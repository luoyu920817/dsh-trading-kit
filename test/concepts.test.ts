/**
 * T2 概念单测（change data-foundation tasks 6.1/6.2/6.3/6.5）。
 * 零 mock：真实本地桩；fixture（6.6 实测）存在时附加真实响应形状断言。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getConcepts, parsePlates, classifyStrength, REASON_MAX_LENGTH } from '../src/data/concepts.ts'
import { S8_FIELDS, s8SymbolForCode } from '../src/data/s8.ts'
import { toCompactDate } from '../src/data/date.ts'
import { createConceptsTool, renderConceptsText } from '../src/tools/concepts.ts'
import {
  startDataStub, createTempDataRoot, createTestDeps, s8Payload, type DataStubServer, type S8StubPlate,
} from './helpers/data-stub.ts'

const OFF_SESSION = (): Date => new Date('2026-09-21T08:00:00Z') // 2026-09-21 周一盘后

interface Harness {
  stub: DataStubServer
  deps: ReturnType<typeof createTestDeps>
  dataRoot: string
  cleanup(): Promise<void>
}

function s8Responder(plates: Record<string, S8StubPlate>, code = 20000): Parameters<DataStubServer['setResponder']>[0] {
  return (req) => {
    if (req.path.includes('plates_by_any_stock')) {
      // T2 无日期语义：请求 MUST NOT 带日期参数。
      expect(req.query.get('date')).toBeNull()
      expect(req.query.get('fields')).toBe(S8_FIELDS)
      return { json: s8Payload(plates, code) }
    }
    return undefined
  }
}

async function withHarness(plates: Record<string, S8StubPlate>, fn: (h: Harness) => Promise<void>, code = 20000): Promise<void> {
  const stub = await startDataStub()
  const root = await createTempDataRoot()
  stub.setResponder(s8Responder(plates, code))
  const deps = createTestDeps({ dataRoot: root.dataRoot, stub, now: OFF_SESSION })
  try {
    await fn({ stub, deps, dataRoot: root.dataRoot, cleanup: root.cleanup })
  } finally {
    await root.cleanup()
    await stub.close()
  }
}

const BASIC_PLATES: Record<string, S8StubPlate> = {
  p1: {
    core_avg_pcp: 0.062,
    plate_name: '算力',
    reason: '海外算力订单持续超预期，国内算力租赁价格上行',
    plate_id: 'p1',
    top_n_stocks: { items: [{ symbol: '600000.SS', stock_chi_name: '浦发银行' }] },
  },
  p2: { core_avg_pcp: 0.02, plate_name: '存储', reason: '存储涨价', plate_id: 'p2' },
  p3: { core_avg_pcp: -0.01, plate_name: '地产', plate_id: 'p3' },
}

// ---------------------------------------------------------------- 6.1 S8 客户端

describe('请求白名单含 reason 与 plate_id', () => {
  it('query 序列化结果含 5 个字段 + .SS/.SZ 后缀（对真实本地桩断言）', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      await getConcepts(h.deps, { code: '600000' })
      const req = h.stub.requests[0]
      expect(req.query.get('fields')).toBe('core_avg_pcp,plate_name,reason,plate_id,top_n_stocks')
      expect(req.query.get('symbol')).toBe('600000.SS')
      // headers（照脚本：UA / Accept / Referer）。
      void req
      // 沪 .SS / 深 .SZ 的表驱动判定。
      expect(s8SymbolForCode('600000').verified && s8SymbolForCode('600000').symbol).toBe('600000.SS')
      expect(s8SymbolForCode('000001').verified && s8SymbolForCode('000001').symbol).toBe('000001.SZ')
      expect(s8SymbolForCode('300750').verified && s8SymbolForCode('300750').symbol).toBe('300750.SZ')
    })
  })
})

describe('成功码判定', () => {
  it('code===20000 成功；非 20000 → available=false + 显式错误', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      const ok = await getConcepts(h.deps, { code: '600000' })
      expect(ok.available).toBe(true)
    }, 20000)
    await withHarness(BASIC_PLATES, async (h) => {
      const bad = await getConcepts(h.deps, { code: '600000' })
      expect(bad.available).toBe(false)
      expect(bad.errors.join('\n')).toContain('20001')
      expect(bad.concepts).toEqual([])
    }, 20001)
  })
})

describe('北交所后缀待验证标注', () => {
  it('北交所代码 → 零请求 + 「后缀规则待验证」标注（MUST NOT 静默按深市）', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      const r = await getConcepts(h.deps, { code: '830001' })
      expect(h.stub.requests.length).toBe(0)
      expect(r.available).toBe(false)
      expect(r.notes.join('\n')).toContain('待验证')
    })
  })
})

// ---------------------------------------------------------------- 6.2 解析层

describe('分档边界', () => {
  it('6.2→强 / 5→强 / 2→中 / 1.9→弱 / 0→平 / -1→跌（含 spec scenario 0.062→6.2 强）', () => {
    expect(classifyStrength(6.2)).toBe('强')
    expect(classifyStrength(5)).toBe('强')
    expect(classifyStrength(2)).toBe('中')
    expect(classifyStrength(1.9)).toBe('弱')
    expect(classifyStrength(0.01)).toBe('弱')
    expect(classifyStrength(0)).toBe('平')
    expect(classifyStrength(-0.01)).toBe('跌')
    expect(classifyStrength(-1)).toBe('跌')
    // 解析层换算：0.062 → strengthPct 6.2、strength 强。
    const { concepts } = parsePlates({ p: { core_avg_pcp: 0.062, plate_name: '算力' } }, '600000', null)
    expect(concepts[0]?.strengthPct).toBe(6.2)
    expect(concepts[0]?.strength).toBe('强')
    const flat = parsePlates({ p: { core_avg_pcp: 0, plate_name: '平' } }, '600000', null)
    expect(flat.concepts[0]?.strengthPct).toBe(0)
    expect(flat.concepts[0]?.strength).toBe('平')
  })
})

describe('降序排列', () => {
  it('按 strengthPct 降序（越热越前）', async () => {
    await withHarness({
      a: { core_avg_pcp: 0.01, plate_name: '弱A' },
      b: { core_avg_pcp: 0.09, plate_name: '强B' },
      c: { core_avg_pcp: 0.05, plate_name: '中C' },
    }, async (h) => {
      const r = await getConcepts(h.deps, { code: '600000' })
      expect(r.concepts.map((c) => c.name)).toEqual(['强B', '中C', '弱A'])
      expect(r.concepts.map((c) => c.strengthPct)).toEqual([9, 5, 1])
    })
  })
})

describe('名称命中与未命中', () => {
  it('top_n_stocks 命中 → stock_chi_name；未命中 → null（不猜）', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      const hit = await getConcepts(h.deps, { code: '600000' })
      expect(hit.name).toBe('浦发银行')
    })
    await withHarness(BASIC_PLATES, async (h) => {
      // 600519 不在任何 top_n_stocks.items 中 → null。
      const miss = await getConcepts(h.deps, { code: '600519' })
      expect(miss.name).toBeNull()
    })
  })
})

describe('空数据显式不可用（owner 实测修订 2026-10-05：空 = 未收录，负缓存）', () => {
  it('data 为空对象 → available=false + 负缓存（第二次零网络），不用空列表冒充成功', async () => {
    await withHarness({}, async (h) => {
      const r = await getConcepts(h.deps, { code: '600000' })
      expect(r.available).toBe(false)
      // 未收录 = 源端正常应答（非源错误）——errors 空，notes 记负缓存事实。
      expect(r.errors).toEqual([])
      expect(r.notes.some((n) => n.includes('未收录'))).toBe(true)
      expect(r.concepts).toEqual([])
      const countBefore = h.stub.count('plates_by_any_stock')
      const r2 = await getConcepts(h.deps, { code: '600000' })
      expect(h.stub.count('plates_by_any_stock')).toBe(countBefore) // 负缓存零出站
      expect(r2.available).toBe(false)
    })
  })
})

describe('跨日不命中', () => {
  it('两个请求日各 1 次请求（缓存按 requestedDate 分桶；非限流日也不产生 dateUnavailable）', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      await getConcepts(h.deps, { code: '600000', date: '2025-01-02' })
      await getConcepts(h.deps, { code: '600000', date: '2025-01-03' })
      expect(h.stub.count('plates_by_any_stock')).toBe(2)
    })
  })
})

describe('reason 截断', () => {
  it('超过 200 字 → 截断到 200 且 notes 标注', async () => {
    const longReason = '长'.repeat(REASON_MAX_LENGTH + 50)
    await withHarness({ p: { core_avg_pcp: 0.03, plate_name: 'x', reason: longReason, plate_id: 'p' } }, async (h) => {
      const r = await getConcepts(h.deps, { code: '600000' })
      expect(r.concepts[0]?.reason.value?.length ?? 0).toBeLessThanOrEqual(200)
      expect(r.concepts[0]?.reason.value?.length).toBe(REASON_MAX_LENGTH)
      expect(r.notes.join('\n')).toContain('截断')
    })
  })
})

describe('businessDate=null + notes 标注', () => {
  it('S8 无日期字段 → businessDate=null 且 notes 记「源无日期，按 requestedDate 缓存」', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      const r = await getConcepts(h.deps, { code: '600000', date: '2025-01-02' })
      expect(r.businessDate).toBeNull()
      expect(r.notes).toContain('源无日期，按 requestedDate 缓存')
      // 目录段仍按 requestedDate 折算。
      const { readdir } = await import('node:fs/promises')
      const bucket = join(h.dataRoot, 'agent/DB/temp/dsh-trader-kit', toCompactDate('2025-01-02'))
      expect((await readdir(bucket)).length).toBeGreaterThan(0)
    })
  })
})

describe('非限流日 date 不产生 dateUnavailable', () => {
  it('传历史写法 date 只用于缓存分桶：无 dateUnavailable、仍取当日实时快照', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      const r = await getConcepts(h.deps, { code: '600000', date: '2025-01-02' })
      expect(r.errors).not.toContain('dateUnavailable')
      expect(r.errors).toEqual([])
      expect(r.available).toBe(true)
      expect(r.requestedDate).toBe('2025-01-02')
    })
  })
})

describe('reason/plateId best-effort 降级', () => {
  it('源未返回 reason/plateId → null + source/fetchedAt + notes（不阻塞 available）', async () => {
    await withHarness({ p: { core_avg_pcp: 0.03, plate_name: '仅有的概念' } }, async (h) => {
      const r = await getConcepts(h.deps, { code: '600000' })
      expect(r.available).toBe(true) // 字段缺失不阻塞可用
      const item = r.concepts[0]
      expect(item?.reason).toMatchObject({ value: null, source: 'S8' })
      expect(item?.plateId).toMatchObject({ value: null, source: 'S8' })
      expect(item?.reason.fetchedAt).not.toBeNull()
      expect(r.notes.join('\n')).toContain('best-effort')
    })
  })
})

describe('工具与渲染（6.4 schema 快照）', () => {
  it('输出 schema 快照含 businessDate/reason/plateId/strength/strengthPct/notes/errors；渲染非零值冒充', async () => {
    await withHarness(BASIC_PLATES, async (h) => {
      const facade = { getConcepts: (input: { code: string; date?: string }) => getConcepts(h.deps, input) }
      const tool = createConceptsTool(facade)
      const props = (tool as unknown as { output: { schema: { properties: Record<string, unknown> } } }).output.schema.properties
      for (const key of ['businessDate', 'name', 'concepts', 'notes', 'errors', 'source', 'fetchedAt', 'available', 'code', 'requestedDate']) {
        expect(props[key], `输出 schema 缺少 ${key}`).toBeDefined()
      }
      const conceptProps = (props['concepts'] as { items: { properties: Record<string, unknown> } }).items.properties
      for (const key of ['name', 'strength', 'strengthPct', 'reason', 'plateId', 'source', 'fetchedAt']) {
        expect(conceptProps[key], `概念项 schema 缺少 ${key}`).toBeDefined()
      }
      // T2 入参 schema 无 refresh、keys 非空（7.3⑥）。
      const params = (tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters
      expect(Object.keys(params.properties ?? {}).sort()).toEqual(['code', 'date'])
      const result = await facade.getConcepts({ code: '600000' })
      const text = renderConceptsText(result)
      expect(text).toContain('算力')
      expect(text).toContain('强')
      expect(text).not.toContain('0 项为显式不可用')
    })
  })
})

// ---------------------------------------------------------------- 6.6 实测 fixture

describe('S8 实测 fixture（6.6，真实响应定稿）', () => {
  const fixturePath = join(import.meta.dirname, 'fixtures', 's8-plates.json')
  it('fixture 存在则 parsePlates 解析出降序概念与 best-effort 字段结论', () => {
    if (!existsSync(fixturePath)) {
      throw new Error('test/fixtures/s8-plates.json 缺失：6.6 要求真实 S8 响应 fixture（网络失败则该任务不得勾选）')
    }
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
      meta?: { fetchedAt?: string; conclusion?: string; fieldStats?: { platesTotal?: number; platesWithPlateId?: number; platesWithReason?: number } }
      response?: { code?: number; data?: Record<string, unknown> }
    }
    expect(fixture.response?.code).toBe(20000)
    const data = fixture.response?.data ?? {}
    const parsed = parsePlates(data, '600000', fixture.meta?.fetchedAt ?? null)
    expect(Array.isArray(parsed.concepts)).toBe(true)
    // 降序不变量对真实响应同样成立。
    const pcts = parsed.concepts.map((c) => c.strengthPct)
    for (let i = 1; i < pcts.length; i += 1) expect(pcts[i - 1]).toBeGreaterThanOrEqual(pcts[i] as number)
    // 6.6 实测定稿：plate_id 必返（number）；reason 源有值时必返、天然缺失时 best-effort null。
    const stats = fixture.meta?.fieldStats
    expect(stats?.platesWithPlateId).toBe(stats?.platesTotal)
    const withReason = fixture.meta?.fieldStats?.platesWithReason ?? 0
    if (withReason < (stats?.platesTotal ?? 0)) {
      // 存在天然无 reason 的概念 → notes 含 best-effort 标注，缺失项 value=null。
      expect(parsed.notes.join('\n')).toContain('best-effort')
      const missing = parsed.concepts.filter((c) => c.reason.value === null)
      expect(missing.length).toBeGreaterThanOrEqual(1)
    }
  })
})
