import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { appendCard } from '../../src/review/store.ts'
import { readDocumentSources } from '../../src/review/processors/source.ts'

it('受控上下文从本卡片及同文档历史读取，拒绝越权材料', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workflow-context-'))
  try {
    const loc = { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }
    const created = await appendCard({ loc, body: '@文字 第一张卡片', clientRequestId: 'context-1' })
    await appendCard({ loc, body: '同日第二张卡片', clientRequestId: 'context-2' })
    const [source] = await readDocumentSources(root, created.path)
    const module = await import('../../src/review/processors/context.ts').catch(() => ({})) as { createWorkflowContextReader?: Function }
    expect(module.createWorkflowContextReader).toBeTypeOf('function')
    const reader = module.createWorkflowContextReader!(root, source, new AbortController().signal)
    expect(await reader.read({ kind: 'card', limit: 1 })).toEqual([{ id: source.anchor, kind: 'card', content: source.body, revision: source.sourceRevision }])
    expect(await reader.read({ kind: 'history', limit: 1 })).toEqual([expect.objectContaining({ kind: 'history', content: '同日第二张卡片' })])
    await expect(reader.read({ kind: 'role' })).rejects.toThrow('CONTEXT_CAPABILITY_UNAVAILABLE')
    await expect(reader.read({ kind: 'marketEvidence' })).rejects.toThrow('CONTEXT_CAPABILITY_UNAVAILABLE')
    await expect(reader.read({ kind: 'card', path: '../outside' })).rejects.toThrow('CONTEXT_REQUEST_INVALID')
    await expect(reader.read({ kind: 'history', limit: 51 })).rejects.toThrow('CONTEXT_REQUEST_INVALID')
  } finally { await rm(root, { recursive: true, force: true }) }
})
