/**
 * 分发包结构校验（tasks 1.4 的 validate 半边）。
 *
 * 职责（spec「下载与完整性校验」）：HTTP 状态 / content-type / 可解压 /
 * 必需条目 SKILL.md / frontmatter name 匹配 / version 可解析。
 * 任一失败 → SkillInstallerError（含 failedCheck），由调用方中止安装、保留旧版、清理暂存区。
 *
 * name 匹配的实现口径（登记偏离，见模块头注释与任务汇报）：官方包
 * frontmatter name 为展示标题「通达信TQ-Local」（test/fixtures/official-zip-manifest.json
 * 实测），与目录名 tdx-tq-local 不相等——硬等值会让官方默认源永远装不上。
 * 因此默认（strictNameMatch=false）对「name 存在但与目标名不一致」记显式警告；
 * 「name 键缺失/为空」仍是硬失败。strictNameMatch=true 时恢复 spec 字面的硬等值
 * 校验（供测试与未来官方向 kebab-case 迁移后收紧）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SkillInstallerError } from './errors.ts'
import { sha256Bytes } from './hash.ts'
import { parseSkillFrontmatter, type FrontmatterParseResult } from './version.ts'
import {
  extractGuarded,
  parseCentralDirectory,
  type ExtractedFile,
  type ZipLimits,
} from './zip-guard.ts'

/** HTTP 状态 / content-type 校验（下载响应层；错误含 status 与 url）。 */
export function validateDownloadResponse(input: { status: number; contentType: string | null; url: string }): void {
  if (input.status < 200 || input.status >= 300) {
    throw new SkillInstallerError(
      'HTTP_STATUS_FAILED',
      `下载失败：HTTP 状态 ${input.status}（源 ${input.url}）`,
      { failedCheck: 'http-status', status: input.status, url: input.url },
    )
  }
  const contentType = (input.contentType ?? '').toLowerCase()
  if (!contentType.includes('zip')) {
    throw new SkillInstallerError(
      'CONTENT_TYPE_FAILED',
      `下载失败：content-type 为「${input.contentType ?? '（缺失）'}」，不是 zip（源 ${input.url}）`,
      { failedCheck: 'content-type', contentType: input.contentType, url: input.url },
    )
  }
}

/** 在解压产物中定位 SKILL.md：条目唯一，或取路径最短者（design「待验证」表降级策略）。 */
export function pickSkillMd(files: ExtractedFile[]): ExtractedFile {
  const candidates = files.filter((file) => {
    const segments = file.relPath.split('/')
    return segments[segments.length - 1] === 'SKILL.md'
  })
  if (candidates.length === 0) {
    throw new SkillInstallerError('MISSING_ENTRY', '压缩包内缺少必需条目 SKILL.md', { failedCheck: 'missing-entry' })
  }
  candidates.sort((a, b) => a.relPath.length - b.relPath.length || (a.relPath < b.relPath ? -1 : 1))
  return candidates[0]
}

export interface ValidatedPackage {
  /** 包内 SKILL.md 的相对路径（相对包根；官方包为 `SKILL.md`）。 */
  skillMdRelPath: string
  skillMdBytes: Uint8Array
  skillMdSha256: string
  frontmatter: FrontmatterParseResult & { ok: true }
  version: string | null
  versionUnparsable: boolean
  files: ExtractedFile[]
  /** 校验过程产生的非致命警告（如 name 与目标名不一致）。 */
  warnings: string[]
}

function checkFrontmatter(
  parsed: FrontmatterParseResult,
  targetName: string,
  strictNameMatch: boolean,
  warnings: string[],
): asserts parsed is FrontmatterParseResult & { ok: true } {
  if (!parsed.ok) {
    const reasonText =
      parsed.reason === 'no-frontmatter'
        ? '缺少 frontmatter'
        : parsed.reason === 'truncated'
          ? 'frontmatter 被截断'
          : 'frontmatter 缺少 name 键'
    throw new SkillInstallerError('SKILL_MD_INVALID', `SKILL.md 解析失败：${reasonText}`, {
      failedCheck: 'name-mismatch',
      reason: parsed.reason,
    })
  }
  if (parsed.name !== targetName) {
    const message =
      `frontmatter name「${parsed.name}」与目标名「${targetName}」不一致` +
      (parsed.nameFormat === 'other' ? '（官方包以展示标题为 name，目录名才是发现键）' : '')
    if (strictNameMatch) {
      throw new SkillInstallerError('NAME_MISMATCH', `校验失败：${message}`, {
        failedCheck: 'name-mismatch',
        frontmatterName: parsed.name,
        targetName,
      })
    }
    warnings.push(`警告：${message}；按目录名「${targetName}」安装，建议人工确认包来源。`)
  }
  if (parsed.versionUnparsable) {
    throw new SkillInstallerError(
      'VERSION_UNPARSABLE',
      `SKILL.md version 值「${parsed.versionRaw}」无法解析出语义化版本号（宁可吵，不可假）`,
      { failedCheck: 'version-unparsable', versionRaw: parsed.versionRaw },
    )
  }
}

export interface ValidateAndStageInput {
  /** 已下载的 zip 字节。 */
  zipBytes: Uint8Array
  /** 解压暂存根（`<runDir>/unzip`；调用方后续把包根改名为 `stage/<name>`）。 */
  unzipRoot: string
  /** 最终 stage 根（`<runDir>/stage`）。 */
  stageRoot: string
  /** 目标 skill 目录名（决定 stage/<name>）。 */
  targetName: string
  limits?: ZipLimits
  strictNameMatch?: boolean
}

/**
 * 校验并暂存 zip 包：加固解压到 `<unzipRoot>` → 定位 SKILL.md → 若整包被单一
 * 顶层目录包裹则剥壳 → 改名到 `<stageRoot>/<targetName>`（两级布局，D-3 第 5 步）。
 */
export async function validateAndStageZip(input: ValidateAndStageInput): Promise<ValidatedPackage> {
  const warnings: string[] = []
  // 结构预检（条目数/名称形态/规模声明值）先行——在解压前拒绝恶意包
  parseCentralDirectory(input.zipBytes)
  const extracted = await extractGuarded(input.zipBytes, input.unzipRoot, input.limits)
  const skillMd = pickSkillMd(extracted.files)
  const skillMdBytes = await fsp.readFile(skillMd.absPath)
  const parsed = parseSkillFrontmatter(skillMdBytes.toString('utf8'))
  checkFrontmatter(parsed, input.targetName, input.strictNameMatch ?? false, warnings)

  // 剥壳：SKILL.md 位于单一顶层目录下 → 该目录即包根
  const segments = skillMd.relPath.split('/')
  const stageDir = path.join(input.stageRoot, input.targetName)
  await fsp.mkdir(input.stageRoot, { recursive: true })
  let relInPackage = skillMd.relPath
  if (segments.length === 1) {
    // 包根即解压根：整体改名到 stage/<name>
    await fsp.rename(input.unzipRoot, stageDir)
  } else {
    const top = segments[0]
    const topEntries = new Set(extracted.files.map((file) => file.relPath.split('/')[0]))
    if (topEntries.size === 1) {
      // 整包被单一顶层目录包裹：剥壳后 stage/<name> 即包根
      await fsp.rename(path.join(input.unzipRoot, top), stageDir)
      await fsp.rm(input.unzipRoot, { recursive: true, force: true })
      relInPackage = segments.slice(1).join('/')
    } else {
      // SKILL.md 嵌套但同层还有其它顶层条目（非标准布局）：原样保留完整包结构
      await fsp.rename(input.unzipRoot, stageDir)
    }
  }
  return {
    skillMdRelPath: relInPackage,
    skillMdBytes,
    skillMdSha256: sha256Bytes(skillMdBytes),
    frontmatter: parsed,
    version: parsed.version?.raw ?? null,
    versionUnparsable: parsed.versionUnparsable,
    files: extracted.files,
    warnings,
  }
}

/** 本地目录源的结构校验（5.2：与 zip 源共用 frontmatter/version 判据）。 */
export async function validateLocalDirPackage(input: {
  packageDir: string
  targetName: string
  strictNameMatch?: boolean
}): Promise<{ skillMdBytes: Uint8Array; skillMdSha256: string; frontmatter: FrontmatterParseResult & { ok: true }; version: string | null; warnings: string[] }> {
  const warnings: string[] = []
  const skillMdPath = path.join(input.packageDir, 'SKILL.md')
  let skillMdBytes: Buffer
  try {
    skillMdBytes = await fsp.readFile(skillMdPath)
  } catch {
    throw new SkillInstallerError('MISSING_ENTRY', `本地源目录缺少必需条目 SKILL.md（${skillMdPath}）`, {
      failedCheck: 'missing-entry',
      path: skillMdPath,
    })
  }
  const parsed = parseSkillFrontmatter(skillMdBytes.toString('utf8'))
  checkFrontmatter(parsed, input.targetName, input.strictNameMatch ?? false, warnings)
  return {
    skillMdBytes,
    skillMdSha256: sha256Bytes(skillMdBytes),
    frontmatter: parsed,
    version: parsed.version?.raw ?? null,
    warnings,
  }
}
