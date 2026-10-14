/** 本地读状态；空结果与尚未完成的扫描必须明确区分。 */
export type LoadState = 'loading' | 'ready' | 'error'

/** 单飞快照，旧值在过期刷新期间仍可读。 */
export class Snapshot<T> {
  value: T | undefined
  state: LoadState = 'loading'
  private at = -Infinity
  private retryAt = -Infinity
  private generation = 0
  private pending?: Promise<void>

  /**
   * 业务逻辑: 保存读取器、有效期和时钟；不阻塞构造。
   * 关键判断: 调用方决定何时异步预热。
   * 异常处理: 读取异常由刷新捕获。
   * 参数: loader读取完整快照，ttl毫秒，now时钟，onError可选告警出口。
   * 返回: 独立快照实例。
   */
  constructor(private loader: () => Promise<T> | T, private ttl: number, private now = Date.now, public onError?: (error: unknown) => void) {}

  /**
   * 业务逻辑: 到期启动刷新，同时立即返回已完成快照。
   * 关键判断: 无旧值时返回undefined，不能伪装空结果。
   * 异常处理: 后台异常由refresh降级处理。
   * 参数: 无。
   * 返回: 最近成功值。
   */
  read(): T | undefined {
    if (this.now() - this.at >= this.ttl) void this.refresh()
    return this.value
  }

  /**
   * 业务逻辑: 同一快照只运行一次刷新；失败五秒后允许重试。
   * 关键判断: 世代变化禁止旧任务发布；有旧值时失败仍保持ready。
   * 异常处理: 捕获读取错误，冷读标记error，发布一次告警；告警失败不影响缓存。
   * 参数: 无。
   * 返回: 可等待的刷新任务。
   */
  refresh(): Promise<void> {
    if (this.pending !== undefined) return this.pending
    if (this.now() < this.retryAt) return Promise.resolve()
    const generation = this.generation
    if (this.value === undefined) this.state = 'loading'
    const task = (async () => {
      try {
        const value = await this.loader()
        if (generation !== this.generation) return
        this.value = value
        this.at = this.now()
        this.retryAt = -Infinity
        this.state = 'ready'
      } catch (error) {
        if (generation !== this.generation) return
        this.retryAt = this.now() + 5_000
        this.state = this.value === undefined ? 'error' : 'ready'
        try { this.onError?.(error) } catch { /* 告警不能改变快照降级结果 */ }
      }
    })()
    this.pending = task.finally(() => { this.pending = undefined })
    return this.pending
  }

  /**
   * 业务逻辑: 写入后清空旧值并增加发布世代。
   * 关键判断: 正在运行的任务继续执行但不能回填旧数据。
   * 异常处理: 下次读取重新刷新。
   * 参数: 无。
   * 返回: 无。
   */
  invalidate(): void {
    this.generation++
    this.value = undefined
    this.at = -Infinity
    this.retryAt = -Infinity
    this.state = 'loading'
  }
}
