/**
 * 面板常量（review-loop `review-panel`；客户端半）。
 *
 * - `PANEL_REVIEW_BASE_PATH`：宿主同端口路由前缀。**与 `src/routes/review.ts` 的
 *   `REVIEW_BASE_PATH` 同值**（客户端不 import 宿主模块；一致性由结构断言保证——
 *   test/routes-review/review-loop-panel.test.ts）。
 * - `ORGANIZE_DAY_PROMPT`：面板「整理今日复盘」按钮发送的**固定模板 prompt**
 *   （MUST NOT 拼接页面可变内容）；与 skill 的「触发短语」同文（单一事实源在
 *   skill 文本，本常量为面板侧副本，结构断言比对两处字面量一致）。
 */
export const PANEL_REVIEW_BASE_PATH = '/dsh-trader-kit'

/** 面板 id（`sidebar.panellist` 项与 root keyed `main` 槽同 id 寻址）。 */
export const PANEL_ID = 'trader-kit-review'

/** 面板入口标题（侧边栏图标 tooltip/无障碍名）。 */
export const PANEL_TITLE = '复盘'

/** 触发短语（固定模板；交易日缺省由 skill 经 T0 解析——MUST NOT 带日期字面量）。 */
export const ORGANIZE_DAY_PROMPT = '整理今日复盘：请按 review-daily-summary 工作流执行——扫描当日有卡标的并逐标的生成 AI 附注，'
  + '读取 DB/stock 标的档案（角色 作为口径）后在收尾汇总四段（指数/情绪/赚钱效应/题材）写入当日盘面 md。交易日缺省按 T0 解析。'

/** 当日状态读接口路径。 */
export function dayApiUrl(): string {
  return PANEL_REVIEW_BASE_PATH + '/review/api/day'
}
