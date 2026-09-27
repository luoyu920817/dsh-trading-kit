/**
 * tasks 2.4：gitignore-notice（三种 fixture：无 .gitignore / 已忽略 / 未忽略）。
 */
import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { checkTargetIgnored } from '../../src/skill/gitignore-notice.ts'
import { tempDir } from './helpers/tmp.ts'

describe('checkTargetIgnored（tasks 2.4）', () => {
  it('无 .gitignore → ignored=false、gitignorePresent=false、无提示', async () => {
    const project = await tempDir()
    await fsp.mkdir(path.join(project.path, '.git'), { recursive: true })
    try {
      const result = await checkTargetIgnored(path.join(project.path, '.dsh', 'skills'))
      expect(result.isGitRepo).toBe(true)
      expect(result.gitignorePresent).toBe(false)
      expect(result.ignored).toBe(false)
      expect(result.hint).toBeNull()
    } finally {
      await project.cleanup()
    }
  })

  it('已忽略（.dsh/skills/ 粒度）→ ignored=true、无提示；MUST NOT 代改文件', async () => {
    const project = await tempDir()
    await fsp.mkdir(path.join(project.path, '.git'), { recursive: true })
    const gitignorePath = path.join(project.path, '.gitignore')
    await fsp.writeFile(gitignorePath, 'node_modules/\n.dsh/skills/\n.dsh/.dsh-trader-kit-tmp/\n', 'utf8')
    const before = await fsp.readFile(gitignorePath, 'utf8')
    try {
      const result = await checkTargetIgnored(path.join(project.path, '.dsh', 'skills'))
      expect(result.ignored).toBe(true)
      expect(result.hint).toBeNull()
      // 不代改：.gitignore 字节不变
      expect(await fsp.readFile(gitignorePath, 'utf8')).toBe(before)
    } finally {
      await project.cleanup()
    }
  })

  it('未忽略 → hint 含建议忽略的路径（不代改）', async () => {
    const project = await tempDir()
    await fsp.mkdir(path.join(project.path, '.git'), { recursive: true })
    await fsp.writeFile(path.join(project.path, '.gitignore'), 'node_modules/\n', 'utf8')
    try {
      const result = await checkTargetIgnored(path.join(project.path, '.dsh', 'skills'))
      expect(result.ignored).toBe(false)
      expect(result.hint).toContain('.dsh/skills/')
      expect(result.hint).toContain('不代改')
    } finally {
      await project.cleanup()
    }
  })

  it('非 git 仓库 → 无提示（isGitRepo=false）', async () => {
    const dir = await tempDir()
    try {
      const result = await checkTargetIgnored(path.join(dir.path, '.dsh', 'skills'))
      expect(result.isGitRepo).toBe(false)
      expect(result.hint).toBeNull()
    } finally {
      await dir.cleanup()
    }
  })

  it('git 语义：`!` 反选与整目录忽略（.dsh/）', async () => {
    const project = await tempDir()
    await fsp.mkdir(path.join(project.path, '.git'), { recursive: true })
    await fsp.writeFile(path.join(project.path, '.gitignore'), '.dsh/\n!.dsh/skills/\n', 'utf8')
    try {
      const ignoredDir = await checkTargetIgnored(path.join(project.path, '.dsh', '.other'))
      expect(ignoredDir.ignored).toBe(true)
      const negated = await checkTargetIgnored(path.join(project.path, '.dsh', 'skills'))
      expect(negated.ignored).toBe(false)
    } finally {
      await project.cleanup()
    }
  })
})
