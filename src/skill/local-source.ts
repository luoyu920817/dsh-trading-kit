/**
 * 本地目录源部署（tasks 5.2，design D-11；spec「本地目录源部署」）。
 *
 * 具名签名：`syncLocalDir(input: { sourcePath, targetRoot, name })`（service key
 * `traderKit.skill.deployLocalDir`，工具出口 `tq_skill_manage action:'deploy'`）。
 * 三态全部落在代码层（MUST NOT 交给 agent 自律）：
 * - `in-sync`：目标内容哈希 == 源内容哈希 → 零写入；
 * - `user-modified`：目标存在、内容不同、源版本 ≤ 目标版本（或源无 version）→
 *   不覆盖 + 非空 diff；
 * - `upgradable`：源版本 > 目标版本 → 走原子替换（installer 同一实现）→ `updated`。
 *
 * `targetRoot` 允许 = `<dataRoot>/agent/skills`（change 5 落点，contracts §10
 * 白名单区）——https 落点的 vault/dataRoot 禁令 MUST NOT 否决本源的白名单落点；
 * `minVersion` 基线对本源不生效（`baseline: null`，MUST NOT 产生
 * `version-below-baseline` 假警告）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SkillInstallerError } from './errors.ts'
import { hashDir, listDirHashes } from './hash.ts'
import { installSkill } from './installer.ts'
import { checkDiscovery, type DiscoveryResult, type HostSkillsService } from './discovery.ts'
import { parseSkillFrontmatter } from './version.ts'

export type LocalDeployOutcome = 'in-sync' | 'user-modified' | 'upgradable' | 'installed' | 'updated' | 'rejected'

export interface DeployLocalDirInput {
  /** 源目录（如仓库 skills/review-daily-summary/）。 */
  sourcePath: string
  /** 落点根（change 5 = <dataRoot>/agent/skills）。 */
  targetRoot: string
  /** skill 目录名（change 5 = 'review-daily-summary'）。 */
  name: string
  projectRoot?: string | null
  extraSkillRoots?: string[]
  skills?: HostSkillsService
  signal?: AbortSignal
  scope?: unknown
  now?: () => Date
}

export interface LocalDeployResult {
  outcome: LocalDeployOutcome
  name: string
  /** `<targetRoot>/<name>/`。 */
  targetPath: string
  contentHash: string
  version: string | null
  previousVersion: string | null
  /** user-modified 时 MUST 非空（差异文件清单文本）。 */
  diff?: string
  residue: string[]
  warnings: string[]
  /** `<targetRoot>/<name>/SKILL.md`。 */
  skillPath: string
  /** localDir 源恒为 null（D-4：基线不生效）。 */
  baseline: null
  discovery?: DiscoveryResult
}

async function readVersionFromSkillMd(packageDir: string): Promise<string | null> {
  try {
    const bytes = await fsp.readFile(path.join(packageDir, 'SKILL.md'))
    const parsed = parseSkillFrontmatter(bytes.toString('utf8'))
    return parsed.ok ? (parsed.version?.raw ?? null) : null
  } catch {
    return null
  }
}

/** 差异文件清单文本（`--- a/<rel>` / `+++ b/<rel>` 逐差异文件；MUST 非空）。 */
function buildDiffText(sourceFiles: NonNullable<Awaited<ReturnType<typeof listDirHashes>>>, targetFiles: NonNullable<Awaited<ReturnType<typeof listDirHashes>>>): string {
  const sourceByPath = new Map(sourceFiles.map((file) => [file.relPath, file]))
  const targetByPath = new Map(targetFiles.map((file) => [file.relPath, file]))
  const lines: string[] = ['--- a/<目标目录（用户版本）>', '+++ b/<源目录（待部署版本）>']
  const allPaths = new Set<string>([...sourceByPath.keys(), ...targetByPath.keys()])
  const sorted = [...allPaths].sort()
  for (const relPath of sorted) {
    const inSource = sourceByPath.get(relPath)
    const inTarget = targetByPath.get(relPath)
    if (inSource && !inTarget) {
      lines.push(`--- a/${relPath}（目标缺失，源新增，sha256 ${inSource.sha256.slice(0, 12)}…）`)
      lines.push(`+++ b/${relPath}`)
    } else if (!inSource && inTarget) {
      lines.push(`--- a/${relPath}`)
      lines.push(`+++ b/${relPath}（目标独有，源已删除，sha256 ${inTarget.sha256.slice(0, 12)}…）`)
    } else if (inSource && inTarget && inSource.sha256 !== inTarget.sha256) {
      lines.push(`--- a/${relPath}`)
      lines.push(`+++ b/${relPath}`)
      lines.push(`@@ 内容不同：目标 sha256 ${inTarget.sha256.slice(0, 12)}… / 源 sha256 ${inSource.sha256.slice(0, 12)}…`)
    }
  }
  return lines.join('\n')
}

/**
 * 本地目录源三态部署（与 https zip 源共用 installer 的校验/原子替换/零残留/
 * 可发现性核对实现；互斥由 installer 的锁承担）。
 */
export async function syncLocalDir(input: DeployLocalDirInput): Promise<LocalDeployResult> {
  const sourcePath = path.resolve(input.sourcePath)
  const targetRoot = path.resolve(input.targetRoot)
  const name = input.name
  const targetPath = path.join(targetRoot, name)
  const skillPath = path.join(targetPath, 'SKILL.md')
  const warnings: string[] = []

  let sourceStat
  try {
    sourceStat = await fsp.stat(sourcePath)
  } catch {
    throw new SkillInstallerError('SOURCE_DIR_MISSING', `本地目录源不存在：${sourcePath}`, { sourcePath })
  }
  if (!sourceStat.isDirectory()) {
    throw new SkillInstallerError('SOURCE_DIR_NOT_DIRECTORY', `本地目录源不是目录：${sourcePath}`, { sourcePath })
  }

  const sourceHash = await hashDir(sourcePath)
  const sourceVersion = await readVersionFromSkillMd(sourcePath)

  let targetStat
  try {
    targetStat = await fsp.stat(targetPath)
  } catch {
    targetStat = null
  }

  // ── 首次部署：目标不存在 → 直接安装（与 https 源同一原子替换实现）──────
  if (!targetStat || !targetStat.isDirectory()) {
    const install = await installSkill({
      targetRoot,
      name,
      kind: 'local-dir',
      sourceDir: sourcePath,
      sourceId: `dir:${sourceHash}`,
      projectRoot: input.projectRoot ?? null,
      extraSkillRoots: input.extraSkillRoots,
      skills: input.skills,
      signal: input.signal,
      scope: input.scope,
      now: input.now,
    })
    if (!install.ok && install.outcome === 'rejected') {
      // 被拒调用显式返回 rejected（design D-10），MUST NOT 与成功结果混同
      return {
        outcome: 'rejected',
        name,
        targetPath,
        contentHash: install.contentHash ?? '',
        version: install.version,
        previousVersion: install.previousVersion,
        residue: install.residue,
        warnings: install.warnings,
        skillPath,
        baseline: null,
      }
    }
    const discovery = await maybeDiscovery(input, targetRoot, name)
    return {
      outcome: 'installed',
      name,
      targetPath,
      contentHash: install.contentHash ?? sourceHash,
      version: install.version,
      previousVersion: null,
      residue: install.residue,
      warnings: [...warnings, ...install.warnings, ...discovery.warnings],
      skillPath,
      baseline: null,
      discovery: discovery.result ?? undefined,
    }
  }

  // ── 三态判定 ──────────────────────────────────────────────────────────
  const targetHash = await hashDir(targetPath)
  if (targetHash === sourceHash) {
    // in-sync：零写入（不 mkdir、不 rename、不 mtime）
    const discovery = await maybeDiscovery(input, targetRoot, name)
    return {
      outcome: 'in-sync',
      name,
      targetPath,
      contentHash: targetHash,
      version: sourceVersion,
      previousVersion: sourceVersion,
      residue: [],
      warnings: [...warnings, ...discovery.warnings],
      skillPath,
      baseline: null,
      discovery: discovery.result ?? undefined,
    }
  }

  const targetVersion = await readVersionFromSkillMd(targetPath)
  // upgradable：源版本 > 目标版本；user-modified：源版本 ≤ 目标版本（或源无 version）
  const comparable = sourceVersion !== null && targetVersion !== null && compareVersionsSafe(sourceVersion, targetVersion) > 0
  if (comparable) {
    const install = await installSkill({
      targetRoot,
      name,
      kind: 'local-dir',
      sourceDir: sourcePath,
      sourceId: `dir:${sourceHash}`,
      previousSourceId: `dir:${targetHash}`,
      projectRoot: input.projectRoot ?? null,
      extraSkillRoots: input.extraSkillRoots,
      skills: input.skills,
      signal: input.signal,
      scope: input.scope,
      now: input.now,
    })
    if (!install.ok && install.outcome === 'rejected') {
      // 被拒调用显式返回 rejected（design D-10），MUST NOT 与成功结果混同
      return {
        outcome: 'rejected',
        name,
        targetPath,
        contentHash: install.contentHash ?? '',
        version: install.version,
        previousVersion: install.previousVersion,
        residue: install.residue,
        warnings: install.warnings,
        skillPath,
        baseline: null,
      }
    }
    const discovery = await maybeDiscovery(input, targetRoot, name)
    return {
      outcome: 'updated',
      name,
      targetPath,
      contentHash: install.contentHash ?? sourceHash,
      version: install.version,
      previousVersion: install.previousVersion,
      residue: install.residue,
      warnings: [...warnings, ...install.warnings, ...discovery.warnings],
      skillPath,
      baseline: null,
      discovery: discovery.result ?? undefined,
    }
  }

  // user-modified：不覆盖 + 非空 diff（统一 diff 文本，逐差异文件）
  const sourceFiles = await listDirHashes(sourcePath)
  const targetFiles = await listDirHashes(targetPath)
  const diff = buildDiffText(sourceFiles ?? [], targetFiles ?? [])
  const discovery = await maybeDiscovery(input, targetRoot, name)
  return {
    outcome: 'user-modified',
    name,
    targetPath,
    contentHash: targetHash,
    version: targetVersion,
    previousVersion: targetVersion,
    diff,
    residue: [],
    warnings: [
      ...warnings,
      '警告：目标目录与源不一致且源版本未高于目标版本（可能含用户手工打磨）——未覆盖；' +
        'diff 已随返回体输出，请人工合并后重部署。',
      ...discovery.warnings,
    ],
    skillPath,
    baseline: null,
    discovery: discovery.result ?? undefined,
  }
}

function compareVersionsSafe(a: string, b: string): number {
  const pa = parseSemverTriple(a)
  const pb = parseSemverTriple(b)
  if (!pa || !pb) return 0
  return pa[0] !== pb[0] ? pa[0] - pb[0] : pa[1] !== pb[1] ? pa[1] - pb[1] : pa[2] - pb[2]
}

function parseSemverTriple(value: string): [number, number, number] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

async function maybeDiscovery(
  input: DeployLocalDirInput,
  targetRoot: string,
  name: string,
): Promise<{ warnings: string[]; result: DiscoveryResult | null }> {
  const projectRoot = input.projectRoot ?? null
  if (!projectRoot) return { warnings: [], result: null }
  const result = await checkDiscovery({
    skills: input.skills ?? undefined,
    projectRoot,
    targetRoot,
    name,
    signal: input.signal,
    scope: input.scope,
  })
  return { warnings: result.warnings, result }
}
