/**
 * 目标仓库忽略提示（tasks 2.4，design Risks「.gitignore 只保本仓」）。
 *
 * 安装落点在宿主当前项目根（可能是其它仓库），本仓 .gitignore 对它无效；
 * 因此安装后只**提示**目标仓库是否忽略 `<targetRoot>`（读目标根 .gitignore
 * 判断），MUST NOT 代改文件、不引 shell。状态字段 `installDirIgnored` 由此产出。
 */

import { existsSync, promises as fsp } from 'node:fs'
import path from 'node:path'
import { resolveProjectRoot } from './root.ts'

export interface GitignoreCheck {
  /** 目标根是否已被目标仓库忽略。 */
  ignored: boolean
  gitignorePresent: boolean
  /** 未忽略且在 git 仓库内时给出建议忽略的路径提示；否则为 null。 */
  hint: string | null
  isGitRepo: boolean
}

interface IgnorePattern {
  regex: RegExp
  negated: boolean
  dirOnly: boolean
  anchored: boolean
}

function parseGitignore(text: string): IgnorePattern[] {
  const patterns: IgnorePattern[] = []
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine
    if (line.trim() === '' || line.startsWith('#')) continue
    if (line.startsWith('\\#') || line.startsWith('\\!')) line = line.slice(1) // 反转义字面量
    let negated = false
    if (line.startsWith('!')) {
      negated = true
      line = line.slice(1)
    }
    if (line === '') continue
    let dirOnly = false
    if (line.endsWith('/')) {
      dirOnly = true
      line = line.slice(0, -1)
    }
    let anchored = false
    if (line.startsWith('/')) {
      anchored = true
      line = line.slice(1)
    } else if (line.includes('/')) {
      anchored = true // 含中间斜杠的 pattern 相对 .gitignore 所在目录锚定（git 语义）
    }
    patterns.push({ regex: compilePattern(line), negated, dirOnly, anchored })
  }
  return patterns
}

/** gitignore glob → 全匹配正则（`**` 跨段、`*`/`?` 不跨段）。 */
function compilePattern(pattern: string): RegExp {
  let source = ''
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*'
        i++
        if (pattern[i + 1] === '/') i++
      } else {
        source += '[^/]*'
      }
    } else if (char === '?') {
      source += '[^/]'
    } else if ('\\^$.|+()[]{}'.includes(char)) {
      source += `\\${char}`
    } else {
      source += char
    }
  }
  // dirOnly 的 pattern 也可匹配目录本身；对目录内容由前缀检查覆盖
  return new RegExp(`^${source}(/.*)?$`)
}

function matchPattern(relativePath: string, pattern: IgnorePattern): boolean {
  if (pattern.anchored) return pattern.regex.test(relativePath)
  const segments = relativePath.split('/')
  for (let i = 0; i < segments.length; i++) {
    if (pattern.regex.test(segments.slice(i).join('/'))) return true
  }
  return false
}

/**
 * 判断 `<targetRoot>` 是否被其所在 git 仓库的 `.gitignore` 忽略。
 * 近似 git 语义：逐段检查 target 相对仓库根的路径前缀（目录被忽略则内容被忽略），
 * 「最后一条命中的 pattern」决定结果（支持 `!` 反选）。
 */
export async function checkTargetIgnored(targetRoot: string): Promise<GitignoreCheck> {
  const projectRoot = resolveProjectRoot(targetRoot)
  const isGitRepo = existsSync(path.join(projectRoot, '.git'))
  const gitignorePath = path.join(projectRoot, '.gitignore')
  if (!isGitRepo || !existsSync(gitignorePath)) {
    return { ignored: false, gitignorePresent: false, hint: null, isGitRepo }
  }
  const text = await fsp.readFile(gitignorePath, 'utf8')
  const patterns = parseGitignore(text)
  const relativeTarget = path.relative(projectRoot, path.resolve(targetRoot)).split(path.sep).join('/')
  if (relativeTarget === '') {
    return { ignored: false, gitignorePresent: true, hint: null, isGitRepo }
  }
  const segments = relativeTarget.split('/')
  let ignored = false
  for (let depth = 1; depth <= segments.length; depth++) {
    const prefix = segments.slice(0, depth).join('/')
    for (const pattern of patterns) {
      if (matchPattern(prefix, pattern)) {
        ignored = !pattern.negated
      }
    }
  }
  const hint = ignored
    ? null
    : `提示：安装落点 ${relativeTarget}/ 未被 ${path.join(projectRoot, '.gitignore')} 忽略` +
      '——安装器不代改目标仓库文件；如不希望进入版本管理，请自行追加忽略规则。'
  return { ignored, gitignorePresent: true, hint, isGitRepo }
}
