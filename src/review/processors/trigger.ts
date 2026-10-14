import { isAbsolute, relative, resolve } from 'node:path'
import { onReviewWrite } from '../write-events.ts'

/**
 * 订阅保存成功后的关键词协调，不占用用户写入事务。
 * 业务逻辑: 同一数据根通知串行协调，失败报告后台健康而继续处理下一通知。
 * 关键判断: 只认复盘月桶文档，来源回读与工作流去重由协调器执行；关闭先停通知再排空。
 * 异常处理: 协调失败不能回滚已保存卡片，错误观察者失败亦隔离。
 * 参数: dataRoot为绑定根，reconcile为真实协调入口，onError为错误观察者。
 * 返回: drain排空通知；dispose停止订阅并排空，均不取消已保存结果。
 */
export function attachKeywordTrigger(dataRoot: string, reconcile: (path: string) => Promise<void>, onError: (error: unknown) => void): { drain(): Promise<void>; dispose(): Promise<void> } {
  let pending = Promise.resolve()
  let closed = false
  const stop = onReviewWrite(path => {
    if (closed) return
    const rel = relative(resolve(dataRoot), resolve(path)).replaceAll('\\', '/')
    if (isAbsolute(rel) || !/^DB\/review\/\d{6}\/[^/]+\.md$/.test(rel)) return
    pending = pending.then(() => reconcile(path)).catch(error => {
      try { onError(error) } catch { /* 错误观察不影响用户已提交数据或下一通知。 */ }
    })
  })
  return {
    /** 业务逻辑: 等待已接纳通知；关键判断: 不启动新运行；异常处理: 已观察失败不重复抛。参数: 无。返回: 排空。 */
    async drain() { await pending },
    /** 业务逻辑: 停订阅后等待队列；关键判断: 幂等；异常处理: 既有错误已观察。参数: 无。返回: 排空。 */
    async dispose() { closed = true; stop(); await pending },
  }
}
