/**
 * SKILL.md frontmatter 解析与版本三元组比对（tasks 1.1）。
 *
 * 官方 frontmatter 实测形态（test/fixtures/official-zip-manifest.json，2026-09-27）：
 *   name: 通达信TQ-Local
 *   version: 1.2.0（2026-09-20）
 * 即 version 值带全角括号日期，用正则提取 `(\d+)\.(\d+)\.(\d+)`。
 *
 * 偏离登记（对照 spec「frontmatter name 等于本次目标的 name」）：官方包的
 * frontmatter name 是展示标题「通达信TQ-Local」，不等于目录名 tdx-tq-local，
 * 也不匹配宿主 isSkillName 的 kebab-case 形态（F5 旁证与官方包现实冲突，宿主
 * 源码本会话不可达、未能核验）。若按「name 不等 → 硬失败」实现，官方默认源
 * 将永远无法通过校验，与本 change 的首要验收（一键安装官方包）自相矛盾。
 * 因此本解析把 name 归为：
 * - 「无 name 键」→ 解析失败（hard）；
 * - 「有 name 但非 kebab-case」→ ok，`nameFormat: 'other'`（是否硬比较由调用方
 *   的 strictNameMatch 决定，默认仅告警）。
 */

import { SkillInstallerError } from './errors.ts'

/** 与宿主 isSkillName 同款形态（F5 旁证；宿主源码本会话不可达，未能核验）。 */
const KEBAB_CASE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** 从 version 值中提取语义化版本号的正则（design D-4）。 */
const SEMVER_RE = /(\d+)\.(\d+)\.(\d+)/

export interface SemVer {
  major: number
  minor: number
  patch: number
  /** 提取出的 `x.y.z` 标准形态（不含官方值里的日期后缀）。 */
  raw: string
}

export type FrontmatterParseResult =
  | {
      ok: true
      name: string
      nameFormat: 'kebab-case' | 'other'
      /** version 键的原始值（未重格式化）；键缺失时为 null。 */
      versionRaw: string | null
      /** 解析出的三元组；键缺失时为 null。 */
      version: SemVer | null
      /** version 键存在但无法提取三元组 → 「不可解析」（调用方决定是否硬失败）。 */
      versionUnparsable: boolean
      description: string | null
    }
  | { ok: false; reason: 'no-frontmatter' | 'truncated' | 'name-missing' }

/** 解析 frontmatter 未知键时静默忽略（F5：宿主只强制 name 与 description）。 */
export function parseSkillFrontmatter(text: string): FrontmatterParseResult {
  const normalized = text.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---')) {
    return { ok: false, reason: 'no-frontmatter' }
  }
  const lines = normalized.split('\n')
  // 首行即 '---'（或 '---…' 围栏开头），寻找闭合围栏。
  const closing = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---')
  if (closing < 0) {
    return { ok: false, reason: 'truncated' }
  }

  let name: string | null = null
  let versionRaw: string | null = null
  let description: string | null = null
  for (const line of lines.slice(1, closing)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (key === 'name' && name === null) name = value
    else if (key === 'version' && versionRaw === null) versionRaw = value
    else if (key === 'description' && description === null) description = value
    // 其余键静默忽略（F5）
  }

  if (name === null || name === '') {
    return { ok: false, reason: 'name-missing' }
  }

  let version: SemVer | null = null
  let versionUnparsable = false
  if (versionRaw !== null) {
    version = extractSemVer(versionRaw)
    versionUnparsable = version === null
  }

  return {
    ok: true,
    name,
    nameFormat: KEBAB_CASE_RE.test(name) ? 'kebab-case' : 'other',
    versionRaw,
    version,
    versionUnparsable,
    description,
  }
}

/** 从任意 version 值（如 `1.2.0（2026-09-20）`）提取三元组；无匹配返回 null。 */
export function extractSemVer(value: string): SemVer | null {
  const match = SEMVER_RE.exec(value)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2])
  const patch = Number(match[3])
  const raw = `${major}.${minor}.${patch}`
  return { major, minor, patch, raw }
}

/** 版本三元组比较：a<b → -1，a===b → 0，a>b → 1。 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const va = extractSemVer(a)
  const vb = extractSemVer(b)
  if (!va || !vb) {
    throw new SkillInstallerError('VERSION_UNPARSABLE', `版本号不可解析：${!va ? a : b}`, {
      failedCheck: 'version-unparsable',
      value: !va ? a : b,
    })
  }
  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1
  return 0
}
