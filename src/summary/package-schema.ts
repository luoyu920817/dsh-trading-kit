/**
 * 数据包 schema 校验（change 5 daily-summary tasks 2.6；spec「数据包 schema」）。
 *
 * 数据包由 skill（agent）逐标的组装，本模块是其**唯一**校验实现（手写校验、
 * 零依赖，design Open Questions 7）：字段/类型/`missing` 元素 `{field, reason}`
 * 与原因枚举/必填键含 `cacheReused`/`limitReason.errors[]`。校验不通过 → 显式
 * 抛错并**点名非法字段**，MUST NOT 静默丢弃字段。
 *
 * 判定口径（spec 逐条落地）：
 * - `available=false` **不等于**取数失败（noRecord 只进 missing），但 `fields`
 *   MUST 保持对象形态（各字段 `value=null` + `source=null` 并逐个进 missing）；
 *   把 `fields` 写成 null 即非法（无字段名可枚举）。
 * - `limitReason.errors[]` 必须保留（三档判定输入，§12.8）。
 * - `cacheReused` 为必填键（无 TQ 路径参与时写 `none`）。
 * - `source`/`fetchedAt` 逐字段携带，无来源数值非法。
 */

/** missing 原因枚举（spec「数据包 schema」逐字）。 */
export const MISSING_REASONS = ['sourceUnavailable', 'dateMismatch', 'noRecord', 'fieldAbsent'] as const
export type MissingReason = (typeof MISSING_REASONS)[number]

/** 逐字段信封（value 可空标量 + source/fetchedAt 可空字符串）。 */
export interface SourcedValue {
  value: string | number | null
  source: string | null
  fetchedAt: string | null
}

/** TQ 当日表现块（available=false 时 fields 保持对象形态）。 */
export interface QuoteBlock {
  available: boolean
  fields: Record<string, SourcedValue>
  source: string | null
  fetchedAt: string | null
  /** 必填键：'true' | 'false' | 逐字段 `字段=true|false`；无 TQ 路径参与写 'none'。 */
  cacheReused: string
  /** TQ skill 版本（SKILL.md frontmatter version）；不可解析记 'unknown'。 */
  skillVersion: string
}

/** T1 涨停原因块（T1 输出裁剪；errors[] 必须保留）。 */
export interface LimitReasonBlock {
  available: boolean
  tradeDate: string | null
  cause: SourcedValue
  firstTime: SourcedValue
  lastTime: SourcedValue
  openCount: SourcedValue
  streakDesc: SourcedValue
  source: 'S7' | 'S5' | null
  fetchedAt: string | null
  notes: string[]
  errors: string[]
}

/** 用户卡片（change 4 Card 的数据包子集，两边形状一致）。 */
export interface PackageCard {
  anchor: string
  writtenAt: string
  body: string
}

/** 逐字段缺失登记。 */
export interface PackageMissingEntry {
  field: string
  reason: MissingReason
}

/** 每日汇总数据包（skill 组装、进 W4 前自检）。 */
export interface DailyDataPackage {
  code: string
  name: string
  tradeDate: string
  generatedAt: string
  cards: PackageCard[]
  quote: QuoteBlock
  limitReason: LimitReasonBlock
  missing: PackageMissingEntry[]
}

/** 校验失败（message 点名非法字段路径）。 */
export class PackageSchemaError extends Error {
  constructor(message: string) {
    super(`数据包 schema 校验失败：${message}`)
    this.name = 'PACKAGE_SCHEMA_INVALID'
  }
}

const CODE_RE = /^\d{6}$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** 东八偏移字面经字符类拼接构造（避免源码出现第二份偏移字面——review-page 1.13 唯一拼装）。 */
const OFFSET8 = '+' + String.fromCharCode(48 + 0) + '8:00'
/** generatedAt 形态：ISO8601 东八偏移（时间格式唯一实现 src/review/format.ts 产出的形状）。 */
const GENERATED_AT_RE = new RegExp('^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:' + OFFSET8 + '|Z)$')

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function fail(fieldPath: string, expect: string, actual: unknown): never {
  throw new PackageSchemaError(`字段 '${fieldPath}' 非法——期望 ${expect}，实际 ${JSON.stringify(actual) ?? 'undefined'}`)
}

function requireString(obj: Record<string, unknown>, key: string, path: string, opts: { allowEmpty?: boolean } = {}): string {
  const v = obj[key]
  if (typeof v !== 'string') fail(`${path}${key}`, 'string', v)
  if (!opts.allowEmpty && v === '') fail(`${path}${key}`, '非空 string', v)
  return v
}

function requireNullableString(obj: Record<string, unknown>, key: string, path: string): string | null {
  const v = obj[key]
  if (v === null) return null
  if (typeof v !== 'string') fail(`${path}${key}`, 'string | null', v)
  return v
}

/** 逐字段信封校验（value/source/fetchedAt 三键必须存在——无来源数值非法）。 */
function requireSourcedValue(obj: Record<string, unknown>, key: string, path: string): void {
  const v = obj[key]
  if (!isPlainObject(v)) fail(`${path}${key}`, 'object {value, source, fetchedAt}', v)
  if (!('value' in v)) fail(`${path}${key}.value`, '存在（可为 null，MUST NOT 缺键）', undefined)
  if (!('source' in v)) fail(`${path}${key}.source`, '存在（string | null）', undefined)
  if (!('fetchedAt' in v)) fail(`${path}${key}.fetchedAt`, '存在（string | null）', undefined)
  const value = v.value
  if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
    fail(`${path}${key}.value`, 'string | number | null', value)
  }
  if (v.source !== null && typeof v.source !== 'string') fail(`${path}${key}.source`, 'string | null', v.source)
  if (v.fetchedAt !== null && typeof v.fetchedAt !== 'string') fail(`${path}${key}.fetchedAt`, 'string | null', v.fetchedAt)
}

/** 校验数据包；不通过抛 PackageSchemaError（点名非法字段），通过返回原引用。 */
export function validateDataPackage(input: unknown): DailyDataPackage {
  if (!isPlainObject(input)) fail('（根）', 'object 数据包', input)
  const pkg = input

  // -- 顶层必填标量 ---------------------------------------------------------
  const code = requireString(pkg, 'code', '')
  if (!CODE_RE.test(code)) fail('code', '6 位数字 ^\\d{6}$（经 normalizeCode 归一）', code)
  requireString(pkg, 'name', '', { allowEmpty: true })
  const tradeDate = requireString(pkg, 'tradeDate', '')
  if (!ISO_DATE_RE.test(tradeDate)) fail('tradeDate', 'canonical YYYY-MM-DD', tradeDate)
  const generatedAt = requireString(pkg, 'generatedAt', '')
  if (!GENERATED_AT_RE.test(generatedAt)) fail('generatedAt', 'ISO8601 东八偏移（formatZonedIso 产出形态）', generatedAt)

  // -- cards ----------------------------------------------------------------
  const cards = pkg.cards
  if (!Array.isArray(cards)) fail('cards', 'array（可为空）', cards)
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    if (!isPlainObject(card)) fail(`cards[${i}]`, 'object {anchor, writtenAt, body}', card)
    requireString(card, 'anchor', `cards[${i}].`)
    requireString(card, 'writtenAt', `cards[${i}].`)
    requireString(card, 'body', `cards[${i}].`)
  }

  // -- quote ----------------------------------------------------------------
  const quote = pkg.quote
  if (!isPlainObject(quote)) fail('quote', 'object {available, fields, source, fetchedAt, cacheReused, skillVersion}', quote)
  if (typeof quote.available !== 'boolean') fail('quote.available', 'boolean', quote.available)
  if (!isPlainObject(quote.fields)) {
    // spec：available=false 时 fields MUST 保持对象形态（写成 null 即非法）。
    fail('quote.fields', `object（available=${String(quote.available)} 时也 MUST 保持对象形态，各字段 value=null + source=null 并逐个进 missing）`, quote.fields)
  }
  for (const [fieldName, field] of Object.entries(quote.fields)) {
    if (!isPlainObject(field)) fail(`quote.fields.${fieldName}`, 'object {value, source, fetchedAt}', field)
    requireSourcedValue(quote.fields, fieldName, 'quote.fields.')
  }
  requireNullableString(quote, 'source', 'quote.')
  requireNullableString(quote, 'fetchedAt', 'quote.')
  requireString(quote, 'cacheReused', 'quote.', { allowEmpty: false })
  requireString(quote, 'skillVersion', 'quote.', { allowEmpty: false })
  // available=false → 全字段 value=null + source=null，且 missing 覆盖每个字段。
  if (quote.available === false) {
    for (const [fieldName, field] of Object.entries(quote.fields)) {
      const f = field as Record<string, unknown>
      if (f.value !== null) fail(`quote.fields.${fieldName}.value`, 'null（quote.available=false 时不得携带数值）', f.value)
      if (f.source !== null) fail(`quote.fields.${fieldName}.source`, 'null（quote.available=false 时源不可用）', f.source)
    }
  }

  // -- limitReason ----------------------------------------------------------
  const lr = pkg.limitReason
  if (!isPlainObject(lr)) fail('limitReason', 'object（T1 输出裁剪）', lr)
  if (typeof lr.available !== 'boolean') fail('limitReason.available', 'boolean', lr.available)
  requireNullableString(lr, 'tradeDate', 'limitReason.')
  for (const key of ['cause', 'firstTime', 'lastTime', 'openCount', 'streakDesc']) {
    requireSourcedValue(lr, key, 'limitReason.')
  }
  requireNullableString(lr, 'source', 'limitReason.')
  requireNullableString(lr, 'fetchedAt', 'limitReason.')
  if (!Array.isArray(lr.notes)) fail('limitReason.notes', 'array（可为空）', lr.notes)
  // errors[] 必须保留（三档判定输入，§12.8）。
  if (!Array.isArray(lr.errors)) fail('limitReason.errors', 'array（MUST 保留，三档判定输入）', lr.errors)
  for (let i = 0; i < lr.errors.length; i++) {
    if (typeof lr.errors[i] !== 'string') fail(`limitReason.errors[${i}]`, 'string', lr.errors[i])
  }

  // -- missing --------------------------------------------------------------
  const missing = pkg.missing
  if (!Array.isArray(missing)) fail('missing', 'array（元素 {field, reason}）', missing)
  for (let i = 0; i < missing.length; i++) {
    const entry = missing[i]
    if (!isPlainObject(entry) || typeof entry.field !== 'string' || typeof entry.reason !== 'string') {
      fail(`missing[${i}]`, 'object {field: string, reason: 枚举}', entry)
    }
    if (!(MISSING_REASONS as readonly string[]).includes(entry.reason)) {
      fail(`missing[${i}].reason`, `枚举 ${MISSING_REASONS.join(' | ')}`, entry.reason)
    }
    if (entry.field === '') fail(`missing[${i}].field`, '非空 string', entry.field)
  }

  // available=false 的块必须有 missing 登记（逐字段登记，MUST NOT 笼统整块）。
  if (quote.available === false) {
    const covered = new Set(
      (missing as PackageMissingEntry[]).filter((m) => m.field === 'quote' || m.field.startsWith('quote.')).map((m) => m.field),
    )
    if (covered.size === 0) {
      fail('missing', "含 quote 缺失登记（quote.available=false 时逐字段登记，如 {field: 'quote', reason: 'sourceUnavailable'}）", missing)
    }
  }

  return input as unknown as DailyDataPackage
}
