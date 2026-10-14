import type { JsonObject, JsonValue, WorkflowResult, WorkflowRunEvent, WorkflowRunRecord } from './types.ts'

/**
 * 核验通用工作流结果，不强制业务schema。
 * 业务逻辑: 只接纳summary及可选JSON data，深度和总大小受限。
 * 关键判断: 拒绝额外身份字段、函数、原型对象、循环、非有限数和过深结构。
 * 异常处理: 非法输出抛稳定码，不修复模型JSON。
 * 参数: result为未知输出。返回: 独立合法结果。
 */
export function validateWorkflowResult(result: unknown): WorkflowResult {
  if (!result || typeof result !== 'object' || Array.isArray(result) || Object.getPrototypeOf(result) !== Object.prototype || Object.keys(result).some(key => key !== 'summary' && key !== 'data')) throw new Error('WORKFLOW_RESULT_INVALID')
  const value = result as Record<string, unknown>
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 16_384) throw new Error('WORKFLOW_RESULT_INVALID')
  const pending = [{ value: result, depth: 0 }]
  const objects = new Set<object>()
  while (pending.length) {
    const entry = pending.pop()!
    const item = entry.value
    if (entry.depth > 32) throw new Error('WORKFLOW_RESULT_INVALID')
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue
    if (typeof item === 'number' && Number.isFinite(item)) continue
    if (!item || typeof item !== 'object' || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) || objects.has(item)) throw new Error('WORKFLOW_RESULT_INVALID')
    objects.add(item)
    for (const child of Object.values(item)) pending.push({ value: child, depth: entry.depth + 1 })
  }
  const text = JSON.stringify(result)
  if (Buffer.byteLength(text, 'utf8') > 128 * 1024) throw new Error('WORKFLOW_RESULT_INVALID')
  return JSON.parse(text) as WorkflowResult
}

/**
 * 清除记录内已知私有凭据及配置中的秘密值。
 * 业务逻辑: 收集尝试token和敏感配置字段，再替换消息中的完整值。
 * 关键判断: 不把原始异常/配置串直接透出；不宣称能识别所有未知业务秘密。
 * 异常处理: 输入限制为字符串，非法拒绝。
 * 参数: record和消息。返回: 有界脱敏文字。
 */
export function redactRunText(record: WorkflowRunRecord, message: string): string {
  if (typeof message !== 'string') throw new Error('WORKFLOW_LOG_INVALID')
  const secrets = record.activeAttemptToken ? [record.activeAttemptToken] : []
  const pending: { key: string; value: JsonValue }[] = [{ key: '', value: record.optionsSnapshot }]
  while (pending.length) {
    const { key, value } = pending.pop()!
    if (typeof value === 'string' && /token|secret|password|credential|api.?key/i.test(key) && value.length > 0) secrets.push(value)
    else if (value !== null && typeof value === 'object') for (const [child, item] of Object.entries(value)) pending.push({ key: /token|secret|password|credential|api.?key/i.test(key) ? key : child, value: item })
  }
  let text = message
  for (const secret of secrets.sort((a, b) => b.length - a.length)) text = text.replaceAll(secret, '[已脱敏]')
  return text
}

/**
 * 在单条记录里追加有界安全事件。
 * 业务逻辑: 单调序号、精确尝试关联与脱敏信息一起交记录CAS写入。
 * 关键判断: details只允许原始值且屏蔽路径/凭据字段，日志不包含配置或正文副本。
 * 异常处理: 非法消息拒绝；存储错误由调用方传播。
 * 参数: 记录、事件码/消息/时间、可选详情/级别。返回: 原记录（供同次原子写入）。
 */
export function appendRunEvent(record: WorkflowRunRecord, code: string, message: string, occurredAt: string, details: JsonObject = {}, level: WorkflowRunEvent['level'] = 'info'): WorkflowRunRecord {
  const clean: WorkflowRunEvent['details'] = {}
  for (const [key, value] of Object.entries(details)) {
    if (/path|cwd|token|secret|password|credential|body|prompt/i.test(key)) continue
    if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) clean[key] = value
    else if (typeof value === 'string') clean[key] = redactRunText(record, value).slice(0, 1000)
  }
  const sequence = (record.timeline.at(-1)?.sequence ?? record.omittedEventCount) + 1
  record.timeline.push({ sequence, eventId: `${record.runId}:${sequence}`, occurredAt, level, code, message: redactRunText(record, message).slice(0, 2000), runId: record.runId, attemptId: record.activeAttemptId, nativeJobId: record.currentNativeJobId, executionSessionId: record.attempts.find(attempt => attempt.attemptId === record.activeAttemptId)?.executionSessionId ?? null, details: clean })
  if (record.timeline.length > 200) { const excess = record.timeline.length - 200; record.timeline.splice(0, excess); record.omittedEventCount += excess }
  record.firstRetainedSequence = record.timeline[0]?.sequence ?? null
  record.updatedAt = occurredAt
  return record
}

/**
 * 冻结合法历史结果并结束当前尝试。
 * 业务逻辑: 检查当前attempt/token，结果/成功事件和状态合并一次写入。
 * 关键判断: 成功不倒退；旧来源结果由applicability标识历史，不能冒充当前。
 * 异常处理: 旧凭据/非法结果拒绝，不覆盖已提交结果。
 * 参数: 当前记录、明确结果、绑定attempt/token、完成时间。返回: 待CAS写入记录。
 */
export function completeWorkflowResult(record: WorkflowRunRecord, result: WorkflowResult, attemptId: string, token: string, now: string): WorkflowRunRecord {
  if (record.executionState !== 'running' || record.activeAttemptId !== attemptId || record.activeAttemptToken !== token || record.warnings.some(warning => warning.code === 'RUN_CANCEL_REQUESTED')) throw new Error('WORKFLOW_ATTEMPT_STALE')
  const validated = validateWorkflowResult(result)
  const clean = JSON.parse(JSON.stringify(validated, (key, value: unknown) => /token|secret|password|credential|cwd/i.test(key) ? '[已脱敏]' : typeof value === 'string' ? redactRunText(record, value) : value)) as WorkflowResult
  record.result = { ...clean, inputRevision: record.inputRevision, definitionRevision: record.definitionRevision, generatedAt: now, declaration: '仅研究辅助，不构成投资建议' }
  appendRunEvent(record, 'RESULT_COMMITTED', '工作流结果已保存', now)
  const attempt = record.attempts.find(entry => entry.attemptId === attemptId)!
  attempt.finishedAt = now; attempt.outcome = 'completed'
  record.activeAttemptId = null; record.activeAttemptToken = null
  record.executionState = 'succeeded'; record.waitingReason = null; record.resultDelivery = 'complete'; record.deliveryReason = null
  return record
}
