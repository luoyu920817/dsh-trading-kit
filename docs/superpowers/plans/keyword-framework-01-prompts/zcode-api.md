# ZCode：独立管理 HTTP 与普通工具

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / high。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务10。编号只用于历史定位，实施以本任务书和修订主计划为准。
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
仅写该开发规划下 `workers/api.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：迁移后的管理服务真实实现、公共 DTO/错误码/版本/分页字段已交接；results/恢复策略完成。
迁移后的 contracts.md 必须明确实际服务签名与 processing 路由；旧 ProcessingService 声明不能当实现使用。
拥有新文件 `src/routes/review-processors.ts`、`src/tools/review-processors.ts`、`test/processors/api.test.ts`、`test/processors/tools.test.ts`。
完整文件路径均以 `E:/work/code/open/dsh-plugins/dsh-trader-kit/` 为前缀。
只读参考 `src/routes/review.ts`、`src/tools/review.ts` 和既有真实 HTTP 测试，复用普通路由/工具模式。
不改既有 auth、`src/routes/review.ts`、`src/review/index.ts`、root/服务接线；Host/Origin/writeCredential 校验装配由 Codex 主会话独占。
不改 `/local` 的性能和现有复盘请求兼容行为。

## 目标行为和关键边界

页面主要对象为工作流运行；公开配置表达关键词到工作流映射，不输出必选 stage/data/agent 协议。
按已交接路由实现 health/registry/runs或保留tasks兼容名、单次运行/events/cards，以及显式retry/cancel/settings/reload/rescan。
名称以公共交接为准，不私自改旧兼容路径或猜造新 DTO。
GET 只读持久记录；发现遗漏只给 reconciliationNeeded，不登记、wake、远端取数或启动模型。
写请求复用已接线的原鉴权边界；不另造 secret、鉴权协议或 SSE。
请求体64KiB，ID/游标白名单，record/settings版本冲突返回409；不能盲目自动重发写请求。
列表默认20最多50，事件最多100，返回持久序号、hasMore/下一游标及截断信息。
显式重扫最多31自然日，有界分页并经同一登记/额度，不因请求查询历史而自动启动全量回溯。
显式retry以当前已保存输入新增独立运行，旧结果/日志保留；cancel仅作用本框架当前自有执行。
成功运行cancel不回滚，历史 native ID 不具控制权限；运行会话/native关联可读但不授予 kill 权限。
普通工具只开放运行查询/结果读取与显式有界rescan；禁止公共 submit、任意 payload 写、任意路径和人工预期确认。
不写生产 @预期、不调用行情/交易账户接口，不把业务后续观察变为通用工具。
公共 DTO/错误/事件严格白名单脱敏，私有 attempt 凭据、cwd、绝对路径和完整prompt不出网。
能力不可用、记录损坏和版本冲突要明确区分，不能把所有情况包装为空列表/200成功。

## 有意义定向用例

真实本地HTTP与临时dataRoot验证读接口零登记/零执行副作用、分页截断和坏参数拒绝。
真实请求验证64KiB、路径/ID/游标越界、409版本冲突、重扫31日边界和读取损坏记录。
工具查询输出与服务DTO一致，不能取得 submit 或私有凭据；重跑/取消只影响当前自有运行。
原鉴权集成由主会话接线后验证，不用假的鉴权入口证明 Host/Origin/writeCredential 有效。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/processors/api.test.ts test/processors/tools.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
