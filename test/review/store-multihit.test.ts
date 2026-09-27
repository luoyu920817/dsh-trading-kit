/**
 * change 4 tasks 1.10：多命中文档的确定性选择（mtime 最新 → 文件名字典序平局）
 * + warnings 两条路径 + 未被选中文档字节不变。
 */
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendCard, locateDoc, parseDoc, scanDailyCardTargets, setStoreWriteHooksForTest } from '../../src/review/store.ts'
import { NOW_1432, NOW_1500, TRADE_DATE, TRADE_DATE_COMPACT, makeTempRoot, reviewDir } from './helpers.ts'

const LOC = { dataRoot: '', code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }
function loc(root: string): typeof LOC {
  return { ...LOC, dataRoot: root }
}

afterEach(() => setStoreWriteHooksForTest(undefined))

/** 在月目录里直接造两份同 (code, date) 文档（历史遗留形态，手写合法内容）。 */
function seedTwoDocs(root: string, names: [string, string], content: (label: string) => string): [string, string] {
  const dir = reviewDir(root)
  mkdirSync(dir, { recursive: true })
  const [a, b] = names
  writeFileSync(join(dir, a), content('A'), 'utf8')
  writeFileSync(join(dir, b), content('B'), 'utf8')
  return [join(dir, a), join(dir, b)]
}

function docContent(label: string): string {
  return [
    '---',
    'code: "600000"',
    `name: "浦发银行${label}"`,
    'tradeDate: "2026-09-24"',
    'subjective: true',
    'patterns: []',
    'drafts: []',
    '---',
    '',
    `## 09:30 ^card-20260924-600000-0930`,
    '- writtenAt: 2026-09-24T09:30:00+08:00',
    '',
    `${label} 日报`,
  ].join('\n') + '\n'
}

describe('多命中确定性（spec「多命中文档的确定性选择」）', () => {
  it('mtime 最新优先：写入 mtime 最新的文档，warnings 含两条路径', async () => {
    const root = makeTempRoot()
    const [pathA, pathB] = seedTwoDocs(root, ['600000_AAA_20260924.md', '600000_BBB_20260924.md'], docContent)
    // A 更旧、B 更新。
    utimesSync(pathA, new Date(1_000), new Date(1_000))
    utimesSync(pathB, new Date(2_000), new Date(2_000))

    const located = await locateDoc(loc(root))
    expect(located.path).toBe(pathB)
    expect(located.warnings).toHaveLength(1)
    expect(located.warnings[0]).toMatch(/^\[multiHit\] /)
    expect(located.warnings[0]).toContain(pathA)
    expect(located.warnings[0]).toContain(pathB)

    const r = await appendCard({ loc: loc(root), body: '写入较新文档', now: NOW_1432, clientRequestId: 'r1' })
    expect(r.path).toBe(pathB)
    expect(r.warnings.some((w) => w.startsWith('[multiHit] '))).toBe(true)
    const doc = await parseDoc(pathB)
    expect(doc.cards.map((c) => c.body)).toEqual(['B 日报', '写入较新文档'])
  })

  it('mtime 平局 → 文件名字典序（AAA < BBB），结果稳定可复现', async () => {
    const root = makeTempRoot()
    const [pathAAA, pathBBB] = seedTwoDocs(root, ['600000_AAA_20260924.md', '600000_BBB_20260924.md'], docContent)
    utimesSync(pathAAA, new Date(1_000), new Date(1_000))
    utimesSync(pathBBB, new Date(1_000), new Date(1_000))

    const first = await locateDoc(loc(root))
    const second = await locateDoc(loc(root))
    expect(first.path).toBe(pathAAA) // AAA 字典序在前
    expect(second.path).toBe(first.path)
    expect(first.warnings[0]).toContain(pathBBB)
    expect(first.warnings[0]).toContain('候选')
  })

  it('多命中写入后：未被选中文档字节不变（孤儿不删除、不合并）', async () => {
    const root = makeTempRoot()
    const [pathA, pathB] = seedTwoDocs(root, ['600000_AAA_20260924.md', '600000_BBB_20260924.md'], docContent)
    utimesSync(pathA, new Date(1_000), new Date(1_000))
    utimesSync(pathB, new Date(2_000), new Date(2_000))
    const orphanBefore = readFileSync(pathA)

    const r = await appendCard({ loc: loc(root), body: '新卡', now: NOW_1500, clientRequestId: 'r2' })
    expect(r.path).toBe(pathB)
    expect(readFileSync(pathA).equals(orphanBefore)).toBe(true)
    // 告警携带被选与其它候选路径，供页面显式展示。
    expect(r.warnings[0]).toContain('[multiHit]')
    expect(r.warnings[0]).toContain(pathA)
    expect(r.warnings[0]).toContain(pathB)
  })

  it('scanDailyCardTargets 同 code 多命中：确定性取一并告警', async () => {
    const root = makeTempRoot()
    const [pathA, pathB] = seedTwoDocs(root, ['600000_BBB_20260924.md', '600000_AAA_20260924.md'], docContent)
    utimesSync(pathA, new Date(1_000), new Date(1_000))
    utimesSync(pathB, new Date(2_000), new Date(2_000))
    // 另一个正常标的。
    await appendCard({ loc: { ...LOC, dataRoot: root, code: '000001', name: '平安银行' }, body: '深市', now: NOW_1432 })

    const r = await scanDailyCardTargets(TRADE_DATE, root)
    expect(r).toHaveLength(2)
    const target600000 = r.find((t) => t.code === '600000')!
    expect(target600000.path).toBe(pathB)
    expect(target600000.cardCount).toBe(1)
    expect(r.warnings.some((w) => w.startsWith('[multiHit] ') && w.includes(pathA) && w.includes(pathB))).toBe(true)
  })

  it('目录内只有单命中时零告警', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: loc(root), body: '唯一', now: NOW_1432 })
    const located = await locateDoc(loc(root))
    expect(located.warnings).toEqual([])
    expect(readdirSync(reviewDir(root))).toHaveLength(1)
  })
})
