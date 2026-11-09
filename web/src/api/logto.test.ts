// 实论登录哨兵（change lex-web-shell-convergence 6.2）。
//
// 这份登录原先是从 fd-zhesi「照抄」的 103 行残版，**没有 refresh**：
// 会话一过期就得重新登录。切到共享壳后应获得静默续期——本文件就守这件事。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { currentToken, ensureFreshToken, handleCallback, isLoggedIn, login, logout } from './logto'

/** 极简 storage 桩（本仓刻意不引 jsdom，测试走手搓桩）。 */
function makeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

let sessionStore: ReturnType<typeof makeStorage>
let localStore: ReturnType<typeof makeStorage>

function installWindow(href = 'https://shilun.test/workbench') {
  sessionStore = makeStorage()
  localStore = makeStorage()
  const loc = {
    origin: 'https://shilun.test',
    href,
    assign: (url: string) => {
      assigned.push(url)
    },
  }
  assigned = []
  const g = globalThis as unknown as Record<string, unknown>
  g.window = {
    location: loc,
    sessionStorage: sessionStore,
    localStorage: localStore,
    history: { replaceState: () => {} },
  }
  // client.ts 读的是全局 localStorage（不是 window.localStorage），
  // 壳读的是 window.sessionStorage——两者要指向同一份桩，否则写读分家
  g.localStorage = localStore
  g.sessionStorage = sessionStore
}

let assigned: string[] = []

function b64url(o: Record<string, unknown>): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function idToken(expSeconds = Math.floor(Date.now() / 1000) + 3600): string {
  return `${b64url({ alg: 'ES384' })}.${b64url({ sub: 'u-1', exp: expSeconds })}.sig`
}

beforeEach(() => {
  installWindow()
})

afterEach(() => {
  const g = globalThis as unknown as Record<string, unknown>
  delete g.window
  delete g.localStorage
  delete g.sessionStorage
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('实论登录', () => {
  it('未登录时 currentToken 为空', () => {
    expect(currentToken()).toBeNull()
    expect(isLoggedIn()).toBe(false)
  })

  it('回跳成功把 token 同步给 client 的读取键（localStorage）', async () => {
    // 造一个 PKCE 现场（壳用 shilun 前缀 + sessionStorage）
    installWindow('https://shilun.test/workbench?code=c&state=s-1')
    sessionStore.setItem('shilun.pkce', JSON.stringify({ verifier: 'v-1', state: 's-1' }))
    const token = idToken()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ id_token: token }) }) as Response),
    )

    const ok = await handleCallback()
    expect(ok).toBe(true)
    expect(currentToken()).toBe(token)
    // client.ts 读的键（顶栏与 API 共用）
    expect(localStore.getItem('shilun_token')).toBe(token)
  })

  it('state 不符时不换 token（CSRF 守卫）', async () => {
    installWindow('https://shilun.test/workbench?code=c&state=other')
    sessionStore.setItem('shilun.pkce', JSON.stringify({ verifier: 'v', state: 's-1' }))
    const ok = await handleCallback()
    expect(ok).toBe(false)
    expect(currentToken()).toBeNull()
  })

  it('登出清空 token', () => {
    localStore.setItem('shilun_token', 'x')
    logout()
    expect(currentToken()).toBeNull()
    expect(localStore.getItem('shilun_token')).toBeNull()
  })

  it('静默续期：过期会话用 refresh token 换新（原先这份实现没有 refresh）', async () => {
    // 造一个已过期但带 refresh token 的会话（壳的键：shilun.session）
    const expired = Math.floor(Date.now() / 1000) - 60
    sessionStore.setItem(
      'shilun.session',
      JSON.stringify({
        idToken: idToken(expired),
        refreshToken: 'refresh-1',
        expiresAt: Date.now() - 60_000,
        identity: 'u-1',
      }),
    )
    const fresh = idToken()
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(String(init?.body ?? ''))
        return { ok: true, status: 200, json: async () => ({ id_token: fresh, refresh_token: 'refresh-2' }) } as Response
      }),
    )

    const token = await ensureFreshToken()
    expect(token).toBe(fresh)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('grant_type=refresh_token')
    expect(calls[0]).toContain('refresh_token=refresh-1')
    // 新 token 同步给 client 的读取键
    expect(localStore.getItem('shilun_token')).toBe(fresh)
  })

  it('续期失败（凭据失效）返回 null，不假装已登录', async () => {
    sessionStore.setItem(
      'shilun.session',
      JSON.stringify({
        idToken: idToken(Math.floor(Date.now() / 1000) - 60),
        refreshToken: 'refresh-bad',
        expiresAt: Date.now() - 60_000,
        identity: 'u-1',
      }),
    )
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    expect(await ensureFreshToken()).toBeNull()
  })

  it('login 会跳转到 Logto authorize（带 PKCE 参数）', async () => {
    await login()
    expect(assigned).toHaveLength(1)
    expect(assigned[0]).toContain('/oidc/auth?')
    expect(assigned[0]).toContain('code_challenge_method=S256')
    // 回归：issuer 必须是基地址，拼出来的授权端点不能出现双 /oidc
    expect(assigned[0]).not.toContain('/oidc/oidc')
    expect(assigned[0].startsWith('https://auth.finddatatech.cloud/oidc/auth?')).toBe(true)
    expect(assigned[0]).toContain('redirect_uri=')
  })
})
