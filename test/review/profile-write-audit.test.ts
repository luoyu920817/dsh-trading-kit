/**
 * 写路径审计（review-loop tasks 2.9）：`DB/stock` 只建不改 + skill 安装白名单不变。
 * 源码级断言（先断言扫描目标非空，避免空过）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { dataRootWhitelistPaths } from '../../src/skill/root.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = join(REPO_ROOT, 'src')

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  if (statSync(dir).isFile()) return dir.endsWith('.ts') ? [dir] : []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? listTsFiles(p) : e.name.endsWith('.ts') ? [p] : []
  })
}

function rel(path: string): string {
  return path.slice(REPO_ROOT.length).split('\\').join('/')
}

describe('DB/stock 写路径审计（只建不改）', () => {
  it('扫描目标非空', () => {
    expect(listTsFiles(SRC).length).toBeGreaterThan(0)
  })

  it('唯一持有建档写入的文件 = src/review/profile-create.ts（其余 src/** 零 stock 区写入标记）', () => {
    const writers = listTsFiles(SRC).filter((f) => {
      const text = readFileSync(f, 'utf8')
      const mentionsStockArea = text.includes("'stock'") || text.includes('"stock"') || text.includes('DB/stock')
      const writes = text.includes('writeFile(') || text.includes('rename(') || text.includes('unlink(') || text.includes('rm(')
      return mentionsStockArea && writes
    })
    expect(writers.map(rel)).toEqual(['src/review/profile-create.ts'])
  })

  it('建档实现只含 create-only 语义：`wx` 排他创建、无 rename/rm 覆盖路径', () => {
    const text = readFileSync(join(SRC, 'review', 'profile-create.ts'), 'utf8')
    expect(text).toContain("flag: 'wx'")
    expect(text).not.toContain('rename(')
    expect(text).not.toContain('rm(')
    // 覆盖/补键类调用零出现（唯一写入点为 wx 创建）。
    const writeCalls = text.match(/writeFile\(/g) ?? []
    expect(writeCalls.length).toBe(1)
  })

  it('skill 安装白名单仍为三条（DB/stock 不进该清单——避免放宽 skill 安装落点）', () => {
    const paths = dataRootWhitelistPaths('C:/data-root')
    expect(paths).toHaveLength(3)
    expect(paths.join('\n')).not.toContain('stock')
    expect(paths.join('\n')).toContain('DB')
    expect(paths.join('\n')).toContain('review')
  })
})
