/**
 * 文档解析（change 4 tasks 1.2；契约 §2「解析与幂等规则」）。
 *
 * - **逐行扫描，只认 H2 标题行**（`^##\s`）——用户正文里出现的锚点字样
 *   MUST NOT 影响判定。
 * - **跳过 fenced code block**（``` / ~~~ 围栏）内的行——正文示例锚点不构成卡片。
 * - 分节边界只由「锚点 H2 行」（card/ainote）与文件末尾决定：中间的非锚点 H2
 *   行属于该卡片正文（D-16 显式取舍），MUST NOT 判为幽灵卡片。
 * - 幽灵锚点/重复锚点的**判定**在 store.ts（需 frontmatter 基准）——本模块只做
 *   结构解析，返回各分节的字节偏移（写入侧据此做字节级保真合并）。
 */
import { AINOTE_ANCHOR_RE, CARD_ANCHOR_RE } from '../anchor.ts'
import { findFrontmatter, type FrontmatterBlock, type FrontmatterEol } from './frontmatter.ts'

export { type FrontmatterBlock, type FrontmatterEol } from './frontmatter.ts'

export interface SourceLine {
  /** 行首偏移（BOM 剥离后的文本内）。 */
  start: number
  /** 行首 EOL 的偏移（无尾换行时 = 文本长度）。 */
  eolStart: number
  /** 行文本（不含 EOL）。 */
  text: string
}

/** 逐行切分（保留偏移；识别 EOL 风格——首个换行处有无 \r）。 */
export function splitLines(text: string): { lines: SourceLine[]; eol: FrontmatterEol } {
  const lines: SourceLine[] = []
  let pos = 0
  let eol: FrontmatterEol | null = null
  while (pos < text.length) {
    const nl = text.indexOf('\n', pos)
    const eolStart = nl === -1 ? text.length : nl
    lines.push({ start: pos, eolStart, text: text.slice(pos, eolStart).replace(/\r$/, '') })
    if (nl !== -1) {
      const hadCr = text[nl - 1] === '\r'
      if (eol === null) eol = hadCr ? '\r\n' : '\n'
      pos = nl + 1
    } else {
      pos = text.length
    }
  }
  return { lines, eol: eol ?? '\n' }
}

/** 锚点分节解析结果（card/ainote 共用形状；meta 按类提取）。 */
export interface ParsedSection {
  kind: 'card' | 'ainote'
  /** 完整锚点 id，如 `card-20260924-600000-1432-2`。 */
  anchor: string
  date: string
  code: string
  hhmm: string
  seq: number | null
  /** H2 标题行文本（`## ` 之后）。 */
  heading: string
  /** 锚点 H2 行首偏移。 */
  startOffset: number
  /** 分节结束偏移（下一锚点 H2 行首或文件末尾）。 */
  endOffset: number
  /** 分节所在的行号（0 起，含 frontmatter 行）。 */
  lineIndex: number
  /** 分节内全部行（含标题行；不含 EOL）。 */
  lines: SourceLine[]
}

/** 卡片分节解析视图（契约 §3 Card 的解析形状）。 */
export interface ParsedCard {
  anchor: string
  writtenAt: string
  body: string
  heading: string
  clientRequestId: string | undefined
  section: ParsedSection
}

/** 附注分节解析视图（契约 §3 AInote 的解析形状）。 */
export interface ParsedAinote {
  anchor: string
  body: string
  heading: string
  generatedAt: string | undefined
  meta: Record<string, string>
  section: ParsedSection
}

export interface DocumentParse {
  eol: FrontmatterEol
  bom: boolean
  frontmatter: FrontmatterBlock | null
  /** 全部锚点分节（card + ainote，文档顺序；含幽灵/重复——判定在 store.ts）。 */
  sections: ParsedSection[]
}

const CARD_MARKER = '^card-'
const AINOTE_MARKER = '^ainote-'

/** 从 H2 行提取锚点（标记符 `^card-`/`^ainote-` 之后至行尾须整体匹配唯一正则）。 */
function extractAnchor(lineText: string): { kind: 'card' | 'ainote'; anchor: string } | null {
  const cardIdx = lineText.indexOf(CARD_MARKER)
  const ainoteIdx = lineText.indexOf(AINOTE_MARKER)
  if (cardIdx !== -1 && (ainoteIdx === -1 || cardIdx < ainoteIdx)) {
    const token = lineText.slice(cardIdx + 1).trim()
    return CARD_ANCHOR_RE.test(token) ? { kind: 'card', anchor: token } : null
  }
  if (ainoteIdx !== -1) {
    const token = lineText.slice(ainoteIdx + 1).trim()
    return AINOTE_ANCHOR_RE.test(token) ? { kind: 'ainote', anchor: token } : null
  }
  return null
}

function anchorParts(anchor: string, kind: 'card' | 'ainote'): { date: string; code: string; hhmm: string; seq: number | null } {
  const re = kind === 'card' ? CARD_ANCHOR_RE : AINOTE_ANCHOR_RE
  const m = re.exec(anchor)
  if (m === null) throw new Error(`extractAnchor 产出了不匹配的锚点 '${anchor}'（内部不变量被破坏）`)
  return { date: m[1], code: m[2], hhmm: m[3], seq: m[4] === undefined ? null : Number(m[4]) }
}

function isFenceOpen(line: string): boolean {
  const t = line.trim()
  return t.startsWith('```') || t.startsWith('~~~')
}

function fenceMarker(line: string): '`' | '~' | null {
  const t = line.trim()
  if (t.startsWith('```')) return '`'
  if (t.startsWith('~~~')) return '~'
  return null
}

/**
 * 全文解析：frontmatter 定位 + 逐行扫描锚点分节。
 * `text` 为 **BOM 剥离后**的文本（BOM 探测由调用方或 parseDocumentText 完成）。
 */
export function parseDocument(text: string): DocumentParse {
  const frontmatter = findFrontmatter(text)
  const { lines, eol } = splitLines(text)
  const sections: ParsedSection[] = []

  let inFence: '`' | '~' | null = null
  let current: ParsedSection | null = null
  let lineIdx = 0
  for (const line of lines) {
    // frontmatter 块体不参与锚点扫描。
    if (frontmatter !== null && line.start >= frontmatter.start && line.start < frontmatter.end) {
      lineIdx++
      continue
    }
    const marker = fenceMarker(line.text)
    if (inFence !== null) {
      // 围栏内：同标记围栏行闭合。
      if (marker === inFence) inFence = null
      current?.lines.push(line)
      lineIdx++
      continue
    }
    if (marker !== null) {
      inFence = marker
      current?.lines.push(line)
      lineIdx++
      continue
    }
    if (/^##\s/.test(line.text)) {
      const found = extractAnchor(line.text)
      if (found !== null) {
        if (current !== null) current.endOffset = line.start
        const parts = anchorParts(found.anchor, found.kind)
        current = {
          kind: found.kind,
          anchor: found.anchor,
          ...parts,
          heading: line.text.replace(/^##\s+/, ''),
          startOffset: line.start,
          endOffset: text.length,
          lineIndex: lineIdx,
          lines: [line],
        }
        sections.push(current)
        lineIdx++
        continue
      }
    }
    current?.lines.push(line)
    lineIdx++
  }

  return { eol, bom: false, frontmatter, sections }
}

const CARD_META_RE = /^-\s+writtenAt:\s*(.*)$/
const CARD_REQUEST_RE = /^-\s+clientRequestId:\s*(.*)$/
const AINOTE_META_RE = /^-\s+([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/

/** 跳过正文起始的结构性空行（元信息块与正文之间的分隔空行不计入正文）。 */
function withoutLeadingBlanks(lines: string[]): string[] {
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  return lines.slice(i)
}

/** 卡片分节视图：`- writtenAt:` / `- clientRequestId:` 行取元信息（分节内任意位置），其余为正文。 */
export function toParsedCard(section: ParsedSection, eol: FrontmatterEol): ParsedCard {
  let writtenAt = ''
  let clientRequestId: string | undefined
  const bodyLines: string[] = []
  for (const line of section.lines.slice(1)) {
    const w = CARD_META_RE.exec(line.text)
    if (w !== null) {
      writtenAt = w[1].trim()
      continue
    }
    const r = CARD_REQUEST_RE.exec(line.text)
    if (r !== null) {
      clientRequestId = r[1].trim()
      continue
    }
    bodyLines.push(line.text)
  }
  return {
    anchor: section.anchor,
    writtenAt,
    body: withoutLeadingBlanks(bodyLines).join(eol),
    heading: section.heading,
    clientRequestId,
    section,
  }
}

/**
 * 附注分节视图：标题行后**连续**的 `- key: value` 行为元信息块（首个非元信息行
 * 即止，含空行），`generatedAt` 提升为具名字段、其余入 `meta`（含 `dataSources`）；
 * 之后全部为正文。附注正文中的列表行不会被误判为元信息。
 */
export function toParsedAinote(section: ParsedSection, eol: FrontmatterEol): ParsedAinote {
  const meta: Record<string, string> = {}
  let generatedAt: string | undefined
  const bodyLines: string[] = []
  let inMetaBlock = true
  for (const line of section.lines.slice(1)) {
    if (inMetaBlock) {
      const m = AINOTE_META_RE.exec(line.text)
      if (m !== null) {
        const key = m[1]
        const value = m[2].trim()
        if (key === 'generatedAt') generatedAt = value
        else meta[key] = value
        continue
      }
      inMetaBlock = false
    }
    bodyLines.push(line.text)
  }
  return {
    anchor: section.anchor,
    body: withoutLeadingBlanks(bodyLines).join(eol),
    heading: section.heading,
    generatedAt,
    meta,
    section,
  }
}
