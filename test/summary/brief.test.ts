/**
 * 当日盘面 md 单测（review-loop `daily-brief` tasks 3.3–3.5；零 mock：
 * 真实临时目录 + 真实文件；卡片交互经真实 store）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { briefPath, integrityLine, readBriefMeta, renderBrief, validateBriefInput, writeBrief, type WriteBriefInput } from '../../src/summary/brief.ts'
import { appendCard, scanDailyCardTargets } from '../../src/review/store.ts'

const TRADE_DATE = '2026-09-30'
const SECTIONS = {
  index: '上证指数 3949.91（来源：tq-local@2026-09-30）',
  sentiment: '情绪面：连板梯队断层（来源：卡片 999999）。',
  moneyEffect: '赚钱效应：昨日涨停 +3.21%（来源：tq-local@2026-09-30）。',
  theme: '题材：地产链走强（来源：卡片 000002）。',
}

function makeInput(over: Partial<WriteBriefInput> = {}): WriteBriefInput {
  return { tradeDate: TRADE_DATE, sections: { ...SECTIONS }, anchors: ['880863', '999999'], ...over }
}

function makeRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dtk-brief-'))
}

describe('渲染结构（spec「产物结构」）', () => {
  it('标题 + 生成提示行 + 固定行 + 四段字面标题 + frontmatter', () => {
    const text = renderBrief(makeInput(), '2026-09-30T17:35:00+08:00')
    expect(text).toContain('# 盘面整理 · 2026-09-30')
    expect(text).toContain('本文件由工作流生成')
    expect(text).toContain('数据完整性：完整')
    expect(text).toContain('研究辅助、不构成投资建议')
    expect(text).toContain('## 一、指数')
    expect(text).toContain('## 二、情绪')
    expect(text).toContain('## 三、赚钱效应')
    expect(text).toContain('## 四、题材')
    expect(text).toContain('kind: "daily-brief"')
    expect(text).toContain('anchors: ["880863", "999999"]')
    // 四段标题顺序固定。
    const order = ['## 一、指数', '## 二、情绪', '## 三、赚钱效应', '## 四、题材'].map((h) => text.indexOf(h))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('missing → 部分（缺 …），字段去重保序', () => {
    expect(integrityLine([])).toBe('数据完整性：完整')
    expect(integrityLine([
      { field: 'limitReason', reason: 'sourceUnavailable' },
      { field: 'quote', reason: 'sourceUnavailable' },
      { field: 'limitReason', reason: 'noRecord' },
    ])).toBe('数据完整性：部分（缺 limitReason、quote）')
    const text = renderBrief(makeInput({ missing: [{ field: 'limitReason', reason: 'sourceUnavailable' }] }), '2026-09-30T17:35:00+08:00')
    expect(text).toContain('数据完整性：部分（缺 limitReason）')
    expect(text).toContain('missing: ["limitReason:sourceUnavailable"]')
  })

  it('字节稳定：相同入参 + 相同 generatedAt → 完全相同', () => {
    const a = renderBrief(makeInput(), '2026-09-30T17:35:00+08:00')
    const b = renderBrief(makeInput(), '2026-09-30T17:35:00+08:00')
    expect(a).toBe(b)
  })
})

describe('入参校验（显式失败、零落盘）', () => {
  it('非法日期 / 缺段 / 空段 → 抛错点名字段', () => {
    expect(() => validateBriefInput(makeInput({ tradeDate: '2026-09-31' }))).toThrow(/tradeDate/)
    expect(() => validateBriefInput(makeInput({ tradeDate: '20260930' }))).toThrow(/tradeDate/)
    const missingSection = { ...SECTIONS, theme: '' }
    expect(() => validateBriefInput(makeInput({ sections: missingSection as never }))).toThrow(/sections.theme/)
    expect(() => validateBriefInput({ tradeDate: TRADE_DATE, sections: undefined as never })).toThrow(/sections/)
  })

  it('校验失败时 writeBrief 不写任何文件', async () => {
    const root = makeRoot()
    await expect(writeBrief(root, makeInput({ sections: { ...SECTIONS, index: '  ' } as never }))).rejects.toThrow(/sections.index/)
    expect(existsSync(join(root, 'DB'))).toBe(false)
  })
})

describe('写通道：覆盖重写 + 原子写 + 路径', () => {
  it('首次新建 replaced=false，路径 = DB/review/<YYYYMM>/<YYYYMMDD>-summary.md', async () => {
    const root = makeRoot()
    const out = await writeBrief(root, makeInput(), { now: new Date('2026-09-30T09:35:00Z') })
    expect(out.path.replaceAll('\\', '/')).toBe('DB/review/202609/20260930-summary.md')
    expect(out.replaced).toBe(false)
    expect(out.bytes).toBeGreaterThan(0)
    expect(out.generatedAt).toBe('2026-09-30T17:35:00+08:00')
    expect(briefPath(root, TRADE_DATE).absPath).toBe(join(root, 'DB', 'review', '202609', '20260930-summary.md'))
  })

  it('第二次覆盖重写：旧字节不留、无 -v2/.bak 第二份产物', async () => {
    const root = makeRoot()
    await writeBrief(root, makeInput(), { now: new Date('2026-09-30T09:35:00Z') })
    const out2 = await writeBrief(root, makeInput({ sections: { ...SECTIONS, theme: '题材：算力硬件走强（改版）。' } }), { now: new Date('2026-09-30T10:00:00Z') })
    expect(out2.replaced).toBe(true)
    const dir = join(root, 'DB', 'review', '202609')
    const names = readdirSync(dir)
    expect(names).toEqual(['20260930-summary.md'])
    const text = readFileSync(join(dir, '20260930-summary.md'), 'utf8')
    expect(text).toContain('算力硬件走强（改版）')
    expect(text).not.toContain('地产链走强')
  })

  it('原子性失败清理：rename 目标被目录占位 → 抛错且不留 .tmp 半截文件', async () => {
    const root = makeRoot()
    const dir = join(root, 'DB', 'review', '202609')
    mkdirSync(join(dir, '20260930-summary.md'), { recursive: true }) // 目标路径被目录占位
    await expect(writeBrief(root, makeInput(), { now: new Date('2026-09-30T09:35:00Z') })).rejects.toThrow()
    const leftovers = readdirSync(dir).filter((n) => n.endsWith('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('不触碰卡片文档与附注：写前后卡片字节与 mtime 不变；brief 不进卡片计数', async () => {
    const root = makeRoot()
    await appendCard({ loc: { dataRoot: root, code: '000002', name: '万科A', tradeDate: TRADE_DATE }, body: '地产链走强', clientRequestId: 'rv-1', now: new Date('2026-09-30T06:00:00Z') })
    const cardPath = join(root, 'DB', 'review', '202609', '000002_万科A_20260930.md')
    const before = { text: readFileSync(cardPath, 'utf8'), mtime: statSync(cardPath).mtimeMs }
    await writeBrief(root, makeInput(), { now: new Date('2026-09-30T09:35:00Z') })
    expect(readFileSync(cardPath, 'utf8')).toBe(before.text)
    expect(statSync(cardPath).mtimeMs).toBe(before.mtime)
    const targets = await scanDailyCardTargets(TRADE_DATE, root)
    expect(targets).toHaveLength(1)
    expect(targets[0].cardCount).toBe(1)
    expect(targets[0].code).toBe('000002')
  })
})

describe('readBriefMeta（只读元信息）', () => {
  it('不存在 → exists=false；存在 → generatedAt 原样', async () => {
    const root = makeRoot()
    const before = await readBriefMeta(root, TRADE_DATE)
    expect(before.exists).toBe(false)
    expect(before.generatedAt).toBeNull()
    await writeBrief(root, makeInput(), { now: new Date('2026-09-30T09:35:00Z') })
    const after = await readBriefMeta(root, TRADE_DATE)
    expect(after.exists).toBe(true)
    expect(after.generatedAt).toBe('2026-09-30T17:35:00+08:00')
    expect(after.path.replaceAll('\\', '/')).toBe('DB/review/202609/20260930-summary.md')
  })
})
