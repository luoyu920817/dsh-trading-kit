import { mkdtemp, readFile, rm, stat, mkdir, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { appendCard, deleteCard, deleteCardImage, parseDoc, updateCard, setStoreWriteHooksForTest } from '../../src/review/store.ts'
import { readCardImages, readImageFile, validateImageUploads } from '../../src/review/images.ts'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aFOkAAAAASUVORK5CYII='

it('追加落盘，重试去重，单图删除保留空卡片，编辑与整卡删除回收图片', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'review-images-'))
  try {
    const loc = { dataRoot, code: '600000', name: '浦发', tradeDate: '2026-10-07' }
    const image = { relativePath: 'files/review-one.png', dataBase64: png }
    const created = await appendCard({ loc, body: '![[files/review-one.png]]', images: [image], clientRequestId: 'image-one' })
    expect(await readFile(join(dirname(created.path), image.relativePath))).toEqual(Buffer.from(png, 'base64'))
    expect((await appendCard({ loc, body: '![[files/review-one.png]]', images: [image], clientRequestId: 'image-one' })).status).toBe('duplicate')
    expect((await readCardImages(dataRoot, created.path, '![[files/review-one.png]]')).images[0]).toMatchObject({ available: true, mimeType: 'image/png' })
    await deleteCardImage({ dataRoot, anchor: created.anchor, relativePath: image.relativePath })
    expect((await parseDoc(created.path)).cards).toHaveLength(1)
    expect((await parseDoc(created.path)).cards[0].body).toBe('')
    await expect(stat(join(dirname(created.path), image.relativePath))).rejects.toMatchObject({ code: 'ENOENT' })
    await updateCard({ dataRoot, anchor: created.anchor, body: '![[files/review-two.png]]', images: [{ ...image, relativePath: 'files/review-two.png' }] })
    await updateCard({ dataRoot, anchor: created.anchor, body: '文字' })
    await expect(stat(join(dirname(created.path), 'files/review-two.png'))).rejects.toMatchObject({ code: 'ENOENT' })
    await updateCard({ dataRoot, anchor: created.anchor, body: '![[files/review-three.png]]', images: [{ ...image, relativePath: 'files/review-three.png' }] })
    await deleteCard({ dataRoot, anchor: created.anchor })
    await expect(stat(join(dirname(created.path), 'files/review-three.png'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await rm(dataRoot, { recursive: true, force: true }) }
})

it('上传只接受正文引用的安全文件名与真实图片字节', () => {
  expect(validateImageUploads(undefined, '')).toEqual([])
  expect(() => validateImageUploads([{ relativePath: 'files/../bad.png', dataBase64: png }], '![[files/../bad.png]]')).toThrow()
  expect(() => validateImageUploads([{ relativePath: 'files/review-one.png', dataBase64: png }], '未引用')).toThrow()
  expect(() => validateImageUploads([{ relativePath: 'files/review-one.png', dataBase64: Buffer.from('fake').toString('base64') }], '![[files/review-one.png]]')).toThrow()
})

it('10MiB单图及20MiB合计可提交，超限413，非法字符或padding拒绝400', () => {
  const large = Buffer.alloc(10 * 1024 * 1024)
  Buffer.from(png, 'base64').subarray(0, 8).copy(large)
  const base64 = large.toString('base64')
  const one = { relativePath: 'files/review-large.png', dataBase64: base64 }
  const two = { relativePath: 'files/review-second.png', dataBase64: base64 }
  expect(validateImageUploads([one], '![[files/review-large.png]]')).toEqual([one])
  expect(validateImageUploads([one, two], '![[files/review-large.png]]\n![[files/review-second.png]]')).toEqual([one, two])
  const tooLarge = { ...one, dataBase64: Buffer.concat([large, Buffer.from([0])]).toString('base64') }
  expect(() => validateImageUploads([tooLarge], '![[files/review-large.png]]')).toThrow(expect.objectContaining({ code: 'IMAGE_TOO_LARGE', status: 413 }))
  const small = { relativePath: 'files/review-third.png', dataBase64: png }
  expect(() => validateImageUploads([one, two, small], '![[files/review-large.png]]\n![[files/review-second.png]]\n![[files/review-third.png]]')).toThrow(expect.objectContaining({ code: 'IMAGE_TOO_LARGE', status: 413 }))
  for (const invalid of ['A===', 'AAAA=', 'AAA!', 'AB==', 'AA=A']) {
    expect(() => validateImageUploads([{ ...one, dataBase64: invalid }], '![[files/review-large.png]]')).toThrow(expect.objectContaining({ code: 'INVALID_IMAGE_DATA', status: 400 }))
  }
})

it('文档写入失败恢复已移除图片、回收本次新附件，同名不同字节拒绝覆盖', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'review-image-rollback-'))
  try {
    const loc = { dataRoot, code: '600000', tradeDate: '2026-10-07' }
    const image = { relativePath: 'files/review-old.png', dataBase64: png }
    const card = await appendCard({ loc, body: '![[files/review-old.png]]', images: [image] })
    const before = await readFile(card.path)
    setStoreWriteHooksForTest({ onPhase: () => { throw new Error('真实写入前失败注入') } })
    await expect(updateCard({ dataRoot, anchor: card.anchor, body: '![[files/review-new.png]]', images: [{ ...image, relativePath: 'files/review-new.png' }] })).rejects.toThrow('真实写入前失败')
    expect(await readFile(card.path)).toEqual(before)
    expect(await readFile(join(dirname(card.path), image.relativePath))).toEqual(Buffer.from(png, 'base64'))
    expect(await readdir(join(dirname(card.path), 'files'))).toEqual(['review-old.png'])
    setStoreWriteHooksForTest(undefined)
    const other = Buffer.concat([Buffer.from(png, 'base64'), Buffer.from('different')]).toString('base64')
    await expect(updateCard({ dataRoot, anchor: card.anchor, body: '![[files/review-old.png]]', images: [{ ...image, dataBase64: other }] })).rejects.toMatchObject({ code: 'IMAGE_CONFLICT', status: 409 })
    expect(await readFile(card.path)).toEqual(before)
  } finally { setStoreWriteHooksForTest(undefined); await rm(dataRoot, { recursive: true, force: true }) }
})

it('缺图保留不可用元数据，图片接口拒绝越界与files符号链接', async () => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'review-image-safe-'))
  const outside = await mkdtemp(join(tmpdir(), 'review-image-outside-'))
  try {
    const card = await appendCard({ loc: { dataRoot, code: '600000', tradeDate: '2026-10-07' }, body: '![[files/旧 图.png]]' })
    const missing = await readCardImages(dataRoot, card.path, '![[files/旧 图.png]]')
    expect(missing.images).toEqual([{ relativePath: 'files/旧 图.png', path: '', mimeType: '', available: false }])
    expect(missing.warnings).toHaveLength(1)
    await expect(readImageFile(dataRoot, card.path, 'files/../bad.png')).rejects.toMatchObject({ code: 'INVALID_IMAGE_PATH' })
    await mkdir(dirname(card.path), { recursive: true })
    await symlink(outside, join(dirname(card.path), 'files'), 'junction')
    await expect(readImageFile(dataRoot, card.path, 'files/旧 图.png')).rejects.toMatchObject({ code: 'INVALID_IMAGE_PATH' })
  } finally { await rm(dataRoot, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})
