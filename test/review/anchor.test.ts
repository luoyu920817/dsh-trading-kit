/**
 * change 4 tasks 1.3：normalizeCode 与锚点正则唯一版本。
 */
import { describe, expect, it } from 'vitest'
import { AINOTE_ANCHOR_RE, CARD_ANCHOR_RE, buildAnchor, normalizeCode } from '../../src/review/anchor.ts'

describe('normalizeCode（去壳不补全不猜测）', () => {
  it('市场前缀/后缀归一（大小写不敏感）', () => {
    expect(normalizeCode('600000')).toBe('600000')
    expect(normalizeCode('SH600000')).toBe('600000')
    expect(normalizeCode('sh600000')).toBe('600000')
    expect(normalizeCode('600000.SH')).toBe('600000')
    expect(normalizeCode('600000.sh')).toBe('600000')
    expect(normalizeCode('SZ000001')).toBe('000001')
    expect(normalizeCode('bj430047')).toBe('430047')
    expect(normalizeCode('  600000  ')).toBe('600000')
  })

  it('保留前导零', () => {
    expect(normalizeCode('000001')).toBe('000001')
    expect(normalizeCode('sz000001')).toBe('000001')
  })

  it('不补全不猜测：位数不符与非数字一律 null', () => {
    expect(normalizeCode('60000')).toBeNull()
    expect(normalizeCode('6000000')).toBeNull()
    expect(normalizeCode('abc')).toBeNull()
    expect(normalizeCode('')).toBeNull()
    expect(normalizeCode('sh')).toBeNull()
    expect(normalizeCode('60000.SZ')).toBeNull()
    expect(normalizeCode('600000.SH.')).toBeNull()
    expect(normalizeCode('60000 0')).toBeNull()
  })
})

describe('锚点正则唯一版本（写入/解析/幂等共用）', () => {
  it('卡片锚点：日期-代码-HHmm 与可选 -<seq> 序号段', () => {
    const m = CARD_ANCHOR_RE.exec('card-20260924-600000-1432')
    expect(m).not.toBeNull()
    expect(m?.[1]).toBe('20260924')
    expect(m?.[2]).toBe('600000')
    expect(m?.[3]).toBe('1432')
    expect(m?.[4]).toBeUndefined()
    const m2 = CARD_ANCHOR_RE.exec('card-20260924-600000-1432-2')
    expect(m2?.[4]).toBe('2')
  })

  it('附注锚点同形；非法形态不匹配', () => {
    expect(AINOTE_ANCHOR_RE.test('ainote-20260924-600000-1500')).toBe(true)
    expect(AINOTE_ANCHOR_RE.test('ainote-20260924-600000-1500-3')).toBe(true)
    expect(CARD_ANCHOR_RE.test('card-20260924-600000-14320')).toBe(false)
    expect(CARD_ANCHOR_RE.test('card-2026092-600000-1432')).toBe(false)
    expect(CARD_ANCHOR_RE.test('card-20260924-60000-1432')).toBe(false)
    expect(CARD_ANCHOR_RE.test('ainote-20260924-600000-1432')).toBe(false)
  })

  it('buildAnchor：首卡无序号段，同分钟冲突追加 -<seq>', () => {
    expect(buildAnchor('card', '20260924', '600000', '1432', null)).toBe('card-20260924-600000-1432')
    expect(buildAnchor('card', '20260924', '600000', '1432', 2)).toBe('card-20260924-600000-1432-2')
    expect(buildAnchor('ainote', '20260924', '600000', '1500', null)).toBe('ainote-20260924-600000-1500')
  })
})
