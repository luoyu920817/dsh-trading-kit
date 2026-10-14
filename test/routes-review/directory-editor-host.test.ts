/** 真实宿主配置编辑器离线探针；只使用临时 profile，不接触已安装 profile 或真实 vault。 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import { expect, it } from 'vitest'
import { resolveTraderKitConfig } from '../../src/config.ts'
import type { Context } from '../../src/context-types.ts'
import { createDirectorySettingsHost } from '../../src/routes/directory-settings-host.ts'
import { BASIC_SETTINGS_PATH, createBasicSettingsHandler } from '../../src/routes/basic-settings.ts'

const hostRoot = process.env.DIRECTORY_SETTINGS_HOST_ROOT

interface Entry {
  options: { id: string; name: string; config?: Record<string, unknown> }
  fiber?: { state: number; config: unknown }
}
interface Editor {
  entries(): Entry[]
  edit(entry: Entry, change: (current: Record<string, unknown>, inherited: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}
interface HostContext {
  configEditor: Editor
  fiber: { dispose(): Promise<void> }
  provide(name: string, value: unknown): void
  get(name: string): unknown
  plugin(plugin: unknown): PromiseLike<unknown>
}

/**
 * 在系统临时目录启动真实 Loader、ProfileContext 与 ConfigEditor。
 * 业务逻辑: 用普通配置 fixture 记录激活和销毁，再由真实编辑器保存 profile patch。
 * 关键判断: hostRoot 必须由执行者显式提供；没有真实宿主时测试明确跳过。
 * 异常处理: 启动或断言失败仍销毁宿主并清理已验证位于临时目录内的 fixture。
 * 参数: action 接收真实服务和临时文件路径。
 * 返回: action 完成后的 Promise。
 */
async function withHost(action: (ctx: HostContext, root: string, patch: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'trader-kit-directory-editor-'))
  const patch = join(root, 'cordis.patch.yml')
  let ctx: HostContext | undefined
  try {
    await mkdir(join(root, 'home'))
    for (const directory of ['DB/stock', '交易系统/平常心/方法论/模式', '研究/标的', '研究/模式']) await mkdir(join(root, directory), { recursive: true })
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'directory-editor-offline-probe', private: true, dsh: { profile: { bundles: [] } } }))
    await writeFile(join(root, 'cordis.yml'), '[]\n')
    await writeFile(join(root, 'fixture.mjs'), [
      "import { appendFileSync } from 'node:fs'",
      "export const name = 'directory-fixture'",
      'export const Config = { "~standard": { version: 1, vendor: "directory-editor-probe", validate(value) {',
      '  return typeof value.directories?.stock === "string" && typeof value.directories?.patterns === "string"',
      '    ? { value } : { issues: [{ message: "directory strings required" }] }',
      '} } }',
      '/**',
      ' * 记录普通配置变更后的真实 Loader 生命周期。',
      ' * 业务逻辑: 激活追加当前目录，销毁追加旧目录。',
      ' * 关键判断: FAIL_ACTIVATION与FAIL_EXECUTION_ACTIVATION为离线probe指定失败值。',
      ' * 异常处理: 激活失败抛错，由真实 ConfigEditor 恢复原 profile。',
      ' * 参数: ctx 为实际 Cordis 上下文，config 为 schema 验证后的普通配置。',
      ' * 返回: 无；生命周期日志只写入系统临时 fixture。',
      ' */',
      'export function apply(ctx, config) {',
      '  if (config.directories.stock === "FAIL_ACTIVATION") throw new Error("directory fixture activation failed")',
      '  if (config.review?.processing?.provider === "FAIL_EXECUTION_ACTIVATION") throw new Error("execution fixture activation failed")',
      '  ctx.provide("directoryFixtureOwner", ctx)',
      `  const log = ${JSON.stringify(join(root, 'lifecycle.log'))}`,
      '  appendFileSync(log, `activate:${config.directories.stock}\\n`)',
      '  ctx.effect(() => () => appendFileSync(log, `dispose:${config.directories.stock}\\n`))',
      '}',
      '',
    ].join('\n'))
    await writeFile(patch, '# preserve-host-comment\n' + JSON.stringify([{ insert: [{
      id: 'directory-fixture', name: pathToFileURL(join(root, 'fixture.mjs')).href, config: {
        dataRoot: root, directories: { stock: 'DB/stock', patterns: '交易系统/平常心/方法论/模式' },
        review: { writeKey: 'OFFLINE_FIXED_SECRET', processing: { enabled: false, model: 'KEEP_MODEL' } },
      },
    }] }], null, 2) + '\n')
    const { boot, readProfilePatches } = await import(pathToFileURL(join(hostRoot!, '@deepseek-ai/dsh-app-boot/lib/index.js')).href)
    const { default: ConfigEditor } = await import(pathToFileURL(join(hostRoot!, '@deepseek-ai/dsh-settings/node_modules/@deepseek-ai/dsh-config-editor/lib/index.js')).href)
    const { default: NativeDirectoryPicker } = await import(pathToFileURL(join(hostRoot!, '@deepseek-ai/dsh-web-app/node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/index.js')).href)
    const profile = {
      name: 'offline-directory-probe', dir: root, patchPath: patch,
      installAnchor: join(root, 'package.json'), cwd: root, home: join(root, 'home'),
      startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    }
    ctx = await boot('dsh', join(root, 'cordis.yml'), readProfilePatches('dsh', profile), async (prepared: HostContext) => {
      prepared.provide('profileContext', profile)
      await prepared.plugin(ConfigEditor)
      await prepared.plugin(NativeDirectoryPicker)
    }) as HostContext
    await action(ctx, root, patch)
  } finally {
    await ctx?.fiber.dispose()
    const normalized = resolve(root)
    if (!normalized.startsWith(resolve(tmpdir()) + sep) || !normalized.includes('trader-kit-directory-editor-')) {
      throw new Error('Unsafe offline directory fixture cleanup')
    }
    await rm(normalized, { recursive: true, force: true })
  }
}

it.skipIf(!hostRoot)('真实 ConfigEditor：普通目录配置持久保存、保留其他字段并完成自身重载', async () => {
  await withHost(async (ctx, root, patch) => {
    const entry = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')
    expect(entry).toBeDefined()
    await ctx.configEditor.edit(entry!, current => ({ ...current, directories: { stock: '研究/标的', patterns: '研究/模式' } }))
    const active = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')
    expect(active!.fiber!.state).toBe(2)
    expect(active!.fiber!.config).toEqual({
      dataRoot: root, directories: { stock: '研究/标的', patterns: '研究/模式' },
      review: { writeKey: 'OFFLINE_FIXED_SECRET', processing: { enabled: false, model: 'KEEP_MODEL' } },
    })
    expect(await readFile(patch, 'utf8')).toContain('# preserve-host-comment')
    expect(await readFile(patch, 'utf8')).toContain('OFFLINE_FIXED_SECRET')
    expect(await readFile(patch, 'utf8')).toContain('研究/标的')
    expect(await readFile(join(root, 'lifecycle.log'), 'utf8')).toBe('activate:DB/stock\ndispose:DB/stock\nactivate:研究/标的\n')
  })
})

it.skipIf(!hostRoot)('执行HTTP保存：真实编辑器返回成功、非法目录400与CAS409，认证失败不改profile', async () => {
  await withHost(async (ctx, root, patch) => {
    const entry = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    const config = resolveTraderKitConfig(entry.options.config)
    const host = createDirectorySettingsHost(ctx.get('directoryFixtureOwner') as Context, config)
    const handler = createBasicSettingsHandler({ config, directoryHost: host, requestRejection: req => req.headers['x-fence'] === '1' ? 403 : req.headers.cookie === 'dsh-auth=ok' ? undefined : 401 })
    const server = createServer((req, res) => { void handler(req, res) })
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('HTTP_ADDRESS_UNAVAILABLE')
    const url = `http://127.0.0.1:${address.port}${BASIC_SETTINGS_PATH}/save-execution`
    const headers = { cookie: 'dsh-auth=ok', 'content-type': 'application/json' }
    const revision = host.executionEditing!().revision!
    const draft = { enabled: true, provider: 'fixture-provider', model: 'fixture-model', cwd: root }
    const before = await readFile(patch, 'utf8')
    try {
      for (const [requestHeaders, status] of [[{ 'content-type': 'application/json', 'x-write-key': 'OFFLINE_FIXED_SECRET' }, 401], [{ ...headers, 'x-fence': '1' }, 403]] as const) {
        const response = await fetch(url, { method: 'POST', headers: requestHeaders, body: JSON.stringify({ revision, processing: draft }), redirect: 'error' })
        expect(response.status).toBe(status)
        expect(await readFile(patch, 'utf8')).toBe(before)
      }
      const invalid = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ revision, processing: { ...draft, cwd: join(root, 'absent') } }), redirect: 'error' })
      expect(invalid.status).toBe(400)
      expect((await invalid.json()).error).toBe('INVALID_EXECUTION_CONFIG')
      const conflict = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ revision: '0'.repeat(64), processing: draft }), redirect: 'error' })
      expect(conflict.status).toBe(409)
      expect((await conflict.json()).error).toBe('CONFIG_CONFLICT')
      expect(await readFile(patch, 'utf8')).toBe(before)
      const saved = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ revision, processing: draft }), redirect: 'error' })
      expect(saved.status).toBe(200)
      expect(await saved.json()).toEqual({ saved: true })
      expect(await readFile(patch, 'utf8')).toContain('OFFLINE_FIXED_SECRET')
      const active = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
      expect(active.fiber!.state).toBe(2)
      expect((active.options.config!.review as { processing: unknown }).processing).toEqual(draft)
    } finally { await new Promise<void>((done, reject) => server.close(error => error ? reject(error) : done())) }
  })
})

it.skipIf(!hostRoot)('执行配置：实际宿主保存、重载、CAS、保留其它配置，非法目录与缺模型不落盘', async () => {
  await withHost(async (ctx, root, patch) => {
    const entry = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    const current = entry.options.config!
    await ctx.configEditor.edit(entry, () => ({ ...current, review: { ...(current.review as object), processing: { enabled: false, model: 'KEEP_MODEL', maxTokens: 777, agentAttemptLimit: 13, future: 'keep' } }, future: 'retain' }))
    const active = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    const owner = ctx.get('directoryFixtureOwner') as Context
    const host = createDirectorySettingsHost(owner, resolveTraderKitConfig(active.options.config))
    const editing = host.executionEditing!()
    expect(editing.available).toBe(true)
    const before = await readFile(patch, 'utf8')
    for (const processing of [{ enabled: true, provider: 'provider', model: '', cwd: root }, { enabled: true, provider: 'provider', model: 'model', cwd: join(root, 'absent') }, { enabled: true, provider: 'provider', model: 'model', cwd: 'relative' }]) {
      await expect(host.saveExecution!(editing.revision!, processing)).rejects.toThrow('INVALID_EXECUTION_CONFIG')
      expect(await readFile(patch, 'utf8')).toBe(before)
    }
    const processing = { enabled: true, provider: 'provider', model: 'model', cwd: root }
    await expect(host.saveExecution!('0'.repeat(64), processing)).rejects.toThrow('CONFIG_CONFLICT')
    expect(await readFile(patch, 'utf8')).toBe(before)
    await expect(host.saveExecution!(editing.revision!, { ...processing, provider: 'FAIL_EXECUTION_ACTIVATION' })).rejects.toThrow('execution fixture activation failed')
    expect(await readFile(patch, 'utf8')).toBe(before)
    const restored = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    expect(restored.fiber!.state).toBe(2)
    expect(restored.options.config).toEqual(active.options.config)
    const restoredHost = createDirectorySettingsHost(ctx.get('directoryFixtureOwner') as Context, resolveTraderKitConfig(restored.options.config))
    await restoredHost.saveExecution!(restoredHost.executionEditing!().revision!, processing)
    const saved = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    expect(saved.fiber!.state).toBe(2)
    expect(saved.options.config).toEqual({ ...active.options.config, review: { writeKey: 'OFFLINE_FIXED_SECRET', processing: { ...processing, maxTokens: 777, agentAttemptLimit: 13, future: 'keep' } } })
    const fresh = createDirectorySettingsHost(ctx.get('directoryFixtureOwner') as Context, resolveTraderKitConfig(saved.options.config))
    expect(fresh.executionEditing!().revision).not.toBe(editing.revision)
    await fresh.saveExecution!(fresh.executionEditing!().revision!, { enabled: false, provider: '', model: '', cwd: '' })
    const stopped = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    expect((stopped.options.config!.review as { processing: unknown }).processing).toEqual({ enabled: false, provider: '', model: '', cwd: '', maxTokens: 777, agentAttemptLimit: 13, future: 'keep' })
    expect(await readFile(patch, 'utf8')).toContain('OFFLINE_FIXED_SECRET')
  })
})

it.skipIf(!hostRoot)('真实 ConfigEditor：重载失败恢复原 profile 和原目录，未将失败保存当作成功', async () => {
  await withHost(async (ctx, root, patch) => {
    const entry = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')
    expect(entry).toBeDefined()
    const before = await readFile(patch, 'utf8')
    await expect(ctx.configEditor.edit(entry!, current => ({
      ...current, directories: { stock: 'FAIL_ACTIVATION', patterns: '研究/模式' },
    }))).rejects.toThrow('directory fixture activation failed')
    expect(await readFile(patch, 'utf8')).toBe(before)
    const restored = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')
    expect(restored!.fiber!.state).toBe(2)
    expect(restored!.fiber!.config).toEqual({
      dataRoot: root, directories: { stock: 'DB/stock', patterns: '交易系统/平常心/方法论/模式' },
      review: { writeKey: 'OFFLINE_FIXED_SECRET', processing: { enabled: false, model: 'KEEP_MODEL' } },
    })
    expect(await readFile(join(root, 'lifecycle.log'), 'utf8')).toBe('activate:DB/stock\ndispose:DB/stock\nactivate:DB/stock\n')
  })
})

it.skipIf(!hostRoot)('生产目录适配器：真实插件 owner 与宿主服务可用，CAS保存真实文件夹并自重载', async () => {
  await withHost(async (ctx, root, patch) => {
    const owner = ctx.get('directoryFixtureOwner') as Context
    expect(Boolean(owner)).toBe(true)
    const entry = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    const host = createDirectorySettingsHost(owner, resolveTraderKitConfig(entry.options.config))
    const editing = host.editing()
    expect(editing.available).toBe(true)
    expect(editing.revision).toMatch(/^[a-f0-9]{64}$/)
    const before = await readFile(patch, 'utf8')
    // 实际 Win32 实现在创建原生子进程前拒绝已取消信号，因此这项探针不会打开窗口。
    if (process.platform === 'win32') {
      const cancelled = new AbortController()
      cancelled.abort()
      await expect(host.choose(cancelled.signal)).rejects.toThrow('native directory picker aborted')
      expect(await readFile(patch, 'utf8')).toBe(before)
    }
    await expect(host.save('0'.repeat(64), { stock: '研究/标的', patterns: '研究/模式' })).rejects.toThrow('CONFIG_CONFLICT')
    expect(await readFile(patch, 'utf8')).toBe(before)
    await host.save(editing.revision!, { stock: '研究/标的', patterns: '研究/模式' })
    const active = ctx.configEditor.entries().find(candidate => candidate.options.id === 'directory-fixture')!
    expect(active.fiber!.state).toBe(2)
    expect(active.options.config).toEqual({
      dataRoot: root, directories: { stock: '研究/标的', patterns: '研究/模式' },
      review: { writeKey: 'OFFLINE_FIXED_SECRET', processing: { enabled: false, model: 'KEEP_MODEL' } },
    })
    const freshOwner = ctx.get('directoryFixtureOwner') as Context
    const reloaded = createDirectorySettingsHost(freshOwner, resolveTraderKitConfig(active.options.config)).editing()
    expect(reloaded.available).toBe(true)
    expect(reloaded.revision).not.toBe(editing.revision)
    expect(await readFile(join(root, 'lifecycle.log'), 'utf8')).toBe('activate:DB/stock\ndispose:DB/stock\nactivate:研究/标的\n')
    expect(await readFile(patch, 'utf8')).toContain('OFFLINE_FIXED_SECRET')
  })
})
