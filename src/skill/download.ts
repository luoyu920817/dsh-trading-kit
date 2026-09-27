/**
 * skill 资产下载通道（tasks 1.2 / 3.8，design D-12）。
 *
 * 全仓第二条具名出站通道（`iteration-1-contracts §7`：`src/data/http.ts` +
 * `src/skill/download.ts` 两条具名通道）。本文件是 `src/skill/**` 内唯一允许
 * `fetch(` 的模块（test/skill/source-assertions.test.ts 有源码断言）。
 * 豁免 change 2 `src/data/guard.ts` 闸门（该闸门语义 = 数据面频控预算），但
 * MUST 具备全部替代护栏（spec「出站通道与节流边界」）：
 * ① 仅接受 `https:`；② `redirect: 'manual'`，30x 显式报错（含目标 URL）；
 * ③ 超时：连接 3 s / 总 60 s；④ 重试 ≤ 2 次，退避 1 s / 4 s；
 * ⑤ 单次下载字节上限 5 MB；⑥ 启动检查节流在 autocheck.ts（`checkIntervalHours`）；
 * ⑦ 进程内 in-flight 去重（同 URL 同条件同落点的并发请求共享一次出站）。
 *
 * 响应头纪律（design D-5）：`etag` / `lastModified` 一律**原样存储响应头字符串**，
 * 不做日期重格式化（本模块零日期重写路径：etag / lastModified 一律透传响应头原文）。
 */

import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { SkillInstallerError } from './errors.ts'

/** 替代护栏默认值（源码常量，被 test/skill/download.test.ts 断言）。 */
export const DOWNLOAD_GUARDS = {
  connectTimeoutMs: 3_000,
  totalTimeoutMs: 60_000,
  maxBytes: 5_242_880, // 5 MB
} as const

/** 重试退避序列（重试 ≤ 2 次，退避 1 s / 4 s——源码常量断言）。 */
export const RETRY_BACKOFF_MS: readonly [number, number] = [1_000, 4_000]
export const MAX_RETRIES = 2

export interface DownloadResult {
  status: 200 | 304
  /** 200 时下载包落盘路径。 */
  archivePath?: string
  bytes?: number
  /** 响应头原样字符串（未重格式化）。 */
  headers: { etag?: string; lastModified?: string; url: string }
  /** 30x 跳转目标（仅在错误体中携带；正常路径不会返回 3xx）。 */
  redirectTarget?: string
}

export interface DownloadInput {
  url: string
  /** 下载包落盘路径（`<runDir>` 内）。 */
  destinationPath: string
  /** 条件请求：If-None-Match（优先）。 */
  etag?: string | null
  /** 条件请求：If-Modified-Since（值为原样保存的响应头字符串）。 */
  lastModified?: string | null
  connectTimeoutMs?: number
  totalTimeoutMs?: number
  maxBytes?: number
  /** 重试退避延时（测试注入 0ms——零 sleep 纪律）。 */
  delay?: (ms: number) => Promise<void>
  signal?: AbortSignal
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status <= 599
}

function isNetworkError(error: unknown): boolean {
  if (error instanceof SkillInstallerError) return false
  if (error instanceof Error) {
    return (
      error.name === 'TypeError' || // fetch 网络层失败（Node undici）
      error.name === 'AbortError' ||
      error.name === 'TimeoutError' ||
      /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE/i.test(error.message)
    )
  }
  return false
}

/** 进程内 in-flight 去重表：key = url|etag|lastModified|destination。 */
const inFlight = new Map<string, Promise<DownloadResult>>()

class TimeoutAbort extends Error {
  constructor(readonly phase: 'connect' | 'total') {
    super(`download ${phase} timeout`)
    this.name = 'TimeoutAbort'
  }
}

/** abort(reason) 的拒绝值在部分 Node 版本会被包成 AbortError，此处统一还原。 */
function resolveAbortReason(error: unknown, controller: AbortController): unknown {
  if (error instanceof TimeoutAbort) return error
  if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
    const reason = controller.signal.reason
    if (reason instanceof TimeoutAbort) return reason
    return error
  }
  return error
}

async function downloadOnce(input: DownloadInput): Promise<DownloadResult> {
  if (!input.url.startsWith('https://')) {
    throw new SkillInstallerError('INSECURE_SOURCE_URL', `skill 下载源必须是 https:（实际：${input.url}）`, {
      url: input.url,
      configKey: 'skill.sourceUrl',
    })
  }
  const connectTimeoutMs = input.connectTimeoutMs ?? DOWNLOAD_GUARDS.connectTimeoutMs
  const totalTimeoutMs = input.totalTimeoutMs ?? DOWNLOAD_GUARDS.totalTimeoutMs
  const maxBytes = input.maxBytes ?? DOWNLOAD_GUARDS.maxBytes

  const headers: Record<string, string> = {}
  // 条件请求：If-None-Match 优先，无 ETag 时用 If-Modified-Since（原样字符串，design D-5）
  if (input.etag) headers['if-none-match'] = input.etag
  else if (input.lastModified) headers['if-modified-since'] = input.lastModified

  const controller = new AbortController()
  const onOuterAbort = () => controller.abort(new SkillInstallerError('DOWNLOAD_ABORTED', '外部信号中止下载'))
  input.signal?.addEventListener('abort', onOuterAbort, { once: true })
  const totalTimer = setTimeout(() => controller.abort(new TimeoutAbort('total')), totalTimeoutMs)
  const connectTimer = setTimeout(() => controller.abort(new TimeoutAbort('connect')), connectTimeoutMs)

  try {
    let response: Response
    try {
      response = await fetch(input.url, {
        redirect: 'manual', // 护栏②：不静默跟随重定向
        headers,
        signal: controller.signal,
      })
    } catch (error) {
      const abortReason = resolveAbortReason(error, controller)
      if (abortReason instanceof TimeoutAbort) {
        throw new SkillInstallerError(
          'DOWNLOAD_TIMEOUT',
          abortReason.phase === 'connect'
            ? `下载超时：连接阶段超过 ${connectTimeoutMs} ms（源 ${input.url}）`
            : `下载超时：总时长超过 ${totalTimeoutMs} ms（源 ${input.url}）`,
          { failedCheck: 'timeout', phase: abortReason.phase, url: input.url },
        )
      }
      throw error
    }
    clearTimeout(connectTimer) // 响应头已到——连接阶段结束

    // 304：零体下载（先于 3xx 判定——304 属 3xx 数值区间但非重定向）
    if (response.status === 304) {
      return { status: 304, headers: { etag: response.headers.get('etag') ?? undefined, lastModified: response.headers.get('last-modified') ?? undefined, url: input.url } }
    }
    // 30x：显式报错（含目标 URL），MUST NOT 静默接受
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      void response.body?.cancel()
      throw new SkillInstallerError(
        'REDIRECT_DISALLOWED',
        `源返回 ${response.status} 重定向到 ${location ?? '（无 Location 头）'}；redirect: 'manual' 下不静默跟随（源 ${input.url}）`,
        { failedCheck: 'redirect-disallowed', status: response.status, redirectTarget: location, url: input.url },
      )
    }
    if (isRetryableStatus(response.status)) {
      throw new SkillInstallerError('HTTP_RETRYABLE', `源返回可重试状态 ${response.status}（源 ${input.url}）`, {
        status: response.status,
        url: input.url,
        retryable: true,
      })
    }
    if (response.status < 200 || response.status >= 300) {
      void response.body?.cancel()
      throw new SkillInstallerError('HTTP_STATUS_FAILED', `下载失败：HTTP 状态 ${response.status}（源 ${input.url}）`, {
        failedCheck: 'http-status',
        status: response.status,
        url: input.url,
      })
    }

    // 200：读体（单次字节上限护栏⑤），落盘
    const chunks: Uint8Array[] = []
    let total = 0
    if (response.body) {
      try {
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          total += chunk.byteLength
          if (total > maxBytes) {
            controller.abort(new SkillInstallerError('DOWNLOAD_TOO_LARGE', `下载超过单次字节上限 ${maxBytes}`))
            throw new SkillInstallerError(
              'DOWNLOAD_TOO_LARGE',
              `下载中断：响应体 ${total} 字节超过单次上限 ${maxBytes}（源 ${input.url}）`,
              { failedCheck: 'download-too-large', bytes: total, maxBytes, url: input.url },
            )
          }
          chunks.push(chunk)
        }
      } catch (error) {
        if (error instanceof SkillInstallerError) throw error
        const abortReason = resolveAbortReason(error, controller)
        if (abortReason instanceof TimeoutAbort) {
          throw new SkillInstallerError('DOWNLOAD_TIMEOUT', `下载超时：总时长超过 ${totalTimeoutMs} ms（源 ${input.url}）`, {
            failedCheck: 'timeout',
            phase: 'total',
            url: input.url,
          })
        }
        throw error
      }
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    await fsp.mkdir(path.dirname(input.destinationPath), { recursive: true })
    await fsp.writeFile(input.destinationPath, body)
    return {
      status: 200,
      archivePath: input.destinationPath,
      bytes: total,
      headers: {
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined,
        url: input.url,
      },
    }
  } finally {
    clearTimeout(totalTimer)
    clearTimeout(connectTimer)
    input.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/**
 * 下载 zip 到临时区（`<runDir>` 内），带条件请求 / 超时 / 有限重试 / 字节上限。
 * 可重试失败（网络错误 / 5xx）最多重试 MAX_RETRIES 次，退避 RETRY_BACKOFF_MS。
 */
export async function downloadToFile(input: DownloadInput): Promise<DownloadResult> {
  const delay = input.delay ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const dedupeKey = `${input.url}|${input.etag ?? ''}|${input.lastModified ?? ''}|${path.resolve(input.destinationPath)}`

  const existing = inFlight.get(dedupeKey)
  if (existing) return existing

  const run = (async (): Promise<DownloadResult> => {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await downloadOnce(input)
      } catch (error) {
        lastError = error
        const retryable =
          (error instanceof SkillInstallerError && error.details.retryable === true) || isNetworkError(error)
        if (!retryable || attempt >= MAX_RETRIES) break
        await delay(RETRY_BACKOFF_MS[attempt])
      }
    }
    throw lastError
  })()

  inFlight.set(dedupeKey, run)
  try {
    return await run
  } finally {
    inFlight.delete(dedupeKey)
  }
}

/** 仅测试使用的去重表清空钩子（避免跨用例串扰）。 */
export function clearInFlightDownloadsForTest(): void {
  inFlight.clear()
}
