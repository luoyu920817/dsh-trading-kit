/**
 * TQ-Local 只读兜底工具 `get_stock_basics`（review-loop `tq-local-lookup`；
 * tasks 4.6/4.9）。
 *
 * 与 service 出口 `traderKit.data.stockBasics` **同一实现**（facade 注入，
 * data-tool-contract「双出口同一实现」）；白名单与出站闸在 `src/data/http.ts`
 * （本文件 MUST NOT 出现端点端口字面量、MUST NOT 自建出站通道）。
 *
 * 用途：通达信内置代码（`999999`/`880xxx` 等公开源不可得的标的）的名称与最小
 * 基础信息；入参仅 `code` + 可选 `marketSuffix`（**无任意 params 透传口**）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StockBasics, MarketSuffix } from '../data/tq-local.ts'
import { nullableString } from './shared.ts'

/** 工具消费的最小 facade（与 `TraderKitService['data']` 同一实现）。 */
export interface StockBasicsFacade {
  stockBasics(input: { code: string; marketSuffix?: MarketSuffix }): Promise<StockBasics>
}

/** 纯文本投影（不可用态不渲染成 0/--/空）。 */
export function renderStockBasicsText(value: StockBasics): string {
  if (!value.available) {
    return [
      `TQ-Local 基础信息：不可用（code=${value.code}）`,
      ...value.notes.map((n) => `- ${n}`),
    ].join('\n')
  }
  const lines = [
    `TQ-Local 基础信息：${value.name}（${value.code}${value.marketSuffix ?? ''}）`,
    `品种类型 HSStockKind=${value.kind ?? 'null'}｜上市日=${value.listedAt ?? 'null'}｜地域=${value.region ?? 'null'}｜行业=${value.industry ?? 'null'}`,
    `流通股本=${value.floatSharesWan ?? 'null'} 万股｜总股本=${value.totalSharesWan ?? 'null'} 万股（原样字符串，换算归消费方）`,
    `source=${value.source} fetchedAt=${value.fetchedAt} cacheReused=${value.cacheReused ? 'true' : 'false'}`,
  ]
  if (value.notes.length > 0) lines.push(`notes：${value.notes.join('；')}`)
  return lines.join('\n')
}

/** 注册用工具定义（execute 与 service 同一实现函数）。 */
export function createStockBasicsTool(facade: StockBasicsFacade) {
  return defineTool({
    name: 'get_stock_basics',
    description:
      '取标的名称与最小基础信息（TQ-Local 只读兜底；用于公开源不可得的通达信内置代码，如 999999 上证指数 / 880823 微盘股）。'
      + '白名单严限：仅本机 127.0.0.1 TQ-Local 的 get_stock_info 只读接口（MUST NOT 行情/交易接口）；'
      + '入参仅 code + 可选 marketSuffix（后缀候选 .SH/.SZ/.BJ，命中即停）；'
      + 'TdxW 未启动/开关关闭时 available=false 且 notes 说明原因（不阻塞调用方其余数据）。'
      + '字段以字符串原样透出（缺失为 null，MUST NOT 用 0/空串冒充）。',
    parameters: {
      code: { type: 'string', description: '6 位代码（兼容 sh/sz/bj 前缀与 .SH/.SZ/.BJ 后缀，经 normalizeCode 归一）', required: true },
      marketSuffix: {
        type: 'string',
        enum: ['.SH', '.SZ', '.BJ'],
        description: '可选：显式市场后缀（优先；缺省按 .SH→.SZ→.BJ 候选序列命中即停）',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          available: { type: 'boolean' },
          code: { type: 'string' },
          marketSuffix: nullableString(),
          name: nullableString(),
          kind: nullableString(),
          listedAt: nullableString(),
          region: nullableString(),
          industry: nullableString(),
          floatSharesWan: nullableString(),
          totalSharesWan: nullableString(),
          source: { type: 'string' },
          fetchedAt: { type: 'string' },
          cacheReused: { type: 'boolean' },
          notes: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStockBasicsText(value as unknown as StockBasics) }],
    },
    execute: async (args) => facade.stockBasics({ code: args.code, marketSuffix: args.marketSuffix as MarketSuffix | undefined }) as never,
  })
}
