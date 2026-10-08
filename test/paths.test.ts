/**
 * 数据目录范式单测（change data-foundation tasks 2.1–2.6）。
 * 零 mock：真实临时目录（fs.mkdtemp）+ 真实文件系统断言。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AREA_TABLE } from '../src/paths/mapping.ts'
import { ensureDir } from '../src/paths/fs.ts'
import { detectDataRootMismatch } from '../src/paths/migrate-notice.ts'
import { resolveArea, resolveRelativeUnderRoot, PathResolveError } from '../src/paths/resolve.ts'
import { sanitizeNameSegment } from '../src/paths/sanitize.ts'

let root = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dtk-paths-'))
})

afterEach(() => {
  // 临时目录留给 OS temp 清理；不在测试里做删除（避免 Windows 句柄竞争）。
  void root
})

describe('业务区表穷举', () => {
  it('8 个业务区 key 的目录解析结果与映射表一致', () => {
    expect(Object.keys(AREA_TABLE).sort()).toEqual(
      ['agentSkills', 'brief', 'cache', 'macro', 'patterns', 'review', 'stock', 'whiteboard'].sort(),
    )
    // 复盘卡片：date 折算月目录段。
    const review = resolveArea(root, 'review', { code: '600000', name: '浦发银行', date: '20260924' })
    expect(review.relPath.replaceAll('\\', '/')).toBe('DB/review/202609/600000_浦发银行_20260924.md')
    // 当日盘面整理（review-loop）：与卡片区共月目录、文件名模板 <date>-summary.md。
    const brief = resolveArea(root, 'brief', { date: '20260924' })
    expect(brief.relPath.replaceAll('\\', '/')).toBe('DB/review/202609/20260924-summary.md')
    // 标的档案（review-loop）：既有 DB/stock，无文件名模板（消费层按名称直配）。
    expect(resolveArea(root, 'stock').relPath.replaceAll('\\', '/')).toBe('DB/stock')
    // 缓存区：按 requestedDate 折算天级目录。
    const cache = resolveArea(root, 'cache', { date: '20260924' })
    expect(cache.relPath.replaceAll('\\', '/')).toBe('agent/DB/temp/dsh-trader-kit/20260924')
    // 自产 skill：既有区。
    expect(resolveArea(root, 'agentSkills').relPath.replaceAll('\\', '/')).toBe('agent/skills')
    // 宏观区解析返回既有 题材调研/00宏观/（非裸根，MUST NOT 新造目录名）。
    expect(resolveArea(root, 'macro').relPath.replaceAll('\\', '/')).toBe('题材调研/00宏观')
    expect(resolveArea(root, 'whiteboard').relPath.replaceAll('\\', '/')).toBe('交易系统/平常心/方法论')
    expect(resolveArea(root, 'patterns').relPath.replaceAll('\\', '/')).toBe('交易系统/平常心/方法论/模式')
  })

  it('未登记写入用业务区报错（列出已定义业务区）', () => {
    expect(() => resolveArea(root, 'unknown' as never)).toThrow(PathResolveError)
    expect(() => resolveArea(root, 'unknown' as never)).toThrow(/review/)
  })

  it('预留区仅登记：forWrite 显式报错；只解析返回既有路径', () => {
    expect(() => resolveArea(root, 'macro', {}, { forWrite: true })).toThrow(/预留区/)
    expect(resolveArea(root, 'macro').relPath).toContain('题材调研')
  })
})

describe('文件名模板与参数白名单', () => {
  it('注入用例被净化（../../etc、a/b、CON、空名），结果不越出业务区', () => {
    const areaDir = join(root, 'DB', 'review', '202609')
    const cases: Array<[string, string]> = [
      ['../../etc', '.._.._etc'],
      ['a/b', 'a_b'],
      ['CON', 'CON_'], // 保留名加 _ 后缀，与模板分隔符叠加为双下划线
      ['', '600000'], // 空名 → 代码段兜底
    ]
    for (const [raw, expectedName] of cases) {
      const r = resolveArea(root, 'review', { code: '600000', name: raw, date: '20260924' })
      expect(r.absPath.startsWith(areaDir)).toBe(true)
      // 越界防护口径：任何路径段都不等于 '..'（'.._.._etc' 是单段文件名，非穿越）。
      expect(r.relPath.split(/[\\/]/)).not.toContain('..')
      expect(r.relPath.endsWith(`600000_${expectedName}_20260924.md`)).toBe(true)
    }
  })

  it('参数白名单拒绝：5 位 code、canonical 日期直传（提示经 toCompactDate）', () => {
    expect(() => resolveArea(root, 'review', { code: '60000', name: 'x', date: '20260924' }))
      .toThrow(/code/)
    expect(() => resolveArea(root, 'review', { code: '6000000', name: 'x', date: '20260924' }))
      .toThrow(/code/)
    try {
      resolveArea(root, 'review', { code: '600000', name: 'x', date: '2026-09-24' })
      expect.unreachable('canonical 日期直传必须被拒')
    } catch (e) {
      expect((e as Error).message).toContain('toCompactDate')
    }
    // 真实日历校验：20261301（13 月）被拒。
    expect(() => resolveArea(root, 'cache', { date: '20261301' })).toThrow()
  })

  it('名称超长与保留名：截断 ≤40 并记 nameTruncated、保留名加 _', () => {
    const long = '横'.repeat(50)
    const r = resolveArea(root, 'review', { code: '600000', name: long, date: '20260924' })
    const nameSeg = r.relPath.split(/[/\\]/).at(-1)!.split('_')[1]
    expect([...nameSeg].length).toBeLessThanOrEqual(40)
    expect(r.nameTruncated).toBe(true)
    expect(resolveArea(root, 'review', { code: '600000', name: 'NUL', date: '20260924' }).relPath)
      .toContain('NUL_')
  })

  it('净化不改变既有文件名：同一 (code,date,name) 两次解析同名', () => {
    const a = resolveArea(root, 'review', { code: '600000', name: '*ST 浦东/新', date: '20260924' })
    const b = resolveArea(root, 'review', { code: '600000', name: '*ST 浦东/新', date: '20260924' })
    expect(a.absPath).toBe(b.absPath)
    expect(a.nameTruncated).toBe(b.nameTruncated)
  })

  it('sanitizeNameSegment 返回形状：{ value, nameTruncated }', () => {
    expect(sanitizeNameSegment('正常名称')).toEqual({ value: '正常名称', nameTruncated: false })
    expect(sanitizeNameSegment('x'.repeat(41)).nameTruncated).toBe(true)
  })
})

describe('路径越界防护', () => {
  it('路径越界拒绝：.. 段与绝对路径', () => {
    expect(() => resolveRelativeUnderRoot(root, '../outside')).toThrow(PathResolveError)
    expect(() => resolveRelativeUnderRoot(root, 'a/../../b')).toThrow(PathResolveError)
    expect(() => resolveRelativeUnderRoot(root, 'C:\\Windows\\evil')).toThrow(PathResolveError)
    expect(() => resolveRelativeUnderRoot(root, 'agent/DB/temp/dsh-trader-kit/20260924/x.json')).not.toThrow()
  })

  it('数据根为空时拒绝（含配置指引）', () => {
    expect(() => resolveRelativeUnderRoot('', 'any')).toThrow(/dataRoot/)
  })
})

describe('目录自动创建', () => {
  it('缺失目录首次写入：创建 <dataRoot>/DB/review/202609/ 目录链', async () => {
    const { absPath, areaDirAbs } = resolveArea(root, 'review', { code: '600000', name: '浦发银行', date: '20260924' })
    await ensureDir(areaDirAbs)
    expect(existsSync(areaDirAbs)).toBe(true)
    expect(statSync(areaDirAbs).isDirectory()).toBe(true)
    expect(absPath.startsWith(areaDirAbs)).toBe(true)
  })

  it('既有目录不被改动：预置文件后 ensureDir，mtime 与内容不变', async () => {
    const dir = resolveArea(root, 'cache', { date: '20260924' }).areaDirAbs
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'other-skill-product.json')
    writeFileSync(file, '{"keep":true}', 'utf8')
    const before = statSync(file)
    await ensureDir(dir)
    const after = statSync(file)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(readFileSync(file, 'utf8')).toBe('{"keep":true}')
    expect(readdirSync(dir)).toEqual(['other-skill-product.json'])
  })
})

describe('数据根迁移显式后置', () => {
  it('数据根变更后给出非阻断提示（A 根预置产物、当前 B 根）', () => {
    const oldRoot = mkdtempSync(join(tmpdir(), 'dtk-old-'))
    mkdirSync(join(oldRoot, 'DB'), { recursive: true })
    const result = detectDataRootMismatch(root, [oldRoot])
    expect(result.notice).not.toBeNull()
    expect(result.blocking).toBe(false)
  })

  it('无候选残留时无提示；当前根自身不提示', () => {
    expect(detectDataRootMismatch(root, []).notice).toBeNull()
    mkdirSync(join(root, 'DB'), { recursive: true })
    expect(detectDataRootMismatch(root, [root]).notice).toBeNull()
  })
})
