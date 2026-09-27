/**
 * tasks 2.1/2.2①②：根解析纯函数表驱动用例。
 */
import { describe, expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deriveRootFromInstallDir, resolveProjectRoot, resolveTargetRoot } from '../../src/skill/root.ts'
import { tempDir, tempGitProject } from './helpers/tmp.ts'
import { SkillInstallerError, SkillRootResolutionError } from '../../src/skill/errors.ts'

describe('resolveProjectRoot（tasks 2.1）', () => {
  it('无 .git 的项目根退化返回入参', async () => {
    const dir = await tempDir()
    try {
      expect(resolveProjectRoot(dir.path)).toBe(path.resolve(dir.path))
    } finally {
      await dir.cleanup()
    }
  })

  it('多级含 .git 时返回最近祖先（monorepo 子目录向上）', async () => {
    const project = await tempGitProject()
    try {
      const deep = path.join(project.path, 'packages', 'app', 'src')
      await mkdir(deep, { recursive: true })
      expect(resolveProjectRoot(deep)).toBe(path.resolve(project.path))
    } finally {
      await project.cleanup()
    }
  })

  it('嵌套仓库：取最近的 .git 祖先（内层仓库优先）', async () => {
    const outer = await tempGitProject()
    try {
      const innerRoot = path.join(outer.path, 'inner')
      await mkdir(path.join(innerRoot, '.git'), { recursive: true })
      const deep = path.join(innerRoot, 'packages', 'x')
      await mkdir(deep, { recursive: true })
      expect(resolveProjectRoot(deep)).toBe(path.resolve(innerRoot))
    } finally {
      await outer.cleanup()
    }
  })

  it('.git 为文件（worktree/submodule 形态）同样命中', async () => {
    const project = await tempDir()
    try {
      await writeFile(path.join(project.path, '.git'), 'gitdir: ../elsewhere/.git\n', 'utf8')
      expect(resolveProjectRoot(project.path)).toBe(path.resolve(project.path))
    } finally {
      await project.cleanup()
    }
  })
})

describe('deriveRootFromInstallDir（受限反推，N1）', () => {
  it('正当路径：绝对路径且祖先含 .git → 返回真实项目根', async () => {
    const project = await tempGitProject()
    try {
      const installDir = path.join(project.path, 'skills')
      expect(await deriveRootFromInstallDir(installDir, null)).toBe(path.resolve(project.path))
    } finally {
      await project.cleanup()
    }
  })

  it('正当路径：祖先与记录值一致（即使无 .git）→ 返回记录根', async () => {
    const plain = await tempDir() // 无 .git
    try {
      const installDir = path.join(plain.path, 'skills')
      expect(await deriveRootFromInstallDir(installDir, plain.path)).toBe(path.resolve(plain.path))
    } finally {
      await plain.cleanup()
    }
  })

  it('拒绝路径：<dshHome>/skills（绝对、祖先无 .git、无记录一致）→ null', async () => {
    const home = await tempDir()
    try {
      const installDir = path.join(home.path, 'skills')
      expect(await deriveRootFromInstallDir(installDir, null)).toBeNull()
      expect(await deriveRootFromInstallDir(installDir, 'C:\\unrelated\\repo')).toBeNull()
    } finally {
      await home.cleanup()
    }
  })

  it('相对路径 → 恒 null（无解析基）', async () => {
    expect(await deriveRootFromInstallDir('skills', null)).toBeNull()
    expect(await deriveRootFromInstallDir('.dsh/skills', 'C:\\proj')).toBeNull()
  })
})

describe('resolveTargetRoot（tasks 2.1：默认/相对/绝对 + D-13 可写目标校验）', () => {
  it('installDir 为空 → <projectRoot>/.dsh/skills（默认 rank 100）', () => {
    const result = resolveTargetRoot({ projectRoot: 'C:\\proj', installDir: '', kind: 'https-zip' })
    expect(result.targetRoot).toBe(path.resolve('C:\\proj\\.dsh\\skills'))
    expect(result.isDefault).toBe(true)
  })

  it('配置相对路径以 <projectRoot> 为基', () => {
    const result = resolveTargetRoot({ projectRoot: 'C:\\proj', installDir: 'custom-skills', kind: 'https-zip' })
    expect(result.targetRoot).toBe(path.resolve('C:\\proj\\custom-skills'))
  })

  it('https 源：绝对路径落在 dataRoot 内（非白名单区）→ 报错', () => {
    expect(() =>
      resolveTargetRoot({
        projectRoot: 'C:\\proj',
        installDir: 'C:\\vault-data\\DB\\daily',
        kind: 'https-zip',
        dataRoot: 'C:\\vault-data',
      }),
    ).toThrowError(SkillInstallerError)
  })

  it('https 源：白名单区豁免（<dataRoot>/agent/skills 等不触发禁令）', () => {
    expect(() =>
      resolveTargetRoot({
        projectRoot: 'C:\\proj',
        installDir: 'C:\\vault-data\\agent\\skills',
        kind: 'https-zip',
        dataRoot: 'C:\\vault-data',
      }),
    ).not.toThrow()
    expect(() =>
      resolveTargetRoot({
        projectRoot: 'C:\\proj',
        installDir: 'C:\\vault-data\\agent\\skills\\custom',
        kind: 'https-zip',
        dataRoot: 'C:\\vault-data',
      }),
    ).not.toThrow()
  })

  it('localDir 源：白名单落点合法（change 5 形态 <dataRoot>/agent/skills）', () => {
    const result = resolveTargetRoot({
      projectRoot: 'C:\\proj',
      installDir: 'C:\\vault-data\\agent\\skills',
      kind: 'local-dir',
      dataRoot: 'C:\\vault-data',
    })
    expect(result.targetRoot).toBe(path.resolve('C:\\vault-data\\agent\\skills'))
  })

  it('落在插件包自身目录内 → 报错（两源共同禁令）', () => {
    for (const kind of ['https-zip', 'local-dir'] as const) {
      expect(() =>
        resolveTargetRoot({
          projectRoot: 'C:\\proj',
          installDir: 'C:\\plugins\\dsh-trader-kit\\lib\\skills',
          kind,
          pluginRoot: 'C:\\plugins\\dsh-trader-kit',
        }),
      ).toThrowError(/插件包自身目录/)
    }
  })

  it('installDir 为空且无 projectRoot → SkillRootResolutionError（不猜）', () => {
    expect(() => resolveTargetRoot({ projectRoot: null, installDir: '', kind: 'https-zip' })).toThrowError(
      SkillRootResolutionError,
    )
  })
})
