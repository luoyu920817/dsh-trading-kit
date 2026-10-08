/**
 * 标的档案读取单测（review-loop `stock-profile` tasks 2.3；零 mock：
 * 真实临时目录 + 真实文件）。
 */
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readStockProfiles, STOCK_DIR_MISSING } from '../../src/review/profile.ts'

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dtk-profile-'))
}

function writeProfile(root: string, fileName: string, frontmatter: string, body = ''): string {
  const dir = join(root, 'DB', 'stock')
  mkdirSync(dir, { recursive: true })
  const full = join(dir, fileName)
  writeFileSync(full, `---\n${frontmatter}\n---\n\n${body}`, 'utf8')
  return full
}

describe('档案读取：目录缺失与空表', () => {
  it('目录不存在 → 空表 + stockDirMissing（不是错误）', async () => {
    const root = makeRoot()
    const out = await readStockProfiles(root, { codes: ['600000'], names: ['浦发银行'] })
    expect(out.entries).toEqual([])
    expect(out.warnings.length).toBe(1)
    expect(out.warnings[0]).toContain(STOCK_DIR_MISSING)
  })

  it('数据根未配置 → 空表 + dataRootUnconfigured', async () => {
    const out = await readStockProfiles('', { codes: ['600000'] })
    expect(out.entries).toEqual([])
    expect(out.warnings[0]).toContain('dataRootUnconfigured')
  })
})

describe('档案读取：定位规则（名称直配 → 代码索引 → 未命中）', () => {
  it('名称直配命中且 代码 一致', async () => {
    const root = makeRoot()
    const p = writeProfile(root, '万科A.md', '代码: "000002"\n角色: "中军"\n热点标签: 房地产, 权重')
    const out = await readStockProfiles(root, { codes: ['000002'], names: ['万科A'] })
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0]).toMatchObject({
      code: '000002',
      name: '万科A',
      role: '中军',
      isAnchor: false,
      hotTags: ['房地产', '权重'],
      path: 'DB/stock/万科A.md',
    })
    expect(out.warnings).toEqual([])
    expect(statSync(p).size).toBeGreaterThan(0)
  })

  it('名称退化（等于代码）时走 代码 索引兜底', async () => {
    const root = makeRoot()
    writeProfile(root, '中证1000.md', '代码: "000852"\n角色: "小盘科技"')
    const out = await readStockProfiles(root, { codes: ['000852'], names: ['000852'] })
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].name).toBe('中证1000')
    expect(out.entries[0].code).toBe('000852')
  })

  it('双未命中 → 不入结果且无告警（不是错误）', async () => {
    const root = makeRoot()
    writeProfile(root, '万科A.md', '代码: "000002"')
    const out = await readStockProfiles(root, { codes: ['600519'], names: ['贵州茅台'] })
    expect(out.entries).toEqual([])
    expect(out.warnings).toEqual([])
  })

  it('代码 与目标不一致 → 告警且不注入（宁缺勿错）', async () => {
    const root = makeRoot()
    writeProfile(root, '万科A.md', '代码: "000001"')
    const out = await readStockProfiles(root, { codes: ['000002'], names: ['万科A'] })
    expect(out.entries).toEqual([])
    expect(out.warnings.length).toBe(1)
    expect(out.warnings[0]).toContain('不一致')
    expect(out.warnings[0]).toContain('000002')
  })

  it('一代码多档案 → 告警 + 取 mtime 最新', async () => {
    const root = makeRoot()
    const older = writeProfile(root, '万科A.md', '代码: "000002"')
    const newer = writeProfile(root, '万科A旧.md', '代码: "000002"')
    // 明确制造 mtime 差异（不依赖写入顺序的时钟粒度）。
    const now = Date.now()
    writeFileSync(older, readFileSync(older))
    const t = new Date(now - 60_000)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { utimesSync } = await import('node:fs')
    utimesSync(older, t, t)
    const out = await readStockProfiles(root, { codes: ['000002'], names: ['不存在'] })
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0].name).toBe('万科A旧')
    expect(out.warnings.some((w) => w.includes('多档案'))).toBe(true)
    void newer
  })
})

describe('档案读取：降级矩阵与注入面收窄', () => {
  it('空壳档案（仅 板块）/ 有 角色 无其它 / 有 热点标签 无 角色 三类均命中无告警', async () => {
    const root = makeRoot()
    writeProfile(root, '甲.md', '板块: ')
    writeProfile(root, '乙.md', '角色: "情绪主锚"')
    writeProfile(root, '丙.md', '热点标签: 算力, 液冷')
    const out = await readStockProfiles(root, { codes: ['000001', '000002', '000003'], names: ['甲', '乙', '丙'] })
    expect(out.entries.map((e) => [e.name, e.role])).toEqual([
      ['甲', null],
      ['乙', '情绪主锚'],
      ['丙', null],
    ])
    expect(out.warnings).toEqual([])
  })

  it('注入面收窄：出参不含 板块/当前题材/题材地位 等展示字段（热点标签 仅以 hotTags 展示面出现）', async () => {
    const root = makeRoot()
    writeProfile(root, '万科A.md', '代码: "000002"\n板块: 房地产\n当前题材: 地产链\n题材地位: 走强\n热点标签: 房地产\n角色: "中军"', '# 股性\n\n长文笔记')
    const out = await readStockProfiles(root, { codes: ['000002'], names: ['万科A'] })
    const entry = out.entries[0] as unknown as Record<string, unknown>
    expect(Object.keys(entry).sort()).toEqual(['code', 'hotTags', 'isAnchor', 'name', 'path', 'role'])
    expect(JSON.stringify(entry)).not.toContain('地产链')
    expect(JSON.stringify(entry)).not.toContain('走强')
    expect(JSON.stringify(entry)).not.toContain('长文笔记')
  })

  it('零出站 + 只读：读取前后文件字节与 mtime 不变', async () => {
    const root = makeRoot()
    const p = writeProfile(root, '微盘股.md', '代码: "880823"\n角色: "情绪周期｜向上有，向下无"\n锚点: true')
    const before = { text: readFileSync(p, 'utf8'), mtime: statSync(p).mtimeMs }
    await readStockProfiles(root, { codes: ['880823'], names: ['微盘股'] })
    await readStockProfiles(root, {})
    expect(readFileSync(p, 'utf8')).toBe(before.text)
    expect(statSync(p).mtimeMs).toBe(before.mtime)
  })
})

describe('档案读取：全锚点清单（盘面 md 指数段成员）', () => {
  it('缺省返回全部 锚点: true 且含 代码 者（按 code 升序）；锚点缺 代码 记告警并排除', async () => {
    const root = makeRoot()
    writeProfile(root, '昨日涨停.md', '代码: "880863"\n角色: "赚钱效应"\n锚点: true')
    writeProfile(root, '上证指数.md', '代码: "999999"\n角色: "情绪主锚"\n锚点: true')
    writeProfile(root, '缺码锚点.md', '角色: "整体"\n锚点: true')
    writeProfile(root, '万科A.md', '代码: "000002"\n角色: "中军"')
    const out = await readStockProfiles(root, {})
    expect(out.entries.map((e) => e.code)).toEqual(['880863', '999999'])
    expect(out.entries.every((e) => e.isAnchor)).toBe(true)
    expect(out.warnings.length).toBe(1)
    expect(out.warnings[0]).toContain('缺码锚点.md')
    expect(out.warnings[0]).toContain('锚点缺 代码')
  })

  it('非法代码入参 → 告警跳过（不猜测）', async () => {
    const root = makeRoot()
    writeProfile(root, '万科A.md', '代码: "000002"')
    const out = await readStockProfiles(root, { codes: ['abc123'], names: ['浦发银行'] })
    expect(out.entries).toEqual([])
    expect(out.warnings.some((w) => w.includes('非法代码'))).toBe(true)
  })
})
