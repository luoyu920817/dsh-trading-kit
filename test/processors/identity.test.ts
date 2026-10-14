/**
 * 身份与修订指纹回归（identity.ts）。
 * 全部纯函数断言：真实哈希口径（sha256 规范 JSON）、原文不归一化、跨市场/路径/anchor 区分。
 */
import { describe, expect, it } from 'vitest'
import { canonicalJson, cardIdentity, inputRevision, requestIdentity } from '../../src/review/processors/identity.ts'
import type { JsonValue, SourceCardRef, SourceCardSnapshot } from '../../src/review/processors/types.ts'

const ref: SourceCardRef = {
  relativePath: 'DB/review/202610/600000_测试_20261009.md', anchor: '预期-1', market: null, code: '600000', tradeDate: '2026-10-09',
}

/**
 * 构造已核验来源快照。
 * 业务逻辑: 在固定来源身份上展开正文与文档修订；关键判断: 身份字段真实可变以驱动指纹差异；
 * 异常处理: 无 IO。参数: body 原文、可选 sourceRevision。返回: 完整快照。
 */
function snap(body: string, sourceRevision = 'source-1'): SourceCardSnapshot {
  return { ...ref, body, sourceRevision, verification: 'verified' }
}

describe('身份与修订指纹', () => {
  it('canonicalJson 对象键排序、数组保序、转义稳定', () => {
    expect(canonicalJson({ b: [1, { z: null, c: 'x' }], a: 'q' })).toBe('{"a":"q","b":[1,{"c":"x","z":null}]}')
    expect(canonicalJson({ s: 'a"b\nc' })).toBe('{"s":"a\\"b\\nc"}')
    expect(canonicalJson(null)).toBe('null')
    expect(canonicalJson([])).toBe('[]')
  })

  it('canonicalJson 拒绝非 JSON 值', () => {
    expect(() => canonicalJson({ x: undefined } as unknown as JsonValue)).toThrow('CANONICAL_JSON_INVALID')
    expect(() => canonicalJson([undefined] as unknown as JsonValue)).toThrow('CANONICAL_JSON_INVALID')
    expect(() => canonicalJson(Number.POSITIVE_INFINITY as unknown as JsonValue)).toThrow('CANONICAL_JSON_INVALID')
  })

  it('cardIdentity 稳定且为 64 位十六进制', () => {
    expect(cardIdentity(ref)).toBe(cardIdentity(ref))
    expect(cardIdentity(ref)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('cardIdentity 同码跨市场/相对路径/anchor/交易日均不同身份', () => {
    const bare = cardIdentity(ref)
    const sh = cardIdentity({ ...ref, market: 'sh' })
    const sz = cardIdentity({ ...ref, market: 'sz' })
    expect(new Set([bare, sh, sz]).size).toBe(3)
    expect(cardIdentity({ ...ref, relativePath: 'DB/review/202610/600000_别的_20261009.md' })).not.toBe(bare)
    expect(cardIdentity({ ...ref, anchor: '预期-2' })).not.toBe(bare)
    expect(cardIdentity({ ...ref, tradeDate: '2026-10-12' })).not.toBe(bare)
  })

  it('inputRevision 不归一化原文：换行、尾随空白、文档修订差异均产生不同指纹', () => {
    expect(inputRevision(snap('第一行\r\n第二行'))).not.toBe(inputRevision(snap('第一行\n第二行')))
    expect(inputRevision(snap('原句 '))).not.toBe(inputRevision(snap('原句')))
    expect(inputRevision(snap('正文', 'source-2'))).not.toBe(inputRevision(snap('正文')))
    expect(inputRevision(snap('正文'))).toBe(inputRevision(snap('正文')))
    expect(inputRevision(snap('正文'))).toMatch(/^[0-9a-f]{64}$/)
  })

  it('requestIdentity 任一维度变化即不同请求身份；同参稳定', () => {
    const input = inputRevision(snap('正文'))
    const base = requestIdentity(ref, 'expectation', input, 'definition-1')
    expect(base).toBe(requestIdentity(ref, 'expectation', input, 'definition-1'))
    expect(requestIdentity(ref, 'expectation', input, 'definition-2')).not.toBe(base)
    expect(requestIdentity(ref, 'other', input, 'definition-1')).not.toBe(base)
    expect(requestIdentity(ref, 'expectation', inputRevision(snap('他文')), 'definition-1')).not.toBe(base)
  })

  it('requestIdentity 空参数拒绝', () => {
    const input = inputRevision(snap('正文'))
    expect(() => requestIdentity(ref, '', input, 'definition-1')).toThrow('IDENTITY_ARGUMENT_INVALID')
    expect(() => requestIdentity(ref, 'expectation', '', 'definition-1')).toThrow('IDENTITY_ARGUMENT_INVALID')
    expect(() => requestIdentity(ref, 'expectation', input, '')).toThrow('IDENTITY_ARGUMENT_INVALID')
  })

  it('非法来源身份拒绝：空路径、坏 code、坏日期、坏市场', () => {
    expect(() => cardIdentity({ ...ref, relativePath: '' })).toThrow('IDENTITY_ARGUMENT_INVALID')
    expect(() => cardIdentity({ ...ref, code: '60000' })).toThrow('IDENTITY_ARGUMENT_INVALID')
    expect(() => cardIdentity({ ...ref, tradeDate: '2026-02-30' })).toThrow('IDENTITY_ARGUMENT_INVALID')
    expect(() => cardIdentity({ ...ref, market: 'hk' as unknown as SourceCardRef['market'] })).toThrow('IDENTITY_ARGUMENT_INVALID')
    expect(() => inputRevision({ ...snap('正文'), anchor: '' })).toThrow('IDENTITY_ARGUMENT_INVALID')
  })

  it('inputRevision 含 market 前缀同码区分（sh000001 与裸 000001 不同输入）', () => {
    const bareSnap = snap('正文')
    const shSnap: SourceCardSnapshot = { ...bareSnap, market: 'sh' }
    expect(inputRevision(bareSnap)).not.toBe(inputRevision(shSnap))
  })
})
