/**
 * T1 涨停原因单测（change data-foundation tasks 5.3/5.4/5.6）。
 * 零 mock：真实本地桩按端点编程响应；13 组覆盖缺口用例 + 首封时间红线 + 日期三义。
 */
import { describe, expect, it } from 'vitest'
import { getLimitReason } from '../src/data/limit-reason.ts'
import { S5_MARKET_TABLE } from '../src/data/s5.ts'
import { rateLimitDate } from '../src/data/date.ts'
import {
  startDataStub, createTempDataRoot, createTestDeps, s7Payload, s5HistoryPayload, s5DetailPayload, type DataStubServer,
} from './helpers/data-stub.ts'

const OFF_SESSION = (): Date => new Date('2026-09-21T08:00:00Z') // 2026-09-21 周一盘后
const TODAY = rateLimitDate(OFF_SESSION()) // '2026-09-21'
const HIST = '2025-01-02'

interface Harness {
  stub: DataStubServer
  deps: ReturnType<typeof createTestDeps>
  cleanup(): Promise<void>
}

async function createHarness(responder: Parameters<DataStubServer['setResponder']>[0]): Promise<Harness> {
  const stub = await startDataStub()
  const root = await createTempDataRoot()
  stub.setResponder(responder)
  const deps = createTestDeps({ dataRoot: root.dataRoot, stub, now: OFF_SESSION, configOverrides: { sources: { s7: { retries: 0 }, s5: { retries: 0 } } } })
  return { stub, deps, cleanup: root.cleanup }
}

async function withHarness(responder: Parameters<DataStubServer['setResponder']>[0], fn: (h: Harness) => Promise<void>): Promise<void> {
  const h = await createHarness(responder)
  try {
    await fn(h)
  } finally {
    await h.cleanup()
    await h.stub.close()
  }
}

const S7_LIST_OK = (date: string, rows: Record<string, { cause?: string; first?: string; last?: string; open?: number; surgedays?: string }>): Parameters<DataStubServer['setResponder']>[0] =>
  (req) => {
    // List/History 两端点同数据（路由由请求日 vs 限流日决定，桩不区分端点语义）。
    if (req.path.includes('surgeLimitList') || req.path.includes('surgeLimitHistory')) return { json: s7Payload(date, rows) }
    if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
    return undefined
  }

// ---------------------------------------------------------------- 5.6 覆盖缺口 13 组

describe('主源成功', () => {
  it('当日 List 命中：available=true、source=S7、firstTime 来自 first_time、零备源请求', async () => {
    await withHarness(S7_LIST_OK(TODAY, { '600000': { cause: '算力+液冷', first: '0931', last: '1430', open: 2, surgedays: '3连板' } }), async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000' })
      expect(r.available).toBe(true)
      expect(r.source).toBe('S7')
      expect(r.requestedDate).toBe(TODAY)
      expect(r.tradeDate).toBe(TODAY)
      expect(r.cause).toMatchObject({ value: '算力+液冷', source: 'S7' })
      expect(r.firstTime).toMatchObject({ value: '09:31', source: 'S7' })
      expect(r.lastTime).toMatchObject({ value: '14:30', source: 'S7' })
      expect(r.openCount).toMatchObject({ value: 2, source: 'S7' })
      expect(r.streakDesc).toMatchObject({ value: '3连板', source: 'S7' })
      expect(r.errors).toEqual([])
      expect(h.stub.count('anomaly/v1/history')).toBe(0) // 主源命中不取备源
    })
  })
})

describe('主源空走备源', () => {
  it('当日 List 空且 History 亦空 → S5 命中：available=true、source=S5、errors=[]', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitList') || req.path.includes('surgeLimitHistory')) return { json: s7Payload(TODAY, {}) }
      if (req.path.includes('anomaly/v1/history')) {
        return { json: s5HistoryPayload(0, [{ date: `${TODAY} 15:00`, tagCode: 'UP_001', tagName: '涨停', reason: '公告中标', stockName: '浦发银行' }]) }
      }
      if (req.path.includes('infomine3/limit/limitup')) return { json: s5DetailPayload([{ closeTime: `${TODAY} 14:55:06` }], '2连板') }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000' })
      expect(r.available).toBe(true)
      expect(r.source).toBe('S5')
      expect(r.errors).toEqual([]) // S5 命中：S7 leg 失败不进 errors（D-17）
      expect(r.cause).toMatchObject({ value: '公告中标', source: 'S5' })
      expect(r.hitRecordDate).toBe(TODAY)
      expect(h.stub.count('anomaly/v1/history')).toBe(1)
    })
  })
})

describe('主备均失败', () => {
  it('全端点 500 → available=false + sourceUnavailable + 逐源错误摘要', async () => {
    await withHarness(() => ({ status: 500, text: 'down' }), async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000' })
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['sourceUnavailable'])
      expect(r.source).toBeNull()
      expect(r.tradeDate).toBeNull()
      expect(r.notes.join('\n')).toContain('S7 leg')
      expect(r.notes.join('\n')).toContain('S5 leg')
    })
  })
})

describe('非法参数零请求', () => {
  it('非 6 位代码 / 非法日期 → 显式参数错误且零网络', async () => {
    await withHarness(S7_LIST_OK(TODAY, {}), async (h) => {
      for (const bad of ['60000', '6000001', 'abcdef', '']) {
        const r = await getLimitReason(h.deps, { code: bad })
        expect(r.available).toBe(false)
        expect(r.errors).toEqual(['invalidParam'])
      }
      const badDate = await getLimitReason(h.deps, { code: '600000', date: '2026/09/24' })
      expect(badDate.errors).toEqual(['invalidParam'])
      expect(stubCount(h)).toBe(0)
    })
  })
})

function stubCount(h: Harness): number {
  return h.stub.requests.length
}

describe('缓存命中', () => {
  it('同参第二次零网络且结果一致', async () => {
    await withHarness(S7_LIST_OK(HIST, { '600000': { cause: '并购', first: '0930' } }), async (h) => {
      const first = await getLimitReason(h.deps, { code: '600000', date: HIST })
      const n = stubCount(h)
      const second = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(second).toEqual(first)
      expect(stubCount(h)).toBe(n)
    })
  })
})

describe('标的不在列表 tradeDate 可得', () => {
  it('列表正常返回但无该标的：available=false（无涨停记录）、errors=[]、tradeDate=列表业务日', async () => {
    await withHarness(S7_LIST_OK(HIST, { '000001': { cause: '其它标的' } }), async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(false)
      expect(r.errors).toEqual([]) // 无 dateUnavailable → 「无涨停记录」（contracts §12.8）
      expect(r.tradeDate).toBe(HIST)
      expect(r.notes.join('\n')).toContain('不在')
      expect(h.stub.count('anomaly/v1/history')).toBe(0) // 列表权威：不取备源
    })
  })
})

describe('列表为空 tradeDate 可得', () => {
  it('列表成功但为空：tradeDate 仍从响应体取得（MUST NOT 为 null）', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(TODAY, {}) }
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(TODAY, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000' })
      expect(r.tradeDate).toBe(TODAY)
      expect(r.tradeDate).not.toBeNull()
      expect(r.available).toBe(false)
    })
  })
})

describe('hitRecordDate !== requestedDate 只标注不冒充 tradeDate', () => {
  it('S5 命中旧记录：hitRecordDate 独立呈现、errors 含 dateUnavailable、tradeDate 不被顶替', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) } // 历史日 History 空
      if (req.path.includes('anomaly/v1/history')) {
        return { json: s5HistoryPayload(0, [{ date: '2024-12-20 10:00', tagCode: 'UP_001', tagName: '涨停', reason: '旧闻', stockName: 'x' }]) }
      }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.hitRecordDate).toBe('2024-12-20')
      expect(r.tradeDate).not.toBe('2024-12-20') // hitRecordDate MUST NOT 冒充 tradeDate
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['dateUnavailable']) // 该业务日无数据（命中记录只标注、不采用）
      expect(r.notes.join('\n')).toContain('2024-12-20')
    })
  })
})

describe('当日 List 空回退 History', () => {
  it('回退 History 命中：notes 含回退标注、source=S7、endpoint 反映实际端点', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(TODAY, {}) }
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(TODAY, { '600000': { cause: '尾盘回封', first: '0935' } }) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000' })
      expect(r.available).toBe(true)
      expect(r.source).toBe('S7')
      expect(r.tradeDate).toBe(TODAY)
      expect(r.notes.join('\n')).toContain('回退')
      expect(h.stub.count('surgeLimitList')).toBe(1)
      expect(h.stub.count('surgeLimitHistory')).toBe(1)
    })
  })
})

describe('历史日不回退 List', () => {
  it('History 空 + S5 无数据：List 端点零请求、dateUnavailable', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['dateUnavailable'])
      expect(h.stub.count('surgeLimitList')).toBe(0) // MUST NOT 回退 List（行为断言：List 端点零请求）
      expect(r.notes.join('\n')).toContain('surgeLimitHistory') // notes 记录实际尝试的端点
    })
  })
})

describe('历史日 S5 命中不降级', () => {
  it('History 空但 S5 命中该业务日：available=true、source=S5、errors=[]（无 dateUnavailable）', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) }
      if (req.path.includes('anomaly/v1/history')) {
        return { json: s5HistoryPayload(0, [{ date: `${HIST} 15:00`, tagCode: 'UP_001', tagName: '涨停', reason: '订单放量', stockName: 'x' }]) }
      }
      if (req.path.includes('infomine3/limit/limitup')) return { json: s5DetailPayload([{ closeTime: `${HIST} 14:50:00` }], '首板') }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(true)
      expect(r.source).toBe('S5')
      expect(r.errors).toEqual([]) // S7 leg 的 dateUnavailable MUST NOT 保留
      expect(r.notes.join('\n')).toContain('S5 兜底')
      expect(r.hitRecordDate).toBe(HIST)
      expect(r.lastTime).toMatchObject({ value: '14:50:00', source: 'S5' })
    })
  })
})

describe('历史日两源均无数据 → dateUnavailable', () => {
  it('History 空且 S5 无命中记录（无取数失败）：errors=[dateUnavailable]', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['dateUnavailable'])
      expect(r.errors).not.toContain('sourceUnavailable') // 「无数据」≠「取数失败」
      expect(r.notes.join('\n')).toContain(HIST)
    })
  })
})

describe('历史日两源均失败 → sourceUnavailable', () => {
  it('History 与 S5 均失败：errors=[sourceUnavailable]，不用 dateUnavailable 冒充', async () => {
    await withHarness(() => ({ status: 500, text: 'down' }), async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['sourceUnavailable'])
      expect(r.errors).not.toContain('dateUnavailable')
      expect(r.source).toBeNull()
    })
  })
})

// ---------------------------------------------------------------- 5.3 首封时间红线

describe('S7 first_time → firstTime', () => {
  it('firstTime.source 标识 S7、值为 HH:MM 格式', async () => {
    await withHarness(S7_LIST_OK(HIST, { '600000': { cause: 'x', first: '931' } }), async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.firstTime.value).toBe('09:31')
      expect(r.firstTime.source).toBe('S7')
    })
  })
})

describe('降级 S5 只填 lastTime / S5 时间不得进入 firstTime / 最后封板不得冒充首封', () => {
  it('S5 路径：firstTime.value=null、lastTime 来自 S5（最后封板语义）、notes 记 S5 无首封语义', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) }
      if (req.path.includes('anomaly/v1/history')) {
        return { json: s5HistoryPayload(0, [{ date: `${HIST} 15:00`, tagCode: 'UP_001', tagName: '涨停', reason: 'y', stockName: 'x' }]) }
      }
      if (req.path.includes('infomine3/limit/limitup')) return { json: s5DetailPayload([{ closeTime: `${HIST} 14:59:59` }, { closeTime: `${HIST} 15:00:01` }]) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.source).toBe('S5')
      // 红线：S5 时间（boardAnalyses[-1].closeTime = 最后封板）只进 lastTime。
      expect(r.firstTime.value).toBeNull()
      expect(r.firstTime.source).toBe('S5')
      expect(r.lastTime.value).toBe('15:00:01')
      expect(r.lastTime.source).toBe('S5')
      // 返回体所有 source=S5 的时间值都不位于 firstTime（spec scenario 断言）。
      expect(r.firstTime).toEqual({ value: null, source: r.firstTime.source, fetchedAt: r.firstTime.fetchedAt })
      expect(r.notes.join('\n')).toContain('无首封语义')
    })
  })
})

describe('首封时间缺失 → null', () => {
  it('S7 记录无 first_time（「0」/空）→ firstTime.value=null（不猜、不用 lastTime 顶替）', async () => {
    await withHarness(S7_LIST_OK(HIST, { '600000': { cause: 'x', first: '0', last: '1405' } }), async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.firstTime.value).toBeNull()
      expect(r.lastTime.value).toBe('14:05')
    })
  })
})

// ---------------------------------------------------------------- 5.4 日期三义

describe('请求日与源业务日不一致', () => {
  it('历史日请求、源业务日不符 → available=false + dateUnavailable（附两日期）', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload('2024-12-30', { '600000': { cause: '他日数据' } }) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(false)
      expect(r.errors).toEqual(['dateUnavailable'])
      expect(r.notes.join('\n')).toContain('2024-12-30')
      expect(r.notes.join('\n')).toContain(HIST)
      expect(r.tradeDate).toBe('2024-12-30') // 响应体业务日如实呈现
    })
  })
})

describe('紧凑与带连字符两种入参得到同一 requestedDate', () => {
  it("'20250102' 与 '2025-01-02' → 同一 requestedDate、同一缓存键（第二次零网络）", async () => {
    await withHarness(S7_LIST_OK(HIST, { '600000': { cause: 'x' } }), async (h) => {
      const a = await getLimitReason(h.deps, { code: '600000', date: '20250102' })
      const b = await getLimitReason(h.deps, { code: '600000', date: '2025-01-02' })
      expect(a.requestedDate).toBe('2025-01-02')
      expect(b.requestedDate).toBe('2025-01-02')
      expect(b).toEqual(a)
      expect(stubCount(h)).toBe(1)
    })
  })
})

// ---------------------------------------------------------------- 5.5 输出 schema 快照

describe('输出 schema 快照（5.5）', () => {
  it('get_limit_reason 输出 schema 含 tradeDate/requestedDate/hitRecordDate（可 null）/errors/firstTime/lastTime/notes', async () => {
    const { createLimitReasonTool } = await import('../src/tools/limit-reason.ts')
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList') || req.path.includes('surgeLimitHistory')) {
        return { json: s7Payload(HIST, { '600000': { cause: 'x' } }) }
      }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub, now: OFF_SESSION, configOverrides: { sources: { s7: { retries: 0 }, s5: { retries: 0 } } } })
    try {
      const tool = createLimitReasonTool({ getLimitReason: (input) => getLimitReason(deps, input) })
      const props = (tool as unknown as { output: { schema: { properties: Record<string, unknown> } } }).output.schema.properties
      for (const key of ['available', 'code', 'requestedDate', 'tradeDate', 'hitRecordDate', 'cause', 'firstTime', 'lastTime', 'openCount', 'streakDesc', 'source', 'fetchedAt', 'notes', 'errors']) {
        expect(props[key], `输出 schema 缺少 ${key}`).toBeDefined()
      }
      // tradeDate/hitRecordDate 可为 null（oneOf [string, null]）。
      for (const key of ['tradeDate', 'hitRecordDate']) {
        const spec = props[key] as { oneOf?: Array<{ type?: string }> }
        expect(spec.oneOf?.some((b) => b.type === 'null'), `${key} 允许 null`).toBe(true)
      }
      // T1 入参 schema 无 refresh（7.3⑥ 的 T1 部分）。
      const params = (tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters
      expect(Object.keys(params.properties ?? {}).sort()).toEqual(['code', 'date'])
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})

// ---------------------------------------------------------------- 5.2 S5 移植口径

describe('本地 HTML 缺失不影响降级', () => {
  it('无任何本机 HTML 文件时 S5 正常尝试；错误列表无「本地 HTML」类原因', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) }
      if (req.path.includes('anomaly/v1/history')) {
        return { json: s5HistoryPayload(0, [{ date: `${HIST} 15:00`, tagCode: 'UP_001', tagName: '涨停', reason: 'z', stockName: 'x' }]) }
      }
      if (req.path.includes('infomine3/limit/limitup')) return { json: s5DetailPayload([{ closeTime: `${HIST} 14:00:00` }]) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '600000', date: HIST })
      expect(r.available).toBe(true)
      expect(r.source).toBe('S5')
      expect(r.notes.join('\n')).not.toContain('本地 HTML')
      expect(r.notes.join('\n')).not.toContain('TDX_HOME')
    })
  })
})

describe('北交所标的不静默按深市处理 / 市场映射为表驱动', () => {
  it('北交所代码 → S5 零请求（MUST NOT 按深市 marketId 静默请求）+ 显式「待验证」标注', async () => {
    await withHarness((req) => {
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(HIST, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    }, async (h) => {
      const r = await getLimitReason(h.deps, { code: '830001', date: HIST })
      // S5 两端点零请求（北交所显式不支持）；仅 S7 leg 正常出站。
      expect(h.stub.count('anomaly/v1/history')).toBe(0)
      expect(h.stub.count('infomine3/limit/limitup')).toBe(0)
      expect(h.stub.count('surgeLimitHistory')).toBe(1)
      expect(r.notes.join('\n')).toContain('待验证')
    })
  })

  it('市场映射表驱动（17/33 表化，无调用处内联魔法数字）', () => {
    expect(S5_MARKET_TABLE['6']).toMatchObject({ marketId: '17' })
    expect(S5_MARKET_TABLE['0']).toMatchObject({ marketId: '33' })
    expect(S5_MARKET_TABLE['3']).toMatchObject({ marketId: '33' })
    expect(S5_MARKET_TABLE['8']?.marketId).toBeNull() // 北交所：显式不支持
    expect(S5_MARKET_TABLE['4']?.marketId).toBeNull()
    expect(S5_MARKET_TABLE['9']?.marketId).toBeNull()
  })
})
