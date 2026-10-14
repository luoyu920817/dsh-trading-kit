import { expect, it } from 'vitest'
import { validateExpectationResult, expectationWorkflow } from '../../src/review/processors/expectation.ts'

it('预期整理只接纳原文证据及明确的验证条件，不接纳模型编造的原句', () => {
  const source = '@预期 明天指数企稳，成交额回升。'
  const result = { summary: '跟踪指数与成交额', data: { expectations: [{ quote: '明天指数企稳，成交额回升。', condition: '指数收盘不再下跌', verification: '比较次日指数收盘和成交额' }] } }
  expect(validateExpectationResult(source, result)).toEqual(result)
  expect(() => validateExpectationResult(source, { ...result, data: { expectations: [{ quote: '保证涨停', condition: '条件', verification: '验证' }] } })).toThrow('EXPECTATION_QUOTE_INVALID')
  expect(() => validateExpectationResult(source, { ...result, data: { expectations: [{ quote: source, condition: '必须买', verification: '验证' }] } })).toThrow('EXPECTATION_OUTPUT_INVALID')
  expect(() => validateExpectationResult(source, { summary: '没有证据', data: { expectations: [] } })).toThrow('EXPECTATION_OUTPUT_INVALID')
})

it('预期实现只有execute入口，缺Agent不能返回预制成功', async () => {
  expect(Object.keys(expectationWorkflow)).toEqual(['id', 'execute'])
  await expect(expectationWorkflow.execute({ runId: 'run-1', source: { body: '@预期', relativePath: 'DB/review/202610/600000_600000_20261009.md', anchor: 'card-20261009-600000-1500', market: null, code: '600000', tradeDate: '2026-10-09', sourceRevision: 'revision', verification: 'verified' }, mentions: [], options: {}, agent: null, signal: new AbortController().signal, log: async () => {}, read: async () => [] })).rejects.toThrow('AGENT_CAPABILITY_UNAVAILABLE')
})

it('生成字段拒绝明确买卖及委托指令，引用的原文仍可保留', () => {
  const source = '@预期 我计划买入100股，等待条件成立'
  const valid = { summary: '人工核验条件', data: { expectations: [{ quote: source, condition: '指数企稳', verification: '人工比较后续收盘数据' }] } }
  expect(validateExpectationResult(source, valid)).toEqual(valid)
  for (const text of ['建议卖出100股', '9:30买入100股', '建仓', '减仓', '下单', '撤单', '委托成交']) {
    expect(() => validateExpectationResult(source, { ...valid, summary: text })).toThrow('EXPECTATION_OUTPUT_INVALID')
    expect(() => validateExpectationResult(source, { ...valid, data: { expectations: [{ ...valid.data.expectations[0], condition: text }] } })).toThrow('EXPECTATION_OUTPUT_INVALID')
  }
})
