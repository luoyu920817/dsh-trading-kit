import { expect, it } from 'vitest'
import { createReviewHandler } from '../../src/routes/review.ts'
import { jsonBody, makeDeps, makeReq, makeRes, REVIEW_PAGE_PATH } from './helpers.ts'
import { appendCard, parseDoc } from '../../src/review/store.ts'
import { notifyReviewWrite } from '../../src/review/write-events.ts'
import { performance } from 'node:perf_hooks'

it('卡片已完成时不为慢历史名称等待350ms，仍后台补齐', async () => {
  let release!: () => void
  const gate = new Promise<void>((done) => { release = done })
  const { deps } = makeDeps({ overrides: { resolveLocalName: async () => {
    await gate
    return { value: '补位名称', nameSource: 'frontmatter-history', confidence: 'high' }
  } } })
  const handler = createReviewHandler(deps)
  try {
    const { res, rec } = makeRes()
    const started = performance.now()
    await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/local?code=600000&date=2026-09-24', headers: { cookie: 'dsh-auth=ok' } }), res)
    expect(jsonBody(rec).loadState).toMatchObject({ cards: 'ready' })
    expect(performance.now() - started).toBeLessThan(200)
  } finally { release(); handler.dispose?.() }
})

it('local缺同步缓存不调用交易日网络且明确loading', async () => {
  let calls = 0
  const { deps } = makeDeps({ overrides: { resolveTradeDate: async () => { calls++; throw new Error('禁止出站') } } })
  delete deps.peekTradeDate
  const handler = createReviewHandler(deps)
  const { res, rec } = makeRes()
  await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/local?code=600000', headers: { cookie: 'dsh-auth=ok' } }), res)
  const body = jsonBody(rec)
  expect(rec.status).toBe(200)
  expect(calls).toBe(0)
  expect(body.date).toBeNull()
  expect(body.loadState).toMatchObject({ tradeDate: 'loading', cards: 'loading' })
})

it('同键预算超时不重启后台任务，完成后补读并区分无卡ready', async () => {
  let release!: () => void
  const gate = new Promise<void>((done) => { release = done })
  let reads = 0
  const { deps } = makeDeps({ overrides: { locateDoc: async (loc) => {
    reads++
    await gate
    return { path: loc.dataRoot + '/absent.md', warnings: [] }
  } } })
  const handler = createReviewHandler(deps)
  const get = async () => {
    const { res, rec } = makeRes()
    await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/local?code=600000&date=2026-09-24', headers: { cookie: 'dsh-auth=ok' } }), res)
    return jsonBody(rec)
  }
  const first = await get()
  expect(first.loadState).toMatchObject({ cards: 'loading' })
  expect(first.cards).toEqual([])
  const second = get()
  release()
  expect((await second).loadState).toMatchObject({ cards: 'ready' })
  expect(reads).toBe(1)
  expect((await get()).loadState).toMatchObject({ cards: 'ready' })
  expect(reads).toBe(1)
  handler.dispose?.()
})

it('同日显式与归属请求分别保持dateSource，失败归属标error', async () => {
  const { deps } = makeDeps()
  const handler = createReviewHandler(deps)
  const get = async (query: string) => {
    const { res, rec } = makeRes()
    await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/local?code=600000' + query, headers: { cookie: 'dsh-auth=ok' } }), res)
    return jsonBody(rec)
  }
  expect((await get('')).dateSource).toBe('resolved')
  const requested = await get('&date=2026-09-24')
  expect(requested.dateSource).toBe('requested')
  expect(requested.tradeDate).toBeNull()
  delete deps.peekTradeDate
  expect((await get('')).loadState).toMatchObject({ tradeDate: 'loading', cards: 'loading' })
  deps.peekTradeDate = () => ({ value: null, source: 'T1-tradeDate', isTradingDay: null, confidence: 'low' })
  expect((await get('')).loadState).toMatchObject({ tradeDate: 'error', cards: 'error' })
  handler.dispose?.()
})

it('写后旧任务不可回填，补读获得新正文且当前frontmatter名称优先', async () => {
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>((done) => { release = done })
  const reading = new Promise<void>((done) => { started = done })
  let once = true
  const { deps } = makeDeps({ overrides: { parseDoc: async (path) => {
    const result = await parseDoc(path)
    if (once) { once = false; started(); await gate }
    return result
  } } })
  const loc = { dataRoot: deps.dataRoot, code: '600000', tradeDate: '2026-09-24', name: '当前名称' }
  const seeded = await appendCard({ loc, body: '旧正文', clientRequestId: 'first' })
  const handler = createReviewHandler(deps)
  const get = async () => {
    const { res, rec } = makeRes()
    await handler(makeReq({ url: REVIEW_PAGE_PATH + '/api/local?code=600000&date=2026-09-24', headers: { cookie: 'dsh-auth=ok' } }), res)
    return jsonBody(rec)
  }
  const old = get()
  await reading
  await appendCard({ loc, body: '新正文', clientRequestId: 'second' })
  notifyReviewWrite(seeded.path)
  release()
  const stale = await old
  expect(stale.cards).toEqual([])
  expect(stale.loadState).toMatchObject({ cards: 'loading' })
  const fresh = await get()
  expect(fresh.name).toMatchObject({ value: '当前名称' })
  expect(fresh.cards).toHaveLength(2)
  expect(fresh.loadState).toMatchObject({ cards: 'ready' })
  handler.dispose?.()
})
