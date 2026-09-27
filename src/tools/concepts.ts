/**
 * T2 工具 `get_concepts`（concepts-tool spec / tasks 6.4）。
 *
 * 与 service 出口 `traderKit.data.getConcepts` **同一实现**（facade 注入）。
 * 输出 schema 快照含 businessDate（可 null）/ reason / plateId / strength /
 * strengthPct / notes / errors（tasks 6.4 验收）。
 *
 * 台账指向：本模块为**自建**（无脚本来源；S8 口径偏离见 carryover §3.1），tasks 8.4。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ConceptsResult } from '../data/concepts.ts'
import { nullableString, guardRejectionSpec, sourcedField } from './shared.ts'

export interface ConceptsFacade {
  getConcepts(input: { code: string; date?: string }): Promise<ConceptsResult>
}

/** 纯文本投影。 */
export function renderConceptsText(value: ConceptsResult): string {
  const lines: string[] = []
  lines.push(`概念查询：${value.code} requestedDate=${value.requestedDate} available=${value.available ? 'true' : 'false'} source=${value.source ?? 'null'}`)
  if (!value.available) {
    lines.push(`状态：数据不可用——${value.errors.length > 0 ? value.errors.join('；') : '该标的无概念数据'}`)
  }
  lines.push(`businessDate=${value.businessDate ?? 'null（源无日期，按 requestedDate 缓存）'} name=${value.name ?? 'null（反查未命中）'}`)
  if (value.concepts.length > 0) {
    lines.push(`概念 ${value.concepts.length} 项（按 strengthPct 降序）：`)
    for (const item of value.concepts) {
      const reason = item.reason.value === null ? '未取得（best-effort）' : String(item.reason.value)
      lines.push(`  - ${item.name ?? '未取得'} ${item.strength} ${item.strengthPct}（reason: ${reason}）`)
    }
  } else {
    lines.push('概念：未取得（0 项为显式不可用态，不冒充数据）')
  }
  if (value.notes.length > 0) lines.push(`notes: ${value.notes.join('；')}`)
  if (value.errors.length > 0) lines.push(`errors: ${value.errors.join('；')}`)
  if (value.guard !== null) lines.push(`guard: ${value.guard.reason}（limit=${value.guard.limit}, used=${value.guard.used}）`)
  return lines.join('\n')
}

/** 注册用工具定义。 */
export function createConceptsTool(facade: ConceptsFacade) {
  return defineTool({
    name: 'get_concepts',
    description:
      '查询个股所属概念板块与强度（T2，选股宝实时快照，主源无备源）。'
      + '返回 concepts[]（按 strengthPct 降序，每项含 name/strength/strengthPct/reason/plateId 与来源标注）、'
      + 'name（热门股名称反查，best-effort 未命中为 null）、businessDate（源无日期字段恒为 null）。'
      + '入参 code（6 位数字）与可选 date（仅用于缓存分桶——S8 是实时快照接口，不解释为历史日快照，不产生 dateUnavailable）。'
      + '不可用时的表现：available=false + errors（如 sourceUnavailable），不用空列表冒充成功。',
    parameters: {
      code: { type: 'string', description: '6 位股票代码（不补全不猜测）', required: true },
      date: { type: 'string', description: '可选：仅用于缓存分桶（canonical YYYY-MM-DD 或 8 位 YYYYMMDD）；不影响取数内容' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          available: { type: 'boolean' },
          code: { type: 'string' },
          requestedDate: { type: 'string' },
          businessDate: nullableString(),
          name: nullableString(),
          concepts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                name: nullableString(),
                strength: { type: 'string', enum: ['强', '中', '弱', '跌', '平'] },
                strengthPct: { type: 'number' },
                reason: sourcedField(nullableString()),
                plateId: sourcedField({ oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'null' }] }),
                source: { type: 'string' },
                fetchedAt: nullableString(),
              },
            },
          },
          source: nullableString(),
          fetchedAt: nullableString(),
          notes: { type: 'array', items: { type: 'string' } },
          errors: { type: 'array', items: { type: 'string' } },
          guard: guardRejectionSpec(),
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderConceptsText(value as unknown as ConceptsResult) }],
    },
    execute: async (args) => {
      // 边界转换：schema 推断类型与结果类型结构一致（值面为 JSON），此处统一收口。
      const result = await facade.getConcepts({ code: args.code, date: args.date })
      return result as never
    },
  })
}
