/**
 * 日期格式单点实现单测（change data-foundation tasks 4.5）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  fromCompactDate,
  isValidIsoDate,
  normalizeToIsoDate,
  rateLimitDate,
  toCompactDate,
  toMonthSegment,
} from '../src/data/date.ts'

describe('YYYY-MM-DD ⇄ YYYYMMDD 双向转换', () => {
  it('双向转换含闰年 20240229', () => {
    expect(toCompactDate('2026-09-24')).toBe('20260924')
    expect(fromCompactDate('20260924')).toBe('2026-09-24')
    expect(toCompactDate('2024-02-29')).toBe('20240229')
    expect(fromCompactDate('20240229')).toBe('2024-02-29')
  })

  it('toMonthSegment 折算月目录段（复盘卡片 <YYYYMM>）', () => {
    expect(toMonthSegment('20260924')).toBe('202609')
    expect(toMonthSegment('20261001')).toBe('202610')
  })

  it('normalizeToIsoDate 双格式归一为 canonical', () => {
    expect(normalizeToIsoDate('2026-09-24')).toBe('2026-09-24')
    expect(normalizeToIsoDate('20260924')).toBe('2026-09-24')
    expect(normalizeToIsoDate('2026/09/24')).toBeNull()
  })
})

describe('非法日期被拒', () => {
  it('toCompactDate 对非法输入显式抛错（2026-13-01 / 2026/09/24 / 202609）', () => {
    for (const bad of ['2026-13-01', '2026/09/24', '202609', '2026-02-30', '']) {
      expect(() => toCompactDate(bad)).toThrow()
    }
  })

  it('fromCompactDate / toMonthSegment 对非法紧凑输入拒绝', () => {
    expect(fromCompactDate('202609')).toBeNull()
    expect(fromCompactDate('20261301')).toBeNull()
    expect(() => toMonthSegment('202609')).toThrow()
    expect(() => toMonthSegment('20261301')).toThrow()
  })

  it('isValidIsoDate 校验真实日历（闰年接受 0229、平月 30 拒绝）', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true)
    expect(isValidIsoDate('2023-02-29')).toBe(false)
    expect(isValidIsoDate('2026-04-31')).toBe(false)
    expect(isValidIsoDate('2026-04-30')).toBe(true)
  })
})

describe('限流日按 Asia/Shanghai 计算', () => {
  it('跨 UTC 零点用例：UTC 17:00 已是上海次日、UTC 15:59 仍是当日', () => {
    // 2026-09-27T17:00:00Z + 8h = 上海 2026-09-28 01:00
    expect(rateLimitDate(new Date('2026-09-27T17:00:00Z'))).toBe('2026-09-28')
    // 2026-09-27T15:59:00Z + 8h = 上海 2026-09-27 23:59
    expect(rateLimitDate(new Date('2026-09-27T15:59:00Z'))).toBe('2026-09-27')
    // 2026-12-31T16:01:00Z + 8h = 上海 2027-01-01 00:01（跨年）
    expect(rateLimitDate(new Date('2026-12-31T16:01:00Z'))).toBe('2027-01-01')
  })
})

describe('格式唯一性：src/data/** 内除 date.ts 外无自定义日期截断/拼接（结构断言）', () => {
  it('扫描目标非空且其它文件零日期串操作（deferred 域随波次扩充自动生效）', () => {
    const dataDir = join(import.meta.dirname, '..', 'src', 'data')
    const files = readdirSync(dataDir).filter((f) => f.endsWith('.ts'))
    // 前置：扫描目标非空（防空过）。
    expect(files.length).toBeGreaterThan(0)
    expect(files).toContain('date.ts')
    const suspects = files.filter((f) => f !== 'date.ts').map((f) => join(dataDir, f))
    suspects.push(join(import.meta.dirname, '..', 'src', 'index.ts'))
    const dateOpRe = /replace\(\s*\/-|slice\(\s*0\s*,\s*10\s*\)|substring\(\s*0\s*,\s*10\s*\)/
    for (const file of suspects) {
      const text = readFileSync(file, 'utf8')
      expect(dateOpRe.test(text), `${file} 疑似自定义日期截断/拼接（应经 src/data/date.ts）`).toBe(false)
    }
  })
})
