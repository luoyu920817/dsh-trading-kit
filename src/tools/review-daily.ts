/**
 * 装配点（change 5 daily-summary tasks §2）：每日汇总工具注册。
 * 空实现占位——change 5（S）接管本文件；装配点只保留一行调用
 * （`src/review/index.ts` 的 `registerReviewDaily(ctx)`）。
 *
 * 四工具：review_daily_scan / review_read_daily / review_append_ainote /
 * review_daily_report（含 service 出口 traderKit.review.dailyReport）；
 * 依赖不可用时显式报 DEPENDENCY_UNAVAILABLE（tasks 2.5）。
 */
import type { Context } from '../context-types.ts'

export function registerReviewDaily(_ctx: Context): void {
  // change 5（daily-summary tasks 2.1–2.11）装配点：注册四工具 + dailyReport 出口。
}
