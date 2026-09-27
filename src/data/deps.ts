/**
 * 数据模块共享依赖装配（tools/service 与测试共用的工厂入口）。
 *
 * `createDataDeps` 是唯一把 config → guard/cache/transport/now 组装起来的地方：
 * service 装配（src/service/index.ts）与测试（注入本地桩传输、固定时钟、临时
 * dataRoot）都经它，保证「同一实现、同一内存计数」。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无搬运行（tasks 8.4）。
 */
import { resolveTraderKitConfig, type ResolvedTraderKitConfig } from '../config.ts'
import { createDataCache, type DataCache } from './cache.ts'
import { createDataGuard, type DataGuard, type GuardOptions } from './guard.ts'
import { nativeTransport, type DataTransport } from './http.ts'

export interface DataDeps {
  config: ResolvedTraderKitConfig
  /** 业务产物解析基准（缓存目录解析用；空串 = 未配置，写入期显式报错）。 */
  dataRoot: string
  guard: DataGuard
  cache: DataCache
  transport: DataTransport
  /** 时钟（只用于限流判定；业务日期一律取源，design D-3/D-5）。 */
  now: () => Date
}

export interface DataDepsOverrides extends Partial<DataDeps> {
  /** guard 内部等待的注入（间隔/退避测试用；delay 可注入为即时 resolve）。 */
  guardOptions?: GuardOptions
}

/** 由（已解析的）config 组装数据面依赖；overrides 供测试替换任一部件。 */
export function createDataDeps(config: ResolvedTraderKitConfig, overrides: DataDepsOverrides = {}): DataDeps {
  const now = overrides.now ?? (() => new Date())
  const dataRoot = overrides.dataRoot ?? config.dataRoot
  const guard = overrides.guard ?? createDataGuard(config.guard, { now, delay: overrides.guardOptions?.delay })
  const cache = overrides.cache ?? createDataCache(dataRoot)
  const transport = overrides.transport ?? nativeTransport
  return { config, dataRoot, guard, cache, transport, now }
}

/** 便捷入口：直调方（测试）传部分配置时先补默认值再组装。 */
export function createDataDepsFromConfig(config?: ResolvedTraderKitConfig | Parameters<typeof resolveTraderKitConfig>[0], overrides: DataDepsOverrides = {}): DataDeps {
  const resolved = config ?? resolveTraderKitConfig()
  return createDataDeps(resolved as ResolvedTraderKitConfig, overrides)
}
