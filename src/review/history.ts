import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, isAbsolute, relative, resolve } from 'node:path'
import { resolveArea } from '../paths/resolve.ts'
import { isValidIsoDate } from '../data/date.ts'
import { marketPrefixForCode } from './ident.ts'
import { findFrontmatter, parseFrontmatterValues } from './md/frontmatter.ts'
import { Snapshot } from './snapshot.ts'
import { onReviewWrite } from './write-events.ts'

export interface HistoryEntry { path: string; code: string; market: string; date: string; name: string | null; mtimeMs: number }
const snapshots = new Map<string, Snapshot<HistoryEntry[]>>()

/**
 * 业务逻辑: 一次遍历所有月桶建立日期与名称索引，兼容市场前缀与旧文件名。
 * 关键判断: 旧文件按代码推导市场；名称仅取frontmatter，日期仅取合法格式。
 * 异常处理: 缺失目录为空表；单文件读取失败跳过，其他目录错误交由快照退避。
 * 参数: dataRoot为数据根。
 * 返回: 完整历史条目。
 */
async function scanHistory(dataRoot: string): Promise<HistoryEntry[]> {
  if (dataRoot === '') return []
  const base = dirname(resolveArea(dataRoot, 'review', { code: '600000', name: '', date: '19700101' }).areaDirAbs)
  const months = await readdir(base, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const result: HistoryEntry[] = []
  for (const month of months) {
    if (!month.isDirectory()) continue
    const dir = join(base, month.name)
    const files = await readdir(dir).catch(() => [] as string[])
    for (const file of files) {
      const match = /^((?:sh|sz|bj)?)(\d{6})_.+_(\d{4})(\d{2})(\d{2})\.md$/.exec(file)
      if (match === null) continue
      const date = `${match[3]}-${match[4]}-${match[5]}`
      if (!isValidIsoDate(date)) continue
      const path = join(dir, file)
      try {
        const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)])
        const block = findFrontmatter(text)
        const values = block === null ? {} : parseFrontmatterValues(block.bodyLines)
        result.push({ path, code: match[2], market: match[1] || marketPrefixForCode(match[2]), date, name: typeof values.name === 'string' && values.name.trim() !== '' ? values.name : null, mtimeMs: info.mtimeMs })
      } catch { /* 单文件竞态或不可读不阻塞其它记录 */ }
    }
  }
  return result.sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path))
}

/**
 * 业务逻辑: 同一数据根共用历史目录与名称索引并预热。
 * 关键判断: 30秒SWR，避免逐请求重扫全部月桶。
 * 异常处理: 失败五秒退避由Snapshot处理。
 * 参数: dataRoot数据根，onError为可选告警出口。
 * 返回: 历史快照。
 */
export function historySnapshot(dataRoot: string, onError?: (error: unknown) => void): Snapshot<HistoryEntry[]> {
  let snapshot = snapshots.get(dataRoot)
  if (snapshot === undefined) {
    snapshot = new Snapshot(() => scanHistory(dataRoot), 30_000, Date.now, onError)
    snapshots.set(dataRoot, snapshot)
    void snapshot.refresh()
  }
  if (onError !== undefined) snapshot.onError = onError
  return snapshot
}

/**
 * 业务逻辑: 按代码与市场筛选已完成历史索引。
 * 关键判断: 缺省市场遵循既有代码市场语义。
 * 异常处理: 空索引返回空表。
 * 参数: entries完整历史，code六位代码，market可选显式市场。
 * 返回: 当前标的匹配记录。
 */
export function historyFor(entries: HistoryEntry[], code: string, market?: string): HistoryEntry[] {
  return entries.filter((entry) => entry.code === code && entry.market === (market ?? marketPrefixForCode(code)))
}

onReviewWrite((path) => {
  for (const [root, snapshot] of snapshots) {
    const rel = relative(resolve(root), path)
    if (!rel.startsWith('..') && !isAbsolute(rel)) snapshot.invalidate()
  }
})
