import { describe, expect, expectTypeOf, it } from 'vitest'
import { assertTaskInvariants, toPublicTask } from '../../src/review/processors/types.ts'
import type { ParseMentions, PublicWorkflowRunDTO, WorkflowDefinition, WorkflowExecutionContext, WorkflowImplementation, WorkflowRunRecord } from '../../src/review/processors/types.ts'
import { skillTextModule, textModule } from '../fixtures/processors/text-module.ts'

/**
 * 创建确定性的私有运行记录。
 * 业务逻辑: 构造已登记但尚未执行的整卡运行；关键判断: 真实来源身份及私有配置分离。
 * 异常处理: 不读外部资源。参数: 无。返回: 独立记录。
 */
function task(): WorkflowRunRecord {
  return {
    schemaVersion: 1, recordVersion: 1, runId: 'run-1', cardId: 'card-1', workflowId: 'text', workflowLabel: '文字', implementationId: 'text',
    requestKey: 'card-1:text', requestSequence: 1, triggerReason: 'cardSaved',
    sourceSnapshot: { relativePath: 'DB/review/202610/000001.md', anchor: 'c1', market: null, code: '000001', tradeDate: '2026-10-09', body: '@文字 原句', sourceRevision: 'source-1', verification: 'verified' },
    mentions: [{ raw: '@文字', name: '文字', start: 0, end: 3, processorId: 'text' }],
    sourceRevision: 'source-1', inputRevision: 'input-1', definitionRevision: 'definition-1', optionsSnapshot: { credential: 'private-config' },
    executionState: 'queued', waitingReason: null, applicability: 'current', activeAttemptToken: null,
    activeAttemptId: null, attempts: [], currentNativeJobId: null, runtimeInstanceId: null, nextAdmissionAt: null,
    createdAt: '2026-10-11T13:00:00+08:00', updatedAt: '2026-10-11T13:00:00+08:00',
    result: null, resultDelivery: 'none', deliveryReason: null, error: null, warnings: [], timeline: [], omittedEventCount: 0, firstRetainedSequence: null,
  }
}

/**
 * 构造运行上下文，只使用纯代码能力，无假宿主Agent。
 * 业务逻辑: 收集步骤日志并记录授权读取；关键判断: Agent能力明确不可用。
 * 异常处理: 不执行IO。参数: 可选signal。返回: 上下文及检查记录。
 */
function execution(signal = new AbortController().signal) {
  const messages: string[] = []
  const reads: { kind: string; limit?: number }[] = []
  const context: WorkflowExecutionContext = {
    runId: 'run-1', source: task().sourceSnapshot, mentions: task().mentions, options: {}, signal, agent: null,
    /** 业务逻辑: 收集纯工作流日志；关键判断: 不模拟宿主；异常处理: 无。参数: 消息。返回: 完成。 */
    async log(message) { messages.push(message) },
    /** 业务逻辑: 记录受控读取契约；关键判断: 无外部文件；异常处理: 无。参数: 请求。返回: 空授权材料。 */
    async read(request) { reads.push(request); return [] },
  }
  return { context, messages, reads }
}

/**
 * 将确定性记录设为运行中。
 * 业务逻辑: 创建一个活动尝试及凭据；关键判断: 标识一一对应。
 * 异常处理: 无IO。参数: record。返回: 原记录。
 */
function start(record: WorkflowRunRecord) {
  record.executionState = 'running'
  record.activeAttemptId = 'attempt-1'
  record.activeAttemptToken = 'private-attempt'
  record.attempts = [{ attemptId: 'attempt-1', startedAt: record.createdAt, finishedAt: null, provider: null, model: null, executionSessionId: null, nativeJobId: 'job-1', runtimeInstanceId: 'runtime-1', outcome: null }]
  return record
}

describe('运行状态和安全DTO', () => {
  it('两个不同ID的未结束尝试不能同时存在', () => {
    const record = start(task())
    record.attempts.push({ ...record.attempts[0], attemptId: 'attempt-2' })
    expect(() => assertTaskInvariants(record)).toThrow('CURRENT_ATTEMPT_REQUIRED')
  })

  it('公开运行包含触发原因和独立的安全命中摘要', () => {
    const record = task()
    const dto = toPublicTask(record)
    expect(dto.triggerReason).toBe('cardSaved')
    expect(dto.mentions).toEqual([{ name: '文字', start: 0, end: 3 }])
    expect(dto.mentions).not.toBe(record.mentions)
    Object.assign(dto.mentions[0], { name: '外部修改' })
    expect(record.mentions[0].name).toBe('文字')
  })

  it('queued有效；running必须有唯一当前尝试和私有凭据', () => {
    const record = task()
    expect(() => assertTaskInvariants(record)).not.toThrow()
    record.executionState = 'running'
    expect(() => assertTaskInvariants(record)).toThrow('CURRENT_ATTEMPT_REQUIRED')
    start(record)
    expect(() => assertTaskInvariants(record)).not.toThrow()
    record.attempts.push({ ...record.attempts[0] })
    expect(() => assertTaskInvariants(record)).toThrow('CURRENT_ATTEMPT_REQUIRED')
  })

  it('非running不可遗留未结束尝试或活动凭据', () => {
    const record = start(task())
    record.executionState = 'canceled'
    expect(() => assertTaskInvariants(record)).toThrow('CURRENT_ATTEMPT_REQUIRED')
    record.attempts[0].finishedAt = record.updatedAt
    record.attempts[0].outcome = 'killed'
    expect(() => assertTaskInvariants(record)).toThrow('CURRENT_ATTEMPT_REQUIRED')
    record.activeAttemptId = null
    record.activeAttemptToken = null
    expect(() => assertTaskInvariants(record)).not.toThrow()
  })

  it('唯一未结束尝试必须匹配当前ID', () => {
    const record = start(task())
    record.activeAttemptId = 'another-attempt'
    expect(() => assertTaskInvariants(record)).toThrow('CURRENT_ATTEMPT_REQUIRED')
  })

  it('waiting必须有原因，其他状态不可遗留等待原因', () => {
    const record = task()
    record.executionState = 'waiting'
    expect(() => assertTaskInvariants(record)).toThrow('WAITING_REASON_REQUIRED')
    record.waitingReason = 'capability'
    expect(() => assertTaskInvariants(record)).not.toThrow()
    record.executionState = 'queued'
    expect(() => assertTaskInvariants(record)).toThrow('UNEXPECTED_WAITING_REASON')
  })

  it('succeeded必须有结果，pending不能没有结果', () => {
    const record = task()
    record.executionState = 'succeeded'
    expect(() => assertTaskInvariants(record)).toThrow('RESULT_REQUIRED')
    record.executionState = 'queued'
    record.resultDelivery = 'pending'
    expect(() => assertTaskInvariants(record)).toThrow('INVALID_RESULT_DELIVERY')
  })

  it('公开记录只返回白名单，正文/配置/未来凭据不泄露', () => {
    const record = start(task())
    Object.assign(record, { futurePrivateToken: 'future-secret' })
    Object.assign(record.attempts[0], { futurePrivateToken: 'attempt-secret' })
    const dto = toPublicTask(record)
    const json = JSON.stringify(dto)
    for (const secret of ['private-attempt', 'private-config', 'future-secret', 'attempt-secret', '@文字 原句']) expect(json).not.toContain(secret)
    expect(dto.runId).toBe('run-1')
    expect(dto.source).toEqual({ relativePath: record.sourceSnapshot.relativePath, anchor: 'c1', market: null, code: '000001', tradeDate: '2026-10-09' })
    expectTypeOf<PublicWorkflowRunDTO>().not.toHaveProperty('activeAttemptToken')
    expectTypeOf<PublicWorkflowRunDTO>().not.toHaveProperty('optionsSnapshot')
    expectTypeOf<PublicWorkflowRunDTO>().not.toHaveProperty('stage')
  })

  it('序号必须为正整数', () => {
    const record = task()
    for (const invalid of [0, -1, 1.5, Number.NaN]) {
      record.requestSequence = invalid
      expect(() => assertTaskInvariants(record)).toThrow('INVALID_REQUEST_SEQUENCE')
    }
  })

  it('公开结果/来源/数组深复制且拒绝未知结果字段', () => {
    const record = task()
    record.executionState = 'succeeded'
    record.resultDelivery = 'pending'
    record.result = { summary: '文字', data: { nested: { summary: '原结果' } }, inputRevision: record.inputRevision, definitionRevision: record.definitionRevision, generatedAt: record.createdAt, declaration: '研究辅助' }
    record.warnings = [{ code: 'NOTICE', message: '提醒' }]
    expect(() => assertTaskInvariants(record)).not.toThrow()
    Object.assign(record.result, { futurePrivateToken: 'private-result' })
    const dto = toPublicTask(record)
    expect(JSON.stringify(dto)).not.toContain('private-result')
    expect(dto.result).toEqual({ summary: '文字', data: { nested: { summary: '原结果' } }, inputRevision: record.inputRevision, definitionRevision: record.definitionRevision, generatedAt: record.createdAt, declaration: '研究辅助' })
    expect(dto.result?.data).not.toBe(record.result.data)
    Object.assign((dto.result?.data as { nested: object }).nested, { summary: '已改' })
    Object.assign(dto.source, { anchor: '已改' })
    Object.assign(dto.warnings[0], { message: '已改' })
    expect(record.result.data).toEqual({ nested: { summary: '原结果' } })
    expect(record.sourceSnapshot.anchor).toBe('c1')
    expect(record.warnings[0].message).toBe('提醒')
  })
})

describe('单execute工作流契约', () => {
  it('文字工作流只需execute入口即可编排日志和受控读取', async () => {
    expectTypeOf(textModule).toMatchTypeOf<WorkflowImplementation>()
    expect(Object.keys(textModule)).toEqual(['id', 'execute'])
    const { context, messages, reads } = execution()
    await expect(textModule.execute(context)).resolves.toEqual({ summary: '@文字 原句' })
    expect(messages).toEqual(['开始整理文字', '文字整理完成'])
    expect(reads).toEqual([{ kind: 'role', limit: 1 }])
  })

  it('Skill适配也只有同一入口；能力不可用时明确失败', async () => {
    expectTypeOf(skillTextModule).toMatchTypeOf<WorkflowImplementation>()
    expect(Object.keys(skillTextModule)).toEqual(['id', 'execute'])
    const { context, messages } = execution()
    await expect(skillTextModule.execute(context)).rejects.toThrow('AGENT_CAPABILITY_UNAVAILABLE')
    expect(messages).toEqual([])
  })

  it('取消拒绝执行，无日志和读取', async () => {
    const abort = new AbortController()
    abort.abort()
    const { context, messages, reads } = execution(abort.signal)
    await expect(textModule.execute(context)).rejects.toThrow('WORKFLOW_ABORTED')
    await expect(skillTextModule.execute(context)).rejects.toThrow('WORKFLOW_ABORTED')
    expect(messages).toEqual([])
    expect(reads).toEqual([])
  })

  it('定义JSON无stage/执行分支，parser签名保持', () => {
    const definition: WorkflowDefinition = { id: 'text', label: '文字', mentions: ['文字'], enabled: true, implementationId: 'text', options: {}, definitionRevision: 'definition-1' }
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition)
    expectTypeOf<WorkflowDefinition>().not.toHaveProperty('stage')
    expectTypeOf<WorkflowImplementation>().not.toHaveProperty('prepare')
    expectTypeOf<ParseMentions>().parameter(0).toEqualTypeOf<string>()
    expectTypeOf<ParseMentions>().parameter(1).toEqualTypeOf<ReadonlyMap<string, string>>()
  })
})
