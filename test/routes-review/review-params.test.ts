/**
 * 复盘页传参解析单测（change 4 tasks 2.3；design D-1/D-15）。
 * 优先级 hash → query → path 段；归一化 = 只去壳（sh|sz|bj 前缀与 .sh|.sz|.bj
 * 后缀，大小写不敏感）+ 恰 6 位数字（前导零保留）；不补全、不猜测、原样留档。
 */
import { describe, expect, it } from 'vitest'
import { parseReviewParams } from '../../src/client/review/params.ts'

const ROUTE = '/dsh-trader-kit/review'

describe('传参优先级（hash → query → path）', () => {
  it('hash 优先于 query 与 path 段', () => {
    const r = parseReviewParams('#000001', '?code=600000', ROUTE + '/600002', ROUTE)
    expect(r.resolvedForm).toBe('hash')
    expect(r.raw).toBe('000001')
    expect(r.code).toBe('000001')
    expect(r.valid).toBe(true)
  })

  it('无 hash 时取 query；无 query 时取 path 段', () => {
    const q = parseReviewParams('', '?code=600000', ROUTE + '/600002', ROUTE)
    expect(q.resolvedForm).toBe('query')
    expect(q.code).toBe('600000')
    const p = parseReviewParams('', '', ROUTE + '/600002', ROUTE)
    expect(p.resolvedForm).toBe('path')
    expect(p.code).toBe('600002')
  })

  it('三类全缺失 → resolvedForm=null（显式空态），不猜测', () => {
    const r = parseReviewParams('', '', ROUTE, ROUTE)
    expect(r.resolvedForm).toBeNull()
    expect(r.raw).toBeNull()
    expect(r.code).toBeNull()
    expect(r.valid).toBe(false)
  })
})

describe('市场前缀归一化（去壳 ≠ 猜测）', () => {
  it.each([
    ['SH600000', '600000'],
    ['600000.SH', '600000'],
    ['sh600000', '600000'],
    ['600000.sz', '600000'],
    ['bj830799', '830799'],
    ['000001', '000001'], // 前导零保留
  ])('%s → %s', (raw, expected) => {
    const r = parseReviewParams('#' + raw, '', ROUTE, ROUTE)
    expect(r.code).toBe(expected)
    expect(r.valid).toBe(true)
    expect(r.raw).toBe(raw) // 原始取值留档（排障）
  })

  it.each(['60000', '6000000', 'abc', '6000001', '']) // 不补全、不猜测
    ('非法取值 %s → valid=false 且原样留档', (raw) => {
      const r = parseReviewParams(raw === '' ? '' : '#' + raw, '', ROUTE, ROUTE)
      expect(r.valid).toBe(false)
      expect(r.code).toBeNull()
      if (raw !== '') expect(r.raw).toBe(raw)
    })

  it('hash 带 # 或不带均解析；query 缺 code 键 → 回落 path 段', () => {
    expect(parseReviewParams('600000', '', ROUTE, ROUTE).code).toBe('600000')
    const r = parseReviewParams('', '?other=1', ROUTE + '/600001', ROUTE)
    expect(r.resolvedForm).toBe('path')
    expect(r.code).toBe('600001')
  })
})

describe('path 段形态细节', () => {
  it('路由路径之后的首段（含尾随斜杠）；路径不含路由前缀 → 空', () => {
    expect(parseReviewParams('', '', ROUTE + '/600000/', ROUTE).code).toBe('600000')
    expect(parseReviewParams('', '', '/other/600000', ROUTE).pathRaw).toBe('')
    expect(parseReviewParams('', '', '/other/600000', ROUTE).valid).toBe(false)
  })

  it('URL 编码段解码（%53H600000 → SH600000 → 600000）', () => {
    const r = parseReviewParams('', '', ROUTE + '/%53H600000', ROUTE)
    expect(r.pathRaw).toBe('SH600000')
    expect(r.code).toBe('600000')
  })

  it('query 值 decode 与 + 号空格处理', () => {
    const r = parseReviewParams('', '?code=%53H600000', ROUTE, ROUTE)
    expect(r.queryRaw).toBe('SH600000')
    expect(r.code).toBe('600000')
    const plus = parseReviewParams('', '?code=600000+x', ROUTE, ROUTE)
    expect(plus.queryRaw).toBe('600000 x') // + → 空格后非法（原样留档不猜测）
    expect(plus.valid).toBe(false)
  })

  it('页面形态：location.hash/search 带 # ? 前缀（文档化调用约定）', () => {
    expect(parseReviewParams('#600000', '?date=2026-09-24', ROUTE + '/600001', ROUTE).resolvedForm).toBe('hash')
  })
})
