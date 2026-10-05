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
import { SkillInstallerError } from './skill/errors.ts'
import { dataRootWhitelistPaths } from './skill/root.ts'
import { DEFAULT_TQ_SKILL_SOURCE_URL } from './skill/source.ts'
import { DEFAULT_ZIP_LIMITS, isInsideOrEqual, type ZipLimits } from './skill/zip-guard.ts'

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

/**
 * change 3（tq-skill-installer）追加：skill 安装器配置段（design D-13；
 * `contracts §11`——在 change 2 的 Config 上**追加**，不改 dataRoot 默认值与既有字段）。
 */
export interface ResolvedSkillConfig {
  /** 官方 zip 源（MUST 匹配 `^https://`；默认 = DEFAULT_TQ_SKILL_SOURCE_URL，源变更经配置、不要求插件发版）。 */
  sourceUrl: string
  /** https 源落点根；'' → 缺省解析为 `<projectRoot>/.dsh/skills`（design D-1，宿主 rank 100）。 */
  installDir: string
  /** 版本基线；**仅 https 源参与比对**（design D-4：localDir 源 baseline=null，不产生假警告）。 */
  minVersion: string
  /** 启动检查开关；语义 = **只检查不安装**（design D-8，安装/替换只能由显式调用触发）。 */
  autoCheck: boolean
  /** 启动检查最短间隔（小时；`lastCheckedAt` 节流，design D-12⑥）。 */
  checkIntervalHours: number
  /** 显式登记的额外 skill 根（遮蔽检测与暂存区断言用；rank 300 意图）。 */
  extraSkillRoots: string[]
  /** zip 解压加固上限覆盖（默认沿 zip-guard `DEFAULT_ZIP_LIMITS`，design D-2）。 */
  limits: ZipLimits
}

/** `Config.skill.minVersion` 的默认基线（design D-4：默认取当前实测版本 1.2.0）。 */
export const SKILL_MIN_VERSION_DEFAULT = '1.2.0'
/** `Config.skill.checkIntervalHours` 的默认节流（design D-12⑥）。 */
export const SKILL_CHECK_INTERVAL_HOURS_DEFAULT = 24

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
  /** change 3（tq-skill-installer）追加段（4.1；append-only，不动上文字段）。 */
  skill: ResolvedSkillConfig
  /** change 4（review-page）追加段（owner 裁决 2026-10-05：写接口回环+固定密钥）。 */
  review: { writeKey: string }
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
  skill?: {
    sourceUrl?: string
    installDir?: string
    minVersion?: string
    autoCheck?: boolean
    checkIntervalHours?: number
    extraSkillRoots?: string[]
    limits?: Partial<ZipLimits>
  }
  review?: { writeKey?: string }
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
  // change 3（tq-skill-installer 4.1）：skill 段（append-only；installDir 默认 '' =
  // 缺省解析 <projectRoot>/.dsh/skills，落点禁令与白名单豁免在 resolve 期校验）。
  skill: z.object({
    sourceUrl: z.string().default(DEFAULT_TQ_SKILL_SOURCE_URL),
    installDir: z.string().default(''),
    minVersion: z.string().default(SKILL_MIN_VERSION_DEFAULT),
    autoCheck: z.boolean().default(true),
    checkIntervalHours: z.number().min(1).default(SKILL_CHECK_INTERVAL_HOURS_DEFAULT),
    extraSkillRoots: z.array(z.string()).default([]),
    limits: z.object({
      maxEntries: z.number().min(1).default(DEFAULT_ZIP_LIMITS.maxEntries),
      maxFileBytes: z.number().min(1).default(DEFAULT_ZIP_LIMITS.maxFileBytes),
      maxTotalBytes: z.number().min(1).default(DEFAULT_ZIP_LIMITS.maxTotalBytes),
    }),
  }),
  // change 4（review-page）：写接口密钥——空串 = 进程随机生成（经页面注入自动携带）；
  // 设定值 = 固定 key（可写进 profile，重启不变）。
  review: z.object({
    writeKey: z.string().default(''),
  }),
})

/**
 * skill 段静态可判校验（4.1②；运行期校验仍由 root.ts / installer.ts 承担）：
 * sourceUrl 必须 https；installDir 绝对路径不得落在 dataRoot 内——**白名单区
 * （`contracts §10`）豁免**（`<dataRoot>/agent/skills` 等；自产 skill 部署走
 * localDir 源 deploy 落白名单区，不经本禁令）。
 */
function assertSkillConfigInvariants(resolved: ResolvedTraderKitConfig): void {
  const skill = resolved.skill
  if (!/^https:\/\//.test(skill.sourceUrl)) {
    throw new Error(`skill.sourceUrl 非法：'${skill.sourceUrl}'——必须为 https 源（官方 zip 分发；设计 D-13）`)
  }
  if (skill.installDir !== '' && resolved.dataRoot !== '') {
    // installDir 在 dataRoot 内、且不在任何白名单路径内 → 拒绝。
    const inDataRoot = isInsideOrEqual(skill.installDir, resolved.dataRoot)
    const whitelisted = dataRootWhitelistPaths(resolved.dataRoot).some((w) => isInsideOrEqual(skill.installDir, w))
    if (inDataRoot && !whitelisted) {
      throw new SkillInstallerError(
        'INSTALL_DIR_BANNED_AREA',
        `skill.installDir '${skill.installDir}' 落在数据根非白名单区——`
        + 'https 源落点禁入 vault 业务区（`contracts §10`）；自产 skill 部署请用 localDir 源 deploy（白名单区 <dataRoot>/agent/skills 合法）。',
      )
    }
  }
}

/**
 * 直调方（测试 / 服务装配）的默认值填充；Loader 校验正常先跑，
 * 本函数保证绕过 Loader 的调用者拿到同构的完整配置。
 */
export function resolveTraderKitConfig(config?: TraderKitConfig): ResolvedTraderKitConfig {
  const resolved = Config(config ?? {}) as ResolvedTraderKitConfig
  assertSkillConfigInvariants(resolved)
  return resolved
}
