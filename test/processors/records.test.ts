import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createWorkflowRecordStore } from '../../src/review/processors/records.ts'
import { cardIdentity, inputRevision, requestIdentity } from '../../src/review/processors/identity.ts'
import type { WorkflowRunRecord } from '../../src/review/processors/types.ts'

/** 业务逻辑: 构造纯确定性完整记录；关键判断: 无假宿主/业务执行；异常处理: 无IO。参数: 无。返回: queued事实。 */
function record(): WorkflowRunRecord {
  const source = { relativePath: 'DB/review/202610/600000_测试_20261009.md', anchor: 'c1', market: null, code: '600000', tradeDate: '2026-10-09', body: '@文字 原文', sourceRevision: 'source-1', verification: 'verified' as const }
  const input = inputRevision(source)
  return {
    schemaVersion: 1, recordVersion: 1, runId: 'run-1', cardId: cardIdentity(source), workflowId: 'text', workflowLabel: '文字', implementationId: 'text', requestKey: requestIdentity(source, 'text', input, 'definition-1'), requestSequence: 1, triggerReason: 'cardSaved', sourceSnapshot: source,
    mentions: [{ raw: '@文字', name: '文字', start: 0, end: 3, processorId: 'text' }], sourceRevision: source.sourceRevision, inputRevision: input, definitionRevision: 'definition-1', optionsSnapshot: {}, executionState: 'queued', waitingReason: null, applicability: 'current', activeAttemptId: null, activeAttemptToken: null, attempts: [], currentNativeJobId: null, runtimeInstanceId: null, nextAdmissionAt: null,
    createdAt: '2026-10-11T13:00:00Z', updatedAt: '2026-10-11T13:00:00Z', result: null, resultDelivery: 'none', deliveryReason: null, error: null, warnings: [], timeline: [], omittedEventCount: 0, firstRetainedSequence: null,
  }
}

it('真实持久文件create-only、跨实例CAS只有一个写入成功', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-records-'))
  try {
    const store = createWorkflowRecordStore(root), second = createWorkflowRecordStore(root)
    expect(await store.listRuns()).toEqual([])
    const original = record()
    await store.createRun(original)
    expect(await second.readRun('run-1')).toEqual(original)
    await expect(second.createRun(original)).rejects.toThrow('RUN_EXISTS')
    const first = { ...original, recordVersion: 2, updatedAt: '2026-10-11T13:01:00Z' }
    const writes = await Promise.allSettled([store.updateRun(first, 1), second.updateRun({ ...first, triggerReason: 'cardSaved' }, 1)])
    expect(writes.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(writes.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect((await store.readRun('run-1'))?.recordVersion).toBe(2)
    expect(await store.readRequestGroup(original.requestKey)).toHaveLength(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('坏JSON与超限文件不可当不存在或空请求组', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-records-'))
  try {
    const store = createWorkflowRecordStore(root), original = record()
    await store.createRun(original)
    const path = join(root, 'agent/DB/temp/dsh-trader-kit/processors/runs/run-1.json')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(original)
    await writeFile(path, '{')
    await expect(store.readRun('run-1')).rejects.toThrow('RECORD_STORAGE_INVALID')
    await expect(store.readRequestGroup(original.requestKey)).rejects.toThrow('RECORD_STORAGE_INVALID')
    await writeFile(path, ' '.repeat(2 * 1024 * 1024 + 1))
    await expect(store.listRuns()).rejects.toThrow('RECORD_STORAGE_INVALID')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('成功记录不可改成失败或改结果，锁键/重入非法明确拒绝', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-records-'))
  try {
    const store = createWorkflowRecordStore(root), original = record()
    original.executionState = 'succeeded'; original.resultDelivery = 'complete'
    original.result = { summary: '研究结果', inputRevision: original.inputRevision, definitionRevision: original.definitionRevision, generatedAt: original.createdAt, declaration: '研究辅助' }
    await store.createRun(original)
    await expect(store.updateRun({ ...original, recordVersion: 2, executionState: 'failed', result: null, resultDelivery: 'none' }, 1)).rejects.toThrow('RECORD_SUCCESS_IMMUTABLE')
    await expect(store.updateRun({ ...original, recordVersion: 2, result: { ...original.result, summary: '篡改' } }, 1)).rejects.toThrow('RECORD_SUCCESS_IMMUTABLE')
    await expect(store.withRecordLocks(['../../x'], async () => {})).rejects.toThrow('RECORD_LOCK_INVALID')
    await expect(store.withRecordLocks(['agent-budget'], () => store.withRecordLocks(['agent-budget'], async () => {}))).rejects.toThrow('RECORD_LOCK_REENTRANT')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('配置CAS锁支持真实runtime契约', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-records-'))
  try {
    const store = createWorkflowRecordStore(root)
    expect(await store.withRecordLocks(['workflow-config'], async () => '配置锁已持有')).toBe('配置锁已持有')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('来源不可验证waiting事实支持真实runtime契约及已持有组锁创建', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-records-'))
  try {
    const store = createWorkflowRecordStore(root), original = record()
    original.executionState = 'waiting'; original.waitingReason = 'sourceNeedsReview'; original.applicability = 'sourceUnverified'
    await store.withRecordLocks([`group:${original.requestKey}`], () => store.createRun(original))
    expect(await store.readRun(original.runId)).toEqual(original)
  } finally { await rm(root, { recursive: true, force: true }) }
})
