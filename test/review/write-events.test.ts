import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { appendCard, appendAinote, updateCard, deleteCard, deleteCardImage } from '../../src/review/store.ts'
import { onReviewWrite } from '../../src/review/write-events.ts'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOkAAAAASUVORK5CYII='

it('真实提交失效一次：追加、修订、删图和删除；幂等与失败不发布', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-write-events-'))
  const paths: string[] = []
  const stop = onReviewWrite((path) => paths.push(path))
  try {
    const loc = { dataRoot: root, code: '600000', tradeDate: '2026-10-08' }
    const image = { relativePath: 'files/review-one.png', dataBase64: png }
    const input = { loc, body: '![[files/review-one.png]]', images: [image], clientRequestId: 'events-1' }
    const created = await appendCard(input)
    expect(paths).toEqual([created.path])
    expect((await appendCard(input)).status).toBe('duplicate')
    expect(paths).toEqual([created.path])
    await updateCard({ dataRoot: root, anchor: created.anchor, body: '观察\n![[files/review-one.png]]' })
    expect(paths).toEqual([created.path, created.path])
    await deleteCardImage({ dataRoot: root, anchor: created.anchor, relativePath: image.relativePath })
    expect(paths).toEqual(Array(3).fill(created.path))
    const before = await readFile(created.path)
    await expect(updateCard({ dataRoot: root, anchor: created.anchor, body: ' ' })).rejects.toThrow()
    expect(await readFile(created.path)).toEqual(before)
    expect(paths).toEqual(Array(3).fill(created.path))
    await deleteCard({ dataRoot: root, anchor: created.anchor })
    expect(paths).toEqual(Array(4).fill(created.path))
    stop()
    await appendCard({ loc, body: '取消订阅后创建', clientRequestId: 'events-2' })
    expect(paths).toEqual(Array(4).fill(created.path))
  } finally { stop(); await rm(root, { recursive: true, force: true }) }
})

it('附注仅真实创建时发布；监听失败不影响存储或其它订阅者', async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-ainote-events-'))
  const paths: string[] = []
  const stopFailing = onReviewWrite(() => { throw new Error('缓存监听失败') })
  const stop = onReviewWrite((path) => paths.push(path))
  try {
    const input = { loc: { dataRoot: root, code: '600000', tradeDate: '2026-10-08' }, body: 'AI附注', generatedAt: '2026-10-08T15:00:00+08:00', dataSources: [] }
    const created = await appendAinote(input)
    expect(created.status).toBe('created')
    expect(paths).toEqual([created.path])
    expect((await appendAinote(input)).status).toBe('skipped')
    expect(paths).toEqual([created.path])
  } finally { stop(); stopFailing(); await rm(root, { recursive: true, force: true }) }
})
