import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { appendCard } from '../../src/review/store.ts'
import { readDocumentSources } from '../../src/review/processors/source.ts'
import { attachKeywordJobs } from '../../src/review/processors/host-jobs.ts'
import { createWorkflowRuntime } from '../../src/review/processors/runtime.ts'
import type { WorkflowImplementation } from '../../src/review/processors/types.ts'

const textModule: WorkflowImplementation = {
  id: 'text',
  /** 业务逻辑: 真实代码工作流读卡片再整理；关键判断: 不模拟Agent或宿主；异常处理: 读取/日志错误传播。参数: 受控上下文。返回: 卡片摘要。 */
  async execute(context) {
    await context.log('开始代码整理')
    const [card] = await context.read({ kind: 'card', limit: 1 })
    return { summary: String(card.content) }
  },
}

const extracted = process.env.KEYWORD_HOST_PROBE_ROOT

it('MVP运行在持久登记之后才执行；GET只读；无真实Jobs明确等待', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-runtime-'))
  try {
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@文字 原句', clientRequestId: 'runtime-1' })
    const [source] = await readDocumentSources(root, created.path)
    const { createWorkflowRegistry } = await import('../../src/review/processors/registry.ts')
    const { createWorkflowRecordStore } = await import('../../src/review/processors/records.ts')
    const registry = createWorkflowRegistry(new Map([[textModule.id, textModule]]), { schemaVersion: 1, workflows: [{ id: 'text', label: '文字', mentions: ['文字'], enabled: true, implementationId: 'text', options: {} }] })
    const records = createWorkflowRecordStore(root)
    const runtime = createWorkflowRuntime({ dataRoot: root, registry, implementations: new Map([[textModule.id, textModule]]), records, jobs: null, enabled: true, maxConcurrency: 2, agentAttemptLimit: 2 })
    const [first] = await runtime.registerSource(source)
    await runtime.drain()
    expect((await runtime.task(first.runId))!.waitingReason).toBe('capability')
    expect(await runtime.registerSource(source)).toEqual([{ runId: first.runId, disposition: 'reused' }])
    const before = await records.listRuns()
    await runtime.health(); await runtime.tasks({}); await runtime.cards({ code: '600000', market: null, date: '2026-10-09' })
    expect(await records.listRuns()).toEqual(before)
    expect(JSON.stringify(await runtime.task(first.runId))).not.toContain('@文字 原句')
    await runtime.dispose()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it.skipIf(!extracted)('真实安装Jobs托管代码工作流；成功结果持久保存，恢复不重启', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-runtime-'))
  const { Context } = await import(pathToFileURL(join(resolve(extracted!), '@deepseek-ai/cordis/lib/index.js')).href)
  const { default: Jobs } = await import(pathToFileURL(join(resolve(extracted!), '@deepseek-ai/dsh-jobs-local/lib/index.js')).href)
  const ctx = new Context()
  const fiber = ctx.plugin(Jobs)
  await fiber
  const controller = attachKeywordJobs(ctx.jobs)
  try {
    const { createWorkflowRegistry } = await import('../../src/review/processors/registry.ts')
    const { createWorkflowRecordStore } = await import('../../src/review/processors/records.ts')
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@文字 原句', clientRequestId: 'runtime-2' })
    const [source] = await readDocumentSources(root, created.path)
    const registry = createWorkflowRegistry(new Map([[textModule.id, textModule]]), { schemaVersion: 1, workflows: [{ id: 'text', label: '文字', mentions: ['文字'], enabled: true, implementationId: 'text', options: {} }] })
    const records = createWorkflowRecordStore(root)
    const deps = { dataRoot: root, registry, implementations: new Map([[textModule.id, textModule]]), records, jobs: controller, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 }
    const runtime = createWorkflowRuntime(deps)
    const [first] = await runtime.registerSource(source)
    await runtime.drain()
    const record = await records.readRun(first.runId)
    expect(record?.executionState).toBe('succeeded')
    expect(record?.result?.summary).toBe('@文字 原句')
    expect(record?.attempts).toHaveLength(1)
    expect(record?.timeline.map(event => event.code)).toContain('RESULT_COMMITTED')
    expect(ctx.jobs.get(record!.currentNativeJobId!).status).toBe('completed')
    await runtime.dispose()
    const recovered = createWorkflowRuntime({ ...deps, jobs: null })
    await recovered.recover(); await recovered.drain()
    expect((await records.readRun(first.runId))?.attempts).toHaveLength(1)
    expect((await recovered.task(first.runId))?.executionState).toBe('succeeded')
    await recovered.dispose()
  } finally { await controller.dispose(); await fiber.dispose(); await rm(root, { recursive: true, force: true }) }
})

it('设置按CAS持久白名单override，未知选项/版本冲突不改有效表', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-settings-'))
  const { createWorkflowRegistry } = await import('../../src/review/processors/registry.ts')
  const { createWorkflowRecordStore } = await import('../../src/review/processors/records.ts')
  const { createWorkflowRuntime, readWorkflowSettings } = await import('../../src/review/processors/runtime.ts')
  const implementations = new Map([[textModule.id, textModule]])
  const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [{ id: 'text', label: '文字', mentions: ['文字'], enabled: true, implementationId: 'text', options: { limit: 1 } }] })
  const records = createWorkflowRecordStore(root)
  const runtime = createWorkflowRuntime({ dataRoot: root, registry, implementations, records, jobs: null, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
  try {
    expect(await readWorkflowSettings(root)).toBeNull()
    expect((await runtime.registry()).settingsRevision).toBe(1)
    const updated = await runtime.settings({ settingsRevision: 1, workflows: [{ workflowId: 'text', enabled: false, options: { limit: 2 } }] })
    expect(updated.settingsRevision).toBe(2)
    expect(registry.get('text')).toMatchObject({ enabled: false, options: { limit: 2 } })
    const stored = await readWorkflowSettings(root)
    expect(stored).toMatchObject({ settingsRevision: 2, candidate: { schemaVersion: 1, workflows: [expect.objectContaining({ id: 'text', enabled: false, options: { limit: 2 } })] } })
    await expect(runtime.settings({ settingsRevision: 1, workflows: [{ workflowId: 'text', enabled: true }] })).rejects.toThrow('RUN_VERSION_CONFLICT')
    await expect(runtime.settings({ settingsRevision: 2, workflows: [{ workflowId: 'text', options: { arbitraryPath: '../outside' } }] })).rejects.toThrow('SETTINGS_OPTION_INVALID')
    expect(await readWorkflowSettings(root)).toEqual(stored)
    expect(registry.get('text')!.enabled).toBe(false)
    const recovered = createWorkflowRuntime({ dataRoot: root, registry, implementations, records, jobs: null, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
    expect((await recovered.registry()).settingsRevision).toBe(2)
    await recovered.dispose()
  } finally { await runtime.dispose(); await rm(root, { recursive: true, force: true }) }
})
