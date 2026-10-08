/**
 * 数据面出站传输（data-tool-contract「只读边界」的具名出站通道之一；design D-4/D-10）。
 *
 * - 全仓**两条具名出站通道**之一：`src/data/http.ts`（本文件，数据面唯一 `fetch(` 调用点）
 *   与 `src/skill/download.ts`（change 3 下载器）。`src/data/**` 其它模块只依赖本文件
 *   导出的传输接口，MUST NOT 直接 `fetch`（结构断言见 test/structure.test.ts）。
 * - 原生 `fetch`（undici）+ `AbortSignal.timeout` + 固定退避重试（至多 2 次，config
 *   `sources.*.retries` 上限 2）+ 非 2xx / 非 JSON 显式错误。
 * - 绝不向 `127.0.0.1:17709` 发任何数据请求——**唯一例外** = review-loop
 *   `tq-local-lookup` 的 `get_stock_info` 只读白名单请求（owner 裁决 2026-10-06；
 *   method/字段/目标/请求体四重复核见 `assertNotTqLocalEndpoint`），其余一律
 *   `blockedEndpoint` 拦截；健康检查另有独立 `net.connect` 探测通道（health.ts）。
 * - 传输接口可替换（design D-10）：测试用真实本地 `node:http` 服务桩 + 重定向传输，
 *   零 mock 库。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */

/** 与 `fetch` 同形的传输接口（模块代码只依赖该接口，design D-10）。 */
export type DataTransport = (url: string, init?: RequestInit) => Promise<Response>

/** 默认传输：原生 fetch（Node 20 undici）。 */
export const nativeTransport: DataTransport = (url, init) => fetch(url, init)

/** 显式错误分类（「无数据」与「取数失败」区分口径的传输层部分，contracts §12.8）。 */
export type HttpDataErrorKind = 'blockedEndpoint' | 'timeout' | 'network' | 'non2xx' | 'nonJson'

export class HttpDataError extends Error {
  readonly kind: HttpDataErrorKind
  /** 非 2xx 时的状态码。 */
  readonly status?: number

  constructor(kind: HttpDataErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'HttpDataError'
    this.kind = kind
    this.status = status
  }
}

const TQ_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const TQ_LOCAL_PORT = '17709'

/**
 * TQ-Local 只读白名单（review-loop `tq-local-lookup`；owner 裁决 2026-10-06）。
 *
 * **本文件是白名单的唯一字面量定义点**（结构断言：全仓 `method` 字面量集合 ==
 * `TQ_LOCAL_METHOD_ALLOWLIST`）。放宽点严格限定：
 * - 目标 = 仅 `TQ_LOCAL_ENDPOINT`（回环）；
 * - method = 仅 `get_stock_info`（MUST NOT 行情 `get_market_*` / 交易 `order_stock`
 *   等任何其它接口）；
 * - params = 仅 `stock_code` + `field_list`（取值 ⊆ `TQ_LOCAL_FIELD_ALLOWLIST`）。
 * 请求体在闸内**复核**（声明的 method/字段必须与实际 JSON-RPC body 一致），
 * 声明白名单与实际请求不符一律 `blockedEndpoint`。
 */
export const TQ_LOCAL_ENDPOINT = 'http://127.0.0.1:17709/'
export const TQ_LOCAL_METHOD_ALLOWLIST = ['get_stock_info'] as const
export const TQ_LOCAL_FIELD_ALLOWLIST = ['Name', 'HSStockKind', 'J_start', 'tdx_dyname', 'rs_hyname', 'ActiveCapital', 'J_zgb'] as const

/** TQ-Local 请求白名单声明（由 `src/data/tq-local.ts` 出口传入；闸内复核 body）。 */
export interface TqLocalAllowance {
  method: (typeof TQ_LOCAL_METHOD_ALLOWLIST)[number]
  fieldList: readonly (typeof TQ_LOCAL_FIELD_ALLOWLIST)[number][]
}

function blocked(message: string): never {
  throw new HttpDataError('blockedEndpoint', message)
}

/** 代码强制：数据面请求绝不指向 127.0.0.1:17709，**唯一例外** = 白名单内的 TQ-Local 只读请求。 */
function assertNotTqLocalEndpoint(url: string, allowance: TqLocalAllowance | undefined, body: string | undefined): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HttpDataError('blockedEndpoint', `非法 URL：'${url}'`)
  }
  const host = parsed.hostname
  const isTqLocal = TQ_LOCAL_HOSTS.has(host) && parsed.port === TQ_LOCAL_PORT
  if (!isTqLocal) {
    if (allowance !== undefined) blocked('TQ-Local 白名单声明只允许指向 ' + TQ_LOCAL_ENDPOINT)
    return
  }
  if (allowance === undefined) {
    blocked(
      `拒绝向 ${host}:${TQ_LOCAL_PORT} 发起数据请求：该端口只放行 TQ-Local 白名单请求`
      + '（get_stock_info 只读；owner 裁决 2026-10-06），其余一律拒绝；健康检查另有独立 net.connect 探测（design D-4/D-8/D-11）',
    )
  }
  if (url !== TQ_LOCAL_ENDPOINT) blocked(`TQ-Local 白名单只允许 '${TQ_LOCAL_ENDPOINT}'，实际 '${url}'`)
  if (!(TQ_LOCAL_METHOD_ALLOWLIST as readonly string[]).includes(allowance.method)) {
    blocked(`TQ-Local 白名单外的 method '${allowance.method}'（允许：${TQ_LOCAL_METHOD_ALLOWLIST.join(', ')}）——行情/交易接口一律禁止`)
  }
  for (const f of allowance.fieldList) {
    if (!(TQ_LOCAL_FIELD_ALLOWLIST as readonly string[]).includes(f)) {
      blocked(`TQ-Local 字段白名单外的 field_list 项 '${f}'（允许：${TQ_LOCAL_FIELD_ALLOWLIST.join(', ')}）`)
    }
  }
  // body 复核：声明的 method/params 必须与实际 JSON-RPC body 一致。
  let doc: unknown
  try {
    doc = JSON.parse(body ?? '')
  } catch {
    blocked('TQ-Local 白名单请求体必须是 JSON-RPC 对象（实际无法解析）')
  }
  const rec = doc as { method?: unknown; params?: unknown } | null
  if (rec === null || typeof rec !== 'object' || rec.method !== allowance.method) {
    blocked(`TQ-Local 请求体 method 与白名单声明不一致（声明 '${allowance.method}'）`)
  }
  const params = (rec.params ?? {}) as Record<string, unknown>
  for (const key of Object.keys(params)) {
    if (key !== 'stock_code' && key !== 'field_list') {
      blocked(`TQ-Local params 白名单外的键 '${key}'（仅允许 stock_code / field_list）`)
    }
  }
  const fields = Array.isArray(params.field_list) ? params.field_list : []
  if (fields.length === 0) blocked('TQ-Local 请求必须显式给出 field_list（MUST NOT 空）')
  for (const f of fields) {
    if (typeof f !== 'string' || !(TQ_LOCAL_FIELD_ALLOWLIST as readonly string[]).includes(f)) {
      blocked(`TQ-Local 请求体 field_list 含白名单外字段 '${String(f)}'`)
    }
  }
  if (typeof params.stock_code !== 'string' || params.stock_code === '') {
    blocked('TQ-Local 请求体必须含 stock_code')
  }
}

export interface RequestJsonOptions {
  method?: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  /** 单次尝试超时（毫秒，AbortSignal.timeout 截断）。 */
  timeoutMs: number
  /** 失败后的额外重试次数（至多 2；config schema 已限）。 */
  retries?: number
  /** 重试间固定退避（毫秒）。 */
  backoffMs?: number
  /** 可替换传输（缺省原生 fetch；测试注入重定向到本地桩）。 */
  transport?: DataTransport
  /** TQ-Local 白名单声明（唯一放行 17709 的方式；闸内复核 body 一致性）。 */
  tqLocal?: TqLocalAllowance
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) return cause.message
  return String(cause)
}

/**
 * 请求 JSON：非 2xx / 非 JSON / 超时 / 网络错误 → 显式 `HttpDataError`；
 * 失败按固定退避重试至多 `retries` 次（默认 2），重试不改 URL 与请求体。
 */
export async function requestJson(url: string, opts: RequestJsonOptions): Promise<unknown> {
  assertNotTqLocalEndpoint(url, opts.tqLocal, opts.body)
  const transport = opts.transport ?? nativeTransport
  const retries = Math.max(0, Math.min(2, opts.retries ?? 2))
  const backoffMs = opts.backoffMs ?? 500
  const method = opts.method ?? 'GET'

  let lastError: HttpDataError | undefined
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await transport(url, {
        method,
        headers: opts.headers,
        body: opts.body,
        signal: AbortSignal.timeout(opts.timeoutMs),
      })
      if (!response.ok) {
        throw new HttpDataError('non2xx', `${url} 返回非 2xx：HTTP ${response.status}`, response.status)
      }
      const text = await response.text()
      try {
        return JSON.parse(text) as unknown
      } catch {
        throw new HttpDataError('nonJson', `${url} 返回非 JSON 响应（前 200 字符：${text.slice(0, 200)}）`)
      }
    } catch (cause) {
      if (cause instanceof HttpDataError) {
        lastError = cause
      } else if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
        lastError = new HttpDataError('timeout', `${url} 请求超时（${opts.timeoutMs}ms，AbortSignal.timeout 截断）`)
      } else {
        lastError = new HttpDataError('network', `${url} 网络错误：${describeCause(cause)}`)
      }
      if (attempt < retries) {
        await delay(backoffMs)
      }
    }
  }
  throw lastError as HttpDataError
}
