/**
 * S8 客户端（选股宝 plates_by_any_stock 实时快照）——口径照 vault 脚本
 * `fetch_concepts_xuangubao.py` 移植（design D-18、tasks 6.1）。
 *
 * 溯源：docs/carryover.md §3.1「src/data/s8.ts」行（源路径 + 偏离清单）。
 * 相对脚本的偏离（详见台账）：
 * ① 请求 `fields` 扩为 `core_avg_pcp,plate_name,reason,plate_id,top_n_stocks`
 *   （脚本白名单不含 `reason`/`plate_id`，解析层却读它们——扩白名单 + best-effort 降级）；
 * ② T2 **无日期语义**：S8 是不带日期参数的实时快照接口，请求 MUST NOT 带日期参数
 *   （`date` 入参只用于缓存分桶，design D-18）；
 * ③ 频控护栏 + 两层缓存（脚本无限流）；④ 成功判定 `code === 20000` 照抄。
 *
 * 台账指向：docs/carryover.md §3.1（tasks 8.4）。
 */
import type { DataDeps } from './deps.ts'
import { isGuardRejection, type GuardRejection } from './guard.ts'
import { requestJson } from './http.ts'
import { formatZonedIso } from './normalize.ts'

export const S8_API_URL = 'https://flash-api.xuangubao.com.cn/api/stage2/plates_by_any_stock'
/** 请求字段白名单（偏离①：扩入 reason/plate_id，tasks 6.1）。 */
export const S8_FIELDS = 'core_avg_pcp,plate_name,reason,plate_id,top_n_stocks'

export const S8_CACHE_SCHEMA = 's8@1'

/** 请求 headers（照脚本：UA / Accept / Referer）。 */
export function s8Headers(): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    Accept: 'application/json',
    Referer: 'https://flash-api.xuangubao.com.cn/',
  }
}

export type S8Symbol =
  | { verified: true; symbol: string; note: string }
  | { verified: false; symbol: null; note: string }

/**
 * 后缀约定（照脚本 `get_symbol`：沪 `.SS`、深 `.SZ`——注意与 TQ 的 `.SH` 不同）。
 * 未验证市场（北交所等）显式标注待验证，MUST NOT 静默套用沪深规则。
 */
export function s8SymbolForCode(code: string): S8Symbol {
  if (code.startsWith('6')) return { verified: true, symbol: `${code}.SS`, note: '沪市后缀 .SS（参考脚本口径）' }
  if (code.startsWith('0') || code.startsWith('3')) return { verified: true, symbol: `${code}.SZ`, note: '深市后缀 .SZ（参考脚本口径）' }
  return {
    verified: false,
    symbol: null,
    note: `后缀规则待验证（代码前缀 '${code.slice(0, 1)}'，如北交所）——MUST NOT 静默套用沪深后缀，本迭代不支持`,
  }
}

export interface S8PlatesResult {
  ok: boolean
  /** 成功判定照脚本：`code === 20000`。 */
  apiCode: number | null
  /** 响应 data（plateKey → plate 信息）；失败/空 → 空对象。 */
  plates: Record<string, unknown>
  errors: string[]
  notes: string[]
  guard: GuardRejection | null
  unsupported: boolean
  fetchedAt: string | null
}

/**
 * 取 S8 概念响应（实时快照，不带日期参数）。缓存由 concepts.ts 按列表级键
 * （concepts + requestedDate）接管——本函数只负责单次出站与解析。
 */
export async function fetchS8Plates(deps: DataDeps, input: { code: string }): Promise<S8PlatesResult> {
  const failure = (errors: string[], extra: Partial<S8PlatesResult> = {}): S8PlatesResult => ({
    ok: false, apiCode: null, plates: {}, errors, notes: [], guard: null, unsupported: false, fetchedAt: null, ...extra,
  })

  const symbol = s8SymbolForCode(input.code)
  if (!symbol.verified) {
    return failure([], { unsupported: true, notes: [symbol.note] })
  }

  const permit = await deps.guard.acquire({ source: 'S8', batch: 1 })
  if (isGuardRejection(permit)) return failure([], { guard: permit, notes: [`护栏拒绝出站：${permit.reason}`] })
  try {
    const body = await requestJson(`${S8_API_URL}?symbol=${encodeURIComponent(symbol.symbol)}&fields=${S8_FIELDS}`, {
      headers: s8Headers(),
      timeoutMs: deps.config.sources.s8.timeoutMs,
      retries: deps.config.sources.s8.retries,
      transport: deps.transport,
    })
    const fetchedAt = formatZonedIso(deps.now())
    const envelope = body as { code?: unknown; message?: unknown; data?: unknown } | null
    const apiCode = typeof envelope?.code === 'number' ? envelope.code : null
    if (apiCode !== 20000) {
      return failure([`选股宝 API 返回异常：${String(apiCode ?? '缺失')} - ${String(envelope?.message ?? '未知错误')}`], { apiCode, fetchedAt })
    }
    const data = envelope?.data
    if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
      return failure(['选股宝 API 返回异常：data 非对象'], { apiCode, fetchedAt })
    }
    // 空对象 = 源端确认「该标的无板块数据」（owner 实测 2026-10-05：未收录代码返回
    // 空 data）——ok=true + 空 plates，由概念缓存负缓存（当日零重复出站），
    // assemble 判 available=false；MUST NOT 当作源错误（会让"未收录"无法缓存）。
    return {
      ok: true,
      apiCode,
      plates: data as Record<string, unknown>,
      errors: [],
      notes: [symbol.note],
      guard: null,
      unsupported: false,
      fetchedAt,
    }
  } catch (cause) {
    return failure([`选股宝 API 抓取失败：${cause instanceof Error ? cause.message : String(cause)}`])
  } finally {
    permit.release()
  }
}
