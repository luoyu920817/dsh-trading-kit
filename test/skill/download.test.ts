/**
 * tasks 1.2（条件请求/临时区落盘/超时/重试/字节上限）+ 3.8（进程内去重）。
 * 零 mock：node:https 真实本地桩（自签名环回证书 + 随机端口，走真实 TLS/fetch）；
 * 零 sleep：退避延时注入 0ms，超时用例以注入的短超时 + await 真实拒绝完成。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import {
  DOWNLOAD_GUARDS,
  MAX_RETRIES,
  RETRY_BACKOFF_MS,
  clearInFlightDownloadsForTest,
  downloadToFile,
} from '../../src/skill/download.ts'
import { allowSelfSignedCerts, startHttpStub, startHttpsStub, zipResponse, type HttpStub } from './helpers/http-stub.ts'
import { buildOfficialLikeZip } from './helpers/zipgen.ts'
import { tempDir } from './helpers/tmp.ts'
import { SkillInstallerError } from '../../src/skill/errors.ts'

const zeroDelay = async () => undefined
let restoreTls: (() => void) | null = null

afterEach(() => {
  restoreTls?.()
  restoreTls = null
  clearInFlightDownloadsForTest()
})

async function httpsStub(handler: Parameters<typeof startHttpsStub>[0]): Promise<HttpStub> {
  restoreTls = allowSelfSignedCerts()
  return startHttpsStub(handler)
}

describe('downloadToFile（tasks 1.2）', () => {
  it('200 + zip：落盘临时区 + 响应头原样保存（etag/lastModified 不重格式化）', async () => {
    const stub = await httpsStub(zipResponse({ headers: { etag: '"abc-123"', 'last-modified': 'Mon, 21 Sep 2026 08:00:00 GMT' } }))
    const dir = await tempDir()
    try {
      const dest = path.join(dir.path, 'package.zip')
      const result = await downloadToFile({ url: `${stub.origin}/pkg.zip`, destinationPath: dest, delay: zeroDelay })
      expect(result.status).toBe(200)
      expect(result.archivePath).toBe(dest)
      expect(result.headers.etag).toBe('"abc-123"')
      expect(result.headers.lastModified).toBe('Mon, 21 Sep 2026 08:00:00 GMT')
      expect(result.headers.url).toBe(`${stub.origin}/pkg.zip`)
      const bytes = await fsp.readFile(dest)
      expect(bytes.length).toBeGreaterThan(0)
      expect(stub.requests.length).toBe(1)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('304：零体下载分支（不写文件），条件请求头按 If-None-Match 优先发送', async () => {
    const stub = await httpsStub((req, res) => {
      if (req.headers['if-none-match'] === '"cached-etag"') {
        res.writeHead(304)
        res.end()
        return
      }
      if (req.headers['if-modified-since'] === 'Sun, 20 Sep 2026 11:49:07 GMT' && !req.headers['if-none-match']) {
        res.writeHead(304)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/zip' })
      res.end(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n'))
    })
    const dir = await tempDir()
    try {
      const dest = path.join(dir.path, 'pkg.zip')
      const viaEtag = await downloadToFile({ url: stub.origin, destinationPath: dest, etag: '"cached-etag"', delay: zeroDelay })
      expect(viaEtag.status).toBe(304)
      await expect(fsp.access(dest)).rejects.toThrow()
      const viaLastModified = await downloadToFile({
        url: stub.origin,
        destinationPath: dest,
        lastModified: 'Sun, 20 Sep 2026 11:49:07 GMT',
        delay: zeroDelay,
      })
      expect(viaLastModified.status).toBe(304)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('302 到异 host：redirect: manual 下显式报错且错误含目标 URL', async () => {
    const stub = await httpsStub((_req, res) => {
      res.writeHead(302, { location: 'https://evil.example.com/pkg.zip' })
      res.end()
    })
    const dir = await tempDir()
    try {
      const caught = await downloadToFile({
        url: stub.origin,
        destinationPath: path.join(dir.path, 'x.zip'),
        delay: zeroDelay,
      }).then(
        () => null,
        (error: unknown) => error,
      )
      expect(caught).toBeInstanceOf(SkillInstallerError)
      expect((caught as SkillInstallerError).message).toMatch(/evil\.example\.com/)
      expect((caught as SkillInstallerError).details.redirectTarget).toBe('https://evil.example.com/pkg.zip')
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('非 2xx：显式报错（含状态码与 URL），不重试', async () => {
    const stub = await httpsStub((_req, res) => {
      res.writeHead(404)
      res.end('nope')
    })
    const dir = await tempDir()
    try {
      await expect(
        downloadToFile({ url: `${stub.origin}/missing.zip`, destinationPath: path.join(dir.path, 'x.zip'), delay: zeroDelay }),
      ).rejects.toThrowError(/404/)
      expect(stub.requests.length).toBe(1)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('重试 ≤2 且退避 1s/4s：源码常量断言 + 5xx 重试后成功（退避注入 0ms）', async () => {
    expect(RETRY_BACKOFF_MS).toEqual([1_000, 4_000])
    expect(MAX_RETRIES).toBe(2)
    expect(DOWNLOAD_GUARDS.maxBytes).toBe(5_242_880)
    expect(DOWNLOAD_GUARDS.connectTimeoutMs).toBe(3_000)
    expect(DOWNLOAD_GUARDS.totalTimeoutMs).toBe(60_000)

    let count = 0
    const stub = await httpsStub((_req, res) => {
      count++
      if (count <= 2) {
        res.writeHead(503)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/zip' })
      res.end(buildOfficialLikeZip('---\nname: tdx-tq-local\nversion: 1.2.0\n---\n'))
    })
    const dir = await tempDir()
    try {
      const result = await downloadToFile({ url: stub.origin, destinationPath: path.join(dir.path, 'x.zip'), delay: zeroDelay })
      expect(result.status).toBe(200)
      expect(stub.requests.length).toBe(3) // 初次 + 2 次重试（≤ MAX_RETRIES）
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('重试耗尽：5xx 三连 → 显式报错且请求计数 = 3', async () => {
    const stub = await httpsStub((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    const dir = await tempDir()
    try {
      await expect(
        downloadToFile({ url: stub.origin, destinationPath: path.join(dir.path, 'x.zip'), delay: zeroDelay }),
      ).rejects.toThrowError(/500/)
      expect(stub.requests.length).toBe(3)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('连接超时可由桩延迟触发（注入短超时；await 真实拒绝，非 sleep）', async () => {
    const stub = await httpsStub((_req, res) => {
      // 挂起不响应；由 close() 收尾
    })
    const dir = await tempDir()
    try {
      await expect(
        downloadToFile({
          url: stub.origin,
          destinationPath: path.join(dir.path, 'x.zip'),
          connectTimeoutMs: 80,
          totalTimeoutMs: 5_000,
          delay: zeroDelay,
        }),
      ).rejects.toThrowError(/连接阶段超过 80 ms/)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('单次字节上限：超限中止且显式报错（含实际值与上限）', async () => {
    const big = Buffer.alloc(3_000, 0x41)
    const stub = await httpsStub((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/zip', 'content-length': big.length })
      res.end(big)
    })
    const dir = await tempDir()
    try {
      await expect(
        downloadToFile({
          url: stub.origin,
          destinationPath: path.join(dir.path, 'x.zip'),
          maxBytes: 1_000,
          delay: zeroDelay,
        }),
      ).rejects.toThrowError(/超过单次上限/)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })

  it('非 https 源：拒绝（护栏①）', async () => {
    const dir = await tempDir()
    try {
      await expect(
        downloadToFile({ url: 'http://www.tdx.com.cn/pkg.zip', destinationPath: path.join(dir.path, 'x.zip') }),
      ).rejects.toThrowError(/https/)
    } finally {
      await dir.cleanup()
    }
  })
})

describe('进程内去重（tasks 3.8）', () => {
  it('同 URL 同条件同落点的并发请求共享一次出站', async () => {
    const stub = await httpsStub(zipResponse())
    const dir = await tempDir()
    try {
      const dest = path.join(dir.path, 'shared.zip')
      const [a, b] = await Promise.all([
        downloadToFile({ url: stub.origin, destinationPath: dest, delay: zeroDelay }),
        downloadToFile({ url: stub.origin, destinationPath: dest, delay: zeroDelay }),
      ])
      expect(a.status).toBe(200)
      expect(b.status).toBe(200)
      expect(stub.requests.length).toBe(1)
    } finally {
      await stub.close()
      await dir.cleanup()
    }
  })
})
