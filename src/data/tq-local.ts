/**
 * TQ-Local 只读兜底出口（review-loop `tq-local-lookup` capability；tasks 4.6–4.9）。
 *
 * 用途：通达信内置代码（`999999` 上证指数 / `880003` 平均股价 / `880008` 全A等权 /
 * `880823` 微盘股 / `880863` 昨日涨停 / `880005` 涨跌家数 等）在公开源（T2/S8、
 * 行情名称源）中不存在——本出口经本机 TQ-Local（端点常量见 `src/data/http.ts`；本模块不持端口字面量）取
 * **名称 + 最小基础信息**（owner 裁决 2026-10-06：D-TQ 选项 B 局部放开）。
 *
 * 白名单严限（spec「请求契约」）：
 * - method 仅 `get_stock_info`；params 仅 `stock_code` + `field_list`（常量白名单）；
 * - 目标仅回环；经 `src/data/http.ts` 的**同一条**出站通道（白名单常量与闸门都在
 *   该文件；本模块 MUST NOT 另建出站通道、MUST NOT 出现端点端口字面量）；
 * - 单次请求硬超时 2 s、**零重试**；后缀候选 `.SH`→`.SZ`→`.BJ`（调用方显式给出
 *   `marketSuffix` 时只试该值），命中即停；
 * - 失败结果**不缓存**（TdxW 稍后启动即恢复）；成功结果进程内存 TTL 24 h（有上限）。
 *
 * MUST NOT：调用任何行情（`get_market_*`）或交易（`order_stock` 等）接口；
 * 在 `/api/local`（首屏零网络段）调用；把名称/基础信息当作行情事实写入产物。
 */
import {
  HttpDataError,
  TQ_LOCAL_ENDPOINT,
  TQ_LOCAL_FIELD_ALLOWLIST,
  TQ_LOCAL_METHOD_ALLOWLIST,
  requestJson,
  type DataTransport,
} from './http.ts'
import { formatZonedIso } from './normalize.ts'
import { normalizeCode } from '../review/anchor.ts'

/** 单次请求硬超时（spec：2 s，AbortSignal.timeout 截断）。 */
export const TQ_LOCAL_TIMEOUT_MS = 2_000
/** 成功结果缓存 TTL（24 h；失败不缓存）。 */
export const TQ_LOCAL_CACHE_TTL_MS = 24 * 60 * 60 * 1000
/** 缓存条目上限（杜绝无界增长）。 */
export const TQ_LOCAL_CACHE_MAX_ENTRIES = 500

export type MarketSuffix = '.SH' | '.SZ' | '.BJ'

/** 后缀候选序列（确定性；命中即停——MUST NOT 按代码前缀推断市场）。 */
export const MARKET_SUFFIX_CANDIDATES: readonly MarketSuffix[] = ['.SH', '.SZ', '.BJ']

export interface StockBasics {
  available: boolean
  code: string
  marketSuffix: MarketSuffix | null
  name: string | null
  /** `HSStockKind` 原文（`0`=指数 / `1`=A股主板 / `7`=基金 …）。 */
  kind: string | null
  /** `J_start` 原文（`'0'` 归一为 null）。 */
  listedAt: string | null
  region: string | null
  industry: string | null
  /** `ActiveCapital`（流通股本，万股，**字符串原样**）。 */
  floatSharesWan: string | null
  /** `J_zgb`（总股本，万股，字符串原样）。 */
  totalSharesWan: string | null
  source: 'tq-local'
  fetchedAt: string
  cacheReused: boolean
  /** 失败/降级原因原文（不参与业务判断）。 */
  notes: string[]
}

/** 进程内存缓存（键 = 归一后代码；成功结果；有上限）。 */
export class TqLocalCache {
  private readonly entries = new Map<string, { value: StockBasics; atMs: number }>()

  get(code: string, nowMs: number): StockBasics | null {
    const hit = this.entries.get(code)
    if (hit === undefined) return null
    if (nowMs - hit.atMs > TQ_LOCAL_CACHE_TTL_MS) {
      this.entries.delete(code)
      return null
    }
    return hit.value
  }

  set(code: string, value: StockBasics, nowMs: number): void {
    if (this.entries.size >= TQ_LOCAL_CACHE_MAX_ENTRIES) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].atMs - b[1].atMs)[0]
      if (oldest !== undefined) this.entries.delete(oldest[0])
    }
    this.entries.set(code, { value, atMs: nowMs })
  }

  get size(): number {
    return this.entries.size
  }
}

const defaultCache = new TqLocalCache()

export interface TqLocalDeps {
  /** 开关 `sources.tqLocal.enabled`（默认 true；关闭 → 零请求）。 */
  enabled: boolean
  transport?: DataTransport
  now?: () => Date
  /** 缓存注入（测试用；缺省 = 模块级共享实例）。 */
  cache?: TqLocalCache
}

export interface StockBasicsInput {
  code: string
  /** 显式后缀（优先；缺省走候选序列）。 */
  marketSuffix?: MarketSuffix
}

function asField(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t
}

/** `J_start` 语义：`'0'` = 无上市日（归一 null）；其余字段 `'0'` 原样保留。 */
function asDateField(v: unknown): string | null {
  const t = asField(v)
  return t === '0' ? null : t
}

function unavailable(code: string, suffix: MarketSuffix | null, notes: string[], fetchedAt: string, cacheReused: boolean): StockBasics {
  return {
    available: false,
    code,
    marketSuffix: suffix,
    name: null,
    kind: null,
    listedAt: null,
    region: null,
    industry: null,
    floatSharesWan: null,
    totalSharesWan: null,
    source: 'tq-local',
    fetchedAt,
    cacheReused,
    notes,
  }
}

/** 取名称与最小基础信息（白名单严限；见模块头）。 */
export async function getStockBasics(deps: TqLocalDeps, input: StockBasicsInput): Promise<StockBasics> {
  const now = deps.now ?? (() => new Date())
  const fetchedAt = formatZonedIso(now())
  const normalized = normalizeCode(input.code)
  if (normalized === null) {
    return unavailable(String(input.code), null, [`invalidCode: '${String(input.code)}'——期望 6 位数字（经 normalizeCode 归一）`], fetchedAt, false)
  }
  if (deps.enabled !== true) {
    return unavailable(normalized, null, ['disabled: sources.tqLocal.enabled=false——TQ-Local 兜底关闭（零请求）'], fetchedAt, false)
  }
  const cache = deps.cache ?? defaultCache
  const cached = cache.get(normalized, now().getTime())
  if (cached !== null) return { ...cached, cacheReused: true }

  const candidates: readonly MarketSuffix[] = input.marketSuffix !== undefined
    ? [input.marketSuffix]
    : MARKET_SUFFIX_CANDIDATES
  const notes: string[] = []
  for (const suffix of candidates) {
    const body = JSON.stringify({
      id: 1,
      method: TQ_LOCAL_METHOD_ALLOWLIST[0],
      params: { stock_code: `${normalized}${suffix}`, field_list: [...TQ_LOCAL_FIELD_ALLOWLIST] },
    })
    let doc: unknown
    try {
      doc = await requestJson(TQ_LOCAL_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body,
        timeoutMs: TQ_LOCAL_TIMEOUT_MS,
        retries: 0,
        transport: deps.transport,
        tqLocal: { method: TQ_LOCAL_METHOD_ALLOWLIST[0], fieldList: [...TQ_LOCAL_FIELD_ALLOWLIST] },
      })
    } catch (e) {
      // 传输级失败（不可达/超时/闸拒绝）：服务不可用 → 立即终态（换后缀无意义）。
      const kind = e instanceof HttpDataError ? e.kind : 'network'
      const message = e instanceof Error ? e.message : String(e)
      return unavailable(
        normalized,
        suffix,
        [`sourceUnavailable: ${kind}——${message}（提示：确认通达信客户端 TdxW 已启动并登录）`],
        fetchedAt,
        false,
      )
    }
    const result = (doc as { result?: Record<string, unknown> } | null)?.result
    const errorId = result?.ErrorId
    const name = asField(result?.Name)
    if (errorId === '0' && name !== null && result !== undefined) {
      const value: StockBasics = {
        available: true,
        code: normalized,
        marketSuffix: suffix,
        name,
        kind: asField(result.HSStockKind),
        listedAt: asDateField(result.J_start),
        region: asField(result.tdx_dyname),
        industry: asField(result.rs_hyname),
        floatSharesWan: asField(result.ActiveCapital),
        totalSharesWan: asField(result.J_zgb),
        source: 'tq-local',
        fetchedAt,
        cacheReused: false,
        notes,
      }
      cache.set(normalized, value, now().getTime())
      return value
    }
    notes.push(`noRecord: ${normalized}${suffix} ErrorId=${String(errorId ?? '(缺失)')} Name=${JSON.stringify(result?.Name ?? null)}`)
  }
  // 全候选未命中：`noRecord`（不是「无记录」的行情语义，只是该代码在本机 TDX 中无此标的）。
  return unavailable(normalized, null, [`noRecord: 候选后缀 ${candidates.join('/')} 均未取得名称`, ...notes], fetchedAt, false)
}
