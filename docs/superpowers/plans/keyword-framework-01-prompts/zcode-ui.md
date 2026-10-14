# ZCode：独立工作流运行页面与关键词提示

指派对象：独立 ZCode 开发会话；建议模型：GLM-5.3 / high。
日期：2026-10-11。以下全文可直接复制为任务书；模型在应用界面选择，本任务书不自动切模型。
旧任务映射：旧任务11。编号只用于历史定位，实施以本任务书和修订主计划为准。
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
仅写该开发规划下 `workers/ui.md`；不改共享 task_plan/findings/progress，不共享或修改活动计划指针。

## 实施纪律

清理/重构前先在自己的记录写小计划；未覆盖行为先写有意义回归，再以失败断言锁定问题，最小实现后定向回归。
测试用真实临时目录、实际实现、确定性时钟或可控 Promise；零 mock、零 sleep，不以返回预制成功的替身证明宿主行为。
函数/方法按 AGENTS.md 注释业务逻辑、关键判断、异常处理、参数和返回；不引入新依赖，优先复用既有工具与模式。
不注册生产 @预期，不发交易请求，不写真实 vault，不部署/重启，不自动 commit；生产工作流表维持空。
不改主聊天工具，不把源码测试全绿报告为真实宿主 Agent、运行中 profile 或正式管理页成功。

## 专属前置与所有权

专属前置：公共 DTO、API准确路由/错误/分页、parser 和管理槽真实 subject 已交接；HTTP 实装后再做正式请求验收。
只拥有新文件 `src/client/processors/WorkflowRunsPanel.ts`、`src/client/processors/api.ts`、`src/client/review/processor-view.ts`。
拥有新测试 `test/client/workflow-runs-panel.test.ts`、`test/routes-review/review-processors-page.test.ts`。
完整路径均以 `E:/work/code/open/dsh-plugins/dsh-trader-kit/` 为前缀；开工先核这些新文件是否已被他人创建，若重叠先报告主会话分配。
既有 `src/client/processors/KeywordRunsSection.ts`、`contracts.ts`、`src/client/index.ts`、`src/client/review/index.html.ts` 与既有client测试由主会话维护。
本包只交独立组件/读取包装/提示渲染导出；slot注册、旧占位替换、根装配和复盘页面嵌入由 Codex 主会话独占。
不得为方便渲染另建公共 types 或 fixtures；必要的 DTO/client 契约修改交主会话合入。

## 目标行为和关键边界

沿现有 React/createElement 模式显示工作流运行，subject 仅本插件bundle；其他subject不显示或发请求。
列表显示关键词、工作流名称、来源卡片、触发原因、状态、时间、结果摘要及失败/等待的中文原因。
日志来自持久events分页，显示阶段信息、截断、attempt/native job/真实Agent会话关联；不用全量思考流承诺。
步骤是工作流自己报告的日志，不把框架stage/data/agent显示为用户必须理解的业务协议。
代码工作流和Skill适配用同一通用列表；新增业务实现不要求改列表主逻辑。
提供显式重跑、取消、开关/配置、重载和有界重扫；输入和记录冲突409刷新提示，不盲重发。
只读刷新走真实持久HTTP，GET不登记或执行；关闭/隐藏页面停止轮询，关闭页面不取消后台运行。
viewSequence+AbortController隔离筛选/切卡后迟到响应，过期结果不覆盖当前页面。
网络失败、能力未接入、记录损坏和空列表分别展示，不以空白或伪结果掩盖。
原生流仅作补充；无合法sessionId不伪造，重启后历史同名 native ID 不连流/kill。
公开数据不展示私有token、完整prompt、绝对路径；业务自己的待确认界面不加入通用必选模型。
复盘输入仅本地识别/显示已知关键词，未知词不拦保存；保存成功才由后台触发。
不改用户Markdown正文，不代写注释/关键词，旧无关键词、旧Markdown、纯文本和图片卡保持兼容。
不读图片字节、不操作草稿/主聊天、不显示未实现 @预期 假结果；内联代码兼容现有 ES2017/Chromium边界。

## 有意义定向用例

实际React渲染与纯渲染函数验证subject过滤、等待/失败/成功、日志截断、来源关联和空/不可用状态。
可控Promise验证筛选/切卡迟到响应、abort、隐藏停止刷新、关闭不取消运行和409不重发。
真实持久API接入后验证阶段日志/结果；未接线时明确未验，不用固定成功响应替代服务。
关键词提示验证正文不变、unknown不拦保存、无关键词旧卡/旧Markdown/纯文本兼容。

## 验证与交付

先运行定向测试：`pnpm exec vitest run test/client/workflow-runs-panel.test.ts test/routes-review/review-processors-page.test.ts`。
再执行仓库门禁 `pnpm typecheck`、`pnpm build`、`pnpm test`，核结果与基线差异；已知失败也要给出处和当前证据。
运行 `git diff --check` 并静态核查所有权、敏感字段和异步边界；package.json 当前无 lint 脚本，不新增依赖伪造 lint，记录该限制。
未运行的门禁、真实宿主探针或页面验收明确写未运行/skip/阻断及原因，不能算通过。
交付实际修改文件、行为与简化内容、先失败断言和原因、实际命令及通过/失败/skip 数、旧行为回归、剩余风险和共享接口需求。
自己的记录还需写可供下一包调用的真实导出与边界；不要仅报“完成”。
