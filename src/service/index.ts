/**
 * 装配点（change 2 data-foundation）：数据面服务与工具注册。
 *
 * 本文件是 `traderKit` cordis 服务的唯一装配面：change 3 在此追加
 * `api.skill.*`、change 4/5 在此追加 `api.review.*`（MUST NOT 重建
 * `provide('traderKit')`，iteration-1-contracts §11）。
 *
 * 双出口同一实现（data-tool-contract）：工具（src/tools/*.ts）与 service 出口
 * 共用同一组 resolver 函数、同一 guard 内存计数与同一两层缓存。
 * health.status() 为两段视图 `{ data, skill }`：skill 段透传 change 3
 * `skill.status({ cwd? })`（本文件不重复实现）；change 3 未挂载时 skill=null
 * 且 data.warnings 记明（design D-7/D-8）。
 *
 * 模块头注释（tasks 8.4 纪律）：本模块无脚本口径移植；S7 sign/ts 默认值
 * 的脚本来源见 `src/config.ts` 头注释与 docs/carryover.md §3.1。
 */
import type { Context } from '../context-types.ts'
import type { ResolvedTraderKitConfig } from '../config.ts'
import { createDataDeps, type DataDeps } from '../data/deps.ts'
import { createDataHealth, type DataHealth, type DataHealthSnapshot } from '../data/health.ts'
import { resolveTradeDate, type TradeDateResult } from '../data/trade-date.ts'
import { getLimitReason, type LimitReasonResult } from '../data/limit-reason.ts'
import { getConcepts, type ConceptsResult } from '../data/concepts.ts'
import type { GuardStatus } from '../data/guard.ts'
import { createTradeDateTool } from '../tools/trade-date.ts'
import { createLimitReasonTool } from '../tools/limit-reason.ts'
import { createConceptsTool } from '../tools/concepts.ts'

/** 数据面工具名（与 dsh.plugin.json#contributes.tools 一致）。 */
export const DATA_TOOL_NAMES = ['get_trade_date', 'get_limit_reason', 'get_concepts'] as const

/** 健康状态两段视图：data 段 = 本 change 探测结论；skill 段 = change 3 透传（未挂载为 null）。 */
export interface TraderKitHealthStatus {
  data: DataHealthSnapshot
  skill: unknown | null
}

/** 数据面 service 出口（tasks 4.2/5.5/6.4/3.8/7.2 的具名接口，design D-7/D-16）。 */
export interface TraderKitDataApi {
  dataRootConfigured: boolean
  /** 解析后的数据根（装配期已知；复盘线 scanDailyCardTargets 装配期绑定，design D-1）。 */
  dataRoot: string
  /** T0 交易日解析（唯一日期事实源）。 */
  resolveTradeDate(input?: { date?: string }): Promise<TradeDateResult>
  /** T1 涨停原因（主源 S7、备源 S5）。 */
  getLimitReason(input: { code: string; date?: string }): Promise<LimitReasonResult>
  /** T2 概念（S8 实时快照；date 仅用于缓存分桶）。 */
  getConcepts(input: { code: string; date?: string }): Promise<ConceptsResult>
  /** 频控状态只读快照（唯一预算出口：同一内存计数、不出站，design D-16）。 */
  guardStatus(): GuardStatus
}

/** `traderKit` service 形状（各 change 按装配点纪律增量填充）。 */
export interface TraderKitService {
  /** 数据面出口（change 2 具名接口）。 */
  readonly data: TraderKitDataApi
  /** 健康检查两段视图 `{ data, skill }`（tasks 7.1/7.2）。 */
  readonly health: { status(): TraderKitHealthStatus }
  /** change 3 追加：`skill.status({ cwd? })` / `skill.deployLocalDir(...)`（装配期挂载）。 */
  skill?: Record<string, unknown>
  /** change 4/5 追加：`review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets,dailyReport}`（装配期挂载）。 */
  review?: Record<string, unknown>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** dsh-trader-kit 数据面服务（挂载后可见；未挂载/测试桩可缺省）。 */
    traderKit?: TraderKitService
  }
}

/** 数据面装配（测试可注入 deps/health 以接本地桩；生产走 config 默认装配）。 */
export function registerData(ctx: Context, config: ResolvedTraderKitConfig, overrides: {
  deps?: DataDeps
  health?: DataHealth
} = {}): void {
  const deps = overrides.deps ?? createDataDeps(config)
  const health = overrides.health ?? createDataHealth(config, { transport: deps.transport, now: deps.now })
  health.start() // 异步探测：不阻塞挂载；失败不影响工具可用（design D-8）

  /** 双出口同一实现：service 出口函数（工具 facade 也指向这里）。 */
  const dataApi: TraderKitDataApi = {
    dataRootConfigured: config.dataRoot !== '',
    dataRoot: config.dataRoot,
    resolveTradeDate: (input = {}) => resolveTradeDate(deps, input),
    getLimitReason: (input) => getLimitReason(deps, input),
    getConcepts: (input) => getConcepts(deps, input),
    guardStatus: () => deps.guard.status(),
  }

  const tools = [
    createTradeDateTool(dataApi),
    createLimitReasonTool(dataApi),
    createConceptsTool(dataApi),
  ]
  const disposers = tools.map((tool) => ctx.tools.register(tool))
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-trader-kit: data tools')

  const api: TraderKitService = {
    data: dataApi,
    health: {
      status(): TraderKitHealthStatus {
        const snapshot = health.dataStatus()
        // change 3（tq-skill-installer）未挂载：skill 段为 null 并在 data.warnings 记明（design D-7）。
        const skillApi = (ctx as { traderKit?: { skill?: { status?: unknown } } }).traderKit?.skill
        const skill = typeof skillApi?.status === 'function' ? (skillApi.status as () => unknown)() : null
        const warnings = skill === null
          ? [...snapshot.warnings, 'skill 段不可用：change 3（tq-skill-installer）的 skill.status 未挂载（health.status() 两段视图的 skill=null）']
          : snapshot.warnings
        return { data: { ...snapshot, warnings }, skill }
      },
    },
  }
  ctx.provide('traderKit', api)
}
