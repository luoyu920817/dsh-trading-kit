/**
 * 复盘页路由族（change 4 review-page tasks 2.1–2.8；design D-1/D-2/D-3/D-7/D-13，
 * 承载结论 = docs/spikes/tdx-embed.md：http 同端口页面，禁回退 file://）。
 *
 * 路由表（D-1；handler 为同一调度器，宿主 exact 优先于 longest-prefix——
 * host-webserver `match()` 已核验，`/review/api/*` 不会被 path 段吞掉）：
 * | 方法 | 路径                          | 注册 kind | 用途 |
 * | GET  | /dsh-trader-kit/review        | exact     | 页面 HTML（内联资产，离线自包含） |
 * | GET  | …/review/api/local            | exact     | 纯本地段：locateDoc+parseDoc+本地名称层①/③+有卡日期，零出站网络 |
 * | GET  | …/review/api/enrich           | exact     | 网络段：名称层②（T2/S8）+ 标签（T2）+ 涨停原因（T1 有界回溯） |
 * | POST | …/review/api/card             | exact     | 写卡（**只认 A 层**；clientRequestId 幂等） |
 * | POST | …/review/api/card/update     | exact     | 卡片修订（owner 2026-10-05 追授；凭据同写卡；锚点不变仅改正文） |
 * | POST | …/review/api/card/delete     | exact     | 卡片删除（owner 2026-10-05 追授；凭据同写卡；整节移除） |
 * | POST | …/review/api/organize        | exact     | 整理意图登记（owner 2026-10-06 追授；凭据同写卡；返回固定指令供会话发送——MUST NOT 由插件自建 agent 运行） |
 * | GET  | …/review/api/index-quote     | exact     | 指数态行情（owner 2026-10-06 追授；S10 腾讯指数源，读通道） |
 * | GET  | …/review/api/dates            | exact     | 该标的有卡日期（月桶扫描，B2 提示用） |
 * | GET  | …/review（prefix）            | prefix    | 直链 /review/<code> + /review/assets/<name> 的兜底匹配 |
 * MUST NOT 注册 GET /review/api/context（已废止——本地段与网络段 MUST 为独立请求）。
 *
 * 认证（§12.1 + spike 决策第 3 条；design D-3）：
 * - 首行 `requestRejection(req)`：403（Host/Origin 栅栏）不救援；401 时读通道按
 *   `allowUnauthenticatedRead` 分档——**默认 false**（复盘页只读 C 层未签字，owner
 *   对探针页的 C 层签字不外溢；置 true 需 owner 对复盘页单独签字），签字后只读放行
 *   且页面注入 `writable:false`；**写接口两分支同 = 只认 A 层**，未放行一律 401
 *   （{error:'UNAUTHENTICATED'} + 提示），零落盘。B 层诊断 token 不检查（必然 401）。
 * - A 层存活（cookie 放行）→ 页面注入 `writable:true`；TDX 内 A 层未存活时按 spike
 *   口径「写接口显式不可用 + 页面只读降级」，由签字只读分支或 401 承载。
 *
 * 本地段的纯本地性（tasks 2.6，D-7）：本模块 import 面 = src/review/**、src/paths/**、
 * src/client/review/**，零 `fetch`、零 src/data/** import（结构断言见
 * test/routes-review/review-structure.test.ts）；归属交易日经 deps 注入的 T0
 * service 出口（change 2 内存缓存读，§9）。登记缺口：D-7「缓存未命中不发请求」
 * 需要 change 2 透出缓存只读出口，现按 service 出口消费——未命中行为由 change 2
 * 缓存层决定，路由模块自身零出站能力（结构断言保证）。
 *
 * handler 纯工厂（tasks 2.8，沿 probe D-10 先例）：`createReviewHandler(deps)`
 * 只做「请求对象 → 响应对象」映射；单测以请求桩驱动（test/routes-review/**），
 * 注册/卸载与宿主 requestRejection 真实行为属集成核对（tasks 6.1）。
 */
import { readdir, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Context, TraderKitHttpRequest, TraderKitHttpResponse, TraderKitWebRoute } from '../context-types.ts'
import { REVIEW_HTML, REVIEW_STATE_PLACEHOLDER } from '../client/review/index.html.ts'
import { CARD_ANCHOR_RE, normalizeCode } from '../review/anchor.ts'
import { marketPrefixForCode } from '../review/ident.ts'
import { createNameResolver, createTradeDateResolver, type ResolveTradeDateFn, type TradeDateResolver } from '../review/context.ts'
import {
  BACKTRACK_LIMIT_DEFAULT,
  BacktrackAbortedError,
  ENRICH_DAY_TIMEOUT_MS,
  backtrackText,
  runLimitReasonBacktrack,
  toCanonicalDateParam,
  type AbortLike,
  type BacktrackResult,
  type LimitDayFetcher,
} from '../review/enrich.ts'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { formatZonedIso } from '../review/format.ts'
import { appendCard, ConcurrentWriteError, deleteCard, DocMismatchError, locateDoc, parseDoc, AnchorNotFoundError, updateCard, type Card, type Loc } from '../review/store.ts'
import { createStockProfileIfMissing, type EnsureProfileResult } from '../review/profile-create.ts'
import { readStockProfiles } from '../review/profile.ts'
import { readBriefMeta, type BriefMeta } from '../summary/brief.ts'
import { readRunReport, runReportPath, type RunReport } from '../summary/run-report.ts'
import { resolveArea } from '../paths/resolve.ts'
import { readCardImages, readImageFile, ReviewImageError, validateImageUploads, type CardImage, type ImageUpload } from '../review/images.ts'
import { deleteCardImage } from '../review/store.ts'

/** basePath（沿探针先例内联单一事实源；Config 接管归 change 2）。 */
export const REVIEW_BASE_PATH = '/dsh-trader-kit'
/** 复盘页路由路径（exact 注册；同串兼作 prefix 直链路由基路径，分属宿主两张路由表）。 */
export const REVIEW_PAGE_PATH = REVIEW_BASE_PATH + '/review'

/**
 * 整理指令固定模板（owner 2026-10-06 追授「整理」按钮；服务端单一事实源，页面零拼接——
 * spec「交易日行整理动作」，按钮 owner 2026-10-07 自 B3 工具框移到交易日右侧）。agent 的实际执行
 * 由用户在 DSH 会话发送该指令触发；
 * 插件不自建 agent 运行路径（review-loop 草案纪律）。
 */
export function buildOrganizePrompt(code: string, date: string): string {
  return '整理 ' + code + (date !== '' ? '（' + date + '）' : '（最近交易日）') + ' 的复盘日志：'
    + '请按 review-daily-summary 的单标的口径执行——用 review_read_daily 读取该标的当日与历史卡片，'
    + '结合 get_limit_reason / get_concepts 的行情事实给出结构化预分析（事实面 + 待跟踪项），'
    + '并用 review_append_ainote 写入该标的当日文档的 AI 附注（幂等，已有附注则跳过）。'
    + '研究辅助，不构成投资建议；MUST NOT 改写用户卡片正文，MUST NOT 输出交易指令。'
}

/**
 * C 层未认证只读开关（复盘页）：**owner 签字沿革**——2026-10-05 owner 指示
 * 「全部免签名」，签字采纳复盘页读通道免认证（`allowUnauthenticatedRead=true`）。
 * 放宽点 = 仅本插件 /review 路由族的 GET 只读（页面/本地读/回溯/静态资产）、
 * 服务端仅绑 127.0.0.1；**写接口在任何取值下只认 A 层**（红线不随本签字移动；
 * A 层不可用时页面呈现只读降级 + DSH 侧写卡提示）。签字范围记 docs/roadmap.md §5.0。
 */
export const ALLOW_UNAUTHENTICATED_READ_DEFAULT = true

/** 页面注入状态（`window.__REVIEW__`；D-3 只读降级标记 = writable）。 */
export interface ReviewPageState {
  /** A 层可用（或经签字只读分支且 A 层可用）= true；owner 2026-10-05 起写通道有
   *  writeKey 兜底，页面恒可写（writeKey 由服务端注入，页面自动携带）。 */
  writable: boolean
  /** 写接口密钥（服务端注入——页面 POST 自动携带；页面读者 = 回环访问者，威胁模型一致）。 */
  writeKey: string
  basePath: string
  routePath: string
  /** ISO 8601 注入时刻（运行时刻展示，非业务日期）。 */
  injectedAt: string
}

/** 本地段名称层（取值域只有 ① frontmatter-history 与 ③ code-only，§12.4）。 */
export interface ReviewLocalNameView {
  value: string | null
  nameSource: 'frontmatter-history' | 'code-only'
  confidence: 'high' | 'low'
}

/** 网络段 B1 标签视图（T2 概念的页面面，装配点自 service 出口适配）。 */
export interface ReviewConceptView {
  available: boolean
  labels: string[]
  /** T2/S8 附带名称（层② 反查的同一出口；enrich 名称段消费）。 */
  name: string | null
  detail: string | null
}

/** `/api/enrich` 行情四格段（S9 快照；available=false 时数值字段全 null + detail 带原因——MUST NOT 用 0 冒充）。 */
export interface ReviewQuoteView {
  available: boolean
  /** 现价（元）。 */
  price: number | null
  /** 涨跌幅 %。 */
  pct: number | null
  /** 流通市值（元）。 */
  ltsz: number | null
  /** 总市值（元）。 */
  zsz: number | null
  /** 流通股本（股）。 */
  ltgb: number | null
  detail: string | null
}

/**
 * `/api/enrich` 基础信息段（review-loop：TQ-Local 只读兜底的结构面）。
 * 文本一律**原样字符串**（换算归页面）；不可用时全 null + detail。
 * routes 层不 import `src/data/**`——本类型是出口的结构面（装配点适配）。
 */
export interface ReviewBasicsView {
  available: boolean
  /** `HSStockKind` 原文（`0`=指数 / `1`=A股主板 / `7`=基金 …）。 */
  kind: string | null
  /** `J_start` 原文（`'0'` 归一为 null）。 */
  listedAt: string | null
  region: string | null
  industry: string | null
  /** 流通股本（万股，原样字符串）。 */
  floatSharesWan: string | null
  /** 总股本（万股，原样字符串）。 */
  totalSharesWan: string | null
  detail: string | null
}

/** `/api/day` 当日清单元素（`scanDailyCardTargets` 结构面）。 */
export interface ReviewDayTarget {
  code: string
  name: string
  path: string
  cardCount: number
  hasAinote: boolean
  /** 文件名市场前缀（`sh|sz|bj`；旧式无前缀文档缺省——owner 2026-10-08 P0 透传）。 */
  qualifier?: string
}

export type ReviewRouteHandler = (req: TraderKitHttpRequest, res: TraderKitHttpResponse) => Promise<void>

/** `createReviewHandler` 依赖（tasks 2.8 六组 seam；全部显式注入，handler 无全局副作用）。 */
export interface ReviewHandlerDeps {
  // ① 认证判定
  /** A 层宿主认证判定（生产 = `ctx.connection.requestRejection`；含 Host/Origin 栅栏 + cookie）。 */
  requestRejection(req: TraderKitHttpRequest): 401 | 403 | undefined
  /** C 层只读放宽（生产传 ALLOW_UNAUTHENTICATED_READ_DEFAULT；置 true 需复盘页专项签字）。 */
  allowUnauthenticatedRead: boolean
  // ② 存储导出（locateDoc/parseDoc/appendCard；appendAinote/scanDailyCardTargets 无路由消费方——change 5 工具线专用）
  locateDoc(loc: Loc): Promise<{ path: string; warnings: string[] }>
  parseDoc(path: string): Promise<{ frontmatter: Record<string, unknown>; cards: Card[]; warnings: string[] }>
  appendCard(input: { loc: Loc; body: string; now?: Date; clientRequestId?: string; images?: ImageUpload[] }): Promise<{
    status: 'created' | 'duplicate'
    anchor: string
    path: string
    warnings: string[]
  }>
  /** 卡片修订/删除（owner 2026-10-05 追授；未注入 → 对应接口显式 501）。 */
  updateCard?(input: { anchor: string; body: string; dataRoot: string; images?: ImageUpload[]; market?: string }): Promise<{ status: 'updated'; anchor: string; path: string; warnings: string[] }>
  deleteCard?(input: { anchor: string; dataRoot: string; market?: string }): Promise<{ status: 'deleted'; anchor: string; path: string; warnings: string[] }>
  /** 图片删除与文档修订复用同一存储锁；未注入时显式返回 501。 */
  deleteCardImage?: typeof deleteCardImage
  /** 指数行情（S10 腾讯源；指数态专用——owner 2026-10-06 追授。未注入 → 501 显式）。 */
  getIndexQuote?(code: string): Promise<{ available: boolean; name: string | null; price: number | null; pct: number | null; source: string | null; errors: string[]; detail: string | null; fetchedAt: string | null }>
  // ③ 取数（change 2 service 出口）
  resolveTradeDate: TradeDateResolver['resolve']
  getLimitReason: LimitDayFetcher
  getConcepts(input: { code: string; date?: string }): Promise<ReviewConceptView>
  // ④ enrich 回溯、行情四格与名称层②
  runBacktrack: typeof runLimitReasonBacktrack
  /** 行情快照（S9 realhead；行情四格 + 名称层②末级兜底共用同一次出站。未注入 → 行情段显式不可得、名称层②止于 T2/S8）。 */
  lookupQuote?(code: string): Promise<{
    name: string | null
    price: number | null
    pct: number | null
    ltsz: number | null
    zsz: number | null
    ltgb: number | null
  } | null>
  /** 本地段名称（层①/③；生产 = createNameResolver({dataRoot}) 不注入反查——本地段零网络）。 */
  resolveLocalName(code: string): Promise<ReviewLocalNameView>
  // ⑤ 资产（形态①：内联 lib——生产 readAsset 恒 null；白名单资产面经单测注入资产表核验）
  htmlTemplate: string
  readAsset(relPath: string): string | null
  // ⑥ 配置
  basePath: string
  dataRoot: string
  now(): Date
  /** 写接口密钥（owner 裁决 2026-10-05：回环 + 固定密钥；空串由装配层生成随机值）。 */
  writeKey: string
  /** 回溯上限（默认 6，enrich 内部 clamp 到 [1,6]）。 */
  backtrackLimit?: number
  // ⑦ review-loop（面板/当日状态/名称兜底/首卡建档）
  /** 当日有卡标的清单（`traderKit.review.scanDailyCardTargets` 结构面；未注入 → `/api/day` 显式 501）。 */
  scanDailyCardTargets?(tradeDate: string): Promise<Array<ReviewDayTarget> & { warnings: string[] }>
  /** 运行摘要读取（`src/summary/run-report.ts` 唯一实现；未注入 → runReport=null）。 */
  readRunReport?(path: string): Promise<RunReport | null>
  /** 运行摘要路径（`src/summary/run-report.ts` 唯一实现）。 */
  runReportPath?(dataRoot: string, tradeDate: string): string
  /** 当日盘面 md 存在性元信息（`src/summary/brief.ts` 唯一实现；未注入 → brief=null）。 */
  readBriefMeta?(dataRoot: string, tradeDate: string): Promise<BriefMeta>
  /**
   * TQ-Local 只读兜底（名称层②第三级；`traderKit.data.stockBasics` 结构面）。
   * 未注入 → 该级跳过（名称保持既有层结论）。仅在层①未命中且 T2/S8 与行情源均未取得时调用。
   */
  lookupStockBasics?(code: string): Promise<{
    available: boolean
    name: string | null
    kind: string | null
    listedAt: string | null
    region: string | null
    industry: string | null
    floatSharesWan: string | null
    totalSharesWan: string | null
    notes: string[]
  }>
  /**
   * 首卡懒创建（review-loop：写卡成功后 **fire-and-forget** 触发；未注入 → 跳过）。
   * 建档成败 MUST NOT 影响写卡响应；失败经 `logWarning` 与工具告警可见。
   */
  ensureStockProfile?(input: { code: string; name?: string | null }): Promise<EnsureProfileResult>
  /** 异步动作的告警出口（缺省静默；装配点接插件 logger）。 */
  logWarning?(message: string): void
}

// ---------------------------------------------------------------------------
// 响应与解析小件
// ---------------------------------------------------------------------------

function decodeSafe(v: string): string {
  try {
    return decodeURIComponent(v)
  } catch {
    return v
  }
}

/** 手工查询串解析（不经 URLSearchParams，避免隐式解码；首值胜出）。 */
function parseQuery(query: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (query === '') return out
  for (const part of query.split('&')) {
    const eq = part.indexOf('=')
    const key = eq === -1 ? part : part.slice(0, eq)
    if (key === '' || key in out) continue
    const raw = eq === -1 ? '' : part.slice(eq + 1)
    out[key] = decodeSafe(raw.replace(/\+/g, ' '))
  }
  return out
}

function writeJson(res: TraderKitHttpResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(payload))
}

function writeJsonError(res: TraderKitHttpResponse, status: number, error: string, message: string, extra: Record<string, unknown> = {}): void {
  writeJson(res, status, { error, message, ...extra })
}

/** 405：Allow 头（机器可读）+ JSON 错误体（人类可读）。 */
function writeMethodNotAllowed(res: TraderKitHttpResponse, allow: 'GET' | 'POST'): void {
  res.writeHead(405, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Allow: allow })
  res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '仅 ' + allow }))
}

/** JSON 序列化 + 内联脚本转义（沿 probe 的 injectProbeState 同款：</script> 不得逃逸）。 */
function escapeInjectedJson(state: ReviewPageState): string {
  return JSON.stringify(state)
    .replace(/</g, '\\u003C')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/** 把 `window.__REVIEW__` 注入模板（split/join 全量替换 + JSON 转义，probe 同款）。 */
export function injectReviewState(template: string, state: ReviewPageState): string {
  return template.split(REVIEW_STATE_PLACEHOLDER).join(escapeInjectedJson(state))
}

// ---------------------------------------------------------------------------
// 静态资产白名单（tasks 2.4；形态①内联——白名单面保留，生产 readAsset 恒 null）
// ---------------------------------------------------------------------------

const ASSET_MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
}

/** 单段安全文件名（404 而非 403，避免目录探测）：拒 `..`、`%`、盘符、反斜杠、控制字符。 */
function isSafeAssetName(raw: string): boolean {
  if (raw === '' || raw.length > 64) return false
  if (raw.includes('..')) return false
  if (!/^[0-9A-Za-z._-]+$/.test(raw)) return false
  const dot = raw.lastIndexOf('.')
  return dot > 0 && ASSET_MIME_BY_EXT[raw.slice(dot)] !== undefined
}

// ---------------------------------------------------------------------------
// 直链 path 段安全（GET /review/<code>；穿越一律 404）
// ---------------------------------------------------------------------------

function isSafeDirectSegment(raw: string): boolean {
  if (raw === '' || raw.length > 32) return false
  if (raw.includes('..')) return false
  return /^[0-9A-Za-z._-]+$/.test(raw)
}

// ---------------------------------------------------------------------------
// 有卡日期月桶扫描（/api/local 的 cardedDates 与 /api/dates 共用；纯本地）
// ---------------------------------------------------------------------------

/**
 * 扫 DB/review/<YYYYMM>/ 月桶中该代码的全部文档日（canonical 降序；目录缺失 = 空表）。
 * 声明市场过滤（owner 2026-10-08 P0）：显式 `market` 时仅取该市场文档；缺省时排除
 * 显式**异市场**前缀文档（`sh000688_*` 不属于 `#000688` 深市股票页），旧式无前缀
 * 与同市场前缀文档均计入。
 */
async function scanCardedDates(dataRoot: string, code: string, market?: 'sh' | 'sz' | 'bj'): Promise<string[]> {
  if (dataRoot === '') return []
  // 月桶探针：以占位日期取得月目录（校验照走白名单），dirname 派生 DB/review 基目录
  //（与 store/context 的既有做法一致，不自行拼接模板）。
  const probe = resolveArea(dataRoot, 'review', { code, name: '', date: '19700101' })
  const reviewBase = dirname(probe.areaDirAbs)
  let months: Dirent[]
  try {
    months = await readdir(reviewBase, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
    throw e
  }
  const re = new RegExp(`^((?:sh|sz|bj)?)${code}_.+_(\\d{8})\\.md$`)
  const inferred = marketPrefixForCode(code)
  const found = new Set<string>()
  for (const month of months) {
    if (!month.isDirectory()) continue
    let names: string[]
    try {
      names = await readdir(join(reviewBase, month.name))
    } catch {
      continue // 单月读取失败不阻塞其它月份
    }
    for (const name of names) {
      const m = re.exec(name)
      if (m === null) continue
      const declared = m[1] === '' ? inferred : m[1]
      if (market !== undefined ? declared !== market : (m[1] !== '' && m[1] !== inferred)) continue
      const iso = toCanonicalDateParam(m[2])
      if (iso !== null) found.add(iso)
    }
  }
  return [...found].sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
}

// ---------------------------------------------------------------------------
// 客户端中断的惰性探测（宿主结构面无中断原语——真实 IncomingMessage 带 destroyed）
// ---------------------------------------------------------------------------

function lazyAbortSignal(req: TraderKitHttpRequest): AbortLike {
  const holder = req as { destroyed?: boolean }
  return {
    get aborted() {
      return holder.destroyed === true
    },
    addEventListener() {
      /* 惰性探测：enrich 在每次回溯请求前读取 aborted，无需事件监听 */
    },
  }
}

// ---------------------------------------------------------------------------
// handler 纯工厂（tasks 2.8）
// ---------------------------------------------------------------------------

const BODY_LIMIT = 10_000
const NAME_LIMIT = 200
const CLIENT_REQUEST_ID_LIMIT = 200
const CANONICAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const REQUEST_BODY_LIMIT = 30 * 1024 * 1024

/**
 * 有界读取卡片 JSON（包含可选图片 Base64）。
 * 业务逻辑: 逐块累计字节数，在解析 JSON 前限制请求体内存占用。
 * 关键判断: 30 MiB 请求上限容纳 20 MiB 图片的 Base64 与正文。
 * 异常处理: 超限返回可识别的 413，读取错误交由路由兜底。
 * 参数: req 为请求的异步字节流。
 * 返回: UTF-8 请求正文。
 */
async function readBody(req: TraderKitHttpRequest): Promise<string> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > REQUEST_BODY_LIMIT) throw new ReviewImageError('REQUEST_TOO_LARGE', '请求体超限（上限 30 MiB）', 413)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function describeCause(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 六路由调度器（认证判定在先；`/review/api/*` 分支在直链分支之前——匹配优先级）。
 * `unauthenticatedReadonly` = 401 且签字只读放行时为 true（页面注入 writable:false）。
 */
export function createReviewHandler(deps: ReviewHandlerDeps): ReviewRouteHandler {
  const pageExact = deps.basePath + '/review'

  function servePage(res: TraderKitHttpResponse, writable: boolean): void {
    const state: ReviewPageState = {
      writable,
      writeKey: deps.writeKey,
      basePath: deps.basePath,
      routePath: pageExact,
      injectedAt: new Date().toISOString(),
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(injectReviewState(deps.htmlTemplate, state))
  }

  /**
   * 写接口凭据②（owner 裁决 2026-10-05）：回环来源 + 密钥匹配。
   * 来源白名单 = 宿主仅绑 127.0.0.1（socket.remoteAddress 复核，IPv4/IPv6 回环形态）；
   * 密钥 = x-write-key 头（值 = config.review.writeKey，常数时间比对）。
   */
  function writeCredentialValid(req: TraderKitHttpRequest): boolean {
    const socket = (req as { socket?: { remoteAddress?: unknown } }).socket
    const addr = typeof socket?.remoteAddress === 'string' ? socket.remoteAddress : '127.0.0.1'
    const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
    if (!loopback) return false
    const provided = req.headers?.['x-write-key']
    const value = Array.isArray(provided) ? provided[0] : provided
    if (typeof value !== 'string' || value === '') return false
    const a = Buffer.from(value)
    const b = Buffer.from(deps.writeKey)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  function invalidCodeBody(codeRaw: string): { error: string; message: string } {
    return {
      error: 'INVALID_CODE',
      message: `收到 '${codeRaw}'——期望 6 位数字（如 600000），只去壳（sh/sz/bj 前缀与 .sh/.sz/.bj 后缀）、不补全、不猜测；非法代码不触发任何读取`,
    }
  }

  /**
   * 锚点领域档缓存（owner 2026-10-06 反馈「切换响应速度慢」）：readStockProfiles
   * 每次全量扫描 DB/stock（766+ 份档案，OneDrive 逐文件读）——按 TTL 缓存锚点清单，
   * 过期后**后台刷新、先用旧值**（stale-while-revalidate）；档案编辑最迟 TTL+一次
   * 切换后可见。装配期预热一次（fire-and-forget），消除首切卡顿。
   */
  interface AnchorCacheEntry { code: string | null; name: string; role: string | null; isAnchor: boolean; path: string }

  // 档案查询缓存（owner 2026-10-06）：code → 条目（null = 未命中，也缓存以免重复扫描）。
  // 板块指数/锚点/指数族分散在 800+ 份 DB/stock 档案中，逐码懒查询 + TTL 缓存；
  // OneDrive 预热后单次扫描约 0.1–0.3s，每码首访一次、TTL 内秒回。
  const PROFILE_CACHE_TTL_MS = 120_000
  const profileCache = new Map<string, { at: number; entry: AnchorCacheEntry | null }>()

  async function lookupAnchorEntry(code: string): Promise<AnchorCacheEntry | undefined> {
    const cached = profileCache.get(code)
    if (cached !== undefined && Date.now() - cached.at <= PROFILE_CACHE_TTL_MS) {
      return cached.entry ?? undefined
    }
    try {
      const prof = await readStockProfiles(deps.dataRoot, { codes: [code] })
      const hit = prof.entries[0]
      const entry: AnchorCacheEntry | null = hit !== undefined
        ? { code: hit.code, name: hit.name, role: hit.role, isAnchor: hit.isAnchor, path: hit.path }
        : null
      profileCache.set(code, { at: Date.now(), entry })
      return entry ?? undefined
    } catch {
      return undefined // 读取失败不缓存（下次重试）
    }
  }

  /**
   * 读取当前标的的本地卡片与图片元数据。
   * 业务逻辑: 定位文档、解析用户卡片，再补充同目录图片的路径和可用状态。
   * 关键判断: 无图片保持旧卡片形状；缺图不阻断文字与历史日期展示。
   * 异常处理: 非法代码或日期前置拒绝，图片不可读记录告警。
   * 参数: res 为响应，query 为标的与可选日期。
   * 返回: 写入本地卡片 JSON。
   */
  async function handleLocal(res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    const codeRaw = query.code ?? ''
    const code = normalizeCode(codeRaw)
    if (code === null) {
      const invalid = invalidCodeBody(codeRaw)
      writeJsonError(res, 400, invalid.error, invalid.message, { codeRaw, hint: '检查 TDX 联动编码/参数模板' })
      return
    }
    const dateParam = query.date ?? ''
    let date: string | null = null
    if (dateParam !== '') {
      date = toCanonicalDateParam(dateParam)
      if (date === null) {
        writeJsonError(res, 400, 'INVALID_DATE', `非法日期 '${dateParam}'——期望 canonical YYYY-MM-DD（兼容 YYYYMMDD，归一经 src/data/date.ts）`)
        return
      }
    }
    // 显式市场（owner 2026-10-08 P0）：参与文档定位的市场精确过滤（sh000688 指数 vs 000688 同码股票）。
    const marketError = marketParamError(query.market)
    if (marketError !== null) {
      writeJsonError(res, 400, 'INVALID_MARKET', marketError)
      return
    }
    const market = marketParamOf(query.market)
    if (deps.dataRoot === '') {
      writeJson(res, 200, {
        code,
        codeRaw,
        dataRootConfigured: false,
        error: 'DATA_ROOT_UNCONFIGURED',
        message: '数据根未配置——请在宿主 profile 的 dsh-trader-kit 配置段设置 dataRoot（指向含 DB/ 的数据根目录）',
        name: { value: null, nameSource: 'code-only', confidence: 'low' },
        tradeDate: null,
        date: null,
        dateSource: 'unavailable',
        path: null,
        exists: false,
        cards: [],
        cardedDates: [],
        warnings: [],
      })
      return
    }
    // 归属交易日（仅当未显式指定日期时取 T0——经 service 内存缓存读，§9）。
    let attribution: Awaited<ReturnType<TradeDateResolver['resolve']>> | null = null
    if (date === null) {
      attribution = await deps.resolveTradeDate({})
      date = attribution.value
    }
    const warnings: string[] = []
    let locatedPath: string | null = null
    let exists = false
    let cards: Array<Card & { images?: CardImage[] }> = []
    // 锚点领域档（owner 2026-10-06「通达信内部的指标 我只需要作为一个复盘日志评论的领域归类」）：
    // 88xxxx/999999（TDX 内部指标/显示码）经 DB/stock 档案（代码 索引）解析名称与角色——
    // 页面据此展示领域归类并允许写卡（复用 review-loop 的 readStockProfiles，零出站）。
    let anchor: { isAnchor: boolean; name: string | null; role: string | null; path: string | null } | null = null
    // 查询范围：88xxxx（自制指标）/999999/000xxx（中证指数段——000001 上证指数等；
    // 页面对非指数用法忽略该段，000xxx 深市股票页不受影响）；缓存命中为 O(1)。
    if (/^88/.test(code) || code === '999999' || /^000/.test(code)) {
      try {
        const hit = await lookupAnchorEntry(code) // TTL 缓存（全量扫描仅在过期后台刷新）
        anchor = {
          isAnchor: hit !== undefined && hit.isAnchor,
          name: hit !== undefined ? hit.name : null,
          role: hit !== undefined ? hit.role : null,
          path: hit !== undefined ? hit.path : null,
        }
      } catch (e) {
        warnings.push(`锚点档案读取失败（不影响写卡）：${describeCause(e)}`)
      }
    }
    if (date !== null) {
      const located = await deps.locateDoc({ dataRoot: deps.dataRoot, code, tradeDate: date, ...(market === undefined ? {} : { market }) })
      warnings.push(...located.warnings)
      locatedPath = located.path
      try {
        await stat(located.path)
        exists = true
      } catch {
        exists = false // 首建路径尚无文档 → 空态（非错误）
      }
      if (exists) {
        const parsed = await deps.parseDoc(located.path)
        warnings.push(...parsed.warnings)
        cards = parsed.cards
        const enriched: Array<Card & { images?: CardImage[] }> = []
        for (const card of cards) {
          const images = await readCardImages(deps.dataRoot, located.path, card.body)
          warnings.push(...images.warnings)
          enriched.push(images.images.length === 0 ? card : { ...card, images: images.images })
        }
        cards = enriched
      }
    }
    const cardedDates = await scanCardedDates(deps.dataRoot, code, market)
    const name = await deps.resolveLocalName(code)
    writeJson(res, 200, {
      code,
      codeRaw,
      dataRootConfigured: true,
      name,
      tradeDate:
        attribution === null
          ? null
          : {
              value: attribution.value,
              source: attribution.source,
              isTradingDay: attribution.isTradingDay,
              confidence: attribution.confidence,
              marketSuffix: attribution.marketSuffix,
            },
      date,
      dateSource: dateParam !== '' ? 'requested' : date !== null ? 'resolved' : 'unavailable',
      path: locatedPath,
      exists,
      cards,
      cardedDates,
      anchor,
      warnings,
    })
  }

  async function handleDates(res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    const codeRaw = query.code ?? ''
    const code = normalizeCode(codeRaw)
    if (code === null) {
      const invalid = invalidCodeBody(codeRaw)
      writeJsonError(res, 400, 'INVALID_CODE', invalid.message, { codeRaw })
      return
    }
    const marketError = marketParamError(query.market)
    if (marketError !== null) {
      writeJsonError(res, 400, 'INVALID_MARKET', marketError)
      return
    }
    const market = marketParamOf(query.market)
    if (deps.dataRoot === '') {
      writeJson(res, 200, {
        code,
        dates: [],
        error: 'DATA_ROOT_UNCONFIGURED',
        message: '数据根未配置——请在宿主 profile 的 dsh-trader-kit 配置段设置 dataRoot',
      })
      return
    }
    const dates = await scanCardedDates(deps.dataRoot, code, market)
    writeJson(res, 200, { code, dates, warnings: [] })
  }

  async function handleEnrich(req: TraderKitHttpRequest, res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    const codeRaw = query.code ?? ''
    const code = normalizeCode(codeRaw)
    if (code === null) {
      const invalid = invalidCodeBody(codeRaw)
      writeJsonError(res, 400, invalid.error, invalid.message, { codeRaw })
      return
    }
    const dateParam = query.date ?? ''
    let date: string | undefined
    if (dateParam !== '') {
      const canonical = toCanonicalDateParam(dateParam)
      if (canonical === null) {
        writeJsonError(res, 400, 'INVALID_DATE', `非法日期 '${dateParam}'——期望 canonical YYYY-MM-DD（兼容 YYYYMMDD，归一经 src/data/date.ts）`)
        return
      }
      date = canonical
    }
    // 起点（T0 缺省请求日 = 限流日；唯一日期事实源，MUST NOT 自行推断）。
    const t0 = await deps.resolveTradeDate({})
    const startDay = t0.value
    const limit = deps.backtrackLimit ?? BACKTRACK_LIMIT_DEFAULT
    let limitReason: BacktrackResult
    if (startDay === null) {
      limitReason = {
        availability: { available: false, reason: 'dateUnavailable' },
        text: backtrackText({ available: false, reason: 'dateUnavailable' }, limit),
        detail: 'T0 businessDate=null——回溯未发起（起点必须来自 resolveTradeDate，MUST NOT 自行推断日期）',
        requestedDates: [],
        unavailableDates: [],
      }
    } else {
      try {
        limitReason = await deps.runBacktrack(
          { fetchDay: deps.getLimitReason, limit, timeoutMs: ENRICH_DAY_TIMEOUT_MS },
          { code, startDay, signal: lazyAbortSignal(req) },
        )
      } catch (e) {
        if (e instanceof BacktrackAbortedError) return // 客户端已离开（切标的/日期/关闭）——静默收尾
        throw e
      }
    }
    // B1 标签（T2 概念；单项降级不影响其它段）。
    let concepts: ReviewConceptView
    try {
      concepts = await deps.getConcepts({ code, date })
    } catch (e) {
      concepts = { available: false, labels: [], name: null, detail: describeCause(e) }
    }
    // 行情四格 + 名称层②末级（S9 快照；单次 enrich 至多 1 次出站，名称复用同一份——quote-snapshot 能力）。
    let quote: ReviewQuoteView
    let quoteName: string | null = null
    if (deps.lookupQuote === undefined) {
      quote = { available: false, price: null, pct: null, ltsz: null, zsz: null, ltgb: null, detail: '行情快照出口未接线（S9 跳过）' }
    } else {
      try {
        const snap = await deps.lookupQuote(code)
        if (snap === null) {
          quote = { available: false, price: null, pct: null, ltsz: null, zsz: null, ltgb: null, detail: '行情快照未取得（realhead 无数据/护栏受限）' }
        } else {
          quote = { available: true, price: snap.price, pct: snap.pct, ltsz: snap.ltsz, zsz: snap.zsz, ltgb: snap.ltgb, detail: null }
          quoteName = snap.name
        }
      } catch (e) {
        quote = { available: false, price: null, pct: null, ltsz: null, zsz: null, ltgb: null, detail: describeCause(e) }
      }
    }
    // 名称层②：先 T2/S8 反查（concepts.name），未命中由行情快照 name 兜底（nameSource 反映实际来源）。
    let name: { available: boolean; name: string | null; nameSource: string | null; confidence: 'high' | 'low' | null; detail: string | null }
    if (concepts.available === true && concepts.name !== null && concepts.name !== '') {
      name = { available: true, name: concepts.name, nameSource: 'T2-S8', confidence: 'high', detail: null }
    } else if (quoteName !== null && quoteName !== '') {
      name = { available: true, name: quoteName, nameSource: 'quote-ths', confidence: 'high', detail: null }
    } else if (deps.lookupQuote === undefined) {
      name = { available: false, name: null, nameSource: null, confidence: null, detail: '名称反查出口未接线（层②跳过）' }
    } else {
      name = { available: false, name: null, nameSource: null, confidence: null, detail: 'T2/S8 反查与行情快照均未取得名称' }
    }
    // 名称层②第三级：TQ-Local 只读兜底（review-loop owner 裁决 2026-10-06）。
    // 调用条件（spec）：层①（本地历史 frontmatter）未命中 **且** 前两级均未取得名称；
    // 层①命中时零 TQ 请求（MUST NOT 覆盖既有层结论）。
    let basics: ReviewBasicsView | null = null
    if (name.available === false && deps.lookupStockBasics !== undefined) {
      let localKnown: string | null = null
      try {
        localKnown = (await deps.resolveLocalName(code)).value
      } catch {
        localKnown = null // 本地层读取失败按未命中处置（不影响兜底可用性）
      }
      if (localKnown === null) {
        try {
          const b = await deps.lookupStockBasics(code)
          basics = {
            available: b.available,
            kind: b.kind,
            listedAt: b.listedAt,
            region: b.region,
            industry: b.industry,
            floatSharesWan: b.floatSharesWan,
            totalSharesWan: b.totalSharesWan,
            detail: b.available ? null : (b.notes.join('；') || 'TQ-Local 未取得基础信息'),
          }
          if (b.available && b.name !== null && b.name !== '') {
            name = { available: true, name: b.name, nameSource: 'tq-local', confidence: 'high', detail: null }
          } else if (b.available) {
            name.detail = 'TQ-Local 命中但未返回名称（Name 为空）'
          } else {
            name.detail = (name.detail ?? '') + '；TQ-Local 兜底不可用：' + (b.notes.join('；') || '未知原因')
          }
        } catch (e) {
          basics = { available: false, kind: null, listedAt: null, region: null, industry: null, floatSharesWan: null, totalSharesWan: null, detail: describeCause(e) }
        }
      }
    }
    writeJson(res, 200, {
      code,
      tradeDate: {
        value: t0.value,
        source: t0.source,
        isTradingDay: t0.isTradingDay,
        confidence: t0.confidence,
        marketSuffix: t0.marketSuffix,
      },
      name,
      quote,
      concepts,
      limitReason,
      basics,
    })
  }

  /**
   * 保存用户复盘图文卡片。
   * 业务逻辑: 校验正文、图片与归属，再交给同一存储事务幂等提交。
   * 关键判断: 无图片请求维持原行为；交易日待确认时不得静默落盘。
   * 异常处理: 入参返回 4xx，文档归属与并发冲突返回 409，图片错误统一分档。
   * 参数: req 为 JSON 请求，res 为响应。
   * 返回: 创建或重复命中的锚点、路径与告警。
   */
  async function handleCard(req: TraderKitHttpRequest, res: TraderKitHttpResponse): Promise<void> {
    const raw = await readBody(req)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      writeJsonError(res, 400, 'INVALID_JSON', '请求体不是合法 JSON')
      return
    }
    if (parsed === null || typeof parsed !== 'object') {
      writeJsonError(res, 400, 'INVALID_JSON', '请求体须为 JSON 对象')
      return
    }
    const body = parsed as Record<string, unknown>
    // 入参校验（逐项 4xx + 原因，零落盘——tasks 2.7）。
    const clientRequestId = body.clientRequestId
    if (typeof clientRequestId !== 'string' || clientRequestId.trim() === '') {
      writeJsonError(res, 400, 'MISSING_CLIENT_REQUEST_ID', '缺少 clientRequestId——客户端为一次提交意图生成、重试复用同一 id；服务端按「文档 + 该 id」幂等去重')
      return
    }
    if (clientRequestId.length > CLIENT_REQUEST_ID_LIMIT) {
      writeJsonError(res, 400, 'INVALID_CLIENT_REQUEST_ID', `clientRequestId 超限（上限 ${CLIENT_REQUEST_ID_LIMIT} 字符，实际 ${clientRequestId.length}）`)
      return
    }
    const codeRaw = body.code
    const code = typeof codeRaw === 'string' ? normalizeCode(codeRaw) : null
    if (code === null) {
      const rawText = typeof codeRaw === 'string' ? codeRaw : String(codeRaw)
      const invalid = invalidCodeBody(rawText)
      writeJsonError(res, 400, invalid.error, invalid.message, { codeRaw: typeof codeRaw === 'string' ? codeRaw : null })
      return
    }
    const cardBody = body.body
    if (typeof cardBody !== 'string' || cardBody.trim() === '') {
      writeJsonError(res, 400, 'EMPTY_BODY', 'body 须为非空白字符串')
      return
    }
    if (cardBody.length > BODY_LIMIT) {
      writeJsonError(res, 400, 'BODY_TOO_LONG', `body 超限（上限 ${BODY_LIMIT} 字符，实际 ${cardBody.length} 字符）`, { limit: BODY_LIMIT, actual: cardBody.length })
      return
    }
    const images = validateImageUploads(body.images, cardBody)
    let tradeDate: string
    if (body.tradeDate === undefined || body.tradeDate === null || body.tradeDate === '') {
      // 归属待确认 MUST NOT 静默落盘（D-9：value===null 或 isTradingDay===null → 显式拒绝，页面确认后显式提交）。
      const t0 = await deps.resolveTradeDate({})
      if (t0.value === null || t0.isTradingDay !== true) {
        writeJsonError(res, 409, 'TRADE_DATE_UNCONFIRMED',
          `归属待确认（value=${JSON.stringify(t0.value)}, isTradingDay=${JSON.stringify(t0.isTradingDay)}）——MUST NOT 静默按系统日期归属；请在页面确认归属后显式提交 tradeDate`,
          { value: t0.value, isTradingDay: t0.isTradingDay })
        return
      }
      tradeDate = t0.value
    } else {
      const td = body.tradeDate
      if (typeof td !== 'string' || !CANONICAL_DATE_RE.test(td) || toCanonicalDateParam(td) === null) {
        writeJsonError(res, 400, 'INVALID_TRADE_DATE', `非法 tradeDate '${String(td)}'——须为 canonical YYYY-MM-DD 且为真实日历日期`)
        return
      }
      tradeDate = td
    }
    let name: string | undefined
    if (body.name !== undefined && body.name !== null && body.name !== '') {
      if (typeof body.name !== 'string') {
        writeJsonError(res, 400, 'INVALID_NAME', 'name 须为字符串')
        return
      }
      if (body.name.length > NAME_LIMIT) {
        writeJsonError(res, 400, 'NAME_TOO_LONG', `name 超限（上限 ${NAME_LIMIT} 字符，实际 ${body.name.length} 字符）`, { limit: NAME_LIMIT, actual: body.name.length })
        return
      }
      name = body.name
    }
    // 显式市场（owner 2026-10-06「代码标识加沪深」）：可选；缺省按代码段推断（store 内）。
    let market: string | undefined
    if (body.market !== undefined && body.market !== null && body.market !== '') {
      if (body.market !== 'sh' && body.market !== 'sz' && body.market !== 'bj') {
        writeJsonError(res, 400, 'INVALID_MARKET', `非法 market '${String(body.market)}'——期望 sh|sz|bj（缺省按代码段推断）`)
        return
      }
      market = body.market
    }
    const now = deps.now()
    try {
      const result = await deps.appendCard({
        loc: { dataRoot: deps.dataRoot, code, name, tradeDate, market },
        body: cardBody,
        clientRequestId,
        now,
        ...(body.images === undefined ? {} : { images }),
      })
      writeJson(res, 200, {
        status: result.status,
        anchor: result.anchor,
        path: result.path,
        warnings: result.warnings,
        clientRequestId,
        writtenAt: formatZonedIso(now),
      })
      // review-loop：首卡懒创建（异步解耦——不 await、不影响写卡响应；失败只告警）。
      const ensure = deps.ensureStockProfile
      if (ensure !== undefined) {
        void ensure({ code, name: name ?? null }).then(
          (outcome) => {
            for (const w of outcome.warnings) deps.logWarning?.(`[dsh-trader-kit] 首卡建档：${w}`)
          },
          (e: unknown) => deps.logWarning?.(`[dsh-trader-kit] 首卡建档失败（不影响写卡）：${describeCause(e)}`),
        )
      }
    } catch (e) {
      if (e instanceof DocMismatchError) {
        writeJsonError(res, 409, 'DOC_MISMATCH', e.message)
        return
      }
      if (e instanceof ConcurrentWriteError) {
        writeJsonError(res, 409, 'CONCURRENT_WRITE', e.message)
        return
      }
      throw e
    }
  }

  /** 卡片修订/删除共用：JSON 体解析 + 锚点校验（owner 2026-10-05 追授）。 */
  async function readCardActionBody(req: TraderKitHttpRequest, res: TraderKitHttpResponse): Promise<Record<string, unknown> | null> {
    const raw = await readBody(req)
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      writeJsonError(res, 400, 'INVALID_JSON', '请求体不是合法 JSON')
      return null
    }
    if (parsed === null || typeof parsed !== 'object') {
      writeJsonError(res, 400, 'INVALID_JSON', '请求体须为 JSON 对象')
      return null
    }
    return parsed as Record<string, unknown>
  }

  function anchorParamError(value: unknown): string | null {
    if (typeof value !== 'string' || value.trim() === '') {
      return '缺少 anchor——卡片锚点 card-YYYYMMDD-代码-HHMM[-序号]（页面从卡片数据取得，MUST NOT 手工拼接）'
    }
    if (!CARD_ANCHOR_RE.test(value.trim())) {
      return `非法 anchor '${value.trim()}'——期望 card-YYYYMMDD-代码-HHMM[-序号] 形态（经 CARD_ANCHOR_RE 整体匹配）`
    }
    return null
  }

  /** 显式市场参数校验（owner 2026-10-08 P0）：缺省/空合法（按代码段推断）；其余必须 sh|sz|bj。 */
  function marketParamError(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null
    if (typeof value !== 'string') return `非法 market '${String(value)}'——期望 sh|sz|bj（缺省按代码段推断）`
    const v = value.trim().toLowerCase()
    if (v === 'sh' || v === 'sz' || v === 'bj') return null
    return `非法 market '${value}'——期望 sh|sz|bj（缺省按代码段推断）`
  }

  /** market 参数取值（校验通过后调用；大小写不敏感，缺省 undefined）。 */
  function marketParamOf(value: unknown): 'sh' | 'sz' | 'bj' | undefined {
    if (typeof value !== 'string') return undefined
    const v = value.trim().toLowerCase()
    return v === 'sh' || v === 'sz' || v === 'bj' ? v : undefined
  }

  /**
   * 修订卡片正文及图片。
   * 业务逻辑: 校验锚点、非空正文与可选附件，存储层同步清理移除图片。
   * 关键判断: 锚点与时间不变，删除整卡必须使用专用接口。
   * 异常处理: 未接线返回 501，无效请求返回 400，缺锚点和并发冲突分别返回 404、409。
   * 参数: req 为修订 JSON，res 为响应。
   * 返回: 修订结果与附件清理告警。
   */
  async function handleCardUpdate(req: TraderKitHttpRequest, res: TraderKitHttpResponse): Promise<void> {
    if (deps.updateCard === undefined) {
      writeJsonError(res, 501, 'NOT_IMPLEMENTED', '卡片修订出口未接线（updateCard 未注入）')
      return
    }
    const body = await readCardActionBody(req, res)
    if (body === null) return
    const anchorError = anchorParamError(body.anchor)
    if (anchorError !== null) {
      writeJsonError(res, 400, 'INVALID_ANCHOR', anchorError)
      return
    }
    const anchor = (body.anchor as string).trim()
    const cardBody = body.body
    if (typeof cardBody !== 'string' || cardBody.trim() === '') {
      writeJsonError(res, 400, 'EMPTY_BODY', 'body 须为非空白字符串——删除卡片请走 /api/card/delete（MUST NOT 以空正文冒充删除）')
      return
    }
    if (cardBody.length > BODY_LIMIT) {
      writeJsonError(res, 400, 'BODY_TOO_LONG', `body 超限（上限 ${BODY_LIMIT} 字符，实际 ${cardBody.length} 字符）`, { limit: BODY_LIMIT, actual: cardBody.length })
      return
    }
    const images = validateImageUploads(body.images, cardBody)
    try {
      const marketError = marketParamError(body.market)
      if (marketError !== null) {
        writeJsonError(res, 400, 'INVALID_MARKET', marketError)
        return
      }
      const market = marketParamOf(body.market)
      const result = await deps.updateCard({ anchor, body: cardBody, dataRoot: deps.dataRoot, ...(body.images === undefined ? {} : { images }), ...(market === undefined ? {} : { market }) })
      writeJson(res, 200, { status: 'updated', anchor: result.anchor, path: result.path, warnings: result.warnings })
    } catch (e) {
      if (e instanceof AnchorNotFoundError) {
        writeJsonError(res, 404, 'ANCHOR_NOT_FOUND', e.message)
        return
      }
      if (e instanceof ConcurrentWriteError) {
        writeJsonError(res, 409, 'CONCURRENT_WRITE', e.message)
        return
      }
      throw e
    }
  }

  /** POST /api/card/delete：整节移除（写凭据/错误分档同写卡；两段确认由页面承担）。 */
  async function handleCardDelete(req: TraderKitHttpRequest, res: TraderKitHttpResponse): Promise<void> {
    if (deps.deleteCard === undefined) {
      writeJsonError(res, 501, 'NOT_IMPLEMENTED', '卡片删除出口未接线（deleteCard 未注入）')
      return
    }
    const body = await readCardActionBody(req, res)
    if (body === null) return
    const anchorError = anchorParamError(body.anchor)
    if (anchorError !== null) {
      writeJsonError(res, 400, 'INVALID_ANCHOR', anchorError)
      return
    }
    const anchor = (body.anchor as string).trim()
    const marketError = marketParamError(body.market)
    if (marketError !== null) {
      writeJsonError(res, 400, 'INVALID_MARKET', marketError)
      return
    }
    const market = marketParamOf(body.market)
    try {
      const result = await deps.deleteCard({ anchor, dataRoot: deps.dataRoot, ...(market === undefined ? {} : { market }) })
      writeJson(res, 200, { status: 'deleted', anchor: result.anchor, path: result.path, warnings: result.warnings })
    } catch (e) {
      if (e instanceof AnchorNotFoundError) {
        writeJsonError(res, 404, 'ANCHOR_NOT_FOUND', e.message)
        return
      }
      if (e instanceof ConcurrentWriteError) {
        writeJsonError(res, 409, 'CONCURRENT_WRITE', e.message)
        return
      }
      throw e
    }
  }

  /**
   * 读取复盘文档同目录的图片。
   * 业务逻辑: 校验标的和交易日，复用文档定位后读取 files 中的图片字节。
   * 关键判断: 仅允许同源本地图片，文件类型和路径由图片 IO 模块复核。
   * 异常处理: 无效入参返回 400；缺图、越界与 IO 错误交由统一错误出口。
   * 参数: res 为响应，query 为标的、交易日与图片相对路径。
   * 返回: 写入二进制响应，无业务返回值。
   */
  async function handleCardImage(res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    const code = normalizeCode(query.code ?? '')
    if (code === null) {
      const invalid = invalidCodeBody(query.code ?? '')
      writeJsonError(res, 400, invalid.error, invalid.message)
      return
    }
    const tradeDate = toCanonicalDateParam(query.tradeDate ?? '')
    if (tradeDate === null) {
      writeJsonError(res, 400, 'INVALID_TRADE_DATE', '图片读取须提供有效 tradeDate')
      return
    }
    const marketError = marketParamError(query.market)
    if (marketError !== null) {
      writeJsonError(res, 400, 'INVALID_MARKET', marketError)
      return
    }
    const market = marketParamOf(query.market)
    const relativePath = query.relativePath ?? ''
    const located = await deps.locateDoc({ dataRoot: deps.dataRoot, code: query.code, tradeDate, ...(market === undefined ? {} : { market }) })
    const image = await readImageFile(deps.dataRoot, located.path, relativePath)
    res.writeHead(200, { 'Content-Type': image.mimeType, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(image.data)
  }

  /**
   * 显式删除单张图片及卡片中的对应引用。
   * 业务逻辑: 校验卡片锚点，将修订与文件删除交给同一存储事务。
   * 关键判断: 不接收客户端替换正文，避免覆盖用户刚刚写入的其他内容。
   * 异常处理: 未接线返回 501，无效入参返回 400；存储冲突由统一出口分档。
   * 参数: req 为带写凭据的请求，res 为响应。
   * 返回: 卡片更新结果与清理告警。
   */
  async function handleCardImageDelete(req: TraderKitHttpRequest, res: TraderKitHttpResponse): Promise<void> {
    if (deps.deleteCardImage === undefined) {
      writeJsonError(res, 501, 'NOT_IMPLEMENTED', '图片删除出口未接线')
      return
    }
    const body = await readCardActionBody(req, res)
    if (body === null) return
    const anchorError = anchorParamError(body.anchor)
    if (anchorError !== null) {
      writeJsonError(res, 400, 'INVALID_ANCHOR', anchorError)
      return
    }
    if (typeof body.relativePath !== 'string' || body.relativePath === '') {
      writeJsonError(res, 400, 'INVALID_IMAGE_PATH', '图片删除须提供 relativePath')
      return
    }
    const marketError = marketParamError(body.market)
    if (marketError !== null) {
      writeJsonError(res, 400, 'INVALID_MARKET', marketError)
      return
    }
    const market = marketParamOf(body.market)
    const result = await deps.deleteCardImage({ anchor: (body.anchor as string).trim(), relativePath: body.relativePath, dataRoot: deps.dataRoot, ...(market === undefined ? {} : { market }) })
    writeJson(res, 200, result)
  }

  /**
   * `GET /api/day`（review-loop：面板当日状态读接口；**纯本地、零出站**）。
   * 数据：当日有卡标的清单（scanDailyCardTargets）+ 运行摘要四态（readRunReport）
   * + 盘面 md 存在性（readBriefMeta）；缺省交易日经 T0 解析（MUST NOT 读系统日期）。
   */
  async function handleDay(res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    if (deps.dataRoot === '') {
      writeJson(res, 200, {
        tradeDate: null,
        dateSource: 'unavailable',
        targets: [],
        runReport: null,
        brief: null,
        error: 'DATA_ROOT_UNCONFIGURED',
        message: '数据根未配置——请在宿主 profile 的 dsh-trader-kit 配置段设置 dataRoot（指向含 DB/ 的数据根目录）',
        warnings: [],
      })
      return
    }
    const dateParam = query.date ?? ''
    let tradeDate: string | null = null
    let dateSource: 'requested' | 'resolved' | 'unavailable' = 'unavailable'
    if (dateParam !== '') {
      const canonical = toCanonicalDateParam(dateParam)
      if (canonical === null) {
        writeJsonError(res, 400, 'INVALID_DATE', `非法日期 '${dateParam}'——期望 canonical YYYY-MM-DD（兼容 YYYYMMDD，归一经 src/data/date.ts）`)
        return
      }
      tradeDate = canonical
      dateSource = 'requested'
    } else {
      const t0 = await deps.resolveTradeDate({})
      tradeDate = t0.value
      dateSource = t0.value !== null ? 'resolved' : 'unavailable'
    }
    const warnings: string[] = []
    let targets: ReviewDayTarget[] = []
    let runReport: RunReport | null = null
    let brief: BriefMeta | null = null
    if (tradeDate !== null) {
      if (deps.scanDailyCardTargets !== undefined) {
        const listed = await deps.scanDailyCardTargets(tradeDate)
        // qualifier 透传（owner 2026-10-08 P0）：同码跨市场条目（sh000688 vs 000688）供面板区分显示。
        targets = listed.map((t) => ({
          code: t.code,
          name: t.name,
          path: t.path,
          cardCount: t.cardCount,
          hasAinote: t.hasAinote,
          ...(t.qualifier === undefined ? {} : { qualifier: t.qualifier }),
        }))
        warnings.push(...(listed.warnings ?? []))
      } else {
        warnings.push('scanDailyCardTargets 未接线（当日清单不可得）')
      }
      if (deps.readRunReport !== undefined && deps.runReportPath !== undefined) {
        try {
          runReport = await deps.readRunReport(deps.runReportPath(deps.dataRoot, tradeDate))
        } catch (e) {
          warnings.push('运行摘要读取失败：' + describeCause(e))
        }
      }
      if (deps.readBriefMeta !== undefined) {
        try {
          brief = await deps.readBriefMeta(deps.dataRoot, tradeDate)
        } catch (e) {
          warnings.push('盘面 md 状态读取失败：' + describeCause(e))
        }
      }
    } else {
      warnings.push('交易日不可得（可能为休市日/盘前）——可在请求中显式传 date')
    }
    writeJson(res, 200, { tradeDate, dateSource, targets, runReport, brief, warnings })
  }

  /** 整理意图（owner 2026-10-06 追授；进程内记忆——意图天然短暂，重启即失可接受）。 */
  let lastOrganizeIntent: { code: string; date: string | null; registeredAt: string } | null = null

  /** POST /api/organize：登记当前标的的整理意图并返回固定指令（agent 由用户在 DSH 会话发送触发）。 */
  async function handleOrganize(req: TraderKitHttpRequest, res: TraderKitHttpResponse): Promise<void> {
    const body = await readCardActionBody(req, res)
    if (body === null) return
    const codeRaw = body.code
    const code = typeof codeRaw === 'string' ? normalizeCode(codeRaw) : null
    if (code === null) {
      const invalid = invalidCodeBody(typeof codeRaw === 'string' ? codeRaw : String(codeRaw))
      writeJsonError(res, 400, invalid.error, invalid.message, { codeRaw: typeof codeRaw === 'string' ? codeRaw : null })
      return
    }
    let date = ''
    if (body.date !== undefined && body.date !== null && body.date !== '') {
      if (typeof body.date !== 'string' || !CANONICAL_DATE_RE.test(body.date) || toCanonicalDateParam(body.date) === null) {
        writeJsonError(res, 400, 'INVALID_DATE', `非法日期 '${String(body.date)}'——须为 canonical YYYY-MM-DD`)
        return
      }
      date = body.date
    }
    const registeredAt = formatZonedIso(deps.now())
    lastOrganizeIntent = { code, date: date !== '' ? date : null, registeredAt }
    writeJson(res, 200, { status: 'registered', code, date: date !== '' ? date : null, prompt: buildOrganizePrompt(code, date), registeredAt })
  }

  /** GET /api/index-quote：指数态行情（S10 腾讯源；读通道——owner 2026-10-06「科创50 也需要适配」）。 */
  async function handleIndexQuote(res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    if (deps.getIndexQuote === undefined) {
      writeJsonError(res, 501, 'NOT_IMPLEMENTED', '指数行情出口未接线（getIndexQuote 未注入）')
      return
    }
    const codeRaw = query.code ?? ''
    const code = normalizeCode(codeRaw)
    if (code === null) {
      const invalid = invalidCodeBody(codeRaw)
      writeJsonError(res, 400, invalid.error, invalid.message, { codeRaw })
      return
    }
    try {
      const [r, t0] = await Promise.all([
        deps.getIndexQuote(code),
        deps.resolveTradeDate({}), // 指数态交易日定位（owner 2026-10-06 反馈「交易日定位失效」——与股票页同一 T0 事实源）
      ])
      writeJson(res, 200, {
        code,
        available: r.available === true,
        name: r.name,
        price: r.price,
        pct: r.pct,
        source: r.source,
        errors: r.errors,
        detail: r.detail,
        fetchedAt: r.fetchedAt,
        tradeDate: { value: t0.value, source: t0.source, isTradingDay: t0.isTradingDay },
      })
    } catch (e) {
      writeJsonError(res, 502, 'INDEX_QUOTE_FAILED', describeCause(e))
    }
  }

  function handleAsset(res: TraderKitHttpResponse, rel: string): void {
    if (!isSafeAssetName(rel)) {
      writeJsonError(res, 404, 'NOT_FOUND', '资产不存在（穿越/白名单外扩展名一律 404，避免目录探测）')
      return
    }
    const body = deps.readAsset(rel)
    if (body === null) {
      writeJsonError(res, 404, 'NOT_FOUND', '资产不存在')
      return
    }
    const ext = rel.slice(rel.lastIndexOf('.'))
    res.writeHead(200, { 'Content-Type': ASSET_MIME_BY_EXT[ext], 'Cache-Control': 'no-store' })
    res.end(body)
  }

  async function route(req: TraderKitHttpRequest, res: TraderKitHttpResponse, rawPath: string, query: string, unauthenticatedReadonly: boolean): Promise<void> {
    const method = req.method ?? 'GET'
    if (rawPath === pageExact) {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      servePage(res, true) // owner 2026-10-05：writeKey 通道就位——页面恒可写
      return
    }
    if (rawPath === pageExact + '/api/local') {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      await handleLocal(res, parseQuery(query))
      return
    }
    if (rawPath === pageExact + '/api/enrich') {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      await handleEnrich(req, res, parseQuery(query))
      return
    }
    if (rawPath === pageExact + '/api/day') {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      await handleDay(res, parseQuery(query))
      return
    }
    if (rawPath === pageExact + '/api/dates') {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      await handleDates(res, parseQuery(query))
      return
    }
    if (rawPath === pageExact + '/api/card') {
      if (method !== 'POST') {
        writeMethodNotAllowed(res, 'POST')
        return
      }
      await handleCard(req, res)
      return
    }
    if (rawPath === pageExact + '/api/card/update') {
      if (method !== 'POST') {
        writeMethodNotAllowed(res, 'POST')
        return
      }
      await handleCardUpdate(req, res)
      return
    }
    if (rawPath === pageExact + '/api/card/delete') {
      if (method !== 'POST') {
        writeMethodNotAllowed(res, 'POST')
        return
      }
      await handleCardDelete(req, res)
      return
    }
    if (rawPath === pageExact + '/api/card/image') {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      await handleCardImage(res, parseQuery(query))
      return
    }
    if (rawPath === pageExact + '/api/card/image/delete') {
      if (method !== 'POST') {
        writeMethodNotAllowed(res, 'POST')
        return
      }
      await handleCardImageDelete(req, res)
      return
    }
    if (rawPath === pageExact + '/api/organize') {
      if (method !== 'POST') {
        writeMethodNotAllowed(res, 'POST')
        return
      }
      await handleOrganize(req, res)
      return
    }
    if (rawPath === pageExact + '/api/index-quote') {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      await handleIndexQuote(res, parseQuery(query))
      return
    }
    if (rawPath === pageExact + '/api' || rawPath.startsWith(pageExact + '/api/')) {
      // 含已废止的 /api/context——一律 404（MUST NOT 注册 context）。
      writeJsonError(res, 404, 'NOT_FOUND', '未知 API 路径')
      return
    }
    if (rawPath.startsWith(pageExact + '/assets/')) {
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      handleAsset(res, rawPath.slice(pageExact.length + '/assets/'.length))
      return
    }
    if (rawPath === pageExact + '/' || rawPath.startsWith(pageExact + '/')) {
      // 直链 /review/<code>：段安全 → 页面（页面侧解析 path 段，非法段渲染显式空态）；
      // 穿越/盘符/非常规段 → 404（非 403，避免目录探测）。
      if (method !== 'GET') {
        writeMethodNotAllowed(res, 'GET')
        return
      }
      const rest = rawPath.slice(pageExact.length + 1)
      if (rest !== '' && !isSafeDirectSegment(rest)) {
        writeJsonError(res, 404, 'NOT_FOUND', '路径不存在（含穿越段/盘符/非常规文件名的直链一律 404）')
        return
      }
      servePage(res, true) /* owner 2026-10-05：writeKey 通道——恒可写 */
      return
    }
    writeJsonError(res, 404, 'NOT_FOUND', '路径不存在')
  }

  // 装配预热（fire-and-forget，owner 2026-10-06 反馈「切换响应速度慢」）：锚点档案
  // 全量扫描与 T0 内存缓存提前完成——消除重启/首次切换的同步等待。失败静默（运行期
  // 照常按需重试）。
  if (deps.dataRoot !== '') {
    void Promise.resolve(deps.resolveTradeDate({})).catch(() => {}) // T0 内存缓存预热
  }

  return async function reviewHandler(req, res) {
    try {
      const url = typeof req.url === 'string' && req.url !== '' ? req.url : '/'
      const qIndex = url.indexOf('?')
      const rawPath = qIndex === -1 ? url : url.slice(0, qIndex)
      const query = qIndex === -1 ? '' : url.slice(qIndex + 1)
      // 认证首行（宿主不代插件鉴权；403 栅栏不可救援——D-3）。
      const rejection = deps.requestRejection(req)
      if (rejection === 403) {
        writeJsonError(res, 403, 'FORBIDDEN', 'Host/Origin 栅栏拒绝（栅栏是跨站防御，不是认证，不可被任何凭据救援）')
        return
      }
      if (rejection === 401) {
        const method = req.method ?? 'GET'
        if (method === 'GET' && deps.allowUnauthenticatedRead) {
          // C 层签字只读分支（owner 2026-10-05 签字采纳）：页面带 writeKey 注入（写仍可用）。
          await route(req, res, rawPath, query, true)
          return
        }
        // owner 裁决 2026-10-05：写接口凭据② = 回环来源 + 固定密钥（spec 写接口认证修订）；
        // 修订/删除两接口（owner 同日追授）与整理意图（owner 2026-10-06 追授）凭据同款。
        if (method === 'POST' && (rawPath === pageExact + '/api/card'
          || rawPath === pageExact + '/api/card/update'
          || rawPath === pageExact + '/api/card/delete'
          || rawPath === pageExact + '/api/card/image/delete'
          || rawPath === pageExact + '/api/organize') && writeCredentialValid(req)) {
          await route(req, res, rawPath, query, false)
          return
        }
        writeJsonError(res, 401, 'UNAUTHENTICATED', '写卡凭据缺失——页面应自动携带 writeKey；手动调用请带 x-write-key 头（config.review.writeKey）')
        return
      }
      await route(req, res, rawPath, query, false)
    } catch (e) {
      // 兜底：handler 不得向宿主抛（宿主把 rejection 折叠成 400）。
      try {
        if (e instanceof ReviewImageError) {
          writeJsonError(res, e.status, e.code, e.message)
          return
        }
        if (e instanceof AnchorNotFoundError) {
          writeJsonError(res, 404, 'ANCHOR_NOT_FOUND', e.message)
          return
        }
        if (e instanceof ConcurrentWriteError) {
          writeJsonError(res, 409, 'CONCURRENT_WRITE', e.message)
          return
        }
        writeJsonError(res, 500, 'INTERNAL', describeCause(e))
      } catch {
        /* 响应已不可写（客户端断开）——静默 */
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 装配（tasks 2.1：ctx.effect 包裹注册/disposer 注销；依赖自 ctx.traderKit 注入）
// ---------------------------------------------------------------------------

/** `registerReviewRoutes` 选项（生产零传参；结构断言用参数断言 C 层开关两态）。 */
export interface ReviewRoutesOptions {
  /** 覆盖 C 层只读开关（默认 ALLOW_UNAUTHENTICATED_READ_DEFAULT=true——owner 2026-10-05 签字）。 */
  allowUnauthenticatedRead?: boolean
  /** 写接口密钥（owner 裁决 2026-10-05：回环 + 固定密钥；必填注入）。 */
  writeKey?: string
}

interface ReviewLogger {
  info(...args: unknown[]): void
  warn(...args: unknown[]): void
}

function resolveReviewLogger(ctx: Context): ReviewLogger {
  const sinks: ReviewLogger[] = []
  const service: unknown = ctx.logger
  if (typeof service === 'function') {
    try {
      const named: unknown = (service as (name?: string) => unknown)('dsh-trader-kit')
      const candidate = named as ReviewLogger | null | undefined
      if (candidate !== null && candidate !== undefined && typeof candidate.info === 'function' && typeof candidate.warn === 'function') {
        sinks.push(candidate)
      }
    } catch {
      // 命名 logger 不可用时仅用 console。
    }
  }
  sinks.push(console as unknown as ReviewLogger)
  return {
    info: (...args) => {
      for (const s of sinks) s.info(...args)
    },
    warn: (...args) => {
      for (const s of sinks) s.warn(...args)
    },
  }
}

/** 复盘路由注册入口（src/review/index.ts 第二行调用；export 名与签名保持不变）。 */
export function registerReviewRoutes(ctx: Context, options: ReviewRoutesOptions = {}): void {
  const api = ctx.traderKit
  if (api === undefined) {
    throw new Error('registerReviewRoutes 必须在 registerData 之后调用（ctx.traderKit 未挂载——复盘路由依赖 dataRoot 与 T0/T1/T2 出口）')
  }
  const data = api.data
  const dataRoot = data.dataRoot
  const logger = resolveReviewLogger(ctx)
  const localNameResolver = createNameResolver({ dataRoot })

  const handler = createReviewHandler({
    requestRejection: (req) => ctx.connection.requestRejection(req),
    allowUnauthenticatedRead: options.allowUnauthenticatedRead ?? ALLOW_UNAUTHENTICATED_READ_DEFAULT,
    writeKey: options.writeKey ?? randomBytes(24).toString('hex'),
    locateDoc,
    parseDoc,
    appendCard,
    // 修订/删除（owner 2026-10-05 追授）：与追加同一 store 实现，路由层只做凭据与校验。
    updateCard,
    deleteCard,
    deleteCardImage,
    // 指数行情（owner 2026-10-06 追授：科创50 等指数锚点态显示真行情）。
    getIndexQuote: (code) => data.getIndexQuote(code),
    // T0 服务出口 fetchedAt 可空，context.ts 的 ResolveTradeDateFn 形状偏紧——装配点结构适配（不改 context.ts）。
    resolveTradeDate: createTradeDateResolver(data.resolveTradeDate as unknown as ResolveTradeDateFn).resolve,
    getLimitReason: data.getLimitReason,
    getConcepts: (input) =>
      data.getConcepts(input).then((r) => ({
        available: r.available === true,
        labels: (r.concepts ?? [])
          .map((c) => (typeof c.name === 'string' && c.name !== '' ? c.name : ''))
          .filter((s) => s !== ''),
        name: typeof r.name === 'string' && r.name !== '' ? r.name : null,
        detail:
          r.errors.length > 0
            ? r.errors.join('/')
            : r.guard !== null
              ? '护栏拒绝：' + r.guard.reason
              : r.available
                ? null
                : 'S8 未返回可用概念',
      })),
    runBacktrack: runLimitReasonBacktrack,
    // 行情四格 + 名称层②末级：S9 行情快照（getQuoteSnapshot——change 2 出口；
    // owner 2026-10-05「迁移四个基础数据」；S8 反查仅覆盖板块前 N 权重股，
    // realhead 快照兜底非权重股名称并同源供四格行情——同一份出站，spec = quote-snapshot）。
    lookupQuote: async (code) => {
      const q = await data.getQuoteSnapshot(code)
      if (q.available !== true) return null
      return { name: q.name, price: q.price, pct: q.pct, ltsz: q.ltsz, zsz: q.zsz, ltgb: q.ltgb }
    },
    // 本地段名称（层①/③）：不注入反查——/api/local 的名称取值域零网络（§12.4）。
    // review-loop：当日状态（清单/运行摘要/盘面 md）+ 名称兜底 + 首卡建档。
    scanDailyCardTargets: (tradeDate) => {
      const reviewApi = (api.review ?? {}) as { scanDailyCardTargets?: (d: string) => Promise<Array<ReviewDayTarget> & { warnings: string[] }> }
      if (typeof reviewApi.scanDailyCardTargets !== 'function') {
        return Promise.resolve(Object.assign([] as ReviewDayTarget[], { warnings: ['traderKit.review.scanDailyCardTargets 未挂载'] }))
      }
      return reviewApi.scanDailyCardTargets(tradeDate)
    },
    readRunReport,
    runReportPath,
    readBriefMeta,
    lookupStockBasics: async (code) => {
      const b = await data.stockBasics({ code })
      return {
        available: b.available,
        name: b.name,
        kind: b.kind,
        listedAt: b.listedAt,
        region: b.region,
        industry: b.industry,
        floatSharesWan: b.floatSharesWan,
        totalSharesWan: b.totalSharesWan,
        notes: b.notes,
      }
    },
    ensureStockProfile: (input) => createStockProfileIfMissing({ dataRoot, code: input.code, name: input.name }),
    logWarning: (message) => logger.warn(message),
    resolveLocalName: (code) =>
      localNameResolver.resolve(code).then((r) => ({
        value: r.value,
        nameSource: r.source === 'frontmatter-history' ? ('frontmatter-history' as const) : ('code-only' as const),
        confidence: r.confidence,
      })),
    htmlTemplate: REVIEW_HTML,
    readAsset: () => null, // 资产形态①（内联 lib）：无盘上资产；白名单资产面由单测注入资产表核验（tasks 2.4）
    basePath: REVIEW_BASE_PATH,
    dataRoot,
    now: () => new Date(),
  })

  // 路由表：五条 exact + 一条 prefix（同一调度器）。宿主 match() exact 优先于
  // longest-prefix（已核验 host-webserver 源码），/review/api/* 不被 path 段吞掉；
  // prefix 兜底承载直链 /review/<code> 与 /review/assets/<name>。
  const routeDefs: TraderKitWebRoute[] = [
    { kind: 'exact', path: REVIEW_PAGE_PATH, handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/local', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/enrich', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/day', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/dates', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/card', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/card/update', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/card/delete', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/card/image', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/card/image/delete', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/organize', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/index-quote', handler },
    { kind: 'prefix', path: REVIEW_PAGE_PATH, handler },
  ]
  ctx.effect(() => {
    const disposers = routeDefs.map((r) => ctx.webServer.register(r))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'dsh-trader-kit: review routes')

  const base = 'http://127.0.0.1:' + String(ctx.webServer.port)
  logger.info('[dsh-trader-kit] 复盘页 URL: ' + base + REVIEW_PAGE_PATH + '（A 层：先开登录 URL 铸 cookie 再导航；hash 直达如 ' + base + REVIEW_PAGE_PATH + '#600000）')
  logger.info('[dsh-trader-kit] 登录 URL（A 层第一步，宿主铸 cookie 后 303）: ' + ctx.connection.authenticatedUrl(base + '/'))
}
