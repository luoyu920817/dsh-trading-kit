import { describe, expect, it } from 'vitest'
import { imageDraftError, insertImageEmbed, imagePreviewItems, selectDraftImages, cardImageDate, imageReadIsCurrent, imageDraftBytes } from '../../src/client/review/image-draft.ts'
import { Script } from 'node:vm'
import { parseImageEmbeds } from '../../src/review/image-refs.ts'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'

describe('图片草稿业务判断（浏览器内联与测试共用纯函数）', () => {
  it('校验类型、单图及总量边界', () => {
    expect(imageDraftError('image/png', 10 * 1024 * 1024, 10 * 1024 * 1024)).toBe('')
    expect(imageDraftError('image/svg+xml', 1, 0)).toContain('PNG')
    expect(imageDraftError('image/jpeg', 10 * 1024 * 1024 + 1, 0)).toContain('10')
    expect(imageDraftError('image/webp', 1, 20 * 1024 * 1024)).toContain('20')
  })
  it('光标选区替换为嵌入，允许纯图片正文', () => {
    expect(insertImageEmbed('甲乙丙', 1, 2, 'files/review-1.png')).toEqual({ body: '甲![[files/review-1.png]]丙', cursor: 24 })
    expect(insertImageEmbed('', 0, 0, 'files/review-1.png').body).toBe('![[files/review-1.png]]')
  })
  it('正文只携带仍引用的新图，排除代码区域及重复引用', () => {
    const draft = [{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 1, url: 'blob:a' }, { relativePath: 'files/review-b.png', dataBase64: 'Qg==', size: 1, url: 'blob:b' }]
    expect(selectDraftImages('![[files/review-a.png]] ![[files/review-a.png]] `![[files/review-b.png]]`', draft)).toEqual([{ relativePath: 'files/review-a.png', dataBase64: 'QQ==' }])
  })
  it('删除引用后撤销恢复附件，额度只统计当前正文引用', () => {
    const draft = [{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 10 * 1024 * 1024, url: 'blob:a' }]
    expect(imageDraftBytes('', draft, 0)).toBe(0)
    expect(selectDraftImages('', draft)).toEqual([])
    expect(imageDraftBytes('![[files/review-a.png]]', draft, 2)).toBe(10 * 1024 * 1024 + 2)
    expect(selectDraftImages('![[files/review-a.png]]', draft)).toEqual([{ relativePath: 'files/review-a.png', dataBase64: 'QQ==' }])
    expect(draft).toEqual([{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 10 * 1024 * 1024, url: 'blob:a' }])
    const inputRefresh = REVIEW_HTML.slice(REVIEW_HTML.indexOf("ta.addEventListener('input'"), REVIEW_HTML.indexOf("function enterCardEdit"))
    expect(inputRefresh).not.toContain('revokeObjectURL')
    expect(inputRefresh).not.toContain('draft.items =')
  })
  it('输入预览只渲染已引用图片的缩略图，正文文本不镜像（owner 2026-10-07）', () => {
    const draft = [{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 1, url: 'blob:a' }]
    expect(imagePreviewItems('盘面 ![[files/review-a.png]] 观察', draft)).toEqual(draft)
    expect(imagePreviewItems('盘面观察', draft)).toEqual([])
    expect(imagePreviewItems('`![[files/review-a.png]]`', draft)).toEqual([])
    expect(imagePreviewItems('', draft)).toEqual([])
    const inline = new Function('return (' + imagePreviewItems.toString() + ')')() as typeof imagePreviewItems
    expect(inline('![[files/review-a.png]]', draft, parseImageEmbeds)).toEqual(draft)
    expect(REVIEW_HTML).toContain(imagePreviewItems.toString())
    const renderer = REVIEW_HTML.slice(REVIEW_HTML.indexOf('function renderDraftPreview'), REVIEW_HTML.indexOf('function enterCardEdit'))
    expect(renderer).not.toContain('createTextNode') // 正文文本不再镜像渲染
    expect(renderer).toContain('preview.appendChild(img)')
  })
  it('历史图片按锚点日归属且切换/取消拒绝迟到读取', () => {
    expect(cardImageDate('card-20260924-600000-1432', '2026-10-07')).toBe('2026-09-24')
    expect(cardImageDate('', '2026-10-07')).toBe('2026-10-07')
    expect(imageReadIsCurrent(1, 1, 2, 2, true)).toBe(true)
    expect(imageReadIsCurrent(1, 2, 2, 2, true)).toBe(false)
    expect(imageReadIsCurrent(1, 1, 2, 3, true)).toBe(false)
    expect(imageReadIsCurrent(1, 1, 2, 2, false)).toBe(false)
  })
  it('历史编辑提交冻结正文和附件控件，失败恢复编辑', () => {
    const editor = REVIEW_HTML.slice(REVIEW_HTML.indexOf('function enterCardEdit'), REVIEW_HTML.indexOf('function makeDeleteButton'))
    const freeze = editor.indexOf('ta.disabled = true;')
    const request = editor.indexOf("postCardApi('/update'")
    expect(freeze).toBeGreaterThan(0)
    expect(freeze).toBeLessThan(request)
    expect(editor.slice(freeze, request)).toContain('imagePick.disabled = true;')
    expect(editor.slice(freeze, request)).toContain('cancel.disabled = true;')
    const failure = editor.slice(editor.indexOf('save.disabled = false;'))
    expect(failure).toContain('ta.disabled = false;')
    expect(failure).toContain('imagePick.disabled = !writable;')
    expect(failure).toContain('cancel.disabled = false;')
  })
  it('完整内联脚本可编译', () => {
    const scripts = Array.from(REVIEW_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g))
    expect(scripts).toHaveLength(2)
    expect(() => new Script(scripts[1]![1]!)).not.toThrow()
  })
  it('可序列化的纯函数在内联页执行相同行为', () => {
    const inline = new Function('return (' + imageDraftError.toString() + ')')() as typeof imageDraftError
    expect(inline('image/gif', 42, 0)).toBe('')
    // 内联页里 selectDraftImages 复用 imagePreviewItems：序列化后按同一作用域组合再验一次。
    const preview = new Function('return (' + imagePreviewItems.toString() + ')')() as typeof imagePreviewItems
    const select = new Function('imagePreviewItems', 'return (' + selectDraftImages.toString() + ')')(preview) as typeof selectDraftImages
    const parse = new Function('return (' + parseImageEmbeds.toString() + ')')() as typeof parseImageEmbeds
    expect(select('![[files/review-a.png]]', [{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 1, url: 'blob:a' }], parse)).toEqual([{ relativePath: 'files/review-a.png', dataBase64: 'QQ==' }])
    expect(preview('![[files/review-a.png]]', [{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 1, url: 'blob:a' }], parse).length).toBe(1)
    const bytes = new Function('return (' + imageDraftBytes.toString() + ')')() as typeof imageDraftBytes
    expect(bytes('![[files/review-a.png]]', [{ relativePath: 'files/review-a.png', dataBase64: 'QQ==', size: 7, url: 'blob:a' }], 2, parse)).toBe(9)
    expect(REVIEW_HTML).toContain(imageDraftError.toString())
    // window.open 调用点唯一 = 问DeepSeek 跳转（owner 2026-10-13 追授：用户主动导航，
    // TDX 拦截时降级复制）——spike 决策④「页面交互不依赖弹窗」的其余交互维持无弹窗。
    expect(REVIEW_HTML.match(/window\.open\(/g)).toHaveLength(1)
    expect(REVIEW_HTML).toContain("window.open(buildDeepSeekUrl(dsOrigin, prompt), '_blank')")
    expect(REVIEW_HTML).not.toContain('innerHTML')
  })
})
