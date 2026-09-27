/**
 * T0 交易日解析单测（change data-foundation tasks 4.1/4.2/4.3）。
 * 零 mock：真实本地桩；结构断言扫描目标先验非空。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveTradeDate } from '../src/data/trade-date.ts'
import { getLimitReason } from '../src/data/limit-reason.ts'
import { rateLimitDate } from '../src/data/date.ts'
import { createTradeDateTool, renderTradeDateText } from '../src/tools/trade-date.ts'
import { startDataStub, createTempDataRoot, createTestDeps, s7Payload, s5HistoryPayload } from './helpers/data-stub.ts'

const OFF_SESSION = (): Date => new Date('2026-09-21T08:00:00Z') // 2026-09-21 周一盘后

describe('业务日 == 限流日 → true', () => {
  it('当日 List 响应体业务日 == 限流日 → isTradingDay=true（evidence 记录判定依据）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    const today = rateLimitDate() // 经 date.ts 取得（测试不自行截断系统日期）
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(today, { '600000': { cause: 'x' } }) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const result = await resolveTradeDate(deps, {})
      expect(result.requestedDate).toBe(today)
      expect(result.businessDate).toBe(today)
      expect(result.isTradingDay).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.evidence.rateLimitDate).toBe(today)
      expect(result.evidence.businessDateField).toBe('data.date')
      expect(result.source).toBe('S7')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('业务日 != 限流日 → null', () => {
  it('历史请求（业务日 2025-01-02）→ isTradingDay=null，MUST NOT 返回 false', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2025-01-02', {}) }
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(null, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const result = await resolveTradeDate(deps, { date: '2025-01-02' })
      expect(result.businessDate).toBe('2025-01-02')
      expect(result.isTradingDay).toBeNull()
      expect(result.isTradingDay).not.toBe(false)
      expect(result.requestedDate).toBe('2025-01-02')
      expect(result.notes.join('\n')).toContain('归属待用户确认')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('紧凑写法与带连字符写法判为同一日', () => {
  it("'20260924' 与 '2026-09-24' 归一后同一 requestedDate、同一缓存键（第二次零网络）、不允许恒 null", async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2026-09-24', {}) }
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(null, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const compact = await resolveTradeDate(deps, { date: '20260924' })
      const iso = await resolveTradeDate(deps, { date: '2026-09-24' })
      expect(compact.requestedDate).toBe('2026-09-24')
      expect(iso.requestedDate).toBe('2026-09-24')
      expect(compact.businessDate).toBe('2026-09-24')
      expect(compact.businessDate).toBe(iso.businessDate)
      expect(iso.isTradingDay).toBeNull() // 历史日：非恒 false、按规则 null
      expect(stub.requests.length).toBe(1) // 第二种写法命中同一缓存键
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('列表为空仍取到业务日期', () => {
  it('源列表成功但为空 → businessDate 仍为响应体日期（非 null、不回退限流日）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload('2025-01-02', {}) }
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2025-01-02', {}) } // 历史路由（请求日 2025-01-02）
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const result = await resolveTradeDate(deps, { date: '2025-01-02' })
      expect(result.businessDate).toBe('2025-01-02')
      expect(result.businessDate).not.toBeNull()
      expect(result.errors).toEqual([])
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('非法日期零请求', () => {
  it("'2026/09/24'、'2026-13-01'、'202609' → 显式参数错误 + 出站计数 0", async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      for (const bad of ['2026/09/24', '2026-13-01', '202609']) {
        const result = await resolveTradeDate(deps, { date: bad })
        expect(result.errors).toEqual(['invalidParam'])
        expect(result.businessDate).toBeNull()
        expect(result.isTradingDay).toBeNull()
      }
      expect(stub.requests.length).toBe(0)
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('当日重复调用零网络 + 复用列表级缓存不重复取数', () => {
  it('T1 先完成 S7 列表级请求后 T0 零新增出站（同一列表级缓存条目）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    const today = rateLimitDate()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(today, { '600000': { cause: '题材', first: '0931' } }) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const t1 = await getLimitReason(deps, { code: '600000' })
      expect(t1.available).toBe(true)
      expect(stub.requests.length).toBe(1)
      const t0 = await resolveTradeDate(deps, {})
      expect(stub.requests.length).toBe(1) // 复用 T1 的列表级缓存，不新增出站
      expect(t0.businessDate).toBe(today)
      expect(t0.isTradingDay).toBe(true)
      // T0 自身重复调用同样零网络。
      const t0b = await resolveTradeDate(deps, {})
      expect(t0b).toEqual(t0)
      expect(stub.requests.length).toBe(1)
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('源业务日不等于请求日时同参仍零网络', () => {
  it('首取 businessDate≠requestedDate，同参再次调用命中同一键 → 出站计数 0', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2024-12-31', {}) }
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(null, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      const first = await resolveTradeDate(deps, { date: '2025-01-02' })
      expect(first.businessDate).toBe('2024-12-31')
      const count = stub.requests.length
      const second = await resolveTradeDate(deps, { date: '2025-01-02' })
      expect(second.businessDate).toBe('2024-12-31')
      expect(stub.requests.length).toBe(count)
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

describe('工具与 service 双出口同一实现（4.2）', () => {
  it('工具 execute 与 service resolveTradeDate 同一实现函数、第二次零网络、结果相同', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    const today = rateLimitDate()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(today, { '600000': { cause: 'x' } }) }
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(today, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    const facade = {
      resolveTradeDate: (input: { date?: string }) => resolveTradeDate(deps, input),
    }
    try {
      const tool = createTradeDateTool(facade)
      const viaService = await facade.resolveTradeDate({})
      const viaTool = await tool.execute({}, {} as never)
      expect(viaTool).toEqual(viaService)
      expect(stub.requests.length).toBe(1) // 第二次命中缓存零网络
      expect(renderTradeDateText(viaService)).toContain('isTradingDay=true')
      expect(renderTradeDateText(viaService)).not.toContain('数据不可用')
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

// ---------------------------------------------------------------- 4.3 结构断言

describe('结构断言（4.3）：trade-date.ts 不自行推断交易日', () => {
  const sourcePath = join(import.meta.dirname, '..', 'src', 'data', 'trade-date.ts')

  it('不得自行推断交易日（无 getDay/星期/节假日分支；扫描目标非空）', () => {
    const text = readFileSync(sourcePath, 'utf8')
    expect(text.length).toBeGreaterThan(0) // 扫描目标非空
    expect(text).not.toMatch(/getDay\(|getUTCDay\(/)
    expect(text).not.toMatch(/星期[一二三四五六日末]/)
    expect(text).not.toMatch(/isTradingDay\s*[:=]\s*false/)
    // 日期事实只来自响应体：不存在用 rateLimitDate/new Date 直接充当 businessDate 的产出路径
    expect(text).not.toMatch(/businessDate\s*[:=]\s*rateLimitDate/)
  })

  it('无交易日历不得伪造结论（isTradingDay 产出路径只有 true|null）', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    stub.setResponder(() => ({ status: 500, text: 'down' }))
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub, configOverrides: { sources: { s7: { retries: 0 }, s5: { retries: 0 } } } })
    try {
      const result = await resolveTradeDate(deps, {})
      expect(result.isTradingDay === true || result.isTradingDay === null).toBe(true)
      expect(result.businessDate).toBeNull()
      expect(result.errors).toContain('sourceUnavailable')
      // 输出 schema 含 errors 数组 + isTradingDay 取值域 true|null（schema 层约束）。
      const tool = createTradeDateTool({ resolveTradeDate: (input) => resolveTradeDate(deps, input) })
      const props = (tool as unknown as { output: { schema: { properties: Record<string, { type?: string; oneOf?: unknown }> } } }).output.schema.properties
      expect(props['errors']?.type).toBe('array')
      const isTradingDay = props['isTradingDay'] as { oneOf?: Array<{ type?: string; const?: unknown }> }
      expect(isTradingDay.oneOf?.some((b) => b.type === 'boolean' && b.const === true)).toBe(true)
      expect(isTradingDay.oneOf?.some((b) => b.type === 'null')).toBe(true)
      // T0 入参 schema 无 refresh（7.3⑥ 的 T0 部分）；keys 非空。
      const params = (tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters
      expect(Object.keys(params.properties ?? {})).toEqual(['date'])
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})
