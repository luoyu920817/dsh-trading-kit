/**
 * 插件配置面（schemastery schema + 默认值解析）。
 *
 * `src/config.ts` 的唯一 owner 是 change 2（data-foundation）：
 * change 1 的模块常量（PROBE_PATH / DIAGNOSTICS_DEFAULT / UNAUTHENTICATED_READONLY_DEFAULT）
 * 由本文件对应字段接管（iteration-1-contracts §11；schemastery 用法沿
 * DSH-better-sidebar/src/config.ts 先例）。
 *
 * 搬运溯源：S7 `sign`/`ts` 默认值取自 vault 脚本 `fetch_zt_timeline.py` 的
 * `HSL_SIGN`/`HSL_TS` 符号（页面内置公开参数、非密钥，design D-6）；
 * 台账 docs/carryover.md §3.1。
 */
import z from 'schemastery'

/** 频控护栏默认值（经验值、可配置；design D-5——实测回填前不得当容量承诺）。 */
export const GUARD_DEFAULTS = {
  /** 每源并发上限。 */
  maxConcurrency: 2,
  /** 同源相邻请求最小间隔（单标的调用同样排队）。 */
  minIntervalMs: 1000,
  /** 单次调用标的数硬上限。 */
  maxBatch: 20,
  /** 每源每交易日列表级请求预算。 */
  dailyBudget: 200,
} as const

/** S7 页面内置签名参数现值（公开参数；失效时经配置覆盖，并回到页面重新提取）。 */
export const S7_SIGN_DEFAULT = '8e4ef91d04fca0817e2b21e9c816f14e'
export const S7_TS_DEFAULT = '1560867041083'

/** 出站默认超时与重试（design D-4：失败固定退避重试至多 2 次）。 */
export const SOURCE_HTTP_DEFAULTS = {
  timeoutMs: 10_000,
  retries: 2,
} as const

export type ProbeTarget = 's7' | 's5' | 's8' | 'tdx17709'
export type SessionOverride = 'auto' | 'on' | 'off'

/** 完整解析后的配置（所有字段带默认值；直调方经 resolveTraderKitConfig 取得）。 */
export interface ResolvedTraderKitConfig {
  /** 业务产物解析基准；空串 = 未配置（挂载可用，写入期显式报错，design D-1）。 */
  dataRoot: string
  sources: {
    s7: { sign: string; ts: string; timeoutMs: number; retries: number }
    s5: { timeoutMs: number; retries: number }
    s8: { timeoutMs: number; retries: number }
  }
  guard: {
    maxConcurrency: number
    minIntervalMs: number
    maxBatch: number
    dailyBudget: number
    fullMarketGuard: boolean
    sessionOverride: SessionOverride
  }
  diagnostics: {
    probe: { enabled: boolean; targets: ProbeTarget[] }
    /** owner 裁决 2026-09-27：默认开启 17709 TCP 探测（覆盖评审 Issue 26③/29 的 false）。 */
    tdx17709: { enabled: boolean }
  }
}

/** 部署侧可提供的部分配置（深层可选；Loader schema 或 resolveTraderKitConfig 补默认值）。 */
export type TraderKitConfig = {
  dataRoot?: string
  sources?: {
    s7?: { sign?: string; ts?: string; timeoutMs?: number; retries?: number }
    s5?: { timeoutMs?: number; retries?: number }
    s8?: { timeoutMs?: number; retries?: number }
  }
  guard?: {
    maxConcurrency?: number
    minIntervalMs?: number
    maxBatch?: number
    dailyBudget?: number
    fullMarketGuard?: boolean
    sessionOverride?: SessionOverride
  }
  diagnostics?: {
    probe?: { enabled?: boolean; targets?: ProbeTarget[] }
    tdx17709?: { enabled?: boolean }
  }
}

export const Config: z<TraderKitConfig> = z.object({
  dataRoot: z.string().default(''),
  sources: z.object({
    s7: z.object({
      sign: z.string().default(S7_SIGN_DEFAULT),
      ts: z.string().default(S7_TS_DEFAULT),
      timeoutMs: z.number().min(1000).default(SOURCE_HTTP_DEFAULTS.timeoutMs),
      retries: z.number().min(0).max(2).default(SOURCE_HTTP_DEFAULTS.retries),
    }),
    s5: z.object({
      timeoutMs: z.number().min(1000).default(SOURCE_HTTP_DEFAULTS.timeoutMs),
      retries: z.number().min(0).max(2).default(SOURCE_HTTP_DEFAULTS.retries),
    }),
    s8: z.object({
      timeoutMs: z.number().min(1000).default(SOURCE_HTTP_DEFAULTS.timeoutMs),
      retries: z.number().min(0).max(2).default(SOURCE_HTTP_DEFAULTS.retries),
    }),
  }),
  guard: z.object({
    maxConcurrency: z.number().min(1).default(GUARD_DEFAULTS.maxConcurrency),
    minIntervalMs: z.number().min(0).default(GUARD_DEFAULTS.minIntervalMs),
    maxBatch: z.number().min(1).default(GUARD_DEFAULTS.maxBatch),
    dailyBudget: z.number().min(1).default(GUARD_DEFAULTS.dailyBudget),
    fullMarketGuard: z.boolean().default(true),
    sessionOverride: z.union(['auto', 'on', 'off']).default('auto'),
  }),
  diagnostics: z.object({
    probe: z.object({
      enabled: z.boolean().default(true),
      targets: z.array(z.union(['s7', 's5', 's8', 'tdx17709']))
        .default(['s7', 's5', 's8', 'tdx17709']),
    }),
    tdx17709: z.object({
      // owner 裁决 2026-09-27：默认开（默认做 TCP 可达性探测；显式 false 才记「未探测」）。
      enabled: z.boolean().default(true),
    }),
  }),
})

/**
 * 直调方（测试 / 服务装配）的默认值填充；Loader 校验正常先跑，
 * 本函数保证绕过 Loader 的调用者拿到同构的完整配置。
 */
export function resolveTraderKitConfig(config?: TraderKitConfig): ResolvedTraderKitConfig {
  return Config(config ?? {}) as ResolvedTraderKitConfig
}
