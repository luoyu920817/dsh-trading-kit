/**
 * 运行摘要载体（change 5 daily-summary tasks 2.9 / 2.11；spec「运行摘要与具名生产者出口」，
 * iteration-1-contracts §10/§12.6）。
 *
 * - 路径：`<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`
 *   ——经 `src/paths/resolve.ts` 的 `resolveArea('cache', { date, fileName })` 解析
 *   （映射表唯一事实源，MUST NOT 自行拼接业务区路径）；`<YYYYMMDD>` 为 §1 允许的
 *   目录模板例外，canonical → 紧凑折算经 `src/data/date.ts`。
 * - schema：`{ tradeDate, created[], skipped[], failed[{code,reason}], deferred[{code,reason}],
 *   missing[{code,field,reason}], warnings[] }`；`failed`/`deferred` 每条 `reason` 非空；
 *   空清单也落摘要（六个数组键恒存在）。
 * - 原子写：同目录临时文件 + `rename` 覆盖 + 失败清理（中断不留半截 JSON）。
 * - **与业务文档不共用同一把锁**：本模块持有独立的进程内互斥表（键 = 摘要文件绝对
 *   路径），MUST NOT import `src/review/store.ts` 的写锁（文档写锁归 change 4；
 *   摘要写失败不阻断已完成的文档写入，D-11）。本模块是 `daily-summary-run.json`
 *   的唯一读写实现（§12.6 唯一生产者出口的消费底座）。
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { toCompactDate } from '../data/date.ts'
import { resolveArea } from '../paths/resolve.ts'

/** 摘要文件名（本仓唯一出现点；消费方一律经 runReportPath 取路径）。 */
export const RUN_REPORT_FILE_NAME = 'daily-summary-run.json'

/** created/skipped 元素（至少 {code, path, anchor}；reason 为空缺省）。 */
export interface RunReportDoneEntry {
  code: string
  path: string
  anchor: string
  reason?: string
}

/** failed/deferred 元素（reason 非空由出口校验）。 */
export interface RunReportFailureEntry {
  code: string
  reason: string
}

/** 逐字段缺失登记（摘要维度：带 code）。 */
export interface RunReportMissingEntry {
  code: string
  field: string
  reason: string
}

/** 运行摘要（六数组键恒存在；键序固定以保证幂等字节稳定）。 */
export interface RunReport {
  tradeDate: string
  created: RunReportDoneEntry[]
  skipped: RunReportDoneEntry[]
  failed: RunReportFailureEntry[]
  deferred: RunReportFailureEntry[]
  missing: RunReportMissingEntry[]
  warnings: string[]
}

/** 摘要文件绝对路径（经 resolveArea('cache') 映射表解析；dataRoot 未配置时显式报错）。 */
export function runReportPath(dataRoot: string, tradeDate: string): string {
  const compact = toCompactDate(tradeDate)
  return resolveArea(dataRoot, 'cache', { date: compact, fileName: RUN_REPORT_FILE_NAME }).absPath
}

/** 空摘要骨架（六数组键恒存在——字段缺失即违反「空清单也落摘要」）。 */
export function emptyRunReport(tradeDate: string): RunReport {
  return { tradeDate, created: [], skipped: [], failed: [], deferred: [], missing: [], warnings: [] }
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : []
}

/** 规整既有摘要文件内容（缺键补空数组、剔除非对象项；不抛错——坏行按缺失处理）。 */
function normalizeReport(raw: unknown, tradeDate: string): RunReport {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return emptyRunReport(tradeDate)
  const obj = raw as Record<string, unknown>
  return {
    tradeDate: typeof obj.tradeDate === 'string' ? obj.tradeDate : tradeDate,
    created: asArray(obj.created).filter((e): e is RunReportDoneEntry => typeof e === 'object' && e !== null && typeof (e as RunReportDoneEntry).code === 'string'),
    skipped: asArray(obj.skipped).filter((e): e is RunReportDoneEntry => typeof e === 'object' && e !== null && typeof (e as RunReportDoneEntry).code === 'string'),
    failed: asArray(obj.failed).filter((e): e is RunReportFailureEntry => typeof e === 'object' && e !== null && typeof (e as RunReportFailureEntry).code === 'string' && typeof (e as RunReportFailureEntry).reason === 'string'),
    deferred: asArray(obj.deferred).filter((e): e is RunReportFailureEntry => typeof e === 'object' && e !== null && typeof (e as RunReportFailureEntry).code === 'string' && typeof (e as RunReportFailureEntry).reason === 'string'),
    missing: asArray(obj.missing).filter((e): e is RunReportMissingEntry => typeof e === 'object' && e !== null && typeof (e as RunReportMissingEntry).code === 'string' && typeof (e as RunReportMissingEntry).field === 'string' && typeof (e as RunReportMissingEntry).reason === 'string'),
    warnings: asArray(obj.warnings).filter((w): w is string => typeof w === 'string'),
  }
}

export interface RunReportPatch {
  tradeDate: string
  /** 四态 entries；created/skipped 尽量带 path/anchor，failed/deferred 必带非空 reason。 */
  entries: Array<{
    code: string
    status: 'created' | 'skipped' | 'failed' | 'deferred'
    reason?: string
    path?: string
    anchor?: string
  }>
  /** 可选回填通道：逐字段缺失。 */
  missing?: RunReportMissingEntry[]
  /** 可选回填通道：告警（与既有 union 去重）。 */
  warnings?: string[]
}

/**
 * 合并写入补丁（tasks 2.11）：以 `(tradeDate, code)` 为键——同键覆盖（含跨态
 * 迁移：前批 failed 本批 created → 移入 created）、其余键保留；`missing` 以
 * `(code, field)` 为键同键覆盖；`warnings` 并集去重（保序）。确定性合并：同入参
 * 重复合并结果字节不变（数组顺序稳定）。
 */
export function mergeRunReport(existing: unknown, patch: RunReportPatch): RunReport {
  const base = normalizeReport(existing, patch.tradeDate)
  const patchCodes = new Set(patch.entries.map((e) => e.code))

  const buckets = {
    created: base.created.filter((e) => !patchCodes.has(e.code)),
    skipped: base.skipped.filter((e) => !patchCodes.has(e.code)),
    failed: base.failed.filter((e) => !patchCodes.has(e.code)),
    deferred: base.deferred.filter((e) => !patchCodes.has(e.code)),
  } as Record<'created' | 'skipped' | 'failed' | 'deferred', Array<RunReportDoneEntry | RunReportFailureEntry>>

  for (const entry of patch.entries) {
    const item: RunReportDoneEntry | RunReportFailureEntry = entry.status === 'created' || entry.status === 'skipped'
      ? { code: entry.code, path: entry.path ?? '', anchor: entry.anchor ?? '', ...(entry.reason !== undefined ? { reason: entry.reason } : {}) }
      : { code: entry.code, reason: entry.reason ?? '' }
    buckets[entry.status].push(item)
  }

  // missing：(code, field) 同键覆盖、其余保留。
  const patchMissingKeys = new Set((patch.missing ?? []).map((m) => `${m.code}\u0000${m.field}`))
  const missing = [
    ...base.missing.filter((m) => !patchMissingKeys.has(`${m.code}\u0000${m.field}`)),
    ...(patch.missing ?? []),
  ]

  // warnings：并集去重（保序：既有在前、新增在后）。
  const seen = new Set<string>()
  const warnings: string[] = []
  for (const w of [...base.warnings, ...(patch.warnings ?? [])]) {
    if (seen.has(w)) continue
    seen.add(w)
    warnings.push(w)
  }

  // 键序固定（tradeDate, created, skipped, failed, deferred, missing, warnings）。
  return {
    tradeDate: patch.tradeDate,
    created: buckets.created as RunReportDoneEntry[],
    skipped: buckets.skipped as RunReportDoneEntry[],
    failed: buckets.failed as RunReportFailureEntry[],
    deferred: buckets.deferred as RunReportFailureEntry[],
    missing,
    warnings,
  }
}

// ---------------------------------------------------------------------------
// 落盘（独立锁 + 原子写；与业务文档写锁不共用）
// ---------------------------------------------------------------------------

/** 本模块私有互斥表（键 = 摘要文件绝对路径；**不是** src/review/store.ts 的文档锁）。 */
const reportLocks = new Map<string, Promise<unknown>>()

function withReportLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = reportLocks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const sentinel = run.then(
    () => undefined,
    () => undefined,
  )
  reportLocks.set(key, sentinel)
  void sentinel.then(() => {
    if (reportLocks.get(key) === sentinel) reportLocks.delete(key)
  })
  return run
}

/** 读既有摘要；文件不存在 → null（调用方按空摘要起笔）。 */
export async function readRunReport(path: string): Promise<RunReport | null> {
  let buf: Buffer
  try {
    buf = await readFile(path)
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw e
  }
  try {
    return normalizeReport(JSON.parse(buf.toString('utf8')), '')
  } catch {
    return null // 半截/损坏文件视为无既有摘要（原子写保证正常路径不会出现）
  }
}

/**
 * 原子写摘要：同目录临时文件 + rename 覆盖 + 失败清理（中断不留半截 JSON）。
 * 调用方若要合并语义，先 readRunReport → mergeRunReport 再写入。
 */
export async function writeRunReport(path: string, report: RunReport): Promise<void> {
  return withReportLock(path, async () => {
    const dir = dirname(path)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${basename(path)}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      await writeFile(tmp, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      await rename(tmp, path)
    } catch (e) {
      await unlink(tmp).catch(() => { /* 清理失败不掩盖原错误 */ })
      throw e
    }
  })
}

/** 摘要文件是否存在（供「运行未发生 vs 当日无卡片」核对）。 */
export async function runReportExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === 'ENOENT') return false
    throw e
  }
}
