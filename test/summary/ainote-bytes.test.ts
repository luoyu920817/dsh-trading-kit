/**
 * change 5 tasks 2.7：附注写入路径的字节级口径 fixture——CRLF / UTF-8 BOM /
 * 无尾换行三类 + 分节切片比较 + 文件前缀比较（复用 change 4 store-bytes 的口径，
 * 针对 `runAppendAinote`（→ change 4 appendAinote 同一实现）补断言）。
 * 零 mock：真实临时目录。
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { appendAinote } from '../../src/review/store.ts'
import { NOW, TRADE_DATE } from './helpers.ts'

function tempRoot(): string {
  return mkdtempSync(join(tmpdir(), 'dtk-ainote-bytes-'))
}

/** 造一份既定形态的文档（用户手写基调；由 appendCard 落盘保证 frontmatter 合法）。 */
async function seedWithEol(eol: 'crlf' | 'lf', bom: boolean, trailingNewline: boolean): Promise<{ root: string; path: string }> {
  const root = tempRoot()
  const r = await appendAinote as never // 占位引用（下方直接经 appendCard 构造）
  void r
  // 直接用 appendCard 造用户卡片文档：
  const { appendCard } = await import('../../src/review/store.ts')
  const created = await appendCard({
    loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
    body: '早盘观察：量能一般',
    now: NOW,
  })
  let bytes = readFileSync(created.path)
  // 规范化为 LF 再按目标形态重组。
  let text = bytes.toString('utf8').replace(/\r\n/g, '\n')
  if (!trailingNewline && text.endsWith('\n')) text = text.slice(0, -1)
  if (eol === 'crlf') text = text.replace(/\n/g, '\r\n')
  bytes = Buffer.from((bom ? '\uFEFF' : '') + text, 'utf8')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(created.path, bytes)
  return { root, path: created.path }
}

describe('附注写入的字节口径（tasks 2.7：三类 fixture + 切片/前缀断言）', () => {
  for (const [label, opts] of [
    ['CRLF', { eol: 'crlf', bom: false, trailingNewline: true }],
    ['UTF-8 BOM', { eol: 'lf', bom: true, trailingNewline: true }],
    ['无尾换行（LF）', { eol: 'lf', bom: false, trailingNewline: false }],
  ] as const) {
    it(`${label}：各 ^ainote- 分节字节不变 + 结果前缀 == 原字节（± 本文件 EOL）`, async () => {
      const { root, path } = await seedWithEol(opts.eol, opts.bom, opts.trailingNewline)
      const original = readFileSync(path)
      const originalText = original.toString('utf8')

      // 第一条附注落盘。
      const r1 = await appendAinote({
        loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
        body: '- missing: none\n- cacheReused: none\n\n研究辅助、不构成投资建议\n\n① 事实：样例。',
        dataSources: ['tq-local@1.2.0', 'T1 get_limit_reason'],
        generatedAt: '2026-09-24T15:00:00+08:00',
        now: NOW,
      })
      expect(r1.status).toBe('created')

      const after = readFileSync(path)
      const afterText = after.toString('utf8')

      // ① BOM 保留且唯一。
      expect(afterText.startsWith('\uFEFF')).toBe(opts.bom)
      expect((afterText.match(/\uFEFF/g) ?? []).length).toBe(opts.bom ? 1 : 0)

      // ② CRLF 不混排：文件内 LF 与 CRLF 不共存（按目标形态）。
      const bodyNoBom = afterText.replace(/^\uFEFF/, '')
      if (opts.eol === 'crlf') {
        expect(bodyNoBom.includes('\r\n')).toBe(true)
        expect(/(^|[^\r])\n/.test(bodyNoBom.replace(/\r\n/g, ''))).toBe(false)
      } else {
        expect(bodyNoBom.includes('\r')).toBe(false)
      }

      // ③ 文件前缀比较：结果文件的前 len(原字节) 字节 == 原字节（附注只能追加在末尾；
      //    无尾换行时允许恰好补一个本文件 EOL 作为分隔）。
      const eolSeq = opts.eol === 'crlf' ? Buffer.from('\r\n') : Buffer.from('\n')
      const origNoBom = opts.bom ? original.subarray(3) : original
      const expectPrefix = opts.trailingNewline
        ? origNoBom
        : Buffer.concat([origNoBom, eolSeq])
      expect(after.subarray(opts.bom ? 3 : 0).subarray(0, expectPrefix.length).equals(expectPrefix)).toBe(true)

      // ④ 分节切片比较：原每个 ^card- 分节的字节序列在新文件中原样出现（追加不动旧行）。
      const sectionRe = /^## .+ \^card-[^\r\n]*/gm
      for (const m of originalText.matchAll(sectionRe)) {
        const start = original.subarray(0, m.index).length
        // 用字节级 slice（原文件同一编码下）取该行起的一行：
        const lineEnd = original.indexOf(0x0a, start)
        const lineBytes = original.subarray(start, lineEnd === -1 ? original.length : lineEnd)
        expect(after.includes(lineBytes), `分节行被动: ${lineBytes.toString('utf8')}`).toBe(true)
      }

      // ⑤ 附注在文档末尾（末尾锚点行 = 本条附注的锚点；锚点之后不得再出现 card 分节）。
      expect(afterText).toContain(`^${r1.anchor}`)
      const anchorIdx = afterText.lastIndexOf(`^${r1.anchor}`)
      expect(afterText.slice(anchorIdx).includes('^card-')).toBe(false)
    })
  }

  it('frontmatter 键序/引号不变（最小修补——附注写入不重排既有键）', async () => {
    const { root, path } = await seedWithEol('lf', false, true)
    const original = readFileSync(path, 'utf8')
    const fmOrig = original.split('---')[1]
    await appendAinote({
      loc: { dataRoot: root, code: '600000', name: '浦发银行', tradeDate: TRADE_DATE },
      body: '- missing: none\n- cacheReused: none\n\n研究辅助、不构成投资建议',
      dataSources: ['tq-local@1.2.0'],
      generatedAt: '2026-09-24T15:00:00+08:00',
      now: NOW,
    })
    const fmAfter = readFileSync(path, 'utf8').split('---')[1]
    expect(fmAfter).toBe(fmOrig)
  })
})
