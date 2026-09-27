/**
 * T0 交易日解析（trade-date-tool spec / design D-12、D-15；全插件唯一日期事实源）。
 *
 * - `businessDate` 从 S7 响应体**无条件**取值（列表为空也不丢）；MUST NOT 由系统时钟、
 *   限流日或请求日顶替；不可得 → null（MUST NOT 用任何其它日期填充）。
 * - `isTradingDay` 只允许 `true | null`：businessDate === rateLimitDate（归一后同格式比较）
 *   → true；否则 null。**无交易日历，MUST NOT 用系统日期推断「非交易日」，MUST NOT 返回 false**。
 * - 缓存/预算复用列表级口径（键 = `source + requestedDate`，与 T1 共用 fetchS7List 的
 *   同一条目），MUST NOT 另建缓存层。
 * - 入参 canonical `YYYY-MM-DD`（兼容 `YYYYMMDD`，经 src/data/date.ts 归一；不猜测）；
 *   非法入参显式报错且零网络。
 *
 * 结构断言（tasks 4.3）：本文件不存在「按系统时钟判定周一至周五 / 排除法定假日 /
 * 推断非交易日」分支（test/trade-date.test.ts 扫描）。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import { rateLimitDate, normalizeToIsoDate } from './date.ts'
import type { DataDeps } from './deps.ts'
import type { GuardRejection } from './guard.ts'
import { fetchS7List } from './s7.ts'
import { formatZonedIso } from './normalize.ts'

export const TRADE_DATE_CACHE_SCHEMA = 'trade-date@1'

export interface TradeDateEvidence {
  /** 限流日（YYYY-MM-DD，判定基准）。 */
  rateLimitDate: string
  /** 业务日来源字段（S7 响应体）。 */
  businessDateField: 'data.date'
  /** 响应体原始值（未归一）。 */
  businessDateRaw: string | null
  /** 归一后的业务日（与 businessDate 相同）。 */
  businessDateValue: string | null
  /** 判定规则说明。 */
  rule: string
}

export interface TradeDateResult {
  /** 请求日回声（canonical；缺省入参 = 限流日）。 */
  requestedDate: string
  /** 业务日（源响应体；不可得 → null）。 */
  businessDate: string | null
  /** 只允许 true | null（无交易日历，MUST NOT 返回 false）。 */
  isTradingDay: true | null
  source: 'S7' | null
  fetchedAt: string | null
  evidence: TradeDateEvidence
  errors: string[]
  notes: string[]
  guard: GuardRejection | null
}

export interface TradeDateInput {
  /** canonical `YYYY-MM-DD`（兼容 `YYYYMMDD`）；缺省 = 限流日。 */
  date?: string
}

/** T0 解析：请求日归一 → S7 列表（缓存/护栏复用）→ 业务日无条件取响应体 → 同格式比较。 */
export async function resolveTradeDate(deps: DataDeps, input: TradeDateInput = {}): Promise<TradeDateResult> {
  const rawDate = input.date
  const rateLimit = rateLimitDate(deps.now())
  let requestedDate: string | null
  if (rawDate === undefined) {
    requestedDate = rateLimit
  } else {
    requestedDate = normalizeToIsoDate(String(rawDate).trim())
  }
  const evidenceBase: TradeDateEvidence = {
    rateLimitDate: rateLimit,
    businessDateField: 'data.date',
    businessDateRaw: null,
    businessDateValue: null,
    rule: 'businessDate 只取源响应体；businessDate === rateLimitDate（同格式）→ true，否则 null（无交易日历，禁止推断非交易日）',
  }

  if (requestedDate === null) {
    return {
      requestedDate: String(rawDate),
      businessDate: null,
      isTradingDay: null,
      source: null,
      fetchedAt: null,
      evidence: evidenceBase,
      errors: ['invalidParam'],
      notes: [`非法参数 date='${String(rawDate)}'——期望 canonical YYYY-MM-DD 或 8 位 YYYYMMDD（经 src/data/date.ts 归一，不猜测）`],
      guard: null,
    }
  }

  const s7 = await fetchS7List(deps, requestedDate)
  const businessDate = s7.ok ? s7.businessDate : null
  const isTradingDay: true | null = businessDate !== null && businessDate === rateLimit ? true : null
  return {
    requestedDate,
    businessDate,
    isTradingDay,
    source: s7.ok ? 'S7' : null,
    fetchedAt: s7.fetchedAt,
    evidence: {
      ...evidenceBase,
      businessDateRaw: s7.ok ? s7.businessDate : null,
      businessDateValue: businessDate,
      rule: s7.ok
        ? evidenceBase.rule
        : 'S7 leg 失败或护栏拒绝：businessDate 不可得（null），MUST NOT 用系统日期/限流日/请求日顶替',
    },
    errors: s7.ok ? [] : ['sourceUnavailable'],
    notes: s7.ok
      ? (isTradingDay === null && businessDate !== null
          ? [`businessDate=${businessDate} ≠ rateLimitDate=${rateLimit}，归属待用户确认（isTradingDay=null）`]
          : [])
      : [`S7 leg：${s7.errors.join('；') || '不可用'}`, ...s7.notes],
    guard: s7.guard,
  }
}

/** guardStatus 消费方（change 5 预检）读取的时间戳工具（供 service 出口复用）。 */
export function nowZonedIso(deps: DataDeps): string {
  return formatZonedIso(deps.now())
}
