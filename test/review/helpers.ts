/**
 * 复盘存储测试公共件（零 mock：真实临时目录 + 真实文件系统断言）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { setStoreWriteHooksForTest } from '../../src/review/store.ts'

/** 固定时钟：2026-09-24T14:32:05+08:00（锚点 1432 / 标题 14:32）。 */
export const NOW_1432 = new Date('2026-09-24T06:32:05Z')
/** 同一分钟的第二个时点（锚点冲突 → -2 序号）。 */
export const NOW_1432B = new Date('2026-09-24T06:32:59Z')
export const NOW_1500 = new Date('2026-09-24T07:00:00Z')
export const NOW_1600 = new Date('2026-09-24T08:00:00Z')
export const TRADE_DATE = '2026-09-24'
export const TRADE_DATE_COMPACT = '20260924'

export function makeTempRoot(prefix = 'dtk-review-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** 复盘月目录（与 mapping.ts 的 DB/review/<YYYYMM> 范式一致，仅测试断言用）。 */
export function reviewDir(root: string, compact = TRADE_DATE_COMPACT): string {
  return join(root, 'DB', 'review', compact.slice(0, 6))
}

export function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

export function writeRaw(path: string, content: string | Buffer): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

export function exists(path: string): boolean {
  return existsSync(path)
}

/** 从源码树读取文件文本（结构断言用；先由调用方保证目标非空）。 */
export function srcText(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

afterEach(() => {
  setStoreWriteHooksForTest(undefined)
})
