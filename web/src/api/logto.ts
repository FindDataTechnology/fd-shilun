// 实论（shilun）登录：内核换成共享壳（change lex-web-shell-convergence 6.2）。
//
// 原先这份是「照抄 fd-zhesi」的 103 行残版：只有 code→id_token，
// **没有 refresh**——会话一过期就得重新登录。切到壳之后自动获得静默续期。
//
// 对外 API 保持原样（currentToken / isLoggedIn / login / handleCallback / logout），
// 所以 App.tsx 与 client.ts 都不用改。唯一变化：token 落 sessionStorage 而非
// localStorage（壳的默认），关掉标签页即失效——这是有意的收紧。
import { createAuth } from '../kit/auth/index'
import { setToken, TOKEN_KEY } from './client'
import { ssoHintMark as mark, ssoHintSeen as seen } from '../kit/auth/sso-hint'

// 壳约定：issuer 是**基地址**（不含 /oidc），由壳拼 `${issuer}/oidc/auth`。
// 这里原先写的是含 /oidc 的完整 issuer，直接传会拼出 /oidc/oidc/auth。
const ISSUER_BASE = 'https://auth.finddatatech.cloud'
const CLIENT_ID = 'aqqinerulglscp6tw1fy0' // Logto: shilun-workbench（SPA）
const SCOPE = 'openid profile offline_access'

/**
 * 惰性构造：回跳地址依赖 `window.location.origin`，模块加载期读它会让本文件
 * 在 node 环境下直接抛（这也是它此前没有任何测试的原因）。首次使用时才求值。
 */
let instance: ReturnType<typeof createAuth> | null = null
function auth() {
  if (!instance) {
    instance = createAuth({
      fetchConfig: async () => ({
        configured: true,
        issuer: ISSUER_BASE,
        client_id: CLIENT_ID,
        scopes: SCOPE.split(' '),
        organization_required: false,
        missing: [],
      }),
      redirectUri: `${window.location.origin}/workbench`,
      storagePrefix: 'shilun',
      tokenStorage: 'session',
    })
  }
  return instance
}

/** 当前 ID token（供 client.ts 之外的读取方；写路径仍由 client.setToken 统一）。 */
export function currentToken(): string | null {
  return auth().loadSession()?.idToken ?? null
}

export function isLoggedIn(): boolean {
  return Boolean(currentToken())
}

/** 发起登录；未配置时报错而非假登录（壳内的如实阻塞）。 */
export async function login(): Promise<void> {
  await auth().beginLogin()
}

/**
 * 同租户静默单点登录（web-shell-kit「同租户静默单点登录」）。
 *
 * 形状由真实 IdP 决定（2026-11-18 实测 auth.finddatatech.cloud）：无会话时
 * `prompt=none` 是 303 到回跳地址带 `error=login_required`，auth 域带
 * X-Frame-Options: SAMEORIGIN（iframe 不可行）——所以「静默」是一次整页跳转，
 * 多数情况下带 code 直接回来。只在**回跳落地**时被调用（见 App 的挂载点）。
 */
export async function trySilentLogin(): Promise<'logged-in' | 'interactive-required'> {
  try {
    const outcome = await auth().trySilentLogin()
    if (outcome === 'logged-in') {
      const token = auth().loadSession()?.idToken
      if (token) setToken(token)
    }
    return outcome
  } catch {
    // 真实故障不该被静默吞掉：交给调用方按「未登录」呈现，但保留已登录态
    return 'interactive-required'
  }
}

/** 发起一次静默授权跳转（`prompt=none`）。调用方应只在**确认本机值得一试**时调用，
 *  否则每个首次访客都要白跳两趟。 */
export async function beginSilentLogin(): Promise<void> {
  await auth().beginSilentLogin()
}

// ── 跨站登录提示键 ────────────────────────────────────────────────────────
// 实现在共享壳里（`sso-hint.ts`）：localStorage 按源隔离，记不到「你在柏讯登过」，
// 所以用注册域 cookie；语义只有「本浏览器在这个租户登录过」，不含身份信息。

export const SSO_HINT_DOMAIN = '.finddatatech.cloud'

export const ssoHintSeen = (): boolean => seen(SSO_HINT_DOMAIN)
export const ssoHintMark = (): void => mark(SSO_HINT_DOMAIN)

/** 处理回跳：成功返回 true，并把 token 同步到 client 的读取键。 */
export async function handleCallback(): Promise<boolean> {
  try {
    const result = await auth().completeLogin()
    if (!result.ok) return false
    const token = auth().loadSession()?.idToken
    if (token) setToken(token)
    return Boolean(token)
  } catch {
    return false
  }
}

/**
 * 静默续期：受保护请求前调用。
 * 未过期直接返回当前 token；过期则用 refresh token 续（壳内实现），
 * 续不上返回 null（调用方按「需重新登录」处理，壳不会擅自清会话）。
 */
export async function ensureFreshToken(): Promise<string | null> {
  try {
    const session = await auth().ensureFresh()
    if (!session) return null
    setToken(session.idToken)
    return session.idToken
  } catch {
    // 凭据失效或续期失败：如实返回 null，不假装已登录
    return null
  }
}

export function logout(): void {
  auth().logoutLocal()
  setToken('')
}

/** 共享壳实例（供 App 的静默 SSO 挂载点使用；惰性求值，不提前读 window）。 */
export function authShell() {
  return auth()
}
