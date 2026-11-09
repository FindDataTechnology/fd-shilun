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
