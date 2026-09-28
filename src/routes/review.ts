/**
 * 装配点（change 4 review-page tasks §2）：/review 路由族注册。
 * 空实现占位——change 4 波 3（R-b）接管本文件；装配点只保留一行调用
 * （`src/review/index.ts` 的 `registerReviewRoutes(ctx)`）。
 *
 * 承载结论（spike-tdx-embed 终版报告）：采用 http 同端口页面；认证 A 层写/
 * C 层只读（owner 签字）；正向联动用 treeid 导航；handler 须为纯工厂
 * `createReviewHandler(deps)`（tasks 2.8）。
 */
import type { Context } from '../context-types.ts'

export function registerReviewRoutes(_ctx: Context): void {
  // change 4（review-page tasks 2.1–2.8/7.1）装配点：GET /review、/review/<code>、
  // /review/api/{local,enrich,card,dates}，ctx.effect 包裹注册。
}
