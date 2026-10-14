/**
 * 问 DeepSeek 跳转单测（owner 2026-10-13「添加一个问DeepSeek的选项……以 url 跳转
 * 的形式弹框到 DS 的 web 端」；2026-10-14 修订：卡片级询问——只带 B3 输入框正在
 * 写的这张卡，不捆绑当日多卡片；按钮 = B3 插图图标旁的圆形鲸鱼图标）。覆盖：
 * 提示词组装（段序/空段省略/截断语义）、URL 构造（仅 q 参数、无 autosend）、
 * 内联序列化与单测同一实现、REVIEW_HTML 布点与 origin 拼接构造（无 http(s)://
 * 外链字面纪律）。
 */
import { describe, expect, it } from 'vitest'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'
import { buildDeepSeekPrompt, buildDeepSeekUrl, DEEPSEEK_ASK_MAX_CHARS, trimAsk } from '../../src/client/review/ask-deepseek.ts'
import type { DeepSeekAskInput } from '../../src/client/review/ask-deepseek.ts'

/** DeepSeek web 真实 origin——只允许出现在测试内（REVIEW_HTML 以拼接构造保持零字面）。 */
const DS_ORIGIN = 'https://chat.deepseek.com'

const CLOSING = '请结合以上复盘信息，分析该标的的题材逻辑与短线关注点。（研究辅助，不构成投资建议。）'
const TRUNCATION_MARK = '……（内容超长已截断）'

function baseInput(overrides?: Partial<DeepSeekAskInput>): DeepSeekAskInput {
  return {
    code: 'sz001231',
    name: '农心科技',
    tradeDate: '2026-10-13',
    labels: ['虫害防治', '农药', '大农业'],
    limitText: '按源业务日 2026-10-13 · 乡村振兴（公司主要从事农药原药和制剂产品的研发、生产、销售）',
    note: '农业避险题材的',
    ...overrides,
  }
}

describe('问 DeepSeek：提示词组装（卡片级——owner 2026-10-14 修订）', () => {
  it('完整输入：段序 = 标的/交易日/题材/涨停原因/我的补充/结语（结语带研究辅助定位）', () => {
    expect(buildDeepSeekPrompt(baseInput())).toBe([
      '【标的】sz001231 农心科技',
      '【交易日】2026-10-13',
      '【题材】虫害防治、农药、大农业',
      '【涨停原因】按源业务日 2026-10-13 · 乡村振兴（公司主要从事农药原药和制剂产品的研发、生产、销售）',
      '【我的补充】农业避险题材的',
      CLOSING,
    ].join('\n'))
  })

  it('卡片级语义：MUST NOT 出现当日多卡片段（无 cardBodies 入参与【当日卡片】段落）', () => {
    const prompt = buildDeepSeekPrompt(baseInput({ note: '观察\n第二行' }))
    expect(prompt).toContain('【我的补充】观察\n第二行')
    expect(prompt).not.toContain('【当日卡片】')
    expect(prompt).not.toContain('cardBodies')
  })

  it('空段整段省略：仅代码时只余标的首行与结语；名称空白由调用方置 null', () => {
    const prompt = buildDeepSeekPrompt(baseInput({
      name: null, tradeDate: null, labels: [], limitText: null, note: '',
    }))
    expect(prompt).toBe('【标的】sz001231\n' + CLOSING)
    expect(buildDeepSeekPrompt(baseInput({ name: '   ' }))).not.toContain('农心科技')
  })

  it('超长截断只落在输入内容上：总长恰为预算，固定段与结语保留', () => {
    const prompt = buildDeepSeekPrompt(baseInput({ note: '观'.repeat(2000) }))
    expect(prompt.length).toBe(DEEPSEEK_ASK_MAX_CHARS)
    expect(prompt).toContain('【标的】sz001231 农心科技')
    expect(prompt).toContain('【涨停原因】')
    expect(prompt).toContain(TRUNCATION_MARK)
    expect(prompt.endsWith(CLOSING)).toBe(true)
  })

  it('固定段自身超预算：保底整体截断并加标注（结语被切，标注收尾）', () => {
    const prompt = buildDeepSeekPrompt(baseInput({
      labels: [], limitText: '涨'.repeat(1500), note: '',
    }))
    expect(prompt.length).toBe(DEEPSEEK_ASK_MAX_CHARS)
    expect(prompt.endsWith(TRUNCATION_MARK)).toBe(true)
  })

  it('预算常量 = 800（对齐 DeepSeek autosend 量纲）', () => {
    expect(DEEPSEEK_ASK_MAX_CHARS).toBe(800)
  })
})

describe('问 DeepSeek：URL 构造', () => {
  it('仅 q 参数全量编码；不带 autosend/mode/search/thinking（发送由用户确认，不代选偏好）', () => {
    const url = buildDeepSeekUrl(DS_ORIGIN, '测试 提示&词?')
    expect(url).toBe(DS_ORIGIN + '/?q=' + encodeURIComponent('测试 提示&词?'))
    expect(url.startsWith(DS_ORIGIN + '/?q=')).toBe(true)
    expect(url).not.toContain('autosend')
    expect(url).not.toContain('mode=')
  })
})

describe('问 DeepSeek：内联序列化与单测同一实现（与 thread-tag/image-draft 同范式）', () => {
  it('序列化后的组装函数在注入常量下行为一致（常规输入 + 截断输入）', () => {
    const inlinePrompt = new Function(
      'DEEPSEEK_ASK_MAX_CHARS', 'trimAsk',
      'return (' + buildDeepSeekPrompt.toString() + ')',
    )(DEEPSEEK_ASK_MAX_CHARS, trimAsk) as typeof buildDeepSeekPrompt
    expect(inlinePrompt(baseInput())).toBe(buildDeepSeekPrompt(baseInput()))
    const longInput = baseInput({ note: '观'.repeat(2000) })
    expect(inlinePrompt(longInput)).toBe(buildDeepSeekPrompt(longInput))
  })

  it('REVIEW_HTML 内联三个函数源码与预算常量', () => {
    expect(REVIEW_HTML).toContain(trimAsk.toString())
    expect(REVIEW_HTML).toContain(buildDeepSeekPrompt.toString())
    expect(REVIEW_HTML).toContain(buildDeepSeekUrl.toString())
    expect(REVIEW_HTML).toContain('var DEEPSEEK_ASK_MAX_CHARS = 800;')
  })
})

describe('REVIEW_HTML：问DeepSeek 鲸鱼图标布点与接线（B3 插图图标旁——2026-10-14 修订）', () => {
  const b2 = REVIEW_HTML.slice(REVIEW_HTML.indexOf('id="rv-b2"'), REVIEW_HTML.indexOf('id="rv-b3"'))
  const b3 = REVIEW_HTML.slice(REVIEW_HTML.indexOf('id="rv-b3"'), REVIEW_HTML.indexOf('id="rv-b4"'))

  it('按钮在 B3 内、插图图标之后；MUST NOT 回到 B2 整理旁', () => {
    expect(b3).toContain('id="rv-ask-ds"')
    expect(b2).not.toContain('id="rv-ask-ds"')
    expect(b3.indexOf('id="rv-image-pick"')).toBeLessThan(b3.indexOf('id="rv-ask-ds"'))
  })

  it('形态与插图入口同款：圆形 rv-icon-btn + 官方鲸鱼 path（currentColor 随按钮色态）', () => {
    const btn = b3.slice(b3.indexOf('id="rv-ask-ds"'), b3.indexOf('id="rv-ask-ds"') + 4200)
    expect(btn).toContain('class="rv-icon-btn"')
    expect(btn).toContain('<svg viewBox="0 0 50 50" width="16" height="16" fill="currentColor"')
    expect(btn).toContain('fill="currentColor"') // 鲸鱼随色态
    expect(btn).not.toContain('xmlns') // 离线自包含：无命名空间 URL 字面
    expect(REVIEW_HTML).toContain('#rv-ask-ds { margin-top: 6px; margin-left: 6px; }')
  })

  it('只读动作布点：仅要求有效标的，MUST NOT 挂 writable 门禁（只读态可用）', () => {
    expect(REVIEW_HTML).toContain("byId('rv-ask-ds').disabled = currentCode === null")
    expect(REVIEW_HTML).not.toContain("byId('rv-ask-ds').disabled = !writable")
  })

  it('origin 拼接构造（无外链字面纪律——同 treeid 先例）；window.open 以 _blank 打开', () => {
    expect(REVIEW_HTML).toContain("var dsOrigin = 'https:' + '//chat.deepseek.com'")
    expect(REVIEW_HTML).toContain("window.open(buildDeepSeekUrl(dsOrigin, prompt), '_blank')")
  })

  it('降级复制接线：window.open 返回 null 时 copyText 提示手动访问；opener 置空', () => {
    expect(REVIEW_HTML).toContain('copyText(prompt, function (ok) {')
    expect(REVIEW_HTML).toContain('若 DeepSeek 未自动打开，请手动访问 chat.deepseek.com 粘贴发送')
    expect(REVIEW_HTML).toContain('win.opener = null')
  })

  it('输入采集布点：名称/题材 chips（指数页置空）/涨停正文/输入框现状；无卡片列表消费', () => {
    expect(REVIEW_HTML).toContain("querySelectorAll('.tag')")
    expect(REVIEW_HTML).toContain('if (isIndexPage()) labels = [];')
    expect(REVIEW_HTML).toContain("querySelector('.limit-body')")
    expect(REVIEW_HTML).toContain('note: byId(\'rv-input\').value,')
    expect(REVIEW_HTML).not.toContain('currentCards')
  })
})
