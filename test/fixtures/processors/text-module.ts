/** 测试装配：无生产关键词、行情、路径写入或宿主模拟。 */
import type { WorkflowImplementation } from '../../../src/review/processors/types.ts'

export const textModule: WorkflowImplementation = {
  id: 'text',
  /**
   * 整理卡片文字，可读取授权补充材料。
   * 业务逻辑: 记录开始、读取角色材料，再形成摘要并记录完成。
   * 关键判断: 补充材料只有受控read结果，始终保留原始卡片为输入。
   * 异常处理: 取消明确拒绝，日志/读取失败传播。
   * 参数: context为来源固定的受控能力。返回: 文字摘要。
   */
  async execute(context) {
    if (context.signal.aborted) throw new Error('WORKFLOW_ABORTED')
    await context.log('开始整理文字')
    const evidence = await context.read({ kind: 'role', limit: 1 })
    context.signal.throwIfAborted()
    const role = evidence[0]?.content
    const summary = typeof role === 'string' ? `${context.source.body}\n${role}` : context.source.body
    await context.log('文字整理完成')
    return { summary }
  },
}

export const skillTextModule: WorkflowImplementation = {
  id: 'text-skill',
  /**
   * 将受信Skill接入同一个工作流入口。
   * 业务逻辑: 用原卡片正文调用受控Agent能力并返回结果。
   * 关键判断: 运行身份、模型配置和权限由上下文能力固定。
   * 异常处理: 无Agent能力或取消时明确失败，不假造成功。
   * 参数: context为本次运行能力。返回: Skill结果。
   */
  async execute(context) {
    if (context.signal.aborted) throw new Error('WORKFLOW_ABORTED')
    if (!context.agent) throw new Error('AGENT_CAPABILITY_UNAVAILABLE')
    await context.log('开始Skill整理')
    const result = await context.agent.run({ skillId: 'text-summary', prompt: context.source.body })
    context.signal.throwIfAborted()
    await context.log('Skill整理完成')
    return result
  },
}
