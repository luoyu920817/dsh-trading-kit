/**
 * tasks 2.6：第二层集成测试——真实 registry 模拟器 + 真实临时项目根（含 .git）。
 * 安装 → list({cwd}) 命中、落点逐字符断言、恰好 1 个候选胜出、零残留不被发现；
 * change 5 形态（非默认 name/targetRoot）同样可核对。
 */
import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { promises as fsp } from 'node:fs'
import { installSkill } from '../../src/skill/installer.ts'
import { checkDiscovery } from '../../src/skill/discovery.ts'
import { createHostSkillsSim } from './helpers/host-skills-sim.ts'
import { tempDir, tempGitProject, writeSkillDir } from './helpers/tmp.ts'
import { clearInProcessLocksForTest } from '../../src/skill/lock.ts'
import { buildOfficialLikeZip } from './helpers/zipgen.ts'

const OFFICIAL_ZIP = buildOfficialLikeZip(
  '---\nname: 通达信TQ-Local\nversion: 1.2.0（2026-09-20）\ndescription: TdxQuant\n---\n\nTQ\n',
)

afterEach(() => clearInProcessLocksForTest())

describe('discovery 集成（tasks 2.6）', () => {
  it('①②③ https 源默认实例安装后：list({cwd}) 命中、path 与落点一致、恰好 1 个候选、零残留不被发现', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const result = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL_ZIP), projectRoot: project.path,
      })
      expect(result.ok).toBe(true)

      const sim = createHostSkillsSim()
      const view = await sim.list({ cwd: project.path })
      // 扫描型用例先断言扫描目标非空
      expect(view.length).toBeGreaterThan(0)
      const hits = view.filter((entry) => entry.name === 'tdx-tq-local')
      // ② 恰好 1 个候选胜出
      expect(hits.length).toBe(1)
      // ① path 与本落点逐字符一致、source 为项目根 provider
      const skillMdPath = path.resolve(targetRoot, 'tdx-tq-local', 'SKILL.md')
      expect(hits[0].path).toBe(skillMdPath)
      expect(hits[0].source).toBe('project-dsh')

      // checkDiscovery 命中判据
      const discovery = await checkDiscovery({ skills: sim, projectRoot: project.path, targetRoot, name: 'tdx-tq-local' })
      expect(discovery.found).toBe(true)
      expect(discovery.winner?.path).toBe(skillMdPath)

      // ③ list({cwd}) 结果不含任何暂存/备份残留目录
      const tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')
      const residueDirs = (await fsp.readdir(tmpBase)).filter((name) => name.startsWith('run-'))
      expect(residueDirs).toEqual([])
      const resultPaths = (await sim.list({ cwd: project.path })).map((entry) => path.dirname(path.dirname(entry.path)))
      expect(resultPaths.every((dir) => !dir.includes('.dsh-trader-kit-tmp'))).toBe(true)
    } finally {
      await project.cleanup()
    }
  })

  it('④⑤ change 5 形态：name=review-daily-summary 部署后核对按该 name/targetRoot 生效（须登记进候选根）', async () => {
    const project = await tempGitProject()
    const dataRootArea = await tempDir()
    try {
      const sourceDir = await writeSkillDir(dataRootArea.path, 'review-daily-summary-src', { version: '0.1.0' })
      const targetRoot = path.join(dataRootArea.path, 'agent', 'skills')

      // 尚未登记进候选根 → 核对应为「未发现」（模拟器不认识该根）
      const simUnregistered = createHostSkillsSim()
      const before = await checkDiscovery({ skills: simUnregistered, projectRoot: project.path, targetRoot, name: 'review-daily-summary' })
      expect(before.found).toBe(false)

      // 部署（localDir 源）
      const { syncLocalDir } = await import('../../src/skill/local-source.ts')
      const deploy = await syncLocalDir({ sourcePath: sourceDir, targetRoot, name: 'review-daily-summary', projectRoot: project.path })
      expect(deploy.outcome).toBe('installed')
      expect(deploy.skillPath).toBe(path.resolve(targetRoot, 'review-daily-summary', 'SKILL.md'))

      // 登记进 extraSkillRoots（宿主 customSkillDirs 等价）→ 命中
      const sim = createHostSkillsSim({ extraRoots: [{ path: targetRoot, rank: 300 }] })
      const view = await sim.list({ cwd: project.path })
      expect(view.length).toBeGreaterThan(0)
      const discovery = await checkDiscovery({
        skills: sim, projectRoot: project.path, targetRoot, name: 'review-daily-summary',
      })
      expect(discovery.found).toBe(true)
      expect(discovery.winner?.path).toBe(path.resolve(targetRoot, 'review-daily-summary', 'SKILL.md'))
      // 与 tdx-tq-local 无耦合：同名默认实例不被误命中
      expect(view.find((entry) => entry.name === 'tdx-tq-local')).toBeUndefined()
    } finally {
      await project.cleanup()
      await dataRootArea.cleanup()
    }
  })
})
