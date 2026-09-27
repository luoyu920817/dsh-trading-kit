/**
 * 探针 handler 单测（tasks 1.4/1.5/1.6/1.7/1.9；design D-10）：
 * createProbeHandler 纯工厂 + IncomingMessage/ServerResponse 形状桩（零 mock 库、
 * 零出站调用）。覆盖：401/403 拒绝码、B 层 token 缺失/错误/正确、注入转义、
 * 方法不匹配、no-store 头、A 层优先顺序、C 层默认关闭与分支接线。
 */
import { describe, expect, it } from 'vitest'
import { createProbeHandler, injectProbeState, type ProbeHandlerDeps, type ProbeState } from '../../src/routes/probe.ts'
import { PROBE_STATE_PLACEHOLDER } from '../../src/client/probe/index.html.ts'
import { injectedState, makeDeps, makeReq, makeRes, PROBE_PAGE_MARKER, UNAUTHENTICATED_READONLY_DEFAULT } from './helpers.ts'

function run(deps: ProbeHandlerDeps, req: ReturnType<typeof makeReq>) {
  const { res, rec } = makeRes()
  createProbeHandler(deps)(req, res)
  return rec
}

describe('A 层（宿主 cookie，首选）', () => {
  it('requestRejection 放行 + GET → 200 text/html + no-store，注入 auth=cookie', () => {
    const rec = run(makeDeps(), makeReq())
    expect(rec.status).toBe(200)
    expect(rec.ended).toBe(true)
    expect(rec.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(rec.headers['Cache-Control']).toBe('no-store')
    expect(rec.body).toContain(PROBE_PAGE_MARKER)
    const state = injectedState(rec.body)
    expect(state.auth).toBe('cookie')
    expect(state.status).toBe(200)
    expect(state.port).toBe(41000)
    expect(state.basePath).toBe('/dsh-trader-kit')
    expect(() => new Date(state.injectedAt).toISOString()).not.toThrow()
  })

  it('A→B 顺序：cookie 有效时同请求即使带 B 层 ?token= 也记 cookie', () => {
    const rec = run(makeDeps(), makeReq({ url: '/dsh-trader-kit/probe?token=tok-diag-aabbcc' }))
    expect(rec.status).toBe(200)
    expect(injectedState(rec.body).auth).toBe('cookie')
  })
})

describe('401/403 拒绝（插件 handler 自产；页面不渲染、不注入）', () => {
  it('无 cookie（rejection=401）→ 401 + no-store，正文为空、无探针页标记', () => {
    const rec = run(makeDeps({ requestRejection: () => 401 }), makeReq())
    expect(rec.status).toBe(401)
    expect(rec.headers['Cache-Control']).toBe('no-store')
    expect(rec.body).toBe('')
    expect(rec.ended).toBe(true)
    expect(rec.body).not.toContain(PROBE_PAGE_MARKER)
  })

  it('栅栏不过（rejection=403）→ 403 + no-store，正文为空', () => {
    const rec = run(makeDeps({ requestRejection: () => 403 }), makeReq())
    expect(rec.status).toBe(403)
    expect(rec.headers['Cache-Control']).toBe('no-store')
    expect(rec.body).toBe('')
  })

  it('负向事实（spec）：仅带 ?token= 直连（宿主 token 形态）→ 401，不被消费', () => {
    const deps = makeDeps({ requestRejection: () => 401 })
    for (const url of ['/dsh-trader-kit/probe?token=any-host-launch-token', '/dsh-trader-kit/probe?token=', '/dsh-trader-kit/probe?Token=tok-diag-aabbcc', '/dsh-trader-kit/probe']) {
      const rec = run(deps, makeReq({ url }))
      expect(rec.status).toBe(401)
      expect(rec.body).toBe('')
    }
  })
})

describe('B 层（插件自有诊断 token）', () => {
  it('token 正确 → 200 + auth=diagnostic-token（与 A 层 cookie 可区分）', () => {
    const rec = run(makeDeps({ requestRejection: () => 401 }), makeReq({ url: '/dsh-trader-kit/probe?token=tok-diag-aabbcc' }))
    expect(rec.status).toBe(200)
    expect(rec.headers['Cache-Control']).toBe('no-store')
    const state = injectedState(rec.body)
    expect(state.auth).toBe('diagnostic-token')
    expect(state.status).toBe(200)
  })

  it('token 错误 / 缺失 → 401（rejection 为 401 前提下）', () => {
    const deps = makeDeps({ requestRejection: () => 401 })
    for (const url of ['/dsh-trader-kit/probe?token=wrong', '/dsh-trader-kit/probe', '/dsh-trader-kit/probe?other=1']) {
      expect(run(deps, makeReq({ url })).status).toBe(401)
    }
  })

  it('栅栏（403）不被 B 层 token 救援：栅栏是跨站防御，不是认证（D-3）', () => {
    const rec = run(makeDeps({ requestRejection: () => 403 }), makeReq({ url: '/dsh-trader-kit/probe?token=tok-diag-aabbcc' }))
    expect(rec.status).toBe(403)
    expect(rec.body).toBe('')
  })
})

describe('C 层（代码常量开关，默认关闭）', () => {
  it('生产常量 UNAUTHENTICATED_READONLY_DEFAULT=false：未认证仍 401', () => {
    expect(UNAUTHENTICATED_READONLY_DEFAULT).toBe(false)
    const rec = run(makeDeps({ requestRejection: () => 401, unauthenticatedReadonly: UNAUTHENTICATED_READONLY_DEFAULT }), makeReq())
    expect(rec.status).toBe(401)
    expect(rec.body).toBe('')
  })

  it('常量置 true（签字后）的分支接线：401 → 200 + auth=none', () => {
    const rec = run(makeDeps({ requestRejection: () => 401, unauthenticatedReadonly: true }), makeReq())
    expect(rec.status).toBe(200)
    expect(injectedState(rec.body).auth).toBe('none')
  })
})

describe('方法不匹配', () => {
  it('非 GET（POST/HEAD/undefined method）→ 405 + Allow: GET + no-store，正文为空', () => {
    for (const method of ['POST', 'HEAD', 'DELETE']) {
      const rec = run(makeDeps(), makeReq({ method }))
      expect(rec.status).toBe(405)
      expect(rec.headers['Allow']).toBe('GET')
      expect(rec.headers['Cache-Control']).toBe('no-store')
      expect(rec.body).toBe('')
    }
  })

  it('先认证后方法：无 cookie 的 POST → 401（不向无凭据方暴露方法语义）', () => {
    const rec = run(makeDeps({ requestRejection: () => 401 }), makeReq({ method: 'POST' }))
    expect(rec.status).toBe(401)
  })
})

describe('注入转义（tasks 1.4：构造含 </script> 的取值不得逃逸）', () => {
  it('basePath 含 </script> / & / U+2028 / U+2029 / $&：全部转义，script 闭合数不增，JSON 可回读', () => {
    const hostileBasePath = '/kit</script><b>x</b>&flag' + '\u2028' + '\u2029' + '$&'
    const rec = run(makeDeps({ basePath: hostileBasePath }), makeReq())
    expect(rec.status).toBe(200)
    // 模板本有 2 个 script 闭合标签；注入值不得新增（</script> 未逃逸）
    expect(rec.body.match(/<\/script>/g)).toHaveLength(2)
    // 转义形态在场
    expect(rec.body).toContain('\\u003C/script>')
    expect(rec.body).toContain('\\u0026')
    expect(rec.body).toContain('\\u2028')
    expect(rec.body).toContain('\\u2029')
    // split/join 语义：替换串含 $ 类序列时不被展开——`$&` 中 & 照常转义为 \u0026，$ 原样保留
    expect(rec.body).toContain('$\\u0026')
    expect(rec.body).not.toContain('$&')
    const state = injectedState(rec.body)
    expect(state.basePath).toBe(hostileBasePath)
  })

  it('injectProbeState 为占位符全量替换（多占位符模板亦全部替换）', () => {
    const state: ProbeState = { auth: 'none', status: 200, port: 1, basePath: '/b', injectedAt: '2026-09-27T00:00:00.000Z' }
    expect(injectProbeState('a' + PROBE_STATE_PLACEHOLDER + 'b' + PROBE_STATE_PLACEHOLDER + 'c', state)).toBe('a' + JSON.stringify(state) + 'b' + JSON.stringify(state) + 'c')
  })
})
