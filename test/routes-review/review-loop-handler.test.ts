/**
 * review-loop 路由面单测（tasks 4.5/4.10 + 2.7 接线；零 mock：真实 store +
 * 真实临时目录 + 函数注入 seam）。
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createReviewHandler } from '../../src/routes/review.ts'
import { runReportPath, writeRunReport } from '../../src/summary/run-report.ts'
import { readBriefMeta, writeBrief } from '../../src/summary/brief.ts'
import { makeDeps, makeReq, makeRes, jsonBody, seedCard, REVIEW_PAGE_PATH, STUB_TRADE_DATE, type RecordedResponse } from './helpers.ts'

const DAY_URL = REVIEW_PAGE_PATH + '/api/day'

function withLoopDeps(deps: ReturnType<typeof makeDeps>['deps']): ReturnType<typeof makeDeps>['deps'] {
  return {
    ...deps,
    readRunReport: (path: string) => import('../../src/summary/run-report.ts').then((m) => m.readRunReport(path)),
    runReportPath,
    readBriefMeta,
  }
}

async function get(deps: ReturnType<typeof makeDeps>['deps'], url: string, method = 'GET'): Promise<RecordedResponse> {
  const handler = createReviewHandler(deps)
  const { res, rec } = makeRes()
  await handler(makeReq({ url, method, headers: { cookie: 'dsh-auth=ok' } }), res)
  return rec
}

describe('/api/day 当日状态读接口', () => {
  it('未运行：targets 正常、runReport=null、brief.exists=false', async () => {
    const { deps } = makeDeps()
    await seedCard(deps.dataRoot, '000002', STUB_TRADE_DATE, '地产链走强', 'rv-1', '万科A')
    const rec = await get(withLoopDeps(deps), DAY_URL)
    expect(rec.status).toBe(200)
    const body = jsonBody<{ tradeDate: string; dateSource: string; targets: unknown[]; runReport: unknown; brief: { exists: boolean } | null; warnings: string[] }>(rec)
    expect(body.tradeDate).toBe(STUB_TRADE_DATE)
    expect(body.dateSource).toBe('resolved')
    expect(body.targets).toHaveLength(1)
    expect(body.runReport).toBeNull()
    expect(body.brief?.exists).toBe(false)
  })

  it('已运行：runReport 四态 + brief.exists=true + generatedAt', async () => {
    const { deps } = makeDeps()
    await seedCard(deps.dataRoot, '000002', STUB_TRADE_DATE, '地产链走强', 'rv-1', '万科A')
    await writeRunReport(runReportPath(deps.dataRoot, STUB_TRADE_DATE), {
      tradeDate: STUB_TRADE_DATE,
      created: [{ code: '000002', path: 'x', anchor: 'card-1' }],
      skipped: [], failed: [{ code: '600000', reason: 'sourceUnavailable' }], deferred: [], missing: [], warnings: ['w1'],
    })
    await writeBrief(deps.dataRoot, {
      tradeDate: STUB_TRADE_DATE,
      sections: { index: '指数段', sentiment: '情绪段', moneyEffect: '赚钱效应段', theme: '题材段' },
    })
    const rec = await get(withLoopDeps(deps), DAY_URL)
    const body = jsonBody<{ runReport: { created: unknown[]; failed: unknown[] }; brief: { exists: boolean; generatedAt: string | null } }>(rec)
    expect(body.runReport.created).toHaveLength(1)
    expect(body.runReport.failed).toHaveLength(1)
    expect(body.brief.exists).toBe(true)
    expect(body.brief.generatedAt).not.toBeNull()
  })

  it('显式 date 参数（紧凑写法归一）+ 非法日期 400', async () => {
    const { deps } = makeDeps()
    const ok = await get(withLoopDeps(deps), DAY_URL + '?date=20260924')
    expect(jsonBody<{ dateSource: string }>(ok).dateSource).toBe('requested')
    const bad = await get(withLoopDeps(deps), DAY_URL + '?date=2026-13-01')
    expect(bad.status).toBe(400)
    expect(jsonBody<{ error: string }>(bad).error).toBe('INVALID_DATE')
  })

  it('交易日不可得：dateSource=unavailable + 短提示（MUST NOT 用系统日期）', async () => {
    const { deps } = makeDeps({ overrides: { resolveTradeDate: async () => ({ value: null, source: 'T1-tradeDate', isTradingDay: null, confidence: 'low' }) } })
    const rec = await get(withLoopDeps(deps), DAY_URL)
    const body = jsonBody<{ tradeDate: null; dateSource: string; targets: unknown[]; warnings: string[] }>(rec)
    expect(body.tradeDate).toBeNull()
    expect(body.dateSource).toBe('unavailable')
    expect(body.targets).toEqual([])
    expect(body.warnings.join('｜')).toContain('交易日不可得')
  })

  it('dataRoot 未配置 → 200 + DATA_ROOT_UNCONFIGURED（非 500）；非 GET → 405', async () => {
    const { deps } = makeDeps({ overrides: { dataRoot: '' } })
    const rec = await get(withLoopDeps(deps), DAY_URL)
    expect(rec.status).toBe(200)
    expect(jsonBody<{ error: string }>(rec).error).toBe('DATA_ROOT_UNCONFIGURED')
    const post = await get(withLoopDeps(deps), DAY_URL, 'POST')
    expect(post.status).toBe(405)
  })
})

describe('/api/enrich 名称层②第三级（TQ-Local 兜底）与 basics 段', () => {
  it('T2/S8 与行情源均未命中 → TQ 兜底命中（nameSource=tq-local + basics）', async () => {
    const calls: string[] = []
    const { deps } = makeDeps({
      remoteQuote: null,
      overrides: {
        getConcepts: async () => ({ available: false, labels: [], name: null, detail: 'S8 未返回可用概念' }),
        lookupStockBasics: async (code) => {
          calls.push(code)
          return {
            available: true, name: '微盘股', kind: '0', listedAt: '20050607', region: '上海', industry: '软件服务',
            floatSharesWan: '12345.00', totalSharesWan: '67890.00', notes: [],
          }
        },
      },
    })
    const rec = await get(deps, REVIEW_PAGE_PATH + '/api/enrich?code=880823')
    const body = jsonBody<{ name: { available: boolean; name: string; nameSource: string }; basics: { available: boolean; kind: string; floatSharesWan: string } }>(rec)
    expect(body.name).toMatchObject({ available: true, name: '微盘股', nameSource: 'tq-local' })
    expect(body.basics).toMatchObject({ available: true, kind: '0', floatSharesWan: '12345.00' })
    expect(calls).toEqual(['880823'])
  })

  it('层①（历史 frontmatter）已命中 → 零 TQ 请求（MUST NOT 覆盖既有层结论）', async () => {
    const calls: string[] = []
    const { deps } = makeDeps({
      remoteQuote: null,
      overrides: {
        getConcepts: async () => ({ available: false, labels: [], name: null, detail: 'S8 未返回可用概念' }),
        lookupStockBasics: async (code) => {
          calls.push(code)
          return { available: true, name: '不应使用', kind: '0', listedAt: null, region: null, industry: null, floatSharesWan: null, totalSharesWan: null, notes: [] }
        },
      },
    })
    // 层①：该标的历史卡片 frontmatter 含名称（seed 即真实落盘）。
    await seedCard(deps.dataRoot, '000002', STUB_TRADE_DATE, '卡片', 'rv-1', '万科A')
    const rec = await get(deps, REVIEW_PAGE_PATH + '/api/enrich?code=000002')
    expect(calls).toEqual([])
    const body = jsonBody<{ basics: unknown }>(rec)
    expect(body.basics).toBeNull()
  })

  it('TQ 不可用 → 名称保持不可得（detail 含原因）且标签等其余字段照常', async () => {
    const { deps } = makeDeps({
      remoteQuote: null,
      overrides: {
        getConcepts: async () => ({ available: true, labels: ['银行'], name: null, detail: null }),
        lookupStockBasics: async () => ({
          available: false, name: null, kind: null, listedAt: null, region: null, industry: null,
          floatSharesWan: null, totalSharesWan: null, notes: ['sourceUnavailable: 连接被拒绝（提示：确认通达信客户端 TdxW 已启动并登录）'],
        }),
      },
    })
    const rec = await get(deps, REVIEW_PAGE_PATH + '/api/enrich?code=600000')
    const body = jsonBody<{ name: { available: boolean; detail: string | null }; concepts: { labels: string[] }; basics: { available: boolean; detail: string | null } }>(rec)
    expect(body.name.available).toBe(false)
    expect(body.name.detail ?? '').toContain('TQ-Local 兜底不可用')
    expect(body.concepts.labels).toEqual(['银行'])
    expect(body.basics.available).toBe(false)
    expect(body.basics.detail ?? '').toContain('sourceUnavailable')
  })
})

describe('写卡成功 → 首卡懒创建（异步解耦）', () => {
  it('建档被触发且不阻塞写卡响应；建档失败不影响响应', async () => {
    const seen: Array<{ code: string; name?: string | null }> = []
    let rejectEnsure = false
    const { deps } = makeDeps({
      overrides: {
        ensureStockProfile: async (input) => {
          seen.push(input)
          if (rejectEnsure) throw new Error('磁盘只读（模拟）')
          return { status: 'created', path: 'DB/stock/万科A.md', warnings: [] }
        },
      },
    })
    const handler = createReviewHandler(deps)
    const payload = JSON.stringify({ code: '000002', body: '地产链走强', tradeDate: STUB_TRADE_DATE, name: '万科A', clientRequestId: 'rv-loop-1' })
    const { res, rec } = makeRes()
    await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/card', method: 'POST', body: payload, headers: { cookie: 'dsh-auth=ok' } }), res)
    expect(rec.status).toBe(200)
    expect(jsonBody<{ status: string }>(rec).status).toBe('created')
    expect(seen).toEqual([{ code: '000002', name: '万科A' }])
    expect(existsSync(deps.dataRoot)).toBe(true)

    // 建档抛错时：写卡仍 200（fire-and-forget 的 catch 兜底）。
    rejectEnsure = true
    const second = makeRes()
    const payload2 = JSON.stringify({ code: '000002', body: '第二张卡', tradeDate: STUB_TRADE_DATE, name: '万科A', clientRequestId: 'rv-loop-2' })
    await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/card', method: 'POST', body: payload2, headers: { cookie: 'dsh-auth=ok' } }), second.res)
    expect(second.rec.status).toBe(200)
  })
})
