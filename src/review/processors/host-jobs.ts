/** 实际安装Jobs 0.2.0-rc.2公开JS行为的最小结构镜像；无运行时宿主包依赖。 */
export interface KeywordJobOutcome { status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }
export interface KeywordJobHooks {
  /** 业务逻辑: 同步协作取消；关键判断: 幂等，不提前结算清理；异常处理: 由生产者处理。参数: 原因。返回: 无值。 */
  cancel(reason?: string): void
  done: Promise<KeywordJobOutcome>
}
export interface KeywordJobHandle {
  readonly id: string
  /** 业务逻辑: 写原生文本环；关键判断: log只放脱敏阶段；异常处理: 写入失败传播。参数: 文本和通道。返回: 无值。 */
  append(text: string, options?: { channel?: 'stdout' | 'stderr' | 'log'; gapBefore?: true }): void
  /** 业务逻辑: 更新阶段摘要；关键判断: 不代替持久状态；异常处理: 宿主错误传播。参数: 摘要。返回: 无值。 */
  updateProgress(line: string): void
}
export interface KeywordJobSpec {
  kind: string; label: string; owner?: string; outputLimitBytes?: number
  /** 业务逻辑: 同步建立异步执行链；关键判断: 使用job.id，不依赖start返回值；异常处理: 同步失败拒绝启动。参数: 句柄。返回: hooks。 */
  run(job: KeywordJobHandle): KeywordJobHooks
}
export interface KeywordJobsLike {
  /** 业务逻辑: root附加controller；关键判断: scope决定可服务owner；异常处理: 缺服务拒绝。参数: 名称。返回: 注销。 */
  attachController(name: string): () => void
  /** 业务逻辑: 同步进入run；关键判断: 满容量拒绝无队列；异常处理: 准入错误抛出。参数: spec。返回: 原生ID。 */
  start(spec: KeywordJobSpec): string
  /** 业务逻辑: 请求取消而非立即结算；关键判断: caller不等于owner时拒绝；异常处理: 取消异常传播。参数: ID/caller/原因。返回: 请求结果。 */
  kill(id: string, caller?: string, reason?: string): 'requested' | 'already-finished'
}
export interface KeywordJobController {
  /** 业务逻辑: 启动unowned自有任务；关键判断: 不登记卡片、不驱动模型；异常处理: start失败移除关联。参数: 标题/run。返回: 原生ID。 */
  start(label: string, run: KeywordJobSpec['run']): string
  /** 业务逻辑: 仅判断当前内存自有ID；关键判断: 历史ID不可用；异常处理: 无。参数: ID。返回: 是否拥有。 */
  owns(id: string): boolean
  /** 业务逻辑: 仅取消自有任务；关键判断: 不能影响主聊天；异常处理: 非自有ID拒绝。参数: ID/原因。返回: 请求结果。 */
  kill(id: string, reason?: string): 'requested' | 'already-finished'
  /** 业务逻辑: 停接纳、取消并等待生产者清理后注销；关键判断: 不在业务锁内调用；异常处理: 汇总取消/清理错误。参数: 无。返回: 排空。 */
  dispose(): Promise<void>
}

/**
 * 在调用者提供的root Jobs上绑定本插件controller。
 * 业务逻辑: 维护当前挂载的自有ID，unowned启动，无第二队列或执行器。
 * 关键判断: run可能同步执行；done必须在生产者清理后结算；重复dispose共享同一Promise。
 * 异常处理: start失败移除未登记ID；done拒绝阻止新接纳并保留失败，卸载报告AggregateError。
 * 参数: jobs必须来自插件root Context。返回: 只控制本挂载自有任务的适配器。
 */
export function attachKeywordJobs(jobs: KeywordJobsLike): KeywordJobController {
  const detach = jobs.attachController('traderKit:keywords')
  const active = new Map<string, Promise<void>>()
  let closed = false
  let disposal: Promise<void> | undefined
  return {
    /** 业务逻辑: 同步start并绑定run入参ID；关键判断: owner省略；异常处理: 启动失败清关联。参数: label/run。返回: ID。 */
    start(label, run) {
      if (closed) throw new Error('CONTROLLER_CLOSED')
      let enteredId: string | undefined
      try {
        return jobs.start({ kind: 'review-keyword', label,
          /** 业务逻辑: 启动受控生产者并关联清理；关键判断: 用job.id；异常处理: run错误交start传播。参数: job。返回: hooks。 */
          run(job) {
            enteredId = job.id
            const hooks = run(job)
            const cleanup = hooks.done.then(
              /** 业务逻辑: 正常清理完成解除自有关联；关键判断: 不提前释放；异常处理: 无。参数: 无。返回: 无值。 */
              () => { active.delete(job.id) },
              /** 业务逻辑: 保留失败以供卸载报告；关键判断: 禁止再次接纳；异常处理: 保留拒绝。参数: 错误。返回: 不正常返回。 */
              error => { closed = true; throw error },
            )
            // 附加拒绝观察避免unhandled；原cleanup仍拒绝，由dispose明确汇总。
            cleanup.catch(
              /** 业务逻辑: 观察已记录的拒绝；关键判断: 不替换cleanup；异常处理: 不重复抛出。参数: 无。返回: 无值。 */
              () => {},
            )
            active.set(job.id, cleanup)
            return hooks
          },
        })
      } catch (error) {
        if (enteredId !== undefined) active.delete(enteredId)
        throw error
      }
    },
    /** 业务逻辑: 查询当前挂载关联；关键判断: 非历史；异常处理: 无。参数: ID。返回: 布尔值。 */
    owns(id) { return active.has(id) },
    /** 业务逻辑: 请求自有任务取消；关键判断: caller省略适合unowned；异常处理: 非自有ID拒绝。参数: ID/原因。返回: native结果。 */
    kill(id, reason) {
      if (!active.has(id)) throw new Error('JOB_NOT_OWNED')
      return jobs.kill(id, undefined, reason)
    },
    /** 业务逻辑: 幂等卸载；关键判断: await清理后detach；异常处理: 汇总同步kill失败。参数: 无。返回: 排空Promise。 */
    dispose() {
      if (disposal !== undefined) return disposal
      closed = true
      disposal = (async () => {
        const failures: unknown[] = []
        const pending = [...active.entries()]
        for (const [id] of pending) {
          try { jobs.kill(id, undefined, '关键词controller卸载') } catch (error) { failures.push(error) }
        }
        const settlements = await Promise.allSettled(pending.map(([, done]) => done))
        for (const settlement of settlements) if (settlement.status === 'rejected') failures.push(settlement.reason)
        try { detach() } catch (error) { failures.push(error) }
        active.clear()
        if (failures.length > 0) throw new AggregateError(failures, 'KEYWORD_JOB_CLEANUP_FAILED')
      })()
      return disposal
    },
  }
}
