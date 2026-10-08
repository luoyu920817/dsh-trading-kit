/**
 * 客户端插件装配（review-loop `review-panel`；DSH 浏览器半入口）。
 *
 * 经宿主 slot 系统注册：`sidebar.panellist` 一个 list 项（图标入口）+
 * 布局 root 作用域 keyed `main` 槽的**同 id** 内容组件（sidebar 面板入口 →
 * 主面板内容）。两处注册经 `ctx.effect` 管理（卸载释放、不重复）；
 * 槽缺失（宿主版本不含该槽）时记日志跳过——MUST NOT 抛出、MUST NOT 白屏。
 *
 * 依赖以**结构化类型**声明（不 import 宿主客户端包；`dsh.client.inject` 声明
 * 运行时依赖包名，宿主按序装载）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ReviewPanel, type ConversationLike } from './panel/Panel.ts'
import { PANEL_ID, PANEL_TITLE } from './panel/params.ts'

/** 宿主客户端运行时依赖（宿主按序装载；形状见波 0 spike 核验记录）。 */
export const inject = ['slots', 'locale', 'conversation'] as const

/** 槽注册面（宿主 `@deepseek-ai/dsh-client-ui-slots` 的 register/inject 子集）。 */
interface SlotsLike {
  register(declaration: Record<string, unknown>, component: unknown): () => void
  inject?(slotName: string, factory: () => () => void): () => void
}

interface ClientLoggerLike {
  info?(...args: unknown[]): void
  warn?(...args: unknown[]): void
}

/** 客户端插件主体（宿主调用；失败不得冒泡——入口缺席即降级态）。 */
export function apply(ctx: ClientContext): void {
  const anyCtx = ctx as unknown as { slots?: SlotsLike; logger?: unknown; conversation?: ConversationLike; effect?: (fn: () => (() => void) | void, label?: string) => void }
  const slots = anyCtx.slots
  const logger = resolveLogger(anyCtx.logger)
  if (slots === undefined) {
    logger.warn('[dsh-trader-kit] 面板注册跳过：宿主未提供 slots 服务（该版本无客户端槽系统）')
    return
  }
  const conversation = anyCtx.conversation
  const component = (): unknown => ReviewPanel({ conversation }) as unknown

  const register = (): (() => void) => {
    const disposers: Array<() => void> = []
    try {
      disposers.push(slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        label: PANEL_TITLE,
        order: 60,
      }, component))
      disposers.push(slots.register({
        name: 'main',
        id: PANEL_ID,
      }, component))
    } catch (e) {
      // 槽缺失/被占用：入口缺席即为降级态（不阻塞宿主其余界面）。
      logger.warn('[dsh-trader-kit] 面板注册失败（入口缺席，宿主其余功能不受影响）：' + (e instanceof Error ? e.message : String(e)))
    }
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 卸载异常静默（不阻塞插件卸载链） */
        }
      }
    }
  }

  if (typeof anyCtx.effect === 'function') {
    anyCtx.effect(register, 'dsh-trader-kit: review panel')
  } else {
    register()
  }
  logger.info('[dsh-trader-kit] 复盘面板已注册（sidebar.panellist + main，id=' + PANEL_ID + '）')
}

function resolveLogger(raw: unknown): { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void } {
  const named = typeof raw === 'function' ? (raw as (name?: string) => unknown)('dsh-trader-kit') : raw
  const candidate = named as ClientLoggerLike | null | undefined
  return {
    info: (...a) => { candidate?.info?.(...a) },
    warn: (...a) => { candidate?.warn?.(...a) },
  }
}
