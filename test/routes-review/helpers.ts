/**
 * test/routes-review 共享桩（tasks 2.8 请求桩驱动；design D-1「可注入的 handler 工厂」）。
 *
 * 零 mock 纪律：不用 mock 库——请求/响应为 IncomingMessage/ServerResponse 形状桩
 * （真实普通对象，记录调用结果，沿 test/probe/helpers.ts 先例）；存储层接**真实**
 * store 实现 + 真实临时目录（test/review/helpers 的 makeTempRoot）；取数 seam 为
 * 函数注入桩（含调用记录，供「非法入参不触发任何读/网」断言）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { REVIEW_BASE_PATH, REVIEW_PAGE_PATH, type ReviewHandlerDeps } from '../../src/routes/review.ts'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'
import { appendCard, locateDoc, parseDoc } from '../../src/review/store.ts'
import { createNameResolver } from '../../src/review/context.ts'
import { runLimitReasonBacktrack, type LimitDayResponse } from '../../src/review/enrich.ts'
import type { TraderKitHttpRequest, TraderKitHttpResponse } from '../../src/context-types.ts'

export { REVIEW_HTML, REVIEW_PAGE_PATH }

/** 固定时钟（与 test/review/helpers 同一刻：2026-09-24T14:32:05+08:00）。 */
export const NOW_1432 = new Date('2026-09-24T06:32:05Z')
/** 回溯起点业务日（T0 桩缺省返回值）。 */
export const STUB_TRADE_DATE = '2026-09-24'

export interface ReviewRequestOptions {
  url?: string
  method?: string
  headers?: Record<string, string | string[] | undefined>
  body?: string
  destroyed?: boolean
}

/** IncomingMessage 形状桩：url/method/headers + 异步迭代面（POST body 经 chunks）。 */
export function makeReq(options: ReviewRequestOptions = {}): TraderKitHttpRequest {
  const body = options.body
  const req = {
    url: options.url ?? REVIEW_PAGE_PATH,
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
    [Symbol.asyncIterator]: async function* () {
      if (body !== undefined) yield body
    },
  } as TraderKitHttpRequest & { destroyed?: boolean }
  if (options.destroyed !== undefined) req.destroyed = options.destroyed
  return req
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
      if (typeof body === 'string') rec.body += body
    },
  }
  return { res, rec }
}

/** 取数 seam 调用记录（「非法入参零读/零网」断言用）。 */
export interface SeamRecords {
  limitCalls: Array<{ code: string; date: string }>
  conceptCalls: Array<{ code: string; date?: string }>
  remoteNameCalls: string[]
  locateCalls: number
}

/** T1 逐日桩响应（缺省 = 当日命中，1 次请求即停）。 */
export function limitHitResponse(date: string, cause = '孩子王一字板（订单能见度）'): LimitDayResponse {
  return { available: true, tradeDate: date, errors: [], guard: null, cause: { value: cause } }
}

/** A 层判定桩：`dsh-auth=ok` cookie 放行；否则 401（headers.fence = '1' 时 403 栅栏）。 */
export function stubRequestRejection(req: TraderKitHttpRequest): 401 | 403 | undefined {
  if (req.headers.fence === '1') return 403
  const cookie = req.headers.cookie
  return typeof cookie === 'string' && cookie.includes('dsh-auth=ok') ? undefined : 401
}

export function makeTempRoot(prefix = 'dtk-review-routes-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export interface MakeDepsOptions {
  dataRoot?: string
  /** 逐日 T1 桩（缺省 = 当日命中）；函数形态可按请求日给出响应序列。 */
  limitResponse?: LimitDayResponse | ((input: { code: string; date: string }) => Promise<LimitDayResponse>)
  /** 层②名称反查桩（缺省 = 命中「浦发银行」）。 */
  remoteName?: string | null | ((code: string) => Promise<string | null>)
  overrides?: Partial<ReviewHandlerDeps>
}

/** handler 依赖工厂：真实 store + 真实临时目录 + 函数注入的取数 seam（带调用记录）。 */
export function makeDeps(options: MakeDepsOptions = {}): { deps: ReviewHandlerDeps; records: SeamRecords } {
  const dataRoot = options.dataRoot ?? makeTempRoot()
  const records: SeamRecords = { limitCalls: [], conceptCalls: [], remoteNameCalls: [], locateCalls: 0 }
  const limitFn: (input: { code: string; date: string }) => Promise<LimitDayResponse> = (input) => {
    records.limitCalls.push(input)
    const given = options.limitResponse
    if (given === undefined) return Promise.resolve(limitHitResponse(input.date))
    if (typeof given === 'function') return given(input)
    return Promise.resolve(given)
  }
  const remoteFn = (code: string): Promise<string | null> => {
    records.remoteNameCalls.push(code)
    if (typeof options.remoteName === 'function') return options.remoteName(code)
    return Promise.resolve(options.remoteName === undefined ? '浦发银行' : options.remoteName)
  }
  const locateDocCounted: ReviewHandlerDeps['locateDoc'] = async (loc) => {
    records.locateCalls += 1
    return locateDoc(loc)
  }
  const localNameResolver = createNameResolver({ dataRoot })
  const deps: ReviewHandlerDeps = {
    requestRejection: stubRequestRejection,
    allowUnauthenticatedRead: false,
    writeKey: 'test-write-key',
    locateDoc: locateDocCounted,
    parseDoc,
    appendCard,
    resolveTradeDate: async () => ({
      value: STUB_TRADE_DATE,
      source: 'T1-tradeDate',
      isTradingDay: true,
      confidence: 'high',
      marketSuffix: '.SH',
    }),
    getLimitReason: limitFn,
    getConcepts: async (input) => {
      records.conceptCalls.push(input)
      return { available: true, labels: ['银行', '长三角'], name: '浦发银行', detail: null }
    },
    runBacktrack: runLimitReasonBacktrack,
    lookupNameRemote: remoteFn,
    resolveLocalName: async (code) => {
      const r = await localNameResolver.resolve(code)
      return {
        value: r.value,
        nameSource: r.source === 'frontmatter-history' ? 'frontmatter-history' : 'code-only',
        confidence: r.confidence,
      }
    },
    htmlTemplate: REVIEW_HTML,
    readAsset: () => null,
    basePath: REVIEW_BASE_PATH,
    dataRoot,
    now: () => NOW_1432,
    ...options.overrides,
  }
  return { deps, records }
}

/** 从页面响应体解析注入的 window.__REVIEW__（转义后的 JSON 可直接 parse）。 */
export function injectedReviewState(body: string): { writable: boolean; writeKey: string; basePath: string; routePath: string; injectedAt: string } {
  const match = /window\.__REVIEW__ = (\{[\s\S]*?\});/.exec(body)
  if (match === null) {
    throw new Error('window.__REVIEW__ 未注入（响应体不含复盘页状态）')
  }
  return JSON.parse(match[1]) as { writable: boolean; writeKey: string; basePath: string; routePath: string; injectedAt: string }
}

/** 解析 JSON 响应体的最小辅助（断言可读性）。 */
export function jsonBody<T = Record<string, unknown>>(rec: RecordedResponse): T {
  return JSON.parse(rec.body) as T
}

/** 真实写入一颗种子卡片（零 mock：经 store 唯一实现落盘）。 */
export async function seedCard(dataRoot: string, code: string, tradeDate: string, body: string, requestId: string, name = '浦发银行'): Promise<void> {
  await appendCard({ loc: { dataRoot, code, name, tradeDate }, body, clientRequestId: requestId, now: NOW_1432 })
}
