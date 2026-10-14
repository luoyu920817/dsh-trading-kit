import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createReviewHandler, REVIEW_PAGE_PATH } from '../../src/routes/review.ts'
import { deleteCardImage, parseDoc, updateCard } from '../../src/review/store.ts'
import { makeDeps, makeReq, makeRes } from './helpers.ts'
import type { TraderKitHttpResponse } from '../../src/context-types.ts'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG2kAAAAASUVORK5CYII='
const IMAGE = 'files/review-route.png'

/**
 * 驱动真实存储的图片路由测试。
 * 业务逻辑: 收集 JSON 和二进制响应，使用临时数据根。
 * 关键判断: 写请求默认携带页面写凭据，允许用 headers 覆盖测试拒绝路径。
 * 异常处理: handler 自行转换错误，测试保留原始响应字节。
 * 参数: 无。
 * 返回: handler、临时根与请求驱动函数。
 */
function harness() {
  const { deps } = makeDeps({ overrides: { updateCard, deleteCardImage } })
  const handler = createReviewHandler(deps)
  async function request(suffix: string, payload?: unknown, headers: Record<string, string> = { 'x-write-key': 'test-write-key' }) {
    const { res, rec } = makeRes()
    let bytes = Buffer.alloc(0)
    const response: TraderKitHttpResponse = {
      ...res,
      end(body) {
        if (body instanceof Uint8Array) bytes = Buffer.from(body)
        res.end(body)
      },
    }
    await handler(makeReq({ url: REVIEW_PAGE_PATH + suffix, method: payload === undefined ? 'GET' : 'POST', headers, body: payload === undefined ? undefined : JSON.stringify(payload) }), response)
    return { ...rec, bytes, json: rec.body === '' ? null : JSON.parse(rec.body) }
  }
  return { root: deps.dataRoot, request }
}

/**
 * 构造带图片的保存请求。
 * 业务逻辑: 图片引用和二进制内容随同一保存意图提交。
 * 关键判断: 同一 id 用于验证幂等重试。
 * 异常处理: 校验由真实路由与存储完成。
 * 参数: id 为提交标识。
 * 返回: 保存请求对象。
 */
function payload(id = 'image-request') {
  return { code: '600000', name: '浦发银行', tradeDate: '2026-09-24', body: '盘面截图\n![[files/review-route.png]]', clientRequestId: id, images: [{ relativePath: IMAGE, dataBase64: PNG }] }
}

describe('复盘图片路由（真实文件系统）', () => {
  it('保存图文、重复提交、历史元数据和二进制读取贯通', async () => {
    const h = harness()
    const saved = await h.request('/api/card', payload())
    expect(saved.status).toBe(200)
    expect(saved.json.status).toBe('created')
    const file = join(dirname(saved.json.path), IMAGE)
    expect(readFileSync(file)).toEqual(Buffer.from(PNG, 'base64'))
    expect(readFileSync(saved.json.path, 'utf8')).not.toContain(PNG)
    const repeated = await h.request('/api/card', payload())
    expect(repeated.json.status).toBe('duplicate')
    // P0 local有350ms预算；整库并发I/O下允许loading，按真实请求补读而不等待固定时长。
    let local = await h.request('/api/local?code=600000&date=2026-09-24', undefined, { cookie: 'dsh-auth=ok' })
    for (let attempt = 0; local.json.loadState.cards === 'loading' && attempt < 10; attempt++) {
      local = await h.request('/api/local?code=600000&date=2026-09-24', undefined, { cookie: 'dsh-auth=ok' })
    }
    expect(local.json.loadState.cards).toBe('ready')
    expect(local.json.cards).toHaveLength(1)
    expect(local.json.cards[0].images).toEqual([{ relativePath: IMAGE, path: file, mimeType: 'image/png', available: true }])
    const image = await h.request('/api/card/image?code=600000&tradeDate=2026-09-24&relativePath=' + encodeURIComponent(IMAGE), undefined, { cookie: 'dsh-auth=ok' })
    expect(image.status).toBe(200)
    expect(image.headers['Content-Type']).toBe('image/png')
    expect(image.headers['X-Content-Type-Options']).toBe('nosniff')
    expect(image.bytes).toEqual(Buffer.from(PNG, 'base64'))
  })

  it('删图同时删除文件并保留卡片锚点、时间与其他正文', async () => {
    const h = harness()
    const saved = await h.request('/api/card', payload())
    const before = await parseDoc(saved.json.path)
    const removed = await h.request('/api/card/image/delete', { anchor: saved.json.anchor, relativePath: IMAGE })
    expect(removed.status).toBe(200)
    expect(removed.json.status).toBe('updated')
    expect(existsSync(join(dirname(saved.json.path), IMAGE))).toBe(false)
    const after = await parseDoc(saved.json.path)
    expect(after.cards[0].anchor).toBe(before.cards[0].anchor)
    expect(after.cards[0].writtenAt).toBe(before.cards[0].writtenAt)
    expect(after.cards[0].body.trim()).toBe('盘面截图')
  })

  it('编辑接口传入新图片，文本接口仍保持兼容', async () => {
    const h = harness()
    const text = await h.request('/api/card', { ...payload('text'), body: '原文字', images: undefined })
    expect(text.status).toBe(200)
    const updated = await h.request('/api/card/update', { anchor: text.json.anchor, body: payload().body, images: payload().images })
    expect(updated.status).toBe(200)
    expect(readFileSync(join(dirname(text.json.path), IMAGE))).toEqual(Buffer.from(PNG, 'base64'))
    expect((await parseDoc(text.json.path)).cards[0].writtenAt).toBe('2026-09-24T14:32:05+08:00')
  })

  it('未认证与跨站写请求零落盘；非法图片返回4xx', async () => {
    const h = harness()
    expect((await h.request('/api/card', payload(), {})).status).toBe(401)
    expect((await h.request('/api/card', payload(), { fence: '1', 'x-write-key': 'test-write-key' })).status).toBe(403)
    expect(existsSync(join(h.root, 'DB'))).toBe(false)
    const bad = await h.request('/api/card', { ...payload(), images: [{ relativePath: IMAGE, dataBase64: Buffer.from('not an image').toString('base64') }] })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    expect(bad.status).toBeLessThan(500)
    expect(existsSync(join(h.root, 'DB'))).toBe(false)
  })

  it('图片读取拒绝越界，缺图返回404，删除也要求写凭据', async () => {
    const h = harness()
    const saved = await h.request('/api/card', payload())
    const prefix = '/api/card/image?code=600000&tradeDate=2026-09-24&relativePath='
    expect((await h.request(prefix + encodeURIComponent('files/../secret.png'), undefined, { cookie: 'dsh-auth=ok' })).status).toBe(400)
    expect((await h.request(prefix + encodeURIComponent('files/missing.png'), undefined, { cookie: 'dsh-auth=ok' })).status).toBe(404)
    expect((await h.request('/api/card/image/delete', { anchor: saved.json.anchor, relativePath: IMAGE }, {})).status).toBe(401)
    expect(existsSync(join(dirname(saved.json.path), IMAGE))).toBe(true)
  })
})
