/**
 * 探针线装配结构断言 + 边界扫描（tasks 1.1/1.2/1.9；design D-1/D-10）。
 *
 * 「路由注册/卸载」按 tasks 1.2 属**集成核对项**：本文件用 `ctx.effect` 的
 * disposer 契约做插件层结构断言（fake context 为真实对象、记录调用，零 mock
 * 库），不写成「零 mock 单测」；真实宿主内的注册/卸载与宿主 fallback 状态码
 * 由人工/集成核对（spec「诊断页开关」）。
 *
 * 边界扫描（tasks 1.1 偏离裁决 + R2-7）：扫描域收窄为 src/routes/** 与
 * src/client/**——探针自有文件不引入配置面导出、不 import src/config.ts；
 * 出站通道调用点扫描的目标 = test/** 源文件文本（PROBE_HTML 常量文本不计入
 * 目标，§7/R2-7 豁免），标记经字符串拼接构造以避免自匹配。
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DIAGNOSTICS_DEFAULT, mountProbe, PROBE_BASE_PATH, PROBE_PATH, registerProbe, UNAUTHENTICATED_READONLY_DEFAULT } from '../../src/routes/probe.ts'
import type { Context, TraderKitWebRoute } from '../../src/context-types.ts'
import { makeReq, makeRes } from './helpers.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

/** 记录型 fake context：真实对象 + 数组记录，无 mock 库（沿 smoke.test.ts 先例）。 */
function createHarness() {
  const routes: TraderKitWebRoute[] = []
  const logs: string[] = []
  const disposers: Array<() => void> = []
  const ctx = {
    logger: (name?: string) => ({
      info: (...args: unknown[]) => {
        logs.push(['info', name ?? '', ...args.map(String)].join(' '))
      },
      warn: (...args: unknown[]) => {
        logs.push(['warn', name ?? '', ...args.map(String)].join(' '))
      },
      error: () => {},
      debug: () => {},
    }),
    effect: (body: () => unknown, label?: string) => {
      const disposer = body()
      if (typeof disposer === 'function') {
        disposers.push(disposer as () => void)
      }
      logs.push('effect:' + String(label))
      return async () => {}
    },
    webServer: {
      register: (route: TraderKitWebRoute) => {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) {
            routes.splice(index, 1)
          }
        }
      },
      port: 41000,
      host: '127.0.0.1',
    },
    connection: {
      requestRejection: (req: { headers?: Record<string, string | string[] | undefined> }) =>
        typeof req.headers?.cookie === 'string' && req.headers.cookie.includes('dsh-auth=ok') ? undefined : 401,
      authenticatedUrl: (url: string) => url + '?token=stub-launch-token',
    },
  } as unknown as Context
  return { ctx, routes, logs, disposers }
}

describe('模块常量（tasks 1.1）', () => {
  it('PROBE_PATH = /dsh-trader-kit/probe，basePath 由其派生', () => {
    expect(PROBE_PATH).toBe('/dsh-trader-kit/probe')
    expect(PROBE_BASE_PATH).toBe('/dsh-trader-kit')
  })

  it('DIAGNOSTICS_DEFAULT = true（spike 后常驻诊断页）', () => {
    expect(DIAGNOSTICS_DEFAULT).toBe(true)
  })

  it('UNAUTHENTICATED_READONLY_DEFAULT = false（C 层代码常量，默认关闭，非配置项）', () => {
    expect(UNAUTHENTICATED_READONLY_DEFAULT).toBe(false)
  })
})

describe('路由注册/卸载（集成核对项的插件层结构断言，tasks 1.2）', () => {
  it('registerProbe（默认开关）注册恰一条 exact 探针路由，handler 为函数', () => {
    const h = createHarness()
    registerProbe(h.ctx)
    expect(h.routes).toHaveLength(1)
    expect(h.routes[0].kind).toBe('exact')
    expect(h.routes[0].path).toBe(PROBE_PATH)
    expect(typeof h.routes[0].handler).toBe('function')
    expect(h.logs).toContain('effect:dsh-trader-kit: probe route')
  })

  it('挂载打印三行 URL + B 层诊断 token（端口由插件打印，随机分配值不人工猜）', () => {
    const h = createHarness()
    registerProbe(h.ctx)
    const joined = h.logs.join('\n')
    expect(joined).toContain('http://127.0.0.1:41000')
    expect(joined).toContain('http://127.0.0.1:41000/dsh-trader-kit/probe')
    // 登录 URL = ctx.connection.authenticatedUrl(base + '/')（A 层第一步铸 cookie）
    const loginLine = h.logs.find((line) => line.includes('登录 URL'))
    expect(loginLine).toBeDefined()
    expect(loginLine).toContain('http://127.0.0.1:41000/?token=stub-launch-token')
    // B 层诊断 token：挂载时 randomBytes 生成、仅日志可见（64 位 hex）
    const tokenLine = h.logs.find((line) => line.includes('诊断 token'))
    expect(tokenLine).toBeDefined()
    expect(/[0-9a-f]{64}/.test(tokenLine ?? '')).toBe(true)
  })

  it('disposer 卸载：无残留 handler（路由表清空）', () => {
    const h = createHarness()
    registerProbe(h.ctx)
    expect(h.routes).toHaveLength(1)
    for (const disposer of h.disposers) {
      disposer()
    }
    expect(h.routes).toHaveLength(0)
  })

  it('诊断页关闭（DIAGNOSTICS_DEFAULT=false 语义）：不注册探针路由、无残留 handler、不打印探针 URL', () => {
    const h = createHarness()
    mountProbe(h.ctx, { diagnosticsEnabled: false })
    expect(h.routes).toHaveLength(0)
    expect(h.disposers).toHaveLength(0)
    expect(h.logs.some((line) => line.startsWith('warn'))).toBe(true)
    expect(h.logs.some((line) => line.includes('探针 URL'))).toBe(false)
  })

  it('接线冒烟：注册的 handler 经 ctx.connection.requestRejection 判定（401/200 两态）', () => {
    const h = createHarness()
    registerProbe(h.ctx)
    const handler = h.routes[0].handler
    const denied = makeRes()
    handler(makeReq({ headers: {} }), denied.res)
    expect(denied.rec.status).toBe(401)
    expect(denied.rec.body).toBe('')
    const allowed = makeRes()
    handler(makeReq({ headers: { cookie: 'dsh-auth=ok' } }), allowed.res)
    expect(allowed.rec.status).toBe(200)
    expect(allowed.rec.body).toContain('dsh-trader-kit-probe-page')
  })
})

describe('cordis.patch.yml 无 config 段（tasks 1.1 验收；文件 owner = change 2）', () => {
  it('活动行（非注释）不出现 config 键', () => {
    const patch = readFileSync(join(REPO_ROOT, 'cordis.patch.yml'), 'utf8')
    const activeLines = patch.split(/\r?\n/).filter((line) => !line.trimStart().startsWith('#'))
    expect(activeLines.length).toBeGreaterThan(0)
    expect(activeLines.some((line) => /^\s*config\s*:/.test(line))).toBe(false)
  })
})

describe('边界扫描：配置面（tasks 1.1 偏离裁决——扫描域收窄为 src/routes/** 与 src/client/**）', () => {
  it('扫描目标非空（防空过）', () => {
    expect(collectLaneFiles().length).toBeGreaterThan(0)
  })

  it('探针自有文件不引入配置面导出（export const Config / change 2 配置类型名）', () => {
    for (const rel of collectLaneFiles()) {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8')
      expect(content, rel).not.toMatch(/export\s+const\s+Config\b/)
      expect(content, rel).not.toContain('TraderKitConfig')
    }
  })

  it('探针自有文件不 import src/config.ts（配置面唯一 owner = change 2）', () => {
    for (const rel of collectLaneFiles()) {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8')
      expect(content, rel).not.toMatch(/from\s*['"][^'"]*config(\.ts)?['"]/)
    }
  })
})

describe('边界扫描：出站通道调用点（tasks 1.9；§7/R2-7 补充口径）', () => {
  it('test/** 无 fetch / http 请求调用点（标记拼接构造，避免自匹配）', () => {
    const markers = ['fet' + 'ch(', 'http' + '.request']
    const targets = collectTestFiles()
    expect(targets.length).toBeGreaterThan(0)
    for (const file of targets) {
      const content = readFileSync(file, 'utf8')
      for (const marker of markers) {
        expect(content.includes(marker), file + ' 含出站调用点 ' + marker).toBe(false)
      }
    }
  })

  it('探针自有源文件（src/routes/probe.ts + src/client/probe/**）无出站调用点', () => {
    const markers = ['fet' + 'ch(', 'http' + '.request']
    const lane = ['src/routes/probe.ts', ...collectProbeClientFiles()]
    expect(lane.length).toBeGreaterThan(0)
    for (const rel of lane) {
      const content = readFileSync(join(REPO_ROOT, rel), 'utf8')
      for (const marker of markers) {
        expect(content.includes(marker), rel + ' 含出站调用点 ' + marker).toBe(false)
      }
    }
  })
})

// ── 扫描目标收集（一律返回仓库相对路径，读取时 join(REPO_ROOT)）────────────

function listFilesRecursive(relDir: string, suffix: string): string[] {
  const base = join(REPO_ROOT, relDir)
  try {
    return readdirSync(base, { recursive: true })
      .map(String)
      .filter((rel) => rel.endsWith(suffix))
      .map((rel) => join(relDir, rel))
  } catch {
    return []
  }
}

/** 扫描域（偏离裁决）：src/routes/** 与 src/client/** 下的全部 .ts。 */
function collectLaneFiles(): string[] {
  return [...listFilesRecursive('src/routes', '.ts'), ...listFilesRecursive('src/client', '.ts')]
}

/** 探针自有 client 文件：src/client/probe/**。 */
function collectProbeClientFiles(): string[] {
  return listFilesRecursive('src/client/probe', '.ts')
}

/** 出站扫描目标：test/** 全部 .ts（PROBE_HTML 常量文本在 src 侧，天然不计入目标）。 */
function collectTestFiles(): string[] {
  return listFilesRecursive('test', '.ts')
}
