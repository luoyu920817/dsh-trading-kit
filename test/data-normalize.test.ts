/**
 * 规范化单测（change data-foundation tasks 3.4/3.5）。
 * 零 mock：toNumber/field 纯函数直测；渲染用真实渲染函数；缓存写用真实临时目录。
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, afterAll } from 'vitest'

import { field, toNumber, ratioToPercent, UNITS, formatZonedIso } from '../src/data/normalize.ts'
import { createDataCache, listCacheTmpFiles } from '../src/data/cache.ts'
import { toCompactDate, rateLimitDate } from '../src/data/date.ts'
import { createTempDataRoot, startDataStub, createTestDeps, s7Payload, s5HistoryPayload } from './helpers/data-stub.ts'
import { getLimitReason } from '../src/data/limit-reason.ts'
import { renderLimitReasonText } from '../src/tools/limit-reason.ts'

describe('空值守卫全表', () => {
  it('"" / "--" / "None" / null / undefined → null（MUST NOT 用 0 代替缺失）', () => {
    expect(toNumber('')).toBeNull()
    expect(toNumber('--')).toBeNull()
    expect(toNumber('None')).toBeNull()
    expect(toNumber(null)).toBeNull()
    expect(toNumber(undefined)).toBeNull()
  })

  it('数值串转换与含单位词文本 → null（中文金额文本不参与计算）', () => {
    expect(toNumber('16009.27')).toBe(16009.27)
    expect(toNumber('1,609')).toBe(1609)
    expect(toNumber(0)).toBe(0) // 数值 0 是数据，不是缺失
    expect(toNumber('1.6万亿')).toBeNull() // 含单位词 → null 且不参与计算（Open Questions 第 7 条）
    expect(toNumber('3.5亿')).toBeNull()
    expect(toNumber('12%')).toBeNull()
    expect(toNumber('abc')).toBeNull()
    expect(toNumber(NaN)).toBeNull()
  })

  it('比例换算 0.05→5（浮点噪声消除 0.062→6.2）', () => {
    expect(ratioToPercent(0.05)).toBe(5)
    expect(ratioToPercent(0.062)).toBe(6.2)
    expect(ratioToPercent(-0.01)).toBe(-1)
  })

  it('单位常量先建不验收（T1/T2 无金额字段，本用例仅断言导出存在）', () => {
    // data-tool-contract「本 change 无金额字段」：单位 Requirement 不验收，MUST NOT skip 掩盖。
    expect(UNITS.amount).toBe('万元')
    expect(UNITS.marketCap).toBe('亿元')
  })
})

describe('字段缺失仍带 source/fetchedAt', () => {
  it('field(null, source, fetchedAt) 信封完整（字段缺失口径）', () => {
    const t = formatZonedIso(new Date('2026-09-27T02:00:00Z'))
    const missing = field(null, 'S7', t)
    expect(missing).toEqual({ value: null, source: 'S7', fetchedAt: t })
    const alsoMissing = field(undefined, 'S5', t)
    expect(alsoMissing.value).toBeNull()
    expect(alsoMissing.source).toBe('S5')
    expect(alsoMissing.fetchedAt).toBe(t)
    const present = field('原因', 'S7', t)
    expect(present.value).toBe('原因')
  })
})

describe('不可用态不被渲染成零值（渲染层 stub 断言）', () => {
  it('主备均失败渲染出「数据不可用 + 原因」，不出现 0/--/空白冒充数据', async () => {
    const stub = await startDataStub()
    const { dataRoot, cleanup } = await createTempDataRoot()
    const deps = createTestDeps({ dataRoot, stub, configOverrides: { sources: { s7: { retries: 0 }, s5: { retries: 0 } } } })
    stub.setResponder(() => ({ status: 500, text: 'server down' }))
    try {
      const result = await getLimitReason(deps, { code: '600000' })
      expect(result.available).toBe(false)
      expect(result.errors).toContain('sourceUnavailable')
      const text = renderLimitReasonText(result)
      expect(text).toContain('数据不可用')
      expect(text).toContain('sourceUnavailable')
      expect(text).not.toMatch(/cause=0(\D|$)/)
      expect(text).not.toMatch(/openCount=0(\D|$)/)
      expect(text).not.toMatch(/cause=--/)
      expect(text.trim().length).toBeGreaterThan(0)
    } finally {
      await stub.close()
      await cleanup()
    }
  })
})

const inPlaceRoot = await createTempDataRoot()
afterAll(() => inPlaceRoot.cleanup())

describe('原位刷新不追加（断言目录内文件数不变）', () => {
  const { dataRoot, cleanup } = inPlaceRoot
  void cleanup
  const cache = createDataCache(dataRoot)
  const todayBucket = (): string => toCompactDate(rateLimitDate())

  it('同键重复写保持单文件（原位覆盖）', async () => {
    const t = formatZonedIso(new Date())
    await cache.writeList('m', 'm@1', 'S7', rateLimitDate(), { businessDate: null, hitEndpoint: 'x', fetchedAt: t, payload: { n: 1 } })
    const files1 = (await readdir(join(dataRoot, 'agent/DB/temp/dsh-trader-kit', todayBucket())))
      .filter((f) => f.startsWith('m__'))
    expect(files1.length).toBe(1)
    await cache.writeList('m', 'm@1', 'S7', rateLimitDate(), { businessDate: null, hitEndpoint: 'x', fetchedAt: t, payload: { n: 2 } })
    const files2 = (await readdir(join(dataRoot, 'agent/DB/temp/dsh-trader-kit', todayBucket())))
      .filter((f) => f.startsWith('m__'))
    expect(files2.length).toBe(1)
    expect(await listCacheTmpFiles(dataRoot, rateLimitDate())).toEqual([])
    // 第二次写让位给同 fetchedAt 的既有条目（写前 re-read），payload 仍为首次内容。
    const reread = await cache.readList<{ n: number }>('m', 'm@1', 'S7', rateLimitDate())
    expect(reread?.payload.n).toBe(1)
  })
})

// 引用占位：确保 s7/s5 工厂在本文件可独立失败（直接调用一次最小组装）。
describe('响应工厂与限流日联动（防呆）', () => {
  it('s7Payload/s5HistoryPayload 形状稳定', async () => {
    const stub = await startDataStub()
    const { dataRoot, cleanup } = await createTempDataRoot()
    const deps = createTestDeps({ dataRoot, stub })
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload(null, {}) }
      if (req.path.includes('surgeLimitHistory')) return { json: s7Payload(null, {}) }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    try {
      const result = await getLimitReason(deps, { code: '600000' })
      // 两源均无数据 → dateUnavailable（而非取数失败）。
      expect(result.available).toBe(false)
      expect(result.errors[0]).toBe('dateUnavailable')
    } finally {
      await stub.close()
      await cleanup()
    }
  })
})
