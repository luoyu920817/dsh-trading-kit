/**
 * 跨 change 契约用例（change data-foundation tasks 5.7）：以 resolveTradeDate 的
 * 业务日驱动 T1（review-page 的 TradeDateResolver seam 消费点）。
 * 断言 resolved !== rateLimitDate()（经 src/data/date.ts 取得，MUST NOT 自行截断系统日期）且非 null。
 */
import { describe, expect, it } from 'vitest'
import { resolveTradeDate } from '../src/data/trade-date.ts'
import { getLimitReason } from '../src/data/limit-reason.ts'
import { rateLimitDate } from '../src/data/date.ts'
import { startDataStub, createTempDataRoot, createTestDeps, s7Payload, s5HistoryPayload } from './helpers/data-stub.ts'

describe('列表为空时归属交易日仍可得', () => {
  it('T0 业务日驱动 T1：resolved 非 null、!== 限流日；seam 拿到交易日驱动历史取数', async () => {
    const stub = await startDataStub()
    const root = await createTempDataRoot()
    // 当日 List 为空但响应体带业务日（盘前未出数形态）；历史 History 正常出数。
    stub.setResponder((req) => {
      if (req.path.includes('surgeLimitList')) return { json: s7Payload('2026-01-02', {}) }
      if (req.path.includes('surgeLimitHistory')) {
        // 当日 List 空的 History 回退：亦空（维持 List 空结论）；T1 的历史请求（20260102）出数。
        const compact = req.query.get('date') ?? ''
        if (compact === '20260102') {
          return { json: s7Payload('2026-01-02', { '600000': { cause: '重组', first: '0925', last: '1430', open: 1 } }) }
        }
        return { json: s7Payload('2026-01-02', {}) }
      }
      if (req.path.includes('anomaly/v1/history')) return { json: s5HistoryPayload(0, []) }
      return undefined
    })
    const deps = createTestDeps({ dataRoot: root.dataRoot, stub })
    try {
      // TradeDateResolver seam：change 4/5 MUST 调用 T0，不得自行推断。
      const resolved = await resolveTradeDate(deps, {})
      expect(resolved.businessDate).not.toBeNull()
      expect(resolved.businessDate).not.toBe(rateLimitDate())
      expect(resolved.businessDate).toBe('2026-01-02')

      // seam 的业务日驱动 T1（历史日请求 → History 端点 → 该日数据可得）。
      const t1 = await getLimitReason(deps, { code: '600000', date: resolved.businessDate ?? undefined })
      expect(t1.requestedDate).toBe(resolved.businessDate)
      expect(t1.available).toBe(true)
      expect(t1.tradeDate).toBe(resolved.businessDate)
      expect(stub.count('surgeLimitHistory')).toBe(2) // 1 = T0 当日 List 空的 History 回退；1 = T1 历史请求
      expect(stub.count('surgeLimitList')).toBe(1) // T1 走历史路由，不重复当日 List
    } finally {
      await stub.close()
      await root.cleanup()
    }
  })
})
