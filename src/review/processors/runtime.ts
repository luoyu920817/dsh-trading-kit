import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { isValidIsoDate } from '../../data/date.ts'
import { resolveArea } from '../../paths/resolve.ts'
import { withVerifiedCardSnapshot } from '../store.ts'
import { parseMentions } from './parser.ts'
import { readCardSource, readDocumentSources } from './source.ts'
import { createWorkflowContextReader } from './context.ts'
import { admissionReason, createAgentBudget, writeRuntimeJson } from './scheduler.ts'
import { appendRunEvent, completeWorkflowResult } from './results.ts'
import { cardIdentity, inputRevision, requestIdentity } from './identity.ts'
import { toPublicTask } from './types.ts'
import type { WorkflowRegistry } from './registry.ts'
import { createWorkflowRegistry } from './registry.ts'
import type { WorkflowAgentScope } from './agent.ts'
import type { KeywordJobController, KeywordJobHandle, KeywordJobOutcome } from './host-jobs.ts'
import type { Applicability, CancelRequest, ControlledWorkflowAgent, EventPage, JsonObject, JsonValue, ProcessingService, RegistrationResult, RescanRequest, RetryRequest, SettingsRequest, SourceCardSnapshot, TaskQuery, WaitingReason, WorkflowDefinition, WorkflowImplementation, WorkflowResult, WorkflowRunRecord } from './types.ts'

export interface WorkflowRuntimeDeps {
  readonly dataRoot: string
  readonly registry: WorkflowRegistry
  readonly implementations: ReadonlyMap<string, WorkflowImplementation>
  readonly records: import('./types.ts').WorkflowRecordStore & { listRuns(): Promise<WorkflowRunRecord[]> }
  readonly jobs: KeywordJobController | null
  readonly agentFactory?: (scope: WorkflowAgentScope, record: Readonly<WorkflowRunRecord>) => ControlledWorkflowAgent | null
  readonly enabled: boolean
  readonly maxConcurrency: number
  readonly agentAttemptLimit: number
  readonly now?: () => Date
  readonly reloadCandidate?: () => Promise<unknown>
  readonly initialSettingsRevision?: number
}
interface ActiveRun { abort: AbortController; done: Promise<KeywordJobOutcome>; jobId: string | null; cancelReason: string | null }
const PENDING = new Set(['queued', 'waiting', 'retryWaiting'])
const TERMINAL = new Set(['succeeded', 'failed', 'canceled'])

export interface WorkflowSettings { readonly schemaVersion: 1; readonly settingsRevision: number; readonly candidate: unknown }

/**
 * 只读处理器区的持久配置覆盖。
 * 业务逻辑: root装配优先读取已保存候选，缺文件才退回安装资源。
 * 关键判断: 文件真实路径须根内、512KiB上限、精确元数据；候选仍交注册表整体校验。
 * 异常处理: 仅ENOENT返回null，坏文件/链接明确拒绝，不默默忽略用户配置。
 * 参数: dataRoot。返回: 版本及候选或null。
 */
export async function readWorkflowSettings(dataRoot: string): Promise<WorkflowSettings | null> {
  const path = resolveArea(dataRoot, 'processorRuns', { fileName: 'settings.json' }).absPath
  try {
    if (await realpath(path) !== path) throw new Error('SETTINGS_STORAGE_INVALID')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024) throw new Error('SETTINGS_STORAGE_INVALID')
    const stored: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('SETTINGS_STORAGE_INVALID')
    const value = stored as Record<string, unknown>
    if (Object.keys(value).sort().join() !== 'candidate,schemaVersion,settingsRevision' || value.schemaVersion !== 1 || !Number.isSafeInteger(value.settingsRevision) || (value.settingsRevision as number) < 1 || !value.candidate || typeof value.candidate !== 'object') throw new Error('SETTINGS_STORAGE_INVALID')
    return value as unknown as WorkflowSettings
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

/** 业务逻辑: 将冻结定义还原为可校验候选；关键判断: 不混入内部fingerprint；异常处理: 不做IO。参数: 定义列表。返回: 精确JSON候选。 */
function definitionCandidate(definitions: readonly WorkflowDefinition[]) {
  return { schemaVersion: 1, workflows: definitions.map(({ id, label, mentions, enabled, implementationId, options }) => ({ id, label, mentions: [...mentions], enabled, implementationId, options: structuredClone(options) })) }
}

/**
 * 建立关键词MVP运行服务。
 * 业务逻辑: 来源登记、真实Jobs执行和持久运行查询共用一个服务。
 * 关键判断: 无第二执行器/隐式历史扫描，Agent能力由root受控工厂提供。
 * 异常处理: 非法配置拒绝，运行错误持久显示且存储失败停止接纳。
 * 参数: 固定数据根/注册表/记录/真实宿主能力。返回: 运行管理服务。
 */
export function createWorkflowRuntime(deps: WorkflowRuntimeDeps): WorkflowRuntime {
  return new WorkflowRuntime(deps)
}

export class WorkflowRuntime implements ProcessingService {
  private readonly active = new Map<string, ActiveRun>()
  private readonly clock: () => Date
  private readonly budget: ReturnType<typeof createAgentBudget>
  private readonly implementations: ReadonlyMap<string, WorkflowImplementation>
  private readonly runtimeId = randomUUID()
  private pumping: Promise<void> | undefined
  private pumpRequested = false
  private closed = false
  private admissionClosed = false
  private storageError: { code: string; message: string } | null = null
  private readonly cleanupErrors: unknown[] = []
  private disposal: Promise<void> | undefined
  private settingsRevision = 1

  /** 业务逻辑: 固定依赖并建立只读预算服务；关键判断: 构造不扫描/写文件/执行；异常处理: 非法容量或额度拒绝。参数: deps。返回: 实例。 */
  constructor(private readonly deps: WorkflowRuntimeDeps) {
    admissionReason({ enabled: deps.enabled, jobsAvailable: deps.jobs !== null, active: 0, maxConcurrency: deps.maxConcurrency })
    this.clock = deps.now ?? (() => new Date())
    this.budget = createAgentBudget(deps.dataRoot, deps.records, deps.agentAttemptLimit, this.clock)
    this.implementations = new Map(deps.implementations)
    this.settingsRevision = deps.initialSettingsRevision ?? 1
    if (!Number.isSafeInteger(this.settingsRevision) || this.settingsRevision < 1) throw new Error('SETTINGS_REVISION_INVALID')
  }

  /** 业务逻辑: 统一时钟；关键判断: 合法ISO持久时间；异常处理: 非法日期拒绝。参数: 无。返回: ISO。 */
  private timestamp(): string { return this.clock().toISOString() }

  /** 业务逻辑: 短运行锁下读取最新记录并CAS；关键判断: 锁名不同于records内部run锁；异常处理: 缺失/版本失败传播。参数: ID/短修改。返回: 最新记录。 */
  private async mutate(runId: string, change: (record: WorkflowRunRecord) => void): Promise<WorkflowRunRecord> {
    return this.deps.records.withRecordLocks([`mutation:${runId}`], async () => {
      const record = await this.deps.records.readRun(runId)
      if (!record) throw new Error('RUN_NOT_FOUND')
      const previous = record.recordVersion
      change(record)
      record.recordVersion = previous + 1
      record.updatedAt = this.timestamp()
      return this.deps.records.updateRun(record, previous)
    })
  }

  /** 业务逻辑: 合并唤醒请求；关键判断: 只安排Jobs接纳，不建立另一个后台执行器；异常处理: 存储失败关闭接纳。参数: 无。返回: 无。 */
  private wake(): void {
    if (this.closed || this.admissionClosed) return
    this.pumpRequested = true
    if (this.pumping) return
    this.pumping = (async () => {
      while (this.pumpRequested && !this.closed && !this.admissionClosed) { this.pumpRequested = false; await this.pumpOnce() }
    })().catch(() => { this.admissionClosed = true; this.storageError = { code: 'STORAGE_UNAVAILABLE', message: '运行记录无法可靠持久保存，已停止接纳' } }).finally(() => {
      this.pumping = undefined
      if (this.pumpRequested && !this.closed && !this.admissionClosed) this.wake()
    })
  }

  /** 业务逻辑: 解释并持久化等待；关键判断: 未运行才可等待、相同原因不反复写日志；异常处理: CAS失败传播。参数: 运行/原因。返回: 无。 */
  private async wait(record: WorkflowRunRecord, reason: WaitingReason): Promise<void> {
    if (record.executionState === 'waiting' && record.waitingReason === reason) return
    await this.mutate(record.runId, current => {
      if (!PENDING.has(current.executionState)) return
      current.executionState = 'waiting'; current.waitingReason = reason
      appendRunEvent(current, 'RUN_WAITING', '工作流等待可用能力、开关或容量', this.timestamp(), { reason })
    })
  }

  /** 业务逻辑: 一轮从持久队列选择并启动真实Jobs；关键判断: 先登记、容量留到done清理；异常处理: 原生容量失败持久等待，其他存储错误上抛。参数: 无。返回: 本轮完成。 */
  private async pumpOnce(): Promise<void> {
    const runs = (await this.deps.records.listRuns()).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.runId.localeCompare(b.runId))
    for (const record of runs) {
      if (this.closed || this.admissionClosed) break
      if (!PENDING.has(record.executionState) || this.active.has(record.runId)) continue
      if (record.applicability !== 'current') continue
      const definition = this.deps.registry.get(record.workflowId)
      if (!definition || definition.definitionRevision !== record.definitionRevision) { await this.invalidate(record, 'configurationChanged'); continue }
      const reason = admissionReason({ enabled: this.deps.enabled && definition.enabled, jobsAvailable: this.deps.jobs !== null, active: this.active.size, maxConcurrency: this.deps.maxConcurrency })
      if (reason) { await this.wait(record, reason); continue }
      if (record.waitingReason === 'budget' && await this.budget.usage() >= this.deps.agentAttemptLimit) continue
      if (record.waitingReason === 'capability' && record.attempts.length > 0 && record.runtimeInstanceId === this.runtimeId) continue
      let source: SourceCardSnapshot
      try { source = await readCardSource(this.deps.dataRoot, record.sourceSnapshot) } catch (error) { await this.invalidate(record, (error as Error).message === 'SOURCE_REMOVED' ? 'sourceRemoved' : 'sourceUnverified'); continue }
      if (source.sourceRevision !== record.sourceRevision || inputRevision(source) !== record.inputRevision) { await this.invalidate(record, 'sourceChanged'); continue }
      const entry: ActiveRun = { abort: new AbortController(), done: Promise.resolve({ status: 'killed' }), jobId: null, cancelReason: null }
      this.active.set(record.runId, entry)
      try {
        this.deps.jobs!.start(record.workflowLabel, job => {
          entry.jobId = job.id
          entry.done = this.executeRun(record.runId, job, entry).finally(async () => {
            this.active.delete(record.runId)
            entry.abort.abort('运行资源已结束')
            if (!this.closed && !this.admissionClosed && (await this.deps.records.listRuns()).some(run => run.executionState === 'queued' || run.waitingReason === 'hostCapacity')) this.wake()
          })
          entry.done.catch(() => { this.admissionClosed = true; this.storageError = { code: 'STORAGE_UNAVAILABLE', message: '运行清理或记录保存失败' } })
          return { cancel: reason => { entry.cancelReason = reason ?? '用户取消'; entry.abort.abort(entry.cancelReason) }, done: entry.done }
        })
      } catch (error) {
        this.active.delete(record.runId)
        if (entry.jobId !== null) throw error
        await this.wait(record, 'hostCapacity')
      }
    }
  }

  /** 业务逻辑: 来源/配置失效标记并协作取消；关键判断: 成功历史只改适用性，运行中等待实际清理；异常处理: 存储失败传播。参数: 记录/适用性。返回: 无。 */
  private async invalidate(record: WorkflowRunRecord, applicability: Applicability): Promise<void> {
    await this.mutate(record.runId, current => {
      current.applicability = applicability
      if (PENDING.has(current.executionState)) { current.executionState = applicability === 'sourceUnverified' ? 'waiting' : 'canceled'; current.waitingReason = applicability === 'sourceUnverified' ? 'sourceNeedsReview' : null }
      appendRunEvent(current, 'SOURCE_INVALIDATED', '原卡片或工作流定义已变化，保留历史记录', this.timestamp(), { applicability })
    })
    const entry = this.active.get(record.runId)
    if (entry) { entry.cancelReason = '来源或定义变化'; entry.abort.abort(entry.cancelReason) }
  }

  /** 业务逻辑: 原来源短锁中登记命中并去重；关键判断: 全部保存完成后才唤醒Jobs，同卡相同关键词只一次；异常处理: 版本变化/不完整目录拒绝。参数: source/原因/显式重跑。返回: 登记结果。 */
  registerSource(source: SourceCardSnapshot, triggerReason = 'cardSaved', force = false): Promise<RegistrationResult[]> {
    return this.registerSavedSource(source, triggerReason, force)
  }

  /** 业务逻辑: 保存/指定重跑共用来源和去重事务；关键判断: 显式retry在请求组锁下重核原运行CAS；异常处理: 旧版本不能插入新运行。参数: 原来源/触发/强制/目标/可选CAS。返回: 登记结果。 */
  private async registerSavedSource(source: SourceCardSnapshot, triggerReason: string, force: boolean, onlyWorkflowId?: string, retryGuard?: RetryRequest): Promise<RegistrationResult[]> {
    if (this.closed) throw new Error('RUNTIME_CLOSED')
    const results = await withVerifiedCardSnapshot(this.deps.dataRoot, source, async actual => {
      if (actual.sourceRevision !== source.sourceRevision) throw new Error('RUN_INPUT_CONFLICT')
      const mentions = parseMentions(actual.body, this.deps.registry.aliases()).recognized
      const workflowIds = [...new Set(mentions.map(mention => mention.processorId))]
      const cardId = cardIdentity(actual)
      const revision = inputRevision(actual)
      const registered: RegistrationResult[] = []
      for (const workflowId of workflowIds) {
        if (onlyWorkflowId !== undefined && workflowId !== onlyWorkflowId) continue
        const definition = this.deps.registry.get(workflowId)!
        const requestKey = requestIdentity(actual, workflowId, revision, definition.definitionRevision)
        registered.push(await this.deps.records.withRecordLocks([`group:${requestKey}`], async () => {
          const group = await this.deps.records.readRequestGroup(requestKey)
          const newest = [...group].sort((a, b) => b.requestSequence - a.requestSequence)[0]
          if (newest && !force && newest.applicability === 'current') return { runId: newest.runId, disposition: 'reused' as const }
          const create = async (): Promise<RegistrationResult> => {
          if (retryGuard) {
            const origin = await this.deps.records.readRun(retryGuard.runId)
            if (!origin) throw new Error('RUN_NOT_FOUND')
            if (origin.recordVersion !== retryGuard.recordVersion) throw new Error('RUN_VERSION_CONFLICT')
            if (origin.inputRevision !== retryGuard.expectedInputRevision) throw new Error('RUN_INPUT_CONFLICT')
          }
          const sequence = (newest?.requestSequence ?? 0) + 1
          const runId = createHash('sha256').update(JSON.stringify([requestKey, sequence])).digest('hex')
          const now = this.timestamp()
          const record: WorkflowRunRecord = {
            schemaVersion: 1, recordVersion: 1, runId, cardId, workflowId, workflowLabel: definition.label, implementationId: definition.implementationId,
            requestKey, requestSequence: sequence, triggerReason: triggerReason.slice(0, 100), sourceSnapshot: structuredClone(actual), mentions: mentions.filter(mention => mention.processorId === workflowId),
            sourceRevision: actual.sourceRevision, inputRevision: revision, definitionRevision: definition.definitionRevision, optionsSnapshot: structuredClone(definition.options),
            executionState: 'queued', waitingReason: null, applicability: 'current', activeAttemptId: null, activeAttemptToken: null,
            attempts: [], currentNativeJobId: null, runtimeInstanceId: null, nextAdmissionAt: null, createdAt: now, updatedAt: now,
            result: null, resultDelivery: 'none', deliveryReason: null, error: null, warnings: [], timeline: [], omittedEventCount: 0, firstRetainedSequence: null,
          }
          appendRunEvent(record, 'RUN_REGISTERED', '已根据保存的卡片登记工作流', now)
          await this.deps.records.createRun(record)
          return { runId, disposition: 'registered' as const }
          }
          return retryGuard ? this.deps.records.withRecordLocks([`mutation:${retryGuard.runId}`], create) : create()
        }))
      }
      return { registered, cardId, revision, workflowIds }
    })
    for (const record of await this.deps.records.listRuns()) {
      if (record.cardId !== results.cardId || record.applicability !== 'current') continue
      if (record.inputRevision !== results.revision || !results.workflowIds.includes(record.workflowId)) await this.invalidate(record, 'sourceChanged')
      else if (this.deps.registry.get(record.workflowId)?.definitionRevision !== record.definitionRevision) await this.invalidate(record, 'configurationChanged')
      else if (force && (onlyWorkflowId === undefined || record.workflowId === onlyWorkflowId) && !results.registered.some(result => result.runId === record.runId)) await this.invalidate(record, 'sourceChanged')
    }
    this.wake()
    return results.registered
  }

  /** 业务逻辑: Jobs生产者执行代码/Skill同一入口；关键判断: 激活尝试先持久、全部上下文身份固定；异常处理: 分类失败并结束尝试，成功不回滚。参数: 运行ID/job/控制。返回: 原生结局。 */
  private async executeRun(runId: string, job: KeywordJobHandle, entry: ActiveRun): Promise<KeywordJobOutcome> {
    const attemptId = randomUUID(); const token = randomUUID()
    try {
      const record = await this.mutate(runId, current => {
        if (!PENDING.has(current.executionState) || current.applicability !== 'current' || entry.abort.signal.aborted) throw new Error('WORKFLOW_ATTEMPT_STALE')
        const definition = this.deps.registry.get(current.workflowId)
        if (!definition || !definition.enabled || definition.definitionRevision !== current.definitionRevision) throw new Error('WORKFLOW_DEFINITION_STALE')
        current.executionState = 'running'; current.waitingReason = null; current.activeAttemptId = attemptId; current.activeAttemptToken = token
        current.currentNativeJobId = job.id; current.runtimeInstanceId = this.runtimeId
        current.attempts.push({ attemptId, startedAt: this.timestamp(), finishedAt: null, provider: null, model: null, executionSessionId: null, nativeJobId: job.id, runtimeInstanceId: this.runtimeId, outcome: null })
        appendRunEvent(current, 'RUN_STARTED', '工作流已由原生Jobs接纳', this.timestamp())
      })
      const log = async (message: string, details: JsonObject = {}): Promise<void> => {
        entry.abort.signal.throwIfAborted()
        const updated = await this.mutate(runId, current => {
          const attempt = current.attempts.find(item => item.attemptId === attemptId)
          if (attempt?.executionSessionId && details.executionSessionId === attempt.executionSessionId) {
            if (typeof details.provider === 'string') attempt.provider = details.provider.slice(0, 128)
            if (typeof details.model === 'string') attempt.model = details.model.slice(0, 128)
          }
          appendRunEvent(current, 'WORKFLOW_LOG', message, this.timestamp(), details)
        })
        try { job.append(updated.timeline.at(-1)!.message + '\n', { channel: 'log' }); job.updateProgress(updated.timeline.at(-1)!.message) } catch { await this.mutate(runId, current => { current.warnings.push({ code: 'NATIVE_LOG_UNAVAILABLE', message: '原生日志暂不可写，持久日志已保存' }) }) }
      }
      const scope: WorkflowAgentScope = {
        runId, signal: entry.abort.signal, log,
        onStart: async sessionId => {
          entry.abort.signal.throwIfAborted()
          await this.budget.reserve(runId, attemptId, sessionId)
          await this.mutate(runId, current => {
            entry.abort.signal.throwIfAborted()
            if (current.activeAttemptId !== attemptId || current.activeAttemptToken !== token || current.executionState !== 'running') throw new Error('WORKFLOW_ATTEMPT_STALE')
            current.attempts.find(attempt => attempt.attemptId === attemptId)!.executionSessionId = sessionId
            appendRunEvent(current, 'AGENT_STARTED', '已持久授权本次独立Agent执行', this.timestamp(), { executionSessionId: sessionId })
          })
        },
        onCleanupError: async error => {
          this.cleanupErrors.push(error); this.admissionClosed = true
          await this.mutate(runId, current => { current.warnings.push({ code: 'AGENT_CLEANUP_FAILED', message: 'Agent清理失败，已停止接纳新执行' }) })
        },
      }
      const agent = this.deps.agentFactory?.(scope, structuredClone(record)) ?? null
      const implementation = this.implementations.get(record.implementationId)
      if (!implementation) throw new Error('WORKFLOW_IMPLEMENTATION_UNAVAILABLE')
      const reader = createWorkflowContextReader(this.deps.dataRoot, record.sourceSnapshot, entry.abort.signal)
      const result = await implementation.execute({ runId, source: structuredClone(record.sourceSnapshot), mentions: structuredClone(record.mentions), options: structuredClone(record.optionsSnapshot), signal: entry.abort.signal, log, read: request => reader.read(request), agent })
      entry.abort.signal.throwIfAborted()
      await this.commitResult(runId, attemptId, token, result)
      return { status: 'completed' }
    } catch (error) {
      const raw = error instanceof Error ? error.message.split(':')[0] : ''
      const reason: WaitingReason | null = raw === 'AGENT_BUDGET_EXCEEDED' ? 'budget' : /CAPABILITY_UNAVAILABLE|AGENT_UNAVAILABLE|SKILL_UNAVAILABLE|IMPLEMENTATION_UNAVAILABLE|AGENT_CONFIG_INVALID/.test(raw) ? 'capability' : null
      await this.mutate(runId, current => {
        if (current.executionState === 'succeeded' || current.activeAttemptId !== attemptId && !PENDING.has(current.executionState)) return
        const now = this.timestamp()
        const attempt = current.attempts.find(item => item.attemptId === attemptId)
        if (attempt) { attempt.finishedAt = now; attempt.outcome = entry.abort.signal.aborted ? 'killed' : 'failed' }
        current.activeAttemptId = null; current.activeAttemptToken = null
        current.executionState = entry.abort.signal.aborted ? 'canceled' : reason ? 'waiting' : 'failed'; current.waitingReason = entry.abort.signal.aborted ? null : reason
        if (raw === 'WORKFLOW_DEFINITION_STALE') { current.executionState = 'canceled'; current.waitingReason = null; current.applicability = 'configurationChanged' }
        current.error = current.executionState === 'failed' ? { code: /^[A-Z_]{3,80}$/.test(raw) ? raw : 'WORKFLOW_EXECUTION_FAILED', message: '工作流执行失败，结果未保存' } : null
        appendRunEvent(current, entry.abort.signal.aborted ? 'RUN_CANCELED' : reason ? 'RUN_WAITING' : 'RUN_FAILED', entry.abort.signal.aborted ? '工作流已取消并完成清理' : reason ? '等待授权能力或Agent额度' : '工作流明确失败', now, reason ? { reason } : {}, 'warn')
      })
      return { status: entry.abort.signal.aborted ? 'killed' : 'failed' }
    }
  }

  /** 业务逻辑: 来源短锁核输入/定义/最新请求后一次提交历史结果；关键判断: token/attempt不匹配拒绝，旧结果仅历史；异常处理: 来源不可读区分移除，其余提交错误传播。参数: 绑定凭据/结果。返回: 已保存。 */
  private async commitResult(runId: string, attemptId: string, token: string, result: WorkflowResult): Promise<void> {
    const original = await this.deps.records.readRun(runId)
    if (!original) throw new Error('RUN_NOT_FOUND')
    let entered = false
    const save = async (source: SourceCardSnapshot | null, missing: Applicability = 'sourceUnverified'): Promise<void> => {
      const group = await this.deps.records.readRequestGroup(original.requestKey)
      await this.mutate(runId, current => {
        const definition = this.deps.registry.get(current.workflowId)
        current.applicability = !source ? missing : source.sourceRevision !== current.sourceRevision || inputRevision(source) !== current.inputRevision || group.some(run => run.requestSequence > current.requestSequence) ? 'sourceChanged' : !definition || !definition.enabled || definition.definitionRevision !== current.definitionRevision ? 'configurationChanged' : current.applicability
        completeWorkflowResult(current, result, attemptId, token, this.timestamp())
      })
    }
    try {
      await withVerifiedCardSnapshot(this.deps.dataRoot, original.sourceSnapshot, async actual => { entered = true; await save(actual) })
    } catch (error) {
      if (entered) throw error
      await save(null, (error as Error).message === 'SOURCE_REMOVED' ? 'sourceRemoved' : 'sourceUnverified')
    }
  }

  /** 业务逻辑: 写通知只处理该实际文档；关键判断: 附注不进输入、删卡取消但历史保留；异常处理: 不可读只标待复核。参数: 文档绝对路径。返回: 对账完成。 */
  async reconcileDocument(path: string): Promise<void> {
    if (this.closed) return
    const rel = relative(resolve(this.deps.dataRoot), resolve(path)).replaceAll('\\', '/')
    let sources: SourceCardSnapshot[]
    try { sources = await readDocumentSources(this.deps.dataRoot, path) } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as Error).message === 'SOURCE_REMOVED'
      for (const record of await this.deps.records.listRuns()) if (record.sourceSnapshot.relativePath === rel && record.applicability === 'current') await this.invalidate(record, missing ? 'sourceRemoved' : 'sourceUnverified')
      return
    }
    const ids = new Set(sources.map(source => cardIdentity(source)))
    for (const record of await this.deps.records.listRuns()) if (record.sourceSnapshot.relativePath === rel && !ids.has(record.cardId) && record.applicability === 'current') await this.invalidate(record, 'sourceRemoved')
    for (const source of sources) await this.registerSource(source)
  }

  /** 业务逻辑: 恢复只读已登记历史；关键判断: running标中断，成功绝不再执行，无自动历史重扫；异常处理: 损坏记录拒绝。参数: 无。返回: 恢复完成。 */
  async recover(): Promise<void> {
    if (this.closed) throw new Error('RUNTIME_CLOSED')
    for (const record of await this.deps.records.listRuns()) {
      if (record.executionState === 'running') {
        await this.mutate(record.runId, current => {
          const now = this.timestamp()
          for (const attempt of current.attempts) if (attempt.finishedAt === null) { attempt.finishedAt = now; attempt.outcome = 'failed' }
          current.activeAttemptId = null; current.activeAttemptToken = null; current.executionState = 'failed'; current.waitingReason = null
          current.error = { code: 'RUN_INTERRUPTED', message: '插件重启中断了本次执行，可手动重新运行' }
          appendRunEvent(current, 'RUN_INTERRUPTED', '未冒充接续旧Agent会话', now, {}, 'warn')
        })
      }
    }
    this.wake()
  }

  /** 业务逻辑: 只读健康态和当天已授权次数；关键判断: 不唤醒/刷新远端/写台账；异常处理: 台账错误显示storage。参数: 无。返回: 状态。 */
  async health() {
    let usage = 0; let storage = this.storageError
    try { usage = await this.budget.usage() } catch { storage = { code: 'STORAGE_UNAVAILABLE', message: '无法读取Agent预算台账' } }
    const waitingCounts: Partial<Record<WaitingReason, number>> = {}
    for (const record of await this.deps.records.listRuns()) if (record.waitingReason) waitingCounts[record.waitingReason] = (waitingCounts[record.waitingReason] ?? 0) + 1
    return { enabled: this.deps.enabled && !this.closed && !this.admissionClosed, capabilities: { jobs: this.deps.jobs !== null, agentFactory: this.deps.agentFactory !== undefined }, agentAttemptsToday: usage, agentAttemptLimit: this.deps.agentAttemptLimit, waitingCounts, storageError: storage, managementSection: 'unverified' as const }
  }

  /** 业务逻辑: 只读注册表白名单；关键判断: 不透完整options；异常处理: 无额外IO。参数: 无。返回: DTO。 */
  async registry() {
    const stored = await readWorkflowSettings(this.deps.dataRoot)
    const definitions = stored ? createWorkflowRegistry(this.implementations, stored.candidate).list() : this.deps.registry.list()
    return { settingsRevision: stored?.settingsRevision ?? this.settingsRevision, workflows: definitions.map(({ id, label, mentions, enabled, definitionRevision }) => ({ id, label, mentions: [...mentions], enabled, definitionRevision })) }
  }

  /** 业务逻辑: 只读过滤并稳定分页；关键判断: 默认20最多50，不登记执行；异常处理: 非法参数拒绝。参数: query。返回: 页。 */
  async tasks(query: TaskQuery) {
    const allowed = new Set(['workflowId', 'state', 'tradeDate', 'code', 'market', 'cursor', 'limit'])
    const limit = query.limit ?? 20
    if (Object.keys(query).some(key => !allowed.has(key)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || query.tradeDate !== undefined && !isValidIsoDate(query.tradeDate) || query.code !== undefined && !/^\d{6}$/.test(query.code)) throw new Error('QUERY_INVALID')
    let runs = (await this.deps.records.listRuns()).filter(run => (!query.workflowId || run.workflowId === query.workflowId) && (!query.state || run.executionState === query.state) && (!query.tradeDate || run.sourceSnapshot.tradeDate === query.tradeDate) && (!query.code || run.sourceSnapshot.code === query.code) && (!query.market || run.sourceSnapshot.market === query.market)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId))
    if (query.cursor) {
      let after: unknown
      try { after = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) } catch { throw new Error('QUERY_INVALID') }
      if (!Array.isArray(after) || after.length !== 2 || after.some(value => typeof value !== 'string')) throw new Error('QUERY_INVALID')
      const [createdAt, runId] = after as string[]
      runs = runs.filter(run => run.createdAt < createdAt || run.createdAt === createdAt && run.runId < runId)
    }
    const page = runs.slice(0, limit); const last = page.at(-1)
    return { tasks: page.map(toPublicTask), nextCursor: runs.length > limit && last ? Buffer.from(JSON.stringify([last.createdAt, last.runId])).toString('base64url') : null }
  }

  /** 业务逻辑: 只读单记录白名单；关键判断: 无隐式执行；异常处理: 不存在null。参数: ID。返回: DTO。 */
  async task(runId: string) { const record = await this.deps.records.readRun(runId); return record ? toPublicTask(record) : null }

  /** 业务逻辑: 只读事件分页；关键判断: <=100及真实截断事实；异常处理: 缺记录/参数拒绝。参数: ID/后序号/上限。返回: 日志页。 */
  async events(runId: string, afterSequence: number, limit: number): Promise<EventPage> {
    if (!Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error('QUERY_INVALID')
    const record = await this.deps.records.readRun(runId)
    if (!record) throw new Error('RUN_NOT_FOUND')
    const events = record.timeline.filter(event => event.sequence > afterSequence)
    const page = events.slice(0, limit)
    return { events: structuredClone(page), nextSequence: page.at(-1)?.sequence ?? afterSequence, hasMore: events.length > limit, omittedEventCount: record.omittedEventCount, firstRetainedSequence: record.firstRetainedSequence }
  }

  /** 业务逻辑: 来源卡片只读投影；关键判断: 旧裸代码身份不混市场；异常处理: 非法来源拒绝。参数: 标的/市场/日期。返回: 运行DTO。 */
  async cards(query: { readonly code: string; readonly market: import('../ident.ts').MarketPrefix | null; readonly date: string }) {
    if (!/^\d{6}$/.test(query.code) || !isValidIsoDate(query.date)) throw new Error('QUERY_INVALID')
    return (await this.deps.records.listRuns()).filter(run => run.sourceSnapshot.code === query.code && run.sourceSnapshot.market === query.market && run.sourceSnapshot.tradeDate === query.date).map(toPublicTask)
  }

  /** 业务逻辑: 以已保存当前来源显式新增运行；关键判断: 先核CAS和期望输入，保留旧历史；异常处理: 缺失/冲突拒绝。参数: retry。返回: 新运行身份。 */
  async retry(request: RetryRequest): Promise<RegistrationResult> {
    const record = await this.deps.records.readRun(request.runId)
    if (!record) throw new Error('RUN_NOT_FOUND')
    if (record.recordVersion !== request.recordVersion) throw new Error('RUN_VERSION_CONFLICT')
    if (record.inputRevision !== request.expectedInputRevision) throw new Error('RUN_INPUT_CONFLICT')
    const source = await readCardSource(this.deps.dataRoot, record.sourceSnapshot)
    if (inputRevision(source) !== request.expectedInputRevision) throw new Error('RUN_INPUT_CONFLICT')
    const results = await this.registerSavedSource(source, 'manualRetry', true, record.workflowId, request)
    const result = results.find(item => item.runId !== record.runId && item.disposition === 'registered')
    if (!result) throw new Error('WORKFLOW_NOT_TRIGGERED')
    return result
  }

  /** 业务逻辑: 取消当前自有执行并等待资源清理；关键判断: 成功不倒退，queued立即持久取消；异常处理: 版本冲突拒绝。参数: cancel。返回: 清理后的DTO。 */
  async cancel(request: CancelRequest) {
    const record = await this.mutate(request.runId, current => {
      if (current.recordVersion !== request.recordVersion) throw new Error('RUN_VERSION_CONFLICT')
      if (TERMINAL.has(current.executionState)) return
      if (PENDING.has(current.executionState)) { current.executionState = 'canceled'; current.waitingReason = null }
      else if (current.executionState === 'running') current.warnings.push({ code: 'RUN_CANCEL_REQUESTED', message: '已请求取消，正在等待执行资源清理' })
      appendRunEvent(current, 'CANCEL_REQUESTED', '用户请求取消当前工作流', this.timestamp())
    })
    const entry = this.active.get(request.runId)
    if (entry && record.executionState !== 'succeeded') {
      entry.cancelReason = request.reason.slice(0, 200); entry.abort.abort(entry.cancelReason)
      if (entry.jobId && this.deps.jobs?.owns(entry.jobId)) this.deps.jobs.kill(entry.jobId, '用户取消工作流')
      await entry.done
    }
    return (await this.task(request.runId))!
  }

  /** 业务逻辑: CAS保存工作流开关及已有选项；关键判断: 全候选校验后先原子落override再切表，不改安装资源或宿主配置；异常处理: 版本/未知键/保存失败拒绝且保留有效表。参数: 白名单设置。返回: 已持久有效表。 */
  async settings(request: SettingsRequest): Promise<Awaited<ReturnType<WorkflowRuntime['registry']>>> {
    if (this.closed) throw new Error('RUNTIME_CLOSED')
    await this.deps.records.withRecordLocks(['workflow-config'], async () => {
      const stored = await readWorkflowSettings(this.deps.dataRoot)
      const revision = stored?.settingsRevision ?? this.settingsRevision
      if (request.settingsRevision !== revision) throw new Error('RUN_VERSION_CONFLICT')
      const base = stored ? createWorkflowRegistry(this.implementations, stored.candidate).list() : this.deps.registry.list()
      if (!Array.isArray(request.workflows) || request.workflows.length > 32 || new Set(request.workflows.map(item => item.workflowId)).size !== request.workflows.length || Object.keys(request).some(key => key !== 'settingsRevision' && key !== 'workflows')) throw new Error('QUERY_INVALID')
      for (const change of request.workflows) {
        const definition = base.find(item => item.id === change.workflowId)
        if (!definition || Object.keys(change).some(key => !['workflowId', 'enabled', 'options'].includes(key)) || change.enabled !== undefined && typeof change.enabled !== 'boolean') throw new Error('QUERY_INVALID')
        if (change.options !== undefined && (!change.options || typeof change.options !== 'object' || Array.isArray(change.options) || Object.keys(change.options).some(key => !Object.hasOwn(definition.options, key)))) throw new Error('SETTINGS_OPTION_INVALID')
      }
      const candidate = definitionCandidate(base.map(definition => {
        const change = request.workflows.find(item => item.workflowId === definition.id)
        return change ? { ...definition, enabled: change.enabled ?? definition.enabled, options: { ...definition.options, ...change.options } } : definition
      }))
      createWorkflowRegistry(this.implementations, candidate)
      await writeRuntimeJson(this.deps.dataRoot, 'settings.json', { schemaVersion: 1, settingsRevision: revision + 1, candidate } as unknown as JsonValue)
      this.deps.registry.replace(candidate)
      this.settingsRevision = revision + 1
    })
    await this.reconcileConfiguration()
    this.wake()
    return this.registry()
  }

  /** 业务逻辑: 当前有效表变更后标旧运行并取消未结束；关键判断: 历史保留、取消在配置写锁外；异常处理: 持久失败传播。参数: 无。返回: 对账完成。 */
  private async reconcileConfiguration(): Promise<void> {
    for (const record of await this.deps.records.listRuns()) {
      const definition = this.deps.registry.get(record.workflowId)
      if ((!definition || !definition.enabled || definition.definitionRevision !== record.definitionRevision) && record.applicability === 'current') await this.invalidate(record, 'configurationChanged')
    }
  }

  /** 业务逻辑: root读取候选后整体重载并对账旧定义；关键判断: 失败保留原表、旧成功历史不删；异常处理: 缺候选读取能力明确拒绝。参数: 无。返回: 当前表。 */
  async reload() {
    if (!this.deps.reloadCandidate) throw new Error('REGISTRY_RELOAD_UNAVAILABLE')
    this.deps.registry.replace(await this.deps.reloadCandidate())
    this.settingsRevision = (await readWorkflowSettings(this.deps.dataRoot))?.settingsRevision ?? this.settingsRevision + 1
    await this.reconcileConfiguration()
    this.wake()
    return this.registry()
  }

  /** 业务逻辑: 用户显式日期范围重扫；关键判断: <=31自然日且每页最多50文档、相同输入去重；异常处理: 非法日期/部分目录拒绝。参数: 范围/游标。返回: 登记统计。 */
  async rescan(request: RescanRequest) {
    if (!isValidIsoDate(request.dateFrom) || !isValidIsoDate(request.dateTo)) throw new Error('RESCAN_RANGE_INVALID')
    const start = Date.parse(request.dateFrom + 'T00:00:00Z'); const end = Date.parse(request.dateTo + 'T00:00:00Z')
    if (end < start || (end - start) / 86_400_000 >= 31) throw new Error('RESCAN_RANGE_INVALID')
    const months = new Set<string>()
    for (let day = start; day <= end; day += 86_400_000) months.add(new Date(day).toISOString().slice(0, 7).replace('-', ''))
    const files: string[] = []
    for (const month of months) {
      const names = await readdir(join(this.deps.dataRoot, 'DB/review', month)).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })
      for (const name of names) {
        const compact = /_(\d{8})\.md$/.exec(name)?.[1]
        if (!compact) continue
        const date = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`
        if (date >= request.dateFrom && date <= request.dateTo) files.push(`DB/review/${month}/${name}`)
      }
    }
    files.sort()
    const cursors = new Map(files.map(file => [createHash('sha256').update(file).digest('base64url'), file]))
    let cursor: string | undefined
    if (request.cursor !== undefined) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(request.cursor)) throw new Error('QUERY_INVALID')
      cursor = cursors.get(request.cursor)
      if (cursor === undefined) throw new Error('QUERY_INVALID')
    }
    const candidates = files.filter(file => cursor === undefined || file > cursor)
    let registered = 0; let reused = 0
    const page = candidates.slice(0, 50)
    for (const file of page) for (const source of await readDocumentSources(this.deps.dataRoot, resolve(this.deps.dataRoot, file))) for (const result of await this.registerSource(source, 'explicitRescan')) result.disposition === 'registered' ? registered++ : reused++
    return { registered, reused, nextCursor: candidates.length > 50 ? createHash('sha256').update(page.at(-1)!).digest('base64url') : null }
  }

  /** 业务逻辑: 等待已安排接纳及生产者清理；关键判断: waiting不制造新运行或阻塞无限期；异常处理: 持久失败明确报告。参数: 无。返回: 排空。 */
  async drain(): Promise<void> {
    while (this.pumping || this.active.size > 0) { await this.pumping; await Promise.all([...this.active.values()].map(entry => entry.done)) }
    if (this.storageError) throw new Error(this.storageError.code)
    if (this.cleanupErrors.length > 0) throw new Error('WORKFLOW_CLEANUP_FAILED')
  }

  /** 业务逻辑: 停接纳、协作取消并等done后卸载Jobs；关键判断: 幂等且不先释放容量；异常处理: 清理错误汇总。参数: 无。返回: 卸载完成。 */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.closed = true
    this.disposal = (async () => {
      await this.pumping
      for (const entry of this.active.values()) { entry.cancelReason = '插件卸载'; entry.abort.abort(entry.cancelReason) }
      const settled = await Promise.allSettled([...this.active.values()].map(entry => entry.done))
      for (const result of settled) if (result.status === 'rejected') this.cleanupErrors.push(result.reason)
      try { await this.deps.jobs?.dispose() } catch (error) { this.cleanupErrors.push(error) }
      if (this.cleanupErrors.length) throw new AggregateError(this.cleanupErrors, 'WORKFLOW_CLEANUP_FAILED')
    })()
    return this.disposal
  }
}
