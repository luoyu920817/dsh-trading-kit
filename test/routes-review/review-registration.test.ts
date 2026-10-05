/**
 * 复盘路由装配结构断言（change 4 tasks 2.1；design D-1/D-10 沿探针先例）。
 *
 * 「路由注册/卸载」按 tasks 2.8 属集成核对项：本文件用 `ctx.effect` 的 disposer
 * 契约做插件层结构断言（fake context 为真实对象、记录调用，零 mock 库）——
 * 路由表集合断言、与 change 1 探针路由共存（重复 (kind,path) 抛错不被触发）、
 * 宿主 match() 语义（exact 优先于 longest-prefix，host-webserver 已核验）下的
 * 匹配优先级、C 层开关两态。真实宿主内的注册/卸载行为由人工/集成核对（6.1）。
 */
import { describe, expect, it } from 'vitest'
import { registerProbe, PROBE_PATH } from '../../src/routes/probe.ts'
import { registerReviewRoutes, REVIEW_BASE_PATH, REVIEW_PAGE_PATH } from '../../src/routes/review.ts'
import { apply } from '../../src/index.ts'
import { resolveTraderKitConfig } from '../../src/config.ts'
import type { Context, TraderKitWebRoute } from '../../src/context-types.ts'
import { injectedReviewState, jsonBody, makeReq, makeRes, makeTempRoot, stubRequestRejection } from './helpers.ts'
import { REVIEW_PAGE_MARKER } from '../../src/client/review/index.html.ts'

/** 记录型 fake context：真实对象 + 数组记录，无 mock 库（沿 probe-registration 先例）。 */
function createHarness(options: { dataRoot?: string; withTraderKit?: boolean } = {}) {
  const routes: TraderKitWebRoute[] = []
  const logs: string[] = []
  const disposers: Array<() => void> = []
  const t0 = {
    requestedDate: '2026-09-24',
    businessDate: '2026-09-24',
    isTradingDay: true as const,
    source: 'S7' as const,
    fetchedAt: '2026-09-24T14:32:05+08:00',
    evidence: {},
  }
  const ctxObj: Record<string, unknown> = {
    logger: (name?: string) => ({
      info: (...args: unknown[]) => {
        logs.push(['info', name ?? '', ...args.map(String)].join(' '))
      },
      warn: (...args: unknown[]) => {
        logs.push(['warn', name ?? '', ...args.map(String)].join(' '))
      },
      error: () => {},
      debug: () => {},
    }),
    effect: (body: () => unknown, label?: string) => {
      const disposer = body()
      if (typeof disposer === 'function') disposers.push(disposer as () => void)
      logs.push('effect:' + String(label))
      return async () => {}
    },
    webServer: {
      register: (route: TraderKitWebRoute) => {
        // 宿主契约：重复 (kind, path) 抛错（host-webserver register，已核验）。
        if (routes.some((r) => r.kind === route.kind && r.path === route.path)) {
          throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
        }
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
      port: 41000,
      host: '127.0.0.1',
    },
    connection: {
      requestRejection: stubRequestRejection,
      authenticatedUrl: (url: string) => url + '?token=stub-launch-token',
    },
    // provide 同时挂到 ctx 上（镜像真实 cordis 行为；review 线依赖 ctx.traderKit 的挂载顺序）。
    provide: (key: string, api: unknown) => {
      ctxObj[key] = api
    },
  }
  if (options.withTraderKit !== false) {
    ctxObj.traderKit = {
      data: {
        dataRoot: options.dataRoot ?? '',
        resolveTradeDate: async () => t0,
        getLimitReason: async () => ({ available: true, tradeDate: '2026-09-24', errors: [], guard: null, cause: { value: '原因' } }),
        getConcepts: async () => ({ available: true, code: '600000', requestedDate: '2026-09-24', businessDate: null, name: '浦发银行', concepts: [{ name: '银行' }], source: 'S8', fetchedAt: null, notes: [], errors: [], guard: null }),
        guardStatus: () => ({ remaining: 100, budgetLimit: 200, budgetUsed: 0, minIntervalMs: 1000, sessionState: 'inSession' }),
      },
    }
  }
  const ctx = ctxObj as unknown as Context
  return { ctx, routes, logs, disposers }
}

/** 宿主 match() 语义复刻（host-webserver：exact 表命中，否则 longest-prefix）。 */
function matchRoute(routes: TraderKitWebRoute[], pathname: string): TraderKitWebRoute | undefined {
  const exact = routes.find((r) => r.kind === 'exact' && r.path === pathname)
  if (exact !== undefined) return exact
  let best: TraderKitWebRoute | undefined
  for (const route of routes) {
    if (route.kind !== 'prefix') continue
    if (pathname !== route.path && !pathname.startsWith(route.path + '/')) continue
    if (best === undefined || route.path.length > best.path.length) best = route
  }
  return best
}

async function drive(handler: TraderKitWebRoute['handler'], url: string, headers: Record<string, string> = {}) {
  const { res, rec } = makeRes()
  await handler(makeReq({ url, headers }), res)
  return rec
}

describe('路由表（tasks 2.1：六路由注册 + effect/disposer）', () => {
  it('注册恰 6 条路由：5 条 exact（页面 + 4 API）+ 1 条 prefix（直链/资产兜底），经 ctx.effect', () => {
    const h = createHarness()
    registerReviewRoutes(h.ctx)
    expect(h.routes).toHaveLength(6)
    const exacts = h.routes.filter((r) => r.kind === 'exact').map((r) => r.path)
    expect(exacts).toEqual([
      REVIEW_PAGE_PATH,
      REVIEW_PAGE_PATH + '/api/local',
      REVIEW_PAGE_PATH + '/api/enrich',
      REVIEW_PAGE_PATH + '/api/dates',
      REVIEW_PAGE_PATH + '/api/card',
    ])
    const prefixes = h.routes.filter((r) => r.kind === 'prefix').map((r) => r.path)
    expect(prefixes).toEqual([REVIEW_PAGE_PATH])
    expect(h.routes.every((r) => typeof r.handler === 'function')).toBe(true)
    expect(h.logs).toContain('effect:dsh-trader-kit: review routes')
  })

  it('MUST NOT 注册 GET /review/api/context（已废止）', () => {
    const h = createHarness()
    registerReviewRoutes(h.ctx)
    const paths = h.routes.map((r) => r.kind + ':' + r.path)
    expect(paths).not.toContain('exact:' + REVIEW_PAGE_PATH + '/api/context')
    expect(paths.join('\n')).not.toContain('/api/context')
  })

  it('disposer 卸载：路由表清空，无残留处理器', () => {
    const h = createHarness()
    registerReviewRoutes(h.ctx)
    expect(h.routes).toHaveLength(6)
    for (const disposer of h.disposers) disposer()
    expect(h.routes).toHaveLength(0)
  })

  it('挂载打印复盘页 URL 与 A 层登录 URL（端口由插件运行时打印）', () => {
    const h = createHarness()
    registerReviewRoutes(h.ctx)
    const joined = h.logs.join('\n')
    expect(joined).toContain('http://127.0.0.1:41000' + REVIEW_PAGE_PATH)
    expect(joined).toContain('登录 URL')
    expect(joined).toContain('http://127.0.0.1:41000/?token=stub-launch-token')
  })

  it('registerReviewRoutes 在 ctx.traderKit 未挂载时显式抛错（依赖 dataRoot 与 T0/T1/T2 出口）', () => {
    const h = createHarness({ withTraderKit: false })
    expect(() => registerReviewRoutes(h.ctx)).toThrowError(/traderKit/)
  })
})

describe('与 change 1 探针路由共存（tasks 2.1 验收：重复 (kind,path) 不被触发）', () => {
  it('registerProbe + registerReviewRoutes 同 ctx 注册不抛错；路径集合互不重叠', () => {
    const h = createHarness()
    registerProbe(h.ctx)
    expect(() => registerReviewRoutes(h.ctx)).not.toThrow()
    expect(h.routes).toHaveLength(7) // 探针 1 + 复盘 6
    const pairs = h.routes.map((r) => r.kind + ' ' + r.path)
    expect(new Set(pairs).size).toBe(7) // 无重复 (kind, path)
    expect(pairs).toContain('exact ' + PROBE_PATH)
    expect(pairs.filter((p) => p.startsWith('exact ' + REVIEW_BASE_PATH + '/review')).length).toBe(5)
  })

  it('宿主 match() 语义下：/review/api/* 由 exact 命中（不被 prefix 直链吞掉）', async () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    registerProbe(h.ctx)
    registerReviewRoutes(h.ctx)
    // /review/api/local → exact API 路由（JSON，而非 prefix 直链分支的 HTML）。
    const local = matchRoute(h.routes, REVIEW_PAGE_PATH + '/api/local')
    expect(local?.kind).toBe('exact')
    const rec = await drive(local!.handler, REVIEW_PAGE_PATH + '/api/local?code=SH600000', { cookie: 'dsh-auth=ok' })
    expect(rec.status).toBe(200)
    expect(rec.headers['Content-Type']).toBe('application/json')
    expect(jsonBody(rec).code).toBe('600000')
  })

  it('宿主 match() 语义下：/review/<code> 落入 prefix 直链（HTML）；/probe 不受影响', async () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    registerProbe(h.ctx)
    registerReviewRoutes(h.ctx)
    const direct = matchRoute(h.routes, REVIEW_PAGE_PATH + '/600000')
    expect(direct?.kind).toBe('prefix')
    const rec = await drive(direct!.handler, REVIEW_PAGE_PATH + '/600000', { cookie: 'dsh-auth=ok' })
    expect(rec.status).toBe(200)
    expect(rec.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(rec.body).toContain(REVIEW_PAGE_MARKER)
    const probe = matchRoute(h.routes, PROBE_PATH)
    expect(probe?.kind).toBe('exact')
    expect(probe!.path).toBe(PROBE_PATH)
    // /review（无段）→ exact 页面路由。
    const page = matchRoute(h.routes, REVIEW_PAGE_PATH)
    expect(page?.kind).toBe('exact')
  })
})

describe('C 层开关两态（tasks 2.2；owner 2026-10-05 签字「全部免签名」→ 生产默认 true；关闭态以显式 false 注入覆盖）', () => {
  it('生产默认（签字采纳）：未认证 GET 页面 → 200 + 注入 writable:false（只读降级，写接口仍 401）', async () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    registerReviewRoutes(h.ctx)
    const page = h.routes.find((r) => r.kind === 'exact' && r.path === REVIEW_PAGE_PATH)!
    const rec = await drive(page.handler, REVIEW_PAGE_PATH)
    expect(rec.status).toBe(200)
    expect(injectedReviewState(rec.body).writable).toBe(false)
    // 写接口在只读分支下仍只认 A 层（红线）——专门用例见 review-handler.test.ts 311/323。
  })

  it('显式关闭（allowUnauthenticatedRead=false 注入）：未认证 GET 页面 → 401', async () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    registerReviewRoutes(h.ctx, { allowUnauthenticatedRead: false })
    const page = h.routes.find((r) => r.kind === 'exact' && r.path === REVIEW_PAGE_PATH)!
    const rec = await drive(page.handler, REVIEW_PAGE_PATH)
    expect(rec.status).toBe(401)
    expect(jsonBody(rec).error).toBe('UNAUTHENTICATED')
  })

  it('options.allowUnauthenticatedRead=true 显式注入：未认证 GET 页面 → 200 + 注入 writable:false', async () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    registerReviewRoutes(h.ctx, { allowUnauthenticatedRead: true })
    const page = h.routes.find((r) => r.kind === 'exact' && r.path === REVIEW_PAGE_PATH)!
    const rec = await drive(page.handler, REVIEW_PAGE_PATH)
    expect(rec.status).toBe(200)
    expect(injectedReviewState(rec.body).writable).toBe(false)
  })

  it('装配接线冒烟：ctx.connection.requestRejection 真实参与判定（A 层 cookie → 200 writable:true）', async () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    registerReviewRoutes(h.ctx)
    const page = h.routes.find((r) => r.kind === 'exact' && r.path === REVIEW_PAGE_PATH)!
    const rec = await drive(page.handler, REVIEW_PAGE_PATH, { cookie: 'dsh-auth=ok' })
    expect(rec.status).toBe(200)
    const state = injectedReviewState(rec.body)
    expect(state.writable).toBe(true)
    expect(state.basePath).toBe(REVIEW_BASE_PATH)
  })
})

describe('装配面结构（挂载后可观察）', () => {
  it('apply 全量挂载（探针开启）→ 数据工具 3 + tq_skill_manage 1 + 每日汇总 4 + 复盘路由 6 + 探针 1，互不冲突', () => {
    const h = createHarness({ dataRoot: makeTempRoot() })
    const registeredTools: unknown[] = []
    const ctxObj = h.ctx as unknown as Record<string, unknown>
    ctxObj.tools = { register: (tool: unknown) => {
      registeredTools.push(tool)
      return () => {}
    } }
    expect(() => apply(h.ctx, resolveTraderKitConfig({}))).not.toThrow()
    // 波 4 起：+ tq_skill_manage = 8。
    expect(registeredTools.length).toBe(8)
    expect(h.routes).toHaveLength(7)
  })
})
