/**
 * 配置面单测（change data-foundation tasks 1.1/1.5）。
 * 零 mock：schemastery 真实解析；挂载用真实 fake context（记录调用对象）。
 */
import { describe, expect, it } from 'vitest'
import { Config, resolveTraderKitConfig, type ResolvedTraderKitConfig, S7_SIGN_DEFAULT, S7_TS_DEFAULT } from '../src/config.ts'
import { apply } from '../src/index.ts'
import { resolveArea } from '../src/paths/resolve.ts'

/** 与 smoke 同款最小 fake context（真实对象记录调用）。 */
function createFakeContext() {
  const registeredTools: string[] = []
  const provided: Record<string, unknown> = {}
  const ctx = {
    webServer: { register: () => () => {}, port: 41000, host: '127.0.0.1' },
    connection: {
      requestRejection: () => 401 as const,
      authenticatedUrl: (u: string) => `${u}?token=stub`,
    },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    tools: { register: (tool: { name: string }) => { registeredTools.push(tool.name); return () => {} } },
    // provide 同时挂到 ctx 上（镜像真实 cordis 行为；后续装配线依赖 ctx.traderKit 可见）。
    provide: (key: string, api: unknown) => {
      provided[key] = api
      ;(ctx as unknown as Record<string, unknown>)[key] = api
    },
    effect: (body: () => unknown) => { body(); return () => {} },
  }
  return { ctx, registeredTools, provided }
}

describe('Config 默认值填充', () => {
  it('空配置解析出全部默认值（dataRoot 空串、guard 经验值、S7 签名现值）', () => {
    const resolved = resolveTraderKitConfig()
    expect(resolved.dataRoot).toBe('')
    expect(resolved.guard).toEqual({
      maxConcurrency: 2,
      minIntervalMs: 1000,
      maxBatch: 20,
      dailyBudget: 200,
      fullMarketGuard: true,
      sessionOverride: 'auto',
    })
    expect(resolved.sources.s7.sign).toBe(S7_SIGN_DEFAULT)
    expect(resolved.sources.s7.ts).toBe(S7_TS_DEFAULT)
    expect(resolved.sources.s7.retries).toBe(2)
    expect(resolved.sources.s5.timeoutMs).toBe(10_000)
    expect(resolved.diagnostics.probe.enabled).toBe(true)
    expect(resolved.diagnostics.probe.targets).toEqual(['s7', 's5', 's8', 'tdx17709'])
  })

  it('tdx17709.enabled 默认值断言为 true（owner 裁决 2026-09-27：默认开）', () => {
    const resolved = resolveTraderKitConfig()
    expect(resolved.diagnostics.tdx17709.enabled).toBe(true)
  })

  it('显式配置覆盖默认值且不回填未知形状', () => {
    const resolved = resolveTraderKitConfig({
      dataRoot: 'X:/data',
      guard: { dailyBudget: 50 },
    })
    expect(resolved.dataRoot).toBe('X:/data')
    expect(resolved.guard.dailyBudget).toBe(50)
    expect(resolved.guard.minIntervalMs).toBe(1000) // 未覆盖字段仍取默认
  })
})

describe('非法值拒绝', () => {
  it('非法 guard 值被拒绝', () => {
    expect(() => resolveTraderKitConfig({ guard: { maxConcurrency: 0 } })).toThrow()
    expect(() => resolveTraderKitConfig({ guard: { minIntervalMs: -1 } })).toThrow()
    expect(() => resolveTraderKitConfig({ guard: { sessionOverride: 'always' as never } })).toThrow()
  })

  it('sources 非法值被 schema 拒绝（重试至多 2、超时下限 1s）', () => {
    expect(() => resolveTraderKitConfig({ sources: { s7: { retries: 3 } } })).toThrow()
    expect(() => resolveTraderKitConfig({ sources: { s8: { timeoutMs: 100 } } })).toThrow()
  })

  it('diagnostics 非法值被 schema 拒绝（未知探测目标）', () => {
    expect(() => resolveTraderKitConfig({ diagnostics: { probe: { targets: ['s7', 'nope' as never] } } })).toThrow()
  })
})

describe('未配置 dataRoot → 挂载成功且写入报错', () => {
  it('空 dataRoot 挂载成功（工具注册 + service 提供），写入解析显式报错', () => {
    const { ctx, registeredTools } = createFakeContext()
    // 测试零真实出站：probe 显式关闭（生产默认开，owner 裁决 2026-09-27）。
    expect(() => apply(ctx as never, { dataRoot: '', diagnostics: { probe: { enabled: false } } })).not.toThrow()
    // 波 4 起：数据面 3 + tq_skill_manage + 每日汇总 4 = 8（见 test/smoke.test.ts）。
    expect(registeredTools.length).toBe(8)
    expect(() => resolveArea('', 'review', { code: '600000', name: '浦发银行', date: '20260924' }, { forWrite: true }))
      .toThrow(/dataRoot/)
    // 磁盘无任何新增文件由 resolveArea 的纯解析性质保证（无 fs 调用）。
  })
})

describe('关闭 17709 探测记为未探测', () => {
  it('显式关闭后 enabled=false（健康检查消费该值时该项记「未探测」——状态语义随 tasks 7.1 落地）', () => {
    const resolved = resolveTraderKitConfig({ diagnostics: { tdx17709: { enabled: false } } })
    expect(resolved.diagnostics.tdx17709.enabled).toBe(false)
    // Loader 同源：schema 直调（无参）同样得到默认 true（schema 填默认后即完整形状）。
    expect((Config(null) as ResolvedTraderKitConfig).diagnostics.tdx17709.enabled).toBe(true)
  })
})
