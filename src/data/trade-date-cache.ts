/** 当前交易日已解析快照；不持久化 T0，沿用 S7 列表缓存与原解析算法。 */
import { normalizeToIsoDate, rateLimitDate } from './date.ts'
import type { DataDeps } from './deps.ts'
import { resolveTradeDate, type TradeDateInput, type TradeDateResult } from './trade-date.ts'

const REFRESH_MS = 60_000
const RETRY_MS = 5_000
const CHECK_MS = 1_000

export interface TradeDateCacheOptions {
  /** 宿主定时生命周期适配；测试用显式事件调度，不改系统时钟或使用fakeTimers。 */
  schedule?: (check: () => Promise<void>, intervalMs: number) => () => void
  /** 后台因预算预留跳过时的具名可观察信息。 */
  onBackgroundSkip?: (note: string) => void
}

/**
 * 注册后台检查周期。
 * 业务逻辑: 使用原生定时器触发检查，由调用方释放。
 * 关键判断: unref防止单独的刷新timer阻止进程退出。
 * 异常处理: check自行捕获后台异常，重复释放安全。
 * 参数: check为后台检查入口，intervalMs为检查周期。
 * 返回: 清除原生timer的disposer。
 */
function scheduleCheck(check: () => Promise<void>, intervalMs: number): () => void {
  const timer = setInterval(() => { void check() }, intervalMs)
  timer.unref()
  return () => { clearInterval(timer) }
}

/**
 * 创建当前限流日的已解析交易日快照。
 * 业务逻辑: 合并同日解析任务，记录原结果；后台定期刷新当前日。
 * 关键判断: 业务日仅来自原算法；历史请求不覆盖当前快照；peek绝不执行I/O。
 * 异常处理: 后台失败保留同日旧结果并至少5秒后重试，显式调用仍透传异常。
 * 参数: deps为同一数据面依赖与列表缓存，options提供生命周期调度和跳过通知。
 * 返回: 同步peek、显式resolve、后台refreshCurrent与生命周期start。
 */
export function createTradeDateCache(deps: DataDeps, options: TradeDateCacheOptions = {}) {
  let snapshot: TradeDateResult | null = null
  let refreshDay: string | null = null
  let nextRefreshAt = 0
  const pending = new Map<string, Promise<TradeDateResult>>()
  const backgroundUsedByDay = new Map<string, number>()
  let skipped: { day: string; note: string } | null = null

  // S7 当日列表超过快照刷新周期才视为未命中；历史列表保持既有缓存口径。
  const resolverDeps: DataDeps = {
    ...deps,
    cache: {
      ...deps.cache,
      /**
       * 读取原列表缓存并判断当前日数据时效。
       * 业务逻辑: 原缓存命中后仅淘汰过期的当前日S7列表读结果。
       * 关键判断: 历史日及其他源不改变；不新增持久化缓存。
       * 异常处理: 无效时间戳视为当前日未命中，读盘异常沿原实现处理。
       * 参数: module/schema/source/requestedDate为原列表缓存键。
       * 返回: 原条目或null，交给原S7算法重新获取。
       */
      async readList<P>(module: string, schema: string, source: string, requestedDate: string) {
        const entry = await deps.cache.readList<P>(module, schema, source, requestedDate)
        if (entry !== null && module === 's7' && source === 'S7' && requestedDate === rateLimitDate(deps.now())) {
          const fetchedAt = Date.parse(entry.fetchedAt)
          if (!Number.isFinite(fetchedAt) || deps.now().getTime() - fetchedAt >= REFRESH_MS) return null
        }
        return entry
      },
    },
  }

  /**
   * 同步读取当前日已完成快照。
   * 业务逻辑: 仅比较内存快照的请求日与当前限流日。
   * 关键判断: 跨日立即返回null；不以时钟补出业务日，不触发刷新。
   * 异常处理: 无快照返回null。
   * 参数: 无。
   * 返回: 原解析结果或null。
   */
  function peek(): TradeDateResult | null {
    return snapshot?.requestedDate === rateLimitDate(deps.now()) ? snapshot : null
  }

  /**
   * 解析交易日并合并同日尚未完成的任务。
   * 业务逻辑: 请求日归一后复用在途Promise，原算法完成后记录当前日结果。
   * 关键判断: 不合并不同日期；迟到的历史结果不覆盖新日；失败保留同日旧快照。
   * 异常处理: 非法参数交原算法零网络处理；抛错透传并释放在途记录。
   * 参数: input为原交易日参数，缺省请求当前限流日。
   * 返回: 原TradeDateResult，保留source、guard、evidence等所有字段。
   */
  function resolve(input: TradeDateInput = {}): Promise<TradeDateResult> {
    const requestedDate = input.date === undefined
      ? rateLimitDate(deps.now())
      : normalizeToIsoDate(String(input.date).trim())
    if (requestedDate === null) return resolveTradeDate(resolverDeps, input)
    const existing = pending.get(requestedDate)
    if (existing !== undefined) return existing
    const task = resolveTradeDate(resolverDeps, { date: requestedDate }).then((result) => {
      if (requestedDate === rateLimitDate(deps.now()) && result.evidence.rateLimitDate === requestedDate) {
        if (result.source !== null || peek() === null) snapshot = result
        refreshDay = requestedDate
        const fetchedAt = result.fetchedAt === null ? NaN : Date.parse(result.fetchedAt)
        nextRefreshAt = result.source === null
          ? deps.now().getTime() + RETRY_MS
          : (Number.isFinite(fetchedAt) ? fetchedAt : deps.now().getTime()) + REFRESH_MS
        if (result.source !== null) skipped = null
      }
      return result
    }).finally(() => { pending.delete(requestedDate) })
    pending.set(requestedDate, task)
    return task
  }

  /**
   * 后台检查当前限流日快照是否应刷新。
   * 业务逻辑: 冷态、跨日或到期时调用同一解析入口，复用同日在途任务。
   * 关键判断: 未配置数据根不预热；成功按源时间60秒后刷新，失败至少5秒后重试；
   * 后台最多分配S7日预算20%（至少1），并保留其余额度给前台显式调用。
   * 异常处理: 捕获后台异常且保留同日快照，避免未处理Promise拒绝。
   * 参数: 无。
   * 返回: 检查与必要解析完成的Promise。
   */
  async function refreshCurrent(): Promise<void> {
    if (deps.dataRoot === '') return
    const day = rateLimitDate(deps.now())
    if (refreshDay === day && deps.now().getTime() < nextRefreshAt) return
    const existing = pending.get(day)
    if (existing !== undefined) {
      // 共享已有任务不产生新的后台出站，不重复累计预算。
      try {
        await existing
      } catch {
        if (day === rateLimitDate(deps.now())) {
          refreshDay = day
          nextRefreshAt = deps.now().getTime() + RETRY_MS
        }
      }
      return
    }
    const source = deps.guard.status().sources.find((item) => item.source === 'S7')!
    const allowance = Math.max(1, Math.floor(source.budgetLimit * 0.2))
    const reserved = Math.max(0, source.budgetLimit - allowance)
    const backgroundUsed = backgroundUsedByDay.get(day) ?? 0
    if (backgroundUsed >= allowance || source.remaining <= reserved) {
      const note = `backgroundTradeDateBudgetReserved: 后台交易日刷新跳过；S7后台日额度=${allowance}，已用=${backgroundUsed}，源剩余=${source.remaining}，前台预留=${reserved}；保留已有快照，未更新源时间`
      skipped = { day, note }
      const current = peek()
      if (current !== null) snapshot = { ...current, notes: [...current.notes.filter((item) => !item.startsWith('backgroundTradeDateBudgetReserved:')), note] }
      refreshDay = day
      nextRefreshAt = deps.now().getTime() + REFRESH_MS
      options.onBackgroundSkip?.(note)
      return
    }
    try {
      await resolve({ date: day })
    } catch {
      if (day === rateLimitDate(deps.now())) {
        refreshDay = day
        nextRefreshAt = deps.now().getTime() + RETRY_MS
      }
    } finally {
      const after = deps.guard.status()
      const used = after.sources.find((item) => item.source === 'S7')!.budgetUsed
      // 同日并发前台出站可能保守多算；跨日只记录新日实际总用量，避免漏计迟到任务。
      const delta = after.rateLimitDate === day ? Math.max(0, used - source.budgetUsed) : used
      backgroundUsedByDay.set(after.rateLimitDate, (backgroundUsedByDay.get(after.rateLimitDate) ?? 0) + delta)
    }
  }

  /**
   * 读取后台预算跳过信息供宿主健康状态展示。
   * 业务逻辑: 返回当前限流日的具名跳过信息。
   * 关键判断: 跨日不沿用旧日警告；全程仅读内存。
   * 异常处理: 未跳过或后续已成功解析时返回空列表。
   * 参数: 无。
   * 返回: 当前后台刷新警告列表。
   */
  function backgroundWarnings(): string[] {
    return skipped?.day === rateLimitDate(deps.now()) ? [skipped.note] : []
  }

  /**
   * 启动后台预热与跨日检查，并提供宿主卸载释放入口。
   * 业务逻辑: 配置数据根后立即预热，每秒检查限流日与刷新期限。
   * 关键判断: 实际解析仍遵守60秒时效；timer不阻止测试进程退出。
   * 异常处理: 刷新异常由refreshCurrent处理，重复清理安全。
   * 参数: 无。
   * 返回: 清除timer的disposer。
   */
  function start(): () => void {
    if (deps.dataRoot === '') return () => {}
    void refreshCurrent()
    return (options.schedule ?? scheduleCheck)(refreshCurrent, CHECK_MS)
  }

  return { peek, resolve, refreshCurrent, start, backgroundWarnings }
}
