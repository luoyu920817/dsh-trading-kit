/**
 * 原子安装流程（tasks 1.5 / 1.7，design D-3；spec「原子安装到 DSH 可发现的 skill 根」）。
 *
 * 落点由两个具名参数决定（N2 参数化）：`targetRoot` + `name`，落点 = `<targetRoot>/<name>/`。
 * `tdx-tq-local` / `installDir` 只是 https 源的默认实例，本流程 MUST NOT 写死它们。
 *
 * 流程（暂存区基准点 = `dirname(targetRoot)`，且不在任何 skills 扫描根内）：
 *  1. `tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')`；
 *  2. 两条独立断言（N6）：① `assertNotInside(tmpBase, root)` 对 knownSkillRoots 的
 *     每个 root（含 targetRoot 自身，「相等=在内」）；② targetRoot MUST NOT 是其它
 *     更前 rank 登记根的后代（违反 → `TMP_AREA_IN_SCAN_ROOT`；等于自身登记项合法）；
 *  3. 历史残留迁移/清理（`targetRoot` 顶层 `.*backup-*`/`.*stage-*` 与 tmpBase 的
 *     `run-*` 残留，可重试，失败记 warning 不阻断）；
 *  4. 进程内 + 跨进程锁（try-acquire；被拒 → `outcome: 'rejected'`）；
 *  5. `fs.mkdtemp` 唯一运行目录 `runDir`；
 *  6. 填充 stage（zip：加固解压+结构校验后改名到 `runDir/stage/<name>`；dir：整目录复制）——
 *     **https 源的下载以延迟 provider 在断言与加锁之后执行**（spec：暂存区断言失败
 *     MUST NOT 开始下载）；
 *  7. 降级闸门（downgrade.ts）+ 同版本同哈希零替换（up-to-date）；
 *  8. 旧版改名 → `runDir/backup/<name>`；stage 改名 → `<targetRoot>/<name>`；
 *  9. 删除 `runDir` 并 `stat` 断言零残留；删除失败 → `installed-with-residue` +
 *     `ok: false` + `residue[]`（MUST NOT 报成功）。
 *
 * 不变量：任何时刻要么旧版可用、要么新版可用，不存在半装状态；失败回滚恢复 backup。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { DowngradeBlockedError, SkillInstallerError } from './errors.ts'
import { sha256Bytes, sha256File } from './hash.ts'
import { acquireInstallLock, describeLockHolder, type InstallLockInfo } from './lock.ts'
import { buildKnownSkillRoots, type KnownSkillRoot } from './root.ts'
import { metaPathFor, readMeta, writeMeta, type SkillMeta, type SkillSourceKind } from './state.ts'
import { compareVersions, parseSkillFrontmatter } from './version.ts'
import { checkDowngrade } from './downgrade.ts'
import { validateAndStageZip, validateLocalDirPackage } from './validate.ts'
import { assertNotInside, isStrictlyInside, DEFAULT_ZIP_LIMITS, type ZipLimits } from './zip-guard.ts'
import { checkDiscovery, type DiscoveryResult, type HostSkillsService } from './discovery.ts'

export type InstallOutcome =
  | 'installed'
  | 'updated'
  | 'up-to-date'
  | 'installed-with-residue'
  | 'rejected'
  | 'downgrade-blocked'

export interface InstallResult {
  ok: boolean
  outcome: InstallOutcome
  version: string | null
  previousVersion: string | null
  /** `<targetRoot>/<name>/SKILL.md` 绝对路径。 */
  path: string
  sourceId: string | null
  previousSourceId: string | null
  contentHash: string | null
  warnings: string[]
  residue: string[]
  discovery?: DiscoveryResult
}

/** 延迟下载 provider：在断言与加锁之后才调用（spec：断言失败 MUST NOT 开始下载）。 */
export interface ArchiveProviderContext {
  runDir: string
  archivePath: string
}

export interface InstallSkillInput {
  targetRoot: string
  name: string
  kind: SkillSourceKind
  /** https 源的 zip 字节（已下载，测试直供）；与 archiveProvider 二选一。 */
  archiveBytes?: Uint8Array
  /** https 源的延迟下载（生产路径：downloadToFile 落盘到 runDir 内）。 */
  archiveProvider?: (ctx: ArchiveProviderContext) => Promise<{ archiveBytes: Uint8Array; archiveHash: string }>
  /** localDir 源的源目录（整目录复制到 stage）。 */
  sourceDir?: string
  /** 记录进 meta 的源标识（etag/lastModified 组合或目录哈希）。 */
  sourceId?: string | null
  previousSourceId?: string | null
  sourceUrl?: string | null
  archiveHash?: string | null
  etag?: string | null
  lastModified?: string | null
  /** 根解析记录（首次安装持久化进 meta.json；spec「首次安装持久化根」）。 */
  rootRecord?: { resolvedCwd: string | null; projectRoot: string | null }
  /** 已知登记根（缺省按 projectRoot 推导默认两级 + extraSkillRoots）。 */
  projectRoot?: string | null
  extraSkillRoots?: string[]
  limits?: ZipLimits
  force?: boolean
  strictNameMatch?: boolean
  /** 可选宿主 skills 服务（只读可发现性核对，design D-6）。 */
  skills?: HostSkillsService
  /** 显式 signal/scope（宿主消费者同款用法）。 */
  signal?: AbortSignal
  scope?: unknown
  now?: () => Date
  /** 失败注入点（测试专用：回滚/零残留/删除失败路径）。 */
  hooks?: {
    afterAssertions?: () => Promise<void> | void
    afterStageValidated?: () => Promise<void> | void
    afterBackup?: () => Promise<void> | void
    afterRename?: () => Promise<void> | void
    beforeCleanup?: () => Promise<void> | void
  }
  /**
   * 删除实现注入（测试专用，模拟 Windows 占用/杀软导致的删除失败——现代 libuv
   * 以 FILE_SHARE_DELETE 打开文件，句柄占用已无法阻止 fs.rm）。
   * 缺省 = 真实 fs.rm（recursive/force + 重试）。
   */
  rmImpl?: (target: string) => Promise<void>
}

function rmRecursive(target: string): Promise<void> {
  return fsp.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 })
}

/** 列出目录树下仍存在的路径（零残留断言用；上限 500 条防失控）。 */
async function listResidue(root: string): Promise<string[]> {
  const out: string[] = [root]
  try {
    for (const entry of await fsp.readdir(root, { withFileTypes: true, recursive: true })) {
      if (out.length >= 500) break
      out.push(path.resolve(root, entry.name))
    }
  } catch {
    return out
  }
  return out
}

const LEGACY_RESIDUE_RE = /^\..*(?:backup|stage)-/

/**
 * 暂存区断言（N6 两条独立断言；spec「原子安装」）。可独立调用：
 * install/update 前置校验，或 status/配置校验期的静态检查。
 */
export function assertInstallArea(input: {
  targetRoot: string
  projectRoot?: string | null
  extraSkillRoots?: string[]
}): { tmpBase: string; knownSkillRoots: KnownSkillRoot[] } {
  const targetRoot = path.resolve(input.targetRoot)
  const tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')
  const registered = buildKnownSkillRoots(input.projectRoot ?? null, input.extraSkillRoots ?? [])

  // 断言②：targetRoot MUST NOT 是其它登记根的后代（「等于自身登记项」合法，不报错）
  for (const root of registered) {
    if (isStrictlyInside(targetRoot, root.path)) {
      throw new SkillInstallerError(
        'TMP_AREA_IN_SCAN_ROOT',
        `落点 <${targetRoot}> 是已知 skill 扫描根 <${root.path}>（rank ${root.rank ?? '?'}）的后代——` +
          `暂存区 <${tmpBase}> 将落入扫描根，拒绝安装；请修正 skill.installDir 配置`,
        { configKey: 'skill.installDir', targetRoot, scanRoot: root.path, rank: root.rank },
      )
    }
  }

  // 断言①：tmpBase 不得位于任何 knownSkillRoots 内（含 targetRoot 自身；「相等=在内」）
  const knownSkillRoots: KnownSkillRoot[] = [{ path: targetRoot, rank: null }, ...registered]
  const seen = new Set<string>()
  for (const root of knownSkillRoots) {
    const resolved = path.resolve(root.path)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    assertNotInside(tmpBase, resolved)
  }
  return { tmpBase, knownSkillRoots }
}

async function readInstalledVersionAndHash(targetPath: string): Promise<{ version: string | null; hash: string | null }> {
  const skillMdPath = path.join(targetPath, 'SKILL.md')
  try {
    const bytes = await fsp.readFile(skillMdPath)
    const parsed = parseSkillFrontmatter(bytes.toString('utf8'))
    return {
      version: parsed.ok ? (parsed.version?.raw ?? null) : null,
      hash: await sha256File(skillMdPath),
    }
  } catch {
    return { version: null, hash: null }
  }
}

/** 历史残留迁移/清理：targetRoot 顶层 `.*backup-*`/`.*stage-*` + tmpBase 的 run-* 残留。 */
async function cleanResidues(targetRoot: string, tmpBase: string): Promise<{ warnings: string[]; residue: string[] }> {
  const warnings: string[] = []
  const residue: string[] = []
  try {
    for (const entry of await fsp.readdir(targetRoot, { withFileTypes: true })) {
      if (LEGACY_RESIDUE_RE.test(entry.name) && entry.isDirectory()) {
        const legacyPath = path.join(targetRoot, entry.name)
        try {
          // 会被宿主当 skill 发现的顶层残留（F4 无 dot 过滤）：直接删除
          await rmRecursive(legacyPath)
          warnings.push(`警告：已清理历史残留目录 ${legacyPath}（旧版布局，会被宿主误发现）。`)
        } catch {
          residue.push(legacyPath)
          warnings.push(`警告：历史残留目录 ${legacyPath} 清理失败，已记入 residue，下次安装/更新重试。`)
        }
      }
    }
  } catch {
    // targetRoot 尚不存在：无历史残留
  }
  try {
    for (const entry of await fsp.readdir(tmpBase, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('run-')) {
        const leftover = path.join(tmpBase, entry.name)
        try {
          await rmRecursive(leftover)
          warnings.push(`警告：已清理上次安装的暂存残留 ${leftover}。`)
        } catch {
          residue.push(leftover)
          warnings.push(`警告：暂存残留 ${leftover} 清理失败，已记入 residue，下次安装/更新重试。`)
        }
      }
    }
  } catch {
    // tmpBase 尚不存在
  }
  return { warnings, residue }
}

/**
 * 原子安装 / 更新（https zip 与 localDir 源共用同一实现，design D-11）。
 */
export async function installSkill(input: InstallSkillInput): Promise<InstallResult> {
  const targetRoot = path.resolve(input.targetRoot)
  const name = input.name
  const targetPath = path.join(targetRoot, name)
  const skillMdPath = path.join(targetPath, 'SKILL.md')
  const now = input.now ?? (() => new Date())
  const warnings: string[] = []

  // 断言先于一切（含下载）
  const { tmpBase } = assertInstallArea({
    targetRoot,
    projectRoot: input.projectRoot ?? null,
    extraSkillRoots: input.extraSkillRoots,
  })
  await input.hooks?.afterAssertions?.()

  // 历史残留迁移/清理（可重试；失败不阻断本次安装）
  const cleaned = await cleanResidues(targetRoot, tmpBase)
  warnings.push(...cleaned.warnings)

  // 锁（try-acquire）：进程内 + 跨进程；被拒 → rejected（D-10）
  const acquired = await acquireInstallLock(tmpBase)
  if (!acquired.ok) {
    return {
      ok: false,
      outcome: 'rejected',
      version: null,
      previousVersion: null,
      path: skillMdPath,
      sourceId: input.sourceId ?? null,
      previousSourceId: null,
      contentHash: null,
      warnings: [`警告：${describeLockHolder(acquired.holder)}；本次调用被拒绝（outcome: rejected），未做任何改动。`],
      residue: [],
    }
  }
  const lock = acquired.lock
  if (lock.staleTakeover) {
    warnings.push('警告：检测到超过 10 分钟的陈旧安装锁，已接管继续执行。')
  }

  let runDir: string | null = null
  let backupPath: string | null = null
  let replaced = false
  try {
    runDir = await fsp.mkdtemp(path.join(tmpBase, 'run-'))
    const unzipRoot = path.join(runDir, 'unzip')
    const stageRoot = path.join(runDir, 'stage')

    // ── 填充 stage（zip 延迟下载在此处执行）─────────────────────────────
    let stageVersion: string | null
    let stageHash: string
    let archiveHash = input.archiveHash ?? null
    if (input.kind === 'https-zip') {
      let bytes = input.archiveBytes
      if (!bytes && input.archiveProvider) {
        const provided = await input.archiveProvider({ runDir, archivePath: path.join(runDir, 'package.zip') })
        bytes = provided.archiveBytes
        archiveHash = provided.archiveHash
      }
      if (!bytes) {
        throw new SkillInstallerError('NO_ARCHIVE', 'https 源安装缺少分发包（archiveBytes / archiveProvider 二选一）')
      }
      const validated = await validateAndStageZip({
        zipBytes: bytes,
        unzipRoot,
        stageRoot,
        targetName: name,
        limits: input.limits ?? DEFAULT_ZIP_LIMITS,
        strictNameMatch: input.strictNameMatch,
      })
      stageVersion = validated.version
      stageHash = validated.skillMdSha256
      warnings.push(...validated.warnings)
    } else {
      if (!input.sourceDir) {
        throw new SkillInstallerError('NO_SOURCE_DIR', 'localDir 源安装缺少 sourceDir')
      }
      const stageDir = path.join(stageRoot, name)
      await fsp.mkdir(stageRoot, { recursive: true })
      await fsp.cp(path.resolve(input.sourceDir), stageDir, { recursive: true })
      const validated = await validateLocalDirPackage({
        packageDir: stageDir,
        targetName: name,
        strictNameMatch: input.strictNameMatch,
      })
      stageVersion = validated.version
      stageHash = validated.skillMdSha256
      warnings.push(...validated.warnings)
    }
    await input.hooks?.afterStageValidated?.()

    // ── 现状读取 + 零替换判定 + 降级闸门 ────────────────────────────────
    const installed = await readInstalledVersionAndHash(targetPath)
    const metaPath = metaPathFor(targetRoot, name)
    const { meta: existingMeta } = await readMeta(metaPath)
    const previousSourceId = input.previousSourceId ?? null

    const sourceIdUnchanged =
      input.sourceId !== null &&
      input.sourceId !== undefined &&
      existingMeta !== null &&
      existingMeta.sourceId === input.sourceId
    if (
      installed.version !== null &&
      installed.version === stageVersion &&
      installed.hash === stageHash &&
      sourceIdUnchanged
    ) {
      // 同版本 + 同内容 + 同源标识 → 零替换（不动目标目录、不更新 installedAt；design D-5 / 3.3）
      await rmRecursive(runDir)
      let residue: string[] = []
      try {
        await fsp.stat(runDir)
        residue = await listResidue(runDir)
      } catch {
        // 已不存在：零残留
      }
      const discovery = await maybeCheckDiscovery(input, targetRoot, name)
      return {
        ok: residue.length === 0,
        outcome: 'up-to-date',
        version: installed.version,
        previousVersion: installed.version,
        path: skillMdPath,
        sourceId: input.sourceId ?? null,
        previousSourceId,
        contentHash: stageHash,
        warnings: [
          ...warnings,
          ...discovery.warnings,
          ...(residue.length > 0 ? [`警告：暂存区清理失败，残留 ${residue.length} 项，下次安装/更新重试。`] : []),
        ],
        residue,
        discovery: discovery.result ?? undefined,
      }
    }
    // 同版本 + 同内容但源标识变化（或无记录）→ 覆盖安装并记录新旧源标识（spec「同版本重发」）

    if (installed.version !== null && stageVersion !== null) {
      const decision = checkDowngrade({ remoteVersion: stageVersion, installedVersion: installed.version, force: input.force })
      if (decision.action === 'block') {
        // 记录降级拒绝（status → downgrade-blocked 态）后显式报错
        if (existingMeta) {
          existingMeta.downgradeBlocked = {
            remoteVersion: stageVersion,
            installedVersion: installed.version,
            at: now().toISOString(),
          }
          existingMeta.lastCheckedAt = now().toISOString()
          await writeMeta(metaPath, existingMeta)
        }
        await rmRecursive(runDir)
        throw new DowngradeBlockedError(stageVersion, installed.version)
      }
      if (decision.warning) warnings.push(decision.warning)
    }

    // ── 备份 → 改名（Windows 上目录改名要求目标不存在）─────────────────
    if (await existsDir(targetPath)) {
      const backupRoot = path.join(runDir, 'backup')
      await fsp.mkdir(backupRoot, { recursive: true })
      backupPath = path.join(backupRoot, name)
      await fsp.rename(targetPath, backupPath)
      replaced = true // 有旧版被替换（升级/覆盖），outcome=updated
    }
    await input.hooks?.afterBackup?.()

    await fsp.mkdir(targetRoot, { recursive: true }) // 落点根可能尚不存在（首次安装）
    await fsp.rename(path.join(stageRoot, name), targetPath)
    await input.hooks?.afterRename?.()

    // ── meta.json（首次安装持久化根；同版本重发记录新旧源标识）──────────
    const meta: SkillMeta =
      existingMeta ?? {
        version: null,
        contentHash: null,
        archiveHash: null,
        etag: null,
        lastModified: null,
        installedAt: null,
        lastCheckedAt: null,
        sourceUrl: null,
        sourceKind: input.kind,
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
    const oldSourceId = meta.sourceId
    const kindChanged = meta.sourceKind !== input.kind
    const timestamp = now().toISOString()
    meta.version = stageVersion
    meta.contentHash = stageHash
    meta.archiveHash = archiveHash
    if (kindChanged) {
      // 源类型切换：清空旧源的响应头标识，避免条件请求跨源失配
      meta.etag = null
      meta.lastModified = null
      meta.sourceUrl = null
    }
    meta.etag = input.etag ?? meta.etag
    meta.lastModified = input.lastModified ?? meta.lastModified
    meta.installedAt = timestamp
    // lastCheckedAt 不在此更新：install 不是「检查」（节流以检查计；3.2② 首次挂载恰好 1 次出站）
    meta.sourceUrl = input.sourceUrl ?? meta.sourceUrl
    meta.sourceKind = input.kind
    meta.sourceId = input.sourceId ?? meta.sourceId
    meta.previousSourceId = replaced ? oldSourceId : meta.previousSourceId
    meta.previousVersion = replaced ? installed.version : meta.previousVersion
    meta.resolvedCwd = input.rootRecord?.resolvedCwd ?? meta.resolvedCwd
    meta.projectRoot = input.rootRecord?.projectRoot ?? meta.projectRoot
    meta.targetRoot = targetRoot
    meta.name = name
    meta.firstFetchedAt = meta.firstFetchedAt ?? timestamp
    meta.sourceReachable =
      input.kind === 'https-zip'
        ? { state: 'reachable', checkedAt: timestamp, reason: null }
        : meta.sourceReachable
    meta.availableVersion = stageVersion
    meta.downgradeBlocked = null
    meta.residue = []

    // ── 清理 + 零残留断言（成功的前提）─────────────────────────────────
    await input.hooks?.beforeCleanup?.()
    const rm = input.rmImpl ?? rmRecursive
    await rm(runDir)
    let residue: string[] = []
    try {
      await fsp.stat(runDir)
      residue = await listResidue(runDir)
    } catch {
      // runDir 已不存在 → 零残留
    }
    meta.residue = residue
    try {
      await writeMeta(metaPath, meta)
    } catch (error) {
      warnings.push(
        `警告：meta.json 写入失败（${error instanceof Error ? error.message : String(error)}）；状态将按「安装记录缺失」降级，建议重装。`,
      )
    }

    const discovery = await maybeCheckDiscovery(input, targetRoot, name)
    const outcome: InstallOutcome = residue.length > 0 ? 'installed-with-residue' : replaced ? 'updated' : 'installed'
    if (residue.length > 0) {
      warnings.push(`警告：暂存区清理失败（Windows 占用/同步盘/杀软可能占用），残留 ${residue.length} 项已记入状态；本次不报成功，下次安装/更新/启动检查重试清理。`)
    }
    return {
      ok: residue.length === 0,
      outcome,
      version: stageVersion,
      previousVersion: replaced ? installed.version : null,
      path: skillMdPath,
      sourceId: input.sourceId ?? meta.sourceId,
      previousSourceId: meta.previousSourceId,
      contentHash: stageHash,
      warnings: [...warnings, ...discovery.warnings],
      residue,
      discovery: discovery.result ?? undefined,
    }
  } catch (error) {
    // ── 回滚：恢复 backup → 清理 runDir → 显式报错 ─────────────────────
    const rollbackWarnings: string[] = []
    const residue: string[] = []
    if (backupPath !== null) {
      try {
        if (replaced) await rmRecursive(targetPath) // 新版已就位 → 先移除再恢复旧版
        await fsp.rename(backupPath, targetPath)
        rollbackWarnings.push('警告：安装中途失败，已回滚到旧版本。')
      } catch {
        residue.push(backupPath)
        rollbackWarnings.push(`警告：回滚失败（旧版备份位于 ${backupPath}），请人工检查；目标目录当前状态不可信。`)
      }
    }
    if (runDir !== null) {
      try {
        await rmRecursive(runDir)
      } catch {
        residue.push(runDir)
      }
      try {
        await fsp.stat(runDir)
        residue.push(...(await listResidue(runDir)))
      } catch {
        // 已清理
      }
    }
    const message =
      error instanceof SkillInstallerError || error instanceof DowngradeBlockedError
        ? error.message
        : `安装失败：${error instanceof Error ? error.message : String(error)}`
    const wrapped =
      error instanceof SkillInstallerError || error instanceof DowngradeBlockedError
        ? error
        : new SkillInstallerError('INSTALL_FAILED', message, { residue: residue.length > 0 ? residue : undefined })
    ;(wrapped as { residue?: string[]; rollbackWarnings?: string[] }).residue = residue
    ;(wrapped as { rollbackWarnings?: string[] }).rollbackWarnings = rollbackWarnings
    throw wrapped
  } finally {
    await lock.release()
  }
}

async function existsDir(target: string): Promise<boolean> {
  try {
    return (await fsp.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function maybeCheckDiscovery(
  input: InstallSkillInput,
  targetRoot: string,
  name: string,
): Promise<{ warnings: string[]; result: DiscoveryResult | null }> {
  if (!input.skills) return { warnings: [], result: null }
  const projectRoot = input.projectRoot ?? null
  if (!projectRoot) return { warnings: [], result: null }
  const result = await checkDiscovery({
    skills: input.skills,
    projectRoot,
    targetRoot,
    name,
    signal: input.signal,
    scope: input.scope,
  })
  return { warnings: result.warnings, result }
}

export type { InstallLockInfo }
