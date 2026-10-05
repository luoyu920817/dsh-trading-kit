/**
 * 缓存幂等与原子写单测（change data-foundation tasks 3.3/3.7）。
 * 零 mock：真实本地桩计数出站请求；真实临时目录落盘。
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'
import { getLimitReason } from '../src/data/limit-reason.ts'
import { getConcepts } from '../src/data/concepts.ts'
import { listCacheTmpFiles } from '../src/data/cache.ts'
import { toCompactDate } from '../src/data/date.ts'
import {
  startDataStub, createTempDataRoot, createTestDeps, s7Payload, s5HistoryPayload, s8Payload, type DataStubServer,
} from './helpers/data-stub.ts'
import type { DataDeps } from '../src/data/deps.ts'

/** 盘后固定时钟（2026-09-21 周一上海 16:00）；历史日 2025-01-0x 恒为历史路由。 */
const OFF_SESSION = (): Date => new Date('2026-09-21T08:00:00Z')

interface Harness {
  stub: DataStubServer
  deps: DataDeps
  dataRoot: string
  cleanup(): Promise<void>
}

async function createHarness(responder: Parameters<DataStubServer['setResponder']>[0], configOverrides?: Parameters<typeof createTestDeps>[0]['configOverrides']): Promise<Harness> {
  const stub = await startDataStub()
  const root = await createTempDataRoot()
  stub.setResponder(responder)
  const deps = createTestDeps({ dataRoot: root.dataRoot, stub, now: OFF_SESSION, configOverrides })
  return { stub, deps, dataRoot: root.dataRoot, cleanup: root.cleanup }
}

/** S7 History 按请求参数回显业务日 + 返回单条记录；S5 无记录（保证不走备源）。 */
function historyResponder(): Parameters<DataStubServer['setResponder']>[0] {
  return (req) => {
    if (req.path.includes('surgeLimitHistory')) {
      const compact = req.query.get('date') ?? ''
      const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
      return { json: s7Payload(iso, { '600000': { cause: '重组', first: '0930', last: '1450', open: 2 } }) }
    }
    if (req.path.includes('surgeLimitList')) return { json: s7Payload('2025-01-02', {}) }
    if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
    return undefined
  }
}

describe('当日重复调用零网络', () => {
  it('同参第二次调用直接返回缓存结果（桩计数不变）', async () => {
    const h = await createHarness(historyResponder(), { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      const first = await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(first.available).toBe(true)
      expect(h.stub.requests.length).toBe(1)
      const second = await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(second).toEqual(first)
      expect(h.stub.requests.length).toBe(1)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('T2 概念缓存（owner 实测修订 2026-10-05：S8 响应按 symbol 裁剪，键含 code）', () => {
  it('同标的同参数重复调用 → 列表级请求 1、预算 +1，第二次零网络', async () => {
    const h = await createHarness((req) => {
      if (req.path.includes('plates_by_any_stock')) {
        return { json: s8Payload({
          p1: { core_avg_pcp: 0.062, plate_name: '算力', reason: 'r1', plate_id: 'p1', top_n_stocks: { items: [{ symbol: '600000.SS', stock_chi_name: '浦发银行' }] } },
          p2: { core_avg_pcp: 0.02, plate_name: '存储', reason: 'r2', plate_id: 'p2' },
        }) }
      }
      return undefined
    })
    try {
      await getConcepts(h.deps, { code: '600000' })
      await getConcepts(h.deps, { code: '600000' })
      expect(h.stub.count('plates_by_any_stock')).toBe(1)
      expect(h.deps.guard.status().budgetUsed).toBe(1)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })

  it('跨标的不串股：000002 与 603919 各自独立请求，603919 空数据显式不可用（不命中 000002 缓存）', async () => {
    const h = await createHarness((req) => {
      if (req.path.includes('plates_by_any_stock')) {
        if (req.query.get('symbol') === '000002.SZ') {
          return { json: s8Payload({
            p1: { core_avg_pcp: 0.05, plate_name: '破净股', reason: 'rk', plate_id: 'p1', top_n_stocks: { items: [{ symbol: '000002.SZ', stock_chi_name: '万  科Ａ' }] } },
          }) }
        }
        return { json: s8Payload({}) } // 603919 未收录 → 空 data
      }
      return undefined
    })
    try {
      const a = await getConcepts(h.deps, { code: '000002' })
      const b = await getConcepts(h.deps, { code: '603919' })
      expect(h.stub.count('plates_by_any_stock')).toBe(2)
      expect(h.deps.guard.status().budgetUsed).toBe(2)
      expect(a.available).toBe(true)
      expect(a.concepts.map((c: { name: string }) => c.name)).toEqual(['破净股'])
      // 603919：空数据 → 显式不可用（MUST NOT 命中 000002 的缓存串股）。
      expect(b.available).toBe(false)
      expect(b.name).toBeNull()
      // 负缓存：同标的第二次仍零网络。
      const b2 = await getConcepts(h.deps, { code: '603919' })
      expect(h.stub.count('plates_by_any_stock')).toBe(2)
      expect(b2.available).toBe(false)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('跨日不命中', () => {
  it('两个请求日各 1 次列表级请求（目录按各自日期分桶）', async () => {
    const h = await createHarness(historyResponder(), { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      await getLimitReason(h.deps, { code: '600000', date: '2025-01-03' })
      expect(h.stub.count('surgeLimitHistory')).toBe(2)
      const bucketA = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-02'))
      const bucketB = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-03'))
      expect((await readdir(bucketA)).length).toBeGreaterThan(0)
      expect((await readdir(bucketB)).length).toBeGreaterThan(0)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('缓存写入原子性', () => {
  it('写入完成后无残留临时文件、目标为完整 JSON（写入中断不留半截文件）', async () => {
    const h = await createHarness(historyResponder(), { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(await listCacheTmpFiles(h.dataRoot, '2025-01-02')).toEqual([])
      const bucket = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-02'))
      const files = await readdir(bucket)
      expect(files.length).toBeGreaterThan(0)
      for (const f of files) {
        const parsed = JSON.parse(await readFile(join(bucket, f), 'utf8')) as Record<string, unknown>
        expect(typeof parsed['cacheSchema']).toBe('string')
      }
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('历史请求按列表级计数', () => {
  it('6 日回溯 → 预算用量 6（一次 History 请求 = 一次列表级请求）', async () => {
    const h = await createHarness(historyResponder(), { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      const dates = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09']
      for (const d of dates) {
        const r = await getLimitReason(h.deps, { code: '600000', date: d })
        expect(r.available).toBe(true)
      }
      const status = h.deps.guard.status()
      expect(status.budgetUsed).toBe(6)
      expect(status.remaining).toBe(status.budgetLimit - 6)
      expect(h.stub.count('surgeLimitHistory')).toBe(6)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('列表级缓存先行', () => {
  it('20 个标的 → 列表级请求数 1、预算 +1（其余命中列表级缓存）', async () => {
    const rows: Record<string, { cause: string }> = {}
    for (let i = 0; i < 20; i += 1) rows[String(600000 + i)] = { cause: `原因${i}` }
    const h = await createHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2025-01-02', rows) }
      if (req.path.includes('surgeLimitList')) return { json: s7Payload('2025-01-02', rows) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      for (let i = 0; i < 20; i += 1) {
        const r = await getLimitReason(h.deps, { code: String(600000 + i), date: '2025-01-02' })
        expect(r.available).toBe(true)
      }
      expect(h.stub.requests.length).toBe(1)
      expect(h.deps.guard.status().budgetUsed).toBe(1)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('源业务日不等于请求日时同参第二次零网络', () => {
  it('键由入参构造（businessDate 是值不是键），同参再次调用零出站', async () => {
    const h = await createHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2024-12-30', {}) } // 响应体日期 ≠ 请求日
      if (req.path.includes('surgeLimitList')) return { json: s7Payload('2024-12-30', {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      const first = await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(first.tradeDate).toBe('2024-12-30')
      expect(first.available).toBe(false)
      const firstCount = h.stub.requests.length
      expect(firstCount).toBeGreaterThan(0)
      const second = await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(second.errors).toEqual(first.errors)
      expect(h.stub.requests.length).toBe(firstCount) // 零网络
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('cacheSchema 不匹配视为未命中', () => {
  it('篡改磁盘缓存 schema 后重新取数并原位覆盖写回新 schema', async () => {
    const h = await createHarness(historyResponder(), { sources: { s7: { retries: 0 }, s5: { retries: 0 } } })
    try {
      await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(h.stub.requests.length).toBe(1)
      const bucket = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-02'))
      const listFile = (await readdir(bucket)).find((f) => f.startsWith('s7__list__'))
      expect(listFile).toBeDefined()
      const filePath = join(bucket, listFile as string)
      const entry = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
      entry['cacheSchema'] = 's7@0-stale'
      await writeFile(filePath, JSON.stringify(entry), 'utf8')

      const again = await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(again.available).toBe(true)
      expect(h.stub.requests.length).toBe(2) // 未命中 → 重新取数
      const rewritten = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
      expect(rewritten['cacheSchema']).toBe('s7@1') // 原位覆盖写（不另开垃圾文件）
      expect((await readdir(bucket)).filter((f) => f.startsWith('s7__list__')).length).toBe(1)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})

describe('概念缓存 schema 升级与无日期源键构造', () => {
  it('无日期源的键与目录由入参构造：businessDate=null 下同参第二次零网络、目录段=requestedDate', async () => {
    const h = await createHarness((req) => {
      if (req.path.includes('plates_by_any_stock')) {
        // S8 请求不带日期参数（T2 无日期语义）。
        expect(req.query.get('date')).toBeNull()
        return { json: s8Payload({ p1: { core_avg_pcp: 0.03, plate_name: '充电桩', plate_id: 'p1' } }) }
      }
      return undefined
    })
    try {
      const first = await getConcepts(h.deps, { code: '300750', date: '2025-01-02' })
      expect(first.businessDate).toBeNull()
      expect(first.notes).toContain('源无日期，按 requestedDate 缓存')
      expect(first.available).toBe(true)
      expect(h.stub.requests.length).toBe(1)
      const second = await getConcepts(h.deps, { code: '300750', date: '2025-01-02' })
      expect(second).toEqual(first)
      expect(h.stub.requests.length).toBe(1)
      const bucket = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-02'))
      expect((await readdir(bucket)).some((f) => f.startsWith('concepts__list__'))).toBe(true)
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })

  it('缓存 schema 升级视为未命中并覆盖写（concepts）', async () => {
    const h = await createHarness((req) => {
      if (req.path.includes('plates_by_any_stock')) return { json: s8Payload({ p1: { core_avg_pcp: 0.03, plate_name: '充电桩' } }) }
      return undefined
    })
    try {
      await getConcepts(h.deps, { code: '300750', date: '2025-01-02' })
      const bucket = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-02'))
      // schema 升级影响该模块全部缓存条目（列表级 + 派生视图级）：全部改写为旧 schema。
      const files = (await readdir(bucket)).filter((f) => f.startsWith('concepts__'))
      expect(files.length).toBeGreaterThanOrEqual(2)
      for (const f of files) {
        const filePath = join(bucket, f)
        const entry = JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>
        entry['cacheSchema'] = 'concepts@0-old'
        await writeFile(filePath, JSON.stringify(entry), 'utf8')
      }
      const again = await getConcepts(h.deps, { code: '300750', date: '2025-01-02' })
      expect(again.available).toBe(true)
      expect(h.stub.count('plates_by_any_stock')).toBe(2) // 未命中 → 重新取数
      for (const f of (await readdir(bucket)).filter((x) => x.startsWith('concepts__'))) {
        const rewritten = JSON.parse(await readFile(join(bucket, f), 'utf8')) as Record<string, unknown>
        expect(rewritten['cacheSchema']).toBe('concepts@2') // 原位覆盖写（不另开垃圾文件）
      }
    } finally {
      await h.cleanup()
      await h.stub.close()
    }
  })
})
