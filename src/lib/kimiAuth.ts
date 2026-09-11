/**
 * Kimi OAuth 登录辅助（纯逻辑，无 React 组件）。
 *
 * 从 components/LoginSheet.tsx 拆出：该文件需要保持「只导出组件」以满足
 * react-refresh 的 Fast Refresh 边界；OAuth 取址与跳转属于纯函数，独立成模块。
 */

/** 构造 Kimi OAuth 授权 URL。
 *  配置来源优先取服务端：GET /api/oauth/nonce 返回 { nonce, authUrl, appId }
 *  （nonce 为登录 CSRF 防护，state = base64(JSON{ r: redirectUri, n: nonce })），
 *  这样前端构建无需注入 VITE_KIMI_AUTH_URL / VITE_APP_ID，发布包不依赖构建期密钥；
 *  后端接口未就绪时降级到构建期 import.meta.env，再不行降级原 state = base64(redirectUri)，不阻断登录。 */
export async function getKimiOAuthUrl(): Promise<string> {
  let kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL as string | undefined
  let appID = import.meta.env.VITE_APP_ID as string | undefined
  const redirectUri = `${window.location.origin}/api/oauth/callback`
  let state = btoa(redirectUri)
  try {
    const resp = await fetch('/api/oauth/nonce', { credentials: 'include' })
    if (resp.ok) {
      const data = (await resp.json()) as { nonce?: string; authUrl?: string; appId?: string }
      // origin 为 punycode、nonce 由服务端生成，均为 ASCII，btoa 安全
      if (data && typeof data.nonce === 'string' && data.nonce) {
        state = btoa(JSON.stringify({ r: redirectUri, n: data.nonce }))
      }
      if (data && typeof data.authUrl === 'string' && data.authUrl) kimiAuthUrl = data.authUrl
      if (data && typeof data.appId === 'string' && data.appId) appID = data.appId
    }
  } catch {
    // nonce 接口不存在或网络失败：保持降级 state 与构建期配置，不阻断登录
  }
  if (!kimiAuthUrl || !appID) {
    throw new Error('登录服务未配置（缺少授权地址或应用 ID）')
  }
  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`)
  url.searchParams.set('client_id', appID)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'profile')
  url.searchParams.set('state', state)
  return url.toString()
}

/** 跳 Kimi OAuth 授权页（与 Login 页同一套参数） */
export function goKimiLogin() {
  void getKimiOAuthUrl()
    .then((url) => {
      window.location.href = url
    })
    .catch(() => {
      window.alert('登录服务暂不可用，请稍后再试')
    })
}
