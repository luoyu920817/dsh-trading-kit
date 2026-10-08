/**
 * 复盘线结构断言（change 4 tasks 6.3 十一项 + tasks 2.6 纯本地性；契约 §7：
 * 每条扫描用例先断言「扫描目标非空」，标记经字符串拼接构造避免自匹配）。
 *
 * 既有覆盖说明：storeWarnings 别名 / docMismatch / 净化唯一 / 锚点正则唯一在
 * test/review/structure.test.ts（tasks 1.x）已断言——本文件按 6.3 清单在本 change
 * 扫描域内逐条复核（自足可失败，不依赖阅读顺序）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'
import { runLimitReasonBacktrack } from '../../src/review/enrich.ts'

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SRC = join(REPO_ROOT, 'src')
const TEST_DIR = join(REPO_ROOT, 'test')

/** 拼接构造的扫描标记（避免扫描器文件自匹配）。 */
const FETCH_MARKER = 'fet' + 'ch('
const HTTP_REQUEST_MARKER = 'http' + '.request'
const STORE_WARNINGS_MARKER = 'storeWar' + 'nings'
const SESSION_REJECTED_MARKER = 'sessionRe' + 'jected'
const OFFSET_MARKER = '+08' + ':00'
const NOW_CALL_MARKER = 'new ' + 'Date()'
const DATE_NOW_MARKER = 'Date.' + 'now('

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  if (statSync(dir).isFile()) return dir.endsWith('.ts') ? [dir] : []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    return e.isDirectory() ? listTsFiles(p) : e.name.endsWith('.ts') ? [p] : []
  })
}

function rel(path: string): string {
  return path.slice(REPO_ROOT.length).split('\\').join('/')
}

describe('6.3① routes/client 不 import src/data/**（允许 service 类型）', () => {
  it('src/routes/** + src/client/** 零 data 深层 import（目标非空）', () => {
    const files = [...listTsFiles(join(SRC, 'routes')), ...listTsFiles(join(SRC, 'client'))]
    expect(files.length).toBeGreaterThan(0)
    const violations = files.filter((f) => /from\s+['"][^'"]*\/data\//.test(readFileSync(f, 'utf8')))
    expect(violations.map(rel)).toEqual([])
  })
})

describe('6.3② 全 src 与 test/** 零出站调用点（fet' + 'ch( / http' + '.request；具名豁免两条出站通道）', () => {
  it('src/** 除 src/data/http.ts、src/skill/download.ts、页面同源 API 调用外零出站标记', () => {
    const files = listTsFiles(SRC)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => {
      const norm = rel(f)
      if (norm === 'src/data/http.ts') return false // 具名出站通道 1（change 2）
      if (norm === 'src/skill/download.ts') return false // 具名出站通道 2（change 3）
      if (norm === 'src/client/review/index.html.ts') return false // 页面同源 /review/api/* 调用（浏览器上下文，非插件出站通道；第三方 URL 禁令由 6.3③ 承担）
      if (norm === 'src/client/panel/Panel.ts') return false // review-loop 面板同源 /review/api/day 调用（同为浏览器上下文；同源与零外链由 review-loop-panel 断言承担）
      const text = readFileSync(f, 'utf8')
      return text.includes(FETCH_MARKER) || text.includes(HTTP_REQUEST_MARKER)
    })
    expect(offenders.map(rel)).toEqual([])
  })

  it('页面同源边界：REVIEW_HTML 的取数目标全部为 basePath 相对拼接的同源 API 路径', () => {
    expect(REVIEW_HTML.length).toBeGreaterThan(0)
    expect(REVIEW_HTML).not.toMatch(/https?:\/\//i) // 交叉承担 6.3③
    expect(REVIEW_HTML).toMatch(/fetchJson\(apiUrl\(/) // 读：basePath + '/review/api/…'
    expect(REVIEW_HTML).toContain("basePath + '/review/api/card'") // 写
  })

  it('test/** 除 test/structure.test.ts、test/helpers/data-stub.ts 外零 fet' + 'ch(（具名豁免见 probe-registration 登记）', () => {
    const files = listTsFiles(TEST_DIR)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => {
      const norm = rel(f)
      if (norm === 'test/structure.test.ts') return false // 数据线扫描型断言文件（正则字符串含标记字面）
      if (norm === 'test/helpers/data-stub.ts') return false // change 2 本地桩通道（运行时回环断言）
      return readFileSync(f, 'utf8').includes(FETCH_MARKER)
    })
    expect(offenders.map(rel)).toEqual([])
  })
})

describe('6.3③④⑤ 页面层零第三方 URL / 零交易接口 / 17709 零 HTTP', () => {
  it('src/client/** 零 http(s):// 字面（treeid 拼接构造不算字面）', () => {
    const files = listTsFiles(join(SRC, 'client'))
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => /https?:\/\//i.test(readFileSync(f, 'utf8')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('src/** 无 order_stock / cancel_order 调用路径（注释提及不算）', () => {
    const files = listTsFiles(SRC)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => /order_stock\s*\(|cancel_order\s*\(/.test(readFileSync(f, 'utf8').replace(/^\s*(?:\/\/|\/\*|\*).*$/gm, '')))
    expect(offenders.map(rel)).toEqual([])
  })

  it('全 src 无 HTTP URL 指向 17709——唯一例外 = 出站闸文件（review-loop 白名单端点常量）', () => {
    const files = listTsFiles(SRC)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => {
      const norm = rel(f)
      if (norm === 'src/data/http.ts') return false // 白名单端点常量唯一定义点（闸内复核 method/字段/body）
      return /https?:\/\/[^'"]*17709/.test(readFileSync(f, 'utf8'))
    })
    expect(offenders.map(rel)).toEqual([])
  })
})

describe('6.3⑥⑦ storeWarnings 别名 0 / 本 change 内 sessionRe' + 'jected 0', () => {
  it('全 src（含 REVIEW_HTML 资产文本）不出现 storeWarnings 标识符——一律 warnings', () => {
    const files = listTsFiles(SRC)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes(STORE_WARNINGS_MARKER))
    expect(offenders.map(rel)).toEqual([])
  })

  it('本 change 文件（路由/页面/本线测试）内 sessionRe' + 'jected 命中 0（目标清单非空）', () => {
    const targets = [
      join(SRC, 'routes', 'review.ts'),
      join(SRC, 'client', 'review', 'index.html.ts'),
      join(SRC, 'client', 'review', 'params.ts'),
      join(SRC, 'review', 'enrich.ts'),
      ...listTsFiles(join(TEST_DIR, 'routes-review')),
      join(TEST_DIR, 'review-enrich.test.ts'),
    ]
    expect(targets.length).toBeGreaterThan(0)
    const offenders = targets.filter((f) => existsSync(f) && readFileSync(f, 'utf8').includes(SESSION_REJECTED_MARKER))
    expect(offenders.map(rel)).toEqual([])
  })
})

describe('6.3⑧⑨⑩⑪ 净化唯一 / +08:00 唯一 / StoreWarningKind 无 docMismatch / enrich 无系统日期 fallback', () => {
  it('不存在 src/review/sanitize.ts（净化唯一实现 = change 2 的 src/paths/sanitize.ts）', () => {
    expect(existsSync(join(SRC, 'review', 'sanitize.ts'))).toBe(false)
    expect(existsSync(join(SRC, 'paths', 'sanitize.ts'))).toBe(true)
  })

  it('src 全树（src/data/** 为数据线辖区）仅 src/review/format.ts 持有 +08:00 偏移拼装', () => {
    const files = listTsFiles(SRC).filter((f) => !rel(f).startsWith('src/data/'))
    expect(files.length).toBeGreaterThan(0)
    const holders = files.filter((f) => readFileSync(f, 'utf8').includes(OFFSET_MARKER))
    expect(holders.map(rel)).toEqual(['src/review/format.ts'])
  })

  it('StoreWarningKind 枚举无 docMismatch（写前归属不一致走抛错 DOC_MISMATCH）', () => {
    const types = readFileSync(join(SRC, 'review', 'types.ts'), 'utf8')
    expect(types.length).toBeGreaterThan(0)
    expect(types.includes('docMismatch')).toBe(false)
    expect(types).toContain("'multiHit' | 'ghostAnchor' | 'duplicateAnchor' | 'nameTruncated'")
  })

  it('src/review/enrich.ts 无系统日期 fallback：无 new Date() / Date.now(（回溯起点只来自 resolveTradeDate）', () => {
    const enrich = readFileSync(join(SRC, 'review', 'enrich.ts'), 'utf8')
    expect(enrich.length).toBeGreaterThan(0)
    expect(enrich.includes(NOW_CALL_MARKER)).toBe(false)
    expect(enrich.includes(DATE_NOW_MARKER)).toBe(false)
  })

  it('enrich 回溯出口存在且签名可注入（本 change 消费面；实现冻结——测试面见 test/review-enrich.test.ts）', () => {
    expect(typeof runLimitReasonBacktrack).toBe('function')
    expect(runLimitReasonBacktrack.length).toBeGreaterThanOrEqual(1)
  })
})

describe('tasks 2.6：/api/local 依赖链纯本地（结构面）', () => {
  it('src/routes/review.ts 的 import 面不含出站通道（fet' + 'ch( / http' + '.request / 数据线取数实现）', () => {
    const routes = readFileSync(join(SRC, 'routes', 'review.ts'), 'utf8')
    expect(routes.length).toBeGreaterThan(0)
    expect(routes.includes(FETCH_MARKER)).toBe(false)
    expect(routes.includes(HTTP_REQUEST_MARKER)).toBe(false)
    expect(routes).not.toMatch(/from\s+['"][^'"]*\/data\//)
    // 本地化取值域：名称层只经 createNameResolver（不注入反查即零网络）；卡片读经 locateDoc/parseDoc。
    expect(routes).toContain('createNameResolver')
    expect(routes).toContain('locateDoc')
    expect(routes).toContain('parseDoc')
  })
})
