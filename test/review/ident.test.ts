/**
 * 代码标识单测（owner 2026-10-06「整体添加代码标识添加一个沪深」）：
 * marketPrefixForCode 推断仅用于显示/标识；qualifyCode 仅显式市场加前缀（存储零迁移）。
 * SecurityId/declaredMarketOf（owner 2026-10-08 P0）：文档定位的身份领域类型。
 */
import { describe, expect, it } from 'vitest'
import { declaredMarketOf, marketPrefixForCode, qualifyCode, splitQualified } from '../../src/review/ident.ts'

describe('市场前缀推断（仅标识用；与 TDX 板块文件口径一致）', () => {
  it('代码段推断：0/1/2/3→深、5/6/9→沪、4/8→北、88xxxx（自制指标按沪存）→沪', () => {
    expect(marketPrefixForCode('000002')).toBe('sz')
    expect(marketPrefixForCode('300750')).toBe('sz')
    expect(marketPrefixForCode('600000')).toBe('sh')
    expect(marketPrefixForCode('688981')).toBe('sh')
    expect(marketPrefixForCode('510300')).toBe('sh')
    expect(marketPrefixForCode('999999')).toBe('sh')
    expect(marketPrefixForCode('880823')).toBe('sh')
    expect(marketPrefixForCode('833171')).toBe('bj')
    expect(marketPrefixForCode('430047')).toBe('bj')
  })
})

describe('存储层标识（qualifyCode）：仅显式市场加前缀', () => {
  it('显式 sh/sz/bj → 前缀化；缺省 → 原样 6 位（既有文档零迁移）', () => {
    expect(qualifyCode('000001', 'sh')).toBe('sh000001')
    expect(qualifyCode('000002', 'sz')).toBe('sz000002')
    expect(qualifyCode('833171', 'bj')).toBe('bj833171')
    expect(qualifyCode('000002', null)).toBe('000002')
    expect(qualifyCode('000002')).toBe('000002')
  })
})

describe('拆分（splitQualified）', () => {
  it('带前缀与无前缀两种形态', () => {
    expect(splitQualified('sh000001')).toEqual({ market: 'sh', code: '000001' })
    expect(splitQualified('000001')).toEqual({ market: null, code: '000001' })
    expect(splitQualified('sh00001')).toBeNull()
    expect(splitQualified('xx000001')).toBeNull()
  })
})

describe('文档身份（SecurityId + declaredMarketOf，owner 2026-10-08 P0）', () => {
  it('显式前缀优先；null（旧式无前缀文档）按代码段推导声明市场', () => {
    expect(declaredMarketOf({ market: 'sh', code: '000688' })).toBe('sh') // 科创50（指数）
    expect(declaredMarketOf({ market: 'sz', code: '000688' })).toBe('sz') // 国城矿业（显式前缀）
    expect(declaredMarketOf({ market: null, code: '000688' })).toBe('sz') // 旧式文档 = 深市股票
    expect(declaredMarketOf({ market: null, code: '600000' })).toBe('sh')
    expect(declaredMarketOf({ market: null, code: '880823' })).toBe('sh') // TDX 自制指标按沪
    expect(declaredMarketOf({ market: null, code: '430047' })).toBe('bj')
  })
})
