/**
 * T2 `get_concepts` 解析与缓存接线（concepts-tool spec / design D-11、D-18、tasks 6.2–6.3）。
 *
 * - 强度分档（照脚本）：`core_avg_pcp` 百分数换算（0.05 → 5）后 ≥5 强 / ≥2 中 / >0 弱 /
 *   <0 跌 / =0 平；列表按 `core_avg_pcp` 降序。
 * - `reason` 截断 200 字（值存在时适用；偏离脚本：脚本截断后补 '...' 会使长度 >200，
 *   本实现直接截到 200 以满足 `value.length <= 200`）；`reason`/`plateId` 为 best-effort：
 *   源端未返回 → `null` + notes（不阻塞 available）。
 * - 名称反查（best-effort）：`top_n_stocks.items[].stock_chi_name`；未命中 → null（不猜）。
 * - **T2 无日期语义**（design D-18）：`date` 入参只用于缓存分桶与列表级键
 *   （键 = `concepts + requestedDate`，与 `source + requestedDate` 同构）；请求 S8 MUST NOT
 *   带日期参数；`businessDate=null`（源无日期字段）时 notes 记「源无日期，按 requestedDate
 *   缓存」；目录段仍按 requestedDate 折算；MUST NOT 产生 dateUnavailable。
 *
 * **口径注记（待 6.6 fixture / 6.7 抽查复核）**：列表级键为 `concepts + requestedDate`
 * （spec 口径：S8 响应视作整份概念列表），因此同一请求日内的跨标的派生复用同一份缓存
 * 响应（name 反查与 concepts 均以该响应为域）。S8 实际按 symbol 取数，跨标的复用的
 * 覆盖度以实测 fixture 为准——若实测证明响应严格按 symbol 裁剪，需在后续迭代把键
 * 升级为含 code 的 schema v2（cacheSchema 不匹配视为未命中，自动覆盖）。
 *
 * 台账指向：docs/carryover.md §3.1（tasks 8.4）。
 */
import { normalizeToIsoDate, rateLimitDate } from './date.ts'
import type { DataDeps } from './deps.ts'
import type { GuardRejection } from './guard.ts'
import { fetchS8Plates, type S8PlatesResult } from './s8.ts'
import { cleanText, field, formatZonedIso, ratioToPercent, type SourcedField } from './normalize.ts'

export const CONCEPTS_CACHE_SCHEMA = 'concepts@1'

/** reason 截断长度（照脚本 `_reason_short` 的 200 字上限）。 */
export const REASON_MAX_LENGTH = 200

export type ConceptStrength = '强' | '中' | '弱' | '跌' | '平'

export interface ConceptItem {
  /** 概念名（plate_name；空名条目跳过，照脚本）。 */
  name: string | null
  /** 分档：≥5 强 / ≥2 中 / >0 弱 / <0 跌 / =0 平。 */
  strength: ConceptStrength
  /** 百分数数值（源小数 0.05 → 5）。 */
  strengthPct: number
  /** best-effort：源端未返回 → null + notes（不阻塞 available）。 */
  reason: SourcedField<string>
  /** best-effort：源端未返回 → null + notes。 */
  plateId: SourcedField<string | number>
  source: 'S8'
  fetchedAt: string | null
}

export interface ConceptsResult {
  available: boolean
  code: string
  requestedDate: string
  /** S8 响应无日期字段 → null（MUST NOT 用请求日/限流日代填，design D-18）。 */
  businessDate: string | null
  /** 名称反查（best-effort；未命中 → null）。 */
  name: string | null
  concepts: ConceptItem[]
  source: 'S8' | null
  fetchedAt: string | null
  notes: string[]
  errors: string[]
  guard: GuardRejection | null
}

export interface ConceptsInput {
  code: string
  /** 只用于缓存分桶与列表级键；请求 S8 不带日期参数（T2 无日期语义）。 */
  date?: string
}

/** 强度分档（边界：6.2→强 / 2→中 / 0→平 / -1→跌）。 */
export function classifyStrength(strengthPct: number): ConceptStrength {
  if (strengthPct >= 5) return '强'
  if (strengthPct >= 2) return '中'
  if (strengthPct > 0) return '弱'
  if (strengthPct < 0) return '跌'
  return '平'
}

/** reason 截断（值存在时适用；200 字上限）。 */
function truncateReason(raw: string | null): { value: string | null; truncated: boolean } {
  if (raw === null) return { value: null, truncated: false }
  if (raw.length <= REASON_MAX_LENGTH) return { value: raw, truncated: false }
  return { value: raw.slice(0, REASON_MAX_LENGTH), truncated: true }
}

interface PlateLike {
  core_avg_pcp?: unknown
  plate_name?: unknown
  reason?: unknown
  plate_id?: unknown
  top_n_stocks?: { items?: unknown }
}

function toPlateList(plates: Record<string, unknown>): PlateLike[] {
  return Object.values(plates).filter((p): p is PlateLike => p !== null && typeof p === 'object')
}

/** 名称反查（best-effort）：top_n_stocks.items[].symbol（剥离 .SH/.SZ/.SS）== code → stock_chi_name。 */
function lookupName(plates: PlateLike[], code: string): string | null {
  for (const plate of plates) {
    const items = plate.top_n_stocks?.items
    if (!Array.isArray(items)) continue
    for (const item of items) {
      if (item === null || typeof item !== 'object') continue
      const rec = item as { symbol?: unknown; stock_chi_name?: unknown }
      const sym = String(rec.symbol ?? '').replace(/\.(SH|SZ|SS)$/i, '')
      if (sym === code) {
        const name = cleanText(rec.stock_chi_name)
        if (name !== null) return name
      }
    }
  }
  return null
}

/** 解析层：排序、分档、换算、截断、best-effort 反查（纯函数，供单测直测）。 */
export function parsePlates(payload: Record<string, unknown>, code: string, fetchedAt: string | null): { concepts: ConceptItem[]; name: string | null; notes: string[] } {
  const plates = toPlateList(payload)
  const notes: string[] = []
  if (plates.some((p) => p.reason === undefined) || plates.some((p) => p.plate_id === undefined)) {
    notes.push('reason/plateId 源端未返回（best-effort 降级为 null，不阻塞 available）')
  }

  const items = plates
    .map((plate): ConceptItem | null => {
      const name = cleanText(plate.plate_name)
      if (name === null) return null // 照脚本：无名条目跳过
      const pcpRaw = plate.core_avg_pcp
      const pcp = typeof pcpRaw === 'number' && Number.isFinite(pcpRaw) ? pcpRaw : 0
      const strengthPct = ratioToPercent(pcp)
      const reason = truncateReason(cleanText(plate.reason))
      if (reason.truncated) notes.push(`概念「${name}」reason 超长已截断到 ${REASON_MAX_LENGTH} 字`)
      const plateIdRaw = plate.plate_id
      const plateId: string | number | null = typeof plateIdRaw === 'number' ? plateIdRaw : cleanText(plateIdRaw)
      return {
        name,
        strength: classifyStrength(strengthPct),
        strengthPct,
        reason: field(reason.value, 'S8', fetchedAt),
        plateId: field(plateId, 'S8', fetchedAt),
        source: 'S8' as const,
        fetchedAt,
      }
    })
    .filter((item): item is ConceptItem => item !== null)
    .sort((a, b) => b.strengthPct - a.strengthPct)

  const name = lookupName(plates, code)
  if (name === null) notes.push('名称反查未命中（top_n_stocks.items 中无本标的；name=null，不猜）')
  return { concepts: items, name, notes: [...new Set(notes)] }
}

function paramErrorResult(code: string, requestedDateEcho: string, message: string): ConceptsResult {
  return {
    available: false, code, requestedDate: requestedDateEcho, businessDate: null, name: null,
    concepts: [], source: null, fetchedAt: null, notes: [message], errors: ['invalidParam'], guard: null,
  }
}

/** T2 取数：视图缓存 → 列表级缓存 → 出站（护栏）→ 解析 → 写缓存。 */
export async function getConcepts(deps: DataDeps, input: ConceptsInput): Promise<ConceptsResult> {
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!/^\d{6}$/.test(code)) {
    return paramErrorResult(code, String(input.code), `非法参数 code='${String(input.code)}'——白名单 ^\\d{6}$（6 位数字，不补全不猜测）`)
  }
  let requestedDate: string
  if (input.date === undefined) {
    requestedDate = rateLimitDate(deps.now())
  } else {
    const normalized = normalizeToIsoDate(String(input.date).trim())
    if (normalized === null) {
      return paramErrorResult(code, String(input.date), `非法参数 date='${String(input.date)}'——期望 canonical YYYY-MM-DD 或 8 位 YYYYMMDD（经 src/data/date.ts 归一，不猜测）`)
    }
    requestedDate = normalized
  }

  const noDateNote = '源无日期，按 requestedDate 缓存'

  // code 派生视图级缓存先行（键 = requestedDate + code）。
  const cachedView = await deps.cache.readView<ConceptsResult>('concepts', CONCEPTS_CACHE_SCHEMA, requestedDate, code)
  if (cachedView !== null) return cachedView.value

  const assemble = (parts: { plates: Record<string, unknown>; fetchedAt: string | null; notes: string[]; errors: string[]; guard: GuardRejection | null }): ConceptsResult => {
    const parsed = parsePlates(parts.plates, code, parts.fetchedAt)
    const available = parsed.concepts.length > 0 && parts.errors.length === 0
    return {
      available,
      code,
      requestedDate,
      businessDate: null, // S8 无日期字段（design D-18）：MUST NOT 用请求日/限流日代填
      name: parsed.name,
      concepts: parsed.concepts,
      source: 'S8',
      fetchedAt: parts.fetchedAt,
      notes: [...parts.notes, ...parsed.notes, noDateNote],
      errors: parts.errors,
      guard: parts.guard,
    }
  }

  // 列表级缓存（键 = concepts + requestedDate；payload = 整份 S8 响应）。
  const cachedList = await deps.cache.readList<{ plates: Record<string, unknown> }>('concepts', CONCEPTS_CACHE_SCHEMA, 'concepts', requestedDate)
  if (cachedList !== null) {
    const result = assemble({ plates: cachedList.payload.plates, fetchedAt: cachedList.fetchedAt, notes: [], errors: [], guard: null })
    if (result.available) {
      await deps.cache.writeView('concepts', CONCEPTS_CACHE_SCHEMA, requestedDate, code, result, { businessDate: null, fetchedAt: cachedList.fetchedAt })
    }
    return result
  }

  const fetched = await fetchS8Plates(deps, { code })
  if (!fetched.ok) {
    return {
      available: false,
      code,
      requestedDate,
      businessDate: null,
      name: null,
      concepts: [],
      source: 'S8',
      fetchedAt: fetched.fetchedAt,
      notes: fetched.unsupported
        ? [...fetched.notes, noDateNote]
        : [...fetched.notes, '空数据/失败为显式不可用态（MUST NOT 用空列表冒充成功）', noDateNote],
      errors: fetched.errors.length > 0 ? fetched.errors : ['sourceUnavailable'],
      guard: fetched.guard,
    }
  }

  await deps.cache.writeList('concepts', CONCEPTS_CACHE_SCHEMA, 'concepts', requestedDate, {
    businessDate: null,
    hitEndpoint: 'plates_by_any_stock',
    fetchedAt: fetched.fetchedAt ?? formatZonedIso(deps.now()),
    payload: { plates: fetched.plates },
    errors: [],
    notes: [noDateNote],
  })
  const result = assemble({ plates: fetched.plates, fetchedAt: fetched.fetchedAt, notes: fetched.notes, errors: [], guard: null })
  if (result.available) {
    await deps.cache.writeView('concepts', CONCEPTS_CACHE_SCHEMA, requestedDate, code, result, { businessDate: null, fetchedAt: result.fetchedAt ?? '' })
  }
  return result
}
