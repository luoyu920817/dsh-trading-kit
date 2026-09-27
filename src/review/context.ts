/**
 * 名称三层兜底与交易日归属 seam（change 4 tasks 1.5/3.1/3.1b；契约 §1/§12.4，
 * design D-5/D-9/D-TQ）。
 *
 * - `NameResolver`：层① 本地历史 frontmatter（零网络）→ 层② T2/S8 网络反查
 *   （**以注入的异步反查函数承接**，默认实现不注入即不出网）→ 层③ 仅代码。
 *   层序与接口归属见契约 §12.4：本地段（`/api/local`）的取值域只有 ① 与 ③，
 *   层② 只在 enrich 路径消费。
 * - `TradeDateResolver`：交易日归属的结构化 seam——默认包装器接收注入的
 *   `traderKit.data.resolveTradeDate`（change 2 T0；本任务只定义 seam 形状与
 *   包装器，接线在装配点）。MUST NOT 自行实现日期推断或系统日期 fallback。
 * - `createTqStubTradeDateResolver`（tasks 3.1b）：D-TQ **选项 B 最小 stub**——
 *   不接线、不调用 TQ，返回 `source: 'TQ-HqDate'` + `marketSuffix`，用于契约
 *   测试断言「替换 seam 实现后页面/存储层零改动」。MUST NOT 出现在生产注册路径。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { dirname, join } from 'node:path'
import { resolveArea } from '../paths/resolve.ts'
import { isValidIsoDate } from '../data/date.ts'
import { normalizeCode } from './anchor.ts'
import { findFrontmatter, parseFrontmatterValues } from './md/frontmatter.ts'

// ---------------------------------------------------------------------------
// 名称三层兜底（契约 §12.4）
// ---------------------------------------------------------------------------

export type NameSource = 'frontmatter-history' | 'T2-S8' | 'code-only' | 'TQ-match-stkinfo'

export interface NameResult {
  /** 名称；null = 不可得（层③ 仅代码，页面以代码显示）。 */
  value: string | null
  source: NameSource
  confidence: 'high' | 'low'
  /** D-TQ 选项 B 预留（沪 .SH / 深 .SZ / 北 .BJ）。 */
  marketSuffix?: '.SH' | '.SZ' | '.BJ'
}

export interface NameResolver {
  resolve(code: string): Promise<NameResult>
}

export interface NameResolverDeps {
  /**
   * 层②：T2/S8 网络反查（enrich 路径注入；返回 null = 反查不可得）。
   * 默认不注入——本地层（①/③）MUST NOT 出网，未注入时层② 直接跳过。
   */
  lookupNameRemote?: (code: string) => Promise<string | null>
  /** 数据根（层① 扫描本地历史卡片 frontmatter 用）。 */
  dataRoot: string
}

/** 由 6 位代码推导市场后缀（6 开头沪、0/3 开头深、4/8/9 开头北交所）。 */
export function marketSuffixForCode(code: string): '.SH' | '.SZ' | '.BJ' {
  if (code.startsWith('6')) return '.SH'
  if (code.startsWith('0') || code.startsWith('3')) return '.SZ'
  return '.BJ'
}

/**
 * 层①：扫描本地历史卡片 frontmatter 的 `name`（**零网络**，纯文件系统）。
 * 候选 = `<代码>_*.md`（任意日期、任意月份），取 mtime 最新的非空名称（确定性）。
 */
async function lookupLocalHistoryName(dataRoot: string, code: string): Promise<string | null> {
  if (dataRoot === '') return null
  let base = ''
  let monthEntries: Dirent[] = []
  try {
    const probe = resolveArea(dataRoot, 'review', { code, name: '', date: '19700101' })
    base = dirname(probe.areaDirAbs) // DB/review 基目录（resolveArea 输出派生）
    monthEntries = await readdir(base, { withFileTypes: true })
  } catch {
    return null
  }
  const files: Array<{ path: string; mtimeMs: number }> = []
  for (const month of monthEntries) {
    if (!month.isDirectory()) continue
    const dir = join(base, month.name)
    const names = await readdir(dir).catch(() => [] as string[])
    for (const f of names) {
      if (!f.startsWith(`${code}_`) || !f.endsWith('.md')) continue
      const full = join(dir, f)
      try {
        files.push({ path: full, mtimeMs: (await stat(full)).mtimeMs })
      } catch { /* 竞态消失的候选跳过 */ }
    }
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs)
  for (const { path } of files) {
    try {
      const text = await readFile(path, 'utf8')
      const fmBlock = findFrontmatter(text)
      if (fmBlock === null) continue
      const values = parseFrontmatterValues(fmBlock.bodyLines)
      if (typeof values.name === 'string' && values.name !== '') return values.name
    } catch { /* 读取失败跳过该候选 */ }
  }
  return null
}

/** 名称三层兜底解析器（层序固定：① 本地历史 → ② 注入的网络反查 → ③ 仅代码）。 */
export function createNameResolver(deps: NameResolverDeps): NameResolver {
  return {
    async resolve(code: string): Promise<NameResult> {
      const normalized = normalizeCode(code)
      if (normalized === null) {
        throw new Error(`NameResolver: 非法标的编码 '${code}'——期望 6 位数字（经 normalizeCode 归一）`)
      }
      const suffix = marketSuffixForCode(normalized)
      // 层①：本地历史 frontmatter（零网络）。
      const local = await lookupLocalHistoryName(deps.dataRoot, normalized)
      if (local !== null) {
        return { value: local, source: 'frontmatter-history', confidence: 'high', marketSuffix: suffix }
      }
      // 层②：注入的 T2/S8 网络反查（未注入即不出网）。
      if (deps.lookupNameRemote !== undefined) {
        const remote = await deps.lookupNameRemote(normalized)
        if (remote !== null && remote !== '') {
          return { value: remote, source: 'T2-S8', confidence: 'high', marketSuffix: suffix }
        }
      }
      // 层③：仅代码。
      return { value: null, source: 'code-only', confidence: 'low', marketSuffix: suffix }
    },
  }
}

// ---------------------------------------------------------------------------
// 交易日归属 seam（契约 §1，design D-9）
// ---------------------------------------------------------------------------

export type TradeDateSource = 'T1-tradeDate' | 'TQ-HqDate' | 'user-confirm'

export interface TradeDateResult {
  /** `YYYY-MM-DD`；null = 不可得（默认留空 + 用户显式填入）。 */
  value: string | null
  source: TradeDateSource
  /** true = 业务日即限流日（可直接归属）；null = 无交易日历，归属待确认。 */
  isTradingDay: true | null
  /** 派生自 source 与是否与限流日一致。 */
  confidence: 'high' | 'low'
  /** D-TQ 选项 B（TQ HqDate 语义）预留。 */
  marketSuffix?: '.SH' | '.SZ' | '.BJ'
}

export interface TradeDateResolver {
  resolve(req?: { code?: string; date?: string }): Promise<TradeDateResult>
}

/**
 * change 2 T0 能力的形状（`traderKit.data.resolveTradeDate({ date? })`，
 * `iteration-1-contracts §1`）。本任务只消费该形状；实现由 change 2 提供。
 */
export type ResolveTradeDateFn = (input: { date?: string }) => Promise<{
  requestedDate: string
  businessDate: string | null
  isTradingDay: true | null
  source: string
  fetchedAt: string
  evidence: unknown
}>

/**
 * `TradeDateResolver` 默认包装器：MUST 调用注入的 change 2
 * `traderKit.data.resolveTradeDate`，MUST NOT 自行推断或系统日期 fallback。
 * `source` 映射：change 2 的 source 含 'TQ' → 'TQ-HqDate'，否则 'T1-tradeDate'；
 * `user-confirm` 由归属确认交互产生（页面层），本包装器不产生。
 */
export function createTradeDateResolver(resolveTradeDate: ResolveTradeDateFn): TradeDateResolver {
  return {
    async resolve(req?: { code?: string; date?: string }): Promise<TradeDateResult> {
      const upstream = await resolveTradeDate({ date: req?.date })
      const normalizedCode = req?.code !== undefined ? normalizeCode(req.code) : null
      return {
        value: upstream.businessDate,
        source: upstream.source.includes('TQ') ? 'TQ-HqDate' : 'T1-tradeDate',
        isTradingDay: upstream.isTradingDay === true ? true : null,
        confidence: upstream.isTradingDay === true && upstream.businessDate !== null ? 'high' : 'low',
        marketSuffix: normalizedCode !== null ? marketSuffixForCode(normalizedCode) : undefined,
      }
    },
  }
}

/**
 * D-TQ 选项 B 最小 stub（tasks 3.1b）：不接线、不调用 TQ；返回
 * `source: 'TQ-HqDate'` + 按代码推导的 `marketSuffix`，供契约测试断言
 * 「替换 seam 实现后调用方零改动」。**MUST NOT 出现在生产注册路径。**
 */
export function createTqStubTradeDateResolver(
  opts: { value?: string | null } = {},
): TradeDateResolver & { /** 标记，供结构断言识别 stub 未接线 */ readonly __tqStub: true } {
  const value = opts.value === undefined ? null : opts.value
  if (value !== null && !isValidIsoDate(value)) {
    throw new Error(`createTqStubTradeDateResolver: value 须为 YYYY-MM-DD 或 null，实际 '${value}'`)
  }
  return {
    __tqStub: true,
    async resolve(req?: { code?: string; date?: string }): Promise<TradeDateResult> {
      const normalized = req?.code !== undefined ? normalizeCode(req.code) : null
      return {
        value,
        source: 'TQ-HqDate',
        isTradingDay: null,
        confidence: 'low',
        marketSuffix: normalized !== null ? marketSuffixForCode(normalized) : undefined,
      }
    },
  }
}
