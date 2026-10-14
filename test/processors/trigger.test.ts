import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { appendCard, appendAinote, updateCard } from '../../src/review/store.ts'
import { readDocumentSources } from '../../src/review/processors/source.ts'
import { attachKeywordTrigger } from '../../src/review/processors/trigger.ts'

it('已提交写入异步排空，后台失败不回滚卡片，卸载后不再接纳通知', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keyword-trigger-'))
  const seen: string[] = []
  const errors: unknown[] = []
  const trigger = attachKeywordTrigger(root, async path => {
    seen.push((await readDocumentSources(root, path))[0]?.body ?? '')
    if (seen.length === 1) throw new Error('实际后台失败')
  }, error => { errors.push(error) })
  try {
    const loc = { dataRoot: root, code: '600000', tradeDate: '2026-10-09' }
    const card = await appendCard({ loc, body: '@预期 原文', clientRequestId: 'trigger-1' })
    expect(card.status).toBe('created')
    await trigger.drain()
    expect(seen).toEqual(['@预期 原文'])
    expect(errors).toHaveLength(1)
    await appendAinote({ loc, body: '@预期 附注', generatedAt: '2026-10-09T16:00:00+08:00', dataSources: [] })
    await trigger.drain()
    expect(seen).toEqual(['@预期 原文', '@预期 原文'])
    await trigger.dispose()
    await updateCard({ dataRoot: root, anchor: card.anchor, body: '关闭后的新正文' })
    await trigger.drain()
    expect(seen).toHaveLength(2)
  } finally { await trigger.dispose(); await rm(root, { recursive: true, force: true }) }
})
