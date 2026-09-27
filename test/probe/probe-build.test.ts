/**
 * 构建产物与发包白名单验收（tasks 1.10；design D-2 内联定案）。
 *
 * 断言依赖 `pnpm build` 产物：lib/ 不存在或缺标记时给出明确文案提示先跑构建。
 * 内联 TS 模板字符串方案下，探针页随 entry 模块图进 lib/**，运行时零读盘资产
 * （无 ENOENT 误判「承载不可行」的通道）；「从 lib/ 启动后 GET PROBE_PATH 返回
 * 200 且 text/html 非空」的完整链路属真实宿主集成核对（spec），插件层以
 * 「产物含页面标记 + handler 恒从内存模板出页」组合断言。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PROBE_PAGE_MARKER, PROBE_STATE_PLACEHOLDER } from '../../src/client/probe/index.html.ts'
import { PROBE_PATH } from '../../src/routes/probe.ts'
import { injectedState, makeReq, makeRes } from './helpers.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const LIB_DIR = join(REPO_ROOT, 'lib')

function libUrl(rel: string): string {
  return pathToFileURL(join(LIB_DIR, rel)).href
}

function libJsFiles(): string[] {
  return readdirSync(LIB_DIR, { recursive: true })
    .map(String)
    .filter((rel) => rel.endsWith('.js'))
}

describe('构建产物（tasks 1.10）', () => {
  it('lib/ 存在——不存在则明确提示先跑 pnpm build', () => {
    if (!existsSync(LIB_DIR)) {
      throw new Error('lib/ 不存在：先跑 pnpm build，再跑本断言（构建产物验收依赖 pnpm build 产物）')
    }
    expect(existsSync(LIB_DIR)).toBe(true)
  })

  it('lib/** 含探针页标记、注入占位符与探针路由路径（内联进产物，非运行时读盘）', () => {
    const files = libJsFiles()
    expect(files.length).toBeGreaterThan(0)
    const contents = files.map((rel) => readFileSync(join(LIB_DIR, rel), 'utf8'))
    expect(contents.some((text) => text.includes(PROBE_PAGE_MARKER)), '探针页标记未进构建产物').toBe(true)
    expect(contents.some((text) => text.includes(PROBE_STATE_PLACEHOLDER)), '注入占位符未进构建产物').toBe(true)
    expect(contents.some((text) => text.includes(PROBE_PATH)), '探针路由路径未进构建产物').toBe(true)
  })

  it('package.json#files 含 lib（发包白名单；内联方案无需 lib/assets 条目）', () => {
    const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as { files?: unknown }
    expect(Array.isArray(pkg.files)).toBe(true)
    expect(pkg.files as string[]).toContain('lib')
  })

  it('从 lib/ 构建产物加载探针 handler：GET PROBE_PATH → 200 + text/html 非空 + 内联解析函数自包含可用', async () => {
    if (!existsSync(LIB_DIR)) {
      throw new Error('lib/ 不存在：先跑 pnpm build，再跑本断言（构建产物验收依赖 pnpm build 产物）')
    }
    // 构建产物以 file:// 动态加载（Node 加载 ESM 产物的方式；产物无 .d.ts，
    // 用 src 侧类型作结构断言）。计算型 specifier 不参与编译期解析。
    const [builtProbe, builtHtml, builtParams] = (await Promise.all([
      import(libUrl('routes/probe.js')),
      import(libUrl('client/probe/index.html.js')),
      import(libUrl('client/probe/params.js')),
    ])) as [
      typeof import('../../src/routes/probe.ts'),
      typeof import('../../src/client/probe/index.html.ts'),
      typeof import('../../src/client/probe/params.ts'),
    ]
    expect(builtProbe.PROBE_PATH).toBe(PROBE_PATH)
    expect(builtHtml.PROBE_HTML).toContain(PROBE_PAGE_MARKER)
    const handler = builtProbe.createProbeHandler({
      template: builtHtml.PROBE_HTML,
      diagnosticToken: 'tok-built',
      requestRejection: () => undefined,
      basePath: '/dsh-trader-kit',
      port: 41000,
      unauthenticatedReadonly: false,
    })
    const { res, rec } = makeRes()
    handler(makeReq(), res)
    expect(rec.status).toBe(200)
    expect(rec.headers['Content-Type']).toBe('text/html; charset=utf-8')
    expect(rec.headers['Cache-Control']).toBe('no-store')
    expect(rec.body.length).toBeGreaterThan(0)
    const state = injectedState(rec.body)
    expect(state.auth).toBe('cookie')
    expect(state.port).toBe(41000)
    // 构建产物内联的解析函数：序列化源自包含（可重建）且行为正确
    const builtSrc = String(builtParams.parseProbeParams)
    expect(builtSrc.length).toBeGreaterThan(0)
    expect(rec.body).toContain(builtSrc)
    const builtFn = new Function('return (' + builtSrc + ')')() as (hash: string, search: string, pathname: string, routePath: string) => { resolvedValue: string | null; valid: boolean }
    const parsed = builtFn('#600000', '', PROBE_PATH, PROBE_PATH)
    expect(parsed.resolvedValue).toBe('600000')
    expect(parsed.valid).toBe(true)
  })
})
