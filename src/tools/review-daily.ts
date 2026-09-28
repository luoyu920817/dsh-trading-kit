/**
 * 装配点（change 5 daily-summary tasks §2）：每日汇总工具注册。
 *
 * 四工具 + service 出口（**同一实现**，data-tool-contract 双出口纪律）：
 * - `review_daily_scan`    —— 当日有卡标的清单（缺省交易日经 T0，MUST NOT 读系统日期）；
 * - `review_read_daily`    —— 该标的当日用户卡片集合（排除 `^ainote-`）；
 * - `review_append_ainote` —— AI 附注追加（幂等 + append-only；**调 change 4 的
 *   `appendAinote` 同一实现**，MUST NOT 另写追加/原子写；schema 无 force/overwrite/refresh）；
 * - `review_daily_report`  —— 运行摘要的**唯一生产者出口**（`iteration-1-contracts §12.6`），
 *   service key `traderKit.review.dailyReport`（本 change 注册；change 4 的五个 key 只消费、
 *   不重复注册，§11）。
 *
 * 依赖不可用显式报错（tasks 2.5，D-1b）：`traderKit.review.*`（change 4）/ T0 与
 * `traderKit.data.guardStatus()`（change 2）/ `src/review/format.ts` 导出缺失 →
 * `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），不产出任何文件、不自实现兜底。
 *
 * 交易日来源（tasks 2.10，D-2b）：缺省交易日**只**来自 T0
 * `traderKit.data.resolveTradeDate`；本文件唯一的 `new Date()` 在 `runtimeNow()`
 * （附注时间戳缺省 = 运行时刻，MUST NOT 用于目标交易日）。
 *
 * 装配点只保留一行调用（`src/review/index.ts` 的 `registerReviewDaily(ctx)`）。
 */
import { stat } from 'node:fs/promises'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '../context-types.ts'
import { normalizeToIsoDate } from '../data/date.ts'
import type { GuardStatus } from '../data/guard.ts'
import type { TradeDateResult } from '../data/trade-date.ts'
import { normalizeCode } from '../review/anchor.ts'
import * as reviewFormat from '../review/format.ts'
import {
  mergeRunReport,
  readRunReport,
  runReportPath,
  writeRunReport,
  type RunReport,
  type RunReportMissingEntry,
} from '../summary/run-report.ts'
import { nullableString } from './shared.ts'

// ---------------------------------------------------------------------------
// 消费面（依赖探测 seam：facade 结构化最小类型；缺键 → DEPENDENCY_UNAVAILABLE）
// ---------------------------------------------------------------------------

/** change 4 `Loc`（契约 §3）。 */
export interface DailyLoc {
  dataRoot: string
  code: string
  name?: string
  tradeDate: string
}

/** change 4 `scanDailyCardTargets` 的清单元素（用户卡片数，不含附注）。 */
export interface DailyScanTarget {
  code: string
  name: string
  path: string
  cardCount: number
  hasAinote: boolean
}

export type DailyScanResult = Array<DailyScanTarget> & { warnings: string[] }
export type DailyScanFn = (tradeDate: string) => Promise<DailyScanResult>
export type DailyLocateFn = (loc: DailyLoc) => Promise<{ path: string; warnings: string[] }>
export interface DailyCardRef {
  anchor: string
  writtenAt: string
  body: string
}
export interface DailyAinoteRef {
  anchor: string
  body: string
}
export type DailyParseFn = (path: string) => Promise<{
  frontmatter: Record<string, unknown>
  cards: DailyCardRef[]
  ainotes: DailyAinoteRef[]
  warnings: string[]
}>
export type DailyAppendAinoteFn = (input: {
  loc: DailyLoc
  body: string
  generatedAt: string
  dataSources: string[]
  now?: Date
}) => Promise<{ status: 'created' | 'skipped'; anchor: string; path: string; warnings: string[] }>

/** change 4 `src/review/format.ts` 的两个具名导出（§3；MUST NOT 自写格式化）。 */
export interface ReviewFormatExports {
  formatZonedIso: (date: Date) => string
  formatAnchorTime: (date: Date) => string
}

/** 消费面（真实装配来自 `ctx.traderKit`；测试注入真实对象桩）。 */
export interface ReviewDailyFacades {
  review: {
    locateDoc?: DailyLocateFn
    parseDoc?: DailyParseFn
    appendAinote?: DailyAppendAinoteFn
    scanDailyCardTargets?: DailyScanFn
  }
  data: {
    dataRoot?: string
    resolveTradeDate?: (input?: { date?: string }) => Promise<TradeDateResult>
    guardStatus?: () => GuardStatus
  }
  format: ReviewFormatExports
}

const REVIEW_OWNER = 'change 4（review-page）tasks 1.12 / iteration-1-contracts §3'
const FORMAT_OWNER = 'change 4（review-page）tasks 1.13 / iteration-1-contracts §3'
const TRADE_DATE_OWNER = 'change 2（data-foundation）T0 resolveTradeDate / iteration-1-contracts §1'
const GUARD_OWNER = 'change 2（data-foundation）guardStatus / iteration-1-contracts §9'

/** 依赖不可用（含缺失接口名与所属 change 任务号；不产出任何文件、不自实现兜底）。 */
export class DependencyUnavailableError extends Error {
  readonly missingInterface: string
  constructor(missingInterface: string, owner: string) {
    super(
      `DEPENDENCY_UNAVAILABLE: 消费面不可用——缺少 ${missingInterface}（所属 ${owner}）。`
      + ' 本次不产出任何文件、不自实现兜底；请先落地对应依赖或检查插件装配。',
    )
    this.name = 'DEPENDENCY_UNAVAILABLE'
    this.missingInterface = missingInterface
  }
}

function requireReview<K extends 'locateDoc' | 'parseDoc' | 'appendAinote' | 'scanDailyCardTargets'>(
  facades: ReviewDailyFacades,
  key: K,
): NonNullable<ReviewDailyFacades['review'][K]> {
  const fn = facades.review?.[key]
  if (typeof fn !== 'function') {
    throw new DependencyUnavailableError(`traderKit.review.${key}`, REVIEW_OWNER)
  }
  return fn as NonNullable<ReviewDailyFacades['review'][K]>
}

function requireTradeDate(facades: ReviewDailyFacades): NonNullable<ReviewDailyFacades['data']['resolveTradeDate']> {
  const fn = facades.data?.resolveTradeDate
  if (typeof fn !== 'function') throw new DependencyUnavailableError('traderKit.data.resolveTradeDate', TRADE_DATE_OWNER)
  return fn
}

function requireFormat(facades: ReviewDailyFacades): ReviewFormatExports {
  const format = facades.format
  if (typeof format?.formatZonedIso !== 'function') {
    throw new DependencyUnavailableError('src/review/format.ts 的 formatZonedIso', FORMAT_OWNER)
  }
  if (typeof format?.formatAnchorTime !== 'function') {
    throw new DependencyUnavailableError('src/review/format.ts 的 formatAnchorTime', FORMAT_OWNER)
  }
  return format
}

/** 运行时刻（仅用于附注 `generatedAt` 缺省 = 写入时刻；目标交易日 MUST NOT 取自系统时钟——tasks 2.10）。 */
function runtimeNow(): Date {
  return new Date()
}

function paramError(message: string): never {
  throw new Error(message)
}

// ---------------------------------------------------------------------------
// 预算预检与分批（tasks 3.5；spec「预算预检与分批」）
// ---------------------------------------------------------------------------

/** 预算预检与分批计划（planBatchByBudget 产物；同步纯计算、无任何等待）。 */
export interface BudgetPlan {
  remaining: number
  budgetLimit: number
  budgetUsed: number
  minIntervalMs: number
  sessionState: string
  /** 本次可处理的标的数（= min(remaining, targets.length)）。 */
  processableCount: number
  /** 被截断标的（记 deferred、不计 failed）。 */
  deferred: Array<{ code: string; reason: 'budgetExhausted' }>
  /** 不足时的显式提示（含「本次可处理前 N 个标的」）；充足时为空串。 */
  message: string
}

const GUARD_NUMBER_FIELDS = ['remaining', 'budgetLimit', 'budgetUsed', 'minIntervalMs'] as const

/**
 * 预算预检与分批（tasks 3.5）：按 `§9` 列表级请求数口径，`remaining` 不足以覆盖
 * 全部标的时截断为前 N 个，其余记 `deferred`（原因 `budgetExhausted`，**不计
 * failed**）并给出显式提示。同步纯函数——无 sleep/无排队（预算耗尽立即显式失败）。
 * `guardStatus` 缺失或字段不全 → `DEPENDENCY_UNAVAILABLE`（MUST NOT 自建预算计数、
 * MUST NOT 静默跳过预检）。
 */
export function planBatchByBudget(
  guardStatus: GuardStatus | null | undefined,
  targets: readonly DailyScanTarget[],
): BudgetPlan {
  if (guardStatus === null || guardStatus === undefined || typeof guardStatus !== 'object') {
    throw new DependencyUnavailableError('traderKit.data.guardStatus()', GUARD_OWNER)
  }
  const raw = guardStatus as unknown as Record<string, unknown>
  for (const field of GUARD_NUMBER_FIELDS) {
    const v = raw[field]
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new DependencyUnavailableError(
        `traderKit.data.guardStatus().${field}`,
        `${GUARD_OWNER}——字段缺失或类型不符（期望有限数值），MUST NOT 自建预算计数、MUST NOT 静默跳过预检`,
      )
    }
  }
  const sessionState = raw.sessionState
  if (typeof sessionState !== 'string' || sessionState === '') {
    throw new DependencyUnavailableError(
      'traderKit.data.guardStatus().sessionState',
      `${GUARD_OWNER}——字段缺失（期望 'inSession' | 'offSession' | 'overridden'）`,
    )
  }

  const remaining = guardStatus.remaining
  if (remaining >= targets.length) {
    return {
      remaining,
      budgetLimit: guardStatus.budgetLimit,
      budgetUsed: guardStatus.budgetUsed,
      minIntervalMs: guardStatus.minIntervalMs,
      sessionState,
      processableCount: targets.length,
      deferred: [],
      message: '',
    }
  }
  if (remaining <= 0) {
    return {
      remaining,
      budgetLimit: guardStatus.budgetLimit,
      budgetUsed: guardStatus.budgetUsed,
      minIntervalMs: guardStatus.minIntervalMs,
      sessionState,
      processableCount: 0,
      deferred: targets.map((t) => ({ code: t.code, reason: 'budgetExhausted' as const })),
      message: `预算耗尽（remaining=${remaining}）——本次无法处理任何标的，立即显式停止、不长时间等待、不静默排队；请调整预算后重跑。`,
    }
  }
  return {
    remaining,
    budgetLimit: guardStatus.budgetLimit,
    budgetUsed: guardStatus.budgetUsed,
    minIntervalMs: guardStatus.minIntervalMs,
    sessionState,
    processableCount: remaining,
    deferred: targets.slice(remaining).map((t) => ({ code: t.code, reason: 'budgetExhausted' as const })),
    message: `预算不足：本次可处理前 ${remaining} 个标的（剩余 ${targets.length - remaining} 个标的记 deferred（budgetExhausted，不计 failed），完成本批后可续跑）。`,
  }
}

function budgetView(plan: BudgetPlan): {
  remaining: number
  budgetLimit: number
  budgetUsed: number
  minIntervalMs: number
  sessionState: string
  processableCount: number
  deferredCodes: string[]
  message: string
} {
  return {
    remaining: plan.remaining,
    budgetLimit: plan.budgetLimit,
    budgetUsed: plan.budgetUsed,
    minIntervalMs: plan.minIntervalMs,
    sessionState: plan.sessionState,
    processableCount: plan.processableCount,
    deferredCodes: plan.deferred.map((d) => d.code),
    message: plan.message,
  }
}

// ---------------------------------------------------------------------------
// review_daily_scan（tasks 2.1 / 2.10；D-2b 交易日来源唯一实现）
// ---------------------------------------------------------------------------

export type DailyScanState = 'ok' | 'tradeDateUnavailable' | 'ownershipUncertain' | 'noCards'

export interface DailyScanOutcome {
  state: DailyScanState
  tradeDate: string | null
  message: string
  targets: DailyScanTarget[]
  warnings: string[]
  budget: ReturnType<typeof budgetView> | null
}

/**
 * 扫描当日有卡标的（`review_daily_scan` 的实现，tool 与 service 同一实现）。
 * 缺省交易日调 T0 `traderKit.data.resolveTradeDate`（MUST NOT 读系统日期、MUST NOT
 * 由逐标的 T1 `tradeDate` 推导）；扫描复用 change 4 `scanDailyCardTargets`（不自行
 * 遍历目录）；`warnings[]` 原样上抛。返回三态可区分：交易日不可得 / 归属待确认 /
 * 该交易日无卡片（MUST NOT 使用「非交易日 / 长假」命名）。
 */
export async function runDailyScan(facades: ReviewDailyFacades, input: { date?: string }): Promise<DailyScanOutcome> {
  let tradeDate: string
  if (input.date !== undefined) {
    const normalized = normalizeToIsoDate(String(input.date).trim())
    if (normalized === null) {
      paramError(`非法交易日 '${input.date}'——期望 canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD，归一必须经 src/data/date.ts，MUST NOT 猜测）`)
    }
    tradeDate = normalized
  } else {
    // 缺省交易日唯一来源 = T0；系统时钟仅存在于 T0 内部的限流判定，不在这里。
    const resolved = await requireTradeDate(facades)({})
    if (resolved.businessDate === null) {
      return {
        state: 'tradeDateUnavailable',
        tradeDate: null,
        message: '交易日不可得（盘前 / 源未出数）——请显式指定交易日（date 入参，canonical YYYY-MM-DD）；MUST NOT 以系统日期或限流日顶替。',
        targets: [],
        warnings: [],
        budget: null,
      }
    }
    if (resolved.isTradingDay === null) {
      const rateLimit = resolved.evidence?.rateLimitDate ?? resolved.requestedDate
      return {
        state: 'ownershipUncertain',
        tradeDate: null,
        message: `归属待确认（业务日 ${resolved.businessDate}、限流日 ${rateLimit}）——请显式指定交易日确认归属；MUST NOT 把 isTradingDay=null 当作「非交易日 / 长假」。`,
        targets: [],
        warnings: [],
        budget: null,
      }
    }
    tradeDate = resolved.businessDate
  }

  // 预算预检（运行开始前；guardStatus 缺失/字段不全 → DEPENDENCY_UNAVAILABLE，不静默跳过）。
  const guardStatus = typeof facades.data?.guardStatus === 'function' ? facades.data.guardStatus() : null
  const plan = planBatchByBudget(guardStatus, [])

  const scan = await requireReview(facades, 'scanDailyCardTargets')(tradeDate)
  const warnings = [...scan.warnings]
  const targets: DailyScanTarget[] = [...scan]
  const finalPlan = targets.length > 0 ? planBatchByBudget(guardStatus, targets) : plan

  if (targets.length === 0) {
    return {
      state: 'noCards',
      tradeDate,
      message: '该交易日无卡片——工作流结束，不产出任何附注、不提示补录（与「交易日不可得」「归属待确认」可区分）。',
      targets: [],
      warnings,
      budget: budgetView(finalPlan),
    }
  }
  return {
    state: 'ok',
    tradeDate,
    message: finalPlan.message !== ''
      ? finalPlan.message
      : `扫描到 ${targets.length} 个当日有卡标的（用户卡片数不含附注）。`,
    targets,
    warnings,
    budget: budgetView(finalPlan),
  }
}

// ---------------------------------------------------------------------------
// review_read_daily（tasks 2.2；下游解析口径：排除 ^ainote-）
// ---------------------------------------------------------------------------

export interface DailyReadOutcome {
  found: boolean
  code: string
  tradeDate: string
  path: string
  /** 用户卡片集合（排除 `^ainote-` 分节）。 */
  cards: Array<{ anchor: string; writtenAt: string; body: string }>
  /** 该文档既有附注条数（不计入卡片数口径）。 */
  ainoteCount: number
  warnings: string[]
}

/** 读该标的当日用户卡片（`review_read_daily` 的实现；代码入参经 normalizeCode）。 */
export async function runReadDaily(
  facades: ReviewDailyFacades,
  input: { code: string; tradeDate: string },
): Promise<DailyReadOutcome> {
  const rawCode = typeof input.code === 'string' ? input.code : ''
  const code = normalizeCode(rawCode)
  if (code === null) {
    paramError(`非法标的编码 '${rawCode}'——期望 6 位数字（经 normalizeCode 归一：只去壳、不补全、不猜测）`)
  }
  const tradeDate = normalizeToIsoDate(typeof input.tradeDate === 'string' ? input.tradeDate.trim() : '')
  if (tradeDate === null) {
    paramError(`非法交易日 '${input.tradeDate}'——期望 canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD，归一必须经 src/data/date.ts）`)
  }
  const locateDoc = requireReview(facades, 'locateDoc')
  const parseDoc = requireReview(facades, 'parseDoc')
  const dataRoot = facades.data?.dataRoot ?? ''
  const located = await locateDoc({ dataRoot, code, tradeDate })
  const warnings = [...located.warnings]

  let docStat = null
  try {
    docStat = await stat(located.path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw e
  }
  if (docStat === null) {
    return { found: false, code, tradeDate, path: located.path, cards: [], ainoteCount: 0, warnings }
  }
  const parsed = await parseDoc(located.path)
  warnings.push(...parsed.warnings)
  return {
    found: true,
    code,
    tradeDate,
    path: located.path,
    cards: parsed.cards.map((c) => ({ anchor: c.anchor, writtenAt: c.writtenAt, body: c.body })),
    ainoteCount: parsed.ainotes.length,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// review_append_ainote（tasks 2.3；文档写入唯一实现 = change 4 appendAinote）
// ---------------------------------------------------------------------------

export interface DailyAppendOutcome {
  status: 'created' | 'skipped'
  code: string
  tradeDate: string
  anchor: string
  path: string
  generatedAt: string
  warnings: string[]
  /** 重算指引（附注一旦写入，重跑只返回 skipped；无 force/overwrite 入参）。 */
  recomputeHint: string
}

/**
 * generatedAt 形态判定：唯一拼装实现产出的字符串必须被其自身复现
 * （避免第二份东八偏移字面正则；Date.parse 只做粗检，回环相等为准）。
 */
function isZonedIso(value: string, format: ReviewFormatExports | undefined): boolean {
  if (typeof format?.formatZonedIso !== 'function') return false
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return false
  return format.formatZonedIso(new Date(parsed)) === value
}

const DATA_SOURCE_ITEM_RE = /^[^=,\r\n]+=[^=,\r\n]+@\d{4}-\d{2}-\d{2}$/

/**
 * 追加 AI 附注（`review_append_ainote` 的实现）：**调用 change 4 的
 * `appendAinote` 同一实现**（幂等 + append-only + 原子写 + 写前归属硬校验
 * DOC_MISMATCH 均由其承担），本工具不另写追加/原子写。
 *
 * 元信息六键分工：`generatedAt`/`dataSources` 由 change 4 落盘；`tradeDate`/`code`
 * 由本工具按入参自动补写（机械不变量在代码层）；`missing`/`cacheReused` 由
 * agent 按数据包写入 body 开头（skill「附注结构模板」，缺行显式报错）。
 */
export async function runAppendAinote(
  facades: ReviewDailyFacades,
  input: {
    code: string
    tradeDate: string
    body: string
    generatedAt?: string
    dataSources?: string[]
    name?: string
    now?: Date
  },
): Promise<DailyAppendOutcome> {
  const rawCode = typeof input.code === 'string' ? input.code : ''
  const code = normalizeCode(rawCode)
  if (code === null) {
    paramError(`非法标的编码 '${rawCode}'——期望 6 位数字（经 normalizeCode 归一：只去壳、不补全、不猜测）`)
  }
  const tradeDate = normalizeToIsoDate(typeof input.tradeDate === 'string' ? input.tradeDate.trim() : '')
  if (tradeDate === null) {
    paramError(`非法交易日 '${input.tradeDate}'——期望 canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD，归一必须经 src/data/date.ts）`)
  }
  if (typeof input.body !== 'string' || input.body.trim() === '') {
    paramError('body 为空——须提供非空白附注正文（元信息行 + 数据完整性行 + 定位声明行 + 总结）')
  }
  for (const key of ['missing', 'cacheReused'] as const) {
    const present = input.body.split(/\r?\n/).some((line) => line.trim().startsWith(`- ${key}:`))
    if (!present) {
      paramError(
        `body 缺少元信息行 '- ${key}: …'——六键元信息中 missing/cacheReused 由 agent 按数据包写入 body 开头`
        + '（tradeDate/code 由工具自动补写、generatedAt/dataSources 由存储层落盘）；模板见 skills/review-daily-summary/SKILL.md「附注结构模板」。',
      )
    }
  }
  let dataSources = input.dataSources ?? []
  if (!Array.isArray(dataSources) || dataSources.some((s) => typeof s !== 'string' || s.trim() === '')) {
    paramError('dataSources 须为字符串数组（逐字段 `字段=源@YYYY-MM-DD`）')
  }
  dataSources = dataSources.map((s) => s.trim())
  for (const item of dataSources) {
    if (!DATA_SOURCE_ITEM_RE.test(item)) {
      paramError(`dataSources 元素 '${item}' 非法——期望 \`字段=源@YYYY-MM-DD\`（逐字段可追溯，MUST NOT 无日期）`)
    }
  }

  const format = requireFormat(facades)
  let generatedAt: string
  if (input.generatedAt !== undefined && input.generatedAt !== '') {
    if (typeof input.generatedAt !== 'string' || !isZonedIso(input.generatedAt, facades.format)) {
      paramError(`generatedAt '${String(input.generatedAt)}' 非法——期望东八偏移的 ISO8601（formatZonedIso 产出的形态）`)
    }
    generatedAt = input.generatedAt
  } else {
    generatedAt = format.formatZonedIso(input.now ?? runtimeNow())
  }

  // tradeDate/code 元信息行由工具补写（与 frontmatter/锚点同源，消除 agent 抄写漂移）。
  const composedBody = `- tradeDate: ${tradeDate}\n- code: ${code}\n${input.body.replace(/^\r?\n+/, '')}`
  const appendAinote = requireReview(facades, 'appendAinote')
  const result = await appendAinote({
    loc: { dataRoot: facades.data?.dataRoot ?? '', code, name: input.name, tradeDate },
    body: composedBody,
    generatedAt,
    dataSources,
    now: input.now,
  })
  return {
    status: result.status,
    code,
    tradeDate,
    anchor: result.anchor,
    path: result.path,
    generatedAt,
    warnings: result.warnings,
    recomputeHint: '如需重算：删除该附注分节（block ^ainote-<YYYYMMDD>-<代码>-<HHMM>）后重跑；工具与 schema 不存在 force/overwrite 入参。',
  }
}

// ---------------------------------------------------------------------------
// 失败判定矩阵（tasks 3.2；spec「失败判定矩阵与重算指引」的纯函数编排）
// ---------------------------------------------------------------------------

/** T1 侧判定输入（取数失败传 null）。 */
export interface T1JudgmentView {
  available: boolean
  /** T1 列表业务日（MUST 与目标交易日一致，否则降级 dateMismatch）。 */
  tradeDate: string | null
  errors: string[]
}

export interface JudgeOutcomeInput {
  /** 该标的当日是否有用户卡片（无卡 → skipped 零打扰）。 */
  hasCards: boolean
  /** 当日表现（TQ skill）取数成功。 */
  quoteOk: boolean
  /** 涨停原因（T1）结果；取数失败/未取得传 null。 */
  limitReason: T1JudgmentView | null
  targetTradeDate: string
}

export interface JudgeOutcome {
  status: 'created' | 'skipped' | 'failed'
  writeDoc: boolean
  missing: Array<{ field: 'quote' | 'limitReason'; reason: 'sourceUnavailable' | 'dateMismatch' | 'noRecord' | 'fieldAbsent' }>
  /** 数据完整性行（「数据完整性：完整」/「数据完整性：部分（缺 X）」）。 */
  integrityLine: string
  /** limitReason 缺失档对应的正文表述（§12.8 分档）。 */
  limitReasonPhrase: string | null
  /** failed 时的原因（含两路原因）。 */
  failedReason: string | null
}

/**
 * 四态判定矩阵（tasks 3.2）：任一路成功 → `created`（部分，带 missing）；两路皆
 * 不可用 → `failed`（不写文档）；T1 按 `errors` 三档（`dateUnavailable` →
 * sourceUnavailable「该日涨停原因数据不可得」，MUST NOT 写「无涨停记录」；
 * available=false 无 dateUnavailable → noRecord；tradeDate 不一致 → dateMismatch）。
 * 该标的当日无用户卡片 → `skipped`（零打扰）。`deferred` 属预算层（见 planBatchByBudget）。
 */
export function judgeDailyOutcome(input: JudgeOutcomeInput): JudgeOutcome {
  if (!input.hasCards) {
    return { status: 'skipped', writeDoc: false, missing: [], integrityLine: '', limitReasonPhrase: null, failedReason: null }
  }

  const quoteMissing = input.quoteOk ? null : ({ field: 'quote', reason: 'sourceUnavailable' } as const)

  let limitMissing: { field: 'limitReason'; reason: 'sourceUnavailable' | 'dateMismatch' | 'noRecord' } | null = null
  const lr = input.limitReason
  if (lr === null) {
    limitMissing = { field: 'limitReason', reason: 'sourceUnavailable' }
  } else if (lr.errors.includes('dateUnavailable')) {
    limitMissing = { field: 'limitReason', reason: 'sourceUnavailable' }
  } else if (!lr.available) {
    limitMissing = { field: 'limitReason', reason: 'noRecord' }
  } else if (lr.tradeDate !== null && lr.tradeDate !== input.targetTradeDate) {
    limitMissing = { field: 'limitReason', reason: 'dateMismatch' }
  }

  if (quoteMissing !== null && limitMissing !== null) {
    return {
      status: 'failed',
      writeDoc: false,
      missing: [quoteMissing, limitMissing],
      integrityLine: '',
      limitReasonPhrase: null,
      failedReason: `sourceUnavailable（两路皆不可用：quote=${quoteMissing.reason}; limitReason=${limitMissing.reason}）`,
    }
  }

  const missing = [quoteMissing, limitMissing].filter((m): m is NonNullable<typeof m> => m !== null)
  const missingFields = missing.map((m) => m.field)
  let phrase: string | null = null
  if (limitMissing?.reason === 'sourceUnavailable') phrase = '该日涨停原因数据不可得'
  else if (limitMissing?.reason === 'noRecord') phrase = '无涨停记录'
  else if (limitMissing?.reason === 'dateMismatch') phrase = '涨停原因数据业务日与目标交易日不一致（已降级，MUST NOT 冒充本交易日事实）'
  return {
    status: 'created',
    writeDoc: true,
    missing,
    integrityLine: missing.length === 0 ? '数据完整性：完整' : `数据完整性：部分（缺 ${missingFields.join('、')}）`,
    limitReasonPhrase: phrase,
    failedReason: null,
  }
}

// ---------------------------------------------------------------------------
// review_daily_report（tasks 2.11；运行摘要唯一生产者出口，§12.6）
// ---------------------------------------------------------------------------

export const REPORT_ENTRY_STATUSES = ['created', 'skipped', 'failed', 'deferred'] as const
export type ReportEntryStatus = (typeof REPORT_ENTRY_STATUSES)[number]

export interface ReportEntryInput {
  code: string
  status: ReportEntryStatus
  reason?: string
  path?: string
  anchor?: string
}

/**
 * 合并写入运行摘要（`review_daily_report` 的实现，tool 与 service
 * `traderKit.review.dailyReport` 同一实现）：
 * - 以 `(tradeDate, code)` 为键合并（同键覆盖、其余保留）；
 * - **出口自身**调用 `traderKit.review.scanDailyCardTargets(tradeDate)` 自扫清单，
 *   未出现于 entries 的代码补 `failed`（reason='entryMissing'）并记 warnings[]；
 * - `missing` / `warnings` 为可选回填通道（未传时摘要对应键为 []）；
 * - 依赖不可用 → `DEPENDENCY_UNAVAILABLE` 且**不写摘要**。
 */
export async function runDailyReport(
  facades: ReviewDailyFacades,
  input: {
    tradeDate: string
    entries: ReportEntryInput[]
    missing?: RunReportMissingEntry[]
    warnings?: string[]
  },
): Promise<RunReport> {
  const tradeDate = normalizeToIsoDate(typeof input.tradeDate === 'string' ? input.tradeDate.trim() : '')
  if (tradeDate === null) {
    paramError(`非法交易日 '${input.tradeDate}'——期望 canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD，归一必须经 src/data/date.ts）`)
  }
  if (!Array.isArray(input.entries)) {
    paramError('entries 须为数组（每元素 {code, status, reason?, path?, anchor?}）；四态并集由出口自扫兜底，MUST NOT 缺 entries')
  }
  const entries: ReportEntryInput[] = []
  for (let i = 0; i < input.entries.length; i++) {
    const entry = input.entries[i] as unknown as Record<string, unknown>
    if (entry === null || typeof entry !== 'object') {
      paramError(`entries[${i}] 须为对象 {code, status, reason?, path?, anchor?}`)
    }
    const code = normalizeCode(typeof entry.code === 'string' ? entry.code : '')
    if (code === null) {
      paramError(`entries[${i}].code '${String(entry.code)}' 非法——期望 6 位数字（经 normalizeCode 归一）`)
    }
    const status = entry.status
    if (typeof status !== 'string' || !(REPORT_ENTRY_STATUSES as readonly string[]).includes(status)) {
      paramError(`entries[${i}].status '${String(status)}' 非法——枚举 ${REPORT_ENTRY_STATUSES.join(' | ')}`)
    }
    if ((status === 'failed' || status === 'deferred')
      && (typeof entry.reason !== 'string' || entry.reason.trim() === '')) {
      paramError(`entries[${i}].reason 非空必填（status='${status}' 的标的 MUST 带原因，MUST NOT 静默无因失败）`)
    }
    entries.push({
      code,
      status: status as ReportEntryStatus,
      ...(typeof entry.reason === 'string' ? { reason: entry.reason } : {}),
      ...(typeof entry.path === 'string' ? { path: entry.path } : {}),
      ...(typeof entry.anchor === 'string' ? { anchor: entry.anchor } : {}),
    })
  }
  const missingInput: RunReportMissingEntry[] = []
  if (input.missing !== undefined) {
    if (!Array.isArray(input.missing)) paramError('missing 须为数组（元素 {code, field, reason}）')
    for (let i = 0; i < input.missing.length; i++) {
      const m = input.missing[i] as unknown as Record<string, unknown>
      const code = normalizeCode(typeof m?.code === 'string' ? m.code : '')
      if (code === null) paramError(`missing[${i}].code '${String(m?.code)}' 非法——期望 6 位数字`)
      if (typeof m?.field !== 'string' || m.field === '') paramError(`missing[${i}].field 须为非空 string`)
      if (typeof m?.reason !== 'string' || m.reason === '') paramError(`missing[${i}].reason 须为非空 string`)
      missingInput.push({ code, field: m.field, reason: m.reason })
    }
  }
  const warningsInput = input.warnings ?? []
  if (!Array.isArray(warningsInput) || warningsInput.some((w) => typeof w !== 'string')) {
    paramError('warnings 须为字符串数组（change 4 五导出返回的 warnings 原样交回）')
  }

  // 依赖探测在先：出口自身不可用 → DEPENDENCY_UNAVAILABLE 且不写摘要。
  const scan = await requireReview(facades, 'scanDailyCardTargets')(tradeDate)
  const warnings = [...warningsInput, ...scan.warnings]

  // 出口自扫：entries 未覆盖的清单代码补 failed（entryMissing）。
  const entryCodes = new Set(entries.map((e) => e.code))
  for (const target of scan) {
    if (entryCodes.has(target.code)) continue
    entries.push({ code: target.code, status: 'failed', reason: 'entryMissing' })
    warnings.push(`[entryMissing] ${target.code} — 出口自扫清单中的标的未出现在 entries，已补 failed（entryMissing）；MUST NOT 静默丢失。`)
  }

  const dataRoot = facades.data?.dataRoot ?? ''
  const path = runReportPath(dataRoot, tradeDate)
  const existing = await readRunReport(path)
  const merged = mergeRunReport(existing, {
    tradeDate,
    entries,
    missing: missingInput,
    warnings,
  })
  await writeRunReport(path, merged)
  return merged
}

// ---------------------------------------------------------------------------
// 工具定义（中文渲染描述；写明幂等、只追加、依赖不可用显式报错语义）
// ---------------------------------------------------------------------------

const REPORT_STATUS_ENUM = [...REPORT_ENTRY_STATUSES] as unknown as string[]

/** `review_daily_scan` 工具定义（execute 与 runDailyScan 同一实现）。 */
export function createReviewDailyScanTool(facades: ReviewDailyFacades) {
  return defineTool({
    name: 'review_daily_scan',
    description:
      '扫描某交易日的当日有卡标的清单（每日汇总 W2）。缺省交易日经 T0 resolveTradeDate 解析（MUST NOT 读系统日期；不可得时显式要求指定交易日）。'
      + '返回代码/名称/文档路径/用户卡片数（不含附注）/是否已有附注/warnings[]，并附预算预检与分批计划（不足时提示「本次可处理前 N 个标的」，被截断项记 deferred）。'
      + '交易日不可得、归属待确认、该交易日无卡片三态可区分；依赖不可用时显式报 DEPENDENCY_UNAVAILABLE。',
    parameters: {
      date: { type: 'string', description: '可选：目标交易日，canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD）；缺省 = 经 T0 解析' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          state: { type: 'string', enum: ['ok', 'tradeDateUnavailable', 'ownershipUncertain', 'noCards'] },
          tradeDate: nullableString(),
          message: { type: 'string' },
          targets: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                code: { type: 'string' },
                name: { type: 'string' },
                path: { type: 'string' },
                cardCount: { type: 'number' },
                hasAinote: { type: 'boolean' },
              },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
          budget: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: true,
                properties: {
                  remaining: { type: 'number' },
                  budgetLimit: { type: 'number' },
                  budgetUsed: { type: 'number' },
                  minIntervalMs: { type: 'number' },
                  sessionState: { type: 'string' },
                  processableCount: { type: 'number' },
                  deferredCodes: { type: 'array', items: { type: 'string' } },
                  message: { type: 'string' },
                },
              },
              { type: 'null' },
            ],
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderScanText(value as unknown as DailyScanOutcome),
      }],
    },
    execute: async (args) => runDailyScan(facades, args) as never,
  })
}

function renderScanText(value: DailyScanOutcome): string {
  const lines = [`每日汇总扫描：state=${value.state} tradeDate=${value.tradeDate ?? 'null'}`]
  lines.push(value.message)
  for (const t of value.targets) {
    lines.push(`- ${t.code} ${t.name}｜卡片数=${t.cardCount}（不含附注）｜已有附注=${t.hasAinote ? '是' : '否'}｜${t.path}`)
  }
  if (value.budget !== null) {
    lines.push(
      `预算：remaining=${value.budget.remaining}/${value.budget.budgetLimit}（used=${value.budget.budgetUsed}），`
      + `本次可处理=${value.budget.processableCount} 个标的，minIntervalMs=${value.budget.minIntervalMs}，sessionState=${value.budget.sessionState}`,
    )
    if (value.budget.deferredCodes.length > 0) lines.push(`deferred（budgetExhausted）：${value.budget.deferredCodes.join(', ')}`)
  }
  if (value.warnings.length > 0) lines.push(`warnings：${value.warnings.join('；')}`)
  return lines.join('\n')
}

/** `review_read_daily` 工具定义。 */
export function createReviewReadDailyTool(facades: ReviewDailyFacades) {
  return defineTool({
    name: 'review_read_daily',
    description:
      '读取某标的当日文档的用户卡片集合（每日汇总 W3 取料；代码入参兼容 sh600000/600000.SH 形态，经 normalizeCode 归一）。'
      + '返回锚点/writtenAt/正文，**排除 ^ainote- 附注分节**（卡片数口径 = 用户卡片数）；store 层 warnings 原样返回。'
      + '依赖（change 4 locateDoc/parseDoc）不可用时显式报 DEPENDENCY_UNAVAILABLE。',
    parameters: {
      code: { type: 'string', description: '6 位股票代码（兼容 sh/sz/bj 前缀与 .SH/.SZ/.BJ 后缀，不补全不猜测）', required: true },
      tradeDate: { type: 'string', description: '目标交易日，canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD）', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          found: { type: 'boolean' },
          code: { type: 'string' },
          tradeDate: { type: 'string' },
          path: { type: 'string' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                anchor: { type: 'string' },
                writtenAt: { type: 'string' },
                body: { type: 'string' },
              },
            },
          },
          ainoteCount: { type: 'number' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderReadText(value as unknown as DailyReadOutcome),
      }],
    },
    execute: async (args) => runReadDaily(facades, args) as never,
  })
}

function renderReadText(value: DailyReadOutcome): string {
  if (!value.found) return `该标的当日文档不存在：${value.code} @ ${value.tradeDate}（${value.path}）——该交易日无卡片或尚未创建。`
  const lines = [`用户卡片读取：${value.code} @ ${value.tradeDate}（附注 ${value.ainoteCount} 条不计入卡片数）`, value.path]
  for (const card of value.cards) {
    lines.push(`## ${card.anchor}（writtenAt=${card.writtenAt}）`, card.body)
  }
  if (value.warnings.length > 0) lines.push(`warnings：${value.warnings.join('；')}`)
  return lines.join('\n')
}

/** `review_append_ainote` 工具定义（schema 无 force/overwrite/refresh——§9 无幽灵参数）。 */
export function createReviewAppendAinoteTool(facades: ReviewDailyFacades) {
  return defineTool({
    name: 'review_append_ainote',
    description:
      '向某标的当日文档追加 AI 附注（每日汇总 W5；**只追加、幂等、原子写**——同一交易日同一标的重复运行返回 skipped，绝不改写用户卡片分节）。'
      + '写入经 change 4 appendAinote 同一实现，写前归属硬校验（frontmatter tradeDate+code == 目标 loc）不符即报 DOC_MISMATCH。'
      + 'body 须以「- missing: …」「- cacheReused: …」元信息行开头并含「数据完整性」「研究辅助、不构成投资建议」固定行'
      + '（tradeDate/code 两行由工具按入参自动补写，generatedAt 缺省按写入时刻产出，东八偏移）。'
      + '如需重算：删除该附注分节后重跑；本工具无 force/overwrite/refresh 入参。依赖不可用时显式报 DEPENDENCY_UNAVAILABLE、不产出任何文件。',
    parameters: {
      code: { type: 'string', description: '6 位股票代码（兼容 sh/sz/bj 前缀与 .SH/.SZ/.BJ 后缀）', required: true },
      tradeDate: { type: 'string', description: '目标交易日（canonical，须与文档 frontmatter tradeDate 一致，否则 DOC_MISMATCH）', required: true },
      body: { type: 'string', description: '附注正文：以「- missing: …」「- cacheReused: …」元信息行开头，含「数据完整性：完整｜部分（缺 X）」与「研究辅助、不构成投资建议」固定行', required: true },
      generatedAt: { type: 'string', description: '可选：ISO8601 东八偏移（formatZonedIso 产出形态）；缺省按写入时刻产出' },
      dataSources: { type: 'array', items: { type: 'string' }, description: '逐字段数据来源（字段=源@YYYY-MM-DD），如 quote.close=tq-local@2026-09-24' },
      name: { type: 'string', description: '可选：标的名称（新建文档时的名称段；既有文档按代码+日期定位）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          status: { type: 'string', enum: ['created', 'skipped'] },
          code: { type: 'string' },
          tradeDate: { type: 'string' },
          anchor: { type: 'string' },
          path: { type: 'string' },
          generatedAt: { type: 'string' },
          warnings: { type: 'array', items: { type: 'string' } },
          recomputeHint: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderAppendText(value as unknown as DailyAppendOutcome),
      }],
    },
    execute: async (args) => runAppendAinote(facades, args) as never,
  })
}

function renderAppendText(value: DailyAppendOutcome): string {
  const statusText = value.status === 'created' ? '已追加附注（created）' : '已存在附注，跳过（skipped，幂等）'
  return [
    `AI 附注写入：${statusText}`,
    `${value.code} @ ${value.tradeDate}｜锚点=${value.anchor}`,
    value.path,
    `generatedAt=${value.generatedAt}`,
    value.recomputeHint,
    value.warnings.length > 0 ? `warnings：${value.warnings.join('；')}` : '',
  ].filter((l) => l !== '').join('\n')
}

/** `review_daily_report` 工具定义（运行摘要唯一生产者出口）。 */
export function createReviewDailyReportTool(facades: ReviewDailyFacades) {
  return defineTool({
    name: 'review_daily_report',
    description:
      '提交每日汇总运行结果并合并写入运行摘要（每日汇总收尾 SHALL 调用；运行摘要的唯一生产者，落 agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json）。'
      + '入参 entries 为四态 {code, status: created|skipped|failed|deferred, reason?, path?, anchor?}（failed/deferred 的 reason 必填），'
      + '可选回填 missing/warnings；出口自身扫描当日清单，未出现于 entries 的标的补 failed（entryMissing）。'
      + '合并语义：以 (tradeDate, code) 为键同键覆盖、其余保留；同入参重复调用幂等（字节不变）。'
      + '依赖不可用时显式报 DEPENDENCY_UNAVAILABLE 且不写摘要。',
    parameters: {
      tradeDate: { type: 'string', description: '运行归属交易日，canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD）', required: true },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: true,
          properties: {
            code: { type: 'string' },
            status: { type: 'string', enum: REPORT_STATUS_ENUM },
            reason: { type: 'string' },
            path: { type: 'string' },
            anchor: { type: 'string' },
          },
        },
        description: '四态 entries（每个处理过的标的一条；created/skipped 尽量带 path/anchor）',
        required: true,
      },
      missing: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, field: { type: 'string' }, reason: { type: 'string' } } }, description: '可选回填：逐字段缺失 [{code, field, reason}]' },
      warnings: { type: 'array', items: { type: 'string' }, description: '可选回填：本次运行收集的告警（含 change 4 导出的 warnings 原文）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          tradeDate: { type: 'string' },
          created: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, path: { type: 'string' }, anchor: { type: 'string' } } } },
          skipped: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, path: { type: 'string' }, anchor: { type: 'string' } } } },
          failed: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, reason: { type: 'string' } } } },
          deferred: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, reason: { type: 'string' } } } },
          missing: { type: 'array', items: { type: 'object', additionalProperties: true, properties: { code: { type: 'string' }, field: { type: 'string' }, reason: { type: 'string' } } } },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderReportText(value as unknown as RunReport),
      }],
    },
    execute: async (args) => runDailyReport(facades, args as never) as never,
  })
}

function renderReportText(value: RunReport): string {
  const lines = [
    `运行摘要已提交：tradeDate=${value.tradeDate}`,
    `created=${value.created.length} skipped=${value.skipped.length} failed=${value.failed.length} deferred=${value.deferred.length} missing=${value.missing.length} warnings=${value.warnings.length}`,
  ]
  for (const e of value.created) lines.push(`- created ${e.code} ${e.anchor} ${e.path}`)
  for (const e of value.skipped) lines.push(`- skipped ${e.code} ${e.anchor} ${e.path}`)
  for (const e of value.failed) lines.push(`- failed ${e.code}（${e.reason}）`)
  for (const e of value.deferred) lines.push(`- deferred ${e.code}（${e.reason}）`)
  for (const m of value.missing) lines.push(`- missing ${m.code} ${m.field}（${m.reason}）`)
  if (value.warnings.length > 0) lines.push(`warnings：${value.warnings.join('；')}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 装配（tasks 2.4：四工具注册 + dailyReport service 出口；只注册自己的出口）
// ---------------------------------------------------------------------------

/** 由 ctx 构建消费面（挂载期不校验；调用期经 requireXxx 显式报错）。 */
export function createReviewDailyFacades(ctx: Context): ReviewDailyFacades {
  const api = (ctx as { traderKit?: { review?: unknown; data?: unknown } }).traderKit
  return {
    review: (api?.review ?? {}) as ReviewDailyFacades['review'],
    data: (api?.data ?? {}) as ReviewDailyFacades['data'],
    format: reviewFormat,
  }
}

/**
 * 每日汇总装配（由 `src/review/index.ts` 的 registerReview 第三行调用）：
 * 注册四工具 + service 出口 `traderKit.review.dailyReport`。
 * **只注册自己的出口**——change 4 的五个 key（locateDoc/parseDoc/appendCard/
 * appendAinote/scanDailyCardTargets）只消费、不重复注册（§11）。
 */
export function registerReviewDaily(ctx: Context): void {
  const facades = createReviewDailyFacades(ctx)
  const disposers = [
    ctx.tools.register(createReviewDailyScanTool(facades)),
    ctx.tools.register(createReviewReadDailyTool(facades)),
    ctx.tools.register(createReviewAppendAinoteTool(facades)),
    ctx.tools.register(createReviewDailyReportTool(facades)),
  ]
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-trader-kit: review daily tools')

  // service 出口（与工具同一实现）：追加到既有 traderKit.review 容器（不重建 provide）。
  const api = (ctx as { traderKit?: { review?: Record<string, unknown> } }).traderKit
  if (api !== undefined) {
    const review = api.review ?? (api.review = {})
    review.dailyReport = (input: { tradeDate: string; entries: ReportEntryInput[]; missing?: RunReportMissingEntry[]; warnings?: string[] }) =>
      runDailyReport(facades, input)
  }
}
