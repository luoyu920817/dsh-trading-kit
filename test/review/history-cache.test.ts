import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { historySnapshot, historyFor } from '../../src/review/history.ts'
import { stockProfileSnapshot, readStockProfiles } from '../../src/review/profile.ts'
import { createNameResolver } from '../../src/review/context.ts'
import { appendCard } from '../../src/review/store.ts'
import { makeTempRoot } from './helpers.ts'

it('完整档案快照跨查询共享且不丢非锚点，复用既有多命中选择规则', async () => {
  const root = makeTempRoot()
  const dir = join(root, 'DB', 'stock')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, '普通档案.md'), '---\n代码: 600000\n角色: 银行\n---\n')
  await writeFile(join(dir, '锚点档案.md'), '---\n代码: 880001\n锚点: true\n---\n')
  const snapshot = stockProfileSnapshot(root)
  expect(stockProfileSnapshot(root)).toBe(snapshot)
  await snapshot.refresh()
  expect(snapshot.state).toBe('ready')
  expect(snapshot.value?.profiles).toHaveLength(2)
  const selected = await readStockProfiles(root, { codes: ['600000', '880001'] }, snapshot.value)
  expect(selected.entries.map((entry) => [entry.code, entry.name, entry.isAnchor])).toEqual([
    ['600000', '普通档案', false], ['880001', '锚点档案', true],
  ])
})

it('市场前缀与旧名共用索引，坏日期不影响其它文件，写后立即失效', async () => {
  const root = makeTempRoot()
  await appendCard({ loc: { dataRoot: root, code: '000688', market: 'sh', name: '科创50', tradeDate: '2026-09-24' }, body: '指数' })
  await appendCard({ loc: { dataRoot: root, code: '000688', name: '国城矿业', tradeDate: '2026-09-24' }, body: '股票' })
  await writeFile(join(root, 'DB', 'review', '202609', '000688_错误_20269999.md'), '---\nname: 错误\n---\n')
  const snapshot = historySnapshot(root)
  expect(historySnapshot(root)).toBe(snapshot)
  await snapshot.refresh()
  expect(snapshot.state).toBe('ready')
  expect(snapshot.value).toHaveLength(2)
  expect(historyFor(snapshot.value ?? [], '000688', 'sh').map((entry) => entry.name)).toEqual(['科创50'])
  const resolver = createNameResolver({ dataRoot: root })
  expect((await resolver.resolve('000688', 'sh')).value).toBe('科创50')
  expect((await resolver.resolve('000688')).value).toBe('国城矿业')
  await appendCard({ loc: { dataRoot: root, code: '000688', name: '国城矿业', tradeDate: '2026-09-25' }, body: '次日' })
  expect(snapshot.value).toBeUndefined()
  await snapshot.refresh()
  expect(snapshot.value).toHaveLength(3)
})
