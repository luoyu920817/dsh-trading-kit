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
  return {
    tools: { register: (tool: { name: string }) => { registeredTools.push(tool.name); return () => {} } },
    provide: (key: string, api: unknown) => { provided[key] = api },
    effect: (body: () => unknown, effectName: string) => { body(); effects.push(effectName); return () => {} },
    registeredTools,
    provided,
    effects,
  }
}

describe('dsh-trader-kit 装配面', () => {
  it('导出 cordis 插件名，与包名 / patch 行一致', () => {
    expect(name).toBe('dsh-trader-kit')
  })

  it('注册了 3 个数据面工具（T0/T1/T2）+ 提供 traderKit service', () => {
    const ctx = createFakeContext()
    expect(() => apply(ctx as never)).not.toThrow()
    expect(ctx.registeredTools.length).toBe(3)
    expect(ctx.registeredTools).toEqual(['get_trade_date', 'get_limit_reason', 'get_concepts'])
    const api = ctx.provided.traderKit as { health: { status(): unknown } } | undefined
    expect(api).toBeDefined()
    // 骨架阶段的 health.status() 可调用（真实探测随 tasks 7.1 落地）。
    expect(typeof api?.health.status()).toBe('object')
  })

  it('inject 声明覆盖探针线（webServer/connection）与数据线（tools）', () => {
    expect(inject).toEqual(['webServer', 'connection', 'tools'])
  })
})
