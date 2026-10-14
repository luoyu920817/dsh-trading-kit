/**
 * review-loop 工具装配（`stock-profile` + `daily-brief` 两个 capability 的工具面；
 * tasks 2.2/2.5、3.2）。
 *
 * 双出口同一实现（data-tool-contract 纪律）：本文件的 `execute` 与
 * `traderKit.review.{stockProfiles,writeBrief}` service 出口指向同一组函数。
 *
 * - `review_stock_profiles`：读 `DB/stock/` 标的档案（只读；`角色` = 给 agent 的
 *   提示词重点内容；`锚点: true` = 盘面 md 指数段成员；未命中不入结果、不是错误）。
 * - `review_write_brief`：写当日盘面 md（**唯一生产者**；覆盖重写 + 原子写；
 *   schema 无 `force`/`overwrite`）。
 *
 * 依赖不可用（区域未登记 / dataRoot 未配置）SHALL 显式报错
 * `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），MUST NOT 自实现兜底。
 * 装配点只保留一行调用（`src/review/index.ts` 的 `registerReviewLoop(ctx)`）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '../context-types.ts'
import { PathResolveError } from '../paths/resolve.ts'
import { readStockProfiles } from '../review/profile.ts'
import { writeBrief, type BriefMissingEntry, type BriefSections } from '../summary/brief.ts'
import { DependencyUnavailableError } from './review-daily.ts'
import { nullableString } from './shared.ts'

// ---------------------------------------------------------------------------
// 消费面（依赖探测 seam；缺键 → DEPENDENCY_UNAVAILABLE）
// ---------------------------------------------------------------------------

export interface ReviewLoopFacades {
  data: {
    /** 数据根（装配期绑定；'' = 未配置 → 调用期显式报错）。 */
    dataRoot?: string
    /** 标的目录相对数据根；模式目录由基础配置展示。 */
    directories?: { stock: string; patterns: string }
  }
  profiles: {
    read?: typeof readStockProfiles
  }
  brief: {
    write?: typeof writeBrief
  }
}

/**
 * 业务逻辑: 绑定宿主数据根与标的目录，复用真实读档和盘面写入函数。
 * 关键判断: 目录来自当前插件数据服务，不修改全局映射；旧服务缺目录沿默认。
 * 异常处理: 数据根缺省在实际工具调用时显式报错。
 * 参数: ctx为宿主上下文。
 * 返回: 当前插件实例的工具依赖。
 */
export function createReviewLoopFacades(ctx: Context): ReviewLoopFacades {
  const api = (ctx as { traderKit?: { data?: { dataRoot?: unknown; directories?: { stock: string; patterns: string } } } }).traderKit
  const dataRoot = typeof api?.data?.dataRoot === 'string' ? api.data.dataRoot : undefined
  return {
    data: { dataRoot, directories: api?.data?.directories },
    profiles: { read: readStockProfiles },
    brief: { write: writeBrief },
  }
}

function requireDataRoot(facades: ReviewLoopFacades): string {
  const dataRoot = facades.data.dataRoot
  if (typeof dataRoot !== 'string' || dataRoot === '') {
    throw new DependencyUnavailableError('traderKit.data.dataRoot（数据根未配置）', 'change 2 data-foundation / 宿主 profile 配置段')
  }
  return dataRoot
}

/** 区域/路径类错误 → DEPENDENCY_UNAVAILABLE（区域未登记属装配缺陷，显式报错不兜底）。 */
function asDependencyError(e: unknown): never {
  if (e instanceof PathResolveError) {
    throw new DependencyUnavailableError(`src/paths/mapping.ts 区域表（${e.message}）`, 'change 2 data-root-layout')
  }
  throw e
}

// ---------------------------------------------------------------------------
// review_stock_profiles（读档案）
// ---------------------------------------------------------------------------

export interface StockProfilesOutcome {
  entries: Array<{
    code: string | null
    name: string
    role: string | null
    isAnchor: boolean
    hotTags: string[]
    path: string
  }>
  warnings: string[]
}

/**
 * 业务逻辑: 根据绑定目录读取标的档案，工具与服务共用同一出口。
 * 关键判断: 只读操作，目录通过第三参数传递，禁止使用全局目录状态。
 * 异常处理: 依赖或区域配置缺失转换为明确依赖错误，其余错误透传。
 * 参数: facades为实例依赖，args为代码和对应名称集合。
 * 返回: 档案结果和告警。
 */
export async function runStockProfiles(
  facades: ReviewLoopFacades,
  args: { codes?: string[]; names?: string[] },
): Promise<StockProfilesOutcome> {
  const read = facades.profiles.read
  if (typeof read !== 'function') {
    throw new DependencyUnavailableError('src/review/profile.ts 的 readStockProfiles', 'review-loop stock-profile')
  }
  const dataRoot = requireDataRoot(facades)
  try {
    return await read(dataRoot, { codes: args.codes, names: args.names }, { directory: facades.data.directories?.stock })
  } catch (e) {
    asDependencyError(e)
  }
}

/** `review_stock_profiles` 工具定义（execute 与 service 出口同一实现）。 */
export function createReviewStockProfilesTool(facades: ReviewLoopFacades) {
  return defineTool({
    name: 'review_stock_profiles',
    description:
      '读取已配置的标的档案目录（默认 DB/stock；review-loop 标的上下文 W3 步；只读、零出站、不写入任何档案）。'
      + '入参 codes 给出时按「名称直配 → 代码索引兜底」逐代码定位（names 与 codes 按下标对齐，缺省回落代码索引）；两者皆缺省 = 返回全部 锚点: true 且含 代码 的档案（盘面 md 指数段成员）。'
      + '出参 role = 档案 角色 键原文（= 给 agent 的提示词重点内容，唯一进 agent 上下文的业务字段）；isAnchor = 锚点: true；hotTags 仅展示用（MUST NOT 进 agent 上下文）。'
      + '未命中的标的不入结果且不是错误；目录缺失返回空表 + warnings（stockDirMissing）。',
    parameters: {
      codes: { type: 'array', items: { type: 'string' }, description: '可选：目标代码清单（6 位；与 names 按下标对齐）' },
      names: { type: 'array', items: { type: 'string' }, description: '可选：与 codes 对齐的名称清单（缺省/退化时回落 代码 索引）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                code: nullableString(),
                name: { type: 'string' },
                role: nullableString(),
                isAnchor: { type: 'boolean' },
                hotTags: { type: 'array', items: { type: 'string' } },
                path: { type: 'string' },
              },
            },
          },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderProfilesText(value as unknown as StockProfilesOutcome) }],
    },
    execute: async (args) => runStockProfiles(facades, args as { codes?: string[]; names?: string[] }) as never,
  })
}

function renderProfilesText(value: StockProfilesOutcome): string {
  const lines = [`标的档案：命中 ${value.entries.length} 条`]
  for (const e of value.entries) {
    lines.push(
      `- ${e.code ?? '（无 代码 键）'} ${e.name}｜角色=${e.role ?? '（未填）'}`
      + `｜锚点=${e.isAnchor ? '是' : '否'}${e.hotTags.length > 0 ? `｜热点标签=${e.hotTags.join('、')}（仅展示）` : ''}｜${e.path}`,
    )
  }
  if (value.warnings.length > 0) lines.push(`warnings：${value.warnings.join('；')}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// review_write_brief（写当日盘面 md；唯一生产者）
// ---------------------------------------------------------------------------

export interface WriteBriefOutcome {
  path: string
  tradeDate: string
  bytes: number
  generatedAt: string
  replaced: boolean
  warnings: string[]
}

export async function runWriteBrief(
  facades: ReviewLoopFacades,
  args: {
    tradeDate: string
    sections: BriefSections
    anchors?: string[]
    missing?: BriefMissingEntry[]
    warnings?: string[]
    generatedAt?: string
  },
): Promise<WriteBriefOutcome> {
  const write = facades.brief.write
  if (typeof write !== 'function') {
    throw new DependencyUnavailableError('src/summary/brief.ts 的 writeBrief', 'review-loop daily-brief')
  }
  const dataRoot = requireDataRoot(facades)
  try {
    return await write(dataRoot, args)
  } catch (e) {
    if (e instanceof PathResolveError) asDependencyError(e)
    throw e
  }
}

const SECTION_PARAM = {
  type: 'string',
  description: '段正文（MUST 非空；事实逐条带来源，缺项显式写「数据不可得」/「卡片未覆盖」）',
} as const

/** `review_write_brief` 工具定义（当日盘面 md 的唯一生产者）。 */
export function createReviewWriteBriefTool(facades: ReviewLoopFacades) {
  return defineTool({
    name: 'review_write_brief',
    description:
      '写入当日盘面整理 md（review-loop W6 收尾；落 DB/review/<YYYYMM>/<YYYYMMDD>-summary.md）。'
      + '**唯一生产者**：同交易日重复调用 = 覆盖重写（原子写；无 force/overwrite 入参）。'
      + '四段（index 指数 / sentiment 情绪 / moneyEffect 赚钱效应 / theme 题材）均 MUST 非空；'
      + 'MUST NOT 触碰用户卡片与 AI 附注分节；失败不改变附注/运行摘要的既有结果。',
    parameters: {
      tradeDate: { type: 'string', description: '目标交易日，canonical YYYY-MM-DD', required: true },
      sections: {
        type: 'object',
        additionalProperties: false,
        description: '四段正文对象：{ index, sentiment, moneyEffect, theme }（各段 MUST 非空）',
        properties: {
          index: SECTION_PARAM,
          sentiment: SECTION_PARAM,
          moneyEffect: SECTION_PARAM,
          theme: SECTION_PARAM,
        },
        required: true,
      },
      anchors: { type: 'array', items: { type: 'string' }, description: '可选：本次参与指数段的锚点代码' },
      missing: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: { field: { type: 'string' }, reason: { type: 'string' } },
        },
        description: '可选：逐项缺失登记 [{field, reason}]（reason 枚举沿 daily-summary：sourceUnavailable/dateMismatch/noRecord/fieldAbsent）',
      },
      warnings: { type: 'array', items: { type: 'string' }, description: '可选：告警出口（原样落入产物 frontmatter）' },
      generatedAt: { type: 'string', description: '可选：写入时刻（东八区偏移）；缺省 = 工具运行时刻' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          path: { type: 'string' },
          tradeDate: { type: 'string' },
          bytes: { type: 'number' },
          generatedAt: { type: 'string' },
          replaced: { type: 'boolean' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderBriefText(value as unknown as WriteBriefOutcome) }],
    },
    execute: async (args) => runWriteBrief(facades, args as never) as never,
  })
}

function renderBriefText(value: WriteBriefOutcome): string {
  const lines = [
    `盘面 md：${value.replaced ? '覆盖重写' : '新建'} ${value.path}（${String(value.bytes)} 字节，generatedAt=${value.generatedAt}）`,
  ]
  if (value.warnings.length > 0) lines.push(`warnings：${value.warnings.join('；')}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// 装配（工具 + service 出口；只注册自己的出口）
// ---------------------------------------------------------------------------

/**
 * review-loop 装配（由 `src/review/index.ts` 第四行调用）：
 * 注册两工具 + service 出口 `traderKit.review.stockProfiles` / `traderKit.review.writeBrief`。
 * MUST NOT 重建 `traderKit.review` 容器（只追加键）。
 */
export function registerReviewLoop(ctx: Context): void {
  const facades = createReviewLoopFacades(ctx)
  const disposers = [
    ctx.tools.register(createReviewStockProfilesTool(facades)),
    ctx.tools.register(createReviewWriteBriefTool(facades)),
  ]
  ctx.effect(() => () => { for (const dispose of disposers) dispose() }, 'dsh-trader-kit: review loop tools')

  const api = (ctx as { traderKit?: { review?: Record<string, unknown> } }).traderKit
  if (api !== undefined) {
    const review = api.review ?? (api.review = {})
    review.stockProfiles = (input: { codes?: string[]; names?: string[] }) => runStockProfiles(facades, input)
    review.writeBrief = (input: Parameters<typeof runWriteBrief>[1]) => runWriteBrief(facades, input)
  }
}
