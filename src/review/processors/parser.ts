/**
 * 关键词标记解析常量与纯函数（@语法第一版，沿前版明确语法）。
 * 本文件零副作用：不读文件、不发请求、不登记任务、不调用模型；仅消费传入正文与别名表。
 * 忽略区段判定沿 src/review/image-refs.ts 的逐行扫描与原文跨度做法。
 */
import type { Mention, ParsedMentions, RecognizedMention } from './types.ts'

/**
 * 允许开启标记的前置标点表（前版语法：成对括号开口侧与中英文标点）。
 * 空白与正文/行首在 parseMentions 内单独认定；闭括号不在此表，故闭括号紧邻的 @ 不触发。
 */
const mentionBoundaryValues = [
  '（', '(', '[', '【', '{', '、', '，', ',', '；', ';', '：', ':', '。', '！', '？', '!', '?',
]

/**
 * 创建无法暴露底层可变 Set 的只读边界快照。
 * 业务逻辑: 保留查询、迭代与 forEach；所有读操作委托私有 Set。
 * 关键判断: 不导出 add/delete/clear，forEach 第三个参数也只能看到快照。
 * 异常处理: 回调抛错按原生 Set 语义传递，冻结阻止修改导出方法。
 * 参数: values 为边界字符。返回: 冻结的 ReadonlySet。
 */
function createMentionBoundarySet(values: readonly string[]): ReadonlySet<string> {
  const set = new Set(values)
  const snapshot: ReadonlySet<string> = {
    size: set.size,
    has: set.has.bind(set),
    entries: set.entries.bind(set),
    keys: set.keys.bind(set),
    values: set.values.bind(set),
    [Symbol.iterator]: set[Symbol.iterator].bind(set),
    /**
     * 遍历边界快照。
     * 业务逻辑: 原序遍历并向回调传递只读快照。
     * 关键判断: 不将底层 Set 交给外部回调。
     * 异常处理: 回调异常原样传播。
     * 参数: callbackfn 为回调，thisArg 为其上下文。返回: 无。
     */
    forEach(callbackfn, thisArg) {
      for (const value of set) callbackfn.call(thisArg, value, value, snapshot)
    },
  }
  return Object.freeze(snapshot)
}

export const MENTION_BOUNDARY_PUNCTUATION = createMentionBoundarySet(mentionBoundaryValues)

/** 标记名字符：中文（Han script，含扩展区与星面）、英文字母、数字、下划线、连字符；u 标志保证星面字符按码点匹配。 */
export const MENTION_NAME_CHAR = /[\p{Script=Han}A-Za-z0-9_-]/u

/** 标记名最大长度（Unicode 码点）；超长名字整段不作为标记，不截短成已注册前缀。 */
export const MENTION_NAME_MAX_CODE_POINTS = 32

/**
 * 查找精确长度的反引号闭合串，可跨行。
 * 业务逻辑: 每次消费完整反引号串，只允许同长度闭合。
 * 关键判断: 长串内部的子串不能关闭短串；未闭合返回 -1。
 * 异常处理: 缺失闭合按普通正文降级，不吞掉后续内容。
 * 参数: body 为原文，start 为开口，length 为串长度。返回: 闭合起点或 -1。
 */
function findMentionCodeClose(body: string, start: number, length: number): number {
  let cursor = start + length
  while (cursor < body.length) {
    const next = body.indexOf('`', cursor)
    if (next < 0) return -1
    let end = next
    while (body[end] === '`') end++
    if (end - next === length) return next
    cursor = end
  }
  return -1
}

/**
 * 查找 Markdown 嵌套括号或方括号的闭合位置。
 * 业务逻辑: 跟踪括号层级；目标的引号 title 内不解释括号，反斜杠跳过其后一字符。
 * 关键判断: 图片 alt 支持嵌套方括号；目标支持嵌套括号与单双引号 title。
 * 异常处理: 未闭合返回 -1，由调用方保留既有降级行为。
 * 参数: text 为本行，start 为开括号，open/close 为括号字符，titles 是否支持 title。
 * 返回: 配对闭括号的位置或 -1。
 */
function findMentionBracketClose(text: string, start: number, open: string, close: string, titles: boolean): number {
  let depth = 1
  let quote = ''
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    const char = text[cursor]
    if (char === '\\') {
      cursor++
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (titles && (char === '"' || char === "'") && /\s/.test(text[cursor - 1])) {
      quote = char
      continue
    }
    if (char === open) depth++
    else if (char === close && --depth === 0) return cursor
  }
  return -1
}

/**
 * 解析正文中的关键词标记并按别名表分类。
 * 业务逻辑: 逐行扫描原正文（行含换行符，偏移随行累计），先整体跳过不可触发区段——围栏代码块
 *   （按围栏字符与长度配对开合且闭合尾部仅空白）、引用块整行、代码跨度（精确长度反引号串跨行配对，未闭合仅跳过反引号串本身）、
 *   bare http/https URL（至行内首个空白止）、Markdown 链接目标 `](`…`)`、图片 `![alt](target)` 与
 *   Obsidian 嵌入 `![[…]]`（整体跳过）——再在其余区段识别 ASCII `@` 加连续名字字符。
 * 关键判断: @ 前必须是正文/行首、空白或边界标点表中的字符；核查边界时越过紧邻的整段反斜杠，
 *   奇数个连续反斜杠为转义文本不触发，偶数个不阻断（反斜杠本身保留在正文，不进 raw）；
 *   名字按 Unicode 码点计数 1–32，超长或无名字（编辑中的未完成输入）均不产生提及；
 *   全名精确匹配 aliases，不做最长前缀触发；别名表里无法构成的键静默不匹配。
 * 异常处理: 对任意输入不抛错、不产出告警；同一输入重复解析结果一致。
 * 参数: body 为保存后的实际正文（偏移基准，不做归一化）；aliases 为完整关键词名→受控 processorId。
 * 返回: recognized/unknown 两组提及（各自按扫描顺序排列），每项 raw 含 @ 且 body.slice(start,end)===raw；
 *   已注册项另含 processorId，未知项原文保留。多标记多跨度全部保留，去重由模块输入/请求层处理。
 */
export function parseMentions(body: string, aliases: ReadonlyMap<string, string>): ParsedMentions {
  const recognized: RecognizedMention[] = []
  const unknown: Mention[] = []
  let offset = 0
  let skipUntil = 0
  // fence 记录当前打开的围栏串（如 ``` 或 ~~~~），null 表示不在围栏内。
  let fence: string | null = null
  for (const line of body.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const fenceMarker = offset >= skipUntil ? /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line) : null
    if (fenceMarker) {
      // 闭合行只能带空白；带信息串的围栏行仍在代码区段。
      if (!fence) fence = fenceMarker[1]
      else if (fenceMarker[1][0] === fence[0] && fenceMarker[1].length >= fence.length && /^\s*$/.test(fenceMarker[2])) fence = null
      offset += line.length
      continue
    }
    if (fence) {
      offset += line.length
      continue
    }
    // 引用块整行不触发，避免摘录旧观点带来新任务。
    if (offset >= skipUntil && /^ {0,3}>/.test(line)) {
      offset += line.length
      continue
    }
    let i = Math.max(0, skipUntil - offset)
    while (i < line.length) {
      if (line[i] === '`') {
        // 精确串长度跨行配对；未闭合时只跳过开口串。
        const run = /^`+/.exec(line.slice(i))![0]
        const close = findMentionCodeClose(body, offset + i, run.length)
        if (close < 0) i += run.length
        else {
          skipUntil = close + run.length
          i = skipUntil - offset
        }
        continue
      }
      if (line.startsWith('![[', i)) {
        // Obsidian 嵌入整体跳过；未闭合只跳过起始标记，退化为普通文本扫描。
        const close = line.indexOf(']]', i + 3)
        i = close < 0 ? i + 3 : close + 2
        continue
      }
      if (line.startsWith('![', i)) {
        // 图片整体跳过（alt 与目标都不是卡片正文）；找不到 alt 闭合时只跳过起始标记。
        const altClose = findMentionBracketClose(line, i + 1, '[', ']', false)
        if (altClose < 0) {
          i += 2
          continue
        }
        if (line[altClose + 1] === '(') {
          const targetClose = findMentionBracketClose(line, altClose + 1, '(', ')', true)
          i = targetClose < 0 ? line.length : targetClose + 1
        } else {
          i = altClose + 1
        }
        continue
      }
      if (line[i] === ']' && line[i + 1] === '(') {
        // Markdown 链接目标跳过；链接文本已在此前正常扫描。目标未闭合则吞掉本行余文。
        const targetClose = findMentionBracketClose(line, i + 1, '(', ')', true)
        i = targetClose < 0 ? line.length : targetClose + 1
        continue
      }
      if ((line[i] === 'h' || line[i] === 'H') && /^https?:\/\//i.test(line.slice(i, i + 8))) {
        // bare URL（协议大小写不敏感）至行内首个空白止；URL 内不触发标记。
        // 字符守卫加限长切片：外层逐字符扫描若整段 slice 会退化为 O(n²) 复制。
        while (i < line.length && !/\s/.test(line[i])) i++
        continue
      }
      if (line[i] === '@') {
        let backslashes = 0
        while (i - 1 - backslashes >= 0 && line[i - 1 - backslashes] === '\\') backslashes++
        const runStart = i - backslashes
        // 边界核查越过整段反斜杠：偶数反斜杠（含 0 个）不阻断，奇数为转义文本。
        const boundaryOk =
          runStart === 0 ||
          (() => {
            const prev = line[runStart - 1]
            return MENTION_BOUNDARY_PUNCTUATION.has(prev) || /\s/.test(prev)
          })()
        if (boundaryOk && backslashes % 2 === 0) {
          // 名字按码点消费：星面字符占两个 UTF-16 单元但计 1 个码点。
          let p = i + 1
          let codePoints = 0
          while (p < line.length) {
            const code = line.codePointAt(p)!
            if (!MENTION_NAME_CHAR.test(String.fromCodePoint(code))) break
            p += code > 0xffff ? 2 : 1
            codePoints++
          }
          if (codePoints === 0) {
            // 只有 @ 没有名字是编辑中的未完成输入，不产生提及。
            i++
            continue
          }
          if (codePoints > MENTION_NAME_MAX_CODE_POINTS) {
            // 超长名字整段不作为标记，继续按普通文本扫描，不截短成已注册前缀。
            i = p
            continue
          }
          const name = line.slice(i + 1, p)
          const processorId = aliases.get(name)
          if (processorId === undefined) {
            unknown.push(Object.freeze({ raw: line.slice(i, p), name, start: offset + i, end: offset + p }))
          } else {
            recognized.push(Object.freeze({ raw: line.slice(i, p), name, start: offset + i, end: offset + p, processorId }))
          }
          i = p
          continue
        }
        i++
        continue
      }
      i++
    }
    offset += line.length
  }
  // 冻结结果与条目，向调用方表达只读契约，避免共享数组被原地改动。
  return Object.freeze({ recognized: Object.freeze(recognized), unknown: Object.freeze(unknown) })
}

/**
 * 生成内联复盘页可直接嵌入的浏览器解析脚本。
 * 业务逻辑: 序列化同一解析函数及所有 helper，并补齐只读边界与名字常量。
 * 关键判断: 不维护第二套正则解析器；脚本只声明 parseMentions，不执行解析或外部操作。
 *   函数本体维持 ES2017 语法基线，Han Unicode 正则沿宿主 Chromium 81 能力。
 * 异常处理: 源函数序列化使用运行时原生 toString；调用方构建失败直接暴露，不降级到不同语法。
 * 参数: 无。返回: 自包含的 JavaScript 源码字符串。
 */
export function createMentionParserScript(): string {
  return [
    `var mentionBoundaryValues = ${JSON.stringify(mentionBoundaryValues)};`,
    `var createMentionBoundarySet = ${createMentionBoundarySet.toString()};`,
    'var MENTION_BOUNDARY_PUNCTUATION = createMentionBoundarySet(mentionBoundaryValues);',
    `var MENTION_NAME_CHAR = ${MENTION_NAME_CHAR.toString()};`,
    `var MENTION_NAME_MAX_CODE_POINTS = ${MENTION_NAME_MAX_CODE_POINTS};`,
    `var findMentionCodeClose = ${findMentionCodeClose.toString()};`,
    `var findMentionBracketClose = ${findMentionBracketClose.toString()};`,
    `var parseMentions = ${parseMentions.toString()};`,
  ].join('\n')
}
