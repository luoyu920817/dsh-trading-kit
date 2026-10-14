/** 左侧导航图标、右侧主页面与设置弹框接线，生命周期归宿主。 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ReviewPanelIcon, ReviewWorkspace, TraderKitSettings } from './panel/Workspace.ts'
import { PANEL_ID, PANEL_TITLE } from './panel/params.ts'

/** 只消费slots服务，不使用根作用域conversation。 */
export const inject = ['slots'] as const
interface SlotsLike {
  register(options: Record<string, unknown>, component: unknown): () => void
  inject(slotName: string, factory: () => () => void): () => void
}
interface ClientLoggerLike { info?(message: string): void; warn?(message: string): void }

/**
 * 注册导航图标、主页面和设置页。
 * 业务逻辑: 同id导航选择keyed main，settings.section承载配置入口。
 * 关键判断: inject等待槽声明；左侧无正文；不依赖当前会话。
 * 异常处理: 一处失败只警告，其他入口继续；卸载由effect释放。
 * 参数: ctx为宿主客户端上下文。返回: 无。
 */
export function apply(ctx: ClientContext): void {
  const client = ctx as unknown as { get?: (name: string) => unknown; slots?: SlotsLike; logger?: unknown; effect?: (fn: () => () => void, label?: string) => void }
  const slots = (typeof client.get === 'function' ? client.get('slots') : client.slots) as SlotsLike | undefined
  const logger = resolveLogger(client.logger)
  if (!slots || typeof slots.inject !== 'function') {
    logger?.warn?.('[dsh-trader-kit] 页面注册跳过：宿主缺少 slots.inject')
    return
  }
  /**
   * 等待并注册一处独立UI贡献。
   * 业务逻辑: 槽出现时注册，消失或卸载时释放。
   * 关键判断: 一处错误不阻止其他入口；主页面使用key，列表入口使用id。
   * 异常处理: 注册失败警告并返回空释放函数。
   * 参数: options注册描述，component实际React组件。返回: 无。
   */
  function contribute(options: Record<string, unknown> & { name: string }, component: unknown): void {
    /** 业务逻辑: 注册已声明槽。关键判断: 使用原样描述。异常处理: 警告降级。参数: 无。返回: 释放函数。 */
    const register = (): (() => void) => {
      try { return slots!.register(options, component) }
      catch (error) {
        logger?.warn?.('[dsh-trader-kit] 注册 ' + options.name + ' 失败：' + (error instanceof Error ? error.message : String(error)))
        /** 业务逻辑: 未分配资源。关键判断: 空释放。异常处理: 无。参数: 无。返回: 无。 */
        return () => {}
      }
    }
    /** 业务逻辑: 绑定槽等待器。关键判断: 卸载移除注册与等待。异常处理: 宿主effect处理。参数: 无。返回: 释放函数。 */
    const mount = (): (() => void) => slots!.inject(options.name, register)
    if (typeof client.effect === 'function') client.effect(mount, 'dsh-trader-kit: ' + options.name)
    else mount()
  }
  contribute({ name: 'sidebar.panellist', id: PANEL_ID, label: PANEL_TITLE, order: 60 }, ReviewPanelIcon)
  contribute({ name: 'main', key: PANEL_ID }, ReviewWorkspace)
  contribute({ name: 'settings.section', id: 'trader-kit-settings', label: '交易工作流', order: 100 }, TraderKitSettings)
  logger?.info?.('[dsh-trader-kit] 导航、主页面与交易工作流设置页已接线')
}

/**
 * 兼容宿主具名logger与直接logger对象。
 * 业务逻辑: 取得日志面，不包装业务异常。
 * 关键判断: logger缺席允许降级。
 * 异常处理: 不调用未知对象方法。参数: raw日志服务。返回: 可选日志面。
 */
function resolveLogger(raw: unknown): ClientLoggerLike | undefined {
  return (typeof raw === 'function' ? (raw as (name: string) => unknown)('dsh-trader-kit') : raw) as ClientLoggerLike | undefined
}
