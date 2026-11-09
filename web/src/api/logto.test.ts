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

  it('登录全链：登录 → 受保护请求带 Bearer → 续期 → 重放 → 退出后不可达', async () => {
    // ① 登录跳转
    await login()
    expect(assigned[0]).toContain('https://auth.finddatatech.cloud/oidc/auth?')
    const pkceRaw = sessionStore.getItem('shilun.pkce')
    expect(pkceRaw).toBeTruthy()
    const pkce = JSON.parse(pkceRaw as string)

    // ② 回跳换令牌（短命：5 秒后过期）
    const now0 = Date.now()
    const shortExp = Math.floor(now0 / 1000) + 5
    installWindow('https://shilun.test/workbench')
    sessionStore.setItem('shilun.pkce', pkceRaw as string)
    sessionStore.setItem('x', '') // 保持 store 引用不变
    const g = globalThis as unknown as Record<string, unknown>
    ;(g.window as { history: { replaceState: () => void } }).history.replaceState = () => {}
    // 用 replaceState 造回跳地址
    ;(globalThis as unknown as { window: { location: { href: string } } }).window.location.href =
      `https://shilun.test/workbench?code=c-1&state=${pkce.state}`

    const seenAuth: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url)
        if (u.includes('/oidc/token')) {
          const body = String(init?.body ?? '')
          const isRefresh = body.includes('grant_type=refresh_token')
          return {
            ok: true,
            status: 200,
            json: async () =>
              isRefresh
                ? { id_token: idToken(Math.floor(Date.now() / 1000) + 3600), refresh_token: 'r-2' }
                : { id_token: idToken(shortExp), refresh_token: 'r-1' },
          } as Response
        }
        seenAuth.push(String(new Headers(init?.headers).get('Authorization')))
        if (seenAuth.length === 1) return new Response('expired', { status: 401 })
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      }),
    )

    expect(await handleCallback()).toBe(true)

    // ③ 受保护请求：401 → 静默续期 → 重放成功
    const { api } = await import('./client')
    await api.listDoctypes()
    expect(seenAuth.length).toBe(2)
    expect(seenAuth[0]).toMatch(/^Bearer /)
    expect(seenAuth[1]).toMatch(/^Bearer /)
    expect(seenAuth[1]).not.toBe(seenAuth[0])

    // ④ 退出后受保护入口不可达
    logout()
    expect(currentToken()).toBeNull()
    expect(localStore.getItem('shilun_token')).toBeNull()
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
