/**
 * 状态查询出口的数据源单点实现（tasks 3.1 / 3.4；design D-15）。
 *
 * `buildSkillStatus()` 的返回体即 change 2 的 health 出口两段视图中
 * `skill` 段（该两段视图的唯一 owner 是 change 2，`contracts §11`/`§12.2`——
 * 本模块 MUST NOT 产出 / 注册 / 实现 health 两段视图的组装）。
 *
 * 铁律：
 * - **status MUST NOT 内联发起网络请求**（`sourceReachable` 是 meta.json 里的
 *   缓存结论）；本模块零 fetch / 零 http（源码断言覆盖）。
 * - **以文件系统为准**（state.ts reconcile）：meta.json 只是备忘。
 * - `minVersion` 基线只在 `https-zip` 源生效；localDir 源 `baseline: null` 且
 *   MUST NOT 产生 `version-below-baseline`（D-4）。
 * - `cwd` 记录优先 + 受限反推 + 无来源显式拒绝（root.ts / D-1）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SkillRootResolutionError } from './errors.ts'
import { checkTargetIgnored } from './gitignore-notice.ts'
import { checkDiscovery, type HostSkillsService } from './discovery.ts'
import { findShadowedCandidates, formatShadowWarning, type ShadowCandidate } from './shadowing.ts'
import {
  buildKnownSkillRoots,
  deriveRootFromInstallDir,
  resolveProjectRoot,
  resolveTargetRoot,
} from './root.ts'
import {
  metaPathFor,
  readFsSkillState,
  readMeta,
  reconcileFsAndMeta,
  type SkillMeta,
} from './state.ts'
import { compareVersions } from './version.ts'

export type SkillStateName =
  | 'installed'
  | 'missing'
  | 'source-unreachable'
  | 'shadowed'
  | 'not-discovered'
  | 'version-below-baseline'
  | 'content-drifted'
  | 'downgrade-blocked'
  | 'unparseable'
  | 'state-mismatch'
  | 'installed-with-residue'

export interface SkillStatus {
  state: SkillStateName
  installed: boolean
  version: string | null
  previousVersion: string | null
  availableVersion: string | null
  /** minVersion 基线；localDir 源为 null（D-4）。 */
  baseline: string | null
  targetRoot: string
  name: string
  targetPath: string
  skillPath: string
  /** https 源默认 targetRoot 别名（保留以兼容既有消费方）。 */
  installDir: string
  source: {
    kind: 'https-zip' | 'local-dir'
    url: string | null
    path: string | null
    id: string | null
    firstFetchedAt: string | null
  }
  /** 缓存结论；status MUST NOT 内联出站。 */
  sourceReachable: { state: 'reachable' | 'unreachable' | 'unknown'; checkedAt: string | null; reason: string | null }
  contentHash: string | null
  expectedHash: string | null
  drift: 'unchanged' | 'drifted' | 'unknown'
  discovery: {
    checked: boolean
    mode: 'host-service' | 'filesystem-only'
    cwdUsed: string | null
    cwdSource: string | null
    found: boolean
    winner: { path: string; source: string | null; rank: number | null } | null
  }
  shadowed: Array<{ path: string; rank: number | null; version: string | null; name: string }>
  residue: string[]
  resolvedCwd: string | null
  projectRoot: string | null
  cwdSource: 'session' | 'explicit' | 'recorded' | 'install-dir-derived' | null
  lastCheckedAt: string | null
  installedAt: string | null
  /** 目标仓库是否忽略落点（提示性字段，2.4）。 */
  installDirIgnored: boolean | null
  warnings: string[]
}

export interface BuildSkillStatusInput {
  /** 显式 cwd（service 入参 / 工具的 session cwd）。 */
  cwd?: string
  name?: string
  /** 配置的 skill.installDir（'' → 按 D-1 默认 `<projectRoot>/.dsh/skills`）。 */
  installDir?: string
  /** 配置基线（默认 '1.2.0'）；localDir 源不套用。 */
  minVersion?: string | null
  extraSkillRoots?: string[]
  /** 可选宿主 skills 服务（只读核对；缺省 → filesystem-only）。 */
  skills?: HostSkillsService | null
  signal?: AbortSignal
  scope?: unknown
  /** 显式落点根（localDir 源或测试直供；缺省按 installDir/记录/默认推导）。 */
  targetRoot?: string
  dataRoot?: string | null
  vaultRoot?: string | null
  pluginRoot?: string | null
}

interface RootResolution {
  projectRoot: string | null
  resolvedCwd: string | null
  cwdSource: 'session' | 'explicit' | 'recorded' | 'install-dir-derived' | null
  targetRoot: string
  name: string
  meta: SkillMeta | null
  metaCorrupt: boolean
  warnings: string[]
}

/**
 * 根解析（记录优先 + 受限反推 + 无来源拒绝；spec「安装根解析与来源优先级」）。
 * targetRoot 优先级：显式入参 > installDir 配置 > meta 记录 > 默认 `<projectRoot>/.dsh/skills`。
 */
async function resolveStatusRoots(input: BuildSkillStatusInput): Promise<RootResolution> {
  const warnings: string[] = []
  const installDir = (input.installDir ?? '').trim()

  // ── 阶段 1：显式 cwd → projectRoot；meta 定位候选 ──────────────────────
  let projectRoot: string | null = null
  let cwdSource: RootResolution['cwdSource'] = null
  let resolvedCwd: string | null = null
  if (input.cwd !== undefined && input.cwd !== '') {
    projectRoot = resolveProjectRoot(input.cwd)
    cwdSource = 'explicit'
    resolvedCwd = input.cwd
  }
  const candidateTargetRoot: string | null = input.targetRoot
    ? path.resolve(input.targetRoot)
    : installDir !== '' && path.isAbsolute(installDir)
      ? path.resolve(installDir)
      : projectRoot !== null
        ? installDir !== ''
          ? path.resolve(projectRoot, installDir) // 相对 installDir 以 projectRoot 为基
          : path.join(projectRoot, '.dsh', 'skills')
        : null

  // ── 阶段 2：读 meta（记录优先的数据基础）──────────────────────────────
  let meta: SkillMeta | null = null
  let metaCorrupt = false
  if (candidateTargetRoot !== null) {
    const read = await readMeta(metaPathFor(candidateTargetRoot, input.name ?? 'tdx-tq-local'))
    meta = read.meta
    metaCorrupt = read.corrupt
  }

  // ── 阶段 3：无显式 cwd 时记录值优先 ───────────────────────────────────
  if (cwdSource === null && meta?.projectRoot) {
    projectRoot = path.resolve(meta.projectRoot)
    cwdSource = 'recorded'
    resolvedCwd = meta.resolvedCwd ?? null
  }

  // ── 阶段 4：受限反推（仅绝对路径 且 祖先与记录值一致或含 .git）────────
  if (cwdSource === null) {
    if (installDir === '') {
      throw new SkillRootResolutionError(
        '无法解析项目根：无可用来源（cwd 未传；meta.json 无记录值；skill.installDir 为空不可反推）——拒绝猜测，请显式传 cwd',
        { configKey: 'skill.installDir' },
      )
    }
    if (!path.isAbsolute(installDir)) {
      throw new SkillRootResolutionError(
        `skill.installDir 为相对路径（${installDir}）且无解析基：cwd 未传、meta.json 无记录值——拒绝猜测，请显式传 cwd 或改用绝对路径`,
        { configKey: 'skill.installDir', installDir },
      )
    }
    const derived = deriveRootFromInstallDir(installDir, meta?.projectRoot ?? null)
    if (derived === null) {
      throw new SkillRootResolutionError(
        `无法解析项目根：skill.installDir（${installDir}）为绝对路径，但其祖先目录既与安装记录不一致、也不含 .git，` +
          `受限反推失败；请显式传 cwd，或修正 installDir 配置（尝试推导的祖先链自 ${path.dirname(path.resolve(installDir))} 起向上）`,
        { configKey: 'skill.installDir', installDir },
      )
    }
    projectRoot = derived
    cwdSource = 'install-dir-derived'
    resolvedCwd = null
  }

  // ── 阶段 5：显式 cwd 与记录不一致 → 以显式为准并告警（优先级 1 > 2）────
  if (cwdSource === 'explicit' && meta?.projectRoot && projectRoot !== null && path.resolve(meta.projectRoot) !== path.resolve(projectRoot)) {
    warnings.push(
      `警告：显式 cwd 与安装记录不一致——以显式 cwd 为准：` +
        `projectRoot=${projectRoot}（cwdSource=explicit），记录值=${meta.projectRoot}（cwdSource=recorded）；` +
        '落点判定使用显式值，请确认安装落点与会话工作空间一致。',
    )
  }

  // ── 阶段 6：最终 targetRoot ───────────────────────────────────────────
  const name = input.name ?? meta?.name ?? 'tdx-tq-local'
  let targetRoot: string
  if (input.targetRoot) {
    targetRoot = path.resolve(input.targetRoot)
  } else if (installDir !== '') {
    targetRoot = resolveTargetRoot({
      projectRoot,
      installDir,
      kind: meta?.sourceKind ?? 'https-zip',
      dataRoot: input.dataRoot ?? null,
      vaultRoot: input.vaultRoot ?? null,
      pluginRoot: input.pluginRoot ?? null,
    }).targetRoot
  } else if (meta?.targetRoot) {
    targetRoot = path.resolve(meta.targetRoot) // 记录优先（N1）
  } else {
    targetRoot = path.join(projectRoot as string, '.dsh', 'skills')
  }
  // meta 与最终落点不符（记录属另一落点）→ 视为无记录
  if (meta && meta.targetRoot && path.resolve(meta.targetRoot) !== path.resolve(targetRoot)) {
    meta = null
  }
  return { projectRoot, resolvedCwd, cwdSource, targetRoot, name, meta, metaCorrupt, warnings }
}

/** 版本基线警告装配（tasks 3.1：缺失/不可解析/低于基线；localDir 源 baseline=null）。 */
function baselineWarnings(input: {
  kind: 'https-zip' | 'local-dir'
  version: string | null
  versionUnparsable: boolean
  minVersion: string | null
  installed: boolean
}): { baseline: string | null; warnings: string[]; belowBaseline: boolean } {
  // 基线只在 https-zip 源生效（D-4）：localDir 源不产生 version-below-baseline 假警告
  const baseline = input.kind === 'https-zip' ? input.minVersion : null
  const warnings: string[] = []
  if (!input.installed || baseline === null) return { baseline, warnings, belowBaseline: false }
  if (input.version === null) {
    warnings.push(
      '警告：已安装的 SKILL.md 未包含 version 字段（原因：frontmatter 无 version 键）；' +
        `基线为 ${baseline}；建议动作：执行安装/更新以恢复可判定的版本。`,
    )
    return { baseline, warnings, belowBaseline: false }
  }
  if (input.versionUnparsable) {
    warnings.push(
      `警告：已安装版本「${input.version}」无法解析为语义化版本号（原因：格式不符合 x.y.z）；` +
        `基线为 ${baseline}；建议动作：执行安装/更新以恢复可解析版本（宁可吵，不可假）。`,
    )
    return { baseline, warnings, belowBaseline: false }
  }
  if (compareVersions(input.version, baseline) < 0) {
    warnings.push(
      `警告：已安装版本 ${input.version} 低于基线 ${baseline}（原因：版本过低）；` +
        '建议动作：执行更新（tq_skill_manage action=update）升级到基线及以上版本。功能不阻断。',
    )
    return { baseline, warnings, belowBaseline: true }
  }
  return { baseline, warnings, belowBaseline: false }
}

async function scanResidue(targetRoot: string, meta: SkillMeta | null): Promise<string[]> {
  const tmpBase = path.join(path.dirname(path.resolve(targetRoot)), '.dsh-trader-kit-tmp')
  const out = new Set<string>(meta?.residue ?? [])
  try {
    for (const entry of await fsp.readdir(tmpBase, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('run-')) out.add(path.join(tmpBase, entry.name))
    }
  } catch {
    // tmpBase 不存在：无残留
  }
  // 历史顶层残留（会被宿主误发现）
  try {
    for (const entry of await fsp.readdir(path.resolve(targetRoot), { withFileTypes: true })) {
      if (entry.isDirectory() && /^\..*(?:backup|stage)-/.test(entry.name)) {
        out.add(path.join(path.resolve(targetRoot), entry.name))
      }
    }
  } catch {
    // targetRoot 不存在
  }
  return [...out]
}

/**
 * 构建 skill 段状态（单点实现；工具 action:'status' 与 service 同一实现）。
 * 全部 D-15 字段齐备（null 表示不可得，不省略键）。
 */
export async function buildSkillStatus(input: BuildSkillStatusInput = {}): Promise<SkillStatus> {
  const resolution = await resolveStatusRoots(input)
  const { meta, metaCorrupt } = resolution
  const warnings = [...resolution.warnings]
  const targetRoot = resolution.targetRoot
  const name = resolution.name
  const targetPath = path.join(targetRoot, name)
  const skillPath = path.join(targetPath, 'SKILL.md')

  // cwd ≠ projectRoot（monorepo 子目录/会话工作空间与项目根不一致）→ 显式提示根证据
  if (
    resolution.resolvedCwd !== null &&
    resolution.projectRoot !== null &&
    path.resolve(resolution.resolvedCwd) !== path.resolve(resolution.projectRoot)
  ) {
    warnings.push(
      `警告：会话 cwd 与项目根不一致——resolvedCwd=${resolution.resolvedCwd}、projectRoot=${resolution.projectRoot}、` +
        `cwdSource=${resolution.cwdSource}；落点与可发现性核对按 projectRoot 执行，请确认会话工作空间与安装根一致。`,
    )
  }

  // 文件系统 × meta 调解（事实源优先级）
  const fsState = await readFsSkillState(targetRoot, name)
  const reconciled = reconcileFsAndMeta(fsState, meta, metaCorrupt)
  warnings.push(...reconciled.warnings)

  const kind = meta?.sourceKind ?? 'https-zip'
  const minVersion = input.minVersion ?? '1.2.0'
  const { baseline, warnings: baselineWarningTexts, belowBaseline } = baselineWarnings({
    kind,
    version: reconciled.version,
    versionUnparsable: fsState.fsFrontmatter?.ok === true ? fsState.fsFrontmatter.versionUnparsable : false,
    minVersion,
    installed: reconciled.installed,
  })
  warnings.push(...baselineWarningTexts)

  // 可发现性核对（cwd 必传——用根解析产物）
  const discovery = await checkDiscovery({
    skills: input.skills ?? undefined,
    projectRoot: resolution.projectRoot ?? targetRoot,
    targetRoot,
    name,
    cwdSource: resolution.cwdSource ?? undefined,
    signal: input.signal,
    scope: input.scope,
  })
  warnings.push(...discovery.warnings)

  // 同名遮蔽检测（候选根：本落点 + 默认两级 + extraSkillRoots + 宿主赢家所在根）
  const ourRank =
    discovery.winner !== null && discovery.found
      ? (discovery.winner.rank ?? null)
      : path.resolve(targetRoot) === path.resolve(path.join(path.resolve(resolution.projectRoot ?? targetRoot), '.dsh', 'skills'))
        ? 100
        : null
  const candidateRoots = [
    { path: targetRoot, rank: ourRank },
    ...buildKnownSkillRoots(resolution.projectRoot, input.extraSkillRoots ?? []),
  ]
  const shadowed: ShadowCandidate[] = findShadowedCandidates({
    roots: candidateRoots,
    name,
    excludePath: skillPath,
  })
  const shadowingBlocked = !discovery.found && shadowed.length > 0
  if (shadowingBlocked) {
    for (const candidate of shadowed) warnings.push(formatShadowWarning(candidate))
  }

  // 残留（meta 记录 + tmpBase run-* + 历史顶层形态）
  const residue = await scanResidue(targetRoot, meta)
  if (residue.length > 0) {
    warnings.push(
      `警告：检测到 ${residue.length} 处暂存/备份残留（首处：${residue[0]}）；` +
        '下次安装/更新/启动检查会重试清理，或执行卸载动作清理。',
    )
  }

  // 源不可达（缓存结论，不内联出站）
  const sourceReachable = meta?.sourceReachable ?? { state: 'unknown' as const, checkedAt: null, reason: null }

  // 目标仓库忽略状态（2.4：只提示，不代改）
  let installDirIgnored: boolean | null = null
  const gitignore = await checkTargetIgnored(targetRoot)
  if (gitignore.isGitRepo && gitignore.gitignorePresent) {
    installDirIgnored = gitignore.ignored
    if (gitignore.hint) warnings.push(gitignore.hint)
  }

  // ── 状态判定（确定性优先级）──────────────────────────────────────────
  let state: SkillStateName = reconciled.state
  if (reconciled.installed && belowBaseline) {
    state = 'version-below-baseline'
  }
  if (meta?.downgradeBlocked) {
    state = 'downgrade-blocked'
    warnings.push(
      `警告：上次更新被降级闸门拒绝（远端 ${meta.downgradeBlocked.remoteVersion} < 本地 ${meta.downgradeBlocked.installedVersion}）；` +
        '已安装版本未变；确需降级请显式传 force: true。',
    )
  }
  if (sourceReachable.state === 'unreachable') {
    state = 'source-unreachable'
    warnings.push(
      `警告：源不可达（${sourceReachable.reason ?? '原因未记录'}）；已安装版本保留继续可用（${sourceReachable.checkedAt ?? '未知时间'}探测）。`,
    )
  }
  if (shadowingBlocked) {
    state = 'shadowed'
  } else if (!discovery.found && discovery.mode === 'host-service' && reconciled.installed) {
    state = 'not-discovered'
  }
  if (residue.length > 0 && reconciled.installed && state !== 'missing') {
    state = 'installed-with-residue'
  }

  return {
    state,
    installed: reconciled.installed,
    version: reconciled.version,
    previousVersion: meta?.previousVersion ?? null,
    availableVersion: meta?.availableVersion ?? null,
    baseline,
    targetRoot,
    name,
    targetPath,
    skillPath,
    installDir: targetRoot,
    source: {
      kind,
      url: meta?.sourceUrl ?? null,
      path: kind === 'local-dir' ? (meta?.sourceUrl ?? null) : null,
      id: meta?.sourceId ?? null,
      firstFetchedAt: meta?.firstFetchedAt ?? null,
    },
    sourceReachable,
    contentHash: reconciled.contentHash,
    expectedHash: reconciled.expectedHash,
    drift: reconciled.drift,
    discovery,
    shadowed,
    residue,
    resolvedCwd: resolution.resolvedCwd,
    projectRoot: resolution.projectRoot,
    cwdSource: resolution.cwdSource,
    lastCheckedAt: meta?.lastCheckedAt ?? null,
    installedAt: meta?.installedAt ?? null,
    installDirIgnored,
    warnings,
  }
}
