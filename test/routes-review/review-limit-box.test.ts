import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'

/**
 * 执行页面原有折叠盒渲染及点击逻辑。
 * 业务逻辑: 从实际内联页提取渲染函数，以最小元素容器记录显示状态和点击事件。
 * 关键判断: 每次渲染清空旧子节点；日期可变，用于验证切日重新渲染。
 * 异常处理: 提取不到函数时断言失败，不跳过测试。
 * 参数: date 为当前交易日，可为空。
 * 返回: 渲染函数、日期切换入口和元素容器。
 */
function limitBox(date: string | null) {
  const source = REVIEW_HTML.slice(REVIEW_HTML.indexOf('  function renderLimitBox('), REVIEW_HTML.indexOf('  function renderEnrich('))
  expect(source).toContain('function renderLimitBox(')
  const elements: Array<{ textContent: string; style: Record<string, string>; className: string; click?: () => void }> = []
  const box = {
    set textContent(_value: string) { elements.length = 0 },
    appendChild(element: typeof elements[number]) { elements.push(element) },
  }
  const context = {
    currentDate: date,
    byId: () => box,
    document: {
      createElement: () => ({
        textContent: '', style: {}, className: '',
        addEventListener(_event: string, listener: () => void) { this.click = listener },
        click: undefined as (() => void) | undefined,
      }),
    },
  }
  const render = runInNewContext(source + '\nrenderLimitBox;', context) as (reason: { text: string | null; businessDate?: string | null } | null) => void
  return { render, elements, context }
}

describe('涨停原因默认展开与手动折叠', () => {
  it('同交易日默认展开，支持手动收起和再次展开', () => {
    const page = limitBox('2026-09-30')
    page.render({ text: '白酒', businessDate: '2026-09-30' })
    expect(page.elements).toHaveLength(2)
    expect(page.elements[1]!.textContent).toBe('白酒')
    expect(page.elements[1]!.style.display).toBe('')
    expect(page.elements[0]!.textContent).toBe('涨停原因（点击收起）▴ ［2026-09-30］')
    page.elements[0]!.click!()
    expect(page.elements[1]!.style.display).toBe('none')
    expect(page.elements[0]!.textContent).toContain('点击展开')
    page.elements[0]!.click!()
    expect(page.elements[1]!.style.display).toBe('')
    expect(page.elements[0]!.textContent).toContain('点击收起')
  })

  it('切换交易日后重新计算默认状态，未定交易日保持收起', () => {
    const page = limitBox(null)
    const reason = { text: '白酒', businessDate: '2026-09-30' }
    page.render(reason)
    expect(page.elements[1]!.style.display).toBe('none')
    page.context.currentDate = '2026-09-30'
    page.render(reason)
    expect(page.elements[1]!.style.display).toBe('')
    page.context.currentDate = '2026-10-07'
    page.render(reason)
    expect(page.elements).toHaveLength(2)
    expect(page.elements[1]!.style.display).toBe('none')
    expect(page.elements[0]!.textContent).toContain('点击展开')
  })

  it.each(['2026-09-29', null, ''])('归属日不同或缺失时收起（%s），仍可手动展开和收起', (businessDate) => {
    const page = limitBox('2026-09-30')
    page.render({ text: '白酒', businessDate })
    expect(page.elements).toHaveLength(2)
    expect(page.elements[1]!.textContent).toBe('白酒')
    expect(page.elements[1]!.style.display).toBe('none')
    expect(page.elements[0]!.textContent).toContain('点击展开')
    page.elements[0]!.click!()
    expect(page.elements[1]!.style.display).toBe('')
    expect(page.elements[0]!.textContent).toContain('点击收起')
    page.elements[0]!.click!()
    expect(page.elements[1]!.style.display).toBe('none')
    expect(page.elements[0]!.textContent).toContain('点击展开')
  })

  it('缺失正文时只显示不可用提示', () => {
    const page = limitBox('2026-09-30')
    page.render(null)
    expect(page.elements).toHaveLength(1)
    expect(page.elements[0]!.textContent).toBe('涨停原因：不可用（响应缺失）')
    expect(page.elements[0]!.click).toBeUndefined()
  })
})
