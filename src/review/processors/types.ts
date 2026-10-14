/** 关键词 → 工作流契约；类型声明不代表宿主或持久服务已实现。 */
import type { MarketPrefix } from '../ident.ts'

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }
export type ExecutionState = 'queued' | 'waiting' | 'preparing' | 'running' | 'retryWaiting' | 'succeeded' | 'failed' | 'canceled'
export type Applicability = 'current' | 'sourceChanged' | 'sourceRemoved' | 'sourceUnverified' | 'configurationChanged'
export type ResultDelivery = 'none' | 'pending' | 'complete' | 'obsolete'
export type WaitingReason = 'workflowDisabled' | 'sourceNeedsReview' | 'capability' | 'budget' | 'hostCapacity' | 'storage'

/** 原始Card.body的UTF-16半开区间；raw必须等于body.slice(start,end)。 */
export interface Mention { readonly raw: string; readonly name: string; readonly start: number; readonly end: number }
/** processorId仅保留parser签名，值桥接workflowId。 */
export interface RecognizedMention extends Mention { readonly processorId: string }
export interface ParsedMentions { readonly recognized: readonly RecognizedMention[]; readonly unknown: readonly Mention[] }
export type ParseMentions = (body: string, aliases: ReadonlyMap<string, string>) => ParsedMentions
export interface PublicMention { readonly name: string; readonly start: number; readonly end: number }

/** 实际文档身份；market=null保留旧裸代码文档，不按裸代码追随外部改名。 */
export interface SourceCardRef {
  readonly relativePath: string; readonly anchor: string; readonly market: MarketPrefix | null; readonly code: string; readonly tradeDate: string
}
export interface SourceCardSnapshot extends SourceCardRef {
  readonly body: string; readonly sourceRevision: string; readonly verification: 'verified'
}
export type ContextKind = 'card' | 'role' | 'history' | 'tracking' | 'marketEvidence'
export interface ContextReadRequest { readonly kind: ContextKind; readonly limit?: number }
export interface FrozenEvidence { readonly id: string; readonly kind: ContextKind; readonly content: JsonValue; readonly revision: string }
export interface ControlledContextReader {
  /** 业务逻辑: 读取代码授权材料；关键判断: 无任意路径/SQL；异常处理: 缺能力明确拒绝。参数: 类型/上限。返回: 编号证据。 */
  read(request: ContextReadRequest): Promise<readonly FrozenEvidence[]>
}
export interface WorkflowResult { readonly summary: string; readonly data?: JsonValue }
/** 受信工作流提供请求；来源/模型/cwd/凭据固定于能力闭包。 */
export interface WorkflowAgentRequest { readonly prompt: string; readonly skillId?: string }
export interface ControlledWorkflowAgent {
  /** 业务逻辑: 执行授权Agent步骤；关键判断: 身份不由模型改写；异常处理: 取消/缺能力拒绝。参数: 提示词/受信Skill。返回: 步骤结果。 */
  run(request: WorkflowAgentRequest): Promise<WorkflowResult>
}
export interface WorkflowDefinition {
  readonly id: string; readonly label: string; readonly mentions: readonly string[]; readonly enabled: boolean
  readonly implementationId: string; readonly options: JsonObject; readonly definitionRevision: string
}
export interface WorkflowExecutionContext extends ControlledContextReader {
  readonly runId: string; readonly source: SourceCardSnapshot; readonly mentions: readonly RecognizedMention[]
  readonly options: JsonObject; readonly signal: AbortSignal
  /** null表示未提供已核验Agent能力。 */
  readonly agent: ControlledWorkflowAgent | null
  /** 业务逻辑: 持久化脱敏步骤日志；关键判断: 不改变来源/结果；异常处理: 存储失败传播。参数: 消息/安全细节。返回: 落盘完成。 */
  log(message: string, details?: JsonObject): Promise<void>
}
export interface WorkflowImplementation {
  readonly id: string
  /** 业务逻辑: 工作流自行编排并返回结果；关键判断: 单入口，生命周期由框架承接；异常处理: 取消/失败抛出。参数: 受控上下文。返回: 摘要/数据。 */
  execute(context: WorkflowExecutionContext): Promise<WorkflowResult>
}
export interface WorkflowAttempt {
  attemptId: string; startedAt: string; finishedAt: string | null; provider: string | null; model: string | null
  executionSessionId: string | null; nativeJobId: string; runtimeInstanceId: string; outcome: 'completed' | 'killed' | 'failed' | null
}
export interface WorkflowRunEvent {
  sequence: number; eventId: string; occurredAt: string; level: 'info' | 'warn' | 'error'; code: string; message: string
  runId: string; attemptId: string | null; nativeJobId: string | null; executionSessionId: string | null
  details: Record<string, string | number | boolean | null>
}
export interface TaskIssue { readonly code: string; readonly message: string }
export interface WorkflowResultEnvelope extends WorkflowResult {
  readonly inputRevision: string; readonly definitionRevision: string; readonly generatedAt: string; readonly declaration: string
}
/** 私有来源/配置/尝试凭据不进管理页；整卡指纹由运行服务计算。 */
export interface WorkflowRunRecord {
  schemaVersion: 1; recordVersion: number
  runId: string; cardId: string; workflowId: string; workflowLabel: string; implementationId: string
  requestKey: string; requestSequence: number; triggerReason: string
  sourceSnapshot: SourceCardSnapshot; mentions: readonly RecognizedMention[]
  sourceRevision: string; inputRevision: string; definitionRevision: string; optionsSnapshot: JsonObject
  executionState: ExecutionState; waitingReason: WaitingReason | null; applicability: Applicability
  activeAttemptToken: string | null; activeAttemptId: string | null
  attempts: WorkflowAttempt[]; currentNativeJobId: string | null; runtimeInstanceId: string | null; nextAdmissionAt: string | null
  createdAt: string; updatedAt: string
  result: WorkflowResultEnvelope | null; resultDelivery: ResultDelivery; deliveryReason: string | null
  error: TaskIssue | null; warnings: TaskIssue[]
  timeline: WorkflowRunEvent[]; omittedEventCount: number; firstRetainedSequence: number | null
}
/** 显式白名单；result内容由受控结果服务先脱敏。 */
export interface PublicWorkflowRunDTO {
  recordVersion: number; runId: string; cardId: string; workflowId: string; workflowLabel: string; requestSequence: number
  triggerReason: string; mentions: readonly PublicMention[]; source: SourceCardRef
  sourceRevision: string; inputRevision: string; definitionRevision: string
  executionState: ExecutionState; waitingReason: WaitingReason | null; applicability: Applicability
  attempts: readonly WorkflowAttempt[]; currentNativeJobId: string | null; runtimeInstanceId: string | null
  nextAdmissionAt: string | null; createdAt: string; updatedAt: string
  result: WorkflowResultEnvelope | null; resultDelivery: ResultDelivery; deliveryReason: string | null
  error: TaskIssue | null; warnings: readonly TaskIssue[]; omittedEventCount: number; firstRetainedSequence: number | null
}
/** 仅客户端旧类型名兼容，无第二份运行记录协议。 */
export type PublicTaskDTO = PublicWorkflowRunDTO
export type KeywordTaskEvent = WorkflowRunEvent

/**
 * 核验运行状态不变量，供持久写入复用。
 * 业务逻辑: 检查序号、等待、活动尝试和结果一致性。
 * 关键判断: 全体未结束尝试至多一个，存在时必须属于running且匹配当前ID和凭据。
 * 异常处理: 抛稳定错误码，不修补坏记录。
 * 参数: task为内部记录。返回: 合法无值。
 */
export function assertTaskInvariants(task: WorkflowRunRecord): void {
  if (!Number.isSafeInteger(task.requestSequence) || task.requestSequence < 1) throw new Error('INVALID_REQUEST_SEQUENCE')
  if (task.executionState === 'waiting' && task.waitingReason === null) throw new Error('WAITING_REASON_REQUIRED')
  if (task.executionState !== 'waiting' && task.waitingReason !== null) throw new Error('UNEXPECTED_WAITING_REASON')
  const unfinished = task.attempts.filter(a => a.finishedAt === null)
  if (unfinished.length > 1 || (task.executionState === 'running'
    ? unfinished.length !== 1 || unfinished[0]?.attemptId !== task.activeAttemptId || !task.activeAttemptToken
    : unfinished.length !== 0 || task.activeAttemptId !== null || task.activeAttemptToken !== null)) throw new Error('CURRENT_ATTEMPT_REQUIRED')
  if (task.executionState === 'succeeded' && task.result === null) throw new Error('RESULT_REQUIRED')
  if ((task.result !== null) !== (task.executionState === 'succeeded') || (task.result === null ? task.resultDelivery !== 'none' : task.resultDelivery === 'none')) throw new Error('INVALID_RESULT_DELIVERY')
}

/**
 * 将内部运行投影为公开DTO。
 * 业务逻辑: 逐字段复制审阅白名单和结果；关键判断: 禁止剩余属性展开或可变引用穿透。
 * 异常处理: 调用者先校验不可信磁盘JSON及脱敏业务字符串。
 * 参数: task为已核验记录。返回: 独立公开副本。
 */
export function toPublicTask(task: WorkflowRunRecord): PublicWorkflowRunDTO {
  const source = task.sourceSnapshot
  const result = task.result
  return {
    recordVersion: task.recordVersion, runId: task.runId, cardId: task.cardId, workflowId: task.workflowId, workflowLabel: task.workflowLabel, requestSequence: task.requestSequence,
    triggerReason: task.triggerReason, mentions: task.mentions.map(m => ({ name: m.name, start: m.start, end: m.end })),
    source: { relativePath: source.relativePath, anchor: source.anchor, market: source.market, code: source.code, tradeDate: source.tradeDate },
    sourceRevision: task.sourceRevision, inputRevision: task.inputRevision, definitionRevision: task.definitionRevision,
    executionState: task.executionState, waitingReason: task.waitingReason, applicability: task.applicability,
    attempts: task.attempts.map(a => ({ attemptId: a.attemptId, startedAt: a.startedAt, finishedAt: a.finishedAt, provider: a.provider, model: a.model, executionSessionId: a.executionSessionId, nativeJobId: a.nativeJobId, runtimeInstanceId: a.runtimeInstanceId, outcome: a.outcome })),
    currentNativeJobId: task.currentNativeJobId, runtimeInstanceId: task.runtimeInstanceId, nextAdmissionAt: task.nextAdmissionAt,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    result: result === null ? null : { summary: result.summary, ...(result.data === undefined ? {} : { data: structuredClone(result.data) }), inputRevision: result.inputRevision, definitionRevision: result.definitionRevision, generatedAt: result.generatedAt, declaration: result.declaration },
    resultDelivery: task.resultDelivery, deliveryReason: task.deliveryReason,
    error: task.error === null ? null : { code: task.error.code, message: task.error.message }, warnings: task.warnings.map(w => ({ code: w.code, message: w.message })),
    omittedEventCount: task.omittedEventCount, firstRetainedSequence: task.firstRetainedSequence,
  }
}

/** 请求身份只由受信代码创建，模型不能选择来源或目标。 */
export interface InitialRequest {
  readonly kind: 'initial'; readonly workflowId: string; readonly cardId: string; readonly source: SourceCardSnapshot
  readonly mentions: readonly RecognizedMention[]; readonly options: JsonObject
  readonly inputRevision: string; readonly definitionRevision: string; readonly triggerReason: string
}
export interface FollowupRequest extends Omit<InitialRequest, 'kind'> {
  readonly kind: 'followup'; readonly sourceInputRevision: string; readonly earliestRunAt: string
}
export type RegistrationRequest = InitialRequest | FollowupRequest
export interface RegistrationResult { readonly runId: string; readonly disposition: 'registered' | 'reused' }
export interface ProcessingScheduler {
  /** 业务逻辑: 登记并去重；关键判断: 来源由代码固定；异常处理: 冲突拒绝。参数: 请求。返回: 运行身份。 */
  registerRequest(request: RegistrationRequest): Promise<RegistrationResult>
  /** 业务逻辑: 安排接纳；关键判断: 不保证立即执行；异常处理: 健康态记录。参数: 原因。返回: 无。 */
  wake(reason: string): void
  /** 业务逻辑: 排空工作；关键判断: 不创建运行；异常处理: 失败传播。参数: 无。返回: 完成。 */
  drain(): Promise<void>
}
export type VerifiedCardCommit<T> = (actual: SourceCardSnapshot) => Promise<T>
export type WithVerifiedCardSnapshot = <T>(dataRoot: string, sourceRef: SourceCardRef, commit: VerifiedCardCommit<T>) => Promise<T>
export interface WorkflowRecordStore {
  /** 业务逻辑: 读取校验运行；关键判断: 非提交证明；异常处理: 损坏拒绝。参数: ID。返回: 记录或null。 */
  readRun(runId: string): Promise<WorkflowRunRecord | null>
  /** 业务逻辑: 完整读请求组；关键判断: 不按mtime取赢家；异常处理: 部分目录拒绝。参数: 键。返回: 历史。 */
  readRequestGroup(requestKey: string): Promise<readonly WorkflowRunRecord[]>
  /** 业务逻辑: 原子新建；关键判断: create-only；异常处理: 冲突拒绝。参数: 初始记录。返回: 无。 */
  createRun(record: WorkflowRunRecord): Promise<void>
  /** 业务逻辑: CAS更新；关键判断: 递增一次；异常处理: 版本不匹配拒绝。参数: 记录/版本。返回: 新记录。 */
  updateRun(record: WorkflowRunRecord, expectedRecordVersion: number): Promise<WorkflowRunRecord>
  /** 业务逻辑: 同层锁排序；关键判断: 网络锁外；异常处理: 释放并传播。参数: 键/短回调。返回: 回调结果。 */
  withRecordLocks<T>(recordKeys: readonly string[], commit: () => Promise<T>): Promise<T>
}
export interface TaskQuery { readonly workflowId?: string; readonly state?: ExecutionState; readonly tradeDate?: string; readonly code?: string; readonly market?: MarketPrefix; readonly cursor?: string; readonly limit?: number }
export interface TaskPage { readonly tasks: readonly PublicWorkflowRunDTO[]; readonly nextCursor: string | null }
export interface EventPage { readonly events: readonly WorkflowRunEvent[]; readonly nextSequence: number; readonly hasMore: boolean; readonly omittedEventCount: number; readonly firstRetainedSequence: number | null }
export interface ProcessingHealth {
  readonly enabled: boolean; readonly capabilities: Readonly<Record<string, boolean>>; readonly agentAttemptsToday: number; readonly agentAttemptLimit: number
  readonly waitingCounts: Readonly<Partial<Record<WaitingReason, number>>>; readonly storageError: TaskIssue | null; readonly managementSection: 'unverified' | 'available' | 'unavailable'
}
export type PublicWorkflowDefinition = Pick<WorkflowDefinition, 'id' | 'label' | 'mentions' | 'enabled' | 'definitionRevision'>
export interface RegistryDTO { readonly settingsRevision: number; readonly workflows: readonly PublicWorkflowDefinition[] }
export interface TaskMutationRequest { readonly runId: string; readonly recordVersion: number }
export interface RetryRequest extends TaskMutationRequest { readonly expectedInputRevision: string }
export interface CancelRequest extends TaskMutationRequest { readonly reason: string }
export interface SettingsRequest { readonly settingsRevision: number; readonly workflows: readonly { readonly workflowId: string; readonly enabled?: boolean; readonly options?: JsonObject }[] }
export interface RescanRequest { readonly dateFrom: string; readonly dateTo: string; readonly cursor?: string }
export interface RescanResult { readonly registered: number; readonly reused: number; readonly nextCursor: string | null }
/** HTTP共享服务声明；只读入口不登记、唤醒或执行模型。 */
export interface ProcessingService {
  /** 业务逻辑: 读健康态；关键判断: 不刷新远端；异常处理: 存储错误字段。参数: 无。返回: 健康。 */
  health(): Promise<ProcessingHealth>
  /** 业务逻辑: 读有效表；关键判断: 不重载；异常处理: 失败传播。参数: 无。返回: DTO。 */
  registry(): Promise<RegistryDTO>
  /** 业务逻辑: 分页；关键判断: 默认20最多50；异常处理: 非法拒绝。参数: 查询。返回: 页。 */
  tasks(query: TaskQuery): Promise<TaskPage>
  /** 业务逻辑: 单运行查询；关键判断: 无凭据；异常处理: 缺失null。参数: ID。返回: DTO。 */
  task(runId: string): Promise<PublicWorkflowRunDTO | null>
  /** 业务逻辑: 日志分页；关键判断: <=100；异常处理: 非法拒绝。参数: ID/序号/上限。返回: 页。 */
  events(runId: string, afterSequence: number, limit: number): Promise<EventPage>
  /** 业务逻辑: 卡片投影；关键判断: 缺记录不登记；异常处理: 来源失败传播。参数: 来源。返回: DTO列表。 */
  cards(query: { readonly code: string; readonly market: MarketPrefix | null; readonly date: string }): Promise<readonly PublicWorkflowRunDTO[]>
  /** 业务逻辑: 新序号重跑；关键判断: 历史保留；异常处理: CAS冲突。参数: 期望版本。返回: 新运行。 */
  retry(request: RetryRequest): Promise<RegistrationResult>
  /** 业务逻辑: 取消自有执行；关键判断: 不回滚成功；异常处理: CAS冲突。参数: 原因/版本。返回: DTO。 */
  cancel(request: CancelRequest): Promise<PublicWorkflowRunDTO>
  /** 业务逻辑: 白名单设置；关键判断: 不改宿主总闸；异常处理: 版本冲突。参数: 设置。返回: 表。 */
  settings(request: SettingsRequest): Promise<RegistryDTO>
  /** 业务逻辑: 重载候选；关键判断: 失败留旧；异常处理: 明确错误。参数: 无。返回: 表。 */
  reload(): Promise<RegistryDTO>
  /** 业务逻辑: 有界重扫；关键判断: <=31日；异常处理: 部分不判删除。参数: 范围。返回: 统计。 */
  rescan(request: RescanRequest): Promise<RescanResult>
}
