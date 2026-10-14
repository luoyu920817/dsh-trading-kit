# 01 开发计划入口

2026-10-11最新步骤：[修订计划](../../docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md)，[实际源码审查](../../docs/spikes/keyword-framework-implementation-review-2026-10-11.md)。旧主计划只作历史参考，当前先公共契约迁移和解析误识别修复；模型/指派/17份全文见最新提示词索引。

最新设计以 [简单关键词入口与开放Agent工作流](../../docs/design/keyword-framework/00-simple-agent-workflow-principles.md) 为准。原任务书需先迁移六方法等公共契约；任务0/1首轮已完成，未继续派发后续包。

主文件：[01 框架与触发机制开发计划](../../docs/superpowers/plans/2026-10-10-keyword-framework-01.md)。主文件是唯一步骤清单，本目录不保存重复副本。

分工：[任务分配与前置条件](../../docs/superpowers/plans/2026-10-10-keyword-framework-01-task-allocation.md)，给出 zcode 的文件范围、启动条件、交付和协调责任；尚未实际下发或开始实现。

启动：[指派对象、模型与完整提示词](../../docs/superpowers/plans/keyword-framework-01-prompts/README.md)。用户已要求新建一个 Codex 开发会话；实际创建见 progress.md，ZCode 包不自动下发。

本轮状态：计划编制完成，实际开发 not_started；主计划任务 0–12 全部未勾选。

恢复前先读 [task_plan.md](task_plan.md)、[findings.md](findings.md)、[progress.md](progress.md)，再读主计划。下一步优先按任务 0 核对基线和真实宿主接线；未获得实机证据不能把完整框架验收标成完成。

任务 ID：`2026-10-10-keyword-framework-01`。插件活动指针位于 `../.active_plan`；工具子进程设置 PLAN_ID 不等于父会话 hooks 已固定，恢复时需显式选择并核对解析结果。
