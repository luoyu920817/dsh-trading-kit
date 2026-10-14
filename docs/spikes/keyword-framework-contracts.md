# 关键词工作流公共契约（2026-10-11 修订）

本文以当前 `src/review/processors/types.ts` 为准。旧六方法、公共 stage、data/agent 双分支和强制预期观察协议已移除；没有旧生产记录消费者，仅测试 fixture 随新契约迁移。`host-jobs.ts` 与 parser 签名不变。

## 实际导出和接入方式

```ts
interface WorkflowDefinition {
  readonly id: string
  readonly label: string
  readonly mentions: readonly string[]
  readonly enabled: boolean
  readonly implementationId: string
  readonly options: JsonObject
  readonly definitionRevision: string
}
interface WorkflowImplementation {
  readonly id: string
  execute(context: WorkflowExecutionContext): Promise<WorkflowResult>
}
interface WorkflowResult { readonly summary: string; readonly data?: JsonValue }
interface WorkflowExecutionContext extends ControlledContextReader {
  readonly runId: string
  readonly source: SourceCardSnapshot
  readonly mentions: readonly RecognizedMention[]
  readonly options: JsonObject
  readonly signal: AbortSignal
  readonly agent: ControlledWorkflowAgent | null
  log(message: string, details?: JsonObject): Promise<void>
}
interface ControlledContextReader {
  read(request: ContextReadRequest): Promise<readonly FrozenEvidence[]>
}
interface ControlledWorkflowAgent {
  run(request: WorkflowAgentRequest): Promise<WorkflowResult>
}
interface WorkflowAgentRequest { readonly prompt: string; readonly skillId?: string }
```

上下文由受控运行服务提供。代码工作流可组织读取、条件、多个 Agent 步骤和日志；Skill 适配也只实现 execute，无六方法空实现。Agent 能力缺失显式为 null；provider/model/cwd、来源、权限和运行关联固定于服务闭包，不让模型请求选择。Skill 受信注册/作用域/版本核验由真实适配器承担，`skillId` 声明本身不是核验实现。

测试专用 `textModule` 只有 id/execute，使用授权 read 和异步 log；`skillTextModule` 同接口调用受控 agent.run，未提供能力则拒绝。它们没有生产注册，不假造宿主模型成功。

## 来源、命中和指纹

SourceCardRef 为 relativePath/anchor/market/code/tradeDate；snapshot 增加原正文 body、sourceRevision 和 verification='verified'。market=null 保留原裸代码来源身份。来源无法读取、变化、移除分别由 applicability 表达，不能伪造 verified 快照。

parser 的 Mention/RecognizedMention/ParsedMentions/ParseMentions 保持签名：

```ts
type ParseMentions = (body: string, aliases: ReadonlyMap<string, string>) => ParsedMentions
interface Mention { readonly raw: string; readonly name: string; readonly start: number; readonly end: number }
interface RecognizedMention extends Mention { readonly processorId: string }
interface ParsedMentions { readonly recognized: readonly RecognizedMention[]; readonly unknown: readonly Mention[] }
```

processorId 在 parser 输出中仅桥接 workflowId。UTF-16 原文半开区间，raw 等于 body.slice(start,end)。全部命中交给工作流，整卡默认参与 inputRevision；实际摘要计算由身份/登记服务实现，types 不伪造指纹。规范关键词只绑定一个定义，定义及有效参数变更必须改变 definitionRevision；注册表具体规范化和指纹算法以 registry 真实实现为准。

## 运行记录和公开DTO

WorkflowRunRecord 已取代旧 KeywordTaskRecord。标识为 runId/cardId/workflowId/workflowLabel/implementationId；保留 requestKey/requestSequence、原 sourceSnapshot、sourceRevision/inputRevision/definitionRevision、optionsSnapshot、执行状态、适用性、尝试/私有凭据、原生 Jobs 和 Agent 会话、结果、日志及截断计数。补 triggerReason 和 mentions；不保留 stage/moduleInput/preparedSnapshot/preparationToken/contextRevision/evidenceRevision。

WorkflowResultEnvelope 在 summary/data 外冻结 inputRevision/definitionRevision/generatedAt/declaration。业务输出结构由实现负责，运行服务做 JSON/摘要合法性、权限与来源版本核验；不把预期字段当通用 schema。

真实导出函数：

- `assertTaskInvariants(task: WorkflowRunRecord): void`：请求序号正整数；waiting 原因一致；全部未结束尝试至多一个，running 必须一个且匹配 activeAttemptId 和私有 token；非 running 不得遗留未结束尝试或活动凭据；succeeded/result/delivery 一致。
- `toPublicTask(task: WorkflowRunRecord): PublicWorkflowRunDTO`：显式逐字段白名单，不传正文/配置/实现ID/cwd/凭据/未知结果字段；命中仅 name/start/end；结果 data 深复制，来源/命中/尝试/错误/警告均为独立副本。

PublicTaskDTO/KeywordTaskEvent 仅为客户端旧类型名别名，不是另一套运行协议。客户端同时导出新 PublicWorkflowRunDTO/WorkflowRunEvent/PublicMention/PublicWorkflowDefinition。公开列表不直接带 timeline；日志经独立鉴权入口分页。业务 data 和日志字符串脱敏由结果/trace 服务保证，DTO 投影不声称能识别任意字符串里的秘密。

## 下游准确声明

```ts
interface WorkflowRecordStore {
  readRun(runId: string): Promise<WorkflowRunRecord | null>
  readRequestGroup(requestKey: string): Promise<readonly WorkflowRunRecord[]>
  createRun(record: WorkflowRunRecord): Promise<void>
  updateRun(record: WorkflowRunRecord, expectedRecordVersion: number): Promise<WorkflowRunRecord>
  withRecordLocks<T>(recordKeys: readonly string[], commit: () => Promise<T>): Promise<T>
}
interface InitialRequest {
  readonly kind: 'initial'
  readonly workflowId: string
  readonly cardId: string
  readonly source: SourceCardSnapshot
  readonly mentions: readonly RecognizedMention[]
  readonly options: JsonObject
  readonly inputRevision: string
  readonly definitionRevision: string
  readonly triggerReason: string
}
interface FollowupRequest extends Omit<InitialRequest, 'kind'> {
  readonly kind: 'followup'
  readonly sourceInputRevision: string
  readonly earliestRunAt: string
}
type RegistrationRequest = InitialRequest | FollowupRequest
interface RegistrationResult { readonly runId: string; readonly disposition: 'registered' | 'reused' }
interface ProcessingScheduler {
  registerRequest(request: RegistrationRequest): Promise<RegistrationResult>
  wake(reason: string): void
  drain(): Promise<void>
}
```

类型声明不等于 records/scheduler 的实现。请求由代码固定原卡片关联；后续请求保留 sourceInputRevision，不开放模型自行选来源。原生重试属于 attempts，显式重跑创建新 requestSequence 和 runId。来源锁 → 配置锁 → 请求组锁 → 同层运行锁；网络、Jobs.start、Agent 创建/清理在锁外。

ProcessingService 保留 health/registry/tasks/task/events/cards/retry/cancel/settings/reload/rescan 声明。task/events 使用 runId，TaskQuery 使用 workflowId，无 stage。RegistryDTO 为 `{settingsRevision,workflows}`，公开定义只有 id/label/mentions/enabled/definitionRevision，无完整 options。SettingsRequest 修改受控 workflows 列表。RetryRequest/CancelRequest 使用 runId/recordVersion，重跑还核 expectedInputRevision。

## 本 worker 验证和边界

迁移前回归实测失败：两个不同未结束 attempt 被旧函数接受；DTO 缺 triggerReason/mentions；fixture 没有 execute。迁移后 types 14 条、parser 19 条、client 默认槽 1 条通过，共 34 passed/4 skipped。4 skip 是默认未提供真实宿主探针路径，不属于 live Agent/页面验收。

未调用交易/行情、未写真实 vault、未个人 profile 部署重启、未自动提交或引入依赖。公共契约本身不承诺 Agent/Skill 实机、生产注册、任务持久化或正式日志管理页完成；这些由对应模块独立交付证据。
