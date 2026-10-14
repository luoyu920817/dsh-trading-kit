/**
 * 客户端面板：打包声明、构建产物与安全断言（review-loop tasks 5.5/5.6）。
 * 断言依赖 `pnpm build` 产物（lib/ 不存在时给出明确提示，沿 review-build 先例）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PANEL_ID, PANEL_REVIEW_BASE_PATH, ORGANIZE_DAY_PROMPT } from '../../src/client/panel/params.ts'
import { REVIEW_BASE_PATH } from '../../src/routes/review.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LIB_DIR = join(REPO_ROOT, 'lib')

function read(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), 'utf8')
}

describe('打包声明（spec「client 打包与宿主 SDK 纪律」）', () => {
  it('exports["./client"] / dsh.client / files 三项齐备', () => {
    const pkg = JSON.parse(read('package.json')) as {
      exports?: Record<string, { default?: string }>
      files?: string[]
      dsh?: { client?: { platform?: string; inject?: unknown } }
    }
    expect(pkg.exports?.['./client']?.default).toBe('./lib/client.js')
    expect(pkg.files).toContain('lib')
    expect(pkg.dsh?.client?.platform).toBe('web')
    expect(Array.isArray(pkg.dsh?.client?.inject)).toBe(true)
    for (const item of pkg.dsh?.client?.inject as unknown[]) {
      expect(typeof item).toBe('string')
    }
    // 运行时依赖的宿主客户端包（slots 注册表 / 会话发送 / 字典）
    expect(pkg.dsh?.client?.inject as string[]).toEqual([
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-layout',
      '@deepseek-ai/dsh-client-ui-sidebar',
      '@deepseek-ai/dsh-client-ui-settings-general',
    ])
  })

  it('dsh.plugin.json#contributes.tools 含 get_stock_basics（与 DATA_TOOL_NAMES 一致）', () => {
    const manifest = JSON.parse(read('dsh.plugin.json')) as { contributes?: { tools?: string[] } }
    expect(manifest.contributes?.tools).toContain('get_stock_basics')
  })
})

describe('构建产物（tasks 5.5）', () => {
  it('lib/client.js 存在且含导航/主页面/设置视图，不调用根会话发送', () => {
    if (!existsSync(LIB_DIR)) {
      throw new Error('lib/ 不存在：先跑 pnpm build，再跑本断言（构建产物验收依赖 pnpm build 产物）')
    }
    const client = read('lib/client.js')
    expect(client).toContain(PANEL_ID)
    expect(client).toContain('复盘卡片')
    expect(client).toContain('关键词任务')
    expect(client).toContain('settings.section')
    expect(client).toContain('/dsh-trader-kit/review/processors#settings')
    expect(client).not.toContain('conversation.send')
    expect(client).toContain('sidebar.panellist')
    expect(client).toContain('main')
  })

  it('宿主 SDK 与 React 不内联（由 loader require 提供共享 React）', () => {
    const client = read('lib/client.js')
    expect(client).toMatch(/require\(["']react["']\)/)
    // 宿主 SDK 零内联：产物中不出现其内部实现特征串。
    for (const text of [client]) {
      expect(text).not.toContain('dsh-client-ui-slots')
      expect(text).not.toContain('createSlotRegistry')
    }
    // 无外链（同源 API 由 basePath 拼接，不写 http(s):// 字面）。
    expect(client).not.toMatch(/https?:\/\//i)
  })

  it('client 源码零外链、零写通道、零 writeKey', () => {
    for (const rel of ['src/client/index.ts', 'src/client/panel/Panel.ts', 'src/client/panel/params.ts']) {
      const text = read(rel)
      expect(text).not.toMatch(/https?:\/\//i)
      expect(text).not.toContain('writeKey')
      expect(text).not.toContain('/api/card')
    }
  })
})

describe('单一事实源一致性（tasks 5.6）', () => {
  it('面板 basePath 与宿主路由常量同值（客户端不 import 宿主模块）', () => {
    expect(PANEL_REVIEW_BASE_PATH).toBe(REVIEW_BASE_PATH)
  })

  it('触发短语与 skill 文本逐字一致（无日期字面量、无插值）', () => {
    const skill = read('skills/review-daily-summary/SKILL.md')
    expect(skill).toContain(ORGANIZE_DAY_PROMPT)
    expect(ORGANIZE_DAY_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(ORGANIZE_DAY_PROMPT).not.toContain('${')
    const params = read('src/client/panel/params.ts')
    // 常量拼接只允许字面量（无变量插值）。
    expect(params).not.toContain('${')
  })
})
