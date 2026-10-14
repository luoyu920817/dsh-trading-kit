/**
 * 标的档案首卡懒创建（review-loop `stock-profile`「懒加载建档」Requirement；
 * tasks 2.6–2.8）。
 *
 * owner 裁决（2026-10-06）：期望「每个标的在 `DB/stock` 都有档案」，实现方式 =
 * **首次写该标的复盘卡片时异步创建一份骨架**；内容（`角色`/`锚点`）由 owner 填写，
 * 本模块 **MUST NOT 猜测取值**、**MUST NOT 改写既有档案**。
 *
 * 硬约束（spec 逐条）：
 * - **create-only**：以 `wx` 排他创建；目标路径已存在（无论内容）即放弃——
 *   MUST NOT 读取后覆写、MUST NOT 补键、MUST NOT 改名、MUST NOT 删除；
 * - **异步解耦**：调用方（写卡路由）以 fire-and-forget 触发，建档成败 MUST NOT
 *   影响卡片写入的成败/返回/可感延迟；失败只经告警与日志可见，至多尝试一次；
 * - **命名**：`<名称>.md`（经 `sanitizeNameSegment`）；名称为空或退化为代码段时
 *   **不建档**（告警 `nameUnavailable`，待名称可得后的下次写卡再建；MUST NOT 用
 *   `<代码>.md` 替代，MUST NOT 事后改名）；
 * - **同名冲突**：目标已存在但 `代码` 与本次目标不同 → 告警并放弃（不新建第二份）；
 * - **骨架**：主变体（`板块/当前题材/题材地位/热点标签`）+ `代码` + 空 `角色`
 *   + `# 股性` / `# 记录` + 组件嵌入行（与既有 516/766 份档案同形）。
 */
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { encodeFrontmatterValue, findFrontmatter, parseFrontmatterValues } from './md/frontmatter.ts'
import { normalizeCode } from './anchor.ts'
import { stockProfilePathFor } from './profile.ts'
import { assertAreaPathUnderRoot } from '../paths/resolve.ts'

/** 名称不可得告警码（消费方按码分支，MUST NOT 解析文案）。 */
export const NAME_UNAVAILABLE = 'nameUnavailable'

export interface EnsureProfileInput {
  dataRoot: string
  /** 自定义标的目录，相对dataRoot；缺省沿区域映射。 */
  directory?: string
  code: string
  /** 名称（来自写卡入参或清单名称段）；空/缺省 → 不建档。 */
  name?: string | null
}

export interface EnsureProfileResult {
  status: 'created' | 'skipped'
  /** 相对数据根路径（skipped 且档案存在时为既有档案路径）。 */
  path: string
  /** 跳过原因（skipped）：`exists`（已存在）/ `nameUnavailable`（名称不可得）/ `codeMismatch`（同名冲突）。 */
  reason?: 'exists' | 'nameUnavailable' | 'codeMismatch'
  warnings: string[]
}

/** 骨架正文（一次成型的完整字节；失败清理半截文件——写与清理同一函数内）。 */
export function renderProfileSkeleton(code: string): string {
  const quoted = encodeFrontmatterValue(code)
  return [
    '---',
    `代码: ${quoted}`,
    '板块:',
    '当前题材:',
    '题材地位:',
    '热点标签:',
    '角色:',
    '---',
    '',
    '# 股性',
    '',
    '',
    '',
    '# 记录',
    '',
    '![[stock-info.components]]',
    '',
  ].join('\n')
}

/**
 * 首卡懒创建入口（调用方 fire-and-forget；返回值仅供日志与测试等待 seam 使用）。
 * 任一分支均**不抛出**业务失败（失败折叠为告警），除 `resolveArea` 的配置类错误
 * （数据根未配置/区域未登记）——那属装配缺陷，由调用方日志可见。
 * 业务逻辑: 在配置标的目录排他创建骨架，既有档案只读取冲突信息。
 * 关键判断: 实际祖先和目标路径先校验，链接越界不进入写入或清理分支。
 * 异常处理: 配置与路径异常透传；普通建档失败返回告警，不影响写卡。
 * 参数: input包含数据根、可选相对目录及标的代码名称。
 * 返回: 创建或跳过状态、相对路径和告警。
 */
export async function createStockProfileIfMissing(input: EnsureProfileInput): Promise<EnsureProfileResult> {
  const code = normalizeCode(input.code)
  if (code === null) {
    return { status: 'skipped', path: '', reason: 'nameUnavailable', warnings: [`${NAME_UNAVAILABLE}: 非法代码 '${String(input.code)}'（建档跳过）`] }
  }
  const rawName = typeof input.name === 'string' ? input.name.trim() : ''
  if (rawName === '' || rawName === code) {
    return {
      status: 'skipped',
      path: '',
      reason: 'nameUnavailable',
      warnings: [`${NAME_UNAVAILABLE}: 名称不可得（name=${JSON.stringify(input.name ?? null)}）——MUST NOT 以 <代码>.md 代替建档；待名称可得后的下次写卡再建`],
    }
  }
  const target = stockProfilePathFor(input.dataRoot, rawName, code, { directory: input.directory })
  await assertAreaPathUnderRoot(input.dataRoot, target.absPath)

  // create-only：`wx` 排他创建（已存在即 EEXIST，不读后覆写）。
  try {
    await writeFile(target.absPath, renderProfileSkeleton(code), { encoding: 'utf8', flag: 'wx' })
    return { status: 'created', path: target.relPath, warnings: [] }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code !== 'EEXIST') {
      // 半截文件清理（`wx` 下失败通常不留文件；显式兜底一次）。
      await unlink(target.absPath).catch(() => {})
      return {
        status: 'skipped',
        path: target.relPath,
        reason: 'exists',
        warnings: [`建档失败（不影响写卡；至多尝试一次）：${target.relPath}——${err instanceof Error ? err.message : String(e)}`],
      }
    }
  }

  // 目标已存在：只读复核 `代码` 一致性（同名冲突 → 告警；一致/缺省 → 静默跳过）。
  let existingCode: string | null = null
  try {
    const text = await readFile(target.absPath, 'utf8')
    const fmBlock = findFrontmatter(text)
    if (fmBlock !== null) {
      const values = parseFrontmatterValues(fmBlock.bodyLines)
      const raw = values['代码']
      existingCode = typeof raw === 'string' && raw.trim() !== '' ? normalizeCode(raw.trim()) : null
    }
  } catch {
    /* 读取失败不影响判定：视为已存在即跳过 */
  }
  if (existingCode !== null && existingCode !== code) {
    return {
      status: 'skipped',
      path: target.relPath,
      reason: 'codeMismatch',
      warnings: [`同名档案 代码 不一致（放弃建档，不修改既有档案）：${target.relPath} 的 代码=${existingCode}，本次目标=${code}`],
    }
  }
  return { status: 'skipped', path: target.relPath, reason: 'exists', warnings: [] }
}
