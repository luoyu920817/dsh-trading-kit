/**
 * tasks 1.1：frontmatter 解析与版本三元组比对（表驱动）。
 */
import { describe, expect, it } from 'vitest'
import { compareVersions, extractSemVer, parseSkillFrontmatter } from '../../src/skill/version.ts'

describe('parseSkillFrontmatter（tasks 1.1）', () => {
  it('官方真实形态：1.2.0（2026-09-20）→ 提取 1.2.0（含全角括号日期）', () => {
    const text = '---\nname: 通达信TQ-Local\nversion: 1.2.0（2026-09-20）\ndescription: TdxQuant\n---\n\n# TQ\n'
    const parsed = parseSkillFrontmatter(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.versionRaw).toBe('1.2.0（2026-09-20）')
    expect(parsed.version?.raw).toBe('1.2.0')
    expect(parsed.versionUnparsable).toBe(false)
    // 官方 name 是展示标题（非 kebab-case）→ 记录形态，不视为解析失败（登记偏离）
    expect(parsed.name).toBe('通达信TQ-Local')
    expect(parsed.nameFormat).toBe('other')
  })

  it('纯语义化版本 1.2.0 → 解析成功且 nameFormat 按 kebab-case 识别', () => {
    const parsed = parseSkillFrontmatter('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.version?.raw).toBe('1.2.0')
    expect(parsed.nameFormat).toBe('kebab-case')
  })

  it('缺 version 键 → version null 但不判「不可解析」', () => {
    const parsed = parseSkillFrontmatter('---\nname: tdx-tq-local\n---\n')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.version).toBeNull()
    expect(parsed.versionRaw).toBeNull()
    expect(parsed.versionUnparsable).toBe(false)
  })

  it('version 不可解析（banana）→ versionUnparsable = true（宁可吵，不可假）', () => {
    const parsed = parseSkillFrontmatter('---\nname: tdx-tq-local\nversion: banana\n---\n')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.versionUnparsable).toBe(true)
    expect(parsed.version).toBeNull()
  })

  it('name 不合 kebab-case → ok 但 nameFormat=other（宿主形态与官方包现实冲突，见模块注释）', () => {
    const parsed = parseSkillFrontmatter('---\nname: My Skill!\n---\n')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.nameFormat).toBe('other')
  })

  it('frontmatter 截断（无闭合围栏）→ ok=false reason=truncated', () => {
    const parsed = parseSkillFrontmatter('---\nname: tdx-tq-local\nversion: 1.2.0\n')
    expect(parsed).toEqual({ ok: false, reason: 'truncated' })
  })

  it('无 frontmatter → ok=false reason=no-frontmatter；缺 name 键 → name-missing', () => {
    expect(parseSkillFrontmatter('# 没有围栏')).toEqual({ ok: false, reason: 'no-frontmatter' })
    expect(parseSkillFrontmatter('---\nversion: 1.2.0\n---\n')).toEqual({ ok: false, reason: 'name-missing' })
  })

  it('未知键静默忽略（F5）', () => {
    const parsed = parseSkillFrontmatter('---\nname: tdx-tq-local\nversion: 1.2.0\nunknown-key: whatever\n---\n')
    expect(parsed.ok).toBe(true)
  })
})

describe('compareVersions（tasks 1.1）', () => {
  it.each([
    ['1.10.0', '1.9.9', 1],
    ['1.2.0', '1.2.0', 0],
    ['1.2.0', '1.2.1', -1],
    ['2.0.0', '1.99.99', 1],
    ['1.0.0', '1.0.10', -1],
  ] as const)('compareVersions(%s, %s) === %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })

  it('带日期后缀的官方版本可直接比较', () => {
    expect(compareVersions('1.2.0（2026-09-20）', '1.2.0')).toBe(0)
  })

  it('不可解析输入 → 显式报错（不猜）', () => {
    expect(() => compareVersions('banana', '1.0.0')).toThrowError(/不可解析/)
  })

  it('extractSemVer：纯提取', () => {
    expect(extractSemVer('v1.2.3')?.raw).toBe('1.2.3')
    expect(extractSemVer('nothing')).toBeNull()
  })
})
