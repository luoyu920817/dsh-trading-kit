import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { isValidIsoDate } from '../../data/date.ts'
import type { JsonValue, SourceCardRef, SourceCardSnapshot } from './types.ts'

/**
 * 生成确定性JSON。
 * 业务逻辑: 对象键排序，数组及文本保持原样；关键判断: 仅有限JSON、纯对象、无循环和空洞数组。
 * 异常处理: 非JSON/过深抛CANONICAL_JSON_INVALID。
 * 参数: value为JSON事实。返回: 规范字符串。
 */
export function canonicalJson(value: JsonValue): string {
  const seen = new Set<object>()
  /** 业务逻辑: 递归编码JSON事实；关键判断: 当前祖先检测循环；异常处理: 类型/深度非法拒绝。参数: 当前值/深度。返回: 编码。 */
  function encode(item: unknown, depth: number): string {
    if (depth > 64) throw new Error('CANONICAL_JSON_INVALID')
    if (item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return JSON.stringify(item)
    if (!item || typeof item !== 'object' || seen.has(item) || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new Error('CANONICAL_JSON_INVALID')
    seen.add(item)
    let encoded: string
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) throw new Error('CANONICAL_JSON_INVALID')
      encoded = '[' + Array.from(item, value => encode(value, depth + 1)).join(',') + ']'
    } else {
      const fields = item as Record<string, unknown>
      encoded = '{' + Object.keys(fields).sort().map(key => JSON.stringify(key) + ':' + encode(fields[key], depth + 1)).join(',') + '}'
    }
    seen.delete(item)
    return encoded
  }
  return encode(value, 0)
}

/** 业务逻辑: SHA256规范事实；关键判断: 不依赖对象插入顺序；异常处理: 非JSON拒绝。参数: 事实。返回: 64位hash。 */
function digest(value: JsonValue): string { return createHash('sha256').update(canonicalJson(value)).digest('hex') }

/** 业务逻辑: 验证原相对身份；关键判断: 不跟更名/不猜市场；异常处理: 路径/归属非法拒绝。参数: source。返回: 无。 */
function checkSource(source: SourceCardRef): void {
  if (!source || typeof source.relativePath !== 'string' || isAbsolute(source.relativePath) || !/^DB\/review\/\d{6}\/[^/\\]+\.md$/.test(source.relativePath) || source.relativePath.split('/').includes('..') || typeof source.anchor !== 'string' || !source.anchor.trim() || source.anchor.length > 128 || !/^\d{6}$/.test(source.code) || !isValidIsoDate(source.tradeDate) || ![null, 'sh', 'sz', 'bj'].includes(source.market)) throw new Error('IDENTITY_ARGUMENT_INVALID')
}

/**
 * 固定卡片身份。
 * 业务逻辑: 原路径、anchor、market、code、交易日组成SHA256。
 * 关键判断: bare市场null不合并显式市场；异常处理: 非法来源拒绝。
 * 参数: source实际来源身份。返回: 卡片hash。
 */
export function cardIdentity(source: SourceCardRef): string {
  checkSource(source)
  return digest([source.relativePath, source.anchor, source.market, source.code, source.tradeDate])
}

/**
 * 固定整卡输入修订。
 * 业务逻辑: 卡片身份、原正文和核验来源版本组成SHA256。
 * 关键判断: 不归一化换行/空格，不拿mtime或附注代正文；异常处理: 缺原文/来源版本拒绝。
 * 参数: source核验快照。返回: 输入hash。
 */
export function inputRevision(source: SourceCardSnapshot): string {
  if (typeof source.body !== 'string' || typeof source.sourceRevision !== 'string' || !source.sourceRevision || source.verification !== 'verified') throw new Error('IDENTITY_ARGUMENT_INVALID')
  return digest([cardIdentity(source), source.body, source.sourceRevision])
}

/**
 * 固定逻辑请求组。
 * 业务逻辑: 卡片身份、工作流、输入/定义版本组成SHA256。
 * 关键判断: 显式重跑不改组，只增加组内序号；异常处理: 空版本拒绝。
 * 参数: source/工作流/两版本。返回: 请求组hash。
 */
export function requestIdentity(source: SourceCardRef, workflowId: string, input: string, definition: string): string {
  if (![workflowId, input, definition].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 128)) throw new Error('IDENTITY_ARGUMENT_INVALID')
  return digest([cardIdentity(source), workflowId, input, definition])
}
