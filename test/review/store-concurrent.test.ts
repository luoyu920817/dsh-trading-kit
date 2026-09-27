/**
 * change 4 tasks 1.8：并发写纪律（契约 §5）——进程内互斥、写前 stat 校验重试、
 * CONCURRENT_WRITE、占用后重试成功。并发用真实 Promise 竞争；重试退避注入 0ms；
 * 外部修改/占用用真实文件系统操作经测试钩子注入（零 mock、零 sleep）。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendAinote, appendCard, parseDoc, setStoreWriteHooksForTest } from '../../src/review/store.ts'
import type { StoreWriteHooks } from '../../src/review/store.ts'
import { NOW_1432, NOW_1432B, NOW_1500, NOW_1600, TRADE_DATE, makeTempRoot } from './helpers.ts'

const LOC = { dataRoot: '', code: '600000', name: '浦发银行', tradeDate: TRADE_DATE }
function loc(root: string): typeof LOC {
  return { ...LOC, dataRoot: root }
}

afterEach(() => setStoreWriteHooksForTest(undefined))

describe('进程内并发（真实 Promise 竞争）', () => {
  it('页面写卡与附注写并发：两条均保留，卡片在附注之前、附注在末尾', async () => {
    const root = makeTempRoot()
    const first = await appendCard({ loc: loc(root), body: '既有卡', now: NOW_1432, clientRequestId: 'r0' })

    const [card, note] = await Promise.all([
      appendCard({ loc: loc(root), body: '并发卡', now: NOW_1500, clientRequestId: 'r1' }),
      appendAinote({ loc: loc(root), body: '并发摘要', generatedAt: '2026-09-24T16:00:00+08:00', dataSources: ['T1'], now: NOW_1600 }),
    ])
    expect(card.status).toBe('created')
    expect(note.status).toBe('created')
    expect(card.path).toBe(first.path)
    expect(note.path).toBe(first.path)

    const after = readFileSync(first.path, 'utf8')
    const iCard0 = after.indexOf('## 14:32 ^card-')
    const iCard1 = after.indexOf('## 15:00 ^card-')
    const iNote = after.indexOf('## 16:00 ^ainote-')
    expect(iCard1).toBeGreaterThan(iCard0)
    expect(iNote).toBeGreaterThan(iCard1)
    const doc = await parseDoc(first.path)
    expect(doc.cards.map((c) => c.body)).toEqual(['既有卡', '并发卡'])
    expect(doc.ainotes).toHaveLength(1)
    expect(doc.ainotes[0].body).toBe('并发摘要')
  })

  it('同卡并发（同 clientRequestId）：幂等去重，只落一张', async () => {
    const root = makeTempRoot()
    const [a, b] = await Promise.all([
      appendCard({ loc: loc(root), body: '唯一一张', now: NOW_1432, clientRequestId: 'same-id' }),
      appendCard({ loc: loc(root), body: '唯一一张', now: NOW_1432B, clientRequestId: 'same-id' }),
    ])
    const statuses = [a.status, b.status].sort()
    expect(statuses).toEqual(['created', 'duplicate'])
    expect(a.anchor).toBe(b.anchor)
    const doc = await parseDoc(a.path)
    expect(doc.cards).toHaveLength(1)
    expect(doc.cards[0].clientRequestId).toBe('same-id')
  })
})

describe('跨进程 stat 校验（外部修改经测试钩子在真实文件系统上注入）', () => {
  it('写前快照不一致 → 重读重试：外部追加内容保留，新卡片写入成功', async () => {
    const root = makeTempRoot()
    const created = await appendCard({ loc: loc(root), body: '卡一', now: NOW_1432 })
    const hooks: StoreWriteHooks = {
      retryDelaysMs: [0, 0, 0],
      onPhase: (phase, path, attempt) => {
        // 模拟 OneDrive/编辑器在「读取快照之后、复核之前」追加了内容。
        if (phase === 'before-verify' && attempt === 0) {
          const current = readFileSync(path, 'utf8')
          writeFileSync(path, current + '外部追加行（Obsidian 侧）\n', 'utf8')
        }
      },
    }
    setStoreWriteHooksForTest(hooks)
    const r = await appendCard({ loc: loc(root), body: '卡二', now: NOW_1500 })
    expect(r.status).toBe('created')
    expect(r.path).toBe(created.path)

    const doc = await parseDoc(created.path)
    // 外部追加行落在卡一分节内（外部编辑发生于卡一与卡二之间）——按分节语义保留。
    expect(doc.cards).toHaveLength(2)
    expect(doc.cards[0].body).toContain('卡一')
    expect(doc.cards[0].body).toContain('外部追加行（Obsidian 侧）')
    expect(doc.cards[1].body).toBe('卡二')
  })

  it('重试 3 次后仍冲突 → CONCURRENT_WRITE（含路径），MUST NOT 覆盖、无临时文件残留', async () => {
    const root = makeTempRoot()
    const created = await appendCard({ loc: loc(root), body: '原文', now: NOW_1432 })
    const original = readFileSync(created.path, 'utf8')
    const hooks: StoreWriteHooks = {
      retryDelaysMs: [0, 0, 0],
      onPhase: (phase, path, attempt) => {
        // 每次复核前外部都在改动 mtime（内容不变；两次固定远期时间交替，
        // 保证与刚读取的快照恒不相同）。
        if (phase === 'before-verify') {
          const mtime = attempt % 2 === 0 ? new Date(1_262_304_000_000) : new Date(1_262_304_000_001)
          utimesSync(path, new Date(0), mtime)
        }
      },
    }
    setStoreWriteHooksForTest(hooks)
    const err = await appendCard({ loc: loc(root), body: '新卡', now: NOW_1500 }).then(
      () => { throw new Error('应抛 CONCURRENT_WRITE') },
      (e: unknown) => e as Error,
    )
    expect(err.name).toBe('CONCURRENT_WRITE')
    expect(err.message).toContain(created.path)
    expect(err.message).toContain('未落盘')
    // 文档内容未被覆盖（mtime 变化但字节不变）。
    expect(readFileSync(created.path, 'utf8')).toBe(original)
    // 无临时文件残留。
    expect(readdirSync(root, { recursive: true }).filter((f) => String(f).includes('.tmp'))).toEqual([])
  })

  it('目标被外部占用（覆盖写失败）→ 重试成功；既有内容与既有分节保留', async () => {
    const root = makeTempRoot()
    const created = await appendCard({ loc: loc(root), body: '卡一', now: NOW_1432 })
    let saved = ''
    const hooks: StoreWriteHooks = {
      retryDelaysMs: [0, 0, 0],
      onPhase: (phase, path, attempt) => {
        if (phase === 'before-write' && attempt === 0) {
          // 占用模拟：目标被替换为同名目录（覆盖写必然失败，等同 OneDrive 占用）。
          saved = readFileSync(path, 'utf8')
          unlinkSync(path)
          mkdirSync(path)
        }
        if (phase === 'before-read' && attempt === 1) {
          // 占用解除：目录移除、原内容恢复。
          rmdirSync(path)
          writeFileSync(path, saved, 'utf8')
        }
      },
    }
    setStoreWriteHooksForTest(hooks)
    const r = await appendCard({ loc: loc(root), body: '卡二', now: NOW_1500 })
    expect(r.status).toBe('created')
    expect(r.path).toBe(created.path)
    const doc = await parseDoc(created.path)
    expect(doc.cards.map((c) => c.body)).toEqual(['卡一', '卡二'])
    expect(existsSync(created.path)).toBe(true)
    expect(readdirSync(root, { recursive: true }).filter((f) => String(f).includes('.tmp'))).toEqual([])
  })
})
