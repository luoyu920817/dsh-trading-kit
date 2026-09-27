/**
 * 装配点（change 1 spike-tdx-embed）：探针路由注册。
 * 空实现占位——change 1 接管本文件；主装配只保留一行调用
 * （`src/index.ts` 的 `registerProbe(ctx)`），见 docs/roadmap.md 波次计划。
 */
import type { Context } from '../context-types.ts'

export function registerProbe(_ctx: Context): void {
  // change 1（spike-tdx-embed）装配点：注入 webServer/connection 依赖后注册探针路由。
}
