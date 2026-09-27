/**
 * 装配点（change 3 tq-skill-installer）：skill 安装器注册。
 * 空实现占位——change 3 接管本文件（tq_skill_manage 工具、skill.status 出口）；
 * 主装配只保留一行调用（`src/index.ts` 的 `registerSkillInstaller(ctx)`）。
 */
import type { Context } from '../context-types.ts'

export function registerSkillInstaller(_ctx: Context): void {
  // change 3（tq-skill-installer）装配点：注册 tq_skill_manage 与 skill 状态出口。
}
