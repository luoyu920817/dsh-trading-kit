/**
 * 关键词→工作流注册表：候选 JSON 整体校验、受信实现绑定与有效定义指纹。
 *
 * 零副作用：不读文件、不发请求、不登记运行、不调用模型、不动态 import 任意 JS/路径；
 * 只消费调用方传入的受信实现表与 JSON 文本/已解析 JSON 值（design 01 §2、
 * 契约 `docs/spikes/keyword-framework-contracts.md`）。
 * 生产默认表 = `config/card-processors.json`（安装根定位由装配层处理，注册表无路径依赖）。
 */
import { createHash } from 'node:crypto'
import { MENTION_NAME_CHAR, MENTION_NAME_MAX_CODE_POINTS } from './parser.ts'
import type { JsonObject, JsonValue, WorkflowDefinition, WorkflowImplementation } from './types.ts'

/** 候选 JSON 上限（UTF-8 字节；design 01 §2「注册表上限256KiB」）。 */
export const CARD_PROCESSORS_MAX_BYTES = 256 * 1024
/** 定义数量上限（design 01 §2「32个模块」）。 */
export const CARD_PROCESSORS_MAX_WORKFLOWS = 32
/** 每定义别名上限（design 01 §2「每模块8个别名」）。 */
export const WORKFLOW_MENTIONS_MAX = 8
/** 定义展示名长度上限（Unicode 码点；仅展示，不进指纹）。 */
export const WORKFLOW_LABEL_MAX_CODE_POINTS = 64
/** 定义 ID 长度上限；稳定 ASCII 标识（小写字母开头，小写字母/数字/连字符）。 */
export const WORKFLOW_ID_MAX_LENGTH = 64
/** 实现 ID 长度上限；键即受信实现表条目，约定以 `@版本` 结尾（代码/提示词更新必须升版本）。 */
export const WORKFLOW_IMPLEMENTATION_ID_MAX_LENGTH = 128
/** options 嵌套深度上限（含根对象；超出拒绝，防深层结构与无界递归）。 */
export const WORKFLOW_OPTIONS_MAX_DEPTH = 8

/** 定义 ID 形态：小写字母开头，后接小写字母/数字/连字符（长度另行核）。 */
const WORKFLOW_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/
/** 根对象与定义条目的精确字段集（整体校验，不收未知字段）。 */
const ROOT_FIELDS = new Set(['schemaVersion', 'workflows'])
const WORKFLOW_FIELDS = new Set(['id', 'label', 'mentions', 'enabled', 'implementationId', 'options'])

/** 有效定义快照的只读访问面；运行期唯一变更入口 = replace（整表校验通过才切换）。 */
export interface WorkflowRegistry {
  /**
   * 业务逻辑: 汇总全部定义的关键词名→工作流ID，供解析器精确全名匹配。
   * 关键判断: 关闭的定义也保留（命中先登记、由开关裁决等待），未知词才提示未注册。
   * 异常处理: 无。参数: 无。返回: 独立拷贝的只读映射（外部改写不影响快照）。
   */
  aliases(): ReadonlyMap<string, string>
  /**
   * 业务逻辑: 按定义ID取有效定义。关键判断: 不做别名回退。异常处理: 无。
   * 参数: id 为定义ID。返回: 冻结定义或 undefined。
   */
  get(id: string): WorkflowDefinition | undefined
  /**
   * 业务逻辑: 按配置顺序列出全部定义。关键判断: 返回独立数组，不可借列表改写快照。
   * 异常处理: 无。参数: 无。返回: 冻结定义数组。
   */
  list(): WorkflowDefinition[]
  /**
   * 业务逻辑: 校验候选表（JSON 文本或已解析 JSON 值），通过则整体原子替换。
   * 关键判断: 未知实现/字段冲突/非法字段与参数/超限一律拒绝，失败保留旧快照（重载失败保旧）。
   * 异常处理: 抛「CODE: 中文原因」稳定错误；JSON 不加载任意 JS/路径。
   * 参数: candidate 为候选配置。返回: 无。
   */
  replace(candidate: unknown): void
}

/**
 * 创建关键词→工作流注册表。
 * 业务逻辑: 创建时快照受信实现表，整体校验初始定义并生成别名表与定义快照。
 * 关键判断: 实现只来自受信 map（键=实现ID，创建后外部 map 变更不影响）；不动态加载、不猜实现。
 * 异常处理: 初始定义非法直接抛出——启动期没有可保留的旧表，由装配层决定降级或阻断。
 * 参数: implementations 为受信实现表；definitions 为 JSON 文本或已解析 JSON 值。
 * 返回: 注册表只读访问面。
 */
export function createWorkflowRegistry(
  implementations: ReadonlyMap<string, WorkflowImplementation>,
  definitions: unknown,
): WorkflowRegistry {
  const trusted = snapshotImplementations(implementations)
  let snapshot = materialize(definitions, trusted)
  return Object.freeze({
    aliases: (): ReadonlyMap<string, string> => new Map(snapshot.aliases),
    get: (id: string): WorkflowDefinition | undefined => snapshot.byId.get(id),
    list: (): WorkflowDefinition[] => [...snapshot.definitions],
    replace: (candidate: unknown): void => { snapshot = materialize(candidate, trusted) },
  })
}

/** 校验错误统一为「CODE: 中文原因」，供装配层与测试稳定匹配。 */
function registryFailure(code: string, detail: string): Error {
  return new Error(`${code}: ${detail}`)
}

/** 受信实现表快照：键与实现ID必须一致且具备唯一 execute 入口（不信任外部后期变更）。 */
function snapshotImplementations(
  implementations: ReadonlyMap<string, WorkflowImplementation>,
): ReadonlyMap<string, WorkflowImplementation> {
  const source = implementations as unknown
  if (source === null || typeof source !== 'object' || typeof (source as { entries?: unknown }).entries !== 'function') {
    throw registryFailure('INVALID_IMPLEMENTATIONS', '受信实现表必须是 ReadonlyMap')
  }
  const trusted = new Map<string, WorkflowImplementation>()
  for (const [key, implementation] of implementations) {
    const keyValid = typeof key === 'string' && key.length > 0
      && key.length <= WORKFLOW_IMPLEMENTATION_ID_MAX_LENGTH && !/\s/.test(key)
    const implementationValid = implementation !== null && typeof implementation === 'object'
      && implementation.id === key && typeof implementation.execute === 'function'
    if (!keyValid || !implementationValid) {
      throw registryFailure('INVALID_IMPLEMENTATIONS', `实现表条目非法（键 ${JSON.stringify(key)} 必须等于实现ID且带 execute）`)
    }
    trusted.set(key, implementation)
  }
  return trusted
}

interface RegistrySnapshot {
  readonly definitions: readonly WorkflowDefinition[]
  readonly byId: ReadonlyMap<string, WorkflowDefinition>
  readonly aliases: ReadonlyMap<string, string>
}

/** 把候选表整体校验成新快照；任何一步失败都抛出且不产出半成品。 */
function materialize(candidate: unknown, trusted: ReadonlyMap<string, WorkflowImplementation>): RegistrySnapshot {
  const root = parseCandidate(candidate)
  assertExactFields(root, ROOT_FIELDS, '根对象')
  if (root.schemaVersion !== 1) {
    throw registryFailure('INVALID_SCHEMA_VERSION', `schemaVersion 必须是 1，实际 ${JSON.stringify(root.schemaVersion)}`)
  }
  const rawWorkflows = root.workflows
  if (!Array.isArray(rawWorkflows)) {
    throw registryFailure('INVALID_WORKFLOWS', 'workflows 必须是定义数组')
  }
  if (rawWorkflows.length > CARD_PROCESSORS_MAX_WORKFLOWS) {
    throw registryFailure('TOO_MANY_WORKFLOWS', `定义数 ${rawWorkflows.length} 超过上限 ${CARD_PROCESSORS_MAX_WORKFLOWS}`)
  }
  const definitions: WorkflowDefinition[] = []
  const byId = new Map<string, WorkflowDefinition>()
  const aliases = new Map<string, string>()
  for (const [index, raw] of rawWorkflows.entries()) {
    const where = `workflows[${index}]`
    if (!isPlainObject(raw)) throw registryFailure('INVALID_WORKFLOW', `${where} 必须是对象`)
    assertExactFields(raw, WORKFLOW_FIELDS, where)

    const id = raw.id
    if (typeof id !== 'string' || id.length > WORKFLOW_ID_MAX_LENGTH || !WORKFLOW_ID_PATTERN.test(id)) {
      throw registryFailure('INVALID_WORKFLOW_ID', `${where}.id 非法（小写字母开头、含小写字母/数字/连字符、≤${WORKFLOW_ID_MAX_LENGTH} 字符）`)
    }
    if (byId.has(id)) throw registryFailure('DUPLICATE_WORKFLOW_ID', `定义ID「${id}」重复`)

    const label = raw.label
    if (typeof label !== 'string' || label.trim().length === 0 || [...label].length > WORKFLOW_LABEL_MAX_CODE_POINTS) {
      throw registryFailure('INVALID_WORKFLOW_LABEL', `${where}.label 必须是非空展示名（≤${WORKFLOW_LABEL_MAX_CODE_POINTS} 码点）`)
    }

    const rawMentions = raw.mentions
    if (!Array.isArray(rawMentions) || rawMentions.length < 1 || rawMentions.length > WORKFLOW_MENTIONS_MAX) {
      throw registryFailure('INVALID_MENTIONS', `${where}.mentions 必须是 1–${WORKFLOW_MENTIONS_MAX} 个关键词名数组`)
    }
    const seen = new Set<string>()
    for (const mention of rawMentions) {
      if (typeof mention !== 'string' || !isParserMentionName(mention)) {
        throw registryFailure('INVALID_MENTION_NAME', `${where}.mentions 含解析器无法构成的名字（1–${MENTION_NAME_MAX_CODE_POINTS} 个名字字符）`)
      }
      if (seen.has(mention)) throw registryFailure('DUPLICATE_MENTION', `定义「${id}」内关键词「${mention}」重复`)
      seen.add(mention)
      if (aliases.has(mention)) throw registryFailure('DUPLICATE_ALIAS', `关键词「${mention}」已被定义「${aliases.get(mention)}」占用`)
    }

    const enabled = raw.enabled
    if (typeof enabled !== 'boolean') throw registryFailure('INVALID_ENABLED', `${where}.enabled 必须是布尔值`)

    const implementationId = raw.implementationId
    if (typeof implementationId !== 'string' || !trusted.has(implementationId)) {
      throw registryFailure('UNKNOWN_IMPLEMENTATION', `${where}.implementationId ${JSON.stringify(implementationId)} 不在受信实现表（不动态加载实现）`)
    }

    const options = cloneOptions(raw.options, `${where}.options`)
    const mentions = Object.freeze([...rawMentions]) as readonly string[]
    const definition: WorkflowDefinition = Object.freeze({
      id, label, mentions, enabled, implementationId, options,
      definitionRevision: computeDefinitionRevision(implementationId, mentions, options),
    })
    definitions.push(definition)
    byId.set(id, definition)
    for (const mention of mentions) aliases.set(mention, id)
  }
  return { definitions: Object.freeze(definitions), byId, aliases }
}

/** 候选入口：JSON 文本按原文计字节并解析；已解析值按规范化序列化计字节。 */
function parseCandidate(candidate: unknown): Record<string, unknown> {
  let value: unknown = candidate
  if (typeof candidate === 'string') {
    if (Buffer.byteLength(candidate, 'utf8') > CARD_PROCESSORS_MAX_BYTES) {
      throw registryFailure('CONFIG_TOO_LARGE', `候选文本超过 ${CARD_PROCESSORS_MAX_BYTES} 字节上限`)
    }
    const text = candidate.charCodeAt(0) === 0xfeff ? candidate.slice(1) : candidate
    try {
      value = JSON.parse(text)
    } catch {
      throw registryFailure('CONFIG_JSON_PARSE_FAILED', '候选文本不是合法 JSON')
    }
  } else {
    let serialized: string | undefined
    try {
      serialized = JSON.stringify(candidate)
    } catch {
      throw registryFailure('CONFIG_NOT_JSON_OBJECT', '候选不是可序列化的纯 JSON 值')
    }
    if (serialized === undefined) throw registryFailure('CONFIG_NOT_JSON_OBJECT', '候选不是纯 JSON 值（undefined/函数）')
    if (Buffer.byteLength(serialized, 'utf8') > CARD_PROCESSORS_MAX_BYTES) {
      throw registryFailure('CONFIG_TOO_LARGE', `候选序列化超过 ${CARD_PROCESSORS_MAX_BYTES} 字节上限`)
    }
  }
  if (!isPlainObject(value)) throw registryFailure('CONFIG_NOT_JSON_OBJECT', '根值必须是 {schemaVersion, workflows} 对象')
  return value
}

/** 精确字段集校验：未知字段与缺字段都拒绝（旧 processors/stage 表不冒充新契约）。 */
function assertExactFields(record: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw registryFailure('UNKNOWN_FIELD', `${where} 含未知字段「${key}」`)
  }
  for (const key of allowed) {
    if (!(key in record)) throw registryFailure('MISSING_FIELD', `${where} 缺必需字段「${key}」`)
  }
}

/** 解析器名字兼容：码点逐个核名字字符类与 1–32 码点上限，保证别名表键都能被真实构成。 */
function isParserMentionName(name: string): boolean {
  if (name.length === 0) return false
  let codePoints = 0
  for (const character of name) {
    if (!MENTION_NAME_CHAR.test(character)) return false
    codePoints++
    if (codePoints > MENTION_NAME_MAX_CODE_POINTS) return false
  }
  return true
}

/** options 入口：必须是 JSON 对象（数组/标量/null 拒绝），递归白名单克隆并冻结。 */
function cloneOptions(raw: unknown, where: string): JsonObject {
  if (!isPlainObject(raw)) throw registryFailure('INVALID_OPTIONS', `${where} 必须是 JSON 对象（无参数用 {}）`)
  return cloneJsonValue(raw, 1, where) as JsonObject
}

/** JSON 值白名单克隆：只收 null/布尔/有限数/字符串/数组/纯对象，拒绝危险键与超深嵌套。 */
function cloneJsonValue(value: unknown, depth: number, where: string): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw registryFailure('INVALID_OPTIONS', `${where} 含非有限数值`)
    return value
  }
  if (typeof value !== 'object') throw registryFailure('INVALID_OPTIONS', `${where} 含非 JSON 值（${typeof value}）`)
  if (depth > WORKFLOW_OPTIONS_MAX_DEPTH) {
    throw registryFailure('INVALID_OPTIONS', `${where} 嵌套超过 ${WORKFLOW_OPTIONS_MAX_DEPTH} 层`)
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item, index) => cloneJsonValue(item, depth + 1, `${where}[${index}]`)))
  }
  if (!isPlainObject(value)) throw registryFailure('INVALID_OPTIONS', `${where} 含非纯 JSON 对象`)
  const clone: Record<string, JsonValue> = {}
  for (const key of Object.keys(value)) {
    if (key === '__proto__') throw registryFailure('INVALID_OPTIONS', `${where} 含危险键 __proto__`)
    clone[key] = cloneJsonValue(value[key], depth + 1, `${where}.${key}`)
  }
  return Object.freeze(clone)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 有效定义指纹：sha256 覆盖实现ID、别名集合（排序）与规范化 options，不含 label/enabled。
 * 业务逻辑: 运行身份只随「实现版本 + 有效参数 + 关键词集合」变化；仅改中文说明/开关不重跑。
 * 关键判断: 对象键序与别名顺序无语义，先规范化再哈希；实现代码或提示词更新必须升实现版本（`id@版本`）。
 * 异常处理: 输入已通过校验（无 __proto__、有限数），JSON.stringify 不会失败。
 * 参数: implementationId/mentions/options 为已校验定义字段。返回: 64 位小写十六进制 sha256。
 */
function computeDefinitionRevision(implementationId: string, mentions: readonly string[], options: JsonObject): string {
  const canonical = JSON.stringify({
    implementationId,
    mentions: [...mentions].sort(),
    options: canonicalizeJson(options),
  })
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/** 规范化 JSON：对象键排序递归重建，数组保序；用于不敏感于书写顺序的指纹。 */
function canonicalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return (value as readonly JsonValue[]).map(item => canonicalizeJson(item))
  const record = value as { readonly [key: string]: JsonValue }
  const sorted: Record<string, JsonValue> = {}
  for (const key of Object.keys(record).sort()) sorted[key] = canonicalizeJson(record[key])
  return sorted
}
