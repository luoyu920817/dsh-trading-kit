/**
 * T0 工具 `get_trade_date`（trade-date-tool spec / tasks 4.2）。
 *
 * 与 service 出口 `traderKit.data.resolveTradeDate` **同一实现**（facade 注入），
 * MUST NOT 各自实现取数逻辑（data-tool-contract「双出口同一实现」）。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { TradeDateResult } from '../data/trade-date.ts'
import { nullableString, trueOrNull, guardRejectionSpec } from './shared.ts'

/** 工具消费的最小 facade（与 TraderKitService['data'] 同一实现）。 */
export interface TradeDateFacade {
  resolveTradeDate(input: { date?: string }): Promise<TradeDateResult>
}

/** 纯文本投影（页面/会话可读；不可用态不渲染成 0/--/空）。 */
export function renderTradeDateText(value: TradeDateResult): string {
  const lines: string[] = []
  lines.push(`交易日解析：requestedDate=${value.requestedDate}`)
  if (value.businessDate === null) {
    lines.push(`businessDate=null（源不可用或响应无业务日，归属待确认——MUST NOT 用系统日期兜底）`)
  } else {
    lines.push(`businessDate=${value.businessDate}`)
  }
  lines.push(`isTradingDay=${value.isTradingDay === true ? 'true' : 'null'}${value.isTradingDay === null ? '（null=归属待用户确认，无交易日历不推断非交易日）' : ''}`)
  lines.push(`source=${value.source ?? 'null'} fetchedAt=${value.fetchedAt ?? 'null'}`)
  lines.push(`evidence: rateLimitDate=${value.evidence.rateLimitDate}, field=${value.evidence.businessDateField}, rule=${value.evidence.rule}`)
  if (value.errors.length > 0) lines.push(`errors: ${value.errors.join('；')}`)
  if (value.notes.length > 0) lines.push(`notes: ${value.notes.join('；')}`)
  if (value.guard !== null) lines.push(`guard: ${value.guard.reason}（limit=${value.guard.limit}, used=${value.guard.used}）`)
  return lines.join('\n')
}

/** 注册用工具定义（execute 与 service 同一实现函数）。 */
export function createTradeDateTool(facade: TradeDateFacade) {
  return defineTool({
    name: 'get_trade_date',
    description:
      '解析 A 股交易日归属（T0 日期事实源）。返回请求日（requestedDate）、业务日（businessDate，来自数据源响应体、非系统日期）'
      + '与是否交易日（isTradingDay：业务日==限流日 → true；否则 null=归属待确认；无交易日历，绝不返回 false）。'
      + '入参 date 可选（canonical YYYY-MM-DD，兼容 YYYYMMDD；缺省=限流日）；'
      + '源不可用时 businessDate=null 且 errors 说明原因，不做日期兜底。',
    parameters: {
      date: { type: 'string', description: '可选：canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD）；缺省 = 限流日' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          requestedDate: { type: 'string' },
          businessDate: nullableString(),
          isTradingDay: trueOrNull(),
          source: nullableString(),
          fetchedAt: nullableString(),
          evidence: {
            type: 'object',
            additionalProperties: true,
            properties: {
              rateLimitDate: { type: 'string' },
              businessDateField: { type: 'string' },
              businessDateRaw: nullableString(),
              businessDateValue: nullableString(),
              rule: { type: 'string' },
            },
          },
          errors: { type: 'array', items: { type: 'string' } },
          notes: { type: 'array', items: { type: 'string' } },
          guard: guardRejectionSpec(),
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderTradeDateText(value as unknown as TradeDateResult) }],
    },
    execute: async (args) => {
      // 边界转换：schema 推断类型与结果类型结构一致（值面为 JSON），此处统一收口。
      const result = await facade.resolveTradeDate({ date: args.date })
      return result as never
    },
  })
}
