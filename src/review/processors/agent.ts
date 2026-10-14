/** 当前安装 DSH 0.2 的最小文本 Agent 适配；不继承主聊天，不给模型文件或通用工具。 */
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { ControlledWorkflowAgent, JsonObject, WorkflowAgentRequest, WorkflowResult } from './types.ts'

interface HostEvent { readonly type: string; readonly data: unknown }
interface HostUserMessage {
  readonly id: string
  readonly role: 'user'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
  readonly source: { readonly kind: string }
}
interface HostScopedContext {
  get(name: 'tools'): {
    presentAs(mode: 'native'): unknown
    restrict(filter: { allow: readonly string[] }): unknown
    guard(check: () => string): unknown
  } | undefined
}
interface HostAgent {
  readonly id: string
  readonly session: { snapshotEvents(): readonly HostEvent[] }
  followup(message: HostUserMessage): void
  cancel(cause: { readonly kind: 'hook'; readonly reason: string }): void
  whenIdle(): Promise<void>
}
export interface WorkflowAgentHost {
  readonly agents?: {
    create(options: {
      readonly sessionId: string
      readonly meta: { readonly cwd: string }
      readonly agentOptions: { readonly provider: string; readonly model: string; readonly maxTokens: number }
      readonly signal: AbortSignal
      readonly setup: (context: HostScopedContext, agent: HostAgent) => Promise<void>
    }): Promise<{ readonly agent: HostAgent; dispose(): Promise<void> }>
  }
  readonly skills?: {
    get(name: string, options: { readonly scope: HostAgent; readonly cwd: string; readonly signal: AbortSignal }): Promise<{
      readonly name: string; readonly content: string; readonly provider: string; readonly source: string; readonly path?: string
    } | undefined>
  }
}
export interface WorkflowAgentConfig {
  readonly provider: string
  readonly model: string
  readonly cwd: string
  readonly maxTokens: number
  readonly timeoutMs: number
  readonly allowedSkills?: readonly string[]
}
export interface WorkflowAgentScope {
  readonly runId: string
  readonly signal: AbortSignal
  /** 业务逻辑: 写本次持久日志；关键判断: 无主聊天出口；异常处理: 写失败传播。参数: 信息/事实。返回: 无值。 */
  log(message: string, details?: JsonObject): Promise<void>
  /** 业务逻辑: 先持久启动与额度事实；关键判断: 成功后才followup；异常处理: 拒绝则不激活。参数: 精确sessionId。返回: 无值。 */
  onStart(sessionId: string): Promise<void>
  /** 业务逻辑: 清理失败关闭全局接纳；关键判断: 保留合法结果；异常处理: 错误交协调器。参数: 清理错误。返回: 无值。 */
  onCleanupError?(error: unknown): Promise<void>
}

/**
 * 读取未知对象的字段。
 * 业务逻辑: 仅普通非数组对象可读；关键判断: 不给不可信值强制类型；异常处理: 非对象返回undefined。
 * 参数: value为未知值，key为字段。返回: 字段或undefined。
 */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined
}

/**
 * 为管理日志生成Skill实际来源指纹。
 * 业务逻辑: 保留允许Skill名/provider与正文哈希，来源/path只参与哈希。
 * 关键判断: 公开日志不包含实际文件路径或Skill正文；来源内容变化都改变指纹。
 * 异常处理: 上游先校验实际Skill类型，此处不读取文件。
 * 参数: 实际加载Skill。返回: 可安全持久化日志事实。
 */
export function workflowSkillLogFacts(skill: { readonly name: string; readonly provider: string; readonly source: string; readonly path?: string; readonly content: string }): JsonObject {
  return {
    skillId: skill.name,
    provider: isAbsolute(skill.provider) ? 'filesystem' : skill.provider,
    contentHash: createHash('sha256').update(skill.content).digest('hex'),
    sourceHash: createHash('sha256').update(JSON.stringify([skill.provider, skill.source, skill.path ?? null])).digest('hex'),
  }
}

/**
 * 从当前独立会话的完成事件收集 JSON 结果。
 * 业务逻辑: 最后turn须completed，取该turn最后完整assistant文本；核summary/data白名单。
 * 关键判断: idle、截断、工具块、越权身份字段和早先turn结果均不能成功。
 * 异常处理: 不合法统一拒绝，不猜测或修复模型JSON。
 * 参数: events为本次会话事件。返回: 脱离事件的合法结果。
 */
export function readWorkflowAgentResult(events: readonly HostEvent[]): WorkflowResult {
  const end = events.findLast(event => event.type === 'turn/end')
  if (field(field(end?.data, 'reason'), 'kind') !== 'completed') throw new Error('KEYWORD_AGENT_RESULT_INVALID')
  const turn = field(end?.data, 'turn')
  const message = events.findLast(event => event.type === 'assistant/message' && field(event.data, 'turn') === turn)
  const blocks = field(field(message?.data, 'message'), 'content')
  if (!Array.isArray(blocks) || !blocks.length || field(message?.data, 'interrupted') === true || blocks.some(block => !['text', 'reasoning'].includes(String(field(block, 'type'))) || typeof field(block, 'text') !== 'string')) throw new Error('KEYWORD_AGENT_RESULT_INVALID')
  const text = blocks.filter(block => field(block, 'type') === 'text').map(block => field(block, 'text')).join('')
  if (text.length > 128 * 1024) throw new Error('KEYWORD_AGENT_RESULT_INVALID')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('KEYWORD_AGENT_RESULT_INVALID') }
  const summary = field(value, 'summary')
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 16_384 || Object.keys(value as object).some(key => key !== 'summary' && key !== 'data')) throw new Error('KEYWORD_AGENT_RESULT_INVALID')
  const pending = [value]
  while (pending.length) {
    const next = pending.pop()
    if (typeof next === 'number' && !Number.isFinite(next)) throw new Error('KEYWORD_AGENT_RESULT_INVALID')
    if (next !== null && typeof next === 'object') pending.push(...Object.values(next))
  }
  return value as WorkflowResult
}

/**
 * 为一次工作流绑定受控 Agent 能力。
 * 业务逻辑: 显式配置新会话、限制全部工具、按实际scope读Skill；持久启动后才激活并收集当前JSON结果。
 * 关键判断: 无seed/parentAgent，模型仅接收业务给定prompt；每次run新session且不得并发重入。
 * 异常处理: 缺能力/非法配置/取消明确拒绝；dispose排空后返回，清理失败关闭接纳并保留已合法结果。
 * 参数: host为真实root服务，config为代码配置，scope为本次持久运行闭包。返回: 单入口Agent能力。
 */
export function createWorkflowAgentAdapter(host: WorkflowAgentHost, config: WorkflowAgentConfig, scope: WorkflowAgentScope): ControlledWorkflowAgent {
  if (!config.provider?.trim() || !config.model?.trim() || !config.cwd || !isAbsolute(config.cwd) || !Number.isSafeInteger(config.maxTokens) || config.maxTokens <= 0 || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0 || config.timeoutMs > 2_147_483_647) throw new Error('KEYWORD_AGENT_CONFIG_INVALID')
  if (!scope.runId?.trim() || typeof scope.log !== 'function' || typeof scope.onStart !== 'function' || !scope.signal || typeof scope.signal.throwIfAborted !== 'function') throw new Error('KEYWORD_AGENT_SCOPE_INVALID')
  if (!host.agents || typeof host.agents.create !== 'function') throw new Error('KEYWORD_AGENT_UNAVAILABLE')
  const agents = host.agents
  const frozenConfig = { ...config, allowedSkills: [...config.allowedSkills ?? []] }
  let busy = false
  let cleanupFailed = false
  return {
    /**
     * 激活本次独立文本研究会话。
     * 业务逻辑: 校验prompt/Skill白名单，setup配置scope后持久启动，等待idle、核结果、释放handle。
     * 关键判断: 不调用主聊天；激活前再次检查abort；超时只cancel本次Agent并等待实际清理。
     * 异常处理: 创建/读取/结果失败传播；清理失败阻止后续run，合法结果附持久警告。
     * 参数: request仅含prompt和可选已授权skillId。返回: 合法JSON工作流结果。
     */
    async run(request: WorkflowAgentRequest): Promise<WorkflowResult> {
      if (busy || cleanupFailed) throw new Error('KEYWORD_AGENT_ADMISSION_CLOSED')
      if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 128 * 1024 || Object.keys(request).some(key => key !== 'prompt' && key !== 'skillId')) throw new Error('KEYWORD_AGENT_REQUEST_INVALID')
      if (request.skillId !== undefined && (!frozenConfig.allowedSkills.includes(request.skillId) || !host.skills)) throw new Error('KEYWORD_AGENT_SKILL_UNAVAILABLE')
      scope.signal.throwIfAborted()
      busy = true
      const signal = AbortSignal.any([scope.signal, AbortSignal.timeout(frozenConfig.timeoutMs)])
      const sessionId = `keyword-${randomUUID()}`
      let handle: Awaited<ReturnType<typeof agents.create>> | undefined
      let result: WorkflowResult | undefined
      let failure: unknown
      let skillText = ''
      /** 业务逻辑: 取消独立Agent；关键判断: 本次handle限定；异常处理: 由生命周期清理核验。参数: 无。返回: 无值。 */
      const cancel = (): void => { handle?.agent.cancel({ kind: 'hook', reason: 'keyword workflow aborted or timed out' }) }
      try {
        handle = await agents.create({
          sessionId,
          meta: { cwd: frozenConfig.cwd },
          agentOptions: { provider: frozenConfig.provider, model: frozenConfig.model, maxTokens: frozenConfig.maxTokens },
          signal,
          /** 业务逻辑: 发布前封闭工具、读取scope Skill；关键判断: 不继承工具，不信同名候选；异常处理: 缺接口/Skill拒绝创建。参数: scope与Agent。返回: 无值。 */
          async setup(context, agent): Promise<void> {
            const tools = context.get('tools')
            if (!tools || typeof tools.presentAs !== 'function' || typeof tools.restrict !== 'function' || typeof tools.guard !== 'function') throw new Error('KEYWORD_AGENT_TOOL_ISOLATION_UNAVAILABLE')
            tools.presentAs('native')
            tools.restrict({ allow: [] })
            tools.guard(() => 'keyword workflow text Agent has no tool permission')
            if (request.skillId !== undefined) {
              const skill = await host.skills!.get(request.skillId, { scope: agent, cwd: frozenConfig.cwd, signal })
              if (!skill || skill.name !== request.skillId || typeof skill.content !== 'string' || skill.content.length > 128 * 1024 || typeof skill.source !== 'string' || typeof skill.provider !== 'string') throw new Error('KEYWORD_AGENT_SKILL_UNAVAILABLE')
              skillText = skill.content
              await scope.log('已读取本次 scoped Skill 正文', workflowSkillLogFacts(skill))
            }
          },
        })
        signal.addEventListener('abort', cancel, { once: true })
        signal.throwIfAborted()
        await scope.onStart(sessionId)
        signal.throwIfAborted()
        await scope.log('独立 Agent 开始研究', { executionSessionId: sessionId, provider: frozenConfig.provider, model: frozenConfig.model })
        signal.throwIfAborted()
        const text = `${skillText ? `工作流 Skill：\n${skillText}\n\n` : ''}${request.prompt}\n\n仅输出一个 JSON 对象，字段仅允许 summary（非空字符串）和可选 data（JSON值）。不得指定运行身份或来源路径；材料不足明确说明，禁止交易指令。`
        handle.agent.followup(Object.freeze({ id: randomUUID(), role: 'user', content: Object.freeze([Object.freeze({ type: 'text', text })]), source: Object.freeze({ kind: 'keyword-workflow' }) }))
        await handle.agent.whenIdle()
        signal.throwIfAborted()
        result = readWorkflowAgentResult(handle.agent.session.snapshotEvents())
      } catch (error) {
        failure = error
      } finally {
        signal.removeEventListener('abort', cancel)
        try { await handle?.dispose() } catch (error) {
          cleanupFailed = true
          await scope.onCleanupError?.(error)
          if (result) await scope.log('Agent 清理失败，已停止接纳后续调用', { code: 'KEYWORD_AGENT_CLEANUP_FAILED', executionSessionId: sessionId })
          else failure = new AggregateError([failure, error].filter(value => value !== undefined), 'KEYWORD_AGENT_CLEANUP_FAILED')
        } finally { busy = false }
      }
      if (failure !== undefined) throw failure
      if (!result) throw new Error('KEYWORD_AGENT_RESULT_INVALID')
      return result
    },
  }
}
