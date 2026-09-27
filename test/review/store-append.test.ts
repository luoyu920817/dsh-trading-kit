/**
 * change 4 tasks 1.4/1.6/1.7/1.12：追加主流程——首次落盘/同日插入/跨日新文档/
 * 名称变化复用/锚点唯一/幂等去重/DOC_MISMATCH/插入位置/文件名净化接入。
 * 零 mock：真实临时目录 + 真实文件系统断言；时钟经 now 注入。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveArea } from '../../src/paths/resolve.ts'
import {
  appendAinote,
  appendCard,
  locateDoc,
  parseDoc,
  scanDailyCardTargets,
} from '../../src/review/store.ts'
import {
  NOW_1432,
  NOW_1432B,
  NOW_1500,
  NOW_1600,
  TRADE_DATE,
  TRADE_DATE_COMPACT,
  makeTempRoot,
  reviewDir,
} from './helpers.ts'

const LOC = { dataRoot: '', code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }

function loc(root: string, overrides: Partial<typeof LOC> = {}): typeof LOC {
  return { ...LOC, dataRoot: root, ...overrides }
}

describe('首次落盘 / 同日插入 / 跨日新文档（spec「存储路径与文件粒度」）', () => {
  it('首次落卡：目录按范式自动创建，文件名与 frontmatter/分节结构符合契约', async () => {
    const root = makeTempRoot()
    const r = await appendCard({ loc: loc(root), body: '分时缩量回踩，观察 20 日线承接', now: NOW_1432 })
    expect(r.status).toBe('created')
    expect(r.warnings).toEqual([])
    const expected = resolveArea(root, 'review', { code: '600000', name: '浦发银行', date: TRADE_DATE_COMPACT }).absPath
    expect(r.path).toBe(expected)
    expect(statSync(expected).isFile()).toBe(true)

    const doc = await parseDoc(expected)
    expect(doc.frontmatter).toMatchObject({
      code: '600000', name: '浦发银行', tradeDate: '2026-09-24', subjective: true, patterns: [], drafts: [],
    })
    expect(doc.cards).toHaveLength(1)
    expect(doc.cards[0].anchor).toBe('card-20260924-600000-1432')
    expect(doc.cards[0].body).toBe('分时缩量回踩，观察 20 日线承接')
    // 分节标题与锚点时间同源（同一 formatAnchorTime）。
    const text = readFileSync(expected, 'utf8')
    expect(text).toContain('## 14:32 ^card-20260924-600000-1432')
    expect(text).toContain('- writtenAt: 2026-09-24T14:32:05+08:00')
  })

  it('同日第二张卡：不产生新文件，插入既有文档卡片区尾部', async () => {
    const root = makeTempRoot()
    const first = await appendCard({ loc: loc(root), body: '第一张', now: NOW_1432, clientRequestId: 'req-1' })
    const second = await appendCard({ loc: loc(root), body: '第二张', now: NOW_1500, clientRequestId: 'req-2' })
    expect(second.status).toBe('created')
    expect(second.path).toBe(first.path)
    expect(second.anchor).toBe('card-20260924-600000-1500')
    expect(readdirSync(reviewDir(root))).toHaveLength(1)
    const doc = await parseDoc(first.path)
    expect(doc.cards.map((c) => c.body)).toEqual(['第一张', '第二张'])
  })

  it('跨日新文档：不同 tradeDate 各自成档（跨月亦然）', async () => {
    const root = makeTempRoot()
    const d24 = await appendCard({ loc: loc(root), body: '24 日', now: NOW_1432 })
    const d25 = await appendCard({ loc: loc(root, { tradeDate: '2026-09-25' }), body: '25 日', now: NOW_1432 })
    const d10 = await appendCard({ loc: loc(root, { tradeDate: '2026-10-09' }), body: '10 月 9 日', now: NOW_1432 })
    expect(d24.path).not.toBe(d25.path)
    expect(d25.path).not.toBe(d10.path)
    expect(d10.path.replaceAll('\\', '/')).toContain('DB/review/202610')
    expect((await parseDoc(d24.path)).cards).toHaveLength(1)
    expect((await parseDoc(d25.path)).cards[0].anchor).toBe('card-20260925-600000-1432')
    expect((await parseDoc(d10.path)).cards[0].anchor).toBe('card-20261009-600000-1432')
  })
})

describe('文档复用与名称（spec「名称变化不产生第二份文档」「名称未获取」）', () => {
  it('名称变化：以代码+日期定位复用既有文档，MUST NOT 新建第二个文档', async () => {
    const root = makeTempRoot()
    const first = await appendCard({ loc: loc(root), body: '改名前', now: NOW_1432 })
    const renamed = await appendCard({ loc: loc(root, { name: '*ST浦发' }), body: '改名后', now: NOW_1500 })
    expect(renamed.path).toBe(first.path)
    expect(readdirSync(reviewDir(root))).toHaveLength(1)
    const doc = await parseDoc(first.path)
    expect(doc.cards.map((c) => c.body)).toEqual(['改名前', '改名后'])
  })

  it('名称未获取：以代码充当名称段并照常落盘，frontmatter name 为空串', async () => {
    const root = makeTempRoot()
    const r = await appendCard({ loc: { dataRoot: root, code: '600000', tradeDate: TRADE_DATE }, body: '无名', now: NOW_1432 })
    expect(r.path.endsWith('600000_600000_20260924.md')).toBe(true)
    const doc = await parseDoc(r.path)
    expect(doc.frontmatter.name).toBe('')
    expect(doc.cards).toHaveLength(1)
  })

  it('净化后为空 → 名称段回落代码段；代码+日期扫描命中既有文档（净化确定性）', async () => {
    const root = makeTempRoot()
    const a = await appendCard({ loc: loc(root, { name: '.' }), body: 'x', now: NOW_1432 })
    const b = await locateDoc(loc(root, { name: '   ' }))
    expect(a.path.endsWith('600000_600000_20260924.md')).toBe(true)
    expect(b.path).toBe(a.path)
  })
})

describe('锚点唯一与幂等（spec「同分钟多卡锚点唯一」「提交幂等」）', () => {
  it('同一分钟第二张卡：锚点追加 -2 序号，文档内锚点唯一', async () => {
    const root = makeTempRoot()
    const a = await appendCard({ loc: loc(root), body: '甲', now: NOW_1432, clientRequestId: 'r1' })
    const b = await appendCard({ loc: loc(root), body: '乙', now: NOW_1432B, clientRequestId: 'r2' })
    expect(a.anchor).toBe('card-20260924-600000-1432')
    expect(b.anchor).toBe('card-20260924-600000-1432-2')
    const doc = await parseDoc(a.path)
    const anchors = doc.cards.map((c) => c.anchor)
    expect(new Set(anchors).size).toBe(anchors.length)
    expect(doc.cards[1].writtenAt).toBe('2026-09-24T14:32:59+08:00')
  })

  it('同 clientRequestId 重复提交 → duplicate + 既有锚点，文档字节不变', async () => {
    const root = makeTempRoot()
    const first = await appendCard({ loc: loc(root), body: '原文', now: NOW_1432, clientRequestId: 'req-x' })
    const before = readFileSync(first.path)
    const again = await appendCard({ loc: loc(root), body: '重试的正文', now: NOW_1500, clientRequestId: 'req-x' })
    expect(again.status).toBe('duplicate')
    expect(again.anchor).toBe(first.anchor)
    expect(again.path).toBe(first.path)
    expect(readFileSync(first.path).equals(before)).toBe(true)
  })

  it('不同 clientRequestId 正常追加两张，锚点唯一', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: loc(root), body: '一', now: NOW_1432, clientRequestId: 'r-1' })
    await appendCard({ loc: loc(root), body: '二', now: NOW_1500, clientRequestId: 'r-2' })
    const doc = await parseDoc((await locateDoc(loc(root))).path)
    expect(doc.cards).toHaveLength(2)
    expect(new Set(doc.cards.map((c) => c.anchor)).size).toBe(2)
  })

  it('缺正文显式报错且零写入（页面层 4xx 前置的存储层防线）', async () => {
    const root = makeTempRoot()
    await expect(appendCard({ loc: loc(root), body: '   ', now: NOW_1432 })).rejects.toThrow(/正文为空/)
    const listing = readdirSync(root, { recursive: true }).join(',')
    expect(listing).not.toContain('review')
  })
})

describe('写前归属硬校验 DOC_MISMATCH（spec「写前归属不一致」）', () => {
  it('frontmatter code 被外部改动 → 抛 DOC_MISMATCH（含两侧值），插件零写入', async () => {
    const root = makeTempRoot()
    const created = await appendCard({ loc: loc(root), body: '原文', now: NOW_1432 })
    // 外部（Obsidian 手改）把 frontmatter code 改为 000001。
    const tampered = readFileSync(created.path, 'utf8').replace('code: "600000"', 'code: "000001"')
    writeFileSync(created.path, tampered)

    const err = await appendCard({ loc: loc(root), body: '新卡', now: NOW_1500 }).then(
      () => { throw new Error('应抛 DOC_MISMATCH') },
      (e: unknown) => e as Error,
    )
    expect(err.name).toBe('DOC_MISMATCH')
    expect(err.message).toContain('000001')
    expect(err.message).toContain('600000')
    expect(err.message).toContain('2026-09-24')
    // 插件未写：文档仍为被外部改后的字节。
    expect(readFileSync(created.path, 'utf8')).toBe(tampered)
  })

  it('frontmatter tradeDate 与 loc 不一致 → 抛 DOC_MISMATCH，含两侧 tradeDate', async () => {
    const root = makeTempRoot()
    const created = await appendCard({ loc: loc(root), body: '原文', now: NOW_1432 })
    const tampered = readFileSync(created.path, 'utf8').replace('tradeDate: "2026-09-24"', 'tradeDate: "2026-09-23"')
    writeFileSync(created.path, tampered)
    const err = await appendCard({ loc: loc(root), body: '新卡', now: NOW_1500 }).then(
      () => { throw new Error('应抛 DOC_MISMATCH') },
      (e: unknown) => e as Error,
    )
    expect(err.name).toBe('DOC_MISMATCH')
    expect(err.message).toContain('2026-09-23')
    expect(err.message).toContain('2026-09-24')
    expect(readFileSync(created.path, 'utf8')).toBe(tampered)
  })

  it('非法入参显式报错：code 非法 / tradeDate 形态非法 / 真实日历非法', async () => {
    const root = makeTempRoot()
    await expect(appendCard({ loc: loc(root, { code: '60000' }), body: 'x', now: NOW_1432 })).rejects.toThrow(/6 位数字/)
    await expect(appendCard({ loc: loc(root, { tradeDate: '20260924' }), body: 'x', now: NOW_1432 })).rejects.toThrow(/YYYY-MM-DD/)
    await expect(appendCard({ loc: loc(root, { tradeDate: '2026-13-01' }), body: 'x', now: NOW_1432 })).rejects.toThrow()
  })
})

describe('插入位置（spec「追加/插入语义」：卡片在附注前、附注始终末尾）', () => {
  it('文档已含附注时，新卡片插入附注之前；附注字节不变且仍在文件末尾', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: loc(root), body: '卡一', now: NOW_1432, clientRequestId: 'r1' })
    const note = await appendAinote({
      loc: loc(root),
      body: 'AI 复盘摘要',
      generatedAt: '2026-09-24T15:00:00+08:00',
      dataSources: ['T1'],
      now: NOW_1500,
    })
    expect(note.status).toBe('created')
    expect(note.anchor).toBe('ainote-20260924-600000-1500')
    const beforeCard2 = readFileSync(note.path, 'utf8')
    const ainoteStart = beforeCard2.indexOf('## 15:00 ^ainote-')

    const card2 = await appendCard({ loc: loc(root), body: '卡二', now: NOW_1600, clientRequestId: 'r2' })
    expect(card2.status).toBe('created')
    const after = readFileSync(note.path, 'utf8')
    const iCard1 = after.indexOf('## 14:32 ^card-')
    const iCard2 = after.indexOf('## 16:00 ^card-')
    const iNote = after.indexOf('## 15:00 ^ainote-')
    expect(iCard1).toBeGreaterThanOrEqual(0)
    expect(iCard2).toBeGreaterThan(iCard1)
    expect(iNote).toBeGreaterThan(iCard2)
    // 既有字节 = 结果文件前缀 + 结果文件后缀（插入点后内容整体后移、字节不变）。
    expect(after.startsWith(beforeCard2.slice(0, ainoteStart))).toBe(true)
    expect(after.endsWith(beforeCard2.slice(ainoteStart))).toBe(true)
  })

  it('同日附注幂等：第二次 appendAinote → skipped + 既有锚点，不追加第二份', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: loc(root), body: '卡一', now: NOW_1432 })
    const n1 = await appendAinote({ loc: loc(root), body: '摘要一', generatedAt: '2026-09-24T15:00:00+08:00', dataSources: ['T1'], now: NOW_1500 })
    const before = readFileSync(n1.path)
    const n2 = await appendAinote({ loc: loc(root), body: '摘要二', generatedAt: '2026-09-24T16:00:00+08:00', dataSources: ['T1'], now: NOW_1600 })
    expect(n2.status).toBe('skipped')
    expect(n2.anchor).toBe(n1.anchor)
    expect(readFileSync(n1.path).equals(before)).toBe(true)
    const doc = await parseDoc(n1.path)
    expect(doc.ainotes).toHaveLength(1)
  })
})

describe('locateDoc（契约 §3）', () => {
  it('无文档 → 返回创建路径；有文档 → 命中复用；空告警字段存在', async () => {
    const root = makeTempRoot()
    const fresh = await locateDoc(loc(root))
    expect(fresh.warnings).toEqual([])
    const expected = resolveArea(root, 'review', { code: '600000', name: '浦发银行', date: TRADE_DATE_COMPACT }).absPath
    expect(fresh.path).toBe(expected)
    await appendCard({ loc: loc(root), body: 'x', now: NOW_1432 })
    const hit = await locateDoc(loc(root, { name: '别的名字' })) // 名称不影响定位
    expect(hit.path).toBe(expected)
  })

  it('nameTruncated 透传：名称超 40 字符 → 写入响应 warnings 含 nameTruncated', async () => {
    const root = makeTempRoot()
    const r = await appendCard({ loc: loc(root, { name: '横'.repeat(50) }), body: 'x', now: NOW_1432 })
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0]).toMatch(/^\[nameTruncated\] .+ — /)
    const fileName = r.path.split(/[\\/]/).at(-1)!
    expect([...fileName.split('_')[1]].length).toBe(40)
  })
})

describe('scanDailyCardTargets（契约 §3）', () => {
  it('按交易日汇总：cardCount/hasAinote/name，按代码排序', async () => {
    const root = makeTempRoot()
    await appendCard({ loc: loc(root), body: '甲', now: NOW_1432 })
    await appendCard({ loc: loc(root), body: '乙', now: NOW_1500 })
    await appendAinote({ loc: loc(root), body: '摘要', generatedAt: '2026-09-24T15:10:00+08:00', dataSources: ['T1'], now: NOW_1500 })
    await appendCard({ loc: loc(root, { code: '000001', name: '平安银行' }), body: '深市', now: NOW_1432 })
    await appendCard({ loc: loc(root, { code: '430047', name: '诺思兰德', tradeDate: '2026-09-25' }), body: '别的日子', now: NOW_1432 })

    const r = await scanDailyCardTargets(TRADE_DATE, root)
    expect(r.warnings).toEqual([])
    expect(r.map((t) => `${t.code}|${t.name}|${t.cardCount}|${t.hasAinote}`)).toEqual([
      '000001|平安银行|1|false',
      '600000|浦发银行|2|true',
    ])
    expect(r.every((t) => t.path.endsWith(`_${TRADE_DATE_COMPACT}.md`))).toBe(true)
  })

  it('目录不存在 → 空数组 + 空 warnings 字段存在', async () => {
    const root = makeTempRoot()
    const r = await scanDailyCardTargets(TRADE_DATE, root)
    expect(r).toHaveLength(0)
    expect(r.warnings).toEqual([])
  })

  it('未提供 dataRoot → 显式报错', async () => {
    await expect(scanDailyCardTargets(TRADE_DATE)).rejects.toThrow(/dataRoot/)
  })
})

describe('文件名净化接入（tasks 1.6/1.7：必经 resolveArea/sanitizeNameSegment 唯一实现）', () => {
  const cases: Array<[string, string]> = [
    ['*ST海航', '_ST海航'], // * → _
    ['a/b\\c:d', 'a_b_c_d'], // 路径分隔与冒号 → _（不建子目录、不越界）
    ['CON', 'CON_'], // Windows 保留名
    ['com1', 'com1_'], // 保留名（大小写不敏感）
  ]
  for (const [raw, expectedName] of cases) {
    it(`名称 '${raw}' → 名称段 '${expectedName}' 落盘成功`, async () => {
      const root = makeTempRoot()
      const r = await appendCard({ loc: loc(root, { name: raw }), body: 'x', now: NOW_1432 })
      expect(r.path.endsWith(`600000_${expectedName}_20260924.md`)).toBe(true)
      expect(existsSync(r.path)).toBe(true)
      // 不越出月目录：无子目录被创建。
      expect(readdirSync(reviewDir(root), { withFileTypes: true }).every((e) => e.isFile())).toBe(true)
    })
  }

  it('NFC 归一 + 北交所代码落盘', async () => {
    const root = makeTempRoot()
    const r = await appendCard({ loc: loc(root, { code: '430047', name: 'A\u0301股北交所' }), body: 'x', now: NOW_1432 })
    expect(r.path.endsWith('430047_\u00C1股北交所_20260924.md')).toBe(true)
    expect((await parseDoc(r.path)).frontmatter.code).toBe('430047')
  })
})
