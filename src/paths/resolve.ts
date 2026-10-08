/**
 * 业务区路径解析 + 越界防护（`data-root-layout`「数据根可配置与相对解析」
 * 「文件名模板与参数白名单」两个 Requirement 的实现）。
 *
 * 分工：本模块只做「参数白名单 → 模板渲染 → 越界校验」；canonical → 紧凑的
 * 日期折算 MUST 由调用方经 `src/data/date.ts` 的 `toCompactDate` 完成（本模块
 * 不自行 replace/slice 日期串；`<YYYYMM>` 目录段经 date.ts 的 `toMonthSegment`）。
 */
import { isAbsolute, join, resolve, sep } from 'node:path'
import { toMonthSegment } from '../data/date.ts'
import { AREA_KEYS, AREA_TABLE, type AreaKey } from './mapping.ts'
import { sanitizeNameSegment } from './sanitize.ts'

/** 模板参数白名单（`data-root-layout` Requirement 表格逐字落地）。 */
const CODE_RE = /^(?:sh|sz|bj)?\d{6}$/ // owner 2026-10-06：可选市场前缀（指数/锚点族与同码股票的文件区分）
const COMPACT_DATE_RE = /^\d{8}$/

export class PathResolveError extends Error {}

function fail(message: string): never {
  throw new PathResolveError(message)
}

/** 未配置数据根的显式报错（design D-1：挂载可用，操作期报错 + 配置指引）。 */
function requireDataRoot(dataRoot: string): string {
  if (dataRoot === '') {
    fail(
      '数据根未配置（config.dataRoot 为空）：请在宿主 profile 的 dsh-trader-kit 配置段设置 dataRoot'
      + '（cordis.patch.yml 的 config 段或 profile 层），指向含 DB/ 与 agent/ 的数据根目录。',
    )
  }
  return dataRoot
}

/**
 * 相对路径越界防护：拒绝 `..` 段与绝对路径（含盘符/UNC），并做 resolve 后的
 * 前缀复核（双保险——即使某段通过了白名单，最终结果仍 MUST 落在根内）。
 * 返回 `join(dataRoot, rel)` 的绝对路径。
 */
export function resolveRelativeUnderRoot(dataRoot: string, rel: string): string {
  requireDataRoot(dataRoot)
  if (isAbsolute(rel)) fail(`路径越界：'${rel}' 是绝对路径，拒绝解析（业务路径必须相对 dataRoot）`)
  const segments = rel.split(/[\\/]/)
  if (segments.some((s) => s === '..')) {
    fail(`路径越界：'${rel}' 含 '..' 段，拒绝解析（MUST NOT 引用业务区之外的任何位置）`)
  }
  const rootAbs = resolve(dataRoot)
  const abs = resolve(rootAbs, rel)
  if (abs !== rootAbs && !abs.startsWith(rootAbs + sep)) {
    fail(`路径越界：'${rel}' 渲染结果 '${abs}' 越出数据根 '${rootAbs}'`)
  }
  return abs
}

export interface ResolveAreaParams {
  /** 6 位代码（`^\d{6}$`，保留前导零）。 */
  code?: string
  /** 名称段（经 sanitizeNameSegment 净化）。 */
  name?: string
  /** 紧凑日期 `YYYYMMDD`（canonical 入参先经 toCompactDate 折算）。 */
  date?: string
  /** 缓存区文件名（由缓存层按模块与键生成；单段安全名校验）。 */
  fileName?: string
}

export interface ResolvedArea {
  /** 最终绝对路径（目录区 = 区域目录；文件区 = 渲染后的文件路径）。 */
  absPath: string
  /** 相对 dataRoot 的路径。 */
  relPath: string
  /** 区域目录绝对路径（不含文件名）。 */
  areaDirAbs: string
  /** 名称段是否因超长被截断（调用方透传到写入响应 warnings）。 */
  nameTruncated: boolean
}

/**
 * 业务区路径解析（唯一入口）。
 *
 * - `forWrite: true` 时校验写入许可：预留区（仅登记）显式报错（design D-14）。
 * - 参数校验失败显式报错，不进行任何文件操作。
 * - `date` 只接受紧凑 `YYYYMMDD`；canonical 写法直传会报错并提示经
 *   `toCompactDate` 折算（`data-root-layout`「参数白名单拒绝」scenario）。
 */
export function resolveArea(
  dataRoot: string,
  key: AreaKey,
  params: ResolveAreaParams = {},
  opts: { forWrite?: boolean } = {},
): ResolvedArea {
  requireDataRoot(dataRoot)
  const area = AREA_TABLE[key]
  if (area === undefined) {
    fail(`未定义业务区 '${String(key)}'——已登记业务区：${AREA_KEYS.join(', ')}（MUST NOT 猜测路径）`)
  }
  if (opts.forWrite === true && area.status === 'reserved') {
    fail(`业务区 '${key}' 为预留区：仅登记、未开放解析写入（${area.note}）`)
  }

  // 参数白名单（先校验、后渲染；任何失败都不产生文件操作）。
  for (const required of area.params ?? []) {
    if (params[required] === undefined) fail(`业务区 '${key}' 缺少必需参数 '${required}'`)
  }
  if (params.code !== undefined && !CODE_RE.test(params.code)) {
    fail(`非法参数 code='${params.code}'——白名单 ^(?:sh|sz|bj)?\d{6}$（可选市场前缀 + 6 位数字，保留前导零，不补全不猜测）`)
  }
  if (params.date !== undefined) {
    if (!COMPACT_DATE_RE.test(params.date)) {
      fail(
        `非法参数 date='${params.date}'——目录段只接受紧凑 YYYYMMDD；`
        + 'canonical YYYY-MM-DD 请先经 src/data/date.ts 的 toCompactDate 折算',
      )
    }
    toMonthSegment(params.date) // 仍校验真实日历（20261301 之类显式拒绝）
  }
  let nameTruncated = false
  let nameValue: string | undefined
  if (params.name !== undefined) {
    const sanitized = sanitizeNameSegment(params.name, params.code)
    nameValue = sanitized.value
    nameTruncated = sanitized.nameTruncated
    if (nameValue === '') fail(`业务区 '${key}' 的名称段净化后为空且无代码段可兜底`)
  }
  if (params.fileName !== undefined && !/^[^\\/:*?"<>|\x00-\x1f]+$/.test(params.fileName)) {
    fail(`非法参数 fileName='${params.fileName}'——只允许单段安全文件名（缓存层生成）`)
  }

  // 区域目录渲染：<YYYYMM>/<YYYYMMDD> 由 date 参数折算（经 date.ts）。
  const dirRel = area.dir
    .replace('<YYYYMM>', () => (params.date !== undefined ? toMonthSegment(params.date) : ''))
    .replace('<YYYYMMDD>', () => params.date ?? '')
  const areaDirAbs = resolveRelativeUnderRoot(dataRoot, dirRel)

  if (area.template === undefined) {
    const rel = params.fileName !== undefined ? join(dirRel, params.fileName) : dirRel
    return {
      absPath: params.fileName !== undefined ? join(areaDirAbs, params.fileName) : areaDirAbs,
      relPath: rel,
      areaDirAbs,
      nameTruncated,
    }
  }

  // 文件名模板渲染（模板归属 mapping.ts，本处只做参数替换）。
  const fileName = area.template
    .replace('<code>', () => params.code ?? '')
    .replace('<name>', () => nameValue ?? '')
    .replace('<date>', () => params.date ?? '')
  const relPath = join(dirRel, fileName)
  return {
    absPath: resolveRelativeUnderRoot(dataRoot, relPath),
    relPath,
    areaDirAbs,
    nameTruncated,
  }
}
