/**
 * 市场前缀参与文档定位——路由面（owner 2026-10-08 P0）：
 * /api/local、/api/dates 的 market 透传与同码跨市场定位（sh000688 科创50 vs
 * 000688 国城矿业）、非法 market 400、卡片修订/删除的 market 透传、/api/day
 * 的 qualifier 透传。真实 store + 真实临时目录（零 mock）。
 */
import { describe, expect, it } from 'vitest'
import { createReviewHandler, REVIEW_PAGE_PATH } from '../../src/routes/review.ts'
import { appendCard } from '../../src/review/store.ts'
import type { TraderKitHttpRequest, TraderKitHttpResponse } from '../../src/context-types.ts'
import { jsonBody, makeDeps, makeReq, makeRes, NOW_1432, type RecordedResponse } from './helpers.ts'

const API_LOCAL = REVIEW_PAGE_PATH + '/api/local'
const API_DATES = REVIEW_PAGE_PATH + '/api/dates'
const API_DAY = REVIEW_PAGE_PATH + '/api/day'
const API_CARD_UPDATE = REVIEW_PAGE_PATH + '/api/card/update'
const API_CARD_DELETE = REVIEW_PAGE_PATH + '/api/card/delete'

const DATE = '2026-09-24'

async function drive(handler: ReturnType<typeof createReviewHandler>, req: TraderKitHttpRequest): Promise<RecordedResponse> {
  const { res, rec } = makeRes()
  await handler(req, res)
  return rec
}

function authedReq(options: Parameters<typeof makeReq>[0] = {}): TraderKitHttpRequest {
  return makeReq({ ...options, headers: { ...options.headers, cookie: 'dsh-auth=ok' } })
}

/** 同码跨市场种子：sh000688_科创50（显式市场）+ 000688_国城矿业（无前缀惯例）。 */
async function seedSameCodeDocs(dataRoot: string): Promise<{ shPath: string; szPath: string }> {
  const sh = await appendCard({ loc: { dataRoot, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE }, body: '指数卡', now: NOW_1432, clientRequestId: 'seed-sh' })
  const sz = await appendCard({ loc: { dataRoot, code: '000688', name: '国城矿业', tradeDate: DATE }, body: '股票卡', now: NOW_1432, clientRequestId: 'seed-sz' })
  return { shPath: sh.path, szPath: sz.path }
}

describe('GET /api/local：显式市场参与文档定位（owner 2026-10-08 P0）', () => {
  it('market=sh → 定位 sh000688_科创50 文档；缺省 → 深市股票文档（sh 前缀文档不参与）', async () => {
    const { deps } = makeDeps()
    const { shPath, szPath } = await seedSameCodeDocs(deps.dataRoot)
    const handler = createReviewHandler(deps)

    const withSh = await drive(handler, authedReq({ url: API_LOCAL + '?code=000688&date=' + DATE + '&market=sh' }))
    expect(withSh.status).toBe(200)
    expect(jsonBody<{ path: string }>(withSh).path).toBe(shPath)

    const withoutMarket = await drive(handler, authedReq({ url: API_LOCAL + '?code=000688&date=' + DATE }))
    expect(jsonBody<{ path: string }>(withoutMarket).path).toBe(szPath)
  })

  it('非法 market → 400 INVALID_MARKET（零定位）', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=000688&date=' + DATE + '&market=xx' }))
    expect(rec.status).toBe(400)
    expect(jsonBody(rec).error).toBe('INVALID_MARKET')
  })
})

describe('GET /api/dates：声明市场过滤', () => {
  it('market=sh 且只有无前缀股票文档 → 空表（异市场前缀文档不属于该身份）', async () => {
    const { deps } = makeDeps()
    await appendCard({ loc: { dataRoot: deps.dataRoot, code: '000688', name: '国城矿业', tradeDate: DATE }, body: '股票卡', now: NOW_1432 })
    const handler = createReviewHandler(deps)

    const shView = await drive(handler, authedReq({ url: API_DATES + '?code=000688&market=sh' }))
    expect(jsonBody<{ dates: string[] }>(shView).dates).toEqual([])

    const szView = await drive(handler, authedReq({ url: API_DATES + '?code=000688&market=sz' }))
    expect(jsonBody<{ dates: string[] }>(szView).dates).toEqual([DATE])
  })
})

describe('卡片修订/删除：market 透传到存储出口（owner 2026-10-08 P0）', () => {
  it('body.market 原样传给 updateCard/deleteCard；非法 market → 400 且零调用', async () => {
    const updateCalls: Array<{ anchor: string; market?: string }> = []
    const deleteCalls: Array<{ anchor: string; market?: string }> = []
    const { deps } = makeDeps({
      overrides: {
        updateCard: async (input) => {
          updateCalls.push({ anchor: input.anchor, market: input.market })
          return { status: 'updated' as const, anchor: input.anchor, path: 'x.md', warnings: [] }
        },
        deleteCard: async (input) => {
          deleteCalls.push({ anchor: input.anchor, market: input.market })
          return { status: 'deleted' as const, anchor: input.anchor, path: 'x.md', warnings: [] }
        },
      },
    })
    const handler = createReviewHandler(deps)

    const upd = await drive(handler, authedReq({
      url: API_CARD_UPDATE,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: 'card-20260924-000688-1432', body: '修订', market: 'sh' }),
    }))
    expect(upd.status).toBe(200)
    expect(updateCalls).toEqual([{ anchor: 'card-20260924-000688-1432', market: 'sh' }])

    const del = await drive(handler, authedReq({
      url: API_CARD_DELETE,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: 'card-20260924-000688-1432', market: 'sz' }),
    }))
    expect(del.status).toBe(200)
    expect(deleteCalls).toEqual([{ anchor: 'card-20260924-000688-1432', market: 'sz' }])

    const invalid = await drive(handler, authedReq({
      url: API_CARD_UPDATE,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ anchor: 'card-20260924-000688-1432', body: '修订', market: 'hk' }),
    }))
    expect(invalid.status).toBe(400)
    expect(jsonBody(invalid).error).toBe('INVALID_MARKET')
    expect(updateCalls).toHaveLength(1)
  })
})

describe('GET /api/day：同码跨市场条目带 qualifier（面板可区分显示）', () => {
  it('sh000688_科创50 与 000688_国城矿业 各自成条目', async () => {
    const { deps } = makeDeps()
    await seedSameCodeDocs(deps.dataRoot)
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_DAY }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ targets: Array<{ code: string; name: string; qualifier?: string }> }>(rec)
    const sh = body.targets.find((t) => t.code === '000688' && t.qualifier === 'sh')
    const sz = body.targets.find((t) => t.code === '000688' && t.qualifier === undefined)
    expect(sh?.name).toBe('科创50')
    expect(sz?.name).toBe('国城矿业')
  })
})
