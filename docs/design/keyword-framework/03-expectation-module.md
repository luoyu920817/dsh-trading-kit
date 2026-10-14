# 第一个业务模块：预期整理、观察与回查

> 设计调整（2026-10-10）：按 [简单关键词入口与开放Agent工作流](00-simple-agent-workflow-principles.md) 收缩公共框架。本文预期跟踪、回查和确认规则属于预期工作流内部，原六方法接线需后续调整。

状态：详细设计草案。此模块在框架、原生执行和管理页日志验收后接入，不要求框架理解预期业务字段。

## 1. 交付行为与模块边界

用户保存含`@预期`的卡片，系统整理原话、观察对象、前提、预期和失效条件，保存原句依据并登记观察。到了目标交易日、数据齐备后比较原句与实际证据，提出建议；用户确认兑现、证伪、失效或继续观察。

首版必要输入是文字。已有图片引用保留，图片未读取明确标注，不从图片猜数值/标的，也不宣称图像预期已实现。历史/角色是辅助口径，不能替用户补价格阈值。

| 所属 | 负责内容 |
| --- | --- |
| 框架 | @识别、task状态、原生job、执行会话、尝试、版本保护、日志和通用管理页 |
| 预期模块 | 原句条目、可验证规则、expectationId、观察窗口、暂停/撤回/确认、回查请求 |
| 市场证据适配 | 已确认标的、真实业务日期、完整日线/交易日序列、单位与来源 |
| Skill | 在给定证据范围内整理和解释；不负责身份分配、文件写入或最终人工结论 |

## 2. 模块文件和阶段

| 文件 | 责任 |
| --- | --- |
| src/review/processors/modules/expectation.ts | 实现ProcessorModule，初始extract和后续check两个stage的接线 |
| src/review/processors/modules/expectation-types.ts | 整理条目、规则、观察记录和比对结果的业务类型 |
| src/review/processors/modules/expectation-validation.ts | 原句跨度、规则单位/来源、引用与结构校验，不使用模型输出路径 |
| src/review/processors/modules/expectation-tracking.ts | 幂等登记、业务匹配、观察窗口、编辑暂停和人工确认 |
| src/review/processors/market-evidence.ts | 只读证据适配接口与能力状态，缺生产者时明确不可得 |
| skills/review-expectation-extract/SKILL.md | 当日原句整理说明 |
| skills/review-expectation-check/SKILL.md | 指定窗口的原句/证据比对说明 |

模块初始projectInput包含原始body、标的身份、原交易日及有效参数；inputRevision不含图片字节、AI附注、mtime。与旧文件的纯文字卡片兼容，不迁移旧Markdown。

## 3. 当日整理的上下文与输出

上下文提供：本次实际用户正文及证据编号、显式市场与代码、原交易日、最多10张允许历史卡片、角色字段。历史加载复用historySnapshot定位文档、parseDoc提取用户卡片，不另建目录索引。当前卡片必须完整提供；超24000字符失败，不截断后还校验同一跨度。

整理Skill必须执行以下业务步骤：

1. 逐条找到用户表达的预期，引用完整原句及在body中的起止位置。
2. 分清“如果发生什么”（前提）、“希望看到什么”（预期）、“出现什么就不再成立”（失效）。没有明确表述保持null。
3. 保留不确定性。模糊的走强/承接/情绪修复不得擅自补百分比、均线或买卖阈值。
4. 指明观察的是来源个股、明确指数/其他对象还是无法定位；不能因为卡片属于个股就默认原句中的指数也指该股。
5. 输出结构化结果；不修改卡片，不写跟踪文件，不发送提醒或调用交易接口。

```ts
interface ExpectationExtractResult {
  expectations: ExpectationDraft[];
  warnings: string[];
}
interface ExpectationDraft {
  quote: {text: string; start: number; end: number; evidenceId: string};
  dimension: 'index' | 'sentiment' | 'theme' | 'moneyEffect' | 'stock' | 'unspecified';
  subjectText: string | null;
  subjectSecurity: {market: 'sh' | 'sz' | 'bj'; code: string} | null;
  subjectEvidenceId: string | null;
  conditionText: string | null;
  expectedText: string | null;
  invalidationText: string | null;
  observationItems: string[];
  interpretation: string | null;
  evaluationMode: 'structuredRule' | 'manualJudgment';
  rules: ExpectationRule[];
  ambiguityReasons: string[];
}
```

quote必须满足body.slice(start,end)===text，evidenceId属于本次冻结卡片。每卡最多20条预期，每条最多10个观察事项，解释最多2000字符。只有标记、没有expectedText时结果可成功、expectations为空；登记0条观察并写日志，不虚构业务事项。

## 4. 规则可执行的条件

规则有role（前提/预期/失效）、明确security与instrumentKind、subjectEvidenceId、metric、operator、comparison及单位。metric首版仅close/high/low/amount；operator仅gt/gte/lt/lte；comparison为literal或originMetric二选一。价格元、指数点位point、成交额元，未知单位拒绝。

literal包含原句明确数字与quote evidence；originMetric只指向原交易日的明确字段。原日真实数据尚未取得时规则合法但不可评价，不能生成一个猜测的阈值。来源市场推断仅用于文件定位，不授予指数/ETF/北京市场取数能力。

| 用户文字 | 允许整理 | 不允许的转换 |
| --- | --- | --- |
| 收盘不低于3850 | 若对象明确为指数，close>=3850 point | 默认为来源个股价格 |
| 不跌破3850 | 人工判断，提示盘中/收盘口径不明 | 自动当close>=3850 |
| 明天收盘高于今天收盘 | close与originMetric.close比较 | 用当前实时价代原日收盘 |
| 核心票重新走强 | 文字观察，保留对象未明确项 | 自动补涨幅>=3% |
| 如果情绪修复，观察题材回流 | 前提与预期分开，人工判断 | 前提没发生就算证伪 |

规则role组内全部明确条件满足才说该组符合。前提未发生返回notApplicable；失效触发单独标invalidationTriggered，不等于预测方向相反。量化规则不完整时整体保留manualJudgment。

## 5. 观察记录身份：不与技术任务绑死

第一次有效整理成功后，模块在tracking目录生成expectationId（crypto.randomUUID，仅本地代码分配）。它是业务事项身份；重试或同输入重跑不因为taskId/nativeJobId变化就重新分配。

```ts
interface ExpectationTracking {
  schemaVersion: 1;
  recordVersion: number;
  expectationId: string;
  cardId: string;
  originTradeDate: string;
  originalQuote: string;
  quoteOccurrence: number;
  matchingKey: string;
  observationFingerprint: string;
  acceptedDraft: ExpectationDraft;
  sourceLinks: Array<{taskId: string; sourceRevision: string; inputRevision: string}>;
  trackingState: 'waitingDate' | 'waitingData' | 'readyForEvaluation' |
    'waitingConfirmation' | 'paused' | 'closed' | 'withdrawn';
  pauseReasons: Array<'moduleDisabled' | 'frameworkDisabled' | 'sourceChanged' |
    'sourceUnverified' | 'userPaused' | 'definitionChanged'>;
  confirmedOutcome: 'pending' | 'fulfilled' | 'refuted' | 'invalidated';
  windows: ObservationWindow[];
  activeWindowId: string | null;
  proposedUpdate: ExpectationDraft | null;
  proposedUpdateFingerprint: string | null;
}
```

matchingKey=SHA-256([cardId,originTradeDate,精确原句,同原句在卡片中出现序号])；不做同义词或语义相似匹配。observationFingerprint对原句、原日、明确对象、evaluationMode、规则及用户明确条件/预期/失效字段规范序列化计算。机器解释和格式变化不单独改变已接受观察条件；原句重复数变化或对象不明时不猜对应关系。

pauseReasons是去重集合，独立保存各类阻断。编辑只增加sourceChanged，关闭只增加对应开关原因，来源恢复/开关开启只清自己的原因；自动流程永不清userPaused。只要还有任何原因就保持paused，管理页展示全部原因，不用单值覆盖用户手动暂停。

第一次extract的acceptedDraft可自动登记，因为用户写@预期明确请求整理与回查；这不代表机器有权确认业务结论。之后机器不能用重跑结果静默改写已登记条件，差异进入proposedUpdate。

proposedUpdateFingerprint由模块对候选受控字段计算，GET返回，接受/拒绝必须提交同值。确认接口的acceptedFingerprint就是本记录observationFingerprint，名称差异只是请求字段，不能客户端另算一套指纹。

任务resultDelivery初始pending。afterCommit在card锁→配置→请求组→task/tracking锁顺序下复核源和该结果适用性，按matchingKey检查既有记录，创建或关联条目；全部成功才写complete。同task重复恢复不得生成重复expectationId。task结果与tracking不是跨文件事务，部分写入后失败继续幂等恢复。

## 6. 编辑、重跑、暂停与撤回的规则

| 用户动作/来源变化 | 处理任务 | 已登记观察 |
| --- | --- | --- |
| 相同输入自动重复事件 | 复用 | 保持原记录 |
| 相同输入点击重新处理 | 新task/requestSequence；保留旧任务历史 | 继续现有观察；原句/条件指纹一致只追加sourceLink，不清空评价或人工确认 |
| 重跑给出不同条件/对象 | 保存新整理结果和差异 | 保留acceptedDraft，写proposedUpdate；需要用户接受，不能悄悄改观察 |
| 编辑正文仍保留@预期 | 旧task过期，新extract | 未结束条目暂停/sourceChanged；重新整理后精确匹配且指纹一致自动恢复原条目 |
| 编辑后原句/条件变了 | 新extract、新条目可登记 | 旧条目保持暂停并显示被修改，用户可撤回；不把旧人工结论搬到新条目 |
| 删除@预期或整卡 | 取消对应处理 | 未结束条目withdrawn，历史评价和confirmedOutcome保留 |
| 关闭模块/框架 | 未开始任务waiting，运行中协作取消 | 未结束条目暂停moduleDisabled/frameworkDisabled |
| 重新开启 | 复核来源/能力；有未完成处理才重新接纳 | 相同接受条件、来源仍有效且非userPaused可恢复；已成功整理不为开关操作重跑模型 |
| 临时读文件失败 | 暂停接纳，sourceUnverified | 暂停，不按删除撤回；成功读取后复核 |
| 外部文件改名 | 旧路径不追随同码文件 | 旧来源待核/撤回，新文档显式重扫作为新来源，历史留原路径 |

关闭时尚未提交结果的运行task历史保持canceled；重新开启需要继续处理时创建新的requestSequence，不能把终态记录改回running。已经RESULT_COMMITTED的task保留succeeded/resultDelivery=pending，重开核验后只补业务登记，不重跑模型。业务expectationId仍可保持，不依赖技术任务身份。已closed/withdrawn条目不因自动恢复重新打开。

proposedUpdate接受入口将旧条目保留为历史、明确建立新观察条件和新窗口；不修改已确认结论。原句重复且无法一一匹配时统一暂停待人工确认，不自动复制/合并两个条目。

这种设计不要求模型判断“用户改了几个字是否改变原意”：自动沿用只接受精确证据和受控字段一致；其余可观察、可人工处理。

## 7. 观察窗口与目标交易日

每条记录初次建立一个windowId，包含originTradeDate、targetTradeDate|null、dateProof、状态、evaluations、人工确认记录。target仅由经验证的连续交易日序列确定；自然日/周一至周五不能充当市场日历。

| 情况 | 行为 |
| --- | --- |
| 尚无目标日证明 | waitingDate，显示缺交易日序列；不先写“明天” |
| 目标日还没结束 | waitingDate，不请求模型 |
| 目标日已结束但数据不足 | waitingData，显示缺字段/停牌/源错误 |
| 数据完整且版本未评价 | 模块提出stage=check后续请求 |
| 同窗口同证据已评价 | waitingConfirmation，不每天重复模型调用 |
| 客观数据源修订 | 新证据版本可追加新评价，旧评价保留；已确认窗口不自动重开 |
| 用户继续观察 | 新windowId、明确更晚目标、理由；保留旧日期和评价 |

每天17:30（Asia/Shanghai）只做后台唤醒，宿主在线才执行；插件启动和显式重扫补查未结束窗口。模块检查到期条目并交给同一框架接纳；不另开一个预期专属执行器或系统cron。

“已登记观察”不意味着已经创建check执行任务。未到目标日或证据不足时，等待保存在tracking窗口中；模块将WAITING_TARGET_DATE、WAITING_MARKET_DATA及原因变化写入持久businessEvents，管理页在关联观察中展示。证据齐备才生成FollowupRequest，经框架创建check task/native job；这样不会用一个原生running任务占着容量等待数日。

每窗口的后续opaqueBusinessKey=expectationId+windowId。新证据改变evidenceRevision，同一证据重复唤醒复用任务。错过目标日仍取那个目标日，不能用再后一天替换观察窗口。

## 8. 市场证据接口与启用门槛

当前实时报价/指数接口只有实时字段和fetchedAt，不能证明原交易日/目标日高低收盘。复用现有交易日缓存不等于获得未来完整日历。自动回查需要专门证据适配：

```ts
interface MarketEvidenceProvider {
  resolveNextTradingDate(input: {originTradeDate: string; market: string}):
    Promise<{available: boolean; targetTradeDate: string | null; coverageVerified: boolean; source: string | null}>;
  validateTradingDate(input: {tradeDate: string; market: string}):
    Promise<{available: boolean; verified: boolean; source: string | null}>;
  readDailyEvidence(input: {security: {market: string; code: string}; tradeDate: string}):
    Promise<VerifiedDailyEvidence>;
}
```

VerifiedDailyEvidence必须定义available、明确security、源可证businessDate、sessionComplete、带unit/source/fetchedAt的逐字段值、missing、停牌/合法无成交说明及evidenceRevision。必须拒绝请求日替代业务日、市场同码误用、盘中快照冒充收盘、单位猜测和未支持资产。

实施时在`docs/spikes/expectation-market-evidence.md`记录一个实际可用的只读日线/日历生产者：公开契约、实际历史样本、长假/停牌/指数/错误日期测试及宿主组合。选择完成前available=false，check等待；设计不虚构来源URL或“已有历史接口”。允许消费经验证的官方TQ Skill产物，但本插件TS继续不直接调用17709行情，只保留既有get_stock_info白名单。

缺数据时仍能完整交付当日整理、持久观察、管理页日志、人工确认与原句回看；**自动回查单独标未启用，不能称全自动闭环完成**。实施顺序已预留证据探针和接入步骤，不把它省略。

## 9. 比对结果与人工判断

check Skill接收已冻结acceptedDraft、窗口、指定原日/目标日证据和允许引用；不能重新解释/替换当日原句，不调用额外行情工具。结果至少包含：windowId、evidenceRevision、逐条件证据、recommendation、invalidationTriggered、explanation、missing。

prepare冻结tracking.recordVersion、activeWindowId、observationFingerprint和业务状态，并交给框架commitGuard。框架在卡片来源锁→配置→请求组→合并排序的task/tracking锁内重新核验：条目未closed/withdrawn、pauseReasons为空、activeWindowId与接受指纹仍一致、recordVersion未被人工动作改变。失败时拒绝结果成为当前评价，保存具体过期原因；不能由迟到check重新置waitingConfirmation。原子task结果成功后afterCommit追加评价时再核同一业务闸门；期间发生确认/暂停则只保留历史task结果，不改业务记录、不无限重试pending投递。

明确关闭/换窗口/来源撤回导致不可投递时，将resultDelivery=obsolete并记录BUSINESS_DELIVERY_SUPERSEDED；仅临时持久错误保持pending。模块关闭或临时来源不可读属于暂停，保留pending并等待恢复，不把暂停误判成永久过期。

recommendation仅matched（符合）、partiallyMatched（部分符合）、notMatched（不符合）、notApplicable（前提未发生）、insufficientEvidence（证据不足）。机器建议不是confirmedOutcome。

condition规则不满足或无法判定必须单独解释；不能把“前提没有出现”写成证伪。manualJudgment条目可以组织指定日证据并解释不足，但没有可信数据就不启动一个只输出“无法判断”的重复模型任务。主观盘面文字对照需明确sourceType=userView，不能当客观行情。

人工确认动作：确认兑现、确认证伪、确认失效、继续观察、暂停、撤回。前3项结束当前条目/窗口；继续观察创建新窗口，不改旧评价。依据机器建议必须当前evaluationId；没有评价可basis=manual，但理由非空。recordVersion不匹配409，未知交易日不能直接继续到自然明日。

## 10. 页面与业务接口

管理页新增“待观察/待确认预期”摘要和条目页，普通复盘卡片只显示整理摘要、状态和“查看依据”。原文保留，不写回Markdown附注、不改frontmatter、不写模式库或DB/stock。

| 方法/后缀（沿processing前缀） | 入参 | 结果 |
| --- | --- | --- |
| GET /expectations | code/market/state/date/cursor可选 | 条目、窗口、暂停原因、建议及确认历史，默认20最多50 |
| GET /expectation | expectationId | acceptedDraft、sourceLinks、窗口、评价、proposedUpdate |
| POST /expectation-confirm | expectationId、windowId、recordVersion、expectedInputRevision、acceptedFingerprint、basis、evaluationId|null、action、reason、newTargetTradeDate? | 合法确认/继续；409旧版本/来源，503日期不可验证 |
| POST /expectation-pause | expectationId、recordVersion、expectedInputRevision、acceptedFingerprint、action=pause/resume、reason | resume必须源复核；只清userPaused，其他暂停原因仍保留 |
| POST /expectation-update | expectationId、recordVersion、expectedInputRevision、acceptedFingerprint、action=accept/reject、expectedProposalFingerprint | 接受差异明确建新观察；拒绝保留旧条件，记录理由 |

普通Agent仅有只读processor_list、processor_results、expectation_list；显式processor_rescan按日期范围登记，仍计预算。全局工具不开放最终submit或任意修改人工结论；所有submit仅在该执行Agent scope绑定。

确认、继续观察、resume及接受proposal都调用withVerifiedCardSnapshot短提交接口，按卡片→配置→相关请求组→排序业务记录锁重读真实正文/关键词、inputRevision、recordVersion、接受指纹、活动窗口及当前proposal。日期/数据核验在锁外做，短提交再核证明对应请求窗口；来源已改变或暂不可读时409/503，不能只因异步写事件尚未更新recordVersion就放行旧确认。pause/撤回是减少自动行为，可以在来源不可读时记录，但不恢复或确认旧条件。reject只记录拒绝，不启用新条件。

businessEvents与业务状态同tracking文件原子保存，字段为eventId/occurredAt/windowId/code/action/reason/operator（user或system）、relatedTaskId|null；人工动作operator=user，等待日期/数据和来源复核operator=system，不伪造模型执行。初始resultDelivery或followup task日志与业务事件通过expectationId关联查看；管理页可同时看技术执行和观察等待阶段。相同等待原因不反复追加，保留/截断边界沿任务阶段日志。自动清一个暂停原因也必须在来源短核验内执行，且永不清userPaused。

## 11. 关键验收案例

1. 一卡两条预期：一个extract任务、两个稳定业务条目，原句跨度完整。
2. 只有@预期：成功整理0条，不制造观察或后续check。
3. 相同输入重跑：native job和task变，expectationId及确认历史不变；条件差异只进入proposal。
4. 编辑补充无关文字：先暂停，精确条目/指纹一致后沿用；删标记则明确撤回。
5. 关闭再开启：暂停和恢复可观察，不把旧确认搬到新条目、不自动全量重跑。
6. 次日数据缺/错日期/盘中：等待，无伪造评价；日志能说明为何没启动模型。
7. 同一证据重复唤醒：不重复调用；窗口后续证据修订可追加评价。
8. 先提交成功后跟踪写失败：管理页显示投递待恢复，重启幂等补建。
9. 人工确认与旧回查并发：旧recordVersion/evaluationId拒绝，已关闭窗口不被机器重开。
10. 管理页与卡片能看到原句、证据日期、机器建议、人工结论的不同来源。
