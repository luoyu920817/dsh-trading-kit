import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { appendAinote, appendCard, updateCard } from '../../src/review/store.ts'
import { expectationWorkflow } from '../../src/review/processors/expectation.ts'
import { createWorkflowRegistry } from '../../src/review/processors/registry.ts'
import { createWorkflowRecordStore } from '../../src/review/processors/records.ts'
import { createWorkflowRuntime } from '../../src/review/processors/runtime.ts'
import { attachKeywordTrigger } from '../../src/review/processors/trigger.ts'
import { readDocumentSources } from '../../src/review/processors/source.ts'

it('实际保存@预期自动持久去重；缺能力等待，附注不触发，修订旧版本与取消重跑保留历史', async () => {
  const root = await mkdtemp(join(tmpdir(), 'expectation-save-mvp-'))
  const implementations = new Map([[expectationWorkflow.id, expectationWorkflow]])
  const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [{ id: 'expectation', label: '预期整理', mentions: ['预期'], enabled: true, implementationId: expectationWorkflow.id, options: {} }] })
  const records = createWorkflowRecordStore(root)
  const runtime = createWorkflowRuntime({ dataRoot: root, registry, records, implementations, jobs: null, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
  const errors: unknown[] = []
  const trigger = attachKeywordTrigger(root, path => runtime.reconcileDocument(path), error => { errors.push(error) })
  try {
    const loc = { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }
    const created = await appendCard({ loc, body: '@预期 成交额回升。@预期 指数企稳。', clientRequestId: 'mvp-save-1' })
    await trigger.drain(); await runtime.drain()
    const first = (await records.listRuns())[0]!
    expect(first).toMatchObject({ workflowId: 'expectation', executionState: 'waiting', waitingReason: 'capability', requestSequence: 1, result: null })
    expect(first.mentions).toHaveLength(2)
    expect(await records.listRuns()).toHaveLength(1)
    const [source] = await readDocumentSources(root, created.path)
    expect(await runtime.registerSource(source!)).toEqual([{ runId: first.runId, disposition: 'reused' }])
    await appendAinote({ loc, body: '@预期 附注不产生新输入', generatedAt: '2026-10-09T16:00:00+08:00', dataSources: [] })
    await trigger.drain(); await runtime.drain()
    expect(await records.listRuns()).toHaveLength(1)
    await updateCard({ dataRoot: root, anchor: created.anchor, body: '@预期 指数企稳且成交额继续回升。' })
    await trigger.drain(); await runtime.drain()
    const revised = (await records.listRuns()).find(run => run.runId !== first.runId)!
    expect(revised.inputRevision).not.toBe(first.inputRevision)
    expect((await records.readRun(first.runId))!.applicability).toBe('sourceChanged')
    const canceled = await runtime.cancel({ runId: revised.runId, recordVersion: revised.recordVersion, reason: '人工取消' })
    expect(canceled.executionState).toBe('canceled')
    const retried = await runtime.retry({ runId: revised.runId, recordVersion: canceled.recordVersion, expectedInputRevision: revised.inputRevision })
    await runtime.drain()
    expect(retried.runId).not.toBe(revised.runId)
    expect((await records.readRun(retried.runId))!.requestSequence).toBe(2)
    expect((await records.readRun(revised.runId))!.executionState).toBe('canceled')
    expect(await runtime.health()).toMatchObject({ agentAttemptsToday: 0, waitingCounts: { capability: 1 } })
    expect(await readFile(created.path, 'utf8')).toContain('@预期 指数企稳且成交额继续回升。')
    expect(errors).toEqual([])
  } finally { await trigger.dispose(); await runtime.dispose(); await rm(root, { recursive: true, force: true }) }
}, 15_000)
