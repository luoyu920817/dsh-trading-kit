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
  let businessDate = s7.ok ? s7.businessDate : null
  let isTradingDay: true | null = businessDate !== null && businessDate === rateLimit ? true : null
  const probeNotes: string[] = []

  // owner 裁决补丁（2026-10-05）：S7 List 响应无日期字段（实测）——请求日=限流日且
  // List 行非空时，以「会话集合比对」定业务日（数据驱动，不猜日历）：
  // 前探最近有数据的日期 D，List 代码集合 == D 的集合 → List 即 D 日会话（休市日）；
  // List 有 D 没有的新代码 → List 是请求日的新会话（交易日）。详见 trade-date-tool spec 补丁。
  if (s7.ok && businessDate === null && Object.keys(s7.rows).length > 0) {
    const listCodes = new Set(Object.keys(s7.rows))
    let probeDay: string | null = fromIsoShift(rateLimit, -1)
    let outbound = 0 // 真实出站探针数（缓存命中不计额度——否则长假期会耗尽 6 次）
    for (let i = 0; i < 30 && probeDay !== null && outbound < 6; i++) {
      const probeDate = probeDay
      const budgetBefore = deps.guard.status().budgetUsed
      const h = await fetchS7List(deps, probeDate)
      const isOutbound = deps.guard.status().budgetUsed > budgetBefore
      // 缓存毒化防护（owner 实测 bug 2026-10-06）：该日期曾是「当日」时缓存条目来自
      // List（businessDate=null，实际是更早会话的数据）——跳过，MUST NOT 用探针日期兜底。
      if (!h.ok || Object.keys(h.rows).length === 0 || h.businessDate === null) {
        probeNotes.push(
          !h.ok ? `探针 ${probeDate}: 失败`
          : Object.keys(h.rows).length === 0 ? `探针 ${probeDate}: 无数据`
          : `探针 ${probeDate}: 缓存条目无业务日（List 缓存，会话归属不可证）——跳过`,
        )
        probeDay = fromIsoShift(probeDate, -1)
        if (isOutbound) outbound += 1
        continue
      }
      if (isOutbound) outbound += 1
      const probeCodes = new Set(Object.keys(h.rows))
      const identical = listCodes.size === probeCodes.size
        && [...listCodes].every((c) => probeCodes.has(c))
      if (identical) {
        businessDate = h.businessDate
        isTradingDay = null // D ≠ 限流日 → 归属待确认（休市日场景，页面预填 D）
        probeNotes.push(`会话集合比对：List 与 ${businessDate} 的代码集合一致（${listCodes.size} 只）→ List 为该日会话`)
      } else {
        businessDate = rateLimit
        isTradingDay = true // List 含新代码 → 请求日的新会话
        probeNotes.push(`会话集合比对：List 含 ${probeDate} 没有的新代码 → List 为请求日（${rateLimit}）新会话`)
      }
      break
    }
    if (!probeNotes.some((n) => n.includes('→'))) {
      probeNotes.push('前探无可用业务日（数据源未覆盖或条目不可归属）——businessDate 保持 null')
    }
  }

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
      ? [...probeNotes,
         ...(isTradingDay === null && businessDate !== null
          ? [`businessDate=${businessDate} ≠ rateLimitDate=${rateLimit}，归属待用户确认（isTradingDay=null）`]
          : [])]
      : [`S7 leg：${s7.errors.join('；') || '不可用'}`, ...s7.notes],
    guard: s7.guard,
  }
}

/** 自然日前移 N 天（经 date.ts 单点实现；越界/非法返回 null——不猜）。 */
function fromIsoShift(iso: string, days: number): string | null {
  const parsed = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(parsed.getTime())) return null
  const shifted = new Date(parsed.getTime() + days * 86_400_000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** guardStatus 消费方（change 5 预检）读取的时间戳工具（供 service 出口复用）。 */
export function nowZonedIso(deps: DataDeps): string {
  return formatZonedIso(deps.now())
}
