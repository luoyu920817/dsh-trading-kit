import { join, resolve } from 'node:path'
import type { ResolvedProcessingConfig, ResolvedTraderKitConfig } from '../config.ts'
import type { Context, TraderKitHttpRequest, TraderKitHttpResponse } from '../context-types.ts'
import { AREA_TABLE, type AreaKey } from '../paths/mapping.ts'
import { createDirectorySettingsHost, type DirectoryEditing, type DirectorySettingsHost, type ExecutionDraft } from './directory-settings-host.ts'

export const BASIC_SETTINGS_PATH = '/dsh-trader-kit/review/api/basic-settings'
export const DIRECTORY_CHOOSE_PATH = BASIC_SETTINGS_PATH + '/choose-directory'
export const DIRECTORY_SAVE_PATH = BASIC_SETTINGS_PATH + '/save'
export const EXECUTION_SAVE_PATH = BASIC_SETTINGS_PATH + '/save-execution'
const EDIT_UNAVAILABLE: DirectoryEditing = { available: false, revision: null, unavailableReason: '当前宿主未提供目录配置编辑能力' }
const EXECUTION_UNAVAILABLE: DirectoryEditing = { available: false, revision: null, unavailableReason: '当前宿主未提供执行配置编辑能力' }

export interface BasicSettingsSnapshot {
  readonly dataRoot: string
  readonly directories: readonly {
    readonly id: AreaKey
    readonly label: string
    readonly relativePath: string
    readonly absolutePath: string | null
    readonly status: 'active' | 'reserved'
  }[]
  readonly processing: ResolvedProcessingConfig
  readonly tqLocalEnabled: boolean
  readonly editing: DirectoryEditing
  readonly executionEditing: DirectoryEditing
}

export interface BasicSettingsDeps {
  readonly config: ResolvedTraderKitConfig
  readonly directoryHost?: DirectorySettingsHost
  readonly pickers?: Set<AbortController>
  /** 业务逻辑: 沿宿主登录与访问栅栏判定；关键判断: 写键不救援；异常处理: handler 封闭。参数: 请求。返回: 拒绝码。 */
  requestRejection(req: TraderKitHttpRequest): 401 | 403 | undefined
}

const DIRECTORY_LABELS: readonly [AreaKey, string][] = [
  ['stock', '标的目录'], ['patterns', '模式目录'], ['review', '复盘目录'],
  ['processorRuns', '工作流记录目录'], ['agentSkills', '业务 Skill 目录'],
]

/**
 * 从已解析配置构造基础设置的白名单快照。
 * 业务逻辑: 目录默认来自AREA_TABLE，标的/模式消费实例配置；公开编辑能力及当前版本。
 * 关键判断: 未设置根目录时绝对路径为 null；日期模板保留；模式区显示 reserved。
 * 异常处理: 不读取或创建目录，不返回写键、行情签名或安装源凭据。
 * 参数: config为当前配置，editing为目录编辑能力，executionEditing为执行编辑能力。返回: 可展示的只读DTO。
 */
export function basicSettingsSnapshot(config: ResolvedTraderKitConfig, editing: DirectoryEditing = EDIT_UNAVAILABLE, executionEditing: DirectoryEditing = EXECUTION_UNAVAILABLE): BasicSettingsSnapshot {
  const dataRoot = config.dataRoot ? resolve(config.dataRoot) : ''
  const processing = config.review.processing
  return {
    dataRoot,
    directories: DIRECTORY_LABELS.map(([id, label]) => ({
      id, label, relativePath: id === 'stock' || id === 'patterns' ? config.directories[id] : AREA_TABLE[id].dir,
      absolutePath: dataRoot ? join(dataRoot, id === 'stock' || id === 'patterns' ? config.directories[id] : AREA_TABLE[id].dir) : null,
      status: AREA_TABLE[id].status,
    })),
    processing: {
      enabled: processing.enabled, provider: processing.provider, model: processing.model, cwd: processing.cwd,
      maxConcurrency: processing.maxConcurrency, agentAttemptLimit: processing.agentAttemptLimit,
      maxTokens: processing.maxTokens, timeoutMs: processing.timeoutMs,
    },
    tqLocalEnabled: config.sources.tqLocal.enabled,
    editing,
    executionEditing,
  }
}

/** 业务逻辑: 限8KiB读取显式JSON提交；关键判断: 字段稍后白名单，拒绝数组及非UTF8；异常处理: 格式400/超限413。参数: req。返回: JSON对象。 */
async function input(req: TraderKitHttpRequest): Promise<Record<string, unknown>> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(String(req.headers['content-type'] ?? ''))) throw new Error('INVALID_REQUEST')
  const chunks: Buffer[] = []; let bytes = 0
  for await (const chunk of req) { const data = Buffer.from(chunk); bytes += data.length; if (bytes > 8192) throw new Error('BODY_TOO_LARGE'); chunks.push(data) }
  try { const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result as Record<string, unknown> } catch { throw new Error('INVALID_REQUEST') }
}

/** 业务逻辑: 严格限制用户可提交字段；关键判断: 不允许带任意路径/配置键；异常处理: 非法400。参数: 对象与键。返回: 无。 */
function only(value: Record<string, unknown>, keys: readonly string[]): void { if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('INVALID_REQUEST') }

/** 业务逻辑: 返回 JSON 且禁止缓存私有路径；关键判断: 方法错误注明 GET；异常处理: 序列化失败交外层。参数: 响应、状态与 DTO。返回: 无。 */
function respond(res: TraderKitHttpResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(status === 405 ? { allow: 'GET' } : {}) })
  res.end(JSON.stringify(value))
}

/**
 * 创建基础设置及目录编辑请求处理器。
 * 业务逻辑: 先宿主cookie与访问栅栏，GET返回快照，用户显式POST才选择/保存目录。
 * 关键判断: 无写键救援、字段白名单；选择器沿请求与插件生命周期，保存由宿主CAS重载。
 * 异常处理: 认证401/403、路径404、方法405、参数400、版本409、缺能力503；其他异常脱敏500。
 * 参数: deps 为配置与宿主认证。返回: 无副作用 handler。
 */
export function createBasicSettingsHandler(deps: BasicSettingsDeps): (req: TraderKitHttpRequest, res: TraderKitHttpResponse) => Promise<void> {
  /** 业务逻辑: 核验并返回白名单配置；关键判断: 认证先于路径和方法；异常处理: 内部错误封闭。参数: 请求/响应。返回: 无。 */
  return async function handler(req, res): Promise<void> {
    let executionRequest = false
    try {
      const rejection = deps.requestRejection(req)
      if (rejection === 403) { respond(res, 403, { error: 'FORBIDDEN', message: '请求未通过宿主访问栅栏' }); return }
      if (rejection === 401) { respond(res, 401, { error: 'UNAUTHENTICATED', message: '需要宿主登录凭据' }); return }
      const url = new URL(req.url ?? '', 'http://127.0.0.1')
      if (![BASIC_SETTINGS_PATH, DIRECTORY_CHOOSE_PATH, DIRECTORY_SAVE_PATH, EXECUTION_SAVE_PATH].includes(url.pathname)) { respond(res, 404, { error: 'NOT_FOUND', message: '接口不存在' }); return }
      const method = url.pathname === BASIC_SETTINGS_PATH ? 'GET' : 'POST'
      if (req.method !== method) { res.writeHead(405, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', allow: method }); res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' })); return }
      if (url.search) { respond(res, 400, { error: 'INVALID_REQUEST', message: '请求参数不合法' }); return }
      if (method === 'GET') { respond(res, 200, basicSettingsSnapshot(deps.config, deps.directoryHost?.editing() ?? EDIT_UNAVAILABLE, deps.directoryHost?.executionEditing?.() ?? EXECUTION_UNAVAILABLE)); return }
      executionRequest = url.pathname === EXECUTION_SAVE_PATH
      const body = await input(req)
      if (url.pathname === EXECUTION_SAVE_PATH) {
        if (Object.keys(body).some(key => !['revision', 'processing'].includes(key)) || typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision) || !body.processing || typeof body.processing !== 'object' || Array.isArray(body.processing)) throw new Error('INVALID_EXECUTION_CONFIG')
        const processing = body.processing as Record<string, unknown>
        if (Object.keys(processing).some(key => !['enabled', 'provider', 'model', 'cwd'].includes(key)) || typeof processing.enabled !== 'boolean' || ['provider', 'model', 'cwd'].some(key => typeof processing[key] !== 'string')) throw new Error('INVALID_EXECUTION_CONFIG')
        const executionEditing = deps.directoryHost?.executionEditing?.() ?? EXECUTION_UNAVAILABLE
        if (!executionEditing.available || !deps.directoryHost?.saveExecution) { respond(res, 503, { error: 'EXECUTION_EDIT_UNAVAILABLE', message: executionEditing.unavailableReason ?? '宿主执行配置能力暂不可用' }); return }
        await deps.directoryHost.saveExecution(body.revision, processing as unknown as ExecutionDraft)
        respond(res, 200, { saved: true }); return
      }
      if (url.pathname === DIRECTORY_CHOOSE_PATH) {
        only(body, ['directory']); if (body.directory !== 'stock' && body.directory !== 'patterns') throw new Error('INVALID_REQUEST')
      } else {
        only(body, ['revision', 'directories'])
        if (typeof body.revision !== 'string' || !/^[a-f0-9]{64}$/.test(body.revision) || !body.directories || typeof body.directories !== 'object' || Array.isArray(body.directories)) throw new Error('INVALID_REQUEST')
        const directories = body.directories as Record<string, unknown>; only(directories, ['stock', 'patterns']); if (typeof directories.stock !== 'string' || typeof directories.patterns !== 'string') throw new Error('INVALID_REQUEST')
      }
      const editing = deps.directoryHost?.editing() ?? EDIT_UNAVAILABLE
      if (!editing.available) { respond(res, 503, { error: 'DIRECTORY_EDIT_UNAVAILABLE', message: editing.unavailableReason }); return }
      if (url.pathname === DIRECTORY_SAVE_PATH) {
        await deps.directoryHost!.save(body.revision as string, body.directories as { stock: string; patterns: string })
        respond(res, 200, { saved: true }); return
      }
      const controller = new AbortController()
      const requestEvents = req as TraderKitHttpRequest & { once?: (name: string, listener: () => void) => unknown; off?: (name: string, listener: () => void) => unknown }
      const responseEvents = res as TraderKitHttpResponse & { once?: (name: string, listener: () => void) => unknown; off?: (name: string, listener: () => void) => unknown }
      /** 业务逻辑: 客户端断开时关闭原生窗口；关键判断: 正常读完请求不取消；异常处理: Abort幂等。参数: 无。返回: 无。 */
      const abort = (): void => controller.abort()
      deps.pickers?.add(controller); requestEvents.once?.('aborted', abort); responseEvents.once?.('close', abort)
      try {
        const relativePath = await deps.directoryHost!.choose(controller.signal)
        controller.signal.throwIfAborted()
        respond(res, 200, { directory: body.directory, relativePath })
      } finally { deps.pickers?.delete(controller); requestEvents.off?.('aborted', abort); responseEvents.off?.('close', abort) }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        const state = res as TraderKitHttpResponse & { destroyed?: boolean; writableEnded?: boolean }
        if (!state.destroyed && !state.writableEnded) respond(res, 409, { error: 'CONFIG_CONFLICT', message: '目录选择已取消或插件已重载，请刷新后再试' })
        return
      }
      const rawCode = error instanceof Error ? error.message : ''
      const code = executionRequest && rawCode === 'INVALID_REQUEST' ? 'INVALID_EXECUTION_CONFIG' : rawCode
      if (code === 'INVALID_EXECUTION_CONFIG' || code === 'EXECUTION_EDIT_UNAVAILABLE') {
        respond(res, code === 'INVALID_EXECUTION_CONFIG' ? 400 : 503, { error: code, message: code === 'INVALID_EXECUTION_CONFIG' ? '启用自动执行需要数据根目录、提供商、模型和现有绝对工作目录；关闭时可留空' : '宿主执行配置能力暂不可用' }); return
      }
      const [status, kind, message] = code === 'CONFIG_CONFLICT' ? [409, code, '配置已变化，请刷新后重新选择'] : code === 'BODY_TOO_LARGE' ? [413, code, '请求正文超过限制'] : code === 'DIRECTORY_EDIT_UNAVAILABLE' ? [503, code, '宿主目录配置能力暂不可用'] : /^INVALID_|目录|路径|业务目录/.test(code) ? [400, 'INVALID_REQUEST', '目录必须是数据根内的现有文件夹，并保存为相对路径'] : (error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'ENOTDIR' ? [400, 'INVALID_REQUEST', '所选目录不存在或不是文件夹'] : [500, 'INTERNAL_ERROR', '基础设置暂不可用']
      respond(res, status as number, { error: kind, message })
    }
  }
}

/**
 * 注册基础设置和两个显式目录编辑路由。
 * 业务逻辑: 复用宿主配置编辑器/选择器/认证，卸载取消在途原生窗口。
 * 关键判断: 精确路径，不依赖关键词runtime；缺根仍可看设置，编辑明确不可用。
 * 异常处理: 注册失败由宿主报告，不隐藏配置问题。
 * 参数: ctx 为宿主、config 为解析后配置。返回: 无。
 */
export function registerBasicSettingsRoutes(ctx: Context, config: ResolvedTraderKitConfig): void {
  const pickers = new Set<AbortController>()
  const handler = createBasicSettingsHandler({ config, directoryHost: createDirectorySettingsHost(ctx, config), pickers, requestRejection: req => ctx.connection.requestRejection(req) })
  for (const path of [BASIC_SETTINGS_PATH, DIRECTORY_CHOOSE_PATH, DIRECTORY_SAVE_PATH, EXECUTION_SAVE_PATH]) ctx.effect(() => ctx.webServer.register({ kind: 'exact', path, handler }))
  ctx.effect(() => () => { for (const controller of pickers) controller.abort(); pickers.clear() })
}
