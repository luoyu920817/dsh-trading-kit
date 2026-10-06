/**
 * 复盘卡片存储（change 4 tasks 1.4/1.12；契约 §3/§4/§5）。
 *
 * 五个导出即契约（change 5 复用，MUST NOT 另写追加逻辑）：
 * `locateDoc` / `parseDoc` / `appendCard` / `appendAinote` / `scanDailyCardTargets`，
 * **一律**返回 `warnings: string[]`（空告警为 `[]`，MUST NOT 缺字段）。
 * 另有显式修订/删除扩展（owner 2026-10-05 追授）：`updateCard` / `deleteCard`，
 * 纪律与追加同款（见「卡片显式修订与删除」Requirement）。
 *
 * 写入纪律（契约 §4/§5）：
 * - 文档定位经 `src/paths/resolve.ts` 的 `resolveArea`（调用方 MUST NOT 自行拼接）；
 *   扫描月目录匹配 `<代码>_*_<YYYYMMDD>.md`，多命中按 mtime 最新、平局文件名
 *   字典序确定性取一并显式告警。
 * - 进程内互斥：`Map` 串行链，键 = 月目录 + code + 日期的**规范键**（与「按绝对
 *   路径互斥」等价且更强：创建路径含名称段，直接用 absPath 做键会漏掉
 *   「两个不同名称段并发首次创建」的竞态）。
 * - 写前 `stat`（mtimeMs + size）与读取快照比对，不一致 → 重读重试；重试上限
 *   3 次、退避 50/200/800 ms（可注入）；`EBUSY`/`EPERM`/`EACCES` 视为可重试；
 *   单次写入（临时文件写 + 改名）总超时 5 s；冲突不可解 → 显式
 *   `CONCURRENT_WRITE`（含路径与处置建议）。
 * - 原子写：同目录临时文件 + `rename` 覆盖，失败清理临时文件，不留半截文档。
 * - 卡片插入 = 首个 `^ainote-` 分节之前（卡片区尾部）；附注始终追加到文档
 *   末尾；既有字节按契约 §4 口径保真。
 * - 写前归属硬校验：目标文档 frontmatter 的 `tradeDate` + `code` 与入参 `loc`
 *   不一致 → 抛 `DOC_MISMATCH`（含两侧值），MUST NOT 追加、MUST NOT 改用其它文档。
 */
import { readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { isValidIsoDate, toCompactDate } from '../data/date.ts'
import { ensureDir } from '../paths/fs.ts'
import { resolveArea } from '../paths/resolve.ts'
import { NAME_SEGMENT_MAX, sanitizeNameSegment } from '../paths/sanitize.ts'
import { buildAnchor, CARD_ANCHOR_RE, normalizeCode } from './anchor.ts'
import { anchorTimeToHeading, formatAnchorTime, formatZonedIso } from './format.ts'
import { encodeStoreWarning, type AInote, type Card, type StoreWarning } from './types.ts'
import {
  buildFrontmatterBlock,
  ensureFrontmatterKeys,
  parseFrontmatterValues,
  type FrontmatterValues,
} from './md/frontmatter.ts'
import {
  CARD_META_RE,
  CARD_REQUEST_RE,
  parseDocument,
  toParsedAinote,
  toParsedCard,
  type DocumentParse,
  type ParsedSection,
} from './md/parse.ts'

/** 契约 §3：文档定位入参（tradeDate 为 canonical `YYYY-MM-DD`）。 */
export type Loc = { dataRoot: string; code: string; name?: string; tradeDate: string }
/** 契约 §3：五个导出一律返回 warnings: string[]。 */
export type Result<T> = T & { warnings: string[] }

export { type AInote, type Card } from './types.ts'

// ---------------------------------------------------------------------------
// 错误
// ---------------------------------------------------------------------------

/** 写前归属硬校验失败（错误体含两侧 code/tradeDate；不返回结果体、不走 warnings）。 */
export class DocMismatchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DOC_MISMATCH'
  }
}

/** 并发冲突不可解（重试耗尽；含路径与处置建议，MUST NOT 静默覆盖）。 */
export class ConcurrentWriteError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CONCURRENT_WRITE'
  }
}

/** 修订/删除的显式失败（锚点不存在 / 文档缺失 / 幽灵锚点；零字节变化，MUST NOT 新建文档）。 */
export class AnchorNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ANCHOR_NOT_FOUND'
  }
}

/** 单次写入步超时（临时文件写 / 改名；按可重试处理）。 */
class WriteTimeoutError extends Error {}

// ---------------------------------------------------------------------------
// 测试钩子（生产 MUST NOT 调用；契约签名不受影响）
// ---------------------------------------------------------------------------

export interface StoreWriteHooks {
  /** 重试退避（默认 50/200/800 ms；测试注入 [0,0,0]）。 */
  retryDelaysMs?: readonly number[]
  /** 写入尝试循环的注入点：重试尝试的重读前 / 快照后复核前 / 复核后原子写前。 */
  onPhase?: (
    phase: 'before-read' | 'before-verify' | 'before-write',
    absPath: string,
    attempt: number,
  ) => void | Promise<void>
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [50, 200, 800]
const MAX_RETRIES = 3
const WRITE_TIMEOUT_MS = 5_000
/** 可重试文件系统错误（契约 §5；EISDIR 为「改名覆盖到目录类目标」时的补充观测）。 */
const RETRYABLE_FS_CODES = new Set(['EBUSY', 'EPERM', 'EACCES', 'EISDIR'])

let activeHooks: StoreWriteHooks = {}

/** 注入测试钩子（零 mock 纪律下的真实文件系统注入点；生产代码 MUST NOT 调用）。 */
export function setStoreWriteHooksForTest(hooks: StoreWriteHooks | undefined): void {
  activeHooks = hooks ?? {}
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new WriteTimeoutError(`${label} 超时（${ms} ms）`)), ms)
    p.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e: unknown) => { clearTimeout(timer); reject(e instanceof Error ? e : new Error(String(e))) },
    )
  })
}

function isRetryableFsError(e: unknown): boolean {
  if (e instanceof WriteTimeoutError) return true
  const code = (e as NodeJS.ErrnoException | null)?.code
  return typeof code === 'string' && RETRYABLE_FS_CODES.has(code)
}

// ---------------------------------------------------------------------------
// 进程内互斥（契约 §5①）
// ---------------------------------------------------------------------------

const fileLocks = new Map<string, Promise<unknown>>()

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const sentinel = run.then(
    () => undefined,
    () => undefined,
  )
  fileLocks.set(key, sentinel)
  // 串行链释放（sentinel 永不 reject，无可泄漏的 unhandled rejection）。
  void sentinel.then(() => {
    if (fileLocks.get(key) === sentinel) fileLocks.delete(key)
  })
  return run
}

// ---------------------------------------------------------------------------
// 定位与扫描
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

interface NormalizedLoc {
  code: string
  compact: string
  /** 经净化、兜底后的名称段（与文件名一致；空名回落代码段）。 */
  nameSegment: string
  /** 净化实现上报的截断事实（透传 warnings；change 2 唯一实现产生）。 */
  nameTruncated: boolean
}

function normalizeLoc(loc: Loc): NormalizedLoc {
  const code = normalizeCode(loc.code)
  if (code === null) {
    throw new Error(`非法标的编码 '${loc.code}'——期望 6 位数字（经 normalizeCode 归一：只去壳、不补全、不猜测）`)
  }
  const compact = toCompactDate(loc.tradeDate)
  const sanitized = sanitizeNameSegment(loc.name ?? '', code)
  return { code, compact, nameSegment: sanitized.value, nameTruncated: sanitized.nameTruncated }
}

interface DocCandidate {
  path: string
  fileName: string
  mtimeMs: number
}

/** 扫描月目录：`<代码>_*_<YYYYMMDD>.md`（目录不存在 → 空数组）。 */
async function scanCandidates(areaDirAbs: string, code: string, compact: string): Promise<DocCandidate[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(areaDirAbs, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return []
    throw e
  }
  const re = new RegExp(`^${escapeRe(code)}_.+_${escapeRe(compact)}\\.md$`)
  const out: DocCandidate[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !re.test(entry.name)) continue
    const full = join(areaDirAbs, entry.name)
    const st = await stat(full)
    out.push({ path: full, fileName: entry.name, mtimeMs: st.mtimeMs })
  }
  return out
}

/** 多命中确定性选择：mtime 最新；平局按文件名字典序（code unit 序）。 */
function selectCandidate(candidates: DocCandidate[]): DocCandidate {
  return [...candidates].sort((a, b) => {
    if (a.mtimeMs !== b.mtimeMs) return b.mtimeMs - a.mtimeMs
    return a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0
  })[0]
}

function multiHitWarning(selected: DocCandidate, all: DocCandidate[]): StoreWarning {
  const others = all.filter((c) => c.path !== selected.path).map((c) => c.path)
  return {
    kind: 'multiHit',
    path: selected.path,
    detail: `同 (code, tradeDate) 命中 ${all.length} 份文档，已确定性选一（mtime 最新，平局文件名字典序），其余未改动`,
    candidates: others,
  }
}

/**
 * 定位文档（契约 §3 `locateDoc`）：存在则返回被选中的既有文档路径（多命中
 * 显式告警）；不存在则返回按当前名称段解析的创建路径（`nameTruncated` 透传）。
 * 本函数不做任何写操作。
 */
export async function locateDoc(loc: Loc): Promise<Result<{ path: string }>> {
  const { code, compact } = normalizeLoc(loc)
  const resolved = resolveArea(loc.dataRoot, 'review', { code, name: loc.name ?? '', date: compact })
  const warnings: string[] = []
  const candidates = await scanCandidates(resolved.areaDirAbs, code, compact)
  if (candidates.length > 0) {
    const selected = selectCandidate(candidates)
    if (candidates.length > 1) warnings.push(encodeStoreWarning(multiHitWarning(selected, candidates)))
    return { path: selected.path, warnings }
  }
  if (resolved.nameTruncated) {
    warnings.push(encodeStoreWarning({
      kind: 'nameTruncated',
      path: resolved.absPath,
      detail: `文件名名称段超过 ${NAME_SEGMENT_MAX} 字符，已由净化实现截断`,
    }))
  }
  return { path: resolved.absPath, warnings }
}

// ---------------------------------------------------------------------------
// 解析（parseDoc）
// ---------------------------------------------------------------------------

/** 解析文档（契约 §3 `parseDoc`）：frontmatter + 有效卡片 + 附注 + EOL/BOM + 告警。 */
export async function parseDoc(path: string): Promise<{
  frontmatter: Record<string, unknown>
  cards: Card[]
  ainotes: AInote[]
  eol: '\n' | '\r\n'
  bom: boolean
  warnings: string[]
}> {
  let buf: Buffer
  try {
    buf = await readFile(path)
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e)
    throw new Error(`parseDoc: 文档不可读: ${path}（${reason}）`, { cause: e })
  }
  return parseDocumentBuffer(path, buf)
}

function parseDocumentBuffer(path: string, buf: Buffer): {
  frontmatter: Record<string, unknown>
  cards: Card[]
  ainotes: AInote[]
  eol: '\n' | '\r\n'
  bom: boolean
  warnings: string[]
} {
  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
  const text = bom ? buf.toString('utf8').slice(1) : buf.toString('utf8')
  const parse = parseDocument(text)
  const warnings: string[] = []
  const fm = parse.frontmatter === null ? {} : parseFrontmatterValues(parse.frontmatter.bodyLines)
  const { cards, ainotes } = collectSections(parse, path, fm, warnings)
  return { frontmatter: fm, cards, ainotes, eol: parse.eol, bom, warnings }
}

/** 幽灵锚点告警（归属不一致/基准缺失，含行信息，不计入卡片）。 */
function pushGhostWarning(
  warnings: string[],
  path: string,
  section: ParsedSection,
  baselineDesc: string,
): void {
  warnings.push(encodeStoreWarning({
    kind: 'ghostAnchor',
    path,
    detail: `锚点 ${section.anchor}（第 ${section.lineIndex + 1} 行）与 frontmatter 基准（${baselineDesc}）不一致，不计入卡片`,
  }))
}

/** 幽灵/重复锚点判定：锚点段 == frontmatter 基准才计入；同锚点重复保留首次。 */
function collectSections(
  parse: DocumentParse,
  path: string,
  fm: FrontmatterValues,
  warnings: string[],
): { cards: Card[]; ainotes: AInote[] } {
  const fmCode = typeof fm.code === 'string' ? fm.code : null
  const fmTrade = typeof fm.tradeDate === 'string' ? fm.tradeDate : null
  const baseline = fmTrade !== null && isValidIsoDate(fmTrade) ? toCompactDate(fmTrade) : null
  const baselineDesc = `code=${fmCode ?? '缺失'}, tradeDate=${fmTrade ?? '缺失'}`
  const cards: Card[] = []
  const ainotes: AInote[] = []
  const seen = new Set<string>()

  for (const section of parse.sections) {
    if (fmCode === null || baseline === null || section.code !== fmCode || section.date !== baseline) {
      pushGhostWarning(warnings, path, section, baselineDesc)
      continue
    }
    if (seen.has(section.anchor)) {
      warnings.push(encodeStoreWarning({
        kind: 'duplicateAnchor',
        path,
        detail: `锚点 ${section.anchor}（第 ${section.lineIndex + 1} 行）重复，按首次出现保留、其余去重`,
      }))
      continue
    }
    seen.add(section.anchor)
    if (section.kind === 'card') {
      const card = toParsedCard(section, parse.eol)
      cards.push({
        anchor: card.anchor,
        writtenAt: card.writtenAt,
        body: card.body,
        heading: card.heading,
        clientRequestId: card.clientRequestId,
      })
    } else {
      const note = toParsedAinote(section, parse.eol)
      ainotes.push({
        anchor: note.anchor,
        body: note.body,
        generatedAt: note.generatedAt,
        tradeDate: fmTrade ?? undefined,
        code: section.code,
        meta: Object.keys(note.meta).length > 0 ? note.meta : undefined,
      })
    }
  }
  return { cards, ainotes }
}

// ---------------------------------------------------------------------------
// 写入（appendCard / appendAinote）
// ---------------------------------------------------------------------------

interface AppendOutcome {
  status: 'created' | 'duplicate' | 'skipped'
  anchor: string
  path: string
  warnings: string[]
}

type StatSnapshot = { mtimeMs: number; size: number }

function sameStat(a: StatSnapshot | null, b: StatSnapshot | null): boolean {
  if (a === null || b === null) return a === b
  return a.mtimeMs === b.mtimeMs && a.size === b.size
}

async function statSafe(path: string): Promise<StatSnapshot | null> {
  try {
    const st = await stat(path)
    return { mtimeMs: st.mtimeMs, size: st.size }
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw e
  }
}

/** 原子写：同目录临时文件 + rename 覆盖 + 失败清理（单步 5 s 超时）。 */
async function atomicWrite(absPath: string, content: string): Promise<void> {
  const dir = dirname(absPath)
  await ensureDir(dir)
  const tmp = join(dir, `.${basename(absPath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`)
  try {
    await withTimeout(writeFile(tmp, content, 'utf8'), WRITE_TIMEOUT_MS, `临时文件写入 ${tmp}`)
    await withTimeout(rename(tmp, absPath), WRITE_TIMEOUT_MS, `改名覆盖 ${absPath}`)
  } catch (e) {
    await unlink(tmp).catch(() => { /* 清理失败不掩盖原错误 */ })
    throw e
  }
}

function buildCardSectionText(params: {
  headingTime: string
  anchor: string
  writtenAt: string
  clientRequestId: string | undefined
  body: string
  eol: '\n' | '\r\n'
}): string {
  const lines = [`## ${params.headingTime} ^${params.anchor}`, `- writtenAt: ${params.writtenAt}`]
  if (params.clientRequestId !== undefined) lines.push(`- clientRequestId: ${params.clientRequestId}`)
  const bodyLines = params.body.trim().replace(/\r\n/g, '\n').split('\n')
  if (bodyLines.length > 0 && bodyLines[0] !== '') lines.push('', ...bodyLines)
  return `${lines.join(params.eol)}${params.eol}`
}

function buildAinoteSectionText(params: {
  headingTime: string
  anchor: string
  generatedAt: string
  dataSources: string[]
  body: string
  eol: '\n' | '\r\n'
}): string {
  const lines = [`## ${params.headingTime} ^${params.anchor}`, `- generatedAt: ${params.generatedAt}`]
  if (params.dataSources.length > 0) lines.push(`- dataSources: ${params.dataSources.join(', ')}`)
  const bodyLines = params.body.trim().replace(/\r\n/g, '\n').split('\n')
  if (bodyLines.length > 0 && bodyLines[0] !== '') lines.push('', ...bodyLines)
  return `${lines.join(params.eol)}${params.eol}`
}

/**
 * 分节组装进文档文本：插入点 = 首个附注分节行首（卡片）或文件末尾（附注）。
 * 无尾换行时先补一个本文件 EOL 分隔符（不计入既有内容）；插入点在行首时既有
 * 字节（前后缀）原样保留。
 */
function assembleInsert(text: string, insertOffset: number, sectionText: string, eol: '\n' | '\r\n'): string {
  const prefix = text.slice(0, insertOffset)
  const suffix = text.slice(insertOffset)
  let section = sectionText
  if (insertOffset >= text.length && text.length > 0 && !text.endsWith('\n')) {
    section = eol + section
  }
  return prefix + section + suffix
}

/** 同分钟锚点序号：同一 (date, code, hhmm) 前缀下既有最大 seq + 1（首卡无序号段）。 */
function nextAnchorSeq(
  sections: readonly ParsedSection[],
  kind: 'card' | 'ainote',
  compact: string,
  code: string,
  hhmm: string,
): number | null {
  let max = 0
  for (const s of sections) {
    if (s.kind !== kind || s.date !== compact || s.code !== code || s.hhmm !== hhmm) continue
    max = Math.max(max, s.seq ?? 1)
  }
  return max === 0 ? null : max + 1
}

interface AppendInput {
  loc: Loc
  kind: 'card' | 'ainote'
  body: string
  now: Date
  clientRequestId?: string
  generatedAt?: string
  dataSources?: string[]
}

/**
 * frontmatter 值级最小修补（既有文档）：缺失必填键按固定格式追加、`name` 拿到
 * 新的非空名称时改值。返回 null = 无需修补。`code`/`tradeDate` 既有值不同属
 * assertOwnership 的抛错路径，不在此处置。
 */
function patchFrontmatterBlock(
  parse: DocumentParse,
  text: string,
  fm: FrontmatterValues,
  params: { code: string; compact: string; requestedName: string; eol: '\n' | '\r\n' },
): string | null {
  if (parse.frontmatter === null) return null
  const blockRaw = text.slice(parse.frontmatter.start, parse.frontmatter.end)
  let blockCore = blockRaw
  let blockTail = ''
  if (blockCore.endsWith('\r\n')) { blockCore = blockCore.slice(0, -2); blockTail = '\r\n' }
  else if (blockCore.endsWith('\n')) { blockCore = blockCore.slice(0, -1); blockTail = '\n' }

  const entries: Array<{ key: string; value: string | boolean }> = []
  if (!('code' in fm)) entries.push({ key: 'code', value: params.code })
  if (!('tradeDate' in fm)) {
    entries.push({ key: 'tradeDate', value: `${params.compact.slice(0, 4)}-${params.compact.slice(4, 6)}-${params.compact.slice(6, 8)}` })
  }
  if (!('name' in fm)) entries.push({ key: 'name', value: params.requestedName })
  if (!('subjective' in fm)) entries.push({ key: 'subjective', value: true })
  if ('name' in fm && params.requestedName !== '' && fm.name !== params.requestedName) {
    entries.push({ key: 'name', value: params.requestedName })
  }
  if (entries.length === 0) return null
  const patched = ensureFrontmatterKeys(blockCore, entries, params.eol)
  return patched.text + blockTail
}

/** 写前归属硬校验（契约 §3；不一致抛 DOC_MISMATCH，含两侧 code/tradeDate）。 */
function assertOwnership(
  fm: FrontmatterValues,
  code: string,
  loc: Loc,
  targetPath: string,
  hasDocument: boolean,
): void {
  if (!hasDocument) return // 新建文档：frontmatter 由本流程按 loc 生成，天然一致
  const fmCode = fm.code
  const fmTrade = fm.tradeDate
  const codeMismatch = typeof fmCode === 'string' && fmCode !== code
  const tradeMismatch = typeof fmTrade === 'string' && fmTrade !== loc.tradeDate
  if (codeMismatch || tradeMismatch) {
    throw new DocMismatchError(
      `DOC_MISMATCH: ${targetPath} — 目标文档 frontmatter (code=${JSON.stringify(fmCode)}, tradeDate=${JSON.stringify(fmTrade)}) `
      + `与写入目标 loc (code=${JSON.stringify(code)}, tradeDate=${JSON.stringify(loc.tradeDate)}) 不一致。`
      + ' MUST NOT 追加、MUST NOT 静默改用其它文档；请核对归属后使用正确的 loc。',
    )
  }
}

/** 追加主流程：定位 → 互斥 → re-read + stat 校验重试 → 最小修补 → 原子写。 */
async function appendIntoDailyDoc(input: AppendInput): Promise<AppendOutcome> {
  const { code, compact, nameSegment, nameTruncated } = normalizeLoc(input.loc)
  const resolved = resolveArea(input.loc.dataRoot, 'review', { code, name: input.loc.name ?? '', date: compact }, { forWrite: true })
  const absPath = resolved.absPath
  const hooks = activeHooks
  const retryDelays = hooks.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const staticWarnings: string[] = []
  if (nameTruncated) {
    staticWarnings.push(encodeStoreWarning({
      kind: 'nameTruncated',
      path: absPath,
      detail: `文件名名称段超过 ${NAME_SEGMENT_MAX} 字符，已由净化实现截断`,
    }))
  }

  // 互斥键：月目录 + code + 日期（与「按绝对路径互斥」等价且更强，见模块头）。
  const lockKey = `${resolved.areaDirAbs}::${code}_${compact}`
  return withLock(lockKey, async () => {
    let lastFailure: { kind: 'mismatch' } | { kind: 'fs'; message: string } | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(retryDelays[Math.min(attempt - 1, retryDelays.length - 1)] ?? 0)
        await hooks.onPhase?.('before-read', absPath, attempt)
      }

      // -- 定位（每次尝试重扫：创建竞态/外部新增文档都能被看到）
      const warnings = [...staticWarnings]
      let candidates: DocCandidate[] = []
      try {
        candidates = await scanCandidates(resolved.areaDirAbs, code, compact)
      } catch (e) {
        lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
        continue
      }
      const selected = candidates.length > 0 ? selectCandidate(candidates) : null
      if (selected !== null && candidates.length > 1) warnings.push(encodeStoreWarning(multiHitWarning(selected, candidates)))
      const targetPath = selected?.path ?? absPath

      // -- re-read
      let text: string | null = null
      let bom = false
      if (selected !== null) {
        try {
          const buf = await readFile(targetPath)
          bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
          text = bom ? buf.toString('utf8').slice(1) : buf.toString('utf8')
        } catch (e) {
          if ((e as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
            lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
            continue
          }
          text = null // 读取瞬间被外部移除 → 按创建路径重建
        }
      }

      // -- 快照 + 复核（跨进程纪律：不一致 → 重读重试）
      let snapshot: StatSnapshot | null = null
      try {
        snapshot = await statSafe(targetPath)
      } catch (e) {
        lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
        continue
      }
      await hooks.onPhase?.('before-verify', targetPath, attempt)
      let current: StatSnapshot | null = null
      try {
        current = await statSafe(targetPath)
      } catch (e) {
        lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
        continue
      }
      if (!sameStat(snapshot, current)) {
        lastFailure = { kind: 'mismatch' }
        continue
      }

      // -- 解析 + 写前归属硬校验 + 幂等
      const parse = parseDocument(text ?? '')
      const fm = parse.frontmatter === null ? {} : parseFrontmatterValues(parse.frontmatter.bodyLines)
      assertOwnership(fm, code, input.loc, targetPath, text !== null)

      if (input.kind === 'card' && input.clientRequestId !== undefined) {
        const dup = parse.sections.find((s) => {
          if (s.kind !== 'card') return false
          return toParsedCard(s, parse.eol).clientRequestId === input.clientRequestId
        })
        if (dup !== undefined) {
          return { status: 'duplicate', anchor: dup.anchor, path: targetPath, warnings }
        }
      }
      if (input.kind === 'ainote') {
        const existing = parse.sections.find((s) => s.kind === 'ainote' && s.date === compact && s.code === code)
        if (existing !== undefined) {
          return { status: 'skipped', anchor: existing.anchor, path: targetPath, warnings }
        }
      }

      // -- 组装：frontmatter 最小修补（或为无块遗留文档注入基准块）+ 分节插入
      const hhmm = formatAnchorTime(input.now)
      const seq = nextAnchorSeq(parse.sections, input.kind, compact, code, hhmm)
      const anchor = buildAnchor(input.kind, compact, code, hhmm, seq)
      const headingTime = anchorTimeToHeading(hhmm)
      const sectionText = input.kind === 'card'
        ? buildCardSectionText({
            headingTime,
            anchor,
            writtenAt: formatZonedIso(input.now),
            clientRequestId: input.clientRequestId,
            body: input.body,
            eol: parse.eol,
          })
        : buildAinoteSectionText({
            headingTime,
            anchor,
            generatedAt: input.generatedAt ?? formatZonedIso(input.now),
            dataSources: input.dataSources ?? [],
            body: input.body,
            eol: parse.eol,
          })

      let base: string
      let shift: number
      if (text === null) {
        // 新建文档：frontmatter 按 loc 生成（键序 = schema 表序；值双引号包裹），
        // 其后一个空行再接新分节。
        const fmBlock = buildFrontmatterBlock({ code, name: input.loc.name ?? '', tradeDate: input.loc.tradeDate }, parse.eol)
        base = `${fmBlock}${parse.eol}${parse.eol}`
        shift = base.length
      } else if (parse.frontmatter === null) {
        // 遗留文档无 frontmatter 块：注入基准块（既有字节全部保留在其后），
        // 使锚点归属校验从本次起可判定。
        const injected = buildFrontmatterBlock({ code, name: input.loc.name ?? '', tradeDate: input.loc.tradeDate }, parse.eol)
        base = `${injected}${parse.eol}${parse.eol}${text}`
        shift = injected.length + parse.eol.length * 2
      } else {
        const patchedBlock = patchFrontmatterBlock(parse, text, fm, {
          code,
          compact,
          requestedName: input.loc.name ?? '',
          eol: parse.eol,
        })
        if (patchedBlock === null) {
          base = text
          shift = 0
        } else {
          base = patchedBlock + text.slice(parse.frontmatter.end)
          shift = patchedBlock.length - parse.frontmatter.end
        }
      }

      const insertOffsetOriginal = input.kind === 'card'
        ? (text === null ? 0 : (parse.sections.find((s) => s.kind === 'ainote')?.startOffset ?? text.length))
        : (text === null ? 0 : text.length)
      const merged = assembleInsert(base, insertOffsetOriginal + shift, sectionText, parse.eol)
      const content = bom ? `\uFEFF${merged}` : merged

      // -- 原子写
      try {
        await hooks.onPhase?.('before-write', targetPath, attempt)
        await atomicWrite(targetPath, content)
      } catch (e) {
        if (isRetryableFsError(e)) {
          lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
          continue
        }
        throw e
      }
      return { status: 'created', anchor, path: targetPath, warnings }
    }

    if (lastFailure?.kind === 'mismatch') {
      throw new ConcurrentWriteError(
        `CONCURRENT_WRITE: ${absPath} — 重试 ${MAX_RETRIES} 次后写入前校验仍检测到并发修改（mtimeMs/size 不一致）。`
        + ' 未落盘、未覆盖任何内容；请确认 OneDrive/编辑器等外部占用结束后重试。',
      )
    }
    throw new Error(
      `STORE_WRITE_FAILED: ${absPath} — 重试 ${MAX_RETRIES} 次后仍失败（${lastFailure?.message ?? '未知原因'}）。未产生半截文档。`,
    )
  })
}

/** 追加卡片（契约 §3 `appendCard`）。 */
export async function appendCard(input: {
  loc: Loc
  body: string
  now?: Date
  clientRequestId?: string
}): Promise<Result<{ status: 'created' | 'duplicate'; anchor: string; path: string }>> {
  if (typeof input.body !== 'string' || input.body.trim() === '') {
    throw new Error('appendCard: 卡片正文为空——须提供非空白正文（页面层负责 4xx 前置校验）')
  }
  const outcome = await appendIntoDailyDoc({
    loc: input.loc,
    kind: 'card',
    body: input.body,
    now: input.now ?? new Date(),
    clientRequestId: input.clientRequestId,
  })
  const status = outcome.status === 'duplicate' ? 'duplicate' as const : 'created' as const
  return { status, anchor: outcome.anchor, path: outcome.path, warnings: outcome.warnings }
}

/** 追加附注（契约 §3 `appendAinote`；change 5 的工具出口与本实现同一份）。 */
export async function appendAinote(input: {
  loc: Loc
  body: string
  generatedAt: string
  dataSources: string[]
  now?: Date
}): Promise<Result<{ status: 'created' | 'skipped'; anchor: string; path: string }>> {
  const outcome = await appendIntoDailyDoc({
    loc: input.loc,
    kind: 'ainote',
    body: input.body,
    now: input.now ?? new Date(),
    generatedAt: input.generatedAt,
    dataSources: input.dataSources,
  })
  const status = outcome.status === 'skipped' ? 'skipped' as const : 'created' as const
  return { status, anchor: outcome.anchor, path: outcome.path, warnings: outcome.warnings }
}

// ---------------------------------------------------------------------------
// 显式修订与删除（owner 2026-10-05 追授：updateCard / deleteCard；spec =「卡片显式
// 修订与删除」Requirement——锚点/meta 行字节不变、其余分节保真、写入纪律同款）
// ---------------------------------------------------------------------------

/** 卡片锚点解析（date 紧凑形 + code；正则整体匹配失败 → 非法锚点）。 */
function parseCardAnchor(anchor: string): { compact: string; code: string } {
  const m = CARD_ANCHOR_RE.exec(anchor)
  if (m === null) {
    throw new Error(`非法卡片锚点 '${anchor}'——期望 card-YYYYMMDD-代码-HHMM[-序号] 形态（经 CARD_ANCHOR_RE 整体匹配）`)
  }
  return { compact: m[1], code: m[2] }
}

/** 修改主流程（update/delete 共用模板）：定位 → 互斥 → re-read + stat 复核重试 → 变换 → 原子写。 */
async function transformDailyDoc(input: {
  anchor: string
  dataRoot: string
  mode: 'update' | 'delete'
  body?: string
}): Promise<{ status: 'updated' | 'deleted'; anchor: string; path: string; warnings: string[] }> {
  const { compact, code } = parseCardAnchor(input.anchor)
  const resolved = resolveArea(input.dataRoot, 'review', { code, name: '', date: compact }, { forWrite: true })
  const hooks = activeHooks
  const retryDelays = hooks.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const notFound = (detail: string): AnchorNotFoundError =>
    new AnchorNotFoundError(`ANCHOR_NOT_FOUND: ^${input.anchor} — ${detail}。零字节变化；MUST NOT 新建文档，请核对锚点与归属。`)

  const lockKey = `${resolved.areaDirAbs}::${code}_${compact}`
  return withLock(lockKey, async () => {
    let lastFailure: { kind: 'mismatch' } | { kind: 'fs'; message: string } | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        await delay(retryDelays[Math.min(attempt - 1, retryDelays.length - 1)] ?? 0)
        await hooks.onPhase?.('before-read', resolved.absPath, attempt)
      }

      // -- 定位（扫描不依赖名称段：`<代码>_*_<日期>.md` 全匹配）
      let candidates: DocCandidate[]
      try {
        candidates = await scanCandidates(resolved.areaDirAbs, code, compact)
      } catch (e) {
        lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
        continue
      }
      if (candidates.length === 0) throw notFound('该 (代码, 交易日) 不存在文档')
      const warnings: string[] = []
      const selected = selectCandidate(candidates)
      if (candidates.length > 1) warnings.push(encodeStoreWarning(multiHitWarning(selected, candidates)))
      const targetPath = selected.path

      // -- re-read
      let buf: Buffer
      try {
        buf = await readFile(targetPath)
      } catch (e) {
        if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') throw notFound('文档在读取时被外部移除')
        lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
        continue
      }

      // -- 快照 + 复核（同追加纪律）
      const snapshot = await statSafe(targetPath)
      let current: StatSnapshot | null = null
      try {
        current = await statSafe(targetPath)
      } catch (e) {
        lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
        continue
      }
      if (!sameStat(snapshot, current)) {
        lastFailure = { kind: 'mismatch' }
        continue
      }

      // -- 解析 + 归属校验（幽灵锚点按未找到处置，MUST NOT 修改）
      const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
      const text = bom ? buf.toString('utf8').slice(1) : buf.toString('utf8')
      const parse = parseDocument(text)
      const fm = parse.frontmatter === null ? {} : parseFrontmatterValues(parse.frontmatter.bodyLines)
      const section = parse.sections.find((s) => s.kind === 'card' && s.anchor === input.anchor)
      if (section === undefined) throw notFound('文档中不存在该卡片锚点')
      const fmCode = typeof fm.code === 'string' ? fm.code : null
      const fmTrade = typeof fm.tradeDate === 'string' ? fm.tradeDate : null
      if (fmCode === null || fmTrade === null || fmCode !== section.code || toCompactDate(fmTrade) !== section.date) {
        throw notFound(`锚点归属与文档 frontmatter 基准不一致（锚点 code=${section.code}, date=${section.date}；基准 code=${fmCode ?? '缺失'}, tradeDate=${fmTrade ?? '缺失'}）`)
      }

      // -- 变换（字节级：delete = 整节移除；update = 保留 H2+meta 行字节、替换其后的正文跨度）
      let merged: string
      if (input.mode === 'delete') {
        merged = text.slice(0, section.startOffset) + text.slice(section.endOffset)
      } else {
        let lastMetaIdx = 0 // 至少保留标题行；meta 块 = 标题行后连续的 meta 行（写入器形状）
        for (let i = 1; i < section.lines.length; i++) {
          const lineText = section.lines[i].text
          if (CARD_META_RE.test(lineText) || CARD_REQUEST_RE.test(lineText)) lastMetaIdx = i
          else break
        }
        const bodyLines = (input.body ?? '').trim().replace(/\r\n/g, '\n').split('\n')
        const bodyStart = section.lines[lastMetaIdx].eolStart + 1
        const span = parse.eol + bodyLines.join(parse.eol) + parse.eol
        merged = text.slice(0, bodyStart) + span + text.slice(section.endOffset)
      }
      const content = bom ? `\uFEFF${merged}` : merged

      // -- 原子写
      try {
        await hooks.onPhase?.('before-write', targetPath, attempt)
        await atomicWrite(targetPath, content)
      } catch (e) {
        if (isRetryableFsError(e)) {
          lastFailure = { kind: 'fs', message: e instanceof Error ? e.message : String(e) }
          continue
        }
        throw e
      }
      return {
        status: input.mode === 'update' ? ('updated' as const) : ('deleted' as const),
        anchor: input.anchor,
        path: targetPath,
        warnings,
      }
    }

    if (lastFailure?.kind === 'mismatch') {
      throw new ConcurrentWriteError(
        `CONCURRENT_WRITE: ${resolved.absPath} — 重试 ${MAX_RETRIES} 次后修改前校验仍检测到并发修改（mtimeMs/size 不一致）。`
        + ' 未落盘、未覆盖任何内容；请确认 OneDrive/编辑器等外部占用结束后重试。',
      )
    }
    throw new Error(
      `STORE_WRITE_FAILED: ${resolved.absPath} — 重试 ${MAX_RETRIES} 次后仍失败（${lastFailure?.message ?? '未知原因'}）。未产生半截文档。`,
    )
  })
}

/** 修订卡片正文（owner 2026-10-05 追授）：锚点与 meta 行字节不变，仅替换正文。 */
export async function updateCard(input: {
  anchor: string
  body: string
  dataRoot: string
}): Promise<Result<{ status: 'updated'; anchor: string; path: string }>> {
  if (typeof input.body !== 'string' || input.body.trim() === '') {
    throw new Error('updateCard: 卡片正文为空——删除请用 deleteCard 通道（MUST NOT 以空正文冒充删除）')
  }
  const outcome = await transformDailyDoc({ anchor: input.anchor, dataRoot: input.dataRoot, mode: 'update', body: input.body })
  return { status: 'updated' as const, anchor: outcome.anchor, path: outcome.path, warnings: outcome.warnings }
}

/** 删除卡片分节（owner 2026-10-05 追授）：该分节字节原样移除，其余内容保真。 */
export async function deleteCard(input: {
  anchor: string
  dataRoot: string
}): Promise<Result<{ status: 'deleted'; anchor: string; path: string }>> {
  const outcome = await transformDailyDoc({ anchor: input.anchor, dataRoot: input.dataRoot, mode: 'delete' })
  return { status: 'deleted' as const, anchor: outcome.anchor, path: outcome.path, warnings: outcome.warnings }
}

// ---------------------------------------------------------------------------
// 全量扫描（scanDailyCardTargets）
// ---------------------------------------------------------------------------

/**
 * 扫描某交易日的全部卡片目标（契约 §3 `scanDailyCardTargets`）。
 *
 * 扫描范围：`DB/review/` 全部月度子目录——基目录由 `resolveArea` 输出经
 * `path.dirname` 派生（不自行拼接模板；月目录本身必经 resolveArea 折算）。
 * 同一 code 多命中按 mtime 最新/文件名字典序确定性取一并告警。
 * `dataRoot` 缺省时显式报错（service 出口由装配点绑定，见 src/review/index.ts）。
 */
export async function scanDailyCardTargets(
  tradeDate: string,
  dataRoot?: string,
): Promise<Result<Array<{ code: string; name: string; path: string; cardCount: number; hasAinote: boolean }>>> {
  const root = dataRoot ?? ''
  if (root === '') {
    throw new Error('scanDailyCardTargets: 未提供 dataRoot——请显式传参，或使用 registerReview 装配的 service 出口')
  }
  const compact = toCompactDate(tradeDate)
  const warnings: string[] = []
  // 探针解析：以占位 code 取得月目录（校验照走白名单与真实日历），再取其父目录
  // 作为 DB/review 基目录（path.dirname 派生，非模板拼接）。
  const probe = resolveArea(root, 'review', { code: '000000', name: '', date: compact })
  const reviewBase = dirname(probe.areaDirAbs)

  let months: Dirent[]
  try {
    months = await readdir(reviewBase, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return Object.assign([] as Array<{ code: string; name: string; path: string; cardCount: number; hasAinote: boolean }>, { warnings })
    throw e
  }

  const re = /^(\d{6})_.+_(\d{8})\.md$/
  interface Target {
    code: string
    name: string
    path: string
    cardCount: number
    hasAinote: boolean
    mtimeMs: number
    fileName: string
  }
  const byCode = new Map<string, Target[]>()

  for (const month of months) {
    if (!month.isDirectory()) continue
    let files: Dirent[]
    try {
      files = await readdir(join(reviewBase, month.name), { withFileTypes: true })
    } catch {
      continue // 月目录读取失败不阻塞其它月份
    }
    for (const f of files) {
      const m = re.exec(f.name)
      if (m === null || m[2] !== compact) continue
      const full = join(reviewBase, month.name, f.name)
      const parsed = await parseDoc(full)
      warnings.push(...parsed.warnings)
      const st = await stat(full)
      const nameFromFile = f.name.slice(m[1].length + 1, f.name.length - (compact.length + 3))
      const target: Target = {
        code: m[1],
        name: typeof parsed.frontmatter.name === 'string' && parsed.frontmatter.name !== ''
          ? parsed.frontmatter.name
          : nameFromFile,
        path: full,
        cardCount: parsed.cards.length,
        hasAinote: parsed.ainotes.length > 0,
        mtimeMs: st.mtimeMs,
        fileName: f.name,
      }
      const list = byCode.get(target.code) ?? []
      list.push(target)
      byCode.set(target.code, list)
    }
  }

  const out = Object.assign([] as Array<{ code: string; name: string; path: string; cardCount: number; hasAinote: boolean }>, { warnings })
  for (const [code, list] of [...byCode.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const winner: Target = list.length === 1
      ? list[0]
      : [...list].sort((a, b) => (a.mtimeMs !== b.mtimeMs ? b.mtimeMs - a.mtimeMs : a.fileName < b.fileName ? -1 : 1))[0]
    if (list.length > 1) {
      warnings.push(encodeStoreWarning(multiHitWarning(winner, list)))
    }
    out.push({ code: winner.code, name: winner.name, path: winner.path, cardCount: winner.cardCount, hasAinote: winner.hasAinote })
  }
  return out
}
