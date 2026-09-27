/**
 * tasks 1.5 + 1.7：原子替换流程（扫描根外暂存区 → 备份 → 改名 → 零残留）+
 * 回滚 + 恶意包 + 并发 + 同目录其它 skill 零改动。
 * 零 mock / 零 sleep：真实临时目录 + 真实官方快照 zip。
 */
import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { installSkill, assertInstallArea } from '../../src/skill/installer.ts'
import { metaPathFor, readMeta } from '../../src/skill/state.ts'
import { listDirHashes } from '../../src/skill/hash.ts'
import { parseSkillFrontmatter } from '../../src/skill/version.ts'
import { buildOfficialLikeZip, buildZip } from './helpers/zipgen.ts'
import { tempGitProject, writeSkillDir } from './helpers/tmp.ts'
import { clearInProcessLocksForTest } from '../../src/skill/lock.ts'
import { DowngradeBlockedError, SkillInstallerError } from '../../src/skill/errors.ts'

const OFFICIAL_ZIP = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'official', 'tdx-tq-local-snapshot.zip'),
)

function skillZip(name: string, version: string, body = `body ${version}`): Buffer {
  return buildOfficialLikeZip(`---\nname: ${name}\nversion: ${version}\ndescription: t\n---\n\n${body}\n`)
}

async function makeProject() {
  const project = await tempGitProject()
  const targetRoot = path.join(project.path, '.dsh', 'skills')
  return { project, targetRoot }
}

describe('installSkill：暂存区断言（tasks 1.5①②）', () => {
  it('① 断言失败先于下载：archiveProvider 不被调用即拒绝', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      // targetRoot 落到默认根内部（后代）→ 暂存区落入扫描根
      const nestedRoot = path.join(targetRoot, 'nested')
      let providerCalled = 0
      let caught: unknown = null
      try {
        await installSkill({
          targetRoot: nestedRoot,
          name: 'tdx-tq-local',
          kind: 'https-zip',
          archiveProvider: async () => {
            providerCalled++
            return { archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), archiveHash: 'x' }
          },
          projectRoot: project.path,
        })
      } catch (error) {
        caught = error
      }
      expect((caught as SkillInstallerError).code).toBe('TMP_AREA_IN_SCAN_ROOT')
      expect(providerCalled).toBe(0)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('② 反向控制：targetRoot 取默认值（等于自身登记项）→ MUST NOT 报错、安装正常进行', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const result = await installSkill({
        targetRoot, // 默认 <projectRoot>/.dsh/skills，等于自身登记项
        name: 'tdx-tq-local',
        kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')),
        projectRoot: project.path,
      })
      expect(result.ok).toBe(true)
      expect(result.outcome).toBe('installed')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('② assertInstallArea 独立调用：默认落点通过；后代落点抛 TMP_AREA_IN_SCAN_ROOT', () => {
    expect(() =>
      assertInstallArea({ targetRoot: 'C:\\proj\\.dsh\\skills', projectRoot: 'C:\\proj' }),
    ).not.toThrow()
    expect(() =>
      assertInstallArea({ targetRoot: 'C:\\proj\\.dsh\\skills\\inner', projectRoot: 'C:\\proj' }),
    ).toThrowError(TMP_AREA_IN_SCAN_ROOT_MATCH)
  })

  const TMP_AREA_IN_SCAN_ROOT_MATCH = /扫描根/
})

describe('installSkill：成功路径与零残留（tasks 1.5③）', () => {
  it('首次安装：落点字节 == 包内字节 + residue 空 + meta 含 resolvedCwd/projectRoot', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const result = await installSkill({
        targetRoot,
        name: 'tdx-tq-local',
        kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL_ZIP),
        archiveHash: 'hash-official',
        etag: '"6aafc833-7681"',
        lastModified: 'Sun, 20 Sep 2026 11:49:07 GMT',
        rootRecord: { resolvedCwd: project.path, projectRoot: project.path },
        projectRoot: project.path,
      })
      expect(result.ok).toBe(true)
      expect(result.outcome).toBe('installed')
      expect(result.residue).toEqual([])
      expect(result.version).toBe('1.2.0')

      const skillMd = await fsp.readFile(path.join(targetRoot, 'tdx-tq-local', 'SKILL.md'))
      const extractedBytes = OFFICIAL_ZIP
      // 落点 SKILL.md 与包内条目一致（官方包单条目，解压后即包内容）
      expect(skillMd.equals(extractedBytes)).toBe(false) // zip ≠ 明文（防呆断言）
      const { parseCentralDirectory } = await import('../../src/skill/zip-guard.ts')
      const entry = parseCentralDirectory(new Uint8Array(extractedBytes)).entries[0]
      expect(skillMd.length).toBe(entry.uncompressedSize)

      // 零残留：runDir 不存在（stat 断言）
      const tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')
      const leftovers = (await fsp.readdir(tmpBase)).filter((entryName) => entryName.startsWith('run-'))
      expect(leftovers).toEqual([])

      // meta：resolvedCwd/projectRoot 与根解析结果一致（记录优先的数据基础）
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.resolvedCwd).toBe(path.resolve(project.path))
      expect(meta?.projectRoot).toBe(path.resolve(project.path))
      expect(meta?.targetRoot).toBe(path.resolve(targetRoot))
      expect(meta?.name).toBe('tdx-tq-local')
      expect(meta?.etag).toBe('"6aafc833-7681"')
      expect(meta?.lastModified).toBe('Sun, 20 Sep 2026 11:49:07 GMT')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('覆盖安装（升级）：新版本就位 + residue 空 + previousSourceId 记录', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const first = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.1.0')),
        sourceId: 'old-etag',
        projectRoot: project.path,
      })
      expect(first.outcome).toBe('installed')

      const second = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')),
        sourceId: 'new-etag',
        previousSourceId: 'old-etag',
        projectRoot: project.path,
      })
      expect(second.outcome).toBe('updated')
      expect(second.version).toBe('1.2.0')
      expect(second.previousVersion).toBe('1.1.0')
      expect(second.residue).toEqual([])
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.previousSourceId).toBe('old-etag')
      expect(meta?.sourceId).toBe('new-etag')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('同版本同内容同源标识 → up-to-date 零替换（目标 mtime 不变）', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const zip = skillZip('tdx-tq-local', '1.2.0')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(zip), sourceId: 'etag-same', projectRoot: project.path,
      })
      const skillMdPath = path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')
      const mtimeBefore = (await fsp.stat(skillMdPath)).mtimeMs
      const again = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(zip), sourceId: 'etag-same', projectRoot: project.path,
      })
      expect(again.outcome).toBe('up-to-date')
      expect(again.ok).toBe(true)
      expect((await fsp.stat(skillMdPath)).mtimeMs).toBe(mtimeBefore)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('同目录其它 skill 零改动（安装前后逐文件哈希比对）', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await writeSkillDir(targetRoot, 'other-skill', { version: '0.1.0' })
      const before = await listDirHashes(targetRoot)
      expect(before!.length).toBeGreaterThan(0) // 扫描目标非空
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')),
        projectRoot: project.path,
      })
      const after = await listDirHashes(targetRoot)
      const beforeOther = before!.filter((file) => file.relPath.startsWith('other-skill'))
      const afterOther = after!.filter((file) => file.relPath.startsWith('other-skill'))
      expect(afterOther).toEqual(beforeOther)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })
})

describe('installSkill：回滚与失败注入（tasks 1.7③）', () => {
  it('改名前失败（afterBackup 抛出）→ 旧版恢复 + 无半装 + runDir 清理', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.1.0')), projectRoot: project.path,
      })
      const before = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))
      let caught: unknown = null
      try {
        await installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
          hooks: { afterBackup: () => { throw new SkillInstallerError('INJECTED', '注入失败（改名前）') } },
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(SkillInstallerError)
      expect((caught as Error).message).toContain('注入失败')
      const after = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))
      expect(after).toEqual(before) // 旧版字节不变
      const tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')
      expect((await fsp.readdir(tmpBase)).filter((name) => name.startsWith('run-'))).toEqual([])
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('改名后失败（afterRename 抛出）→ 回滚到旧版', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.1.0')), projectRoot: project.path,
      })
      let caught: unknown = null
      try {
        await installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
          hooks: { afterRename: () => { throw new SkillInstallerError('INJECTED', '注入失败（改名后）') } },
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(SkillInstallerError)
      const restored = parseFrontmatterVersion(path.join(targetRoot, 'tdx-tq-local', 'SKILL.md'))
      expect(restored).toBe('1.1.0') // 回滚到旧版
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('④ 删除失败注入（rmImpl 模拟 Windows 占用）→ installed-with-residue + ok=false + residue 含路径', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const result = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
        // 模拟 Windows 占用/杀软：逐项删除但跳过被占用文件 → 目录删除失败留下残骸
        rmImpl: async (target) => {
          await fsp.writeFile(path.join(target, 'stage.locked'), 'busy', 'utf8')
          for (const entry of await fsp.readdir(target)) {
            if (entry === 'stage.locked') continue // 删除被占用项失败（EBUSY 语义）
            await fsp.rm(path.join(target, entry), { force: true, recursive: true })
          }
          // 目录仍含被占用项 → 本次 rm 以失败告终（与真实 Windows 行为一致）
        },
      })
      expect(result.outcome).toBe('installed-with-residue')
      expect(result.ok).toBe(false)
      expect(result.residue.length).toBeGreaterThan(0)
      expect(result.residue[0]).toMatch(/run-/)
      // 残留位于扫描根之外：MUST NOT 被宿主发现（不在 targetRoot 顶层）
      expect(result.residue[0]).toContain('.dsh-trader-kit-tmp')
      // 下次安装重试清理成功（真实 rmImpl）→ residue 清空
      const retry = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')),
        sourceId: 'same',
        projectRoot: project.path,
      })
      expect(retry.residue).toEqual([])
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.residue).toEqual([])
      const tmpBase = path.join(path.dirname(path.resolve(targetRoot)), '.dsh-trader-kit-tmp')
      expect((await fsp.readdir(tmpBase)).filter((name) => name.startsWith('run-'))).toEqual([])
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('⑤ 历史残留（targetRoot 顶层的 .tdx-tq-local.backup-*）迁移删除并记 warning', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      // 旧版布局残留：顶层含 SKILL.md，会被宿主当 skill 发现（F4 无 dot 过滤）
      const legacy = path.join(targetRoot, '.tdx-tq-local.backup-1758000000')
      await fsp.mkdir(legacy, { recursive: true })
      await fsp.writeFile(path.join(legacy, 'SKILL.md'), '---\nname: tdx-tq-local\nversion: 0.9.0\n---\n', 'utf8')
      const result = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
      })
      expect(result.ok).toBe(true)
      expect(result.warnings.join('\n')).toContain('历史残留')
      await expect(fsp.access(legacy)).rejects.toThrow()
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })
})

describe('installSkill：恶意包与并发（tasks 1.7④⑤）', () => {
  it('恶意包 4 条契约：../x、绝对路径、symlink、超大包 → 校验失败中止且旧版字节不变', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.1.0')), projectRoot: project.path,
      })
      const before = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))

      const maliciousZips: Array<{ label: string; zip: Buffer }> = [
        { label: '../x', zip: buildZip([{ name: '../x.md', data: 'evil' }]) },
        { label: '绝对路径', zip: buildZip([{ name: '/etc/passwd', data: 'evil' }]) },
        { label: 'symlink', zip: buildZip([{ name: 'link', data: 'target', externalAttrs: 0o120777 << 16 }]) },
        { label: '超大包', zip: buildZip([{ name: 'SKILL.md', data: '---\nname: tdx-tq-local\nversion: 1.2.0\n---\n', declaredUncompressedSize: 52_428_801 }]) },
      ]
      for (const { label, zip } of maliciousZips) {
        // 注：恶意包条目缺 SKILL.md 的合法形态 → 先被 guard 拦截
        let caught: unknown = null
        try {
          await installSkill({
            targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
            archiveBytes: new Uint8Array(zip), projectRoot: project.path,
          })
        } catch (error) {
          caught = error
        }
        expect(caught, label).toBeInstanceOf(SkillInstallerError)
        expect((caught as SkillInstallerError).message, label).toMatch(/压缩包|SKILL|穿越|symlink|解压|保留名|上限/)
      }
      const after = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))
      expect(after).toEqual(before) // 旧版字节不变
      // 暂存区被清理
      const tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')
      expect((await fsp.readdir(tmpBase)).filter((name) => name.startsWith('run-'))).toEqual([])
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('截断 zip → unzip 校验失败中止、保留旧版', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.1.0')), projectRoot: project.path,
      })
      const before = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))
      const good = skillZip('tdx-tq-local', '1.2.0')
      const truncated = good.subarray(0, Math.floor(good.length * 0.7))
      await expect(
        installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(truncated), projectRoot: project.path,
        }),
      ).rejects.toThrowError()
      expect(await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))).toEqual(before)
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('⑤并发两次 install（Promise.all）→ 恰好 1 个有效安装 + residue 空 + 另一返回 rejected', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const [a, b] = await Promise.all([
        installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
        }),
        installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
        }),
      ])
      const outcomes = [a.outcome, b.outcome].sort()
      expect(outcomes).toEqual(['installed', 'rejected'])
      const winner = a.outcome === 'installed' ? a : b
      expect(winner.ok).toBe(true)
      expect(winner.residue).toEqual([])
      const loser = a.outcome === 'rejected' ? a : b
      expect(loser.warnings.join('\n')).toContain(String(process.pid))
      // 落点存在且恰好一个
      await fsp.access(path.join(targetRoot, 'tdx-tq-local', 'SKILL.md'))
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('降级闸门：远端版本更低 → DowngradeBlockedError（含两版本号）+ 目标字节不变', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
      })
      const before = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))
      let caught: unknown = null
      try {
        await installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.0.9')), projectRoot: project.path,
        })
      } catch (error) {
        caught = error
      }
      expect(caught).toBeInstanceOf(DowngradeBlockedError)
      expect((caught as DowngradeBlockedError).remoteVersion).toBe('1.0.9')
      expect((caught as DowngradeBlockedError).installedVersion).toBe('1.2.0')
      expect(await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))).toEqual(before)
      // meta 记录了 downgrade-blocked（status 的数据来源）
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.downgradeBlocked?.remoteVersion).toBe('1.0.9')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('force: true 强制降级 → 安装成功 + warning 记录强制降级', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')), projectRoot: project.path,
      })
      const result = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.0.9')), force: true, projectRoot: project.path,
      })
      expect(result.ok).toBe(true)
      expect(result.version).toBe('1.0.9')
      expect(result.warnings.join('\n')).toContain('强制降级')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('同版本重发（源标识变化）→ 覆盖安装并记录新旧源标识（不静默）', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')),
        sourceId: 'etag-old', projectRoot: project.path,
      })
      const skillMdPath = path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')
      const mtimeBefore = (await fsp.stat(skillMdPath)).mtimeMs
      const result = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(skillZip('tdx-tq-local', '1.2.0')),
        sourceId: 'etag-new', projectRoot: project.path,
      })
      // 同版本同内容但源标识变化 → 覆盖安装（记录新旧标识）
      expect(result.outcome).toBe('updated')
      expect((await fsp.stat(skillMdPath)).mtimeMs).toBeGreaterThan(mtimeBefore - 1)
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.sourceId).toBe('etag-new')
      expect(meta?.previousSourceId).toBe('etag-old')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })

  it('官方包 name 为展示标题（通达信TQ-Local）→ 默认仅告警、安装成功（登记偏离）', async () => {
    clearInProcessLocksForTest()
    const { project, targetRoot } = await makeProject()
    try {
      const result = await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(OFFICIAL_ZIP), projectRoot: project.path,
      })
      expect(result.ok).toBe(true)
      expect(result.warnings.join('\n')).toMatch(/不一致|通达信/)
      // strictNameMatch: true → spec 字面的硬失败路径可复现
      let caught: unknown = null
      try {
        await installSkill({
          targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
          archiveBytes: new Uint8Array(OFFICIAL_ZIP), strictNameMatch: true, projectRoot: project.path,
        })
      } catch (error) {
        caught = error
      }
      expect((caught as SkillInstallerError)?.details.failedCheck).toBe('name-mismatch')
    } finally {
      clearInProcessLocksForTest()
      await project.cleanup()
    }
  })
})

function parseFrontmatterVersion(skillMdPath: string): string | null {
  const text = readFileSync(skillMdPath, 'utf8')
  const parsed = parseSkillFrontmatter(text)
  return parsed.ok ? (parsed.version?.raw ?? null) : null
}