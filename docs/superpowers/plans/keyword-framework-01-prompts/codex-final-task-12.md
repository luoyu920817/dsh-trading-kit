# Codex主会话：任务12新框架最终验收

日期：2026-10-11。建议模型／思考：GPT-6.1 Sol / high。以下全文可直接复制到指派会话。

仓库：E:/work/code/open/dsh-plugins/dsh-trader-kit。
先读 AGENTS.md、docs/design/keyword-framework/00-simple-agent-workflow-principles.md、
docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md、
docs/spikes/keyword-framework-implementation-review-2026-10-11.md、
docs/superpowers/plans/keyword-framework-01-prompts/README.md。
再读 docs/spikes/keyword-framework-contracts.md 和真实源码，核日期及实际导出；旧交接尚可能是六方法快照，声明不当可调用实现。

业务对象只有卡片、关键词、工作流、运行记录；模块只有触发、执行、运行管理与日志。
统一工作流执行入口从首版支持代码编排，Skill/提示词是同入口的一种实现；内部步骤/工具/业务产物由工作流组织。
不要要求所有工作流实现六方法、公共stage/data-agent协议或预期观察模型。来源/权限/版本/幂等保障保留在受控服务。

你不是独自在仓库工作。先核git状态和文件归属，不撤销他人改动、不整目录覆盖、不自动提交。
公共types、client/contracts、fixture、旧store/root/auth/slot与共享记录由Codex开发主会话唯一维护；ZCode共享需求交主会话合入。
前置未满足列准确缺项，继续独立可做项；不造空壳、假Agent或第二后台运行器。
开发目录沿 .planning/2026-10-10-keyword-framework-01-development/；主会话维护共享记录，worker只写自己的workers记录，不改活动指针，设计目录只读。
行为修改先失败回归，再最小实现；真实临时文件、确定性时间/可控Promise，零mock、零sleep，新函数按AGENTS注释规范。
无新增依赖、上游修改、交易请求、真实vault测试写入、生产预期注册、个人profile部署/重启或自动commit。
实际模型在应用界面设置，本提示词不自动切换模型。源码、安装离线探针与实机验收分开报告。

前置新任务1–11实际完成、任务0live能力具备和集成测试交付，不按旧六方法清单勾完成。
拥有包资产/最终交接、宿主证据和开发记录；必要共享修正顺序接手，不覆盖worker在途文件。

1. 审源码只有四对象/三模块，新工作流单入口，无必选六方法/stage/data-agent/公共观察。
任务1迁移、活动尝试/DTO缺项与任务2误触发修复均有回归，任务3有实现而非声明。
2. 两类扩展：Skill适配；代码取材料/两轮工具Agent/分支，都走同一框架。
增加第二关键词不改parser/scheduler/页面，业务模型只留对应实现。
3. 真实测试卡保存→映射→持久运行→Jobs/Agent→明确结果→正式管理日志，测试重跑/取消/编辑迟到/卸载重启。
4. 临时dataRoot/测试profile核安装包config/client资产和实际加载版本；build/刷新不是部署成功。
测试profile验证按任务必要执行，个人profile变更/重启要有明确已有授权。
5. 生产空工作流表，不夹带测试Skill/虚构交易材料，不提前实现预期观察/交易日/确认。
6. 全量typecheck/build/test/合规/diff，默认skip明确；实际Agent/Skill/详情日志不可用不能用单测或占位替代。
7. 输出修改文件、真实端到端证据、旧行为兼容与风险；未验项不勾完整框架交付，不自动commit/PR。

验证命令沿实际package scripts/探针路径，不编造lint。完成框架后才另排预期实现。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
