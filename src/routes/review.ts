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
import { normalizeCode } from '../review/anchor.ts'
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
import { appendCard, DocMismatchError, ConcurrentWriteError, locateDoc, parseDoc, type Card, type Loc } from '../review/store.ts'
import { resolveArea } from '../paths/resolve.ts'

/** basePath（沿探针先例内联单一事实源；Config 接管归 change 2）。 */
export const REVIEW_BASE_PATH = '/dsh-trader-kit'
/** 复盘页路由路径（exact 注册；同串兼作 prefix 直链路由基路径，分属宿主两张路由表）。 */
export const REVIEW_PAGE_PATH = REVIEW_BASE_PATH + '/review'

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
  /** T2/S8 附带名称（层② 反查的同一出口；路由层不消费此字段）。 */
  name: string | null
  detail: string | null
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
  appendCard(input: { loc: Loc; body: string; now?: Date; clientRequestId?: string }): Promise<{
    status: 'created' | 'duplicate'
    anchor: string
    path: string
    warnings: string[]
  }>
  // ③ 取数（change 2 service 出口）
  resolveTradeDate: TradeDateResolver['resolve']
  getLimitReason: LimitDayFetcher
  getConcepts(input: { code: string; date?: string }): Promise<ReviewConceptView>
  // ④ enrich 回溯与名称层②
  runBacktrack: typeof runLimitReasonBacktrack
  /** T2/S8 名称反查（层②；未注入 → enrich 名称段显式不可得，不出网）。 */
  lookupNameRemote?(code: string): Promise<string | null>
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

/** 扫 DB/review/<YYYYMM>/ 月桶中该代码的全部文档日（canonical 降序；目录缺失 = 空表）。 */
async function scanCardedDates(dataRoot: string, code: string): Promise<string[]> {
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
  const re = new RegExp(`^${code}_.+_(\\d{8})\\.md$`)
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
      const iso = toCanonicalDateParam(m[1])
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

async function readBody(req: TraderKitHttpRequest): Promise<string> {
  let out = ''
  for await (const chunk of req) {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
  }
  return out
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
    let cards: Card[] = []
    if (date !== null) {
      const located = await deps.locateDoc({ dataRoot: deps.dataRoot, code, tradeDate: date })
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
      }
    }
    const cardedDates = await scanCardedDates(deps.dataRoot, code)
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
      warnings,
    })
  }

  async function handleDates(res: TraderKitHttpResponse, query: Record<string, string>): Promise<void> {
    const codeRaw = query.code ?? ''
    const code = normalizeCode(codeRaw)
    if (code === null) {
      const invalid = invalidCodeBody(codeRaw)
      writeJsonError(res, 400, invalid.error, invalid.message, { codeRaw })
      return
    }
    if (deps.dataRoot === '') {
      writeJson(res, 200, {
        code,
        dates: [],
        error: 'DATA_ROOT_UNCONFIGURED',
        message: '数据根未配置——请在宿主 profile 的 dsh-trader-kit 配置段设置 dataRoot',
      })
      return
    }
    const dates = await scanCardedDates(deps.dataRoot, code)
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
    // 名称层②（T2/S8 反查，best-effort；未接线/失败/未命中 → 显式不可得，不冒充）。
    let name: { available: boolean; name: string | null; nameSource: string | null; confidence: 'high' | 'low' | null; detail: string | null }
    if (deps.lookupNameRemote === undefined) {
      name = { available: false, name: null, nameSource: null, confidence: null, detail: 'T2/S8 名称反查出口未接线（层②跳过）' }
    } else {
      try {
        const remote = await deps.lookupNameRemote(code)
        name =
          remote === null
            ? { available: false, name: null, nameSource: null, confidence: null, detail: 'T2/S8 名称反查未命中' }
            : { available: true, name: remote, nameSource: 'T2-S8', confidence: 'high', detail: null }
      } catch (e) {
        name = { available: false, name: null, nameSource: null, confidence: null, detail: describeCause(e) }
      }
    }
    // B1 标签（T2 概念；单项降级不影响其它段）。
    let concepts: ReviewConceptView
    try {
      concepts = await deps.getConcepts({ code, date })
    } catch (e) {
      concepts = { available: false, labels: [], name: null, detail: describeCause(e) }
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
      concepts,
      limitReason,
    })
  }

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
    const now = deps.now()
    try {
      const result = await deps.appendCard({
        loc: { dataRoot: deps.dataRoot, code, name, tradeDate },
        body: cardBody,
        clientRequestId,
        now,
      })
      writeJson(res, 200, {
        status: result.status,
        anchor: result.anchor,
        path: result.path,
        warnings: result.warnings,
        clientRequestId,
        writtenAt: formatZonedIso(now),
      })
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
      servePage(res, !unauthenticatedReadonly)
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
      servePage(res, !unauthenticatedReadonly)
      return
    }
    writeJsonError(res, 404, 'NOT_FOUND', '路径不存在')
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
        // owner 裁决 2026-10-05：写接口凭据② = 回环来源 + 固定密钥（spec 写接口认证修订）。
        if (method === 'POST' && rawPath === pageExact + '/api/card' && writeCredentialValid(req)) {
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
    // 层②：T2/S8 名称反查（getConcepts.name）→ 未命中再行情名称源兜底
    // （data.getQuoteName——change 2 新出口，owner 2026-10-05「名称必须显示」；
    // S8 反查仅覆盖板块前 N 权重股，realhead 行情源兜底非权重股）。
    lookupNameRemote: async (code) => {
      try {
        const r = await data.getConcepts({ code })
        if (r.available === true && typeof r.name === 'string' && r.name !== '') return r.name
      } catch { /* S8 失败 → 落行情源兜底 */ }
      const q = await data.getQuoteName(code)
      return q.available === true ? q.name : null
    },
    // 本地段名称（层①/③）：不注入反查——/api/local 的名称取值域零网络（§12.4）。
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
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/dates', handler },
    { kind: 'exact', path: REVIEW_PAGE_PATH + '/api/card', handler },
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
