# DSH原生执行与管理页面执行日志

> 设计调整（2026-10-10）：先读 [简单关键词入口与开放Agent工作流](00-simple-agent-workflow-principles.md)。原生Jobs、独立Agent和管理页日志方案继续参考；data分支及强制prepare/commitGuard等协议不再作为首版普通工作流要求，流程需按开放工作流接入面重排。

状态：详细设计草案。宿主公开类型和页面渲染点已只读核验，实际挂载、流式更新、取消与重启仍是实施验收项。

## 1. 用户要看到的页面

在DSH的插件管理界面打开`dsh-trader-kit`详情页，新增“关键词任务与执行日志”区。它显示保存后尚未开始的任务、等待原因、每次执行、失败或取消、结果提交及预期登记；不要求先进入某个聊天才能知道任务是否排队。

原生会话头部的后台任务列表作为实时执行的第二入口。插件管理页的持久阶段日志是审阅历史的权威入口；不能把终端logger输出、插件安装日志或模型聊天文本当作这个功能的替代。

页面布局：

```text
关键词任务与执行日志
框架：已启用  | 原生执行：可用 | 今日Agent尝试：3 / 30
待处理2  等待能力1  执行中1  失败0  待确认预期4

筛选：交易日 / 关键词 / 执行状态 / 标的     [刷新] [重扫范围]
时间       关键词 标的      状态       阶段/原因          操作
15:12:03   预期   sh000001  执行中     正在读取历史       查看日志 / 取消
15:14:08   预期   sz000011  等待       尚未配置模型       查看日志

选中任务：完整taskId、输入版本、原交易日、当前来源状态
执行尝试：1  原生job：review-keyword-7  执行会话：<sessionId>
15:12:03  INFO  用户保存，关键词已识别，任务登记成功
15:12:03  INFO  通过接纳检查，原生后台任务已创建
15:12:04  INFO  Skill作用域核验通过
15:12:04  INFO  模型尝试已启动
15:12:06  INFO  结构化结果通过校验
15:12:06  INFO  结果已保存，登记2条观察
15:12:07  INFO  执行资源已释放
```

上面是页面结构示意，不是实际运行结果。列表默认不展示原句或绝对文件路径；展开证据时才读取合法卡片内容。

## 2. 已核验宿主事实与选择理由

安装根为`C:/Users/luoyu/.dsh/profiles/node_modules/@deepseek-ai/`；本机实际包类型不能替代运行中组合验证。

| 事实 | 精确依据 | 设计选择 |
| --- | --- | --- |
| jobs.start立即执行run，无排队，满额拒绝 | dsh-jobs/lib/types/index.d.ts；dsh-jobs-local/src/index.ts:206–222 | 自有最小待接纳记录，不复制运行引擎 |
| native状态仅running/stopping/completed/killed/failed | dsh-jobs/lib/types/view.d.ts:10–15 | 页面展示独立业务executionState，progress解释准备/校验阶段 |
| 原生日志为内存环，重启丢失 | dsh-jobs-local/README，运行环默认256KiB、结算环16KiB | 持久化关键阶段事件；原生流作为实时投影 |
| unowned job各会话可見，任意caller可取消 | dsh-jobs公开访问语义及job-controller类型 | 第一版明确为单用户profile的插件级任务，省略owner |
| unowned结算不触发tool-jobs模型通知 | dsh-tool-jobs/src/index.ts:278对owner===undefined直接return | 避免后台任务完成后自动向主聊天插话 |
| 原生后台列表在会话头部 | dsh-client-ui-jobs/src/client/index.ts:35–49 | 不误称它是插件管理页 |
| plugins.detail.section真实渲染 | 嵌套dsh-client-ui-plugin-manager/src/client/PluginManagerPage.tsx:595 | 为本插件详情页增加正式扩展区 |
| 通用logger未发现管理页消费通道 | Cordis logger类型；管理页仅订阅plugin-manager/install-log | 不写安装日志通道、不全局截获所有插件日志 |

插件管理包在`dsh-web-app/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/`；原生Job Controller类型在`dsh-client-ui-jobs/node_modules/@deepseek-ai/dsh-api-job-controller/`。顶层没有目录不等于功能未安装。

没有确认通用ctx.tasks、jobs.create/register/resume或持久日志append API，设计不能调用这些假想接口。

## 3. 原生Jobs适配接口

`src/context-types.ts`镜像当前宿主最小结构，不为设计引入新的运行时或开发依赖：

```ts
interface KeywordJobsLike {
  attachController(name: string): () => void;
  start(spec: KeywordJobSpec): string;
  kill(id: string, caller?: string, reason?: string): 'requested' | 'already-finished';
}
interface KeywordJobSpec {
  kind: string;
  label: string;
  owner?: string;
  outputLimitBytes?: number;
  run(job: KeywordJobHandle): KeywordJobHooks;
}
interface KeywordJobHandle {
  readonly id: string;
  append(text: string, options?: {channel?: 'stdout' | 'stderr' | 'log'; gapBefore?: true}): void;
  updateProgress(line: string): void;
}
interface KeywordJobHooks {
  cancel(reason?: string): void;
  done: Promise<{status: 'completed' | 'killed' | 'failed'; detail?: string; result?: string}>;
}
```

适配器在插件root Context调用`jobs.attachController('traderKit:keywords')`，保存disposer。只在Agent scope attach不能服务unowned桶。不为了controller准入额外加载dsh-tool-jobs。

start使用kind=`review-keyword`、label=`关键词任务 · 预期整理 · <taskId短前缀>`，省略owner。运行时接受非空自定义kind；若未来直接import宿主JobSpec，才按其JobKindMap声明合并。当前本仓无法直接解析dsh-jobs类型包，不为声明合并新增依赖，也不冒用bash/subagent种类。

unowned意味着所有该profile已认证会话能看见及取消；这符合当前个人单用户工程，不提供多租户会话隔离承诺。原生label/result/detail不得带完整原句、绝对路径、token或模型凭据。完整卡片证据只经原鉴权业务接口展示。

不要让执行Agent成为其自身job的owner再在done前dispose：owner teardown等待owned job，而job等待dispose可能形成循环。首版省略owner，不创建额外长期管理Agent；每次执行Agent仍由插件单独持有和释放。

## 4. 接纳与一次执行的精确顺序

1. 持久queued任务已存在，接纳器取得本地并发名额，核当前输入/开关/定义。agent再核候选Skill、模型和Agent日预算；data只核自己的受控数据能力及额度，不要求Agent服务。缺条件保持waiting，不创建占着容量长期等数据的原生job。
2. 在短锁内领取准备凭据、写preparing与日志，释放所有锁。
3. 调用jobs.start；它同步进入run，run仅建立异步执行链并返回cancel/done，不在同步回调里读取大文件或驱动模型。内存执行槽预先拥有taskId/preparationToken，回调用job.id记录原生关联，不依赖start返回值已赋给外层变量。
4. nativeJobId和本次runtimeInstanceId关联尚未持久成功时不得启动处理。只有已识别的容量拒绝才写waiting/hostCapacity；缺controller写waiting/capability，其他异常具体报错，不一概当容量。释放本地名额、不计Agent尝试，容量等待最早10秒后重检，不快速自旋。
5. 原生链内准备冻结上下文，创建独立Agent。在create前核候选Skill来源及哈希；setup取得实际agent后注册该Skill、scoped skills.get核正文和来源、限制继承工具并绑定上下文/提交工具。
6. create/setup成功后在卡片→配置→请求组→task短锁内再次复核。通过才原子追加attemptId/startedAt/provider/model/sessionId、生成私有attemptToken、写running、计日启动尝试。异步写盘结束后立即检查内存abort/取消标记；已取消则不激活工具、不followup，清理资源。未取消才绑定凭据、激活闭包并同步提交followup，二者之间不增加await间隙。启动计数是保守接纳计数，刚提交就失败或写盘期间已取消仍计预算，不等同provider计费。
7. 模型经受控工具读取本次证据并提交。结果必须对应当前attemptId和私有attemptToken，原句可按原body跨度重现，schema与证据校验通过；后续任务还核业务commitGuard，然后原子写result+succeeded+RESULT_COMMITTED事件。
8. 模块afterCommit幂等登记观察；失败保留resultDelivery=pending与明确日志，之后恢复补建。不能把缺登记说成“已安排”。
9. concludeTurn后等待Agent idle并dispose；释放该次文件/监听器资源。done在清理后结算，才释放本地执行槽。提交成功但清理失败显示清理告警，未排空不得并发启动同请求下一实例。
10. 原生Outcome.completed代表业务结果已保存且本次链正常清理。无有效提交、模型错误或schema错误为failed；用户/来源取消为killed。RESULT_COMMITTED后收到取消时，native可killed但业务task保持succeeded及pending投递，并在detail说明“结果已保存后停止”；重开只补投递。不要仅用whenIdle或native completed证明预期已兑现。

上述第5–7步是agent分支。data分支在同一native run中prepare受控函数与数据证据，经相同来源/定义/业务guard复核后写attemptId/attemptToken；provider/model/sessionId为null，不计Agent日预算。最后一次同步abort检查通过才调用数据处理器，结果经统一results入口提交，释放该次读取资源后结算done。它不create Agent、不装载Skill、不followup，但同样可取消、重试、保存结果和记录日志。

取消通过registry.kill(nativeJobId,undefined,reason)，不是不存在的jobHandle.kill。run返回的cancel必须同步、幂等：设置中止标记、AbortController.abort、向已创建执行Agent发协作cancel。done最终等待清理结算；取消后闭包失活，晚到结果拒绝。取消正在准备的任务也要覆盖“Agent创建稍后返回”的竞态，返回后立即dispose且不followup。

时间相关重试仅重唤醒接纳器；实际执行、输出、停止仍交原生job。缺原生Jobs/controller时框架和管理页继续显示，但处理进入waiting/capability，不静默降级为不可观察的后台执行。

## 5. Agent工具与会话关联

每个Agent只开放review_processor_context和review_processor_submit。第一版文字预期没有图片工具，也不暴露shell、任意文件写入、全文vault搜索或修改卡片工具。submit闭包固定taskId、attemptId、私有attemptToken、输入/定义版本和目标文件；模型仅提交payload及证据引用。公开attemptId用于观察关联，不授予提交权限；activeAttemptToken/preparationToken绝不返回HTTP或日志。

上下文最多24000字符；历史默认最多10张、硬上限20张；正文过大明确失败不偷偷截断原句。角色仅消费DB/stock的角色口径，历史是用户观点而非市场事实。提交工具成功后concludeTurn；idle却没有合法提交返回RESULT_NOT_SUBMITTED。

create.meta只使用公开cwd/parentSession/isSeeded/origin/delegationDepth/agentPreset字段，不塞taskId/title。业务关联保存到task.attempts；provider/model/cwd来自框架明确配置，不取最近聊天或process.cwd猜测。

若sessionTitle服务可用，使用公开sessionTitle.rename为执行会话命名，如“预期整理 · 000001 · 10-09”；cwd明确绝对路径。不要假设origin=subagent能标识业务，普通侧栏会隐藏该来源。管理页始终显示sessionId；打开会话按钮仅在已核验客户端导航能力时启用，缺能力仍可看全部阶段日志，不能拼未经验证的URL。

## 6. 持久阶段日志契约

`src/review/processors/trace.ts`提供唯一emitEvent：状态变更与事件在同一task JSON原子保存，再投影到当前native job.append({channel:'log'})及updateProgress。queue/waiting尚无native job时只写持久事件，管理页仍可读。

```ts
interface KeywordTaskEvent {
  sequence: number;
  eventId: string;
  occurredAt: string;
  level: 'info' | 'warn' | 'error';
  code: string;
  message: string;
  taskId: string;
  attemptId: string | null;
  nativeJobId: string | null;
  executionSessionId: string | null;
  details: Record<string, string | number | boolean | null>;
}
```

sequence在该task文件锁内单调递增，eventId=taskId+sequence；时间为东八区带偏移ISO串。details白名单只含阶段耗时、计数、版本短指纹、缺失能力、错误码、取消原因等，不含任意模型对象。message最多512字符，字段值和错误消息先脱敏；禁止token、cookie、请求头、绝对路径及全文原句。

| 事件 | 中文含义 | 必要细节 |
| --- | --- | --- |
| TASK_REGISTERED | 保存/重扫/后续观察登记成功 | trigger、processorId、stage |
| INPUT_SUPERSEDED | 新输入使旧任务过期 | 新旧输入短指纹 |
| ADMISSION_WAITING | 等待能力/额度/容量/数据 | reason与具体缺项 |
| PREPARATION_STARTED | 任务已领取准备 | preparation阶段耗时起点 |
| NATIVE_JOB_CREATED | 原生任务创建成功 | nativeJobId |
| SKILL_VERIFIED | 实际作用域Skill核验通过 | skillId及哈希短指纹 |
| CONTEXT_READY | 本次证据冻结完成 | 卡片/历史条数、contextRevision |
| ATTEMPT_STARTED | 真正开始一次模型/数据尝试 | 尝试序号、provider/model、sessionId |
| RESULT_REJECTED | 结构、证据或旧版本被拒绝 | 错误码及字段名 |
| RESULT_COMMITTED | 合法结果已原子保存 | schema、结果条数 |
| FOLLOWUP_REGISTERED | 业务观察/后续请求登记完成 | 业务条目数量，不暴露原句 |
| DELIVERY_PENDING | 结果成功、业务登记待恢复 | 失败类别及可恢复说明 |
| RETRY_SCHEDULED | 可恢复失败进入退避 | 下一次时间、剩余尝试 |
| CANCEL_REQUESTED / EXECUTION_CANCELED | 请求取消/清理完成 | 触发者与原因 |
| RECOVERY_RECONCILED | 重启核验/补齐完成 | 采用已保存结果还是重试 |
| EXECUTION_RELEASED | Agent与本次资源已释放 | 耗时及清理告警 |

没有状态变化的轮询不追加事件。原生输出包含eventId和原发生时间，创建job时可重放本次关联的登记/等待摘要；不能把历史等待伪装成本次发生。重复投影不影响持久sequence，浏览器按eventId去重。

task记录读取上限2MiB；阶段事件默认保留首20条和最近980条。超过时保存omittedEventCount与firstRetainedSequence，UI明确“较早阶段日志已截断”，不称无限完整审计。模型逐token与工具原始响应不写入此日志；深入模型过程可查看关联宿主会话。失败/取消历史不自动删，未来清理必须单独授权。

持久写入失败发生在模型启动前时阻止本次执行，避免无记录启动。已经执行中的写入失败立即停止后续写/启动、取消并输出宿主诊断；旧文件仍可读时管理页显示最后成功阶段和框架storageError。日志不能成为又一个“写入失败却报告成功”的双写来源。

## 7. 管理页正式扩展接线

新增`src/client/processors/KeywordRunsSection.ts`，不修改宿主源代码。沿现有React/createElement与客户端结构镜像模式：

```ts
ctx.slots.inject('plugins.detail.section', () =>
  ctx.slots.register({
    name: 'plugins.detail.section',
    id: 'dsh-trader-kit:keyword-runs',
    order: 100,
    inject: () => observationFace,
  }, KeywordRunsSection)
);
```

这是接线形状示意；实施函数必须按仓库注释规范写业务/判断/异常说明。component直接收到subject，不读取不存在的props.owner包装。只在subject.kind==='bundle'且subject.pkg.name==='dsh-trader-kit'返回内容，其他插件返回null。

正式owner类型来自plugins.detail.section的PropsRuntime；本仓无可解析类型包时镜像最小结构，实机核声明同名槽，不追加未经核验依赖。客户端可选消费slots、locale及jobs观察服务；缺jobs时仍用持久读接口展示历史。缺管理页槽则健康态显示不可用，此验收项未完成，不能仅有console日志就宣称满足需求。

原生观察沿公开jobs.watchRows(sessionId)/observe(sessionId,jobId)/kill使用，底层Controller.list/follow/kill已有流式协议。不新建第二套原生job RPC或SSE。管理页没有当前会话时，先用已核验的可选sessionId观察unowned job；如果该客户端服务要求sessionId，改用当前有效会话或仅显示持久日志，不能传伪造SessionId。首批管理页实时阶段刷新通过本地task接口始终可用，native流是补充。

只有当前runtimeInstanceId和内存自有ID集合一致才启用native observe/kill；历史nativeJobId默认只展示，不连接。宿主计数在重启后可能重新产生review-keyword-1，不能把旧编号当新任务。管理页取消经业务POST/cancel验证当前关联，再由host-jobs调用registry.kill；历史页不直接将原生编号交给客户端kill。

## 8. 业务观察HTTP接口

沿旧设计前缀`/dsh-trader-kit/review/api/processing`，新分派在review-processors.ts，原review.ts继续唯一鉴权外壳。GET不触发网络/模型或任务登记。

| 方法/路径 | 请求 | 返回/副作用 |
| --- | --- | --- |
| GET /health | 无 | 全局/能力/预算、等待计数、storageError、日志区接线状态 |
| GET /registry | 无 | 受控模块/参数/能力与settingsRevision |
| GET /tasks | processorId、stage、state、tradeDate、code、market、cursor可选 | 默认20、最多50条；稳定游标以createdAt+taskId定位 |
| GET /task | taskId | 完整业务状态、结果摘要、来源版本、attempt/native/session关联；不返回凭据 |
| GET /events | taskId、afterSequence可选、limit<=100 | 持久事件、nextSequence、hasMore和截断信息 |
| GET /cards | code、market、date | 当前卡片处理结果/过期提示；与旧卡片身份一致 |
| POST /retry | taskId、expectedInputRevision、recordVersion | 新requestSequence，202返回新taskId，不篡改原尝试记录 |
| POST /cancel | taskId、recordVersion、reason | 只操作本框架任务，转暂停/取消并kill自有native job |
| POST /settings | settingsRevision、允许字段 | 409防覆盖；模块暂停/恢复按第03份 |
| POST /reload | 无 | 重载候选定义与能力，失败保留旧表 |
| POST /rescan | dateFrom/dateTo、cursor | <=31自然日，有界扫描；202返回登记和复用计数 |

POST上限64KiB，不接受任意Prompt/文件路径/结果payload。新写路径加入既有writeCredentialValid的POST allowlist，继续Host/Origin、cookie与回环writeKey，不借原生unowned策略绕过业务鉴权。错误沿400参数、409版本、503缺能力/日期、500本地持久错误区分。

管理页可见时运行任务2秒刷新、空闲10秒，隐藏时停止；取消/重试后只刷新结果不发聊天。每次选择taskId和请求sequence，旧任务的迟到响应丢弃。卸载停止所有poll/native observe；外部文本纯文本渲染，下载JSON默认脱敏。

## 9. 验收条件

实际DSH管理页中可以看到：尚未启动的等待任务、Agent开始、结构化提交、错误/重试、取消以及重启后历史。原生job可展开实时log并停止；插件管理页的日志区没有使用install-log。相同任务明确关联不同尝试的nativeJobId/sessionId；关闭页面不停止任务，卸载插件则清理自己的工作。完整步骤在第04份。
