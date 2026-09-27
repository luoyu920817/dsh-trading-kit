/**
 * tasks 1.6：meta.json 记录 + 「以文件系统为准」的状态装配（验收四条）。
 */
import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  emptyMeta,
  metaPathFor,
  readFsSkillState,
  readMeta,
  reconcileFsAndMeta,
  writeMeta,
  type SkillMeta,
} from '../../src/skill/state.ts'
import { tempDir, writeSkillDir } from './helpers/tmp.ts'
import { sha256File } from '../../src/skill/hash.ts'

async function fixtureState(targetRoot: string, name: string, meta: SkillMeta | null, metaCorrupt = false) {
  const fsState = await readFsSkillState(targetRoot, name)
  return { fsState, reconciled: reconcileFsAndMeta(fsState, meta, metaCorrupt) }
}

describe('state.ts：文件系统 × meta 调解（tasks 1.6）', () => {
  it('① meta.json 存在但落点被删 → missing + warning 含「残留 meta.json」', async () => {
    const dir = await tempDir()
    try {
      const meta = emptyMeta()
      meta.version = '1.2.0'
      meta.contentHash = 'deadbeef'
      const reconciled = await fixtureState(dir.path, 'tdx-tq-local', meta)
      expect(reconciled.reconciled.state).toBe('missing')
      expect(reconciled.reconciled.installed).toBe(false)
      expect(reconciled.reconciled.warnings.join('\n')).toContain('残留 meta.json')
    } finally {
      await dir.cleanup()
    }
  })

  it('② 落点被手工替换（版本/哈希都变）→ 版本与哈希取自文件系统 + 两个来源并列告警', async () => {
    const dir = await tempDir()
    try {
      const targetRoot = path.join(dir.path, 'root', '.dsh', 'skills')
      await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '9.9.9', body: 'hand-modified body' })
      const meta = emptyMeta()
      meta.version = '1.2.0'
      meta.contentHash = 'aaaa1111aaaa1111'
      const { reconciled } = await fixtureState(targetRoot, 'tdx-tq-local', meta)
      // 版本取文件系统
      expect(reconciled.version).toBe('9.9.9')
      expect(reconciled.contentHash).toBe(await sha256File(path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')))
      expect(reconciled.expectedHash).toBe('aaaa1111aaaa1111')
      // 状态 ∈ {state-mismatch, content-drifted}；告警同时列出两个来源的值
      expect(['state-mismatch', 'content-drifted']).toContain(reconciled.state)
      const allWarnings = reconciled.warnings.join('\n')
      expect(allWarnings).toContain('9.9.9')
      expect(allWarnings).toContain('1.2.0')
      expect(allWarnings).toContain('aaaa1111aaaa1111')
    } finally {
      await dir.cleanup()
    }
  })

  it('③ 落点在而 meta.json 缺失 → installed + 「安装记录缺失」warning', async () => {
    const dir = await tempDir()
    try {
      const targetRoot = path.join(dir.path, 'root', '.dsh', 'skills')
      await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '1.2.0' })
      const { reconciled } = await fixtureState(targetRoot, 'tdx-tq-local', null)
      expect(reconciled.state).toBe('installed')
      expect(reconciled.installed).toBe(true)
      expect(reconciled.version).toBe('1.2.0')
      expect(reconciled.warnings.join('\n')).toContain('安装记录缺失')
      expect(reconciled.warnings.join('\n')).toContain('建议重装')
    } finally {
      await dir.cleanup()
    }
  })

  it('③b 无 meta 也无落点（从未安装）→ missing 且无残留告警', async () => {
    const dir = await tempDir()
    try {
      const { reconciled } = await fixtureState(dir.path, 'tdx-tq-local', null)
      expect(reconciled.state).toBe('missing')
      expect(reconciled.warnings).toEqual([])
    } finally {
      await dir.cleanup()
    }
  })

  it('④ SKILL.md 不可解析 → unparseable + 显式警告', async () => {
    const dir = await tempDir()
    try {
      const targetRoot = path.join(dir.path, 'root', '.dsh', 'skills')
      const skillDir = await writeSkillDir(targetRoot, 'tdx-tq-local', { version: '1.2.0' })
      await fsp.writeFile(path.join(skillDir, 'SKILL.md'), '正文没有 frontmatter 围栏', 'utf8')
      const meta = emptyMeta()
      meta.version = '1.2.0'
      const { reconciled } = await fixtureState(targetRoot, 'tdx-tq-local', meta)
      expect(reconciled.state).toBe('unparseable')
      expect(reconciled.warnings.length).toBeGreaterThan(0)
      expect(reconciled.warnings.join('\n')).toContain('无法解析')
    } finally {
      await dir.cleanup()
    }
  })
})

describe('meta.json 读写', () => {
  it('metaPathFor：<dirname(targetRoot)>/.dsh-trader-kit-tmp/meta/<name>.json（落点之外、扫描根之外）', () => {
    const metaPath = metaPathFor('C:\\proj\\.dsh\\skills', 'tdx-tq-local')
    expect(metaPath).toBe(path.resolve('C:\\proj\\.dsh\\.dsh-trader-kit-tmp\\meta\\tdx-tq-local.json'))
    expect(metaPath).not.toContain(path.join('skills', 'tdx-tq-local'))
  })

  it('writeMeta 原子写 + readMeta 回读（字段含 resolvedCwd/projectRoot/targetRoot/name）', async () => {
    const dir = await tempDir()
    try {
      const metaPath = metaPathFor(path.join(dir.path, 'skills'), 'tdx-tq-local')
      const meta = emptyMeta()
      meta.version = '1.2.0'
      meta.contentHash = 'aa'
      meta.etag = '"6aafc833-7681"'
      meta.lastModified = 'Sun, 20 Sep 2026 11:49:07 GMT'
      meta.resolvedCwd = 'C:\\proj\\sub'
      meta.projectRoot = 'C:\\proj'
      meta.targetRoot = 'C:\\proj\\.dsh\\skills'
      meta.name = 'tdx-tq-local'
      await writeMeta(metaPath, meta)
      const { meta: back, corrupt } = await readMeta(metaPath)
      expect(corrupt).toBe(false)
      expect(back?.etag).toBe('"6aafc833-7681"') // 原样字符串
      expect(back?.lastModified).toBe('Sun, 20 Sep 2026 11:49:07 GMT') // 未重格式化
      expect(back?.resolvedCwd).toBe('C:\\proj\\sub')
      expect(back?.projectRoot).toBe('C:\\proj')
      expect(back?.targetRoot).toBe('C:\\proj\\.dsh\\skills')
      expect(back?.name).toBe('tdx-tq-local')
    } finally {
      await dir.cleanup()
    }
  })

  it('损坏的 meta.json → corrupt 标记（不静默当「无记录」）', async () => {
    const dir = await tempDir()
    try {
      const metaPath = metaPathFor(path.join(dir.path, 'skills'), 'tdx-tq-local')
      await fsp.mkdir(path.dirname(metaPath), { recursive: true })
      await fsp.writeFile(metaPath, '{broken json', 'utf8')
      const { meta, corrupt } = await readMeta(metaPath)
      expect(meta).toBeNull()
      expect(corrupt).toBe(true)
    } finally {
      await dir.cleanup()
    }
  })
})
