/**
 * 传参解析单测（tasks 1.8；design D-5）：hash → query → path 段优先级、
 * 原样记录不猜测补全、非 6 位/空态显式标记；序列化产物（页面内联通道）可重建
 * 且行为一致、无基线页未证语法特征。
 */
import { describe, expect, it } from 'vitest'
import { parseProbeParams } from '../../src/client/probe/params.ts'

const ROUTE = '/dsh-trader-kit/probe'

describe('parseProbeParams：hash 形态（TDX 基线通道）', () => {
  it('#600000 → 600000（合法 6 位，前导零形态保留）', () => {
    const p = parseProbeParams('#600000', '', ROUTE, ROUTE)
    expect(p).toEqual({
      hashRaw: '600000',
      queryRaw: '',
      pathRaw: '',
      presentForms: ['hash'],
      resolvedForm: 'hash',
      resolvedValue: '600000',
      valid: true,
    })
  })

  it('#000001 前导零保留且合法', () => {
    const p = parseProbeParams('#000001', '', ROUTE, ROUTE)
    expect(p.resolvedValue).toBe('000001')
    expect(p.valid).toBe(true)
  })

  it('hash 仅 "#" 时视为缺失（不猜测）', () => {
    const p = parseProbeParams('#', '', ROUTE, ROUTE)
    expect(p.hashRaw).toBe('')
    expect(p.presentForms).toEqual([])
    expect(p.resolvedForm).toBeNull()
    expect(p.resolvedValue).toBeNull()
    expect(p.valid).toBe(false)
  })
})

describe('parseProbeParams：优先级（hash → query → path 段）', () => {
  it('三形态同时提供：hash 胜出，且三类原值全部原样保留', () => {
    const p = parseProbeParams('#600000', '?code=000001', ROUTE + '/000002', ROUTE)
    expect(p.presentForms).toEqual(['hash', 'query', 'path'])
    expect(p.resolvedForm).toBe('hash')
    expect(p.resolvedValue).toBe('600000')
    expect(p.queryRaw).toBe('000001')
    expect(p.pathRaw).toBe('000002')
  })

  it('仅 query：?code=000001 → 000001（form=query）', () => {
    const p = parseProbeParams('', '?code=000001', ROUTE, ROUTE)
    expect(p.resolvedForm).toBe('query')
    expect(p.resolvedValue).toBe('000001')
    expect(p.valid).toBe(true)
  })

  it('仅 path 段：路由后缀 /600000 → 600000（form=path）', () => {
    const p = parseProbeParams('', '', ROUTE + '/600000', ROUTE)
    expect(p.resolvedForm).toBe('path')
    expect(p.resolvedValue).toBe('600000')
    expect(p.valid).toBe(true)
  })

  it('hash 缺失时 query 优先于 path 段', () => {
    const p = parseProbeParams('', '?code=600000', ROUTE + '/000001', ROUTE)
    expect(p.presentForms).toEqual(['query', 'path'])
    expect(p.resolvedForm).toBe('query')
  })

  it('非法不回退：hash 非法时取 hash 判非法，不静默改取 query（掩盖传参缺陷）', () => {
    const p = parseProbeParams('#SH600000', '?code=600000', ROUTE, ROUTE)
    expect(p.resolvedForm).toBe('hash')
    expect(p.resolvedValue).toBe('SH600000')
    expect(p.valid).toBe(false)
    expect(p.queryRaw).toBe('600000')
  })
})

describe('parseProbeParams：原样记录与显式判定（不静默修正）', () => {
  it('SH600000：原样记录、判非法、不补全', () => {
    const p = parseProbeParams('#SH600000', '', ROUTE, ROUTE)
    expect(p.hashRaw).toBe('SH600000')
    expect(p.resolvedValue).toBe('SH600000')
    expect(p.valid).toBe(false)
  })

  it('600000.SH：经 query 原样记录、判非法', () => {
    const p = parseProbeParams('', '?code=600000.SH', ROUTE, ROUTE)
    expect(p.queryRaw).toBe('600000.SH')
    expect(p.valid).toBe(false)
  })

  it('非 6 位（5 位 / 7 位 / 含字母）判非法', () => {
    expect(parseProbeParams('#60000', '', ROUTE, ROUTE).valid).toBe(false)
    expect(parseProbeParams('#6000000', '', ROUTE, ROUTE).valid).toBe(false)
    expect(parseProbeParams('#60a000', '', ROUTE, ROUTE).valid).toBe(false)
  })

  it('三类全缺失：显式空态（resolved null + valid false），不显示推测标的', () => {
    const p = parseProbeParams('', '', ROUTE, ROUTE)
    expect(p.presentForms).toEqual([])
    expect(p.resolvedForm).toBeNull()
    expect(p.resolvedValue).toBeNull()
    expect(p.valid).toBe(false)
  })

  it('query 无值的 code 参数视为缺失；首个 code 参数胜出', () => {
    expect(parseProbeParams('', '?code&x=1', ROUTE, ROUTE).queryRaw).toBe('')
    expect(parseProbeParams('', '?code=1&code=600000', ROUTE, ROUTE).queryRaw).toBe('1')
  })

  it('path 段只认路由后缀：pathname 不以 routePath 开头 → 缺失（不猜整个 pathname）', () => {
    const p = parseProbeParams('', '', '/other/600000', ROUTE)
    expect(p.pathRaw).toBe('')
    expect(p.resolvedForm).toBeNull()
  })

  it('path 段取路由后首个段；多余层级与连续斜杠不猜测', () => {
    expect(parseProbeParams('', '', ROUTE + '/600000/', ROUTE).pathRaw).toBe('600000')
    expect(parseProbeParams('', '', ROUTE + '//600000', ROUTE).pathRaw).toBe('600000')
    expect(parseProbeParams('', '', ROUTE + '/600000/extra', ROUTE).pathRaw).toBe('600000')
  })
})

describe('parseProbeParams：页面内联序列化通道（tasks 1.3）', () => {
  const src = parseProbeParams.toString()

  it('序列化产物可经 Function 重建并与直调行为一致', () => {
    expect(src).toContain('function parseProbeParams')
    const rebuilt = new Function('return (' + src + ')')() as typeof parseProbeParams
    const cases: Array<[string, string, string, string]> = [
      ['#600000', '', ROUTE, ROUTE],
      ['#000001', '', ROUTE, ROUTE],
      ['', '?code=000001', ROUTE, ROUTE],
      ['', '', ROUTE + '/600000', ROUTE],
      ['#600000', '?code=000001', ROUTE + '/000002', ROUTE],
      ['#SH600000', '?code=600000', ROUTE, ROUTE],
      ['', '', ROUTE, ROUTE],
      ['#', '', ROUTE, ROUTE],
      ['', '', '/other/600000', ROUTE],
    ]
    for (const [hash, search, pathname, routePath] of cases) {
      expect(rebuilt(hash, search, pathname, routePath)).toEqual(parseProbeParams(hash, search, pathname, routePath))
    }
  })

  it('序列化源无基线页未证语法特征（ES module / 可选链 / 空值合并 / async / await / 模板字符串）', () => {
    expect(src).not.toContain('`')
    expect(src).not.toContain('${')
    expect(src).not.toContain('?.')
    expect(src).not.toContain('??')
    expect(src).not.toMatch(/\basync\b/)
    expect(src).not.toMatch(/\bawait\b/)
    expect(src).not.toMatch(/\bimport\b/)
    expect(src).not.toMatch(/=>/)
  })
})
