/**
 * 每日汇总测试公共件（零 mock：真实临时目录 + change 4 真实存储实现 +
 * 数据面真实对象桩——只记录调用，不打桩网络）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendAinote,
  appendCard,
  locateDoc,
  parseDoc,
  scanDailyCardTargets,
} from '../../src/review/store.ts'
import * as reviewFormat from '../../src/review/format.ts'
import type { TradeDateResult } from '../../src/data/trade-date.ts'
import type { GuardStatus } from '../../src/data/guard.ts'
import type { ReviewDailyFacades } from '../../src/tools/review-daily.ts'

export const TRADE_DATE = '2026-09-24'
export const TRADE_DATE_COMPACT = '20260924'
/** 固定时钟：2026-09-24T14:32:05+08:00。 */
export const NOW = new Date('2026-09-24T06:32:05Z')

export function makeTempRoot(prefix = 'dtk-summary-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** 用 change 4 真实实现预置一份当日文档（含一张用户卡片），返回路径。 */
export async function seedDoc(
  root: string,
  code: string,
  name: string,
  opts: { body?: string; tradeDate?: string; now?: Date } = {},
): Promise<string> {
  const r = await appendCard({
    loc: { dataRoot: root, code, name, tradeDate: opts.tradeDate ?? TRADE_DATE },
    body: opts.body ?? '早盘观察：量能一般',
    now: opts.now ?? NOW,
  })
  return r.path
}

/** 合法的 T0 结果桩（记录调用的真实对象桩，不出站）。 */
export function tradeDateStub(overrides: Partial<TradeDateResult> = {}): TradeDateResult {
  return {
    requestedDate: TRADE_DATE,
    businessDate: TRADE_DATE,
    isTradingDay: true,
    source: 'S7',
    fetchedAt: '2026-09-24T15:00:00+08:00',
    evidence: {
      rateLimitDate: TRADE_DATE,
      businessDateField: 'data.date',
      businessDateRaw: TRADE_DATE,
      businessDateValue: TRADE_DATE,
      rule: 'businessDate===rateLimitDate',
    },
    errors: [],
    notes: [],
    guard: null,
    ...overrides,
  }
}

/** 记录调用次数与入参的 T0 桩。 */
export function recordingTradeDateStub(result: TradeDateResult): {
  fn: (input?: { date?: string }) => Promise<TradeDateResult>
  calls: Array<Record<string, unknown>>
} {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    fn: async (input: { date?: string } = {}) => {
      calls.push({ ...input })
      return result
    },
  }
}

/** 合法的 guardStatus 桩（§9 字段齐备）。 */
export function guardStub(overrides: Partial<GuardStatus> = {}): GuardStatus {
  return {
    rateLimitDate: TRADE_DATE,
    budgetLimit: 200,
    budgetUsed: 0,
    remaining: 200,
    minIntervalMs: 1000,
    fullMarketGuard: false,
    sessionState: 'offSession',
    fetchedAt: '2026-09-24T15:00:00+08:00',
    sources: [],
    ...overrides,
  }
}

export interface FacadesOptions {
  /** T0 桩（缺省 = TRADE_DATE 已确认）。 */
  resolveTradeDate?: (input?: { date?: string }) => Promise<TradeDateResult>
  /** guardStatus 桩；传 null 表示出口缺失。 */
  guardStatus?: (() => GuardStatus) | null
  /** 数据根（缺省 = root）。 */
  dataRoot?: string
  /** 覆盖 review 面（依赖不可用注入用）。 */
  review?: Partial<ReviewDailyFacades['review']>
  /** 覆盖 format 面（依赖不可用注入用）。 */
  format?: Partial<ReviewDailyFacades['format']> | null
}

/** 真实对象桩 facades：change 4 存储走真实实现（绑定 root），数据面为记录型桩。 */
export function makeFacades(root: string, opts: FacadesOptions = {}): ReviewDailyFacades {
  // 依赖不可用注入：显式传 undefined（'resolveTradeDate' in opts）= 该出口缺失；
  // 缺省 = 接默认桩（与「未传」语义区分）。
  const hasT0 = Object.prototype.hasOwnProperty.call(opts, 'resolveTradeDate')
  return {
    review: {
      locateDoc,
      parseDoc,
      appendAinote,
      scanDailyCardTargets: (tradeDate: string) => scanDailyCardTargets(tradeDate, opts.dataRoot ?? root),
      ...opts.review,
    },
    data: {
      dataRoot: opts.dataRoot ?? root,
      ...(hasT0 ? { resolveTradeDate: opts.resolveTradeDate } : { resolveTradeDate: async () => tradeDateStub() }),
      ...(opts.guardStatus !== null ? { guardStatus: opts.guardStatus ?? (() => guardStub()) } : {}),
    },
    // format: null = 注入「导出缺失」面（DEPENDENCY_UNAVAILABLE 用例）；undefined = 默认全量。
    format: (opts.format === null
      ? {} as ReviewDailyFacades['format']
      : opts.format === undefined ? reviewFormat : { ...reviewFormat, ...opts.format }) as ReviewDailyFacades['format'],
  }
}

/** 附注 body 样板（六键元信息口径：missing/cacheReused 行由 agent 写入 body 开头）。 */
export function ainoteBody(overrides: { missing?: string; cacheReused?: string; extra?: string } = {}): string {
  return [
    `- missing: ${overrides.missing ?? 'none'}`,
    `- cacheReused: ${overrides.cacheReused ?? 'none'}`,
    '',
    '数据完整性：完整',
    '',
    '研究辅助、不构成投资建议',
    '',
    '① 事实：数据来自 TQ skill 与 T1（2026-09-24）。',
    '② 当日表现：收盘价来自 tq-local。',
    '③ 待跟踪：明日核对量能变化（不构成建议）。',
    ...(overrides.extra !== undefined ? [overrides.extra] : []),
  ].join('\n')
}

/** 递归清点临时根下全部文件（依赖不可用「磁盘零新增」断言用）。 */
export function countFiles(root: string): number {
  let count = 0
  const walk = (dir: string): void => {
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) count += 1
    }
    void statSync
  }
  walk(root)
  return count
}
