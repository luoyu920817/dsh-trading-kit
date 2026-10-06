/**
 * 复盘页传参解析（change 4 review-page tasks 2.3；design D-1/D-15）。
 *
 * 优先级：hash → query → path 段（D-1：TDX 联动的实际通道是 hash；query/path 是
 * 兼容形态——`GET <basePath>/review/<code>` 直链归 path 段）。解析结果**原样记录**
 * 原始取值（排障用），归一化 = 只去已知外壳（`sh|sz|bj` 前缀与 `.sh|.sz|.bj` 后缀，
 * 大小写不敏感）+ 6 位数字校验；**不补全、不猜测**（`60000` → invalid，非法不触发
 * 任何读——页面据 invalid 直接渲染显式空态）。
 *
 * 嵌入方式（沿探针页先例）：本函数经模板插值原样序列化进 REVIEW_HTML 的内联脚本
 * （src/client/review/index.html.ts），因此本文件 MUST 保持「纯函数 + 基线页已证
 * 语法（ES2017 + Fetch + Promise）」：
 * - 函数体内不得引用函数外标识符（含 import、模块级常量；语言内建除外）；
 * - 不得使用可选链（?.）、空值合并（??）、ES module、顶层 await、反引号模板串
 *   （Chromium 81 内核已证基线取保守子集）；
 * - 路径段做 decodeURIComponent（try/catch 包裹，失败回退原样值）。
 *
 * 归一实现的唯一权威 = 服务端 `src/review/anchor.ts` 的 `normalizeCode`（页面侧
 * 为同逻辑自包含副本——页面离线自包含无法 import 服务端模块；服务端对全部入参
 * 仍会再次归一，页面副本仅用于「非法不触发任何读」的前置空态判定）。
 */

/** 传参形态（按优先级顺序）。 */
export type ReviewParamForm = 'hash' | 'query' | 'path'

/** 解析结果（全部字段可 JSON 序列化）。 */
export interface ReviewParamsResult {
  /** location.hash 去掉前导 `#` 后的原样值（不 decode）。 */
  hashRaw: string
  /** 第一个 `?code=` 的原样值（decode 失败时原样；无该参数为空串）。 */
  queryRaw: string
  /** 路由路径之后的首个 path 段（decode；无则为空串）。 */
  pathRaw: string
  /** 按优先级取值的形态；三类全缺失时为 null（显式空态）。 */
  resolvedForm: ReviewParamForm | null
  /** 优先级最高形态的原样取值；三类全缺失时为 null。 */
  raw: string | null
  /** 归一结果（去壳后恰 6 位数字）；非法/缺失为 null。 */
  code: string | null
  /**
   * 显式市场（owner 2026-10-06 追授：`sh|sz|bj` 前缀或 `.sh|.sz|.bj` 后缀，大小写
   * 不敏感——中证指数段 000xxx 挂沪市与深市股票同码不同品种，市场号只能由 URL 提供）；
   * 未提供为 null = 维持既有按前缀惯例解析的现状。
   */
  market: 'sh' | 'sz' | 'bj' | null
  valid: boolean
}

/**
 * 解析三类传参并按优先级取值。
 *
 * @param hash      页面侧传 `location.hash`（含 `#` 前缀），测试侧传原始串
 * @param search    页面侧传 `location.search`（含 `?` 前缀）
 * @param pathname  页面侧传 `location.pathname`
 * @param routePath 复盘页路由路径（`<basePath>/review`）
 */
export function parseReviewParams(
  hash: string,
  search: string,
  pathname: string,
  routePath: string,
): ReviewParamsResult {
  // 辅助逻辑 MUST 内联在函数体内（不得引用函数外标识符）：本函数经序列化进页面，
  // 模块级私有函数不会随序列化带出。
  function safeDecode(v: string): string {
    try {
      return decodeURIComponent(v)
    } catch (e) {
      return v
    }
  }

  function readQueryCode(search: string): string {
    var query = search.charAt(0) === '?' ? search.slice(1) : search
    if (query === '') {
      return ''
    }
    var parts = query.split('&')
    for (var i = 0; i < parts.length; i++) {
      var pair = parts[i]
      var eq = pair.indexOf('=')
      var key = eq === -1 ? pair : pair.slice(0, eq)
      if (key === 'code') {
        var v = eq === -1 ? '' : pair.slice(eq + 1)
        var plus = v.split('+').join(' ')
        return safeDecode(plus)
      }
    }
    return ''
  }

  // path 段形态只认路由后缀：pathname 不以 routePath 开头时返回空串。
  function readPathSegment(pathname: string, routePath: string): string {
    if (routePath === '' || pathname.indexOf(routePath) !== 0) {
      return ''
    }
    var rest = pathname.slice(routePath.length)
    while (rest.charAt(0) === '/') {
      rest = rest.slice(1)
    }
    var slash = rest.indexOf('/')
    var seg = slash === -1 ? rest : rest.slice(0, slash)
    return safeDecode(seg)
  }

  // 归一化（去壳不补全）：trim → 捕获市场前/后缀（大小写不敏感）→ 余下须恰为 6 位
  // 数字（前导零保留）。市场为「显式提供才非 null」——同码不同品种（如 000688=
  // 科创50(沪)/国城矿业(深)）的区分只能靠 owner 手配 URL 显式给出。
  function normalizeLite(raw: string): { code: string | null; market: string | null } {
    var v = raw
    try {
      v = v.replace(/^\s+|\s+$/g, '')
    } catch (e) {
      v = raw
    }
    var market = null
    var m = /^(sh|sz|bj)/i.exec(v)
    if (m !== null) {
      market = m[1].toLowerCase()
      v = v.slice(m[1].length)
    }
    var s = /\.(sh|sz|bj)$/i.exec(v)
    if (s !== null) {
      market = s[1].toLowerCase()
      v = v.slice(0, v.length - s[0].length)
    }
    return { code: /^\d{6}$/.test(v) ? v : null, market: market }
  }

  var hashRaw = hash.charAt(0) === '#' ? hash.slice(1) : hash
  var queryRaw = readQueryCode(search)
  var pathRaw = readPathSegment(pathname, routePath)

  var resolvedForm: ReviewParamForm | null = null
  var raw: string | null = null
  if (hashRaw !== '') {
    resolvedForm = 'hash'
    raw = hashRaw
  } else if (queryRaw !== '') {
    resolvedForm = 'query'
    raw = queryRaw
  } else if (pathRaw !== '') {
    resolvedForm = 'path'
    raw = pathRaw
  }

  var normalized = raw !== null ? normalizeLite(raw) : { code: null, market: null }
  return {
    hashRaw: hashRaw,
    queryRaw: queryRaw,
    pathRaw: pathRaw,
    resolvedForm: resolvedForm,
    raw: raw,
    code: normalized.code,
    market: normalized.market as 'sh' | 'sz' | 'bj' | null,
    valid: normalized.code !== null,
  }
}
