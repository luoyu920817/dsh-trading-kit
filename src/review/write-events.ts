/** 存储提交后的只读缓存失效通知；不参与写事务，不产生网络或额外落盘。 */
const listeners = new Set<(path: string) => void>()

/**
 * 订阅复盘文档成功提交。
 * 业务逻辑: 为页面读取缓存登记失效入口，卸载时解除订阅。
 * 关键判断: 通知以实际绝对文档路径区分数据根、市场和日期。
 * 异常处理: 监听器错误由发布入口隔离，不影响存储成功结果。
 * 参数: listener 为接收已提交文档路径的同步函数。
 * 返回: 可重复调用的取消订阅函数。
 */
export function onReviewWrite(listener: (path: string) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * 发布复盘文档提交事件。
 * 业务逻辑: 在真实写入完成后同步使各读取缓存失效。
 * 关键判断: 发布者只在内容发生改变时调用；幂等重放不需要失效。
 * 异常处理: 单个监听器失败不能回滚已成功的写入，也不阻止其它监听器。
 * 参数: path 为真实提交的绝对文档路径。
 * 返回: 无。
 */
export function notifyReviewWrite(path: string): void {
  for (const listener of listeners) {
    try { listener(path) } catch { /* 缓存失效失败不得把已提交的写入报告成失败。 */ }
  }
}
