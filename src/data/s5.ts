/**
 * S5 备源客户端（同花顺异动历史 + 涨停明细）——口径照 vault 脚本
 * `fetch_limit_reason_local.py` 移植（design D-13、tasks 5.2）。
 *
 * 溯源：docs/carryover.md §3.1「src/data/s5.ts」行（源路径 + 偏离清单）。
 * 相对脚本的硬口径偏离（详见台账）：
 * ① **删除本地 HTML 依赖**：不检查 `D:/TDX_HOME/...html`，其缺失不得成为断开备源的理由；
 * ② **marketId 表化**（脚本 `17`/`33` 内联）：北交所等待验证，本迭代显式不支持，
 *    MUST NOT 静默按深市套用（脚本会静默按深市）；
 * ③ **时间语义**：S5 的 `first_limit_time` 实为**最后封板时刻**（取自
 *    `boardAnalyses[-1].closeTime`），只进 `lastTime`，MUST NOT 进 `firstTime`；
 * ④ **hitRecordDate 独立字段**：脚本 `_pick_news` 无精确日期记录时会回退「≤ 目标
 *    日期的最近一条」甚至任意记录——命中记录日 MUST NOT 冒充列表业务日（tradeDate）；
 * ⑤ 频控护栏 + code 派生视图级缓存（S5 为按标的取数，整份记录列表按 (code, 请求日) 缓存）。
 */
import type { DataDeps } from './deps.ts'
import { isValidIsoDate, toCompactDate } from './date.ts'
import { isGuardRejection, type GuardRejection } from './guard.ts'
import { requestJson } from './http.ts'
import { cleanText, toNumber, formatZonedIso } from './normalize.ts'

export const S5_HISTORY_URL = 'https://flow.10jqka.com.cn/anomaly/v1/history'
export const S5_DETAIL_URL = 'https://vis.10jqka.com.cn/infomine3/limit/limitup'

export const S5_CACHE_SCHEMA = 's5@1'

/** S5 请求 UA（照脚本 headers 口径）。 */
export const S5_UA = 'Mozilla/5.0'
/** 历史请求条数（照脚本 count=252）。 */
export const S5_HISTORY_COUNT = 252

/**
 * 市场映射表（表驱动，MUST NOT 在调用处内联魔法数字）。
 * 脚本口径：`6` 开头 → `17`（沪），其余 → `33`（深）；北交所被脚本静默按深市——
 * 本表显式改判：`8`/`4`/`9` 开头等待验证、本迭代不支持。未知前缀同样显式不支持。
 */
export const S5_MARKET_TABLE: Readonly<Record<string, { marketId: string | null; note: string }>> = {
  '6': { marketId: '17', note: '沪市（参考脚本口径）' },
  '0': { marketId: '33', note: '深市主板/中小板（参考脚本口径）' },
  '3': { marketId: '33', note: '深市创业板（参考脚本口径）' },
  '8': { marketId: null, note: '北交所——市场映射待验证，本迭代显式不支持（MUST NOT 静默按深市）' },
  '4': { marketId: null, note: '北交所/新三板——市场映射待验证，本迭代显式不支持' },
  '9': { marketId: null, note: '沪 B/老三板——市场映射待验证，本迭代显式不支持' },
}

export type S5Market =
  | { supported: true; marketId: string; note: string }
  | { supported: false; marketId: null; note: string }

/** 表驱动的市场映射；未登记前缀 → 显式不支持（不猜测）。 */
export function s5MarketForCode(code: string): S5Market {
  const rule = S5_MARKET_TABLE[code.slice(0, 1)]
  if (rule === undefined) {
    return { supported: false, marketId: null, note: `市场映射待验证（前缀 '${code.slice(0, 1)}' 未登记），本迭代显式不支持` }
  }
  if (rule.marketId === null) return { supported: false, marketId: null, note: rule.note }
  return { supported: true, marketId: rule.marketId, note: rule.note }
}

export interface S5RecordResult {
  /** 请求成功且响应可解析（不代表命中记录）。 */
  ok: boolean
  /** 命中异动/涨跌停记录。 */
  hit: boolean
  /**
   * 命中的异动记录自身携带的日期（YYYY-MM-DD；源回退到旧记录时 ≠ requestedDate，
   * 只进本字段与 notes，MUST NOT 冒充 tradeDate）。无记录或日期不可判 → null。
   */
  hitRecordDate: string | null
  reason: string | null
  tagName: string | null
  tagCode: string | null
  isLimitUp: boolean
  /** 最后封板时刻（boardAnalyses[-1].closeTime 的时间部分；S5 无首封语义）。 */
  lastTime: string | null
  /** 连板数（S5 文本解析，best-effort）。 */
  streak: number | null
  errors: string[]
  notes: string[]
  guard: GuardRejection | null
  /** 显式不支持（市场映射待验证）时置位。 */
  unsupported: boolean
  fetchedAt: string | null
}

interface S5News {
  date?: unknown
  tagCode?: unknown
  tagName?: unknown
  reason?: unknown
  stockName?: unknown
  keywordList?: unknown
}

/**
 * 记录挑选（照脚本 `_pick_news` 口径）：精确日期 → ≤ 目标日期的最近一条（列表序）→
 * 偏好涨停/大涨 tag → 首条。命中记录日与请求日的差异由 hitRecordDate/notes 呈现。
 */
function pickNews(news: S5News[], targetIso: string): S5News | null {
  if (news.length === 0) return null
  const dateOf = (n: S5News): string | null => {
    const raw = String(n.date ?? '').trim()
    if (raw === '') return null
    const head = raw.split(/[ T]/)[0] ?? ''
    return isValidIsoDate(head) ? head : null
  }
  const exact = news.find((n) => dateOf(n) === targetIso)
  if (exact !== undefined) return exact
  const before = news.find((n) => {
    const d = dateOf(n)
    return d !== null && d <= targetIso
  })
  if (before !== undefined) return before
  for (const n of news) {
    const tag = String(n.tagCode ?? '') + String(n.tagName ?? '')
    if (['UP', 'LIMIT'].some((k) => tag.toUpperCase().includes(k)) || ['涨停', '大涨'].some((k) => tag.includes(k))) {
      return n
    }
  }
  return news[0] as S5News
}

/** 连板数解析（照脚本 `_parse_streak` 口径）。 */
function parseStreak(text: string): number | null {
  const m = /(\d+)\s*连板|(\d+)\s*板/.exec(text)
  if (m === null) return null
  const g = m[1] ?? m[2]
  return g === undefined ? null : toNumber(g)
}

/** 时间部分提取（照脚本 `.split(' ')[-1]` 口径）：'2026-09-24 14:55:06' → '14:55:06'。 */
function timePart(raw: unknown): string | null {
  const text = String(raw ?? '').trim()
  if (text === '') return null
  const parts = text.split(/\s+/).filter((p) => p !== '')
  const last = parts[parts.length - 1]
  return last === undefined || last === '' ? null : last
}

/**
 * 取 S5 异动记录 + 涨停明细（护栏 + code 派生视图缓存，键 = (code, requestedDate)）。
 * 本地 HTML 依赖已删除：任何本机文件缺失都不参与错误判定。
 */
export async function fetchS5Record(deps: DataDeps, input: { code: string; requestedDate: string }): Promise<S5RecordResult> {
  const { code, requestedDate } = input
  const cached = await deps.cache.readView<S5RecordResult>('s5', S5_CACHE_SCHEMA, requestedDate, code)
  if (cached !== null) return cached.value

  const failure = (errors: string[], extra: Partial<S5RecordResult> = {}): S5RecordResult => ({
    ok: false, hit: false, hitRecordDate: null, reason: null, tagName: null, tagCode: null,
    isLimitUp: false, lastTime: null, streak: null, errors, notes: [], guard: null,
    unsupported: false, fetchedAt: null, ...extra,
  })

  // 市场映射表化：显式不支持直接返回（零请求），MUST NOT 静默按深市。
  const market = s5MarketForCode(code)
  if (!market.supported) {
    const result = failure([], { unsupported: true, notes: [market.note] })
    await deps.cache.writeView('s5', S5_CACHE_SCHEMA, requestedDate, code, result, { businessDate: null, fetchedAt: formatZonedIso(deps.now()) })
    return result
  }

  const permit = await deps.guard.acquire({ source: 'S5', batch: 1 })
  if (isGuardRejection(permit)) return failure([], { guard: permit, notes: [`护栏拒绝出站：${permit.reason}`] })
  try {
    const fetchedAt = formatZonedIso(deps.now())
    const body = await requestJson(S5_HISTORY_URL, {
      method: 'POST',
      headers: { 'User-Agent': S5_UA, 'Content-Type': 'application/json', Referer: 'https://flow.10jqka.com.cn/' },
      body: JSON.stringify({ thsHqCode: code, marketId: market.marketId, count: S5_HISTORY_COUNT }),
      timeoutMs: deps.config.sources.s5.timeoutMs,
      retries: deps.config.sources.s5.retries,
      transport: deps.transport,
    })
    const envelope = body as { status_code?: unknown; status_msg?: unknown; message?: unknown; data?: unknown } | null
    const errors: string[] = []
    const notes: string[] = [`市场映射：${market.note}`]
    if (envelope?.status_code !== 0) {
      errors.push(`同花顺 history 接口返回异常：${String(envelope?.status_msg ?? envelope?.message ?? '未知错误')}`)
    }
    const list = (envelope?.data as { anomalyAnalysisList?: unknown } | null | undefined)?.anomalyAnalysisList
    const news: S5News[] = Array.isArray(list) ? (list as S5News[]) : []
    const selected = errors.length === 0 ? pickNews(news, requestedDate) : null
    if (selected === null) {
      const result = failure(errors, {
        ok: errors.length === 0,
        notes: errors.length === 0 ? [...notes, '未获取到同花顺异动/涨跌停原因记录'] : notes,
        fetchedAt,
      })
      if (result.ok) {
        await deps.cache.writeView('s5', S5_CACHE_SCHEMA, requestedDate, code, result, { businessDate: null, fetchedAt })
      }
      return result
    }

    // 命中记录日：独立字段（源记录日期格式自由 → 归一校验，不可判 → null + note）。
    const rawDate = String(selected.date ?? '').trim()
    const dateHead = rawDate.split(/[ T]/)[0] ?? ''
    const hitRecordDate = isValidIsoDate(dateHead) ? dateHead : null
    if (rawDate !== '' && hitRecordDate === null) {
      notes.push(`S5 记录日期 '${rawDate}' 无法归一为 YYYY-MM-DD，hitRecordDate 记 null`)
    }
    if (hitRecordDate !== null && hitRecordDate !== requestedDate) {
      notes.push(`命中非请求日记录：hitRecordDate=${hitRecordDate} ≠ requestedDate=${requestedDate}（只标注、不采用）`)
    }

    const tagCode = cleanText(selected.tagCode)
    const tagName = cleanText(selected.tagName)
    const isLimitUp = (tagCode !== null && tagCode.toUpperCase().includes('UP')) || (tagName !== null && tagName.includes('涨停'))
    const reason = cleanText(selected.reason)

    // 明细（最后封板时刻）：S5 时间只进 lastTime（首封语义只在 S7 first_time）。
    let lastTime: string | null = null
    let streak: number | null = null
    if (hitRecordDate !== null) {
      try {
        const detailBody = await requestJson(`${S5_DETAIL_URL}?stockCode=${encodeURIComponent(code)}&date=${toCompactDate(hitRecordDate)}`, {
          headers: { 'User-Agent': S5_UA },
          timeoutMs: deps.config.sources.s5.timeoutMs,
          retries: deps.config.sources.s5.retries,
          transport: deps.transport,
        })
        const payload = (detailBody as { data?: { boardAnalyses?: unknown; closeNumText?: unknown; summary?: unknown } | null } | null)?.data ?? null
        const boards = payload?.boardAnalyses
        if (Array.isArray(boards) && boards.length > 0) {
          const lastBoard = boards[boards.length - 1] as { closeTime?: unknown }
          lastTime = timePart(lastBoard?.closeTime)
        }
        const textForStreak = [cleanText(payload?.closeNumText), cleanText(payload?.summary)]
          .filter((t): t is string => t !== null)
          .join(' ')
        streak = parseStreak(textForStreak)
      } catch (cause) {
        errors.push(`同花顺 limitup 明细抓取失败：${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }

    const result: S5RecordResult = {
      ok: true,
      hit: true,
      hitRecordDate,
      reason,
      tagName,
      tagCode,
      isLimitUp,
      lastTime,
      streak,
      errors,
      notes,
      guard: null,
      unsupported: false,
      fetchedAt,
    }
    await deps.cache.writeView('s5', S5_CACHE_SCHEMA, requestedDate, code, result, { businessDate: null, fetchedAt })
    return result
  } catch (cause) {
    return failure([`同花顺异动/涨跌停原因抓取失败：${cause instanceof Error ? cause.message : String(cause)}`])
  } finally {
    permit.release()
  }
}
