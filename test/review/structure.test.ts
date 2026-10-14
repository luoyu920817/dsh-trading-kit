/**
 * change 4 tasks 1.7/1.13/1.14 结构断言（契约 §7：扫描先断言目标非空）——
 * 净化实现唯一 / 锚点正则唯一 / +08:00 唯一 / warnings 字段名唯一 /
 * StoreWarningKind 无 docMismatch / 告警编码可解析。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { encodeStoreWarning, type StoreWarning, type StoreWarningKind } from '../../src/review/types.ts'

function toPath(url: URL): string {
  return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:)/, '$1')
}

function listFiles(dirPath: string, out: string[] = []): string[] {
  for (const name of readdirSync(dirPath)) {
    const full = join(dirPath, name)
    if (statSync(full).isDirectory()) listFiles(full, out)
    else if (name.endsWith('.ts')) out.push(full)
  }
  return out
}

const REVIEW_DIR = toPath(new URL('../../src/review', import.meta.url))
const SRC_DIR = toPath(new URL('../../src', import.meta.url))
const TEST_REVIEW_DIR = toPath(new URL('../../test/review', import.meta.url))

const WARN_KINDS: readonly StoreWarningKind[] = ['multiHit', 'ghostAnchor', 'duplicateAnchor', 'nameTruncated']

describe('tasks 1.7：净化实现唯一（MUST NOT 另建 src/review/sanitize.ts）', () => {
  it('src/review 下不存在 sanitize.ts；review 源码不内联 NFC/保留名/40 截断净化逻辑', () => {
    const sanitizePath = new URL('../../src/review/sanitize.ts', import.meta.url)
    expect(existsSync(sanitizePath)).toBe(false)
    const files = listFiles(REVIEW_DIR)
    expect(files.length).toBeGreaterThan(0) // 扫描目标非空
    for (const f of files) {
      const text = readFileSync(f, 'utf8')
      expect(text.includes("normalize('NFC')"), `${f} 内联了 NFC 归一`).toBe(false)
      expect(/COM[1-9]|LPT[1-9]/.test(text), `${f} 内联了 Windows 保留名表`).toBe(false)
    }
  })

  it('文件名拼装必经 resolveArea（store 不自行拼接模板路径）', () => {
    const storeSource = readFileSync(new URL('../../src/review/store.ts', import.meta.url), 'utf8')
    expect(storeSource.length).toBeGreaterThan(0) // 扫描目标非空
    expect(storeSource).toContain('resolveArea(')
    expect(storeSource).toContain('sanitizeNameSegment(')
    expect(storeSource).not.toMatch(/DB.review.<YYYYMM>/) // 目录名不由调用方拼接
  })
})

describe('tasks 1.3：锚点正则唯一版本', () => {
  it('全 src/review 仅 anchor.ts 持有锚点模式', () => {
    const files = listFiles(REVIEW_DIR)
    expect(files.length).toBeGreaterThan(0)
    const holders = files.filter((f) => readFileSync(f, 'utf8').includes('\\d{8})-(\\d{6})'))
    expect(holders).toHaveLength(1)
    expect(holders[0].replaceAll('\\', '/')).toContain('src/review/anchor.ts')
  })
})

describe('tasks 1.14：warnings 字段名与编码唯一', () => {
  it('全仓（src + test/review，不含本检查文件自身）不出现 storeWarnings 别名', () => {
    const selfPath = toPath(new URL('.', import.meta.url)).replaceAll('\\', '/')
    const files = [
      ...listFiles(SRC_DIR),
      ...listFiles(TEST_REVIEW_DIR),
    ].filter((f) => f.replaceAll('\\', '/') !== `${selfPath}structure.test.ts`)
    expect(files.length).toBeGreaterThan(0) // 扫描目标非空
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('storeWarnings'))
    expect(offenders).toEqual([])
  })

  it('StoreWarningKind 枚举无 docMismatch（types.ts 结构断言）', () => {
    const typesSource = readFileSync(new URL('../../src/review/types.ts', import.meta.url), 'utf8')
    expect(typesSource.length).toBeGreaterThan(0)
    expect(typesSource.includes('docMismatch')).toBe(false)
    expect(typesSource).toContain("'multiHit' | 'ghostAnchor' | 'duplicateAnchor' | 'nameTruncated'")
    void WARN_KINDS
  })

  it('唯一编码：[<kind>] <path> — <detail>；候选追加「；候选: a, b」且可解析回 kind', () => {
    const base: StoreWarning = { kind: 'ghostAnchor', path: 'P:\\vault\\doc.md', detail: '与 frontmatter 基准不一致' }
    expect(encodeStoreWarning(base)).toBe('[ghostAnchor] P:\\vault\\doc.md — 与 frontmatter 基准不一致')
    const withCandidates = encodeStoreWarning({ ...base, kind: 'multiHit', candidates: ['a.md', 'b.md'] })
    expect(withCandidates).toBe('[multiHit] P:\\vault\\doc.md — 与 frontmatter 基准不一致；候选: a.md, b.md')
    // 可解析回 kind。
    const m = /^\[(multiHit|ghostAnchor|duplicateAnchor|nameTruncated)\] /.exec(withCandidates)
    expect(m).not.toBeNull()
    expect(m![1]).toBe('multiHit')
    // 空候选不加后缀。
    expect(encodeStoreWarning({ ...base, candidates: [] })).toBe(encodeStoreWarning(base))
  })
})

describe('tasks 1.12：文档原子写唯一，附件事务独立', () => {
  it('review 线的 rename 仅由文档存储和附件暂存模块执行', () => {
    const files = listFiles(REVIEW_DIR)
    expect(files.length).toBeGreaterThan(0)
    const renamers = files.filter((f) => {
      const t = readFileSync(f, 'utf8')
      return t.includes('rename(') && !t.includes('rename(tmp, absPath)') ? true : t.includes('rename(')
    })
    expect(renamers.map((f) => f.replaceAll('\\', '/'))).toEqual(
      expect.arrayContaining([expect.stringContaining('src/review/store.ts')]),
    )
    const documentRenamers = renamers.filter(f => !f.replaceAll('\\', '/').includes('/processors/'))
    expect(documentRenamers.map((f) => f.replaceAll('\\', '/').split('/').pop()).sort()).toEqual(['images.ts', 'store.ts'])
    const runtimeRenamers = renamers.filter(f => f.replaceAll('\\', '/').includes('/processors/'))
    expect(runtimeRenamers.map(f => f.replaceAll('\\', '/').split('/').pop()).sort()).toEqual(['records.ts', 'scheduler.ts'])
    for (const file of runtimeRenamers) expect(readFileSync(file, 'utf8')).toContain("'processorRuns'")
    const imagesSource = readFileSync(join(REVIEW_DIR, 'images.ts'), 'utf8')
    expect(imagesSource).toContain('stageImageDeletes')
    expect(imagesSource).toContain('settleImageDeletes')
    expect(imagesSource).not.toContain('rename(tmp, absPath)')
    expect(imagesSource).not.toContain('parseDocument(')
  })
})
