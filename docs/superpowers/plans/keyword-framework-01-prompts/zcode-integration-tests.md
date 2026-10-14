# ZCode：统一执行扩展与集成验证

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / high。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务12辅助。编号只用于历史定位，实施以本任务书和修订主计划为准。
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
仅写该开发规划下 `workers/integration-tests.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：主会话公共迁移及各包真实导出/测试已经交接，API/root接线已可调用；实际缺项逐一可查。
Codex 主会话维护并交接两种仅测试装配：代码编排实现与 Skill 适配实现，都注册 WorkflowImplementation.execute。
只拥有 `test/processors/framework-integration.test.ts`、`test/processors/extension.test.ts`。
完整路径为 `E:/work/code/open/dsh-plugins/dsh-trader-kit/test/processors/framework-integration.test.ts` 和 `E:/work/code/open/dsh-plugins/dsh-trader-kit/test/processors/extension.test.ts`。
fixtures、公共 types、client、宿主适配、生产源码及 host-jobs-contract.test.ts 由 Codex 主会话维护。
需要 fixture 能力时列出真实需求交主会话，不直接改 fixture 或用 fake宿主Agent填空。
本包不承担部署、profile安装与正式管理页完成声明。

## 验证行为和关键边界

用真实临时dataRoot写卡，经真实parser/registry登记、records/scheduler执行、results保存、trace与管理API读取。
整条链保持卡片→关键词→工作流→运行记录四对象，三模块通用职责，不引入第二套运行器。
分别验证代码编排与Skill适配通过同一 execute 接入；不能用“第二个同类文字模块”代替异构扩展证明。
代码编排至少验证多个内部步骤/受控材料/业务摘要，增加步骤无需改 parser/scheduler/trace/通用列表。
Skill适配验证实际适配注册、配置与结果边界；真实宿主不可用时只测本地可验证部分，缺项明确未运行。
不造 fake Agent 的 followup/idle/submit 来宣称真实宿主成功，不以离线结果全绿证明会话创建和工具可用。
生产工作流表保持空；测试装配不注册生产 @预期 或污染真实vault。
验证同词多处一运行、多个工作流各自运行、跨卡独立、保存前只提示、原始Markdown保持不变。
验证无关键词旧卡/附注不重跑、编辑后旧结果保护、定义改变、关停/取消、当前显式重跑历史保留。
验证缺能力/额度/容量中文原因、running取消、清理前占槽、重启已有结果不再执行和中断attempt重新记账。
验证私有凭据不出DTO/日志，来源写通知滞后仍短核，历史native ID重用不接管当前执行。
业务产物写入只在临时目录受控范围，真实版本/权限/幂等保护可检，不借统一afterCommit观察协议过关。

## 宿主证据等级与有意义用例

默认全套报告中的4个宿主探针 skip 是 skip，不是通过；明确列出其名字、原因和实际启用条件。
仅在实际宿主/安装真实实现与所需能力确有交接后运行对应探针，不能凭环境变量存在判断服务可用。
安装源码、真实实现离线探针、live DSH/profile、真实Agent会话与正式页面验收分别报告。
现有 `KEYWORD_HOST_PROBE_ROOT` 只证明其指向的真实安装实现；不把Jobs离线探针当Agent/profile验收。
真实宿主测试由主会话确认执行边界与无生产副作用；无法运行记not_run，保留断言，不删测试降门禁。
所有本地集成采用真实临时文件、确定性时间、可控Promise，零mock/零sleep。
先写实际失败回归再修测试装配需求；发现生产缺陷报告主会话，不能越权修生产文件。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/processors/framework-integration.test.ts test/processors/extension.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
