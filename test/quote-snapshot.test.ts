/**
 * S9 行情快照单测（change 2 data-foundation，quote-snapshot 能力；owner 2026-10-05
 * 「迁移四个基础数据」）。零 mock：真实本地桩（node:http）+ 重定向传输；realhead
 * 为 JSONP 文本响应（`quotebridge_..._last({...})` 包裹）。
 * 本文件同时补上 fetchQuoteName 的测试面（此前无直接单测——S9 唯一覆盖）。
 */
import { describe, expect, it } from 'vitest'
import { fetchQuoteName, fetchQuoteSnapshot } from '../src/data/quote-name.ts'
import { createTempDataRoot, createTestDeps, startDataStub, type DataStubServer } from './helpers/data-stub.ts'

/** realhead JSONP 响应体（items 字段号：10 现价 / 199112 涨跌幅 / 3475914 流通市值 / 3541450 总市值 / 407 流通股本）。 */
function realheadJsonp(items: Record<string, unknown>): string {
  return 'quotebridge_quote_page_h5_v6_hs_600000_last(' + JSON.stringify({ items }) + ')'
}

function mountRealhead(stub: DataStubServer, items: Record<string, unknown>): void {
  stub.setResponder((req) => {
    if (req.path.includes('/v6/realhead/')) return { text: realheadJsonp(items) }
    return undefined
  })
}

describe('S9 行情快照：四项字段逐字段解析', () => {
  it('数值字段全量 → available=true 逐字段对应（现价/涨跌幅/流通市值/总市值/流通股本）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mountRealhead(stub, {
      name: '浦发银行',
      '10': 13.25,
      '199112': 2.34,
      '3475914': 3.86e11,
      '3541450': 3.9e11,
      '407': 2.92e10,
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchQuoteSnapshot(deps, '600000')
      expect(r.available).toBe(true)
      expect(r.source).toBe('quote-ths')
      expect(r.name).toBe('浦发银行')
      expect(r.price).toBe(13.25)
      expect(r.pct).toBe(2.34)
      expect(r.ltsz).toBe(3.86e11)
      expect(r.zsz).toBe(3.9e11)
      expect(r.ltgb).toBe(2.92e10)
      expect(r.errors).toEqual([])
      expect(r.fetchedAt).not.toBeNull()
      // 出站路径 = realhead 的 hs_<code> JSONP（与参考页 fetchThsQuote 同源）。
      expect(stub.requests.length).toBe(1)
      expect(stub.requests[0]?.path).toContain('/v6/realhead/hs_600000/last.js')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('字符串数值可解析；个别字段缺失 → 该字段 null 不影响其它字段', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mountRealhead(stub, { name: '万科A', '10': '6.71', '3541450': '7.98e10' })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchQuoteSnapshot(deps, '000002')
      expect(r.available).toBe(true)
      expect(r.price).toBe(6.71)
      expect(r.zsz).toBeCloseTo(7.98e10, 0)
      expect(r.pct).toBeNull()
      expect(r.ltsz).toBeNull()
      expect(r.ltgb).toBeNull()
      expect(r.errors).toEqual([])
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('items 全缺 → available=false + notFound（MUST NOT 用 0 冒充）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mountRealhead(stub, {})
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchQuoteSnapshot(deps, '600000')
      expect(r.available).toBe(false)
      expect(r.source).toBeNull()
      expect(r.errors).toEqual(['notFound'])
      expect(r.price).toBeNull()
      expect(r.ltsz).toBeNull()
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })

  it('非法数值（0 长度串/非数）→ null；传输失败 → quoteProbe 显式错误', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    mountRealhead(stub, { name: 'x', '10': '--', '199112': 'abc', '3475914': 0 })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const r = await fetchQuoteSnapshot(deps, '600000')
      expect(r.price).toBeNull() // '--' → null
      expect(r.pct).toBeNull() // 'abc' → null
      expect(r.ltsz).toBe(0) // 数值 0 是合法数据（不是冒充——源真的返回 0）
      // 传输层失败（注入抛错传输——具名 seam，非 mock 库）：quoteProbe 分档。
      const broken = { ...deps, transport: async () => { throw new Error('boom') } }
      const e = await fetchQuoteSnapshot(broken, '600000')
      expect(e.available).toBe(false)
      expect(e.errors[0]).toContain('quoteProbe')
      expect(e.errors[0]).toContain('boom')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('S9 名称投影（fetchQuoteName；层②末级兜底）', () => {
  it('name 命中 → available=true；name 缺失但现价可得 → 名称专指 false + notFound', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      mountRealhead(stub, { name: '浦发银行', '10': 13.25 })
      const hit = await fetchQuoteName(deps, '600000')
      expect(hit.available).toBe(true)
      expect(hit.name).toBe('浦发银行')
      expect(hit.source).toBe('quote-ths')

      mountRealhead(stub, { '10': 13.25 })
      const noName = await fetchQuoteName(deps, '600000')
      expect(noName.available).toBe(false)
      expect(noName.name).toBeNull()
      expect(noName.source).toBeNull()
      expect(noName.errors).toEqual(['notFound'])
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})
