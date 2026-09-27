/**
 * test/probe 共享桩（design D-10 测试 seam）。
 *
 * 零 mock 纪律：不用 mock 库——这里是 IncomingMessage/ServerResponse 的
 * **形状桩**（真实普通对象，记录调用结果），与 dsh-trading「真实本地服务桩」
 * 先例同构。端到端另见 probe-e2e.test.ts（真实临时 node:http server + node:net
 * 裸 socket 驱动，无出站调用——createServer 属服务端监听）。
 */
import { PROBE_BASE_PATH, UNAUTHENTICATED_READONLY_DEFAULT, type ProbeHandlerDeps, type ProbeState } from '../../src/routes/probe.ts'
import { PROBE_HTML, PROBE_PAGE_MARKER } from '../../src/client/probe/index.html.ts'
import type { TraderKitHttpRequest, TraderKitHttpResponse } from '../../src/context-types.ts'

export { PROBE_HTML, PROBE_PAGE_MARKER, PROBE_BASE_PATH, UNAUTHENTICATED_READONLY_DEFAULT }

export interface ProbeRequestOptions {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
}

/** IncomingMessage 形状桩：url/method/headers + 异步迭代面。 */
export function makeReq(options: ProbeRequestOptions = {}): TraderKitHttpRequest {
  return {
    url: options.url ?? '/dsh-trader-kit/probe',
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    [Symbol.asyncIterator]: async function* () {},
  }
}

export interface RecordedResponse {
  status: number
  headers: Record<string, string>
  body: string
  ended: boolean
}

/** ServerResponse 形状桩：记录 writeHead 的状态与头、end 的正文。 */
export function makeRes(): { res: TraderKitHttpResponse; rec: RecordedResponse } {
  const rec: RecordedResponse = { status: 0, headers: {}, body: '', ended: false }
  const res: TraderKitHttpResponse = {
    statusCode: 0,
    writeHead(status: number, headers?: Record<string, string>) {
      rec.status = status
      rec.headers = headers ?? {}
      res.statusCode = status
    },
    end(body?: string | Uint8Array) {
      rec.ended = true
      if (typeof body === 'string') {
        rec.body += body
      }
    },
  }
  return { res, rec }
}

/** handler 依赖工厂：生产取值（PROBE_HTML + 生产 C 层常量），用例按需覆盖。 */
export function makeDeps(overrides: Partial<ProbeHandlerDeps> = {}): ProbeHandlerDeps {
  return {
    template: PROBE_HTML,
    diagnosticToken: 'tok-diag-aabbcc',
    requestRejection: () => undefined,
    basePath: PROBE_BASE_PATH,
    port: 41000,
    unauthenticatedReadonly: UNAUTHENTICATED_READONLY_DEFAULT,
    ...overrides,
  }
}

/** 从探针页响应体解析注入的 window.__PROBE__（转义后的 JSON 可直接 parse）。 */
export function injectedState(body: string): ProbeState {
  const match = /window\.__PROBE__ = (\{[\s\S]*?\});/.exec(body)
  if (match === null) {
    throw new Error('window.__PROBE__ 未注入（响应体不含探针状态）')
  }
  return JSON.parse(match[1]) as ProbeState
}
