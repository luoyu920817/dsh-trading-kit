/**
 * T0/T1/T2 工具的输出 schema 公共片段（dsh-tools ValueSchemaSpec DSL）。
 *
 * 说明：`ValueSchemaSpec` 无「nullable string」节点，可空字段统一用
 * `oneOf [T, null]` 表达；`isTradingDay: true | null` 用 `const: true` 约束取值域
 * （trade-date-tool spec：类型与 schema 双层约束）。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import type { ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export function nullableString(): ValueSchemaSpec {
  return { oneOf: [{ type: 'string' }, { type: 'null' }] }
}

export function nullableNumber(): ValueSchemaSpec {
  return { oneOf: [{ type: 'number' }, { type: 'null' }] }
}

/** `true | null`（无交易日历：MUST NOT 返回 false）。 */
export function trueOrNull(): ValueSchemaSpec {
  return { oneOf: [{ type: 'boolean', const: true }, { type: 'null' }] }
}

/** 逐字段信封（value 可空标量 + source/fetchedAt 可空字符串）。 */
export function sourcedField(value: ValueSchemaSpec): ValueSchemaSpec {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      value,
      source: nullableString(),
      fetchedAt: nullableString(),
    },
  }
}

export const GUARD_REASONS = ['sessionRejected', 'budgetExhausted', 'batchLimitExceeded', 'intervalLimited'] as const

/** 具名拒绝态（design D-16：消费方按 reason 分支，MUST NOT 解析文案）。 */
export function guardRejectionSpec(): ValueSchemaSpec {
  return {
    oneOf: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          rejected: { type: 'boolean', const: true },
          reason: { type: 'string', enum: [...GUARD_REASONS] },
          limit: { type: 'number' },
          used: { type: 'number' },
        },
      },
      { type: 'null' },
    ],
  }
}
