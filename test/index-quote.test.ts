/**
 * S10 指数行情源单测（quote-snapshot 同款零 mock 纪律：真实本地桩 + 重定向传输；
 * spec = index-quote 能力）。腾讯响应为 GBK `v_sh<code>="~"` 字段串。
 */
import { describe, expect, it } from 'vitest'
import { fetchIndexQuote } from '../src/data/index-quote.ts'
import { createTempDataRoot, createTestDeps, startDataStub, type DataStubServer } from './helpers/data-stub.ts'

/** 腾讯载荷字段（[1]=name [3]=现价 [32]=涨跌幅）。 */
function tencentBody(code: string, fields: string[]): string {
  return `v_sh${code}="` + fields.join('~') + '"'
}

function indexFields(name: string, price: string, pct: string): string[] {
  const f: string[] = new Array(33).fill('')
  f[1] = name
  f[2] = '000688'
  f[3] = price
  f[32] = pct
  return f
}

function mount(stub: DataStubServer, responder: Parameters<DataStubServer['setResponder']>[0]): void {
  stub.setResponder(responder)
}

describe('S10 指数行情：解析与代码语义', () => {
  it('科创50 → available=true 逐字段（name/price/pct）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mount(stub, (req) => {
      if (req.path.includes('/q=sh000688')) return { text: tencentBody('000688', indexFields('KC50', '1530.01', '-2.51')) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchIndexQuote(deps, '000688')
      expect(r.available).toBe(true)
      expect(r.name).toBe('KC50')
      expect(r.price).toBe(1530.01)
      expect(r.pct).toBe(-2.51)
      expect(r.source).toBe('index-tencent')
      expect(r.errors).toEqual([])
      expect(stub.requests[0]?.path).toContain('/q=sh000688')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('GBK 中文名解码（真实载荷为 GBK；handcraft 字节验证解码路径）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    // 「科创50」GBK 字节：科=BFC6 创=B4B4 + ASCII "50"。
    const gbkName = Buffer.from([0xbf, 0xc6, 0xb4, 0xb4, 0x35, 0x30])
    const body = tencentBody('000688', indexFields('\u0000GBK\u0000', '1530.01', '-2.51'))
    const [before, after] = body.split('\u0000GBK\u0000')
    mount(stub, (req) => {
      if (req.path.includes('/q=sh000688')) {
        return { raw: Buffer.concat([Buffer.from(before, 'utf8'), gbkName, Buffer.from(after, 'utf8')]) }
      }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchIndexQuote(deps, '000688')
      expect(r.available).toBe(true)
      expect(r.name).toBe('科创50')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('999999 → 别名 000001 出站（TDX 上证指数显示码）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mount(stub, (req) => {
      if (req.path.includes('/q=sh000001')) return { text: tencentBody('000001', indexFields('SHCI', '3842.19', '0.31')) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchIndexQuote(deps, '999999')
      expect(r.available).toBe(true)
      expect(r.name).toBe('SHCI')
      expect(r.price).toBe(3842.19)
      expect(stub.requests[0]?.path).toContain('/q=sh000001')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('880823 自制指标 → 显式不可得且零出站', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mount(stub, () => ({ text: 'should-not-be-called' }))
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchIndexQuote(deps, '880823')
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['noExternalSource'])
      expect(stub.requests).toHaveLength(0)
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('空响应 → notFound；非法代码 → invalidCode 零出站', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mount(stub, (req) => {
      if (req.path.includes('/q=sh000300')) return { text: '' }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const empty = await fetchIndexQuote(deps, '000300')
      expect(empty.available).toBe(false)
      expect(empty.errors).toEqual(['notFound'])
      const bad = await fetchIndexQuote(deps, 'abc123')
      expect(bad.available).toBe(false)
      expect(bad.errors).toEqual(['invalidCode'])
      expect(stub.requests).toHaveLength(1) // 仅 000300 出站
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})
