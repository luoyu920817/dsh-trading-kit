/**
 * 构建产物与发包白名单验收（change 4 tasks 7.1；design D-2 资产形态定案①内联）。
 * 断言依赖 `pnpm build` 产物：lib/ 不存在或缺标记时给出明确文案提示先跑构建
 *（沿 test/probe/probe-build.test.ts 先例）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REVIEW_HTML, REVIEW_PAGE_MARKER, REVIEW_STATE_PLACEHOLDER } from '../../src/client/review/index.html.ts'
import { REVIEW_PAGE_PATH } from '../../src/routes/review.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LIB_DIR = join(REPO_ROOT, 'lib')

function libJsFiles(): string[] {
  return readdirSync(LIB_DIR, { recursive: true })
    .map(String)
    .filter((rel) => rel.endsWith('.js'))
}

describe('构建产物（tasks 7.1：内联资产随包发布）', () => {
  it('lib/ 存在——不存在则明确提示先跑 pnpm build', () => {
    if (!existsSync(LIB_DIR)) {
      throw new Error('lib/ 不存在：先跑 pnpm build，再跑本断言（构建产物验收依赖 pnpm build 产物）')
    }
    expect(existsSync(LIB_DIR)).toBe(true)
  })

  it('lib/** 含复盘页标记、注入占位符、复盘路由路径与四区块骨架（内联进产物，非运行时读盘）', () => {
    const files = libJsFiles()
    expect(files.length).toBeGreaterThan(0)
    const contents = files.map((rel) => readFileSync(join(LIB_DIR, rel), 'utf8'))
    expect(contents.some((text) => text.includes(REVIEW_PAGE_MARKER)), '复盘页标记未进构建产物').toBe(true)
    expect(contents.some((text) => text.includes(REVIEW_STATE_PLACEHOLDER)), '注入占位符未进构建产物').toBe(true)
    expect(contents.some((text) => text.includes(REVIEW_PAGE_PATH)), '复盘路由路径未进构建产物').toBe(true)
    expect(contents.some((text) => text.includes('id="rv-b1"')), '四区块骨架未进构建产物').toBe(true)
  })

  it('lib/** 的复盘页文本与 src 常量同源（内联定案①：无拷贝漂移）', () => {
    const files = libJsFiles()
    const contents = files.map((rel) => readFileSync(join(LIB_DIR, rel), 'utf8'))
    const excerpt = REVIEW_HTML.split('\n').filter((l) => l.includes('rv-limit'))[0] ?? ''
    expect(excerpt).not.toBe('')
    expect(contents.some((text) => text.includes(excerpt.trim()))).toBe(true)
  })

  it('package.json#files 含 lib（发包白名单；内联方案无需 lib/assets 条目）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { files?: unknown }
    expect(Array.isArray(pkg.files)).toBe(true)
    expect(pkg.files as string[]).toContain('lib')
  })

  it('从 lib/ 构建产物加载复盘模块：REVIEW_HTML 导出完整且含页面标记', async () => {
    if (!existsSync(LIB_DIR)) {
      throw new Error('lib/ 不存在：先跑 pnpm build，再跑本断言（构建产物验收依赖 pnpm build 产物）')
    }
    const built = (await import(pathToFileURL(join(LIB_DIR, 'client', 'review', 'index.html.js')).href)) as
      typeof import('../../src/client/review/index.html.ts')
    expect(built.REVIEW_HTML).toContain(REVIEW_PAGE_MARKER)
    expect(built.REVIEW_HTML).toContain(REVIEW_STATE_PLACEHOLDER)
    expect(built.REVIEW_HTML).not.toMatch(/https?:\/\//i) // 产物同样无外链
  })
})
