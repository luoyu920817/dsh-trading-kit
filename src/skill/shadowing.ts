/**
 * 同名遮蔽检测（tasks 2.5，design D-6；spec「可发现性核对与同名遮蔽」）。
 *
 * 候选根 = targetRoot、`<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、
 * extraSkillRoots 与宿主 `list({ cwd })` 赢家。检测手段：对每个可枚举候选根做
 * 文件系统同名目录探测（宿主 list 只返回赢家，无法覆盖「被压住的副本」）。
 * 遮蔽警告形如「已遮蔽 <路径>（rank 100，版本 1.0.12）」。
 */

import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs'
import path from 'node:path'
import type { HostSkillView } from './discovery.ts'
import { parseSkillFrontmatter } from './version.ts'

export interface ShadowRoot {
  path: string
  rank: number | null
}

export interface ShadowCandidate {
  path: string
  rank: number | null
  version: string | null
  name: string
}

export interface FindShadowedInput {
  /** 候选根（含 rank；调用方按 F1 语义给出）。 */
  roots: ShadowRoot[]
  /** 本次目标 skill 目录名（参数化，MUST NOT 写死）。 */
  name: string
  /** 本落点自身的 SKILL.md 路径（精确排除——自己不算遮蔽自己）。 */
  excludePath?: string
}

/** 扫描候选根下的同名目录（一层目录 + 其下 SKILL.md，F4 同款判据）。 */
export function findShadowedCandidates(input: FindShadowedInput): ShadowCandidate[] {
  const out: ShadowCandidate[] = []
  const exclude = input.excludePath ? path.resolve(input.excludePath) : null
  const seen = new Set<string>()
  for (const root of input.roots) {
    const skillMdPath = path.join(path.resolve(root.path), input.name, 'SKILL.md')
    const resolved = path.resolve(skillMdPath)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    if (exclude && resolved === exclude) continue
    if (!existsSync(skillMdPath)) continue
    let version: string | null = null
    try {
      const text = readSmallFileSync(skillMdPath)
      const parsed = parseSkillFrontmatter(text)
      if (parsed.ok) version = parsed.version?.raw ?? null
    } catch {
      // 版本读不出 → null（警告里显示「版本未知」）
    }
    out.push({ path: resolved, rank: root.rank, version, name: input.name })
  }
  return out
}

function readSmallFileSync(filePath: string): string {
  // 遮蔽检测只读 frontmatter 头部（≤ 8 KB 足够），避免大文件全量读
  // （SKILL.md frontmatter 位于文件头，截断读取不影响解析）。
  const size = statSync(filePath).size
  const handle = openSync(filePath, 'r')
  try {
    const length = Math.min(size, 8192)
    const buffer = Buffer.alloc(length)
    readSync(handle, buffer, 0, length, 0)
    return buffer.toString('utf8')
  } finally {
    closeSync(handle)
  }
}

/** 遮蔽警告文案（spec：含遮蔽者路径、rank、版本）。 */
export function formatShadowWarning(candidate: ShadowCandidate): string {
  return (
    `警告：已遮蔽 ${candidate.path}（rank ${candidate.rank ?? '?'}，版本 ${candidate.version ?? '未知'}）——` +
    `同名副本会按 rank 优先压过本落点，请清理旧副本或调整落点。`
  )
}

/** 从宿主 list 赢家构造候选根补充（赢家路径 → 其所在 skill 根）。 */
export function rootsFromHostWinner(winner: HostSkillView | null, name: string): ShadowRoot[] {
  if (!winner || winner.name !== name) return []
  const skillMd = path.resolve(winner.path)
  const root = path.dirname(path.dirname(skillMd)) // <root>/<name>/SKILL.md → <root>
  return [{ path: root, rank: winner.rank ?? null }]
}
