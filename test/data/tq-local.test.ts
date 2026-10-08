/**
 * TQ-Local 只读兜底单测（review-loop `tq-local-lookup` tasks 4.11；零 mock：
 * 真实本地 `node:http` 桩服务 + 重定向传输；白名单闸为真实实现）。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { startDataStub, tqLocalRedirectTransport, type DataStubServer } from '../helpers/data-stub.ts'
import { HttpDataError, TQ_LOCAL_ENDPOINT, TQ_LOCAL_FIELD_ALLOWLIST, TQ_LOCAL_METHOD_ALLOWLIST, requestJson, type DataTransport } from '../../src/data/http.ts'
import { getStockBasics, TqLocalCache, MARKET_SUFFIX_CANDIDATES } from '../../src/data/tq-local.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

let stub: DataStubServer

beforeEach(async () => {
  stub = await startDataStub()
})

afterEach(async () => {
  await stub.close()
})

/** 标准 TQ 桩响应（ErrorId=0 + 名称/基础字段）。 */
function tqHit(name: string, extra: Record<string, unknown> = {}): unknown {
  return {
    id: 1,
    result: {
      ErrorId: '0',
      Name: name,
      HSStockKind: '0',
      J_start: '0',
      tdx_dyname: '上海',
      rs_hyname: '软件服务',
      ActiveCapital: '12345.00',
      J_zgb: '67890.00',
      ...extra,
    },
  }
}

function tqMiss(): unknown {
  return { id: 1, result: { ErrorId: '9', Name: '' } }
}

describe('命中与后缀候选', () => {
  it('.SH 首个命中即停（请求计数 1），字段原样透出、J_start=0 归一 null', async () => {
    const seen: string[] = []
    stub.setResponder(() => ({ json: tqHit('微盘股', { HSStockKind: '0', J_start: '20050607' }) }))
    const out = await getStockBasics(
      { enabled: true, transport: tqLocalRedirectTransport(stub, seen), cache: new TqLocalCache(), now: () => new Date('2026-10-06T09:00:00Z') },
      { code: '880823' },
    )
    expect(out.available).toBe(true)
    expect(out.name).toBe('微盘股')
    expect(out.marketSuffix).toBe('.SH')
    expect(out.kind).toBe('0')
    expect(out.listedAt).toBe('20050607')
    expect(out.region).toBe('上海')
    expect(out.industry).toBe('软件服务')
    expect(out.floatSharesWan).toBe('12345.00')
    expect(out.totalSharesWan).toBe('67890.00')
    expect(out.source).toBe('tq-local')
    expect(out.cacheReused).toBe(false)
    expect(seen).toEqual([TQ_LOCAL_ENDPOINT])
    expect(stub.requests).toHaveLength(1)
    // 请求体：method 与字段白名单齐备。
    const body = JSON.parse(stub.requests[0].body) as { method: string; params: { stock_code: string; field_list: string[] } }
    expect(body.method).toBe('get_stock_info')
    expect(body.params.stock_code).toBe('880823.SH')
    expect(body.params.field_list).toEqual([...TQ_LOCAL_FIELD_ALLOWLIST])
  })

  it('.SH 未命中 → 依次试 .SZ/.BJ（全未命中计数 3、reason=noRecord）', async () => {
    const seen: string[] = []
    stub.setResponder(() => ({ json: tqMiss() }))
    const out = await getStockBasics(
      { enabled: true, transport: tqLocalRedirectTransport(stub, seen), cache: new TqLocalCache() },
      { code: '880823' },
    )
    expect(out.available).toBe(false)
    expect(out.notes.join('｜')).toContain('noRecord')
    expect(stub.requests).toHaveLength(3)
    expect(MARKET_SUFFIX_CANDIDATES).toEqual(['.SH', '.SZ', '.BJ'])
  })

  it('显式 marketSuffix → 只试该后缀（计数 1）', async () => {
    const seen: string[] = []
    stub.setResponder(() => ({ json: tqMiss() }))
    const out = await getStockBasics(
      { enabled: true, transport: tqLocalRedirectTransport(stub, seen), cache: new TqLocalCache() },
      { code: '880823', marketSuffix: '.SZ' },
    )
    expect(out.available).toBe(false)
    expect(stub.requests).toHaveLength(1)
    expect(JSON.parse(stub.requests[0].body).params.stock_code).toBe('880823.SZ')
  })

  it('服务不可达 → sourceUnavailable + 提示 TdxW，且不重试（计数 1）', async () => {
    const out = await getStockBasics(
      { enabled: true, transport: () => Promise.reject(new Error('ECONNREFUSED（模拟 TdxW 未启动）')), cache: new TqLocalCache() },
      { code: '880823' },
    )
    expect(out.available).toBe(false)
    expect(out.notes.join('｜')).toContain('sourceUnavailable')
    expect(out.notes.join('｜')).toContain('TdxW')
  })
})

describe('缓存与开关', () => {
  it('24h 内二次调用 → cacheReused=true 且零新请求', async () => {
    const seen: string[] = []
    const cache = new TqLocalCache()
    stub.setResponder(() => ({ json: tqHit('上证指数') }))
    const deps = { enabled: true, transport: tqLocalRedirectTransport(stub, seen), cache, now: () => new Date('2026-10-06T09:00:00Z') }
    await getStockBasics(deps, { code: '999999' })
    const second = await getStockBasics(deps, { code: '999999' })
    expect(second.cacheReused).toBe(true)
    expect(second.name).toBe('上证指数')
    expect(stub.requests).toHaveLength(1)
  })

  it('失败不缓存：首次不可达失败后服务恢复 → 第二次真实出站成功', async () => {
    const seen: string[] = []
    const cache = new TqLocalCache()
    let up = false
    const live = tqLocalRedirectTransport(stub, seen)
    const deps = {
      enabled: true,
      cache,
      transport: ((url: string, init?: RequestInit) => (up ? live(url, init) : Promise.reject(new Error('ECONNREFUSED')))) as DataTransport,
    }
    stub.setResponder(() => ({ json: tqHit('昨日涨停') }))
    const first = await getStockBasics(deps, { code: '880863' })
    expect(first.available).toBe(false)
    up = true
    const second = await getStockBasics(deps, { code: '880863' })
    expect(second.available).toBe(true)
    expect(second.name).toBe('昨日涨停')
    // 失败尝试未出站（传输直接 reject）→ 桩只收到第二次（恢复后）的真实请求。
    expect(stub.requests).toHaveLength(1)
    expect(seen).toEqual([TQ_LOCAL_ENDPOINT])
  })

  it('开关关闭 → available=false + disabled 且零请求', async () => {
    const seen: string[] = []
    const out = await getStockBasics({ enabled: false, transport: tqLocalRedirectTransport(stub, seen), cache: new TqLocalCache() }, { code: '999999' })
    expect(out.available).toBe(false)
    expect(out.notes.join('｜')).toContain('disabled')
    expect(seen).toEqual([])
    expect(stub.requests).toHaveLength(0)
  })
})

describe('白名单闸（唯一放行路径；其余一律 blockedEndpoint）', () => {
  it('无声明直发 17709 → blockedEndpoint', async () => {
    await expect(requestJson(TQ_LOCAL_ENDPOINT, { method: 'POST', body: '{}', timeoutMs: 1000, retries: 0, transport: () => Promise.reject(new Error('不应出站')) }))
      .rejects.toBeInstanceOf(HttpDataError)
  })

  it('声明白名单外的 method / 字段 / 额外 params / 声明与 body 不符 → blockedEndpoint', async () => {
    const transport: DataTransport = () => Promise.reject(new Error('不应出站'))
    const base = { method: 'POST' as const, timeoutMs: 1000, retries: 0, transport }
    // method 越界
    await expect(requestJson(TQ_LOCAL_ENDPOINT, { ...base, body: JSON.stringify({ method: 'get_market_data', params: { stock_code: 'x', field_list: ['Name'] } }), tqLocal: { method: 'get_stock_info', fieldList: ['Name'] } }))
      .rejects.toThrow(/不一致|白名单/)
    // 字段越界
    await expect(requestJson(TQ_LOCAL_ENDPOINT, { ...base, body: JSON.stringify({ method: 'get_stock_info', params: { stock_code: 'x', field_list: ['Name'] } }), tqLocal: { method: 'get_stock_info', fieldList: ['Name', 'ZZZ' as never] } }))
      .rejects.toThrow(/字段白名单/)
    // 额外 params
    await expect(requestJson(TQ_LOCAL_ENDPOINT, { ...base, body: JSON.stringify({ method: 'get_stock_info', params: { stock_code: 'x', field_list: ['Name'], extra: 1 } }), tqLocal: { method: 'get_stock_info', fieldList: ['Name'] } }))
      .rejects.toThrow(/params 白名单/)
    // 非白名单端点（其它端口）带声明
    await expect(requestJson('http://127.0.0.1:18080/', { ...base, body: JSON.stringify({ method: 'get_stock_info', params: { stock_code: 'x', field_list: ['Name'] } }), tqLocal: { method: 'get_stock_info', fieldList: ['Name'] } }))
      .rejects.toThrow(/只允许指向/)
  })

  it('method 字面量集合 == 白名单（源码级；行情/交易接口零出现）', () => {
    const strip = (t: string): string => t.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '')
    const src = strip(readFileSync(REPO_ROOT + 'src/data/tq-local.ts', 'utf8')) + strip(readFileSync(REPO_ROOT + 'src/data/http.ts', 'utf8'))
    expect(TQ_LOCAL_METHOD_ALLOWLIST).toEqual(['get_stock_info'])
    for (const forbidden of ['get_market_data', 'get_market_snapshot', 'order_stock', 'cancel_order_stock', 'subscribe_hq']) {
      expect(src.includes(forbidden), `不应出现 ${forbidden}`).toBe(false)
    }
  })
})
