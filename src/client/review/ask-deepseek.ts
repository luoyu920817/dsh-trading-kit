/**
 * 问 DeepSeek 跳转（owner 2026-10-13「添加一个问DeepSeek的选项——点击将当前卡片
 * 的内容结合最上面的标的、题材和涨停情况的内容，以 url 跳转的形式弹框到 DS 的
 * web 端」；2026-10-14 修订：**卡片级别询问**——只带 B3 输入框正在写的这一张卡，
 * 不捆绑当日多卡片；按钮 = B3 插图图标旁的圆形鲸鱼图标，与插图入口同款）。
 * 与 thread-tag.ts/image-draft.ts 同范式：浏览器内联与单测共用纯函数——ES2017
 * 保守子集（var/function、函数体内无可选链/模板字符串/箭头函数），可被
 * toString() 序列化进 REVIEW_HTML。
 *
 * URL 契约（chat.deepseek.com 主 bundle 实证 2026-10-13，tracker 事件「通过 query
 * 参数唤起网页」）：根路径读 query 的 `q`（或 `prompt`）预填输入框，读取后参数从
 * 地址栏清除并以 pending intent 持久化；`autosend=1` 仅在 ≤800 字符时自动发送。
 * 本跳转不带 autosend（预填即达目的，发送由用户确认）。图片不传递（契约无图片
 * 通道；剪贴板接力留待后续迭代）。
 *
 * origin 纪律：REVIEW_HTML 无 http(s):// 外链字面（同 treeid 先例，页面以拼接
 * 构造）——本模块以参数收 origin，真实 origin 字面只允许出现在测试内。
 */

/** 提示词预算（字符数）：对齐 DeepSeek autosend 的 800 字符量纲；超出优先截断输入内容。 */
export var DEEPSEEK_ASK_MAX_CHARS = 800

/** 问 DeepSeek 输入（页面在点击时从 B1 标的头部与 B3 输入区现状采集）。 */
export interface DeepSeekAskInput {
  /** 已限定代码（如 sz001231；调用方保证非空）。 */
  code: string
  /** 标的名称（未获取时 null）。 */
  name: string | null
  /** 交易日（YYYY-MM-DD 或 null——未定时省略该段）。 */
  tradeDate: string | null
  /** 题材标签（指数/锚点页调用方传空数组）。 */
  labels: string[]
  /** 涨停原因正文（未取得时 null）。 */
  limitText: string | null
  /** B3 输入框正在写的卡片内容（可为空串）。 */
  note: string
}

/** 首尾空白收口（序列化内联进页面，供 buildDeepSeekPrompt 复用；与页面既有 trim 独立）。 */
export function trimAsk(v: string): string {
  return v.replace(/^\s+|\s+$/g, '')
}

/**
 * 组装问 DeepSeek 的提示词。
 * 业务逻辑: 固定段（标的/交易日/题材/涨停原因）在前，【我的补充】= 正在写的卡片
 * 内容，结语收尾；超出预算时只截断卡片内容并显式标注——标的、涨停原因与结语
 * MUST NOT 被截掉。
 * 关键判断: 空段（无名称/无日期/无标签/无涨停/空输入框）整段省略；卡片内容为空
 * 时跳转仍然可用（纯标的问询）；结语固定携带「研究辅助，不构成投资建议」定位
 * （沿整理指令模板口径）。
 * 异常处理: 各字段按 null/空串防御；预算耗尽时保底整体截断加标注。
 * 参数: input为页面采集的问询输入。
 * 返回: 待预填进 DeepSeek 输入框的提示词全文。
 */
export function buildDeepSeekPrompt(input: DeepSeekAskInput): string {
  var lines: string[] = []
  var header = '【标的】' + input.code
  if (input.name !== null && trimAsk(input.name) !== '') header += ' ' + trimAsk(input.name)
  lines.push(header)
  if (input.tradeDate !== null && trimAsk(input.tradeDate) !== '') lines.push('【交易日】' + input.tradeDate)
  if (input.labels.length > 0) lines.push('【题材】' + input.labels.join('、'))
  if (input.limitText !== null && trimAsk(input.limitText) !== '') lines.push('【涨停原因】' + input.limitText)
  var fixed = lines.join('\n')
  var closing = '\n请结合以上复盘信息，分析该标的的题材逻辑与短线关注点。（研究辅助，不构成投资建议。）'
  var mark = '……（内容超长已截断）'
  var notePrefix = '\n【我的补充】'
  if (trimAsk(input.note) === '') {
    var bare = fixed + closing
    if (bare.length <= DEEPSEEK_ASK_MAX_CHARS) return bare
    return bare.slice(0, DEEPSEEK_ASK_MAX_CHARS - mark.length) + mark
  }
  var full = fixed + notePrefix + input.note + closing
  if (full.length <= DEEPSEEK_ASK_MAX_CHARS) return full
  var budget = DEEPSEEK_ASK_MAX_CHARS - fixed.length - closing.length - notePrefix.length - mark.length
  if (budget <= 0) return (fixed + closing).slice(0, DEEPSEEK_ASK_MAX_CHARS - mark.length) + mark
  return fixed + notePrefix + input.note.slice(0, budget) + mark + closing
}

/**
 * 构造 DeepSeek web 预填跳转 URL。
 * 业务逻辑: origin 根路径拼 `q` 参数（encodeURIComponent 全量编码）。
 * 关键判断: 不带 autosend——预填后发送由用户确认；不带 mode/search/thinking——
 * 沿用户在 DS 侧的既有会话偏好，页面不越权代选。
 * 异常处理: 无（输入为纯字符串拼接）。
 * 参数: origin为 DS web 源（页面以拼接构造传入，模块零字面），prompt为提示词全文。
 * 返回: window.open 用的完整 URL。
 */
export function buildDeepSeekUrl(origin: string, prompt: string): string {
  return origin + '/?q=' + encodeURIComponent(prompt)
}
