import { expect, it } from 'vitest'
import { validateWorkflowResult } from '../../src/review/processors/results.ts'

it('通用结果拒绝身份/路径额外字段、非JSON、空摘要及超限，同时保留不同业务数据', async () => {
  const validate = validateWorkflowResult
  expect(validate({ summary: '文字', data: { anything: ['a', 2, null] } })).toEqual({ summary: '文字', data: { anything: ['a', 2, null] } })
  for (const bad of [{ summary: '' }, { summary: '文字', runId: 'other' }, { summary: '文字', data: Infinity }, { summary: '文字', data: new Date() }, { summary: '文字', data: { method() {} } }, { summary: 'a'.repeat(16385) }]) expect(() => validate(bad)).toThrow('WORKFLOW_RESULT_INVALID')
})

it('已持久请求取消的尝试不得随后提交成功，即使资源尚未结束', async () => {
  const { completeWorkflowResult } = await import('../../src/review/processors/results.ts')
  const record: import('../../src/review/processors/types.ts').WorkflowRunRecord = {
    schemaVersion: 1, recordVersion: 1, runId: 'run-1', cardId: 'card-1', workflowId: 'text', workflowLabel: '文字', implementationId: 'text', requestKey: 'request-1', requestSequence: 1, triggerReason: 'cardSaved',
    sourceSnapshot: { relativePath: 'DB/review/202610/600000_600000_20261009.md', anchor: 'card-20261009-600000-1500', market: null, code: '600000', tradeDate: '2026-10-09', body: '@文字', sourceRevision: 'source-1', verification: 'verified' }, mentions: [],
    sourceRevision: 'source-1', inputRevision: 'input-1', definitionRevision: 'definition-1', optionsSnapshot: {}, executionState: 'running', waitingReason: null, applicability: 'current', activeAttemptToken: 'private-token', activeAttemptId: 'attempt-1',
    attempts: [{ attemptId: 'attempt-1', startedAt: '2026-10-11T00:00:00Z', finishedAt: null, provider: null, model: null, executionSessionId: null, nativeJobId: 'job-1', runtimeInstanceId: 'runtime-1', outcome: null }], currentNativeJobId: 'job-1', runtimeInstanceId: 'runtime-1', nextAdmissionAt: null,
    createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', result: null, resultDelivery: 'none', deliveryReason: null, error: null, warnings: [{ code: 'RUN_CANCEL_REQUESTED', message: '正在等待清理' }], timeline: [], omittedEventCount: 0, firstRetainedSequence: null,
  }
  expect(() => completeWorkflowResult(record, { summary: '迟到结果' }, 'attempt-1', 'private-token', '2026-10-11T00:00:01Z')).toThrow('WORKFLOW_ATTEMPT_STALE')
  expect(record.executionState).toBe('running')
  expect(record.result).toBeNull()
})
