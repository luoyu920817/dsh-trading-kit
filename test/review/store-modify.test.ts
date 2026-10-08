/**
 * 显式修订与删除（owner 2026-10-05 追授）字节级验收：spec「卡片显式修订与删除」
 * 场景——编辑只替换正文（锚点/meta 行字节不变）、删除整节移除、其余分节与
 * frontmatter 逐字节保真、锚点不存在显式 ANCHOR_NOT_FOUND 零字节变化、
 * CRLF 保持。零 mock：真实临时目录 + store 唯一实现。
 */
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { appendAinote, appendCard, deleteCard, locateDoc, parseDoc, setStoreWriteHooksForTest, updateCard, type Loc } from '../../src/review/store.ts'
import { NOW_1432, NOW_1500, NOW_1600, TRADE_DATE, TRADE_DATE_COMPACT, makeTempRoot, reviewDir, writeRaw } from './helpers.ts'

afterEach(() => setStoreWriteHooksForTest(undefined))

const LOC_BASE = { code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }
function loc(root: string): Loc {
  return { ...LOC_BASE, dataRoot: root }
}

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

/** 路径分隔符归一（fixture 用 `/` 拼、store 返回平台分隔符）。 */
function samePath(a: string, b: string): boolean {
  return a.split('\\').join('/') === b.split('\\').join('/')
}

/** 提取某锚点分节的完整文本（标题行至下一锚点 H2 或文末）。 */
function sectionOf(text: string, anchor: string): string {
  const at = text.indexOf('^' + anchor)
  if (at === -1) return ''
  const start = text.lastIndexOf('## ', at)
  const next = text.indexOf('\n## ', at)
  return next === -1 ? text.slice(start) : text.slice(start, next + 1)
}

async function seedTwoCards(root: string): Promise<{ anchorA: string; anchorB: string; path: string; before: string }> {
  const a = await appendCard({ loc: loc(root), body: '第一张卡：早盘观察', now: NOW_1432, clientRequestId: 'seed-a' })
  const b = await appendCard({ loc: loc(root), body: '第二张卡：午后再看', now: NOW_1500, clientRequestId: 'seed-b' })
  const path = a.path
  return { anchorA: a.anchor, anchorB: b.anchor, path, before: readFileSync(path, 'utf8') }
}

describe('updateCard：编辑只替换正文且锚点/meta 行字节不变', () => {
  it('正文替换 + 其余分节与 frontmatter 逐字节不变（spec 场景：编辑只替换正文且锚点不变）', async () => {
    const root = makeTempRoot()
    const { anchorA, anchorB, path, before } = await seedTwoCards(root)
    const r = await updateCard({ anchor: anchorA, body: '编辑后的正文\n第二行', dataRoot: root })
    expect(r.status).toBe('updated')
    expect(r.anchor).toBe(anchorA)
    expect(r.path).toBe(path)
    expect(r.warnings).toEqual([])

    const after = readText(path)
    const parsed = await parseDoc(path)
    const cardA = parsed.cards.find((c) => c.anchor === anchorA)
    expect(cardA?.body).toBe('编辑后的正文\n第二行')
    expect(cardA?.anchor).toBe(anchorA) // 锚点不变（Obsidian 块引用不失效）
    // H2 行 + meta 行（writtenAt/clientRequestId）字节不变：after 分节以 before 分节的 meta 块前缀开头。
    const beforeSection = sectionOf(before, anchorA)
    const metaEnd = beforeSection.indexOf('\n\n')
    expect(after.startsWith(before.slice(0, before.indexOf('## ')))).toBe(true) // frontmatter 不变
    expect(sectionOf(after, anchorA).startsWith(beforeSection.slice(0, metaEnd))).toBe(true)
    expect(sectionOf(after, anchorA)).toContain('编辑后的正文')
    // 其它卡片分节逐字节不变。
    expect(sectionOf(after, anchorB)).toBe(sectionOf(before, anchorB))
  })

  it('附注分节不受编辑影响（仍位于文档末尾）', async () => {
    const root = makeTempRoot()
    const { anchorA, path } = await seedTwoCards(root)
    await appendAinote({ loc: loc(root), body: 'AI 附注内容', generatedAt: '2026-09-24T16:00:00+08:00', dataSources: ['T1'], now: NOW_1600 })
    const before = readText(path)
    await updateCard({ anchor: anchorA, body: '改写', dataRoot: root })
    const after = readText(path)
    expect(sectionOf(after, 'ainote-20260924-600000-1600')).toBe(sectionOf(before, 'ainote-20260924-600000-1600'))
  })

  it('空正文显式拒绝（MUST NOT 以空正文冒充删除）', async () => {
    const root = makeTempRoot()
    const { anchorA, path } = await seedTwoCards(root)
    const before = readText(path)
    await expect(updateCard({ anchor: anchorA, body: '   ', dataRoot: root })).rejects.toThrow('正文为空')
    expect(readText(path)).toBe(before)
  })
})

describe('deleteCard：整节移除且其余保真', () => {
  it('删除后该锚点消失、其余卡片/附注/frontmatter 逐字节不变（spec 场景：删除整节且其余保真）', async () => {
    const root = makeTempRoot()
    const { anchorA, anchorB, path } = await seedTwoCards(root)
    await appendAinote({ loc: loc(root), body: 'AI 附注', generatedAt: '2026-09-24T16:00:00+08:00', dataSources: [], now: NOW_1600 })
    const before = readText(path)
    const r = await deleteCard({ anchor: anchorA, dataRoot: root })
    expect(r.status).toBe('deleted')
    expect(r.anchor).toBe(anchorA)
    const after = readText(path)
    expect(after).not.toContain(anchorA)
    expect(sectionOf(after, anchorB)).toBe(sectionOf(before, anchorB))
    expect(sectionOf(after, 'ainote-20260924-600000-1600')).toBe(sectionOf(before, 'ainote-20260924-600000-1600'))
    const parsed = await parseDoc(path)
    expect(parsed.cards.map((c) => c.anchor)).toEqual([anchorB])
    expect(parsed.ainotes).toHaveLength(1)
  })
})

describe('锚点不存在 / 非法锚点：显式失败且零字节变化', () => {
  it('update/delete 对不存在锚点 → ANCHOR_NOT_FOUND（文档内无此锚点 / 文档不存在两类）', async () => {
    const root = makeTempRoot()
    const { path } = await seedTwoCards(root)
    const before = readText(path)
    await expect(updateCard({ anchor: 'card-20260924-600000-0999', body: 'x', dataRoot: root })).rejects.toMatchObject({ name: 'ANCHOR_NOT_FOUND' })
    await expect(deleteCard({ anchor: 'card-20260924-600000-0999', dataRoot: root })).rejects.toMatchObject({ name: 'ANCHOR_NOT_FOUND' })
    // 不同日期 → 连文档都不存在，同样显式未找到。
    await expect(deleteCard({ anchor: 'card-20260923-600000-0930', dataRoot: root })).rejects.toMatchObject({ name: 'ANCHOR_NOT_FOUND' })
    expect(readText(path)).toBe(before)
  })

  it('非法锚点形态 → 显式报错（不经 CARD_ANCHOR_RE 不触碰磁盘）', async () => {
    const root = makeTempRoot()
    await expect(updateCard({ anchor: 'not-an-anchor', body: 'x', dataRoot: root })).rejects.toThrow('非法卡片锚点')
    await expect(deleteCard({ anchor: 'card-2026-600000-0930', dataRoot: root })).rejects.toThrow('非法卡片锚点')
  })
})

describe('CRLF 文档的修订（EOL 保持）', () => {
  it('CRLF 文档编辑后仍为 CRLF，meta 行字节不变', async () => {
    const root = makeTempRoot()
    const dir = reviewDir(root)
    const original = [
      '---',
      'code: "600000"',
      'name: "浦发银行"',
      'tradeDate: "2026-09-24"',
      'subjective: true',
      '---',
      '',
      '## 09:30 ^card-20260924-600000-0930',
      '- writtenAt: 2026-09-24T09:30:00+08:00',
      '',
      '早盘观察：量能不足',
    ].join('\r\n') + '\r\n'
    writeRaw(`${dir}/600000_浦发银行_${TRADE_DATE_COMPACT}.md`, original)
    const anchor = 'card-20260924-600000-0930'
    await updateCard({ anchor, body: '新正文', dataRoot: root })
    const after = readText(`${dir}/600000_浦发银行_${TRADE_DATE_COMPACT}.md`)
    expect(after).toContain('新正文')
    expect(after.replace(/\r\n/g, '').includes('\n')).toBe(false) // 无裸 \n（无混排）
    expect(after).toContain('- writtenAt: 2026-09-24T09:30:00+08:00\r\n') // meta 行字节不变
  })
})

describe('同码跨市场共存（owner 2026-10-06：指数为关键判断载体；名称即身份）', () => {
  /** 手工 fixture：同码两文档（000001 上证指数(沪) / 平安银行(深)），各含一张卡。 */
  function seedCollision(root: string): { dir: string; indexFile: string; bankFile: string } {
    const dir = reviewDir(root)
    const mk = (name: string, anchor: string, body: string): string => [
      '---',
      'code: "000001"',
      `name: "${name}"`,
      'tradeDate: "2026-09-24"',
      'subjective: true',
      '---',
      '',
      `## 09:30 ^${anchor}`,
      '- writtenAt: 2026-09-24T09:30:00+08:00',
      '',
      body,
      '',
    ].join('\n')
    const indexFile = `${dir}/000001_上证指数_${TRADE_DATE_COMPACT}.md`
    const bankFile = `${dir}/000001_平安银行_${TRADE_DATE_COMPACT}.md`
    writeRaw(indexFile, mk('上证指数', 'card-20260924-000001-0930', '指数判断：关键位 3853（@预期）'))
    writeRaw(bankFile, mk('平安银行', 'card-20260924-000001-0931', '银行板块观察'))
    return { dir, indexFile, bankFile }
  }

  it('appendCard 名称段精确命中：写入对应文档、另一方字节不变、免多命中告警', async () => {
    const root = makeTempRoot()
    const { indexFile, bankFile } = seedCollision(root)
    const bankBefore = readText(bankFile)
    const r = await appendCard({ loc: { dataRoot: root, code: '000001', name: '上证指数', tradeDate: TRADE_DATE }, body: '上证指数：关键位观察', clientRequestId: 'c1', now: NOW_1432 })
    expect(r.status).toBe('created')
    expect(samePath(r.path, indexFile)).toBe(true)
    expect(r.warnings).toEqual([]) // 名称即身份：唯一精确命中不告警
    expect(readText(bankFile)).toBe(bankBefore)
    expect(readText(indexFile)).toContain('上证指数：关键位观察')
  })

  it('updateCard/deleteCard 按锚点跨候选查找：只动锚点所属文档（不落到同码另一标的）', async () => {
    const root = makeTempRoot()
    const { indexFile, bankFile } = seedCollision(root)
    const indexBefore = readText(indexFile)
    // 平安银行那张卡（锚点在银行文档；文档选择不得因 mtime/序而落到指数文档）
    const upd = await updateCard({ anchor: 'card-20260924-000001-0931', body: '银行板块观察（修订）', dataRoot: root })
    expect(samePath(upd.path, bankFile)).toBe(true)
    expect(readText(bankFile)).toContain('银行板块观察（修订）')
    expect(readText(indexFile)).toBe(indexBefore)
    const del = await deleteCard({ anchor: 'card-20260924-000001-0930', dataRoot: root })
    expect(samePath(del.path, indexFile)).toBe(true)
    expect(readText(indexFile)).not.toContain('关键位 3853')
    expect(readText(bankFile)).toContain('银行板块观察（修订）')
  })

  it('locateDoc 名称段优先（名称变化仍回落 mtime 复用既有文档）', async () => {
    const root = makeTempRoot()
    const { indexFile, bankFile } = seedCollision(root)
    const hitIndex = await locateDoc({ dataRoot: root, code: '000001', name: '上证指数', tradeDate: TRADE_DATE })
    expect(samePath(hitIndex.path, indexFile)).toBe(true)
    expect(hitIndex.warnings).toEqual([])
    const hitBank = await locateDoc({ dataRoot: root, code: '000001', name: '平安银行', tradeDate: TRADE_DATE })
    expect(samePath(hitBank.path, bankFile)).toBe(true)
    // 名称未命中（如更名后）：回落 mtime 最新 + 多命中告警（既有语义保持）。
    const renamed = await locateDoc({ dataRoot: root, code: '000001', name: '某新名', tradeDate: TRADE_DATE })
    expect([indexFile, bankFile].some((f) => samePath(f, renamed.path))).toBe(true)
    expect(renamed.warnings.length).toBeGreaterThan(0)
  })
})
