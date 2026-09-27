/**
 * 更新判定与执行（tasks 3.3，design D-5；spec「更新策略与源不可达降级」）。
 *
 * 「无变化」= **零体下载**：①条件请求命中 304；②HEAD 比对一致。实现采用
 * 条件 GET（If-None-Match 优先 / If-Modified-Since 兜底，值都是原样响应头
 * 字符串）——它同时覆盖 304 与 HEAD 比对两条判定路径，且单请求即完成。
 * 双标识皆缺 / 源忽略条件请求恒 200 → 每次都取，下载后按 `version + SHA-256`
 * 判等 → 相等即 `up-to-date` 零替换（installer 的同版本同哈希短路 + installer
 * 同源标识条件），并记「源不支持条件请求」warning。
 *
 * 源不可达不是错误：保留已安装版本，状态置 `source-unreachable`（含原因）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SkillInstallerError } from './errors.ts'
import { sha256Bytes } from './hash.ts'
import { metaPathFor, readMeta, writeMeta, type SkillMeta } from './state.ts'
import { composeSourceId, DEFAULT_TQ_SKILL_SOURCE_URL } from './source.ts'
import { downloadToFile, DOWNLOAD_GUARDS } from './download.ts'
import { installSkill, type InstallResult } from './installer.ts'
import type { HostSkillsService } from './discovery.ts'
import type { ZipLimits } from './zip-guard.ts'

export interface UpdateLocalRecord {
  etag: string | null
  lastModified: string | null
}

export interface UpdateRemoteHeaders {
  etag?: string | null
  lastModified?: string | null
}

/**
 * 纯判定：本地已记录标识 × 远端标识 → 'up-to-date'（零体下载）| 'download'。
 * ETag 优先；无 ETag 用 Last-Modified；双缺 → download（接受一次体下载后按
 * version+SHA-256 判等）。
 */
export function decideUpdate(local: UpdateLocalRecord, remote: UpdateRemoteHeaders): 'up-to-date' | 'download' {
  if (local.etag && remote.etag) return local.etag === remote.etag ? 'up-to-date' : 'download'
  if (local.lastModified && remote.lastModified) {
    return local.lastModified === remote.lastModified ? 'up-to-date' : 'download'
  }
  return 'download'
}

export type UpdateOutcome = InstallResult['outcome'] | 'source-unreachable'

export interface UpdateResult {
  ok: boolean
  outcome: UpdateOutcome
  version: string | null
  previousVersion: string | null
  availableVersion: string | null
  path: string
  sourceId: string | null
  previousSourceId: string | null
  contentHash: string | null
  warnings: string[]
  residue: string[]
  sourceReachable: SkillMeta['sourceReachable']
}

export interface RunUpdateInput {
  sourceUrl?: string
  targetRoot: string
  name: string
  projectRoot?: string | null
  extraSkillRoots?: string[]
  minVersion?: string | null
  force?: boolean
  strictNameMatch?: boolean
  skills?: HostSkillsService
  signal?: AbortSignal
  scope?: unknown
  limits?: ZipLimits
  delay?: (ms: number) => Promise<void>
  connectTimeoutMs?: number
  totalTimeoutMs?: number
  maxBytes?: number
  now?: () => Date
}

/**
 * 手动更新执行：条件请求 → 304 零替换 / 200 走完整校验与原子安装（降级闸门在
 * installer 内）。源不可达 → `source-unreachable`（保留现版，不视为错误）。
 */
export async function runUpdate(input: RunUpdateInput): Promise<UpdateResult> {
  const targetRoot = path.resolve(input.targetRoot)
  const metaPath = metaPathFor(targetRoot, input.name)
  const { meta } = await readMeta(metaPath)
  const now = input.now ?? (() => new Date())
  const sourceUrl = input.sourceUrl ?? meta?.sourceUrl ?? DEFAULT_TQ_SKILL_SOURCE_URL

  const baseWarnings: string[] = []
  if (meta?.downgradeBlocked) {
    baseWarnings.push(
      `警告：上次更新被降级闸门拒绝（远端 ${meta.downgradeBlocked.remoteVersion} < 本地 ${meta.downgradeBlocked.installedVersion}，${meta.downgradeBlocked.at}）；` +
        '如确需降级请显式传 force: true。',
    )
  }

  // 条件请求（零体下载判定在 HTTP 层：304）
  const tmpBase = path.dirname(path.dirname(metaPath))
  const probePath = path.join(tmpBase, `.update-probe-${Math.random().toString(36).slice(2)}.zip`)
  let download: Awaited<ReturnType<typeof downloadToFile>>
  try {
    download = await downloadToFile({
      url: sourceUrl,
      destinationPath: probePath,
      etag: meta?.etag ?? null,
      lastModified: meta?.lastModified ?? null,
      signal: input.signal,
      delay: input.delay,
      connectTimeoutMs: input.connectTimeoutMs,
      totalTimeoutMs: input.totalTimeoutMs,
      maxBytes: input.maxBytes ?? DOWNLOAD_GUARDS.maxBytes,
    })
  } catch (error) {
    await fsp.rm(probePath, { force: true }).catch(() => undefined)
    // 源不可达：保留已安装版本继续可用（不删除、不降级），记录缓存结论
    const reason = error instanceof Error ? error.message : String(error)
    const sourceReachable = { state: 'unreachable' as const, checkedAt: now().toISOString(), reason }
    if (meta) {
      meta.sourceReachable = sourceReachable
      meta.lastCheckedAt = sourceReachable.checkedAt
      await writeMeta(metaPath, meta)
    }
    return {
      ok: true,
      outcome: 'source-unreachable',
      version: meta?.version ?? null,
      previousVersion: meta?.previousVersion ?? null,
      availableVersion: meta?.availableVersion ?? null,
      path: path.join(targetRoot, input.name, 'SKILL.md'),
      sourceId: meta?.sourceId ?? null,
      previousSourceId: meta?.previousSourceId ?? null,
      contentHash: meta?.contentHash ?? null,
      warnings: [
        ...baseWarnings,
        `警告：源不可达（${reason}）；已安装版本保留继续可用，未做任何改动。`,
      ],
      residue: [],
      sourceReachable,
    }
  }

  const timestamp = now().toISOString()

  if (download.status === 304) {
    // 零体下载：已是最新（零替换——不动目标目录）
    if (meta) {
      meta.sourceReachable = { state: 'reachable', checkedAt: timestamp, reason: null }
      meta.lastCheckedAt = timestamp
      await writeMeta(metaPath, meta)
    }
    return {
      ok: true,
      outcome: 'up-to-date',
      version: meta?.version ?? null,
      previousVersion: meta?.previousVersion ?? null,
      availableVersion: meta?.version ?? null,
      path: path.join(targetRoot, input.name, 'SKILL.md'),
      sourceId: meta?.sourceId ?? null,
      previousSourceId: meta?.previousSourceId ?? null,
      contentHash: meta?.contentHash ?? null,
      warnings: baseWarnings,
      residue: [],
      sourceReachable: { state: 'reachable', checkedAt: timestamp, reason: null },
    }
  }

  // 200：有体下载 → 完整校验 + 原子安装（降级闸门/同版本重发判定在 installer）
  if (!download.archivePath) {
    throw new SkillInstallerError('DOWNLOAD_MISSING_ARCHIVE', '下载结果缺少落盘路径（内部错误）')
  }
  const archiveBytes = await fsp.readFile(download.archivePath)
  const archiveHash = sha256Bytes(archiveBytes)
  const sourceId = composeSourceId({
    etag: download.headers.etag,
    lastModified: download.headers.lastModified,
    archiveHash,
  })
  const doubleMissingIdentifiers = !download.headers.etag && !download.headers.lastModified

  const install = await installSkill({
    targetRoot,
    name: input.name,
    kind: 'https-zip',
    archiveBytes,
    archiveHash,
    etag: download.headers.etag ?? null,
    lastModified: download.headers.lastModified ?? null,
    sourceId,
    previousSourceId: meta?.sourceId ?? null,
    sourceUrl,
    projectRoot: input.projectRoot ?? meta?.projectRoot ?? null,
    extraSkillRoots: input.extraSkillRoots,
    force: input.force,
    strictNameMatch: input.strictNameMatch,
    skills: input.skills,
    signal: input.signal,
    scope: input.scope,
    limits: input.limits,
    now: input.now,
  })

  const warnings = [...baseWarnings, ...install.warnings]
  if (doubleMissingIdentifiers && install.outcome === 'up-to-date') {
    warnings.push('警告：源不支持条件请求（无 ETag/Last-Modified 或恒返 200），已完成一次体下载；按 version + SHA-256 判等，本次零替换。')
  }

  // 清理探针下载残留（installer 内部已自带运行目录；此处仅清理 runUpdate 的直落盘文件）
  await fsp.rm(probePath, { force: true }).catch(() => undefined)

  return {
    ok: install.ok,
    outcome: install.outcome,
    version: install.version,
    previousVersion: install.previousVersion,
    availableVersion: install.version ?? meta?.availableVersion ?? null,
    path: install.path,
    sourceId: install.sourceId,
    previousSourceId: install.previousSourceId ?? meta?.sourceId ?? null,
    contentHash: install.contentHash,
    warnings,
    residue: install.residue,
    sourceReachable: { state: 'reachable', checkedAt: timestamp, reason: null },
  }
}
