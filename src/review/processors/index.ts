import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '../../context-types.ts'
import type { ResolvedTraderKitConfig } from '../../config.ts'
import { registerReviewProcessorRoutes } from '../../routes/review-processors.ts'
import { registerWorkflowPage } from '../../routes/workflow-page.ts'
import { registerBasicSettingsRoutes } from '../../routes/basic-settings.ts'
import { attachKeywordJobs, type KeywordJobsLike } from './host-jobs.ts'
import { createWorkflowAgentAdapter, type WorkflowAgentHost } from './agent.ts'
import { expectationWorkflow } from './expectation.ts'
import { createWorkflowRegistry } from './registry.ts'
import { createWorkflowRecordStore } from './records.ts'
import { createWorkflowRuntime, readWorkflowSettings, type WorkflowRuntime } from './runtime.ts'
import { attachKeywordTrigger } from './trigger.ts'

/**
 * 从安装资源读取工作流配置，路径不依赖启动目录。
 * 业务逻辑: lib与src同样相对包根定位已打包JSON。
 * 关键判断: 注册表校验整个候选，读取不执行代码。
 * 异常处理: 缺资源/坏JSON显式拒绝，由装配记录不可用原因。
 * 参数: 无。返回: JSON候选文本。
 */
export function readPackagedWorkflowDefinitions(): Promise<string> {
  return readFile(new URL('../../../config/card-processors.json', import.meta.url), 'utf8')
}

/**
 * 在复盘根挂载关键词工作流与独立管理API。
 * 业务逻辑: 复用真实Jobs/Agent服务，订阅成功保存，恢复仅已登记记录。
 * 关键判断: 默认处理关闭；不继承主聊天，不自动扫描旧卡；公开读取沿宿主认证。
 * 异常处理: 异步装配/后台登记失败仅报本模块不可用，不影响旧卡片保存；卸载排空清理。
 * 参数: ctx为真实宿主，config为完整配置，writeKey沿既有复盘写通道。
 * 返回: 无；运行服务挂在既有traderKit.processing，生命周期归ctx.effect。
 */
export function registerKeywordProcessors(ctx: Context, config: ResolvedTraderKitConfig, writeKey: string): void {
  registerBasicSettingsRoutes(ctx, config)
  registerWorkflowPage(ctx)
  if (!config.dataRoot) return
  const logger = ctx.logger('trader-kit:keywords')
  const get = (name: string): unknown => (ctx as unknown as { get?: (name: string) => unknown }).get?.(name)
  ctx.effect(() => {
    let closed = false
    let runtime: WorkflowRuntime | undefined
    const jobsService = get('jobs') as KeywordJobsLike | undefined
    const jobs = jobsService ? attachKeywordJobs(jobsService) : null
    const host: WorkflowAgentHost = { agents: get('agents') as WorkflowAgentHost['agents'], skills: get('skills') as WorkflowAgentHost['skills'] }
    const processing = config.review.processing
    const implementations = new Map([[expectationWorkflow.id, expectationWorkflow]])
    const ready = (async () => {
      const settings = await readWorkflowSettings(config.dataRoot)
      const registry = createWorkflowRegistry(implementations, settings?.candidate ?? await readPackagedWorkflowDefinitions())
      const records = createWorkflowRecordStore(config.dataRoot)
      runtime = createWorkflowRuntime({
        dataRoot: config.dataRoot, registry, records, jobs, implementations,
        enabled: processing.enabled, maxConcurrency: processing.maxConcurrency, agentAttemptLimit: processing.agentAttemptLimit,
        initialSettingsRevision: settings?.settingsRevision,
        reloadCandidate: async () => (await readWorkflowSettings(config.dataRoot))?.candidate ?? await readPackagedWorkflowDefinitions(),
        agentFactory(scope) {
          if (!host.agents || !processing.provider.trim() || !processing.model.trim() || !isAbsolute(processing.cwd)) return null
          return createWorkflowAgentAdapter(host, processing, scope)
        },
      })
      if (!closed) {
        if (ctx.traderKit) ctx.traderKit.processing = runtime
        registerReviewProcessorRoutes(ctx, { service: runtime, writeKey })
        await runtime.recover()
      }
      return runtime
    })()
    const trigger = attachKeywordTrigger(config.dataRoot, async path => {
      const runtime = await ready
      if (!closed) await runtime.reconcileDocument(path)
    }, () => { logger.error('关键词工作流后台登记失败；卡片保存成功，请在运行管理中检查或显式重扫') })
    ready.catch(() => { logger.error('关键词工作流装配失败，请核验打包配置、存储和宿主能力') })
    return async () => {
      closed = true
      const failures: unknown[] = []
      try { await trigger.dispose() } catch (error) { failures.push(error) }
      await Promise.allSettled([ready])
      try {
        if (runtime) await runtime.dispose()
        else if (jobs) await jobs.dispose()
      } catch (error) { failures.push(error) }
      const api = ctx.traderKit
      if (api && api.processing === runtime) delete api.processing
      if (failures.length) throw new AggregateError(failures, 'KEYWORD_ROOT_CLEANUP_FAILED')
    }
  }, 'dsh-trader-kit: keyword workflows')
}
