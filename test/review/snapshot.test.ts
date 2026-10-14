import { expect, it } from 'vitest'
import { Snapshot } from '../../src/review/snapshot.ts'

it('快照冷读共用刷新、过期保留旧值、失败五秒退避且失效拒绝旧回填', async () => {
  let now = 0
  let calls = 0
  let finish!: (v: number) => void
  const snapshot = new Snapshot<number>(() => { calls++; return new Promise((resolve) => { finish = resolve }) }, 120_000, () => now)
  const first = snapshot.refresh()
  expect(snapshot.refresh()).toBe(first)
  expect(snapshot.state).toBe('loading')
  finish(1)
  await first
  expect(snapshot.value).toBe(1)
  now = 120_001
  snapshot.read()
  expect(snapshot.value).toBe(1)
  expect(calls).toBe(2)
  snapshot.invalidate()
  finish(2)
  await snapshot.refresh()
  expect(snapshot.value).toBeUndefined()
  let attempts = 0
  const warnings: string[] = []
  const failed = new Snapshot(() => { attempts++; throw new Error('读失败') }, 30_000, () => now, (error) => { warnings.push(String(error)) })
  await failed.refresh()
  expect(failed.state).toBe('error')
  await failed.refresh()
  expect(attempts).toBe(1)
  expect(warnings).toEqual(['Error: 读失败'])
  now += 5_000
  await failed.refresh()
  expect(attempts).toBe(2)
  expect(warnings).toEqual(['Error: 读失败', 'Error: 读失败'])
})
