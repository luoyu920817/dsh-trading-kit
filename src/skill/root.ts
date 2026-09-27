/**
 * 安装根解析（tasks 2.1，design D-1 / D-13；spec「安装根解析与来源优先级」）。
 *
 * 铁律：**禁止使用进程工作目录兜底**（src/skill/** 源码断言为 0，见
 * test/skill/source-assertions.test.ts）——cwd 一律由调用方显式传入（工具出口取
 * `exec.agent?.session.header.cwd`，service 出口取入参），后台检查只信 meta.json
 * 记录值与受限反推。这是「装了但 agent 读不到」的头一号防线。
 *
 * 优先级（记录优先，N1）：显式 cwd（'explicit'）> meta.json 记录值（'recorded'）>
 * installDir 受限反推（'install-dir-derived'）；取不到 → 显式拒绝（不猜）。
 * 反推仅在「installDir 为绝对路径 且（祖先与记录值一致 或 该祖先含 .git）」时使用。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { SkillInstallerError, SkillRootResolutionError } from './errors.ts'
import { isInsideOrEqual } from './zip-guard.ts'

function hasGit(dir: string): boolean {
  return existsSync(path.join(dir, '.git'))
}

/**
 * 从 cwd 向上找最近含 `.git` 的祖先目录（`.git` 目录或文件——worktree/submodule），
 * 找不到则返回入参（与宿主 findProjectRoot 同规则，design F2）。纯函数语义：
 * 只读探测、无副作用、不落盘。
 */
export function resolveProjectRoot(cwd: string): string {
  let dir = path.resolve(cwd)
  for (;;) {
    if (hasGit(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return path.resolve(cwd)
    dir = parent
  }
}

/**
 * installDir 受限反推：仅当 installDir 为绝对路径，且其祖先（dirname 逐级向上，
 * 至少到 dirname(dirname(installDir))）与记录值一致或含 `.git` 时返回推导出的
 * 项目根；否则返回 null（由调用方显式拒绝，MUST NOT 把推导值写进记录）。
 */
export function deriveRootFromInstallDir(installDir: string, recorded: string | null): string | null {
  if (!path.isAbsolute(installDir)) return null
  const resolved = path.resolve(installDir)
  let dir = path.dirname(resolved)
  const recordedResolved = recorded ? path.resolve(recorded) : null
  for (;;) {
    if (recordedResolved && dir === recordedResolved) return dir
    if (hasGit(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** contracts §10 白名单写路径（vault 内 dataRoot 下的豁免区）。 */
export function dataRootWhitelistPaths(dataRoot: string): string[] {
  return [
    path.join(path.resolve(dataRoot), 'agent', 'skills'),
    path.join(path.resolve(dataRoot), 'agent', 'DB', 'temp', 'dsh-trader-kit'),
    path.join(path.resolve(dataRoot), 'DB', 'review'),
  ]
}

export interface ResolveTargetRootInput {
  /** 项目根（调用方已按 D-1 优先级确定）；installDir 为空/相对时必需。 */
  projectRoot?: string | null
  /** 配置的 skill.installDir（'' → 默认 `<projectRoot>/.dsh/skills`；相对 → 以 projectRoot 为基）。 */
  installDir?: string | null
  /** https 源 = tdx 落点（禁 vault/dataRoot，豁免 §10 白名单）；localDir 源 = 显式落点（白名单区合法）。 */
  kind: 'https-zip' | 'local-dir'
  /** D-13 可写目标校验用：数据根 / vault 根 / 插件包自身目录。 */
  dataRoot?: string | null
  vaultRoot?: string | null
  pluginRoot?: string | null
}

export interface ResolvedTargetRoot {
  targetRoot: string
  /** installDir 为空时的默认根标记（`<projectRoot>/.dsh/skills`，宿主 rank 100）。 */
  isDefault: boolean
}

/**
 * 解析落点根 `targetRoot`（spec「原子安装」+ D-13「可写目标」规则）。
 * 校验失败显式报错（含配置项名与冲突路径），MUST NOT 静默落到别处。
 */
export function resolveTargetRoot(input: ResolveTargetRootInput): ResolvedTargetRoot {
  const installDir = (input.installDir ?? '').trim()
  const projectRoot = input.projectRoot ? path.resolve(input.projectRoot) : null

  if (installDir === '') {
    if (!projectRoot) {
      throw new SkillRootResolutionError(
        '无法解析落点根：skill.installDir 未配置且无可用项目根（cwd 未传、无记录值）',
        { configKey: 'skill.installDir' },
      )
    }
    return { targetRoot: path.join(projectRoot, '.dsh', 'skills'), isDefault: true }
  }

  if (!path.isAbsolute(installDir)) {
    if (!projectRoot) {
      throw new SkillRootResolutionError(
        `skill.installDir 为相对路径（${installDir}）且无解析基（cwd 未传、无记录值）——拒绝猜测，请显式传 cwd 或改用绝对路径`,
        { configKey: 'skill.installDir', installDir },
      )
    }
    const targetRoot = path.resolve(projectRoot, installDir)
    assertWritableTarget(targetRoot, input)
    return { targetRoot, isDefault: false }
  }

  const targetRoot = path.resolve(installDir)
  assertWritableTarget(targetRoot, input)
  return { targetRoot, isDefault: false }
}

/** D-13 可写目标校验：vault/dataRoot 禁令（https 源）+ 插件包目录禁令（两源共同）。 */
function assertWritableTarget(targetRoot: string, input: ResolveTargetRootInput): void {
  if (input.pluginRoot && isInsideOrEqual(targetRoot, path.resolve(input.pluginRoot))) {
    throw new SkillInstallerError(
      'INSTALL_DIR_FORBIDDEN_AREA',
      `skill.installDir 落点 <${targetRoot}> 位于插件包自身目录内（${path.resolve(input.pluginRoot)}）——禁止`,
      { configKey: 'skill.installDir', targetRoot, pluginRoot: path.resolve(input.pluginRoot) },
    )
  }

  const bannedAreas: Array<{ root: string; label: string }> = []
  if (input.dataRoot) bannedAreas.push({ root: path.resolve(input.dataRoot), label: 'dataRoot' })
  if (input.vaultRoot) bannedAreas.push({ root: path.resolve(input.vaultRoot), label: 'vault' })

  for (const area of bannedAreas) {
    if (!isInsideOrEqual(targetRoot, area.root)) continue
    // 白名单豁免（contracts §10）：三条白名单写路径内的落点不触发禁令
    //（含 localDir 源的 change 5 落点 <dataRoot>/agent/skills，design D-11/N2）
    const whitelisted =
      typeof input.dataRoot === 'string' &&
      dataRootWhitelistPaths(input.dataRoot).some((whitelistedPath) => isInsideOrEqual(targetRoot, whitelistedPath))
    if (whitelisted) return
    throw new SkillInstallerError(
      'INSTALL_DIR_FORBIDDEN_AREA',
      `skill.installDir 落点 <${targetRoot}> 位于 ${area.label}（${area.root}）内且不在 contracts §10 白名单区——禁止（https 下载落点不进 vault/dataRoot；localDir 源仅豁免白名单区）`,
      { configKey: 'skill.installDir', targetRoot, area: area.label, areaRoot: area.root },
    )
  }
}

/** 已知 skill 扫描根（rank 语义，design F1；供遮蔽检测与暂存区断言）。 */
export interface KnownSkillRoot {
  path: string
  rank: number | null
}

/**
 * 组装 knownSkillRoots：`<projectRoot>/.dsh/skills`（100）、`<projectRoot>/.agents/skills`（200）、
 * extraSkillRoots（300 意图）。projectRoot 缺失时只含显式给出的部分。
 */
export function buildKnownSkillRoots(projectRoot: string | null, extraSkillRoots: string[] = []): KnownSkillRoot[] {
  const roots: KnownSkillRoot[] = []
  if (projectRoot) {
    roots.push({ path: path.join(path.resolve(projectRoot), '.dsh', 'skills'), rank: 100 })
    roots.push({ path: path.join(path.resolve(projectRoot), '.agents', 'skills'), rank: 200 })
  }
  for (const extra of extraSkillRoots) {
    roots.push({ path: path.resolve(extra), rank: 300 })
  }
  return roots
}
