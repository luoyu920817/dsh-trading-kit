/**
 * change 4 tasks 1.5/3.1/3.1b：名称三层兜底与交易日归属 seam（含 D-TQ 选项 B
 * 最小 stub 契约测试）+ tasks 1.12 registerReview 装配。
 */
import { describe, expect, it } from 'vitest'
import {
  createNameResolver,
  createTqStubTradeDateResolver,
  createTradeDateResolver,
  type NameResolver,
  type ResolveTradeDateFn,
  type TradeDateResolver,
  type TradeDateResult,
} from '../../src/review/context.ts'
import { appendCard } from '../../src/review/store.ts'
import { NOW_1432, TRADE_DATE, makeTempRoot, srcText } from './helpers.ts'
import { registerReview } from '../../src/review/index.ts'
import type { Context } from '../../src/context-types.ts'

describe('NameResolver 三层兜底（契约 §12.4）', () => {
  it('层①：本地历史 frontmatter 命中（零网络），带市场后缀', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }, body: 'x', now: NOW_1432 })
    const resolver = createNameResolver({ dataRoot: root })
    const r = await resolver.resolve('600000')
    expect(r).toEqual({ value: '浦发银行', source: 'frontmatter-history', confidence: 'high', marketSuffix: '.SH' })
  })

  it('层②：本地未命中时走注入的网络反查；未注入即不出网', async () => {
    const root = makeTempRoot()
    let remoteCalls = 0
    const withRemote = createNameResolver({
      dataRoot: root,
      lookupNameRemote: async (code) => { remoteCalls++; return `浦发银行(${code})` },
    })
    const r2 = await withRemote.resolve('sh600000')
    expect(r2.source).toBe('T2-S8')
    expect(r2.value).toBe('浦发银行(600000)')
    expect(remoteCalls).toBe(1)

    // 未注入反查函数：层③ 直接兜底（不存在任何出网路径）。
    const withoutRemote: NameResolver = createNameResolver({ dataRoot: root })
    const r3 = await withoutRemote.resolve('600000')
    expect(r3).toEqual({ value: null, source: 'code-only', confidence: 'low', marketSuffix: '.SH' })
    expect(remoteCalls).toBe(1) // 层①/③ 未触发网络
  })

  it('层① 优先于层②（层序固定，本地名 MUST NOT 被网络层覆盖）', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: { dataRoot: root, code: '600000', name: '本地名', tradeDate: TRADE_DATE }, body: 'x', now: NOW_1432 })
    let remoteCalls = 0
    const resolver = createNameResolver({
      dataRoot: root,
      lookupNameRemote: async () => { remoteCalls++; return '网络名' },
    })
    const r = await resolver.resolve('600000')
    expect(r.value).toBe('本地名')
    expect(r.source).toBe('frontmatter-history')
    expect(remoteCalls).toBe(0)
  })

  it('层② 反查不可得（null）→ 层③ 兜底；市场后缀按代码段推导', async () => {
    const root = makeTempRoot()
    const resolver = createNameResolver({ dataRoot: root, lookupNameRemote: async () => null })
    expect((await resolver.resolve('000001')).marketSuffix).toBe('.SZ')
    expect((await resolver.resolve('430047')).marketSuffix).toBe('.BJ')
    const r = await resolver.resolve('600000')
    expect(r.source).toBe('code-only')
    expect(r.value).toBeNull()
  })

  it('非法代码显式报错（归一化不猜测）', async () => {
    const resolver = createNameResolver({ dataRoot: makeTempRoot() })
    await expect(resolver.resolve('60000')).rejects.toThrow(/6 位数字/)
  })
})

describe('TradeDateResolver seam（tasks 3.1，契约 §1）', () => {
  const upstreamOk = async (_input?: { date?: string }): Promise<Awaited<ReturnType<ResolveTradeDateFn>>> => ({
    requestedDate: '2026-09-24',
    businessDate: '2026-09-24',
    isTradingDay: true,
    source: 'T1-tradeDate',
    fetchedAt: '2026-09-24T14:00:00+08:00',
    evidence: {},
  })

  it('默认包装器调用注入的 change 2 出口并结构化返回', async () => {
    let calls = 0
    const resolver = createTradeDateResolver(async (input) => {
      calls++
      expect(input).toEqual({ date: '2026-09-24' })
      return upstreamOk()
    })
    const r = await resolver.resolve({ code: '600000', date: '2026-09-24' })
    expect(calls).toBe(1)
    expect(r).toEqual({
      value: '2026-09-24', source: 'T1-tradeDate', isTradingDay: true, confidence: 'high', marketSuffix: '.SH',
    })
  })

  it('isTradingDay === null → 归属待确认（confidence low）；value 不可得透传 null', async () => {
    const resolver = createTradeDateResolver(async () => ({
      ...await upstreamOk(), businessDate: null, isTradingDay: null,
    }))
    const r = await resolver.resolve({ code: '000001' })
    expect(r).toMatchObject({ value: null, isTradingDay: null, confidence: 'low', source: 'T1-tradeDate' })
  })

  it('change 2 source 含 TQ → 映射 TQ-HqDate（seam 可容纳选项 B）', async () => {
    const resolver = createTradeDateResolver(async () => ({
      ...await upstreamOk(), source: 'TQ-get_more_info',
    }))
    expect((await resolver.resolve()).source).toBe('TQ-HqDate')
  })
})

describe('D-TQ 选项 B 最小 stub（tasks 3.1b：不接线、不调 TQ）', () => {
  it('返回 source TQ-HqDate + marketSuffix，value 由构造注入', async () => {
    const stub = createTqStubTradeDateResolver({ value: '2026-09-25' })
    expect(stub.__tqStub).toBe(true)
    const r = await stub.resolve({ code: '600000' })
    const expected: TradeDateResult = {
      value: '2026-09-25', source: 'TQ-HqDate', isTradingDay: null, confidence: 'low', marketSuffix: '.SH',
    }
    expect(r).toEqual(expected)
    expect((await stub.resolve({ code: '000001' })).marketSuffix).toBe('.SZ')
    expect((await stub.resolve({ code: '430047' })).marketSuffix).toBe('.BJ')
    expect((await stub.resolve()).marketSuffix).toBeUndefined()
  })

  it('契约测试：同一调用方在默认包装器与 stub 之间替换零改动', async () => {
    async function consumeSeam(resolver: TradeDateResolver): Promise<string> {
      const r = await resolver.resolve({ code: '600000', date: '2026-09-24' })
      return `${r.source}:${String(r.value)}:${String(r.marketSuffix)}:${r.isTradingDay}`
    }
    const viaDefault = await consumeSeam(createTradeDateResolver(async () => ({
      requestedDate: '2026-09-24', businessDate: '2026-09-24', isTradingDay: null, source: 'T1-tradeDate', fetchedAt: '', evidence: {},
    })))
    const viaStub = await consumeSeam(createTqStubTradeDateResolver({ value: '2026-09-24' }))
    expect(viaDefault).toBe('T1-tradeDate:2026-09-24:.SH:null')
    expect(viaStub).toBe('TQ-HqDate:2026-09-24:.SH:null')
  })

  it('stub 非法 value 显式报错；生产注册路径不含 stub（结构断言）', () => {
    expect(() => createTqStubTradeDateResolver({ value: '20260925' })).toThrow(/YYYY-MM-DD/)
    const indexSource = srcText('../../src/review/index.ts')
    expect(indexSource.length).toBeGreaterThan(0) // 扫描目标非空
    expect(indexSource.includes('TqStub')).toBe(false)
  })
})

describe('registerReview 装配（tasks 1.12：service key traderKit.review.*）', () => {
  function fakeCtx(traderKit: unknown): Context {
    // 波 3 起 registerReview 依次调 attachReviewService/registerReviewRoutes/registerReviewDaily：
    // 后两者需要 tools.register / effect / connection / webServer 面——装配为 no-op（真实行为由各自线的装配测试覆盖）。
    return {
      traderKit,
      tools: { register: () => () => {} },
      effect: (body: () => unknown) => { body(); return () => {} },
      webServer: { register: () => () => {}, port: 41000, host: '127.0.0.1' },
      connection: {
        requestRejection: () => 401 as const,
        authenticatedUrl: (u: string) => `${u}?token=stub`,
      },
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    } as unknown as Context
  }

  it('未就绪（registerData 之前）→ 显式抛错', () => {
    expect(() => registerReview(fakeCtx(undefined))).toThrow(/registerReview 必须在 registerData 之后/)
  })

  it('挂载五个出口；scanDailyCardTargets 绑定装配期 dataRoot（change 5 复用同一实现）', async () => {
    const root = makeTempRoot()
    // traderKit 服务对象本体（registerReview 对既有服务追加 review 出口，不重建 provide）。
    const api: { data: Record<string, unknown>; review?: Record<string, unknown> } = { data: { dataRoot: root } }
    registerReview(fakeCtx(api as unknown))
    expect(api.review).toBeDefined()
    const review = api.review as Record<string, unknown>
    for (const key of ['locateDoc', 'parseDoc', 'appendCard', 'appendAinote', 'scanDailyCardTargets']) {
      expect(typeof review[key]).toBe('function')
    }
    // 经 service 出口写一张卡（与直接调用同一实现）。
    const append = review.appendCard as typeof import('../../src/review/store.ts').appendCard
    const r = await append({ loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }, body: '经 service 出口', now: NOW_1432 })
    expect(r.status).toBe('created')
    // service 出口的 scanDailyCardTargets 使用装配期 dataRoot。
    const scan = review.scanDailyCardTargets as (tradeDate: string) => ReturnType<typeof import('../../src/review/store.ts').scanDailyCardTargets>
    const targets = await scan(TRADE_DATE)
    expect(targets).toHaveLength(1)
    expect(targets[0].code).toBe('600000')
  })

  it('dataRoot 未透出时出口仍挂载，操作期以 resolveArea 显式报错给配置指引', async () => {
    const api: { data: Record<string, unknown>; review?: Record<string, unknown> } = { data: {} }
    registerReview(fakeCtx(api as unknown))
    const locate = (api.review as Record<string, unknown>).locateDoc as (typeof import('../../src/review/store.ts').locateDoc)
    await expect(locate({ dataRoot: '', code: '600000', name: 'x', tradeDate: TRADE_DATE }))
      .rejects.toThrow(/数据根未配置|dataRoot/)
  })
})
