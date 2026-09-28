/**
 * B1 有界回溯单测（change 4 review-page tasks 5.3/5.4/5.5；契约 §12.5/§12.8，design D-8）。
 *
 * 被测 = src/review/enrich.ts 的 `runLimitReasonBacktrack`（已完成的实现，本文件
 * 只补测试面）：具名可注入 seam（`LimitDayFetcher` + 计时注入）驱动，零 mock 库、
 * 零 sleep、零真实网络——桩响应序列为普通对象/函数注入。
 *
 * 口径（spec「B1 有界回溯的量化边界」）：
 * - 第 k+1 次请求日 = 第 k 次响应 `tradeDate`（源业务日，非 null）的前一自然日；
 *   `tradeDate === null` → 以该次**请求日**的前一自然日继续推进（计入 N）。
 * - 响应业务日（非 null）即该次实际评估的交易日，纳入命中判定与推进基准——
 *   MUST NOT 出现「请求日 A、响应业务日 B<A、然后从 A 前推」的路径。
 * - `available=false` + `errors` 含 `dateUnavailable` → 数据不可得（不计 noRecord），
 *   继续推进；`available=false` 且无错误 → 权威无记录（终态 noRecord）。
 * - 上限 N=6（可配置不超 6）、命中即停、同一业务日不重复请求、abort 即停。
 */
import { describe, expect, it } from 'vitest'
import {
  BacktrackAbortedError,
  BACKTRACK_LIMIT_DEFAULT,
  BACKTRACK_LIMIT_MAX,
  backtrackText,
  prevNaturalDay,
  runLimitReasonBacktrack,
  toCanonicalDateParam,
  type LimitDayFetcher,
  type LimitDayResponse,
} from '../src/review/enrich.ts'

/** 响应构造器（available=false + 无错误 = 权威「该日无涨停记录」）。 */
function noRecord(bizDate: string | null, opts: { errors?: string[] } = {}): LimitDayResponse {
  return { available: false, tradeDate: bizDate, errors: opts.errors ?? [], guard: null, cause: { value: null } }
}

function hit(bizDate: string, cause = '一字板（订单能见度）'): LimitDayResponse {
  return { available: true, tradeDate: bizDate, errors: [], guard: null, cause: { value: cause } }
}

interface Harness {
  results: Array<{ requested: string; response: LimitDayResponse }>
  calls: string[]
}

/** 按请求日序列出响应（记录调用序，供推进断言）；序列耗尽后回退 clean noRecord(biz=请求日)。 */
function scriptedFetcher(script: Record<string, LimitDayResponse>): LimitDayFetcher & { calls: string[] } {
  const calls: string[] = []
  const fn = (input: { code: string; date: string }): Promise<LimitDayResponse> => {
    calls.push(input.date)
    const response = script[input.date] ?? noRecord(input.date)
    return Promise.resolve(response)
  }
  return Object.assign(fn, { calls })
}

const CODE = '600000'

describe('tasks 5.3：四类桩（rateLimited / sourceError / 源业务日≠请求日 / dateUnavailable）', () => {
  it('① 预算耗尽（guard budgetExhausted）→ rateLimited 文案「频控受限」', async () => {
    const fetchDay = scriptedFetcher({
      '2026-09-24': { available: false, tradeDate: '2026-09-24', errors: [], guard: { reason: 'budgetExhausted', limit: 200, used: 200 }, cause: null },
    })
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability).toEqual({ available: false, reason: 'rateLimited' })
    expect(r.text).toBe('近期涨停记录不可得（频控受限）')
    expect(r.detail).toContain('budgetExhausted')
    expect(r.detail).toContain('limit=200')
    expect(fetchDay.calls).toEqual(['2026-09-24']) // 护栏拒绝为即时终态：仅 1 次请求
    expect(r.text).not.toContain('未找到涨停记录')
  })

  it('② 数据模块返回显式错误（任何错误码）→ sourceError 文案含错误码；intervalLimited 归 rateLimited', async () => {
    const fetchDay = scriptedFetcher({
      '2026-09-24': { available: false, tradeDate: '2026-09-24', errors: ['GUARD_SESSION_OFF'], guard: null, cause: null },
    })
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability).toEqual({ available: false, reason: 'sourceError' })
    expect(r.text).toBe('近期涨停记录不可得（数据源错误 GUARD_SESSION_OFF）')
    // 其余护栏拒绝（非预算/间隔类）同样透传错误码到 sourceError（tasks 5.6：不发明状态名）。
    const guarded = scriptedFetcher({
      '2026-09-24': { available: false, tradeDate: '2026-09-24', errors: [], guard: { reason: 'fullMarketGuard', limit: 20, used: 25 }, cause: null },
    })
    const r2 = await runLimitReasonBacktrack({ fetchDay: guarded }, { code: CODE, startDay: '2026-09-24' })
    expect(r2.availability.reason).toBe('sourceError')
    expect(r2.text).toContain('fullMarketGuard')
    // 间隔类护栏 = rateLimited。
    const interval = scriptedFetcher({
      '2026-09-24': { available: false, tradeDate: '2026-09-24', errors: [], guard: { reason: 'intervalLimited', limit: 1, used: 1 }, cause: null },
    })
    const r3 = await runLimitReasonBacktrack({ fetchDay: interval }, { code: CODE, startDay: '2026-09-24' })
    expect(r3.availability.reason).toBe('rateLimited')
  })

  it('③ businessDate ≠ requestedDate：以源业务日归属展示、以其纳入命中判定、seam 仍按 requestedDate 调用（缓存键 = source + requestedDate）', async () => {
    // 请求日 2026-09-27（周日），源在历史端点命中 2026-09-25（周五）。
    const fetchDay = scriptedFetcher({ '2026-09-27': hit('2026-09-25') })
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-27' })
    expect(r.availability).toEqual({ available: true })
    expect(r.businessDate).toBe('2026-09-25') // 以源业务日归属
    expect(r.text).toContain('按源业务日 2026-09-25')
    expect(r.text).toContain('一字板')
    expect(r.requestedDates).toEqual(['2026-09-27']) // seam 收到请求日（缓存桶键），非业务日
    expect(fetchDay.calls).toEqual(['2026-09-27'])
    // 无记录类响应同样以其业务日为下一次推进基准（§12.5）。
    const advance = scriptedFetcher({ '2026-09-27': noRecord('2026-09-25') })
    const r2 = await runLimitReasonBacktrack({ fetchDay: advance, limit: 2 }, { code: CODE, startDay: '2026-09-27' })
    expect(advance.calls).toEqual(['2026-09-27', '2026-09-24']) // 从 B=09-25 前推 → 09-24，不从请求日 09-27 前推
    expect(r2.requestedDates).toEqual(['2026-09-27', '2026-09-24'])
  })

  it('④ errors 含 dateUnavailable（含 businessDate=null）→ 记「数据不可得」继续推进、不计无记录', async () => {
    const fetchDay = scriptedFetcher({
      '2026-09-27': noRecord('2026-09-25', { errors: ['dateUnavailable'] }), // 请求日恰为非交易日（周日）
      '2026-09-24': noRecord(null, { errors: ['dateUnavailable'] }), // 响应体确无日期（null 亦判数据不可得，§12.8）
      '2026-09-23': noRecord('2026-09-23'), // 权威无记录（非 null 业务日且无错误）→ 终态 noRecord
    })
    const r = await runLimitReasonBacktrack({ fetchDay, limit: 3 }, { code: CODE, startDay: '2026-09-27' })
    // 前 2 次为「数据不可得」（§12.8：不计为未找到涨停记录），第 3 次权威无记录 → noRecord 终态。
    expect(r.availability).toEqual({ available: false, reason: 'noRecord' })
    expect(r.unavailableDates).toEqual(['2026-09-27', '2026-09-24'])
    // 09-27 响应回带业务日 09-25 → 下一请求 09-24；09-24 响应 null → 以请求日 09-24 前推 → 09-23。
    expect(fetchDay.calls).toEqual(['2026-09-27', '2026-09-24', '2026-09-23'])
  })
})

describe('tasks 5.4：当日命中 / 历史命中 / 达上限 noRecord / 源不可用降级 / 全部数据不可得', () => {
  it('当日命中即停：后续业务日零请求', async () => {
    const fetchDay = scriptedFetcher({ '2026-09-24': hit('2026-09-24') })
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability.available).toBe(true)
    expect(r.businessDate).toBe('2026-09-24')
    expect(r.cause).toBe('一字板（订单能见度）')
    expect(fetchDay.calls).toEqual(['2026-09-24']) // 命中即停，请求数 1
  })

  it('历史命中：第 3 次命中后停止（请求数 3）', async () => {
    const fetchDay = scriptedFetcher({
      '2026-09-24': noRecord('2026-09-24'),
      '2026-09-23': noRecord('2026-09-23'),
      '2026-09-22': hit('2026-09-22', '二连板（题材发酵）'),
    })
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability.available).toBe(true)
    expect(r.businessDate).toBe('2026-09-22')
    expect(fetchDay.calls).toEqual(['2026-09-24', '2026-09-23', '2026-09-22'])
    expect(fetchDay.calls.length).toBe(3)
  })

  it('达上限未命中（6 次权威无记录）→ noRecord 终态，文案 N=实际配置值，请求数=6', async () => {
    const fetchDay = scriptedFetcher({}) // 缺省 = clean noRecord(biz=请求日)
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability).toEqual({ available: false, reason: 'noRecord' })
    expect(r.text).toBe('近 6 次查询内未找到涨停记录')
    expect(fetchDay.calls).toHaveLength(6)
    expect(r.requestedDates).toHaveLength(6)
    expect(r.unavailableDates).toEqual([])
  })

  it('N 次全部数据不可得 → dateUnavailable 终态，正文 MUST NOT 写「未找到涨停记录」', async () => {
    const fetchDay: LimitDayFetcher = (input) => {
      void input
      return Promise.resolve(noRecord(null, { errors: ['dateUnavailable'] }))
    }
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability).toEqual({ available: false, reason: 'dateUnavailable' })
    expect(r.text).toBe('近 6 次查询内未取得可用数据（数据不可得）')
    expect(r.text).not.toContain('未找到涨停记录')
    expect(r.unavailableDates).toHaveLength(6)
    expect(r.detail).toContain('unavailableDates')
  })

  it('配置上限 clamp：limit=3 → 3 次封顶；limit=99 → 硬上限 6；缺省 6', async () => {
    const a = scriptedFetcher({})
    const ra = await runLimitReasonBacktrack({ fetchDay: a, limit: 3 }, { code: CODE, startDay: '2026-09-24' })
    expect(ra.text).toBe('近 3 次查询内未找到涨停记录')
    expect(a.calls).toHaveLength(3)
    const b = scriptedFetcher({})
    const rb = await runLimitReasonBacktrack({ fetchDay: b, limit: 99 }, { code: CODE, startDay: '2026-09-24' })
    expect(rb.text).toBe('近 6 次查询内未找到涨停记录')
    expect(b.calls).toHaveLength(BACKTRACK_LIMIT_MAX)
    expect(BACKTRACK_LIMIT_DEFAULT).toBe(6)
  })

  it('传输级失败（seam reject）→ sourceError 即时终态，不再续发', async () => {
    let calls = 0
    const fetchDay: LimitDayFetcher = () => {
      calls += 1
      return Promise.reject(new Error('S7 不可达'))
    }
    const r = await runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24' })
    expect(r.availability).toEqual({ available: false, reason: 'sourceError' })
    expect(r.detail).toContain('S7 不可达')
    expect(calls).toBe(1)
  })

  it('单请求超时（计时注入同步触发）→ 该次降级为数据不可得并继续推进（记录 unavailableDates）', async () => {
    const fetchDay = scriptedFetcher({})
    const cancelled: number[] = []
    const schedule = (_ms: number, fn: () => void): unknown => {
      fn() // 同步超时：每次 T1 调用都被计时器抢先结算
      return 0
    }
    const cancel = (handle: unknown): void => {
      cancelled.push(handle as number)
    }
    const r = await runLimitReasonBacktrack(
      { fetchDay, limit: 3, scheduleTimeout: schedule, cancelTimeout: cancel },
      { code: CODE, startDay: '2026-09-24' },
    )
    // 每次调用都被超时降级为「数据不可得」→ 以请求日前推继续，不命中；终态 dateUnavailable。
    expect(r.availability).toEqual({ available: false, reason: 'dateUnavailable' })
    expect(r.unavailableDates).toEqual(['2026-09-24', '2026-09-23', '2026-09-22'])
    expect(fetchDay.calls).toEqual(['2026-09-24', '2026-09-23', '2026-09-22'])
    expect(cancelled.length).toBeGreaterThan(0) // 未结算分支清理计时器（MUST NOT 泄漏）
  })
})

describe('tasks 5.5：回溯推进算法（R3-Issue 29；响应业务日前推 / null / 不漏检）', () => {
  it('跨周末：响应业务日 2026-09-28（周一）→ 下一请求日 = 2026-09-27（前一自然日，不跳周末）', async () => {
    const fetchDay = scriptedFetcher({ '2026-09-28': noRecord('2026-09-28') })
    await runLimitReasonBacktrack({ fetchDay, limit: 2 }, { code: CODE, startDay: '2026-09-28' })
    expect(fetchDay.calls).toEqual(['2026-09-28', '2026-09-27']) // 自然日前推，MUST NOT 自行枚举交易日
  })

  it('回带上一交易日不漏检：A=2026-09-27、B=2026-09-25 → 下一请求 2026-09-24（从 B 前推），B 纳入评估记录', async () => {
    const fetchDay = scriptedFetcher({ '2026-09-27': noRecord('2026-09-25') })
    const r = await runLimitReasonBacktrack({ fetchDay, limit: 3 }, { code: CODE, startDay: '2026-09-27' })
    expect(fetchDay.calls).toEqual(['2026-09-27', '2026-09-24', '2026-09-23'])
    expect(r.requestedDates).toEqual(['2026-09-27', '2026-09-24', '2026-09-23'])
    expect(r.requestedDates).not.toContain('2026-09-26') // 不存在「从请求日 A=09-27 前推到 09-26」的路径
  })

  it('businessDate=null → 以该次请求日前一自然日推进（计入 N），不抛错不静默停摆', async () => {
    const fetchDay = scriptedFetcher({ '2026-09-24': noRecord(null), '2026-09-23': noRecord('2026-09-23') })
    const r = await runLimitReasonBacktrack({ fetchDay, limit: 3 }, { code: CODE, startDay: '2026-09-24' })
    expect(fetchDay.calls).toEqual(['2026-09-24', '2026-09-23', '2026-09-22'])
    expect(r.unavailableDates).toEqual(['2026-09-24']) // null 响应记为该日数据不可得
    // 第 2 次权威无记录 → noRecord 终态（期间 dateUnavailable 不改变该终态）。
    expect(r.availability).toEqual({ available: false, reason: 'noRecord' })
  })

  it('同一业务日不重复请求：推进环收敛即停（评估集 = 已请求日 ∪ 已评估业务日）', async () => {
    // 回带业务日与下一请求日重合（如 biz=09-23，下一次请求亦为 09-23 之后的序列回环）：
    // 构造恒回带 2026-09-23 的响应——从 09-24 出发：biz=09-23 → 下请求 09-22；仍回带 09-23（已评估）→ 收敛。
    const fetchDay = scriptedFetcher({ '2026-09-24': noRecord('2026-09-23'), '2026-09-22': noRecord('2026-09-23') })
    const r = await runLimitReasonBacktrack({ fetchDay, limit: 6 }, { code: CODE, startDay: '2026-09-24' })
    expect(fetchDay.calls).toEqual(['2026-09-24', '2026-09-22']) // 09-23 已在评估集，不再请求
    expect(r.availability).toEqual({ available: false, reason: 'noRecord' })
  })

  it('prevNaturalDay 边界：月初/闰年/跨年；非法入参显式抛错（折算入口经 date.ts 校验）', () => {
    expect(prevNaturalDay('2026-09-01')).toBe('2026-08-31')
    expect(prevNaturalDay('2026-03-01')).toBe('2026-02-28') // 2026 非闰年
    expect(prevNaturalDay('2024-03-01')).toBe('2024-02-29') // 闰年
    expect(prevNaturalDay('2026-01-01')).toBe('2025-12-31') // 跨年
    expect(() => prevNaturalDay('2026-02-30')).toThrowError()
    expect(() => prevNaturalDay('20260924')).toThrowError()
  })

  it('非法起点业务日显式抛错（起点 MUST 来自 resolveTradeDate，不自行推断）', async () => {
    const fetchDay = scriptedFetcher({})
    await expect(runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '20260924' })).rejects.toThrowError(/起点/)
    expect(fetchDay.calls).toEqual([])
  })

  it('abort：已中止信号 → 首请求前抛 BacktrackAbortedError；中途中止 → 不再续发', async () => {
    const fetchDay = scriptedFetcher({ '2026-09-24': noRecord('2026-09-24') })
    await expect(
      runLimitReasonBacktrack({ fetchDay }, { code: CODE, startDay: '2026-09-24', signal: { aborted: true, addEventListener: () => {} } }),
    ).rejects.toBeInstanceOf(BacktrackAbortedError)
    expect(fetchDay.calls).toEqual([])

    // 中途中止：第 1 响应到达后置 aborted → 第 2 次请求前结算为 aborted。
    const mid = scriptedFetcher({ '2026-09-24': noRecord('2026-09-24'), '2026-09-23': hit('2026-09-23') })
    let aborted = false
    const listeners: Array<() => void> = []
    const signal = {
      get aborted(): boolean {
        return aborted
      },
      addEventListener(_t: 'abort', l: () => void): void {
        listeners.push(l)
      },
    }
    const wrapped: LimitDayFetcher = async (input) => {
      const response = await mid(input)
      if (input.date === '2026-09-24') {
        aborted = true
        for (const l of listeners) l()
      }
      return response
    }
    await expect(
      runLimitReasonBacktrack({ fetchDay: wrapped }, { code: CODE, startDay: '2026-09-24', signal }),
    ).rejects.toBeInstanceOf(BacktrackAbortedError)
    expect(mid.calls).toEqual(['2026-09-24']) // abort 后不再发新请求
  })
})

describe('tasks 5.2：分档文案（backtrackText 由 availability 驱动，MUST NOT 用 0/空值冒充）', () => {
  it('五类文案逐字', () => {
    expect(backtrackText({ available: true }, 6, { businessDate: '2026-09-24', cause: '一字板' })).toBe('按源业务日 2026-09-24 · 一字板')
    expect(backtrackText({ available: false, reason: 'noRecord' }, 6)).toBe('近 6 次查询内未找到涨停记录')
    expect(backtrackText({ available: false, reason: 'dateUnavailable' }, 6)).toBe('近 6 次查询内未取得可用数据（数据不可得）')
    expect(backtrackText({ available: false, reason: 'rateLimited' }, 6)).toBe('近期涨停记录不可得（频控受限）')
    expect(backtrackText({ available: false, reason: 'sourceError' }, 6, { errorCode: 'S7_TIMEOUT' })).toBe('近期涨停记录不可得（数据源错误 S7_TIMEOUT）')
    // 文案中的 N 与实际配置一致（limit=4 → 「近 4 次」）。
    expect(backtrackText({ available: false, reason: 'noRecord' }, 4)).toContain('近 4 次')
  })

  it('入参日期归一：canonical 直通、紧凑折算经 src/data/date.ts（toCanonicalDateParam 委托）', () => {
    expect(toCanonicalDateParam('2026-09-24')).toBe('2026-09-24')
    expect(toCanonicalDateParam('20260924')).toBe('2026-09-24')
    expect(toCanonicalDateParam('2026-13-01')).toBeNull()
    expect(toCanonicalDateParam('abc')).toBeNull()
  })
})
