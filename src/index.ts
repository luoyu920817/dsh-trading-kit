/**
 * dsh-trader-kit —— 个人 A 股交易工作流插件（host 面）。
 *
 * 定位与分层：docs/architecture.md；阶段路线：docs/roadmap.md；
 * 搬运溯源：docs/carryover.md。参考源（dsh-trading）只读，不回流。
 *
 * 阶段 1（骨架）：无服务、无工具、无路由——只验证「npm 包 → patch 行 →
 * 宿主插件树」装配链路与构建/测试链路。后续阶段的接线点：
 * - 阶段 2：桥（REST + SSE + tokenized URL）——TDX 嵌入页的地基；
 * - 阶段 3：connector-tdx + kit-cn research-data（搬运）；
 * - 阶段 4：knowledge vault 引擎（搬运 + 适配，无 cards.json 包袱）；
 * - 阶段 5：盘后例行 job + 复盘 skill（五需求工作流层）；
 * - 阶段 6：strategies（搬运）+ patternId/toTdxFormula + 嵌入页。
 */
import type { Context } from '@deepseek-ai/cordis'

/** Cordis 插件名（= cordis.patch.yml 挂载的 npm 包名）。 */
export const name = 'dsh-trader-kit'

/** 阶段配置占位：各阶段接线时按需扩展（沿 dsh-trading Config 先例）。 */
export interface TraderKitConfig {}

export function apply(_ctx: Context, _config?: TraderKitConfig): void {
  // 阶段 1：无操作。装配契约见 test/smoke.test.ts。
}
