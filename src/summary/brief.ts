/**
 * 当日盘面整理 md（review-loop `daily-brief` capability；tasks 3.1–3.5）。
 *
 * 产物：`<数据根>/DB/review/<YYYYMM>/<YYYYMMDD>-summary.md`（一交易日一份；
 * 路径经 `resolveArea('brief', { date })`，MUST NOT 自行拼接）。
 *
 * 结构（spec「产物结构」逐条）：
 * 1. frontmatter：`tradeDate`（canonical）/`generatedAt`（东八区偏移，经
 *    `formatZonedIso`）/`kind: "daily-brief"`/`anchors`（指数段成员代码）/
 *    `missing`（`"<field>:<reason>"` 流列表）/`warnings`；
 * 2. 标题 `# 盘面整理 · <tradeDate>`；
 * 3. 生成提示行（本文件由工作流生成、重跑覆盖）——owner 手改会被覆盖，必须可见；
 * 4. 固定行 `数据完整性：…` 与 `研究辅助、不构成投资建议`；
 * 5. 四段 H2（字面固定：`## 一、指数` / `## 二、情绪` / `## 三、赚钱效应` / `## 四、题材`）。
 *
 * 写通道纪律（spec「写通道」）：**唯一生产者**、**同交易日覆盖重写**（owner
 * 2026-10-06 裁决）、原子写（同目录临时文件 + rename + 失败清理）、本模块私有
 * 互斥表（键 = 目标绝对路径；与卡片文档写锁、运行摘要写锁各自独立）。
 * MUST NOT 触碰卡片文档与附注（本模块只写 brief 区域文件；结构断言见测试）。
 */
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { isValidIsoDate, toCompactDate } from '../data/date.ts'
import { resolveArea } from '../paths/resolve.ts'
import { encodeFrontmatterValue } from '../review/md/frontmatter.ts'
import { findFrontmatter, parseFrontmatterValues } from '../review/md/frontmatter.ts'
import { formatZonedIso } from '../review/format.ts'

/** frontmatter `kind` 字面量（下游识别用；本仓唯一出现点）。 */
export const BRIEF_KIND = 'daily-brief'

/** 四段固定标题（顺序即渲染顺序，MUST NOT 改动字面）。 */
export const BRIEF_SECTION_TITLES = {
  index: '一、指数',
  sentiment: '二、情绪',
  moneyEffect: '三、赚钱效应',
  theme: '四、题材',
} as const

export type BriefSectionKey = keyof typeof BRIEF_SECTION_TITLES

/** 四段正文（各段 MUST 非空；缺项由 agent 显式写「数据不可得」/「卡片未覆盖」）。 */
export type BriefSections = Record<BriefSectionKey, string>

export interface BriefMissingEntry {
  field: string
  reason: string
}

export interface WriteBriefInput {
  /** canonical `YYYY-MM-DD`。 */
  tradeDate: string
  sections: BriefSections
  /** 本次参与指数段的锚点代码（缺省空数组）。 */
  anchors?: readonly string[]
  missing?: readonly BriefMissingEntry[]
  warnings?: readonly string[]
  /** 缺省 = 写入时刻（经 formatZonedIso）。 */
  generatedAt?: string
}

export interface WriteBriefResult {
  /** 相对数据根路径（来源标注/页面读取用）。 */
  path: string
  tradeDate: string
  bytes: number
  generatedAt: string
  replaced: boolean
  warnings: string[]
}

const SECTION_ORDER: readonly BriefSectionKey[] = ['index', 'sentiment', 'moneyEffect', 'theme']

/** 目标路径（经映射表；canonical → 紧凑折算经 src/data/date.ts）。 */
export function briefPath(dataRoot: string, tradeDate: string): { absPath: string; relPath: string } {
  const resolved = resolveArea(dataRoot, 'brief', { date: toCompactDate(tradeDate) })
  return { absPath: resolved.absPath, relPath: resolved.relPath }
}

/** 数据完整性行（完整 / 部分（缺 <字段>）；字段去重保序）。 */
export function integrityLine(missing: readonly BriefMissingEntry[]): string {
  if (missing.length === 0) return '数据完整性：完整'
  const fields: string[] = []
  for (const m of missing) {
    if (!fields.includes(m.field)) fields.push(m.field)
  }
  return `数据完整性：部分（缺 ${fields.join('、')}）`
}

/**
 * 渲染盘面 md（确定性；除 `generatedAt` 外相同入参字节稳定）。
 * 调用方 MUST 先经 `validateBriefInput`（渲染层不做静默兜底）。
 */
export function renderBrief(input: WriteBriefInput, generatedAt: string): string {
  const fm: string[] = ['---']
  fm.push(`tradeDate: ${encodeFrontmatterValue(input.tradeDate)}`)
  fm.push(`generatedAt: ${encodeFrontmatterValue(generatedAt)}`)
  fm.push(`kind: ${encodeFrontmatterValue(BRIEF_KIND)}`)
  const anchors = input.anchors ?? []
  fm.push(`anchors: [${anchors.map((a) => encodeFrontmatterValue(a)).join(', ')}]`)
  const missing = input.missing ?? []
  fm.push(`missing: [${missing.map((m) => encodeFrontmatterValue(`${m.field}:${m.reason}`)).join(', ')}]`)
  const warnings = input.warnings ?? []
  fm.push(`warnings: [${warnings.map((w) => encodeFrontmatterValue(w)).join(', ')}]`)
  fm.push('---')

  const lines: string[] = [
    ...fm,
    '',
    `# 盘面整理 · ${input.tradeDate}`,
    '',
    '本文件由工作流生成，同交易日重跑整体覆盖（请勿手改，手改会被覆盖）。',
    '',
    integrityLine(missing),
    '',
    '研究辅助、不构成投资建议',
    '',
  ]
  for (const key of SECTION_ORDER) {
    lines.push(`## ${BRIEF_SECTION_TITLES[key]}`)
    lines.push('')
    lines.push(input.sections[key].trim())
    lines.push('')
  }
  return lines.join('\n')
}

/** 入参校验（显式失败并点名字段；MUST NOT 写任何文件）。 */
export function validateBriefInput(input: WriteBriefInput): void {
  if (typeof input.tradeDate !== 'string' || !isValidIsoDate(input.tradeDate)) {
    throw new Error(`writeBrief: 非法 tradeDate '${String(input.tradeDate)}'——须为 canonical YYYY-MM-DD 且为真实日历日期`)
  }
  const sections = input.sections
  if (sections === null || typeof sections !== 'object') {
    throw new Error('writeBrief: sections 缺失——须提供四段正文（index/sentiment/moneyEffect/theme）')
  }
  for (const key of SECTION_ORDER) {
    const body = sections[key]
    if (typeof body !== 'string' || body.trim() === '') {
      throw new Error(`writeBrief: sections.${key} 为空——四段 MUST 非空；无内容请显式写「数据不可得」或「卡片未覆盖」（MUST NOT 留空段）`)
    }
  }
}

/** 本模块私有互斥表（键 = 目标绝对路径；与卡片文档锁/运行摘要锁各自独立）。 */
const briefLocks = new Map<string, Promise<unknown>>()

function withBriefLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = briefLocks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const sentinel = run.then(() => undefined, () => undefined)
  briefLocks.set(key, sentinel)
  void sentinel.then(() => {
    if (briefLocks.get(key) === sentinel) briefLocks.delete(key)
  })
  return run
}

/**
 * 写盘面 md（**覆盖重写** + 原子写）。
 * 返回 `replaced`（本次是否覆盖既有文件）与 `bytes`（写入字节数，UTF-8）。
 */
export async function writeBrief(dataRoot: string, input: WriteBriefInput, opts: { now?: Date } = {}): Promise<WriteBriefResult> {
  validateBriefInput(input)
  const generatedAt = input.generatedAt ?? formatZonedIso(opts.now ?? new Date())
  const target = briefPath(dataRoot, input.tradeDate)
  return withBriefLock(target.absPath, async () => {
    let replaced = false
    try {
      await stat(target.absPath)
      replaced = true
    } catch (e) {
      if ((e as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw e
    }
    const dir = dirname(target.absPath)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${basename(target.absPath)}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`)
    const text = renderBrief(input, generatedAt)
    try {
      await writeFile(tmp, text, 'utf8')
      await rename(tmp, target.absPath)
    } catch (e) {
      await unlink(tmp).catch(() => { /* 清理失败不掩盖原错误 */ })
      throw e
    }
    return {
      path: target.relPath,
      tradeDate: input.tradeDate,
      bytes: Buffer.byteLength(text, 'utf8'),
      generatedAt,
      replaced,
      warnings: [...(input.warnings ?? [])],
    }
  })
}

export interface BriefMeta {
  exists: boolean
  /** 相对数据根路径。 */
  path: string
  generatedAt: string | null
}

/** 只读存在性元信息（`/api/day` 用；MUST NOT 解析四段正文）。 */
export async function readBriefMeta(dataRoot: string, tradeDate: string): Promise<BriefMeta> {
  const target = briefPath(dataRoot, tradeDate)
  let text: string
  try {
    text = await readFile(target.absPath, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') {
      return { exists: false, path: target.relPath, generatedAt: null }
    }
    throw e
  }
  const fmBlock = findFrontmatter(text)
  const values = fmBlock === null ? {} : parseFrontmatterValues(fmBlock.bodyLines)
  const raw = values.generatedAt
  return {
    exists: true,
    path: target.relPath,
    generatedAt: typeof raw === 'string' && raw.trim() !== '' ? raw : null,
  }
}
