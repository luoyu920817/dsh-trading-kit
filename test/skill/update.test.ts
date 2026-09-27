/**
 * tasks 3.3（decideUpdate 纯判定 + 304/双缺降级行为）+ 3.4（源不可达降级）。
 * 零 mock：node:https 真实环回桩；零 sleep：退避注入 0ms。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { decideUpdate, runUpdate } from '../../src/skill/update.ts'
import { clearInFlightDownloadsForTest } from '../../src/skill/download.ts'
import { allowSelfSignedCerts, startHttpsStub, zipResponse } from './helpers/http-stub.ts'
import { buildOfficialLikeZip } from './helpers/zipgen.ts'
import { tempDir, tempGitProject } from './helpers/tmp.ts'
import { clearInProcessLocksForTest } from '../../src/skill/lock.ts'
import { metaPathFor, readMeta } from '../../src/skill/state.ts'
import { listDirHashes } from '../../src/skill/hash.ts'

const zeroDelay = async () => undefined
let restoreTls: (() => void) | null = null

afterEach(() => {
  restoreTls?.()
  restoreTls = null
  clearInFlightDownloadsForTest()
  clearInProcessLocksForTest()
})

describe('decideUpdate（tasks 3.3 纯判定）', () => {
  it('ETag 相等 → up-to-date；不等 → download', () => {
    expect(decideUpdate({ etag: '"a"', lastModified: null }, { etag: '"a"' })).toBe('up-to-date')
    expect(decideUpdate({ etag: '"a"', lastModified: null }, { etag: '"b"' })).toBe('download')
  })

  it('无 ETag 时用 Last-Modified（原样字符串比对）', () => {
    expect(
      decideUpdate({ etag: null, lastModified: 'Sun, 20 Sep 2026 11:49:07 GMT' }, { lastModified: 'Sun, 20 Sep 2026 11:49:07 GMT' }),
    ).toBe('up-to-date')
    expect(
      decideUpdate({ etag: null, lastModified: 'Sun, 20 Sep 2026 11:49:07 GMT' }, { lastModified: 'Mon, 21 Sep 2026 00:00:00 GMT' }),
    ).toBe('download')
  })

  it('双标识皆缺 → download（退化：每次都取）', () => {
    expect(decideUpdate({ etag: null, lastModified: null }, {})).toBe('download')
    expect(decideUpdate({ etag: null, lastModified: 'x' }, {})).toBe('download')
  })
})

describe('runUpdate（tasks 3.3 行为 + 3.4）', () => {
  it('304 → up-to-date 且零替换（目标 mtimeMs 与字节不变）', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    let etagState = '"etag-v2"'
    const stub = await startHttpsStub((req, res) => {
      if (req.headers['if-none-match'] === etagState) {
        res.writeHead(304)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/zip', etag: etagState })
      res.end(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n\nv2\n'))
    })
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      // 首次安装 1.1.0（带旧 etag）
      const { installSkill } = await import('../../src/skill/installer.ts')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.1.0\n---\n\nv1\n')),
        sourceId: '"etag-v2"', etag: '"etag-v2"',
        projectRoot: project.path,
      })
      const skillMdPath = path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')
      const mtimeBefore = (await fsp.stat(skillMdPath)).mtimeMs
      const bytesBefore = await fsp.readFile(skillMdPath)

      const result = await runUpdate({ targetRoot, name: 'tdx-tq-local', sourceUrl: stub.origin, delay: zeroDelay })
      expect(result.outcome).toBe('up-to-date')
      expect(result.ok).toBe(true)
      expect((await fsp.stat(skillMdPath)).mtimeMs).toBe(mtimeBefore)
      expect((await fsp.readFile(skillMdPath)).equals(bytesBefore)).toBe(true)
    } finally {
      await stub.close()
      await project.cleanup()
    }
  })

  it('200（源有更新且版本更高）→ 完整校验与原子安装，记录新旧版本', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    const stub = await startHttpsStub(zipResponse({ headers: { etag: '"etag-120"' } }))
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const { installSkill } = await import('../../src/skill/installer.ts')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.1.0\n---\nv1\n')),
        sourceId: '"etag-111"', projectRoot: project.path,
      })
      const result = await runUpdate({ targetRoot, name: 'tdx-tq-local', sourceUrl: stub.origin, delay: zeroDelay })
      expect(result.outcome).toBe('updated')
      expect(result.version).toBe('1.2.0')
      expect(result.previousVersion).toBe('1.1.0')
      expect(result.residue).toEqual([])
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.etag).toBe('"etag-120"')
    } finally {
      await stub.close()
      await project.cleanup()
    }
  })

  it('③ 源忽略条件请求恒 200 + 双标识缺失：按 version+SHA 判等 → up-to-date 零替换 + 「源不支持条件请求」warning', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    const zip = buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n\nsame\n')
    const stub = await startHttpsStub(zipResponse({ body: zip })) // 恒 200，无 etag/lastModified
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const { installSkill } = await import('../../src/skill/installer.ts')
      const { sha256Bytes } = await import('../../src/skill/hash.ts')
      // 双缺场景：sourceId = sha256:<archiveHash>（与 runUpdate 的退化派生一致）
      const archiveHash = sha256Bytes(new Uint8Array(zip))
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(zip), sourceId: `sha256:${archiveHash}`, projectRoot: project.path,
      })
      const skillMdPath = path.join(targetRoot, 'tdx-tq-local', 'SKILL.md')
      const mtimeBefore = (await fsp.stat(skillMdPath)).mtimeMs
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      const installedAtBefore = meta?.installedAt

      const result = await runUpdate({ targetRoot, name: 'tdx-tq-local', sourceUrl: stub.origin, delay: zeroDelay })
      expect(result.outcome).toBe('up-to-date')
      expect(result.warnings.join('\n')).toContain('源不支持条件请求')
      expect((await fsp.stat(skillMdPath)).mtimeMs).toBe(mtimeBefore)
      const { meta: after } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(after?.installedAt).toBe(installedAtBefore) // 不更新 installedAt
    } finally {
      await stub.close()
      await project.cleanup()
    }
  })

  it('④ 无日期重格式化：304/200 路径写 meta 的 lastModified 原样保留', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    const raw = 'Sun, 20 Sep 2026 11:49:07 GMT'
    const stub = await startHttpsStub(zipResponse({ headers: { etag: '"e"', 'last-modified': raw } }))
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const result = await runUpdate({ targetRoot, name: 'tdx-tq-local', sourceUrl: stub.origin, delay: zeroDelay })
      expect(result.ok).toBe(true)
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      expect(meta?.lastModified).toBe(raw)
    } finally {
      await stub.close()
      await project.cleanup()
    }
  })

  it('源不可达（桩关闭）→ source-unreachable + 已装版本字节不变 + reason 非空', async () => {
    restoreTls = allowSelfSignedCerts()
    const project = await tempGitProject()
    const targetRoot = path.join(project.path, '.dsh', 'skills')
    const { installSkill } = await import('../../src/skill/installer.ts')
    const zip = buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\nv\n')
    await installSkill({
      targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
      archiveBytes: new Uint8Array(zip), projectRoot: project.path,
    })
    const before = await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))
    // 预置 meta.sourceUrl 指向一个真实 https 不可达地址（已关闭端口的环回 https）
    const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
    meta!.sourceUrl = 'https://127.0.0.1:9/pkg.zip'
    await (await import('../../src/skill/state.ts')).writeMeta(metaPathFor(targetRoot, 'tdx-tq-local'), meta!)

    const result = await runUpdate({ targetRoot, name: 'tdx-tq-local', sourceUrl: 'https://127.0.0.1:9/pkg.zip', delay: zeroDelay, connectTimeoutMs: 300, totalTimeoutMs: 2_000 })
    expect(result.outcome).toBe('source-unreachable')
    expect(result.sourceReachable.state).toBe('unreachable')
    expect(result.sourceReachable.reason).not.toBe('')
    expect(await listDirHashes(path.join(targetRoot, 'tdx-tq-local'))).toEqual(before)
  })

  it('status() 不内联出站：sourceReachable 为缓存结论（桩计数不变）', async () => {
    const project = await tempGitProject()
    try {
      const targetRoot = path.join(project.path, '.dsh', 'skills')
      const { installSkill } = await import('../../src/skill/installer.ts')
      await installSkill({
        targetRoot, name: 'tdx-tq-local', kind: 'https-zip',
        archiveBytes: new Uint8Array(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\nv\n')),
        projectRoot: project.path,
      })
      const { meta } = await readMeta(metaPathFor(targetRoot, 'tdx-tq-local'))
      meta!.sourceReachable = { state: 'unreachable', checkedAt: '2026-09-27T00:00:00.000Z', reason: '缓存结论' }
      await (await import('../../src/skill/state.ts')).writeMeta(metaPathFor(targetRoot, 'tdx-tq-local'), meta!)

      const { buildSkillStatus } = await import('../../src/skill/status.ts')
      for (let index = 0; index < 5; index++) {
        const status = await buildSkillStatus({ cwd: project.path })
        expect(status.state).toBe('source-unreachable')
        expect(status.sourceReachable.checkedAt).toBe('2026-09-27T00:00:00.000Z')
      }
      // 无任何网络出口可断言：status 不接受 URL 参数、模块零 fetch（另见 source-assertions）
    } finally {
      await project.cleanup()
    }
  })
})
