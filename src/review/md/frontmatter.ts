/**
 * frontmatter 读写（change 4 tasks 1.1/1.7；契约 §4「既有行文本不变」口径）。
 *
 * 设计约束（spec `review-card-store`「frontmatter 最小键 schema」「既有内容不变的
 * 精确口径」）：
 * - **值级最小文本修补**：既有行文本不变；仅允许 ① 对既有键改值、② 按固定格式
 *   追加缺失键；MUST NOT 重排既有行、MUST NOT 整体重序列化（键序/引号形态/
 *   缩进/注释与未知键一律不变）。
 * - frontmatter 值一律**双引号包裹**并转义 `"` 与换行（契约 §6）；`name` 为空
 *   写空字符串。
 * - 已知键：`code` / `name` / `tradeDate` / `subjective`（必填四键）+
 *   `patterns` / `drafts`（F2 预留键——既有值 MUST NOT 被清空；本迭代恒空数组）。
 */

export type FrontmatterEol = '\n' | '\r\n'

/** 必填四键（遗留文档缺失时按固定格式追加；既有值不同属写前归属校验，见 store.ts）。 */
export const FRONTMATTER_REQUIRED_KEYS = ['code', 'name', 'tradeDate', 'subjective'] as const

/** F2 预留键（仅创建时写入空数组；既有文档只保留、MUST NOT 重置）。 */
export const FRONTMATTER_RESERVED_KEYS = ['patterns', 'drafts'] as const

/** 值编码：双引号包裹 + 转义 `\` `"` 换行 回车 制表符（契约 §6）。 */
export function encodeFrontmatterValue(v: string): string {
  const escaped = v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  return `"${escaped}"`
}

/** 双引号标量反转义（逐字符；未识别转义原样保留）。 */
function unescapeDoubleQuoted(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && i + 1 < s.length) {
      const n = s[++i]
      if (n === 'n') out += '\n'
      else if (n === 'r') out += '\r'
      else if (n === 't') out += '\t'
      else if (n === '"') out += '"'
      else if (n === '\\') out += '\\'
      else out += `\\${n}`
    } else {
      out += c
    }
  }
  return out
}

/** 标量值解码：双引号/单引号包裹则剥壳反转义，否则原样。 */
export function decodeFrontmatterScalar(raw: string): string {
  const v = raw.trim()
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return unescapeDoubleQuoted(v.slice(1, -1))
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'")
  return v
}

/** 固定格式：标量一律双引号包裹；boolean 用字面量。 */
export function formatFrontmatterValue(value: string | boolean | readonly string[]): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return encodeFrontmatterValue(value)
  return `[${value.map((s) => encodeFrontmatterValue(s)).join(', ')}]`
}

/** 文档解析出的 frontmatter 值视图（已知键有类型；未知键为解码后的标量/原文）。 */
export type FrontmatterValues = Record<string, unknown>

/** flow 序列 → string[]（`patterns` 用；元素剥引号，空流 → 空数组）。 */
function parseStringFlow(raw: string): string[] {
  const v = raw.trim()
  if (v === '' || v === '[]') return []
  if (!(v.startsWith('[') && v.endsWith(']'))) return [decodeFrontmatterScalar(v)]
  const inner = v.slice(1, -1)
  if (inner.trim() === '') return []
  return inner.split(',').map((el) => decodeFrontmatterScalar(el))
}

/** flow 集合 → 未知结构值（`drafts` 用：JSON 可解析则解析，否则逐元素标量化）。 */
function parseUnknownFlow(raw: string): unknown {
  const v = raw.trim()
  if (v === '') return []
  if (v.startsWith('[') || v.startsWith('{')) {
    try {
      return JSON.parse(v) as unknown
    } catch {
      /* YAML flow 不必是合法 JSON——回落标量视图 */
    }
  }
  return decodeFrontmatterScalar(v)
}

/**
 * 逐行解析 frontmatter 块体（不含 `---` 分隔行）为值视图。
 * 已知键按 schema 折型（`subjective` → boolean、`patterns` → string[]、
 * `drafts` → unknown）；其余键解码为标量字符串。**只读，不改文本**。
 */
export function parseFrontmatterValues(lines: readonly string[]): FrontmatterValues {
  const values: FrontmatterValues = {}
  for (const line of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(.*)$/.exec(line)
    if (m === null) continue
    const key = m[1]
    const raw = m[2].trim()
    if (key === 'subjective') {
      values[key] = raw === 'true' ? true : raw === 'false' ? false : raw
    } else if (key === 'patterns') {
      values[key] = parseStringFlow(raw)
    } else if (key === 'drafts') {
      values[key] = parseUnknownFlow(raw)
    } else {
      values[key] = decodeFrontmatterScalar(raw)
    }
  }
  return values
}

/**
 * 最小键 schema 校验（spec「frontmatter 最小键 schema」表格逐条落地）。
 * 返回 issue 清单（空 = 合法）。**校验不改写文档**；store 写入路径对
 * 「缺失键 → 追加」「既有键 ≠ 入参 → DOC_MISMATCH」另有处置。
 */
export interface FrontmatterSchemaIssue {
  key: string
  message: string
}

export function validateFrontmatterSchema(values: FrontmatterValues): FrontmatterSchemaIssue[] {
  const issues: FrontmatterSchemaIssue[] = []
  const code = values.code
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    issues.push({ key: 'code', message: `期望 6 位数字字符串，实际 ${JSON.stringify(code)}` })
  }
  if (typeof values.name !== 'string') {
    issues.push({ key: 'name', message: `期望字符串（可为空串），实际 ${JSON.stringify(values.name)}` })
  }
  const tradeDate = values.tradeDate
  if (typeof tradeDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
    issues.push({ key: 'tradeDate', message: `期望 YYYY-MM-DD，实际 ${JSON.stringify(tradeDate)}` })
  }
  if (values.subjective !== true) {
    issues.push({ key: 'subjective', message: `恒为 true，实际 ${JSON.stringify(values.subjective)}` })
  }
  const patterns = values.patterns
  if (patterns !== undefined && !Array.isArray(patterns)) {
    issues.push({ key: 'patterns', message: '期望字符串数组' })
  } else if (Array.isArray(patterns) && patterns.some((el) => typeof el !== 'string' || el === '')) {
    issues.push({ key: 'patterns', message: '元素须为非空模式 id 字符串（MUST NOT 为对象或空串）' })
  }
  const drafts = values.drafts
  if (drafts !== undefined && !Array.isArray(drafts)) {
    issues.push({ key: 'drafts', message: '期望数组（元素结构未定，保留原样）' })
  }
  return issues
}

/**
 * 值级最小修补：对既有键**改值**（保留键名与冒号后原始空白），缺失键按固定
 * 格式**追加**到既有行之后（分隔行之前）。MUST NOT 重排/重序列化——未涉及的
 * 行逐字节原样（含未知键、注释、空行与引号形态）。
 *
 * @param blockText 含首尾 `---` 分隔行的完整块文本
 * @param entries 期望键值（只处理列出的键；不做的键保持原样）
 */
export interface FrontmatterPatchResult {
  text: string
  appendedKeys: string[]
  patchedKeys: string[]
}

export function ensureFrontmatterKeys(
  blockText: string,
  entries: ReadonlyArray<{ key: string; value: string | boolean | readonly string[] }>,
  eol: FrontmatterEol,
): FrontmatterPatchResult {
  const lines = blockText.split(eol === '\r\n' ? /\r\n/ : /\n/)
  // 分隔行定位：首行 `---`、末行 `---`（findFrontmatter 保证结构）。
  const first = lines[0] ?? ''
  const lastIdx = lines.length - 1
  const closing = lines[lastIdx] ?? ''
  if (!/^---\s*$/.test(first) || !/^(---|\.\.\.)\s*$/.test(closing)) {
    throw new Error(`ensureFrontmatterKeys: 输入不是完整的 frontmatter 块（首行 '${first}' / 末行 '${closing}'）`)
  }
  const body = lines.slice(1, lastIdx)
  const appendedKeys: string[] = []
  const patchedKeys: string[] = []

  for (const entry of entries) {
    const desired = formatFrontmatterValue(entry.value)
    const keyRe = new RegExp(`^${entry.key}\\s*:`)
    const idx = body.findIndex((l) => keyRe.test(l))
    if (idx === -1) {
      body.push(`${entry.key}: ${desired}`)
      appendedKeys.push(entry.key)
      continue
    }
    const line = body[idx]
    const colon = line.indexOf(':')
    const rawValue = line.slice(colon + 1).trim()
    const current = typeof entry.value === 'string' ? decodeFrontmatterScalar(rawValue) : rawValue
    if (current === (typeof entry.value === 'boolean' ? desired : entry.value)) continue
    // 改值：保留键名 + 冒号 + 冒号后的原始空白，仅替换值本身。
    const afterColon = line.slice(colon + 1)
    const leadingWs = /^\s*/.exec(afterColon)?.[0] ?? ''
    body[idx] = `${line.slice(0, colon + 1)}${leadingWs}${desired}`
    patchedKeys.push(entry.key)
  }

  const text = [first, ...body, closing].join(eol)
  return { text, appendedKeys, patchedKeys }
}

/** 新建文档的 frontmatter 块（固定键序 = schema 表序；值双引号包裹）。 */
export function buildFrontmatterBlock(
  fields: {
    code: string
    name: string
    tradeDate: string
    subjective?: boolean
    patterns?: readonly string[]
    drafts?: readonly string[]
  },
  eol: FrontmatterEol,
): string {
  const lines = [
    '---',
    `code: ${encodeFrontmatterValue(fields.code)}`,
    `name: ${encodeFrontmatterValue(fields.name)}`,
    `tradeDate: ${encodeFrontmatterValue(fields.tradeDate)}`,
    `subjective: ${fields.subjective === false ? 'false' : 'true'}`,
    `patterns: [${(fields.patterns ?? []).map((s) => encodeFrontmatterValue(s)).join(', ')}]`,
    `drafts: [${(fields.drafts ?? []).map((s) => encodeFrontmatterValue(s)).join(', ')}]`,
    '---',
  ]
  return lines.join(eol)
}

/**
 * frontmatter 块定位：文档（BOM 剥离后）以 `---` 行开头，至闭合 `---`/`...`
 * 行。无块返回 null。`end` 为闭合行（含其 EOL）之后的偏移。
 */
export interface FrontmatterBlock {
  start: number
  end: number
  /** 块体行（不含分隔行，不含 EOL）。 */
  bodyLines: string[]
  eol: FrontmatterEol
}

export function findFrontmatter(text: string): FrontmatterBlock | null {
  if (!text.startsWith('---')) return null
  // 首行必须恰为 ---（允许 \r 结尾由 eol 归一处理）。
  const nl = text.indexOf('\n')
  const firstLine = (nl === -1 ? text : text.slice(0, nl)).replace(/\r$/, '')
  if (firstLine !== '---') return null
  const eol: FrontmatterEol = nl > 0 && text[nl - 1] === '\r' ? '\r\n' : '\n'
  let pos = nl + 1
  const bodyLines: string[] = []
  while (pos <= text.length) {
    const nextNl = text.indexOf('\n', pos)
    const lineEnd = nextNl === -1 ? text.length : nextNl
    const line = text.slice(pos, lineEnd).replace(/\r$/, '')
    if (/^(---|\.\.\.)\s*$/.test(line)) {
      const end = nextNl === -1 ? text.length : nextNl + 1
      return { start: 0, end, bodyLines, eol }
    }
    bodyLines.push(line)
    if (nextNl === -1) break
    pos = nextNl + 1
  }
  return null // 无闭合分隔行 → 不视作 frontmatter 块
}
