import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { appendCard, updateCard } from '../../src/review/store.ts'
import { readDocumentSources } from '../../src/review/processors/source.ts'
import { createWorkflowRegistry } from '../../src/review/processors/registry.ts'
import { createWorkflowRecordStore } from '../../src/review/processors/records.ts'
import { createWorkflowRuntime } from '../../src/review/processors/runtime.ts'
import { attachKeywordJobs } from '../../src/review/processors/host-jobs.ts'
import { expectationWorkflow } from '../../src/review/processors/expectation.ts'
import type { WorkflowImplementation } from '../../src/review/processors/types.ts'

const extracted = process.env.KEYWORD_HOST_PROBE_ROOT

/** 业务逻辑: 提供确定性工作流闸门；关键判断: 纯代码Promise无mock/sleep；异常处理: 无。参数: 无。返回: promise/resolve。 */
function gate() {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}

/** 业务逻辑: 加载真实安装Jobs隔离上下文；关键判断: 无模拟宿主；异常处理: 包缺失失败而不skip。参数: 无。返回: 实际controller与清理函数。 */
async function realJobs() {
  const { Context } = await import(pathToFileURL(join(resolve(extracted!), '@deepseek-ai/cordis/lib/index.js')).href)
  const { default: Jobs } = await import(pathToFileURL(join(resolve(extracted!), '@deepseek-ai/dsh-jobs-local/lib/index.js')).href)
  const ctx = new Context(); const fiber = ctx.plugin(Jobs); await fiber
  const controller = attachKeywordJobs(ctx.jobs)
  return { controller, ctx, fiber }
}

it.skipIf(!extracted)('来源写通知滞后时完成结果保留历史，但不得标为当前输入', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-late-'))
  const host = await realJobs(); const begun = gate(); const finish = gate()
  const implementation: WorkflowImplementation = {
    id: 'late',
    /** 业务逻辑: 纯代码等待确定性闸门；关键判断: 不模拟Agent；异常处理: 框架处理。参数: 来源上下文。返回: 原输入结果。 */
    async execute(context) { begun.release(); await finish.promise; return { summary: context.source.body } },
  }
  const implementations = new Map([[implementation.id, implementation]])
  const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [{ id: 'late', label: '文字', mentions: ['文字'], enabled: true, implementationId: 'late', options: {} }] })
  const records = createWorkflowRecordStore(root)
  const runtime = createWorkflowRuntime({ dataRoot: root, registry, implementations, records, jobs: host.controller, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
  try {
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@文字 旧输入', clientRequestId: 'late-1' })
    const [source] = await readDocumentSources(root, created.path)
    const [registered] = await runtime.registerSource(source)
    await begun.promise
    await updateCard({ dataRoot: root, anchor: source.anchor, body: '@文字 新输入' })
    finish.release(); await runtime.drain()
    expect(await runtime.task(registered.runId)).toMatchObject({ executionState: 'succeeded', applicability: 'sourceChanged', result: { summary: '@文字 旧输入' } })
  } finally { finish.release(); await runtime.dispose(); await host.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it.skipIf(!extracted)('取消的代码清理完成前仍占槽，排空后下一工作流才能执行', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-cancel-'))
  const host = await realJobs(); const begun = gate(); const aborted = gate(); const cleanup = gate()
  let secondCalls = 0
  const first: WorkflowImplementation = {
    id: 'first',
    /** 业务逻辑: 观察取消后等待真实代码清理；关键判断: 清理闸门前不返回；异常处理: 取消最终抛出。参数: 上下文。返回: 不成功。 */
    async execute(context) { context.signal.addEventListener('abort', aborted.release, { once: true }); begun.release(); await aborted.promise; await cleanup.promise; context.signal.throwIfAborted(); return { summary: '不可到达' } },
  }
  const second: WorkflowImplementation = {
    id: 'second',
    /** 业务逻辑: 计次纯代码执行；关键判断: 不模拟模型；异常处理: 无IO。参数: 无。返回: 结果。 */
    async execute() { secondCalls++; return { summary: '第二工作流完成' } },
  }
  const implementations = new Map([[first.id, first], [second.id, second]])
  const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [first, second].map(implementation => ({ id: implementation.id, label: implementation.id, mentions: [implementation.id], enabled: true, implementationId: implementation.id, options: {} })) })
  const records = createWorkflowRecordStore(root)
  const runtime = createWorkflowRuntime({ dataRoot: root, registry, implementations, records, jobs: host.controller, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
  try {
    const loc = { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }
    const created = await appendCard({ loc, body: '@first', clientRequestId: 'cancel-1' })
    const [source1] = await readDocumentSources(root, created.path)
    const [registered1] = await runtime.registerSource(source1)
    await begun.promise
    await appendCard({ loc, body: '@second', clientRequestId: 'cancel-2' })
    const source2 = (await readDocumentSources(root, created.path)).find(source => source.anchor !== source1.anchor)!
    const [registered2] = await runtime.registerSource(source2)
    const current = (await runtime.task(registered1.runId))!
    const cancel = runtime.cancel({ runId: registered1.runId, recordVersion: current.recordVersion, reason: '用户取消' })
    await aborted.promise
    expect(secondCalls).toBe(0)
    expect(host.controller.owns(current.currentNativeJobId!)).toBe(true)
    cleanup.release(); await cancel; await runtime.drain()
    expect(await runtime.task(registered1.runId)).toMatchObject({ executionState: 'canceled', result: null })
    expect(await runtime.task(registered2.runId)).toMatchObject({ executionState: 'succeeded' })
    expect(secondCalls).toBe(1)
  } finally { cleanup.release(); aborted.release(); await runtime.dispose(); await host.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it.skipIf(!extracted)('无Agent能力的真实预期实现明确等待，GET不重复执行；显式重扫限31日', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-noagent-'))
  const host = await realJobs()
  const code: WorkflowImplementation = {
    id: 'code',
    /** 业务逻辑: 真实代码输出；关键判断: 不借用Agent；异常处理: 无IO。参数: 无。返回: 固定代码结果。 */
    async execute() { return { summary: '代码工作流完成' } },
  }
  const implementations = new Map([[expectationWorkflow.id, expectationWorkflow], [code.id, code]])
  const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [{ id: 'expectation', label: '预期', mentions: ['预期'], enabled: true, implementationId: expectationWorkflow.id, options: {} }, { id: 'code', label: '代码', mentions: ['代码'], enabled: true, implementationId: code.id, options: {} }] })
  const records = createWorkflowRecordStore(root)
  const runtime = createWorkflowRuntime({ dataRoot: root, registry, implementations, records, jobs: host.controller, agentFactory: () => null, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
  try {
    await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@预期 指数企稳', clientRequestId: 'noagent-1' })
    await runtime.recover(); await runtime.drain()
    expect(await records.listRuns()).toEqual([])
    expect(await runtime.rescan({ dateFrom: '2026-10-09', dateTo: '2026-10-09' })).toEqual({ registered: 1, reused: 0, nextCursor: null })
    await runtime.drain()
    const [record] = await records.listRuns()
    expect(record).toMatchObject({ executionState: 'waiting', waitingReason: 'capability', result: null, activeAttemptId: null })
    expect(record.attempts).toHaveLength(1)
    expect(await runtime.health()).toMatchObject({ agentAttemptsToday: 0, waitingCounts: { capability: 1 } })
    await runtime.tasks({}); await runtime.task(record.runId); await runtime.events(record.runId, 0, 100)
    const created = await appendCard({ loc: { dataRoot: root, code: '600001', tradeDate: '2026-10-09' }, body: '@代码', clientRequestId: 'noagent-code' })
    const [codeSource] = await readDocumentSources(root, created.path)
    const [codeRun] = await runtime.registerSource(codeSource)
    await runtime.drain()
    expect(await runtime.task(codeRun.runId)).toMatchObject({ executionState: 'succeeded' })
    expect((await records.readRun(record.runId))!.attempts).toHaveLength(1)
    await expect(runtime.rescan({ dateFrom: '2026-10-01', dateTo: '2026-11-01' })).rejects.toThrow('RESCAN_RANGE_INVALID')
    await expect(runtime.rescan({ dateFrom: '2026-10-09', dateTo: '2026-10-08' })).rejects.toThrow('RESCAN_RANGE_INVALID')
  } finally { await runtime.dispose(); await host.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})
