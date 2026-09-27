/**
 * tasks 1.8：唯一目录（mkdtemp）+ 进程内 mutex + 跨进程锁文件（含陈旧锁接管）。
 */
import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  LOCK_STALE_MS,
  acquireInstallLock,
  clearInProcessLocksForTest,
  withInstallLock,
} from '../../src/skill/lock.ts'
import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { tempDir } from './helpers/tmp.ts'

describe('install lock（tasks 1.8）', () => {
  it('mkdtemp 目录名两两不同（100 次循环断言无重复）', async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-lock-mkdtemp-'))
    try {
      const names = new Set<string>()
      for (let index = 0; index < 100; index++) {
        names.add(await fsp.mkdtemp(path.join(base, 'run-')))
      }
      expect(names.size).toBe(100)
    } finally {
      await fsp.rm(base, { recursive: true, force: true })
    }
  })

  it('进程内互斥：占用中第二调用被拒且原因含持锁 pid', async () => {
    clearInProcessLocksForTest()
    const dir = await tempDir()
    try {
      const first = await acquireInstallLock(dir.path)
      expect(first.ok).toBe(true)
      const second = await acquireInstallLock(dir.path)
      expect(second.ok).toBe(false)
      if (!second.ok) {
        expect(second.holder.pid).toBe(process.pid)
      }
      // 释放后可再次获取
      if (first.ok) await first.lock.release()
      const third = await acquireInstallLock(dir.path)
      expect(third.ok).toBe(true)
      if (third.ok) await third.lock.release()
    } finally {
      clearInProcessLocksForTest()
      await dir.cleanup()
    }
  })

  it('跨进程锁文件：lock.json 含 pid/startedAt；未过期锁被拒', async () => {
    clearInProcessLocksForTest()
    const dir = await tempDir()
    try {
      // 手工放置一个未过期的「他进程」锁
      const lockPath = path.join(dir.path, 'lock.json')
      await fsp.writeFile(lockPath, JSON.stringify({ pid: 424242, startedAt: new Date().toISOString() }), 'utf8')
      const result = await acquireInstallLock(dir.path)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.holder.pid).toBe(424242)
        expect(typeof result.holder.startedAt).toBe('string')
      }
    } finally {
      clearInProcessLocksForTest()
      await dir.cleanup()
    }
  })

  it('陈旧锁（startedAt 早于 10 分钟）被接管且 staleTakeover 标记存在', async () => {
    clearInProcessLocksForTest()
    const dir = await tempDir()
    try {
      const lockPath = path.join(dir.path, 'lock.json')
      const staleTime = new Date(Date.now() - LOCK_STALE_MS - 60_000).toISOString()
      await fsp.writeFile(lockPath, JSON.stringify({ pid: 111111, startedAt: staleTime }), 'utf8')
      const result = await acquireInstallLock(dir.path)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.lock.staleTakeover).toBe(true)
        await result.lock.release()
        // 接管后锁文件已被我的 pid 覆盖并随后释放删除
        await expect(fsp.access(lockPath)).rejects.toThrow()
      }
    } finally {
      clearInProcessLocksForTest()
      await dir.cleanup()
    }
  })

  it('内容不可解析的锁文件按陈旧锁处理（接管）', async () => {
    clearInProcessLocksForTest()
    const dir = await tempDir()
    try {
      await fsp.writeFile(path.join(dir.path, 'lock.json'), 'not-json{', 'utf8')
      const result = await acquireInstallLock(dir.path)
      expect(result.ok).toBe(true)
      if (result.ok) await result.lock.release()
    } finally {
      clearInProcessLocksForTest()
      await dir.cleanup()
    }
  })

  it('withInstallLock：正常路径返回值 + busy 路径返回 holder', async () => {
    clearInProcessLocksForTest()
    const dir = await tempDir()
    try {
      const good = await withInstallLock(dir.path, async () => 'value')
      expect(good.ok).toBe(true)
      if (good.ok) expect(good.value).toBe('value')

      const outer = await withInstallLock(dir.path, async () => {
        const inner = await withInstallLock(dir.path, async () => 'never')
        expect(inner.ok).toBe(false)
        if (!inner.ok) expect(inner.holder.pid).toBe(process.pid)
        return 'outer'
      })
      expect(outer.ok).toBe(true)
      if (outer.ok) expect(outer.value).toBe('outer')
    } finally {
      clearInProcessLocksForTest()
      await dir.cleanup()
    }
  })
})
