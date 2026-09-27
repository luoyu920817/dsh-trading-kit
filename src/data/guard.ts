/**
 * 频控护栏（data-tool-contract「频控护栏（代码强制）」/ design D-5、D-16）。
 *
 * 数据面出站请求的**唯一闸门**（`src/data/**` 不得绕过；全仓第二条具名出站通道
 * `src/skill/download.ts` 自带替代护栏，不经本闸门）：
 * - ① 每源并发上限（默认 ≤2）与最小请求间隔（默认 1000 ms，按源全局，单标的同样排队）；
 * - ② 单次批量标的数硬上限（默认 ≤20）——不受任何豁免放宽；
 * - ③ 盘中时段（工作日 09:15–11:30 / 13:00–15:00，Asia/Shanghai）拒绝「全市场级」调用
 *   （判据 = 批量 > 硬上限 **或** 显式 `fullMarket`）；`offSession` 只放宽③；
 * - ④ 每源每交易日**列表级请求**预算（默认 200 次；一次 History 请求 = 一次列表级请求）。
 *
 * 拒绝态具名（D-16 / 评审 Issue 31）：`{ rejected: true, reason, limit, used }`，
 * reason ∈ `sessionRejected | budgetExhausted | batchLimitExceeded | intervalLimited`。
 * `guardStatus()` 与护栏共用**同一内存计数**，只读快照、不出站。
 *
 * 默认值为「经验值、可配置」（design D-5 依据段；实测回填前不得当容量承诺）。
 * 系统时钟只用于限流判定（时段 / 预算桶键 / T1 路由判据）；业务日期一律取源。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import { rateLimitDate } from './date.ts'
import { formatZonedIso } from './normalize.ts'
import type { SessionOverride } from '../config.ts'

/** 护栏管辖的数据源（concepts 请求走 S8 端点，预算同记 S8）。 */
export type GuardSource = 'S7' | 'S5' | 'S8'

export interface GuardConfig {
  maxConcurrency: number
  minIntervalMs: number
  maxBatch: number
  dailyBudget: number
  fullMarketGuard: boolean
  sessionOverride: SessionOverride
}

/** 具名拒绝态（消费方按 `reason` 分支，MUST NOT 解析文案字符串）。 */
export type GuardRejectionReason =
  | 'sessionRejected'
  | 'budgetExhausted'
  | 'batchLimitExceeded'
  | 'intervalLimited'

export interface GuardRejection {
  rejected: true
  reason: GuardRejectionReason
  /** 限额（时段拒绝时为批量硬上限口径）。 */
  limit: number
  /** 实际用量。 */
  used: number
}

export interface GuardAcquireOptions {
  source: GuardSource
  /** 本次调用涉及的标的数（默认 1；> maxBatch 即「全市场级」判据命中）。 */
  batch?: number
  /** 调用方显式全市场级标记。 */
  fullMarket?: boolean
  /** 盘后任务显式豁免：只放宽③时段拒绝，不放宽①②④。 */
  offSession?: boolean
  /**
   * 间隔等待上限（毫秒）：默认无限等待（单标的调用同样排队）；传入后，
   * 所需等待超过该值 → `intervalLimited` 拒绝（不占并发位）。
   */
  maxWaitMs?: number
}

export interface GuardPermit {
  source: GuardSource
  /** 出站完成（或放弃）后必须调用，释放并发位。 */
  release(): void
}

export type GuardAcquireResult = GuardPermit | GuardRejection

export function isGuardRejection(r: GuardAcquireResult): r is GuardRejection {
  return (r as GuardRejection).rejected === true
}

export type SessionState = 'inSession' | 'offSession' | 'overridden'

export interface GuardSourceStatus {
  source: GuardSource
  budgetLimit: number
  budgetUsed: number
  remaining: number
}

export interface GuardStatus {
  /** 限流日（YYYY-MM-DD，系统时钟固定 Asia/Shanghai；预算桶键）。 */
  rateLimitDate: string
  budgetLimit: number
  budgetUsed: number
  remaining: number
  minIntervalMs: number
  /** 当前时段「全市场级」判定的闸门状态（含 offSession 放宽结果）。 */
  fullMarketGuard: boolean
  sessionState: SessionState
  /** 状态快照时间（ISO8601 东八偏移，格式化唯一实现 src/review/format.ts）。 */
  fetchedAt: string
  sources: GuardSourceStatus[]
}

export interface DataGuard {
  acquire(options: GuardAcquireOptions): Promise<GuardAcquireResult>
  /** 只读快照：与护栏同一内存计数；不请求、不耗预算、不改计数与时段状态。 */
  status(): GuardStatus
}

export interface GuardOptions {
  /** 时钟（默认系统时钟；测试注入固定时钟验证时段/间隔/预算）。 */
  now?: () => Date
  /** 等待实现（默认真实 setTimeout；测试可注入即时 resolve）。 */
  delay?: (ms: number) => Promise<void>
}

const SESSION_WINDOWS: Array<{ startMin: number; endMin: number }> = [
  { startMin: 9 * 60 + 15, endMin: 11 * 60 + 30 },
  { startMin: 13 * 60, endMin: 15 * 60 },
]

/** 时段判定（保守口径：工作日 + 盘中窗口；无交易日历，调休/假日可能误判——只影响「拦不拦」）。 */
export function isIntradaySession(now: Date): boolean {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const day = shifted.getUTCDay()
  if (day === 0 || day === 6) return false
  const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
  return SESSION_WINDOWS.some((w) => minutes >= w.startMin && minutes <= w.endMin)
}

function effectiveInSession(config: GuardConfig, now: Date): { inSession: boolean; overridden: boolean } {
  if (config.sessionOverride === 'on') return { inSession: true, overridden: true }
  if (config.sessionOverride === 'off') return { inSession: false, overridden: true }
  return { inSession: isIntradaySession(now), overridden: false }
}

interface SourceRuntime {
  inFlight: number
  lastStartAt: number
  /** 占位总预算按日分桶：Map<rateLimitDate, used>。 */
  budgetByDay: Map<string, number>
  waiters: Array<() => void>
}

export function createDataGuard(config: GuardConfig, options: GuardOptions = {}): DataGuard {
  const now = options.now ?? (() => new Date())
  const delay = options.delay ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms) }))
  const runtimes = new Map<GuardSource, SourceRuntime>()

  function runtimeOf(source: GuardSource): SourceRuntime {
    let rt = runtimes.get(source)
    if (rt === undefined) {
      rt = { inFlight: 0, lastStartAt: 0, budgetByDay: new Map(), waiters: [] }
      runtimes.set(source, rt)
    }
    return rt
  }

  function notifyWaiters(rt: SourceRuntime): void {
    while (rt.waiters.length > 0) {
      const wake = rt.waiters.shift() as () => void
      wake()
    }
  }

  async function acquire(given: GuardAcquireOptions): Promise<GuardAcquireResult> {
    const source = given.source
    const batch = Math.max(1, given.batch ?? 1)
    const rt = runtimeOf(source)

    // ② 批量硬上限：不受任何豁免放宽（offSession 只放宽③）。
    if (batch > config.maxBatch) {
      return { rejected: true, reason: 'batchLimitExceeded', limit: config.maxBatch, used: batch }
    }

    // ③ 时段闸门：盘中拒绝全市场级（判据 = 批量 > 硬上限〔已在②拦截〕或显式 fullMarket）。
    const session = effectiveInSession(config, now())
    if (config.fullMarketGuard && session.inSession && given.fullMarket === true && given.offSession !== true) {
      return { rejected: true, reason: 'sessionRejected', limit: config.maxBatch, used: batch }
    }

    // ④ 预算（按列表级请求数计，桶键 = 限流日）。
    const bucket = rateLimitDate(now())
    const used = rt.budgetByDay.get(bucket) ?? 0
    if (used >= config.dailyBudget) {
      return { rejected: true, reason: 'budgetExhausted', limit: config.dailyBudget, used }
    }

    // ① 并发位等待。
    while (rt.inFlight >= config.maxConcurrency) {
      await new Promise<void>((resolve) => { rt.waiters.push(resolve) })
    }

    // ① 最小间隔（按源全局，单标的同样排队）；首请求无锚点不等待；maxWaitMs 超限 → 具名拒绝。
    if (rt.lastStartAt > 0) {
      const earliest = rt.lastStartAt + config.minIntervalMs
      const waitNeeded = earliest - now().getTime()
      if (waitNeeded > 0) {
        if (given.maxWaitMs !== undefined && waitNeeded > given.maxWaitMs) {
          return { rejected: true, reason: 'intervalLimited', limit: config.minIntervalMs, used: waitNeeded }
        }
        await delay(waitNeeded)
      }
    }

    // 出站前一次性记账：预算 +1（一次 History 请求 = 一次列表级请求）、间隔锚点、并发位。
    rt.budgetByDay.set(bucket, (rt.budgetByDay.get(bucket) ?? 0) + 1)
    rt.lastStartAt = now().getTime()
    rt.inFlight += 1

    return {
      source,
      release(): void {
        rt.inFlight = Math.max(0, rt.inFlight - 1)
        notifyWaiters(rt)
      },
    }
  }

  function status(): GuardStatus {
    const nowDate = now()
    const bucket = rateLimitDate(nowDate)
    const session = effectiveInSession(config, nowDate)
    const sources: GuardSourceStatus[] = (['S7', 'S5', 'S8'] as const).map((source) => {
      const used = runtimeOf(source).budgetByDay.get(bucket) ?? 0
      return { source, budgetLimit: config.dailyBudget, budgetUsed: used, remaining: Math.max(0, config.dailyBudget - used) }
    })
    const conservative = sources.reduce(
      (min, s) => (s.remaining < min.remaining ? s : min),
      sources[0] as GuardSourceStatus,
    )
    return {
      rateLimitDate: bucket,
      budgetLimit: config.dailyBudget,
      budgetUsed: conservative.budgetUsed,
      remaining: conservative.remaining,
      minIntervalMs: config.minIntervalMs,
      fullMarketGuard: config.fullMarketGuard && session.inSession,
      sessionState: session.overridden ? 'overridden' : session.inSession ? 'inSession' : 'offSession',
      fetchedAt: formatZonedIso(nowDate),
      sources,
    }
  }

  return { acquire, status }
}
