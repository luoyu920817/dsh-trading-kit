/**
 * change 4 tasks 1.9：「既有内容不变的精确口径」（契约 §4）fixture 断言——
 * CRLF / BOM / 无尾换行 / frontmatter 既有行不变 + 新增键按固定格式追加。
 * fixture 文件名遵循 `<代码>_<名称>_<YYYYMMDD>.md`（否则定位扫描命中不了）。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendAinote, appendCard, parseDoc, setStoreWriteHooksForTest } from '../../src/review/store.ts'
import { NOW_1432, NOW_1500, NOW_1600, TRADE_DATE, TRADE_DATE_COMPACT, makeTempRoot, reviewDir } from './helpers.ts'

const LOC = { dataRoot: '', code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }
function loc(root: string): typeof LOC {
  return { ...LOC, dataRoot: root }
}

afterEach(() => setStoreWriteHooksForTest(undefined))

const FIXTURE_NAME = `600000_浦发银行_${TRADE_DATE_COMPACT}.md`

/** 在月目录写一份既有文档（完全控制字节）。 */
function writeFixture(root: string, content: string | Buffer): string {
  const dir = reviewDir(root)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, FIXTURE_NAME)
  writeFileSync(path, content)
  return path
}

function fixtureLines(): string[] {
  return [
    '---',
    'code: "600000"',
    'name: "浦发银行"',
    'tradeDate: "2026-09-24"',
    'subjective: true',
    'patterns: []',
    'drafts: []',
    '---',
    '',
    '## 09:30 ^card-20260924-600000-0930',
    '- writtenAt: 2026-09-24T09:30:00+08:00',
    '',
    '早盘观察：量能不足',
  ]
}

describe('CRLF 文档（spec 场景：写入后仍为 CRLF，不混排）', () => {
  it('新插入行亦用 CRLF；既有字节为结果前缀', async () => {
    const root = makeTempRoot()
    const original = fixtureLines().join('\r\n') + '\r\n'
    const path = writeFixture(root, original)

    const r = await appendCard({ loc: loc(root), body: '午后再看', now: NOW_1432, clientRequestId: 'r1' })
    expect(r.status).toBe('created')
    expect(r.path).toBe(path)
    const after = readFileSync(path, 'utf8')
    // 原文件字节是结果文件前缀。
    expect(after.startsWith(original)).toBe(true)
    // 无混排：除末段外每个 \n 前都有 \r。
    expect(after.includes('\n')).toBe(true)
    expect(after.split('\n').every((seg, i, arr) => i === arr.length - 1 || seg.endsWith('\r'))).toBe(true)
    // 新分节按 CRLF 写入。
    expect(after).toContain('## 14:32 ^card-20260924-600000-1432\r\n')
  })

  it('CRLF 文档追加附注：附注到末尾、CRLF 保持、前缀断言', async () => {
    const root = makeTempRoot()
    const original = fixtureLines().join('\r\n') + '\r\n'
    const path = writeFixture(root, original)
    await appendAinote({ loc: loc(root), body: '摘要', generatedAt: '2026-09-24T15:00:00+08:00', dataSources: ['T1'], now: NOW_1500 })
    const after = readFileSync(path, 'utf8')
    expect(after.startsWith(original)).toBe(true)
    expect(after.split('\n').every((seg, i, arr) => i === arr.length - 1 || seg.endsWith('\r'))).toBe(true)
    expect(after).toContain('## 15:00 ^ainote-20260924-600000-1500\r\n')
  })
})

describe('BOM 文档（spec 场景：BOM 保留且仅一个）', () => {
  it('写入后 BOM 仍在文件首部且仅一个；既有字节（去 BOM 后）为结果前缀', async () => {
    const root = makeTempRoot()
    const bodyText = fixtureLines().join('\n') + '\n'
    const path = writeFixture(root, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(bodyText, 'utf8')]))

    const r = await appendCard({ loc: loc(root), body: '午后修复', now: NOW_1432 })
    expect(r.status).toBe('created')
    expect(r.path).toBe(path)
    const buf = readFileSync(path)
    expect(buf[0]).toBe(0xef)
    expect(buf[1]).toBe(0xbb)
    expect(buf[2]).toBe(0xbf)
    const after = buf.toString('utf8')
    expect(after.split('\uFEFF')).toHaveLength(2) // 仅首部一个 BOM
    expect(after.slice(1).startsWith(bodyText)).toBe(true)
    expect(after).toContain('## 14:32 ^card-20260924-600000-1432')
  })
})

describe('无尾换行文档（spec 场景：先补本文件 EOL，分隔符不计入既有内容）', () => {
  it('追加卡片：原字节是前缀，随后恰为一个本文件 EOL 分隔符', async () => {
    const root = makeTempRoot()
    const original = fixtureLines().join('\n') // 末行无换行
    const path = writeFixture(root, original)

    await appendCard({ loc: loc(root), body: '尾盘补记', now: NOW_1432 })
    const after = readFileSync(path, 'utf8')
    expect(after.startsWith(original)).toBe(true)
    const rest = after.slice(original.length)
    expect(rest.startsWith('\n')).toBe(true)
    expect(rest.startsWith('\n\n')).toBe(false) // 恰一个分隔符，非空行
    expect(after).toContain('\n## 14:32 ^card-20260924-600000-1432\n')
  })

  it('追加附注：同样先补 EOL 再追加', async () => {
    const root = makeTempRoot()
    const original = fixtureLines().join('\n')
    const path = writeFixture(root, original)
    await appendAinote({ loc: loc(root), body: '摘要', generatedAt: '2026-09-24T15:00:00+08:00', dataSources: ['T1'], now: NOW_1500 })
    const after = readFileSync(path, 'utf8')
    expect(after.startsWith(original)).toBe(true)
    expect(after.slice(original.length).startsWith('\n')).toBe(true)
    expect(after).toContain('## 15:00 ^ainote-20260924-600000-1500')
  })
})

describe('frontmatter 既有行不变 + 新增键按固定格式追加（spec 场景）', () => {
  it('遗留文档缺 tradeDate：既有三行逐字节不变，tradeDate 追加其后', async () => {
    const root = makeTempRoot()
    const original = [
      '---',
      'name: "浦发银行"',
      'code: "600000"',
      'subjective: true',
      '---',
      '',
      '## 09:30 ^card-20260924-600000-0930',
      '- writtenAt: 2026-09-24T09:30:00+08:00',
      '',
      '早盘观察',
    ].join('\n')
    const path = writeFixture(root, original)

    const r = await appendCard({ loc: loc(root), body: '新卡', now: NOW_1432, clientRequestId: 'r9' })
    expect(r.status).toBe('created')
    const after = readFileSync(path, 'utf8')
    const fmLines = after.split('\n').slice(0, 6)
    // 既有三行文本逐字节不变、键序不变。
    expect(fmLines[1]).toBe('name: "浦发银行"')
    expect(fmLines[2]).toBe('code: "600000"')
    expect(fmLines[3]).toBe('subjective: true')
    // tradeDate 按固定格式追加在这三行之后。
    expect(fmLines[4]).toBe('tradeDate: "2026-09-24"')
    expect(fmLines[5]).toBe('---')
    // 既有卡片分节字节不变。
    expect(after).toContain('## 09:30 ^card-20260924-600000-0930')
    expect(after).toContain('早盘观察')
    // 新分节与 clientRequestId 登记。
    expect(after).toContain('- clientRequestId: r9')
    const doc = await parseDoc(path)
    expect(doc.cards.map((c) => c.anchor)).toEqual(['card-20260924-600000-0930', 'card-20260924-600000-1432'])
  })

  it('既有分节与其正文字节级不变（N 卡 + 1 断言）', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: loc(root), body: '第一张\n第二行', now: NOW_1432, clientRequestId: 'r1' })
    const second = await appendCard({ loc: loc(root), body: '第二张', now: NOW_1500, clientRequestId: 'r2' })
    const before = readFileSync(second.path, 'utf8')
    const third = await appendCard({ loc: loc(root), body: '第三张', now: NOW_1600, clientRequestId: 'r3' })
    const after = readFileSync(third.path, 'utf8')
    // 前两张分节（含 frontmatter 至第三张插入点前的全部字节）是结果的严格前缀。
    expect(after.startsWith(before)).toBe(true)
    expect(after.length).toBeGreaterThan(before.length)
  })
})
