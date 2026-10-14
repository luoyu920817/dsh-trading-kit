/**
 * 本插件消费的 cordis 服务结构镜像 + 共享 Context 面。
 *
 * 搬运溯源：结构镜像做法与接口形态搬自 DSH-better-sidebar `src/context-types.ts`
 * （插件范式参照仓，非运行时依赖；只搬结构、按本仓需要裁剪，台账见 docs/carryover.md）。
 *
 * 为什么用交集（intersection）而不是 declare module 增强：DSH 自有包会对同一
 * `@deepseek-ai/cordis` Context 成员声明不同类型，重复声明会 TS2717 冲突；
 * 交集让每个调用点各自解析所需成员。（`traderKit` 服务例外——它是本插件自有
 * 服务、无第三方声明冲突，在 `src/service/index.ts` 用 declare module 增强。）
 *
 * 运行时事实（spike-tdx-embed 设计已核验的宿主符号，版本等价性未核验）：
 * - `webServer.register` 对重复 `(kind, path)` 抛错；`WebRoute.kind` 只有 `'exact' | 'prefix'`；
 *   `port` 允许配置 `0`（OS 分配），故 URL 必须由插件运行时打印。
 * - `connection.requestRejection(req)` = Host/Origin 栅栏 + cookie 校验，返回
 *   `401 | 403 | undefined`，无跳转；**插件路由不会被宿主自动鉴权**，须自行调用。
 * - `connection.authenticatedUrl(url)` 在 URL 上拼宿主 launchToken（BrowserAuth 私有
 *   字段，公共面**没有任何 token 校验原语**）。
 */
import type { Context as CordisContext } from '@deepseek-ai/cordis'
import type { KeywordJobsLike } from './review/processors/host-jobs.ts'

/** 路由 handler 看到的请求面（node `IncomingMessage` 的结构子集）。 */
export interface TraderKitHttpRequest {
  url?: string
  method?: string
  headers: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<string | Uint8Array>
}

/** 路由 handler 写出的响应面（node `ServerResponse` 的结构子集）。 */
export interface TraderKitHttpResponse {
  statusCode: number
  writeHead(status: number, headers?: Record<string, string>): void
  end(body?: string | Uint8Array): void
}

/** 一条具名 webserver 路由（host-webserver `WebRoute` 的结构镜像）。 */
export interface TraderKitWebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: TraderKitHttpRequest, res: TraderKitHttpResponse) => void | Promise<void>
}

/** webServer 服务面（含 `port`/`host` 公共 getter，探针三行 URL 打印依赖）。 */
export interface TraderKitWebServer {
  register(route: TraderKitWebRoute): () => void
  /** 监听端口（配置为 0 时由 OS 分配）。 */
  readonly port: number
  readonly host: string
}

/**
 * connection 服务面（`dsh-client-connection` `ConnectionService` 的结构子集）。
 * 公共面还有 `rpc`/`fetch`/`operator`/`createSharedFetchHandler`/`admit`/`authorizeIndex`，
 * 本插件目前只消费以下两个。
 */
export interface TraderKitConnection {
  /** Host/Origin 栅栏 + cookie 校验；返回拒绝码（401|403）或 undefined（放行）。 */
  requestRejection(req: TraderKitHttpRequest): 401 | 403 | undefined
  /** 把宿主 launchToken 拼进给定 URL，返回「两步登录」的第一步地址。 */
  authenticatedUrl(url: string): string
}

/** 工具注册面（`@deepseek-ai/dsh-tools` `ToolRuntime` 的结构镜像）。 */
export interface TraderKitToolsService {
  /** 注册一个工具定义（`defineTool` 产物），返回注销 disposer。 */
  register(tool: unknown): () => void
}

/** 本插件消费的服务形状（与 cordis `Context` 交集）。 */
export interface TraderKitContextShape {
  /** 可选root Jobs能力，缺失不影响旧复盘服务；任务7才接正式执行。 */
  jobs?: KeywordJobsLike
  webServer: TraderKitWebServer
  connection: TraderKitConnection
  tools: TraderKitToolsService
}

/** 本插件视角的 Context：cordis 基础 Context（含 `logger`/`effect`/`provide` 等）交集上表。 */
export type Context = CordisContext & TraderKitContextShape
