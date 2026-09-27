/**
 * change 4 tasks 1.2/1.6：按锚点解析分节——只认 H2、跳过代码块、元信息提取、
 * EOL/BOM 探测、非锚点 H2 归入正文。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocument, splitLines, toParsedAinote, toParsedCard } from '../../src/review/md/parse.ts'
import { NOW_1432, NOW_1500, TRADE_DATE, makeTempRoot } from './helpers.ts'
import { appendAinote, appendCard, parseDoc } from '../../src/review/store.ts'

const CARD_HEADING = '## 14:32 ^card-20260924-600000-1432'

function seedCardDoc(root: string, eol = '\n', bom = false): string {
  const lines = [
    '---',
    'code: "600000"',
    'name: "浦发银行"',
    'tradeDate: "2026-09-24"',
    'subjective: true',
    'patterns: []',
    'drafts: []',
    '---',
    '',
    CARD_HEADING,
    '- writtenAt: 2026-09-24T14:32:05+08:00',
    '',
    '想法',
  ]
  const text = lines.join(eol) + eol
  const path = join(root, `seed-${eol === '\r\n' ? 'crlf' : 'lf'}${bom ? '-bom' : ''}.md`)
  const buf = Buffer.from(text, 'utf8')
  writeFileSync(path, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf]) : buf)
  return path
}

describe('splitLines / parseDocument 基础', () => {
  it('逐行切分保留偏移与 EOL 风格', () => {
    const { lines, eol } = splitLines('a\r\nb\nc')
    expect(eol).toBe('\r\n')
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
    expect(lines[0].start).toBe(0)
    expect(lines[1].start).toBe(3)
    const lf = splitLines('a\nb\n')
    expect(lf.eol).toBe('\n')
    expect(lf.lines).toHaveLength(2)
  })

  it('H2 锚点行分节；分节边界 = 下一锚点 H2 行 / 文件末尾', () => {
    const text = [
      '## 09:00 开盘综述', // 非锚点 H2，先于任何分节 → 不属于任何卡片
      CARD_HEADING,
      '- writtenAt: 2026-09-24T14:32:05+08:00',
      '',
      '第一条想法',
      '## 14:33 ^card-20260924-600000-1433',
      '- writtenAt: 2026-09-24T14:33:00+08:00',
      '',
      '第二条',
    ].join('\n')
    const parse = parseDocument(text)
    expect(parse.eol).toBe('\n')
    expect(parse.bom).toBe(false)
    expect(parse.sections).toHaveLength(2)
    expect(parse.sections[0].anchor).toBe('card-20260924-600000-1432')
    expect(parse.sections[0].kind).toBe('card')
    expect(parse.sections[0].heading).toBe('14:32 ^card-20260924-600000-1432')
    expect(parse.sections[0].hhmm).toBe('1432')
    expect(parse.sections[0].seq).toBeNull()
    // 非锚点 H2 行「开盘综述」在第一个锚点之前 → 不计入任何分节正文。
    const card1 = toParsedCard(parse.sections[0], parse.eol)
    expect(card1.body).not.toContain('开盘综述')
    expect(card1.body).toContain('第一条想法')
    const card2 = toParsedCard(parse.sections[1], parse.eol)
    expect(card2.body).toContain('第二条')
  })

  it('正文含行首 ##（不含锚点）→ 归入所属卡片正文（D-16 显式取舍）', () => {
    const text = [
      CARD_HEADING,
      '- writtenAt: 2026-09-24T14:32:05+08:00',
      '',
      '想法前半',
      '## 小节标题（正文一部分）',
      '想法后半',
    ].join('\n')
    const parse = parseDocument(text)
    expect(parse.sections).toHaveLength(1)
    const card = toParsedCard(parse.sections[0], parse.eol)
    expect(card.body).toContain('## 小节标题（正文一部分）')
    expect(card.body).toContain('想法后半')
  })
})

describe('fenced code block 跳过（tasks 1.6 代码块内锚点）', () => {
  it('``` 围栏内的锚点 H2 不构成分节、不产生告警', async () => {
    const root = makeTempRoot()
    const created = await appendCard({
      loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
      body: ['示例：', '```', '## 12:00 ^card-20260924-600000-1200', '```', '结束'].join('\n'),
      now: NOW_1432,
    })
    const doc = await parseDoc(created.path)
    expect(doc.cards).toHaveLength(1)
    expect(doc.cards[0].anchor).toBe('card-20260924-600000-1432')
    expect(doc.warnings).toEqual([])
    expect(doc.cards[0].body).toContain('^card-20260924-600000-1200')
  })

  it('~~~ 围栏同理；非同标记不闭合', () => {
    const text = [
      CARD_HEADING,
      '- writtenAt: 2026-09-24T14:32:05+08:00',
      '',
      '~~~',
      '## 12:00 ^ainote-20260924-600000-1200',
      '```', // 不同标记，不闭合 ~~~
      '仍在围栏内 ^card-20260924-600000-9999',
      '~~~',
      '围栏外',
    ].join('\n')
    const parse = parseDocument(text)
    expect(parse.sections).toHaveLength(1)
    expect(parse.sections[0].anchor).toBe('card-20260924-600000-1432')
  })
})

describe('元信息提取', () => {
  it('writtenAt / clientRequestId 可提取，其余为正文', async () => {
    const root = makeTempRoot()
    const created = await appendCard({
      loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
      body: '分批低吸',
      now: NOW_1432,
      clientRequestId: 'req-abc-1',
    })
    const parse = parseDocument(readFileSync(created.path, 'utf8'))
    const card = toParsedCard(parse.sections[0], parse.eol)
    expect(card.writtenAt).toBe('2026-09-24T14:32:05+08:00')
    expect(card.clientRequestId).toBe('req-abc-1')
    expect(card.body).toBe('分批低吸')
    expect(card.heading).toBe('14:32 ^card-20260924-600000-1432')
  })

  it('附注元信息块：generatedAt 提升、dataSources 入 meta；正文列表不误判', async () => {
    const root = makeTempRoot()
    await appendCard({
      loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
      body: '基数',
      now: NOW_1432,
    })
    const note = await appendAinote({
      loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
      body: ['结论一：情绪修复。', '', '- 结论条目一', '- 结论条目二'].join('\n'),
      generatedAt: '2026-09-24T15:00:00+08:00',
      dataSources: ['T1', 'T2'],
      now: NOW_1500,
    })
    const parse = parseDocument(readFileSync(note.path, 'utf8'))
    const ainoteSection = parse.sections.find((s) => s.kind === 'ainote')!
    const parsed = toParsedAinote(ainoteSection, parse.eol)
    expect(parsed.generatedAt).toBe('2026-09-24T15:00:00+08:00')
    expect(parsed.meta.dataSources).toBe('T1, T2')
    expect(parsed.body).toContain('结论一：情绪修复。')
    expect(parsed.body).toContain('- 结论条目一')
    expect(parsed.body).toContain('- 结论条目二')
  })
})

describe('EOL/BOM 探测（tasks 1.2 返回值）', () => {
  it('CRLF / LF / BOM 三态', async () => {
    const root = makeTempRoot()
    const crlf = await parseDoc(seedCardDoc(root, '\r\n'))
    expect(crlf.eol).toBe('\r\n')
    expect(crlf.bom).toBe(false)
    expect(crlf.cards).toHaveLength(1)
    const bom = await parseDoc(seedCardDoc(root, '\n', true))
    expect(bom.bom).toBe(true)
    expect(bom.eol).toBe('\n')
    expect(bom.cards).toHaveLength(1)
    const lf = await parseDoc(seedCardDoc(root, '\n'))
    expect(lf.bom).toBe(false)
    expect(lf.eol).toBe('\n')
  })

  it('parseDoc 对不可读路径显式报错', async () => {
    const root = makeTempRoot()
    await expect(parseDoc(join(root, '不存在.md'))).rejects.toThrow(/不可读/)
  })
})
