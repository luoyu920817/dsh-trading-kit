/**
 * T1 `get_limit_reason` 取数编排（limit-reason-tool spec / design D-17、tasks 5.3–5.4）。
 *
 * - 主源 S7（surgeLimitList / surgeLimitHistory 路由见 s7.ts），备源 S5；
 * - **备源聚合优先级判定表**（D-17，评审 Issue 28）：
 *   ① S5 在该业务日有命中记录 → `available=true` / `source='S5'` / `errors=[]`
 *     （S7 leg 的 dateUnavailable/sourceUnavailable 只进 notes）；
 *   ② 两源均无数据 → `available=false` + `errors:['dateUnavailable']`（附请求日）；
 *   ③ 两源均失败（或任一 leg 硬失败且无数据）→ `available=false` + `errors:['sourceUnavailable']`。
 *   「无数据」与「取数失败」MUST 用不同 error 值区分（contracts §12.8）。
 * - **日期三义**：requestedDate 回声（canonical，兼容 YYYYMMDD 归一）；tradeDate 无条件取
 *   S7 响应体；`requestedDate !== rateLimitDate` 且源业务日与请求日不一致 →
 *   `available=false` + `errors:['dateUnavailable']`（附两日期，MUST NOT 仅 notes 标注）。
 * - **首封时间红线**：firstTime 只来自 S7 `first_time`；S5 时间（最后封板语义）只进 lastTime。
 *
 * 台账指向：本模块为**自建**（无脚本来源；S7/S5 口径偏离见 docs/carryover.md §3.1
 * 「src/data/s7.ts」「src/data/s5.ts」对应行），tasks 8.4。
 */
import { rateLimitDate, normalizeToIsoDate } from './date.ts'
import type { DataDeps } from './deps.ts'
import type { GuardRejection } from './guard.ts'
import { fetchS7List, type S7ListResult } from './s7.ts'
import { fetchS5Record, type S5RecordResult } from './s5.ts'
import { field, formatZonedIso, type SourcedField } from './normalize.ts'

export const LIMIT_REASON_CACHE_SCHEMA = 'limit-reason@1'

export interface LimitReasonResult {
  available: boolean
  code: string
  /** 请求日回声（canonical YYYY-MM-DD）。 */
  requestedDate: string
  /** 列表业务日 = S7 响应体业务日（无条件取值；MUST NOT 用 hitRecordDate 冒充）。 */
  tradeDate: string | null
  /** S5 命中的异动记录日（不适用 → null；只标注、不采用）。 */
  hitRecordDate: string | null
  cause: SourcedField<string>
  /** 首封时间——只来自 S7 `first_time`。 */
  firstTime: SourcedField<string>
  /** 最后封板时间（S7 `last_time|ori_last_time`，或 S5 最后封板时刻）。 */
  lastTime: SourcedField<string>
  openCount: SourcedField<number>
  streakDesc: SourcedField<string>
  source: 'S7' | 'S5' | null
  fetchedAt: string | null
  notes: string[]
  errors: string[]
  guard: GuardRejection | null
}

export interface LimitReasonInput {
  code: string
  /** canonical `YYYY-MM-DD`（兼容 `YYYYMMDD` 归一）；缺省 = 限流日。 */
  date?: string
}

function unavailableResult(code: string, requestedDate: string, opts: {
  errors: string[]
  notes: string[]
  source?: 'S7' | 'S5' | null
  tradeDate?: string | null
  hitRecordDate?: string | null
  fetchedAt?: string | null
  guard?: GuardRejection | null
  s7?: S7ListResult | null
}): LimitReasonResult {
  const fetchedAt = opts.fetchedAt ?? null
  const envSource = opts.source ?? null
  return {
    available: false,
    code,
    requestedDate,
    tradeDate: opts.tradeDate ?? null,
    hitRecordDate: opts.hitRecordDate ?? null,
    cause: field(null, envSource, fetchedAt),
    firstTime: field(null, envSource, fetchedAt),
    lastTime: field(null, envSource, fetchedAt),
    openCount: field(null, envSource, fetchedAt),
    streakDesc: field(null, envSource, fetchedAt),
    source: envSource,
    fetchedAt,
    notes: opts.notes,
    errors: opts.errors,
    guard: opts.guard ?? null,
  }
}

function paramError(code: string, rawDate: string | undefined, message: string): LimitReasonResult {
  const result = unavailableResult(code, rawDate ?? '', { errors: ['invalidParam'], notes: [message] })
  return result
}

/** 主源命中（S7 列表内有该标的）的可用结果。 */
function fromS7Row(code: string, requestedDate: string, s7: S7ListResult): LimitReasonResult {
  const row = s7.rows[code]
  const fetchedAt = s7.fetchedAt
  const notes = [...s7.notes]
  return {
    available: true,
    code,
    requestedDate,
    tradeDate: s7.businessDate,
    hitRecordDate: null,
    cause: field(row?.cause ?? null, 'S7', fetchedAt),
    firstTime: field(row?.firstTime ?? null, 'S7', fetchedAt),
    lastTime: field(row?.lastTime ?? null, 'S7', fetchedAt),
    openCount: field(row?.openCount ?? null, 'S7', fetchedAt),
    streakDesc: field(row?.streakDesc ?? null, 'S7', fetchedAt),
    source: 'S7',
    fetchedAt,
    notes,
    errors: [],
    guard: s7.guard,
  }
}

/** T1 取数：主源 S7 →（空/失败/日期不符时）备源 S5 → 按 D-17 聚合。 */
export async function getLimitReason(deps: DataDeps, input: LimitReasonInput): Promise<LimitReasonResult> {
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!/^\d{6}$/.test(code)) {
    return paramError(code, input.date, `非法参数 code='${String(input.code)}'——白名单 ^\\d{6}$（6 位数字，不补全不猜测）`)
  }
  const rawDate = input.date
  let requestedDate: string | null
  if (rawDate === undefined) {
    requestedDate = rateLimitDate(deps.now())
  } else {
    requestedDate = normalizeToIsoDate(String(rawDate).trim())
  }
  if (requestedDate === null) {
    return paramError(code, rawDate, `非法参数 date='${String(rawDate)}'——期望 canonical YYYY-MM-DD 或 8 位 YYYYMMDD（经 src/data/date.ts 归一，不猜测）`)
  }

  const s7 = await fetchS7List(deps, requestedDate)
  const rateLimit = rateLimitDate(deps.now())
  const isHistorical = requestedDate !== rateLimit
  // 历史请求下源业务日与请求日不一致 → S7 数据不可用于该请求日（dateUnavailable），
  // 但最终可用态仍按聚合表（S5 命中可兜底）。
  const s7DateMismatch = isHistorical && s7.ok && s7.businessDate !== null && s7.businessDate !== requestedDate
  const row = s7.ok && !s7DateMismatch ? s7.rows[code] : undefined
  const notes: string[] = [...s7.notes]
  if (s7DateMismatch) {
    notes.push(`源业务日 ${s7.businessDate} 与请求日 ${requestedDate} 不一致，S7 列表数据不用于本请求`)
  }

  // ① 主源成功且命中该标的：直接可用（不取备源）。
  if (s7.ok && row !== undefined && !s7DateMismatch) {
    const result = fromS7Row(code, requestedDate, s7)
    return result
  }

  // ② 主源成功、列表非空、但无该标的（业务日一致）→ 权威「无涨停记录」：
  //    available=false、errors=[]（无 dateUnavailable，contracts §12.8），tradeDate 仍可得。
  if (s7.ok && !s7DateMismatch && Object.keys(s7.rows).length > 0) {
    return unavailableResult(code, requestedDate, {
      errors: [],
      notes: [...notes, `该标的不在 ${s7.endpoint ?? 'S7'} 列表中（无涨停记录）`],
      source: null,
      tradeDate: s7.businessDate,
      fetchedAt: s7.fetchedAt,
      guard: s7.guard,
    })
  }

  // ③ 主源空 / 失败 / 历史日业务日不符 → 备源 S5（历史日不回退 List 已由 s7.ts 保证）。
  const s5 = await fetchS5Record(deps, { code, requestedDate })
  const mergedNotes = [...notes, ...s5.notes]
  if (s7.ok === false && s7.errors.length > 0) mergedNotes.push(`S7 leg 失败：${s7.errors.join('；')}`)
  if (s5.errors.length > 0) mergedNotes.push(`S5 leg 错误：${s5.errors.join('；')}`)

  // ② S5 在该业务日有命中记录（hitRecordDate 可判为同一业务日）→ 可用、errors=[]。
  if (s5.ok && s5.hit && s5.hitRecordDate !== null && s5.hitRecordDate === requestedDate && !s5.unsupported) {
    mergedNotes.push('History 为空，已由 S5 兜底')
    const fetchedAt = s5.fetchedAt
    return {
      available: true,
      code,
      requestedDate,
      tradeDate: s7.ok ? s7.businessDate : null,
      hitRecordDate: s5.hitRecordDate,
      cause: field(s5.reason, 'S5', fetchedAt),
      firstTime: field(null, 'S5', fetchedAt), // S5 无首封语义（红线）：firstTime 只来自 S7 first_time
      lastTime: field(s5.lastTime, 'S5', fetchedAt),
      openCount: field(null, 'S5', fetchedAt),
      streakDesc: field(s5.streak === null ? null : String(s5.streak), 'S5', fetchedAt),
      source: 'S5',
      fetchedAt,
      notes: [...mergedNotes, 'S5 无首封语义：firstTime=null，时间值为最后封板时刻（lastTime）'],
      errors: [],
      guard: s5.guard ?? s7.guard,
    }
  }

  // 备源也未给出该业务日的可用数据 → 聚合「无数据」或「取数失败」。
  const fetchedAt = s5.fetchedAt ?? s7.fetchedAt
  const anyLegFailed = s7.ok === false || (s5.ok === false && !s5.unsupported)
  if (anyLegFailed) {
    // ③ 两源均失败（或任一 leg 硬失败且无数据）→ sourceUnavailable（取数失败）。
    return unavailableResult(code, requestedDate, {
      errors: ['sourceUnavailable'],
      notes: [
        ...mergedNotes,
        `S7 leg：${s7.ok ? 'ok（无可用数据）' : '失败'}`,
        `S5 leg：${s5.ok ? 'ok（无该业务日命中）' : s5.unsupported ? '显式不支持' : '失败'}`,
      ].filter((n) => n !== ''),
      source: null,
      tradeDate: s7.ok ? s7.businessDate : null,
      hitRecordDate: s5.hitRecordDate,
      fetchedAt,
      guard: s5.guard ?? s7.guard,
    })
  }

  // ② 两源均无数据 → dateUnavailable（具名 token；附请求日与源业务日进 notes）。
  const dateNotes: string[] = []
  if (isHistorical && s7.ok && s7.businessDate !== null && s7.businessDate !== requestedDate) {
    dateNotes.push(`requestedDate=${requestedDate}，源业务日=${s7.businessDate}（不一致，附两日期）`)
  } else {
    dateNotes.push(`requestedDate=${requestedDate}；已尝试 S7/${s7.endpoint ?? '未出站'} 与 S5`)
  }
  return unavailableResult(code, requestedDate, {
    errors: ['dateUnavailable'],
    notes: [...mergedNotes, ...dateNotes],
    source: s5.ok && s5.hit ? 'S5' : null,
    tradeDate: s7.ok ? s7.businessDate : null,
    hitRecordDate: s5.hitRecordDate,
    fetchedAt,
    guard: s5.guard ?? s7.guard,
  })
}
