/**
 * tasks 3.1（基线警告，仅 https 源）+ 3.5（篡改/降级/条件请求失败路径 + vault 副本无关）。
 * status 为纯文件系统 + meta 装配（零出站，见 update.test.ts 的缓存结论用例）。
 */
import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { buildSkillStatus } from '../../src/skill/status.ts'
import { metaPathFor, readMeta, emptyMeta, writeMeta } from '../../src/skill/state.ts'
import { installSkill } from '../../src/skill/installer.ts'
import { buildOfficialLikeZip } from './helpers/zipgen.ts'
import { tempDir, tempGitProject, writeSkillDir } from './helpers/tmp.ts'
import { clearInProcessLocksForTest } from '../../src/skill/lock.ts'

const OFFICIAL = () => buildOfficialLikeZip('---\nname: 通达信TQ-Local\nversion: 1.2.0（2026-09-20）\ndescription: t\n---\n\nTQ body\n')

describe('版本基线警告（tasks 3.1）', () => {
  it('版本正常：installed + drift unchanged + warnings 为空（除记录缺失外）', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL()), projectRoot: project.path,
      })
      const status = await buildSkillStatus({ cwd: project.path, minVersion: '1.2.0' })
      expect(status.state).toBe('installed')
      expect(status.drift).toBe('unchanged')
      expect(status.baseline).toBe('1.2.0')
      expect(status.warnings).toEqual([])
      expect(status.version).toBe('1.2.0')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('低于基线 → warning 含「已装版本、基线、建议动作」三段且不阻断（state 正常返回）', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.1.0\n---\n')),
        projectRoot: project.path,
      })
      const status = await buildSkillStatus({ cwd: project.path, minVersion: '1.2.0' })
      expect(status.state).toBe('version-below-baseline')
      const warning = status.warnings.join('\n')
      expect(warning).toContain('1.1.0') // 已装版本
      expect(warning).toContain('1.2.0') // 基线
      expect(warning).toContain('建议动作') // 建议动作
      // 不阻断：buildSkillStatus 正常返回完整字段
      expect(status.installed).toBe(true)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('localDir 源：baseline === null 且 MUST NOT 产生 version-below-baseline（低于基线版本也不警告）', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    const customRoot = await tempDir()
    try {
      const targetRoot = path.join(customRoot.path, 'agent', 'skills')
      // 手工落一个 0.0.1 的本地源 skill（meta.sourceKind = local-dir）
      const skillDir = await writeSkillDir(targetRoot, 'review-daily-summary', { version: '0.0.1' })
      const meta = emptyMeta('local-dir')
      meta.version = '0.0.1'
      meta.contentHash = await (await import('../../src/skill/hash.ts')).sha256File(path.join(skillDir, 'SKILL.md'))
      meta.targetRoot = targetRoot
      meta.name = 'review-daily-summary'
      meta.projectRoot = project.path
      meta.sourceKind = 'local-dir'
      await writeMeta(metaPathFor(targetRoot, 'review-daily-summary'), meta)

      const status = await buildSkillStatus({
        cwd: project.path, targetRoot, name: 'review-daily-summary', minVersion: '1.2.0',
      })
      expect(status.baseline).toBeNull()
      expect(status.warnings.join('\n')).not.toContain('version-below-baseline')
      expect(status.warnings.join('\n')).not.toContain('低于基线')
      expect(status.state).toBe('installed')
      expect(status.version).toBe('0.0.1')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
      await customRoot.cleanup()
    }
  })
})

describe('篡改与降级状态（tasks 3.5）', () => {
  it('① SKILL.md 被删除（meta 仍在）→ missing + 显式警告与建议动作', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL()), projectRoot: project.path,
      })
      await fsp.rm(path.join(targetRoot, 'tdx-tq-local'), { recursive: true, force: true })
      const status = await buildSkillStatus({ cwd: project.path })
      expect(status.state).toBe('missing')
      expect(status.warnings.join('\n')).toMatch(/重装|卸载/)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('③ 保号篡改（版本不变、正文被换）→ content-drifted + 双哈希并列', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL()), projectRoot: project.path,
      })
      const skillMdPath = path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')
      const original = await fsp.readFile(skillMdPath, 'utf8')
      await fsp.writeFile(skillMdPath, original.replace('TQ body', 'TQ body TAMPERED'), 'utf8')
      const status = await buildSkillStatus({ cwd: project.path })
      expect(status.state).toBe('content-drifted')
      expect(status.drift).toBe('drifted')
      expect(status.contentHash).not.toBe(status.expectedHash)
      expect(status.warnings.join('\n')).toContain('指令集已变更')
      expect(status.warnings.join('\n')).toContain('人工复核')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('frontmatter 不可解析 → unparseable + 建议动作', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL()), projectRoot: project.path,
      })
      await fsp.writeFile(path.join(targetRoot, 'tdx-tq-local', 'SKILL.md'), 'no fence', 'utf8')
      const status = await buildSkillStatus({ cwd: project.path })
      expect(status.state).toBe('unparseable')
      expect(status.warnings.join('\n')).toMatch(/安装|更新/)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('④ vault 副本缺失/陈旧不产生错误与警告（安装器与 vault 零耦合）', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL()), projectRoot: project.path,
      })
      const status = await buildSkillStatus({ cwd: project.path })
      expect(status.warnings.join('\n').toLowerCase()).not.toContain('vault')
      expect(status.warnings.join('\n')).not.toContain('claude')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })
})

describe('downgrade-blocked 状态（3.5② 的 status 侧）', () => {
  it('上次更新被闸门拒绝 → state=downgrade-blocked + warning 含两版本号', async () => {
    clearInProcessLocksForTest()
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n')),
        projectRoot: project.path,
      })
      let caught: unknown = null
      try {
        await installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.1.0\n---\n')),
          projectRoot: project.path,
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(Error)
      const status = await buildSkillStatus({ cwd: project.path })
      expect(status.state).toBe('downgrade-blocked')
      expect(status.warnings.join('\n')).toContain('1.1.0')
      expect(status.warnings.join('\n')).toContain('1.2.0')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })
})
