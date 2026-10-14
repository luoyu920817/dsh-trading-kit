import { createServer, type ServerResponse } from 'node:http'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'

/**
 * 执行真实页面和本地 HTTP 通道。
 * 业务逻辑: 最小 DOM 承载实际脚本，由服务器显式释放响应，不等待时间流逝。
 * 关键判断: 补读调度器由调用方推进；fetch、响应解析和中断均为真实实现。
 * 异常处理: 请求结束后关闭所有连接，避免失败测试残留句柄。
 * 参数: writable 控制写卡入口。返回: 页面入口、DOM、请求队列和补读调度队列。
 */
async function page(writable = false) {
  class Element {
    value = ''; style: Record<string, string> = {}; className = ''; disabled = false
    children: Element[] = []; listeners: Record<string, (...args: any[]) => void> = {}
    private text = ''
    /** 业务逻辑: 汇总节点文本。关键判断: 包含子节点。异常处理: 空子节点为空。参数: 无。返回: 文本。 */
    get textContent(): string { return this.text + this.children.map(c => c.textContent).join('') }
    /** 业务逻辑: 替换节点文本。关键判断: 释放子节点。异常处理: 无。参数: v为文本。返回: 无。 */
    set textContent(v: string) { this.text = v; this.children = [] }
    /** 业务逻辑: 加入子节点。关键判断: 保留节点身份。异常处理: 无。参数: e为节点。返回: 原节点。 */
    appendChild(e: Element) { this.children.push(e); return e }
    /** 业务逻辑: 取得首卡插入位置。关键判断: 空容器返回null。异常处理: 无。参数: 无。返回: 首节点或null。 */
    get firstChild(): Element | null { return this.children[0] ?? null }
    /** 业务逻辑: 插入编辑节点或首卡。关键判断: null目标在末尾追加。异常处理: 非空目标缺失抛错。参数: e新节点、before相邻节点。返回: 新节点。 */
    insertBefore(e: Element, before: Element | null) { if (before === null) return this.appendChild(e); const index = this.children.indexOf(before); assert(index >= 0); this.children.splice(index, 0, e); return e }
    /** 业务逻辑: 移除已退出的编辑节点。关键判断: 只移除指定节点。异常处理: 目标缺失抛错。参数: e目标节点。返回: 移除节点。 */
    removeChild(e: Element) { const index = this.children.indexOf(e); assert(index >= 0); this.children.splice(index, 1); return e }
    /** 业务逻辑: 注册交互入口。关键判断: 同名事件覆盖。异常处理: 无。参数: k事件、fn处理器。返回: 无。 */
    addEventListener(k: string, fn: (...args: any[]) => void) { this.listeners[k] = fn }
    /** 业务逻辑: 接受不影响测试的属性。关键判断: 不参与呈现断言。异常处理: 无。参数: 无。返回: 无。 */
    setAttribute() {}
    /** 业务逻辑: 移除克隆节点的模板 id。关键判断: 缺失属性安全空操作。异常处理: 无。参数: name属性名。返回: 无。 */
    removeAttribute(name: string) { delete (this as unknown as Record<string, unknown>)[name] }
    /** 业务逻辑: 复制节点供编辑条复用静态图标入口（makeImagePickBtn）。关键判断: 深复制文本与子节点，监听不随克隆。异常处理: 无。参数: deep是否深复制。返回: 新节点。 */
    cloneNode(deep?: boolean): Element {
      const copy = new Element()
      copy.value = this.value
      copy.className = this.className
      copy.disabled = this.disabled
      Object.assign(copy.style, this.style)
      if (!deep) return copy
      copy.text = this.text
      for (const child of this.children) copy.appendChild(child.cloneNode(true))
      return copy
    }
    /** 业务逻辑: 判断日历点击范围。关键判断: 本节点或直接子节点。异常处理: 无。参数: e目标节点。返回: 是否包含。 */
    contains(e: Element) { return e === this || this.children.includes(e) }
  }
  const elements = new Map<string, Element>()
  const byId = (id: string) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id)! }
  const queue: Array<{ url: URL; res: ServerResponse }> = []
  let notify: (() => void) | undefined
  const server = createServer((req, res) => { queue.push({ url: new URL(req.url!, 'http://localhost'), res }); notify?.(); notify = undefined })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const scheduled: Array<{ fn: () => void; delay: number; cancelled: boolean }> = []
  const events: Record<string, () => void> = {}
  const window: any = { __REVIEW__: { basePath: `http://127.0.0.1:${address.port}/kit`, writable,
    localRetryScheduler: {
      /** 业务逻辑: 登记业务补读任务。关键判断: 显式推进而非改写时钟。异常处理: 无。参数: fn任务、delay延迟。返回: 任务。 */
      schedule(fn: () => void, delay: number) { const task = { fn, delay, cancelled: false }; scheduled.push(task); return task },
      /** 业务逻辑: 标记取消任务。关键判断: 保留取消证据。异常处理: 无。参数: task任务。返回: 无。 */
      cancel(task: { cancelled: boolean }) { task.cancelled = true },
    },
  },
    /** 业务逻辑: 登记页面生命周期。关键判断: 覆盖同名入口。异常处理: 无。参数: k事件、fn处理器。返回: 无。 */
    addEventListener(k: string, fn: () => void) { events[k] = fn },
  }
  const script = Array.from(REVIEW_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g))[1]![1]!
    .replace(/}\)\(\);\s*$/, 'window.page = { switchContext: switchContext, loadLocal: loadLocal, applyDateChange: applyDateChange, loadIndexQuote: loadIndexQuote, onNavTargetChange: onNavTargetChange };})();')
  const completions: Array<{ key: string; promise: Promise<void> }> = []
  const outbound: Array<{ url: URL; options: RequestInit }> = []
  runInNewContext(script, { window, document: { getElementById: byId, createElement: () => new Element(), createTextNode(text: string) { const node = new Element(); node.textContent = text; return node }, addEventListener() {} },
    location: { hash: '', search: '', pathname: '/kit/review' }, navigator: {}, URL, AbortController, setTimeout, clearTimeout,
    /** 业务逻辑: 真实HTTP读取并登记解析完成。关键判断: 原样传递中断信号。异常处理: 失败仍释放完成信号。参数: url地址、options选项。返回: 真实响应。 */
    fetch(url: string, options: RequestInit) {
      let complete!: () => void
      const parsed = new URL(url)
      assert.equal(parsed.protocol, 'http:')
      assert.equal(parsed.hostname, '127.0.0.1')
      assert.equal(parsed.port, String(address.port))
      outbound.push({ url: parsed, options })
      completions.push({ key: parsed.pathname + parsed.search, promise: new Promise<void>(resolve => { complete = resolve }) })
      return fetch(url, options).then(resp => { const json = resp.json.bind(resp); resp.json = () => json().finally(complete); return resp }, error => { complete(); throw error })
    },
  })
  return { api: window.page, byId, scheduled, events, outbound,
    /** 业务逻辑: 读取真实到达的请求。关键判断: 按路径匹配以消除并发到达顺序依赖。异常处理: 未到达则等事件。参数: path路径尾部。返回: 请求。 */
    async next(path?: string) {
      let index = queue.findIndex(req => !path || req.url.pathname.endsWith(path))
      while (index < 0) { await new Promise<void>(resolve => { notify = resolve }); index = queue.findIndex(req => !path || req.url.pathname.endsWith(path)) }
      return queue.splice(index, 1)[0]!
    },
    /** 业务逻辑: 释放HTTP响应并等真实解析完成。关键判断: 微任务仅刷新Promise链，不等待时钟。异常处理: 中断响应同样完成。参数: req请求、body正文。返回: 完成Promise。 */
    async respond(req: { url: URL; res: ServerResponse }, body: unknown) { req.res.setHeader('content-type', 'application/json'); req.res.end(JSON.stringify(body)); const index = completions.findIndex(c => c.key === req.url.pathname + req.url.search); await completions.splice(index, 1)[0]!.promise; for (let i = 0; i < 8; i++) await Promise.resolve() },
    /** 业务逻辑: 关闭页面及HTTP服务。关键判断: 先中断读请求再关闭连接。异常处理: 尚无生命周期入口则忽略。参数: 无。返回: 完成Promise。 */
    async close() { events.pagehide?.(); const closed = new Promise<void>(resolve => server.close(() => resolve())); server.closeAllConnections(); await closed },
  }
}

const ready = { name: { value: '档案名' }, date: '2026-10-08', dateSource: 'requested', cards: [], warnings: [], history: [] }
const pending = { ...ready, cards: [], loadState: { profile: 'ready', tradeDate: 'ready', history: 'ready', cards: 'loading' } }

describe('复盘实际页面上下文和渐进补读', () => {
  it('输入页仅作为数据源，关键词输入不请求管理信息也不展示管理故障', async () => {
    const p = await page(true)
    try {
      expect(p.outbound).toHaveLength(0)
      const input = p.byId('rv-input')
      input.value = '@预期 @预期差 `@预期`'; input.listeners.input!()
      expect(input.value).toBe('@预期 @预期差 `@预期`')
      expect(p.byId('rv-status').textContent).not.toContain('关键词管理信息不可用')
      expect(p.outbound).toHaveLength(0)
      input.value = '`a\n@预期\nb`'; input.listeners.input!()
      expect(input.value).toBe('`a\n@预期\nb`')
      expect(p.outbound).toHaveLength(0)
    } finally { await p.close() }
  })

  it('@预期原文保存失败保留输入，重试复用幂等标识且保存后不请求工作流管理', async () => {
    const p = await page(true)
    try {
      expect(p.outbound.filter(r => r.url.pathname.includes('/processors/'))).toHaveLength(0)
      p.api.switchContext('999999', '999999', 'sh')
      await p.respond(await p.next('/local'), ready)
      await p.respond(await p.next('/index-quote'), { available: true, name: '指数', price: 1, pct: 0 })
      const input = p.byId('rv-input'); input.value = '@预期 明天观察'; input.listeners.input!()
      input.listeners.keydown!({ key: 'Enter', preventDefault() {} })
      const failed = await p.next('/card'); failed.res.statusCode = 500
      const first = JSON.parse(p.outbound.find(r => r.options.method === 'POST')!.options.body as string)
      expect(first).toMatchObject({ code: '999999', market: 'sh', tradeDate: '2026-10-08', body: '@预期 明天观察' })
      await p.respond(failed, { error: 'STORAGE_ERROR', message: '磁盘不可写' })
      expect(input.value).toBe('@预期 明天观察')
      expect(p.byId('rv-status').textContent).toContain('保存失败')
      expect(p.byId('rv-status').textContent).toContain('磁盘不可写')
      input.listeners.keydown!({ key: 'Enter', preventDefault() {} })
      await p.respond(await p.next('/card'), { status: 'created', anchor: 'card-20261008-999999-1100' })
      const second = JSON.parse(p.outbound.filter(r => r.options.method === 'POST')[1]!.options.body as string)
      expect(second).toEqual(first)
      expect(input.value).toBe('')
      expect(p.byId('rv-cards').textContent).toContain('@预期 明天观察')
      expect(p.byId('rv-status').textContent).toContain('已保存')
      expect(p.byId('rv-cards').textContent).not.toContain('关键词管理信息不可用')
      expect(p.outbound.filter(r => r.url.pathname.includes('/processors/'))).toHaveLength(0)
    } finally { await p.close() }
  })

  it('@预期修订保持原文、来源和失败提示，修订与删除成功后仅回读卡片数据', async () => {
    const p = await page(true)
    try {
      p.api.switchContext('999999', '999999', 'sh')
      const body = { ...ready, cards: [{ body: '@预期 原判断', writtenAt: '10:00', anchor: 'card-20261008-999999-1000' }] }
      await p.respond(await p.next('/local'), body)
      await p.respond(await p.next('/index-quote'), { available: true, name: '指数', price: 1, pct: 0 })
      const card = p.byId('rv-cards').children[0]!
      card.children[0]!.children.find(e => e.textContent === '编辑')!.listeners.click!()
      const textarea = card.children[1]!, bar = card.children[2]!
      textarea.value = '@预期 调整后的判断'
      const save = bar.children.find(e => e.textContent === '保存编辑')!
      save.listeners.click!()
      const failed = await p.next('/card/update'); failed.res.statusCode = 500
      const first = JSON.parse(p.outbound.find(r => r.url.pathname.endsWith('/card/update'))!.options.body as string)
      expect(first).toMatchObject({ market: 'sh', anchor: 'card-20261008-999999-1000', body: '@预期 调整后的判断' })
      await p.respond(failed, { error: 'STORAGE_ERROR', message: '磁盘不可写' })
      expect(textarea.value).toBe('@预期 调整后的判断'); expect(textarea.disabled).toBe(false)
      expect(p.byId('rv-status').textContent).toContain('编辑保存失败')
      expect(p.byId('rv-status').textContent).toContain('磁盘不可写')
      save.listeners.click!()
      await p.respond(await p.next('/card/update'), { status: 'updated' })
      await p.respond(await p.next('/local'), { ...body, cards: [{ ...body.cards[0], body: '@预期 调整后的判断' }] })
      expect(p.byId('rv-cards').textContent).toContain('@预期 调整后的判断')
      const updated = p.byId('rv-cards').children[0]!
      const remove = updated.children[0]!.children.find(e => e.textContent === '删除')!
      remove.listeners.click!(); remove.listeners.click!()
      const deletion = await p.next('/card/delete')
      const payload = JSON.parse(p.outbound.find(r => r.url.pathname.endsWith('/card/delete'))!.options.body as string)
      expect(payload).toMatchObject({ market: 'sh', anchor: 'card-20261008-999999-1000' })
      await p.respond(deletion, { status: 'deleted' })
      await p.respond(await p.next('/local'), { ...body, cards: [] })
      expect(p.byId('rv-cards').children).toHaveLength(0)
      expect(p.outbound.filter(r => r.url.pathname.includes('/processors/'))).toHaveLength(0)
    } finally { await p.close() }
  })

  it('编辑原文不变保存成功也退出禁用编辑态，保持相邻卡片DOM', async () => {
    const p = await page(true)
    try {
      p.api.switchContext('999999', '999999', 'sh')
      const body = { ...ready, cards: [{ body: '相邻判断', writtenAt: '09:00', anchor: 'card-20261008-999999-0900' }, { body: '当天判断', writtenAt: '10:00', anchor: 'card-20261008-999999-1000' }] }
      await p.respond(await p.next('/local'), body)
      await p.respond(await p.next('/index-quote'), { available: true, name: '指数', price: 1, pct: 0 })
      const card = p.byId('rv-cards').children[0]!
      const neighbour = p.byId('rv-cards').children[1]
      const head = card.children[0]!
      head.children.find(e => e.textContent === '编辑')!.listeners.click!()
      const textarea = card.children[1]!
      const bar = card.children[2]!
      bar.children.find(e => e.textContent === '保存编辑')!.listeners.click!()
      expect(textarea.disabled).toBe(true)
      await p.respond(await p.next('/card/update'), { status: 'updated' })
      await p.respond(await p.next('/local'), body)
      expect(card.children).toHaveLength(2)
      expect(card.children[1]!.style.display).toBe('')
      expect(card.children[1]!.textContent).toBe('当天判断')
      expect(p.byId('rv-cards').children[1]).toBe(neighbour)
    } finally { await p.close() }
  })
  it('同码跨市场纯文本草稿必须确认新归属后才允许提交', async () => {
    const p = await page(true)
    try {
      p.api.switchContext('000001', 'sh000001', 'sh')
      await p.respond(await p.next('/local'), ready)
      await p.respond(await p.next('/index-quote'), { available: true, name: '指数', price: 1, pct: 0 })
      const input = p.byId('rv-input')
      input.value = '指数观察'; input.listeners.input!()
      p.api.onNavTargetChange('000001', 'sz000001', 'sz')
      expect(p.byId('rv-owner-confirm').style.display).toBe('')
      expect(p.byId('rv-owner-confirm').textContent).toContain('sh000001')
      expect(p.byId('rv-owner-confirm').textContent).toContain('sz000001')
      await p.respond(await p.next('/local'), ready)
      await p.respond(await p.next('/enrich'), { concepts: { available: true, labels: [] }, limitReason: null })
      input.listeners.keydown!({ key: 'Enter', preventDefault() {} })
      expect(p.outbound.filter(r => r.options?.method === 'POST')).toHaveLength(0)
      expect(input.value).toBe('指数观察')
      p.byId('rv-confirm-owner').listeners.click!()
      input.listeners.keydown!({ key: 'Enter', preventDefault() {} })
      const posted = p.outbound.filter(r => r.options?.method === 'POST')
      expect(posted).toHaveLength(1)
      expect(JSON.parse(posted[0]!.options.body as string)).toMatchObject({ code: '000001', market: 'sz', body: '指数观察' })
      await p.respond(await p.next('/card'), { status: 'created', anchor: 'card-20261008-000001-1100' })
    } finally { await p.close() }
  })
  it('pageshow恢复停用读取并保留已选日期和草稿，恢复时仅发起一次指数请求', async () => {
    const p = await page()
    try {
      p.api.switchContext('999999', '999999', 'sh')
      await p.respond(await p.next('/local'), ready)
      await p.respond(await p.next('/index-quote'), { available: true, name: '指数', price: 1, pct: 0 })
      p.byId('rv-date').value = '2026-10-07'; p.api.applyDateChange()
      await p.respond(await p.next('/local'), { ...ready, date: '2026-10-07' })
      await p.respond(await p.next('/index-quote'), { available: true, name: '指数', price: 2, pct: 0 })
      p.byId('rv-input').value = '未提交'; p.byId('rv-input').listeners.input!()
      p.events.pagehide!()
      expect(p.events.pageshow).toBeTypeOf('function')
      p.events.pageshow!(); p.events.pageshow!()
      const reread = await p.next('/local')
      expect(reread.url.searchParams.get('date')).toBe('2026-10-07')
      await p.respond(reread, { ...ready, date: '2026-10-07' })
      await p.respond(await p.next('/index-quote'), { available: true, name: '恢复指数', price: 3, pct: 0 })
      expect(p.byId('rv-input').value).toBe('未提交')
      expect(p.byId('rv-date').value).toBe('2026-10-07')
      expect(p.byId('rv-name').textContent).toBe('档案名')
      expect(p.byId('rv-qp-price').textContent).toContain('3.00')
      expect(p.outbound.filter(r => r.url.pathname.endsWith('/index-quote'))).toHaveLength(3)
    } finally { await p.close() }
  })
  it('旧响应无 loadState 仍显示已就绪的空卡事实与档案名称', async () => {
    const p = await page()
    try { p.api.switchContext('999999', '999999', 'sh'); await p.respond(await p.next(), ready)
      expect(p.byId('rv-name').textContent).toBe('档案名')
      expect(p.byId('rv-empty').textContent).toContain('该日无卡片')
    } finally { await p.close() }
  })
  it('切换立即更新代码并清旧卡、行情、名称、角色与错误，保留草稿归属保护', async () => {
    const p = await page()
    try {
      p.api.switchContext('999999', '999999', 'sh'); await p.respond(await p.next(), ready)
      p.byId('rv-cards').textContent = '旧卡'; p.byId('rv-qp-price').textContent = '123'; p.byId('rv-concepts').textContent = '旧角色'; p.byId('rv-status').textContent = '旧错误'
      p.byId('rv-input').value = '未提交'; p.byId('rv-input').listeners.input!()
      p.api.onNavTargetChange('880001', '880001', 'sh')
      expect(p.byId('rv-code').textContent).toBe('sh880001')
      expect(p.byId('rv-cards').textContent).toBe('')
      expect(p.byId('rv-qp-price').textContent).toBe('--')
      expect(p.byId('rv-name').textContent).toBe('名称未获取')
      expect(p.byId('rv-concepts').textContent).toBe('')
      expect(p.byId('rv-status').textContent).not.toContain('旧错误')
      expect(p.byId('rv-input').value).toBe('未提交')
      expect(p.byId('rv-owner-confirm').style.display).toBe('')
    } finally { await p.close() }
  })
  it('卡片 pending 不宣称无卡，串行补读合并同上下文请求，就绪后不再调度', async () => {
    const p = await page()
    try {
      p.api.switchContext('999999', '999999', 'sh'); const request = await p.next()
      p.api.loadLocal(true)
      await p.respond(request, pending)
      expect(p.byId('rv-empty').textContent).not.toContain('无卡片')
      expect(p.scheduled.map(t => t.delay)).toEqual([250])
      const index = await p.next(); expect(index.url.pathname).toContain('index-quote')
      await p.respond(index, { available: true, name: '指数名', price: 1, pct: 0 })
      p.scheduled[0]!.fn()
      await p.respond(await p.next(), ready)
      expect(p.byId('rv-empty').textContent).toContain('该日无卡片')
      expect(p.scheduled).toHaveLength(1)
    } finally { await p.close() }
  })
  it('指数日补位在本地请求完成后串行回读，名称不会被后续本地空名称抹去', async () => {
    const p = await page()
    try {
      p.api.switchContext('999999', '999999', 'sh')
      await p.respond(await p.next(), { ...ready, name: null, date: null, dateSource: 'unavailable' })
      await p.respond(await p.next(), { available: true, name: '上证指数', price: 3, pct: 0, tradeDate: { value: '2026-10-09' } })
      const reread = await p.next()
      expect(reread.url.searchParams.get('date')).toBe('2026-10-09')
      await p.respond(reread, { ...ready, name: null, date: '2026-10-09' })
      expect(p.byId('rv-name').textContent).toBe('上证指数')
      expect(p.byId('rv-qp-price').textContent).toBe('3.00  0.00%')
      expect(p.byId('rv-empty').textContent).toContain('2026-10-09')
    } finally { await p.close() }
  })
  it('已取得的同日卡片在pending补位中保留DOM，只更新变化区域', async () => {
    const p = await page()
    try {
      p.api.switchContext('999999', '999999', 'sh')
      const body = { ...ready, cards: [{ body: '当天判断', writtenAt: '10:00', anchor: 'card-20261008-999999-1000' }] }
      await p.respond(await p.next(), body)
      await p.respond(await p.next(), { available: true, name: '指数', price: 1, pct: 0 })
      const node = p.byId('rv-cards').children[0]
      p.api.loadLocal(true)
      await p.respond(await p.next(), pending)
      expect(p.byId('rv-cards').children[0]).toBe(node)
      expect(p.byId('rv-cards').textContent).toContain('当天判断')
      p.scheduled[0]!.fn(); const request = await p.next()
      p.api.loadLocal(true)
      expect(p.scheduled).toHaveLength(1)
      await p.respond(request, body)
      expect(p.byId('rv-cards').children[0]).toBe(node)
    } finally { await p.close() }
  })
  it('补读退避最长30秒，超时保留内容，切换及pagehide取消任务', async () => {
    const p = await page()
    try {
      p.api.switchContext('999999', '999999', 'sh'); await p.respond(await p.next(), pending)
      await p.respond(await p.next(), { available: true, name: '指数', price: 1, pct: 0 })
      for (let i = 0; i < 20; i++) {
        const task = p.scheduled[i]
        if (!task) break
        task.fn()
        if (p.byId('rv-status').textContent.includes('刷新')) break
        await p.respond(await p.next(), pending)
      }
      expect(p.scheduled.slice(0, 5).map(t => t.delay)).toEqual([250, 500, 1000, 2000, 2000])
      expect(p.scheduled.reduce((sum, t) => sum + t.delay, 0)).toBe(30000)
      expect(p.byId('rv-status').textContent).toContain('刷新')
      expect(p.byId('rv-name').textContent).toBe('档案名')
      p.api.switchContext('880001', '880001', 'sh'); await p.respond(await p.next(), pending)
      expect(p.scheduled.at(-1)!.delay).toBe(250)
      p.events.pagehide!()
      expect(p.scheduled.at(-1)!.cancelled).toBe(true)
    } finally { await p.close() }
  })
  it('同码跨市场切换中断旧本地和指数请求，迟到旧响应与错误不污染新页', async () => {
    const p = await page()
    try {
      p.api.switchContext('000001', 'sh000001', 'sh')
      await p.respond(await p.next(), ready)
      const oldIndex = await p.next()
      p.api.loadLocal(true); const oldLocal = await p.next()
      p.api.switchContext('000001', 'sz000001', 'sz')
      const newLocal = await p.next('/local'); const newEnrich = await p.next('/enrich')
      expect(newEnrich.url.pathname).toContain('enrich')
      await p.respond(oldIndex, { available: true, name: '旧指数', price: 123, pct: 0 })
      await p.respond(oldLocal, { ...ready, name: { value: '旧名称' } })
      await p.respond(newLocal, { ...ready, name: { value: '深市股票' } })
      await p.respond(newEnrich, { name: { available: true, name: '网络名' }, quote: { available: true, price: 8, pct: 0 }, concepts: { available: true, labels: [] }, limitReason: null })
      expect(p.byId('rv-code').textContent).toBe('sz000001')
      expect(p.byId('rv-name').textContent).toBe('深市股票')
      expect(p.byId('rv-qp-price').textContent).toBe('8.00  0.00%')
      expect(p.byId('rv-status').textContent).not.toContain('Abort')
    } finally { await p.close() }
  })
  it('enrich自动回填日期不作废当前结果，本地在途完成后仅补读真正变化的日期', async () => {
    const p = await page()
    try {
      p.api.switchContext('600000', 'sh600000', 'sh')
      const initialLocal = await p.next('/local'); const enrich = await p.next('/enrich')
      await p.respond(enrich, { name: { available: true, name: '网络名' }, tradeDate: { value: '2026-10-09' }, quote: { available: true, price: 9, pct: 0 }, concepts: { available: true, labels: ['银行'] }, limitReason: { text: '最新原因', businessDate: '2026-10-09' } })
      expect(p.byId('rv-date').value).toBe('2026-10-09')
      expect(p.byId('rv-name').textContent).toBe('网络名')
      expect(p.byId('rv-qp-price').textContent).toContain('9.00')
      await p.respond(initialLocal, { ...ready, name: null, date: null })
      const reread = await p.next(); expect(reread.url.searchParams.get('date')).toBe('2026-10-09')
      await p.respond(reread, { ...ready, name: null, date: '2026-10-09' })
      expect(p.byId('rv-concepts').textContent).toBe('银行')
      expect(p.byId('rv-limit').textContent).toContain('最新原因')
      expect(p.byId('rv-qp-price').textContent).toContain('9.00')
      expect(p.scheduled).toHaveLength(0)
    } finally { await p.close() }
  })
  it('用户切日作废旧本地与enrich，自动日期不得覆盖显式选日', async () => {
    const p = await page()
    try {
      p.api.switchContext('600000', 'sh600000', 'sh')
      const oldLocal = await p.next('/local'); const oldEnrich = await p.next('/enrich')
      p.byId('rv-date').value = '2026-10-07'; p.api.applyDateChange()
      const local = await p.next('/local'); const enrich = await p.next('/enrich')
      expect(local.url.searchParams.get('date')).toBe('2026-10-07')
      expect(enrich.url.searchParams.get('date')).toBe('2026-10-07')
      await p.respond(oldEnrich, { quote: { available: true, price: 123, pct: 0 } })
      await p.respond(oldLocal, { ...ready, name: { value: '旧日期名称' } })
      await p.respond(local, { ...ready, date: '2026-10-07' })
      await p.respond(enrich, { tradeDate: { value: '2026-10-09' }, quote: { available: true, price: 7, pct: 0 }, concepts: { available: true, labels: [] }, limitReason: null })
      expect(p.byId('rv-date').value).toBe('2026-10-07')
      expect(p.byId('rv-name').textContent).toBe('档案名')
      expect(p.byId('rv-qp-price').textContent).toContain('7.00')
      expect(p.byId('rv-status').textContent).not.toContain('Abort')
    } finally { await p.close() }
  })
})
