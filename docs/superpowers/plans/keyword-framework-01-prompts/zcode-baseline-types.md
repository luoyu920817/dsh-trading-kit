# ZCode基线修复：仅当前新错误存在时启动

日期：2026-10-11。建议模型／思考：GLM-5.3 / high。以下全文可直接复制到指派会话。

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

2026-10-11 typecheck已通过。历史10处类型错误不是当前阻塞，默认不启动本包。
前置：新检查真实失败，协调者明确分配错误文件及归属；任务1共享types/fixture迁移错误归Codex。

历史可限定文件：test/routes-review/review-limit-box.test.ts、review-params.test.ts、
test/skill/assembly.test.ts、version.test.ts、zip-guard.test.ts；不是全目录许可。
其他错误先报告归属，不抢公共类型；无错误回报无需修复，不为旧任务书改测试。

1. 记录当前错误与真实业务类型，确认非旧日志；迁移接口稳定后再修。
2. 保留断言和旧数据/API，不删除检查、不as any、不放宽tsconfig、不为过测改生产行为。
3. 最小类型修正并运行受影响现有测试，行为变化先失败回归，不写镜像测试。
4. 不和其他任务同时编辑五文件，不修全仓；输出已分配范围和遗留阻塞。

验证pnpm typecheck与实际受影响测试，记录workers/baseline-types.md，不改共享规划。
缺当前失败就不要进行修改。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
