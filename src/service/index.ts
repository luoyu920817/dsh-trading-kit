/**
 * 装配点（change 2 data-foundation）：数据面服务与工具注册。
 * 空实现占位——change 2 接管本文件（`traderKit` service、T0/T1/T2 工具）；
 * 主装配只保留一行调用（`src/index.ts` 的 `registerData(ctx)`）。
 */
import type { Context } from '../context-types.ts'

export function registerData(_ctx: Context): void {
  // change 2（data-foundation）装配点：接入 tools 依赖 + provide('traderKit', api)。
}
