/**
 * change 3 4.x 组装测试（tasks 4.1②/4.2/4.3/4.5）：
 * Config.skill 段校验 / tq_skill_manage 分派 / service 出口 / uninstall 幂等。
 * 零 mock：真实临时目录 + 真实对象桩 facades（记录调用）。
 */
import { existsSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  resolveTraderKitConfig,
} from '../../src/config.ts'
import {
  createTqSkillManageTool,
  defaultTqSkillFacades,
  runTqSkillManage,
  type TqSkillFacades,
} from '../../src/skill/index.ts'
import { uninstallSkill } from '../../src/skill/uninstall.ts'
import { metaPathFor } from '../../src/skill/state.ts'
import type { ResolvedTraderKitConfig } from '../../src/config.ts'

describe('Config.skill 段（tasks 4.1）', () => {
  it('默认值填充：官方源 URL、installDir 空串（缺省 <projectRoot>/.dsh/skills）、基线 1.2.0、autoCheck 开', () => {
    const c = resolveTraderKitConfig()
    expect(c.skill.sourceUrl).toMatch(/^https:\/\//)
    expect(c.skill.installDir).toBe('')
    expect(c.skill.minVersion).toBe('1.2.0')
    expect(c.skill.autoCheck).toBe(true)
    expect(c.skill.checkIntervalHours).toBe(24)
    expect(c.skill.extraSkillRoots).toEqual([])
    expect(c.skill.limits.maxEntries).toBeGreaterThan(0)
    // append-only 核验：既有 dataRoot 默认值仍为空串（change 2 交付时逐字符一致）。
    expect(c.dataRoot).toBe('')
  })

  it('sourceUrl 非 https → 拒绝', () => {
    expect(() => resolveTraderKitConfig({ skill: { sourceUrl: 'http://example.com/x.zip' } })).toThrow(/https/)
  })

  it('installDir 落点禁令：dataRoot 非白名单区拒绝；<dataRoot>/agent/skills 白名单区合法', () => {
    const dataRoot = process.platform === 'win32' ? 'D:\\dt-vault' : '/tmp/dt-vault'
    const banned = join(dataRoot, 'DB', 'staging')
    const allowed = join(dataRoot, 'agent', 'skills')
    expect(() => resolveTraderKitConfig({ dataRoot, skill: { installDir: banned } }))
      .toThrow(/白名单|installDir/)
    // 白名单区（localDir 源落点）不被 https 落点禁令否决。
    expect(resolveTraderKitConfig({ dataRoot, skill: { installDir: allowed } }).skill.installDir).toBe(allowed)
    // 默认组合（installDir=''）永远不报错（反向控制）。
    expect(() => resolveTraderKitConfig({ dataRoot })).not.toThrow()
  })

  it('dataRoot 未配置时跳过落点禁令（挂载可用，静态可判项缺失）', () => {
    expect(() => resolveTraderKitConfig({ skill: { installDir: 'X:\\any' } })).not.toThrow()
  })
})

describe('tq_skill_manage 分派（tasks 4.2）', () => {
  function makeConfig(root: string): ResolvedTraderKitConfig {
    // installDir 放在 dataRoot 之外（https 源落点禁入数据根非白名单区——4.1② 被测行为）。
    const installDir = join(root, '..', 'dtk-skill-home-' + root.slice(-6))
    return resolveTraderKitConfig({ dataRoot: root, skill: { installDir } })
  }

  it('非法 action 拒绝', async () => {
    const facades = defaultTqSkillFacades()
    await expect(runTqSkillManage(facades, makeConfig(makeTempRootSync()), { action: 'reinstall' as never }))
      .rejects.toThrow(/action/)
  })

  it('deploy 缺 targetRoot/name → 显式拒绝并提示', async () => {
    const facades = defaultTqSkillFacades()
    await expect(runTqSkillManage(facades, makeConfig(makeTempRootSync()), { action: 'deploy', sourcePath: '.' }))
      .rejects.toThrow(/deploy/)
  })

  it('工具定义：name/入参/输出渲染（outcome/version/path/warnings 必在）', () => {
    const tool = createTqSkillManageTool(defaultTqSkillFacades(), resolveTraderKitConfig())
    expect(tool.name).toBe('tq_skill_manage')
    const keys = Object.keys((tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters.properties ?? {})
    expect(keys).toEqual(expect.arrayContaining(['action', 'force', 'cwd', 'purge', 'sourcePath', 'targetRoot', 'name']))
    const serialized = JSON.stringify(tool.output ?? {}).toLowerCase()
    expect(serialized).not.toContain('refresh')
  })

  it('status action：真实 buildSkillStatus（cwd 可解析）→ 结论含 state；降级面（不可解析）→ missing + 指引', async () => {
    const root = makeTempRootSync()
    const facades = defaultTqSkillFacades()
    // 可解析：cwd 指向真实目录（installDir 为空 → 默认 <projectRoot>/.dsh/skills）。
    const configDefault = resolveTraderKitConfig({ skill: { installDir: '' } })
    const okView = await runTqSkillManage(facades, configDefault, { action: 'status', cwd: root })
    expect(okView.action).toBe('status')
    expect(typeof okView.outcome).toBe('string')
    expect(okView.outcome.length).toBeGreaterThan(0)
    // 不可解析：绝对 installDir 无 .git 祖先 → status 出口降级为 missing + 配置指引（不抛出）。
    const configAbs = makeConfig(root)
    const degraded = await runTqSkillManage(facades, configAbs, { action: 'status' })
    expect(degraded.outcome).toBe('missing')
    expect(degraded.warnings.join('\n')).toContain('配置 skill.installDir')
  })
})

describe('uninstallSkill（tasks 4.5）', () => {
  it('卸载后落点不存在；二次 uninstall → nothing-to-do（不报错）', async () => {
    const root = makeTempRootSync()
    const targetRoot = join(root, 'skills-home')
    const skillDir = join(targetRoot, 'tdx-tq-local')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: tdx-tq-local\nversion: 1.2.0\n---\n# tdx', 'utf8')
    const r1 = await uninstallSkill({ targetRoot, name: 'tdx-tq-local' })
    expect(r1.outcome).toBe('uninstalled')
    expect(existsSync(skillDir)).toBe(false)
    const r2 = await uninstallSkill({ targetRoot, name: 'tdx-tq-local', purge: true })
    expect(r2.outcome).toBe('nothing-to-do')
  })

  it('purge:false 保留 meta.json；purge:true 删除', async () => {
    const root = makeTempRootSync()
    const targetRoot = join(root, 'skills-home')
    const skillDir = join(targetRoot, 'tdx-tq-local')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), 'x', 'utf8')
    const metaPath = metaPathFor(targetRoot, 'tdx-tq-local')
    mkdirSync(join(metaPath, '..'), { recursive: true })
    writeFileSync(metaPath, JSON.stringify({ version: '1.2.0' }), 'utf8')
    await uninstallSkill({ targetRoot, name: 'tdx-tq-local', purge: false })
    expect(existsSync(metaPath)).toBe(true)
    await uninstallSkill({ targetRoot, name: 'tdx-tq-local', purge: true })
    expect(existsSync(metaPath)).toBe(false)
  })

  it('历史残留（run-* 目录，mtime 陈旧）一并清理并记入 residue；新鲜 run 目录受 10 分钟保护', async () => {
    const root = makeTempRootSync()
    const targetRoot = join(root, 'skills-home')
    const staleDir = join(targetRoot, '..', '.dsh-trader-kit-tmp', 'run-stale')
    const freshDir = join(targetRoot, '..', '.dsh-trader-kit-tmp', 'run-fresh')
    mkdirSync(staleDir, { recursive: true })
    mkdirSync(freshDir, { recursive: true })
    writeFileSync(join(staleDir, 'partial.zip'), 'zzz', 'utf8')
    // 把 stale 目录 mtime 拨到 11 分钟前（越过 10 分钟保护窗口）。
    const old = new Date(Date.now() - 60 * 60 * 1000)
    const { utimesSync } = await import('node:fs')
    utimesSync(staleDir, old, old)
    const r = await uninstallSkill({ targetRoot, name: 'tdx-tq-local', purge: true })
    // nothing-to-do（无落点无 meta）但陈旧残留清理仍执行；新鲜目录保留（在途安装保护）。
    expect(existsSync(staleDir)).toBe(false)
    expect(existsSync(freshDir)).toBe(true)
    expect(r.residue.some((p) => p.includes('run-stale'))).toBe(true)
  })
})

function makeTempRootSync(): string {
  return mkdtempSync(join(tmpdir(), 'dtk-skill-asm-'))
}

