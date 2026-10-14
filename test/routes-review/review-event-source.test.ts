/** 复盘输入作为事件源的真实 HTTP/宿主鉴权/持久登记组合探针；只写系统临时目录。 */
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, it } from 'vitest'
import { createReviewHandler, REVIEW_PAGE_PATH, type ReviewRouteHandler } from '../../src/routes/review.ts'
import { updateCard, deleteCard } from '../../src/review/store.ts'
import { expectationWorkflow } from '../../src/review/processors/expectation.ts'
import { createWorkflowRegistry } from '../../src/review/processors/registry.ts'
import { createWorkflowRecordStore } from '../../src/review/processors/records.ts'
import { createWorkflowRuntime, type WorkflowRuntime } from '../../src/review/processors/runtime.ts'
import { attachKeywordTrigger } from '../../src/review/processors/trigger.ts'
import { readDocumentSources } from '../../src/review/processors/source.ts'
import { makeDeps, injectedReviewState } from './helpers.ts'

const hostRoot = process.env.DIRECTORY_SETTINGS_HOST_ROOT

/**
 * 无登录复盘 HTTP 提交与宿主后台事件登记共用真实来源。
 * 业务逻辑: 匿名页面注入写头，保存、重复、修订、删除均通过真实 HTTP 与 store，对账真实持久记录。
 * 关键判断: 使用已安装宿主 HostConnectionService 的 Host/Origin/Cookie 判定，不创建假 Agent；缺 Jobs 真实等待。
 * 异常处理: HTTP 异常回传 500 供断言定位，最终排空处理并清理校验过的临时目录。
 * 参数: 无；宿主依赖根由 DIRECTORY_SETTINGS_HOST_ROOT 显式指定。
 * 返回: 测试完成；未配置宿主依赖时明确跳过。
 */
it.skipIf(!hostRoot)('真实宿主：无 Cookie 复盘保存/修订/删除触发持久工作流，去重且保留 Host/Origin 栅栏', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-event-source-'))
  let ctx: { connection: { requestRejection(req: unknown): 401 | 403 | undefined }; fiber: { dispose(): Promise<void> }; plugin(plugin: unknown, config: unknown): PromiseLike<unknown> } | undefined
  let server: Server | undefined
  let handler: ReviewRouteHandler | undefined
  let runtime: WorkflowRuntime | undefined
  let trigger: ReturnType<typeof attachKeywordTrigger> | undefined
  const errors: unknown[] = []
  const requests: { method: string; path: string; cookie: string | undefined; rejection: 401 | 403 | undefined }[] = []
  try {
    const { Context } = await import(pathToFileURL(join(hostRoot!, '@deepseek-ai/cordis/lib/index.js')).href)
    const { default: Credentials } = await import(pathToFileURL(join(hostRoot!, '@deepseek-ai/dsh-credentials-local/lib/index.js')).href)
    const Connection = await import(pathToFileURL(join(hostRoot!, '@deepseek-ai/dsh-web-app/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js')).href)
    ctx = new Context()
    await ctx!.plugin(Credentials, { dshHome: join(root, 'host-home'), watch: false })
    await ctx!.plugin(Connection, { cookieMaxAgeDays: 30 })
    const connection = ctx!.connection
    const dataRoot = join(root, 'data')
    const implementations = new Map([[expectationWorkflow.id, expectationWorkflow]])
    const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [{ id: 'expectation', label: '预期整理', mentions: ['预期'], enabled: true, implementationId: expectationWorkflow.id, options: {} }] })
    const records = createWorkflowRecordStore(dataRoot)
    runtime = createWorkflowRuntime({ dataRoot, registry, implementations, records, jobs: null, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
    trigger = attachKeywordTrigger(dataRoot, path => runtime!.reconcileDocument(path), error => { errors.push(error) })
    const { deps, records: dataCalls } = makeDeps({ dataRoot, overrides: {
      requestRejection: req => connection.requestRejection(req), allowUnauthenticatedRead: true, updateCard, deleteCard,
    } })
    handler = createReviewHandler(deps)
    server = createServer((req, res) => {
      requests.push({ method: req.method!, path: req.url!.split('?')[0]!, cookie: req.headers.cookie, rejection: connection.requestRejection(req) })
      void handler!(req, res).catch(error => {
        errors.push(error)
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('EVENT_SOURCE_FIXTURE_HANDLER_FAILED')
      })
    })
    await new Promise<void>(done => server!.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('EVENT_SOURCE_TEST_ADDRESS_UNAVAILABLE')
    const origin = `http://127.0.0.1:${address.port}`
    const allowed = [REVIEW_PAGE_PATH, `${REVIEW_PAGE_PATH}/api/card`, `${REVIEW_PAGE_PATH}/api/card/update`, `${REVIEW_PAGE_PATH}/api/card/delete`]
    /**
     * 只请求本探针随机端口的固定复盘输入路由。
     * 业务逻辑: 浏览器式 HTTP 请求不携带 Cookie、不访问关键词管理 GET。
     * 关键判断: URL 在网络前校验精确源与路由；重定向不自动跟随。
     * 异常处理: 越界立即拒绝，网络错误由测试传播。
     * 参数: path 为固定输入路由，init 为写头/正文或负向 Origin。
     * 返回: 真实 HTTP 响应。
     */
    async function request(path: string, init?: RequestInit): Promise<Response> {
      const url = new URL(path, origin)
      if (url.origin !== origin || !allowed.includes(url.pathname) || new Headers(init?.headers).has('cookie')) throw new Error('EVENT_SOURCE_TEST_REQUEST_OUT_OF_SCOPE')
      return fetch(url, { ...init, redirect: 'manual' })
    }
    const page = await request(REVIEW_PAGE_PATH)
    expect(page.status).toBe(200)
    expect(page.headers.get('set-cookie')).toBeNull()
    const state = injectedReviewState(await page.text())
    expect(state.writable).toBe(true)
    expect(state.writeKey).toBe(deps.writeKey)
    expect(state.writeKey.length).toBeGreaterThan(0)
    const headers = { 'content-type': 'application/json', 'x-write-key': state.writeKey, origin }
    const input = { code: '600000', market: 'sh', tradeDate: '2026-10-12', name: '临时探针标的', body: '@预期 指数企稳且成交额回升。', clientRequestId: 'event-source-save-1' }
    const saved = await request(allowed[1]!, { method: 'POST', headers, body: JSON.stringify(input) })
    expect(saved.status).toBe(200)
    const savedBody = await saved.json()
    expect(savedBody).toMatchObject({ status: 'created', clientRequestId: input.clientRequestId, warnings: [] })
    await trigger.drain(); await runtime.drain()
    const runs = await records.listRuns()
    expect(runs).toHaveLength(1)
    const first = runs[0]!
    const [source] = await readDocumentSources(dataRoot, savedBody.path)
    expect(source).toMatchObject({ anchor: savedBody.anchor, code: input.code, market: input.market, tradeDate: input.tradeDate, body: input.body, verification: 'verified' })
    expect(first).toMatchObject({ workflowId: 'expectation', triggerReason: 'cardSaved', requestSequence: 1, executionState: 'waiting', waitingReason: 'capability', applicability: 'current', sourceSnapshot: source, sourceRevision: source!.sourceRevision, attempts: [], result: null, resultDelivery: 'none' })
    expect(first.timeline.map(event => event.code)).toEqual(['RUN_REGISTERED', 'RUN_WAITING'])
    expect(first.mentions).toHaveLength(1)
    expect(first.mentions[0]).toMatchObject({ raw: '@预期', processorId: 'expectation' })
    const duplicate = await request(allowed[1]!, { method: 'POST', headers, body: JSON.stringify(input) })
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toMatchObject({ status: 'duplicate', anchor: savedBody.anchor, path: savedBody.path, clientRequestId: input.clientRequestId })
    await trigger.drain(); await runtime.drain()
    expect(await records.listRuns()).toEqual(runs)

    const revisedText = '@预期 指数企稳且成交额连续两日回升。'
    const updated = await request(allowed[2]!, { method: 'POST', headers, body: JSON.stringify({ anchor: savedBody.anchor, market: input.market, body: revisedText }) })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({ status: 'updated', anchor: savedBody.anchor, path: savedBody.path, warnings: [] })
    await trigger.drain(); await runtime.drain()
    const revisedRuns = await records.listRuns()
    expect(revisedRuns).toHaveLength(2)
    const revised = revisedRuns.find(run => run.runId !== first.runId)!
    const [revisedSource] = await readDocumentSources(dataRoot, savedBody.path)
    expect(revisedSource!.body).toBe(revisedText)
    expect(revisedSource!.sourceRevision).not.toBe(source!.sourceRevision)
    expect(revised).toMatchObject({ sourceSnapshot: revisedSource, sourceRevision: revisedSource!.sourceRevision, executionState: 'waiting', waitingReason: 'capability', applicability: 'current', result: null, attempts: [] })
    expect(revised.inputRevision).not.toBe(first.inputRevision)
    expect(await records.readRun(first.runId)).toMatchObject({ executionState: 'canceled', waitingReason: null, applicability: 'sourceChanged', sourceSnapshot: source, result: null, attempts: [] })

    const bytesBeforeFence = await readFile(savedBody.path)
    const fenced = await request(allowed[2]!, { method: 'POST', headers: { ...headers, origin: 'http://untrusted.invalid' }, body: JSON.stringify({ anchor: savedBody.anchor, market: input.market, body: '@预期 不应保存' }) })
    expect(fenced.status).toBe(403)
    expect((await fenced.json()).error).toBe('FORBIDDEN')
    expect(await readFile(savedBody.path)).toEqual(bytesBeforeFence)
    expect(await records.listRuns()).toEqual(revisedRuns)

    const deleted = await request(allowed[3]!, { method: 'POST', headers, body: JSON.stringify({ anchor: savedBody.anchor, market: input.market }) })
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ status: 'deleted', anchor: savedBody.anchor, path: savedBody.path, warnings: [] })
    await trigger.drain(); await runtime.drain()
    expect(await readDocumentSources(dataRoot, savedBody.path)).toEqual([])
    expect(await records.listRuns()).toHaveLength(2)
    expect(await records.readRun(first.runId)).toMatchObject({ executionState: 'canceled', applicability: 'sourceChanged', result: null })
    expect(await records.readRun(revised.runId)).toMatchObject({ executionState: 'canceled', waitingReason: null, applicability: 'sourceRemoved', sourceSnapshot: revisedSource, result: null, attempts: [] })
    expect(await runtime.health()).toMatchObject({ enabled: true, agentAttemptsToday: 0, capabilities: { jobs: false, agentFactory: false }, waitingCounts: {} })
    expect(dataCalls.limitCalls).toEqual([])
    expect(dataCalls.conceptCalls).toEqual([])
    expect(dataCalls.quoteCalls).toEqual([])
    expect(requests).toEqual([
      { method: 'GET', path: allowed[0], cookie: undefined, rejection: 401 },
      ...[allowed[1], allowed[1], allowed[2]].map(path => ({ method: 'POST', path, cookie: undefined, rejection: 401 })),
      { method: 'POST', path: allowed[2], cookie: undefined, rejection: 403 },
      { method: 'POST', path: allowed[3], cookie: undefined, rejection: 401 },
    ])
    expect(requests.some(req => req.path.includes('/processors/'))).toBe(false)
    expect(errors).toEqual([])
  } finally {
    if (server?.listening) await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done()))
    await trigger?.dispose()
    await runtime?.dispose()
    handler?.dispose?.()
    await ctx?.fiber.dispose()
    const safe = resolve(root)
    if (!safe.startsWith(resolve(tmpdir()) + sep) || !safe.includes('review-event-source-')) throw new Error('UNSAFE_EVENT_SOURCE_TEST_CLEANUP')
    await rm(safe, { recursive: true, force: true })
  }
}, 20_000)
