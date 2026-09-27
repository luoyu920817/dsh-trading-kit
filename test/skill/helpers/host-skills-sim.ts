/**
 * 测试专用宿主 skills 注册表模拟器（tasks 2.3/2.6 的「真实 registry」替身）。
 *
 * 零 mock 纪律：它不拦截/打桩任何东西，而是**按 design F1/F3/F4 的已核验宿主
 * 行为**对真实文件系统做真实扫描（rank 100/200 项目根只在 cwd 传入时推入、
 * 一层目录 + SKILL.md、无 dot 过滤、`.system` 跳过、localeCompare 升序、
 * rank → providerOrder → localOrder 胜出排序）。宿主源码本会话不可达，
 * 此模拟器以可执行形式固化 F1/F3/F4 的核验结论，供集成测试断言。
 */

import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type { HostSkillView, HostSkillsService } from '../../../src/skill/discovery.ts'
import { resolveProjectRoot } from '../../../src/skill/root.ts'

export interface SimExtraRoot {
  path: string
  rank: number
}

export interface SimHostOptions {
  /** 宿主 Config.customSkillDirs 等价物（rank 300 意图）。 */
  extraRoots?: SimExtraRoot[]
  /** 模拟宿主 skills 服务不可用（list 抛错 → 插件应退化 filesystem-only）。 */
  failList?: boolean
}

export function createHostSkillsSim(options: SimHostOptions = {}): HostSkillsService & { allCandidates: (cwd: string) => HostSkillView[] } {
  function scanRoots(cwd: string): Array<{ root: string; rank: number }> {
    const roots: Array<{ root: string; rank: number }> = []
    // F3：项目根只在 cwd !== undefined 时才被推入（本模拟器 list 的 cwd 必传，
    // 由调用方保证；插件实现 MUST 传 cwd——不传的实现对应用例判失败）
    const projectRoot = resolveProjectRoot(cwd)
    roots.push({ root: path.join(projectRoot, '.dsh', 'skills'), rank: 100 })
    roots.push({ root: path.join(projectRoot, '.agents', 'skills'), rank: 200 })
    for (const extra of options.extraRoots ?? []) {
      roots.push({ root: extra.path, rank: extra.rank })
    }
    return roots
  }

  function scanAll(cwd: string): HostSkillView[] {
    const candidates: Array<HostSkillView & { rank: number; localName: string }> = []
    for (const { root, rank } of scanRoots(cwd)) {
      if (!existsSync(root)) continue
      let dirents: Array<{ name: string; isDirectory: boolean }>
      try {
        dirents = readdirSync(root, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }))
      } catch {
        continue
      }
      for (const entry of dirents) {
        // F4：唯一跳过是 root.skipSystem && entry.name === '.system'
        if (entry.name === '.system') continue
        if (!entry.isDirectory) continue
        const skillMd = path.join(root, entry.name, 'SKILL.md')
        if (!existsSync(skillMd)) continue
        candidates.push({
          name: entry.name,
          path: skillMd,
          source: rank === 100 ? 'project-dsh' : rank === 200 ? 'project-agents' : 'custom',
          rank,
          localName: entry.name,
        })
      }
    }
    // F1：胜出顺序 rank → providerOrder → localOrder（同 provider 内目录名 localeCompare 升序）
    candidates.sort((a, b) => a.rank - b.rank || a.localName.localeCompare(b.localName))
    return candidates
  }

  return {
    async list({ cwd }: { cwd: string }) {
      if (options.failList) throw new Error('host skills service unavailable (simulated)')
      const all = scanAll(cwd)
      // list 只返回赢家：同名取最前 rank
      const winners = new Map<string, HostSkillView>()
      for (const candidate of all) {
        if (!winners.has(candidate.name)) {
          winners.set(candidate.name, { name: candidate.name, path: candidate.path, source: candidate.source, rank: candidate.rank })
        }
      }
      return [...winners.values()]
    },
    allCandidates(cwd: string) {
      return scanAll(cwd)
    },
  }
}
