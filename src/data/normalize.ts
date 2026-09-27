/**
 * 规范化单点实现（data-tool-contract「字段规范化与单位标注」/ design D-9）。
 *
 * 所有数据模块的字段转换只经本模块，MUST NOT 各处重写守卫逻辑：
 * - `toNumber`：空值守卫全表（`""` / `"--"` / `"None"` / null / undefined → null），
 *   含单位词的中文金额文本 → null（不参与计算，Open Questions 第 7 条）；
 * - `field`：逐字段信封 `{ value, source, fetchedAt }`（「来源标注」Requirement）；
 * - `ratioToPercent`：百分数比例换算（源小数 0.05 → 5）；
 * - 单位常量：万元 / 亿元 / 百分数——本 change 的 T1/T2 返回体无金额/市值字段，
 *   单位 Requirement **不验收**（design D-9 收口），常量仅供后继 change 消费。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */

/** 逐字段信封（来源标注 Requirement：MUST NOT 出现无来源的数值）。 */
export interface SourcedField<T> {
  value: T | null
  /** 提供该值的源（如 'S7' / 'S5' / 'S8'；缺失判定也标注是哪次取数）。 */
  source: string | null
  /** 本次取数时间（ISO8601 东八偏移；唯一拼装点 = src/review/format.ts，review-page 1.13）。 */
  fetchedAt: string | null
}

/** 构造逐字段信封；`value` 缺失时仍携带 source/fetchedAt（字段缺失口径）。 */
export function field<T>(value: T | null | undefined, source: string | null, fetchedAt: string | null): SourcedField<NonNullable<T>> {
  return { value: (value ?? null) as NonNullable<T> | null, source, fetchedAt }
}

const GUARDED_TEXTS = new Set(['', '--', '-', 'None', 'none', 'null', 'undefined', 'NaN'])

/**
 * 空值守卫 + 数值转换：
 * - `""` / `"--"` / `"None"` / null / undefined → null（MUST NOT 用 0 代替缺失值）；
 * - 含单位词（万/亿/%）的中文金额文本（如 `"1.6万亿"`）→ null，不参与计算；
 * - 纯数值串（允许千分位逗号）→ 数值；其余非数值文本 → null。
 */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const text = v.trim()
  if (GUARDED_TEXTS.has(text)) return null
  const cleaned = text.replace(/,/g, '')
  if (!/^[+-]?\d+(\.\d+)?$/.test(cleaned)) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * 百分数比例换算：源小数比例 `0.05` → 百分数数值 `5`（contracts「字段规范化」：
 * 比例类 = 百分数数值）。保留 4 位小数以消除浮点噪声（0.062 → 6.2）。
 */
export function ratioToPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0
  return Math.round(ratio * 100 * 10000) / 10000
}

/**
 * 单位常量（本 change 无金额/市值字段，仅建不验收；后继携带金额字段的 change
 * 按「金额类 = 万元、市值类 = 亿元、比例类 = 百分数数值」消费）。
 */
export const UNITS = {
  amount: '万元',
  marketCap: '亿元',
  percent: '%',
} as const

/** 文本净化（移植自脚本 `_clean` 符号口径）：折叠空白、去首尾；空 → null。 */
export function cleanText(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s === '' ? null : s
}

/** 取数时间戳：转发时间格式化唯一实现（review-page tasks 1.13 归属 src/review/format.ts；数据线不复拼装）。 */
export { formatZonedIso } from '../review/format.ts'
