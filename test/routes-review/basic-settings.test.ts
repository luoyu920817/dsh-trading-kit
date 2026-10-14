import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { resolveTraderKitConfig } from '../../src/config.ts'
import { BASIC_SETTINGS_PATH, createBasicSettingsHandler, type BasicSettingsDeps } from '../../src/routes/basic-settings.ts'

/**
 * 在真实 HTTP 上读取基础配置快照。
 * 业务逻辑: 测试服务器运行生产 handler，并确保连接收尾。
 * 关键判断: cookie 与访问栅栏仅作为 HTTP 请求事实，不模拟文件系统或 Agent。
 * 异常处理: 回调失败也关闭服务器。参数: 配置与断言回调。返回: 完成。
 */
async function withApi(config: ReturnType<typeof resolveTraderKitConfig>, check: (url: string, request: (url: string, options?: RequestInit) => Promise<Response>) => Promise<void>, requestRejection: BasicSettingsDeps['requestRejection'] = req => req.headers['x-fence'] === '1' ? 403 : req.headers.cookie === 'dsh-auth=ok' ? undefined : 401): Promise<void> {
  const handler = createBasicSettingsHandler({ config, requestRejection })
  const server = createServer((req, res) => { handler(req, res) })
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('HTTP_ADDRESS_UNAVAILABLE')
  const serverUrl = new URL(`http://127.0.0.1:${address.port}${BASIC_SETTINGS_PATH}`)
  /**
   * 将测试 HTTP 请求限制在本次随机端口与基础设置路径。
   * 业务逻辑: 每次请求先核验源和路径，再调用真实 fetch。
   * 关键判断: 仅允许精确基础路径及其子路径错误验收，禁止重定向和 URL 凭据。
   * 异常处理: 越界请求在网络前拒绝。参数: 请求 URL 与 HTTP 选项。返回: 真实响应。
   */
  async function request(url: string, options?: RequestInit): Promise<Response> {
    const target = new URL(url)
    if (target.origin !== serverUrl.origin || target.username || target.password ||
      (target.pathname !== BASIC_SETTINGS_PATH && !target.pathname.startsWith(BASIC_SETTINGS_PATH + '/'))) {
      throw new Error('BASIC_SETTINGS_TEST_REQUEST_OUT_OF_SCOPE')
    }
    return fetch(target, { ...options, redirect: 'error' })
  }
  try { await check(serverUrl.href, request) }
  finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) }
}

it('基础配置快照只公开目录和执行预算，路径来自映射且不创建业务目录', async () => {
  const root = await mkdtemp(join(tmpdir(), 'basic-settings-'))
  const dataRoot = join(root, 'not-created')
  try {
    const config = resolveTraderKitConfig({ dataRoot, sources: { s7: { sign: 'secret-source' }, tqLocal: { enabled: false } }, review: { writeKey: 'secret-key', processing: { enabled: true, provider: 'configured-provider', model: 'configured-model', cwd: root, maxConcurrency: 2, agentAttemptLimit: 9, maxTokens: 3000, timeoutMs: 45000 } } })
    await withApi(config, async (url, request) => {
      const response = await request(url, { headers: { cookie: 'dsh-auth=ok' } })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      const dto = await response.json()
      expect(dto).toEqual({
        dataRoot: resolve(dataRoot), tqLocalEnabled: false,
        editing: { available: false, revision: null, unavailableReason: '当前宿主未提供目录配置编辑能力' },
        executionEditing: { available: false, revision: null, unavailableReason: '当前宿主未提供执行配置编辑能力' },
        directories: [
          { id: 'stock', label: '标的目录', relativePath: 'DB/stock', absolutePath: join(dataRoot, 'DB/stock'), status: 'active' },
          { id: 'patterns', label: '模式目录', relativePath: '交易系统/平常心/方法论/模式', absolutePath: join(dataRoot, '交易系统/平常心/方法论/模式'), status: 'reserved' },
          { id: 'review', label: '复盘目录', relativePath: 'DB/review/<YYYYMM>', absolutePath: join(dataRoot, 'DB/review/<YYYYMM>'), status: 'active' },
          { id: 'processorRuns', label: '工作流记录目录', relativePath: 'agent/DB/temp/dsh-trader-kit/processors', absolutePath: join(dataRoot, 'agent/DB/temp/dsh-trader-kit/processors'), status: 'active' },
          { id: 'agentSkills', label: '业务 Skill 目录', relativePath: 'agent/skills', absolutePath: join(dataRoot, 'agent/skills'), status: 'active' },
        ],
        processing: { enabled: true, provider: 'configured-provider', model: 'configured-model', cwd: root, maxConcurrency: 2, agentAttemptLimit: 9, maxTokens: 3000, timeoutMs: 45000 },
      })
      expect(JSON.stringify(dto)).not.toContain('secret-')
    })
    await expect(access(dataRoot)).rejects.toThrow()
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('执行保存入口严格认证及白名单，缺宿主能力明确503', async () => {
  await withApi(resolveTraderKitConfig({}), async (url, request) => {
    const body = { revision: 'a'.repeat(64), processing: { enabled: false, provider: '', model: '', cwd: '' } }
    const headers = { cookie: 'dsh-auth=ok', 'content-type': 'application/json' }
    expect((await request(url + '/save-execution', { method: 'POST', headers: { 'x-write-key': 'key', 'content-type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(401)
    expect((await request(url + '/save-execution', { method: 'POST', headers: { ...headers, 'x-fence': '1' }, body: JSON.stringify(body) })).status).toBe(403)
    const unavailable = await request(url + '/save-execution', { method: 'POST', headers, body: JSON.stringify(body) })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: 'EXECUTION_EDIT_UNAVAILABLE', message: '当前宿主未提供执行配置编辑能力' })
    for (const invalid of [{ ...body, processing: { ...body.processing, maxTokens: 99 } }, { ...body, processing: { ...body.processing, enabled: 'yes' } }, { ...body, revision: 'short' }]) {
      const response = await request(url + '/save-execution', { method: 'POST', headers, body: JSON.stringify(invalid) })
      expect(response.status).toBe(400)
      expect((await response.json()).error).toBe('INVALID_EXECUTION_CONFIG')
    }
    expect((await request(url + '/save-execution', { method: 'POST', headers, body: ' '.repeat(8193) })).status).toBe(413)
    const malformed = await request(url + '/save-execution', { method: 'POST', headers, body: '{' })
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error).toBe('INVALID_EXECUTION_CONFIG')
  })
})

it('未配置根目录仍可读，目录没有伪绝对路径且保留预算默认值', async () => {
  await withApi(resolveTraderKitConfig({}), async (url, request) => {
    const response = await request(url, { headers: { cookie: 'dsh-auth=ok' } })
    const dto = await response.json()
    expect(response.status).toBe(200)
    expect(dto.dataRoot).toBe('')
    expect(dto.directories.map((entry: { absolutePath: unknown }) => entry.absolutePath)).toEqual([null, null, null, null, null])
    expect(dto.processing).toEqual({ enabled: false, provider: '', model: '', cwd: '', maxConcurrency: 1, agentAttemptLimit: 20, maxTokens: 4096, timeoutMs: 120000 })
    expect(dto.tqLocalEnabled).toBe(true)
  })
  const source = readFileSync(new URL('../../src/review/processors/index.ts', import.meta.url), 'utf8')
  expect(source.indexOf('registerBasicSettingsRoutes(ctx, config)')).toBeGreaterThan(-1)
  expect(source.indexOf('registerBasicSettingsRoutes(ctx, config)')).toBeLessThan(source.indexOf('if (!config.dataRoot) return'))
  expect(source.indexOf('registerWorkflowPage(ctx)')).toBeGreaterThan(-1)
  expect(source.indexOf('registerWorkflowPage(ctx)')).toBeLessThan(source.indexOf('if (!config.dataRoot) return'))
  expect(source.match(/registerWorkflowPage\(ctx\)/g)).toHaveLength(1)
})

it('需要宿主认证且写键不能救援，403 优先，认证异常封闭', async () => {
  await withApi(resolveTraderKitConfig({ review: { writeKey: 'secret-key' } }), async (url, request) => {
    const unauthenticated = await request(url, { headers: { 'x-write-key': 'secret-key' } })
    expect(unauthenticated.status).toBe(401)
    expect(await unauthenticated.json()).toEqual({ error: 'UNAUTHENTICATED', message: '需要宿主登录凭据' })
    const forbidden = await request(url, { headers: { cookie: 'dsh-auth=ok', 'x-fence': '1', 'x-write-key': 'secret-key' } })
    expect(forbidden.status).toBe(403)
    expect(await forbidden.json()).toEqual({ error: 'FORBIDDEN', message: '请求未通过宿主访问栅栏' })
  })
  await withApi(resolveTraderKitConfig({ dataRoot: 'private-root' }), async (url, request) => {
    const response = await request(url, { headers: { cookie: 'dsh-auth=ok' } })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'INTERNAL_ERROR', message: '基础设置暂不可用' })
  }, () => { throw new Error('private-root: auth configuration unavailable') })
})

it('认证读取仅支持 GET 与精确路径，不开放查询或写入入口', async () => {
  await withApi(resolveTraderKitConfig({}), async (url, request) => {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const response = await request(url, { method, headers: { cookie: 'dsh-auth=ok' } })
      expect(response.status).toBe(405)
      expect(response.headers.get('allow')).toBe('GET')
    }
    expect((await request(url + '?writeKey=anything', { headers: { cookie: 'dsh-auth=ok' } })).status).toBe(400)
    expect((await request(url + '/other', { headers: { cookie: 'dsh-auth=ok' } })).status).toBe(404)
  })
})

it('目录编辑只允许显式认证JSON POST，缺宿主能力返回原因而非保存成功', async () => {
  await withApi(resolveTraderKitConfig({}), async (url, request) => {
    const headers = { cookie: 'dsh-auth=ok', 'content-type': 'application/json' }
    const unauthenticated = await request(url + '/choose-directory', { method: 'POST', headers: { 'content-type': 'application/json', 'x-write-key': 'unused' }, body: JSON.stringify({ directory: 'stock' }) })
    expect(unauthenticated.status).toBe(401)
    expect((await request(url + '/choose-directory', { headers })).status).toBe(405)
    for (const input of [{ directory: 'review' }, { directory: 'stock', path: '/arbitrary' }, []]) expect((await request(url + '/choose-directory', { method: 'POST', headers, body: JSON.stringify(input) })).status).toBe(400)
    const unavailable = await request(url + '/choose-directory', { method: 'POST', headers, body: JSON.stringify({ directory: 'stock' }) })
    expect(unavailable.status).toBe(503)
    expect(await unavailable.json()).toEqual({ error: 'DIRECTORY_EDIT_UNAVAILABLE', message: '当前宿主未提供目录配置编辑能力' })
    const save = await request(url + '/save', { method: 'POST', headers, body: JSON.stringify({ revision: 'a'.repeat(64), directories: { stock: 'DB/stock', patterns: '模式' } }) })
    expect(save.status).toBe(503)
    expect(await save.json()).not.toHaveProperty('saved')
    expect((await request(url + '/save', { method: 'POST', headers, body: JSON.stringify({ revision: 'short', directories: { stock: 'DB/stock', patterns: '模式' } }) })).status).toBe(400)
    expect((await request(url + '/save', { method: 'POST', headers, body: JSON.stringify({ revision: 'a'.repeat(64), directories: { stock: 'DB/stock', patterns: '模式', cache: 'other' } }) })).status).toBe(400)
    expect((await request(url + '/save', { method: 'POST', headers, body: ' '.repeat(8193) })).status).toBe(413)
  })
})

it('真实 HTTP 测试请求在网络前拒绝外部源、其他端口和其他路径', async () => {
  await withApi(resolveTraderKitConfig({}), async (url, request) => {
    const current = new URL(url)
    const anotherPort = current.port === '65535' ? '65534' : '65535'
    for (const target of [
      'https://example.com' + BASIC_SETTINGS_PATH,
      `http://127.0.0.1:${anotherPort}${BASIC_SETTINGS_PATH}`,
      current.origin + '/dsh-trader-kit/review/api/processors/reload',
      current.origin + BASIC_SETTINGS_PATH + '-other',
    ]) {
      await expect(request(target)).rejects.toThrow('BASIC_SETTINGS_TEST_REQUEST_OUT_OF_SCOPE')
    }
    const response = await request(url, { headers: { cookie: 'dsh-auth=ok' } })
    expect(response.status).toBe(200)
  })
})
