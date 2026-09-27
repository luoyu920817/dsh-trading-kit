/**
 * 装配点（change 4 review-page / change 5 daily-summary）：复盘页路由与存储注册。
 * 空实现占位——change 4 接管本文件（/review 路由族 + traderKit.review.* 出口）；
 * 主装配只保留一行调用（`src/index.ts` 的 `registerReview(ctx)`）。
 */
import type { Context } from '../context-types.ts'

export function registerReview(_ctx: Context): void {
  // change 4（review-page）装配点：注册 /review 路由族与 traderKit.review.* service 出口。
}
