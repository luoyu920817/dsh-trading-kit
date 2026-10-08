import { expect, it } from 'vitest'
import { parseImageEmbeds } from '../../src/review/image-refs.ts'

it('保留嵌入偏移，跳过围栏、行内代码与远程地址', () => {
  const body = '甲 ![[files/中文 图.png]] 乙 `![[files/code.jpg]]`\n```md\n![[files/fence.gif]]\n```\n![[files/last.webp|200]] ![[https://x/a.png]]'
  const refs = parseImageEmbeds(body)
  expect(refs.map((r) => r.relativePath)).toEqual(['files/中文 图.png', 'files/last.webp'])
  expect(refs.map((r) => body.slice(r.start, r.end))).toEqual(['![[files/中文 图.png]]', '![[files/last.webp|200]]'])
  const inline = new Function(`return (${parseImageEmbeds.toString()})`)() as typeof parseImageEmbeds
  expect(inline(body)).toEqual(refs)
})
