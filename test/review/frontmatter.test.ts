/**
 * change 4 tasks 1.1/1.11：frontmatter 读写——值级最小修补、最小键 schema、
 * 预留键与未知键保留、双引号转义往返。
 */
import { describe, expect, it } from 'vitest'
import {
  buildFrontmatterBlock,
  decodeFrontmatterScalar,
  encodeFrontmatterValue,
  ensureFrontmatterKeys,
  findFrontmatter,
  parseFrontmatterValues,
  validateFrontmatterSchema,
} from '../../src/review/md/frontmatter.ts'

const LF = '\n'
const CRLF = '\r\n'

describe('findFrontmatter / parseFrontmatterValues', () => {
  it('定位块与行解析（含 CRLF 与 BOM 后文本）', () => {
    const text = `---\ncode: "600000"\nname: "浦发银行"\ntradeDate: "2026-09-24"\nsubjective: true\npatterns: []\ndrafts: []\n---\n\n## 14:32 ^card-20260924-600000-1432\n正文\n`
    const block = findFrontmatter(text)
    expect(block).not.toBeNull()
    expect(block!.eol).toBe(LF)
    expect(block!.bodyLines).toHaveLength(6)
    expect(text.slice(block!.start, block!.end)).toContain('---')
    const values = parseFrontmatterValues(block!.bodyLines)
    expect(values).toEqual({
      code: '600000',
      name: '浦发银行',
      tradeDate: '2026-09-24',
      subjective: true,
      patterns: [],
      drafts: [],
    })
  })

  it('无闭合分隔行 / 非 --- 开头 → 无 frontmatter', () => {
    expect(findFrontmatter('---\ncode: "1"\n')).toBeNull()
    expect(findFrontmatter('code: 1\n')).toBeNull()
    expect(findFrontmatter('')).toBeNull()
  })

  it('值形态：单引号、裸标量、布尔、未知键', () => {
    const values = parseFrontmatterValues([
      "name: '单引号名'",
      'code: 600000',
      'subjective: false',
      'customKey: 任意 文本',
      'empty:',
    ])
    expect(values.name).toBe('单引号名')
    expect(values.code).toBe('600000')
    expect(values.subjective).toBe(false)
    expect(values.customKey).toBe('任意 文本')
    expect(values.empty).toBe('')
  })

  it('patterns 元素解析；drafts 原样结构（JSON flow 可解析则解析）', () => {
    const values = parseFrontmatterValues([
      'patterns: ["超短-首板", "价投-趋势"]',
      'drafts: [{"id": 1, "text": "x"}]',
      'patternsEmpty: []',
    ])
    expect(values.patterns).toEqual(['超短-首板', '价投-趋势'])
    expect(values.drafts).toEqual([{ id: 1, text: 'x' }])
  })
})

describe('双引号转义往返（tasks 1.7 值转义 / 1.11 重解析）', () => {
  it('含引号与换行的值可写入并可重新解析', () => {
    const raw = '含"引号\'与\n换行和\\反斜杠'
    const encoded = encodeFrontmatterValue(raw)
    expect(encoded).toBe('"含\\"引号\'与\\n换行和\\\\反斜杠"')
    expect(decodeFrontmatterScalar(encoded)).toBe(raw)
    // 落入完整块再解析。
    const block = buildFrontmatterBlock({ code: '600000', name: raw, tradeDate: '2026-09-24' }, LF)
    const parsed = parseFrontmatterValues(findFrontmatter(block)!.bodyLines)
    expect(parsed.name).toBe(raw)
    // 值含换行时仍为单行（不破坏块结构）。
    expect(block.split('\n').every((l) => !l.slice(6).includes('\n'))).toBe(true)
  })

  it('name 为空写空字符串', () => {
    const block = buildFrontmatterBlock({ code: '600000', name: '', tradeDate: '2026-09-24' }, LF)
    expect(block).toContain('name: ""')
    expect(parseFrontmatterValues(findFrontmatter(block)!.bodyLines).name).toBe('')
  })
})

describe('值级最小修补（MUST NOT 整体重序列化）', () => {
  it('既有行逐字节不变；缺失键按固定格式追加在既有行之后', () => {
    const before = [
      '---',
      'name: "浦发银行"',
      'code: "600000"',
      'subjective: true',
      '---',
    ].join(LF)
    const result = ensureFrontmatterKeys(before, [
      { key: 'tradeDate', value: '2026-09-24' },
    ], LF)
    expect(result.appendedKeys).toEqual(['tradeDate'])
    expect(result.patchedKeys).toEqual([])
    const lines = result.text.split(LF)
    // 既有三行文本逐字节不变、键序不变。
    expect(lines[0]).toBe('---')
    expect(lines[1]).toBe('name: "浦发银行"')
    expect(lines[2]).toBe('code: "600000"')
    expect(lines[3]).toBe('subjective: true')
    // tradeDate 按固定格式追加。
    expect(lines[4]).toBe('tradeDate: "2026-09-24"')
    expect(lines[5]).toBe('---')
  })

  it('改值仅替换值本身：键名、冒号与既有空白保留，未知键与注释不动', () => {
    const before = [
      '---',
      'name:   "旧名"   # 尾注释会随值替换',
      'unknown-key: 保持原样 "原样"',
      'note: 前置注释行',
      '---',
    ].join(LF)
    const result = ensureFrontmatterKeys(before, [{ key: 'name', value: '新名' }], LF)
    expect(result.patchedKeys).toEqual(['name'])
    const lines = result.text.split(LF)
    expect(lines[1]).toBe('name:   "新名"')
    expect(lines[2]).toBe('unknown-key: 保持原样 "原样"')
    expect(lines[3]).toBe('note: 前置注释行')
    expect(result.text.split(LF).length).toBe(before.split(LF).length)
  })

  it('值相同 → 不产生任何修补', () => {
    const before = '---\ncode: "600000"\nname: "浦发银行"\n---'
    const result = ensureFrontmatterKeys(before, [
      { key: 'code', value: '600000' },
      { key: 'name', value: '浦发银行' },
    ], LF)
    expect(result.appendedKeys).toEqual([])
    expect(result.patchedKeys).toEqual([])
    expect(result.text).toBe(before)
  })

  it('CRLF 块：分隔与换行风格保持', () => {
    const before = ['---', 'code: "600000"', '---'].join(CRLF)
    const result = ensureFrontmatterKeys(before, [{ key: 'subjective', value: true }], CRLF)
    expect(result.text.split(CRLF)).toEqual(['---', 'code: "600000"', 'subjective: true', '---'])
  })

  it('预留键既有值保留（MUST NOT 重置为空数组、MUST NOT 重排）', () => {
    const before = [
      '---',
      'code: "600000"',
      'patterns: ["超短-首板"]',
      'drafts: [{"id": 1}]',
      'name: "浦发银行"',
      '---',
    ].join(LF)
    const result = ensureFrontmatterKeys(before, [
      { key: 'tradeDate', value: '2026-09-24' },
      { key: 'subjective', value: true },
    ], LF)
    expect(result.text).toContain('patterns: ["超短-首板"]')
    expect(result.text).toContain('drafts: [{"id": 1}]')
    // 位置未动（仍在 tradeDate 之前）。
    const lines = result.text.split(LF)
    expect(lines.indexOf('patterns: ["超短-首板"]')).toBeLessThan(lines.indexOf('tradeDate: "2026-09-24"'))
  })
})

describe('最小键 schema 校验（spec「frontmatter 最小键 schema」）', () => {
  it('合法四键 + patterns/drafts → 零 issue', () => {
    const values = parseFrontmatterValues([
      'code: "600000"',
      'name: ""',
      'tradeDate: "2026-09-24"',
      'subjective: true',
      'patterns: []',
      'drafts: []',
    ])
    expect(validateFrontmatterSchema(values)).toEqual([])
  })

  it('逐键违规可判定', () => {
    const issues = validateFrontmatterSchema(parseFrontmatterValues([
      'code: "60000"',
      'tradeDate: "2026-9-24"',
      'subjective: false',
      'patterns: ["", {"a": 1}]',
      'drafts: "不是数组"',
    ]))
    const keys = issues.map((i) => i.key)
    expect(keys).toContain('code')
    expect(keys).toContain('name') // name 缺失
    expect(keys).toContain('tradeDate')
    expect(keys).toContain('subjective')
    expect(keys).toContain('patterns')
    expect(keys).toContain('drafts')
  })

  it('tradeDate 形态校验（spec = ^\\d{4}-\\d{2}-\\d{2}$）', () => {
    expect(validateFrontmatterSchema({ code: '600000', name: '', tradeDate: '2026-09-24', subjective: true })).toEqual([])
    const issues = validateFrontmatterSchema({ code: '600000', name: '', tradeDate: '20260924', subjective: true })
    expect(issues.some((i) => i.key === 'tradeDate')).toBe(true)
  })
})
