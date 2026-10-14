/**
 * 结构断言测试（change data-foundation tasks 7.3/7.5；评审 Issue 25 扫描域分层）。
 *
 * **扫描域分层**：
 * - 可验证域 = `src/data/**` + `src/index.ts`（必然存在，`targets.length > 0` 由此成立）；
 * - deferred 域 = `src/routes/**`、`src/client/**`（change 4 review-page 落地）与
 *   `src/skill/download.ts`（change 3 tq-skill-installer 落地）——**目录/文件存在时执行**
 *   （本时点三者已存在，检查实际执行），不存在时用例以 `deferred` 命名呈现而非空过。
 *
 * 断言项：① routes/client 不 import src/data/**（允许 service 类型）② 可验证域除
 * src/data/http.ts 外零 fetch(/http.request ③ 17709 无 HTTP 仅 net.connect ④ 无
 * order_stock/cancel_order 调用路径 ⑤ 每条扫描用例先断言目标非空 ⑥ T0/T1/T2 入参
 * schema 无 refresh。
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'
import { registerData } from '../src/service/index.ts'
import { resolveTraderKitConfig } from '../src/config.ts'

const SRC = join(import.meta.dirname, '..', 'src')

/** 7.5 deferred 清单常量（三项目标各占一行且含目标 change 编号）。 */
const DEFERRED_SCAN_DOMAINS: ReadonlyArray<{ label: string; change: string; path: string }> = [
  { label: 'src/routes/**', change: 'change 4 review-page（承载绑定层；既有探针路由 change 1 spike-tdx-embed）', path: join(SRC, 'routes') },
  { label: 'src/client/**', change: 'change 4 review-page', path: join(SRC, 'client') },
  { label: 'src/skill/download.ts', change: 'change 3 tq-skill-installer（第二条具名出站通道）', path: join(SRC, 'skill', 'download.ts') },
]

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  if (statSync(dir).isFile()) return dir.endsWith('.ts') ? [dir] : []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? listTsFiles(p) : e.name.endsWith('.ts') ? [p] : []
  })
}

/** 最小 fake context（真实对象记录调用，零 mock 库；沿 smoke.test.ts 先例）。 */
function createFakeContext(probeEnabled = false) {
  const registeredTools: Array<{ name: string; parameters: Record<string, unknown>; output: unknown; execute: unknown }> = []
  const provided: Record<string, unknown> = {}
  const ctxObj: Record<string, unknown> = {
    webServer: { register: () => () => {}, port: 41000, host: '127.0.0.1' },
    connection: {
      requestRejection: () => 401 as const,
      authenticatedUrl: (u: string) => `${u}?token=stub`,
    },
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
    tools: { register: (tool: { name: string; parameters: Record<string, unknown>; output: unknown; execute: unknown }) => { registeredTools.push(tool); return () => {} } },
    // provide 同时挂到 ctx 上（镜像真实 cordis 行为；review 线依赖 ctx.traderKit 的挂载顺序）。
    provide: (key: string, api: unknown) => { provided[key] = api; (ctxObj as Record<string, unknown>)[key] = api },
    effect: (body: () => unknown, effectName: string) => { body(); return () => {} },
    registeredTools,
    provided,
  }
  const ctx = ctxObj
  const config = resolveTraderKitConfig({ diagnostics: { probe: { enabled: probeEnabled } } })
  return { ctx, config, registeredTools, provided }
}

describe('① routes/client 不 import src/data/**（deferred：change 4 域，存在即执行）', () => {
  it('deferred 域零 data 深层 import（允许 service 类型）', () => {
    expect(DEFERRED_SCAN_DOMAINS.length).toBe(3) // 登记文本完整（7.5）
    const files = DEFERRED_SCAN_DOMAINS.flatMap((d) => listTsFiles(d.path))
    // 目录缺失时目标为空 → 本用例标记 deferred（不空过、不假通过；本时点三者已存在）。
    if (files.length === 0) {
      throw new Error('deferred 域目标为空：src/routes/**、src/client/**、src/skill/download.ts 均不存在（转正条件未满足）')
    }
    expect(files.length).toBeGreaterThan(0)
    const violations = files.filter((f) => {
      const text = readFileSync(f, 'utf8')
      // 任何形如 from '…/data/…' 的 import 都是违规（service 类型走 '../service/index.ts'，不命中）。
      return /from\s+['"][^'"]*\/data\//.test(text)
    })
    expect(violations).toEqual([])
  })
})

describe('② 可验证域除 src/data/http.ts 外零 fetch(/http.request', () => {
  it('src/data/** + src/index.ts：唯一 fetch 调用点为 http.ts（目标非空）', () => {
    const files = listTsFiles(join(SRC, 'data'))
    files.push(join(SRC, 'index.ts'))
    expect(files.length).toBeGreaterThan(0) // 扫描目标非空（可验证域必然存在）
    const offenders = files.filter((f) => {
      if (f.endsWith('http.ts')) return false
      const text = readFileSync(f, 'utf8')
      // 注释提及不计数（如本文件头注释），只匹配实际调用形态。
      return /(^|[^.\w])fetch\s*\(/.test(text.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '')) || /http\.request\s*\(/.test(text)
    })
    expect(offenders).toEqual([])
  })

  it('deferred：src/skill/download.ts 为第二条具名通道（存在时其 fetch 为已登记豁免）', () => {
    const dl = DEFERRED_SCAN_DOMAINS[2]
    if (!existsSync(dl.path)) {
      throw new Error('deferred：src/skill/download.ts 不存在（change 3 未落地）')
    }
    const text = readFileSync(dl.path, 'utf8')
    expect(text).toContain('fetch') // 具名通道本身允许出站（change 3 design D-12 替代护栏）
    // skill 线其余文件零 fetch（具名通道唯一性）。
    const skillFiles = listTsFiles(join(SRC, 'skill')).filter((f) => !f.endsWith('download.ts'))
    expect(skillFiles.length).toBeGreaterThan(0)
    const offenders = skillFiles.filter((f) => /(^|[^.\w])fetch\s*\(/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('③ 17709 无 HTTP 请求、仅 net.connect', () => {
  it('可验证域内 17709 只允许出现在 health.ts（net.connect 探测）与 http.ts（出站拒绝闸）', () => {
    const files = listTsFiles(join(SRC, 'data'))
    expect(files.length).toBeGreaterThan(0)
    const mentions = files.filter((f) => readFileSync(f, 'utf8').includes('17709'))
    expect(mentions.length).toBeGreaterThan(0) // 探测目标被登记
    for (const f of mentions) {
      const text = readFileSync(f, 'utf8')
      const isHealth = f.endsWith('health.ts')
      const isHttpGate = f.endsWith('http.ts')
      expect(isHealth || isHttpGate, `17709 只允许出现在 health.ts / http.ts（命中：${f}）`).toBe(true)
      if (isHealth) {
        expect(text).toContain('node:net')
        expect(text).toMatch(/net\.Socket|net\.connect/)
      }
      if (isHttpGate) {
        // review-loop 白名单例外：闸文件持有唯一端点常量（唯一放行点；其余文件零 17709 URL）。
        expect(text).toContain('TQ_LOCAL_ENDPOINT')
      } else {
        expect(text).not.toMatch(/https?:\/\/[^'"]*17709/) // 无 HTTP URL 指向 17709
      }
    }
  })
})

describe('④ 源码与依赖中不存在 order_stock / cancel_order 调用路径', () => {
  it('src/** 与 package.json 零交易接口调用（扫描目标非空；注释提及不算调用）', () => {
    const files = [...listTsFiles(SRC), join(import.meta.dirname, '..', 'package.json')]
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => {
      const text = readFileSync(f, 'utf8')
      const stripped = text.replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '')
      return /order_stock\s*\(|cancel_order\s*\(/.test(stripped)
    })
    expect(offenders).toEqual([])
  })
})

describe('⑥ T0/T1/T2 入参 schema 无 refresh（属性扫描，keys 非空）', () => {
  it('数据面三工具 schema 不含 refresh / 刷新开关（每日汇总四工具另有同款断言）', () => {
    const { ctx, config, registeredTools } = createFakeContext(false)
    registerData(ctx as never, config, {
      health: { start: () => {}, whenReady: async () => {}, dataStatus: () => ({ probedAt: null, totalTimeoutMs: 3000, targets: {}, warnings: [] }) },
    })
    expect(registeredTools.length).toBe(4)
    const names = registeredTools.map((t) => t.name)
    expect(names).toEqual(['get_trade_date', 'get_limit_reason', 'get_concepts', 'get_stock_basics'])
    for (const tool of registeredTools) {
      // defineTool 编译后的 parameters 为 JSON Schema 对象根：属性键在 .properties 下。
      const params = (tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters
      const keys = Object.keys(params.properties ?? {})
      expect(keys.length, `${tool.name} 入参 schema keys 非空`).toBeGreaterThan(0)
      const serialized = JSON.stringify(params).toLowerCase()
      expect(serialized).not.toContain('refresh')
      // 输出 schema 同样不得出现 refresh。
      expect(JSON.stringify(tool.output ?? {}).toLowerCase()).not.toContain('refresh')
    }
    // T1/T2 必含 code 入参（keys 非空的硬断言）。
    const limitReason = registeredTools.find((t) => t.name === 'get_limit_reason')
    const concepts = registeredTools.find((t) => t.name === 'get_concepts')
    const paramsOf = (t: { parameters: { properties: Record<string, unknown> } }): string[] => Object.keys(t.parameters.properties ?? {})
    expect(paramsOf(limitReason as never)).toContain('code')
    expect(paramsOf(concepts as never)).toContain('code')
  })
})

describe('装配面结构（挂载后可观察，支撑 7.2）', () => {
  it('apply 挂载（probe 关闭）注册 11 工具 + 提供 traderKit data 五出口 + health 两段视图', async () => {
    const { ctx, registeredTools, provided } = createFakeContext(false)
    expect(() => apply(ctx as never, { diagnostics: { probe: { enabled: false } } })).not.toThrow()
    // review-loop 起：数据面 4 + tq_skill_manage + 每日汇总 4 + review-loop 2 = 11（清单见 test/smoke.test.ts）。
    expect(registeredTools.length).toBe(11)
    expect(registeredTools.slice(0, 3).map((t) => t.name)).toEqual(['get_trade_date', 'get_limit_reason', 'get_concepts'])
    const api = provided['traderKit'] as {
      data: Record<string, unknown>
      health: { status(): { data: { warnings: string[] }; skill: unknown } }
    }
    for (const fn of ['resolveTradeDate', 'peekTradeDate', 'getLimitReason', 'getConcepts', 'guardStatus']) {
      expect(typeof api.data[fn], `data.${fn} 出口存在`).toBe('function')
    }
    const status = api.health.status()
    // 波 4 起 change 3 已挂载：skill 段 = skill.status() 的透传（Promise，同一实现）——
    // await 验证它是真实的 SkillStatus 结论（state/targetRoot），不再是 null。
    expect(status.skill).not.toBeNull()
    const skillView = await (status.skill as Promise<{ state: string; targetRoot: string }>)
    expect(typeof skillView.state).toBe('string')
    expect(typeof skillView.targetRoot).toBe('string')
  })
})
