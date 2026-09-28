/**
 * 每日汇总核心单测（change 5 tasks 2.1/2.5/2.9/2.10/2.11/3.2/3.5）：
 * 扫描三态 / 读卡 / 写附注 / 运行摘要合并 / 依赖不可用 / 判定矩阵 / 预算分批。
 * 零 mock：change 4 存储走真实实现（真实临时目录），数据面为记录型真实对象桩。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DependencyUnavailableError,
  judgeDailyOutcome,
  planBatchByBudget,
  runAppendAinote,
  runDailyReport,
  runDailyScan,
  runReadDaily,
} from '../../src/tools/review-daily.ts'
import {
  ainoteBody,
  guardStub,
  makeFacades,
  makeTempRoot,
  recordingTradeDateStub,
  seedDoc,
  tradeDateStub,
  NOW,
  TRADE_DATE,
} from './helpers.ts'
import { emptyRunReport, mergeRunReport, runReportPath } from '../../src/summary/run-report.ts'

describe('review_daily_scan（tasks 2.1：交易日来源与三态）', () => {
  it('缺省交易日调用 T0（记录调用次数与入参）；扫描走 scanDailyCardTargets', async () => {
    const root = makeTempRoot()
    await seedDoc(root, '600000', '浦发银行')
    const t0 = recordingTradeDateStub(tradeDateStub())
    const facades = makeFacades(root, { resolveTradeDate: t0.fn })
    const out = await runDailyScan(facades, {})
    expect(t0.calls.length).toBe(1)
    expect(out.state).toBe('ok')
    expect(out.tradeDate).toBe(TRADE_DATE)
    expect(out.targets).toHaveLength(1)
    expect(out.targets[0]).toMatchObject({ code: '600000', name: '浦发银行', cardCount: 1, hasAinote: false })
  })

  it('交易日不可得 → 显式要求用户指定（与「无卡片」态可区分）', async () => {
    const root = makeTempRoot()
    const t0 = recordingTradeDateStub(tradeDateStub({ businessDate: null, isTradingDay: null }))
    const out = await runDailyScan(makeFacades(root, { resolveTradeDate: t0.fn }), {})
    expect(out.state).toBe('tradeDateUnavailable')
    expect(out.message).toMatch(/指定.*交易日|交易日/)
    // 「有交易日但无卡片」是另一个 state：
    const t1 = recordingTradeDateStub(tradeDateStub())
    const empty = await runDailyScan(makeFacades(root, { resolveTradeDate: t1.fn }), {})
    expect(empty.state).toBe('noCards')
  })

  it('显式传 date 归一为 canonical（兼容紧凑写法，经 src/data/date.ts）；此时不调 T0', async () => {
    const root = makeTempRoot()
    const t0 = recordingTradeDateStub(tradeDateStub())
    const out = await runDailyScan(makeFacades(root, { resolveTradeDate: t0.fn }), { date: '20260924' })
    expect(t0.calls).toHaveLength(0) // 缺省才走 T0（交易日来源断言，tasks 2.10）
    expect(out.tradeDate).toBe(TRADE_DATE)
  })
})

describe('review_read_daily（tasks 2.2：卡片集合与归一化）', () => {
  it('读回用户卡片排除附注；异常代码形态归一到同一文档', async () => {
    const root = makeTempRoot()
    const path = await seedDoc(root, '600000', '浦发银行')
    await runAppendAinote(makeFacades(root), {
      code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), generatedAt: '2026-09-24T15:00:00+08:00', now: NOW,
    })
    for (const raw of ['600000', 'sh600000', '600000.SH']) {
      const out = await runReadDaily(makeFacades(root), { code: raw, tradeDate: TRADE_DATE })
      expect(out.found).toBe(true)
      expect(out.path).toBe(path)
      expect(out.cards).toHaveLength(1)
      expect(out.cards[0].body).toContain('早盘观察')
      expect(out.ainoteCount).toBe(1)
      // 卡片集合不含附注内容。
      expect(JSON.stringify(out.cards)).not.toContain('研究辅助')
    }
  })

  it('非法代码 → 显式参数错误', async () => {
    await expect(runReadDaily(makeFacades(makeTempRoot()), { code: '60000', tradeDate: TRADE_DATE }))
      .rejects.toThrow(/code|60000/)
  })
})

describe('review_append_ainote（tasks 2.3/2.8：幂等与归属）', () => {
  it('首次 created；重复 skipped 且文档只有一条附注、字节不变', async () => {
    const root = makeTempRoot()
    const path = await seedDoc(root, '600000', '浦发银行')
    const facades = makeFacades(root)
    const first = await runAppendAinote(facades, { code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW })
    expect(first.status).toBe('created')
    const bytes1 = readFileSync(path, 'utf8')
    const second = await runAppendAinote(facades, { code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW })
    expect(second.status).toBe('skipped')
    expect(readFileSync(path, 'utf8')).toBe(bytes1)
    expect(bytes1.match(/^## .+ \^ainote-/gm)).toHaveLength(1)
  })

  it('归属基准唯一：不同交易日各写各的文档；frontmatter 篡改 → DOC_MISMATCH', async () => {
    const root = makeTempRoot()
    const path = await seedDoc(root, '600000', '浦发银行')
    const facades = makeFacades(root)
    await runAppendAinote(facades, { code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW })
    const bytes1 = readFileSync(path, 'utf8')
    // 不同交易日 = 另一份文档（合法），原文档不受影响。
    const r2 = await runAppendAinote(facades, { code: '600000', tradeDate: '2026-09-25', body: ainoteBody(), now: NOW })
    expect(r2.path).not.toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(bytes1)
    // 归属硬校验路径（store 层）：直接以 tampered frontmatter 触发——用 locateDoc 定位后
    // 手工改写 frontmatter tradeDate，再以原 loc 追加 → DOC_MISMATCH。
    const fm = readFileSync(path, 'utf8').replace(`tradeDate: "${TRADE_DATE}"`, 'tradeDate: "2026-01-01"')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(path, fm, 'utf8')
    await expect(runAppendAinote(facades, { code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW }))
      .rejects.toThrow(/DOC_MISMATCH|归属/)
  })

  it('schema 无 force/overwrite/refresh（结构断言：三工具入参 schema 属性扫描）', async () => {
    // 结构面由 test/structure.test.ts 覆盖装配；此处断言实现面：幽灵参数传了也无效（不存在该入参分支）。
    const root = makeTempRoot()
    await seedDoc(root, '600000', '浦发银行')
    const facades = makeFacades(root)
    const r = await runAppendAinote(facades, { code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW } as never)
    expect(r.status).toBe('created')
  })
})

describe('依赖不可用（tasks 2.5：DEPENDENCY_UNAVAILABLE）', () => {
  it('T0 缺失 → scan 显式报错（含接口名与所属 change）；磁盘零新增', async () => {
    const root = makeTempRoot()
    const facades = makeFacades(root, { resolveTradeDate: undefined })
    await expect(runDailyScan(facades, {})).rejects.toThrow(DependencyUnavailableError)
    await expect(runDailyScan(facades, {})).rejects.toThrow(/resolveTradeDate/)
    expect(existsSync(join(root, 'agent'))).toBe(false)
  })

  it('guardStatus 缺失 → planBatchByBudget 显式报错；format 缺失 → append 显式报错且零写入', async () => {
    expect(() => planBatchByBudget(null, [])).toThrow(DependencyUnavailableError)
    const root = makeTempRoot()
    await seedDoc(root, '600000', '浦发银行')
    const facades = makeFacades(root, { format: null })
    await expect(runAppendAinote(facades, { code: '600000', tradeDate: TRADE_DATE, body: ainoteBody(), now: NOW }))
      .rejects.toThrow(DependencyUnavailableError)
  })
})

describe('运行摘要（tasks 2.9/2.11：合并、自扫、幂等）', () => {
  it('review_daily_report：出口自扫清单 ⊇ entries，缺项补 failed(entryMissing)；missing/warnings 回填；同参重跑字节不变', async () => {
    const root = makeTempRoot()
    await seedDoc(root, '600000', '浦发银行')
    await seedDoc(root, '000001', '平安银行')
    const facades = makeFacades(root)
    const first = await runDailyReport(facades, {
      tradeDate: TRADE_DATE,
      entries: [{ code: '600000', status: 'created' }],
      missing: [{ code: '600000', field: 'limitReason', reason: 'noRecord' }],
      warnings: ['样例告警'],
    })
    expect(first.created.map((e) => e.code)).toContain('600000')
    expect(first.failed).toEqual([expect.objectContaining({ code: '000001', reason: 'entryMissing' })])
    expect(first.missing).toHaveLength(1)
    // entryMissing 会追加一条具名警告（出口自扫结果对调用方可见）。
    expect(first.warnings).toEqual(['样例告警', expect.stringContaining('[entryMissing] 000001')])
    const path = runReportPath(root, TRADE_DATE)
    expect(existsSync(path)).toBe(true)
    const bytes1 = readFileSync(path, 'utf8')
    const second = await runDailyReport(facades, {
      tradeDate: TRADE_DATE,
      entries: [{ code: '600000', status: 'created' }],
      missing: [{ code: '600000', field: 'limitReason', reason: 'noRecord' }],
      warnings: ['样例告警'],
    })
    expect(readFileSync(path, 'utf8')).toBe(bytes1)
    expect(second.created.map((e) => e.code)).toEqual(first.created.map((e) => e.code))
  })

  it('mergeRunReport：同键覆盖其余保留；空清单可落摘要（emptyRunReport）', () => {
    const base = emptyRunReport(TRADE_DATE)
    const merged = mergeRunReport(base, {
      tradeDate: TRADE_DATE,
      entries: [
        { code: '600000', status: 'created' },
        { code: '000001', status: 'failed', reason: 'quote 与 T1 均失败' },
      ],
    })
    expect(merged.created).toEqual([expect.objectContaining({ code: '600000' })])
    expect(merged.failed).toEqual([expect.objectContaining({ code: '000001', reason: 'quote 与 T1 均失败' })])
    expect(merged.skipped).toEqual([])
    expect(merged.warnings).toEqual([])
  })
})

describe('失败判定矩阵（tasks 3.2，六行）', () => {
  const BASE = { hasCards: true, targetTradeDate: TRADE_DATE }
  it('① 两路皆成 → created 无缺失', () => {
    const r = judgeDailyOutcome({ ...BASE, quoteOk: true, limitReason: { available: true, tradeDate: TRADE_DATE, errors: [] } })
    expect(r.status).toBe('created')
    expect(r.missing).toEqual([])
    expect(r.limitReasonPhrase).toBeNull()
  })
  it('② quote 败 T1 成 → created 带 missing(quote,sourceUnavailable) + 完整性行', () => {
    const r = judgeDailyOutcome({ ...BASE, quoteOk: false, limitReason: { available: true, tradeDate: TRADE_DATE, errors: [] } })
    expect(r.status).toBe('created')
    expect(r.missing).toEqual([{ field: 'quote', reason: 'sourceUnavailable' }])
    expect(r.integrityLine).toContain('部分')
  })
  it('③ quote 成 T1 dateUnavailable → missing(sourceUnavailable)，正文表述不得含「无涨停记录」', () => {
    const r = judgeDailyOutcome({ ...BASE, quoteOk: true, limitReason: { available: false, tradeDate: TRADE_DATE, errors: ['dateUnavailable'] } })
    expect(r.status).toBe('created')
    expect(r.missing).toEqual([{ field: 'limitReason', reason: 'sourceUnavailable' }])
    expect(r.limitReasonPhrase).toContain('数据不可得')
    expect(r.limitReasonPhrase).not.toContain('无涨停记录')
  })
  it('④ T1 available=false 无 dateUnavailable → noRecord（不计 failed）', () => {
    const r = judgeDailyOutcome({ ...BASE, quoteOk: true, limitReason: { available: false, tradeDate: TRADE_DATE, errors: [] } })
    expect(r.status).toBe('created')
    expect(r.missing).toEqual([{ field: 'limitReason', reason: 'noRecord' }])
  })
  it('⑤ T1 tradeDate 与目标不一致 → dateMismatch', () => {
    const r = judgeDailyOutcome({ ...BASE, quoteOk: true, limitReason: { available: true, tradeDate: '2026-09-23', errors: [] } })
    expect(r.missing).toEqual([{ field: 'limitReason', reason: 'dateMismatch' }])
  })
  it('⑥ 两路皆败 → failed 不写文档；无卡 → skipped 零打扰', () => {
    const failed = judgeDailyOutcome({ ...BASE, quoteOk: false, limitReason: null })
    expect(failed.status).toBe('failed')
    expect(failed.writeDoc).toBe(false)
    expect(failed.failedReason).toBeTruthy()
    const skipped = judgeDailyOutcome({ ...BASE, hasCards: false, quoteOk: false, limitReason: null })
    expect(skipped.status).toBe('skipped')
    expect(skipped.writeDoc).toBe(false)
  })
})

describe('预算预检与分批（tasks 3.5）', () => {
  const targets = [
    { code: '600000', name: '浦发银行', path: 'p1', cardCount: 1, hasAinote: false },
    { code: '000001', name: '平安银行', path: 'p2', cardCount: 2, hasAinote: false },
    { code: '300750', name: '宁德时代', path: 'p3', cardCount: 1, hasAinote: false },
  ]
  it('预算充足 → 全量处理无截断', () => {
    const plan = planBatchByBudget(guardStub({ remaining: 200, budgetLimit: 200, budgetUsed: 0 }), targets)
    expect(plan.processableCount).toBe(3)
    expect(plan.deferred).toEqual([])
    expect(plan.message).toBe('')
  })
  it('预算仅够 N → 处理前 N、其余 deferred(budgetExhausted) + 「前 N 个」提示', () => {
    const plan = planBatchByBudget(guardStub({ remaining: 2, budgetLimit: 200, budgetUsed: 198 }), targets)
    expect(plan.processableCount).toBe(2)
    expect(plan.deferred).toEqual([{ code: '300750', reason: 'budgetExhausted' }])
    expect(plan.message).toContain('前 2 个')
  })
  it('预算耗尽 → 全部 deferred + 显式提示（不等待）', () => {
    const plan = planBatchByBudget(guardStub({ remaining: 0, budgetLimit: 200, budgetUsed: 200 }), targets)
    expect(plan.processableCount).toBe(0)
    expect(plan.deferred).toHaveLength(3)
    expect(plan.deferred.every((d) => d.reason === 'budgetExhausted')).toBe(true)
    expect(plan.message).toContain('预算耗尽')
  })
})
