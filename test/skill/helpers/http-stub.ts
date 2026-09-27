/**
 * 测试专用本地 HTTP(S) 服务桩（零 mock 纪律：node:http/https 真实监听随机端口）。
 *
 * HTTPS 桩用 test/fixtures/dev-cert 的自签名环回证书——skill 下载通道护栏①
 * 只接受 https:，测试必须打真实 https 流量；测试进程内以
 * NODE_TLS_REJECT_UNAUTHORIZED=0 放行自签名（仅环回测试，用后还原）。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { buildOfficialLikeZip } from './zipgen.ts'

const DEV_CERT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'dev-cert')

export interface StubRequestLog {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
}

export interface HttpStub {
  port: number
  origin: string
  readonly requests: StubRequestLog[]
  close(): Promise<void>
}

export type StubHandler = (req: IncomingMessage, res: ServerResponse, stub: HttpStub) => void | Promise<void>

async function listen(server: Server | HttpsServer): Promise<AddressInfo> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  return server.address() as AddressInfo
}

/** 真实 HTTPS 环回桩（自签名证书；调用方在测试期间放宽 TLS 校验）。 */
export async function startHttpsStub(handler: StubHandler): Promise<HttpStub> {
  const requests: StubRequestLog[] = []
  const server: HttpsServer = createHttpsServer(
    {
      cert: readFileSync(path.join(DEV_CERT_DIR, 'cert.pem')),
      key: readFileSync(path.join(DEV_CERT_DIR, 'key.pem')),
    },
    (req, res) => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
      void Promise.resolve(handler(req, res, stub)).then(
        () => undefined,
        () => undefined,
      )
    },
  )
  const address = await listen(server)
  const stub: HttpStub = {
    port: address.port,
    origin: `https://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
  return stub
}

/** 纯 HTTP 桩（供护栏拒绝用例与不涉出站的桩计数用例）。 */
export async function startHttpStub(handler: StubHandler): Promise<HttpStub> {
  const requests: StubRequestLog[] = []
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers })
    void Promise.resolve(handler(req, res, stub)).then(
      () => undefined,
      () => undefined,
    )
  })
  const address = await listen(server)
  const stub: HttpStub = {
    port: address.port,
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
  return stub
}

/** 放行自签名证书（仅测试进程；返回还原函数）。 */
export function allowSelfSignedCerts(): () => void {
  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  return () => {
    if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
    else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous
  }
}

/** 便捷：200 + zip 响应（默认一个合法的 tdx-tq-local v1.2.0 包）。 */
export function zipResponse(options: { body?: Buffer; headers?: Record<string, string> } = {}): StubHandler {
  return async (_req, res) => {
    const body = options.body ?? buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n\nbody\n')
    res.writeHead(200, { 'content-type': 'application/zip', 'content-length': body.length, ...options.headers })
    res.end(body)
  }
}

export { buildOfficialLikeZip }
