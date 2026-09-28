/**
 * B1「最近涨停原因」有界回溯（change 4 review-page tasks 5.1–5.5；契约 §1/§9/§12.5/§12.8，
 * design D-8）。本模块是**具名可注入取数 seam 的纯编排层**：不做任何出站请求——
 * 逐日取数经注入的 `LimitDayFetcher`（生产 = `traderKit.data.getLimitReason` 适配，
 * 其内部复用 change 2 的列表级按日缓存，键 = `source + requestedDate`）。
 *
 * 推进算法（唯一口径，tasks 5.5）：
 * - 起点 = `resolveTradeDate` 得到的最近业务日（第 1 次请求即该日）；本模块不调用
 *   T0——起点由调用方传入（装配点经 `createTradeDateResolver` 注入），
 *   MUST NOT 自行推断日期或用系统日期 fallback。
 * - 第 k+1 次请求日 = **第 k 次响应 `tradeDate`（源业务日）的前一自然日**；
 *   `businessDate === null` → 以**该次请求日**的前一自然日继续推进（计入 N）。
 *   MUST NOT 自行枚举/跳过交易日、MUST NOT 用请求日顶替响应业务日。
 * - 以响应业务日为基准（防漏检）：响应回带的 `tradeDate`（非 null）即该次实际评估的
 *   交易日，纳入命中判定；无论它与请求日是否相同，下一次请求日都从**它**前推——
 *   不存在「请求日 A、响应业务日 B<A、然后从 A 前推」的路径。
 * - 分档（§12.8 二分）：`available=false` 且 `errors` 含 `dateUnavailable`（或
 *   `tradeDate === null`）→ 「该日数据不可得」，**不计为「未找到涨停记录」**，继续推进；
 *   `available=false` 且 errors 为空 → 权威「该日无涨停记录」（回溯继续，终态按
 *   「任一次无记录 → noRecord」）；护栏/其它显式错误 → 终态（见 rateLimited/sourceError）。
 * - 上限 N=6 次 T1 列表级请求（可配置且不可超 6），命中即停；单请求超时
 *   5 s（超时按该项降级为「数据不可得」并**继续回溯**——D-8 允许实现记录该选择）；
 *   传输级失败（取数函数 reject）→ sourceError 终态（源不可用，继续只会重复失败）。
 * - 同一业务日 MUST NOT 重复请求：评估集（请求日 ∪ 非空响应业务日）命中即停。
 * - 本迭代不使用 `offSession` 旁路；护栏拒绝不放宽（预算/间隔类 → rateLimited，
 *   其余护栏拒绝错误码透传到 sourceError 详情）。
 *
 * 日期算术注记（登记缺口）：自然日回退用 UTC 日历算术实现（入参先经
 * `isValidIsoDate` 校验）。`src/data/date.ts` 现无「前一自然日」原语且属数据线辖区
 * （本 change 不改 src/data/**），此处只做**算术**、不做格式拼接折算——格式边界仍以
 * date.ts 的校验为准；待 date.ts 增补原语后回写替换（跨线登记见 tasks 5.x 勾选注）。
 */
import { isValidIsoDate, normalizeToIsoDate } from '../data/date.ts'

/** 回溯上限默认值与硬上限（契约 §12.5：可配置且不可超过 6）。 */
export const BACKTRACK_LIMIT_DEFAULT = 6
export const BACKTRACK_LIMIT_MAX = 6
/** 单请求超时（design D-8：与 change 2 单次调用超时口径一致）。 */
export const ENRICH_DAY_TIMEOUT_MS = 5_000

// ---------------------------------------------------------------------------
// 取数 seam（具名、可注入、零 mock 可构造）
// ---------------------------------------------------------------------------

/** 逐日 T1 响应的最小结构面（`LimitReasonResult` 的结构子集；多余字段被忽略）。 */
export interface LimitDayResponse {
  available: boolean
  /** 源业务日（契约 §1：响应体无条件取值；不可得 → null）。 */
  tradeDate: string | null
  /** 错误码表（§12.8：含 `dateUnavailable` = 数据不可得）。 */
  errors: readonly string[]
  /** 护栏拒绝（非 null = 被护栏拒绝；reason 为 change 2 的具名拒绝态）。 */
  guard: { reason: string; limit: number; used: number } | null
  /** 命中日涨停原因文本（available=true 时展示用；缺失 → null）。 */
  cause: { value: string | null } | null
  notes?: readonly string[]
}

/** 逐日取数函数（生产 = `traderKit.data.getLimitReason` 的适配；缓存键 = `source + requestedDate`）。 */
export type LimitDayFetcher = (input: { code: string; date: string }) => Promise<LimitDayResponse>

/** 结构化 AbortSignal 子集（真实 `AbortSignal` 天然满足；测试用普通对象）。 */
export interface AbortLike {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void): void
}

// ---------------------------------------------------------------------------
// 结果结构（/api/enrich 响应的 B1 涨停原因段，design D-8 响应契约）
// ---------------------------------------------------------------------------

export type BacktrackReason = 'noRecord' | 'dateUnavailable' | 'rateLimited' | 'sourceError'

export interface BacktrackAvailability {
  available: boolean
  reason?: BacktrackReason
}

export interface BacktrackResult {
  availability: BacktrackAvailability
  /** available=true 时 = 命中的源业务日。 */
  businessDate?: string
  /** 本次实际请求过的日期（长度 ≤ N）。 */
  requestedDates: string[]
  /** 其中经 §12.8 判定为「数据不可得」的日期。 */
  unavailableDates: string[]
  /** 分档文案（tasks 5.2；页面直接展示）。 */
  text: string
  /** 命中日原因（available=true）。 */
  cause?: string | null
  /** 降级原因详情（错误码 / 护栏拒绝原因 / 传输失败信息）。 */
  detail?: string
}

/** 回溯被 abort（切标的/切日期/离开页面）——调用方按「响应已作废」处置。 */
export class BacktrackAbortedError extends Error {
  constructor() {
    super('backtrack aborted')
    this.name = 'BACKTRACK_ABORTED'
  }
}

// ---------------------------------------------------------------------------
// 文案分档（tasks 5.2；由 availability 驱动，MUST NOT 用 0/空值冒充）
// ---------------------------------------------------------------------------

/**
 * 分档文案（tasks 5.2 表格逐字落地）。`n` 取实际配置值（noRecord / dateUnavailable
 * 两类终态都耗满 N 次请求）。available=true → 命中日原因与日期，并标注
 * 「按源业务日 <businessDate>」。MUST NOT 出现「盘中限制，盘后重试」类文案；任何
 * 时段类拒绝只透传错误码到 sourceError 详情（tasks 5.6：本 change 不发明状态名）。
 */
export function backtrackText(
  availability: BacktrackAvailability,
  n: number,
  opts: { businessDate?: string; cause?: string | null; errorCode?: string } = {},
): string {
  if (!availability.available) {
    const reason = availability.reason
    if (reason === 'noRecord') return '近 ' + String(n) + ' 次查询内未找到涨停记录'
    if (reason === 'dateUnavailable') return '近 ' + String(n) + ' 次查询内未取得可用数据（数据不可得）'
    if (reason === 'rateLimited') return '近期涨停记录不可得（频控受限）'
    return '近期涨停记录不可得（数据源错误 ' + (opts.errorCode ?? 'unknown') + '）'
  }
  const cause = opts.cause !== null && opts.cause !== undefined && opts.cause !== '' ? opts.cause : '（源未返回原因文本）'
  return '按源业务日 ' + String(opts.businessDate ?? '') + ' · ' + cause
}

// ---------------------------------------------------------------------------
// 日期算术（自然日；格式边界经 date.ts 校验，见模块头「登记缺口」注记）
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return n < 10 ? '0' + String(n) : String(n)
}

/** 前一自然日（UTC 日历算术；含月/年/闰边界）。入参非法显式抛错（不猜测）。 */
export function prevNaturalDay(iso: string): string {
  if (!isValidIsoDate(iso)) {
    throw new Error('prevNaturalDay: 非法 ISO 日期 \'' + iso + '\'——期望 YYYY-MM-DD（经 src/data/date.ts 校验）')
  }
  const y = Number(iso.slice(0, 4))
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  const prev = new Date(Date.UTC(y, m - 1, d - 1))
  return `${prev.getUTCFullYear()}-${pad2(prev.getUTCMonth() + 1)}-${pad2(prev.getUTCDate())}`
}

/**
 * 入参日期归一：canonical `YYYY-MM-DD` 或紧凑 `YYYYMMDD` → canonical；非法 → null
 * （调用方显式拒绝）。格式折算委托 `src/data/date.ts`（唯一实现），本模块不自行 slice。
 */
export function toCanonicalDateParam(raw: string): string | null {
  if (typeof raw !== 'string') return null
  return normalizeToIsoDate(raw.trim())
}

// ---------------------------------------------------------------------------
// 回溯主流程
// ---------------------------------------------------------------------------

export interface BacktrackDeps {
  /** 逐日 T1 取数（列表级缓存复用在 seam 实现内部，本模块不另建缓存层）。 */
  fetchDay: LimitDayFetcher
  /** 回溯上限（默认 6，clamp 到 [1, 6]）。 */
  limit?: number
  /** 单请求超时（默认 5 s）。 */
  timeoutMs?: number
  /** 计时注入（零 mock / 零 sleep：测试注入同步触发或可控计时器；默认全局）。 */
  scheduleTimeout?: (ms: number, fn: () => void) => unknown
  cancelTimeout?: (handle: unknown) => void
}

type DayOutcome =
  | { kind: 'ok'; value: LimitDayResponse }
  | { kind: 'timeout' }
  | { kind: 'error'; message: string }
  | { kind: 'aborted' }

const defaultSchedule = (ms: number, fn: () => void): unknown => setTimeout(fn, ms)
const defaultCancel = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>)

/** 单日取数：超时竞速 + abort 监听（先到先结算，未结算分支清理计时器）。 */
function callDay(
  deps: BacktrackDeps,
  input: { code: string; date: string; signal?: AbortLike },
): Promise<DayOutcome> {
  return new Promise<DayOutcome>((resolve) => {
    let settled = false
    const finish = (outcome: DayOutcome): void => {
      if (settled) return
      settled = true
      resolve(outcome)
    }
    const schedule = deps.scheduleTimeout ?? defaultSchedule
    const cancel = deps.cancelTimeout ?? defaultCancel
    const handle = schedule(deps.timeoutMs ?? ENRICH_DAY_TIMEOUT_MS, () => finish({ kind: 'timeout' }))
    const onAbort = (): void => {
      if (settled) return
      cancel(handle)
      finish({ kind: 'aborted' })
    }
    const signal = input.signal
    if (signal !== undefined && signal.aborted) {
      onAbort()
      return
    }
    if (signal !== undefined) signal.addEventListener('abort', onAbort)
    deps.fetchDay({ code: input.code, date: input.date }).then(
      (value) => {
        cancel(handle)
        finish({ kind: 'ok', value })
      },
      (e: unknown) => {
        cancel(handle)
        finish({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      },
    )
  })
}

function clampLimit(limit: number | undefined): number {
  const n = limit ?? BACKTRACK_LIMIT_DEFAULT
  if (!Number.isFinite(n)) return BACKTRACK_LIMIT_DEFAULT
  return Math.min(Math.max(Math.floor(n), 1), BACKTRACK_LIMIT_MAX)
}

/**
 * 有界回溯主流程（tasks 5.1/5.5）。命中即停；N 次耗尽后按「期间是否出现过权威
 * 无记录」产出 noRecord / dateUnavailable 终态；护栏/显式错误/传输失败为即时终态。
 */
export async function runLimitReasonBacktrack(
  deps: BacktrackDeps,
  input: { code: string; startDay: string; signal?: AbortLike },
): Promise<BacktrackResult> {
  if (!isValidIsoDate(input.startDay)) {
    throw new Error('runLimitReasonBacktrack: 非法起点业务日 \'' + String(input.startDay) + '\'——起点必须来自 resolveTradeDate 的业务日（MUST NOT 自行推断）')
  }
  const limit = clampLimit(deps.limit)
  const requestedDates: string[] = []
  const unavailableDates: string[] = []
  const evaluated = new Set<string>()
  let noRecordSeen = false
  let requested = input.startDay
  let terminal: BacktrackResult | null = null

  for (let k = 0; k < limit; k++) {
    if (input.signal !== undefined && input.signal.aborted) throw new BacktrackAbortedError()
    // 同一业务日不重复请求（推进环保护：评估集 = 已请求日 ∪ 已评估业务日）。
    if (evaluated.has(requested)) break
    evaluated.add(requested)
    requestedDates.push(requested)

    const outcome = await callDay(deps, { code: input.code, date: requested, signal: input.signal })
    if (outcome.kind === 'aborted') throw new BacktrackAbortedError()
    if (outcome.kind === 'timeout') {
      // 超时按该项降级为「数据不可得」，继续推进（D-8：记录是否继续回溯——本实现取继续，
      // N 上限兜底；unavailableDates 保留该请求日的降级事实）。
      unavailableDates.push(requested)
      requested = prevNaturalDay(requested)
      continue
    }
    if (outcome.kind === 'error') {
      terminal = {
        availability: { available: false, reason: 'sourceError' },
        text: backtrackText({ available: false, reason: 'sourceError' }, limit, { errorCode: 'transport' }),
        detail: outcome.message,
        requestedDates: [...requestedDates],
        unavailableDates: [...unavailableDates],
      }
      break
    }

    const resp = outcome.value
    const biz = resp.tradeDate
    if (resp.available === true) {
      // 命中：以响应业务日归属（biz === null 时源未回带日期，按请求日展示并记入 detail）。
      const hitDay = biz ?? requested
      terminal = {
        availability: { available: true },
        businessDate: hitDay,
        cause: resp.cause?.value ?? null,
        text: backtrackText({ available: true }, limit, { businessDate: hitDay, cause: resp.cause?.value ?? null }),
        requestedDates: [...requestedDates],
        unavailableDates: [...unavailableDates],
      }
      if (biz === null) terminal.detail = '响应未回带业务日，按请求日归属'
      break
    }

    const errors = resp.errors ?? []
    const dateUnavailable = errors.indexOf('dateUnavailable') >= 0 || biz === null
    if (dateUnavailable) {
      // §12.8：数据不可得 ≠ 无记录；以响应业务日（非 null）前推，否则以请求日前推。
      unavailableDates.push(requested)
      if (biz !== null) evaluated.add(biz)
      requested = prevNaturalDay(biz ?? requested)
      continue
    }

    if (resp.guard !== null) {
      // 频控类（预算耗尽/最小间隔）→ rateLimited；其余护栏拒绝错误码透传 sourceError
      // （tasks 5.6：本 change 不发明状态名，只透传 change 2 的错误码）。
      const reason = resp.guard.reason
      if (reason === 'budgetExhausted' || reason === 'intervalLimited') {
        terminal = {
          availability: { available: false, reason: 'rateLimited' },
          text: backtrackText({ available: false, reason: 'rateLimited' }, limit),
          detail: reason + '（limit=' + String(resp.guard.limit) + ', used=' + String(resp.guard.used) + '）',
          requestedDates: [...requestedDates],
          unavailableDates: [...unavailableDates],
        }
      } else {
        terminal = {
          availability: { available: false, reason: 'sourceError' },
          text: backtrackText({ available: false, reason: 'sourceError' }, limit, { errorCode: reason }),
          detail: reason,
          requestedDates: [...requestedDates],
          unavailableDates: [...unavailableDates],
        }
      }
      break
    }

    if (errors.length > 0) {
      terminal = {
        availability: { available: false, reason: 'sourceError' },
        text: backtrackText({ available: false, reason: 'sourceError' }, limit, { errorCode: errors.join('/') }),
        detail: errors.join('；') + (resp.notes && resp.notes.length > 0 ? '；' + resp.notes.join('；') : ''),
        requestedDates: [...requestedDates],
        unavailableDates: [...unavailableDates],
      }
      break
    }

    // 权威「该日无该标的涨停记录」（available=false 且无任何错误）：继续推进；
    // 任一次出现即锁定终态 noRecord（期间 dateUnavailable 不改变该终态）。
    noRecordSeen = true
    if (biz !== null) evaluated.add(biz)
    requested = prevNaturalDay(biz ?? requested)
  }

  if (terminal !== null) return terminal
  const reason: BacktrackReason = noRecordSeen ? 'noRecord' : 'dateUnavailable'
  return {
    availability: { available: false, reason },
    text: backtrackText({ available: false, reason }, limit),
    detail: reason === 'dateUnavailable'
      ? 'unavailableDates: ' + unavailableDates.join(', ')
      : undefined,
    requestedDates,
    unavailableDates,
  }
}
