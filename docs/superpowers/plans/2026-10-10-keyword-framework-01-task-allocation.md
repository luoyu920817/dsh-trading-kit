# 01 框架开发的任务分配与前置条件

> 历史分工记录：2026-10-11已完成源码审查，并全面重写 [分工、模型与全文提示词](keyword-framework-01-prompts/README.md) 及 [修订开发计划](2026-10-11-keyword-agent-framework-revised.md)。当前仅先启动任务1契约迁移和任务2解析修复，任务3注册表在本仓尚未交付。下文原六方法等要求仅供追溯，不作为继续编码依据。

> 设计调整（2026-10-10）：见 [新的简单工作流原则](../../design/keyword-framework/00-simple-agent-workflow-principles.md)。原分工和提示词需先同步新接入契约，暂不启动新增实现包；解析的纯语法部分可保留。

依据：[01 开发计划](2026-10-10-keyword-framework-01.md)。本文只分配开发职责和启动条件，不改变生命周期、触发、预算或验收契约。

状态：分工清单已编制，ZCode 尚未下发。用户新增要求已补 [指派对象、模型与独立提示词](keyword-framework-01-prompts/README.md)，并准备一个新的 Codex 开发主会话启动任务0/1。下文“我”指该开发主会话的协调角色：负责前置决策、已有系统接线、合并审查和真实宿主验收。实际创建结果在设计阶段 progress 记录，不把准备提示词当会话已启动。

## 1. 分工原则

**先固定契约，再分文件编码；宿主真实能力先核验，再接执行；高风险结果保护统一审查。**

zcode 可以写有竞态的代码，但不能让它自行猜锁顺序、预算计次、Agent 工具权限或恢复条件。把这些规则落实为接口和失败测试后，再交它实现。宿主接线和最终运行验收需要当前机器/profile 的证据，由我主导。

前置不是“所有工作都等待”：纯解析只依赖本地解析契约，注册表纯校验可以在相同契约下并行；实际 Agent 执行必须等待宿主探针。每个文件同一时间只能有一个修改负责人，接口需求由负责人合入，其他执行器不越界修改。

## 2. 任务 0–12 的责任表

| 原任务 | 建议分配 | 开始前必须有的产物 | 交付检查 |
| --- | --- | --- | --- |
| 0 基线与宿主探针 | 我主导；zcode 可辅助整理接口/基线错误 | 当前 git 状态、真实 profile 和宿主读取权限 | 真实 Jobs、详情槽、取消/done 证据；不能用假对象代替 |
| 1 模块与记录契约 | 我先做并固定；zcode 可辅助编写契约测试 | 01/02 设计与已有源码的边界核对 | 六个模块方法、来源/版本/状态、preparedSnapshot、公共 DTO、内部服务签名 |
| 2 纯关键词解析 | zcode 独立负责 | 任务 1 中 Mention、别名表和语法边界固定 | Markdown 忽略区段、完整名、UTF-16 跨度，零副作用 |
| 3 注册表与配置 | zcode 独立负责 | 模块/stage/schema/设置契约固定；集成验收前任务 2 通过 | 候选表整体校验、旧表保留、默认关闭、发布 JSON 资源 |
| 4 身份/持久记录/日志 | zcode 编码，我审查锁与原子性 | 任务 1/3 完成；路径映射、记录 API、锁和事件规则固定 | 原子 task、版本冲突、序号、截断/脱敏、真实文件测试 |
| 5 来源与保存后触发 | 我负责核心接线；zcode 可补测试 | 任务 2–4 完成、withVerifiedCardSnapshot 契约和既有 store 回归 | 实际来源、dirty/generation、附注不重跑、保存不被登记失败回滚 |
| 6 接纳与预算 | zcode 在确定契约后编码，我审查并整合 | 任务 3–5 完成，统一请求入口/状态决策/计次/释放规则固定 | 等待原因、持久预算、有限重试；清理前不释放槽 |
| 7 Jobs/Agent 执行 | 我负责宿主适配；zcode 负责受控 context 子项 | 任务 0 的宿主探针、任务 6、Skill 和材料契约 | 真实 data/Agent 两支、私有工具闭包、scope、取消与 done |
| 8 结果与业务投递 | zcode 编码，我逐项审查并联调 | 任务 4–7 完成；提交锁、原始 guard 事实和成功点明确 | 旧输入/序号/token 拒绝、成功不回滚、pending/obsolete 幂等 |
| 9 取消/卸载/恢复 | 我负责整合；zcode 可承担定向回归测试 | 任务 6–8 完成、真实 cancel/cleanup 顺序已核 | 所有中间态、成功后补投递、旧 native 编号不误连接 |
| 10 HTTP 与工具 | zcode 写新分派/工具；我接旧鉴权与根装配 | 任务 8/9 的服务面和 DTO 固定 | GET 零接纳、POST 原认证、409、64KiB、31 日重扫 |
| 11 管理页与复盘提示 | zcode 写独立组件；我接已有页面/槽 | 任务 0 的槽结论、任务 2、任务 10 真实接口 | 等待到历史日志、迟到响应隔离、关闭页不取消 |
| 12 打包与真实验收 | 我负责最终验收；zcode 写集成/扩展测试 | 任务 0–11 均有证据 | 安装产物、真实管理页面、停止恢复、生产空表、全量门禁 |

“我审查”是确定的技术责任，不是每个步骤停止等待用户确认。开始开发后按范围推进，不重复请求显然下一步的许可。

## 3. 必须先做的四项准备

### 3.1 保存工作区边界与重核基线

当前工作区已有其他任务的 store/routes/client/service 和测试改动。先记录各文件现状与归属；下发任务只允许修改自己的文件，禁止 reset、整目录覆盖、撤销别人编辑或顺手重构。

上轮类型检查发现 10 处测试错误。开发开始时重新运行，核是否仍存在。可单独交 zcode 调查/修复，涉及：

- `test/routes-review/review-limit-box.test.ts`
- `test/routes-review/review-params.test.ts`
- `test/skill/assembly.test.ts`
- `test/skill/version.test.ts`
- `test/skill/zip-guard.test.ts`

这五个文件单独一个任务、单独归属；仅在当前检查仍证明错误且文件归属已记录后修改。禁止为让类型通过删除断言、改为 any、放宽 tsconfig 或修改生产 API。它可和宿主只读核验并行；不妨碍 parser 的定向测试，但最终全量验收必须明确解决情况。

### 3.2 我先固定本地契约

优先落实任务 1，不要求纯本地契约等待所有 Agent 探针成功。交给 zcode 前至少有以下明确内容：

| 契约 | 要固定的内容 | 阻塞哪些实现 |
| --- | --- | --- |
| Mention / parseMentions | recognized/unknown、raw/name/start/end、aliases 和完整名边界 | 2、前端提示 |
| ProcessorModule / registry | 六方法、stage/executor/schema、options 白名单、定义指纹 | 3、测试模块、后续任务 |
| 来源与输入 | SourceCardRef/Snapshot、实际 body、cardId/input/context 区分 | 4、5、8 |
| 记录与事件 | 全字段、expectedVersion、同组序号、event sequence、public DTO | 4、6、10、11 |
| 准备与提交 | ready/waiting、preparedSnapshot/moduleCommitFacts、内部提交凭据 | 7、8、9 |
| 内部调用面 | records 读/更新/组锁、registerRequest/wake/drain、结果提交、只读投影 | 5、6、8、10 |

接口固定应有真实 TypeScript 类型与契约测试，不只是一段口头说明。zcode 消费这些契约，不直接改 `types.ts`；发现缺字段由我集中修改并通知受影响任务。

### 3.3 我先核宿主执行和管理槽

任务 0 核 JobHooks、同步 run、root controller、unowned、kill/done，以及真实插件详情槽。Agent 还需 Skill 作用域、受控工具、create/setup/followup/idle/dispose 的实际证据。

这些结果阻塞任务 7 的执行接线和任务 11 的正式管理槽验收。它们不阻塞任务 2 的纯文本逻辑或任务 3 的 JSON 校验。Jobs 缺失时生产保持 waiting/capability，不允许 zcode另建后台运行器绕开宿主。

### 3.4 我先写清锁与成功规则

开发记录、接纳和结果前必须明确：卡片 → 配置 → 请求组 → 同层排序 task/业务记录；网络、start、Agent 和 dispose 在锁外；running 持久成功后才同步检查取消并激活执行；RESULT_COMMITTED 后不回滚结果；pending 恢复使用原冻结事实而非新版业务条件。

关键竞态用可控 Promise 和真实文件测试表达，尤其“正文已经保存但写事件尚未消费时旧结果到达”。zcode 负责把断言实现到通过，我复查锁、边界和持久事实是否一致。

## 4. 可直接转交 zcode 的实现包

所有包均需同时阅读主计划对应任务和 `docs/design/keyword-framework/01-framework-lifecycle-and-triggers.md`。涉及执行/页面者还需读第 02 份设计。下面列的是文件所有权，不能把目录作为整目录覆盖许可。

### 关键词解析包：任务 2

**开始条件：** 本地 Mention/aliases/parseMentions 契约固定。

**拥有文件：** `src/review/processors/parser.ts`、`test/processors/parser.test.ts`。

**交付内容：** 完整名字、前边界、32 码点上限、奇偶转义、围栏/行内代码/URL/邮箱/链接目标/图片引用/引用块忽略；每个跨度可从原 body 精确切回 raw；未知词原文保留。

**验证：** `pnpm exec vitest run test/processors/parser.test.ts`。

**不改：** types、store、配置、调度、前端和任何宿主接口。生产测试不登记 @预期。这个包是最适合首先下发的业务功能实现。

### 注册表与配置包：任务 3

**开始条件：** 模块/设置/指纹契约固定。纯 JSON 校验可与解析包并行；最终任务 3 的集成退出仍等待任务 2。

**拥有文件：** `src/review/processors/registry.ts`、`config/card-processors.json`、`src/config.ts`、`package.json`、`test/processors/registry.test.ts`、`test/config.test.ts`。`test/structure.test.ts` 由我统一接收此包新增断言。

**交付内容：** 空生产表、模块代码白名单、别名冲突/格式/限额整表拒绝与旧快照保留、默认关闭、有限执行配置、定义指纹、安装资源定位。模块设置不得越过全局总闸。

**验证：** `pnpm exec vitest run test/processors/registry.test.ts test/config.test.ts`；安装配置资源检查按主计划任务 3 执行。

**不改：** client/store/routes、其他技能、工具注册；不加依赖、不改变原配置语义。

### 持久任务与日志包：任务 4

**开始条件：** 任务 1/3 通过；映射/记录 API、锁和事件契约固定。

**拥有文件：** `src/review/processors/identity.ts`、`records.ts`、`trace.ts`、`src/paths/mapping.ts`、必要的 `src/paths/resolve.ts`、`test/paths.test.ts`、`test/processors/identity.test.ts`、`records.test.ts`、`trace.test.ts`。

**交付内容：** 安全来源身份，月桶任务与固定 settings 路径；原子记录、preparedSnapshot、recordVersion 和请求序号、私有凭据脱敏、有界时间线；状态/result/timeline 同文件。不新增第二持久日志根。

**验证：** `pnpm exec vitest run test/processors/identity.test.ts test/processors/records.test.ts test/processors/trace.test.ts test/paths.test.ts`。

**审查重点：** 真实文件、旧记录完整性、损坏/超限拒绝、同组并发和锁顺序。此包完成后其他包只调用 records，不并行修改它。

### 受控上下文包：任务 7 的 context 子项

**开始条件：** 材料/证据/准备快照类型固定；既有历史和角色口径已核，任务 3/4 可消费。

**拥有文件：** `src/review/processors/context.ts`、`test/processors/context.test.ts`。

**交付内容：** 精确卡片、角色和有界历史材料冻结，证据编号与内容一致，24000 字符限制、历史默认10/最多20，正文超限明确错误。复用现有读取能力，不做新全文搜索或市场请求。

**验证：** `pnpm exec vitest run test/processors/context.test.ts`。

**不改：** host-agent/host-jobs、共享缓存、模块定义或生产 Skill。可与真实 Jobs/Agent 接线的独立文件并行，正式任务 7 在整条执行链通过后才完成。

### 接纳与结果包：任务 6、8 分两次下发

这两个任务由同一 zcode 执行器顺序做，保留对状态机的连续理解；不能同时让两个执行器修改它们依赖的 records/trace/index。

**第一次开始条件：** 任务 3–5 完成，我已提供状态决策/预算和内部调用契约。拥有 `src/review/processors/scheduler.ts`、`test/processors/scheduler.test.ts`；index/records/trace 的接线变更由我合入。

**第一次交付：** 统一 registerRequest、同指纹复用/新逻辑请求序号、条件等待、保守启动计数、2 次重试、5 秒退避、满容量10秒重检、done 前不释放槽。验证 `pnpm exec vitest run test/processors/scheduler.test.ts`。

**第二次开始条件：** 任务 7 真实适配完成，来源短核验和业务 guard/私有凭据规则已固定。拥有 `src/review/processors/results.ts`、`test/processors/results.test.ts`。

**第二次交付：** 模块 payload 校验、框架固定信封、精确来源/定义/序号/token 核验、冻结业务事实 guard、原子成功、afterCommit 幂等和 pending/obsolete。验证 `pnpm exec vitest run test/processors/results.test.ts`。

**审查重点：** 所有旧结果拒绝案例，提交后取消，人工改业务条件后重启。不得把调度或结果审查变成仅看测试计数。任务 6/8 收回审查后，任务 9 再由我顺序接手必要的生命周期修改。

### 管理接口包：任务 10

**开始条件：** 任务 8/9 完成，processing 服务方法、HTTP DTO/错误码和版本字段固定。

**拥有文件：** `src/routes/review-processors.ts`、`src/tools/review-processors.ts`、`test/processors/api.test.ts`、`tools.test.ts`。

**交付内容：** 主计划全部首批接口与普通工具包装；GET 零接纳/零模型，POST 参数/版本/大小/范围校验，对外无私有凭据；测试使用真实本地 HTTP 和临时目录。

**验证：** `pnpm exec vitest run test/processors/api.test.ts test/processors/tools.test.ts`。

**不改：** `src/routes/review.ts`、`src/review/index.ts`、旧凭据或旧 /local 性能行为。我负责在真实鉴权外壳和根服务注册，并联合验证旧路由回归。

### 页面与提示包：任务 11

**开始条件：** 任务 0 的槽已核、parser 已完成，公共 DTO 固定。纯组件可在服务契约固定后预做；正式请求/操作与验收等待任务 10 真实接口。

**拥有文件：** `src/client/processors/KeywordRunsSection.ts`、`contracts.ts`、`api.ts`、`src/client/review/processor-view.ts`、`test/client/keyword-management-section.test.ts`、`test/routes-review/review-processors-page.test.ts`。

**交付内容：** 本插件详情区任务与事件、具体等待原因、截断/版本/投递提示、retry/cancel、迟到响应隔离、隐藏停轮询/关闭不取消；复盘提示纯识别，不改变保存/草稿/图片。

**验证：** `pnpm exec vitest run test/client/keyword-management-section.test.ts test/routes-review/review-processors-page.test.ts`。

**不改：** `src/client/index.ts`、`src/client/review/index.html.ts`。我把独立组件接入这两个已有脏文件并跑性能、图片和旧页面回归。任务 0 完成并转交客户端文件所有权后，我不再同时编辑它们。

## 5. 分批启动与并行边界

| 批次 | 我负责 | 可以给 zcode | 必须等待的事实 |
| --- | --- | --- | --- |
| 开始前 | 工作区归属、任务1本地契约、任务0宿主核验 | 基线类型错误独立调查，随后 parser/registry 纯校验 | 每个实现包先收到固定类型与文件边界 |
| 第一批 | 宿主探针、持久方案审查 | 解析与注册表；结束后持久记录包 | 记录包必须等任务1/3完成 |
| 第二批 | 任务5 store/来源/写触发 | 受控 context 可独立实施；任务5完成后接纳包 | 接纳实际接线等来源触发闭环 |
| 第三批 | 任务7真实执行适配 | 任务7完成后结果包 | 结果包先有真实尝试与提交绑定 |
| 第四批 | 任务9取消恢复、API/页面公共契约、旧文件接线 | 新 HTTP/工具；独立组件预做，随后接真实 API | 正式页面与操作验收等任务10 |
| 第五批 | 真实打包安装/管理页/停止恢复验收 | 集成与第二测试模块扩展测试 | 不能用跳过宿主测试替代正式出口 |

原主计划“任务2/3可并行”只指接口固定后的独立开发，任务3整体退出仍依赖任务2。原“任务5/6可分别推进”只允许记录 API 上的独立逻辑准备和测试；完整接纳接线必须等任务5。本分工采用这个明确边界，不能靠并行打破原任务依赖。

建议同一时刻最多两个 zcode 实现包加一个协调工作；每包交付后再接下一包，降低公共接口反复改动。这里给的是并行建议，没有启动额外执行器。

## 6. 共享文件归属与交付格式

我统一维护：`src/review/processors/types.ts`、`index.ts`、`reconcile.ts`、`host-jobs.ts`、`host-agent.ts`、`src/context-types.ts`、`src/review/store.ts`、`src/review/index.ts`、`src/routes/review.ts`、`src/client/index.ts`、`src/client/review/index.html.ts`、`test/structure.test.ts`、`test/fixtures/processors/text-module.ts`，以及本任务共享 planning 文件和设计/验收记录。

`records.ts/trace.ts` 在记录包期间由该包单独负责；scheduler/results 在对应包期间由同一编码执行器负责，后续生命周期修改由我顺序接手；客户端文件和 contracts.ts 在任务0探针结束、公共 DTO 固定后才转交页面包，页面包不得自行改变服务字段。所有转交需记录现状/差异，不允许双方同时写同一文件。

每个 zcode 包末尾必须返回：

1. 实际修改文件及 diff，新增行为与复用的现有能力。
2. 首先失败的契约断言及具体失败原因。
3. 实际执行的测试命令、通过/失败数及未运行原因。
4. 公共接口需求与未解决风险，不自行越界修改。
5. 旧功能回归结果；源码通过与宿主实际运行分开陈述。

共同约束：不是独自在仓库工作；不要撤销其他人的修改；按 AGENTS 写函数业务注释；无新依赖、无交易接口、无真实 vault 测试写入、无生产 @预期；测试零 mock/零 sleep。普通包不部署或提交整个工作区，最终部署/验收由我按原计划收口。

**推荐首轮安排：我做任务0和任务1的前置；任务1本地契约固定后，先给 zcode 任务2解析，再并行或随后给任务3注册表；任务4在前两项合格后启动。**
