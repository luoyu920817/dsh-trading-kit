/**
 * dsh-trader-kit —— 个人 A 股交易工作流插件（host 面）。
 *
 * 定位与分层：docs/architecture.md；阶段路线：docs/roadmap.md；
 * 搬运溯源：docs/carryover.md。参考源（dsh-trading）只读，不回流。
 *
 * 装配点纪律（波 0.2 起）：本文件只保留四条线的注册调用，各条线只改
 * 自己的文件 + 本文件一行调用。四条线（按 change 依赖序）：
 * - probe            → change 1 spike-tdx-embed（src/routes/probe.ts）
 * - data             → change 2 data-foundation（src/service/index.ts）
 * - skillInstaller   → change 3 tq-skill-installer（src/skill/index.ts）
 * - review           → change 4 review-page / change 5 daily-summary（src/review/index.ts）
 */
import type { Context } from './context-types.ts'
import { resolveTraderKitConfig, type TraderKitConfig } from './config.ts'
import { registerProbe } from './routes/probe.ts'
import { registerData } from './service/index.ts'
import { registerSkillInstaller } from './skill/index.ts'
import { registerReview } from './review/index.ts'

/** Cordis 插件名（= cordis.patch.yml 挂载的 npm 包名）。 */
export const name = 'dsh-trader-kit'

/**
 * 依赖注入声明（沿 better-sidebar 先例）：探针线需要 webServer/connection，
 * 数据线与 skill 安装线需要 tools。新增服务依赖只改这一行。
 */
export const inject = ['webServer', 'connection', 'tools']

export function apply(ctx: Context, config?: TraderKitConfig): void {
  const resolved = resolveTraderKitConfig(config)
  registerProbe(ctx)
  registerData(ctx, resolved)
  registerSkillInstaller(ctx, resolved)
  registerReview(ctx, resolved)
}
