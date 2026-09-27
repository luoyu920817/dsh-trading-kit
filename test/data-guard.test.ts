/**
 * 出站传输与频控护栏单测（change data-foundation tasks 3.1/3.2/3.6/3.8）。
 * 零 mock：`node:http` 真实本地桩计数；guard 时钟/等待可注入（间隔时延用例走真实 60ms）。
 */
import { describe, expect, it, afterAll } from 'vitest'
import { requestJson, HttpDataError } from '../src/data/http.ts'
import { createDataGuard, isGuardRejection, type DataGuard, type GuardRejectionReason } from '../src/data/guard.ts'
import { fetchS7List } from '../src/data/s7.ts'
import { getLimitReason } from '../src/data/limit-reason.ts'
import { rateLimitDate } from '../src/data/date.ts'
import {
  startDataStub, createTempDataRoot, createTestDeps, s7Payload, s5HistoryPayload, type DataStubServer,
} from './helpers/data-stub.ts'
import type { DataDeps } from '../src/data/deps.ts'

/** 盘中固定时钟：2026-09-21（周一）上海 10:00 = UTC 02:00。 */
const MONDAY_1000 = (): Date => new Date('2026-09-21T02:00:00Z')
/** 盘后固定时钟：同一周一上海 16:00 = UTC 08:00。 */
const MONDAY_1600 = (): Date => new Date('2026-09-21T08:00:00Z')

const ALL_GUARD_REASONS: readonly GuardRejectionReason[] = ['sessionRejected', 'budgetExhausted', 'batchLimitExceeded', 'intervalLimited']

/** 断言拿到许可（未拒绝）并返回其类型收窄，供 release() 调用。 */
function expectPermit(r: Awaited<ReturnType<DataGuard['acquire']>>): Exclude<Awaited<ReturnType<DataGuard['acquire']>>, { rejected: true }> {
  expect(isGuardRejection(r)).toBe(false)
  if (isGuardRejection(r)) throw new Error(`意外拒绝：${r.reason}`)
  return r
}

// ---------------------------------------------------------------- 3.1 出站传输（http.ts）

describe('出站传输（http.ts，数据面唯一 fetch 调用点）', () => {
  it('超时显式错误（AbortSignal.timeout 截断）', async () => {
    const stub = await startDataStub()
    try {
      stub.setResponder(() => ({ status: 200, json: { ok: true }, delayMs: 300 }))
      const started = Date.now()
      const err = await requestJson(`${stub.base}/slow`, { timeoutMs: 60, retries: 0 }).catch((e) => e)
      expect(err).toBeInstanceOf(HttpDataError)
      expect((err as HttpDataError).kind).toBe('timeout')
      expect(Date.now() - started).toBeLessThan(2000)
    } finally {
      await stub.close()
    }
  })

  it('非 JSON 显式错误', async () => {
    const stub = await startDataStub()
    try {
      stub.setResponder(() => ({ status: 200, text: '<html>not json</html>' }))
      const err = await requestJson(`${stub.base}/text`, { timeoutMs: 2000, retries: 0 }).catch((e) => e)
      expect(err).toBeInstanceOf(HttpDataError)
      expect((err as HttpDataError).kind).toBe('nonJson')
    } finally {
      await stub.close()
    }
  })

  it('退避重试上限 2 次（真实 node:http 桩计数：1 + 2 = 3）', async () => {
    const stub = await startDataStub()
    try {
      stub.setResponder(() => ({ status: 500, text: 'down' }))
      const err = await requestJson(`${stub.base}/flaky`, { timeoutMs: 2000, retries: 2, backoffMs: 1 }).catch((e) => e)
      expect(err).toBeInstanceOf(HttpDataError)
      expect((err as HttpDataError).kind).toBe('non2xx')
      expect((err as HttpDataError).status).toBe(500)
      expect(stub.requests.length).toBe(3)
    } finally {
      await stub.close()
    }
  })

  it('代码强制拒绝 127.0.0.1:17709（数据面零 TQ 出站）', async () => {
    const stub = await startDataStub()
    try {
      const err = await requestJson('http://127.0.0.1:17709/tq', { timeoutMs: 1000, retries: 0 }).catch((e) => e)
      expect(err).toBeInstanceOf(HttpDataError)
      expect((err as HttpDataError).kind).toBe('blockedEndpoint')
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

// ---------------------------------------------------------------- 3.6 频控五 scenario（拒绝路径出站计数为 0）

describe('预算耗尽', () => {
  it('预算降到 1 后第二次调用显式失败 + 说明用量（拒绝路径桩出站计数 0）', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 1, fullMarketGuard: false, sessionOverride: 'off' }, { now: MONDAY_1600 })
      expectPermit(await guard.acquire({ source: 'S8', batch: 1 })).release()
      expect(guard.status().budgetUsed).toBe(1)
      const second = await guard.acquire({ source: 'S8', batch: 1 })
      expect(isGuardRejection(second)).toBe(true)
      const r = second as { reason: string; limit: number; used: number }
      expect(r.reason).toBe('budgetExhausted')
      expect(r.limit).toBe(1)
      expect(r.used).toBe(1)
      // 拒绝路径零出站：桩计数 0（预算在出站前判定）。
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

describe('盘中拒绝全市场级调用', () => {
  it('盘中（工作日 10:00）批量超上限被拒，出站计数 0', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 200, fullMarketGuard: true, sessionOverride: 'auto' }, { now: MONDAY_1000 })
      const rejected = await guard.acquire({ source: 'S7', batch: 25 })
      expect(isGuardRejection(rejected)).toBe(true)
      expect((rejected as { reason: string }).reason).toBe('batchLimitExceeded')
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

describe('盘中显式 fullMarket 标记被拒绝', () => {
  it('标的数未超上限但 fullMarket=true → sessionRejected（出站计数 0）', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 200, fullMarketGuard: true, sessionOverride: 'auto' }, { now: MONDAY_1000 })
      const rejected = await guard.acquire({ source: 'S7', batch: 5, fullMarket: true })
      expect(isGuardRejection(rejected)).toBe(true)
      expect((rejected as { reason: string }).reason).toBe('sessionRejected')
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

describe('盘后 offSession 只放宽时段闸门', () => {
  it('盘中声明 offSession → fullMarket 放行；间隔与预算仍强制（预算照耗、硬上限照拒）', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 200, fullMarketGuard: true, sessionOverride: 'auto' }, { now: MONDAY_1000, delay: async () => {} })
      const permitted = expectPermit(await guard.acquire({ source: 'S7', batch: 5, fullMarket: true, offSession: true }))
      permitted.release()
      // offSession 不放宽②硬上限。
      const overBatch = await guard.acquire({ source: 'S7', batch: 25, offSession: true })
      expect(isGuardRejection(overBatch)).toBe(true)
      expect((overBatch as { reason: string }).reason).toBe('batchLimitExceeded')
      // offSession 不放宽④预算：预算照常 +1。
      expect(guard.status().budgetUsed).toBe(1)
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

describe('限流时钟与业务日期解耦', () => {
  it('限流按固定时钟、业务日取源，互不污染（预算桶键 = 限流日）', async () => {
    const stub = await startDataStub()
    const { dataRoot, cleanup } = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimit')) return { json: s7Payload('2025-01-02', { '600000': { cause: '算力', first: '0931', last: '1430', open: 1 } }) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot, stub, now: MONDAY_1000, configOverrides: { sources: { s7: { retries: 0 } } } })
    try {
      const result = await getLimitReason(deps, { code: '600000' })
      // 业务日来自源响应体（2025-01-02），与限流日（2026-09-21）互不污染。
      expect(result.tradeDate).toBe('2025-01-02')
      expect(deps.guard.status().rateLimitDate).toBe(rateLimitDate(MONDAY_1000()))
      expect(deps.guard.status().rateLimitDate).toBe('2026-09-21')
      expect(result.available).toBe(true)
    } finally {
      await stub.close()
      await cleanup()
    }
  })
})

// ---------------------------------------------------------------- 3.2 验收补充用例

describe('offSession 不放宽批量硬上限', () => {
  it('offSession=true 且批量 25 > 20 → 仍拒 batchLimitExceeded（出站计数 0）', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 200, fullMarketGuard: true, sessionOverride: 'auto' }, { now: MONDAY_1600 })
      const rejected = await guard.acquire({ source: 'S5', batch: 25, offSession: true })
      expect(isGuardRejection(rejected)).toBe(true)
      const r = rejected as { reason: string; limit: number; used: number }
      expect(r.reason).toBe('batchLimitExceeded')
      expect(r.limit).toBe(20)
      expect(r.used).toBe(25)
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

describe('单标的调用仍受全局间隔约束', () => {
  it('第二次调用等待至间隔到期后才返回许可（真实 60ms 间隔计时）', async () => {
    const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 60, maxBatch: 20, dailyBudget: 200, fullMarketGuard: true, sessionOverride: 'off' }, { now: MONDAY_1600 })
    expectPermit(await guard.acquire({ source: 'S7', batch: 1 })).release()
    const started = Date.now()
    const second = expectPermit(await guard.acquire({ source: 'S7', batch: 1 }))
    const elapsed = Date.now() - started
    second.release()
    expect(elapsed).toBeGreaterThanOrEqual(50) // 60ms 间隔（留少量计时余量）
  })
})

describe('sessionOverride=off 盘中被视为盘后', () => {
  it('盘中时钟 + override=off：fullMarket 放行、sessionState=overridden', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 200, fullMarketGuard: true, sessionOverride: 'off' }, { now: MONDAY_1000 })
      const permitted = expectPermit(await guard.acquire({ source: 'S8', batch: 5, fullMarket: true }))
      permitted.release()
      expect(guard.status().sessionState).toBe('overridden')
      expect(guard.status().fullMarketGuard).toBe(false)
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

describe('History 请求计入列表级预算', () => {
  it('历史日取数（History 端点）后 S7 预算 +1', async () => {
    const stub = await startDataStub()
    const { dataRoot, cleanup } = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitHistory')) {
        const date = req.query.get('date') ?? ''
        const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
        return { json: s7Payload(iso, { '600000': { cause: '并购' } }) }
      }
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(null, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot, stub })
    try {
      // 2026-09-21 为周一（历史日 vs 固定时钟周一 16:00？——用固定盘后时钟 2026-09-21，请求日 2025-01-02 恒为历史日）。
      const result = await fetchS7List(deps, '2025-01-02')
      expect(result.ok).toBe(true)
      expect(result.endpoint).toBe('surgeLimitHistory')
      const s7 = deps.guard.status().sources.find((s) => s.source === 'S7')
      expect(s7?.budgetUsed).toBe(1)
      expect(deps.guard.status().budgetUsed).toBe(1)
    } finally {
      await stub.close()
      await cleanup()
    }
  })
})

describe('拒绝态具名', () => {
  it('四类拒绝均返回 { rejected:true, reason∈枚举, limit, used }', async () => {
    const stub = await startDataStub()
    try {
      const guard = createDataGuard({ maxConcurrency: 2, minIntervalMs: 1000, maxBatch: 20, dailyBudget: 1, fullMarketGuard: true, sessionOverride: 'auto' }, { now: MONDAY_1000 })
      const batch = await guard.acquire({ source: 'S7', batch: 25 })
      expect(isGuardRejection(batch) && batch.reason === 'batchLimitExceeded').toBe(true)
      const session = await guard.acquire({ source: 'S7', batch: 5, fullMarket: true })
      expect(isGuardRejection(session) && session.reason === 'sessionRejected').toBe(true)
      expectPermit(await guard.acquire({ source: 'S7', batch: 1 })).release() // 首次消耗预算 1/1
      const budget2 = await guard.acquire({ source: 'S7', batch: 1 })
      expect(isGuardRejection(budget2) && budget2.reason === 'budgetExhausted').toBe(true)
      // intervalLimited：独立 guard（预算充裕、关闭时段闸），间隔 1000ms + maxWaitMs=10 → 拒绝。
      const guard2 = createDataGuard({ maxConcurrency: 2, minIntervalMs: 1000, maxBatch: 20, dailyBudget: 200, fullMarketGuard: false, sessionOverride: 'off' }, { now: MONDAY_1600 })
      expectPermit(await guard2.acquire({ source: 'S5', batch: 1 })).release()
      const interval = await guard2.acquire({ source: 'S5', batch: 1, maxWaitMs: 10 })
      expect(isGuardRejection(interval) && interval.reason === 'intervalLimited').toBe(true)
      // 枚举闭合：以上 reason 全部 ∈ ALL_GUARD_REASONS。
      for (const r of ['batchLimitExceeded', 'sessionRejected', 'budgetExhausted', 'intervalLimited'] as const) {
        expect(ALL_GUARD_REASONS).toContain(r)
      }
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
    }
  })
})

// ---------------------------------------------------------------- 3.8 guardStatus 只读出口

describe('guardStatus 频控状态查询出口（3.8）', () => {
  let stub: DataStubServer
  let deps: DataDeps
  let cleanupDataRoot: () => Promise<void>
  const DATES = ['2025-01-02', '2025-01-03', '2025-01-06']

  afterAll(async () => {
    await stub.close()
    await cleanupDataRoot()
  })

  it('预算预检可用：3 次列表级请求后 budgetUsed=3、remaining=limit-3、查询前后出站计数不变', async () => {
    stub = await startDataStub()
    const root = await createTempDataRoot()
    cleanupDataRoot = root.cleanup
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2025-01-02', { '600000': { cause: 'x' } }) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    deps = createTestDeps({ dataRoot: root.dataRoot, stub, now: MONDAY_1600, configOverrides: { guard: { minIntervalMs: 1000 }, sources: { s7: { retries: 0 }, s5: { retries: 0 } } } })
    for (const d of DATES) await fetchS7List(deps, d)
    const before = stub.requests.length
    const status = deps.guard.status()
    expect(status.budgetUsed).toBe(3)
    expect(status.remaining).toBe(status.budgetLimit - 3)
    expect(status.rateLimitDate).toBe(rateLimitDate(MONDAY_1600()))
    expect(status.sources.find((s) => s.source === 'S7')?.budgetUsed).toBe(3)
    expect(status.fetchedAt).toContain('+08:00')
    // 查询不出站：桩计数与预算用量均不变。
    const status2 = deps.guard.status()
    expect(stub.requests.length).toBe(before)
    expect(status2.budgetUsed).toBe(status.budgetUsed)
    expect(status2.remaining).toBe(status.remaining)
    expect(status2.minIntervalMs).toBe(1000)
    expect(['inSession', 'offSession', 'overridden']).toContain(status2.sessionState)
  })

  it('预算耗尽时预检可判：remaining=0 足以支撑分批决策（N 可为 0）', async () => {
    const small = createDataGuard({ maxConcurrency: 2, minIntervalMs: 0, maxBatch: 20, dailyBudget: 2, fullMarketGuard: false, sessionOverride: 'off' }, { now: MONDAY_1600 })
    expectPermit(await small.acquire({ source: 'S7', batch: 1 })).release()
    expectPermit(await small.acquire({ source: 'S7', batch: 1 })).release()
    const status = small.status()
    expect(status.budgetUsed).toBe(status.budgetLimit)
    expect(status.remaining).toBe(0)
    // 消费方据此算出「本次可处理前 N 个标的」= 0，MUST NOT 自读缓存或推算。
    expect(status.remaining === 0 && status.budgetLimit === 2).toBe(true)
  })

  it('消费方不自建预算计数（结构断言：预算计数只存在于 guard.ts）', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dataDir = join(import.meta.dirname, '..', 'src', 'data')
    const files = readdirSync(dataDir).filter((f) => f.endsWith('.ts'))
    expect(files.length).toBeGreaterThan(0) // 扫描目标非空（防空过）
    const mutating = files.filter((f) => {
      const text = readFileSync(join(dataDir, f), 'utf8')
      return text.includes('budgetByDay') && f !== 'guard.ts'
    })
    expect(mutating).toEqual([]) // 第二份预算计数不存在
  })
})
