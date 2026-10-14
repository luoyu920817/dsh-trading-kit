/**
 * 复盘路由 handler 单测（change 4 tasks 2.1–2.8；design D-1/D-3/D-13）。
 *
 * 驱动方式（tasks 2.8 验收明写）：**请求桩直接调用工厂产物**——
 * `createReviewHandler(deps)` 为纯映射，用 IncomingMessage/ServerResponse 形状桩 +
 * 函数注入的取数 seam + 真实临时目录（零 mock、零真实 HTTP 客户端）驱动全部用例：
 * 六路由可达 / 404 / 传参 / 认证分层（未认证写被拒零落盘、B 层 token、A 层不可用
 * 只读降级标记、栅栏不救援）/ 入参校验逐项 4xx 零写入 / 资产穿越与 MIME 白名单 /
 * 缓存头。「ctx.effect 注册/卸载与宿主 requestRejection 真实行为」为集成核对（6.1），
 * 在 review-registration.test.ts 以插件层结构断言承载。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createReviewHandler,
  injectReviewState,
  REVIEW_BASE_PATH,
  REVIEW_PAGE_PATH,
  type ReviewHandlerDeps,
} from '../../src/routes/review.ts'
import { REVIEW_PAGE_MARKER } from '../../src/client/review/index.html.ts'
import { ConcurrentWriteError, AnchorNotFoundError } from '../../src/review/store.ts'
import { historySnapshot } from '../../src/review/history.ts'
import { stockProfileSnapshot } from '../../src/review/profile.ts'
import type { TraderKitHttpRequest, TraderKitHttpResponse } from '../../src/context-types.ts'
import {
  jsonBody,
  limitHitResponse,
  injectedReviewState,
  makeDeps,
  makeReq,
  makeRes,
  makeTempRoot,
  NOW_1432,
  seedCard,
  stubRequestRejection,
  type RecordedResponse,
} from './helpers.ts'

const API_LOCAL = REVIEW_PAGE_PATH + '/api/local'
const API_ENRICH = REVIEW_PAGE_PATH + '/api/enrich'
const API_CARD = REVIEW_PAGE_PATH + '/api/card'
const API_DATES = REVIEW_PAGE_PATH + '/api/dates'

/** A 层放行请求（cookie 判定桩）。 */
function authedReq(options: Parameters<typeof makeReq>[0] = {}): TraderKitHttpRequest {
  return makeReq({ ...options, headers: { ...options.headers, cookie: 'dsh-auth=ok' } })
}

async function drive(handler: ReturnType<typeof createReviewHandler>, req: TraderKitHttpRequest): Promise<RecordedResponse> {
  const { res, rec } = makeRes()
  await handler(req, res)
  return rec
}

function dirSnapshot(root: string): Array<{ name: string; size: number }> {
  const monthDir = join(root, 'DB', 'review')
  if (!existsSync(monthDir)) return []
  const out: Array<{ name: string; size: number }> = []
  for (const month of readdirSync(monthDir)) {
    const dir = join(monthDir, month)
    for (const name of readdirSync(dir)) {
      out.push({ name: month + '/' + name, size: readFileSync(join(dir, name)).length })
    }
  }
  return out
}

async function postCard(handler: ReturnType<typeof createReviewHandler>, payload: unknown, headers: Record<string, string | string[] | undefined> = {}): Promise<RecordedResponse> {
  return drive(handler, makeReq({
    url: API_CARD,
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'dsh-auth=ok', ...headers },
    body: JSON.stringify(payload),
  }))
}

describe('GET /review：页面 HTML（tasks 2.1/2.4）', () => {
  it('A 层请求 → 200 text/html + Cache-Control no-store + 页面标记 + 注入状态 writable=true', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: REVIEW_PAGE_PATH }))
    expect(rec.status).toBe(200)
    expect(rec.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(rec.headers['Cache-Control']).toBe('no-store')
    expect(rec.body).toContain(REVIEW_PAGE_MARKER)
    const state = injectedReviewState(rec.body)
    expect(state.writable).toBe(true)
    expect(state.basePath).toBe(REVIEW_BASE_PATH)
    expect(state.routePath).toBe(REVIEW_PAGE_PATH)
  })

  it('query 形态（?code=600000）与 path 段直链（/review/600000、/review/SH600000、/review/）均交付同一页面', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    for (const url of [REVIEW_PAGE_PATH + '?code=600000', REVIEW_PAGE_PATH + '/600000', REVIEW_PAGE_PATH + '/SH600000', REVIEW_PAGE_PATH + '/']) {
      const rec = await drive(handler, authedReq({ url }))
      expect(rec.status, url).toBe(200)
      expect(rec.headers['Content-Type'], url).toBe('text/html; charset=utf-8')
      expect(rec.body, url).toContain(REVIEW_PAGE_MARKER)
    }
  })

  it('非 GET（POST /review，A 层已过）→ 405 + Allow；未认证 POST → 401 先行', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    const rec = await drive(handler, authedReq({ url: REVIEW_PAGE_PATH, method: 'POST' }))
    expect(rec.status).toBe(405)
    expect(rec.headers['Allow']).toBe('GET')
    const unauth = await drive(handler, makeReq({ url: REVIEW_PAGE_PATH, method: 'POST' }))
    expect(unauth.status).toBe(401) // 认证判定先于方法校验
  })

  it('注入函数与 probe 同款转义：state 含 </script> 形态字符时不逃逸出脚本', () => {
    const state = { writable: false, basePath: '</script><x>', routePath: REVIEW_PAGE_PATH, injectedAt: '2026-09-27T00:00:00+08:00', writeKey: 'test-write-key' }
    const html = injectReviewState('window.__REVIEW__ = __REVIEW_STATE_JSON__;', state)
    expect(html).not.toContain('</script><x>')
    expect(html).toContain('\\u003C')
  })
})

describe('/review/api/* 匹配优先级：不被 path 段吞掉（tasks 2.1）', () => {
  it('GET /review/api/local 命中本地段 JSON（而非直链分支的 HTML）', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=600000' }))
    expect(rec.status).toBe(200)
    expect(rec.headers['Content-Type']).toBe('application/json')
    expect(jsonBody(rec).code).toBe('600000')
  })

  it('/review/api 前缀下的未知路径（含已废止 /api/context）一律 404', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    for (const url of [REVIEW_PAGE_PATH + '/api/context', REVIEW_PAGE_PATH + '/api', REVIEW_PAGE_PATH + '/api/other']) {
      const rec = await drive(handler, authedReq({ url }))
      expect(rec.status, url).toBe(404)
    }
  })

  it(' basePath 外路径 → 404', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: REVIEW_BASE_PATH + '/other' }))
    expect(rec.status).toBe(404)
  })
})

describe('GET /review/api/local：纯本地段（tasks 2.1/2.3/2.6）', () => {
  it('归一化去壳：SH600000 → 600000（原值留档），空库 → code-only + 空卡片 + 归属交易日', async () => {
    const { deps, records } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=SH600000' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ code: string; codeRaw: string; name: { value: string | null; nameSource: string }; cards: unknown[]; cardedDates: string[]; warnings: string[]; date: string; dateSource: string; tradeDate: { value: string; isTradingDay: boolean } }>(rec)
    expect(body.code).toBe('600000')
    expect(body.codeRaw).toBe('SH600000')
    expect(body.name.nameSource).toBe('code-only')
    expect(body.name.value).toBeNull()
    expect(body.cards).toEqual([])
    expect(body.cardedDates).toEqual([])
    expect(body.warnings).toEqual([])
    expect(body.date).toBe('2026-09-24')
    expect(body.dateSource).toBe('resolved')
    expect(body.tradeDate.value).toBe('2026-09-24')
    expect(body.tradeDate.isTradingDay).toBe(true)
    expect(records.locateCalls).toBe(1)
  })

  it('显式日期（紧凑写法）→ dateSource=requested、tradeDate=null；非法日期 → 400', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    const ok = await drive(handler, authedReq({ url: API_LOCAL + '?code=600000.SH&date=20260924' }))
    expect(ok.status).toBe(200)
    const body = jsonBody<{ date: string; dateSource: string; tradeDate: unknown }>(ok)
    expect(body.date).toBe('2026-09-24')
    expect(body.dateSource).toBe('requested')
    expect(body.tradeDate).toBeNull()
    const bad = await drive(handler, authedReq({ url: API_LOCAL + '?code=600000&date=2026-13-01' }))
    expect(bad.status).toBe(400)
    expect(jsonBody(bad).error).toBe('INVALID_DATE')
  })

  it('非法代码（60000）→ 400 + 原文/期望格式/TDX 指引，且零读取（不触发 locateDoc）', async () => {
    const { deps, records } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=60000' }))
    expect(rec.status).toBe(400)
    const body = jsonBody<{ error: string; codeRaw: string; message: string; hint: string }>(rec)
    expect(body.error).toBe('INVALID_CODE')
    expect(body.codeRaw).toBe('60000')
    expect(body.message).toContain('60000')
    expect(body.message).toContain('6 位数字')
    expect(body.hint).toContain('TDX')
    expect(records.locateCalls).toBe(0)
    expect(records.conceptCalls).toHaveLength(0)
    expect(records.limitCalls).toHaveLength(0)
  })

  it('有文档：exists + 卡片集合 + 名称层①（frontmatter-history）+ 多命中 warnings 透传', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    await seedCard(root, '600000', '2026-09-24', '竞价弱转强，观察承接', 'seed-1')
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=sh600000&date=2026-09-24' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ exists: boolean; cards: Array<{ anchor: string; body: string }>; name: { value: string | null; nameSource: string }; warnings: string[]; path: string }>(rec)
    expect(body.exists).toBe(true)
    expect(body.cards).toHaveLength(1)
    expect(body.cards[0].body).toContain('竞价弱转强')
    expect(body.name.value).toBe('浦发银行')
    expect(body.name.nameSource).toBe('frontmatter-history')
    expect(body.path).toContain('600000_')
    expect(body.warnings).toEqual([])
  })

  it('有卡日期列表（cardedDates 降序）来自月桶扫描', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    await seedCard(root, '600000', '2026-09-24', 'a', 's1')
    await seedCard(root, '600000', '2026-09-22', 'b', 's2')
    // 本用例锁定已取得的历史排序；冷态/补位契约由local-budget测试覆盖。
    const history = historySnapshot(root)
    await history.refresh()
    if (history.value === undefined) await history.refresh() // 写中失效的旧预热完成后重建
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=600000' }))
    expect(jsonBody<{ cardedDates: string[] }>(rec).cardedDates).toEqual(['2026-09-24', '2026-09-22'])
  })

  it('数据根未配置 → 200 + DATA_ROOT_UNCONFIGURED + 配置指引（显式降级，不猜测）', async () => {
    const { deps } = makeDeps({ dataRoot: '' })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=600000' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ error: string; message: string; cards: unknown[] }>(rec)
    expect(body.error).toBe('DATA_ROOT_UNCONFIGURED')
    expect(body.message).toContain('dataRoot')
    expect(body.cards).toEqual([])
  })
})

describe('GET /review/api/enrich：网络段（tasks 2.1；名称层②/标签/回溯）', () => {
  it('合法代码 → 200：T1 命中文案（按源业务日）+ 层②名称 T2-S8 + 标签 + 行情四格', async () => {
    const { deps, records } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=600000&date=2026-09-24' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ code: string; name: { available: boolean; name: string | null; nameSource: string | null }; quote: { available: boolean; price: number | null; pct: number | null; ltsz: number | null; zsz: number | null; ltgb: number | null; detail: string | null }; concepts: { available: boolean; labels: string[] }; limitReason: { availability: { available: boolean }; businessDate?: string; text: string; requestedDates: string[] } }>(rec)
    expect(body.code).toBe('600000')
    expect(body.name.available).toBe(true)
    expect(body.name.nameSource).toBe('T2-S8')
    expect(body.concepts.available).toBe(true)
    expect(body.concepts.labels).toContain('银行')
    // 行情四格（S9 快照；concepts.name 命中时名称走 T2-S8，四格仍出快照——同一次出站）。
    expect(body.quote.available).toBe(true)
    expect(body.quote.price).toBe(13.25)
    expect(body.quote.pct).toBe(2.34)
    expect(body.quote.ltsz).toBe(3.86e11)
    expect(body.quote.zsz).toBe(3.9e11)
    expect(body.quote.ltgb).toBe(2.92e10)
    expect(body.quote.detail).toBeNull()
    expect(body.limitReason.availability.available).toBe(true)
    expect(body.limitReason.businessDate).toBe('2026-09-24')
    expect(body.limitReason.text).toContain('按源业务日 2026-09-24')
    expect(body.limitReason.requestedDates).toEqual(['2026-09-24'])
    expect(records.limitCalls).toHaveLength(1)
    expect(records.quoteCalls).toEqual(['600000'])
  })

  it('T2/S8 名称未命中 → 层②止于行情快照 name（nameSource=quote-ths，同一次出站）', async () => {
    const { deps, records } = makeDeps({
      overrides: {
        getConcepts: async () => ({ available: true, labels: ['银行'], name: null, detail: null }),
      },
    })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=600000' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ name: { available: boolean; name: string | null; nameSource: string | null }; quote: { available: boolean } }>(rec)
    expect(body.name.available).toBe(true)
    expect(body.name.nameSource).toBe('quote-ths')
    expect(body.name.name).toBe('浦发银行')
    expect(body.quote.available).toBe(true)
    expect(records.quoteCalls).toHaveLength(1) // 单次 enrich 至多 1 次 S9 出站
  })

  it('行情快照不可得 → quote 段 available=false 全 null + detail（不冒充 0），名称随层②显式未命中', async () => {
    const { deps } = makeDeps({
      overrides: {
        getConcepts: async () => ({ available: true, labels: ['银行'], name: null, detail: null }),
        lookupQuote: async () => null,
      },
    })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=600000' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ name: { available: boolean; nameSource: string | null }; quote: { available: boolean; price: number | null; pct: number | null; ltsz: number | null; zsz: number | null; ltgb: number | null; detail: string | null } }>(rec)
    expect(body.quote.available).toBe(false)
    expect(body.quote.price).toBeNull()
    expect(body.quote.pct).toBeNull()
    expect(body.quote.ltsz).toBeNull()
    expect(body.quote.zsz).toBeNull()
    expect(body.quote.ltgb).toBeNull()
    expect(body.quote.detail).toContain('行情快照未取得')
    expect(body.name.available).toBe(false)
    expect(body.name.nameSource).toBeNull()
  })

  it('非法代码 → 400 且零网络（T1/T2 均未被调用）', async () => {
    const { deps, records } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=abc' }))
    expect(rec.status).toBe(400)
    expect(records.limitCalls).toHaveLength(0)
    expect(records.conceptCalls).toHaveLength(0)
    expect(records.quoteCalls).toHaveLength(0)
  })

  it('行情快照未接线 → quote 段显式不可得（不冒充），名称层②止于 T2/S8 仍可得；T2 抛错 → 标签单项降级', async () => {
    const { deps } = makeDeps({ overrides: { lookupQuote: undefined } })
    const handler = createReviewHandler(deps)
    const rec = await drive(handler, authedReq({ url: API_ENRICH + '?code=600000' }))
    const body = jsonBody<{ name: { available: boolean; nameSource: string | null }; quote: { available: boolean; price: number | null; detail: string | null }; concepts: { available: boolean } }>(rec)
    expect(body.quote.available).toBe(false)
    expect(body.quote.price).toBeNull()
    expect(body.quote.detail).toContain('未接线')
    expect(body.name.available).toBe(true) // 层②第一级（T2/S8 反查）随 getConcepts 仍接线
    expect(body.name.nameSource).toBe('T2-S8')
    expect(body.concepts.available).toBe(true)
    const throwing = makeDeps({
      overrides: {
        getConcepts: async () => {
          throw new Error('S8 不可达')
        },
      },
    })
    const rec2 = await drive(createReviewHandler(throwing.deps), authedReq({ url: API_ENRICH + '?code=600000' }))
    const body2 = jsonBody<{ name: { available: boolean; nameSource: string | null }; concepts: { available: boolean; detail: string | null }; limitReason: { availability: { available: boolean } } }>(rec2)
    expect(body2.concepts.available).toBe(false)
    expect(body2.concepts.detail).toContain('S8 不可达')
    expect(body2.name.available).toBe(true) // S8 失败 → 名称层②落快照兜底
    expect(body2.name.nameSource).toBe('quote-ths')
    expect(body2.limitReason.availability.available).toBe(true) // 单项降级不回传 B1 其它段
  })

  it('T1 传输失败 → limitReason sourceError（错误码/原因透出）', async () => {
    const { deps } = makeDeps({
      limitResponse: async () => {
        throw new Error('S7 超时')
      },
    })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=600000' }))
    const body = jsonBody<{ limitReason: { availability: { available: boolean; reason?: string }; text: string; detail?: string } }>(rec)
    expect(body.limitReason.availability.available).toBe(false)
    expect(body.limitReason.availability.reason).toBe('sourceError')
    expect(body.limitReason.text).toContain('数据源错误')
    expect(body.limitReason.detail).toContain('S7 超时')
  })

  it('T0 businessDate=null → 回溯未发起（零 T1 调用）+ dateUnavailable 显式文案', async () => {
    const { deps, records } = makeDeps({
      overrides: {
        resolveTradeDate: async () => ({ value: null, source: 'T1-tradeDate' as const, isTradingDay: null, confidence: 'low' as const }),
      },
    })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=600000' }))
    const body = jsonBody<{ limitReason: { availability: { available: boolean; reason?: string }; requestedDates: string[]; detail?: string } }>(rec)
    expect(body.limitReason.availability.available).toBe(false)
    expect(body.limitReason.availability.reason).toBe('dateUnavailable')
    expect(body.limitReason.requestedDates).toEqual([])
    expect(body.limitReason.detail).toContain('resolveTradeDate')
    expect(records.limitCalls).toHaveLength(0)
  })
})

describe('POST /review/api/card：A 层写入通道（tasks 2.2/2.7；spec 认证分层）', () => {
  const validPayload = { code: '600000', body: '分时回封，量能跟上', clientRequestId: 'req-001' }

  it('无凭据（无 cookie 无 key）→ 401 {UNAUTHENTICATED} + 提示，零落盘（owner 2026-10-05：写凭据②=回环+key）', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const before = dirSnapshot(root)
    const rec = await drive(createReviewHandler(deps), makeReq({ url: API_CARD, method: 'POST', body: JSON.stringify(validPayload) }))
    expect(rec.status).toBe(401)
    const body = jsonBody<{ error: string; message: string }>(rec)
    expect(body.error).toBe('UNAUTHENTICATED')
    expect(body.message).toContain('writeKey')
    expect(dirSnapshot(root)).toEqual(before)
  })

  it('写凭据②：无 cookie + x-write-key 匹配 → 200 created（owner 2026-10-05 回环+key 通道）', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const rec = await drive(createReviewHandler(deps), makeReq({
      url: API_CARD, method: 'POST', body: JSON.stringify(validPayload), headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(rec.status).toBe(200)
    expect(jsonBody<{ status: string }>(rec).status).toBe('created')
  })

  it('写凭据②负向：key 错误 → 401 零落盘', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const before = dirSnapshot(root)
    const rec = await drive(createReviewHandler(deps), makeReq({
      url: API_CARD, method: 'POST', body: JSON.stringify(validPayload), headers: { 'x-write-key': 'wrong' },
    }))
    expect(rec.status).toBe(401)
    expect(dirSnapshot(root)).toEqual(before)
  })

  it('403 栅栏不救援（任何凭据不放宽）；仅带诊断 token（?token=）直连写接口 → 401 零写入', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const handler = createReviewHandler(deps)
    const before = dirSnapshot(root)
    // 403（栅栏）即使带 A 层 cookie 也不放行（栅栏是跨站防御，不是认证）。
    const fenced = await postCard(handler, validPayload, { fence: '1', cookie: 'dsh-auth=ok' })
    expect(fenced.status).toBe(403)
    // 仅带 ?token=（宿主 launchToken 或插件诊断 token 形态）直连业务路径：?token= 只在
    // 根路径被宿主消费，isAuthenticated 只读 cookie → 必然 401（spec 负向场景）。
    const tokenUrl = await drive(handler, makeReq({
      url: API_CARD + '?token=deadbeef-diagnostic',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validPayload),
    }))
    expect(tokenUrl.status).toBe(401)
    expect(dirSnapshot(root)).toEqual(before)
  })

  it('A 层不可用 + C 层签字只读（allowUnauthenticatedRead=true）→ POST 仍 401（写通道两分支同 = 只认 A 层）', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root, overrides: { allowUnauthenticatedRead: true } })
    const before = dirSnapshot(root)
    const rec = await drive(createReviewHandler(deps), makeReq({ url: API_CARD, method: 'POST', body: JSON.stringify(validPayload) }))
    expect(rec.status).toBe(401)
    expect(jsonBody(rec).error).toBe('UNAUTHENTICATED')
    expect(dirSnapshot(root)).toEqual(before)
  })

  it('A 层有效 → 200 created：落盘卡片 + writtenAt + warnings；同 clientRequestId 重放 → duplicate 且单卡', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const handler = createReviewHandler(deps)
    const first = await postCard(handler, validPayload)
    expect(first.status).toBe(200)
    const body = jsonBody<{ status: string; anchor: string; path: string; warnings: string[]; clientRequestId: string; writtenAt: string }>(first)
    expect(body.status).toBe('created')
    expect(body.anchor).toBe('card-20260924-600000-1432')
    expect(body.clientRequestId).toBe('req-001')
    expect(body.writtenAt).toBe('2026-09-24T14:32:05+08:00')
    expect(body.warnings).toEqual([])
    expect(existsSync(body.path)).toBe(true)
    const written = readFileSync(body.path, 'utf8')
    expect(written).toContain('- clientRequestId: req-001')
    expect(written).toContain('分时回封，量能跟上')
    const replay = await postCard(handler, validPayload)
    expect(replay.status).toBe(200)
    expect(jsonBody<{ status: string; anchor: string }>(replay).status).toBe('duplicate')
    expect(jsonBody<{ anchor: string }>(replay).anchor).toBe(body.anchor)
    expect(readFileSync(body.path, 'utf8').split('^card-').length - 1).toBe(1) // 只存在一张对应卡片
  })

  it('入参校验逐项 4xx + 零落盘（tasks 2.7：code/body/tradeDate/name/clientRequestId）', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const handler = createReviewHandler(deps)
    const cases: Array<{ label: string; payload: Record<string, unknown>; error: string }> = [
      { label: '缺 clientRequestId', payload: { code: '600000', body: 'x' }, error: 'MISSING_CLIENT_REQUEST_ID' },
      { label: 'code 非法', payload: { code: '6000000', body: 'x', clientRequestId: 'r' }, error: 'INVALID_CODE' },
      { label: 'body 空', payload: { code: '600000', body: '   ', clientRequestId: 'r' }, error: 'EMPTY_BODY' },
      { label: 'body 超 10000', payload: { code: '600000', body: 'x'.repeat(10001), clientRequestId: 'r' }, error: 'BODY_TOO_LONG' },
      { label: 'tradeDate 紧凑形态', payload: { code: '600000', body: 'x', clientRequestId: 'r', tradeDate: '20260924' }, error: 'INVALID_TRADE_DATE' },
      { label: 'tradeDate 非法日历', payload: { code: '600000', body: 'x', clientRequestId: 'r', tradeDate: '2026-02-30' }, error: 'INVALID_TRADE_DATE' },
      { label: 'name 超 200', payload: { code: '600000', body: 'x', clientRequestId: 'r', name: 'n'.repeat(201) }, error: 'NAME_TOO_LONG' },
      { label: 'name 非字符串', payload: { code: '600000', body: 'x', clientRequestId: 'r', name: 3 }, error: 'INVALID_NAME' },
    ]
    const before = dirSnapshot(root)
    for (const c of cases) {
      const rec = await postCard(handler, c.payload)
      expect(rec.status, c.label).toBe(400)
      expect(jsonBody(rec).error, c.label).toBe(c.error)
      if (c.label === 'body 超 10000') {
        expect(jsonBody<{ limit: number; actual: number }>(rec).limit).toBe(10000)
        expect(jsonBody<{ actual: number }>(rec).actual).toBe(10001)
      }
      if (c.label === 'name 超 200') expect(jsonBody<{ actual: number }>(rec).actual).toBe(201)
    }
    expect(dirSnapshot(root)).toEqual(before)
  })

  it('请求体非 JSON → 400 INVALID_JSON', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), makeReq({ url: API_CARD, method: 'POST', headers: { cookie: 'dsh-auth=ok' }, body: 'not-json' }))
    expect(rec.status).toBe(400)
    expect(jsonBody(rec).error).toBe('INVALID_JSON')
  })

  it('缺省 tradeDate + T0 归属待确认（isTradingDay=null）→ 409 TRADE_DATE_UNCONFIRMED 零落盘（不静默按系统日期归属）', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({
      dataRoot: root,
      overrides: {
        resolveTradeDate: async () => ({ value: '2026-09-26', source: 'T1-tradeDate' as const, isTradingDay: null, confidence: 'low' as const }),
      },
    })
    const before = dirSnapshot(root)
    const rec = await postCard(createReviewHandler(deps), { code: '600000', body: 'x', clientRequestId: 'r' })
    expect(rec.status).toBe(409)
    const body = jsonBody<{ error: string; message: string; isTradingDay: unknown }>(rec)
    expect(body.error).toBe('TRADE_DATE_UNCONFIRMED')
    expect(body.message).toContain('tradeDate')
    expect(body.isTradingDay).toBeNull()
    expect(dirSnapshot(root)).toEqual(before)
  })

  it('CONCURRENT_WRITE（重试耗尽）→ 409 含路径与处置建议', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({
      dataRoot: root,
      overrides: {
        appendCard: async () => {
          throw new ConcurrentWriteError('CONCURRENT_WRITE: 路径 — 重试 3 次后仍冲突；请确认外部占用结束后重试')
        },
      },
    })
    const rec = await postCard(createReviewHandler(deps), { code: '600000', body: 'x', clientRequestId: 'r2' })
    expect(rec.status).toBe(409)
    const body = jsonBody<{ error: string; message: string }>(rec)
    expect(body.error).toBe('CONCURRENT_WRITE')
    expect(body.message).toContain('重试')
  })

  it('不同归属不写既有文档：既有文档字节不变（写前归属硬校验的字节事实）', async () => {
    const root = makeTempRoot()
    await seedCard(root, '600000', '2026-09-24', '既有卡片', 'seed-1')
    const monthDir = join(root, 'DB', 'review', '202609')
    const file = join(monthDir, readdirSync(monthDir)[0])
    const before = readFileSync(file, 'utf8')
    const { deps } = makeDeps({ dataRoot: root })
    const rec = await postCard(createReviewHandler(deps), { code: '600000', body: '新日卡片', clientRequestId: 'r9', tradeDate: '2026-09-25' })
    expect(rec.status).toBe(200) // 写入 2026-09-25 的独立文档
    expect(readFileSync(file, 'utf8')).toBe(before) // 既有 2026-09-24 文档字节不变
    expect(jsonBody<{ path: string }>(rec).path).not.toBe(file)
  })
})

describe('GET /review/api/dates（tasks 2.1；B2 提示用）', () => {
  it('月桶扫描该标的有卡日期（降序）；其它标的不混入', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    await seedCard(root, '600000', '2026-09-24', 'a', 's1')
    await seedCard(root, '600000', '2026-09-22', 'b', 's2')
    await seedCard(root, '000001', '2026-09-24', 'c', 's3')
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_DATES + '?code=600000' }))
    expect(rec.status).toBe(200)
    expect(jsonBody<{ code: string; dates: string[] }>(rec)).toEqual({ code: '600000', dates: ['2026-09-24', '2026-09-22'], warnings: [] })
  })

  it('非法代码 → 400；数据根未配置 → 空表 + 指引', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    const bad = await drive(handler, authedReq({ url: API_DATES + '?code=60000' }))
    expect(bad.status).toBe(400)
    const unconfigured = makeDeps({ dataRoot: '' })
    const rec = await drive(createReviewHandler(unconfigured.deps), authedReq({ url: API_DATES + '?code=600000' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ dates: string[]; error?: string }>(rec)
    expect(body.dates).toEqual([])
    expect(body.error).toBe('DATA_ROOT_UNCONFIGURED')
  })
})

describe('静态资产面与直链穿越（tasks 2.4；spec「静态资产安全与打包」）', () => {
  function withAssetMap(map: Record<string, string>): ReturnType<typeof makeDeps> {
    return makeDeps({ overrides: { readAsset: (rel: string) => (rel in map ? map[rel] : null) } })
  }

  it('白名单扩展名 → 正确 MIME + no-cache；白名单外（.exe）→ 404', async () => {
    const { deps } = withAssetMap({ 'style.css': 'body { color: red; }' })
    const handler = createReviewHandler(deps)
    const css = await drive(handler, authedReq({ url: REVIEW_PAGE_PATH + '/assets/style.css' }))
    expect(css.status).toBe(200)
    expect(css.headers['Content-Type']).toBe('text/css')
    expect(css.headers['Cache-Control']).toBe('no-store')
    expect(css.body).toContain('color: red')
    const exe = await drive(handler, authedReq({ url: REVIEW_PAGE_PATH + '/assets/tool.exe' }))
    expect(exe.status).toBe(404)
  })

  it('穿越/盘符/URL 编码穿越/多段 → 404（非 403）；readAsset 未命中 → 404', async () => {
    const { deps } = withAssetMap({ 'a.css': 'x' })
    const handler = createReviewHandler(deps)
    const urls = [
      REVIEW_PAGE_PATH + '/assets/..%2fsecret.css',
      REVIEW_PAGE_PATH + '/assets/%2e%2e/secret.css',
      REVIEW_PAGE_PATH + '/assets/..',
      REVIEW_PAGE_PATH + '/assets/C:boot.ini',
      REVIEW_PAGE_PATH + '/assets/sub/dir.css',
      REVIEW_PAGE_PATH + '/assets/missing.css',
    ]
    for (const url of urls) {
      const rec = await drive(handler, authedReq({ url }))
      expect(rec.status, url).toBe(404)
      expect(rec.status, url).not.toBe(403)
    }
  })

  it('直链段穿越（..、%2e%2e、盘符）→ 404；常规段（abc）→ 页面（页面侧渲染显式空态）', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    for (const url of [REVIEW_PAGE_PATH + '/..', REVIEW_PAGE_PATH + '/..%2f..%2fetc', REVIEW_PAGE_PATH + '/%2e%2e', REVIEW_PAGE_PATH + '/C:', REVIEW_PAGE_PATH + '/a/b']) {
      const rec = await drive(handler, authedReq({ url }))
      expect(rec.status, url).toBe(404)
      expect(rec.status, url).not.toBe(403)
    }
    const plain = await drive(handler, authedReq({ url: REVIEW_PAGE_PATH + '/abc' }))
    expect(plain.status).toBe(200)
    expect(plain.headers['Content-Type']).toBe('text/html; charset=utf-8')
  })
})

describe('认证读分档（tasks 2.2；默认分支 A 层 / 签字只读分支）', () => {
  it('默认（allowUnauthenticatedRead=false）：未认证 GET 页面/读接口 → 401', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    const page = await drive(handler, makeReq({ url: REVIEW_PAGE_PATH }))
    expect(page.status).toBe(401)
    expect(jsonBody(page).error).toBe('UNAUTHENTICATED')
    const local = await drive(handler, makeReq({ url: API_LOCAL + '?code=600000' }))
    expect(local.status).toBe(401)
  })

  it('签字只读分支（allowUnauthenticatedRead=true）：GET 页面 200 + 注入 writable:true（writeKey 通道就位，页面恒可写）；读接口放行', async () => {
    const { deps } = makeDeps({ overrides: { allowUnauthenticatedRead: true } })
    const handler = createReviewHandler(deps)
    const page = await drive(handler, makeReq({ url: REVIEW_PAGE_PATH }))
    expect(page.status).toBe(200)
    const state = injectedReviewState(page.body)
    // owner 2026-10-05：writeKey 通道就位——只读分支注入 writable:true（页面恒可写）。
    expect(state.writable).toBe(true)
    expect(state.writeKey.length).toBeGreaterThan(0)
    const local = await drive(handler, makeReq({ url: API_LOCAL + '?code=600000' }))
    expect(local.status).toBe(200)
    expect(jsonBody(local).code).toBe('600000')
    // 直链同样注入可写状态。
    const direct = await drive(handler, makeReq({ url: REVIEW_PAGE_PATH + '/600000' }))
    expect(injectedReviewState(direct.body).writable).toBe(true)
  })

  it('403 栅栏在签字只读分支下仍 403（栅栏不是认证）', async () => {
    const { deps } = makeDeps({ overrides: { allowUnauthenticatedRead: true } })
    const rec = await drive(createReviewHandler(deps), makeReq({ url: REVIEW_PAGE_PATH, headers: { fence: '1' } }))
    expect(rec.status).toBe(403)
  })
})

describe('handler 边界（tasks 2.8）', () => {
  it('非 GET 读路由 → 405 + Allow（dates/enrich/local）', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    for (const url of [API_DATES, API_ENRICH, API_LOCAL]) {
      const rec = await drive(handler, makeReq({ url, method: 'DELETE', headers: { cookie: 'dsh-auth=ok' } }))
      expect(rec.status, url).toBe(405)
      expect(rec.headers['Allow'], url).toBe('GET')
    }
    const cardGet = await drive(handler, authedReq({ url: API_CARD }))
    expect(cardGet.status).toBe(405)
    expect(cardGet.headers['Allow']).toBe('POST')
  })

  it('同步缓存函数抛错 → 500 INTERNAL（handler 不向宿主抛出）', async () => {
    const { deps } = makeDeps({
      overrides: {
        peekTradeDate: () => {
          throw new Error('T0 不可用')
        },
      },
    })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=600000' }))
    expect(rec.status).toBe(500)
    expect(jsonBody(rec).error).toBe('INTERNAL')
  })

  it('客户端断开（req.destroyed）→ enrich 回溯在首次 T1 请求前中止且不写响应', async () => {
    const { deps, records } = makeDeps({
      limitResponse: async (input) => ({ available: false, tradeDate: null, errors: ['dateUnavailable'], guard: null, cause: null }),
    })
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_ENRICH + '?code=600000', destroyed: true }))
    expect(records.limitCalls).toHaveLength(0) // 回溯发起前即探测到断开（惰性 aborted）
    expect(rec.ended).toBe(false) // BacktrackAbortedError → 静默收尾（响应已不可达）
  })

  it('deps seam 完整性：requestRejection 桩语义与生产同序（403 优先于 401）', async () => {
    expect(stubRequestRejection(makeReq({ headers: { fence: '1', cookie: 'dsh-auth=ok' } }))).toBe(403)
    expect(stubRequestRejection(makeReq({ headers: { cookie: 'dsh-auth=ok' } }))).toBeUndefined()
    expect(stubRequestRejection(makeReq({}))).toBe(401)
    const { deps } = makeDeps({ limitResponse: limitHitResponse('2026-09-24') })
    const handler: ReviewHandlerDeps['requestRejection'] = deps.requestRejection
    expect(handler(makeReq({}))).toBe(401)
    expect(NOW_1432.getTime()).toBe(new Date('2026-09-24T06:32:05Z').getTime())
  })
})

describe('POST /review/api/card/update + /delete（owner 2026-10-05 追授：修订/删除）', () => {
  const API_UPDATE = REVIEW_PAGE_PATH + '/api/card/update'
  const API_DELETE = REVIEW_PAGE_PATH + '/api/card/delete'
  const ANCHOR = 'card-20260924-600000-1432'

  it('写凭据门控：无凭据 → 401 且 store 出口零调用（update/delete 同款）', async () => {
    const { deps, records } = makeDeps()
    const handler = createReviewHandler(deps)
    const r1 = await drive(handler, makeReq({ url: API_UPDATE, method: 'POST', body: JSON.stringify({ anchor: ANCHOR, body: 'x' }) }))
    expect(r1.status).toBe(401)
    const r2 = await drive(handler, makeReq({ url: API_DELETE, method: 'POST', body: JSON.stringify({ anchor: ANCHOR }) }))
    expect(r2.status).toBe(401)
    expect(records.updateCalls).toHaveLength(0)
    expect(records.deleteCalls).toHaveLength(0)
  })

  it('update：凭据匹配 → 200 updated；锚点/正文透传 store；错误 key → 401', async () => {
    const { deps, records } = makeDeps()
    const rec = await drive(createReviewHandler(deps), makeReq({
      url: API_UPDATE, method: 'POST',
      body: JSON.stringify({ anchor: ANCHOR, body: '新正文' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ status: string; anchor: string; warnings: string[] }>(rec)
    expect(body.status).toBe('updated')
    expect(body.anchor).toBe(ANCHOR)
    expect(records.updateCalls).toEqual([{ anchor: ANCHOR, body: '新正文' }])
    const bad = await drive(createReviewHandler(deps), makeReq({
      url: API_UPDATE, method: 'POST',
      body: JSON.stringify({ anchor: ANCHOR, body: 'x' }),
      headers: { 'x-write-key': 'wrong' },
    }))
    expect(bad.status).toBe(401)
  })

  it('update 入参校验逐项 4xx：非法锚点 / 空正文 / 超限正文 / 非 JSON', async () => {
    const { deps, records } = makeDeps()
    const handler = createReviewHandler(deps)
    const call = (raw: string): Promise<RecordedResponse> => drive(handler, makeReq({
      url: API_UPDATE, method: 'POST', body: raw, headers: { 'x-write-key': 'test-write-key' },
    }))
    expect((await call(JSON.stringify({ anchor: 'bogus', body: 'x' }))).status).toBe(400)
    expect((await call(JSON.stringify({ anchor: ANCHOR, body: '   ' }))).status).toBe(400)
    expect((await call(JSON.stringify({ anchor: ANCHOR, body: 'x'.repeat(10001) }))).status).toBe(400)
    expect((await call('not-json')).status).toBe(400)
    expect(records.updateCalls).toHaveLength(0)
  })

  it('delete：凭据匹配 → 200 deleted；锚点不存在 → 404 ANCHOR_NOT_FOUND；非法锚点 → 400', async () => {
    const { deps, records } = makeDeps()
    const rec = await drive(createReviewHandler(deps), makeReq({
      url: API_DELETE, method: 'POST', body: JSON.stringify({ anchor: ANCHOR }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ status: string; anchor: string }>(rec)
    expect(body.status).toBe('deleted')
    expect(records.deleteCalls).toEqual([ANCHOR])
    const missing = makeDeps({ overrides: { deleteCard: async () => { throw new AnchorNotFoundError('ANCHOR_NOT_FOUND: 不存在') } } })
    const rec2 = await drive(createReviewHandler(missing.deps), makeReq({
      url: API_DELETE, method: 'POST', body: JSON.stringify({ anchor: ANCHOR }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(rec2.status).toBe(404)
    expect(jsonBody<{ error: string }>(rec2).error).toBe('ANCHOR_NOT_FOUND')
    const invalid = await drive(createReviewHandler(deps), makeReq({
      url: API_DELETE, method: 'POST', body: JSON.stringify({ anchor: 'bogus' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(invalid.status).toBe(400)
  })

  it('出口未接线 → 501 NOT_IMPLEMENTED（显式，不静默成功）', async () => {
    const { deps } = makeDeps({ overrides: { updateCard: undefined, deleteCard: undefined } })
    const handler = createReviewHandler(deps)
    const r1 = await drive(handler, makeReq({
      url: API_UPDATE, method: 'POST', body: JSON.stringify({ anchor: ANCHOR, body: 'x' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(r1.status).toBe(501)
    const r2 = await drive(handler, makeReq({
      url: API_DELETE, method: 'POST', body: JSON.stringify({ anchor: ANCHOR }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(r2.status).toBe(501)
  })
})

describe('POST /review/api/organize（owner 2026-10-06 追授：整理意图登记）', () => {
  const API_ORGANIZE = REVIEW_PAGE_PATH + '/api/organize'

  it('写凭据门控：无凭据 → 401', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), makeReq({
      url: API_ORGANIZE, method: 'POST', body: JSON.stringify({ code: '000002', date: '2026-09-30' }),
    }))
    expect(rec.status).toBe(401)
  })

  it('登记成功 → 200 registered + 固定指令（含标的/日期/合规定位，服务端单一事实源）', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), makeReq({
      url: API_ORGANIZE, method: 'POST',
      body: JSON.stringify({ code: '000002', date: '2026-09-30' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ status: string; code: string; date: string | null; prompt: string }>(rec)
    expect(body.status).toBe('registered')
    expect(body.code).toBe('000002')
    expect(body.date).toBe('2026-09-30')
    expect(body.prompt).toContain('000002')
    expect(body.prompt).toContain('2026-09-30')
    expect(body.prompt).toContain('review_read_daily')
    expect(body.prompt).toContain('review_append_ainote')
    expect(body.prompt).toContain('研究辅助')
  })

  it('缺省日期 → prompt 以「最近交易日」占位；非法代码/非法日期 → 400', async () => {
    const { deps } = makeDeps()
    const handler = createReviewHandler(deps)
    const nodate = await drive(handler, makeReq({
      url: API_ORGANIZE, method: 'POST', body: JSON.stringify({ code: '000002' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(jsonBody<{ date: string | null; prompt: string }>(nodate).date).toBeNull()
    expect(jsonBody<{ prompt: string }>(nodate).prompt).toContain('最近交易日')
    const badCode = await drive(handler, makeReq({
      url: API_ORGANIZE, method: 'POST', body: JSON.stringify({ code: 'abc' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(badCode.status).toBe(400)
    const badDate = await drive(handler, makeReq({
      url: API_ORGANIZE, method: 'POST', body: JSON.stringify({ code: '000002', date: '2026-9-30' }),
      headers: { 'x-write-key': 'test-write-key' },
    }))
    expect(badDate.status).toBe(400)
  })
})

describe('GET /api/local：锚点领域档（owner 2026-10-06「领域归类」——DB/stock 锚点档案解析）', () => {
  it('88 代码 → anchor 段命中（名称/角色来自 DB/stock 档案，代码索引）', async () => {
    const root = makeTempRoot()
    const dir = join(root, 'DB', 'stock')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '微盘股.md'), [
      '---', '代码: "880823"', '板块:', '当前题材:', '题材地位:', '热点标签:',
      '角色: "情绪周期"', '锚点: true', '---', '', '# 股性', '', '# 记录', '',
    ].join('\n'), 'utf8')
    const { deps } = makeDeps({ dataRoot: root })
    await stockProfileSnapshot(root).refresh() // 锁定预热完成后的原有名称/角色契约
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=880823' }))
    expect(rec.status).toBe(200)
    const body = jsonBody<{ anchor: { isAnchor: boolean; name: string | null; role: string | null } | null }>(rec)
    expect(body.anchor).not.toBeNull()
    expect(body.anchor?.isAnchor).toBe(true)
    expect(body.anchor?.name).toBe('微盘股')
    expect(body.anchor?.role).toBe('情绪周期')
  })

  it('普通股票代码 → anchor=null（不触发档案扫描）', async () => {
    const { deps } = makeDeps()
    const rec = await drive(createReviewHandler(deps), authedReq({ url: API_LOCAL + '?code=600000' }))
    const body = jsonBody<{ anchor: unknown }>(rec)
    expect(body.anchor).toBeNull()
  })
})

describe('写卡 market 字段（owner 2026-10-06「代码标识加沪深」）', () => {
  it('显式 market=sh → 文件名带前缀（sh000001_…）；非法 market → 400 零落盘', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const handler = createReviewHandler(deps)
    const ok = await drive(handler, authedReq({
      url: API_CARD, method: 'POST',
      body: JSON.stringify({ code: '000001', body: '上证指数判断', clientRequestId: 'mk-1', tradeDate: '2026-09-30', name: '上证指数', market: 'sh' }),
    }))
    expect(ok.status).toBe(200)
    const body = jsonBody<{ path: string }>(ok)
    expect(body.path.split('\\').join('/')).toContain('/sh000001_上证指数_20260930.md')
    const bad = await drive(handler, authedReq({
      url: API_CARD, method: 'POST',
      body: JSON.stringify({ code: '000001', body: 'x', clientRequestId: 'mk-2', tradeDate: '2026-09-30', market: 'xx' }),
    }))
    expect(bad.status).toBe(400)
    expect(jsonBody<{ error: string }>(bad).error).toBe('INVALID_MARKET')
  })

  it('缺省 market → 既有 6 位文件名（零迁移）', async () => {
    const root = makeTempRoot()
    const { deps } = makeDeps({ dataRoot: root })
    const rec = await drive(createReviewHandler(deps), authedReq({
      url: API_CARD, method: 'POST',
      body: JSON.stringify({ code: '600000', body: '缺省市场', clientRequestId: 'mk-3', tradeDate: '2026-09-30' }),
    }))
    const body = jsonBody<{ path: string }>(rec)
    expect(body.path.split('\\').join('/')).toContain('/600000_600000_20260930.md')
  })
})
