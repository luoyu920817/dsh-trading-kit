/**
 * 探针路由（change 1 spike-tdx-embed；tasks 1.1–1.8；design D-1/D-2/D-3/D-10）。
 *
 * 定位：阶段 1 出口后的可行性闸门——验证「TDX 内嵌浏览器打开宿主同端口 http
 * 路由页」。spike 后保留为诊断页（本文件模块常量开关；change 2 已落地
 * `src/config.ts`，接管回写归其所有，本模块不 import 配置面）。
 *
 * 安全红线（沿 dsh-trading 基线）：只读诊断——不写数据根/vault，不调用行情
 * 或交易接口（无 order_stock / cancel_order 调用路径）；探针页为静态单文件，
 * 页面侧不发起任何网络请求。
 *
 * 认证三层（design D-3 / iteration-1-contracts §12.1，判定顺序按 spec
 * 「认证流程」场景逐字实现）：
 * - 首行（MUST）：`requestRejection(req)` —— 宿主 Host/Origin 栅栏 + cookie
 *   校验；插件路由不被宿主自动鉴权，拒绝码由本 handler 自行输出（401/403，
 *   附 `Cache-Control: no-store`——spec「拒绝由状态码与 no-store 响应本身作证」）。
 * - 403（栅栏）不可被任何 token 救援：栅栏是 DNS-rebinding/跨站防御，不是认证。
 * - 401（无 cookie）→ B 层救援：**插件自有**诊断 token（`?token=`，挂载时
 *   `crypto.randomBytes` 生成、仅内存 + 日志、路由层 sha256 后常数时间比对）。
 *   四项边界：来源 = 插件生成（不是宿主认证，不得声称等价）；有效期 = 进程
 *   生命周期（重启即失效、无持久化）；作用域 = 仅 `<basePath>/probe` 诊断路由；
 *   明文出现在 URL 查询串（可能进日志/历史）→ **业务写入 MUST NOT 依赖 B 层**。
 *   MUST NOT 校验宿主 launchToken——`connection` 公共面无任何 token 校验原语
 *   （launchToken 为 BrowserAuth 私有字段，仅在 `authenticatedUrl()` 内拼 URL）。
 * - 401 且无 B 层 token → C 层开关（代码常量 `UNAUTHENTICATED_READONLY_DEFAULT`，
 *   默认 false）：false 时保持 401；置 true 前 MUST 取得 owner 签字（见常量注释
 *   的放宽点定义）。业务写入 MUST NOT 走 C 层。
 * - cookie 有效（A 层两步登录的第二步）→ `auth: 'cookie'`；A→B 顺序，同请求
 *   即使同时带 B 层 `?token=` 也记 `'cookie'`。
 * - 负向事实（spec「未认证拒绝」与「跳转」的区分）：仅带 `?token=` 直连本路由
 *   （宿主 launchToken 或任何未知 token）必然 401——`?token=` 只在根路径被宿主
 *   `authorizeIndex` 消费，`isAuthenticated` 只读 cookie。报告 MUST 记录该负向
 *   结果，MUST NOT 据此判「TDX 不接受 tokenized URL」。
 *
 * 单测 seam（D-10，零 mock）：handler 提取为纯工厂 `createProbeHandler(deps)`，
 * 测试用 IncomingMessage/ServerResponse 形状桩 + 真实临时 node:http server +
 * node:net 裸 socket 驱动（见 test/probe/**）。「路由注册/卸载」为集成核对项，
 * 插件层仅按 `ctx.effect` disposer 契约做结构断言，不写成零 mock 单测。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Context, TraderKitHttpRequest, TraderKitHttpResponse } from '../context-types.ts'
import { PROBE_HTML, PROBE_STATE_PLACEHOLDER } from '../client/probe/index.html.ts'

// ── 模块常量（tasks 1.1；design D-1 配置面定案）────────────────────────────
//
// 配置面所有权（iteration-1-contracts §11）：`src/config.ts` 的配置导出唯一
// owner 是 change 2。本 change 曾定案「不引入 Config、不改 cordis.patch.yml」；
// 与 change 2 同波次并行落地后裁决（偏离登记见 tasks 1.1 勾选项）：扫描域收窄
// 为 src/routes/** 与 src/client/**——本模块不引入配置面导出、不保留 change 2
// 的配置类型名，也不 import src/config.ts（边界扫描见 test/probe）。

/** 探针路由路径（`kind: 'exact'`；默认 basePath 内联于此，MUST NOT 占用 prefix 路由）。 */
export const PROBE_PATH = '/dsh-trader-kit/probe'

/** basePath（由 PROBE_PATH 派生，单一事实源；change 2 落地 Config 后由其 basePath 字段接管）。 */
export const PROBE_BASE_PATH = PROBE_PATH.slice(0, PROBE_PATH.length - '/probe'.length)

/** 诊断页开关默认值（spike 后常驻为诊断页；关闭时不注册探针路由）。 */
export const DIAGNOSTICS_DEFAULT = true

/**
 * C 层未认证只读开关：**代码常量，非配置项**（R2-6 定案 ②；MUST NOT 新增配置
 * 字段，`Config` 归 change 2）。
 *
 * **owner 签字沿革：2026-09-27 owner 签字采纳 C 层（动机 = TDX 内嵌浏览器不保证
 * 携带 cookie，需免认证只读入口做承载验证），常量自此为 `true`。**
 * 放宽点（签字范围，MUST NOT 默认外溢）：
 * ① 放行路径白名单 = 仅 `PROBE_PATH`（不外溢宿主其它路径）；
 * ② 放行方法白名单 = 仅 GET（只读；非 GET 走 405）；
 * ③ 仅救 401（无凭据）——403 跨站栅栏不救援（栅栏是 DNS-rebinding/跨站防御，不是
 *    认证；better-sidebar trust-fence 先例）；
 * ④ 服务端仅绑 127.0.0.1（loopback），未认证可读面 = 同机进程；
 * ⑤ 能力边界 = 只读诊断、无任何写接口；**业务写入 MUST NOT 走 C 层**（`§12.1`：
 *    写接口认证 = A 层 cookie 硬门槛，change 4 落地时不受本签字影响）。
 * 签字时间与范围已记入 docs/roadmap.md 安全面决策（spike tasks 1.7/4.5）。
 */
export const UNAUTHENTICATED_READONLY_DEFAULT = true

/** 服务端按请求注入的认证判定取值（D-2/R2-8：拒绝态不设枚举取值，页面不渲染）。 */
export type ProbeAuthKind = 'cookie' | 'diagnostic-token' | 'none'

/** `window.__PROBE__` 注入状态（D-2 定死五字段，MUST NOT 扩字段）。 */
export interface ProbeState {
  auth: ProbeAuthKind
  status: number
  port: number
  basePath: string
  /** ISO 8601 注入时刻。 */
  injectedAt: string
}

/** `createProbeHandler` 依赖（D-10 测试 seam；全部显式注入，handler 内无全局副作用）。 */
export interface ProbeHandlerDeps {
  /** 注入模板（PROBE_HTML，含恰好一个 PROBE_STATE_PLACEHOLDER）。 */
  template: string
  /** B 层插件自有诊断 token（挂载时生成，进程生命周期）。 */
  diagnosticToken: string
  /** A 层宿主认证判定（生产 = `ctx.connection.requestRejection`；含 Host/Origin 栅栏 + cookie）。 */
  requestRejection(req: TraderKitHttpRequest): 401 | 403 | undefined
  /** basePath（注入 `window.__PROBE__.basePath`）。 */
  basePath: string
  /** 监听端口（注入 `window.__PROBE__.port`；配置 0 时为 OS 分配值）。 */
  port: number
  /** C 层开关（生产传 `UNAUTHENTICATED_READONLY_DEFAULT`；单测可断言两态）。 */
  unauthenticatedReadonly: boolean
}

/** 探针路由 handler 签名（host-webserver `WebRoute['handler']` 的结构镜像）。 */
export type ProbeRouteHandler = (req: TraderKitHttpRequest, res: TraderKitHttpResponse) => void

/**
 * 探针 handler 纯工厂（tasks 1.5/1.6/1.7；design D-10）。
 *
 * 判定顺序（spec「认证流程」逐字）：
 * 1. 首行 `requestRejection` —— 403（栅栏）立即拒绝，任何 token 不救援；
 * 2. 401（无 cookie）→ B 层 `?token=` 常数时间比对，命中 → 200 `diagnostic-token`；
 * 3. B 层未命中 → C 层开关（owner 2026-09-27 签字后默认 true）→ 未启用则 401；
 * 4. `requestRejection` 放行（A 层 cookie）→ 方法校验（非 GET 405）→ 200 `cookie`。
 * B/C 放行分支同样强制仅 GET（只读放宽点，见 C 层常量注释）。
 */
export function createProbeHandler(deps: ProbeHandlerDeps): ProbeRouteHandler {
  return function probeHandler(req: TraderKitHttpRequest, res: TraderKitHttpResponse): void {
    // D-1 MUST 首行：宿主认证判定（Host/Origin 栅栏 + cookie 校验）。
    // 宿主不代插件鉴权——拒绝码由本 handler 自行输出（writeHead 写状态码 + no-store）。
    const rejection = deps.requestRejection(req)
    if (rejection !== undefined) {
      if (rejection === 401) {
        // B 层（回退 1）：插件自有诊断 token。命中即放行，认证态记 'diagnostic-token'
        //（与 A 层 'cookie' 在证据上可区分）。业务写入 MUST NOT 依赖本层（§12.1）。
        // 放宽点：只读 = 仅 GET（非 GET 405）。
        if (hasValidDiagnosticToken(req, deps.diagnosticToken)) {
          if (req.method !== 'GET') {
            writeRejection(res, 405, 'GET')
            return
          }
          writeProbePage(res, deps, 'diagnostic-token')
          return
        }
        // C 层（回退 2）：未认证只读诊断页。签字沿革与放宽点见
        // UNAUTHENTICATED_READONLY_DEFAULT 注释（2026-09-27 签字采纳，仅 GET、仅本路由）。
        if (deps.unauthenticatedReadonly) {
          if (req.method !== 'GET') {
            writeRejection(res, 405, 'GET')
            return
          }
          writeProbePage(res, deps, 'none')
          return
        }
      }
      // 栅栏（403）不救援：栅栏是跨站防御，不是认证（D-3）；B/C 层不改变栅栏姿态。
      writeRejection(res, rejection)
      return
    }
    // A 层（首选）放行：cookie 有效。同请求即使带 B 层 token 也记 'cookie'（A→B 顺序）。
    if (req.method !== 'GET') {
      writeRejection(res, 405, 'GET')
      return
    }
    writeProbePage(res, deps, 'cookie')
  }
}

/**
 * 把 `window.__PROBE__` 注入模板（tasks 1.4；design D-2）。
 * split/join = 占位符全量替换；函数式替换语义 + JSON 转义见 `escapeInjectedJson`。
 */
export function injectProbeState(template: string, state: ProbeState): string {
  return template.split(PROBE_STATE_PLACEHOLDER).join(escapeInjectedJson(state))
}

/**
 * JSON 序列化 + 内联脚本转义：`<` → `\u003C`（`</script>` 不得逃逸）、
 * `&` → `\u0026`、U+2028/U+2029 → `\u2028`/`\u2029`（JS 行终止符，字符串外也非法）。
 */
function escapeInjectedJson(state: ProbeState): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003C')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** 拒绝响应：不渲染页面、不注入；`no-store` 使缓存无法把 A 请求的判定结果发给 B（D-2）。 */
function writeRejection(res: TraderKitHttpResponse, status: number, allow?: string): void {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
  if (allow !== undefined) {
    headers['Allow'] = allow
  }
  res.writeHead(status, headers)
  res.end()
}

/** 200 探针页：`text/html` + `no-store` + 注入 `window.__PROBE__`（D-2）。 */
function writeProbePage(res: TraderKitHttpResponse, deps: ProbeHandlerDeps, auth: ProbeAuthKind): void {
  const state: ProbeState = {
    auth,
    status: 200,
    port: deps.port,
    basePath: deps.basePath,
    injectedAt: new Date().toISOString(),
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(injectProbeState(deps.template, state))
}

/**
 * B 层 token 校验：`?token=` 原样读取（不 decode，token 为 hex 串），双侧先
 * sha256 再 `timingSafeEqual`（摘要定长，长度不同的输入也走同一比较分支）。
 */
function hasValidDiagnosticToken(req: TraderKitHttpRequest, expected: string): boolean {
  const url = req.url
  if (typeof url !== 'string' || url === '') {
    return false
  }
  const queryIndex = url.indexOf('?')
  if (queryIndex === -1) {
    return false
  }
  const provided = readQueryParam(url.slice(queryIndex + 1), 'token')
  if (provided === '') {
    return false
  }
  const providedDigest = createHash('sha256').update(provided).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(providedDigest, expectedDigest)
}

/** 手工读第一个同名查询参数的原样值（不经 URLSearchParams，避免隐式解码）。 */
function readQueryParam(query: string, name: string): string {
  const parts = query.split('&')
  for (const part of parts) {
    const eq = part.indexOf('=')
    const key = eq === -1 ? part : part.slice(0, eq)
    if (key === name) {
      return eq === -1 ? '' : part.slice(eq + 1)
    }
  }
  return ''
}

/** 探针线的最小日志面（cordis 命名 logger，缺失时降级 console——tasks 1.1）。 */
interface ProbeLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
}

function resolveProbeLogger(ctx: Context): ProbeLogger {
  const sinks: ProbeLogger[] = []
  // 实测宿主 0.1.7-rc.1 下 cordis 命名 logger 的 info 不落 stdout（级别/导出器过滤），
  // 而挂载期三行 URL 与 B 层 token 是人工核对清单首项（tasks 1.1/2.1），必须出现在
  // `dsh web` 控制台——tasks 1.1 允许的第二通道 console 双写兜底（测试经注入 logger 收录）。
  const service: unknown = ctx.logger
  if (typeof service === 'function') {
    try {
      const named: unknown = (service as (name?: string) => unknown)('dsh-trader-kit')
      const candidate = named as ProbeLogger | null | undefined
      if (candidate !== null && candidate !== undefined && typeof candidate.info === 'function' && typeof candidate.warn === 'function') {
        sinks.push(candidate)
      }
    } catch {
      // 命名 logger 不可用时仅用 console。
    }
  }
  sinks.push(console as unknown as ProbeLogger)
  return {
    info: (...args) => { for (const s of sinks) s.info(...args) },
    warn: (...args) => { for (const s of sinks) s.warn(...args) },
  }
}

/** `mountProbe` 选项（生产 = registerProbe 传 DIAGNOSTICS_DEFAULT；结构断言用参数断言两态）。 */
export interface ProbeMountOptions {
  /** 诊断页开关（false 时不注册探针路由——spec「诊断页开关」）。 */
  diagnosticsEnabled: boolean
}

/**
 * 探针线装配（tasks 1.1/1.2/1.6；design D-1）：
 * B 层诊断 token 生成 → `ctx.effect` 包裹路由注册（disposer 纪律）→ 三行 URL 打印
 * （端口可能为 0/OS 分配，MUST 由插件运行时打印，人工核对清单首项以此为准）。
 */
export function mountProbe(ctx: Context, options: ProbeMountOptions): void {
  const logger = resolveProbeLogger(ctx)
  if (!options.diagnosticsEnabled) {
    // spec「关闭诊断页」：不注册探针路由——插件层断言「不由插件 handler 响应、
    // 无残留 handler」；该请求实际状态码由宿主 fallback 决定（集成核对项）。
    logger.warn('[dsh-trader-kit] 诊断页关闭（DIAGNOSTICS_DEFAULT=false），探针路由未注册')
    return
  }
  const port = ctx.webServer.port
  const base = 'http://127.0.0.1:' + String(port)
  // B 层：插件自有诊断 token——挂载时生成、仅内存 + 日志打印（有效期 = 进程生命周期）。
  const diagnosticToken = randomBytes(32).toString('hex')
  const handler = createProbeHandler({
    template: PROBE_HTML,
    diagnosticToken,
    requestRejection: (req) => ctx.connection.requestRejection(req),
    basePath: PROBE_BASE_PATH,
    port,
    unauthenticatedReadonly: UNAUTHENTICATED_READONLY_DEFAULT,
  })
  // 注册返回的 disposer 交由 cordis effect 收集，插件卸载时自动注销（路由 disposer 纪律）。
  ctx.effect(() => ctx.webServer.register({ kind: 'exact', path: PROBE_PATH, handler }), 'dsh-trader-kit: probe route')
  // 三行 URL（D-1「URL 打印」）：base / 登录（A 层第一步铸 cookie）/ 探针。
  logger.info('[dsh-trader-kit] 探针 base URL: ' + base)
  logger.info('[dsh-trader-kit] 登录 URL（A 层第一步，宿主铸 cookie 后 303）: ' + ctx.connection.authenticatedUrl(base + '/'))
  logger.info('[dsh-trader-kit] 探针 URL: ' + base + PROBE_PATH)
  logger.info('[dsh-trader-kit] 诊断 token（B 层，仅 <basePath>/probe 生效，URL 明文风险，业务写入不得依赖）: ' + diagnosticToken)
}

/** 探针线注册入口（`src/index.ts` 装配行调用；导出名与签名保持不变）。 */
export function registerProbe(ctx: Context): void {
  mountProbe(ctx, { diagnosticsEnabled: DIAGNOSTICS_DEFAULT })
}
