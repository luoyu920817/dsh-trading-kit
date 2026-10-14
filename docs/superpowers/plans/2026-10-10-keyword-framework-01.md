# 01 框架与触发机制开发计划

> 2026-10-11：当前开发步骤以 [修订计划](2026-10-11-keyword-agent-framework-revised.md) 和 [最新全文提示词](keyword-framework-01-prompts/README.md) 为准。本文保留旧方案历史细节，不继续实施其强制六方法/公共stage/data-agent/业务观察协议。

> 设计调整（2026-10-10）：先读 [简单关键词入口与开放Agent工作流](../../design/keyword-framework/00-simple-agent-workflow-principles.md)。任务0/1已有产物；旧强制六方法等公共契约需改造，任务3–12和对应任务书需重排。本文暂作历史步骤参考；任务2纯解析规则仍可复用。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先交付能独立验收的关键词处理框架，让真实卡片保存、持久任务、原生后台执行、结果保护、取消恢复和 DSH 管理页日志形成闭环，再接入 `@预期`。

**Architecture:** 沿已有 `onReviewWrite` 订阅文档变化，后台重读 `parseDoc.cards`，由受控模块投影输入和定义版本，再登记持久任务。框架接纳条件与恢复记录由本插件负责，实际运行、日志输出和取消使用宿主 Jobs；业务结果与状态、阶段日志在同一 JSON 原子提交。管理页读取持久记录，原生输出流只作补充。

**Tech Stack:** 当前 TypeScript、Cordis、schemastery、React/createElement、Node 文件系统、Vitest、DSH Jobs/Agent/Skill；不新增依赖。

**状态：计划已编制，开发尚未开始。** 本文所有开发步骤默认未完成。下面的接口和测试片段是实施契约，不表示源码中已经存在这些接口，也不替代各文件的完整实现。

---

## 一、先明确这一波交付到哪里

本计划对应 [01 框架、生命周期与触发机制](../../design/keyword-framework/01-framework-lifecycle-and-triggers.md)。执行与日志接线遵守 [02 DSH 执行和管理页日志](../../design/keyword-framework/02-dsh-execution-and-management-logs.md)，实施范围是 [04 第一批框架交付](../../design/keyword-framework/04-file-plan-and-acceptance.md) 的展开。

这一波完成后应看到：测试装配中的真实卡片保存，异步生成任务；管理页显示为什么等待、哪次原生任务正在执行、结果是否保存以及是否已清理。关闭页面不会取消任务，关闭处理开关或取消会停止本插件对应执行；重启能读历史并恢复必要工作。

生产配置第一批为 `{"schemaVersion":1,"processors":[]}`。测试模块只在测试装配注册，不写入发布配置。`@预期` 的原句整理、观察编号、人工确认、交易日与行情证据、17:30 业务唤醒，全部属于下一份业务计划。框架保留后续请求和业务提交核验接口，本波用无行情测试模块证明这些接口，不提前实现预期规则。

| 本波纳入 | 本波不实施 |
| --- | --- |
| 解析、受控注册表、输入版本、保存后异步接纳 | 预期 schema、阈值解释与兑现/证伪判断 |
| 原子任务文件、接纳状态、尝试、结果和事件 | expectationId、观察窗口、proposal 与人工结论 |
| 原生 Jobs 的 data 和文本 Agent 两条执行路径 | 市场数据提供者和交易日推算 |
| 来源变化、预算、取消、清理、重启和投递恢复 | 无界扫描 vault 或 fs.watch 权威索引 |
| 管理页持久日志、必要 HTTP 操作、最小卡片提示 | 第二套通用队列、事件总线、日志服务或数据库 |

这里只完成 parser 或后台队列不能报告“01 已完成”。管理页正式扩展区、实际原生执行和停止，是 01 第 9 节的验收要求。

## 二、开发前的事实和边界

### 2.1 已存在的接口直接复用

| 当前文件/符号 | 复用方式 | 禁止误用 |
| --- | --- | --- |
| `src/review/write-events.ts`：onReviewWrite / notifyReviewWrite | 同步监听安全文档路径，放 dirty 集合并安排后台读取；ctx.effect 注销 | 直接注册 async listener；通知等同“新用户卡片”；另建事件总线 |
| `src/review/store.ts`：parseDoc | 消费落盘后的 cards/body/anchor，与 frontmatter、文件路径核对 | 把请求体、writtenAt、mtime 或附注当输入版本 |
| `src/review/ident.ts`：SecurityId / splitQualified / declaredMarketOf | 保留显式市场和旧裸代码口径 | 同码跨市场折叠；按裸代码追随改名文档 |
| `src/review/history.ts`：historySnapshot | 发现候选文档、受控读取历史 | 作为精确来源当前性的证明；取折叠后的 daily targets 代替全部文档 |
| `src/review/snapshot.ts`：Snapshot | 复用既有缓存与失效行为 | 重建通用缓存；用缓存允许旧结果提交 |
| `src/paths/resolve.ts`：resolveArea / resolveRelativeUnderRoot | 路径唯一映射，参数与词法边界校验 | 认为词法边界等于真实路径核验；让模型决定写路径 |
| `src/review/index.ts`：registerReview | 既有 review 建立后追加 processing 子键 | 再 provide traderKit 或整体覆盖已有 review |
| `src/routes/review.ts`：写凭据、Host/Origin、路由释放 | 新分派放在同一个认证外壳；只加必需路径 | 复制一套不同鉴权；改 local 缓存与 350ms 预算 |
| `src/client/index.ts`：slots、ctx.effect | 增加插件详情区，保持原面板装配 | 把后台任务发到主聊天；缺槽导致旧面板失败 |

`parseDoc` 已做部分 frontmatter/anchor 核验，但文件名与真实目录仍须补核。新增来源读取必须拒绝穿越、根外符号链接/目录链接、summary、processing 与非卡片文件；旧合法文档继续支持，不能通过“修来源”重命名旧数据。

### 2.2 最小整理计划

只整理以下接线，不借本功能重构整仓：

| 文件 | 必须修改的局部 | 保留的行为 |
| --- | --- | --- |
| `src/review/store.ts` | 增加 `withVerifiedCardSnapshot`，复用现有卡片写锁，短时间读真实文件并调用提交回调 | append/update/delete、锁键、EOL/BOM、重复请求和通知时机 |
| `src/review/index.ts` | service 建立后追加框架装配和 processing 服务键 | daily/loop 出口与唯一 traderKit 服务 |
| `src/routes/review.ts` | 新分派、exact 路径、POST 凭据白名单和释放 | 原路径鉴权、图片、local/enrich 和性能改动 |
| `src/client/index.ts` | 独立详情槽注册，复用 effect 释放 | sidebar/main 与现有主聊天按钮 |
| `src/paths/mapping.ts`、`resolve.ts` | 注册任务月桶根与固定设置文件，校验内部生成 ID 子路径 | reserved 区不开放；旧参数含义不变 |
| `src/config.ts`、`package.json` | 追加 processing 默认值与配置资源发布路径 | 旧配置正常解析；无新增依赖 |

### 2.3 执行约定

每个任务按“先写契约/旧行为回归 → 运行确认失败原因 → 最小实现 → 定向回归 → 文件差异审阅”推进。测试用真实临时文件、确定性时间参数、可控 Promise；不使用 mock Jobs/Agent 冒充宿主运行，不用 sleep 等待竞态。

新函数和实质改动函数按 AGENTS 写业务逻辑、关键判断、异常处理、参数与返回注释。提交只能包含当前步骤拥有的文件；用户要求提交时再逐个显式暂存，默认中文 Conventional Commit。本计划编制没有提交授权流程，也没有执行提交。

## 三、文件分工与步骤依赖

下表所有 `src/review/processors/`、`src/client/processors/` 文件均拟新增。现有文件以“修改”注明，不能把拟新增接口当当前能力。

| 文件 | 唯一职责 | 首次开发任务 |
| --- | --- | --- |
| processors/types.ts | 框架、模块、快照、请求、记录、结果与事件契约 | 1 |
| processors/parser.ts | 纯文本标记与忽略区段解析 | 2 |
| processors/registry.ts | 模块白名单、配置校验、不可变定义和参数指纹 | 3 |
| processors/identity.ts | 规范来源身份与输入/定义版本摘要 | 4 |
| processors/records.ts | 原子记录、版本冲突、请求序号、记录锁与文件边界 | 4 |
| processors/trace.ts | 有界脱敏事件，与状态同提交；原生日志投影 | 4 |
| processors/reconcile.ts | 精确读取、dirty 合并、来源比对、有界恢复发现 | 5 |
| processors/scheduler.ts | registerRequest、条件接纳、并发/预算、重试与恢复 | 6、9 |
| processors/host-jobs.ts | 原生 controller/start/log/cancel/done 与自有 ID | 0、7 |
| processors/host-agent.ts | 独立 Agent scope、Skill 核验、工具闭包与清理 | 7 |
| processors/context.ts | 受控材料冻结、编号和上下文限额 | 7 |
| processors/results.ts | 结构/证据/版本/凭据/业务 guard，成功与投递 | 8 |
| processors/index.ts | 组合前述模块，effect、开关、服务消失与停止 | 5、9 |
| `src/routes/review-processors.ts` | processing HTTP 参数/DTO 分派；无第二鉴权 | 10 |
| `src/tools/review-processors.ts` | 共享服务的 list/results/rescan 工具包装 | 10 |
| `src/client/processors/contracts.ts` | 管理区 subject、slot 和对外 DTO 类型 | 0、11 |
| `src/client/processors/api.ts` | 同源请求、取消旧请求和页序号 | 11 |
| `src/client/processors/KeywordRunsSection.ts` | 本插件任务、事件、结果、等待和操作 | 0、11 |
| `src/client/review/processor-view.ts` | 复盘页纯本地标记提示与状态投影 | 11 |
| `config/card-processors.json` | 第一批空生产表 | 3 |

完整路径中的 processors 文件均位于 `src/review/processors/`，测试位于 `test/processors/`。各任务下再给出准确路径。

执行顺序：**0 能力探针 → 1 契约 → 2 解析 → 3 注册表 → 4 记录 → 5 保存触发 → 6 接纳 → 7 宿主执行 → 8 结果提交 → 9 取消恢复 → 10 HTTP → 11 页面 → 12 全链路验收**。任务 3 整体退出依赖任务 2，任务 6 实际接线依赖任务 5。接口稳定后仅可并行独立子项，例如注册表纯校验或接纳纯决策；不能提前标整个任务完成。根装配、store 和共享契约文件指定单一负责人，具体见 [任务分配与前置条件](2026-10-10-keyword-framework-01-task-allocation.md)。

每个任务都是 review 单位，内部复选步骤是具体操作。跨任务不能跳过“先定义输入输出，再接线”的依赖。下面的完成条件须记录实证，不能只勾选编码。

## 四、按任务执行

### 任务 0：重新建立基线，验证管理页与原生执行能力

**依赖：** 无。先验证最关键的宿主接线，避免做完框架才发现日志无处显示。

**文件：** 新增 `docs/spikes/keyword-management-jobs.md`、`src/review/processors/host-jobs.ts`、`src/client/processors/contracts.ts`、`src/client/processors/KeywordRunsSection.ts`；最小修改 `src/context-types.ts` 和 `src/client/index.ts`；新增 `test/processors/host-jobs-contract.test.ts`、`test/client/keyword-management-section.test.ts`。

- [ ] 记录 `git status --short`，列出已有文件变更；运行现有类型、构建、测试和合规门禁。探针记录写清源码/安装包/profile/实际宿主版本，不把昨日通过数当今天基线。
- [ ] 读取实际安装的 JobSpec/JobHooks、Agent/Skill 和 `plugins.detail.section` 声明。确认 `run` 可能在 `start` 返回前同步调用；确认 job 省略 owner 以及 root `attachController('traderKit:keywords')`。
- [ ] 先写组件只显示 `subject` 对应本插件、其他插件返回 null 的断言。真实槽使用 `name:'plugins.detail.section'`，组件直接接收 `{subject}`，不是猜测的 owner props。
- [ ] 增加固定无行情文本的 Jobs 探针，经真实 root controller 创建 unowned job，append 到 log、updateProgress；不接卡片写事件、不注册生产关键词。探针只经测试入口显式运行，不加插件启动默认行为。
- [ ] 在真实 DSH 插件详情页验证执行、日志、取消、清理，确认没有给主聊天发送 followup；记录成功和缺能力的实际结果。
- [ ] 审阅新宿主结构类型只使用公开字段，jobs/agents/skills/llm 等保持可选能力，不增加整插件必需依赖。

宿主接线契约片段：

```ts
interface KeywordJobHooks {
  cancel(reason?: string): void;
  done: Promise<{ status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string }>;
}
// register 必须拿到 root Context 的 jobs；owner 故意省略。
// run 以入参 job.id 建立关联，不依赖外层 start 的返回值已赋值。
```

**验证命令：** `pnpm exec vitest run test/client/keyword-management-section.test.ts`。真实 Jobs 探针在对应 profile 单独执行并记录，不用单元测试跳过结果当实机通过。

**出口：** 日志真实出现在正式管理详情区；cancel/done 和 owner 行为有证据。若 Jobs 或槽缺失，执行/正式页面验收登记阻断，任务 1–5 可继续；不得报告整波完成。

### 任务 1：固定模块接口、任务字段和状态约束

**依赖：** 0 的宿主接口结论；纯契约编写不依赖宿主能力可用。

**文件：** 新增 `src/review/processors/types.ts`、`test/processors/types.test.ts`、`test/fixtures/processors/text-module.ts`。测试文字模块只在测试装配导入，不由生产 index 导入。

- [ ] 在 types 定义 01 第 3 节的 ProcessorModule 全部六个方法及 FollowupRequest；为 prepare 用可区分的 ready/waiting 结果，不能用 null 猜准备失败。
- [ ] 定义 taskId/cardId/requestKey/序号、source/module/context/definition 版本、执行和适用状态、attempts、resultDelivery、timeline；公共 DTO 单独定义，完全排除 preparationToken/activeAttemptToken。
- [ ] 定义可序列化 `preparedSnapshot`：冻结执行配置、上下文和证据实际内容、模块版本，以及模块提供的 `moduleCommitFacts`（业务记录版本、接受条件/窗口等不透明 JSON）。PreparedExecution 的可持久部分不能含函数/signal/宿主句柄；`commitGuard(prepared)` 由模块代码根据这些冻结事实构造 verify，重启可重建而不重新 prepare 最新业务事实。
- [ ] 先写状态不变量断言：running 必须有当前 attempt；succeeded 必须有结果；waiting 必须有具体 reason；非对应状态清掉 waitingReason；公开记录无私有凭据。
- [ ] 测试模块投影整卡文字，准备固定材料，validateResult 只允许 `{summary:string}`，不含行情结论；提供空或测试业务记录的 commitGuard、幂等 afterCommit 和 reconcileSource。
- [ ] 完成类型检查及契约测试，review 六个方法没有预期字段、路径能力或模型自由选择 stage 的入口。

约束类型片段（其他字段按 01 第 8 节表逐一落地）：

```ts
type ExecutionState = 'queued' | 'waiting' | 'preparing' | 'running'
  | 'retryWaiting' | 'succeeded' | 'failed' | 'canceled';
type Applicability = 'current' | 'sourceChanged' | 'sourceRemoved'
  | 'sourceUnverified' | 'configurationChanged';
type ResultDelivery = 'none' | 'pending' | 'complete' | 'obsolete';
type WaitingReason = 'moduleDisabled' | 'sourceNeedsReview' | 'capability'
  | 'budget' | 'hostCapacity' | 'targetDate' | 'marketData' | 'storage';
interface ModuleCommitGuard {
  recordKeys: readonly string[];
  verify(): Promise<void>;
}
```

**验证：** `pnpm exec vitest run test/processors/types.test.ts`；`pnpm typecheck`。若全量仍有已记录基线错误，须逐条比较，无新增错误才能继续，最终全绿仍单列为未达项。

**出口：** 后续文件可依赖一个确定类型契约，测试模块不会出现在生产注册表/产物业务装配中。

### 任务 2：实现纯关键词解析，锁定每一种触发与忽略规则

**依赖：** 1。

**文件：** 新增 `src/review/processors/parser.ts`、`test/processors/parser.test.ts`。

确定接口 `parseMentions(body, aliases)`，aliases 为只读 `Map<关键词名字, processorId>`；返回 recognized 与 unknown 两组 Mention，每项含 raw/name/start/end，已注册项另含 processorId。偏移是保存后正文 UTF-16 偏移，解析器不登记任务、不读文件、不发 HTTP。

- [ ] 写表驱动回归：ASCII @、全文精确名字、中文/emoji、连续标记、未知完整名、前边界、奇偶反斜线、重复模块。
- [ ] 写围栏与行内代码、quote 块、邮箱/URL、Markdown 链接目标、`![[files/...]]` 和普通图片目标的忽略用例；围栏采用围栏字符及长度配对，不用一个大正则跨全文猜测。
- [ ] 运行测试，确认缺 parser 的失败；实现先识别不可触发区段，再在其余区段读 1–32 Unicode 码点的完整名字，并核前边界和逃逸。
- [ ] 保存 start/end 时使用原正文索引，禁止先 normalize 再把偏移用回原文；去重留给模块输入/请求层，不丢原文多个跨度。
- [ ] 回归全部案例，补所有 Mention 的 `body.slice(start,end) === raw` 断言和未知词原文保留断言。

先锁定的测试片段：

```ts
import { expect, test } from 'vitest';
import { parseMentions } from '../../src/review/processors/parser.ts';

test('完整名字和原文偏移，未知名字不误命中前缀', () => {
  const body = '😀 @预期 明天观察；@预期差 保留原文';
  const aliases = new Map([['预期', 'expectation']]);
  const parsed = parseMentions(body, aliases);
  expect(parsed.recognized.map(x => x.name)).toEqual(['预期']);
  expect(parsed.unknown.map(x => x.name)).toEqual(['预期差']);
  for (const mention of [...parsed.recognized, ...parsed.unknown]) {
    expect(body.slice(mention.start, mention.end)).toBe(mention.raw);
  }
});
```

这里测试使用“预期”只是 parser 输入，不代表生产模块已登记。允许前边界明确为正文开头、空白、成对括号和中英文标点；紧邻字母/数字/名字字符的 @ 不触发。名字字符与边界表作为导出只读常量纳入表驱动测试，后续前端同语法复用。

**验证：** `pnpm exec vitest run test/processors/parser.test.ts`。

**出口：** 完整匹配和原文位置有实证；包含未知词的旧卡片仍可保存；未保存识别永远零任务。

### 任务 3：受控注册表、配置和安装资源

**依赖：** 1、2。

**文件：** 新增 `src/review/processors/registry.ts`、`config/card-processors.json`、`test/processors/registry.test.ts`；修改 `src/config.ts`、`package.json`；补 `test/config.test.ts`、`test/structure.test.ts`。

- [ ] 先写真实 JSON 读取测试：空表可用，超过 256KiB/32 模块/8 别名、别名重复、未知 moduleId、非法 initialStage、schema/skill/stage 不匹配均整表拒绝。
- [ ] 定义代码模块表，与 JSON 的 moduleId 显式匹配；配置不加载 JS、不接收任意 prompt、命令或写路径。初次读取坏表用安全空表并告警，运行时坏候选保留旧有效快照。
- [ ] 添加全局默认关闭及执行配置：并发 1、尝试 2、单次 120 秒、Agent 日启动 30、输出 4096 tokens、上下文 24000 字符、历史默认 10/硬上限 20、恢复 7 自然日；provider/model/cwd 必须显式，不从主聊天隐式借用。
- [ ] 模块 enabled 和 editableOptions 持久覆盖使用 settingsRevision；全局宿主 config 是总闸，不能被模块或持久设置越过。设置只改已声明字段；无生产模块时不伪造可启用业务。
- [ ] 总开关由 DSH 本插件配置修改，管理区读取并提示如何打开；POST /settings 只改模块白名单，不暗中改宿主全局配置。修改总开关引起重挂载时，按恢复规则处理并显示最近 7 日补处理说明。
- [ ] `definitionRevision` 包含执行器/stage/schema、有效参数、模块版本、Skill 候选与实际正文摘要；label/中文说明变化不重跑，改变参数或实际 Skill 必须形成新定义。
- [ ] package files 增加 `config/card-processors.json`，以安装包根定位资源，不能依赖 process.cwd 或源码绝对路径。第一批不发布 probe Skill 到 vault，也不注册预期 Skill。

配置片段：

```json
{"schemaVersion":1,"processors":[]}
```

**验证：** `pnpm exec vitest run test/processors/registry.test.ts test/config.test.ts test/structure.test.ts`；`pnpm pack --pack-destination .planning/2026-10-10-keyword-framework-01/artifacts`，检查 tar 文件清单及 JSON 内容。pack 是后续实现阶段命令，本轮未运行；产物目录不提交。

**出口：** 旧 profile 配置仍能解析；全局默认零执行；安装资源真实可读；无测试关键词生产入口。

### 任务 4：身份、原子任务、设置和持久阶段日志

**依赖：** 1、3。

**文件：** 新增 `src/review/processors/identity.ts`、`records.ts`、`trace.ts`、`test/processors/identity.test.ts`、`records.test.ts`、`trace.test.ts`；修改 `src/paths/mapping.ts`、必要的 `src/paths/resolve.ts` 参数/映射处理，补 `test/paths.test.ts`。

- [ ] 先用真实不同市场/路径卡片测试 cardId；同 anchor 在不同实际文档不同 ID。inputRevision 按模块实际输入生成，sourceRevision 按真实整卡，contextRevision 独立。
- [ ] mapping 固定 processorRecords 为 `dir:'DB/review/<YYYYMM>/processing', params:['date']`；processorSettings 为 `dir:'DB/review/processing', template:'settings.json', params:[]`，两者 status=active。settings.json 是文件模板，不能配置成 dir。内部 records 校验 SHA-256 ID、安全模块记录键，组成 `<cardId>/tasks/<taskId>.json`；不向通用 resolve 暴露模型传入的任意层级路径。
- [ ] 先写真实文件原子更新/冲突测试；records 提供读取、首次登记、expected recordVersion 更新、同组 requestSequence 分配及多记录锁。目录读取不完整时拒绝新序号，不依据 mtime 选赢家。
- [ ] 同目录临时文件写完 rename；状态、result、timeline 在同一 task JSON，单次成功只增加一个 recordVersion。settings 同样版本化原子保存，未知 schema 只告警不覆盖。
- [ ] running 激活前持久 preparedSnapshot 和冻结上下文/证据；恢复不能只有摘要而缺实际校验材料。moduleCommitFacts 仅由模块代码生成，模型和 HTTP 不能覆盖，公共任务概要不展开内部核验事实；超限整体拒绝，不丢原始 guard 条件。
- [ ] trace 统一事件入口：先同事务写事件和状态，再尽力投影原生 append/progress。日志投影失败留告警，不回滚持久成功或导致递归写日志。
- [ ] 任务文件最大 2MiB；时间线保留最初 20 和最新 980 条，序号持续递增，写 omittedEventCount/firstRetainedSequence。task/body 超限明确拒绝，不能静默截原句。
- [ ] 公共 task/events 投影删除 token、密钥、绝对路径和完整 prompt；持久内部正文只供受鉴权的结果读取，不复制到原生 label/detail/result。

身份算法固定为对 JSON 数组 UTF-8 字节做 SHA-256，避免分隔符歧义：

```ts
import { createHash } from 'node:crypto';
const digestParts = (parts: readonly unknown[]): string =>
  createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex');
// cardId = digestParts([normalizedRelativeDocumentPath, anchor]);
// taskId = digestParts([requestKey, inputRevision, definitionRevision,
//                       requestSequence, evidenceRevision]);
```

实施时 digestParts 命名函数按注释规范落地，并在 types/identity 声明输入；规范路径保留实际文件拼写，仅统一分隔符，不能猜市场、改名或任意小写后混同文档。

**验证：** `pnpm exec vitest run test/processors/identity.test.ts test/processors/records.test.ts test/processors/trace.test.ts test/paths.test.ts`。

**出口：** 真文件覆盖不存在/坏 JSON/超限/版本冲突；并行登记同组不产生重复序号；任务成功与日志不存在半提交。

### 任务 5：真实来源读取、保存后异步触发和去重

**依赖：** 2–4。

**文件：** 新增 `src/review/processors/reconcile.ts`、`index.ts`、`test/processors/source.test.ts`、`reconcile.test.ts`、`registration.test.ts`；修改 `src/review/store.ts`、`src/review/index.ts`；补 `test/review/store-concurrent.test.ts`、`test/review/write-events.test.ts`、`test/structure.test.ts`。

- [ ] 先锁旧行为：成功 append/update/delete 的通知、重复/失败零通知，EOL/BOM 和原请求幂等；框架异步登记失败不改变 Markdown created 的返回结果。
- [ ] 实现精确来源读：安全相对月桶卡片路径 → realpath 根内检查 → parseDoc → 文件名/市场/代码/日期/frontmatter/anchor 对齐 → Saved body。非法来源明确 sourceNeedsReview/sourceUnverified，保留告警。
- [ ] 同步 listener 只做路径校验、dirty 标记和 generation 加一，启动后台 Promise 并显式 catch；每文档 single-flight，读取期间再次写则丢弃旧 generation 决策并再读。
- [ ] 仅遍历 cards，按 cardId 与已登记输入版本比较。AI 附注变化和同输入重复保存复用任务；新输入使旧任务失效并登记新组序号。多标记同模块一张卡只登记一次初始任务。
- [ ] 删卡/删标记只有在该文档完整读取且有明确缺失证据时生效；目录部分失败不宣判删除。外部改名是旧来源消失与新来源出现，不按同码追随。
- [ ] 新增 `withVerifiedCardSnapshot(dataRoot, sourceRef, commit)`：复用当前 store 卡片锁，精确核相对路径/anchor/正文，commit 只能短核配置/组/task 并写本地记录，不 await 网络、start、Agent 或 dispose；回调不能再调用获取同卡片锁的写接口。
- [ ] 装配追加 `api.review.processing`；监听器、合并器、唤醒器用 effect 释放。source/history/snapshot 不另建事件或缓存，也不让 processing JSON 反向触发自身。

新增短核验接口的输入固定为保存过的来源标识，而非任意路径：

```ts
interface SourceCardRef {
  relativeDocumentPath: string;
  anchor: string;
  market: 'sh' | 'sz' | 'bj' | null;
  code: string;
  tradeDate: string;
}
// withVerifiedCardSnapshot<T>(dataRoot, sourceRef,
//   commit: (actual: SourceCardSnapshot) => Promise<T>): Promise<T>
// actual 必须来自锁内真实读取，模块输入在此重新投影。
```

竞态测试用两道可控 Promise：旧读取开始后暂不返回；真实 updateCard 保存新版；放行旧读取；排空后台合并器。断言只将新正文登记为 current，旧扫描没有发布任务。测试等待明确的 drain 方法，不靠 setTimeout 或 sleep。

**验证：** `pnpm exec vitest run test/processors/source.test.ts test/processors/reconcile.test.ts test/processors/registration.test.ts test/review/store-concurrent.test.ts test/review/write-events.test.ts test/review/store-market.test.ts test/review/store-bytes.test.ts`。

**出口：** 保存链只新增很短的同步路径标记；精确 body 与市场身份成立；登记失败可观察/可重扫，保存不回滚。不能给最佳努力事件宣称严格一次触发。

### 任务 6：统一登记与接纳，明确何时消耗一次尝试

**依赖：** 3–5。

**文件：** 新增 `src/review/processors/scheduler.ts`、`test/processors/scheduler.test.ts`；补 `records.ts`、`trace.ts` 和 `index.ts` 的组合。

确定服务接口：`registerRequest(request)` 返回 taskId 与 registered/reused；`wake(reason)` 安排一轮接纳；`drain()` 仅供测试/停止等待已安排工作排空。初始请求由 reconciliation 生成，FollowupRequest 由模块代码生成；新输入、新定义、新证据或显式 retry 形成新的逻辑请求时，在同组锁内增加 requestSequence。同指纹重复登记复用任务，执行重试保持原 taskId 和序号。

- [ ] 先写纯接纳决策测试，输入 now、记录、当前配置和能力快照；断言缺能力/额度/时间返回明确 waitingReason，重复轮询不追加相同等待事件。
- [ ] 按卡片 → 配置 → 请求组 → task/业务同层排序取得短锁，核最新 input/definition/sequence，领取本地槽并生成 preparationToken，持久 preparing 后释放锁。
- [ ] 网络/宿主调用在锁外。缺 Jobs/controller 为 waiting/capability；已识别满容量为 waiting/hostCapacity，最早 10 秒后复查；其他 start 异常用具体错误，不统称“容量满”。
- [ ] 等待/准备不计实际尝试；准备成功后 running 原子写 attemptId、私有 token、startedAt 和保守启动计数，再激活执行。Agent 每日最多 30 次，从持久 attempts 按东八区启动日重建，不能重启清零。
- [ ] data 不要求 provider/model/Skill/Agent，不占 Agent 日预算；仍受全局开关、模块开关、来源、并发、准备和结果保护。
- [ ] 可恢复网络失败最多 2 次实际尝试，初始退避 5 秒；schema 错误、未知证据、无结果提交直接 failed，不自动反复试模型。预算跨日的唤醒按实际启动日计数。
- [ ] preparing/running 以及清理中的执行占同一个本地槽；任务已 succeeded 但 done 未结算时不释放槽，不得启动同请求另一实例。

状态决策测试用例必须至少包括：

| 输入情形 | 预期持久结果 | 尝试计数 |
| --- | --- | --- |
| 全局或模块关闭 | waiting/moduleDisabled | 0 |
| 来源暂不可核 | waiting/sourceNeedsReview + sourceUnverified | 0 |
| Jobs/controller 不存在 | waiting/capability | 0 |
| 原生容量拒绝 | waiting/hostCapacity + 下一复查时刻 | 0 |
| 同一天 Agent 启动已达 30 | waiting/budget | 不增加 |
| 创建 Agent 失败、Skill 无法核验 | 明确准备失败/等待；不 running | 0 |
| running 已写后取消到达，尚未 followup | canceled，仍保留这次保守启动计数 | 1 |
| 无合法 submit 就 idle | failed/RESULT_NOT_SUBMITTED | 1 |
| 已提交结果、清理尚未完成 | succeeded，占槽，投递状态独立 | 1 |

**验证：** `pnpm exec vitest run test/processors/scheduler.test.ts test/processors/records.test.ts test/processors/reconcile.test.ts`。

**出口：** 所有入口走同一 registerRequest；缺能力不偷偷使用不可观察的后台执行；预算可重建，等待不忙循环。

### 任务 7：接通真实 Jobs、data 和独立文本 Agent

**依赖：** 0、6；准备材料依赖 3 的定义和 Skill 指纹。

**文件：** 完善 `src/review/processors/host-jobs.ts`；新增 `host-agent.ts`、`context.ts`、`test/processors/host-agent-contract.test.ts`、`context.test.ts`、`test/fixtures/processors/probe-skill/SKILL.md`；局部补 `src/context-types.ts` 和探针记录。

- [ ] 先增加真实宿主契约案例：start 同步进入 run；native 关联尚未持久成功时不执行；controller 消失/满容量/普通错误分别记录；done 资源清理之后结算。
- [ ] 挂载生成新的 runtimeInstanceId，在 run 中使用 job.id 和内存自有集合建立关联；start 外层返回不作为允许处理的条件。关联持久化失败立刻停止探针并清理，不计 Agent 尝试。
- [ ] agent 分支：候选 Skill/provider/model/cwd 预检 → 创建独立 scope → setup 取得实际作用域 Skill 正文与摘要 → 对比定义；不符则登记配置变化并重新接纳定义，不悄悄替换旧任务。
- [ ] 冻结输入/角色/历史和证据编号，只使用受控读取面；历史是用户观点，不是市场事实。上下文最多 24000 字符，正文超限明确拒绝；历史 10/20 张规则确定，角色只取既有 Agent 口径。
- [ ] Agent 只开放 `review_processor_context` 与 `review_processor_submit`；submit 工具闭包绑定 task/attempt/token/版本，模型只给 payload 和证据引用；不开放 shell、任意读写、主聊天发送和卡片修改。
- [ ] 运行记录写盘完成后，同步检查 abort → 激活工具闭包 → 发 followup，中间不再 await；期间收到取消就不启动。create 尚未返回时取消，返回后立即 dispose，不发 followup。
- [ ] submit 成功 concludeTurn，再等 idle/dispose 和其他监听资源释放；没有合法提交就 idle 为失败。done 在清理后结算，不按 native completed 自动认定业务成功。
- [ ] data 分支在同一个 native run 经受控函数执行：不 create Agent、不加载 Skill、不 followup；同样写 running/凭据、检查 abort，结果交统一 results，清理后 done。

探针 Skill 固定只整理测试文字，声明输出 `{summary:string}`，禁止行情判断和访问 vault。它通过测试 profile 的受控测试装配登记，不能被生产空 registry 自动发现执行；只读类型/源码核验不能替代真实 followup、submit 与取消证据。

**验证：** `pnpm exec vitest run test/processors/context.test.ts`，并在已核 profile 分别运行 data 探针与 Agent 文本探针。两个宿主 contract 测试需要真实宿主入口；不可用时记录未运行，不把 skipped 当 passed。

**出口：** 两种执行器有原生 job 与持久尝试关联；主会话无侵入；实际 Skill scope 与限制工具有证据；缺 Agent 不影响可用 data 分支。

### 任务 8：结构化结果、旧结果拒绝和业务投递

**依赖：** 4–7。

**文件：** 新增 `src/review/processors/results.ts`、`test/processors/results.test.ts`；完善测试模块的业务记录/guard/afterCommit；补 records/trace。

统一提交入口 `submitResult(boundAttempt, payload, evidenceRefs)`，boundAttempt 由内部闭包构造，HTTP/普通工具不能构造。按下列顺序实施，不把 payload 里的 task/path/版本当权威：

- [ ] 先写结构/证据测试：schema 不匹配、未知 evidence 编号、试图新增受控字段均不成为成功结果。模型 payload 不要求声明；模块 validate 后由框架生成 schema/版本/generatedAt 与既有固定声明的结果信封，再校验最终信封。缺失/篡改声明的最终记录不得写入，模型不能覆盖信封字段。
- [ ] 准备模块 commitGuard 的已登记 recordKeys，框架将 task 和业务锁合并排序；在 `withVerifiedCardSnapshot` 内重投影 actual，核 input、definition、最新请求序号、attemptId、私有 token、模块和全局开关。
- [ ] guard.verify 在框架已持有业务锁时短读核验，不再次加锁、不取网络；已关闭测试业务键、换条件/窗口、暂停拒绝迟到结果。初始没有业务记录时空 guard 正常通过。
- [ ] 同一 task 文件原子写 result、succeeded、RESULT_COMMITTED、resultDelivery=pending；业务成功点即这次 rename。native 日志稍后失败只留清理/投影告警。
- [ ] 锁外调用幂等 afterCommit；已完成写 complete，临时不可用保持 pending，业务已永久不适用写 obsolete 和原因。投递失败不能回滚 succeeded，也不能再次运行模型。
- [ ] pending 恢复使用原 task 的 preparedSnapshot 重建业务核验，不能重新 prepare 最新 recordVersion/条件后给旧结果放行。模块幂等键为 taskId：如果发现本任务已完成登记，返回 complete；若人工改变业务条件/关闭等导致原冻结条件不再适用，返回 obsolete。区分“本任务部分写盘的正常版本变化”与“他人改变条件”，防止正常幂等恢复被误拒绝。
- [ ] 后处理提出 FollowupRequest 时走 scheduler.registerRequest；processor/stage/path 由模块代码和登记表核验。opaqueBusinessKey 只作受控记录键，不在 scheduler 解释预期规则。
- [ ] 模块投影没变但整卡 sourceRevision 改变，只允许在同一次实际来源短核验中刷新关联；缓存不能放行。提交前后核来源应对外部写者，发现外部改变标过期，并明确单 profile 文件锁不等于跨进程事务。

必须逐一构造的真实文件竞态：

| 竞态输入 | 断言 |
| --- | --- |
| updateCard 已保存，onReviewWrite 后台尚未处理，旧 submit 到达 | 拒绝旧输入；不能只核任务记录里的旧 hash |
| 同 task 新 attempt 已开始，旧 attemptId/token 提交 | 拒绝；公开 attemptId 本身不能授予写权限 |
| 显式 retry 新 requestSequence 已建立 | 旧序号结果不能成为当前结果 |
| 参数/Skill 定义变化 | 旧定义不能提交当前结果 |
| 业务记录版本或可用状态变化 | guard 拒绝；不覆盖业务记录 |
| result rename 完成后收到 cancel | 保留 succeeded/pending；只停止清理/投递 |
| 业务登记已落盘，但投递完成标记写失败 | 恢复后幂等识别已登记，零第二次模型执行 |
| 成功/pending 后人工改变测试业务条件，再重启 | 从原冻结事实核验，拒绝旧投递/obsolete；不能读取新版版本给旧结果授权 |
| 业务记录明确永久关闭 | obsolete 留原因，后续唤醒不无限重复 |

**验证：** `pnpm exec vitest run test/processors/results.test.ts test/processors/records.test.ts test/review/store-concurrent.test.ts`。

**出口：** 合法结果、业务成功、后处理完成三个事实分别可查；任何旧凭据/旧输入不能回写；afterCommit 的两文件关系不冒充事务。

### 任务 9：取消、卸载、恢复和通用后续请求

**依赖：** 6–8。

**文件：** 完善 `src/review/processors/index.ts`、`scheduler.ts`、`reconcile.ts`、`host-jobs.ts`；新增 `test/processors/recovery.test.ts`、`lifecycle.test.ts`、`followup.test.ts`。

- [ ] 分别测试 queued/waiting/preparing/running 与 succeeded/pending 的关闭处理；未提交运行转 canceled，已成功不回滚。待开关恢复时重新核来源和版本，不能直接恢复旧 Agent 会话。
- [ ] native cancel 同步幂等：abort 标记、闭包失活、协作取消；实际 kill 用 registry.kill，不用不存在的 jobHandle.kill。超时默认 120 秒，测试通过显式 deadline/确定性时间触发，不真实 sleep 120 秒。
- [ ] 卸载停止新接纳和唤醒 → 持久暂停/中断记录 → 只 kill 当前 runtimeInstanceId 且内存集合中的自有 job → 等待 done/Agent 清理 → 注销 controller、监听与定时器；不触碰主聊天。
- [ ] 启动发现最近 7 自然日卡片，同时读取所有已登记非终态任务、模块未结束业务键和 succeeded/pending，不受 7 日限制。恢复先核已保存结果，尝试耗尽不再执行。
- [ ] 加载 preparedSnapshot 时核格式、模块版本与证据内容；缺必要冻结事实的旧记录进入 sourceNeedsReview/明确投递告警，不能重新 prepare 为旧结果“补造”核验条件。
- [ ] 全局默认关闭不自动花费；启用界面明确提示最近 7 日补处理。显式更早重扫最多 31 自然日并分页，每页发现/复用/错误均记录；不完整页不能据此撤回来源。
- [ ] 使用测试模块真实业务 JSON 验证 afterCommit 幂等、commitGuard 和后续请求：最早执行时间及 evidenceRevision 去重，数据未齐时留模块观察，齐备后才提出请求。
- [ ] 构造宿主重启后同名 nativeJobId，历史只能展示；旧实例观察/取消无效，必须不会误 kill 当前其他任务。

恢复决策必须覆盖：

| 重启前记录 | 新实例动作 |
| --- | --- |
| queued/waiting | 核当前条件再接纳 |
| preparing、没有 started attempt | 作中断准备恢复；不消耗一次模型尝试 |
| running、没有持久结果 | 结束旧尝试关联，按剩余尝试/退避接纳新尝试；不恢复旧 session |
| succeeded/pending | 只核业务投递；零模型调用 |
| failed 且 schema 错误、次数耗尽 | 保留终态，等待显式新请求 |
| 来源读不完整 | sourceUnverified，等待修复，不宣判删除 |
| 明确删卡/删标记 | 失效对应输入并通知模块撤回测试业务 |

重启后无结果的旧 Agent 是否已经在 provider 执行无法由本地证明。恢复是有预算的至少一次尝试，结果提交和业务登记幂等；不要宣称 provider 严格只调用一次。

**验证：** `pnpm exec vitest run test/processors/recovery.test.ts test/processors/lifecycle.test.ts test/processors/followup.test.ts test/processors/scheduler.test.ts`，再做真实准备期取消和卸载探针。

**出口：** 保存、开关、能力恢复、定时接纳唤醒、重扫、重试统一入口；不包含 17:30 或交易日业务逻辑；卸载后的写事件和旧结果不能继续派发。

### 任务 10：管理接口、原鉴权和零副作用读取

**依赖：** 8、9。

**文件：** 新增 `src/routes/review-processors.ts`、`src/tools/review-processors.ts`、`test/processors/api.test.ts`、`tools.test.ts`；最小修改 `src/routes/review.ts`、`src/review/index.ts`；补 `test/routes-review/review-registration.test.ts`、`review-handler.test.ts`。

- [ ] 先起真实本地 HTTP 测试服务器与临时记录目录，验证旧鉴权，测试未授权写、错误 Host/Origin、超过 64KiB、非法游标/ID 与版本冲突。
- [ ] `review-processors.ts` 只做校验/DTO 分派，主 review 路由保持唯一凭据和响应外壳；新增 exact 路径及 writeCredentialValid 的 POST 白名单，保留旧 /local 分段缓存和预算。
- [ ] 实现下表全部首批接口。GET 只读持久/内存健康投影，发现来源待协调返回 reconciliationNeeded，不能隐式重读市场、登记、唤醒或调用模型。
- [ ] retry 核 expectedInputRevision/recordVersion，创建新的序号和 taskId；cancel 核当前任务版本和自有运行关联。历史 native 编号不直接交给浏览器 kill。
- [ ] settings 只持久模块允许项；reload 坏候选保留旧表；rescan 范围不超过 31 日并有 cursor 与登记/复用/错误计数；显式操作都写触发原因。
- [ ] 普通工具只开放 list/results 和显式 rescan；复用 review.processing 服务实现。不把 attempt submit、人工确认或任意 payload 写入开放为普通工具。
- [ ] API DTO 与客户端契约对照，搜索全部 token/preparation 字段，断言响应和事件串均不含私有凭据。

统一前缀：`/dsh-trader-kit/review/api/processing`。

| 接口 | 入参 | 输出/动作 |
| --- | --- | --- |
| GET /health | 无 | 开关、能力、Agent 日预算、等待计数、storageError、页面接线状态 |
| GET /registry | 无 | 受控模块/参数、settingsRevision；无执行副作用 |
| GET /tasks | processorId/stage/state/tradeDate/code/market/cursor | 默认 20、最多 50；createdAt+taskId 稳定分页 |
| GET /task | taskId | 结果、适用状态、尝试与版本的公共投影 |
| GET /events | taskId/afterSequence/limit | limit<=100、nextSequence/hasMore、截断信息 |
| GET /cards | code/market/date | 卡片任务结果、过期提示；确切身份不折叠 |
| POST /retry | taskId/expectedInputRevision/recordVersion | 202，新 taskId；原尝试历史保留 |
| POST /cancel | taskId/recordVersion/reason | 取消或停止清理；成功结果不回滚 |
| POST /settings | settingsRevision/白名单字段 | 原子模块设置；冲突 409 |
| POST /reload | 无 | 显式重载定义/能力；无效保留旧表 |
| POST /rescan | dateFrom/dateTo/cursor | 202，有界页计数；不绕过开关/预算 |

错误按代码区分：400 参数，409 冲突，503 缺能力/未具备执行条件，500 持久错误；中文说明只展示，不靠解析中文驱动状态机。

**验证：** `pnpm exec vitest run test/processors/api.test.ts test/processors/tools.test.ts test/routes-review/review-registration.test.ts test/routes-review/review-handler.test.ts test/routes-review/review-local-budget.test.ts`。

**出口：** 页面轮询零接纳/零模型，操作有鉴权和冲突保护；旧卡片、图片和 local 返回行为保持。

### 任务 11：正式管理页日志和最小复盘页提示

**依赖：** 0、2、10。

**文件：** 完善 `src/client/processors/KeywordRunsSection.ts`、`contracts.ts`；新增 `api.ts`、`src/client/review/processor-view.ts`、`test/routes-review/review-processors-page.test.ts`；最小修改 `src/client/index.ts`、`src/client/review/index.html.ts`；完善 `test/client/keyword-management-section.test.ts`。

- [ ] 先测试 subject 对应本插件才显示、缺槽旧面板继续、任务切换旧响应不能覆盖新选择；组件维持当前 React/createElement 模式，不新增框架。
- [ ] 管理区首屏显示全局关闭/能力健康、任务筛选、queued/waiting/preparing/running/成功/失败及具体中文原因。日志事件分页保持 sequence，显示截断，不只列已经存在的 native jobs。
- [ ] 详情展示 taskId、attemptId、nativeJobId、sessionId 各自含义、输入/定义版本、结果和 resultDelivery；仅受鉴权详情可显示来源证据，不把内部 token 带到客户端。
- [ ] 本地接口轮询作为基本刷新，页面隐藏停轮询、重新显示恢复读取；切任务增加 viewSequence，并 AbortController 取消旧请求。页面关闭仅停止观察，后台继续运行。
- [ ] 原生 watchRows/observe 可用时作补充；需要 sessionId 而当前没有合法会话时只显示持久日志，不伪造 session。只允许当前 runtimeInstance+自有集合连接；历史同名编号只展示。
- [ ] retry/cancel/settings/reload/rescan 按 API 版本字段提交；409 后刷新并提示冲突，不盲重发。启用行为明确提示最近 7 日补处理和预算；生产空表展示“尚未接入处理模块”。
- [ ] 复盘页输入只做纯本地识别，提示已登记/未知词；保存后读取 /cards 状态，显示查看日志/结果入口，不改变草稿、图片粘贴、保存成功或原正文。内联脚本按现有 ES2017 兼容输出。
- [ ] 卸载注销槽、定时器、请求与原生观察；隐藏/关闭页不能发送 cancel。缺管理槽时 health/诊断明确未接线，不报告页面已完成。

用户可读的最小日志应按顺序出现：

1. 已登记：因卡片保存/重扫/显式重试，识别了哪个测试模块。
2. 等待或准备：具体条件、实际定义和本次来源版本。
3. 已启动：哪次 attempt、哪一个 native job，Agent 则有独立 session。
4. 校验及结果保存：结构/证据是否合法，来源是否仍当前。
5. 投递和清理：业务登记 complete/pending/obsolete，执行资源是否释放。

**验证：** `pnpm exec vitest run test/client/keyword-management-section.test.ts test/routes-review/review-processors-page.test.ts test/routes-review/review-images-page.test.ts test/routes-review/review-context-page.test.ts test/routes-review/review-local-budget.test.ts`，随后真实插件详情区复验。

**出口：** 用户在 DSH 管理页面能看见等待到结束及重启历史；日志不是 console、安装日志或主聊天输出的替代品；原复盘页与异步切卡性能不回退。

### 任务 12：打包、真实全链路验收和第二模块接入证明

**依赖：** 0–11。

**文件：** 完善 `docs/spikes/keyword-management-jobs.md`；新增 `test/processors/framework-integration.test.ts`、`extension.test.ts`；验收记录写入本任务 `progress.md`，不在生产配置留下探针入口。

- [ ] 临时 dataRoot 的真实 Markdown 经 store 保存，使用测试模块与真实宿主：保存 → dirty 合并 → task JSON → native run → submit → result → 管理页 events → cancel/重启恢复。测试装配与生产安装明确区分。
- [ ] 第二个文字测试模块通过同一接口加入，保持 parser/scheduler/host-jobs/trace/主任务列表不改；验证扩展只需要模块与注册表，不要求新增运行器。
- [ ] 首先在源码本地跑门禁，再打包检查 config 和客户端资产。测试 profile 安装后核实际安装 tarball/路由/页面版本，刷新浏览器不能当作插件重新装载。
- [ ] 按下节矩阵逐行记录证据，特别是准备期取消、已成功未清理、缺 Jobs、native 编号重用和旧结果晚到。
- [ ] 清除测试 profile 中临时探针注册，生产空表重新安装启动，确认旧无关键词卡片功能不变且零执行；保留诊断记录，不把探针假称生产预期能力。
- [ ] 运行全量类型、构建、测试、合规和 diff 检查；有基线未解决错误就单列，不勾“全部门禁通过”。最后记录修改文件、复用与简化、风险和回滚。

**验证：** `pnpm exec vitest run test/processors/framework-integration.test.ts test/processors/extension.test.ts`；加实机证据；全量命令见第六节。

**出口：** 01 的框架和管理日志真实闭环成立，生产无测试模块；才能进入 03 的预期实现计划。

## 五、必须覆盖的触发与生命周期验收矩阵

| 场景 | 要看到的事实 | 覆盖任务 |
| --- | --- | --- |
| 输入/粘贴但未保存 | 仅本地提示，零 task/Jobs/模型 | 2、11 |
| 无关键词旧卡片 | 原读写/图片/计数不变，零任务 | 5、12 |
| 未知词/完整名字前缀 | 保留原文不阻塞保存，不误匹配 | 2、5 |
| 同卡同模块多标记 | 保留多个跨度，初始任务只有一个 | 2、5、6 |
| 同输入重复保存、appendAinote | 当前任务复用，零新增执行 | 5 |
| 保存同时第二次编辑 | generation 防旧扫描发布 | 5 |
| 正文编辑、标记删除、卡片删除 | 旧输入失效；旧 submit 不回写 | 5、8、9 |
| 同码不同市场/真实文档 | cardId 与任务隔离，不追随同码改名 | 4、5 |
| 图片仅字节变化/引用文本变化 | 文字模块不读图片；引用文本变化按模块投影 | 4、5 |
| 原始/非规范化正文与 CRLF | 偏移和 hash 来自实际保存 body | 2、4、5 |
| global/module 关闭 | waiting/取消明确；默认全局关闭 | 3、6、9、11 |
| 缺 Agent/Skill/model | agent waiting；可用 data 不被拦截 | 6、7 |
| 缺 Jobs/controller、满容量 | waiting 原因区分，无隐藏后台运行、不计尝试 | 0、6、7 |
| 预算满/跨日/重启 | 持久启动次数重建，等待合理时刻 | 6、9 |
| canceled 在 create 返回前 | 返回立即清理，零 followup | 7、9 |
| canceled 在 running 写盘期间 | 返回后同步 abort 复查，不激活提交 | 6–9 |
| RESULT_COMMITTED 后取消 | succeeded 保留，不重跑；清理/投递独立 | 8、9 |
| 成功但 Agent 没清理 | 槽不释放，不能启动下一实例 | 6、7、9 |
| 非法 schema/证据/idle 无 submit | failed，不自动循环尝试 | 7、8 |
| 旧输入/定义/序号/token/业务条件 | 拒绝迟到结果，未处理写事件也不能放行 | 8 |
| pending 部分落盘后重启 | 幂等补投递，零模型；永久过期 obsolete | 8、9 |
| 超过 7 日的未结束/投递记录 | 仍核验恢复；旧未登记卡只显式重扫 | 5、9 |
| 目录读失败/部分页/文件暂不可读 | 不宣判删除，健康态说明 | 5、9、10 |
| task/settings 原子写失败 | 旧记录保留，错误具体，不伪称已安排 | 4、5、8 |
| 原生日志投影失败 | 持久事件可查，结果不回滚 | 4、8、11 |
| 时间线截断/分页 | 序号递增，首20末980，明确 omitted | 4、10、11 |
| GET/工具只读/页面隐藏或关闭 | 零唤醒；隐藏停轮询，关闭不 cancel | 10、11 |
| nativeJobId 重启后同名 | 历史只展示，不误观察/取消其他任务 | 7、9、11 |
| 插件卸载再挂载 | 自有运行被清理，无残留监听，主聊天继续 | 9、11、12 |
| 生产空表/第二测试模块 | 正常启动，扩展不改通用核心 | 3、12 |

## 六、命令、基线缺项和验收记录

每个步骤的命令只在对应文件创建后执行。全量门禁沿现有工程：

```powershell
pnpm typecheck
pnpm build
pnpm test
node scripts/scan-compliance.mjs --self-test
git diff --check
```

当前 package.json 没有 lint 脚本或独立静态分析配置；不写 `pnpm lint` 已通过。现有静态门禁是类型、合规和差异检查。pnpm 代理/沙箱不能工作时用已安装依赖的对应命令，不为验证环境新增依赖：

```powershell
& ./node_modules/.bin/tsc.CMD --noEmit
& ./node_modules/.bin/tsdown.CMD
& ./node_modules/.bin/vitest.CMD run --reporter=dot --silent
```

本轮编制计划重新核对的现状：

| 检查 | 实际结果 | 对开发的影响 |
| --- | --- | --- |
| 当前类型检查 | 10 处既有测试错误 | 任务 0 重新比较；不能宣称全量门禁通过 |
| 当前构建 | 通过，有已有 external 弃用提示 | 当前源码可构建，不代表框架已实现 |
| 当前现有测试 | 86 个文件、845 条通过 | 本次工作区基线，不是拟新增框架测试 |
| 合规脚本自测 | 通过 | 新结果格式仍须实施后验证固定声明/解释边界 |

类型错误清单：`test/routes-review/review-limit-box.test.ts:67` 一处 businessDate 隐式 any；`review-params.test.ts:46/54` 三处；`test/skill/assembly.test.ts:79` ToolDefinition 无 name 属性；`version.test.ts:76` 三处；`zip-guard.test.ts:198` 两处。基线修复如需进入开发，单独明确文件所有权和回归，不能混进框架差异后掩盖。

每任务 progress 记录固定格式：任务编号/修改文件 → 新失败断言和失败原因 → 定向通过结果 → 旧行为回归 → 实机证据或未运行原因 → 待解决问题。仅源码构建不作为安装/运行成功证明。

实机记录至少包含：实际 profile、宿主及 Jobs/Agent/Skill/插件包版本、安装资源 hash、任务/attempt/native/session/runtimeInstance 关联、对应 JSON recordVersion、管理页位置/截图或复现步骤、取消和 cleanup 的先后事件。Agent 探针无行情，市场能力本波没有验收记录，也不发交易请求。

## 七、review 顺序与停止条件

建议逐次 review 以下四个产物，减少一次审查的文件量：

| review 点 | 完成任务 | 最先看什么 |
| --- | --- | --- |
| 语法与契约 | 0–3 | 宿主探针证据、模块六方法、关键词忽略规则、空生产表 |
| 保存和持久待办 | 4–6 | 路径/身份、原子 task、同步 listener、保存后 source 比对与等待原因 |
| 执行和生命周期 | 7–9 | running 激活顺序、私有凭据、业务 guard、成功点、取消/cleanup/恢复 |
| 用户闭环 | 10–12 | 原鉴权、GET 零副作用、详情页等待到历史日志、实机版本与全量回归 |

review 点是检查和记录节点，不是默认停下来重复请求“是否继续”。开始执行后按已授权范围推进；只有确实缺外部能力/必要信息或不可逆操作才单独报告。

停止接纳/回滚：将宿主 `review.processing.enabled=false`，协作停止本插件运行，已保存结果和历史 JSON 保留；模块业务暂停但不伪造结果。回滚代码不删除 task/settings，未知 schema 只读告警；旧复盘页继续工作。准备尚未提交的尝试可取消，RESULT_COMMITTED 后不能回滚成 canceled。

单 profile 原子文件和最佳努力通知仍存在外部 OneDrive 写者、断电未提交结果、宿主能力缺失等边界；通过复核、有界重扫、幂等登记与预算限制降低影响，不宣称严格跨进程一次执行。

## 八、规划插件的恢复与文件入口

本计划由 planning-with-files 管理，任务 ID 为 `2026-10-10-keyword-framework-01`：

- [任务编制状态](../../../.planning/2026-10-10-keyword-framework-01/task_plan.md)
- [现状与决策](../../../.planning/2026-10-10-keyword-framework-01/findings.md)
- [进度与检查](../../../.planning/2026-10-10-keyword-framework-01/progress.md)
- [开发计划入口](../../../.planning/2026-10-10-keyword-framework-01/development_plan.md)

恢复先选择任务、读三个记录、核新 git diff，再从未勾选任务继续。下面环境变量只固定当前终端子进程，不能据此宣称父会话 hooks 已固定：

```powershell
$env:PLAN_ID='2026-10-10-keyword-framework-01'
$env:PWF_PLAN_ROOT='E:/work/code/open/dsh-plugins/dsh-trader-kit'
& 'C:/Users/luoyu/.codex/plugins/cache/planning-with-files/planning-with-files/3.23.0/.agents/skills/planning-with-files/scripts/resolve-plan-dir.ps1'
```

应返回本仓 `.planning/2026-10-10-keyword-framework-01`。若真实路径核验被环境限制，保留插件检查，经工具批准重试；不要改脚本关闭检查。task_plan 的阶段完成指“计划编制完成”，本文任务复选框才表示开发进度。
