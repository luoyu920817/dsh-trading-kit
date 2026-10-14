# Codex主会话：任务7统一工作流与宿主Agent适配

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

前置：新任务1/3/4的真实契约/记录及任务1固定的context读取/执行能力契约。宿主适配可以独立核验/实现，不等ZCode context完整实现；context包待真实Agent适配交接再完成能力集成。完整联调等任务5/6及context真实实现就绪，避免context/host或任务6/7互等；任务0实际能力缺失须补核。
拥有：processors/agent.ts、host-jobs.ts、context-types.ts、host/agent测试、测试fixture/probe Skill、
keyword-management-jobs.md；context.ts由ZCode维护，types/fixture/root由你维护，旧移交文件先顺序接手。

1. root Jobs controller启动unowned，同步run用job.id绑定；只控制当前自有ID，不取消主聊天、不偷用最近会话。
done只在Agent/资源清理后结算，清理完成才释放并发，失败报告真实错误。
2. 统一调用WorkflowImplementation.execute，Skill和代码多轮同入口；不复制data专属执行器或公共stage协议。
3. 上下文Agent调用承接工具/权限/额度/超时/取消，每次真实激活计额度；工作流不能绕过宿主或自行释放名额。
4. 按实际create/setup/followup(UserMessage)/whenIdle/handle.dispose公开接口，核scoped Skill正文/来源/指纹。
纯提示词实现同权限边界，不让所有工作流强制绑定Skill，不凭旧SDK猜0.2接口。
5. 结果通过绑定本次尝试身份的私有工具收集，由适配器返回合法结果；idle/done无结果是失败。
模型不能指定runId/workflowId/来源路径或提交权限；多轮输出仍关联同一运行及明确尝试。
6. 先持久启动事实再abort检查激活，来源/定义变更拒绝旧结果；合法结果成功后清理错误不回滚。
7. 验证Skill适配和代码两轮Agent/条件步骤都能运行并共享日志，不fake宿主Agent或用data函数代多轮证明。
8. 固定无行情测试宿主探针；无模型/Skill/page列未验，console不能代DSH正式持久日志，不随意改个人profile。

验证：host/agent/context/results定向及实际安装探针，实机Agent与scope另外记录。
输出真实接口、取消/结果/清理、模型配置可用性和未验项；不自动实施预期业务。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
