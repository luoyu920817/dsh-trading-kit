import { mkdtemp, rm, readFile, writeFile, rename, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { it, expect } from 'vitest'
import { appendCard, appendAinote, updateCard, deleteCard, withVerifiedCardSnapshot } from '../../src/review/store.ts'
import { readDocumentSources, readCardSource } from '../../src/review/processors/source.ts'

it('实际文档回读只取用户卡片；附注不改变输入版本，正文修订改变版本', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-source-'))
  try {
    const loc = { dataRoot: root, code: '000001', market: 'sh', tradeDate: '2026-10-09' }
    const created = await appendCard({ loc, body: '@预期 指数企稳', clientRequestId: 'source-1' })
    const [source] = await readDocumentSources(root, created.path)
    expect(source).toMatchObject({ anchor: created.anchor, code: '000001', market: 'sh', tradeDate: loc.tradeDate, body: '@预期 指数企稳', verification: 'verified' })
    expect(source.relativePath).toBe(relative(root, created.path).replaceAll('\\', '/'))
    const before = await readFile(created.path, 'utf8')
    await appendAinote({ loc, body: '@预期 AI附注', generatedAt: '2026-10-09T16:00:00+08:00', dataSources: [] })
    expect((await readDocumentSources(root, created.path))).toHaveLength(1)
    expect((await readCardSource(root, source)).sourceRevision).toBe(source.sourceRevision)
    await updateCard({ dataRoot: root, anchor: created.anchor, market: 'sh', body: '@预期 修订后的指数判断' })
    expect((await readCardSource(root, source)).sourceRevision).not.toBe(source.sourceRevision)
    expect(await readFile(created.path, 'utf8')).toContain(before.split('@预期')[0])
    await deleteCard({ dataRoot: root, anchor: created.anchor, market: 'sh' })
    await expect(readCardSource(root, source)).rejects.toThrow('SOURCE_REMOVED')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('文件名代码和日期必须匹配原身份，不以frontmatter冒充另一文件', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-source-'))
  try {
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@预期', clientRequestId: 'source-3' })
    const [source] = await readDocumentSources(root, created.path)
    const other = created.path.replace('600000_', '600001_')
    await rename(created.path, other)
    await expect(readCardSource(root, { ...source, relativePath: relative(root, other).replaceAll('\\', '/') })).rejects.toThrow('SOURCE_IDENTITY_MISMATCH')
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('短来源核验拒绝根外路径、市场伪装和重复锚点；不调用提交回调', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-source-'))
  try {
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@预期', clientRequestId: 'source-2' })
    const [source] = await readDocumentSources(root, created.path)
    let commits = 0
    await withVerifiedCardSnapshot(root, source, async current => { commits++; expect(current.sourceRevision).toBe(source.sourceRevision) })
    await expect(withVerifiedCardSnapshot(root, { ...source, relativePath: '../outside.md' }, async () => { commits++ })).rejects.toThrow('SOURCE_PATH_INVALID')
    await expect(readCardSource(root, { ...source, market: 'sz' })).rejects.toThrow('SOURCE_IDENTITY_MISMATCH')
    const text = await readFile(created.path, 'utf8')
    await writeFile(created.path, text + '\n' + text.slice(text.indexOf('## ')), 'utf8')
    await expect(withVerifiedCardSnapshot(root, source, async () => { commits++ })).rejects.toThrow('SOURCE_AMBIGUOUS')
    expect(commits).toBe(1)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('空卡片文档仍先核验文件身份、月份与真实路径', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-source-'))
  try {
    const created = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }, body: '@预期', clientRequestId: 'source-empty' })
    await deleteCard({ dataRoot: root, anchor: created.anchor })
    expect(await readDocumentSources(root, created.path)).toEqual([])
    const other = created.path.replace('600000_', '600001_')
    await rename(created.path, other)
    await expect(readDocumentSources(root, other)).rejects.toThrow('SOURCE_IDENTITY_MISMATCH')
    const linked = other.replace('202610', '202611')
    await symlink(dirname(other), dirname(linked), 'junction')
    await expect(readDocumentSources(root, linked)).rejects.toThrow('SOURCE_UNVERIFIED')
  } finally { await rm(root, { recursive: true, force: true }) }
})
