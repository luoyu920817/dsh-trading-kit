/**
 * change 5 tasks 1.2/1.4：部署三态（经 change 3 的 syncLocalDir 具名能力）与
 * 可发现性核对（复用 checkDiscovery / findShadowedCandidates，cwd 必传）。
 * 零 mock：真实仓库 skill 源 + 真实临时目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { syncLocalDir } from '../../src/skill/local-source.ts'
import { checkDiscovery } from '../../src/skill/discovery.ts'
import { findShadowedCandidates } from '../../src/skill/shadowing.ts'

const REPO_SKILL = join(import.meta.dirname, '..', '..', 'skills', 'review-daily-summary')
const NAME = 'review-daily-summary'

function tempRoot(prefix = 'dtk-deploy-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

describe('部署三态（tasks 1.2：经 syncLocalDir，MUST NOT 自建覆盖逻辑）', () => {
  it('首次部署 → installed，skillPath = <dataRoot>/agent/skills/review-daily-summary/SKILL.md', async () => {
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    const r = await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    expect(r.outcome).toBe('installed')
    expect(r.skillPath).toBe(join(targetRoot, NAME, 'SKILL.md'))
    expect(existsSync(r.skillPath)).toBe(true)
    // 版本载体 = SKILL.md frontmatter 的 version（与仓库源一致）。
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('in-sync：同源重跑零写入（mtimeMs 不变）', async () => {
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    const skillPath = join(targetRoot, NAME, 'SKILL.md')
    const before = statSync(skillPath).mtimeMs
    const r2 = await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    expect(r2.outcome).toBe('in-sync')
    expect(statSync(skillPath).mtimeMs).toBe(before)
  })

  it('user-modified：目标被用户改过 → 不覆盖 + diff 非空（AI 出草案人做判断）', async () => {
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    const skillPath = join(targetRoot, NAME, 'SKILL.md')
    const userBytes = readFileSync(skillPath, 'utf8') + '\n<!-- 用户手工修订 -->\n'
    writeFileSync(skillPath, userBytes, 'utf8')
    const r3 = await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    expect(r3.outcome).toBe('user-modified')
    expect(readFileSync(skillPath, 'utf8')).toBe(userBytes) // 目标字节不变
    expect((r3.diff ?? []).length).toBeGreaterThan(0) // diff 非空
  })

  it('upgradable：源版本升级 → 原子替换为新内容 + 新版本，无残留临时/备份目录', async () => {
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    // 造一个旧版本源，部署后升级源内容再部署。
    const oldSource = tempRoot('dtk-oldsrc-')
    mkdirSync(join(oldSource, NAME), { recursive: true })
    writeFileSync(join(oldSource, NAME, 'SKILL.md'),
      '---\nname: review-daily-summary\ndescription: 旧版本\nversion: 0.9.0\n---\n\n# 旧\n', 'utf8')
    await syncLocalDir({ sourcePath: join(oldSource, NAME), targetRoot, name: NAME })
    const skillPath = join(targetRoot, NAME, 'SKILL.md')
    expect(readFileSync(skillPath, 'utf8')).toContain('0.9.0')

    const r = await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    // 三态判定中的 upgradable 态经替换落地后结果枚举为 updated（LocalDeployOutcome）。
    expect(r.outcome).toBe('updated')
    expect(readFileSync(skillPath, 'utf8')).not.toContain('0.9.0')
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/)
    // 零残留：目标目录内无 .dsh-trader-kit-tmp / backup / stage 目录。
    const listing = existsSync(targetRoot) ? readdirSync(targetRoot) : []
    expect(listing.filter((n) => n.includes('dsh-trader-kit-tmp') || n.startsWith('.*backup') || n.startsWith('.*stage'))).toEqual([])
  })
})

describe('可发现性核对（tasks 1.4：复用 change 3 具名导出，cwd 必传）', () => {
  it('命中且路径一致：customSkillDirs 含 <数据根>/agent/skills 时解析路径 == 数据根落点', async () => {
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    const projectRoot = tempRoot('dtk-proj-')
    mkdirSync(join(projectRoot, '.git'), { recursive: true })
    const r = await checkDiscovery({
      projectRoot,
      targetRoot,
      name: NAME,
      skills: undefined, // 宿主服务不可用 → filesystem-only 退化（精度限制标注）
    })
    expect(r.mode).toBe('filesystem-only')
    expect(r.found).toBe(true)
    expect(r.winner?.path.replaceAll('\\', '/')).toContain('agent/skills/review-daily-summary/SKILL.md')
  })

  it('遮蔽：候选根存在同名低 rank 副本 → 警告含路径+rank+版本', async () => {
    const projectRoot = tempRoot('dtk-proj2-')
    mkdirSync(join(projectRoot, '.git'), { recursive: true })
    mkdirSync(join(projectRoot, '.dsh', 'skills', NAME), { recursive: true })
    writeFileSync(join(projectRoot, '.dsh', 'skills', NAME, 'SKILL.md'),
      '---\nname: review-daily-summary\nversion: 0.8.0\n---\n', 'utf8')
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    const shadowed = findShadowedCandidates({
      roots: [
        { path: join(projectRoot, '.dsh', 'skills'), rank: 100 },
        { path: targetRoot, rank: 300 },
      ],
      name: NAME,
      excludePath: join(targetRoot, NAME, 'SKILL.md'), // 本落点自身不算遮蔽自己
    })
    expect(shadowed.length).toBeGreaterThan(0)
    expect(shadowed[0]).toMatchObject({ name: NAME, rank: 100 })
    expect(shadowed[0].path).toContain('.dsh')
  })

  it('cwd 必传：不传 cwd 的调用被拒（对照断言——不传则宿主不扫 rank 100，核对无意义）', async () => {
    const dataRoot = tempRoot()
    const targetRoot = join(dataRoot, 'agent', 'skills')
    await syncLocalDir({ sourcePath: REPO_SKILL, targetRoot, name: NAME })
    // checkDiscovery 无 cwd 参数（其内部以 projectRoot 为扫描基）——此处验证服务形态：
    // service 出口 status({cwd?}) 在 cwd 缺失且 installDir 为空时显式拒绝（不猜）。
    const { buildSkillStatus } = await import('../../src/skill/status.ts')
    await expect(buildSkillStatus({ installDir: '' })).rejects.toThrow(/cwd|显式/)
  })
})
