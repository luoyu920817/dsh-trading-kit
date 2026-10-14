# ZCode：运行身份、持久记录与日志

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / max。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务4。编号只用于历史定位，实施以本任务书和修订主计划为准。
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
仅写该开发规划下 `workers/records.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：迁移后的运行记录/设置/日志类型和 records 的读写、CAS、锁、路径键及 DTO 白名单已由主会话交接；registry 输入/定义版本生成口径已固定。
拥有生产文件：`src/review/processors/identity.ts`、`records.ts`、`trace.ts`、`src/paths/mapping.ts`，以及仅为新增业务区确有必要的 `src/paths/resolve.ts`。
拥有测试：`test/processors/identity.test.ts`、`records.test.ts`、`trace.test.ts`、`test/paths.test.ts`。
完整生产路径前缀为 `E:/work/code/open/dsh-plugins/dsh-trader-kit/`；不要改 store、公共 types、parser、registry、host-jobs 或 root 装配。
先读真实 `src/review/ident.ts`、`src/paths/mapping.ts`、`src/paths/resolve.ts`，复用身份和安全路径入口。

## 目标行为和关键边界

运行身份以真实相对文档路径、anchor、市场及来源版本为基础；同码不同市场、旧裸代码文档不能错误合并。
按迁移后的契约生成 card/run 身份与去重键；不能沿旧 stage 五项 hash 把内部步骤固化为公共模型。
整卡用户正文默认参与输入版本，writtenAt、mtime 和附注不代替正文版本；同请求指纹复用，显式重跑保留独立历史。
保留来源输入版本、工作流定义版本、逻辑请求序号、每次 attempt 与私有提交凭据。
只持久化可序列化事实，不持久化 Agent/Jobs 句柄、函数或 AbortSignal。
在现有 mapping 唯一表登记 processing 运行月桶 `DB/review/<YYYYMM>/processing` 和设置区 `DB/review/processing`；路径键准确名称等交接。
沿已确定白名单写入，不扩 DB/stock 权限，不自造另一日志根，不建第二 JobRegistry。
真实临时文件执行同目录临时文件+rename 原子保存，expectedVersion 冲突拒绝；状态、结果、日志同一运行文件一致提交。
坏 JSON、超限、部分读取和不完整目录给明确错误，不能按 mtime 挑赢家或把读失败当删除。
沿交接的 2MiB 和事件保留上限执行；时间线首20末980，序号不重置，遗漏数量及首保留序号可查询。
公开 DTO 和持久/原生日志不得泄露私有 token、绝对路径、完整 prompt 或未授权正文；字段白名单优先。
原生 job/session 只记录可验证关联和 runtimeInstance，不授权凭历史同名 ID 控制新宿主任务。
原生日志投影失败记录可观察警告，不能回滚已保存成功结果。
运行记录为事实源；结果和日志可存储分文件的扩展必须先交接一致性，不引入强制业务观察/投递协议。

## 有意义定向用例

真实路径验证跨市场/跨文档身份、旧裸代码、越界拒绝和既有 mapping 行为。
并发 CAS、同组请求序号、重复通知复用、损坏/超限文件拒绝、原子保存前后读一致性。
持久化后重读来源/定义版本、attempt、结果及日志；私有 token 不出现在 DTO 或原生投影。
日志截断后序号持续增长；原生投影失败不影响持久成功；不依赖计时 sleep。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/processors/identity.test.ts test/processors/records.test.ts test/processors/trace.test.ts test/paths.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
