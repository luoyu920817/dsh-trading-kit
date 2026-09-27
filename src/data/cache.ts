/**
 * 两层缓存（data-tool-contract「缓存幂等与原子写（两层缓存）」/ design D-3、D-18）。
 *
 * - **列表级**：键 = `source + requestedDate`（调用方入参、可构造）；payload 内含源返回的
 *   `businessDate`（值，非键）与 `hitEndpoint`。
 * - **code 派生视图级**：键 = `requestedDate + code`（T1/T2 的 per-code 结果）。
 * - MUST NOT 用 `businessDate` 做键（响应到达前不可知，读键写键会不是同一个量）——
 *   本 API 只接受 `requestedDate` 构造键，结构上不可能用业务日做键。
 * - 目录按 `requestedDate` 经 `toCompactDate` 折算 `<YYYYMMDD>` 分桶（YYYYMMDD 三处
 *   允许位置之一：天级缓存目录，contracts §1）；路径解析走 `resolveArea('cache')`。
 * - `cacheSchema`（模块名 + 版本）不匹配 → 视为**未命中**，由本轮结果原位覆盖写。
 * - 原子写（临时文件 + rename）+ 写前 re-read（OneDrive 并发容忍：并发方更新则让位）。
 * - 无 `refresh` 入参（本迭代无刷新入口；实现与文档不得出现该幽灵参数）。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { toCompactDate } from './date.ts'
import { ensureDir } from '../paths/fs.ts'
import { resolveArea } from '../paths/resolve.ts'

export interface CacheListEntry<P> {
  cacheSchema: string
  /** source 位（'S7' 等；概念模块为固定标识 'concepts'）。 */
  source: string
  requestedDate: string
  /** 源返回的业务日（值，非键；源无日期字段时为 null——T2 例外，design D-18）。 */
  businessDate: string | null
  hitEndpoint: string | null
  fetchedAt: string
  payload: P
  errors: string[]
  notes: string[]
}

export interface CacheListViewInput<P> {
  businessDate: string | null
  hitEndpoint: string | null
  fetchedAt: string
  payload: P
  errors?: string[]
  notes?: string[]
}

export interface CacheViewEntry<P> {
  cacheSchema: string
  requestedDate: string
  code: string
  businessDate: string | null
  fetchedAt: string
  value: P
}

export interface DataCache {
  /** 列表级读；`cacheSchema` 不匹配或文件缺失/损坏 → null（视为未命中）。 */
  readList<P>(module: string, schema: string, source: string, requestedDate: string): Promise<CacheListEntry<P> | null>
  /** 列表级写（原位覆盖；写前 re-read，并发方更新则让位）。 */
  writeList<P>(module: string, schema: string, source: string, requestedDate: string, view: CacheListViewInput<P>): Promise<void>
  /** code 派生视图级读。 */
  readView<P>(module: string, schema: string, requestedDate: string, code: string): Promise<CacheViewEntry<P> | null>
  /** code 派生视图级写。 */
  writeView<P>(module: string, schema: string, requestedDate: string, code: string, value: P, meta: { businessDate: string | null; fetchedAt: string }): Promise<void>
}

export function createDataCache(dataRoot: string): DataCache {
  function cacheFilePath(module: string, key: string, requestedDate: string): string {
    // 目录段由 requestedDate 折算（YYYYMMDD 允许位置②：天级缓存目录）；forWrite：缓存区为 active。
    const area = resolveArea(dataRoot, 'cache', { date: toCompactDate(requestedDate), fileName: `${module}__${key}.json` }, { forWrite: true })
    return area.absPath
  }

  async function readJson<P>(file: string, schema: string): Promise<{ entry: P; fetchedAt: string } | null> {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      return null
    }
    try {
      const parsed = JSON.parse(text) as P & { cacheSchema?: string; fetchedAt?: string }
      if (parsed.cacheSchema !== schema) return null // schema 不匹配 → 未命中（由本轮覆盖写）
      return { entry: parsed, fetchedAt: typeof parsed.fetchedAt === 'string' ? parsed.fetchedAt : '' }
    } catch {
      return null
    }
  }

  /**
   * 原子写：临时文件 + rename（写入中断不留半截 JSON）；写前 re-read——既有文件为
   * 同 schema 且 fetchedAt 不早于本次时让位（OneDrive 并发容忍，MUST NOT 整目录重写）。
   */
  async function writeJsonAtomic(file: string, value: unknown, schema: string, fetchedAt: string): Promise<void> {
    const existing = await readJson<{ fetchedAt?: string }>(file, schema)
    if (existing !== null && existing.fetchedAt >= fetchedAt) return
    await ensureDir(dirname(file))
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, file)
  }

  return {
    async readList<P>(module: string, schema: string, source: string, requestedDate: string): Promise<CacheListEntry<P> | null> {
      const file = cacheFilePath(module, `list__${source}__${requestedDate}`, requestedDate)
      const found = await readJson<CacheListEntry<P>>(file, schema)
      return found?.entry ?? null
    },

    async writeList<P>(module: string, schema: string, source: string, requestedDate: string, view: CacheListViewInput<P>): Promise<void> {
      const file = cacheFilePath(module, `list__${source}__${requestedDate}`, requestedDate)
      const entry: CacheListEntry<P> = {
        cacheSchema: schema,
        source,
        requestedDate,
        businessDate: view.businessDate,
        hitEndpoint: view.hitEndpoint,
        fetchedAt: view.fetchedAt,
        payload: view.payload,
        errors: view.errors ?? [],
        notes: view.notes ?? [],
      }
      await writeJsonAtomic(file, entry, schema, view.fetchedAt)
    },

    async readView<P>(module: string, schema: string, requestedDate: string, code: string): Promise<CacheViewEntry<P> | null> {
      const file = cacheFilePath(module, `view__${code}__${requestedDate}`, requestedDate)
      const found = await readJson<CacheViewEntry<P>>(file, schema)
      return found?.entry ?? null
    },

    async writeView<P>(module: string, schema: string, requestedDate: string, code: string, value: P, meta: { businessDate: string | null; fetchedAt: string }): Promise<void> {
      const file = cacheFilePath(module, `view__${code}__${requestedDate}`, requestedDate)
      const entry: CacheViewEntry<P> = {
        cacheSchema: schema,
        requestedDate,
        code,
        businessDate: meta.businessDate,
        fetchedAt: meta.fetchedAt,
        value,
      }
      await writeJsonAtomic(file, entry, schema, meta.fetchedAt)
    },
  }
}

/** 测试与运维辅助：天级缓存目录内是否有残留临时文件（原子写中断检查）。 */
export async function listCacheTmpFiles(dataRoot: string, requestedDate: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const area = resolveArea(dataRoot, 'cache', { date: toCompactDate(requestedDate) }, { forWrite: true })
  try {
    const names = await readdir(area.absPath)
    return names.filter((n) => n.includes('.tmp-')).map((n) => join(area.absPath, n))
  } catch {
    return []
  }
}
