/**
 * tasks 2.2③–⑧：status 的根解析证据（cwd ≠ projectRoot 提示 / 记录优先 /
 * 受限反推正当与拒绝路径 / 相对 installDir 拒绝）。
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { buildSkillStatus } from '../../src/skill/status.ts'
import { metaPathFor, emptyMeta, writeMeta } from '../../src/skill/state.ts'
import { tempDir, tempGitProject, writeSkillDir } from './helpers/tmp.ts'
import { SkillRootResolutionError } from '../../src/skill/errors.ts'

describe('status 根解析（tasks 2.2③–⑧）', () => {
  it('③ cwd ≠ projectRoot 时 status 显式提示（warning 含 resolvedCwd/projectRoot/cwdSource）', async () => {
    const project = await tempGitProject()
    try {
      const sub = path.join(project.path, 'packages', 'app')
      const status = await buildSkillStatus({ cwd: sub })
      expect(status.resolvedCwd).toBe(path.resolve(sub))
      expect(status.projectRoot).toBe(path.resolve(project.path))
      expect(status.cwdSource).toBe('explicit')
      expect(status.warnings.join('\n')).toContain('cwdSource=explicit')
      expect(status.warnings.join('\n')).toContain(path.resolve(project.path))
    } finally {
      await project.cleanup()
    }
  })

  it('⑤ 记录优先：meta 有 projectRoot、installDir=<dshHome>/skills（绝对、祖先无 .git）→ projectRoot=记录值、cwdSource=recorded', async () => {
    const project = await tempGitProject()
    const dshHome = await tempDir()
    try {
      const installDir = path.join(dshHome.path, 'skills')
      // meta 按配置落点定位（<dshHome>/.dsh-trader-kit-tmp/meta/...）
      const meta = emptyMeta()
      meta.projectRoot = project.path
      meta.resolvedCwd = project.path
      meta.targetRoot = installDir
      meta.name = 'tdx-tq-local'
      meta.sourceKind = 'https-zip'
      meta.version = '1.2.0'
      await writeMeta(metaPathFor(installDir, 'tdx-tq-local'), meta)

      const status = await buildSkillStatus({ installDir })
      expect(status.cwdSource).toBe('recorded')
      expect(status.projectRoot).toBe(path.resolve(project.path)) // MUST NOT 因反推而改变
      expect(status.resolvedCwd).toBe(path.resolve(project.path))
    } finally {
      await project.cleanup()
      await dshHome.cleanup()
    }
  })

  it('⑥ 受限反推（正当路径）：无记录值、installDir=<projectRoot>/skills（祖先含 .git）→ 反推得到真实项目根', async () => {
    const project = await tempGitProject()
    try {
      const installDir = path.join(project.path, 'skills')
      const status = await buildSkillStatus({ installDir })
      expect(status.cwdSource).toBe('install-dir-derived')
      expect(status.projectRoot).toBe(path.resolve(project.path))
      expect(status.resolvedCwd).toBeNull()
    } finally {
      await project.cleanup()
    }
  })

  it('⑦ 受限反推（拒绝路径）：无记录值、installDir=<dshHome>/skills（祖先无 .git）→ 显式拒绝', async () => {
    const home = await tempDir()
    try {
      const installDir = path.join(home.path, 'skills')
      let caught: unknown = null
      try {
        await buildSkillStatus({ installDir })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(SkillRootResolutionError)
      const message = (caught as Error).message
      expect(message).toContain(installDir)
      expect(message).toContain('受限反推失败')
      expect(message).toMatch(/处置建议|显式传 cwd|修正 installDir/)
    } finally {
      await home.cleanup()
    }
  })

  it('⑧ 相对 installDir + 无 cwd → 显式拒绝（理由 = 无解析基），不回退 process.cwd()', async () => {
    let caught: unknown = null
    try {
      await buildSkillStatus({ installDir: 'relative-skills' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SkillRootResolutionError)
    expect((caught as Error).message).toContain('无解析基')
    expect((caught as Error).message).toContain('skill.installDir')
  })

  it('④/无来源：既无 cwd 又无记录且 installDir 为空 → 显式拒绝（无可用来源），resolvedCwd/projectRoot 为 null', async () => {
    let caught: unknown = null
    try {
      await buildSkillStatus({})
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(SkillRootResolutionError)
    expect((caught as Error).message).toContain('无可用来源')
    expect((caught as SkillRootResolutionError).resolvedCwd).toBeNull()
    expect((caught as SkillRootResolutionError).projectRoot).toBeNull()
  })

  it('反向控制：cwd 显式给出时正常解析且落点为默认 rank 100', async () => {
    const project = await tempGitProject()
    try {
      await writeSkillDir(path.join(project.path, '.dsh', 'skills'), 'tdx-tq-local', { version: '1.2.0' })
      const status = await buildSkillStatus({ cwd: project.path })
      expect(status.cwdSource).toBe('explicit')
      expect(status.targetRoot).toBe(path.join(path.resolve(project.path), '.dsh', 'skills'))
      expect(status.state).toBe('installed')
    } finally {
      await project.cleanup()
    }
  })
})
