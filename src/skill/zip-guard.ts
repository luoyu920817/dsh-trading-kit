/**
 * zip 解压加固层（tasks 1.4，design D-2）。
 *
 * 两道校验（spec「压缩包解压加固」）：
 * ① 解压前：解析 central directory 条目表，`inspectEntries` 按「声明值」预检
 *    （路径形态 / symlink / 加密 / 规模上限）；
 * ② 写出前与写出中：逐条目复核（实际解压字节数、CRC32、累计总量、最终路径
 *    `assertInside`），防声明值说谎。
 *
 * 库选型（tasks 1.3）：fflate 0.8.x 只承担「raw deflate 解字节」（inflateSync），
 * central directory / local header 由本模块自行解析——fflate 高层 API（unzipSync）
 * 不暴露 external attrs（无法判 symlink）与声明大小（无法预检），且一次性解压
 * 全包到内存，无法做写出前预检。截断/损坏输入的完整性失败信号验证见
 * test/skill/zip-guard.test.ts（1.3 选型门禁）。
 *
 * 安全红线：解压 MUST NOT 执行包内任何脚本（本层只写文件字节，不设可执行位、
 * 不进可执行搜索路径）；拒绝 symlink/reparse 条目落盘。
 */

import { inflateSync } from 'fflate'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SkillInstallerError, type SkillFailedCheck } from './errors.ts'
import { sha256Bytes } from './hash.ts'

// ── 路径包含关系判定（越界防护先例：data-foundation/design.md:40）──────────

/** 规范化后 child 是否位于 root 内或与 root 相等（「相等」属于「在内」）。 */
export function isInsideOrEqual(child: string, root: string): boolean {
  const c = path.resolve(child)
  const r = path.resolve(root)
  return c === r || c.startsWith(r + path.sep)
}

/** 规范化后 child 是否严格位于 root 内（不含相等）。 */
export function isStrictlyInside(child: string, root: string): boolean {
  const c = path.resolve(child)
  const r = path.resolve(root)
  return c !== r && c.startsWith(r + path.sep)
}

/** child 必须在 root 内（含相等），否则抛错——zip 条目写出前的越界硬拦。 */
export function assertInside(child: string, root: string): void {
  if (!isInsideOrEqual(child, root)) {
    throw new SkillInstallerError('PATH_ESCAPE', `路径越界：<${child}> 不在根 <${root}> 内`, {
      failedCheck: 'entry-path',
      child,
      root,
    })
  }
}

/**
 * child 不得位于 root 内或与 root 相等——暂存区断言 ①（spec「原子安装」）：
 * 对 knownSkillRoots 的每个 root（含本次 targetRoot 自身）成立，「相等=在内」。
 */
export function assertNotInside(child: string, root: string): void {
  if (isInsideOrEqual(child, root)) {
    throw new SkillInstallerError(
      'TMP_AREA_IN_SCAN_ROOT',
      `暂存区 <${path.resolve(child)}> 落在 skill 扫描根 <${path.resolve(root)}> 内（相等也算在内）；` +
        `暂存区必须位于所有扫描根之外，请修正 skill.installDir / targetRoot 配置`,
      { child: path.resolve(child), root: path.resolve(root), configKey: 'skill.installDir' },
    )
  }
}

// ── 规模上限（design D-2；可经 Config.skill.limits 覆盖）──────────────────

export interface ZipLimits {
  maxEntries: number
  maxFileBytes: number
  maxTotalBytes: number
}

export const DEFAULT_ZIP_LIMITS: ZipLimits = {
  maxEntries: 200,
  maxFileBytes: 5_242_880, // 5 MB
  maxTotalBytes: 52_428_800, // 50 MB
}

// ── central directory 解析 ────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50
const CDE_SIG = 0x02014b50
const LFH_SIG = 0x04034b50
const ZIP64_SENTINEL = 0xffffffff

export interface ZipEntryMeta {
  /** central directory 里的原始条目名。 */
  name: string
  /** 反斜杠归一为 `/` 后的条目名。 */
  normalized: string
  flags: number
  method: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  externalAttrs: number
  localHeaderOffset: number
  isDirectory: boolean
}

export interface ParsedZip {
  entries: ZipEntryMeta[]
}

function findEOCD(zip: Uint8Array): number {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const minStart = Math.max(0, zip.length - 22 - 65_535)
  for (let i = zip.length - 22; i >= minStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i
  }
  throw new SkillInstallerError('ZIP_UNPARSEABLE', 'zip 结构不完整：未找到 EOCD（可能被截断）', {
    failedCheck: 'unzip',
  })
}

/** 解析 central directory（截断/损坏即抛错——完整性失败信号，tasks 1.3）。 */
export function parseCentralDirectory(zip: Uint8Array): ParsedZip {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const eocd = findEOCD(zip)
  const totalEntries = view.getUint16(eocd + 10, true)
  const cdSize = view.getUint32(eocd + 12, true)
  const cdOffset = view.getUint32(eocd + 16, true)
  if (totalEntries === 0xffff || cdSize === ZIP64_SENTINEL || cdOffset === ZIP64_SENTINEL) {
    throw new SkillInstallerError('ZIP64_UNSUPPORTED', '不支持 zip64 形态的包', { failedCheck: 'unzip' })
  }
  if (cdOffset + cdSize > zip.length) {
    throw new SkillInstallerError('ZIP_TRUNCATED', 'zip 结构不完整：central directory 越出文件边界（可能被截断）', {
      failedCheck: 'unzip',
    })
  }
  const decoder = new TextDecoder()
  const entries: ZipEntryMeta[] = []
  let p = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > zip.length || view.getUint32(p, true) !== CDE_SIG) {
      throw new SkillInstallerError('ZIP_UNPARSEABLE', `zip 结构不完整：central directory 第 ${i} 条签名异常`, {
        failedCheck: 'unzip',
      })
    }
    const flags = view.getUint16(p + 8, true)
    const method = view.getUint16(p + 10, true)
    const crc = view.getUint32(p + 16, true)
    const compressedSize = view.getUint32(p + 20, true)
    const uncompressedSize = view.getUint32(p + 24, true)
    const nameLen = view.getUint16(p + 28, true)
    const extraLen = view.getUint16(p + 30, true)
    const commentLen = view.getUint16(p + 32, true)
    const externalAttrs = view.getUint32(p + 38, true)
    const localHeaderOffset = view.getUint32(p + 42, true)
    const name = decoder.decode(zip.subarray(p + 46, p + 46 + nameLen))
    const normalized = name.replace(/\\/g, '/')
    entries.push({
      name,
      normalized,
      flags,
      method,
      crc32: crc,
      compressedSize,
      uncompressedSize,
      externalAttrs,
      localHeaderOffset,
      isDirectory: normalized.endsWith('/'),
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return { entries }
}

// ── 条目校验（解压前预检）─────────────────────────────────────────────────

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
])

const S_IFLNK = 0o120000

export interface ZipViolation {
  kind: SkillFailedCheck
  entry?: string
  detail: string
}

function checkEntryName(normalized: string, entry: ZipEntryMeta, violations: ZipViolation[]): void {
  if (normalized === '') {
    violations.push({ kind: 'empty-name', entry: normalized, detail: '条目名为空' })
    return
  }
  if (normalized.startsWith('/') || entry.name.startsWith('\\') || entry.name.startsWith('\\\\')) {
    violations.push({ kind: 'entry-path', entry: normalized, detail: '条目名为绝对路径' })
  }
  if (/^[a-zA-Z]:/.test(normalized) || /^[a-zA-Z]:/.test(entry.name)) {
    violations.push({ kind: 'entry-path', entry: normalized, detail: '条目名带盘符（X:）' })
  }
  if (entry.name.startsWith('//')) {
    violations.push({ kind: 'entry-path', entry: normalized, detail: '条目名为 UNC 路径' })
  }
  const segments = normalized.split('/')
  for (const segment of segments) {
    if (segment === '..') {
      violations.push({ kind: 'entry-path', entry: normalized, detail: '条目名含 `..` 段（路径穿越）' })
    }
    const dot = segment.indexOf('.')
    const base = dot > 0 ? segment.slice(0, dot) : segment
    if (WINDOWS_RESERVED.has(base.toUpperCase())) {
      violations.push({ kind: 'reserved-name', entry: normalized, detail: `条目名含 Windows 保留名（${base}）` })
    }
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      violations.push({ kind: 'trailing-dot-space', entry: normalized, detail: '条目名段以 `.` 或空格结尾' })
    }
  }
}

/** 解压前预检：依据 central directory 声明值逐条校验 + 规模上限（design D-2）。 */
export function inspectEntries(entries: ZipEntryMeta[], limits: ZipLimits): { ok: boolean; violations: ZipViolation[] } {
  const violations: ZipViolation[] = []
  if (entries.length > limits.maxEntries) {
    violations.push({
      kind: 'entry-count',
      detail: `条目数 ${entries.length} 超过上限 ${limits.maxEntries}`,
    })
  }
  let total = 0
  for (const entry of entries) {
    checkEntryName(entry.normalized, entry, violations)
    const mode = (entry.externalAttrs >>> 16) & 0o170000
    if (mode === S_IFLNK) {
      violations.push({ kind: 'symlink-entry', entry: entry.normalized, detail: '拒绝 symlink / reparse 条目' })
    }
    if (entry.flags & 0x1) {
      violations.push({ kind: 'encrypted-entry', entry: entry.normalized, detail: '拒绝加密条目' })
    }
    if (
      entry.uncompressedSize === ZIP64_SENTINEL ||
      entry.compressedSize === ZIP64_SENTINEL ||
      entry.localHeaderOffset === ZIP64_SENTINEL
    ) {
      violations.push({ kind: 'zip64-entry', entry: entry.normalized, detail: 'zip64 条目不受支持' })
    }
    if (entry.uncompressedSize > limits.maxFileBytes) {
      violations.push({
        kind: 'file-size',
        entry: entry.normalized,
        detail: `单文件解压字节 ${entry.uncompressedSize} 超过上限 ${limits.maxFileBytes}`,
      })
    }
    total += entry.uncompressedSize
  }
  if (total > limits.maxTotalBytes) {
    violations.push({
      kind: 'total-size',
      detail: `解压总量 ${total} 超过上限 ${limits.maxTotalBytes}`,
    })
  }
  return { ok: violations.length === 0, violations }
}

// ── CRC32（zip 标准多项式；Node 20 无 zlib.crc32，自带表实现）─────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ── 加固解压 ──────────────────────────────────────────────────────────────

export interface ExtractedFile {
  relPath: string
  absPath: string
  bytes: number
  sha256: string
}

export interface GuardedExtractResult {
  files: ExtractedFile[]
  totalBytes: number
}

function fail(violation: ZipViolation): never {
  throw new SkillInstallerError('ZIP_GUARD_FAILED', `压缩包校验失败（${violation.entry ?? '包级'}）：${violation.detail}`, {
    failedCheck: violation.kind,
    violation,
  })
}

function inflateEntry(entry: ZipEntryMeta, zip: Uint8Array): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const lho = entry.localHeaderOffset
  if (lho + 30 > zip.length || view.getUint32(lho, true) !== LFH_SIG) {
    fail({ kind: 'unzip', entry: entry.normalized, detail: 'local header 签名异常（包可能被截断或伪造）' })
  }
  const localNameLen = view.getUint16(lho + 26, true)
  const localExtraLen = view.getUint16(lho + 28, true)
  const localName = new TextDecoder().decode(zip.subarray(lho + 30, lho + 30 + localNameLen))
  if (localName !== entry.name) {
    fail({ kind: 'unzip', entry: entry.normalized, detail: 'local header 与 central directory 条目名不一致' })
  }
  const dataStart = lho + 30 + localNameLen + localExtraLen
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > zip.length) {
    fail({ kind: 'unzip', entry: entry.normalized, detail: '条目数据越出文件边界（包可能被截断）' })
  }
  const compressed = zip.subarray(dataStart, dataEnd)
  if (entry.method === 0) {
    return compressed
  }
  if (entry.method === 8) {
    try {
      return inflateSync(compressed)
    } catch (error) {
      throw new SkillInstallerError(
        'ZIP_CORRUPT',
        `zip 完整性校验失败（${entry.normalized}）：解压数据损坏或被截断（${error instanceof Error ? error.message : String(error)}）`,
        { failedCheck: 'unzip', entry: entry.normalized },
      )
    }
  }
  fail({ kind: 'unsupported-method', entry: entry.normalized, detail: `不支持的压缩方法 ${entry.method}` })
}

/**
 * 加固解压：预检（central directory 声明值）→ 逐条目解压复核（实际字节数 /
 * CRC32 / 累计总量 / 最终路径 assertInside）→ 落盘。任一违规：中止 + 显式错误
 * （调用方负责清理暂存区）。
 */
export async function extractGuarded(zip: Uint8Array, stageRoot: string, limits: ZipLimits = DEFAULT_ZIP_LIMITS): Promise<GuardedExtractResult> {
  const parsed = parseCentralDirectory(zip)
  const preflight = inspectEntries(parsed.entries, limits)
  if (!preflight.ok) {
    const first = preflight.violations[0]
    throw new SkillInstallerError(
      'ZIP_GUARD_FAILED',
      `压缩包预检失败（${first.entry ?? '包级'}）：${first.detail}${preflight.violations.length > 1 ? `（共 ${preflight.violations.length} 条违规）` : ''}`,
      { failedCheck: first.kind, violations: preflight.violations },
    )
  }

  await fsp.mkdir(stageRoot, { recursive: true })
  const files: ExtractedFile[] = []
  let totalBytes = 0
  for (const entry of parsed.entries) {
    if (entry.isDirectory) continue
    const data = inflateEntry(entry, zip)
    // 写出中累计复核（防声明 uncompressedSize 说谎）
    if (data.length !== entry.uncompressedSize) {
      fail({
        kind: 'file-size',
        entry: entry.normalized,
        detail: `声明解压字节 ${entry.uncompressedSize} 与实际 ${data.length} 不一致`,
      })
    }
    totalBytes += data.length
    if (totalBytes > limits.maxTotalBytes) {
      fail({ kind: 'total-size', detail: `累计解压字节 ${totalBytes} 超过上限 ${limits.maxTotalBytes}` })
    }
    const actualCrc = crc32(data)
    if (actualCrc !== entry.crc32) {
      fail({
        kind: 'crc-mismatch',
        entry: entry.normalized,
        detail: `CRC32 不一致（声明 ${entry.crc32.toString(16)}，实际 ${actualCrc.toString(16)}）`,
      })
    }
    const mode = (entry.externalAttrs >>> 16) & 0o170000
    if (mode === S_IFLNK) {
      fail({ kind: 'symlink-entry', entry: entry.normalized, detail: '拒绝 symlink / reparse 条目落盘' })
    }
    const absPath = path.resolve(stageRoot, entry.normalized)
    assertInside(absPath, stageRoot)
    await fsp.mkdir(path.dirname(absPath), { recursive: true })
    await fsp.writeFile(absPath, data)
    files.push({ relPath: entry.normalized, absPath, bytes: data.length, sha256: sha256Bytes(data) })
  }
  return { files, totalBytes }
}
