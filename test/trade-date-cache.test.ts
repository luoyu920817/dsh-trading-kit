import { describe, expect, it } from 'vitest'
import { createTradeDateCache } from '../src/data/trade-date-cache.ts'
import { createTempDataRoot, createTestDeps, s7Payload, startDataStub } from './helpers/data-stub.ts'

/**
 * 建立交易日缓存真实测试环境。
 * 业务逻辑: 使用临时目录与本地 HTTP 源，时钟由测试推进。
 * 关键判断: 源日期与请求日独立，避免测试默认把系统日当业务日。
 * 异常处理: 调用方在 finally 释放服务与目录。
 * 参数: 无。
 * 返回: 真实依赖、可推进时钟与清理入口。
 */
async function fixture() {
  const stub = await startDataStub()
  const root = await createTempDataRoot()
  let instant = new Date('2026-10-09T08:00:00Z')
  const deps = createTestDeps({ dataRoot: root.dataRoot, stub, now: () => instant })
  stub.setResponder(() => ({ json: s7Payload('2026-10-08', { '600000': { cause: '测试' } }) }))
  return { stub, root, deps, cache: createTradeDateCache(deps), advance: (value: string) => { instant = new Date(value) } }
}

describe('同步交易日快照', () => {
  it('冷态peek零I/O，归一化并发同日只发一次请求，并记录完整权威结果', async () => {
    const f = await fixture()
    try {
      expect(f.cache.peek()).toBeNull()
      expect(f.stub.requests).toEqual([])
      const [first, second, third] = await Promise.all([
        f.cache.resolve(), f.cache.resolve({ date: '20261009' }), f.cache.resolve({ date: '2026-10-09' }),
      ])
      expect(second).toBe(first)
      expect(third).toBe(first)
      expect(f.cache.peek()).toEqual(first)
      expect(first.businessDate).toBe('2026-10-08')
      expect(first.isTradingDay).toBeNull()
      expect(f.stub.requests).toHaveLength(1)
      await f.root.cleanup()
      expect(f.cache.peek()).toEqual(first)
      expect(f.stub.requests).toHaveLength(1)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('历史并发独立，不覆盖默认快照，跨限流日peek立即回到冷态', async () => {
    const f = await fixture()
    try {
      const [today, historical] = await Promise.all([f.cache.resolve(), f.cache.resolve({ date: '2026-10-07' })])
      expect(historical.requestedDate).toBe('2026-10-07')
      expect(f.stub.requests).toHaveLength(2)
      expect(f.cache.peek()).toEqual(today)
      f.advance('2026-10-10T08:00:00Z')
      expect(f.cache.peek()).toBeNull()
      expect(f.stub.requests).toHaveLength(2)
      await f.cache.refreshCurrent()
      expect(f.cache.peek()?.requestedDate).toBe('2026-10-10')
      expect(f.cache.peek()?.businessDate).toBe('2026-10-08')
      expect(f.stub.requests).toHaveLength(3)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('60s后台刷新复用列表缓存，失败保留同日旧结果，随后可恢复', async () => {
    const f = await fixture()
    try {
      const original = await f.cache.resolve()
      await f.cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(1)
      f.advance('2026-10-09T08:01:01Z')
      f.stub.setResponder(() => ({ status: 503, text: '暂时不可用' }))
      await f.cache.refreshCurrent()
      expect(f.cache.peek()).toEqual(original)
      const failedRequests = f.stub.requests.length
      expect(failedRequests).toBeGreaterThan(1)
      await f.cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(failedRequests)
      f.advance('2026-10-09T08:02:02Z')
      f.stub.setResponder(() => ({ json: s7Payload('2026-10-09', { '600001': {} }) }))
      await f.cache.refreshCurrent()
      expect(f.cache.peek()?.businessDate).toBe('2026-10-09')
      expect(f.cache.peek()?.isTradingDay).toBe(true)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('解析完成但无businessDate也保存权威不可得结果，非法日期不污染快照', async () => {
    const f = await fixture()
    try {
      f.stub.setResponder(() => ({ json: s7Payload(null, {}) }))
      const result = await f.cache.resolve()
      expect(result.source).toBe('S7')
      expect(result.businessDate).toBeNull()
      expect(f.cache.peek()).toEqual(result)
      const count = f.stub.requests.length
      const invalid = await f.cache.resolve({ date: '2026/10/09' })
      expect(invalid.errors).toEqual(['invalidParam'])
      expect(f.cache.peek()).toEqual(result)
      expect(f.stub.requests).toHaveLength(count)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('未配置dataRoot时启动不预热网络，disposer可重复调用', async () => {
    const f = await fixture()
    try {
      const cache = createTradeDateCache({ ...f.deps, dataRoot: '' })
      const dispose = cache.start()
      dispose()
      dispose()
      expect(cache.peek()).toBeNull()
      expect(f.stub.requests).toEqual([])
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('首次源失败保存source=null原结果供不可用状态消费，重试不猜业务日', async () => {
    const f = await fixture()
    try {
      f.stub.setResponder(() => ({ status: 503, text: '不可用' }))
      const result = await f.cache.resolve()
      expect(result.source).toBeNull()
      expect(result.businessDate).toBeNull()
      expect(result.errors).toEqual(['sourceUnavailable'])
      expect(f.cache.peek()).toEqual(result)
      const count = f.stub.requests.length
      await f.cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(count)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('旧日期在途解析跨日后到达，不能作为新日默认快照', async () => {
    const f = await fixture()
    try {
      const pending = f.cache.resolve()
      f.advance('2026-10-10T08:00:00Z')
      const old = await pending
      expect(old.requestedDate).toBe('2026-10-09')
      expect(f.cache.peek()).toBeNull()
      await f.cache.refreshCurrent()
      expect(f.cache.peek()?.requestedDate).toBe('2026-10-10')
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('后台仅占S7日预算20%，保留用户显式解析能力并按日恢复后台额度', async () => {
    const f = await fixture()
    try {
      const deps = createTestDeps({ dataRoot: f.root.dataRoot, stub: f.stub, now: f.deps.now, configOverrides: { guard: { dailyBudget: 5 } } })
      const cache = createTradeDateCache(deps)
      await cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(1)
      f.advance('2026-10-09T08:01:00Z')
      await cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(1)
      expect(cache.peek()?.notes.join(' ')).toContain('backgroundTradeDateBudgetReserved')
      f.stub.setResponder(() => ({ json: s7Payload('2026-10-09', { '600001': {} }) }))
      await cache.resolve()
      expect(f.stub.requests).toHaveLength(2)
      expect(cache.peek()?.businessDate).toBe('2026-10-09')
      f.advance('2026-10-10T08:00:00Z')
      await cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(3)
      expect(cache.peek()?.requestedDate).toBe('2026-10-10')
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('源剩余额度达到前台保留值时不启动新的后台请求', async () => {
    const f = await fixture()
    try {
      const deps = createTestDeps({ dataRoot: f.root.dataRoot, stub: f.stub, now: f.deps.now, configOverrides: { guard: { dailyBudget: 5 } } })
      const permit = await deps.guard.acquire({ source: 'S7' })
      if ('release' in permit) permit.release()
      const notes: string[] = []
      const cache = createTradeDateCache(deps, { onBackgroundSkip: (note) => notes.push(note) })
      await cache.refreshCurrent()
      expect(f.stub.requests).toEqual([])
      expect(cache.peek()).toBeNull()
      expect(notes).toHaveLength(1)
      expect(notes[0]).toContain('backgroundTradeDateBudgetReserved')
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('59秒的前台缓存读取不能把后台刷新推迟到119秒', async () => {
    const f = await fixture()
    try {
      await f.cache.resolve()
      f.advance('2026-10-09T08:00:59Z')
      await f.cache.resolve()
      expect(f.stub.requests).toHaveLength(1)
      f.advance('2026-10-09T08:01:00Z')
      await f.cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(2)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('后台失败在4999毫秒不重试、5000毫秒边界可重试', async () => {
    const f = await fixture()
    try {
      f.stub.setResponder(() => ({ status: 503, text: '失败' }))
      await f.cache.refreshCurrent()
      const count = f.stub.requests.length
      f.advance('2026-10-09T08:00:04.999Z')
      await f.cache.refreshCurrent()
      expect(f.stub.requests).toHaveLength(count)
      f.advance('2026-10-09T08:00:05Z')
      await f.cache.refreshCurrent()
      expect(f.stub.requests.length).toBeGreaterThan(count)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })

  it('配置数据根后start立即预热，每秒检查timer由disposer释放', async () => {
    const f = await fixture()
    try {
      const scheduled = new Map<number, () => Promise<void>>()
      let interval = 0
      let signalRequest!: () => void
      const preheated = new Promise<void>((resolve) => { signalRequest = resolve })
      f.stub.setResponder(() => {
        signalRequest()
        return { json: s7Payload('2026-10-08', { '600000': {} }) }
      })
      const cache = createTradeDateCache(f.deps, { schedule: (check, ms) => {
        interval = ms
        scheduled.set(1, check)
        return () => { scheduled.delete(1) }
      } })
      const dispose = cache.start()
      expect(interval).toBe(1000)
      expect(scheduled.size).toBe(1)
      // 等待真实HTTP事件，未触发任何手动check即可证明start立即发起预热。
      await preheated
      expect(f.stub.requests).toHaveLength(1)
      await scheduled.get(1)!()
      expect(cache.peek()?.businessDate).toBe('2026-10-08')
      expect(f.stub.requests).toHaveLength(1)
      f.advance('2026-10-09T08:01:00Z')
      await scheduled.get(1)!()
      expect(f.stub.requests).toHaveLength(2)
      dispose()
      dispose()
      expect(scheduled.size).toBe(0)
    } finally { await f.stub.close(); await f.root.cleanup() }
  })
})
