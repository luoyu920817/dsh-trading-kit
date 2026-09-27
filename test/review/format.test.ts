/**
 * change 4 tasks 1.13：时间格式化单点（含「全仓唯一 +08:00 拼装」结构断言）。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { anchorTimeToHeading, formatAnchorTime, formatZonedIso } from '../../src/review/format.ts'
import { srcText } from './helpers.ts'

describe('formatZonedIso / formatAnchorTime', () => {
  it('输出固定 +08:00 偏移（不用本地时区）', () => {
    // UTC 06:32:05 → 东八 14:32:05；测试机本地时区不影响结果。
    const d = new Date('2026-09-24T06:32:05Z')
    expect(formatZonedIso(d)).toBe('2026-09-24T14:32:05+08:00')
    expect(formatZonedIso(d)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
    // 跨日边界：UTC 2026-09-24T16:30:00Z → 东八 2026-09-25T00:30:00+08:00。
    expect(formatZonedIso(new Date('2026-09-24T16:30:00Z'))).toBe('2026-09-25T00:30:00+08:00')
    // 年初边界。
    expect(formatZonedIso(new Date('2025-12-31T16:00:01Z'))).toBe('2026-01-01T00:00:01+08:00')
  })

  it('锚点时间段 HHmm 与分节标题 HH:mm 同源折算', () => {
    const d = new Date('2026-09-24T06:32:05Z')
    const hhmm = formatAnchorTime(d)
    expect(hhmm).toBe('1432')
    expect(anchorTimeToHeading(hhmm)).toBe('14:32')
    // 零点补零。
    expect(formatAnchorTime(new Date('2026-09-24T16:00:00Z'))).toBe('0000')
  })

  it('writtenAt 与（change 5 的）generatedAt 消费同一导出（同输入同输出）', () => {
    const d = new Date('2026-09-24T06:32:05Z')
    expect(formatZonedIso(d)).toBe(formatZonedIso(new Date(d.getTime())))
  })
})

describe('结构断言：全仓唯一 +08:00 偏移拼装点（tasks 1.13）', () => {
  function collectTsFiles(dir: string, out: string[]): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) collectTsFiles(full, out)
      else if (name.endsWith('.ts')) out.push(full)
    }
    return out
  }

  it('src/review/** 内仅 format.ts 一处 +08:00 拼装；formatZonedIso 唯一定义', () => {
    const reviewDir = new URL('../../src/review', import.meta.url).pathname
      .replace(/^\/([A-Za-z]:)/, '$1') // Windows URL pathname 盘符修正
    const files = collectTsFiles(reviewDir, [])
    expect(files.length).toBeGreaterThan(0) // 扫描目标非空
    const withOffset = files.filter((f) => readFileSync(f, 'utf8').includes('+08:00'))
    expect(withOffset.length).toBe(1)
    expect(withOffset[0].replaceAll('\\', '/')).toContain('src/review/format.ts')
    const withFormatter = files.filter((f) => readFileSync(f, 'utf8').includes('function formatZonedIso'))
    expect(withFormatter).toEqual(withOffset)
  })

  it('src 全树内 +08:00 拼装仅 src/review/format.ts 一处（src/data/** 为数据线辖区，另行登记）', () => {
    const srcDir = new URL('../../src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
    const files = collectTsFiles(srcDir, [])
    expect(files.length).toBeGreaterThan(0) // 扫描目标非空
    const holders = files
      .filter((f) => !f.replaceAll('\\', '/').includes('/src/data/'))
      .filter((f) => readFileSync(f, 'utf8').includes('+08:00'))
    // 登记：src/data/**（数据线并行落地）存在各自的 +08:00 拼装，属跨线冲突，
    // 收敛后由 6.3⑧ 全仓断言接管；此处断言 review 线边界内唯一。
    expect(holders.map((f) => f.replaceAll('\\', '/'))).toEqual([
      expect.stringContaining('src/review/format.ts'),
    ])
  })

  it('src/review 内不存在第二份 ISO 格式化实现（formatAnchorTime/formatZonedIso 仅 format.ts 导出）', () => {
    const formatSource = srcText('../../src/review/format.ts')
    expect(formatSource).toContain('export function formatZonedIso')
    expect(formatSource).toContain('export function formatAnchorTime')
    expect(formatSource.length).toBeGreaterThan(0) // 扫描目标非空
  })
})
