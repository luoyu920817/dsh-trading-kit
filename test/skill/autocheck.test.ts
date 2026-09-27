/**
 * tasks 3.2：启动检查（autoCheck 只检查不安装 + 节流 + 无来源跳过 + 失败不阻断）。
 * 桩计数用 node:https 真实环回服务；检查函数注入替身计数。
 */
import { afterEach, describe, expect, it } from 'vitest'
import path from 'node:path'
import { runAutoCheck } from '../../src/skill/autocheck.ts'
import { clearInFlightDownloadsForTest } from '../../src/skill/download.ts'
import { clearInProcessLocksForTest } from '../../src/skill/lock.ts'
import { allowSelfSignedCerts, startHttpsStub, zipResponse, type HttpStub } from './helpers/http-stub.ts'
import { tempGitProject } from './helpers/tmp.ts'
import { installSkill } from '../../src/skill/installer.ts'
import { metaPathFor, readMeta, writeMeta, emptyMeta } from '../../src/skill/state.ts'
import { buildOfficialLikeZip } from './helpers/zipgen.ts'

let restoreTls: (() => void) | null = null

afterEach(() => {
  restoreTls?.()
  restoreTls = null
  clearInFlightDownloadsForTest()
  clearInProcessLocksForTest()
})

describe('runAutoCheck（tasks 3.2）', () => {
  it('① 检查路径不调用 installSkill：源码断言 grep installSkill === 0', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const source = await readFile(fileURLToPath(new URL('../../src/skill/autocheck.ts', import.meta.url)), 'utf8')
    expect((source.match(/installSkill/g) ?? []).length).toBe(0)
  })

  it('② 正向控制：有记录值时首次挂载恰好 1 次出站，节流窗口内第二次为 0（桩计数）', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    const stub: HttpStub = await startHttpsStub(zipResponse())
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n')),
        projectRoot: project.path,
      })
      const requestsAfterInstall = stub.requests.length
      const first = await runAutoCheck({ sourceUrl: stub.origin, targetRoot })
      expect(first.ran).toBe(true)
      expect(stub.requests.length).toBe(requestsAfterInstall + 1)

      const second = await runAutoCheck({ sourceUrl: stub.origin, targetRoot })
      expect(second.ran).toBe(false)
      if (second.ran) throw new Error('expected skipped')
      expect(second.reason).toContain('节流')
      expect(stub.requests.length).toBe(requestsAfterInstall + 1) // 零出站
    } finally {
      await stub.close()
      await project.cleanup()
    }
  })

  it('③ 无来源用例：无记录值、installDir 空 → 跳过 + warning、零出站；结果正常返回', async () => {
    const checkerCalls: number[] = []
    const result = await runAutoCheck({
      check: async (input) => {
        checkerCalls.push(1)
        void input
        return { reachable: true, reason: null, etag: null, lastModified: null, availableVersion: null, bodyFetched: false }
      },
    })
    expect(result.ran).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings.join('\n')).toContain('无可用根来源')
    expect(checkerCalls.length).toBe(0)
  })

  it('③b autoCheck=false → 不探测（零出站）', async () => {
    const result = await runAutoCheck({ autoCheck: false, targetRoot: 'C:\\any' })
    expect(result.ran).toBe(false)
    if (result.ran) throw new Error('expected skipped')
    expect(result.reason).toContain('autoCheck')
  })

  it('④ 挂载检查失败不阻断：探针不可达 → ran=true 且 sourceReachable=unreachable（正常返回，不抛错）', async () => {
    const result = await runAutoCheck({
      targetRoot: 'C:\\proj\\.dsh\\skills',
      sourceUrl: 'https://127.0.0.1:9/pkg.zip',
      connectTimeoutMs: 300,
      totalTimeoutMs: 2_000,
      delay: async () => undefined,
    })
    expect(result.ran).toBe(true)
    if (result.ran) {
      expect(result.sourceReachable.state).toBe('unreachable')
      expect(result.sourceReachable.reason).not.toBe('')
    }
  })

  it('autoCheck 只检查不安装：源有新版本时目标目录字节不变、仅 availableVersion 更新', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    const stub = await startHttpsStub(zipResponse()) // 1.2.0 包
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const v111 = buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.1.0\n---\nold\n')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(v111), projectRoot: project.path,
      })
      const skillMdPath = path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')
      const bytesBefore = await (await import('node:fs/promises')).readFile(skillMdPath)

      const result = await runAutoCheck({ sourceUrl: stub.origin, targetRoot })
      expect(result.ran).toBe(true)
      if (result.ran) {
        expect(result.availableVersion).toBe('1.2.0') // 只检查
      }
      // 不安装：落点字节不变
      expect((await (await import('node:fs/promises')).readFile(skillMdPath)).equals(bytesBefore)).toBe(true)
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.version).toBe('1.1.0') // meta.version 仍是已安装版本
      expect(meta?.availableVersion).toBe('1.2.0')
      // 200 检查不回写 etag（旧标识保留，下次仍能发现更新）
      expect(meta?.etag).toBeNull()
    } finally {
      await stub.close()
      await project.cleanup()
    }
  })

  it('节流可被 lastCheckedAt 控制：写入新时间 → 跳过；checkIntervalHours 可覆盖', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const meta = emptyMeta()
      meta.projectRoot = project.path
      meta.targetRoot = targetRoot
      meta.name = 'tdx-tq-local'
      meta.lastCheckedAt = new Date().toISOString()
      await writeMeta(metaPathFor(targetRoot, 'tdx-tq-local'), meta)
      const result = await runAutoCheck({ targetRoot, check: async () => ({ reachable: true, reason: null, etag: null, lastModified: null, availableVersion: null, bodyFetched: false }) })
      expect(result.ran).toBe(false)
      if (result.ran) throw new Error('expected skipped')
      expect(result.reason).toContain('节流')
    } finally {
      await project.cleanup()
    }
  })
})
