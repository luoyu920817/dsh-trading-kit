/**
 * 首卡懒创建单测（review-loop tasks 2.8；零 mock：真实临时目录 + 真实文件）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createStockProfileIfMissing, NAME_UNAVAILABLE, renderProfileSkeleton } from '../../src/review/profile-create.ts'

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dtk-profile-create-'))
}

function stockDir(root: string): string {
  const dir = join(root, 'DB', 'stock')
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('骨架形态', () => {
  it('renderProfileSkeleton：代码 键 + 空 角色 + 股性/记录 小节 + 组件嵌入', () => {
    const text = renderProfileSkeleton('603919')
    expect(text).toContain('代码: "603919"')
    expect(text).toContain('板块:')
    expect(text).toContain('当前题材:')
    expect(text).toContain('题材地位:')
    expect(text).toContain('热点标签:')
    expect(text).toContain('角色:')
    expect(text).toContain('# 股性')
    expect(text).toContain('# 记录')
    expect(text).toContain('![[stock-info.components]]')
    // MUST NOT 猜测取值：骨架不含 锚点 / 角色 的赋值。
    expect(text).not.toContain('锚点: true')
    expect(text).not.toMatch(/角色: "/)
  })
})

describe('懒创建：创建与幂等', () => {
  it('首次创建成功（骨架落盘、路径 = DB/stock/<名称>.md）', async () => {
    const root = makeRoot()
    stockDir(root)
    const out = await createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '金徽酒' })
    expect(out.status).toBe('created')
    expect(out.path.replaceAll('\\', '/')).toBe('DB/stock/金徽酒.md')
    expect(out.warnings).toEqual([])
    const text = readFileSync(join(root, 'DB', 'stock', '金徽酒.md'), 'utf8')
    expect(text).toContain('代码: "603919"')
    expect(text).toContain('角色:')
  })

  it('二次调用（档案已存在）→ skipped 且既有档案字节与 mtime 零改动', async () => {
    const root = makeRoot()
    stockDir(root)
    await createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '金徽酒' })
    const full = join(root, 'DB', 'stock', '金徽酒.md')
    // owner 补写内容（模拟人工维护）。
    writeFileSync(full, readFileSync(full, 'utf8').replace('角色:', '角色: "白酒"'), 'utf8')
    const before = { text: readFileSync(full, 'utf8'), mtime: statSync(full).mtimeMs }
    const out = await createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '金徽酒' })
    expect(out.status).toBe('skipped')
    expect(out.reason).toBe('exists')
    expect(readFileSync(full, 'utf8')).toBe(before.text)
    expect(statSync(full).mtimeMs).toBe(before.mtime)
  })

  it('并发两次 → 只创建一份（wx 排他语义）', async () => {
    const root = makeRoot()
    stockDir(root)
    const results = await Promise.all([
      createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '金徽酒' }),
      createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '金徽酒' }),
    ])
    expect(results.filter((r) => r.status === 'created')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'skipped')).toHaveLength(1)
  })
})

describe('懒创建：不建与冲突分支', () => {
  it('名称为空 → 不建（告警 nameUnavailable，MUST NOT 用 <代码>.md 代替）', async () => {
    const root = makeRoot()
    stockDir(root)
    const out = await createStockProfileIfMissing({ dataRoot: root, code: '603919', name: null })
    expect(out.status).toBe('skipped')
    expect(out.reason).toBe('nameUnavailable')
    expect(out.warnings[0]).toContain(NAME_UNAVAILABLE)
    expect(existsSync(join(root, 'DB', 'stock', '603919.md'))).toBe(false)
  })

  it('名称退化为代码 → 不建', async () => {
    const root = makeRoot()
    stockDir(root)
    const out = await createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '603919' })
    expect(out.status).toBe('skipped')
    expect(out.reason).toBe('nameUnavailable')
  })

  it('同名档案 代码 不一致 → 放弃 + 告警，既有档案零改动', async () => {
    const root = makeRoot()
    const dir = stockDir(root)
    writeFileSync(join(dir, '万科A.md'), '---\n代码: "000001"\n角色: "银行"\n---\n', 'utf8')
    const before = readFileSync(join(dir, '万科A.md'), 'utf8')
    const out = await createStockProfileIfMissing({ dataRoot: root, code: '000002', name: '万科A' })
    expect(out.status).toBe('skipped')
    expect(out.reason).toBe('codeMismatch')
    expect(out.warnings[0]).toContain('不一致')
    expect(readFileSync(join(dir, '万科A.md'), 'utf8')).toBe(before)
  })

  it('建档失败（DB/stock 被同名文件占位）→ skipped + 告警，不抛出（不影响写卡）', async () => {
    const root = makeRoot()
    mkdirSync(join(root, 'DB'), { recursive: true })
    writeFileSync(join(root, 'DB', 'stock'), '不是目录', 'utf8') // 目标父路径被文件占位 → writeFile ENOTDIR
    const out = await createStockProfileIfMissing({ dataRoot: root, code: '603919', name: '金徽酒' })
    expect(out.status).toBe('skipped')
    expect(out.warnings.length).toBe(1)
    expect(out.warnings[0]).toContain('建档失败')
  })
})
