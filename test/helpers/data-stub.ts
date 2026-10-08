/**
 * 数据面测试共用真实本地桩（零 mock 库纪律：`node:http` 真实服务 + 随机端口 +
 * 真实 fetch 重定向传输；design D-10）。
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DataTransport } from '../../src/data/http.ts'
import { createDataDeps, type DataDeps } from '../../src/data/deps.ts'
import { resolveTraderKitConfig, type TraderKitConfig } from '../../src/config.ts'

export interface StubRequest {
  method: string
  path: string
  query: URLSearchParams
  body: string
}

export interface StubResponse {
  status?: number
  json?: unknown
  text?: string
  /** 原始字节响应（GBK 等非 utf8 编码测试用）。 */
  raw?: Buffer
  delayMs?: number
}

export type StubResponder = (req: StubRequest) => StubResponse | undefined

export interface DataStubServer {
  port: number
  base: string
  /** 出站计数（断言「未发出请求」与「零网络」的事实依据）。 */
  requests: StubRequest[]
  count(pathSubstring: string): number
  setResponder(responder: StubResponder): void
  close(): Promise<void>
}

export async function startDataStub(): Promise<DataStubServer> {
  const requests: StubRequest[] = []
  let responder: StubResponder = () => ({ status: 404, text: 'stub: no responder' })
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://stub.local')
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const stubReq: StubRequest = {
        method: req.method ?? 'GET',
        path: url.pathname,
        query: url.searchParams,
        body: Buffer.concat(chunks).toString('utf8'),
      }
      requests.push(stubReq)
      const out = responder(stubReq) ?? { status: 404, text: 'stub: unmatched' }
      const write = (): void => {
        if (out.raw !== undefined) {
          res.writeHead(out.status ?? 200, { 'Content-Type': 'application/octet-stream' })
          res.end(out.raw)
          return
        }
        const bodyText = out.json !== undefined ? JSON.stringify(out.json) : (out.text ?? '')
        res.writeHead(out.status ?? 200, { 'Content-Type': out.json !== undefined ? 'application/json' : 'text/plain' })
        res.end(bodyText)
      }
      if (out.delayMs !== undefined && out.delayMs > 0) setTimeout(write, out.delayMs)
      else write()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    requests,
    count(pathSubstring: string): number {
      return requests.filter((r) => r.path.includes(pathSubstring)).length
    },
    setResponder(fn: StubResponder): void {
      responder = fn
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/** 官方源 origin 前缀（重定向映射：只有 host 换成本地桩，路径/查询/头/体原样）。 */
export const OFFICIAL_BASES: readonly string[] = [
  'https://goserver.huanshoulv.com', // S7 surgeLimitList / surgeLimitHistory
  'https://flow.10jqka.com.cn', // S5 异动历史
  'https://vis.10jqka.com.cn', // S5 涨停明细
  'https://flash-api.xuangubao.com.cn', // S8 概念
  'https://d.10jqka.com.cn', // S9 行情快照（realhead JSONP）
  'https://qt.gtimg.cn', // S10 指数行情（腾讯）
]

/** 重定向传输：官方 URL → 本地桩（真实 fetch 出站到真实本地 http 服务，零 mock）。 */
export function stubTransport(stub: DataStubServer): DataTransport {
  return (url, init) => {
    let target = url
    for (const base of OFFICIAL_BASES) {
      if (url.startsWith(base)) {
        target = `${stub.base}${url.slice(base.length)}`
        break
      }
    }
    if (!target.startsWith('http://127.0.0.1:')) {
      throw new Error('stubTransport 只允许出站到本地回环桩（实际目标: ' + target + '）')
    }
    return fetch(target, init)
  }
}

/**
 * TQ-Local 端点重定向传输（review-loop）：把固定端点 URL 映射到本地桩
 * （记录原始 URL 供「只发白名单端点」断言；真实 fetch 出站到真实本地 http 服务）。
 */
export function tqLocalRedirectTransport(
  stub: DataStubServer,
  seen: string[] = [],
): DataTransport & { seen: string[] } {
  const transport = ((url: string, init?: RequestInit) => {
    seen.push(url)
    return fetch(stub.base + '/', init)
  }) as DataTransport & { seen: string[] }
  transport.seen = seen
  return transport
}

/** 真实临时 dataRoot（缓存落盘用；测试结束清理）。 */
export async function createTempDataRoot(): Promise<{ dataRoot: string; cleanup(): Promise<void> }> {
  const dataRoot = await mkdtemp(join(tmpdir(), 'dtk-data-'))
  return { dataRoot, cleanup: () => rm(dataRoot, { recursive: true, force: true }) }
}

export interface TestDepsOptions {
  dataRoot: string
  stub?: DataStubServer
  configOverrides?: TraderKitConfig
  /** 固定时钟（时段/限流日测试）。 */
  now?: () => Date
  /** guard 等待注入（默认即时 resolve，测试零真实等待；间隔时延测试不注入）。 */
  guardDelay?: (ms: number) => Promise<void>
}

export function createTestDeps(opts: TestDepsOptions): DataDeps {
  // 模块级测试默认 minIntervalMs=0（间隔行为在 data-guard.test.ts 以 guard 直测 + 真实 60ms 计时）；
  // 显式 configOverrides.guard 覆盖仍然生效。
  const config = resolveTraderKitConfig({
    ...opts.configOverrides,
    dataRoot: opts.dataRoot,
    guard: { minIntervalMs: 0, ...opts.configOverrides?.guard },
  })
  return createDataDeps(config, {
    now: opts.now,
    transport: opts.stub === undefined ? undefined : stubTransport(opts.stub),
    guardOptions: { delay: opts.guardDelay },
  })
}

// ---------------------------------------------------------------- 源响应工厂（口径照各源响应形状）

export const S7_FIELDS = ['stock_code', 'cause', 'first_time', 'last_time', 'open_count', 'surgedays', 'trackback', 'intensity'] as const

export interface S7StubRow {
  cause?: string | null
  first?: string | null
  last?: string | null
  open?: number | null
  surgedays?: string | null
}

/** S7 响应体（fields × surgeList 矩阵，照 fetch_hsl_reasons 解析形状；date=响应体业务日）。 */
export function s7Payload(date: string | null, rows: Record<string, S7StubRow>): unknown {
  const surgeList = Object.entries(rows).map(([code, r]) => [
    code, r.cause ?? null, r.first ?? null, r.last ?? null, r.open ?? null, r.surgedays ?? null, null, null,
  ])
  return { data: { date, fields: [...S7_FIELDS], surgeList } }
}

export interface S5StubRecord {
  date: string
  tagCode?: string
  tagName?: string
  reason?: string
  stockName?: string
}

/** S5 history 响应（anomalyAnalysisList；statusCode 照脚本 status_code）。 */
export function s5HistoryPayload(statusCode: number, records: S5StubRecord[]): unknown {
  return {
    status_code: statusCode,
    status_msg: statusCode === 0 ? '成功' : 'mock-error',
    data: { anomalyAnalysisList: records.map((r) => ({ ...r })) },
  }
}

/** S5 limitup 明细响应（boardAnalyses[-1].closeTime = 最后封板时刻）。 */
export function s5DetailPayload(boards: Array<{ closeTime?: string; openTime?: string }>, closeNumText?: string): unknown {
  return { data: { boardAnalyses: boards, closeNumText: closeNumText ?? '', summary: '' } }
}

/** S8 响应（code===20000 成功判定；data 为 plateKey → plate 信息）。 */
export function s8Payload(plates: Record<string, unknown>, code = 20000): unknown {
  return { code, message: code === 20000 ? 'success' : 'error', data: plates }
}

export interface S8StubPlate {
  core_avg_pcp: number
  plate_name: string
  reason?: string
  plate_id?: string | number
  top_n_stocks?: { items?: Array<{ symbol?: string; stock_chi_name?: string }> }
}
