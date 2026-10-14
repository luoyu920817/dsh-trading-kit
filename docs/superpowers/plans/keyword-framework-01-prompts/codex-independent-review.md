# 独立 Codex：统一关键词工作流只读审查

指派对象：用户另开的独立 Codex 审查会话；建议模型：GPT-6 Astra / high。
日期：2026-10-11。以下全文可直接复制；不自动创建审查聊天，不自动切换模型。
旧任务映射：旧任务1–12独立审查。编号仅辅助定位，最新四对象/三模块/统一代码工作流契约优先。
仓库完整路径：`E:/work/code/open/dsh-plugins/dsh-trader-kit`。

## 先读与真实前置

先读以下完整路径：
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/AGENTS.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/design/keyword-framework/00-simple-agent-workflow-principles.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/spikes/keyword-framework-implementation-review-2026-10-11.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/spikes/keyword-framework-contracts.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/spikes/keyword-management-jobs.md`。
读取 Codex 主会话交接的开发规划和已交付 workers 记录；设计规划和活动指针只读。
先 `git status --short` 核实际工作区，不相信任务书“应有”就判断接口存在。
首个前置为 Codex 已完成公共契约迁移，并在 contracts.md 更新准确实现、DTO、服务签名和验证结果。
若迁移尚未完成，只审当前实现与设计差距，明确待迁移；不能按旧六方法继续签发新开发包。
类型声明、安装源码、离线探针和 live能力分别核验，不把声明当可调用服务。

## 只读所有权与协作

你不是独自在仓库工作，不撤销别人改动，不修改源码、测试、types、client、fixture或共享规划。
无生产文件修改所有权；发现问题给精确位置/触发过程/最小修复方向，由对应负责人处理。
可以运行现有只读检查与使用临时目录的已有测试；不启动真实Agent，不发会改个人数据的宿主流程。
不新增依赖，不发交易请求，不写真实vault，不注册生产@预期，不安装/部署/重启/自动commit。
审查输出留在本会话；如主会话明确交接记录目录，只写开发规划下 `workers/independent-review.md`。
不写共享task_plan/findings/progress，不共享或修改活动计划指针，不自动给其他任务发消息。

## 核心审查标准

公共业务模型只有卡片、关键词、工作流、运行记录；结果/日志/attempt/native/session是属性或内部机制。
公共模块只承担触发、执行、运行管理与日志；历史 processors 目录不应导致新增平行 workflow 体系。
注册 WorkflowImplementation 单execute入口，Skill只是适配实现；代码从首版能多轮/工具/业务产物。
检查是否换名后仍强制六方法、stage/data-agent双分支、moduleCommitFacts或afterCommit观察协议。
普通文字工作流不应被预期字段、交易日判断、业务锁和统一观察/确认状态绑定。
工作流内部必要业务写入仍有实际来源/业务版本核验、权限限制、幂等，不能因收缩契约删保护。
整卡默认输入、保存后触发、关键词别名/重复命中去重、显式重跑保历史、旧输入不覆盖当前结果。
来源短核检查真实正文且不依赖写通知已处理；不可读与删除分开，市场/相对文档/anchor身份准确。
来源输入版本、定义版本、逻辑序号与私有attempt凭据同时门控；公开DTO/日志/错误不可泄露凭据。
锁顺序与generation防迟到覆盖；所有网络、Jobs.start、Agent创建/等待/dispose位于短锁外。
running激活后的取消竞争、提交后的成功不回滚、cleanup完成前占槽和清理拒绝显式报告。
恢复已有结果不重新启动Agent；中断无结果attempt明确记录，新尝试计额度，不假称旧会话续接。
native job/Agent session仅绑定当前自有运行；历史ID重启复用不连流、不kill新任务。
GET零接纳/零模型/零网络取数；原Host/Origin/writeCredential边界未被独立API绕过。
页面迟到响应/隐藏轮询/409重发/关闭后台取消边界；未知关键词/旧Markdown/纯文本兼容。
新增工作流能通过同一execute接入，不需要改parser/scheduler/trace/通用列表；不提前建节点DSL或第二调度器。
真实Skill scope/内容/身份及provider/model/cwd是否核验，idle/job done而无明确结果不能成功。

## 有意义验证与结论

优先运行与发现有关的现有定向测试；失败先复核实际断言和基线，不为全绿删除断言或越权修实现。
核测试采用真实临时文件、实际实现、确定性时钟/可控Promise，零mock、零sleep；不增加与实现逐行相同的断言冒充回归。
核两种扩展验证分别为代码编排与Skill适配，不接受第二个同类文字模块冒称开放扩展。
不fake宿主Agent，不把源码全绿作为真实会话、运行中profile或正式管理页成功。
默认4个宿主探针skip明确是skip，不是通过；列实际通过/失败/skip与live未运行边界。
核 `pnpm typecheck`、`pnpm build`、`pnpm test` 和 `git diff --check` 的当前结果。
package.json当前无lint脚本；核已有静态检查和相关源码风险，不引入新工具假称完成lint。
只列证据明确的问题：严重性、准确文件行、触发条件、测试缺口、影响和最小修复。
区分可复现缺陷、设计迁移缺口、实机未验、既有基线问题；未验证内容不要升级为已确定缺陷。
若未发现可复现问题，仍交代实际审查文件/命令/证据和剩余未验风险，不给未测的运行完成背书。
交付所有权核查、实际修改文件（只读应为无）、简化是否兑现、测试证据和剩余风险。
