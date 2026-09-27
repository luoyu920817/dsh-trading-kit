/**
 * tasks 1.4（zip-guard 加固层逐项）+ tasks 1.3（fflate 完整性失败信号选型门禁）。
 *
 * 每条加固项断言「中止 + 显式错误（含条目名与实际值/上限）」；
 * 官方 zip 真实快照（test/fixtures/official/）用于截断/损坏完整性信号与正常解压。
 */
import { readFileSync } from 'node:fs'
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  assertInside,
  assertNotInside,
  extractGuarded,
  inspectEntries,
  isInsideOrEqual,
  isStrictlyInside,
  parseCentralDirectory,
  DEFAULT_ZIP_LIMITS,
} from '../../src/skill/zip-guard.ts'
import { unzipSync } from 'fflate'
import { buildZip, corruptEntryData, testCrc32, truncateZip, type ZipGenEntry } from './helpers/zipgen.ts'
import { tempDir } from './helpers/tmp.ts'
import { SkillInstallerError } from '../../src/skill/errors.ts'

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures')
const OFFICIAL_ZIP = path.join(FIXTURE_DIR, 'official', 'tdx-tq-local-snapshot.zip')
const OFFICIAL_MANIFEST = JSON.parse(readFileSync(path.join(FIXTURE_DIR, 'official-zip-manifest.json'), 'utf8')) as {
  archive: { sha256: string; bytes: number }
  entries: Array<{ name: string; uncompressedSize: number; sha256: string }>
}

const TMP_AREA_ERROR = /落在 skill 扫描根/

async function expectGuardFailure(zip: Buffer, stageRoot: string, pattern: RegExp): Promise<void> {
  let caught: unknown = null
  try {
    await extractGuarded(new Uint8Array(zip), stageRoot)
  } catch (error) {
    caught = error
  }
  expect(caught).toBeInstanceOf(SkillInstallerError)
  expect((caught as SkillInstallerError).message).toMatch(pattern)
}

describe('assertInside / assertNotInside（N6 语义）', () => {
  it('assertInside：相等属于「在内」；前缀比对按 path.resolve 规范化', () => {
    expect(() => assertInside('C:\\a\\b', 'C:\\a\\b')).not.toThrow()
    expect(() => assertInside('C:\\a\\b\\c.md', 'C:\\a\\b')).not.toThrow()
    expect(() => assertInside('C:\\a\\bb\\c.md', 'C:\\a\\b')).toThrowError(/越界/) // 前缀相似但非段内
  })

  it('assertNotInside：相等即「在内」→ 抛错（单测直接覆盖相等输入，tasks 1.5①）', () => {
    expect(() => assertNotInside('C:\\same', 'C:\\same')).toThrowError(TMP_AREA_ERROR)
    expect(() => assertNotInside('C:\\same\\child', 'C:\\same')).toThrowError(TMP_AREA_ERROR)
    expect(() => assertNotInside('C:\\other', 'C:\\same')).not.toThrow()
  })

  it('isStrictlyInside：相等不算后代（targetRoot 等于自身登记项合法的基础）', () => {
    expect(isStrictlyInside('C:\\a\\b', 'C:\\a\\b')).toBe(false)
    expect(isStrictlyInside('C:\\a\\b\\c', 'C:\\a\\b')).toBe(true)
    expect(isInsideOrEqual('C:\\a\\b', 'C:\\a\\b')).toBe(true)
  })
})

describe('inspectEntries：加固项逐条（tasks 1.4）', () => {
  const metaOf = (overrides: Partial<ZipGenEntry> & { name: string }) => {
    const zip = buildZip([{ data: 'x', ...overrides }])
    const parsed = parseCentralDirectory(new Uint8Array(zip))
    expect(parsed.entries.length).toBe(1)
    return parsed.entries[0]
  }

  it('绝对路径 / 盘符 / UNC 拒绝（含条目名）', () => {
    for (const name of ['/etc/passwd', 'C:\\x.md', '\\\\server\\share\\x.md', '//server/share/x.md']) {
      const { ok, violations } = inspectEntries([metaOf({ name })], DEFAULT_ZIP_LIMITS)
      expect(ok).toBe(false)
      expect(violations[0].kind).toBe('entry-path')
      expect(violations[0].detail).toMatch(/绝对路径|盘符|UNC/)
    }
  })

  it('`..` 段（含反斜杠伪装 ..\\）拒绝', () => {
    for (const name of ['../escape.md', '..\\escape.md', 'a/../../b.md']) {
      const { ok, violations } = inspectEntries([metaOf({ name })], DEFAULT_ZIP_LIMITS)
      expect(ok).toBe(false)
      expect(violations[0].kind).toBe('entry-path')
      expect(violations[0].detail).toMatch(/穿越|\.\./)
      expect(violations[0].entry).toBeDefined()
    }
  })

  it('symlink 条目拒绝（external attrs Unix mode 0o120000）', () => {
    const { ok, violations } = inspectEntries([metaOf({ name: 'link.md', externalAttrs: 0o120777 << 16 })], DEFAULT_ZIP_LIMITS)
    expect(ok).toBe(false)
    expect(violations[0].kind).toBe('symlink-entry')
  })

  it('Windows 保留名（CON/NUL/COM1）与尾随空格/点拒绝', () => {
    for (const name of ['CON', 'NUL.txt', 'COM1', 'sub/LPT9.md', 'trailing.md ', 'trailing.md.']) {
      const { ok, violations } = inspectEntries([metaOf({ name })], DEFAULT_ZIP_LIMITS)
      expect(ok, name).toBe(false)
      expect(violations[0].kind === 'reserved-name' || violations[0].kind === 'trailing-dot-space', name).toBe(true)
    }
  })

  it('加密条目拒绝；zip64 哨兵拒绝', () => {
    expect(inspectEntries([metaOf({ name: 'a.md', flags: 0x1 })], DEFAULT_ZIP_LIMITS).violations[0].kind).toBe('encrypted-entry')
    expect(
      inspectEntries([metaOf({ name: 'a.md', declaredUncompressedSize: 0xffffffff })], DEFAULT_ZIP_LIMITS).violations[0].kind,
    ).toBe('zip64-entry')
  })

  it('规模上限：条目数 ≤200、单文件 ≤5 MB、总量 ≤50 MB（报实际值与上限）', () => {
    const many = Array.from({ length: 201 }, (_, index) => {
      const entry = metaOf({ name: `f${index}.md` })
      return entry
    })
    const countResult = inspectEntries(many, DEFAULT_ZIP_LIMITS)
    expect(countResult.violations.some((violation) => violation.kind === 'entry-count' && violation.detail.includes('201'))).toBe(true)

    const big = metaOf({ name: 'big.md', declaredUncompressedSize: 5_242_881 })
    const fileResult = inspectEntries([big], DEFAULT_ZIP_LIMITS)
    expect(fileResult.violations[0].kind).toBe('file-size')
    expect(fileResult.violations[0].detail).toContain('5242881')
    expect(fileResult.violations[0].detail).toContain('5242880')

    const totals = Array.from({ length: 11 }, (_, index) =>
      metaOf({ name: `t${index}.md`, declaredUncompressedSize: 5_000_000 }),
    )
    const totalResult = inspectEntries(totals, DEFAULT_ZIP_LIMITS)
    expect(totalResult.violations.some((violation) => violation.kind === 'total-size')).toBe(true)
  })

  it('合法条目通过（官方形态：根级 SKILL.md，extAttrs 0x20 非 symlink）', () => {
    const { ok, violations } = inspectEntries([metaOf({ name: 'SKILL.md', method: 8 })], DEFAULT_ZIP_LIMITS)
    expect(ok).toBe(true)
    expect(violations).toEqual([])
  })
})

describe('extractGuarded：写出中累计复核与越界硬拦', () => {
  it('官方真实快照：正常解压 → 文件落盘 + sha256 与 fixture 清单一致（1.3 证据链）', async () => {
    const dir = await tempDir()
    try {
      const zip = readFileSync(OFFICIAL_ZIP)
      expect(zip.length).toBe(OFFICIAL_MANIFEST.archive.bytes)
      const result = await extractGuarded(new Uint8Array(zip), path.join(dir.path, 'stage'))
      expect(result.files.length).toBe(1)
      expect(result.files[0].relPath).toBe('SKILL.md')
      expect(result.files[0].sha256).toBe(OFFICIAL_MANIFEST.entries[0].sha256)
      expect(result.totalBytes).toBe(OFFICIAL_MANIFEST.entries[0].uncompressedSize)
    } finally {
      await dir.cleanup()
    }
  })

  it('声明值说谎（usize 谎报小于实际）→ 写出中复核捕获', async () => {
    const dir = await tempDir()
    try {
      const stageRoot = path.join(dir.path, 'stage')
      // 谎报更大的声明值会被预检捕获；这里谎报 4 字节以穿过预检、在写出时被抓
      const zip = buildZip([{ name: 'lie.md', data: 'actual-data-bytes', declaredUncompressedSize: 4 }])
      await expectGuardFailure(zip, stageRoot, /声明解压字节|不一致/)
    } finally {
      await dir.cleanup()
    }
  })

  it('CRC 谎报 → crc-mismatch', async () => {
    const dir = await tempDir()
    try {
      const stageRoot = path.join(dir.path, 'stage')
      const zip = buildZip([{ name: 'a.md', data: 'hello', crcOverride: testCrc32(new TextEncoder().encode('other')) }])
      await expectGuardFailure(zip, stageRoot, /CRC32 不一致/)
    } finally {
      await dir.cleanup()
    }
  })

  it('local header 条目名与 central directory 不一致 → 拒绝', async () => {
    const dir = await tempDir()
    try {
      const zip = buildZip([{ name: 'safe.md', data: 'x', localName: 'evil.md' }])
      await expectGuardFailure(zip, path.join(dir.path, 'stage'), /不一致/)
    } finally {
      await dir.cleanup()
    }
  })

  it.each<[string, RegExp]>([
    ['../escape.md', /越界|穿越/],
    ['/etc/passwd', /绝对路径/],
    ['..\\escape.md', /越界|穿越/],
    ['C:\\x.md', /盘符/],
  ])('恶意契约：条目 %s 中止且 stage 根外零新增文件', async (name, pattern) => {
    const dir = await tempDir()
    try {
      const outsideFile = path.join(dir.path, 'escape.md')
      const stageRoot = path.join(dir.path, 'stage')
      const zip = buildZip([{ name, data: 'evil' }])
      await expect(extractGuarded(new Uint8Array(zip), stageRoot)).rejects.toThrowError(pattern)
      // stage 根之外零新增文件
      await expect(fsp.access(outsideFile)).rejects.toThrow()
    } finally {
      await dir.cleanup()
    }
  })

  it('symlink 条目不落盘', async () => {
    const dir = await tempDir()
    try {
      const stageRoot = path.join(dir.path, 'stage')
      const zip = buildZip([{ name: 'link', data: '/etc/passwd', externalAttrs: 0o120777 << 16 }])
      await expect(extractGuarded(new Uint8Array(zip), stageRoot)).rejects.toThrowError(/symlink/)
      await expect(fsp.lstat(path.join(stageRoot, 'link'))).rejects.toThrow()
    } finally {
      await dir.cleanup()
    }
  })
})

describe('tasks 1.3 选型门禁：截断 / 损坏 zip 的完整性失败信号', () => {
  const makeGoodZip = () => buildZip([{ name: 'SKILL.md', data: 'x'.repeat(4096), method: 8 }])

  it('fflate unzipSync 对截断 zip 给出失败信号（选型验证）', () => {
    const good = makeGoodZip()
    // 正常可解
    expect(() => unzipSync(new Uint8Array(good))).not.toThrow()
    // 多点截断：EOCD/central directory/数据区被切 → 一律抛错
    for (const keep of [good.length - 1, Math.floor(good.length * 0.9), Math.floor(good.length * 0.5), 40, 12]) {
      const truncated = truncateZip(good, keep)
      expect(() => unzipSync(new Uint8Array(truncated)), `keep=${keep}`).toThrow()
    }
  })

  it('fflate inflateSync（本仓解压路径）对截断/损坏数据给出失败信号', async () => {
    const dir = await tempDir()
    try {
      const stageRoot = path.join(dir.path, 'stage')
      const good = makeGoodZip()
      await expect(extractGuarded(new Uint8Array(truncateZip(good, Math.floor(good.length * 0.8))), stageRoot)).rejects.toThrow()
      await expect(extractGuarded(new Uint8Array(corruptEntryData(good)), stageRoot)).rejects.toThrow()
    } finally {
      await dir.cleanup()
    }
  })

  it('官方真实快照的截断包同样给出失败信号（真实包证据）', async () => {
    const dir = await tempDir()
    try {
      const official = readFileSync(OFFICIAL_ZIP)
      const stageRoot = path.join(dir.path, 'stage')
      await expect(
        extractGuarded(new Uint8Array(truncateZip(official, Math.floor(official.length * 0.9))), stageRoot),
      ).rejects.toThrowError(/截断|结构不完整|损坏/)
    } finally {
      await dir.cleanup()
    }
  })

  it('fixture 一致性：快照 zip 的 SHA-256 与官方清单记录逐字符相等', () => {
    const zip = readFileSync(OFFICIAL_ZIP)
    expect(createHash('sha256').update(zip).digest('hex')).toBe(OFFICIAL_MANIFEST.archive.sha256)
  })
})
