/**
 * P0 回归（owner 2026-10-08「同代码跨市场」定位缺陷）：市场前缀必须参与候选
 * 过滤——declared market（显式前缀 ?? 按代码段推断）精确优先，名称段次之，
 * mtime 最后；旧式无前缀文档仅作为 legacy 兜底（跨推断市场时名称命中才复用）。
 */
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendCard, deleteCard, locateDoc, parseDoc, scanDailyCardTargets, setStoreWriteHooksForTest, updateCard } from '../../src/review/store.ts'
import { NOW_1432, NOW_1500, TRADE_DATE, TRADE_DATE_COMPACT, makeTempRoot, reviewDir } from './helpers.ts'

afterEach(() => setStoreWriteHooksForTest(undefined))

const DATE_ISO = TRADE_DATE
const COMPACT = TRADE_DATE_COMPACT

/** 手写一份同 (code, date) 文档（frontmatter code 无市场前缀——既有落盘形态）。 */
function seedDoc(root: string, fileName: string, code: string, name: string, mtimeMs: number): string {
  const dir = reviewDir(root)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, fileName)
  writeFileSync(path, [
    '---',
    `code: "${code}"`,
    `name: "${name}"`,
    `tradeDate: "${DATE_ISO}"`,
    'subjective: true',
    'patterns: []',
    'drafts: []',
    '---',
    '',
    `## 09:30 ^card-${COMPACT}-${code}-0930`,
    '- writtenAt: 2026-09-24T09:30:00+08:00',
    '',
    `${name} 既有卡`,
  ].join('\n') + '\n', 'utf8')
  utimesSync(path, new Date(mtimeMs), new Date(mtimeMs))
  return path
}

describe('市场前缀参与候选过滤（P0：sh000688_科创50 vs 000688_国城矿业）', () => {
  it('显式 sh：sh 前缀文档优先于 mtime 更新的无前缀同码文档（名称即身份，零告警）', async () => {
    const root = makeTempRoot()
    const shDoc = seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 1_000)
    const szDoc = seedDoc(root, '000688_国城矿业_20260924.md', '000688', '国城矿业', 2_000)

    const located = await locateDoc({ dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO })
    expect(located.path).toBe(shDoc)
    expect(located.warnings).toEqual([])

    const r = await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO }, body: '指数卡', now: NOW_1500, clientRequestId: 'm1' })
    expect(r.path).toBe(shDoc)
    expect(r.warnings).toEqual([])
    const shParsed = await parseDoc(shDoc)
    expect(shParsed.cards.at(-1)?.body).toBe('指数卡')
    expect((await parseDoc(szDoc)).cards.map((c) => c.body)).toEqual(['国城矿业 既有卡'])
  })

  it('显式 sh 且仅存 legacy 无前缀同名文档：名称命中复用（既有文档零迁移）', async () => {
    const root = makeTempRoot()
    const legacy = seedDoc(root, '000688_科创50_20260924.md', '000688', '科创50', 1_000)

    const located = await locateDoc({ dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO })
    expect(located.path).toBe(legacy)
    expect(located.warnings).toEqual([])

    const r = await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO }, body: '指数卡', now: NOW_1432, clientRequestId: 'm2' })
    expect(r.path).toBe(legacy)
  })

  it('显式 sh 且 legacy 文档名称不同：MUST NOT 写入同码异名文档——新建 sh 前缀文档', async () => {
    const root = makeTempRoot()
    const stockDoc = seedDoc(root, '000688_国城矿业_20260924.md', '000688', '国城矿业', 2_000)
    const before = readFileSync(stockDoc)

    const r = await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO }, body: '指数卡', now: NOW_1432, clientRequestId: 'm3' })
    expect(r.path).toContain('sh000688_')
    expect(readFileSync(stockDoc).equals(before)).toBe(true)
  })

  it('无显式市场：sh 前缀文档不参与无前缀标的的选择（即使其 mtime 更新）', async () => {
    const root = makeTempRoot()
    const stockDoc = seedDoc(root, '000688_国城矿业_20260924.md', '000688', '国城矿业', 1_000)
    seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 2_000)

    const located = await locateDoc({ dataRoot: root, code: '000688', name: '国城矿业', tradeDate: DATE_ISO })
    expect(located.path).toBe(stockDoc)
    expect(located.warnings).toEqual([])

    // 名称缺省：仍在同声明市场（sz 推断）内取 mtime 最新——MUST NOT 落入 sh 指数文档。
    const r = await appendCard({ loc: { dataRoot: root, code: '000688', tradeDate: DATE_ISO }, body: '股票卡', now: NOW_1432, clientRequestId: 'm4' })
    expect(r.path).toBe(stockDoc)
    expect(r.warnings).toEqual([])
  })

  it('显式 sz：sz 前缀文档优先于 legacy 无前缀文档；锚点修订带 market 命中同市场文档', async () => {
    const root = makeTempRoot()
    const szDoc = seedDoc(root, 'sz000688_国城矿业_20260924.md', '000688', '国城矿业', 1_000)
    seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 2_000)

    const located = await locateDoc({ dataRoot: root, code: '000688', market: 'sz', name: '国城矿业', tradeDate: DATE_ISO })
    expect(located.path).toBe(szDoc)

    // 两份文档同锚点（同分钟）：修订带 market=sz 必须命中 sz 文档。
    seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 2_000)
    const r = await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sz', name: '国城矿业', tradeDate: DATE_ISO }, body: '股票卡', now: NOW_1432, clientRequestId: 'm5' })
    expect(r.path).toBe(szDoc)
  })

  it('scanDailyCardTargets：同码跨市场两份文档各自成条目（declared 身份分组）', async () => {
    const root = makeTempRoot()
    seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 1_000)
    seedDoc(root, '000688_国城矿业_20260924.md', '000688', '国城矿业', 2_000)

    const r = await scanDailyCardTargets(DATE_ISO, root)
    const sh = r.find((t) => (t as { qualifier?: string }).qualifier === 'sh')
    const sz = r.find((t) => (t as { qualifier?: string }).qualifier === undefined)
    expect(sh?.name).toBe('科创50')
    expect(sz?.name).toBe('国城矿业')
  })
})

describe('锚点修订/删除的市场序（P0：同分钟锚点在两份同码文档中重复）', () => {
  it('updateCard 带 market=sh：命中 sh 文档，同码股票文档字节不变', async () => {
    const root = makeTempRoot()
    const shDoc = seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 1_000)
    const szDoc = seedDoc(root, '000688_国城矿业_20260924.md', '000688', '国城矿业', 2_000)
    // 两份文档各写一张同分钟卡片 → 锚点字符串相同（card-…-000688-1432）。
    await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO }, body: '指数卡', now: NOW_1432, clientRequestId: 'a-sh' })
    await appendCard({ loc: { dataRoot: root, code: '000688', name: '国城矿业', tradeDate: DATE_ISO }, body: '股票卡', now: NOW_1432, clientRequestId: 'a-sz' })
    const beforeSz = readFileSync(szDoc)
    const anchor = 'card-20260924-000688-1432'

    const r = await updateCard({ anchor, body: '指数卡修订', dataRoot: root, market: 'sh' })
    expect(r.path).toBe(shDoc)
    expect((await parseDoc(shDoc)).cards.some((c) => c.body === '指数卡修订')).toBe(true)
    expect(readFileSync(szDoc).equals(beforeSz)).toBe(true)

    // 无显式市场 = 深市股票身份：命中无前缀文档（sh 文档字节不变由身份序保证）。
    const r2 = await updateCard({ anchor, body: '股票卡修订', dataRoot: root })
    expect(r2.path).toBe(szDoc)
  })

  it('deleteCard 带 market=sh：只删 sh 文档中的分节', async () => {
    const root = makeTempRoot()
    const shDoc = seedDoc(root, 'sh000688_科创50_20260924.md', '000688', '科创50', 1_000)
    const szDoc = seedDoc(root, '000688_国城矿业_20260924.md', '000688', '国城矿业', 2_000)
    await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: DATE_ISO }, body: '指数卡', now: NOW_1432, clientRequestId: 'd-sh' })
    await appendCard({ loc: { dataRoot: root, code: '000688', name: '国城矿业', tradeDate: DATE_ISO }, body: '股票卡', now: NOW_1432, clientRequestId: 'd-sz' })
    const beforeSz = readFileSync(szDoc)

    const r = await deleteCard({ anchor: 'card-20260924-000688-1432', dataRoot: root, market: 'sh' })
    expect(r.path).toBe(shDoc)
    expect((await parseDoc(shDoc)).cards.map((c) => c.body)).toEqual(['科创50 既有卡'])
    expect(readFileSync(szDoc).equals(beforeSz)).toBe(true)
  })
})
