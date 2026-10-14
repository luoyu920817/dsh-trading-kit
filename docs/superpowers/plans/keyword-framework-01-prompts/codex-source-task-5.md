# Codex主会话：任务5卡片来源与关键词触发

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

前置：新任务1–4真实交付，短来源核验/持久登记/定义查询准确接口可用，不能等任务6空壳登记。
拥有：store.ts必要来源短核验、processors/source.ts、reconcile.ts、index.ts及对应测试；
必要write-events/service/root/结构接线；registry/parser/records有改动必须顺序接手。

1. 复用onReviewWrite同步标dirty，后台合并/reparse真实Card.body，异步拒绝显式catch/记录。
保存成功先返回，后台登记失败不把已保存卡片返回失败，也不虚报已安排。
2. 精确路径/anchor/市场/代码/日期定位，不按裸代码追随改名；不可读与明确删除区分，generation/缓存不代正文。
3. 卡片+工作流汇总所有命中，一卡重复别名一次运行，不同工作流分别运行；整卡文字默认输入指纹。
相同输入/定义重复通知复用，手动重新运行保留旧记录/日志。
4. 只初始消费用户正文，附注/产物不递归触发、不改原文人工判断，未知词提示不阻止保存。
5. 编辑/删除协作取消旧运行，迟到结果只历史不能成为当前；业务撤回在工作流自身，不强制六方法回调。
6. 短锁核真实正文、当前定义/序号/来源；网络、Jobs启动和清理锁外。
补卡片已保存但事件未消费时旧结果抵达、重复保存并发/删除/配置关闭回归。
7. 默认只恢复已登记记录，不自动扫7日旧卡；范围重扫沿同入口/额度。登记/存储失败健康态可观察。
8. 交接真实register/wake入口供任务6，不新建消息总线/缓存/JobsRegistry或预期调度器。

验证：source/reconcile新回归和旧store并发/市场/EOL/附注/写事件测试。
开发共享记录写实际文件/接口/风险，未实现服务不通过“声明存在”交接。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
