/** 真实安装实现离线探针；需显式提供解包路径。默认跳过不表示宿主通过。 */
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { attachKeywordJobs } from '../../src/review/processors/host-jobs.ts'
import type { KeywordJobsLike, KeywordJobOutcome } from '../../src/review/processors/host-jobs.ts'

const extracted = process.env.KEYWORD_HOST_PROBE_ROOT

it.skipIf(!extracted)('真实Jobs：同步run、root/unowned、日志、取消和done清理', async () => {
  const { Context } = await import(pathToFileURL(join(extracted!, '@deepseek-ai/cordis/lib/index.js')).href)
  const { default: Jobs } = await import(pathToFileURL(join(extracted!, '@deepseek-ai/dsh-jobs-local/lib/index.js')).href)
  const ctx = new Context()
  const fiber = ctx.plugin(Jobs)
  await fiber
  const jobs = ctx.jobs as KeywordJobsLike & {
    get(id: string, caller?: string): { id: string; owner?: string; status: string; progress?: string }
    readAt(id: string, offset: number, caller?: string): { chunks: unknown[] }
    list(caller?: string): { id: string }[]
    wait(id: string, timeoutMs: number, caller?: string, signal?: AbortSignal): Promise<unknown>
  }
  let resolveDone!: (outcome: KeywordJobOutcome) => void
  const done = new Promise<KeywordJobOutcome>(resolve => { resolveDone = resolve })
  let resolveCleanup!: () => void
  const cleanup = new Promise<void>(resolve => { resolveCleanup = resolve })
  let canceled = false
  let startReturned = false
  let synchronous = false
  const controller = attachKeywordJobs(jobs)
  try {
    const id = controller.start('固定无行情探针', job => {
      synchronous = !startReturned
      job.append('固定无行情文本\n', { channel: 'log' })
      job.updateProgress('准备完成')
      return {
        cancel() { canceled = true },
        done: done.then(async outcome => { await cleanup; return outcome }),
      }
    })
    startReturned = true
    expect(synchronous).toBe(true)
    expect(jobs.get(id).owner).toBeUndefined()
    expect(jobs.get(id, 'any-authenticated-session').id).toBe(id)
    expect(jobs.list().map(j => j.id)).toContain(id)
    expect(jobs.get(id).progress).toBe('准备完成')
    const first = jobs.readAt(id, 0)
    expect(JSON.stringify(first.chunks)).toContain('固定无行情文本')
    expect(jobs.readAt(id, 0)).toEqual(first)
    expect(controller.kill(id, '用户取消')).toBe('requested')
    expect(canceled).toBe(true)
    expect(jobs.get(id).status).toBe('stopping')
    resolveDone({ status: 'killed', detail: '固定探针取消' })
    expect(controller.owns(id)).toBe(true)
    resolveCleanup()
    await jobs.wait(id, 1000)
    expect(jobs.get(id).status).toBe('killed')
    expect(controller.owns(id)).toBe(false)
    expect(() => controller.kill('historical-job', '拒绝历史关联')).toThrow('JOB_NOT_OWNED')
  } finally {
    resolveCleanup()
    resolveDone({ status: 'killed' })
    await controller.dispose()
    await fiber.dispose()
  }
})

it.skipIf(!extracted)('真实Jobs：done拒绝不能被当作成功清理或再次接纳', async () => {
  const { Context } = await import(pathToFileURL(join(extracted!, '@deepseek-ai/cordis/lib/index.js')).href)
  const { default: Jobs } = await import(pathToFileURL(join(extracted!, '@deepseek-ai/dsh-jobs-local/lib/index.js')).href)
  const ctx = new Context()
  const fiber = ctx.plugin(Jobs)
  await fiber
  const controller = attachKeywordJobs(ctx.jobs)
  let rejectDone!: (reason: Error) => void
  const done = new Promise<KeywordJobOutcome>((_, reject) => { rejectDone = reject })
  try {
    const id = controller.start('固定清理失败探针', () => ({ cancel() {}, done }))
    rejectDone(new Error('FIXED_CLEANUP_FAILURE'))
    await done.catch(() => {})
    await expect(controller.dispose()).rejects.toThrow('KEYWORD_JOB_CLEANUP_FAILED')
    expect(() => controller.start('不允许再次接纳', () => ({ cancel() {}, done }))).toThrow('CONTROLLER_CLOSED')
    expect(id).toMatch(/^review-keyword-/)
  } finally {
    await controller.dispose().catch(() => {})
    await fiber.dispose()
  }
})
