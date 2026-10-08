/**
 * 工具线的显式市场透传（owner 2026-10-08 P0）：`review_read_daily` /
 * `review_append_ainote` 在同码跨市场（sh000688 科创50 vs 000688 国城矿业）下
 * 经 market 入参或带前缀代码定位正确文档。真实 store + 真实临时目录（零 mock）。
 */
import { describe, expect, it } from 'vitest'
import { appendCard } from '../../src/review/store.ts'
import { runAppendAinote, runReadDaily } from '../../src/tools/review-daily.ts'
import { ainoteBody, makeFacades, makeTempRoot, NOW, TRADE_DATE } from './helpers.ts'

/** 同码跨市场种子：sh000688_科创50（显式市场）+ 000688_国城矿业（无前缀惯例）。 */
async function seedSameCodeDocs(root: string): Promise<{ shPath: string; szPath: string }> {
  const sh = await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: TRADE_DATE }, body: '指数卡', now: NOW, clientRequestId: 't-sh' })
  const sz = await appendCard({ loc: { dataRoot: root, code: '000688', name: '国城矿业', tradeDate: TRADE_DATE }, body: '股票卡', now: NOW, clientRequestId: 't-sz' })
  return { shPath: sh.path, szPath: sz.path }
}

describe('runReadDaily：市场透传（P0）', () => {
  it('前缀代码 sh000688 → 命中科创50文档；无前缀 → 国城矿业文档', async () => {
    const root = makeTempRoot('dtk-summary-mkt-')
    const { shPath, szPath } = await seedSameCodeDocs(root)
    const facades = makeFacades(root)

    const sh = await runReadDaily(facades, { code: 'sh000688', tradeDate: TRADE_DATE })
    expect(sh.found).toBe(true)
    expect(sh.path).toBe(shPath)

    const sz = await runReadDaily(facades, { code: '000688', tradeDate: TRADE_DATE })
    expect(sz.path).toBe(szPath)
  })

  it('market 入参与前缀代码等价；非法 market 显式报错', async () => {
    const root = makeTempRoot('dtk-summary-mkt-')
    const { shPath } = await seedSameCodeDocs(root)
    const facades = makeFacades(root)

    const byParam = await runReadDaily(facades, { code: '000688', tradeDate: TRADE_DATE, market: 'sh' })
    expect(byParam.path).toBe(shPath)

    await expect(runReadDaily(facades, { code: '000688', tradeDate: TRADE_DATE, market: 'hk' }))
      .rejects.toThrow(/非法 market/)
  })
})

describe('runAppendAinote：市场透传（P0）', () => {
  it('前缀代码 sh000688 → 附注写入科创50文档；无前缀 → 国城矿业文档（不串写）', async () => {
    const root = makeTempRoot('dtk-summary-mkt-')
    const { shPath, szPath } = await seedSameCodeDocs(root)
    const facades = makeFacades(root)

    const sh = await runAppendAinote(facades, { code: 'sh000688', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW })
    expect(sh.path).toBe(shPath)
    const sz = await runAppendAinote(facades, { code: '000688', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW })
    expect(sz.path).toBe(szPath)

    // 幂等重跑（同前缀代码）→ skipped，且仍指向同一文档。
    const again = await runAppendAinote(facades, { code: 'sh000688', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW })
    expect(again.status).toBe('skipped')
    expect(again.path).toBe(shPath)
  })
})
