/**
 * 数据面出站传输（data-tool-contract「只读边界」的具名出站通道之一；design D-4/D-10）。
 *
 * - 全仓**两条具名出站通道**之一：`src/data/http.ts`（本文件，数据面唯一 `fetch(` 调用点）
 *   与 `src/skill/download.ts`（change 3 下载器）。`src/data/**` 其它模块只依赖本文件
 *   导出的传输接口，MUST NOT 直接 `fetch`（结构断言见 test/structure.test.ts）。
 * - 原生 `fetch`（undici）+ `AbortSignal.timeout` + 固定退避重试（至多 2 次，config
 *   `sources.*.retries` 上限 2）+ 非 2xx / 非 JSON 显式错误。
 * - 绝不向 `127.0.0.1:17709` 发任何数据请求（TQ 能力全在 skill 侧；17709 的唯一动作
 *   是 src/data/health.ts 的独立 `net.connect` 探测通道）——本文件代码强制拦截。
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

/** 代码强制：数据面请求绝不指向 127.0.0.1:17709（design D-4）。 */
function assertNotTqLocalEndpoint(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new HttpDataError('blockedEndpoint', `非法 URL：'${url}'`)
  }
  const host = parsed.hostname
  if (TQ_LOCAL_HOSTS.has(host) && parsed.port === TQ_LOCAL_PORT) {
    throw new HttpDataError(
      'blockedEndpoint',
      `拒绝向 ${host}:${TQ_LOCAL_PORT} 发起数据请求：TQ-Local 能力在 skill 侧，`
      + '数据模块对该端口的唯一动作是健康检查的独立 net.connect 探测（design D-4/D-8）',
    )
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
  assertNotTqLocalEndpoint(url)
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
