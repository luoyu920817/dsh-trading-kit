/**
 * T1 工具 `get_limit_reason`（limit-reason-tool spec / tasks 5.5）。
 *
 * 与 service 出口 `traderKit.data.getLimitReason` **同一实现**（facade 注入）。
 * 输出 schema 含 notes[] / hitRecordDate（可 null）/ errors / firstTime / lastTime /
 * tradeDate / requestedDate（tasks 5.5 快照断言）。
 *
 * 台账指向：本模块为**自建**（无脚本来源；S7/S5 口径偏离见 carryover §3.1），tasks 8.4。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { LimitReasonResult } from '../data/limit-reason.ts'
import { nullableString, nullableNumber, guardRejectionSpec, sourcedField } from './shared.ts'

export interface LimitReasonFacade {
  getLimitReason(input: { code: string; date?: string }): Promise<LimitReasonResult>
}

/** 逐字段文本（不可用态不渲染成 0/--/空——显示「未取得」并注明来源状态）。 */
function fieldText(label: string, f: { value: unknown; source: string | null; fetchedAt: string | null }): string {
  if (f.value === null || f.value === undefined) {
    return `${label}=未取得（source=${f.source ?? 'null'}, fetchedAt=${f.fetchedAt ?? 'null'}）`
  }
  return `${label}=${String(f.value)}（source=${f.source ?? 'null'}, fetchedAt=${f.fetchedAt ?? 'null'}）`
}

/** 纯文本投影（显式降级：不可用显示原因，MUST NOT 显示 0/--/空白冒充数据）。 */
export function renderLimitReasonText(value: LimitReasonResult): string {
  const lines: string[] = []
  lines.push(`涨停原因查询：${value.code} requestedDate=${value.requestedDate} available=${value.available ? 'true' : 'false'} source=${value.source ?? 'null'}`)
  if (!value.available) {
    // 显式不可用文案：原因 + 建议去向（change 4 降级文案按 guard.reason 具名分支）。
    lines.push(`状态：数据不可用——${value.errors.length > 0 ? value.errors.join('；') : '该标的无涨停记录（正常，非取数失败）'}`)
  }
  lines.push(`tradeDate=${value.tradeDate ?? 'null'} hitRecordDate=${value.hitRecordDate ?? 'null'}`)
  lines.push(fieldText('cause', value.cause))
  lines.push(fieldText('firstTime（首封，只认 S7 first_time）', value.firstTime))
  lines.push(fieldText('lastTime（最后封板）', value.lastTime))
  lines.push(fieldText('openCount', value.openCount))
  lines.push(fieldText('streakDesc', value.streakDesc))
  lines.push(`fetchedAt=${value.fetchedAt ?? 'null'}`)
  if (value.notes.length > 0) lines.push(`notes: ${value.notes.join('；')}`)
  if (value.errors.length > 0) lines.push(`errors: ${value.errors.join('；')}`)
  if (value.guard !== null) lines.push(`guard: ${value.guard.reason}（limit=${value.guard.limit}, used=${value.guard.used}）`)
  return lines.join('\n')
}

/** 注册用工具定义。 */
export function createLimitReasonTool(facade: LimitReasonFacade) {
  return defineTool({
    name: 'get_limit_reason',
    description:
      '查询个股涨停原因与封板时间（T1，主源换手率 surgeLimit、备源同花顺异动记录）。'
      + '返回 available、cause（原因）、firstTime（首封时刻，只认主源 first_time）、lastTime（最后封板）、openCount、streakDesc，'
      + '每字段带 source/fetchedAt；tradeDate 为源列表业务日（列表为空/标的不在列表仍可得）。'
      + '入参 code（6 位数字）与可选 date（canonical YYYY-MM-DD，兼容 YYYYMMDD；缺省=最近交易日口径）。'
      + '不可用时的表现：available=false + errors（sourceUnavailable=取数失败 / dateUnavailable=该日无数据），'
      + 'S5 备源命中时 source=S5 且 firstTime=null（S5 无首封语义）。',
    parameters: {
      code: { type: 'string', description: '6 位股票代码（不补全不猜测）', required: true },
      date: { type: 'string', description: '可选：canonical YYYY-MM-DD（兼容 8 位 YYYYMMDD）；缺省 = 限流日' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          available: { type: 'boolean' },
          code: { type: 'string' },
          requestedDate: { type: 'string' },
          tradeDate: nullableString(),
          hitRecordDate: nullableString(),
          cause: sourcedField(nullableString()),
          firstTime: sourcedField(nullableString()),
          lastTime: sourcedField(nullableString()),
          openCount: sourcedField(nullableNumber()),
          streakDesc: sourcedField(nullableString()),
          source: nullableString(),
          fetchedAt: nullableString(),
          notes: { type: 'array', items: { type: 'string' } },
          errors: { type: 'array', items: { type: 'string' } },
          guard: guardRejectionSpec(),
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderLimitReasonText(value as unknown as LimitReasonResult) }],
    },
    execute: async (args) => {
      // 边界转换：schema 推断类型与结果类型结构一致（值面为 JSON），此处统一收口。
      const result = await facade.getLimitReason({ code: args.code, date: args.date })
      return result as never
    },
  })
}
