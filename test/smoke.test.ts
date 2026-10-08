/**
 * 阶段 1 骨架契约：插件名与装配面。
 * 零 mock 纪律（沿 dsh-trading test:audit 精神）：直测真实导出，
 * fake context 用真实对象记录调用（不用 mock 库）。
 */
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'

/** 最小 fake context：记录工具注册与 service 提供（真实对象，零 mock 库）。 */
function createFakeContext() {
  const registeredTools: string[] = []
  const provided: Record<string, unknown> = {}
  const effects: string[] = []
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
    effect: (body: () => unknown, effectName: string) => { body(); effects.push(effectName); return () => {} },
  }
  return { ctx, registeredTools, provided, effects }
}

describe('dsh-trader-kit 装配面', () => {
  it('导出 cordis 插件名，与包名 / patch 行一致', () => {
    expect(name).toBe('dsh-trader-kit')
  })

  it('注册了 4 个数据面工具（T0/T1/T2 + TQ-Local 兜底）+ 提供 traderKit service', () => {
    const { ctx, registeredTools, provided } = createFakeContext()
    // 测试零真实出站：启动探测（diagnostics.probe）在单测中显式关闭（生产默认开）。
    expect(() => apply(ctx as never, { diagnostics: { probe: { enabled: false } } })).not.toThrow()
    // review-loop 起：数据面 4（+ get_stock_basics）+ tq_skill_manage 1 + 每日汇总 4 + review-loop 2 = 11。
    expect(registeredTools.length).toBe(11)
    expect(registeredTools).toEqual([
      'get_trade_date', 'get_limit_reason', 'get_concepts', 'get_stock_basics',
      'tq_skill_manage',
      'review_daily_scan', 'review_read_daily', 'review_append_ainote', 'review_daily_report',
      'review_stock_profiles', 'review_write_brief',
    ])
    const api = provided.traderKit as { health: { status(): unknown } } | undefined
    expect(api).toBeDefined()
    // health.status() 可调用（两段视图 { data, skill }）。
    expect(typeof api?.health.status()).toBe('object')
  })

  it('inject 声明覆盖探针线（webServer/connection）与数据线（tools）', () => {
    expect(inject).toEqual(['webServer', 'connection', 'tools'])
  })
})
