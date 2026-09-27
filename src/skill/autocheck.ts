/**
 * 启动检查（tasks 3.2，design D-8；spec「更新策略与源不可达降级」）。
 *
 * **autoCheck 的语义是「只检查、不安装」**：网络结果只用于更新
 * `sourceReachable` / 可用版本 / 告警；安装与替换 MUST 只能由显式调用触发。
 * 源码断言：本文件不含安装执行函数的标识（test/skill/source-assertions.test.ts）。
 *
 * 节流：`lastCheckedAt` + `checkIntervalHours`（默认 24，design D-12⑥）。
 * 根来源：meta 记录值优先 → installDir 受限反推；无可用来源 → 跳过 + warning、
 * 零出站（MUST NOT 猜测项目根，MUST NOT 回退进程工作目录）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { downloadToFile, DOWNLOAD_GUARDS } from './download.ts'
import { extractGuarded, DEFAULT_ZIP_LIMITS, type ZipLimits } from './zip-guard.ts'
import { pickSkillMd } from './validate.ts'
import { parseSkillFrontmatter } from './version.ts'
import { deriveRootFromInstallDir } from './root.ts'
import { metaPathFor, readMeta, writeMeta, type SkillMeta } from './state.ts'
import { DEFAULT_TQ_SKILL_SOURCE_URL } from './source.ts'

export const DEFAULT_CHECK_INTERVAL_HOURS = 24

export interface AutoCheckProbeInput {
  url: string
  etag: string | null
  lastModified: string | null
  workDir: string
  signal?: AbortSignal
  connectTimeoutMs?: number
  totalTimeoutMs?: number
  /** 重试退避延时注入（测试 0ms；零 sleep 纪律）。 */
  delay?: (ms: number) => Promise<void>
}

export interface AutoCheckProbeOutcome {
  reachable: boolean
  reason: string | null
  etag: string | null
  lastModified: string | null
  /** 200 时解析出的远端版本（不安装，仅记录 availableVersion）。 */
  availableVersion: string | null
  /** 200 时是否触发了体下载（源不支持条件请求 / 有更新）。 */
  bodyFetched: boolean
}

/**
 * 默认检查探针（可注入替身）：条件请求；304 → reachable；200 → 解析远端版本
 * （只检查不安装）；网络失败 → unreachable。注意：200 时**不回写** etag /
 * lastModified（见 runAutoCheck 内说明）——否则下次检查会对未安装的新内容
 * 误判 304，永远看不到「有更新」。
 */
export async function defaultCheckProbe(input: AutoCheckProbeInput): Promise<AutoCheckProbeOutcome> {
  try {
    const download = await downloadToFile({
      url: input.url,
      destinationPath: path.join(input.workDir, 'probe.zip'),
      etag: input.etag,
      lastModified: input.lastModified,
      signal: input.signal,
      connectTimeoutMs: input.connectTimeoutMs,
      totalTimeoutMs: input.totalTimeoutMs,
      maxBytes: DOWNLOAD_GUARDS.maxBytes,
      delay: input.delay,
    })
    if (download.status === 304) {
      return { reachable: true, reason: null, etag: download.headers.etag ?? null, lastModified: download.headers.lastModified ?? null, availableVersion: null, bodyFetched: false }
    }
    // 200：读体 → 解析版本（zip 加固解压到 workDir，不安装）
    let availableVersion: string | null = null
    if (download.archivePath) {
      try {
        const bytes = await fsp.readFile(download.archivePath)
        const extract = await extractGuarded(bytes, path.join(input.workDir, 'probe-extract'), DEFAULT_ZIP_LIMITS)
        const skillMd = pickSkillMd(extract.files)
        const parsed = parseSkillFrontmatter((await fsp.readFile(skillMd.absPath)).toString('utf8'))
        if (parsed.ok) availableVersion = parsed.version?.raw ?? null
      } catch {
        // 探针解析失败不产生错误（源可能暂时异常），只记 availableVersion 不可得
        availableVersion = null
      }
    }
    return {
      reachable: true,
      reason: null,
      etag: download.headers.etag ?? null,
      lastModified: download.headers.lastModified ?? null,
      availableVersion,
      bodyFetched: true,
    }
  } catch (error) {
    return { reachable: false, reason: error instanceof Error ? error.message : String(error), etag: null, lastModified: null, availableVersion: null, bodyFetched: false }
  }
}

export type AutoCheckOutcome =
  | { ran: true; sourceReachable: SkillMeta['sourceReachable']; availableVersion: string | null; warnings: string[]; metaPath: string | null }
  | { ran: false; reason: string; warnings: string[]; metaPath: string | null }

export interface RunAutoCheckInput {
  /** 配置的 skill.installDir（受限反推的依据）。 */
  installDir?: string | null
  /** 配置的 skill.sourceUrl。 */
  sourceUrl?: string | null
  /** 配置的 skill.autoCheck（默认 true）。 */
  autoCheck?: boolean
  /** 配置的 skill.checkIntervalHours（默认 24）。 */
  checkIntervalHours?: number
  /** 测试直供项目根（跳过 meta 记录的解析路径）。 */
  projectRoot?: string | null
  /** 显式落点根（localDir 源或测试直供）。 */
  targetRoot?: string | null
  name?: string
  /** 注入检查探针（测试桩计数）。 */
  check?: (input: AutoCheckProbeInput) => Promise<AutoCheckProbeOutcome>
  limits?: ZipLimits
  now?: () => Date
  signal?: AbortSignal
  /** 探针超时覆盖（默认连接 3s / 总 60s）。 */
  connectTimeoutMs?: number
  totalTimeoutMs?: number
  /** 重试退避延时注入（测试 0ms）。 */
  delay?: (ms: number) => Promise<void>
}

/**
 * 启动检查入口（挂载后异步调用一次；失败不阻断挂载，恒正常返回）。
 */
export async function runAutoCheck(input: RunAutoCheckInput): Promise<AutoCheckOutcome> {
  const now = input.now ?? (() => new Date())
  if (input.autoCheck === false) {
    return { ran: false, reason: 'autoCheck 已关闭（skill.autoCheck=false）', warnings: [], metaPath: null }
  }

  // 根来源：① meta 记录值 ② 受限反推（无 cwd——后台检查禁止猜测）
  const name = input.name ?? 'tdx-tq-local'
  let targetRoot: string | null = input.targetRoot ? path.resolve(input.targetRoot) : null
  let meta: SkillMeta | null = null
  let metaPath: string | null = null
  if (targetRoot !== null) {
    const read = await readMeta(metaPathFor(targetRoot, name))
    meta = read.meta
    metaPath = metaPathFor(targetRoot, name)
  }
  const projectRoot: string | null = input.projectRoot ?? meta?.projectRoot ?? null
  void projectRoot // 记录值仅供诊断；检查只依赖 meta 的条件请求标识与落点推导
  if (targetRoot === null) {
    const installDir = (input.installDir ?? '').trim()
    if (installDir === '') {
      return {
        ran: false,
        reason: '无可用根来源（meta.json 无记录值且 skill.installDir 为空）——跳过检查（零出站）',
        warnings: [
          '警告：启动检查跳过——无可用根来源（meta.json 无记录值且 skill.installDir 为空）；' +
            '首次安装后会记录项目根，启动检查将恢复。',
        ],
        metaPath: null,
      }
    }
    if (!path.isAbsolute(installDir)) {
      return {
        ran: false,
        reason: 'skill.installDir 为相对路径且无记录值——跳过检查（零出站，不做反推）',
        warnings: ['警告：启动检查跳过——skill.installDir 为相对路径且无记录值，无解析基。'],
        metaPath: null,
      }
    }
    const derived = deriveRootFromInstallDir(installDir, meta?.projectRoot ?? null)
    if (derived === null) {
      return {
        ran: false,
        reason: `skill.installDir（${installDir}）受限反推失败——跳过检查（零出站）`,
        warnings: ['警告：启动检查跳过——skill.installDir 反推不出项目根；请显式安装一次以记录项目根。'],
        metaPath: null,
      }
    }
    targetRoot = path.resolve(installDir)
    metaPath = metaPathFor(targetRoot, name)
    const read = await readMeta(metaPath)
    meta = read.meta
  }
  // ── 节流：lastCheckedAt + checkIntervalHours ──────────────────────────
  const intervalHours = input.checkIntervalHours ?? DEFAULT_CHECK_INTERVAL_HOURS
  const lastCheckedMs = meta?.lastCheckedAt ? Date.parse(meta.lastCheckedAt) : Number.NaN
  if (!Number.isNaN(lastCheckedMs)) {
    const dueMs = lastCheckedMs + intervalHours * 3_600_000
    if (Date.now() < dueMs) {
      return {
        ran: false,
        reason: `节流：距上次检查（${meta?.lastCheckedAt}）不足 ${intervalHours} 小时`,
        warnings: [`警告：启动检查因节流跳过（lastCheckedAt=${meta?.lastCheckedAt}，checkIntervalHours=${intervalHours}）。`],
        metaPath,
      }
    }
  }

  const sourceUrl = input.sourceUrl ?? meta?.sourceUrl ?? DEFAULT_TQ_SKILL_SOURCE_URL
  const tmpBase = path.join(path.dirname(path.resolve(targetRoot as string)), '.dsh-trader-kit-tmp')
  await fsp.mkdir(tmpBase, { recursive: true })
  const workDir = await fsp.mkdtemp(path.join(tmpBase, 'run-'))
  try {
    const probe = input.check ?? defaultCheckProbe
    const outcome = await probe({
      url: sourceUrl,
      etag: meta?.etag ?? null,
      lastModified: meta?.lastModified ?? null,
      workDir,
      signal: input.signal,
      connectTimeoutMs: input.connectTimeoutMs,
      totalTimeoutMs: input.totalTimeoutMs,
      delay: input.delay,
    })
    const warnings: string[] = []
    const timestamp = now().toISOString()
    const sourceReachable: SkillMeta['sourceReachable'] = outcome.reachable
      ? { state: 'reachable', checkedAt: timestamp, reason: null }
      : { state: 'unreachable', checkedAt: timestamp, reason: outcome.reason }
    if (!outcome.reachable) {
      warnings.push(`警告：启动检查探测失败（${outcome.reason ?? '未知原因'}）；已安装版本保留继续可用。`)
    }
    if (meta) {
      // 只检查不安装：**不回写 etag/lastModified**（保留旧标识，确保下次条件请求
      // 仍能发现未安装的更新）；仅更新 lastCheckedAt / sourceReachable / availableVersion
      meta.lastCheckedAt = timestamp
      meta.sourceReachable = sourceReachable
      if (outcome.availableVersion !== null) meta.availableVersion = outcome.availableVersion
      await writeMeta(metaPath as string, meta)
    }
    return { ran: true, sourceReachable, availableVersion: outcome.availableVersion, warnings, metaPath }
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }).catch(() => undefined)
  }
}
