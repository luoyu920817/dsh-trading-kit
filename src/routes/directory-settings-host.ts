import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { Context } from '../context-types.ts'
import type { ResolvedTraderKitConfig } from '../config.ts'
import { validateAreaDirectory } from '../paths/resolve.ts'

export interface DirectoryDraft { readonly stock: string; readonly patterns: string }
export interface ExecutionDraft { readonly enabled: boolean; readonly provider: string; readonly model: string; readonly cwd: string }
export interface DirectoryEditing { readonly available: boolean; readonly revision: string | null; readonly unavailableReason?: string }
export interface DirectorySettingsHost {
  /** 业务逻辑: 读取宿主编辑能力与当前版本；关键判断: 不唤起选择器；异常处理: 缺能力给原因。参数: 无。返回: 编辑状态。 */
  editing(): DirectoryEditing
  /** 业务逻辑: 用户显式选择真实目录；关键判断: 取消返回null；异常处理: 信号取消原生窗口。参数: 生命周期信号。返回: 相对目录。 */
  choose(signal: AbortSignal): Promise<string | null>
  /** 业务逻辑: 保存两个目录到宿主配置；关键判断: CAS与真实目录校验；异常处理: 宿主持久化失败透传。参数: 版本/草稿。返回: 完成。 */
  save(revision: string, directories: DirectoryDraft): Promise<void>
  /** 业务逻辑: 读取执行配置持久编辑能力；关键判断: 无需选择器；异常处理: 缺能力给原因。参数: 无。返回: 编辑状态。 */
  executionEditing?(): DirectoryEditing
  /** 业务逻辑: 保存用户显式确认的执行配置；关键判断: 校验启用条件与CAS；异常处理: 宿主回滚。参数: 版本与草稿。返回: 完成。 */
  saveExecution?(revision: string, processing: ExecutionDraft): Promise<void>
}
interface HostEntry { readonly options: { readonly name?: string; readonly config?: Record<string, unknown> }; readonly fiber?: unknown }
interface HostEditor {
  /** 业务逻辑: 枚举宿主可编辑条目；关键判断: 实际Loader对象身份；异常处理: 交宿主。参数: 无。返回: 条目。 */
  entries(): HostEntry[]
  /** 业务逻辑: 原子保存并按Loader重载；关键判断: 最新配置在锁内交change；异常处理: 宿主回滚。参数: 条目与转换。返回: 完成。 */
  edit(entry: HostEntry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}
interface HostPicker {
  /** 业务逻辑: 取得宿主选择器能力；关键判断: 仅native提供pick；异常处理: 交宿主。参数: 无。返回: 能力。 */
  capability(): { readonly kind: string; pick?: (signal: AbortSignal) => Promise<string | null> }
}

/** 业务逻辑: 对完整当前配置生成不透明CAS版本；关键判断: 不返回配置或凭据；异常处理: 非JSON交宿主。参数: 配置。返回: SHA256。 */
export function configRevision(current: Record<string, unknown>): string { return createHash('sha256').update(JSON.stringify(current)).digest('hex') }

/**
 * 只替换已确认的业务目录。
 * 业务逻辑: 先比较当前配置版本，再保留所有其它字段与未来目录字段。
 * 关键判断: 不以公开白名单重建完整配置，不改密钥或Agent开关。
 * 异常处理: 配置变化抛CONFIG_CONFLICT，调用方刷新后重新选择。
 * 参数: 最新raw配置、预期版本与已校验目录。返回: 新raw配置。
 */
export function directoryConfigChange(current: Record<string, unknown>, revision: string, directories: DirectoryDraft): Record<string, unknown> {
  if (configRevision(current) !== revision) throw new Error('CONFIG_CONFLICT')
  const existing = current.directories
  if (existing !== undefined && (!existing || typeof existing !== 'object' || Array.isArray(existing))) throw new Error('INVALID_DIRECTORY_CONFIG')
  return { ...current, directories: { ...(existing as Record<string, unknown> | undefined), ...directories } }
}

/** 业务逻辑: CAS只替换四个执行字段并保留预算和秘密；关键判断: 不能重建review；异常处理: 冲突或非对象拒绝。参数: raw、版本、草稿。返回: 新raw。 */
export function executionConfigChange(current: Record<string, unknown>, revision: string, processing: ExecutionDraft): Record<string, unknown> {
  if (configRevision(current) !== revision) throw new Error('CONFIG_CONFLICT')
  const review = current.review
  if (review !== undefined && (!review || typeof review !== 'object' || Array.isArray(review))) throw new Error('INVALID_EXECUTION_CONFIG')
  const previous = (review as Record<string, unknown> | undefined)?.processing
  if (previous !== undefined && (!previous || typeof previous !== 'object' || Array.isArray(previous))) throw new Error('INVALID_EXECUTION_CONFIG')
  return { ...current, review: { ...(review as Record<string, unknown> | undefined), processing: { ...(previous as Record<string, unknown> | undefined), ...processing } } }
}

/** 业务逻辑: 规范用户执行配置并核验启用条件；关键判断: 关闭允许空字段，启用要求模型、数据根及真实绝对工作目录；异常处理: 不存在目录统一拒绝，不创建文件。参数: 数据根与草稿。返回: 规范草稿。 */
async function validateExecutionDraft(dataRoot: string, processing: ExecutionDraft): Promise<ExecutionDraft> {
  if (typeof processing.enabled !== 'boolean' || ['provider', 'model', 'cwd'].some(key => typeof processing[key as keyof ExecutionDraft] !== 'string')) throw new Error('INVALID_EXECUTION_CONFIG')
  const draft = { enabled: processing.enabled, provider: processing.provider.trim(), model: processing.model.trim(), cwd: processing.cwd.trim() }
  if (!draft.enabled) return draft
  if (!dataRoot || !draft.provider || !draft.model || !draft.cwd || !isAbsolute(draft.cwd)) throw new Error('INVALID_EXECUTION_CONFIG')
  try { if (!(await stat(draft.cwd)).isDirectory()) throw new Error() } catch { throw new Error('INVALID_EXECUTION_CONFIG') }
  return draft
}

/**
 * 将操作员选择的实际文件夹转为数据根内相对目录。
 * 业务逻辑: realpath消解root与选择路径，再核验目录及真实包含关系。
 * 关键判断: 拒绝根自身、外根、跨盘、文件、符号链接外逃，不创建任何目录。
 * 异常处理: 不可读路径透传，由HTTP层统一提示。
 * 参数: 数据根与选择器返回的绝对目录。返回: 使用正斜杠的相对路径。
 */
export async function selectedRelativeDirectory(dataRoot: string, selected: string): Promise<string> {
  if (!dataRoot || !isAbsolute(selected)) throw new Error('INVALID_DIRECTORY')
  const [root, target] = await Promise.all([realpath(dataRoot), realpath(selected)])
  const rel = relative(root, target)
  if (!rel || isAbsolute(rel) || rel === '..' || rel.startsWith('..' + sep) || !(await stat(target)).isDirectory()) throw new Error('INVALID_DIRECTORY')
  return rel.split(sep).join('/')
}

/** 业务逻辑: 核验保存草稿仍为根内真实目录；关键判断: 不接受绝对/占位/点段；异常处理: 任何一项错误拒绝整次保存。参数: 根与两项草稿。返回: 规范相对目录。 */
export async function validateDirectoryDraft(dataRoot: string, directories: DirectoryDraft): Promise<DirectoryDraft> {
  /** 业务逻辑: 校验单目录后按真实路径规范化；关键判断: 不能借resolve消除非法..；异常处理: 拒绝。参数: 原目录。返回: 规范值。 */
  async function validate(value: string): Promise<string> {
    return selectedRelativeDirectory(dataRoot, resolve(dataRoot, validateAreaDirectory(value)))
  }
  const [stock, patterns] = await Promise.all([validate(directories.stock), validate(directories.patterns)])
  return { stock, patterns }
}

/**
 * 使用真实宿主服务连接选择器和持久配置编辑器。
 * 业务逻辑: 捕获本插件Loader条目身份，显式请求才选择或保存；保存由宿主锁/回滚/重载处理。
 * 关键判断: 不猜条目、不使用volatile settings、不造浏览器文件路径；缺服务封闭。
 * 异常处理: 条目替换、能力变化或CAS失败均拒绝；不吞持久化失败。
 * 参数: 当前插件上下文及已解析配置。返回: 可选编辑能力适配器。
 */
export function createDirectorySettingsHost(ctx: Context, config: ResolvedTraderKitConfig): DirectorySettingsHost {
  const get = (name: string): unknown => (ctx as unknown as { get?: (name: string) => unknown }).get?.(name)
  const editor = get('configEditor') as HostEditor | undefined
  const picker = get('directoryPicker') as HostPicker | undefined
  const owner = (ctx as unknown as { fiber?: { entry?: HostEntry } }).fiber?.entry
  /** 业务逻辑: 核验仍是本插件条目；关键判断: 优先owner身份，只有唯一同名可回退；异常处理: 失效返回undefined。参数: 无。返回: 实际条目。 */
  function entry(): HostEntry | undefined {
    const entries = editor?.entries() ?? []
    if (owner) return entries.includes(owner) ? owner : undefined
    const matches = entries.filter(row => row.options.name === 'dsh-trader-kit')
    return matches.length === 1 ? matches[0] : undefined
  }
  /** 业务逻辑: 汇总可用性和当前版本；关键判断: 不调用pick；异常处理: 服务异常降级显示。参数: 无。返回: 编辑状态。 */
  function editing(): DirectoryEditing {
    try {
      const row = entry()
      const reason = !config.dataRoot ? '请先在宿主配置中设置数据根目录' : !editor || !row ? '当前宿主未提供本插件的持久配置编辑能力' : picker?.capability().kind !== 'native' ? '当前宿主未提供原生文件夹选择器' : undefined
      return reason ? { available: false, revision: null, unavailableReason: reason } : { available: true, revision: configRevision(row!.options.config ?? {}) }
    } catch { return { available: false, revision: null, unavailableReason: '宿主目录配置能力暂不可用' } }
  }
  /** 业务逻辑: 汇总执行编辑能力；关键判断: 不依赖native picker或数据根，便于关闭执行；异常处理: 宿主故障明确不可用。参数: 无。返回: 状态。 */
  function executionEditing(): DirectoryEditing {
    try {
      const row = entry()
      return !editor || !row ? { available: false, revision: null, unavailableReason: '当前宿主未提供本插件的持久配置编辑能力' } : { available: true, revision: configRevision(row.options.config ?? {}) }
    } catch { return { available: false, revision: null, unavailableReason: '宿主执行配置能力暂不可用' } }
  }
  return {
    editing,
    executionEditing,
    /** 业务逻辑: 校验执行草稿并交真实宿主持久化重载；关键判断: 只改四字段、锁内CAS，不激活Agent；异常处理: 缺能力或无效配置拒绝。参数: 版本与草稿。返回: 完成。 */
    async saveExecution(revision, processing) {
      if (!executionEditing().available) throw new Error('EXECUTION_EDIT_UNAVAILABLE')
      const row = entry()
      if (!row) throw new Error('CONFIG_CONFLICT')
      const validated = await validateExecutionDraft(config.dataRoot, processing)
      await editor!.edit(row, current => executionConfigChange(current, revision, validated))
    },
    /** 业务逻辑: 唤起宿主原生窗口并转相对目录；关键判断: 点击后才调用且取消保持草稿；异常处理: 能力缺失拒绝。参数: signal。返回: 相对目录/null。 */
    async choose(signal) {
      if (!editing().available) throw new Error('DIRECTORY_EDIT_UNAVAILABLE')
      const capability = picker!.capability()
      if (capability.kind !== 'native' || !capability.pick) throw new Error('DIRECTORY_EDIT_UNAVAILABLE')
      const selected = await capability.pick(signal)
      signal.throwIfAborted()
      return selected === null ? null : selectedRelativeDirectory(config.dataRoot, selected)
    },
    /** 业务逻辑: 校验真实草稿再交宿主持久化；关键判断: 锁内CAS保持其它配置；异常处理: 更新失败由宿主回滚。参数: revision/directories。返回: 完成。 */
    async save(revision, directories) {
      if (!editing().available) throw new Error('DIRECTORY_EDIT_UNAVAILABLE')
      const row = entry()
      if (!row) throw new Error('CONFIG_CONFLICT')
      const validated = await validateDirectoryDraft(config.dataRoot, directories)
      await editor!.edit(row, current => directoryConfigChange(current, revision, validated))
    },
  }
}
