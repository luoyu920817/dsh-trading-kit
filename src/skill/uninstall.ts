/**
 * 卸载出口（change 3 tq-skill-installer tasks 4.5）：幂等删除落点 + 残留清理，
 * `purge` 决定是否删 meta.json（以文件系统为准的状态语义由 status 装配承担）。
 *
 * 与安装器共用暂存区拓扑：`tmpBase = <dirname(targetRoot)>/.dsh-trader-kit-tmp/`，
 * meta 在 `<tmpBase>/meta/<name>.json`（state.ts metaPathFor）。
 */
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import * as path from 'node:path'
import { existsSync } from 'node:fs'
import { metaPathFor } from './state.ts'

export type UninstallOutcome = 'uninstalled' | 'nothing-to-do'

export interface UninstallInput {
  /** 项目根（与安装/状态同一来源；仅用于回显与排障）。 */
  cwd?: string
  /** 落点根（resolveTargetRoot 的产物）。 */
  targetRoot: string
  /** skill 目录名。 */
  name: string
  /** true = 连 meta.json 一并删除；false = 保留（卸载后 status 为 missing + 残留记录警告）。 */
  purge?: boolean
  now?: () => Date
}

export interface UninstallResult {
  outcome: UninstallOutcome
  /** 本次清理的残留路径（落点之外；正常为空）。 */
  residue: string[]
  warnings: string[]
}

/** 幂等卸载：落点不存在且无任何可清理项 → nothing-to-do（不报错）。 */
export async function uninstallSkill(input: UninstallInput): Promise<UninstallResult> {
  const targetRoot = path.resolve(input.targetRoot)
  const name = input.name
  const skillDir = path.join(targetRoot, name)
  const metaPath = metaPathFor(targetRoot, name)
  const tmpBase = path.dirname(path.dirname(metaPath)) // <dirname(targetRoot)>/.dsh-trader-kit-tmp
  const warnings: string[] = []
  const residue: string[] = []
  const now = input.now ?? (() => new Date())

  const skillDirExists = existsSync(skillDir)
  const metaExists = existsSync(metaPath)

  // ② 暂存区残留清理先于早退判断执行（tasks 4.5④：即使落点/meta 均已不存在，
  // 历史残留 run-* / legacy 目录仍要清——这正是 uninstall 的「一并清理」语义）。
  if (existsSync(tmpBase)) {
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = await readdir(tmpBase, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      const isRunDir = entry.isDirectory() && entry.name.startsWith('run-')
      const isLegacy = entry.isDirectory() && (entry.name.startsWith('.*backup-') || entry.name.startsWith('.*stage-'))
      if (!isRunDir && !isLegacy) continue
      const leftover = path.join(tmpBase, entry.name)
      try {
        // 陈旧运行目录 >10 分钟才接管（与锁的过期窗口一致）；新目录可能属于在途安装。
        const st = await stat(leftover)
        const ageMs = now().getTime() - st.mtimeMs
        if (isRunDir && ageMs < 10 * 60 * 1000) continue
        await rm(leftover, { recursive: true, force: true })
        residue.push(leftover)
      } catch {
        warnings.push(`警告：暂存残留 ${leftover} 清理失败，已保留。`)
      }
    }
  }

  if (!skillDirExists && !metaExists) {
    // 无落点无 meta：残留清完即为 nothing-to-do（residue 非空时仍如实返回）。
    return residue.length > 0
      ? { outcome: 'uninstalled', residue, warnings }
      : { outcome: 'nothing-to-do', residue, warnings }
  }

  // ① 删落点目录（含全部内容）。
  if (skillDirExists) {
    try {
      await rm(skillDir, { recursive: true, force: true })
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause)
      warnings.push(`警告：落点目录删除失败（${reason}）——残留路径已记入 residue，可重试或手工清理。`)
      residue.push(skillDir)
    }
  }

  // ② 清理暂存区运行残留（run-* 目录）；历史 legacy 残留一并清理（tasks 4.5④）。
  if (existsSync(tmpBase)) {
    let entries: Array<{ name: string; isDirectory(): boolean }>
    try {
      entries = await readdir(tmpBase, { withFileTypes: true })
    } catch {
      entries = []
    }
    for (const entry of entries) {
      const isRunDir = entry.isDirectory() && entry.name.startsWith('run-')
      const isLegacy = entry.isDirectory() && (entry.name.startsWith('.*backup-') || entry.name.startsWith('.*stage-'))
      if (!isRunDir && !isLegacy) continue
      const leftover = path.join(tmpBase, entry.name)
      try {
        // 陈旧运行目录 >10 分钟才接管（与锁的过期窗口一致）；新目录可能属于在途安装。
        const st = await stat(leftover)
        const ageMs = now().getTime() - st.mtimeMs
        if (isRunDir && ageMs < 10 * 60 * 1000) continue
        await rm(leftover, { recursive: true, force: true })
        residue.push(leftover)
      } catch {
        warnings.push(`警告：暂存残留 ${leftover} 清理失败，已保留。`)
      }
    }
  }

  // ③ meta：purge 删；否则保留（status 以文件系统为准 → missing + 「残留 meta.json」警告由装配层产出）。
  if (input.purge === true) {
    if (metaExists) {
      try {
        await rm(metaPath, { force: true })
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause)
        warnings.push(`警告：meta.json 删除失败（${reason}）。`)
        residue.push(metaPath)
      }
    }
    // meta 目录空了顺手清理（保持 tmpBase 干净；失败不致命）。
    const metaDir = path.dirname(metaPath)
    try {
      const rest = await readdir(metaDir)
      if (rest.length === 0) await rm(metaDir, { force: true })
    } catch {
      // 目录不存在/被并发清理——忽略。
    }
  } else if (metaExists) {
    // 保留 meta：写回 lastUninstalledAt 供排障（失败不致命——meta 是记录不是权威）。
    try {
      const raw = await readFile(metaPath, 'utf8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      parsed.lastUninstalledAt = now().toISOString()
      await writeFile(metaPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8')
    } catch {
      // 不可解析/写失败——保留原样即可。
    }
  }

  const outcome: UninstallOutcome = skillDirExists || residue.length > 0 ? 'uninstalled' : 'nothing-to-do'
  return { outcome, residue, warnings }
}
