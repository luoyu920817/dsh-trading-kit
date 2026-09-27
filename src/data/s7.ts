/**
 * S7 客户端（换手率 surgeLimit 接口）——口径照 vault 脚本 `fetch_zt_timeline.py`
 * 的 `fetch_hsl_reasons` / `_hsl_endpoint_and_params` 符号移植（design D-3/D-6、tasks 5.1）。
 *
 * 溯源：docs/carryover.md §3.1「src/data/s7.ts」行（源路径 + 偏离清单）。
 * 相对脚本的偏离（详见台账）：
 * ① 路由判据改为「请求日 vs 限流日」（脚本按 beijing_today() 判定当日）；
 * ② 业务日从响应体**无条件**取值（脚本 `returned_date` 在 rows 为空时不赋值）；
 * ③ 历史分支 MUST NOT 回退 List（List 不带 date 参数，是当日全市场列表）；
 *    当日 List 空/失败**可**回退 History（记 endpoint 与 notes）；
 * ④ 频控护栏 + 两层缓存（脚本无限流）；预算按列表级请求数计（一次 History = 1 次）；
 * ⑤ 只取 type=1（涨停列表）——本 change 无炸板列表消费方，type=2 不请求（一次
 *    请求日对应一次列表级请求的预算口径）；
 * ⑥ 签名参数 `ts`/`sign` 走 config（默认取脚本 HSL_SIGN/HSL_TS 现值，design D-6）。
 *
 * 源请求参数日期用 `toCompactDate` 折算（YYYYMMDD 允许位置③：第三方源请求参数）。
 */
import type { ResolvedTraderKitConfig } from '../config.ts'
import { rateLimitDate, toCompactDate, normalizeToIsoDate } from './date.ts'
import type { DataDeps } from './deps.ts'
import { isGuardRejection, type GuardRejection } from './guard.ts'
import { requestJson } from './http.ts'
import { cleanText, toNumber, formatZonedIso } from './normalize.ts'

export const S7_LIST_URL = 'https://goserver.huanshoulv.com/aimapp/surgeLimit/surgeLimitList'
export const S7_HISTORY_URL = 'https://goserver.huanshoulv.com/aimapp/surgeLimit/surgeLimitHistory'

/** 缓存 schema（模块名 + 版本；升级后旧缓存视为未命中并覆盖写）。 */
export const S7_CACHE_SCHEMA = 's7@1'

export type S7Endpoint = 'surgeLimitList' | 'surgeLimitHistory'

/** S7 单条涨停记录（字段映射照 fetch_hsl_reasons 的 entry 符号）。 */
export interface S7Row {
  code: string
  /** 涨停原因（`cause`）。 */
  cause: string | null
  /** 首封时间（`first_time`，HH:MM）——firstTime 的**唯一**来源。 */
  firstTime: string | null
  /** 最后封板时间（`last_time`，缺省回退 `ori_last_time`，HH:MM）。 */
  lastTime: string | null
  /** 开板次数（`open_count`）。 */
  openCount: number | null
  /** 连板描述（`surgedays` 原文本，如 '3连板'）。 */
  streakDesc: string | null
  /** 回溯标注（`trackback`）。 */
  trackback: string | null
  /** 强度（`intensity`）。 */
  intensity: number | null
}

export interface S7ListResult {
  /** 请求成功且响应可解析（不代表有数据；空列表也 ok=true）。 */
  ok: boolean
  /** 实际命中的端点（当日 List 空回退 History 后为 History）。 */
  endpoint: S7Endpoint | null
  /** 响应体业务日（无条件取值；格式非法/缺失 → null + note，MUST NOT 用系统日期兜底）。 */
  businessDate: string | null
  rows: Record<string, S7Row>
  errors: string[]
  notes: string[]
  /** 当日 List 空/失败后回退 History 时为 true（记 endpoint + notes）。 */
  fallbackUsed: boolean
  /** 护栏拒绝时置位（拒绝态具名，design D-16）。 */
  guard: GuardRejection | null
  fetchedAt: string | null
}

function fmtHhmm(v: unknown): string | null {
  const text = String(v ?? '').trim()
  if (text === '' || /^0+$/.test(text)) return null
  const digits = text.replace(/\D/g, '')
  if (digits === '') return null
  const padded = digits.padStart(4, '0')
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}`
}

function mapRow(fields: unknown[], raw: unknown[]): S7Row | null {
  const rec: Record<string, unknown> = {}
  for (let i = 0; i < fields.length; i += 1) rec[String(fields[i])] = raw[i]
  const code = String(rec['stock_code'] ?? '').trim()
  if (code === '') return null
  return {
    code,
    cause: cleanText(rec['cause']),
    firstTime: fmtHhmm(rec['first_time']),
    lastTime: fmtHhmm(rec['last_time'] ?? rec['ori_last_time']),
    openCount: toNumber(rec['open_count']),
    streakDesc: cleanText(rec['surgedays']),
    trackback: cleanText(rec['trackback']),
    intensity: toNumber(rec['intensity']),
  }
}

interface S7Attempt {
  ok: boolean
  endpoint: S7Endpoint
  businessDate: string | null
  rows: Record<string, S7Row>
  errors: string[]
  notes: string[]
  guard: GuardRejection | null
  fetchedAt: string | null
}

function buildUrl(endpoint: S7Endpoint, requestedDate: string, sources: ResolvedTraderKitConfig['sources']): string {
  const url = endpoint === 'surgeLimitList' ? S7_LIST_URL : S7_HISTORY_URL
  const params = new URLSearchParams({
    page: '1',
    type: '1',
    sort_type: '-1',
    page_count: '5000',
    channel: 'hsl-app',
    ts: sources.s7.ts,
    sign: sources.s7.sign,
  })
  if (endpoint === 'surgeLimitHistory') {
    params.set('date', toCompactDate(requestedDate))
    params.set('history_type', '1')
  }
  return `${url}?${params.toString()}`
}

async function attemptS7(deps: DataDeps, endpoint: S7Endpoint, requestedDate: string): Promise<S7Attempt> {
  const failure = (errors: string[], guard: GuardRejection | null = null): S7Attempt => ({
    ok: false, endpoint, businessDate: null, rows: {}, errors, notes: [], guard, fetchedAt: null,
  })
  const permit = await deps.guard.acquire({ source: 'S7', batch: 1 })
  if (isGuardRejection(permit)) return failure([], permit)
  try {
    const body = await requestJson(buildUrl(endpoint, requestedDate, deps.config.sources), {
      timeoutMs: deps.config.sources.s7.timeoutMs,
      retries: deps.config.sources.s7.retries,
      transport: deps.transport,
    })
    const fetchedAt = formatZonedIso(deps.now())
    const payload = (body as { data?: unknown } | null)?.data
    if (payload === null || payload === undefined || typeof payload !== 'object') {
      return failure([`${endpoint} 响应缺少 data 对象`])
    }
    const data = payload as { date?: unknown; fields?: unknown; surgeList?: unknown }
    // 业务日**无条件**取响应体（偏离脚本 returned_date 口径）；双格式归一经 date.ts。
    const rawDate = data.date === null || data.date === undefined ? '' : String(data.date).trim()
    const businessDate = rawDate === '' ? null : normalizeToIsoDate(rawDate)
    const fields = Array.isArray(data.fields) ? data.fields.map((f) => String(f)) : []
    const rows: Record<string, S7Row> = {}
    if (Array.isArray(data.surgeList)) {
      for (const raw of data.surgeList) {
        if (!Array.isArray(raw)) continue
        const row = mapRow(fields, raw)
        if (row !== null) rows[row.code] = row
      }
    }
    const notes: string[] = []
    if (rawDate !== '' && businessDate === null) {
      notes.push(`S7 响应体 date='${rawDate}' 无法归一为 YYYY-MM-DD，businessDate 记 null（MUST NOT 用系统日期兜底）`)
    }
    return { ok: true, endpoint, businessDate, rows, errors: [], notes, guard: null, fetchedAt }
  } catch (cause) {
    return failure([`${endpoint} 请求失败：${cause instanceof Error ? cause.message : String(cause)}`])
  } finally {
    permit.release()
  }
}

/**
 * 取 S7 涨停列表（带两层缓存与护栏；T0/T1 共用同一列表级缓存条目）。
 *
 * 路由（判据 = 请求日 vs 限流日）：相等 → List（List 空/失败可回退 History，记
 * endpoint + notes）；不等 → 只用 History（空/失败 MUST NOT 回退 List）。
 * 最终结果按 `list__S7__<requestedDate>` 缓存（键由入参构造）。
 */
export async function fetchS7List(deps: DataDeps, requestedDate: string): Promise<S7ListResult> {
  const cached = await deps.cache.readList<S7ListResult>('s7', S7_CACHE_SCHEMA, 'S7', requestedDate)
  if (cached !== null) return cached.payload

  const rateLimit = rateLimitDate(deps.now())
  const isToday = requestedDate === rateLimit
  const primary: S7Endpoint = isToday ? 'surgeLimitList' : 'surgeLimitHistory'
  let result = await attemptS7(deps, primary, requestedDate)
  const notes = [...result.notes]
  let fallbackUsed = false

  if (isToday) {
    const primaryEmpty = result.ok && Object.keys(result.rows).length === 0
    if (result.ok === false || primaryEmpty) {
      if (result.ok === false) notes.push('当日 surgeLimitList 失败，按当日分支回退 surgeLimitHistory')
      else notes.push('当日 surgeLimitList 为空，按当日分支回退 surgeLimitHistory（History 不含当天，源端可能尚未出数）')
      const fallback = await attemptS7(deps, 'surgeLimitHistory', requestedDate)
      notes.push(...fallback.notes)
      if (fallback.ok && Object.keys(fallback.rows).length > 0) {
        fallbackUsed = true
        notes.push(`已由 surgeLimitHistory 兜底（endpoint=${fallback.endpoint}）`)
        result = fallback
      } else if (result.ok === false) {
        notes.push(...fallback.errors)
      } else {
        notes.push('surgeLimitHistory 亦无数据，维持当日 List 空结论')
      }
    }
  } else {
    // 历史分支 MUST NOT 回退 List（List 不带 date 参数，是当日全市场列表）。
    if (result.ok === false) notes.push('历史分支不回退 surgeLimitList（List 为当日全市场列表，会把别日数据当请求日数据）')
  }

  const final: S7ListResult = {
    ok: result.ok,
    endpoint: result.ok ? result.endpoint : null,
    businessDate: result.ok ? result.businessDate : null,
    rows: result.ok ? result.rows : {},
    errors: result.errors,
    notes,
    fallbackUsed,
    guard: result.guard,
    fetchedAt: result.fetchedAt,
  }
  if (final.ok && final.guard === null) {
    // 只缓存成功出站的结果（护栏拒绝不落缓存）；失败结果不缓存（可重试，预算由护栏管）。
    await deps.cache.writeList('s7', S7_CACHE_SCHEMA, 'S7', requestedDate, {
      businessDate: final.businessDate,
      hitEndpoint: final.endpoint,
      fetchedAt: final.fetchedAt ?? formatZonedIso(deps.now()),
      payload: final,
      errors: final.errors,
      notes: final.notes,
    })
  }
  return final
}
