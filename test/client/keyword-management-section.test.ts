import { expect, it } from 'vitest'
import { ReviewPanelIcon, TraderKitSettings, WORKSPACE_PAGES, reviewCardPage } from '../../src/client/panel/Workspace.ts'
import { apply } from '../../src/client/index.ts'
import { PANEL_ID } from '../../src/client/panel/params.ts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'

const extracted = process.env.KEYWORD_HOST_PROBE_ROOT

it('标的导航不补全或猜测，保留市场与前导零，禁止任意地址', () => {
  expect(reviewCardPage(' sz000001 ')).toBe('/dsh-trader-kit/review/sz000001')
  expect(reviewCardPage('600000.SH')).toBe('/dsh-trader-kit/review/600000.SH')
  expect(reviewCardPage('000001')).toBe('/dsh-trader-kit/review/000001')
  for (const invalid of ['', '60000', '6000000', '../600000', 'https://example.com', '600000?date=2020-01-01']) expect(reviewCardPage(invalid)).toBeNull()
})

/**
 * 载入安装宿主的原样注册器区段和真实Cordis/SlotCore。
 * 业务逻辑: 注册路径无需ReactDOM，仅评估原样registry区段。
 * 关键判断: 不替换slots/effect，不用React或服务stub，不验证浏览器渲染。
 * 异常处理: 源码区域缺失拒绝测试。参数: 无。返回: 实际Context与SlotRegistry构造器。
 */
async function installedRegistry() {
  const cordis = await import(pathToFileURL(join(extracted!, '@deepseek-ai/cordis/lib/index.js')).href)
  const slots = await import(pathToFileURL(join(extracted!, '@deepseek-ai/dsh-client-ui-slots/lib/index.js')).href)
  const source = await readFile(join(extracted!, '@deepseek-ai/dsh-client-ui-renderer/lib/client.js'), 'utf8')
  const start = source.indexOf('const ROOT_INSTANCE_KEY = "root";')
  const end = source.indexOf('//#endregion', start)
  expect(start).toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  const SlotRegistry = runInNewContext(source.slice(start, end) + '\nSlotRegistry', { _deepseek_ai_cordis: cordis, _deepseek_ai_dsh_client_ui_slots: slots, console, queueMicrotask })
  return { Context: cordis.Context, SlotRegistry }
}

it('侧栏只有尺寸匹配的图标，主页面固定同源，设置独立呈现配置', () => {
  const icon = ReviewPanelIcon({ size: 18 })
  expect(icon.type).toBe('svg')
  expect(icon.props.width).toBe(18)
  expect(JSON.stringify(icon)).not.toContain('iframe')
  expect(JSON.stringify(icon)).not.toContain('整理今日复盘')
  expect(WORKSPACE_PAGES.cards.path).toBe('/dsh-trader-kit/review')
  expect(WORKSPACE_PAGES.runs.path).toBe('/dsh-trader-kit/review/processors#runs')
  const settings = TraderKitSettings()
  expect(settings.type).toBe('iframe')
  expect(settings.props.src).toBe('/dsh-trader-kit/review/processors#settings')
  expect(settings.props.title).toBe('交易工作流设置')
  expect(settings.props).not.toHaveProperty('dangerouslySetInnerHTML')
})

it.skipIf(!extracted)('真实 keyed main 接收页面，导航仅图标，设置页延迟声明与卸载均释放', async () => {
  const { Context, SlotRegistry } = await installedRegistry()
  const ctx = new Context()
  new SlotRegistry(ctx)
  const releaseShell = ctx.slots.register({ name: 'root', children: { 'sidebar.panellist': { kind: 'list', scope: 'root' }, main: { kind: 'keyed', scope: 'root' } } }, () => null)
  const plugin = ctx.plugin(apply)
  await plugin
  try {
    expect(ctx.slots.entries('sidebar.panellist').map((e: { options: { id: string } }) => e.options.id)).toContain(PANEL_ID)
    expect(ctx.slots.entries('main')).toHaveLength(1)
    expect(ctx.slots.entries('main')[0].options.key).toBe(PANEL_ID)
    const releaseDetails = ctx.slots.register({ name: 'main', key: 'test-settings', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => null)
    expect(ctx.slots.entries('settings.section').map((e: { options: { id: string } }) => e.options.id)).toContain('trader-kit-settings')
    releaseDetails()
    expect(ctx.slots.entries('main')).toHaveLength(1)
    await plugin.dispose()
    expect(ctx.slots.entries('sidebar.panellist')).toHaveLength(0)
    expect(ctx.slots.entries('main')).toHaveLength(0)
    const releaseAfterUnload = ctx.slots.register({ name: 'main', key: 'later-settings', children: { 'settings.section': { kind: 'list', scope: 'root' } } }, () => null)
    expect(ctx.slots.entries('settings.section')).toHaveLength(0)
    releaseAfterUnload()
  } finally {
    await plugin.dispose()
    releaseShell()
  }
})

it.skipIf(!extracted)('真实Cordis缺slots服务时客户端加载降级且不抛出', async () => {
  const { Context } = await installedRegistry()
  const ctx = new Context()
  const plugin = ctx.plugin(apply)
  try {
    await plugin
    expect(plugin.state).toBe(2)
    expect(ctx.get('slots')).toBeUndefined()
  } finally {
    await plugin.dispose()
  }
})
