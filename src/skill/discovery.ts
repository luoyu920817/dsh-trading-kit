/**
 * 可发现性核对（tasks 2.3，design D-6；spec「可发现性核对与同名遮蔽」）。
 *
 * MUST 按宿主签名传 `cwd`（F3：不传 cwd 宿主不扫 rank 100 项目根，核对结果
 * 无意义）；按 `name` + `targetRoot` 参数化（N2），MUST NOT 写死 tdx-tq-local。
 * 宿主服务不可用 → 退化为文件系统检查（`filesystem-only`），MUST NOT 把
 * 「服务不可用」写成「未发现」。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import { isInsideOrEqual } from './zip-guard.ts'

/** 宿主 skill 视图的结构子集（宿主源码本会话不可达，按 F1/F4 旁证结构化）。 */
export interface HostSkillView {
  name: string
  /** 宿主扫描到的实例化路径（SKILL.md 绝对路径）。 */
  path: string
  source?: string
  rank?: number
}

/** 宿主 skills 服务的结构子集：`list({ cwd, signal, scope })`，cwd 必传。 */
export interface HostSkillsService {
  list(options: { cwd: string; signal?: AbortSignal; scope?: unknown }): Promise<HostSkillView[]>
}

export type DiscoveryMode = 'host-service' | 'filesystem-only'

export interface DiscoveryResult {
  checked: boolean
  mode: DiscoveryMode
  cwdUsed: string | null
  cwdSource: string | null
  found: boolean
  winner: { path: string; source: string | null; rank: number | null } | null
  /** not-discovered 等显式警告（filesystem-only 模式 MUST NOT 产生未发现警告）。 */
  warnings: string[]
}

export interface CheckDiscoveryInput {
  /** 宿主 skills 服务；缺省/不可用时退化为文件系统检查。 */
  skills?: HostSkillsService | null
  /** 根解析产物（D-1）——即传给宿主 list 的 cwd。 */
  projectRoot: string
  targetRoot: string
  name: string
  cwdSource?: 'session' | 'explicit' | 'recorded' | 'install-dir-derived'
  signal?: AbortSignal
  scope?: unknown
}

/**
 * 只读核对：本 skill 是否已被宿主按 `<targetRoot>/<name>/SKILL.md` 发现。
 * 命中判据：`hit.name === name` 且 `hit.path === path.join(targetRoot, name, 'SKILL.md')`。
 */
export async function checkDiscovery(input: CheckDiscoveryInput): Promise<DiscoveryResult> {
  const targetRoot = path.resolve(input.targetRoot)
  const expectedPath = path.join(targetRoot, input.name, 'SKILL.md')
  const cwdUsed = path.resolve(input.projectRoot)

  if (input.skills) {
    try {
      const view = await input.skills.list({ cwd: cwdUsed, signal: input.signal, scope: input.scope })
      // 扫描型用例防空过：宿主返回的视图允许为空（空项目根是合法态），
      // 但「命中」必须以本落点为准逐字符断言。
      const hit = view.find((entry) => entry.name === input.name)
      if (hit && path.resolve(hit.path) === path.resolve(expectedPath)) {
        return {
          checked: true,
          mode: 'host-service',
          cwdUsed,
          cwdSource: input.cwdSource ?? null,
          found: true,
          winner: { path: path.resolve(hit.path), source: hit.source ?? null, rank: hit.rank ?? null },
          warnings: [],
        }
      }
      // 扫到同名但不是本落点 → shadowed（遮蔽警告由 shadowing 模块产出路径/秩/版本）
      // 没扫到 → not-discovered（cwd/根不一致或该根无此目录）
      const warnings = hit
        ? []
        : [
            `警告：skill 未被宿主发现（not-discovered）——检查 targetRoot 与会话工作空间是否一致：` +
              `resolvedCwd=${cwdUsed}、cwdSource=${input.cwdSource ?? '未知'}、落点=${expectedPath}；` +
              '确认安装落点确为宿主 rank 100 扫描根或已登记 extraSkillRoots。',
          ]
      return {
        checked: true,
        mode: 'host-service',
        cwdUsed,
        cwdSource: input.cwdSource ?? null,
        found: false,
        winner: hit ? { path: path.resolve(hit.path), source: hit.source ?? null, rank: hit.rank ?? null } : null,
        warnings,
      }
    } catch {
      // 宿主服务不可用 → 文件系统退化（不产生假的未发现警告）
    }
  }

  const found = existsSync(expectedPath)
  return {
    checked: true,
    mode: 'filesystem-only',
    cwdUsed,
    cwdSource: input.cwdSource ?? null,
    found,
    winner: found ? { path: path.resolve(expectedPath), source: 'filesystem', rank: null } : null,
    warnings: [],
  }
}

/** 同名候选根是否包含本落点（供 shadowing 过滤自身）。 */
export function isSameTarget(candidatePath: string, targetRoot: string, name: string): boolean {
  return isInsideOrEqual(candidatePath, path.join(path.resolve(targetRoot), name))
}
