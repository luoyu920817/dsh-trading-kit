/**
 * 阶段 1 骨架契约：插件名与装配面。
 * 零 mock 纪律（沿 dsh-trading test:audit 精神）：直测真实导出，不打桩。
 */
import { describe, expect, it } from 'vitest'
import { apply, name } from '../src/index.ts'

describe('dsh-trader-kit 阶段 1 骨架', () => {
  it('导出 cordis 插件名，与包名 / patch 行一致', () => {
    expect(name).toBe('dsh-trader-kit')
  })

  it('apply 是函数且不抛错（阶段 1 无操作接线点）', () => {
    expect(typeof apply).toBe('function')
    expect(() => apply({} as never)).not.toThrow()
  })
})
