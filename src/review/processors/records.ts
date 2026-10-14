import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { link, lstat, mkdir, open, readdir, realpath, rename, rm } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { resolveArea } from '../../paths/resolve.ts'
import { canonicalJson, cardIdentity, inputRevision, requestIdentity } from './identity.ts'
import { assertTaskInvariants } from './types.ts'
import { validateWorkflowResult } from './results.ts'
import type { JsonValue, WorkflowRecordStore, WorkflowRunRecord } from './types.ts'

const MAX_BYTES = 2 * 1024 * 1024
const queues = new Map<string, Promise<void>>()
const ownedLocks = new AsyncLocalStorage<ReadonlySet<string>>()
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/
const HASH = /^[0-9a-f]{64}$/
const FIELDS = 'schemaVersion recordVersion runId cardId workflowId workflowLabel implementationId requestKey requestSequence triggerReason sourceSnapshot mentions sourceRevision inputRevision definitionRevision optionsSnapshot executionState waitingReason applicability activeAttemptToken activeAttemptId attempts currentNativeJobId runtimeInstanceId nextAdmissionAt createdAt updatedAt result resultDelivery deliveryReason error warnings timeline omittedEventCount firstRetainedSequence'.split(' ')

/** 业务逻辑: 拒绝损坏持久事实；关键判断: 不包含路径或正文；异常处理: 上层failclosed。参数: 无。返回: 不返回。 */
function corrupt(): never { throw new Error('RECORD_STORAGE_INVALID') }

/** 业务逻辑: 完整字段schema核验；关键判断: 未知/缺字段均拒绝；异常处理: 损坏拒绝。参数: 值/字段。返回: 对象。 */
function shape(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) corrupt()
  const item = value as Record<string, unknown>
  if (Object.keys(item).length !== fields.length || fields.some(key => !Object.hasOwn(item, key))) corrupt()
  return item
}

/** 业务逻辑: 有界字符串事实；关键判断: 不强制归一化内容；异常处理: 损坏拒绝。参数: 值/长度/是否允许空。返回: 字符串。 */
function text(value: unknown, max = 256, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.length) || value.length > max) corrupt()
  return value
}

/** 业务逻辑: 验证完整时间；关键判断: 非日期数字不可作时间；异常处理: 损坏拒绝。参数: 值。返回: 无。 */
function timestamp(value: unknown): void {
  const item = text(value, 64)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(item) || !Number.isFinite(Date.parse(item))) corrupt()
}

/** 业务逻辑: 核验整数计数；关键判断: 无负数/小数/溢出；异常处理: 损坏拒绝。参数: 值/下限。返回: 无。 */
function count(value: unknown, min = 0): void { if (!Number.isSafeInteger(value) || (value as number) < min) corrupt() }

/** 业务逻辑: 核验可空文本；关键判断: undefined不代null；异常处理: 损坏拒绝。参数: 值。返回: 无。 */
function nullableText(value: unknown): void { if (value !== null) text(value) }

/** 业务逻辑: 核验稳定问题对象；关键判断: 只含code/message；异常处理: 损坏拒绝。参数: 值。返回: 无。 */
function issue(value: unknown): void {
  const item = shape(value, ['code', 'message'])
  text(item.code, 128); text(item.message, 2000, true)
}

/**
 * 校验完整运行JSON事实。
 * 业务逻辑: 完整schema、来源/输入/请求指纹、attempt、结果和日志一致性一起核验。
 * 关键判断: 不恢复函数/句柄，不修补坏记录；最多2MiB、200事件且单调序号。
 * 异常处理: 所有损坏统一RECORD_STORAGE_INVALID。
 * 参数: value未知事实。返回: 与调用者分离的合法快照。
 */
export function validateWorkflowRunRecord(value: unknown): WorkflowRunRecord {
  try {
    const encoded = canonicalJson(value as JsonValue)
    if (Buffer.byteLength(encoded) > MAX_BYTES) corrupt()
    const item = shape(JSON.parse(encoded), FIELDS)
    if (item.schemaVersion !== 1) corrupt()
    count(item.recordVersion, 1); count(item.requestSequence, 1); count(item.omittedEventCount)
    for (const key of ['runId', 'cardId', 'workflowId', 'workflowLabel', 'implementationId', 'requestKey', 'triggerReason', 'sourceRevision', 'inputRevision', 'definitionRevision']) text(item[key])
    if (!RUN_ID.test(String(item.runId)) || !HASH.test(String(item.cardId)) || !HASH.test(String(item.requestKey))) corrupt()
    const source = shape(item.sourceSnapshot, ['relativePath', 'anchor', 'market', 'code', 'tradeDate', 'body', 'sourceRevision', 'verification'])
    text(source.body, MAX_BYTES, true)
    const record = item as unknown as WorkflowRunRecord
    if (record.cardId !== cardIdentity(record.sourceSnapshot) || record.sourceRevision !== source.sourceRevision || record.inputRevision !== inputRevision(record.sourceSnapshot) || record.requestKey !== requestIdentity(record.sourceSnapshot, record.workflowId, record.inputRevision, record.definitionRevision)) corrupt()
    const options = record.optionsSnapshot
    if (!options || typeof options !== 'object' || Array.isArray(options)) corrupt()
    if (!['queued', 'waiting', 'preparing', 'running', 'retryWaiting', 'succeeded', 'failed', 'canceled'].includes(record.executionState) || !['current', 'sourceChanged', 'sourceRemoved', 'sourceUnverified', 'configurationChanged'].includes(record.applicability) || !['none', 'pending', 'complete', 'obsolete'].includes(record.resultDelivery) || record.waitingReason !== null && !['workflowDisabled', 'sourceNeedsReview', 'capability', 'budget', 'hostCapacity', 'storage'].includes(record.waitingReason)) corrupt()
    for (const key of ['activeAttemptToken', 'activeAttemptId', 'currentNativeJobId', 'runtimeInstanceId', 'deliveryReason']) nullableText(item[key])
    if (record.nextAdmissionAt !== null) timestamp(record.nextAdmissionAt)
    timestamp(record.createdAt); timestamp(record.updatedAt)
    if (!Array.isArray(record.mentions) || record.mentions.length > 1000) corrupt()
    for (const value of record.mentions) {
      const mention = shape(value, ['raw', 'name', 'start', 'end', 'processorId'])
      text(mention.raw, 256); text(mention.name, 128); count(mention.start); count(mention.end)
      if (mention.processorId !== record.workflowId || (mention.start as number) >= (mention.end as number) || (mention.end as number) > record.sourceSnapshot.body.length || record.sourceSnapshot.body.slice(mention.start as number, mention.end as number) !== mention.raw) corrupt()
    }
    if (!Array.isArray(record.attempts) || record.attempts.length > 1000 || new Set(record.attempts.map(attempt => attempt.attemptId)).size !== record.attempts.length) corrupt()
    for (const value of record.attempts) {
      const attempt = shape(value, ['attemptId', 'startedAt', 'finishedAt', 'provider', 'model', 'executionSessionId', 'nativeJobId', 'runtimeInstanceId', 'outcome'])
      for (const key of ['attemptId', 'nativeJobId', 'runtimeInstanceId']) text(attempt[key])
      for (const key of ['provider', 'model', 'executionSessionId']) nullableText(attempt[key])
      timestamp(attempt.startedAt)
      if (attempt.finishedAt !== null) timestamp(attempt.finishedAt)
      if (attempt.outcome !== null && !['completed', 'killed', 'failed'].includes(String(attempt.outcome)) || (attempt.finishedAt === null) !== (attempt.outcome === null)) corrupt()
    }
    if (record.result !== null) {
      const result = shape(record.result, record.result.data === undefined ? ['summary', 'inputRevision', 'definitionRevision', 'generatedAt', 'declaration'] : ['summary', 'data', 'inputRevision', 'definitionRevision', 'generatedAt', 'declaration'])
      validateWorkflowResult({ summary: result.summary, ...(result.data === undefined ? {} : { data: result.data }) })
      timestamp(result.generatedAt); text(result.declaration, 2000)
      if (result.inputRevision !== record.inputRevision || result.definitionRevision !== record.definitionRevision) corrupt()
    }
    if (record.error !== null) issue(record.error)
    if (!Array.isArray(record.warnings) || record.warnings.length > 1000) corrupt()
    record.warnings.forEach(issue)
    if (!Array.isArray(record.timeline) || record.timeline.length > 200) corrupt()
    for (let index = 0; index < record.timeline.length; index++) {
      const event = shape(record.timeline[index], ['sequence', 'eventId', 'occurredAt', 'level', 'code', 'message', 'runId', 'attemptId', 'nativeJobId', 'executionSessionId', 'details'])
      if (event.sequence !== record.omittedEventCount + index + 1 || event.runId !== record.runId || event.eventId !== `${record.runId}:${event.sequence}` || !['info', 'warn', 'error'].includes(String(event.level))) corrupt()
      timestamp(event.occurredAt); text(event.code, 128); text(event.message, 2000, true)
      for (const key of ['attemptId', 'nativeJobId', 'executionSessionId']) nullableText(event[key])
      if (!event.details || typeof event.details !== 'object' || Array.isArray(event.details) || Object.values(event.details).some(value => value !== null && typeof value !== 'boolean' && typeof value !== 'string' && typeof value !== 'number')) corrupt()
    }
    if (record.firstRetainedSequence !== (record.timeline[0]?.sequence ?? null)) corrupt()
    assertTaskInvariants(record)
    if (record.executionState === 'running') {
      const attempt = record.attempts.find(entry => entry.attemptId === record.activeAttemptId)!
      if (attempt.nativeJobId !== record.currentNativeJobId || attempt.runtimeInstanceId !== record.runtimeInstanceId) corrupt()
    }
    return record
  } catch { corrupt() }
}

/**
 * 获取同根排序锁并检测重入。
 * 业务逻辑: 所有实例共享锁队列，反序嵌套拒绝；内部create可沿已持group锁前进。
 * 关键判断: 不持磁盘锁等待宿主；finally逆序释放，错误不污染队列。
 * 异常处理: 重入/反序稳定拒绝，业务异常透传。
 * 参数: root/键/短回调/内部是否复用已持锁。返回: 回调值。
 */
async function locked<T>(root: string, keys: readonly string[], commit: () => Promise<T>, reuseOwned = false): Promise<T> {
  const prior = ownedLocks.getStore() ?? new Set<string>()
  const requested = [...new Set(keys)].sort().map(key => root + '\0' + key)
  if (!reuseOwned && requested.some(key => prior.has(key))) throw new Error('RECORD_LOCK_REENTRANT')
  const fresh = requested.filter(key => !prior.has(key))
  const held = [...prior].filter(key => key.startsWith(root + '\0')).sort()
  if (held.length && fresh.some(key => key < held.at(-1)!)) throw new Error('RECORD_LOCK_ORDER_INVALID')
  const releases: (() => void)[] = []
  try {
    for (const key of fresh) {
      const previous = queues.get(key) ?? Promise.resolve()
      let release!: () => void
      const wait = new Promise<void>(resolve => { release = resolve })
      const tail = previous.then(() => wait)
      queues.set(key, tail)
      await previous
      releases.push(() => { release(); if (queues.get(key) === tail) queues.delete(key) })
    }
    return await ownedLocks.run(new Set([...prior, ...fresh]), commit)
  } finally { releases.reverse().forEach(release => release()) }
}

/**
 * 建立同根持久运行存储。
 * 业务逻辑: 只写已登记processorRuns/runs，create-only硬链接发布、CAS同目录rename。
 * 关键判断: 每次IO复核真实根与全部目录，无文件/目录链接；读取坏JSON不当缺失。
 * 异常处理: 缺记录null，损坏/目录部分读取拒绝；所有原异常不含入稳定外部错误。
 * 参数: dataRoot真实数据根。返回: 记录服务和完整只读listRuns。
 */
export function createWorkflowRecordStore(dataRoot: string): WorkflowRecordStore & { listRuns(): Promise<WorkflowRunRecord[]> } {
  const root = resolve(dataRoot)
  if (!dataRoot) throw new Error('RECORD_PATH_INVALID')
  const directory = join(resolveArea(root, 'processorRuns', {}, { forWrite: true }).absPath, 'runs')

  /** 业务逻辑: 验证或创建固定目录链；关键判断: 无递归mkdir跟随链接；异常处理: 只缺失读目录返回false。参数: 是否创建。返回: 存在。 */
  async function safeDirectory(create: boolean): Promise<boolean> {
    try {
      const rootInfo = await lstat(root)
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || await realpath(root) !== root) throw new Error('RECORD_PATH_INVALID')
      let current = root
      for (const segment of relative(root, directory).split(sep)) {
        current = join(current, segment)
        if (create) await mkdir(current).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
        let info
        try { info = await lstat(current) } catch (error) { if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error }
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(current) !== current) throw new Error('RECORD_PATH_INVALID')
      }
      return true
    } catch (error) { if (error instanceof Error && error.message === 'RECORD_PATH_INVALID') throw error; throw new Error('STORAGE_UNAVAILABLE', { cause: error }) }
  }

  /** 业务逻辑: 限制文件键；关键判断: 无路径/扩展注入；异常处理: 非法ID拒绝。参数: ID。返回: 固定绝对文件路径。 */
  function filePath(runId: string): string {
    if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('RUN_ID_INVALID')
    return join(directory, runId + '.json')
  }

  /** 业务逻辑: 读取完整原子文件并校验；关键判断: 限2MiB、真实文件无链接、filename匹配runId；异常处理: 仅ENOENT为null。参数: ID。返回: 记录或null。 */
  async function read(runId: string): Promise<WorkflowRunRecord | null> {
    const path = filePath(runId)
    if (!await safeDirectory(false)) return null
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      const info = await lstat(path)
      if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES || await realpath(path) !== path) corrupt()
      handle = await open(path, 'r')
      const bytes = await handle.readFile()
      if (bytes.length > MAX_BYTES || await realpath(path) !== path) corrupt()
      const record = validateWorkflowRunRecord(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))
      if (record.runId !== runId) corrupt()
      return record
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      if (error instanceof SyntaxError || error instanceof TypeError) corrupt()
      if (error instanceof Error && ['RECORD_STORAGE_INVALID', 'RECORD_PATH_INVALID'].includes(error.message)) throw error
      throw new Error('STORAGE_UNAVAILABLE', { cause: error })
    } finally { await handle?.close() }
  }

  /** 业务逻辑: 完整目录读取；关键判断: 只忽略本实现的原子临时文件，未知/消失/坏记录均拒绝；异常处理: 不返回部分列表。参数: 无。返回: 全部快照。 */
  async function listRuns(): Promise<WorkflowRunRecord[]> {
    if (!await safeDirectory(false)) return []
    let entries
    try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { throw new Error('STORAGE_UNAVAILABLE', { cause: error }) }
    const runs: WorkflowRunRecord[] = []
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (/^\.[A-Za-z0-9_-]{1,128}\.[0-9a-f-]{36}\.tmp$/.test(entry.name) && entry.isFile()) continue
      if (!entry.isFile() || !/^[A-Za-z0-9_-]{1,128}\.json$/.test(entry.name)) corrupt()
      const record = await read(entry.name.slice(0, -5))
      if (!record) corrupt()
      runs.push(record)
    }
    return runs
  }

  /** 业务逻辑: 完整组读取及序号检查；关键判断: 重复或中间缺号不选赢家；异常处理: 任意目录失败传播。参数: hash。返回: 序号排序历史。 */
  async function readRequestGroup(requestKey: string): Promise<WorkflowRunRecord[]> {
    if (typeof requestKey !== 'string' || !HASH.test(requestKey)) throw new Error('REQUEST_KEY_INVALID')
    const group = (await listRuns()).filter(run => run.requestKey === requestKey).sort((a, b) => a.requestSequence - b.requestSequence)
    if (group.some((run, index) => run.requestSequence !== index + 1)) throw new Error('RECORD_GROUP_INCOMPLETE')
    return group
  }

  /** 业务逻辑: 同目录fsync后原子发布；关键判断: create-only用link禁止覆盖，update仅锁内CAS后rename；异常处理: 未发布临时文件清理。参数: 完整快照/是否新建。返回: 无。 */
  async function publish(record: WorkflowRunRecord, create: boolean): Promise<void> {
    await safeDirectory(true)
    const path = filePath(record.runId), temp = join(directory, `.${record.runId}.${randomUUID()}.tmp`)
    let published = false
    try {
      const handle = await open(temp, 'wx')
      try { await handle.writeFile(canonicalJson(record as unknown as JsonValue), 'utf8'); await handle.sync() } finally { await handle.close() }
      await safeDirectory(false)
      if (create) { await link(temp, path); published = true; await rm(temp) }
      else { await rename(temp, path); published = true }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error('RUN_EXISTS')
      if (error instanceof Error && error.message === 'RECORD_PATH_INVALID') throw error
      throw new Error('STORAGE_UNAVAILABLE', { cause: error })
    } finally { if (!published) await rm(temp, { force: true }) }
  }

  return {
    readRun: read, listRuns, readRequestGroup,
    /** 业务逻辑: 组锁后run锁内create-only；关键判断: 新序号恰好为下一号且完整JSON先校验；异常处理: 存在/序号冲突拒绝。参数: record。返回: 无。 */
    async createRun(value): Promise<void> {
      const record = validateWorkflowRunRecord(value)
      if (record.recordVersion !== 1) throw new Error('RUN_VERSION_CONFLICT')
      await locked(root, [`group:${record.requestKey}`, `run:${record.runId}`], async () => {
        if (await read(record.runId)) throw new Error('RUN_EXISTS')
        const group = await readRequestGroup(record.requestKey)
        if (record.requestSequence !== group.length + 1) throw new Error('RUN_SEQUENCE_CONFLICT')
        await publish(record, true)
      }, true)
    },
    /** 业务逻辑: 锁内核当前版本后原子替换；关键判断: 身份/原事实不变，成功结果绝不回滚或改写；异常处理: stale冲突/结果回滚拒绝。参数: 下一快照/当前版本。返回: 已保存快照。 */
    async updateRun(value, expectedRecordVersion): Promise<WorkflowRunRecord> {
      const record = validateWorkflowRunRecord(value)
      if (!Number.isSafeInteger(expectedRecordVersion) || expectedRecordVersion < 1 || record.recordVersion !== expectedRecordVersion + 1) throw new Error('RUN_VERSION_CONFLICT')
      return locked(root, [`run:${record.runId}`], async () => {
        const previous = await read(record.runId)
        if (!previous) throw new Error('RUN_NOT_FOUND')
        if (previous.recordVersion !== expectedRecordVersion) throw new Error('RUN_VERSION_CONFLICT')
        for (const key of ['runId', 'cardId', 'workflowId', 'workflowLabel', 'implementationId', 'requestKey', 'requestSequence', 'triggerReason', 'sourceSnapshot', 'mentions', 'sourceRevision', 'inputRevision', 'definitionRevision', 'optionsSnapshot', 'createdAt'] as const) if (canonicalJson(previous[key] as JsonValue) !== canonicalJson(record[key] as JsonValue)) throw new Error('RECORD_IDENTITY_IMMUTABLE')
        if (previous.executionState === 'succeeded' && (record.executionState !== 'succeeded' || canonicalJson(previous.result as unknown as JsonValue) !== canonicalJson(record.result as unknown as JsonValue))) throw new Error('RECORD_SUCCESS_IMMUTABLE')
        if (['failed', 'canceled'].includes(previous.executionState) && record.executionState !== previous.executionState) throw new Error('RECORD_TERMINAL_IMMUTABLE')
        if ((record.timeline.at(-1)?.sequence ?? record.omittedEventCount) < (previous.timeline.at(-1)?.sequence ?? previous.omittedEventCount)) corrupt()
        await publish(record, false)
        return record
      })
    },
    /** 业务逻辑: 外部受控同层锁；关键判断: 仅group/mutation/budget/config，去重排序且重入拒绝；异常处理: 业务异常finally释放。参数: 键/短回调。返回: 回调值。 */
    async withRecordLocks(keys, commit) {
      if (!Array.isArray(keys) || keys.length > 64 || keys.some(key => typeof key !== 'string' || !(key === 'agent-budget' || key === 'workflow-config' || /^group:[0-9a-f]{64}$/.test(key) || /^mutation:[A-Za-z0-9_-]{1,128}$/.test(key)))) throw new Error('RECORD_LOCK_INVALID')
      return locked(root, keys, commit)
    },
  }
}
