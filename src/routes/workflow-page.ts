import type { Context, TraderKitHttpRequest, TraderKitHttpResponse } from '../context-types.ts'
import { WORKFLOW_PAGE_HTML } from '../client/processors/page.ts'

export const WORKFLOW_PAGE_PATH = '/dsh-trader-kit/review/processors'

/**
 * 创建独立关键词管理页面入口。
 * 业务逻辑: 首先执行宿主访问栅栏和 Cookie 认证，然后仅返回静态管理 HTML。
 * 关键判断: 401/403 均不救援；页面只接受 GET，不注入写凭据或内部运行参数。
 * 异常处理: 宿主认证异常封闭为 503，响应只含通用提示。
 * 参数: requestRejection 为宿主认证函数。返回: 同步页面 handler。
 */
export function createWorkflowPageHandler(requestRejection: (req: TraderKitHttpRequest) => 401 | 403 | undefined): (req: TraderKitHttpRequest, res: TraderKitHttpResponse) => void {
  /**
   * 处理一次管理页面访问。
   * 业务逻辑: 校验认证、方法及精确路径后输出 HTML。
   * 关键判断: 查询串不作为凭据，管理 API 使用独立路由。
   * 异常处理: 认证异常返回 503；拒绝响应不包含管理 DOM。
   * 参数: req 为请求，res 为响应。返回: 无。
   */
  return function handler(req, res): void {
    const headers = { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' }
    let rejection: 401 | 403 | undefined
    try { rejection = requestRejection(req) }
    catch { res.writeHead(503, headers); res.end('管理页面认证暂不可用'); return }
    if (rejection) { res.writeHead(rejection, headers); res.end('请先完成宿主登录并通过访问栅栏'); return }
    if ((req.method || 'GET') !== 'GET') { res.writeHead(405, { ...headers, allow: 'GET' }); res.end('仅支持 GET'); return }
    if ((req.url || '').split('?')[0] !== WORKFLOW_PAGE_PATH) { res.writeHead(404, headers); res.end('页面不存在'); return }
    res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8', 'referrer-policy': 'no-referrer' })
    res.end(WORKFLOW_PAGE_HTML)
  }
}

/**
 * 注册 Cookie 认证的精确管理页面路由。
 * 业务逻辑: effect 注册并拥有页面 disposer，复用已有宿主认证。
 * 关键判断: 不占用 API 前缀，不构造第二运行服务。
 * 异常处理: 宿主注册错误直接传播，由插件生命周期处理。
 * 参数: ctx 为真实宿主上下文。返回: 无。
 */
export function registerWorkflowPage(ctx: Context): void {
  const handler = createWorkflowPageHandler(req => ctx.connection.requestRejection(req))
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: WORKFLOW_PAGE_PATH, handler }))
}
