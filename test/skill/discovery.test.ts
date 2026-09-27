/**
 * tasks 2.3：可发现性核对（按宿主签名传 cwd + name/targetRoot 参数化 + 服务不可用退化）。
 * tasks 2.5：同名遮蔽检测。
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { checkDiscovery } from '../../src/skill/discovery.ts'
import { findShadowedCandidates, formatShadowWarning } from '../../src/skill/shadowing.ts'
import { createHostSkillsSim } from './helpers/host-skills-sim.ts'
import { tempDir, tempGitProject, writeSkillDir } from './helpers/tmp.ts'

describe('checkDiscovery（tasks 2.3）', () => {
  it('① 真实 registry（宿主行为模拟器 + 真实临时项目根）：hit.path === <targetRoot>/<name>/SKILL.md', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '1.2.0' })
      const sim = createHostSkillsSim()
      const result = await checkDiscovery({ skills: sim, projectRoot: project.path, targetRoot, name: 'tdx-tq-local' })
      expect(result.mode).toBe('host-service')
      expect(result.found).toBe(true)
      expect(result.winner?.path).toBe(path.resolve(targetRoot, 'tdx-tq-local', 'SKILL.md'))
      expect(result.winner?.source).toBe('project-dsh')
      expect(result.warnings).toEqual([])
    } finally {
      await project.cleanup()
    }
  })

  it('② cwd 必传：实现不传 cwd 的对照断言——list({cwd}) 命中而裸 list() 空过即失败', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '1.2.0' })
      const sim = createHostSkillsSim()
      // 对照：不传 cwd 的调用（宿主不扫 rank 100）→ 空
      const withoutCwd = await sim.list({ cwd: undefined as unknown as string }).catch(() => [])
      expect(withoutCwd.length).toBe(0)
      // 本实现：cwd 必传 → 命中
      const result = await checkDiscovery({ skills: sim, projectRoot: project.path, targetRoot, name: 'tdx-tq-local' })
      expect(result.found).toBe(true)
    } finally {
      await project.cleanup()
    }
  })

  it('③ skills 注入 undefined → filesystem-only 且不产生「未发现」警告（落点存在）', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '1.2.0' })
      const result = await checkDiscovery({ skills: undefined, projectRoot: project.path, targetRoot, name: 'tdx-tq-local' })
      expect(result.mode).toBe('filesystem-only')
      expect(result.found).toBe(true)
      expect(result.warnings).toEqual([])
    } finally {
      await project.cleanup()
    }
  })

  it('③b skills 抛错（宿主服务不可用）→ 退化 filesystem-only，MUST NOT 写「未发现」', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '1.2.0' })
      const sim = createHostSkillsSim({ failList: true })
      const result = await checkDiscovery({ skills: sim, projectRoot: project.path, targetRoot, name: 'tdx-tq-local' })
      expect(result.mode).toBe('filesystem-only')
      expect(result.found).toBe(true)
      expect(result.warnings.join('\n')).not.toContain('未发现')
    } finally {
      await project.cleanup()
    }
  })

  it('④ 参数化证明：name=review-daily-summary + 自定义 targetRoot → 按该 name 生效（写死 tdx-tq-local 的实现判失败）', async () => {
    const project = await tempGitProject()
    const customRoot = await tempGitProject()
    try {
      const targetRoot = path.join(customRoot.path, 'agent', 'skills')
      await writeSkillDir(targetRoot, 'review-daily-summary', { version: '0.1.0' })
      const sim = createHostSkillsSim({ extraRoots: [{ path: targetRoot, rank: 300 }] })
      const result = await checkDiscovery({
        skills: sim, projectRoot: project.path, targetRoot, name: 'review-daily-summary',
      })
      expect(result.found).toBe(true)
      expect(result.winner?.path).toBe(path.resolve(targetRoot, 'review-daily-summary', 'SKILL.md'))
    } finally {
      await project.cleanup()
      await customRoot.cleanup()
    }
  })

  it('not-discovered：host-service 模式下没扫到 → 显式警告含 resolvedCwd/cwdSource', async () => {
    const project = await tempGitProject()
    const elsewhere = await tempGitProject()
    try {
      const sim = createHostSkillsSim()
      const result = await checkDiscovery({
        skills: sim, projectRoot: project.path, targetRoot: path.join(elsewhere.path, '.dsh', 'skills'), name: 'tdx-tq-local',
      })
      expect(result.found).toBe(false)
      expect(result.warnings.join('\n')).toContain('not-discovered')
      expect(result.warnings.join('\n')).toContain('cwdSource')
    } finally {
      await project.cleanup()
      await elsewhere.cleanup()
    }
  })
})

describe('findShadowedCandidates（tasks 2.5）', () => {
  it('fixture：rank 100 同名副本 → shadowed[0] 含 path/rank/version/name 且警告形如 spec', async () => {
    const project = await tempGitProject()
    const customRoot = await tempDir()
    try {
      // 本落点：extraSkillRoots（rank 300 意图）；遮蔽者：rank 100 同名旧副本
      const targetRoot = path.join(customRoot.path, 'agent', 'skills')
      await writeSkillDir(targetRoot, 'review-daily-summary', { version: '0.2.0' })
      const shadowRoot = path.join(project.path, '.dsh', 'skills')
      await writeSkillDir(shadowRoot, 'review-daily-summary', { version: '0.1.0' })

      // 扫描目标非空（防空过）
      const roots = [
        { path: targetRoot, rank: 300 },
        { path: shadowRoot, rank: 100 },
        { path: path.join(project.path, '.agents', 'skills'), rank: 200 },
      ]
      const candidates = findShadowedCandidates({ roots, name: 'review-daily-summary', excludePath: path.join(targetRoot, 'review-daily-summary', 'SKILL.md') })
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates[0]).toMatchObject({ rank: 100, version: '0.1.0', name: 'review-daily-summary' })
      expect(candidates[0].path).toBe(path.resolve(shadowRoot, 'review-daily-summary', 'SKILL.md'))
      const warning = formatShadowWarning(candidates[0])
      expect(warning).toContain(`已遮蔽 ${candidates[0].path}`)
      expect(warning).toContain('rank 100')
      expect(warning).toContain('版本 0.1.0')
    } finally {
      await project.cleanup()
      await customRoot.cleanup()
    }
  })

  it('无同名副本 → shadowed === []', async () => {
    const project = await tempGitProject()
    try {
      const candidates = findShadowedCandidates({
        roots: [{ path: path.join(project.path, '.dsh', 'skills'), rank: 100 }],
        name: 'tdx-tq-local',
      })
      expect(candidates).toEqual([])
    } finally {
      await project.cleanup()
    }
  })

  it('change 5 形态：name=review-daily-summary 检测与 tdx-tq-local 无耦合', async () => {
    const project = await tempGitProject()
    try {
      await writeSkillDir(path.join(project.path, '.agents', 'skills'), 'review-daily-summary', { version: '0.3.0' })
      const candidates = findShadowedCandidates({
        roots: [
          { path: path.join(project.path, '.dsh', 'skills'), rank: 100 },
          { path: path.join(project.path, '.agents', 'skills'), rank: 200 },
        ],
        name: 'review-daily-summary',
      })
      expect(candidates.length).toBe(1)
      expect(candidates[0].rank).toBe(200)
    } finally {
      await project.cleanup()
    }
  })
})
