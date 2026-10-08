/**
 * 启动健康检查（data-tool-contract「启动健康检查」/ design D-8、tasks 7.1）。
 *
 * 三条口径（评审 Issue 14）：
 * 1. **独立通道**：探测不计频控预算、不计入 guard 出站计数、不得被其它模块复用
 *   （本模块直接持有传输，不经 guard.acquire）；
 * 2. **3 秒总硬超时**：最坏耗时受上界约束（`AbortSignal.timeout` 截断 + 总闸计时），
 *   不随「并发 ≤2 × 每目标 3s」放大；
 * 3. 结论进 `health.status()`；任一失败都不影响挂载与工具可用性（start() 异步、不阻塞）。
 *
 * 探测目标：三方源（S7/S5/S8 各一次轻量请求）+ `127.0.0.1:17709`（**仅 net.connect**
 * TCP 可达性，零 TQ 方法调用，零 HTTP 请求）。尊重 `diagnostics.probe.enabled` /
 * `probe.targets` / `tdx17709.enabled`（后者关闭时该项记「未探测」而非「不可用」）。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import net from 'node:net'
import type { ResolvedTraderKitConfig, ProbeTarget } from '../config.ts'
import { S7_LIST_URL } from './s7.ts'
import { S5_HISTORY_URL, S5_UA } from './s5.ts'
import { S8_API_URL, S8_FIELDS, s8Headers } from './s8.ts'
import { nativeTransport, type DataTransport } from './http.ts'
import { formatZonedIso } from './normalize.ts'

/** 探测总硬超时（源码常量，测试断言 3000；注入仅用于测试提速）。 */
export const PROBE_TOTAL_TIMEOUT_MS = 3000

export type ProbeState = 'probing' | 'ok' | 'unreachable' | 'timeout' | 'error' | 'skipped' | 'notProbed'

export interface ProbeTargetStatus {
  state: ProbeState
  detail?: string
  /** HTTP 状态码（三方源，可达即记录——含非 2xx，端点响应即「可达」）。 */
  httpStatus?: number
  latencyMs?: number
}

export interface DataHealthSnapshot {
  probedAt: string | null
  totalTimeoutMs: number
  targets: Partial<Record<ProbeTarget, ProbeTargetStatus>>
  warnings: string[]
  /** 能力开关状态（机器可读；review-loop 追加 `tqLocal`——TQ-Local 只读兜底是否启用）。 */
  switches?: { tqLocal: boolean }
}

export interface DataHealth {
  /** 异步启动探测（不阻塞挂载）。 */
  start(): void
  /** 探测完成 Promise（测试用；生产可忽略）。 */
  whenReady(): Promise<void>
  /** 只读快照：`{ data, skill }` 两段视图的 data 段（skill 段由 service 层透传 change 3）。 */
  dataStatus(): DataHealthSnapshot
}

export interface DataHealthOptions {
  /** 测试注入：总超时缩短（默认 PROBE_TOTAL_TIMEOUT_MS=3000）。 */
  timeoutMs?: number
  transport?: DataTransport
  now?: () => Date
}

/** 17709 探测文案（TdxW 未启动场景，spec「TdxW 未启动」scenario）。 */
export const TDX_NOT_STARTED_HINT = 'TQ-Local（127.0.0.1:17709）不可达：请确认通达信客户端是否已启动并登录'

function probeUrl(target: Exclude<ProbeTarget, 'tdx17709'>): { url: string; init: RequestInit } {
  if (target === 's7') {
    const url = `${S7_LIST_URL}?${new URLSearchParams({ page: '1', type: '1', page_count: '1', channel: 'hsl-app', ts: '0', sign: 'health-probe' }).toString()}`
    return { url, init: { method: 'GET' } }
  }
  if (target === 's5') {
    return {
      url: S5_HISTORY_URL,
      init: {
        method: 'POST',
        headers: { 'User-Agent': S5_UA, 'Content-Type': 'application/json', Referer: 'https://flow.10jqka.com.cn/' },
        body: JSON.stringify({ thsHqCode: '000001', marketId: '33', count: 1 }),
      },
    }
  }
  return {
    url: `${S8_API_URL}?${new URLSearchParams({ symbol: '000001.SZ', fields: S8_FIELDS }).toString()}`,
    init: { method: 'GET', headers: s8Headers() },
  }
}

/** 三方源轻量探测（独立通道：直接持有传输，不经 guard、不计预算）。 */
async function probeHttpSource(target: Exclude<ProbeTarget, 'tdx17709'>, transport: DataTransport, remainingMs: () => number): Promise<ProbeTargetStatus> {
  const started = Date.now()
  const { url, init } = probeUrl(target)
  try {
    const response = await transport(url, { ...init, signal: AbortSignal.timeout(Math.max(1, remainingMs())) })
    return { state: 'ok', httpStatus: response.status, latencyMs: Date.now() - started, detail: `端点可达（HTTP ${response.status}）` }
  } catch (cause) {
    const latencyMs = Date.now() - started
    if (cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError')) {
      return { state: 'timeout', detail: `探测超时（总硬超时截断）`, latencyMs }
    }
    return { state: 'unreachable', detail: cause instanceof Error ? cause.message : String(cause), latencyMs }
  }
}

/** 17709 探测：仅 net.connect TCP 可达性（零 HTTP、零 TQ 方法）。 */
function probeTdx17709(remainingMs: () => number): Promise<ProbeTargetStatus> {
  return new Promise((resolve) => {
    const started = Date.now()
    const socket = new net.Socket()
    let settled = false
    const finish = (status: ProbeTargetStatus): void => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(status)
    }
    socket.setTimeout(Math.max(1, remainingMs()))
    socket.once('connect', () => { finish({ state: 'ok', detail: 'TCP 可达（仅 net.connect，未调用任何 TQ 方法）', latencyMs: Date.now() - started }) })
    socket.once('timeout', () => { finish({ state: 'timeout', detail: '探测超时（总硬超时截断）', latencyMs: Date.now() - started }) })
    socket.once('error', (cause: Error) => {
      finish({ state: 'unreachable', detail: `${cause.message}；${TDX_NOT_STARTED_HINT}`, latencyMs: Date.now() - started })
    })
    socket.connect(17709, '127.0.0.1')
  })
}

export function createDataHealth(config: ResolvedTraderKitConfig, options: DataHealthOptions = {}): DataHealth {
  const transport = options.transport ?? nativeTransport
  const now = options.now ?? (() => new Date())
  const timeoutMs = options.timeoutMs ?? PROBE_TOTAL_TIMEOUT_MS

  const targets: Partial<Record<ProbeTarget, ProbeTargetStatus>> = {}
  let probedAt: string | null = null
  let started = false
  let ready: Promise<void> = Promise.resolve()

  function snapshot(): DataHealthSnapshot {
    return {
      probedAt,
      totalTimeoutMs: timeoutMs,
      targets: { ...targets },
      warnings: buildWarnings(),
      switches: { tqLocal: config.sources.tqLocal.enabled },
    }
  }

  function buildWarnings(): string[] {
    const warnings: string[] = []
    if (config.diagnostics.probe.enabled === false) warnings.push('diagnostics.probe.enabled=false：启动探测已关闭，数据源状态未知（用例「探测不计预算与护栏计数」不受影响）')
    for (const target of ['s7', 's5', 's8', 'tdx17709'] as const) {
      const st = targets[target]
      if (st === undefined) continue
      if (st.state === 'notProbed') warnings.push(`${target} 记为「未探测」（tdx17709.enabled=false 或不在 probe.targets）`)
      if (st.state === 'unreachable') warnings.push(`${target} 不可达：${st.detail ?? ''}`)
      if (st.state === 'timeout') warnings.push(`${target} 探测超时（总硬超时 ${timeoutMs}ms 截断）`)
    }
    return warnings
  }

  function start(): void {
    if (started) return
    started = true
    if (config.diagnostics.probe.enabled === false) {
      for (const target of config.diagnostics.probe.targets) targets[target] = { state: 'skipped', detail: 'probe.enabled=false' }
      probedAt = formatZonedIso(now())
      return
    }

    const deadline = Date.now() + timeoutMs
    const remainingMs = (): number => deadline - Date.now()

    const tasks: Array<Promise<void>> = []
    for (const target of config.diagnostics.probe.targets) {
      if (target === 'tdx17709') {
        if (config.diagnostics.tdx17709.enabled === false) {
          targets.tdx17709 = { state: 'notProbed', detail: 'diagnostics.tdx17709.enabled=false：该项记「未探测」而非「不可用」' }
          continue
        }
        tasks.push(
          probeTdx17709(remainingMs).then((st) => { targets.tdx17709 = st }),
        )
        continue
      }
      targets[target] = { state: 'probing' }
      tasks.push(
        probeHttpSource(target, transport, remainingMs).then((st) => { targets[target] = st }),
      )
    }

    // 总硬超时闸：超时后未完成的探测以超时结论记录（不随并发放大最坏耗时）。
    const hardTimer = new Promise<void>((resolve) => {
      const left = Math.max(0, remainingMs())
      const timer = setTimeout(() => {
        for (const target of config.diagnostics.probe.targets) {
          const st = targets[target]
          if (st === undefined || st.state === 'probing') targets[target] = { state: 'timeout', detail: `总硬超时 ${timeoutMs}ms 截断` }
        }
        resolve()
      }, left)
      // tasks 全部 settle 或计时器先到，二者取先。
      void Promise.allSettled(tasks).then(() => { clearTimeout(timer); resolve() })
    })

    ready = hardTimer.then(() => { probedAt = formatZonedIso(now()) })
    ready.catch(() => {}) // 探测失败绝不向上抛（不阻塞挂载）
  }

  return {
    start,
    whenReady: () => ready,
    dataStatus: snapshot,
  }
}
