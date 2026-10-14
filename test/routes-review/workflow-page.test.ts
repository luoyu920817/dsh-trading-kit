import { expect, it } from 'vitest'
import { createWorkflowPageHandler, WORKFLOW_PAGE_PATH } from '../../src/routes/workflow-page.ts'
import { makeReq, makeRes } from './helpers.ts'
import { createServer, type ServerResponse } from 'node:http'
import { runInNewContext } from 'node:vm'
import { WORKFLOW_PAGE_HTML } from '../../src/client/processors/page.ts'

it('独立管理页面只接受认证GET，不沿旧复盘页免签读取', () => {
  const handler = createWorkflowPageHandler(req => req.headers.cookie === 'dsh-auth=ok' ? undefined : 401)
  const rejected = makeRes()
  handler(makeReq({ url: WORKFLOW_PAGE_PATH }), rejected.res)
  expect(rejected.rec.status).toBe(401)
  expect(rejected.rec.body).not.toContain('id="runs"')
  const allowed = makeRes()
  handler(makeReq({ url: WORKFLOW_PAGE_PATH, headers: { cookie: 'dsh-auth=ok' } }), allowed.res)
  expect(allowed.rec.status).toBe(200)
  expect(allowed.rec.body).toContain('id="runs"')
  expect(allowed.rec.body).toContain('textContent')
  expect(allowed.rec.body).not.toMatch(/innerHTML|\.\.\.\s*|\?\.|\?\?|\basync\b|\bawait\b/)
  const denied = makeRes()
  createWorkflowPageHandler(() => 403)(makeReq({ url: WORKFLOW_PAGE_PATH }), denied.res)
  expect(denied.rec.status).toBe(403)
})

it('管理HTML自身不包含私有参数，不因读取页面自动重扫或重跑', () => {
  const result = makeRes()
  createWorkflowPageHandler(() => undefined)(makeReq({ url: WORKFLOW_PAGE_PATH }), result.res)
  expect(result.rec.body).toContain('credentials: \'same-origin\'')
  expect(result.rec.body).toContain('pagehide')
  expect(result.rec.body).toContain('记录版本已变化')
  expect(result.rec.body).not.toMatch(/writeKey|parentAgent|seed|setInterval/)
})

/**
 * 使用真实HTTP和实际管理脚本，页面DOM只承载可观察文本与点击。
 * 业务逻辑: 服务端显式释放响应，Promise完成信号驱动测试，无sleep或mock。
 * 关键判断: 所有出站请求只能到本次本地服务器；页面入口真实Cookie认证。
 * 异常处理: 关闭时先终止listener再释放连接与页面请求。
 * 参数: 无。返回: 请求队列、DOM、页面生命周期和响应推进函数。
 */
async function workflowPage(hash = '') {
  class Element {
    value = ''; checked = false; disabled = false; hidden = false; type = ''; className = ''
    private text = ''
    children: Element[] = []; listeners: Record<string, () => void> = {}
    /** 业务逻辑: 读取DOM纯文本。关键判断: 无HTML解析。异常处理: 无。参数: 无。返回: 文本。 */
    get textContent() { return this.text }
    /** 业务逻辑: 纯文本替换时清除子节点。关键判断: 沿浏览器DOM语义。异常处理: 无。参数: value。返回: 无。 */
    set textContent(value: string) { this.text = value; this.children = [] }
    /** 业务逻辑: 添加DOM子节点。关键判断: 保留节点身份。异常处理: 无。参数: child。返回: 子节点。 */
    appendChild(child: Element) { this.children.push(child); return child }
    /** 业务逻辑: 保存交互入口。关键判断: 同名覆盖。异常处理: 无。参数: name和fn。返回: 无。 */
    addEventListener(name: string, fn: () => void) { this.listeners[name] = fn }
    /** 业务逻辑: 接受无关呈现属性。关键判断: 不模拟业务API。异常处理: 无。参数: 无。返回: 无。 */
    setAttribute() {}
  }
  const elements = new Map<string, Element>()
  /** 业务逻辑: 取得唯一控件。关键判断: 同ID同身份。异常处理: 首次建立空控件。参数: id。返回: DOM。 */
  function byId(id: string) { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)! }
  const queue: Array<{ url: URL; res: ServerResponse; body: string }> = []
  let notify: (() => void) | undefined
  const handler = createWorkflowPageHandler(req => req.headers.cookie === 'dsh-auth=ok' ? undefined : 401)
  const server = createServer((req, res) => {
    if (req.url === WORKFLOW_PAGE_PATH) { handler(req, res); return }
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => { queue.push({ url: new URL(req.url!, 'http://localhost'), res, body }); notify?.(); notify = undefined })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const denied = await fetch(origin + WORKFLOW_PAGE_PATH)
  expect(denied.status).toBe(401)
  const served = await fetch(origin + WORKFLOW_PAGE_PATH, { headers: { cookie: 'dsh-auth=ok' } })
  expect(served.status).toBe(200)
  const html = await served.text()
  expect(html).toBe(WORKFLOW_PAGE_HTML)
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!
  const windowEvents: Record<string, () => void> = {}
  const documentEvents: Record<string, () => void> = {}
  const document = { hidden: false, getElementById: byId, createElement: () => new Element(),
    /** 业务逻辑: 保存页面可见性入口。关键判断: 不主动触发。异常处理: 无。参数: name/fn。返回: 无。 */
    addEventListener(name: string, fn: () => void) { documentEvents[name] = fn },
  }
  const outbound: Array<{ path: string; options: RequestInit }> = []
  const completed: Array<{ key: string; promise: Promise<void> }> = []
  const location = { hash }
  runInNewContext(script, { document, window: {
    location,
    /** 业务逻辑: 保存生命周期入口。关键判断: 不替代后台取消。异常处理: 无。参数: name/fn。返回: 无。 */
    addEventListener(name: string, fn: () => void) { windowEvents[name] = fn },
  }, AbortController, Promise,
    /** 业务逻辑: 真实HTTP运输页面相对请求。关键判断: 仅本地API和原始请求参数。异常处理: 完成或失败都释放信号。参数: path/options。返回: 真实Response。 */
    fetch(path: string, options: RequestInit) {
      expect(path.startsWith('/dsh-trader-kit/review/api/processors/') || path.startsWith('/dsh-trader-kit/review/api/basic-settings')).toBe(true)
      expect(options.credentials).toBe('same-origin')
      outbound.push({ path, options })
      let resolve!: () => void
      completed.push({ key: path, promise: new Promise<void>(done => { resolve = done }) })
      return fetch(origin + path, options).then(response => { const json = response.json.bind(response); response.json = () => json().finally(resolve); return response }, error => { resolve(); throw error })
    },
  })
  return { byId, outbound, document, documentEvents, windowEvents, location,
    /** 业务逻辑: 按路径取真实请求。关键判断: 消除并发到达顺序依赖。异常处理: 未到则等待请求事件。参数: suffix。返回: 请求。 */
    async next(suffix: string) { let index = queue.findIndex(item => item.url.pathname.endsWith(suffix)); while (index < 0) { await new Promise<void>(resolve => { notify = resolve }); index = queue.findIndex(item => item.url.pathname.endsWith(suffix)) } return queue.splice(index, 1)[0]! },
    /** 业务逻辑: 释放响应并推进实际Promise链。关键判断: 不等待时钟。异常处理: 失败状态同样完成解析。参数: req/body/status。返回: 完成。 */
    async respond(req: { url: URL; res: ServerResponse }, body: unknown, status = 200) { req.res.writeHead(status, { 'content-type': 'application/json' }); req.res.end(JSON.stringify(body)); const index = completed.findIndex(item => item.key === req.url.pathname + req.url.search); await completed.splice(index, 1)[0]!.promise; for (let i = 0; i < 15; i++) await Promise.resolve() },
    /** 业务逻辑: 释放测试连接。关键判断: 先pagehide与停止listener，再断开连接。异常处理: 无。参数: 无。返回: 关闭完成。 */
    async close() { windowEvents.pagehide!(); const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed },
  }
}

/** 业务逻辑: 用户进入设置后显式选择关键词页。关键判断: 初始基本页真实GET完成，不改业务脚本初始状态。异常处理: 接口失败由页面呈现。参数: 无。返回: 关键词页面载体。 */
async function keywordSettingsPage() {
  const page = await workflowPage('#settings')
  await page.respond(await page.next('/basic-settings'), { dataRoot: '', directories: [], processing: {}, tqLocalEnabled: false })
  page.outbound.splice(0)
  page.byId('settings-keywords-tab').listeners.click!()
  page.byId('keyword-config-tab').listeners.click!()
  return page
}

it('实际HTTP管理页启动只有GET，运行详情/日志/结果和retry CAS可用，409不盲重发', async () => {
  const page = await workflowPage()
  try {
    expect(page.outbound).toHaveLength(3)
    expect(page.outbound.every(call => call.options.method === 'GET')).toBe(true)
    await page.respond(await page.next('/health'), { enabled: true, agentAttemptsToday: 0, agentAttemptLimit: 5 })
    await page.respond(await page.next('/registry'), { settingsRevision: 3, workflows: [{ id: 'expectation', label: '预期', mentions: ['预期'], enabled: true }] })
    const run = { runId: 'run-1', workflowId: 'expectation', workflowLabel: '预期', executionState: 'failed', recordVersion: 4, inputRevision: 'input-1', source: { code: '600000' }, result: { data: { conclusion: '<b>不会变成HTML</b>' }, summary: '结果摘要' }, currentNativeJobId: 'job-1', attempts: [{ nativeJobId: 'job-1', sessionId: 'session-1' }] }
    const list = await page.next('/tasks'); expect(list.url.searchParams.get('limit')).toBe('50')
    await page.respond(list, { tasks: [run], nextCursor: 'cursor-1' })
    page.byId('runs').children[0]!.listeners.click!()
    await page.respond(await page.next('/task'), run)
    const events = await page.next('/events'); expect(events.url.searchParams.get('limit')).toBe('100')
    await page.respond(events, { events: [{ sequence: 1, message: 'Agent运行结束' }], nextSequence: 1, hasMore: true, omittedEventCount: 0 })
    expect(page.byId('result').textContent).toContain('<b>不会变成HTML</b>')
    expect(page.byId('run-detail').textContent).toContain('session-1')
    page.byId('events-next').listeners.click!()
    const nextEvents = await page.next('/events'); expect(nextEvents.url.searchParams.get('afterSequence')).toBe('1')
    await page.respond(nextEvents, { events: [], nextSequence: 1, hasMore: false, omittedEventCount: 0 })
    page.byId('retry').listeners.click!()
    const retry = await page.next('/retry'); expect(JSON.parse(retry.body)).toEqual({ runId: 'run-1', recordVersion: 4, expectedInputRevision: 'input-1' })
    await page.respond(retry, { message: 'CAS conflict' }, 409)
    expect(page.byId('message').textContent).toContain('记录版本已变化')
    expect(page.byId('retry').disabled).toBe(true)
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(1)
    const count = page.outbound.length
    page.document.hidden = true; page.documentEvents.visibilitychange!()
    page.byId('refresh').listeners.click!()
    expect(page.outbound).toHaveLength(count)
    expect(page.outbound.filter(call => call.path.endsWith('/cancel'))).toHaveLength(0)
  } finally { await page.close() }
})

it('右侧任务视图保留筛选和运行反馈，隐藏配置且不能触发保存或reload', async () => {
  const page = await workflowPage('#runs')
  try {
    expect(page.byId('settings-section').hidden).toBe(true)
    expect(page.byId('runs-section').hidden).toBe(false)
    expect(page.byId('rescan-section').hidden).toBe(false)
    await page.respond(await page.next('/health'), { enabled: false, capabilities: { jobs: true, agentFactory: false } })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [{ id: 'expectation', label: '预期整理', mentions: ['预期'], enabled: true }] })
    await page.respond(await page.next('/tasks'), { tasks: [], nextCursor: null })
    expect(page.byId('filter-workflow').children.map(child => child.value)).toEqual(['', 'expectation'])
    expect(page.byId('workflows').children).toHaveLength(0)
    page.byId('reload').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
  } finally { await page.close() }
})

it('设置视图只读取能力与注册表，不读取任务日志或重扫，并可显式保存工作流开关', async () => {
  const page = await keywordSettingsPage()
  try {
    expect(page.outbound).toHaveLength(2)
    expect(page.byId('settings-section').hidden).toBe(false)
    expect(page.byId('runs-section').hidden).toBe(true)
    expect(page.byId('detail-section').hidden).toBe(true)
    expect(page.byId('rescan-section').hidden).toBe(true)
    expect(WORKFLOW_PAGE_HTML).toContain('review.processing')
    await page.respond(await page.next('/health'), { enabled: false, capabilities: { jobs: true, agentFactory: false }, agentAttemptsToday: 0, agentAttemptLimit: 20 })
    expect(page.byId('health-summary').textContent).toContain('自动执行关闭')
    expect(page.byId('health-summary').textContent).toContain('宿主或模型能力不可用')
    await page.respond(await page.next('/registry'), { settingsRevision: 4, workflows: [{ id: 'expectation', label: '预期整理', mentions: ['预期'], enabled: true }] })
    page.byId('keyword-enabled').checked = false
    page.byId('keyword-save').listeners.click!()
    const settings = await page.next('/settings')
    expect(JSON.parse(settings.body)).toEqual({ settingsRevision: 4, workflows: [{ workflowId: 'expectation', enabled: false }] })
    await page.respond(settings, { settingsRevision: 5, workflows: [] })
    page.byId('filter').listeners.click!()
    page.byId('rescan').listeners.click!()
    expect(page.outbound.filter(call => /\/(tasks|task|events|rescan)(\?|$)/.test(call.path))).toHaveLength(0)
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(1)
  } finally { await page.close() }
})

it('hash切换只发当前视图GET并中止旧请求，隐藏后不会自动读取或执行', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: true, capabilities: { jobs: true, agentFactory: true } })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [] })
    const previous = page.outbound.slice()
    page.location.hash = '#runs'; page.windowEvents.hashchange!()
    expect(previous.every(call => call.options.signal!.aborted)).toBe(true)
    expect(page.outbound).toHaveLength(5)
    expect(page.outbound.every(call => call.options.method === 'GET')).toBe(true)
    expect(page.byId('settings-section').hidden).toBe(true)
    await page.respond(await page.next('/health'), { enabled: false, capabilities: { jobs: false, agentFactory: false } })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [] })
    await page.respond(await page.next('/tasks'), { tasks: [], nextCursor: null })
    page.document.hidden = true; page.documentEvents.visibilitychange!()
    page.location.hash = '#settings'; page.windowEvents.hashchange!()
    expect(page.outbound).toHaveLength(5)
    expect(page.byId('runs-section').hidden).toBe(true)
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
  } finally { await page.close() }
})

it('切换视图后旧写请求收尾不能解除新写操作锁', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [{ id: 'expectation', label: '预期', mentions: ['预期'], enabled: true }] })
    page.byId('keyword-save').listeners.click!()
    const previous = await page.next('/settings')
    page.location.hash = '#runs'; page.windowEvents.hashchange!()
    page.byId('rescan-from').value = '2026-10-10'
    page.byId('rescan-to').value = '2026-10-11'
    page.byId('rescan').listeners.click!()
    const current = await page.next('/rescan')
    await page.respond(previous, { settingsRevision: 2, workflows: [] })
    expect(page.byId('message').textContent).toBe('操作中')
    page.byId('rescan').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(2)
    await page.respond(current, { nextCursor: null, scanned: 0 })
    expect(page.byId('message').textContent).toBe('操作完成')
    page.byId('rescan').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(3)
  } finally { await page.close() }
})

it('旧运行操作返回时不覆盖用户后来选中的运行详情', async () => {
  const page = await workflowPage()
  try {
    await page.respond(await page.next('/health'), { enabled: true })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [] })
    const first = { runId: 'first', workflowId: 'expectation', executionState: 'failed', recordVersion: 1, inputRevision: 'first-input', result: { summary: '旧运行结果' } }
    const second = { runId: 'second', workflowId: 'expectation', executionState: 'failed', recordVersion: 1, inputRevision: 'second-input', result: { summary: '新选中运行结果' } }
    await page.respond(await page.next('/tasks'), { tasks: [first, second], nextCursor: null })
    page.byId('runs').children[0]!.listeners.click!()
    await page.respond(await page.next('/task'), first)
    await page.respond(await page.next('/events'), { events: [], nextSequence: 0, hasMore: false })
    page.byId('retry').listeners.click!(); const retry = await page.next('/retry')
    page.byId('runs').children[1]!.listeners.click!()
    await page.respond(await page.next('/task'), second)
    await page.respond(await page.next('/events'), { events: [], nextSequence: 0, hasMore: false })
    await page.respond(retry, { ...first, recordVersion: 2, executionState: 'queued' })
    expect(page.byId('run-detail').textContent).toContain('second')
    expect(page.byId('result').textContent).toContain('新选中运行结果')
  } finally { await page.close() }
})

it('retry实际返回登记身份时回读新运行，保留旧运行历史', async () => {
  const page = await workflowPage()
  try {
    await page.respond(await page.next('/health'), { enabled: true })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [] })
    const original = { runId: 'original', workflowId: 'expectation', executionState: 'failed', recordVersion: 1, inputRevision: 'input-1', result: null }
    await page.respond(await page.next('/tasks'), { tasks: [original], nextCursor: null })
    page.byId('runs').children[0]!.listeners.click!()
    await page.respond(await page.next('/task'), original)
    await page.respond(await page.next('/events'), { events: [], nextSequence: 0, hasMore: false })
    page.byId('retry').listeners.click!()
    await page.respond(await page.next('/retry'), { runId: 'new-run', disposition: 'registered' })
    expect(page.outbound.filter(call => call.path.includes('/task?runId=new-run'))).toHaveLength(1)
    await page.respond(await page.next('/task'), { ...original, runId: 'new-run', executionState: 'queued', recordVersion: 1 })
    await page.respond(await page.next('/events'), { events: [], nextSequence: 0, hasMore: false })
    await page.respond(await page.next('/tasks'), { tasks: [original, { ...original, runId: 'new-run', executionState: 'queued' }], nextCursor: null })
    expect(page.byId('run-detail').textContent).toContain('new-run')
    expect(page.byId('run-detail').textContent).toContain('queued')
  } finally { await page.close() }
})

it('等待能力时显示中文原因，并允许用户显式重新运行', async () => {
  const page = await workflowPage()
  try {
    await page.respond(await page.next('/health'), { enabled: true, agentAttemptsToday: 0, agentAttemptLimit: 5 })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [] })
    const run = { runId: 'waiting-run', workflowId: 'expectation', workflowLabel: '预期整理', executionState: 'waiting', waitingReason: 'capability', recordVersion: 2, inputRevision: 'input-1', source: { code: '600000' }, result: null }
    await page.respond(await page.next('/tasks'), { tasks: [run], nextCursor: null })
    expect(page.byId('runs').children[0]!.textContent).toContain('宿主或模型能力不可用')
    page.byId('runs').children[0]!.listeners.click!()
    await page.respond(await page.next('/task'), run)
    await page.respond(await page.next('/events'), { events: [], nextSequence: 0, hasMore: false, omittedEventCount: 0 })
    expect(page.byId('retry').disabled).toBe(false)
  } finally { await page.close() }
})

/** 业务逻辑: 提供公开注册表样本。关键判断: 两工作流加别名验证映射隔离，不含私有options。异常处理: 无。参数: 无。返回: DTO。 */
function keywordRegistry() { return { settingsRevision: 8, workflows: [{ id: 'expectation', label: '预期整理', mentions: ['预期', '展望'], enabled: true, definitionRevision: 'v1' }, { id: 'review', label: '复盘整理', mentions: ['复盘'], enabled: false, definitionRevision: 'v2' }] } }

it('关键词导航映射二级配置与历史，保存只提交选中工作流且历史分页固定workflowId', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), keywordRegistry())
    expect(page.byId('keyword-nav').children.map(child => child.textContent)).toEqual(['@预期', '@展望', '@复盘'])
    expect(page.byId('keyword-title').textContent).toBe('@预期')
    expect(page.byId('keyword-mapping').textContent).toContain('预期整理')
    expect(page.byId('keyword-advanced').textContent).toContain('"definitionRevision": "v1"')
    expect(page.byId('keyword-aliases').textContent).toContain('共享配置与执行历史')
    expect(page.outbound).toHaveLength(3)
    page.byId('keyword-nav').children[2]!.listeners.click!()
    expect(page.byId('keyword-title').textContent).toBe('@复盘')
    page.byId('keyword-enabled').checked = true; page.byId('keyword-save').listeners.click!()
    const save = await page.next('/settings')
    expect(JSON.parse(save.body)).toEqual({ settingsRevision: 8, workflows: [{ workflowId: 'review', enabled: true }] })
    await page.respond(save, keywordRegistry())
    page.byId('keyword-history-tab').listeners.click!()
    const first = await page.next('/tasks'); expect(first.url.searchParams.get('workflowId')).toBe('review')
    expect(page.byId('run-filters').hidden).toBe(true)
    await page.respond(first, { tasks: [], nextCursor: 'next-review' })
    page.byId('runs-next').listeners.click!()
    const next = await page.next('/tasks'); expect(next.url.searchParams.get('workflowId')).toBe('review'); expect(next.url.searchParams.get('cursor')).toBe('next-review')
    await page.respond(next, { tasks: [], nextCursor: null })
    page.byId('keyword-nav').children[1]!.listeners.click!()
    expect(page.byId('keyword-title').textContent).toBe('@展望')
    const aliasHistory = await page.next('/tasks'); expect(aliasHistory.url.searchParams.get('workflowId')).toBe('expectation'); expect(aliasHistory.url.searchParams.has('cursor')).toBe(false)
    await page.respond(aliasHistory, { tasks: [], nextCursor: null })
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(1)
  } finally { await page.close() }
})

it('设置历史只读，错误映射详情封闭，快速切换使旧列表与详情失效', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), keywordRegistry())
    page.byId('keyword-history-tab').listeners.click!()
    const staleList = await page.next('/tasks')
    page.byId('keyword-nav').children[2]!.listeners.click!()
    const currentList = await page.next('/tasks')
    const current = { runId: 'review-run', workflowId: 'review', executionState: 'succeeded', result: { summary: '复盘反馈' } }
    await page.respond(staleList, { tasks: [{ ...current, runId: 'stale-run', workflowId: 'expectation' }], nextCursor: 'stale-cursor' })
    await page.respond(currentList, { tasks: [current], nextCursor: null })
    expect(page.byId('runs').children).toHaveLength(1)
    page.byId('runs').children[0]!.listeners.click!()
    const wrongDetail = await page.next('/task')
    await page.respond(wrongDetail, { ...current, workflowId: 'expectation', result: { summary: '不允许显示' } })
    expect(page.byId('message').textContent).toContain('工作流不匹配')
    expect(page.byId('result').textContent).not.toContain('不允许显示')
    expect(page.outbound.filter(call => call.path.includes('/events'))).toHaveLength(0)
    page.byId('cancel').listeners.click!(); page.byId('retry').listeners.click!(); page.byId('rescan').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
    page.byId('runs').children[0]!.listeners.click!()
    const staleDetail = await page.next('/task')
    page.byId('keyword-nav').children[0]!.listeners.click!()
    await page.respond(staleDetail, current)
    await page.respond(await page.next('/tasks'), { tasks: [], nextCursor: null })
    expect(page.byId('result').textContent).not.toContain('复盘反馈')
    expect(page.byId('keyword-title').textContent).toBe('@预期')
    page.byId('keyword-config-tab').listeners.click!()
    const count = page.outbound.length; page.byId('filter').listeners.click!()
    expect(page.outbound).toHaveLength(count)
  } finally { await page.close() }
})

it('关键词切换隔离旧写收尾，新配置保存锁不会被旧请求解开', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), keywordRegistry())
    page.byId('keyword-save').listeners.click!(); const previous = await page.next('/settings')
    page.byId('keyword-nav').children[2]!.listeners.click!()
    page.byId('keyword-save').listeners.click!(); const current = await page.next('/settings')
    await page.respond(previous, keywordRegistry())
    expect(page.byId('message').textContent).toBe('操作中')
    page.byId('keyword-save').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(2)
    await page.respond(current, { message: 'conflict' }, 409)
    expect(page.byId('message').textContent).toContain('记录版本已变化')
    expect(page.byId('keyword-save').disabled).toBe(true)
  } finally { await page.close() }
})

it('空注册表与选中关键词被移除给出状态，不自动切换映射或读取历史', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [] })
    expect(page.byId('keyword-empty').textContent).toContain('暂无关键词')
    expect(page.byId('keyword-save').disabled).toBe(true)
    page.byId('keyword-history-tab').listeners.click!()
    expect(page.outbound).toHaveLength(2)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), keywordRegistry())
    expect(page.byId('keyword-title').textContent).toBe('@预期')
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), { settingsRevision: 9, workflows: [keywordRegistry().workflows[1]] })
    expect(page.byId('keyword-empty').textContent).toContain('已移除')
    expect(page.byId('keyword-save').disabled).toBe(true)
    expect(page.outbound.filter(call => call.path.includes('/tasks'))).toHaveLength(1)
  } finally { await page.close() }
})

it('关键词历史先核验详情再读日志，旧日志不能覆盖后来选中的关键词', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), keywordRegistry())
    page.byId('keyword-history-tab').listeners.click!()
    const run = { runId: 'expectation-run', workflowId: 'expectation', executionState: 'succeeded', result: { summary: '预期条件已整理', data: { condition: '成交额回升' } } }
    await page.respond(await page.next('/tasks'), { tasks: [run], nextCursor: null })
    page.byId('runs').children[0]!.listeners.click!()
    expect(page.outbound.filter(call => call.path.includes('/events'))).toHaveLength(0)
    await page.respond(await page.next('/task'), run)
    expect(page.byId('result-summary').textContent).toBe('预期条件已整理')
    expect(page.byId('run-actions').hidden).toBe(true)
    await page.respond(await page.next('/events'), { events: [{ occurredAt: '2026-10-12T05:00:00Z', sequence: 1, code: 'DONE', message: '预期整理完成' }], nextSequence: 1, hasMore: true })
    expect(page.byId('events').textContent).toContain('2026-10-12T05:00:00Z DONE 预期整理完成')
    page.byId('events-next').listeners.click!(); const oldEvents = await page.next('/events')
    page.byId('keyword-nav').children[2]!.listeners.click!()
    await page.respond(oldEvents, { events: [{ sequence: 1, message: '旧关键词日志' }], nextSequence: 1, hasMore: true })
    await page.respond(await page.next('/tasks'), { tasks: [], nextCursor: null })
    expect(page.byId('events').textContent).not.toContain('旧关键词日志')
    page.byId('events-next').listeners.click!()
    expect(page.outbound.filter(call => call.path.includes('/events'))).toHaveLength(2)
  } finally { await page.close() }
})

it('注册表读取失败封闭旧映射历史，隐藏再显示不自动请求且高级明细不暴露options', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), { ...keywordRegistry(), workflows: keywordRegistry().workflows.map(workflow => ({ ...workflow, options: { private: '不应显示此值' } })) })
    expect(page.byId('keyword-advanced').textContent).not.toContain('不应显示此值')
    page.byId('keyword-history-tab').listeners.click!()
    const run = { runId: 'inflight-run', workflowId: 'expectation', executionState: 'succeeded', result: { summary: '失效映射旧结果' } }
    await page.respond(await page.next('/tasks'), { tasks: [run], nextCursor: null })
    page.byId('runs').children[0]!.listeners.click!()
    const oldDetail = await page.next('/task')
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), { message: 'storage unavailable' }, 503)
    expect(page.byId('keyword-status').textContent).toContain('读取失败')
    expect(page.byId('keyword-save').disabled).toBe(true)
    expect(page.byId('runs-section').hidden).toBe(true)
    expect(page.byId('runs').children).toHaveLength(0)
    await page.respond(oldDetail, run)
    expect(page.byId('result').textContent).not.toContain('失效映射旧结果')
    expect(page.outbound.filter(call => call.path.includes('/events'))).toHaveLength(0)
    page.byId('keyword-history-tab').listeners.click!()
    expect(page.outbound.filter(call => call.path.includes('/tasks'))).toHaveLength(1)
    const count = page.outbound.length
    page.document.hidden = true; page.documentEvents.visibilitychange!()
    page.document.hidden = false; page.documentEvents.visibilitychange!()
    page.windowEvents.pageshow!()
    expect(page.outbound).toHaveLength(count)
  } finally { await page.close() }
})

it('基本设置默认显示当前目录与执行配置，仅同源GET且不读取历史', async () => {
  const page = await workflowPage('#settings')
  try {
    expect(page.byId('settings-basic-tab').className).toBe('selected')
    expect(page.byId('basic-section').hidden).toBe(false)
    expect(page.byId('settings-section').hidden).toBe(true)
    await page.respond(await page.next('/basic-settings'), { dataRoot: 'E:/finance', directories: [
      { id: 'stock', label: '标的目录', relativePath: 'DB/stock', absolutePath: 'E:/finance/DB/stock', status: 'active' },
      { id: 'patterns', label: '模式目录', relativePath: '交易系统/平常心/方法论/模式', absolutePath: 'E:/finance/交易系统/平常心/方法论/模式', status: 'reserved' },
      { id: 'review', label: '复盘目录', relativePath: 'DB/review/<YYYYMM>', absolutePath: 'E:/finance/DB/review/<YYYYMM>', status: 'active' },
      { id: 'processorRuns', label: '工作流记录目录', relativePath: 'agent/DB/temp/dsh-trader-kit/processors', absolutePath: 'E:/finance/agent/DB/temp/dsh-trader-kit/processors', status: 'active' },
      { id: 'agentSkills', label: '业务 Skill 目录', relativePath: 'agent/skills', absolutePath: 'E:/finance/agent/skills', status: 'active' },
    ], processing: { enabled: false, provider: 'provider-a', model: 'model-a', cwd: 'E:/finance', maxConcurrency: 2, agentAttemptLimit: 20, maxTokens: 4096, timeoutMs: 60000 }, tqLocalEnabled: false })
    expect(page.byId('basic-root').textContent).toBe('E:/finance')
    expect(page.byId('basic-directories').children.map(row => row.textContent)).toEqual([
      '标的目录 · DB/stock（已配置，未探测目录是否存在）',
      '模式目录 · 交易系统/平常心/方法论/模式（预留未接入）',
      '复盘目录 · DB/review/<YYYYMM>（已配置，未探测目录是否存在）',
      '工作流记录目录 · agent/DB/temp/dsh-trader-kit/processors（已配置，未探测目录是否存在）',
      '业务 Skill 目录 · agent/skills（已配置，未探测目录是否存在）',
    ])
    expect(page.byId('basic-processing').children.map(row => row.textContent).join('\n')).toContain('模型 · model-a')
    expect(page.outbound.map(call => call.path)).toEqual(['/dsh-trader-kit/review/api/basic-settings'])
    expect(page.outbound.every(call => call.options.method === 'GET')).toBe(true)
  } finally { await page.close() }
})

it('基础目录未配置与空模型如实呈现，刷新失败清除旧基础配置', async () => {
  const page = await workflowPage('#settings')
  try {
    await page.respond(await page.next('/basic-settings'), { dataRoot: '', directories: [{ id: 'stock', label: '标的目录', relativePath: 'DB/stock', absolutePath: null, status: 'active' }, { id: 'patterns', label: '模式目录', relativePath: '交易系统/平常心/方法论/模式', absolutePath: null, status: 'reserved' }], processing: { enabled: false, provider: '', model: '', cwd: '', maxConcurrency: 1, agentAttemptLimit: 0, maxTokens: 1024, timeoutMs: 1000 }, tqLocalEnabled: false })
    expect(page.byId('basic-root').textContent).toBe('未配置')
    expect(page.byId('basic-directories').children.map(row => row.textContent)).toEqual([
      '标的目录 · DB/stock（未配置数据根目录）',
      '模式目录 · 交易系统/平常心/方法论/模式（预留未接入）',
    ])
    expect(page.byId('basic-processing').children.map(row => row.textContent).join('\n')).toContain('模型 · 未配置')
    expect(page.byId('basic-processing').children.map(row => row.textContent).join('\n')).toContain('每日Agent激活上限 · 0')
    page.byId('reload').listeners.click!(); page.byId('keyword-save').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
    page.byId('refresh').listeners.click!()
    expect(page.byId('basic-content').hidden).toBe(true)
    await page.respond(await page.next('/basic-settings'), { message: '服务暂不可用' }, 503)
    expect(page.byId('basic-status').textContent).toContain('基础配置读取失败')
    expect(page.byId('basic-root').textContent).toBe('')
    expect(page.byId('basic-directories').children).toHaveLength(0)
    expect(page.byId('message').textContent).toBe('服务暂不可用')
    expect(page.outbound.every(call => call.path.endsWith('/basic-settings'))).toBe(true)
  } finally { await page.close() }
})

it('基础与关键词切换作废迟到配置和错误，隐藏恢复只等待手动读取', async () => {
  const page = await workflowPage('#settings')
  try {
    const oldBasic = await page.next('/basic-settings')
    page.byId('settings-keywords-tab').listeners.click!()
    expect(page.outbound[0]!.options.signal!.aborted).toBe(true)
    expect(page.byId('basic-section').hidden).toBe(true)
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), { settingsRevision: 1, workflows: [{ id: 'expectation', label: '预期整理', mentions: ['预期'], enabled: true }] })
    await page.respond(oldBasic, { message: '迟到的基础错误' }, 503)
    expect(page.byId('message').textContent).not.toContain('迟到')
    page.byId('keyword-history-tab').listeners.click!()
    const oldHistory = await page.next('/tasks')
    page.byId('settings-basic-tab').listeners.click!()
    await page.respond(await page.next('/basic-settings'), { dataRoot: 'E:/new-root', directories: [], processing: {}, tqLocalEnabled: false })
    await page.respond(oldHistory, { tasks: [{ runId: 'old', workflowId: 'expectation', executionState: 'succeeded' }], nextCursor: null })
    expect(page.byId('runs').children).toHaveLength(0)
    expect(page.byId('basic-root').textContent).toBe('E:/new-root')
    expect(page.byId('service-section').hidden).toBe(true)
    const count = page.outbound.length
    page.document.hidden = true; page.documentEvents.visibilitychange!()
    page.document.hidden = false; page.documentEvents.visibilitychange!()
    expect(page.outbound).toHaveLength(count)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/basic-settings'), { dataRoot: 'E:/refreshed', directories: [], processing: {}, tqLocalEnabled: false })
    expect(page.byId('basic-root').textContent).toBe('E:/refreshed')
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
  } finally { await page.close() }
})

/** 业务逻辑: 提供可编辑目录快照。关键判断: 仅白名单目录及CAS版本。异常处理: 覆盖字段构造缺能力状态。参数: editing。返回: 公开DTO。 */
function editableBasic(editing = { available: true, revision: 'config-1', unavailableReason: '' }) {
  return { dataRoot: 'E:/finance', directories: [{ id: 'stock', label: '标的目录', relativePath: 'DB/stock', status: 'active' }, { id: 'patterns', label: '模式目录', relativePath: '方法论/模式', status: 'reserved' }], processing: {}, tqLocalEnabled: false, editing }
}

it('目录按钮显式选择并保持取消草稿，保存只携带相对路径与CAS版本且不自动刷新', async () => {
  const page = await workflowPage('#settings')
  try {
    await page.respond(await page.next('/basic-settings'), editableBasic())
    expect(page.byId('basic-stock-path').value).toBe('DB/stock')
    expect(page.byId('basic-patterns-path').value).toBe('方法论/模式')
    expect(page.byId('basic-save').disabled).toBe(false)
    expect(WORKFLOW_PAGE_HTML).toContain('正在运行的工作流会取消并清理')
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
    page.byId('basic-stock-path').value = 'DB/manual'
    page.byId('basic-stock-choose').listeners.click!()
    const stock = await page.next('/choose-directory')
    expect(JSON.parse(stock.body)).toEqual({ directory: 'stock' })
    expect(page.byId('basic-save').disabled).toBe(true)
    page.byId('basic-save').listeners.click!()
    await page.respond(stock, { directory: 'stock', relativePath: null })
    expect(page.byId('basic-stock-path').value).toBe('DB/manual')
    page.byId('basic-patterns-choose').listeners.click!()
    const patterns = await page.next('/choose-directory')
    expect(JSON.parse(patterns.body)).toEqual({ directory: 'patterns' })
    await page.respond(patterns, { directory: 'patterns', relativePath: '研究/模式' })
    expect(page.byId('basic-patterns-path').value).toBe('研究/模式')
    page.byId('basic-save').listeners.click!()
    const save = await page.next('/save')
    expect(JSON.parse(save.body)).toEqual({ revision: 'config-1', directories: { stock: 'DB/manual', patterns: '研究/模式' } })
    await page.respond(save, { saved: true })
    expect(page.byId('message').textContent).toContain('已保存并应用')
    expect(page.byId('message').textContent).toContain('刷新')
    expect(page.byId('basic-save').disabled).toBe(true)
    expect(page.outbound.filter(call => call.options.method === 'GET')).toHaveLength(1)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/basic-settings'), { ...editableBasic(), directories: [{ id: 'stock', label: '标的目录', relativePath: 'DB/applied', status: 'active' }, { id: 'patterns', label: '模式目录', relativePath: '研究/模式', status: 'reserved' }] })
    expect(page.byId('basic-stock-path').value).toBe('DB/applied')
    expect(page.byId('basic-save').disabled).toBe(false)
  } finally { await page.close() }
})

it('目录缺编辑能力、根目录或版本时禁用并明确原因，选择失败保留草稿', async () => {
  const page = await workflowPage('#settings')
  try {
    await page.respond(await page.next('/basic-settings'), editableBasic({ available: false, revision: 'config-1', unavailableReason: '宿主文件夹选择器不可用' }))
    expect(page.byId('basic-editing-status').textContent).toContain('宿主文件夹选择器不可用')
    expect(page.byId('basic-stock-path').disabled).toBe(true)
    page.byId('basic-stock-choose').listeners.click!(); page.byId('basic-save').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/basic-settings'), { ...editableBasic(), dataRoot: '' })
    expect(page.byId('basic-editing-status').textContent).toContain('数据根目录')
    expect(page.byId('basic-save').disabled).toBe(true)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/basic-settings'), editableBasic({ available: true, revision: '', unavailableReason: '' }))
    expect(page.byId('basic-save').disabled).toBe(true)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/basic-settings'), editableBasic())
    page.byId('basic-stock-path').value = 'DB/draft'
    page.byId('basic-stock-choose').listeners.click!()
    await page.respond(await page.next('/choose-directory'), { message: '所选文件夹必须位于数据根目录内' }, 400)
    expect(page.byId('basic-stock-path').value).toBe('DB/draft')
    expect(page.byId('message').textContent).toContain('数据根目录内')
    expect(page.byId('basic-save').disabled).toBe(false)
    page.byId('basic-save').listeners.click!()
    await page.respond(await page.next('/save'), { message: '配置已变更' }, 409)
    expect(page.byId('basic-save').disabled).toBe(true)
    expect(page.byId('basic-stock-path').value).toBe('DB/draft')
    expect(page.byId('message').textContent).toContain('刷新')
  } finally { await page.close() }
})

it('目录写操作切换与隐藏作废迟到成功和失败，不解除新操作锁或污染新视图', async () => {
  const page = await workflowPage('#settings')
  try {
    await page.respond(await page.next('/basic-settings'), editableBasic())
    page.byId('basic-stock-path').value = 'DB/unsaved'
    page.byId('basic-save').listeners.click!()
    const oldSave = await page.next('/save')
    page.byId('settings-keywords-tab').listeners.click!()
    await page.respond(await page.next('/health'), { enabled: false })
    await page.respond(await page.next('/registry'), keywordRegistry())
    page.byId('keyword-save').listeners.click!()
    const newSave = await page.next('/settings')
    await page.respond(oldSave, { saved: true })
    expect(page.byId('keyword-save').disabled).toBe(true)
    expect(page.byId('message').textContent).not.toContain('已保存并应用')
    await page.respond(newSave, keywordRegistry())
    page.byId('settings-basic-tab').listeners.click!()
    await page.respond(await page.next('/basic-settings'), editableBasic())
    expect(page.byId('basic-stock-path').value).toBe('DB/stock')
    page.byId('basic-stock-choose').listeners.click!()
    const oldChooser = await page.next('/choose-directory')
    page.document.hidden = true; page.documentEvents.visibilitychange!()
    page.document.hidden = false; page.documentEvents.visibilitychange!()
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/basic-settings'), editableBasic())
    page.byId('basic-patterns-choose').listeners.click!()
    const newChooser = await page.next('/choose-directory')
    await page.respond(oldChooser, { message: '迟到选择失败' }, 400)
    expect(page.byId('basic-save').disabled).toBe(true)
    expect(page.byId('message').textContent).not.toContain('迟到')
    await page.respond(newChooser, { directory: 'patterns', relativePath: null })
    expect(page.byId('basic-save').disabled).toBe(false)
    expect(page.byId('basic-patterns-path').value).toBe('方法论/模式')
  } finally { await page.close() }
})


it('关键词默认任务记录包含等待任务，突出自动执行关闭与本地来源时间', async () => {
  const page = await workflowPage('#settings')
  try {
    await page.respond(await page.next('/basic-settings'), editableBasic())
    page.byId('settings-keywords-tab').listeners.click!()
    await page.respond(await page.next('/health'), { enabled: false, capabilities: { jobs: true, agentFactory: true } })
    await page.respond(await page.next('/registry'), keywordRegistry())
    expect(page.byId('keyword-history-tab').className).toBe('selected')
    const tasks = await page.next('/tasks')
    expect(tasks.url.searchParams.get('workflowId')).toBe('expectation')
    expect(tasks.url.searchParams.has('state')).toBe(false)
    await page.respond(tasks, { tasks: [{ runId: 'private-id', workflowId: 'expectation', workflowLabel: '预期整理', executionState: 'waiting', waitingReason: 'workflowDisabled', source: { market: 'sh', code: '000001', tradeDate: '2026-10-13' }, createdAt: '2026-10-13T12:23:49Z' }], nextCursor: null })
    const title = page.byId('runs').children[0]!.textContent
    expect(title).toContain('待执行')
    expect(title).toContain('自动执行未开启')
    expect(title).toContain('sh000001')
    expect(title).toContain('2026-10-13 20:23:49')
    expect(title).not.toContain('private-id')
    expect(page.outbound.every(call => call.options.method === 'GET')).toBe(true)
  } finally { await page.close() }
})

it('执行配置独立读取，缺模型如实显示，显式保存仅提交四项和CAS', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: false, capabilities: { jobs: true, agentFactory: true } })
    await page.respond(await page.next('/registry'), keywordRegistry())
    await page.respond(await page.next('/basic-settings'), { ...editableBasic(), processing: { enabled: false, provider: '', model: '', cwd: '' }, executionEditing: { available: true, revision: 'execution-1' } })
    expect(page.byId('execution-status').textContent).toContain('模型服务标识、模型名称、工作目录未配置')
    expect(page.byId('execution-save').disabled).toBe(false)
    page.byId('execution-enabled').checked = true
    page.byId('execution-provider').value = 'local-provider'
    page.byId('execution-model').value = 'actual-model'
    page.byId('execution-cwd').value = 'E:/finance'
    expect(page.outbound.every(call => call.options.method === 'GET')).toBe(true)
    page.byId('execution-save').listeners.click!()
    const save = await page.next('/save-execution')
    expect(JSON.parse(save.body)).toEqual({ revision: 'execution-1', processing: { enabled: true, provider: 'local-provider', model: 'actual-model', cwd: 'E:/finance' } })
    await page.respond(save, { saved: true })
    expect(page.byId('execution-save').disabled).toBe(true)
    expect(page.byId('message').textContent).toContain('重新加载插件')
    expect(page.byId('message').textContent).toContain('已有等待任务')
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(1)
  } finally { await page.close() }
})


it('执行设置跨关键词迟到响应隔离，旧宿主缺编辑接口只读且CAS冲突禁写', async () => {
  const page = await keywordSettingsPage()
  try {
    await page.respond(await page.next('/health'), { enabled: true, capabilities: { jobs: true, agentFactory: true } })
    await page.respond(await page.next('/registry'), keywordRegistry())
    const old = await page.next('/basic-settings')
    page.byId('keyword-nav').children[2]!.listeners.click!()
    const current = await page.next('/basic-settings')
    await page.respond(old, { ...editableBasic(), processing: { enabled: true, provider: 'old', model: 'old', cwd: 'E:/old' }, executionEditing: { available: true, revision: 'old' } })
    expect(page.byId('execution-provider').value).toBe('')
    await page.respond(current, { ...editableBasic(), processing: { enabled: true, provider: 'provider', model: 'model', cwd: 'E:/finance' } })
    expect(page.byId('execution-status').textContent).toContain('实际可用性需执行验证')
    expect(page.byId('execution-status').textContent).toContain('编辑能力不可用')
    expect(page.byId('execution-save').disabled).toBe(true)
    page.byId('execution-save').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(0)
    page.byId('refresh').listeners.click!()
    await page.respond(await page.next('/health'), { enabled: true })
    await page.respond(await page.next('/registry'), keywordRegistry())
    await page.respond(await page.next('/basic-settings'), { ...editableBasic(), processing: { enabled: true, provider: 'provider', model: 'model', cwd: 'E:/finance' }, executionEditing: { available: true, revision: 'current' } })
    page.byId('execution-save').listeners.click!()
    await page.respond(await page.next('/save-execution'), { message: 'configuration changed' }, 409)
    expect(page.byId('execution-save').disabled).toBe(true)
    expect(page.byId('execution-status').textContent).toContain('配置版本已变化')
    page.byId('execution-save').listeners.click!()
    expect(page.outbound.filter(call => call.options.method === 'POST')).toHaveLength(1)
    expect(page.byId('execution-provider').value).toBe('provider')
  } finally { await page.close() }
})

it('全局执行开启时等待原因为工作流停用，能力等待不冒充模型就绪', async () => {
  const page = await workflowPage('#runs')
  try {
    await page.respond(await page.next('/health'), { enabled: true, capabilities: { jobs: true, agentFactory: true } })
    await page.respond(await page.next('/registry'), keywordRegistry())
    await page.respond(await page.next('/tasks'), { tasks: [
      { runId: 'disabled', workflowId: 'review', executionState: 'waiting', waitingReason: 'workflowDisabled' },
      { runId: 'model', workflowId: 'expectation', executionState: 'waiting', waitingReason: 'capability' },
    ], nextCursor: null })
    expect(page.byId('runs').children[0]!.textContent).toContain('此关键词工作流已停用')
    expect(page.byId('runs').children[1]!.textContent).toContain('宿主或模型能力不可用')
    expect(page.byId('health-summary').textContent).not.toContain('模型已就绪')
    expect(WORKFLOW_PAGE_HTML).toContain('<details><summary>高级诊断与预算明细')
    expect(WORKFLOW_PAGE_HTML).not.toContain('<details open')
    expect(page.outbound.every(call => call.options.method === 'GET')).toBe(true)
  } finally { await page.close() }
})
