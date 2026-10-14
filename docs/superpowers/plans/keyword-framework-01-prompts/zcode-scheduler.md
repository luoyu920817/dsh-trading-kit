# ZCode：统一运行接纳、额度与清理

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / max。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务6；后续结果工作按独立任务8提示词交接。编号只用于历史定位，实施以本任务书和修订主计划为准。
仓库完整路径：`E:/work/code/open/dsh-plugins/dsh-trader-kit`。

## 先读与事实核对

先读以下文件，文中相对路径均相对于上述仓库：
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/AGENTS.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/design/keyword-framework/00-simple-agent-workflow-principles.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/spikes/keyword-framework-implementation-review-2026-10-11.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/spikes/keyword-framework-contracts.md`。
- `E:/work/code/open/dsh-plugins/dsh-trader-kit/docs/spikes/keyword-management-jobs.md`。
旧 01–04 设计只用于理解已保留的来源保护、落盘和宿主证据；冲突处以上述最新原则及契约迁移交接为准。
先运行 `git status --short`，核实际源码、测试和已交付 workers 记录；类型声明、计划复选框及历史探针不等于服务已经实现。

## 公共前置与协作纪律

首个前置统一为：Codex 主会话先迁移公共契约，建立可注册的 `WorkflowImplementation` 单 `execute` 入口，并更新 contracts.md 的准确实现、DTO、服务签名和验证结果后交接。
本任务书描述目标行为，不替代准确 TypeScript 签名；收到交接前仅做只读核对和明确不依赖公共类型的现状回归。
如果首个前置或下面专属前置缺失，在自己的 worker 记录列出具体缺项，不造空实现、不越界补齐别人的包。
公共业务对象只有复盘卡片、关键词、工作流、运行记录；结果、日志、输入/定义版本和 attempt 是运行记录属性或内部机制。
公共模块只有关键词触发、工作流执行、运行管理与日志；`processors` 是历史目录名，沿现有路径迁移，不新增平行 workflow 目录。
Skill 是统一执行入口的一种适配实现；代码实现从首版支持多轮 Agent、工具、条件判断和业务产物。
不得把 stage、data/agent 双分支、ProcessorModule 六方法、统一 moduleCommitFacts 或 afterCommit 观察协议设为必选公共接入。
业务工作流内部必要写入仍须在实际写入处校验来源/业务版本、授权范围和幂等，不以简化为由删保护。
你不是独自在仓库工作；不撤销别人改动，不 reset/checkout 整个文件，不覆盖现有脏文件。
只修改下方明确拥有的文件；公共 `src/review/processors/types.ts`、既有 client 文件和 `test/fixtures/processors/` 由 Codex 主会话维护。
旧鉴权、root、slot 及来源接线由主会话独占；需要共享改动只给具体签名与理由，由主会话合入。
设计规划目录只读；开发规划路径以主会话交接为准，默认已有 `.planning/2026-10-10-keyword-framework-01-development/`。
仅写该开发规划下 `workers/scheduler.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：迁移后的注册表、records、来源核验及统一启动/唤醒/排空实际接口已经交接。
公共契约须明确 initial、显式 retry、业务后续运行的来源关联、取消和恢复，不以旧 stage 双分支实现代替。
主会话先交接宿主 Agent/Jobs 适配实际可用能力与容量错误；纯决策测试可以先行，不能提前接不存在的执行器。
只拥有 `src/review/processors/scheduler.ts` 和 `test/processors/scheduler.test.ts`。
完整路径为 `E:/work/code/open/dsh-plugins/dsh-trader-kit/src/review/processors/scheduler.ts` 和 `E:/work/code/open/dsh-plugins/dsh-trader-kit/test/processors/scheduler.test.ts`。
来源订阅、reconcile/index/root、host-agent、host-jobs、records/trace/types 的变更由 Codex 主会话处理。
本包不接卡片写通知，不接 API/slot，不单独重建恢复扫描器。

## 目标行为和关键边界

所有启动都登记运行记录并走同一接纳能力，执行一次注册工作流的 execute；代码和 Skill 适配共用此路径。
同来源输入与定义指纹复用；正文/定义变化或显式重跑创建新逻辑请求，执行重试仅增加可区分 attempt。
关键词触发、手动重跑、后续业务请求都沿相同版本保护、额度与日志；后续业务时机不在 scheduler 判断。
框架仅显示排队、等待、运行、成功、失败、取消；内部准备/退避如保留则属于运行机制，作者无需写六方法。
全局/工作流开关、来源不可核验、能力缺失、容量和额度分别给具体等待原因；原因未变不重复刷日志。
不把所有 start 错误都归 hostCapacity；缺 controller/实际 Agent 能力属于 capability。
宿主容量10秒重检按交接使用可控时间；网络失败5秒退避、最多2次尝试仅在适用错误范围，不重试非法结果。
Agent每日30次沿东八区和持久 attempts 重建；预读不计尝试，running 激活后保守记账。
额度约束真实 Agent 调用/尝试而非名为 data 的逃逸分支；代码多轮调用的计费粒度先按公共交接固定。
每次 attempt 固定私有凭据、来源输入版本、定义版本和 runtimeInstance；失效 attempt 无权提交。
短锁仅核验和原子更新；网络、Jobs.start、Agent创建、等待和 dispose 全在锁外。
取消阻止新工作并协作取消自有资源；等待 done 完成实际清理后再释放并发槽。
明确结果才算成功，Agent idle/native job completed 不替代结果；已保存成功不回滚。
已有结果恢复不再次启动 Agent；无结果被中断 attempt 明确标中断，重试新 attempt 并计额度，不假称续接旧会话。
原生ID/session关联仅凭当前自有映射，重启后历史同名 ID 不接管、kill 或连流。
资源清理失败阻止虚假排空成功，给可定位日志；不在运行服务统一执行业务观察投递。

## 有意义定向用例

确定性时钟验证去重/新输入/定义/显式retry、能力与额度原因、日界切换和重试计数。
可控 Promise 锁外执行验证 running 激活后取消、迟到提交拒绝、结果成功后取消不倒退。
结果已保存但 cleanup 未结束时仍占槽；done 拒绝有明确失败，不释放成“清理成功”。
恢复已有结果不重启执行；历史 native ID 与当前同名 ID 不混用；代码与 Skill 接纳无分叉。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/processors/scheduler.test.ts test/processors/records.test.ts test/processors/reconcile.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
