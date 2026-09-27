/**
 * 端到端形态测试（tasks 1.9；design D-10/R2-7）：真实临时 node:http server +
 * node:net 裸 socket 驱动探针 handler——createServer 属服务端监听，不是出站
 * 通道，测试内零 fetch、零客户端请求库调用（§7 补充口径）。
 */
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { connect } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createProbeHandler, PROBE_PATH } from '../../src/routes/probe.ts'
import { injectedState, makeDeps, PROBE_PAGE_MARKER, UNAUTHENTICATED_READONLY_DEFAULT } from './helpers.ts'

/** A 层判定替身（确定性的 cookie 规则；宿主栅栏语义由宿主负责，不在本测范围）。 */
function cookieRejection(req: { headers?: Record<string, string | string[] | undefined> }): 401 | 403 | undefined {
  const cookie = req.headers?.cookie
  return typeof cookie === 'string' && cookie.includes('dsh-auth=e2e') ? undefined : 401
}

let server: Server | null = null
let port = 0
const diagnosticToken = randomBytes(32).toString('hex')

beforeAll(async () => {
  const handler = createProbeHandler({
    ...makeDeps({ requestRejection: cookieRejection }),
    diagnosticToken,
    unauthenticatedReadonly: UNAUTHENTICATED_READONLY_DEFAULT,
  })
  server = createServer((req, res) => {
    handler(req as Parameters<typeof handler>[0], res as Parameters<typeof handler>[1])
  })
  await new Promise<void>((resolve) => {
    server!.listen(0, '127.0.0.1', () => resolve())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('临时服务器未取得监听端口')
  }
  port = address.port
})

afterAll(async () => {
  if (server !== null) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error === undefined || error === null ? resolve() : reject(error)))
    })
    server = null
  }
})

/** 裸 socket 驱动：写入原始 HTTP 报文，收集完整响应文本。 */
function rawRequest(raw: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, '127.0.0.1')
    let data = ''
    socket.on('connect', () => {
      socket.end(raw)
    })
    socket.on('data', (chunk) => {
      data += chunk.toString('utf8')
    })
    socket.on('end', () => resolve(data))
    socket.on('error', reject)
  })
}

/** 最小响应解析：状态行 + 头区 + 正文（处理 node 的 chunked 分帧）。 */
function parseResponse(raw: string): { statusLine: string; headers: string; body: string } {
  const separator = raw.indexOf('\r\n\r\n')
  const head = raw.slice(0, separator)
  const rawBody = raw.slice(separator + 4)
  const body = /transfer-encoding:\s*chunked/i.test(head) ? dechunk(rawBody) : rawBody
  return { statusLine: head.split('\r\n')[0] ?? '', headers: head, body }
}

function dechunk(raw: string): string {
  let out = ''
  let rest = raw
  for (;;) {
    const lineEnd = rest.indexOf('\r\n')
    if (lineEnd === -1) {
      break
    }
    const size = parseInt(rest.slice(0, lineEnd), 16)
    if (!Number.isFinite(size) || size === 0) {
      break
    }
    out += rest.slice(lineEnd + 2, lineEnd + 2 + size)
    rest = rest.slice(lineEnd + 2 + size + 2)
  }
  return out
}

function probeRequest(target: string, extraHeaders: string[] = []): Promise<string> {
  const lines = ['GET ' + target + ' HTTP/1.1', 'Host: 127.0.0.1', ...extraHeaders, 'Connection: close', '', '']
  return rawRequest(lines.join('\r\n'))
}

describe('真实临时 http server + 裸 socket 端到端', () => {
  it('A 层：带 cookie 的 GET PROBE_PATH → 200 + no-store + 探针页正文 + 注入状态', async () => {
    const raw = await probeRequest(PROBE_PATH, ['Cookie: dsh-auth=e2e'])
    const parsed = parseResponse(raw)
    expect(parsed.statusLine).toContain(' 200 ')
    expect(parsed.headers.toLowerCase()).toContain('cache-control: no-store')
    expect(parsed.headers.toLowerCase()).toContain('content-type: text/html')
    expect(parsed.body).toContain(PROBE_PAGE_MARKER)
    const state = injectedState(parsed.body)
    expect(state.auth).toBe('cookie')
    expect(state.status).toBe(200)
  })

  it('B 层：无 cookie 但带插件自有 ?token= → 200 + auth=diagnostic-token', async () => {
    const raw = await probeRequest(PROBE_PATH + '?token=' + diagnosticToken)
    const parsed = parseResponse(raw)
    expect(parsed.statusLine).toContain(' 200 ')
    expect(injectedState(parsed.body).auth).toBe('diagnostic-token')
  })

  it('未认证（无 cookie 无 token）→ 401，正文为空、页面不渲染', async () => {
    const raw = await probeRequest(PROBE_PATH)
    const parsed = parseResponse(raw)
    expect(parsed.statusLine).toContain(' 401 ')
    expect(parsed.headers.toLowerCase()).toContain('cache-control: no-store')
    expect(parsed.body).not.toContain(PROBE_PAGE_MARKER)
    expect(parsed.body).toBe('')
  })

  it('方法不匹配：POST → 405 + Allow: GET', async () => {
    const raw = await rawRequest('POST ' + PROBE_PATH + ' HTTP/1.1\r\nHost: 127.0.0.1\r\nCookie: dsh-auth=e2e\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
    const parsed = parseResponse(raw)
    expect(parsed.statusLine).toContain(' 405 ')
    expect(parsed.headers.toLowerCase()).toContain('allow: get')
  })
})
