import { describe, expect, expectTypeOf, it, test } from 'vitest'
import ts from 'typescript'
import * as mentionParser from '../../src/review/processors/parser.ts'
import {
  MENTION_BOUNDARY_PUNCTUATION,
  MENTION_NAME_CHAR,
  MENTION_NAME_MAX_CODE_POINTS,
  parseMentions,
} from '../../src/review/processors/parser.ts'
import type { ParseMentions } from '../../src/review/processors/types.ts'

/**
 * 表驱动用例的期望跨度。
 * raw 为含 @ 的原文；start/end 为 body 内 UTF-16 半开区间；processorId 仅 recognized 携带。
 */
interface ExpectSpan {
  readonly raw: string
  readonly name: string
  readonly start: number
  readonly end: number
  readonly processorId?: string
}

/** 一条解析用例：正文、别名表与两组期望结果（均按扫描顺序给出精确跨度）。 */
interface ParseCase {
  readonly label: string
  readonly body: string
  readonly aliases: Readonly<Record<string, string>>
  readonly recognized: readonly ExpectSpan[]
  readonly unknown: readonly ExpectSpan[]
}

/**
 * 运行一组解析用例并断言完整契约。
 * 业务逻辑: 每个用例重复解析一次验证确定性（纯函数、零文件/HTTP/任务/模型副作用的可观察证明），
 *   再逐字段比对 recognized/unknown，并对所有提及断言原文切片往返与名字派生。
 * 关键判断: unknown 不得携带 processorId；start/end 必须落在正文范围内且 body.slice(start,end)===raw。
 * 异常处理: 解析对任意输入不抛错，断言失败由 vitest 以用例标签报告。
 * 参数: cases 为用例表。返回: 无。
 */
function runCases(cases: readonly ParseCase[]): void {
  for (const c of cases) {
    const aliases = new Map(Object.entries(c.aliases))
    const parsed = parseMentions(c.body, aliases)
    expect(parseMentions(c.body, aliases), c.label).toEqual(parsed)
    expect(
      parsed.recognized.map((m) => ({ raw: m.raw, name: m.name, start: m.start, end: m.end, processorId: m.processorId })),
      c.label,
    ).toEqual(c.recognized)
    expect(parsed.unknown.map((m) => ({ raw: m.raw, name: m.name, start: m.start, end: m.end })), c.label).toEqual(c.unknown)
    for (const m of parsed.unknown) expect('processorId' in m, `${c.label} unknown 不带模块编号`).toBe(false)
    for (const m of [...parsed.recognized, ...parsed.unknown]) {
      expect(Object.isFrozen(m), c.label).toBe(true)
      expect(m.raw.startsWith('@'), `${c.label} raw 含 @`).toBe(true)
      expect(m.name, `${c.label} name 派生自 raw`).toBe(m.raw.slice(1))
      expect(m.start, `${c.label} 起点非负`).toBeGreaterThanOrEqual(0)
      expect(m.end, `${c.label} 终点不越界`).toBeLessThanOrEqual(c.body.length)
      expect(c.body.slice(m.start, m.end), `${c.label} 原文切片`).toBe(m.raw)
    }
  }
}

/** 默认别名表：仅“预期”注册到 expectation；测试使用它不代表生产模块已登记。 */
const A = { 预期: 'expectation' }

test('完整名字和原文偏移，未知名字不误命中前缀', () => {
  const body = '😀 @预期 明天观察；@预期差 保留原文'
  const aliases = new Map([['预期', 'expectation']])
  const parsed = parseMentions(body, aliases)
  expect(parsed.recognized.map((x) => x.name)).toEqual(['预期'])
  expect(parsed.unknown.map((x) => x.name)).toEqual(['预期差'])
  for (const mention of [...parsed.recognized, ...parsed.unknown]) {
    expect(body.slice(mention.start, mention.end)).toBe(mention.raw)
  }
})

describe('识别、完整名匹配与多标记保留', () => {
  it('表驱动回归', () => {
    runCases([
      { label: '空正文', body: '', aliases: A, recognized: [], unknown: [] },
      { label: '无标记正文', body: '今天没有标记', aliases: A, recognized: [], unknown: [] },
      { label: '空别名表全部未知', body: '@预期 概念', aliases: {}, recognized: [], unknown: [{ raw: '@预期', name: '预期', start: 0, end: 3 }] },
      {
        label: '正文起始标记',
        body: '@预期 明天回查',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '行中标记',
        body: '明天回查 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 5, end: 8, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '更长名字不截断为已注册前缀',
        body: '@预期指数',
        aliases: A,
        recognized: [],
        unknown: [{ raw: '@预期指数', name: '预期指数', start: 0, end: 5 }],
      },
      {
        label: '全名优先：注册名完整匹配最长候选',
        body: '@预期指数 和 @预期',
        aliases: { 预期: 'expectation', 预期指数: 'index' },
        recognized: [
          { raw: '@预期指数', name: '预期指数', start: 0, end: 5, processorId: 'index' },
          { raw: '@预期', name: '预期', start: 8, end: 11, processorId: 'expectation' },
        ],
        unknown: [],
      },
      {
        label: '紧邻名字字符的第二个@不触发',
        body: '@预期@概念',
        aliases: { 预期: 'expectation', 概念: 'concept' },
        recognized: [{ raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '中文顿号分隔的连续标记',
        body: '@预期、@概念',
        aliases: { 预期: 'expectation', 概念: 'concept' },
        recognized: [
          { raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' },
          { raw: '@概念', name: '概念', start: 4, end: 7, processorId: 'concept' },
        ],
        unknown: [],
      },
      {
        label: '半角逗号分隔的连续标记',
        body: '@预期,@概念',
        aliases: { 预期: 'expectation', 概念: 'concept' },
        recognized: [
          { raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' },
          { raw: '@概念', name: '概念', start: 4, end: 7, processorId: 'concept' },
        ],
        unknown: [],
      },
      {
        label: '同一别名多跨度全部保留',
        body: '@预期 与 @预期',
        aliases: A,
        recognized: [
          { raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' },
          { raw: '@预期', name: '预期', start: 6, end: 9, processorId: 'expectation' },
        ],
        unknown: [],
      },
      {
        label: '同模块多别名均指向同一模块',
        body: '@预期 @看多',
        aliases: { 预期: 'expectation', 看多: 'expectation' },
        recognized: [
          { raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' },
          { raw: '@看多', name: '看多', start: 4, end: 7, processorId: 'expectation' },
        ],
        unknown: [],
      },
      { label: '全角＠不触发', body: '＠预期', aliases: A, recognized: [], unknown: [] },
      { label: '双@无名字不触发', body: '@@预期', aliases: A, recognized: [], unknown: [] },
      { label: '孤立@是未完成输入', body: '看看 @ 结尾', aliases: A, recognized: [], unknown: [] },
      {
        label: '数字开头的名字',
        body: '@1预期',
        aliases: A,
        recognized: [],
        unknown: [{ raw: '@1预期', name: '1预期', start: 0, end: 4 }],
      },
      {
        label: '连字符下划线字母数字名字',
        body: '@a-b_C9',
        aliases: { 'a-b_C9': 'custom' },
        recognized: [{ raw: '@a-b_C9', name: 'a-b_C9', start: 0, end: 7, processorId: 'custom' }],
        unknown: [],
      },
      {
        label: '半角冒号后不是名字也不是配置',
        body: '@预期:三日',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '全角冒号后不是名字',
        body: '@预期：三日',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: 'emoji 结束名字且保持原文',
        body: '@预期😀备注',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '无法构成的别名键静默不匹配且不报错',
        body: '@预期',
        aliases: { 预期: 'expectation', '带!叹号': 'x' },
        recognized: [{ raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('名字长度按 Unicode 码点计，超长整段不作标记', () => {
    const name32 = '预'.repeat(32)
    const name33 = '预'.repeat(33)
    const astral32 = '𠀀'.repeat(32)
    const astral33 = '𠀀'.repeat(33)
    runCases([
      {
        label: '32码点中文名可注册可命中',
        body: `@${name32}`,
        aliases: { [name32]: 'long-name' },
        recognized: [{ raw: `@${name32}`, name: name32, start: 0, end: 33, processorId: 'long-name' }],
        unknown: [],
      },
      { label: '33码点中文名不是标记', body: `@${name33}`, aliases: { [name33]: 'long-name' }, recognized: [], unknown: [] },
      {
        label: '扩展B区汉字按1个码点计',
        body: '@𠀀字',
        aliases: { '𠀀字': 'ext-b' },
        recognized: [{ raw: '@𠀀字', name: '𠀀字', start: 0, end: 4, processorId: 'ext-b' }],
        unknown: [],
      },
      {
        label: '32码点星面名可命中',
        body: `@${astral32}`,
        aliases: { [astral32]: 'astral' },
        recognized: [{ raw: `@${astral32}`, name: astral32, start: 0, end: 65, processorId: 'astral' }],
        unknown: [],
      },
      { label: '33码点星面名不是标记', body: `@${astral33}`, aliases: { [astral33]: 'astral' }, recognized: [], unknown: [] },
      {
        label: 'emoji 直接跟随@不触发（非边界字符）',
        body: '😀@预期',
        aliases: A,
        recognized: [],
        unknown: [],
      },
    ])
  })
})

describe('前边界与导出常量表', () => {
  it('边界标点表中每个字符都开启标记', () => {
    const cases: ParseCase[] = [...MENTION_BOUNDARY_PUNCTUATION].map((ch) => ({
      label: `前边界 ${ch}`,
      body: `甲${ch}@预期`,
      aliases: A,
      recognized: [{ raw: '@预期', name: '预期', start: 2, end: 5, processorId: 'expectation' }],
      unknown: [],
    }))
    runCases(cases)
  })

  it('边界标点表内容与前版语法一致', () => {
    expect([...MENTION_BOUNDARY_PUNCTUATION].sort()).toEqual(
      ['（', '(', '[', '【', '{', '、', '，', ',', '；', ';', '：', ':', '。', '！', '？', '!', '?'].sort(),
    )
  })

  it('空白与行首是合法前边界', () => {
    runCases([
      {
        label: '空格前边界',
        body: '甲 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 2, end: 5, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '制表符前边界',
        body: '甲\t@预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 2, end: 5, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '行首前边界',
        body: '上一天\n@预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 4, end: 7, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('表外字符不开启标记', () => {
    const negatives = ['a', 'Z', '0', '_', '-', '预', '）', ']', '}', '\\', '＠', '😀', '.', 'Ａ']
    const cases: ParseCase[] = negatives.map((ch) => ({
      label: `非边界 ${JSON.stringify(ch)}`,
      body: `${ch}@预期`,
      aliases: A,
      recognized: [],
      unknown: [],
    }))
    cases.push(
      { label: '汉字紧邻不触发', body: '今天@预期上涨', aliases: A, recognized: [], unknown: [] },
      { label: '闭括号后需空白或分隔符', body: '（备注）@预期', aliases: A, recognized: [], unknown: [] },
    )
    runCases(cases)
  })

  it('名字字符表', () => {
    expect(MENTION_NAME_MAX_CODE_POINTS).toBe(32)
    const positives = ['预', '期', 'a', 'Z', '0', '9', '_', '-', '𠀀']
    for (const ch of positives) expect(MENTION_NAME_CHAR.test(ch), `名字字符 ${ch}`).toBe(true)
    const negatives = [' ', '@', '.', '、', '！', '/', 'Ａ', '＠', '😀', '，', '：']
    for (const ch of negatives) expect(MENTION_NAME_CHAR.test(ch), `非名字字符 ${ch}`).toBe(false)
  })
})

describe('反斜线逃逸', () => {
  it('奇数转义偶数触发，反斜杠不删除', () => {
    runCases([
      { label: '单反斜线转义', body: '\\@预期', aliases: A, recognized: [], unknown: [] },
      {
        label: '双反斜线正文起始触发',
        body: '\\\\@预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 2, end: 5, processorId: 'expectation' }],
        unknown: [],
      },
      { label: '三反斜线转义', body: '\\\\\\@预期', aliases: A, recognized: [], unknown: [] },
      {
        label: '四反斜线触发',
        body: '\\\\\\\\@预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 4, end: 7, processorId: 'expectation' }],
        unknown: [],
      },
      { label: '偶数反斜线但前字符非边界不触发', body: 'x\\\\@预期', aliases: A, recognized: [], unknown: [] },
      {
        label: '空白后偶数反斜线触发',
        body: ' \\\\@预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 3, end: 6, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })
})

describe('忽略区段', () => {
  it.each([
    '`a\n@预期\nb`',
    '``a ``` b ` @预期 c``',
    '```\n```text\n@预期\n```',
    '![a [b] @预期](x.png)',
    '[文档](note(a).md "title @预期")',
    '![alt](img(a).png "title @预期")',
    '[文档](note\\).md "title @预期")',
    'HTTPS://x.test/?@预期',
  ])('嵌套和跨行忽略区段不触发: %s', (body) => {
    expect(parseMentions(body, new Map(Object.entries(A)))).toEqual({ recognized: [], unknown: [] })
    expect(parseMentions(body, new Map())).toEqual({ recognized: [], unknown: [] })
  })

  it('导出边界表不能被运行时强制类型转换篡改', () => {
    expect('add' in MENTION_BOUNDARY_PUNCTUATION).toBe(false)
    expect('delete' in MENTION_BOUNDARY_PUNCTUATION).toBe(false)
    expect('clear' in MENTION_BOUNDARY_PUNCTUATION).toBe(false)
    expect(Object.isFrozen(MENTION_BOUNDARY_PUNCTUATION)).toBe(true)
    expect(MENTION_BOUNDARY_PUNCTUATION.has('（')).toBe(true)
  })

  it('围栏代码块整段跳过且按围栏字符长度配对', () => {
    runCases([
      {
        label: '反引号围栏含信息串',
        body: '```text\n@预期\n```\n尾 @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 18, end: 21, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: '波浪线围栏',
        body: '~~~\n@预期\n~~~\n@概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 12, end: 15, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: '短围栏线不能闭合长围栏',
        body: '````\n@预期\n```\n````\n@概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 18, end: 21, processorId: 'concept' }],
        unknown: [],
      },
      { label: '未闭合围栏吞掉余下正文', body: '前言\n```\n@预期\n@概念', aliases: A, recognized: [], unknown: [] },
    ])
  })

  it('行内代码按反引号串配对，未闭合按原文处理', () => {
    runCases([
      { label: '闭合行内代码跳过', body: '记录 `@预期` 完成', aliases: A, recognized: [], unknown: [] },
      {
        label: '多段行内代码后的正文标记',
        body: '`@预期` 前 `@概念` 后 @看多',
        aliases: { 看多: 'bullish' },
        recognized: [{ raw: '@看多', name: '看多', start: 16, end: 19, processorId: 'bullish' }],
        unknown: [],
      },
      {
        label: '未闭合行内代码不吞掉同线余文',
        body: '`x @预期 y',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 3, end: 6, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '紧贴未闭合反引号的标记仍被反引号挡住',
        body: '记录 `@预期 后 @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 10, end: 13, processorId: 'concept' }],
        unknown: [],
      },
    ])
  })

  it('引用块整行不触发', () => {
    runCases([
      { label: '单层引用', body: '> 昨天写了 @预期', aliases: A, recognized: [], unknown: [] },
      { label: '嵌套引用', body: '>> @预期', aliases: A, recognized: [], unknown: [] },
      {
        label: '引用行后的正文标记',
        body: '上一天\n> 引用 @预期\n今天 @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 16, end: 19, processorId: 'concept' }],
        unknown: [],
      },
    ])
  })

  it('URL 与邮箱不触发', () => {
    runCases([
      { label: 'URL 内标记跳过', body: '详情 https://x.com/@预期 已留档', aliases: A, recognized: [], unknown: [] },
      {
        label: 'URL 结束后的正文标记',
        body: '@概念 https://t.cn/@预期',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 0, end: 3, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: 'http URL 与其后标记',
        body: 'http://a.b/@预 c @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 16, end: 19, processorId: 'concept' }],
        unknown: [],
      },
      { label: '邮箱上下文', body: '联系 a@b.com 或 user@example.com', aliases: A, recognized: [], unknown: [] },
      {
        label: '邮箱之后中文标点分隔的标记',
        body: '联系 a@b.com，@预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 11, end: 14, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('链接目标跳过且链接文本正常扫描', () => {
    runCases([
      { label: '链接目标内的标记', body: '[文档](https://x.com/@预期)', aliases: A, recognized: [], unknown: [] },
      {
        label: '链接文本内的标记',
        body: '[看 @预期](notes.md)',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 3, end: 6, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '文本命中且目标内不命中',
        body: '[看 @预期](https://x.com/@b)',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 3, end: 6, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('图片引用与 Obsidian 嵌入整体跳过', () => {
    runCases([
      { label: '图片 alt 与目标都跳过', body: '![截图 @预期](files/a.png)', aliases: A, recognized: [], unknown: [] },
      { label: '嵌入引用内的标记', body: '![[files/@预期.png]]', aliases: A, recognized: [], unknown: [] },
      {
        label: '嵌入后的正文标记',
        body: '![[files/a.png]] @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 17, end: 20, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: '普通图片后的正文标记',
        body: '![alt](x.png) 后 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 16, end: 19, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('混合忽略区段只保留正文标记', () => {
    const lines = [
      '前言 @预期',
      '> 引用 @预期',
      '```ts',
      '代码 @预期',
      '```',
      '行内 `@预期` 之后',
      '[文本](https://x.com/@预期)',
      '![截图 @预期](files/a.png)',
      '![[files/@预期.png]]',
      '邮箱 a@b.com 与 https://t.cn/@预期',
      '尾行 @概念',
    ]
    const body = lines.join('\n')
    let acc = 0
    const firstAt = acc + lines[0].indexOf('@预期')
    for (let k = 0; k < lines.length - 1; k++) acc += lines[k].length + 1
    const lastAt = acc + lines[lines.length - 1].indexOf('@概念')
    runCases([
      {
        label: '围栏/引用/行内/链接/图片/邮箱/URL 混合',
        body,
        aliases: { 预期: 'expectation', 概念: 'concept' },
        recognized: [
          { raw: '@预期', name: '预期', start: firstAt, end: firstAt + 3, processorId: 'expectation' },
          { raw: '@概念', name: '概念', start: lastAt, end: lastAt + 3, processorId: 'concept' },
        ],
        unknown: [],
      },
    ])
  })
})

describe('CRLF 与 UTF-16 偏移保真', () => {
  it('表驱动回归', () => {
    runCases([
      {
        label: 'CRLF 两行标记',
        body: '@预期\r\n明天 @概念',
        aliases: { 预期: 'expectation', 概念: 'concept' },
        recognized: [
          { raw: '@预期', name: '预期', start: 0, end: 3, processorId: 'expectation' },
          { raw: '@概念', name: '概念', start: 8, end: 11, processorId: 'concept' },
        ],
        unknown: [],
      },
      {
        label: 'CRLF 围栏',
        body: '```\r\n@预期\r\n```\r\n尾 @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 17, end: 20, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: 'emoji 占两个 UTF-16 单元',
        body: '😀 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 3, end: 6, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })
})

describe('契约与结果形态', () => {
  it('浏览器源码复用同一解析器并遵守 ES2017 语法基线', () => {
    const sourceFactory = (mentionParser as unknown as { createMentionParserScript: () => string }).createMentionParserScript
    expect(typeof sourceFactory).toBe('function')
    const script = sourceFactory()
    const browserParse = new Function(`${script}; return parseMentions;`)() as typeof parseMentions
    const scanner = ts.createScanner(ts.ScriptTarget.ES2017, true, ts.LanguageVariant.Standard, script)
    let token: ts.SyntaxKind
    while ((token = scanner.scan()) !== ts.SyntaxKind.EndOfFileToken) {
      expect(token).not.toBe(ts.SyntaxKind.QuestionDotToken)
      expect(token).not.toBe(ts.SyntaxKind.QuestionQuestionToken)
      expect(token).not.toBe(ts.SyntaxKind.AsyncKeyword)
    }
    for (const body of [
      '😀 @预期\r\n@预期差、@𠀀字',
      '\\\\@预期 \\@预期 （@预期',
      '`a\n@预期\nb` @预期',
      '``a ``` b ` @预期 c``',
      '```\n```text\n@预期\n```\n@预期',
      '![a [b] @预期](x.png) [看 @预期](note(a).md "title @预期")',
      '[文档](note\\).md "title @预期") HTTPS://x.test/?@预期',
      `@${'𠀀'.repeat(32)} @${'预'.repeat(33)}`,
      '> @预期\n![[@预期]] @预期',
    ]) {
      const aliases = new Map([['预期', 'expectation'], ['𠀀字', 'astral']])
      expect(browserParse(body, aliases), body).toEqual(parseMentions(body, aliases))
    }
  })

  it('parseMentions 满足任务1固定的 ParseMentions 类型', () => {
    expectTypeOf(parseMentions).toEqualTypeOf<ParseMentions>()
  })

  it('返回结构冻结防止调用方原地改动', () => {
    const parsed = parseMentions('@预期', new Map([['预期', 'expectation']]))
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.recognized)).toBe(true)
    expect(Object.isFrozen(parsed.unknown)).toBe(true)
  })
})

describe('Markdown 边界回归锁定（2026-10-11 修复，定位级断言）', () => {
  it('反引号串精确长度配对与未闭合策略', () => {
    runCases([
      { label: '长反引号串不局部闭合短开串', body: '`a ``` b @概念 c`', aliases: { 概念: 'concept' }, recognized: [], unknown: [] },
      {
        label: '开串后更长反引号串不闭合且未闭合只跳过串本身',
        body: '``a ` b @概念 c',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 8, end: 11, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: '未闭合跨行反引号按原文处理',
        body: '`a\nb @预期\nc',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 5, end: 8, processorId: 'expectation' }],
        unknown: [],
      },
      { label: 'CRLF 跨行行内代码吞掉中间标记', body: '`a\r\n@预期\r\nb`', aliases: A, recognized: [], unknown: [] },
      {
        label: '跨行闭合后正文仍识别',
        body: '`a\n@预期\nb` 尾 @概念',
        aliases: { 概念: 'concept' },
        recognized: [{ raw: '@概念', name: '概念', start: 12, end: 15, processorId: 'concept' }],
        unknown: [],
      },
      {
        label: '闭合搜索越过空白行（文档化简化：仅精确长度反引号串终止跨度）',
        body: '`a\n\n@预期\n`',
        aliases: A,
        recognized: [],
        unknown: [],
      },
    ])
  })

  it('围栏闭合行须同字符足够长且尾随仅空白', () => {
    runCases([
      {
        label: '尾随空白的围栏行正常闭合',
        body: '```\n@预期\n```   \n尾 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 17, end: 20, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '不同字符围栏行不关闭已开围栏',
        body: '```\n~~~\n@预期\n```\n尾 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 18, end: 21, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: 'CRLF 尾随空白闭合',
        body: '```\r\n@预期\r\n```   \r\n尾 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 20, end: 23, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('图片与链接按嵌套转义找完整结束且定位准确', () => {
    runCases([
      {
        label: '未配对alt退化为普通文本扫描',
        body: '![a [b @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 7, end: 10, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '链接显示文字与目标后正文仍识别',
        body: '[看 @预期](x.md) 尾 @概念',
        aliases: { 预期: 'expectation', 概念: 'concept' },
        recognized: [
          { raw: '@预期', name: '预期', start: 3, end: 6, processorId: 'expectation' },
          { raw: '@概念', name: '概念', start: 16, end: 19, processorId: 'concept' },
        ],
        unknown: [],
      },
      {
        label: '标题后的正文仍识别',
        body: '[文档](x.md "t") 尾 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 17, end: 20, processorId: 'expectation' }],
        unknown: [],
      },
      {
        label: '嵌套alt闭合后的正文仍识别',
        body: '![a [b] c] 尾 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 13, end: 16, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('bare URL 协议大小写不敏感且边界定位准确', () => {
    runCases([
      {
        label: 'URL 结束后的正文标记仍识别',
        body: 'HTTPS://x.test/a 尾 @预期',
        aliases: A,
        recognized: [{ raw: '@预期', name: '预期', start: 19, end: 22, processorId: 'expectation' }],
        unknown: [],
      },
    ])
  })

  it('提示词完整误触发用例块整体无命中', () => {
    const block = [
      '`a',
      '@预期',
      'b`',
      '``a ``` b ` @预期 c``',
      '```',
      '```text',
      '@预期',
      '```',
      '![a [b] @预期](x.png)',
      '[文档](note(a).md "title @预期")',
      '![alt](img(a).png "title @预期")',
      '[文档](note\\).md "title @预期")',
      'HTTPS://x.test/?@预期',
    ].join('\n')
    runCases([{ label: '完整用例块', body: block, aliases: A, recognized: [], unknown: [] }])
  })
})
