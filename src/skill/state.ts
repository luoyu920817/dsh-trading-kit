/**
 * 本地安装状态：meta.json 记录 + 「以文件系统为准」的状态装配（tasks 1.6）。
 *
 * meta.json 位置：`<dirname(targetRoot)>/.dsh-trader-kit-tmp/meta/<name>.json`——
 * 在落点 `<targetRoot>/<name>/` 之外（原子替换会整体换掉落点目录，meta 必须
 * 跨安装存活；用户手工删除落点后 meta 残留正是 spec「事实源优先级」要检测的
 * 状态），且与暂存区同在 tmpBase（assertNotInside 保证其在所有扫描根之外）。
 * 残留清理只删 `run-*` 目录，不触碰 `meta/`。
 *
 * 事实源优先级（spec「事实源优先级」）：status 一律以文件系统为准；meta.json
 * 只是上一次安装的备忘，MUST NOT 用它的值覆盖落点现实。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { parseSkillFrontmatter } from './version.ts'
import { sha256File } from './hash.ts'
import { isInsideOrEqual } from './zip-guard.ts'

export type SkillSourceKind = 'https-zip' | 'local-dir'

export interface SkillMeta {
  version: string | null
  contentHash: string | null
  archiveHash: string | null
  /** 原样响应头字符串（未重格式化，design D-5）。 */
  etag: string | null
  lastModified: string | null
  installedAt: string | null
  lastCheckedAt: string | null
  sourceUrl: string | null
  sourceKind: SkillSourceKind
  sourceId: string | null
  previousSourceId: string | null
  previousVersion: string | null
  /** 首次安装即持久化（spec「安装根解析与来源优先级」：记录优先）。 */
  resolvedCwd: string | null
  projectRoot: string | null
  targetRoot: string | null
  name: string | null
  firstFetchedAt: string | null
  /** 缓存的源可达结论（status 只读它，不内联出站）。 */
  sourceReachable: { state: 'reachable' | 'unreachable' | 'unknown'; checkedAt: string | null; reason: string | null }
  /** 最近一次检查到的可用版本（autocheck 写入）。 */
  availableVersion: string | null
  /** 最近一次显式更新被降级闸门拒绝的记录（status → downgrade-blocked 态）。 */
  downgradeBlocked: { remoteVersion: string; installedVersion: string; at: string } | null
  /** 上次清理失败留下的残留路径（下次 install/update/启动检查重试清理）。 */
  residue: string[]
}

export function emptyMeta(sourceKind: SkillSourceKind = 'https-zip'): SkillMeta {
  return {
    version: null,
    contentHash: null,
    archiveHash: null,
    etag: null,
    lastModified: null,
    installedAt: null,
    lastCheckedAt: null,
    sourceUrl: null,
    sourceKind,
    sourceId: null,
    previousSourceId: null,
    previousVersion: null,
    resolvedCwd: null,
    projectRoot: null,
    targetRoot: null,
    name: null,
    firstFetchedAt: null,
    sourceReachable: { state: 'unknown', checkedAt: null, reason: null },
    availableVersion: null,
    downgradeBlocked: null,
    residue: [],
  }
}

/** meta.json 路径：`<dirname(targetRoot)>/.dsh-trader-kit-tmp/meta/<name>.json`。 */
export function metaPathFor(targetRoot: string, name: string): string {
  return path.join(path.dirname(path.resolve(targetRoot)), '.dsh-trader-kit-tmp', 'meta', `${name}.json`)
}

export interface ReadMetaResult {
  meta: SkillMeta | null
  /** 文件存在但不可解析（不当作「无记录」静默吞掉——状态装配会告警）。 */
  corrupt: boolean
}

export async function readMeta(metaPath: string): Promise<ReadMetaResult> {
  let raw: string
  try {
    raw = await fsp.readFile(metaPath, 'utf8')
  } catch {
    return { meta: null, corrupt: false }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SkillMeta>
    const base = emptyMeta(parsed.sourceKind === 'local-dir' ? 'local-dir' : 'https-zip')
    const meta: SkillMeta = {
      ...base,
      ...parsed,
      sourceReachable: parsed.sourceReachable ?? base.sourceReachable,
      residue: Array.isArray(parsed.residue) ? parsed.residue : [],
    }
    return { meta, corrupt: false }
  } catch {
    return { meta: null, corrupt: true }
  }
}

/** 原子写 meta.json（临时文件 + 改名）。 */
export async function writeMeta(metaPath: string, meta: SkillMeta): Promise<void> {
  await fsp.mkdir(path.dirname(metaPath), { recursive: true })
  const tmpPath = `${metaPath}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  await fsp.writeFile(tmpPath, JSON.stringify(meta, null, 2), 'utf8')
  await fsp.rename(tmpPath, metaPath)
}

// ── 文件系统事实读取 ──────────────────────────────────────────────────────

export interface FsSkillState {
  targetPath: string
  skillMdPath: string
  targetExists: boolean
  skillMdExists: boolean
  /** 文件系统 frontmatter（skillMd 存在时）。 */
  fsFrontmatter: ReturnType<typeof parseSkillFrontmatter> | null
  /** 文件系统版本（以文件系统为准）。 */
  fsVersion: string | null
  /** 文件系统 SKILL.md SHA-256。 */
  fsContentHash: string | null
}

export async function readFsSkillState(targetRoot: string, name: string): Promise<FsSkillState> {
  const targetPath = path.join(path.resolve(targetRoot), name)
  const skillMdPath = path.join(targetPath, 'SKILL.md')
  const state: FsSkillState = {
    targetPath,
    skillMdPath,
    targetExists: false,
    skillMdExists: false,
    fsFrontmatter: null,
    fsVersion: null,
    fsContentHash: null,
  }
  let skillMdBytes: Buffer
  try {
    skillMdBytes = await fsp.readFile(skillMdPath)
  } catch {
    // SKILL.md 不可读：目录存在与否仅作区分（落点在但 SKILL.md 缺 → 也按缺失处理并告警）
    try {
      const stat = await fsp.stat(targetPath)
      state.targetExists = stat.isDirectory()
    } catch {
      state.targetExists = false
    }
    return state
  }
  state.targetExists = true
  state.skillMdExists = true
  state.fsFrontmatter = parseSkillFrontmatter(skillMdBytes.toString('utf8'))
  if (state.fsFrontmatter.ok) state.fsVersion = state.fsFrontmatter.version?.raw ?? null
  state.fsContentHash = await sha256File(skillMdPath)
  return state
}

// ── 文件系统 × meta 调解（状态装配的数据部分）────────────────────────────

export type ReconciledStateName =
  | 'installed'
  | 'missing'
  | 'content-drifted'
  | 'state-mismatch'
  | 'unparseable'

export interface ReconciledState {
  state: ReconciledStateName
  installed: boolean
  /** 版本取文件系统。 */
  version: string | null
  /** 文件系统哈希。 */
  contentHash: string | null
  /** meta 记录哈希。 */
  expectedHash: string | null
  drift: 'unchanged' | 'drifted' | 'unknown'
  warnings: string[]
}

/**
 * 以文件系统为准调解落点与 meta.json（tasks 1.6 验收四条）：
 * ① meta 在而落点被删 → missing + 「残留 meta.json」警告；
 * ② 落点被手工替换 → 版本/哈希取文件系统 + 两个来源的值并列告警；
 * ③ 落点在而 meta 缺 → installed + 「安装记录缺失」警告；
 * ④ SKILL.md 不可解析 → unparseable（宁可吵，不可假）。
 */
export function reconcileFsAndMeta(fs: FsSkillState, meta: SkillMeta | null, metaCorrupt = false): ReconciledState {
  const warnings: string[] = []
  if (metaCorrupt) {
    warnings.push('警告：meta.json 安装记录无法解析（可能被手工编辑）；状态以下方文件系统为准，建议重装以恢复记录。')
  }

  if (!fs.skillMdExists) {
    if (meta !== null) {
      warnings.push(
        `警告：安装记录仍在但落点不存在（${fs.targetPath}；残留 meta.json，可能被手工删除）；` +
          '如需重装请执行安装/更新动作，如需清除记录请执行卸载（purge）。',
      )
    }
    return {
      state: 'missing',
      installed: false,
      version: null,
      contentHash: null,
      expectedHash: meta?.contentHash ?? null,
      drift: meta?.contentHash ? 'drifted' : 'unknown',
      warnings,
    }
  }

  if (!fs.fsFrontmatter?.ok) {
    warnings.push(
      `警告：${fs.skillMdPath} 的 frontmatter 无法解析（缺失/截断/无 name 键）；` +
        '建议执行安装/更新以恢复已知良好版本。',
    )
    return {
      state: 'unparseable',
      installed: true,
      version: null,
      contentHash: fs.fsContentHash,
      expectedHash: meta?.contentHash ?? null,
      drift: meta?.contentHash ? (meta.contentHash === fs.fsContentHash ? 'unchanged' : 'drifted') : 'unknown',
      warnings,
    }
  }

  const fsVersion = fs.fsVersion
  const fsHash = fs.fsContentHash

  if (meta === null) {
    warnings.push(
      `警告：安装记录缺失（meta.json 不存在），版本取自文件系统（${fsVersion ?? '未知'}）；` +
        '建议重装以恢复哈希基线。',
    )
    return {
      state: 'installed',
      installed: true,
      version: fsVersion,
      contentHash: fsHash,
      expectedHash: null,
      drift: 'unknown',
      warnings,
    }
  }

  let state: ReconciledStateName = 'installed'
  const expectedHash = meta.contentHash
  const drift = expectedHash === null ? 'unknown' : expectedHash === fsHash ? 'unchanged' : 'drifted'
  if (drift === 'drifted') {
    state = 'content-drifted'
    warnings.push(
      `警告：指令集已变更，建议人工复核——本地 SKILL.md 哈希（文件系统）${fsHash} 与安装记录 ${expectedHash} 不一致` +
        `（版本号：文件系统 ${fsVersion ?? '未知'} / 记录 ${meta.version ?? '未知'}）。哈希仅检测相对上次安装的本地漂移。`,
    )
  } else if (fsVersion !== meta.version && meta.version !== null) {
    state = 'state-mismatch'
    warnings.push(
      `警告：落点与安装记录不一致——文件系统版本 ${fsVersion ?? '未知'} / meta.json 记录 ${meta.version}；` +
        '以文件系统为准，建议重装以同步记录。',
    )
  }
  return { state, installed: true, version: fsVersion, contentHash: fsHash, expectedHash, drift, warnings }
}

/** 供 root/installer 复用的「相等/在内」判定（zip-guard 的再导出）。 */
export { isInsideOrEqual }
