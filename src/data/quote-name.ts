/**
 * 行情快照探针（同花顺 realhead；change 2 data-foundation，owner 指示 2026-10-05
 * 「名称必须显示」——S8 反查仅覆盖板块前 N 权重股，本探针兜底非权重股；
 * 同日 owner 指示「迁移四个基础数据」——现价/涨跌幅/流通市值/总市值/流通股本
 * 与参考页 `同花顺涨跌停原因.html` 的 fetchThsQuote 同源同字段）。
 *
 * 台账指向：docs/carryover.md §3.1 无本行（新数据点，非脚本移植——接口口径与
 * owner 参考页 fetchThsQuote 同源，实施期补录；spec = quote-snapshot 能力）。
 * 出站走 src/data/http.ts（全仓唯一 fetch 实现）；本探针为单标的轻量 GET，
 * 经 guard 计数（单标的调用、批量=1，不触发全市场级拒绝）。
 * 实时语义：快照不进日级缓存（行情随盘变化；节流由 guard 统一保证）。
 * 覆盖范围 = 沪深（hs_ 前缀）；北交所未验证 → 显式不可得。
 */
import { nativeTransport, type DataTransport } from './http.ts'
import type { DataDeps } from './deps.ts'
import { isGuardRejection } from './guard.ts'
import { formatZonedIso } from './normalize.ts'

const THS_REALHEAD_URL = 'https://d.10jqka.com.cn/v6/realhead'

/** realhead items 字段号（与参考页 fetchThsQuote 逐字对齐）。 */
const FIELD_PRICE = '10' // 现价
const FIELD_PCT = '199112' // 涨跌幅 %
const FIELD_LTSZ = '3475914' // 流通市值（元）
const FIELD_ZSZ = '3541450' // 总市值（元）
const FIELD_LTGB = '407' // 流通股本（股）

export interface QuoteSnapshotResult {
  available: boolean
  name: string | null
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
  source: 'quote-ths' | null
  errors: string[]
  fetchedAt: string | null
}

export interface QuoteNameResult {
  available: boolean
  name: string | null
  source: 'quote-ths' | null
  errors: string[]
  fetchedAt: string | null
}

/** JSONP 文本 → items 对象（realhead 返回 `quotebridge_..._last({...})` 包裹）。 */
function parseJsonpItems(text: string): { items?: Record<string, unknown> } | null {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start + 1, end)) as { items?: Record<string, unknown> }
  } catch {
    return null
  }
}

/** realhead 文本探针（JSONP；走传输接口以便测试注入本地桩）。 */
async function fetchRealheadText(code: string, transport: DataTransport): Promise<{ items?: Record<string, unknown> } | null> {
  const url = `${THS_REALHEAD_URL}/hs_${code}/last.js?_=${Date.now()}`
  const response = await transport(url, { signal: AbortSignal.timeout(5000) })
  const text = await response.text()
  return parseJsonpItems(text)
}

/** 数值字段解析：有限数值或数值字符串 → number；其余 → null（MUST NOT 用 0 冒充）。 */
function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '' && v !== '--') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** 单标的行情快照（失败/未命中 → available=false；MUST NOT 猜测）。 */
export async function fetchQuoteSnapshot(deps: DataDeps, code: string): Promise<QuoteSnapshotResult> {
  const fetchedAt = formatZonedIso(deps.now())
  const permit = await deps.guard.acquire({ source: 'S9', batch: 1 })
  if (isGuardRejection(permit)) {
    return { available: false, name: null, price: null, pct: null, ltsz: null, zsz: null, ltgb: null, source: null, errors: ['rateLimited'], fetchedAt }
  }
  try {
    const items = await fetchRealheadText(code, deps.transport ?? nativeTransport).then((b) => b?.items)
    const rawName = items?.name
    const name = typeof rawName === 'string' && rawName !== '' ? rawName : null
    const price = toNum(items?.[FIELD_PRICE])
    const pct = toNum(items?.[FIELD_PCT])
    const ltsz = toNum(items?.[FIELD_LTSZ])
    const zsz = toNum(items?.[FIELD_ZSZ])
    const ltgb = toNum(items?.[FIELD_LTGB])
    const available = name !== null || price !== null || ltsz !== null
    return {
      available,
      name,
      price,
      pct,
      ltsz,
      zsz,
      ltgb,
      source: available ? 'quote-ths' : null,
      errors: available ? [] : ['notFound'],
      fetchedAt,
    }
  } catch (cause) {
    return {
      available: false, name: null, price: null, pct: null, ltsz: null, zsz: null, ltgb: null, source: null,
      errors: [`quoteProbe: ${cause instanceof Error ? cause.message : String(cause)}`],
      fetchedAt,
    }
  } finally {
    permit.release()
  }
}

/** 单标的行情名称探针（快照的名称投影；available 专指名称可得，不可得必带原因）。 */
export async function fetchQuoteName(deps: DataDeps, code: string): Promise<QuoteNameResult> {
  const snap = await fetchQuoteSnapshot(deps, code)
  const nameAvailable = snap.name !== null
  return {
    available: nameAvailable,
    name: snap.name,
    source: nameAvailable ? 'quote-ths' : null,
    errors: nameAvailable ? [] : (snap.errors.length > 0 ? snap.errors : ['notFound']),
    fetchedAt: snap.fetchedAt,
  }
}
