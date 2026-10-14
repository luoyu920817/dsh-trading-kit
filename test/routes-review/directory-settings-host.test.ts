import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { configRevision, directoryConfigChange, executionConfigChange, selectedRelativeDirectory, validateDirectoryDraft } from '../../src/routes/directory-settings-host.ts'

it('执行CAS只改四个确认字段，保留秘密预算未知字段且不改变输入', () => {
  const current = { dataRoot: 'root', review: { writeKey: 'secret', retained: true, processing: { enabled: false, maxTokens: 4096, maxConcurrency: 1, timeoutMs: 120000, agentAttemptLimit: 20, future: 'preserved' } }, directories: { stock: 'DB/stock', patterns: '模式' }, sources: { credential: 'preserved' } }
  const draft = { enabled: true, provider: 'provider', model: 'model', cwd: 'working-directory' }
  const next = executionConfigChange(current, configRevision(current), draft)
  expect(next).toEqual({ ...current, review: { ...current.review, processing: { ...current.review.processing, ...draft } } })
  expect(current.review.processing.enabled).toBe(false)
  expect(() => executionConfigChange(next, configRevision(current), draft)).toThrow('CONFIG_CONFLICT')
  for (const broken of [{ review: [] }, { review: { processing: 'broken' } }]) expect(() => executionConfigChange(broken, configRevision(broken), draft)).toThrow('INVALID_EXECUTION_CONFIG')
})

it('配置CAS只改目录，保留原配置密钥与其它目录字段且不修改输入', () => {
  const current = { dataRoot: 'root', review: { writeKey: 'private-key', processing: { enabled: false, agentAttemptLimit: 20 } }, directories: { stock: 'DB/stock', patterns: '模式', future: 'keep' }, other: { retained: true } }
  const revision = configRevision(current)
  const next = directoryConfigChange(current, revision, { stock: '档案/标的', patterns: '规则/模式' })
  expect(next).toEqual({ ...current, directories: { stock: '档案/标的', patterns: '规则/模式', future: 'keep' } })
  expect(current.directories.stock).toBe('DB/stock')
  expect(next.review).toEqual(current.review)
  expect(configRevision(next)).not.toBe(revision)
  expect(() => directoryConfigChange(next, revision, { stock: 'DB/stock', patterns: '模式' })).toThrow('CONFIG_CONFLICT')
})

it('真实目录选择相对化且保留文件，拒绝外根、文件、根自身和symlink外逃', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'directory-draft-'))
  const root = join(temp, 'root'), outside = join(temp, 'outside')
  try {
    await mkdir(join(root, '档案', '标的'), { recursive: true }); await mkdir(join(root, '模式'), { recursive: true }); await mkdir(outside)
    await writeFile(join(root, '档案', '标的', 'existing.md'), '原文')
    expect(await selectedRelativeDirectory(root, join(root, '档案', '标的'))).toBe('档案/标的')
    expect(await validateDirectoryDraft(root, { stock: '档案\\标的', patterns: '模式' })).toEqual({ stock: '档案/标的', patterns: '模式' })
    expect(await readFile(join(root, '档案', '标的', 'existing.md'), 'utf8')).toBe('原文')
    for (const path of [outside, root, join(root, '档案', '标的', 'existing.md')]) await expect(selectedRelativeDirectory(root, path)).rejects.toThrow()
    for (const stock of ['../outside', outside, '.', '不存在', '档案/<YYYYMM>', 'DB:stock']) await expect(validateDirectoryDraft(root, { stock, patterns: '模式' })).rejects.toThrow()
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(validateDirectoryDraft(root, { stock: 'escape', patterns: '模式' })).rejects.toThrow()
    await expect(selectedRelativeDirectory(root, join(root, 'escape'))).rejects.toThrow()
  } finally { await rm(temp, { recursive: true, force: true }) }
})
