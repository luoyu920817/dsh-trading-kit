/**
 * 装配点（change 4 review-page / change 5 daily-summary）：复盘线总装配。
 *
 * 主装配只保留一行调用（`src/index.ts` 的 `registerReview(ctx)`）；本文件
 * `MUST NOT` 重建 `provide('traderKit')`——`traderKit` 服务的唯一装配面在
 * `src/service/index.ts`（change 2），这里只对既有服务追加 `api.review`。
 *
 * 三个注册位（波 3 起）：
 * ① `attachReviewService`——存储五导出（tasks 1.12，已落地）；
 * ② `registerReviewRoutes`——/review 路由族（tasks §2，change 4 承载绑定层）；
 * ③ `registerReviewDaily`——每日汇总工具与 dailyReport 出口（change 5，src/tools/review-daily.ts）。
 * 各 change 只动自己的文件，本文件只保留三行调用。
 */
import { randomBytes } from 'node:crypto'
import type { Context } from '../context-types.ts'
import type { ResolvedTraderKitConfig } from '../config.ts'
import { registerReviewDaily } from '../tools/review-daily.ts'
import { registerReviewLoop } from '../tools/review-loop.ts'
import { registerReviewRoutes } from '../routes/review.ts'
import {
  appendAinote,
  appendCard,
  locateDoc,
  parseDoc,
  scanDailyCardTargets,
} from './store.ts'

/** 复盘存储的 service 出口（契约 §3 service key：`traderKit.review.*`）。 */
export interface ReviewServiceApi {
  locateDoc: typeof locateDoc
  parseDoc: typeof parseDoc
  appendCard: typeof appendCard
  appendAinote: typeof appendAinote
  /** service 出口绑定装配期发现的 dataRoot（change 5 复用同一实现）。 */
  scanDailyCardTargets: (tradeDate: string) => ReturnType<typeof scanDailyCardTargets>
}

/** ① 存储五导出挂到 `api.review`（tasks 1.12）。 */
function attachReviewService(ctx: Context): void {
  const api = ctx.traderKit
  if (api === undefined) {
    throw new Error('registerReview 必须在 registerData 之后调用（ctx.traderKit 未挂载）')
  }
  // dataRoot 由数据面服务透出（change 2 装配期已知）；未透出期间为空串，
  // 存储操作将以 resolveArea 的显式报错给配置指引（design D-1：挂载可用，操作期报错）。
  const data = api.data as { dataRoot?: unknown }
  const dataRoot = typeof data.dataRoot === 'string' ? data.dataRoot : ''

  const reviewApi: ReviewServiceApi = {
    locateDoc,
    parseDoc,
    appendCard,
    appendAinote,
    scanDailyCardTargets: (tradeDate: string) => scanDailyCardTargets(tradeDate, dataRoot),
  }
  api.review = reviewApi as unknown as Record<string, unknown>
}

/** 复盘线总装配：服务面 → 路由族（change 4）→ 每日汇总（change 5）→ 闭环工具（review-loop），顺序即依赖序。 */
export function registerReview(ctx: Context, config: ResolvedTraderKitConfig): void {
  attachReviewService(ctx)
  // 写接口密钥（owner 裁决 2026-10-05）：config.review.writeKey 设定值优先（固定 key，
  // 重启不变）；空串 = 进程随机生成（页面经服务端注入自动携带，使用者零操作）。
  const writeKey = config.review.writeKey !== '' ? config.review.writeKey : randomBytes(24).toString('hex')
  registerReviewRoutes(ctx, { writeKey })
  registerReviewDaily(ctx)
  // review-loop（stock-profile + daily-brief）：两工具 + service 出口
  // `traderKit.review.{stockProfiles,writeBrief}`。
  registerReviewLoop(ctx)
}
