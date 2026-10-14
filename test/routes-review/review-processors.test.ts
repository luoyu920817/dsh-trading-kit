import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import type { ProcessingService } from '../../src/review/processors/types.ts'
import type { TraderKitHttpRequest, TraderKitHttpResponse } from '../../src/context-types.ts'
import { createReviewProcessorsHandler, REVIEW_PROCESSORS_PATH } from '../../src/routes/review-processors.ts'

it('宿主prefix注册不带尾斜杠，满足p或p/子路径的路由边界契约', () => {
  const source = readFileSync(new URL('../../src/routes/review-processors.ts', import.meta.url), 'utf8')
  const expression = source.match(/kind:\s*'prefix',\s*path:\s*([^,}]+)/)?.[1]
  expect(expression).toBeDefined()
  const prefix = new Script(expression!).runInNewContext({ REVIEW_PROCESSORS_PATH }) as string
  expect(prefix.startsWith('/')).toBe(true)
  expect(prefix.endsWith('/')).toBe(false)
  expect((REVIEW_PROCESSORS_PATH + '/health').startsWith(prefix + '/')).toBe(true)
})

/** 业务逻辑: 验证请求前置拒绝；关键判断: service不提供任何假实现；异常处理: 错误在HTTP层封闭。参数: 请求。返回: 已记录响应。 */
async function rejected(url: string, method = 'GET', body?: string, headers: Record<string, string> = { cookie: 'dsh-auth=ok' }) {
  const handler = createReviewProcessorsHandler({ service: {} as ProcessingService, writeKey: 'fixed-key', requestRejection: req => req.headers.fence === '1' ? 403 : req.headers.cookie === 'dsh-auth=ok' ? undefined : 401 })
  return request(handler, url, method, body, headers)
}

/** 业务逻辑: 将HTTP形状对象传真实handler；关键判断: 无网络/服务替身；异常处理: 响应必须可解析。参数: handler/请求事实。返回: JSON响应。 */
async function request(handler: ReturnType<typeof createReviewProcessorsHandler>, url: string, method = 'GET', body?: string, headers: Record<string, string> = { cookie: 'dsh-auth=ok' }) {
  const rec = { status: 0, headers: {} as Record<string, string>, body: '' }
  const req: TraderKitHttpRequest = {
    url: REVIEW_PROCESSORS_PATH + url, method, headers,
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield body },
  }
  const res: TraderKitHttpResponse = {
    statusCode: 0,
    writeHead(status, responseHeaders) { rec.status = status; rec.headers = responseHeaders ?? {} },
    end(value) { rec.body = typeof value === 'string' ? value : String(value ?? '') },
  }
  await handler(req, res)
  return { ...rec, json: JSON.parse(rec.body) }
}

it('新敏感GET要求cookie，writeKey不能救援', async () => {
  const response = await rejected('/health', 'GET', undefined, { 'x-write-key': 'fixed-key' })
  expect(response.status).toBe(401)
  expect(response.json).toEqual({ error: 'UNAUTHENTICATED', message: '需要宿主登录凭据' })
})

it('真实临时runtime的HTTP查询只读，写键取消和CAS保持持久历史', async () => {
  const root = await mkdtemp(join(tmpdir(), 'processor-api-'))
  let runtime: import('../../src/review/processors/runtime.ts').WorkflowRuntime | undefined
  try {
    const { appendCard } = await import('../../src/review/store.ts')
    const { readDocumentSources } = await import('../../src/review/processors/source.ts')
    const { createWorkflowRegistry } = await import('../../src/review/processors/registry.ts')
    const { expectationWorkflow } = await import('../../src/review/processors/expectation.ts')
    const { createWorkflowRecordStore } = await import('../../src/review/processors/records.ts')
    const { createWorkflowRuntime } = await import('../../src/review/processors/runtime.ts')
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@预期 题材有后续催化', clientRequestId: 'api-real-1' })
    const [source] = await readDocumentSources(root, created.path)
    const implementations = new Map([[expectationWorkflow.id, expectationWorkflow]])
    const registry = createWorkflowRegistry(implementations, { schemaVersion: 1, workflows: [{ id: 'expectation', label: '预期', mentions: ['预期'], enabled: true, implementationId: expectationWorkflow.id, options: {} }] })
    const records = createWorkflowRecordStore(root)
    runtime = createWorkflowRuntime({ dataRoot: root, implementations, registry, records, jobs: null, enabled: true, maxConcurrency: 1, agentAttemptLimit: 2 })
    const [registered] = await runtime.registerSource(source)
    await runtime.drain()
    const handler = createReviewProcessorsHandler({ service: runtime, writeKey: 'fixed-key', requestRejection: req => req.headers.cookie === 'dsh-auth=ok' ? undefined : 401 })
    const before = await records.listRuns()
    const run = before[0]!
    const health = await request(handler, '/health')
    expect(health.status).toBe(200)
    expect(health.json.agentAttemptsToday).toBe(0)
    const tasks = await request(handler, '/tasks?workflowId=expectation&limit=20')
    expect(tasks.status).toBe(200)
    expect(tasks.json.tasks).toHaveLength(1)
    expect(tasks.json.tasks[0].runId).toBe(registered!.runId)
    expect(tasks.json.tasks[0].waitingReason).toBe('capability')
    expect(JSON.stringify(tasks.json)).not.toContain('@预期 题材有后续催化')
    expect((await request(handler, '/task?runId=' + run.runId)).json).toEqual(tasks.json.tasks[0])
    expect((await request(handler, '/events?runId=' + run.runId + '&afterSequence=0&limit=100')).json.events.length).toBeGreaterThan(0)
    expect((await request(handler, `/cards?code=600000&date=2026-10-09${source.market ? '&market=' + source.market : ''}`)).json).toHaveLength(1)
    expect(await records.listRuns()).toEqual(before)
    expect((await request(handler, '/health', 'GET', undefined, { 'x-write-key': 'fixed-key' })).status).toBe(401)
    const mutationHeaders = { 'x-write-key': 'fixed-key', 'content-type': 'application/json' }
    const stale = await request(handler, '/cancel', 'POST', JSON.stringify({ runId: run.runId, recordVersion: run.recordVersion + 1, reason: '取消' }), mutationHeaders)
    expect(stale.status).toBe(409)
    expect(stale.json.error).toBe('CONFLICT')
    expect(await records.listRuns()).toEqual(before)
    const canceled = await request(handler, '/cancel', 'POST', JSON.stringify({ runId: run.runId, recordVersion: run.recordVersion, reason: '用户取消' }), mutationHeaders)
    expect(canceled.status).toBe(200)
    expect(canceled.json.executionState).toBe('canceled')
    const retried = await request(handler, '/retry', 'POST', JSON.stringify({ runId: run.runId, recordVersion: canceled.json.recordVersion, expectedInputRevision: run.inputRevision }), mutationHeaders)
    expect(retried.status).toBe(200)
    expect(retried.json.runId).not.toBe(run.runId)
    expect((await records.readRun(run.runId))?.executionState).toBe('canceled')
    expect((await request(handler, '/task?runId=absent')).status).toBe(404)
  } finally {
    await runtime?.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
it('Host/Origin 403不被正确writeKey救援', async () => {
  const response = await rejected('/reload', 'POST', '{}', { fence: '1', 'x-write-key': 'fixed-key', 'content-type': 'application/json' })
  expect(response.status).toBe(403)
  expect(response.json.error).toBe('FORBIDDEN')
})
it.each(['/tasks?limit=51', '/tasks?limit=1&limit=2', '/tasks?unexpected=1', '/tasks?state=finished', '/tasks?tradeDate=2026-02-30', '/tasks?tradeDate=2026-00-01', '/events?runId=run-1&afterSequence=-1', '/task?runId=../x', '/cards?code=000001&market=xx&date=2026-10-11'])('非法查询 %s 在调用服务前拒绝', async url => {
  const response = await rejected(url)
  expect(response.status).toBe(400)
  expect(response.json.error).toBe('INVALID_REQUEST')
})
it.each(['{"runId":"r","recordVersion":1,"reason":"x","token":"secret"}', '{"runId":"r","recordVersion":0,"reason":"x"}', '{"runId":"r","recordVersion":true,"reason":"x"}', '{"runId":"r","recordVersion":"1","reason":"x"}', '[]', '{'])('非法JSON/权限字段先拒绝 %s', async body => {
  const response = await rejected('/cancel', 'POST', body, { 'x-write-key': 'fixed-key', 'content-type': 'application/json' })
  expect(response.status).toBe(400)
  expect(response.json.error).toBe('INVALID_REQUEST')
})
it('设置JSON不接受非有限数值，日期不接受无效月份', async () => {
  const response = await rejected('/settings', 'POST', '{"settingsRevision":1,"workflows":[{"workflowId":"expectation","options":{"number":1e999}}]}', { 'x-write-key': 'fixed-key', 'content-type': 'application/json' })
  expect(response.status).toBe(400)
  expect(response.json.error).toBe('INVALID_REQUEST')
})
it('body最大64KiB，未知错误不泄漏路径或正文', async () => {
  const response = await rejected('/cancel', 'POST', 'x'.repeat(65_537), { 'x-write-key': 'fixed-key', 'content-type': 'application/json' })
  expect(response.status).toBe(413)
  expect(response.json).toEqual({ error: 'BODY_TOO_LARGE', message: '请求正文超过限制' })
})
