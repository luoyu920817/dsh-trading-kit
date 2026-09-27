/**
 * 并发与重入（tasks 1.8，design D-10）。
 *
 * 两层互斥（都是 try-acquire 语义，非排队）：
 * - 进程内：per-tmpBase 的占用表——同插件实例内第二个并发调用立即返回 busy；
 * - 跨进程：锁文件 `<tmpBase>/lock.json`（含 pid / startedAt），被占用时拒绝
 *   并提示持锁 pid 与开始时间；超过 LOCK_STALE_MS（10 分钟）视为陈旧锁并接管
 *   （接管动作记 warning，由调用方通过 `staleTakeover` 呈现）。
 *
 * 并发纪律：被拒调用返回 `outcome: 'rejected'`（installer.ts 映射），MUST NOT
 * 与成功结果混同；暂存目录一律 `fs.mkdtemp`（唯一名，MUST NOT 毫秒时间戳拼名）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'

export interface InstallLockInfo {
  pid: number
  startedAt: string
}

/** 锁过期阈值：10 分钟（design D-10）。 */
export const LOCK_STALE_MS = 10 * 60 * 1000

export interface AcquiredLock {
  path: string
  /** 接管了陈旧锁时为 true（调用方须记 warning）。 */
  staleTakeover: boolean
  release(): Promise<void>
}

export type LockAcquireResult =
  | { ok: true; lock: AcquiredLock }
  | { ok: false; holder: InstallLockInfo }

/** 进程内占用表：key = 规范化 tmpBase。 */
const inProcessLocks = new Map<string, InstallLockInfo>()

function lockFilePath(tmpBase: string): string {
  return path.join(path.resolve(tmpBase), 'lock.json')
}

function describeHolder(holder: InstallLockInfo): string {
  return `另一处安装进行中（pid=${holder.pid}，开始于 ${holder.startedAt}）`
}

export function describeLockHolder(holder: InstallLockInfo): string {
  return describeHolder(holder)
}

/**
 * 尝试获取安装锁（进程内 + 跨进程；try-acquire，不等待）。
 * - 进程内已占用 / 锁文件未过期 → `{ ok: false, holder }`；
 * - 锁文件存在但超过 LOCK_STALE_MS（或内容不可解析）→ 接管（staleTakeover: true）；
 * - 无锁 → 以 `wx` 独占创建锁文件。
 */
export async function acquireInstallLock(tmpBase: string): Promise<LockAcquireResult> {
  const base = path.resolve(tmpBase)
  const filePath = lockFilePath(base)

  const inProcess = inProcessLocks.get(base)
  if (inProcess) {
    return { ok: false, holder: inProcess }
  }

  await fsp.mkdir(base, { recursive: true })
  let holderFromFile: InstallLockInfo | null = null
  try {
    const raw = await fsp.readFile(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<InstallLockInfo>
    if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') {
      holderFromFile = { pid: parsed.pid, startedAt: parsed.startedAt }
    }
  } catch {
    // 无锁文件或内容不可解析（后者按陈旧锁处理）
  }

  let staleTakeover = false
  if (holderFromFile) {
    const startedAtMs = Date.parse(holderFromFile.startedAt)
    const stale = Number.isNaN(startedAtMs) || Date.now() - startedAtMs > LOCK_STALE_MS
    if (!stale) {
      return { ok: false, holder: holderFromFile }
    }
    staleTakeover = true
  }

  const mine: InstallLockInfo = { pid: process.pid, startedAt: new Date().toISOString() }
  try {
    await fsp.writeFile(filePath, JSON.stringify(mine, null, 2), { flag: 'wx' })
  } catch {
    // wx 失败 = 并发创建竞态：重读并按未过期锁处理
    try {
      const raw = await fsp.readFile(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<InstallLockInfo>
      if (typeof parsed.pid === 'number' && typeof parsed.startedAt === 'string') {
        const startedAtMs = Date.parse(parsed.startedAt)
        if (!Number.isNaN(startedAtMs) && Date.now() - startedAtMs <= LOCK_STALE_MS) {
          return { ok: false, holder: { pid: parsed.pid, startedAt: parsed.startedAt } }
        }
      }
    } catch {
      /* 忽略：下方直接覆盖接管 */
    }
    await fsp.writeFile(filePath, JSON.stringify(mine, null, 2), 'utf8')
    staleTakeover = true
  }

  inProcessLocks.set(base, mine)
  return {
    ok: true,
    lock: {
      path: filePath,
      staleTakeover,
      release: async () => {
        inProcessLocks.delete(base)
        await fsp.rm(filePath, { force: true })
      },
    },
  }
}

/** withInstallLock：获取锁 → 执行 fn → 释放；被拒时返回 `{ ok: false, holder }`。 */
export async function withInstallLock<T>(
  tmpBase: string,
  fn: (lock: AcquiredLock) => Promise<T>,
): Promise<{ ok: true; value: T; staleTakeover: boolean } | { ok: false; holder: InstallLockInfo }> {
  const acquired = await acquireInstallLock(tmpBase)
  if (!acquired.ok) {
    return { ok: false, holder: acquired.holder }
  }
  try {
    const value = await fn(acquired.lock)
    return { ok: true, value, staleTakeover: acquired.lock.staleTakeover }
  } finally {
    await acquired.lock.release()
  }
}

/** 仅测试使用：清空进程内占用表（跨用例隔离）。 */
export function clearInProcessLocksForTest(): void {
  inProcessLocks.clear()
}
