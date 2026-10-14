# ZCode：受控上下文与 Agent 可用能力

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / high。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务7的 context 子项。编号只用于历史定位，实施以本任务书和修订主计划为准。
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
仅写该开发规划下 `workers/context.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：主会话交接 execute 运行上下文、来源读取、授权能力、结果/日志形状与上下文限制；registry/records 的实际版本接口可用。
主会话交接当前角色读取和 Agent 能力准确宿主适配；只存在声明或安装源码时不得假设可调用。
只拥有 `src/review/processors/context.ts` 和 `test/processors/context.test.ts`。
完整路径为 `E:/work/code/open/dsh-plugins/dsh-trader-kit/src/review/processors/context.ts` 与 `E:/work/code/open/dsh-plugins/dsh-trader-kit/test/processors/context.test.ts`。
只读参考 `src/review/store.ts`、`src/review/history.ts`、`src/review/snapshot.ts`、`src/context-types.ts`。
不改共享缓存、host-agent/host-jobs、types、fixture、生产 Skill；真实宿主 Agent 创建、工具装配与清理由 Codex 主会话负责。

## 目标行为和关键边界

为 execute 提供已保存整卡快照、全部关键词命中、运行ID、输入/定义版本、取消信号、日志与明确授权的能力。
能力由代码白名单和本次授权固定；模型不指定任意路径、SQL、Skill 来源或未授权工具。
受控读取返回真实材料、来源版本与可验证标识；只允许本工作流授权的 card/角色/历史读取范围。
复用现有 Snapshot/history 能力，角色使用既有 Agent 口径；历史是用户观点，不能伪称行情事实。
输入/定义版本与额外上下文版本区分；整卡正文默认输入，不要求每个工作流实现 projectInput。
上下文默认24000字符，历史默认10条硬上限20；若迁移契约调整必须交接原因和回归，不自行放大。
正文超限明确拒绝或等待原因，不静默截断核心正文，不以摘要冒充原始输入。
文字工作流不读图片字节，不做全文 vault 搜索或市场网络请求；额外能力必须有实际授权与实现。
代码工作流可以按需多轮调用授权 Agent/工具；context 提供受控能力，不把工作流退化为固定单次 prompt。
Skill 适配器同样消费统一 context，实际 Skill 身份/内容由宿主适配核验，候选同名列表不等于实际可用。
缺 provider/model/实际 scoped Skill/读取能力时明确 capability 不可用；不造 fake Agent 返回成功。
取消时停止后续材料读取与能力调用；取消不能使已成功持久结果倒退。
业务产物写入仍通过交接的受控业务能力，校验来源/业务版本、授权及幂等；不能由模型自行选保存路径。
不新增 stage 分派、data 分支、统一 moduleCommitFacts/afterCommit；业务事实由实现内部维护。

## 有意义定向用例

真实临时卡片/历史验证材料对应、来源版本、跨市场隔离、历史上限与超长正文拒绝。
授权之外读取明确拒绝，缺读取/Agent能力明确表达；取消前后不会新增能力调用。
代码编排多步读取使用同一来源快照，Skill适配消费相同基础材料；材料变化不会静默替换运行输入。
测试只验证 context 的实际本地行为；宿主能力未验证须明确写未运行，不能用替身补齐。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/processors/context.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
