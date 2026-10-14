/** 关键词管理独立敏感 API；GET 必须宿主cookie，不沿旧复盘页免签读取。 */
import { timingSafeEqual } from 'node:crypto'
import type { Context, TraderKitHttpRequest, TraderKitHttpResponse } from '../context-types.ts'
import type { ExecutionState, JsonObject, ProcessingService, SettingsRequest, TaskQuery } from '../review/processors/types.ts'
import type { MarketPrefix } from '../review/ident.ts'

export const REVIEW_PROCESSORS_PATH = '/dsh-trader-kit/review/api/processors'
export interface ReviewProcessorsDeps {
  readonly service: ProcessingService
  readonly writeKey: string
  /** 业务逻辑: 验证宿主cookie和栅栏；关键判断: 403不得救援；异常处理: 宿主错误封闭。参数: 请求。返回: 拒绝码。 */
  requestRejection(req: TraderKitHttpRequest): 401 | 403 | undefined
}

/** 业务逻辑: 构造稳定HTTP前置错误；关键判断: 不含私有输入；异常处理: 上层统一响应。参数: 错误码。返回: Error。 */
function invalid(code = 'INVALID_REQUEST'): never { throw new Error(code) }

/** 业务逻辑: 只认非数组JSON对象；关键判断: 防止null/数组进入写面；异常处理: 非法拒绝。参数: 未知值。返回: 字段表。 */
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}

/** 业务逻辑: 保持字段白名单；关键判断: 身份或权限额外字段不能穿透；异常处理: 拒绝。参数: 对象/允许键。返回: 无。 */
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid()
}

/** 业务逻辑: 校验有界字符串；关键判断: 不裁剪用户值；异常处理: 非字符串/长度越界拒绝。参数: 值/最大长度。返回: 原文。 */
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) invalid()
  return value
}

/** 业务逻辑: 身份与游标只允许安全字符；关键判断: 无路径/空白；异常处理: 拒绝。参数: 值/上限。返回: 安全身份。 */
function identity(value: unknown, max = 128): string {
  const result = text(value, max)
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) invalid()
  return result
}

/** 业务逻辑: 校验整型数值；关键判断: 查询不得科学计数/负数/小数；异常处理: 拒绝。参数: 值/范围。返回: 整数。 */
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'string' && typeof value !== 'number') invalid()
  if (typeof value === 'string' && !/^(0|[1-9][0-9]*)$/.test(value)) invalid()
  const result = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(result) || result < min || result > max) invalid()
  return result
}

/** 业务逻辑: 核验实际公历日期；关键判断: 排除自动归一化的二月三十；异常处理: 拒绝。参数: ISO日期。返回: 原日期。 */
function date(value: unknown): string {
  const result = text(value, 10)
  const parsed = Date.parse(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== result) invalid()
  return result
}

/** 业务逻辑: 股票代码保留六位；关键判断: 不接受路径或前缀混用；异常处理: 拒绝。参数: 值。返回: 代码。 */
function code(value: unknown): string {
  const result = text(value, 6)
  if (!/^\d{6}$/.test(result)) invalid()
  return result
}

/** 业务逻辑: 显式市场枚举或旧文档null；关键判断: 不按代码推测旧身份；异常处理: 非法拒绝。参数: 值。返回: 市场。 */
function market(value: unknown): MarketPrefix | null {
  if (value === undefined || value === null || value === '') return null
  if (value !== 'sh' && value !== 'sz' && value !== 'bj') invalid()
  return value
}

/** 业务逻辑: 限64KiB读取JSON正文；关键判断: 严格UTF8且拒绝额外字段；异常处理: 超限413/格式400。参数: 请求。返回: 对象。 */
async function body(req: TraderKitHttpRequest): Promise<Record<string, unknown>> {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) invalid()
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const data = Buffer.from(chunk)
    bytes += data.length
    if (bytes > 65_536) invalid('BODY_TOO_LARGE')
    chunks.push(data)
  }
  try {
    const parsed = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))))
    const pending: unknown[] = [parsed]
    while (pending.length) {
      const next = pending.pop()
      if (typeof next === 'number' && !Number.isFinite(next)) invalid()
      if (next !== null && typeof next === 'object') pending.push(...Object.values(next))
    }
    return parsed
  } catch (error) {
    if (error instanceof Error && error.message === 'BODY_TOO_LARGE') throw error
    invalid()
  }
}

/** 业务逻辑: 精确解析单值查询；关键判断: 重复/未知键均拒绝；异常处理: 拒绝。参数: URL/允许键。返回: 查询表。 */
function query(url: URL, allowed: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    if (!allowed.includes(key) || Object.hasOwn(result, key)) invalid()
    result[key] = value
  }
  return result
}

/** 业务逻辑: 输出JSON并禁缓存；关键判断: DTO直接返回；异常处理: 序列化失败交上层。参数: 响应/状态/值。返回: 无。 */
function respond(res: TraderKitHttpResponse, status: number, value: unknown): void {
  const encoded = JSON.stringify(value)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(encoded)
}

/**
 * 创建关键词管理请求映射。
 * 业务逻辑: 先宿主认证，再严格解析，最后仅调用对应ProcessingService方法。
 * 关键判断: GET不登记/唤醒，POST仅cookie或同一writeKey，403永不救援，返回直接DTO。
 * 异常处理: 参数400、CAS409、缺记录404、存储503；其他500均不回传内部路径/正文/凭据。
 * 参数: deps为真实服务与宿主认证。返回: 无副作用handler。
 */
export function createReviewProcessorsHandler(deps: ReviewProcessorsDeps): (req: TraderKitHttpRequest, res: TraderKitHttpResponse) => Promise<void> {
  /** 业务逻辑: 单请求认证/分发；关键判断: 写键只救401 POST；异常处理: 稳定脱敏响应。参数: req/res。返回: 完成。 */
  return async function handler(req, res): Promise<void> {
    try {
      const rejection = deps.requestRejection(req)
      if (rejection === 403) { respond(res, 403, { error: 'FORBIDDEN', message: '请求未通过宿主访问栅栏' }); return }
      const method = req.method ?? 'GET'
      const supplied = req.headers['x-write-key']
      const a = typeof supplied === 'string' ? Buffer.from(supplied) : Buffer.alloc(0)
      const b = Buffer.from(deps.writeKey)
      const writeAuthorized = method === 'POST' && b.length > 0 && a.length === b.length && timingSafeEqual(a, b)
      if (rejection === 401 && !writeAuthorized) { respond(res, 401, { error: 'UNAUTHENTICATED', message: '需要宿主登录凭据' }); return }
      const url = new URL(req.url ?? '', 'http://127.0.0.1')
      const path = url.pathname.slice(REVIEW_PROCESSORS_PATH.length)
      if (!url.pathname.startsWith(REVIEW_PROCESSORS_PATH + '/')) { respond(res, 404, { error: 'NOT_FOUND', message: '接口不存在' }); return }
      const service = deps.service
      let result: unknown
      if (method === 'GET') {
        if (path === '/health' || path === '/registry') { query(url, []); result = path === '/health' ? await service.health() : await service.registry() }
        else if (path === '/tasks') {
          const q = query(url, ['workflowId', 'state', 'code', 'market', 'tradeDate', 'limit', 'cursor'])
          const parsed: TaskQuery = {
            ...(q.workflowId === undefined ? {} : { workflowId: identity(q.workflowId) }),
            ...(q.code === undefined ? {} : { code: code(q.code) }),
            ...(q.market === undefined ? {} : { market: market(q.market) ?? invalid() }),
            ...(q.tradeDate === undefined ? {} : { tradeDate: date(q.tradeDate) }),
            ...(q.cursor === undefined ? {} : { cursor: identity(q.cursor, 256) }),
            limit: q.limit === undefined ? 20 : integer(q.limit, 1, 50),
          }
          if (q.state !== undefined && !['queued', 'waiting', 'preparing', 'running', 'retryWaiting', 'succeeded', 'failed', 'canceled'].includes(q.state)) invalid()
          result = await service.tasks({ ...parsed, ...(q.state === undefined ? {} : { state: q.state as ExecutionState }) })
        } else if (path === '/task' || path === '/events') {
          const q = query(url, path === '/task' ? ['runId'] : ['runId', 'afterSequence', 'limit'])
          const runId = identity(q.runId)
          result = path === '/task' ? await service.task(runId) : await service.events(runId, q.afterSequence === undefined ? 0 : integer(q.afterSequence, 0), q.limit === undefined ? 50 : integer(q.limit, 1, 100))
          if (result === null) invalid('NOT_FOUND')
        } else if (path === '/cards') {
          const q = query(url, ['code', 'market', 'date'])
          result = await service.cards({ code: code(q.code), market: market(q.market), date: date(q.date) })
        } else { respond(res, 404, { error: 'NOT_FOUND', message: '接口不存在' }); return }
      } else if (method === 'POST') {
        query(url, [])
        const input = await body(req)
        if (path === '/cancel' || path === '/retry') {
          keys(input, ['runId', 'recordVersion', path === '/cancel' ? 'reason' : 'expectedInputRevision'])
          if (typeof input.recordVersion !== 'number') invalid()
          const common = { runId: identity(input.runId), recordVersion: integer(input.recordVersion, 1) }
          result = path === '/cancel' ? await service.cancel({ ...common, reason: text(input.reason, 512) }) : await service.retry({ ...common, expectedInputRevision: identity(input.expectedInputRevision) })
        } else if (path === '/reload') { keys(input, []); result = await service.reload() }
        else if (path === '/settings') {
          keys(input, ['settingsRevision', 'workflows'])
          if (typeof input.settingsRevision !== 'number') invalid()
          if (!Array.isArray(input.workflows) || input.workflows.length > 100) invalid()
          const workflows: SettingsRequest['workflows'] = input.workflows.map(raw => {
            const entry = object(raw)
            keys(entry, ['workflowId', 'enabled', 'options'])
            if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') invalid()
            return { workflowId: identity(entry.workflowId), ...(entry.enabled === undefined ? {} : { enabled: entry.enabled as boolean }), ...(entry.options === undefined ? {} : { options: object(entry.options) as JsonObject }) }
          })
          if (new Set(workflows.map(entry => entry.workflowId)).size !== workflows.length) invalid()
          result = await service.settings({ settingsRevision: integer(input.settingsRevision, 0), workflows })
        } else if (path === '/rescan') {
          keys(input, ['dateFrom', 'dateTo', 'cursor'])
          const dateFrom = date(input.dateFrom), dateTo = date(input.dateTo)
          const days = (Date.parse(dateTo) - Date.parse(dateFrom)) / 86_400_000
          if (days < 0 || days > 30) invalid()
          result = await service.rescan({ dateFrom, dateTo, ...(input.cursor === undefined ? {} : { cursor: identity(input.cursor, 256) }) })
        } else { respond(res, 404, { error: 'NOT_FOUND', message: '接口不存在' }); return }
      } else { respond(res, 405, { error: 'METHOD_NOT_ALLOWED', message: '请求方法不支持' }); return }
      respond(res, 200, result)
    } catch (error) {
      const raw = error instanceof Error ? String((error as Error & { code?: unknown }).code ?? error.message) : ''
      const [status, code, message] = raw === 'BODY_TOO_LARGE' ? [413, 'BODY_TOO_LARGE', '请求正文超过限制']
        : raw === 'NOT_FOUND' || /(?:RUN|TASK)_NOT_FOUND$|SOURCE_.*REMOVED/.test(raw) ? [404, 'NOT_FOUND', '运行记录不存在']
        : /CONFLICT|STALE|REVISION_MISMATCH|CAS|^SOURCE_/.test(raw) ? [409, 'CONFLICT', '运行或配置版本已变化，请刷新后重试']
        : /^INVALID_|_INVALID$|_REQUIRED$/.test(raw) ? [400, 'INVALID_REQUEST', '请求参数不合法']
        : /STORAGE|CORRUPT|EACCES|EPERM|ENOSPC/.test(raw) ? [503, 'STORAGE_UNAVAILABLE', '持久存储暂不可用']
        : [500, 'INTERNAL_ERROR', '处理请求失败']
      respond(res, status as number, { error: code, message })
    }
  }
}

/**
 * 注册独立关键词敏感API前缀。
 * 业务逻辑: 同一ProcessingService供全部路由，effect拥有唯一prefix并释放。
 * 关键判断: 不重建service、不继承旧免签GET，主协调传相同writeKey。
 * 异常处理: 重复注册/宿主缺能力由宿主拒绝，不吞错误。
 * 参数: ctx为宿主，options为受控服务与写键。返回: 无。
 */
export function registerReviewProcessorRoutes(ctx: Context, options: { readonly service: ProcessingService; readonly writeKey: string }): void {
  const handler = createReviewProcessorsHandler({ ...options, requestRejection: req => ctx.connection.requestRejection(req) })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: REVIEW_PROCESSORS_PATH, handler }))
}
