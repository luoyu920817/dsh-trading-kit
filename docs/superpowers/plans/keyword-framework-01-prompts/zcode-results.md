# ZCode：通用结果保存与新旧输入保护

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / max。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务8；与 scheduler 任务6分开交接。编号只用于历史定位，实施以本任务书和修订主计划为准。
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
仅写该开发规划下 `workers/results.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：records、来源短核验、scheduler attempt 激活与宿主绑定提交入口已实现并交接。
公共交接必须给通用执行结果/失败类型、私有 attempt 绑定、来源版本核验与结果历史/当前有效性判定。
只拥有 `src/review/processors/results.ts` 和 `test/processors/results.test.ts`。
完整路径为 `E:/work/code/open/dsh-plugins/dsh-trader-kit/src/review/processors/results.ts` 和 `E:/work/code/open/dsh-plugins/dsh-trader-kit/test/processors/results.test.ts`。
公共 types、records/trace、store、业务适配器、host-agent、fixture 和 root 均由 Codex 主会话维护。
不实现统一业务 afterCommit、观察登记或后续业务投递；业务产物能力留给工作流实现。

## 目标行为和关键边界

保存一次工作流明确返回的通用结果，并保留历史；代码编排与 Skill 适配走相同结果机制。
输出 payload 由工作流自身明确校验，框架核通用信封、版本、长度、授权与已交接证据引用边界。
不能要求所有工作流输出相同业务字段或实现六方法 validateResult/guard/afterCommit。
身份、runId、来源、工作流、attempt及私有凭据由代码闭包绑定，模型不能自行提交身份或路径。
公开 attemptId 仅用于观察关联，不授予提交权；当前私有凭据只存在内部受控调用。
结果先保存为历史，再按真实来源输入版本、定义版本、最新请求/attempt和开关判断当前有效性。
提交时短核实际卡片，即使卡片写通知未处理也能识别正文改变；mtime/writtenAt 不能替代正文版本。
旧输入、旧定义、旧请求、旧 attempt 或私有 token 不得覆盖当前有效结果；拒绝/历史保存策略准确按交接落实。
来源不可读与来源删除区分，读失败不把业务对象默认为撤回。
状态、结果、成功事件按 records 原子提交；持久成功后取消、日志投影失败或业务产物补交都不回滚。
不因日志或产物待补交而重复启动 Agent，也不重新准备新版业务条件冒充原执行。
业务写入校验在工作流受控业务能力实际落盘处实施，版本/权限/幂等均必须保留。
如果业务产物写失败，记录实现自己的可恢复信息，不把它提升为所有运行必选的 pending 观察模型。
提交与取消竞争受同一 attempt/版本门控，锁按交接顺序短持有；网络、Agent等待、资源清理不在锁内。
公开结果/错误/日志按交接白名单及内容规则脱敏，不能只删 token 字段却把 token 放进消息字符串。
宿主Agent idle 或 job done 而无明确结果必须失败；结果成功和资源清理完成是不同运行事实。

## 有意义定向用例

真实临时文件验证旧输入/定义/请求/attempt/token、配置变化、来源不可读与删除的不同结果。
可控 Promise 验证写通知滞后、提交前编辑、提交与取消竞争以及成功后取消不倒退。
保存后重启重读结果与日志，不启动第二次执行；原生日志失败不改持久成功。
普通文字结果与代码产物摘要采用不同业务payload仍通过通用保存，不被预期字段约束。
证据未知/越界、超限与非法结果拒绝；DTO、日志和错误内容不暴露私有凭据。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/processors/results.test.ts test/processors/records.test.ts test/review/store-concurrent.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
