/**
 * 探针页传参解析（spike-tdx-embed tasks 1.8；design D-5）。
 *
 * 优先级：hash → query → path 段（D-5：TDX 联动的实际通道是 hash，query/path
 * 是 P2/P3 分支的兼容形态）。编码不做静默修正：`SH600000` / `600000.SH` 原样
 * 记录并判非法，MUST NOT 猜测补全（污染卡片归属）；解析结果非 6 位数字或三类
 * 全缺失时返回显式空态标记。非法不回退到下一形态（否则会把 TDX 侧传参缺陷
 * 掩盖成「可用」假象）——三类原值全部原样返回，报告可自行归因。
 *
 * 嵌入方式（tasks 1.3）：本函数经 `String(parseProbeParams)` 在运行时原样
 * 序列化进 `PROBE_HTML` 的内联脚本（见 src/client/probe/index.html.ts），
 * 因此本文件 MUST 保持「纯函数 + 基线页已证语法」：
 * - 函数体内不得引用函数外标识符（含 import、全局变量；String/RegExp 等语言内建除外）；
 * - 不得使用模板字符串（反引号）、可选链（?.）、空值合并（??）、async/await、
 *   ES module 语法——基线页只证明了 ES2017 + Fetch + Promise；
 * - 不做 decodeURIComponent 等任何归一化（「原样记录」纪律）。
 * test/probe/probe-params.test.ts 会重建序列化产物并断言行为一致。
 */

/** 传参形态（按优先级顺序）。 */
export type ProbeParamForm = 'hash' | 'query' | 'path'

/** 解析结果（全部字段可 JSON 序列化，供页面文本输出）。 */
export interface ProbeParamsResult {
  /** location.hash 去掉前导 `#` 后的原样值（不 decode）。 */
  hashRaw: string
  /** 第一个 `?code=` 的原样值（不 decode；无该参数为空串）。 */
  queryRaw: string
  /** 路由路径之后的首个 path 段原样值（不 decode；无则为空串）。 */
  pathRaw: string
  /** 实际非空的形态清单（按 hash → query → path 优先级排序）。 */
  presentForms: ProbeParamForm[]
  /** 按优先级取值的形态；三类全缺失时为 null。 */
  resolvedForm: ProbeParamForm | null
  /** 优先级最高形态的原值；三类全缺失时为 null（显式空态）。 */
  resolvedValue: string | null
  /** resolvedValue 恰为 6 位数字（保留前导零）。 */
  valid: boolean
}

/**
 * 解析三类传参并按优先级取值。
 *
 * @param hash      页面侧传 `location.hash`（含 `#` 前缀），测试侧传原始串
 * @param search    页面侧传 `location.search`（含 `?` 前缀）
 * @param pathname  页面侧传 `location.pathname`
 * @param routePath 探针路由路径（`PROBE_PATH`，页面侧用 `__PROBE__.basePath + '/probe'`）
 */
export function parseProbeParams(
  hash: string,
  search: string,
  pathname: string,
  routePath: string,
): ProbeParamsResult {
  // 辅助逻辑 MUST 内联在函数体内（不得引用函数外标识符）：本函数经
  // String() 序列化进页面，模块级私有函数不会随序列化带出。
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
        return eq === -1 ? '' : pair.slice(eq + 1)
      }
    }
    return ''
  }

  // path 段形态只认路由后缀：pathname 不以 routePath 开头时返回空串（不对整个 pathname 猜测）。
  function readPathSegment(pathname: string, routePath: string): string {
    if (routePath === '' || pathname.indexOf(routePath) !== 0) {
      return ''
    }
    var rest = pathname.slice(routePath.length)
    while (rest.charAt(0) === '/') {
      rest = rest.slice(1)
    }
    var slash = rest.indexOf('/')
    return slash === -1 ? rest : rest.slice(0, slash)
  }

  var hashRaw = hash.charAt(0) === '#' ? hash.slice(1) : hash
  var queryRaw = readQueryCode(search)
  var pathRaw = readPathSegment(pathname, routePath)

  var presentForms: ProbeParamForm[] = []
  if (hashRaw !== '') {
    presentForms.push('hash')
  }
  if (queryRaw !== '') {
    presentForms.push('query')
  }
  if (pathRaw !== '') {
    presentForms.push('path')
  }

  var resolvedForm: ProbeParamForm | null = null
  var resolvedValue: string | null = null
  if (presentForms.length > 0) {
    resolvedForm = presentForms[0]
    if (resolvedForm === 'hash') {
      resolvedValue = hashRaw
    } else if (resolvedForm === 'query') {
      resolvedValue = queryRaw
    } else {
      resolvedValue = pathRaw
    }
  }

  var valid = resolvedValue !== null && /^\d{6}$/.test(resolvedValue)

  return { hashRaw: hashRaw, queryRaw: queryRaw, pathRaw: pathRaw, presentForms: presentForms, resolvedForm: resolvedForm, resolvedValue: resolvedValue, valid: valid }
}
