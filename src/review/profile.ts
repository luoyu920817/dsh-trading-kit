/**
 * 标的档案读取（review-loop `stock-profile` capability；tasks 2.2–2.3）。
 *
 * 复用既有 `DB/stock/` 目录（owner 手工维护 + 首卡懒创建骨架），**只读**：
 * 本模块 MUST NOT 写入/改名/删除任何档案（建档归 `src/review/profile-create.ts`，
 * 且仅 create-only 新建）。
 *
 * 定位规则（spec「档案读取」逐条落地；层序固定、无猜测）：
 * ① 名称直配 `<名称>.md`（名称来自当日清单 `scanDailyCardTargets.name`，退化为
 *    代码段时不参与直配）；
 * ② `代码` 索引兜底（档案 frontmatter `代码` == 目标代码）；
 * ③ 双未命中 → **未命中**（不入结果、不是错误）。
 * 命中后若档案 `代码` 与目标不一致 → 记 `warnings` 且**不注入**（宁缺勿错）；
 * 一代码多档案（异常数据）→ 记 `warnings` 并取 mtime 最新（同时间取文件名字典序）。
 *
 * 字段契约（spec 表）：`角色` = 给 agent 的提示词重点内容（唯一进 agent 上下文的
 * 业务字段）；`锚点: true` = 盘面 md 指数段成员；`代码` = 定位兜底与一致性校验；
 * `热点标签`/`板块`/`当前题材`/`题材地位`/`# 股性` **只保存与展示**（不进上下文，
 * 本模块也不把它们放进业务出参——`hotTags` 仅作展示复用面）。
 *
 * 零出站：纯文件系统读；解析复用 change 4 `src/review/md/frontmatter.ts`
 * （键名白名单已含 CJK）+ `resolveArea('stock')`（MUST NOT 自行拼接路径）。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'
import { Snapshot } from './snapshot.ts'
import { assertAreaPathUnderRoot, resolveArea } from '../paths/resolve.ts'
import { sanitizeNameSegment } from '../paths/sanitize.ts'
import { normalizeCode } from './anchor.ts'
import { findFrontmatter, parseFrontmatterValues } from './md/frontmatter.ts'

/** 目录缺失告警码（消费方按码分支，MUST NOT 解析文案）。 */
export const STOCK_DIR_MISSING = 'stockDirMissing'
/** 数据根未配置告警码。 */
export const DATA_ROOT_UNCONFIGURED = 'dataRootUnconfigured'

/** 档案条目（`code`/`role` 为空 = 该键缺省；`hotTags` 仅展示面）。 */
export interface StockProfileEntry {
  code: string | null
  name: string
  role: string | null
  isAnchor: boolean
  hotTags: string[]
  /** 相对数据根路径（来源标注用）。 */
  path: string
}

export interface StockProfilesResult {
  entries: StockProfileEntry[]
  warnings: string[]
}

export interface StockProfilesInput {
  /** 目标代码（6 位；与 `names` 按下标对齐）。 */
  codes?: readonly string[]
  /** 与 `codes` 对齐的名称（缺省/退化时回落到 `代码` 索引）。 */
  names?: readonly (string | null | undefined)[]
}

/** 档案内部视图（含 mtime，供多命中确定性排序）。 */
export interface ScannedProfile extends StockProfileEntry {
  mtimeMs: number
  fileName: string
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

/** `锚点: true` 判定（接受布尔 true 与字符串 true/1/是；其余为 false）。 */
function asBoolean(v: unknown): boolean {
  if (v === true) return true
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase()
    return t === 'true' || t === '1' || v.trim() === '是'
  }
  return false
}

/** `热点标签` 值 → 标签数组（展示用；支持 flow 形态与中英文分隔符）。 */
function splitTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter((s) => s !== '')
  if (typeof v !== 'string') return []
  let raw = v.trim()
  if (raw === '') return []
  if (raw.startsWith('[') && raw.endsWith(']')) raw = raw.slice(1, -1)
  return raw.split(/[,，、]/).map((s) => s.trim()).filter((s) => s !== '')
}

/** 档案解析：文件名即名称；`代码` 经 normalizeCode 归一（非法/缺失 → null）。 */
function parseProfileText(fileName: string, text: string, relPath: string, mtimeMs: number): ScannedProfile {
  const name = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName
  const fmBlock = findFrontmatter(text)
  const values = fmBlock === null ? {} : parseFrontmatterValues(fmBlock.bodyLines)
  const rawCode = asString(values['代码'])
  const code = rawCode === null ? null : normalizeCode(rawCode)
  return {
    code,
    name,
    role: asString(values['角色']),
    isAnchor: asBoolean(values['锚点']),
    hotTags: splitTags(values['热点标签']),
    path: relPath,
    mtimeMs,
    fileName,
  }
}

/**
 * 业务逻辑: 扫描选定标的目录完整档案并读取名称、代码与业务属性。
 * 关键判断: 返回全部档案；读取前复核真实目录不含链接越界。
 * 异常处理: 目录缺失返回空表和告警；单文件失败跳过，其它错误抛出。
 * 参数: dataRoot为数据根，opts.directory为可选相对目录。
 * 返回: 完整档案与读取告警。
 */
export async function scanStockDir(dataRoot: string, opts: { directory?: string } = {}): Promise<{ profiles: ScannedProfile[]; warnings: string[] }> {
  const warnings: string[] = []
  if (dataRoot === '') {
    return { profiles: [], warnings: [`${DATA_ROOT_UNCONFIGURED}: 数据根未配置（config.dataRoot 为空）——请在宿主 profile 的 dsh-trader-kit 配置段设置 dataRoot`] }
  }
  const area = resolveArea(dataRoot, 'stock', {}, opts)
  const dirAbs = area.areaDirAbs
  await assertAreaPathUnderRoot(dataRoot, dirAbs)
  let dirents: Dirent[]
  try {
    dirents = await readdir(dirAbs, { withFileTypes: true })
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { profiles: [], warnings: [`${STOCK_DIR_MISSING}: 标的档案目录不存在（${area.relPath}）——未命中不是错误；owner 建档或首卡懒创建后自动可用`] }
    }
    throw e
  }
  const profiles: ScannedProfile[] = []
  for (const d of dirents) {
    if (!d.isFile() || !d.name.endsWith('.md')) continue
    const full = join(dirAbs, d.name)
    try {
      const [text, st] = await Promise.all([readFile(full, 'utf8'), stat(full)])
      profiles.push(parseProfileText(d.name, text, [area.relPath.replaceAll('\\', '/'), d.name].join('/'), st.mtimeMs))
    } catch (e) {
      warnings.push(`档案读取失败（跳过该文件）：${area.relPath}/${d.name}——${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return { profiles, warnings }
}

/** 多命中确定性：mtime 最新；同时间取文件名字典序首个。 */
function pickLatest(cands: ScannedProfile[]): ScannedProfile {
  return [...cands].sort((a, b) => (a.mtimeMs !== b.mtimeMs ? b.mtimeMs - a.mtimeMs : a.fileName < b.fileName ? -1 : 1))[0]
}

/**
 * 读取标的档案（按代码清单或全锚点清单）。
 * - `codes` 给出：逐代码按「名称直配 → `代码` 索引」定位；未命中/不一致按 spec 处置；
 * - `codes` 与 `names` 皆缺省：返回全部 `锚点: true` 且含 `代码` 的档案（按 code 升序；
 *   `锚点: true` 但缺 `代码` 者记 warnings 并排除——盘面 md 指数段需要代码）。
 * 业务逻辑: 复用扫描快照或读取配置目录，按确定性规则定位档案。
 * 关键判断: 名称匹配仍复核代码；读取范围绑定调用者目录，互不影响。
 * 异常处理: 缺档为未命中；不一致返回告警；配置越界错误透传。
 * 参数: dataRoot为数据根，input为目标集合，opts为目录与可选完整快照。
 * 返回: 匹配档案和告警。
 */
export async function readStockProfiles(
  dataRoot: string,
  input: StockProfilesInput = {},
  opts: { directory?: string; profiles?: ScannedProfile[]; warnings?: string[] } = {},
): Promise<StockProfilesResult> {
  const scanned = opts.profiles !== undefined
    ? { profiles: opts.profiles, warnings: opts.warnings ?? [] }
    : await scanStockDir(dataRoot, { directory: opts.directory })
  const { profiles } = scanned
  const warnings = [...scanned.warnings]
  const byFileName = new Map<string, ScannedProfile>()
  for (const p of profiles) byFileName.set(p.fileName, p)
  const strip = (p: ScannedProfile): StockProfileEntry => ({
    code: p.code, name: p.name, role: p.role, isAnchor: p.isAnchor, hotTags: p.hotTags, path: p.path,
  })

  const codes = input.codes
  if (codes === undefined || codes.length === 0) {
    const anchors: StockProfileEntry[] = []
    for (const p of profiles) {
      if (!p.isAnchor) continue
      if (p.code === null) {
        warnings.push(`锚点缺 代码 键（已排除，指数段需要代码）：${p.path}`)
        continue
      }
      anchors.push(strip(p))
    }
    anchors.sort((a, b) => (String(a.code) < String(b.code) ? -1 : 1))
    return { entries: anchors, warnings }
  }

  const entries: StockProfileEntry[] = []
  for (let i = 0; i < codes.length; i += 1) {
    const target = normalizeCode(codes[i])
    if (target === null) {
      warnings.push(`非法代码（跳过）：'${String(codes[i])}'——期望 6 位数字（经 normalizeCode 归一）`)
      continue
    }
    const rawName = input.names?.[i] ?? null
    const name = typeof rawName === 'string' && rawName.trim() !== '' && rawName.trim() !== target ? rawName.trim() : null
    // ① 名称直配。
    let hit: ScannedProfile | undefined
    if (name !== null) {
      const candidate = byFileName.get(`${name}.md`)
      if (candidate !== undefined) {
        if (candidate.code !== null && candidate.code !== target) {
          warnings.push(`档案 代码 与目标不一致（不注入）：${candidate.path} 的 代码=${candidate.code}，目标=${target}`)
          continue
        }
        hit = candidate
      }
    }
    // ② `代码` 索引兜底。
    if (hit === undefined) {
      const idxHits = profiles.filter((p) => p.code === target)
      if (idxHits.length > 1) {
        const picked = pickLatest(idxHits)
        warnings.push(`一代码多档案（取 mtime 最新）：code=${target} → ${picked.path}；其余候选：${idxHits.filter((p) => p !== picked).map((p) => p.path).join(', ')}`)
        hit = picked
      } else if (idxHits.length === 1) {
        hit = idxHits[0]
      }
    }
    // ③ 未命中：不入结果、无告警（不是错误）。
    if (hit !== undefined) entries.push(strip(hit))
  }
  return { entries, warnings }
}

/**
 * 业务逻辑: 名称净化后解析档案文件路径，默认或用户目录均经区域解析。
 * 关键判断: 文件名始终单段，目录必须相对数据根；不修改其他业务区。
 * 异常处理: 配置非法由resolveArea抛出；本函数不操作文件系统。
 * 参数: dataRoot为数据根，name/code为标的身份，opts.directory为可选目录。
 * 返回: 绝对与相对路径及名称截断信息。
 */
export function stockProfilePathFor(
  dataRoot: string,
  name: string,
  code: string,
  opts: { directory?: string } = {},
): { absPath: string; relPath: string; nameTruncated: boolean } {
  const area = resolveArea(dataRoot, 'stock', {}, { ...opts, forWrite: true })
  const dirAbs = area.areaDirAbs
  const sanitized = sanitizeNameSegment(name, code)
  const fileName = sanitized.value + '.md'
  return {
    absPath: join(dirAbs, fileName),
    relPath: [area.relPath.replaceAll('\\', '/'), fileName].join('/'),
    nameTruncated: sanitized.nameTruncated,
  }
}
const stockSnapshots = new Map<string, Snapshot<{ profiles: ScannedProfile[]; warnings: string[] }>>()
/**
 * 业务逻辑: 同一数据根和标的目录共享完整扫描，供逐码查询复用opts.profiles。
 * 关键判断: 缓存键包含目录，配置切换不复用旧档案；120秒过期、单飞刷新。
 * 异常处理: 快照读取失败五秒退避，不缓存假空表。
 * 参数: dataRoot为数据根绝对路径，onError为可选告警出口，opts为可选目录。
 * 返回: 完整档案快照容器。
 */
export function stockProfileSnapshot(dataRoot: string, onError?: (error: unknown) => void, opts: { directory?: string } = {}): Snapshot<{ profiles: ScannedProfile[]; warnings: string[] }> {
  const key = JSON.stringify([dataRoot, opts.directory ?? null])
  let snapshot = stockSnapshots.get(key)
  if (snapshot === undefined) {
    snapshot = new Snapshot(() => scanStockDir(dataRoot, opts), 120_000, Date.now, onError)
    stockSnapshots.set(key, snapshot)
    void snapshot.refresh()
  }
  if (onError !== undefined) snapshot.onError = onError
  return snapshot
}
