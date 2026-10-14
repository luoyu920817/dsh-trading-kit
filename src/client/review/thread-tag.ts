/**
 * 思考线条标签（owner 2026-10-13「交易日下方一排单选框，为卡片打当前思考线条标签」）。
 * 与 image-draft.ts 同范式：浏览器内联与单测共用纯函数——ES2017 保守子集
 * （var/function、无可选链/模板字符串/箭头函数体内禁用），可被 toString()
 * 序列化进 REVIEW_HTML；候选常量经 JSON.stringify 注入。
 *
 * 工作流语义：五个盘后标签与 review-loop 四段（index 指数 / sentiment 情绪 /
 * moneyEffect 赚钱效应 / theme 题材）及锚点领域词汇（情绪周期/赚钱效应）对齐，
 * 另补「模式」（pattern-unification 模式归纳线）与「盘中」（owner 2026-10-13
 * 追授——盘中思考的记录线）。卡片末行带 #标签 后，后续分析可按标签把同一
 * 思考线的卡片串联起来。
 */

/** 思考线条候选（顺序 = 页面单选行排布顺序）。 */
export var THREAD_TAGS = ['指数', '情绪周期', '题材', '赚钱效应', '模式', '盘中']

/** 「保留上一次」的存储键（localStorage）。 */
export var THREAD_STORAGE_KEY = 'rvThreadTag'

/** 存储形态（页面传 window.localStorage，测试传普通对象）。 */
export interface ThreadStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/**
 * 读取上一次的思考线条选择。
 * 业务逻辑: 从页面持久化存储恢复「保留上一次」，页面加载即回填单选行。
 * 关键判断: 只接受候选内取值——候选调整后旧存值按未选处理。
 * 异常处理: storage 缺失（隐私态/取属性被禁）或读取抛错都返回 null。
 * 参数: storage为页面注入的存储（可为 null）。
 * 返回: 有效的思考线条标签或 null（未选）。
 */
export function loadThreadTag(storage: ThreadStorage | null): string | null {
  if (!storage) return null
  var value: string | null = null
  try {
    value = storage.getItem(THREAD_STORAGE_KEY)
  } catch (e) {
    value = null
  }
  if (value === null) return null
  return THREAD_TAGS.indexOf(value) >= 0 ? value : null
}

/**
 * 保存思考线条选择。
 * 业务逻辑: 每次切换单选即落存储，跨会话保留上一次。
 * 关键判断: 只在 storage 可用时持久化。
 * 异常处理: 写入抛错（配额/禁用）静默放弃——本会话选择仍然生效。
 * 参数: storage为页面注入的存储（可为 null），value为本次选中的标签。
 * 返回: 无。
 */
export function saveThreadTag(storage: ThreadStorage | null, value: string): void {
  if (!storage) return
  try {
    storage.setItem(THREAD_STORAGE_KEY, value)
  } catch (e) {
    /* 持久化不可用——仅当前会话生效 */
  }
}

/**
 * 在卡片正文末行追加思考线条标签。
 * 业务逻辑: 提交时把当前选中的标签作为独立末行（如 #指数）附到正文之后。
 * 关键判断: 正文已含同名标签（手打或失败重试复跑）不重复追加，保持幂等；
 * 先去尾部空白再另起一行，保证标签独立成末行。
 * 异常处理: 未选或标签不在候选内时原样返回。
 * 参数: text为输入框正文（调用方保证非空），tag为当前选中的思考线条。
 * 返回: 待保存的最终正文。
 */
export function appendThreadTag(text: string, tag: string | null): string {
  if (tag === null || THREAD_TAGS.indexOf(tag) < 0) return text
  if (text.indexOf('#' + tag) >= 0) return text
  var trimmed = text.replace(/\s+$/, '')
  return trimmed + '\n' + '#' + tag
}
