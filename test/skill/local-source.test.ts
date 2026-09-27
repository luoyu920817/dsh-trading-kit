/**
 * tasks 5.2：本地目录源三态（in-sync 零写入 / user-modified 不覆盖+diff / upgradable 原子替换）
 * + 首次部署 + change 5 形态 + 基线不生效 + D-10 互斥复用。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { syncLocalDir } from '../../src/skill/local-source.ts'
import { listDirHashes } from '../../src/skill/hash.ts'
import { tempDir, tempGitProject, writeSkillDir } from './helpers/tmp.ts'
import { clearInProcessLocksForTest } from '../../src/skill/lock.ts'

afterEach(() => clearInProcessLocksForTest())

async function makeSource(version: string, body = `source body ${version}`) {
  const source = await tempDir()
  // 源目录本体 = <tmp>/skill（writeSkillDir 在其下写 SKILL.md）
  const dir = await writeSkillDir(source.path, 'skill', { version, body, fmName: 'whatever-name' })
  return { sourcePath: dir, cleanup: () => source.cleanup() }
}

describe('syncLocalDir 三态（tasks 5.2）', () => {
  it('首次部署（目标不存在）→ installed + skillPath 逐字符', async () => {
    const project = await tempGitProject()
    const area = await tempDir()
    try {
      const { sourcePath } = await makeSource('0.1.0')
      const targetRoot = path.join(area.path, 'agent', 'skills')
      const result = await syncLocalDir({ sourcePath: sourcePath, targetRoot, name: 'skill' })
      expect(result.outcome).toBe('installed')
      expect(result.skillPath).toBe(path.resolve(targetRoot, 'skill', 'SKILL.md'))
      expect(result.residue).toEqual([])
      expect(result.baseline).toBeNull()
    } finally {
      await project.cleanup()
      await area.cleanup()
    }
  })

  it('in-sync：零写入（目标 mtimeMs 与文件清单不变）', async () => {
    const project = await tempGitProject()
    const area = await tempDir()
    try {
      const { sourcePath } = await makeSource('0.1.0')
      const targetRoot = path.join(area.path, 'skills')
      await syncLocalDir({ sourcePath: sourcePath, targetRoot, name: 'skill' })
      const targetPath = path.join(targetRoot, 'skill')
      const beforeFiles = await listDirHashes(targetPath)
      const mtimeBefore = (await fsp.stat(path.join(targetPath, 'SKILL.md'))).mtimeMs

      const result = await syncLocalDir({ sourcePath: sourcePath, targetRoot, name: 'skill' })
      expect(result.outcome).toBe('in-sync')
      expect((await fsp.stat(path.join(targetPath, 'SKILL.md'))).mtimeMs).toBe(mtimeBefore)
      expect(await listDirHashes(targetPath)).toEqual(beforeFiles)
      expect(result.diff).toBeUndefined()
    } finally {
      await project.cleanup()
      await area.cleanup()
    }
  })

  it('user-modified：目标字节不变 + diff 非空（源版本 ≤ 目标版本）', async () => {
    const project = await tempGitProject()
    const area = await tempDir()
    try {
      // 目标版本 0.2.0（用户打磨过），源 0.1.0
      const source = await tempDir()
      await writeSkillDir(source.path, 'skill', { version: '0.1.0', body: 'from repo' })
      const targetRoot = path.join(area.path, 'skills')
      await writeSkillDir(targetRoot, 'skill', { version: '0.2.0', body: 'user polished\nmore lines' })

      const targetPath = path.join(targetRoot, 'skill')
      const before = await listDirHashes(targetPath)

      const result = await syncLocalDir({ sourcePath: path.join(source.path, 'skill'), targetRoot, name: 'skill' })
      expect(result.outcome).toBe('user-modified')
      expect(result.diff).toBeDefined()
      expect(result.diff!.length).toBeGreaterThan(0)
      expect(result.diff).toContain('--- a/')
      expect(result.diff).toContain('+++ b/')
      // 目标目录逐文件哈希不变（未覆盖）
      expect(await listDirHashes(targetPath)).toEqual(before)
    } finally {
      await project.cleanup()
      await area.cleanup()
    }
  })

  it('user-modified：源无 version → 不覆盖（保守侧）', async () => {
    const project = await tempGitProject()
    const area = await tempDir()
    try {
      const source = await tempDir()
      await writeSkillDir(source.path, 'skill', { version: null, body: 'no version' })
      const targetRoot = path.join(area.path, 'skills')
      await writeSkillDir(targetRoot, 'skill', { version: '0.1.0', body: 'target' })
      const before = await listDirHashes(path.join(targetRoot, 'skill'))
      const result = await syncLocalDir({ sourcePath: path.join(source.path, 'skill'), targetRoot, name: 'skill' })
      expect(result.outcome).toBe('user-modified')
      expect(await listDirHashes(path.join(targetRoot, 'skill'))).toEqual(before)
    } finally {
      await project.cleanup()
      await area.cleanup()
    }
  })

  it('upgradable：源版本更高 → 原子替换 outcome=updated + residue 空 + 新旧版本记录', async () => {
    const project = await tempGitProject()
    const area = await tempDir()
    try {
      const source = await tempDir()
      await writeSkillDir(source.path, 'skill', { version: '0.3.0', body: 'new content' })
      const targetRoot = path.join(area.path, 'skills')
      await writeSkillDir(targetRoot, 'skill', { version: '0.2.0', body: 'old content' })

      const result = await syncLocalDir({ sourcePath: path.join(source.path, 'skill'), targetRoot, name: 'skill' })
      expect(result.outcome).toBe('updated')
      expect(result.version).toBe('0.3.0')
      expect(result.previousVersion).toBe('0.2.0')
      expect(result.residue).toEqual([])
      // 落点已是源内容
      const deployed = await fsp.readFile(path.join(targetRoot, 'skill', 'SKILL.md'), 'utf8')
      expect(deployed).toContain('new content')
    } finally {
      await project.cleanup()
      await area.cleanup()
    }
  })

  it('change 5 形态：targetRoot=<临时 dataRoot>/agent/skills、name=review-daily-summary → 合法落点 + 白名单不被 https 禁令否决', async () => {
    const project = await tempGitProject()
    const dataRoot = await tempDir()
    try {
      const source = await tempDir()
      await writeSkillDir(source.path, 'src', { version: '1.0.0', fmName: 'review-daily-summary' })
      const targetRoot = path.join(dataRoot.path, 'agent', 'skills') // contracts §10 白名单区
      const result = await syncLocalDir({
        sourcePath: path.join(source.path, 'src'), targetRoot, name: 'review-daily-summary', projectRoot: project.path,
      })
      expect(result.outcome).toBe('installed')
      expect(result.skillPath).toBe(path.resolve(targetRoot, 'review-daily-summary', 'SKILL.md'))
      expect(result.baseline).toBeNull()
      expect(result.warnings.join('\n')).not.toContain('version-below-baseline')
      expect(result.warnings.join('\n')).not.toContain('FORBIDDEN')
    } finally {
      await project.cleanup()
      await dataRoot.cleanup()
    }
  })

  it('D-10 互斥复用：并发两次 upgradable 部署 → 恰好 1 个成功、另一 rejected', async () => {
    const project = await tempGitProject()
    const area = await tempDir()
    try {
      const source = await tempDir()
      await writeSkillDir(source.path, 'skill', { version: '0.3.0', body: 'new content' })
      const targetRoot = path.join(area.path, 'skills')
      await writeSkillDir(targetRoot, 'skill', { version: '0.1.0', body: 'old' })

      const [a, b] = await Promise.all([
        syncLocalDir({ sourcePath: path.join(source.path, 'skill'), targetRoot, name: 'skill' }),
        syncLocalDir({ sourcePath: path.join(source.path, 'skill'), targetRoot, name: 'skill' }),
      ])
      const outcomes = [a.outcome, b.outcome].sort()
      expect(outcomes).toEqual(['rejected', 'updated'])
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
      await area.cleanup()
    }
  })
})
