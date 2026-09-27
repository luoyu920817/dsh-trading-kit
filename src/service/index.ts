/**
 * 装配点（change 2 data-foundation）：数据面服务与工具注册。
 *
 * 本文件是 `traderKit` cordis 服务的唯一装配面：change 3 在此追加
 * `api.skill.*`、change 4/5 在此追加 `api.review.*`（MUST NOT 重建
 * `provide('traderKit')`，iteration-1-contracts §11）。
 *
 * 模块头注释（tasks 8.4 纪律）：本模块无脚本口径移植；S7 sign/ts 默认值
 * 的脚本来源见 `src/config.ts` 头注释与 docs/carryover.md §3.1。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '../context-types.ts'
import type { ResolvedTraderKitConfig } from '../config.ts'

/** 数据面工具名（与 dsh.plugin.json#contributes.tools 一致）。 */
export const DATA_TOOL_NAMES = ['get_trade_date', 'get_limit_reason', 'get_concepts'] as const

/** 健康状态两段视图（骨架阶段未探测；真实实现见 tasks 7.1）。 */
export interface TraderKitHealthStatus {
  data: null
  skill: null
  warnings: string[]
}

/** `traderKit` service 形状（各 change 按装配点纪律增量填充）。 */
export interface TraderKitService {
  /** 数据面出口（tasks 4/5/6/3.8 落地）：resolveTradeDate/getLimitReason/getConcepts/guardStatus。 */
  readonly data: Record<string, unknown>
  /** 健康检查两段视图 `{ data, skill }`（tasks 7.1/7.2 落地；skill 段透传 change 3）。 */
  readonly health: { status(): TraderKitHealthStatus }
  /** change 3 追加：`skill.status({ cwd? })` / `skill.deployLocalDir(...)`。 */
  readonly skill?: Record<string, unknown>
  /** change 4/5 追加：`review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets,dailyReport}`。 */
  readonly review?: Record<string, unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** dsh-trader-kit 数据面服务（挂载后可见；未挂载/测试桩可缺省）。 */
    traderKit?: TraderKitService
  }
}

/** 本模块渲染帮助（工具输出纯文本投影，沿 better-sidebar 先例）。 */
function textRender(fn: () => string): () => [{ type: 'text'; text: string }] {
  return () => [{ type: 'text', text: fn() }]
}

/** 骨架阶段的占位工具定义：name 已定稿，实现与描述由 tasks 4.2/5.5/6.4 替换。 */
function stubTool(name: (typeof DATA_TOOL_NAMES)[number], description: string) {
  return defineTool({
    name,
    description,
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {} },
      render: textRender(() => `${name} 尚未实现（数据面实现于 change 2 后续任务落地）`),
    },
    execute: async () => {
      throw new Error(`${name} 尚未实现（change 2 tasks 4.2/5.5/6.4 落地真实实现）`)
    },
  })
}

/** 数据面装配：注册 T0/T1/T2 三工具 + provide('traderKit') 服务。 */
export function registerData(ctx: Context, config: ResolvedTraderKitConfig): void {
  const disposers = DATA_TOOL_NAMES.map((name) => ctx.tools.register(stubTool(name, `${name}（骨架占位：真实描述与实现随 change 2 tasks 4.2/5.5/6.4 落地）`)))
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-trader-kit: data tools')

  const api: TraderKitService = {
    data: {
      // 波 2（D-b）在此填充 resolveTradeDate/getLimitReason/getConcepts/guardStatus。
      dataRootConfigured: config.dataRoot !== '',
    },
    health: {
      status(): TraderKitHealthStatus {
        return {
          data: null,
          skill: null,
          warnings: ['健康检查未实现（change 2 tasks 7.1 落地三方源与 17709 探测）'],
        }
      },
    },
  }
  ctx.provide('traderKit', api)
}
