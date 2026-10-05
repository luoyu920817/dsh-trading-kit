/**
 * 行情名称探针（同花顺 realhead；change 2 data-foundation，owner 指示 2026-10-05
 * 「名称必须显示」——S8 反查仅覆盖板块前 N 权重股，本探针兜底非权重股）。
 *
 * 台账指向：docs/carryover.md §3.1 无本行（新数据点，非脚本移植——接口口径与
 * owner 参考页 `同花顺涨跌停原因.html` 的 fetchThsQuote 同源，实施期补录）。
 * 出站走 src/data/http.ts（全仓唯一 fetch 实现）；本探针为单标的轻量 GET，
 * 经 guard 计数（单标的调用、批量=1，不触发全市场级拒绝）。
 */
import { nativeTransport, type DataTransport } from './http.ts'
import type { DataDeps } from './deps.ts'
import { isGuardRejection } from './guard.ts'
import { formatZonedIso } from './normalize.ts'

const THS_REALHEAD_URL = 'https://d.10jqka.com.cn/v6/realhead'

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

/** 单标的行情名称探针（失败/未命中 → available=false；MUST NOT 猜测）。 */
export async function fetchQuoteName(deps: DataDeps, code: string): Promise<QuoteNameResult> {
  const fetchedAt = formatZonedIso(deps.now())
  const permit = await deps.guard.acquire({ source: 'S9', batch: 1 })
  if (isGuardRejection(permit)) {
    return { available: false, name: null, source: null, errors: ['rateLimited'], fetchedAt }
  }
  try {
    const body = await fetchRealheadText(code, deps.transport ?? nativeTransport)
    const name = body?.items?.name
    if (typeof name === 'string' && name !== '') {
      return { available: true, name, source: 'quote-ths', errors: [], fetchedAt }
    }
    return { available: false, name: null, source: null, errors: ['notFound'], fetchedAt }
  } catch (cause) {
    return { available: false, name: null, source: null, errors: [`quoteProbe: ${cause instanceof Error ? cause.message : String(cause)}`], fetchedAt }
  } finally {
    permit.release()
  }
}
