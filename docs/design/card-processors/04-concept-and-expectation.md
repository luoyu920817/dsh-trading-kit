# 第四步：概念补全、预期整理与后续交易日回查

状态：详细设计草案。本文件的价格和原句示例是设计案例，不是实际行情或投资建议。

## 1. 两个首批模块为什么这样组合

`@概念` 用现有确定性服务检验“标记 → 代码模块 → 校验 → 展示”。`@预期` 用宿主 Agent 检验“原句 → 结构化观点 → 后续回查”。两条链共同使用注册表、卡片版本、任务与结果服务，不重复各造一套保存和重试逻辑。

框架可扩展性的验收是：添加一个受控业务模块时，不修改关键词解析器和调度器；只增加模块定义、处理器/Skill及对应结果校验。

## 2. 文件清单

| 文件 | 新增/修改 | 具体职责 |
| --- | --- | --- |
| `src/review/processors/modules/concept.ts` | 新增 | 调既有 getConcepts，区分实时快照、无记录和来源不可用 |
| `src/review/processors/modules/expectation.ts` | 新增 | 预期提取结果校验、原句关联、预期条目编号生成 |
| `src/review/processors/tracking.ts` | 新增 | 未结束预期清单、回查记录、人工确认及来源撤回 |
| `src/review/processors/market-evidence.ts` | 新增 | 带业务日期的市场证据与交易日序列适配；能力不足时明确不可得 |
| `skills/review-expectation/SKILL.md` | 新增 | 当日原句整理流程与结果提交规范 |
| `skills/review-expectation-check/SKILL.md` | 新增 | 对冻结预期和指定交易日证据进行比对，提出机器建议 |
| `config/card-processors.json` | 增补 | concept/expectation 的处理器、Skill、schema及业务参数 |
| `src/review/processors/results.ts` | 增补 | 注册 concept@1、expectation@1、expectation-check@1 校验器 |
| `test/processors/concept.test.ts` | 新增 | 真实本地 HTTP 服务、既有缓存/频控、日期不可得和身份支持 |
| `test/processors/expectation.test.ts` | 新增 | 原句/阈值/跨度校验、多条预期和缺字段 |
| `test/processors/tracking.test.ts` | 新增 | 到期资格、状态分离、人工确认、来源修改、跨月 |
| `test/processors/market-evidence.test.ts` | 新增 | 日期、单位、来源、交易日连续覆盖与未来数据拒绝 |
| `docs/spikes/expectation-market-evidence.md` | 新增 | 后续交易日证据提供者的实际能力、样本和限制登记 |

## 3. 概念模块：复用服务，不混淆历史日期

### 3.1 输入

来源卡片身份、交易日及本次配置。调用 `traderKit.data.getConcepts({code, date})`，复用已有 guard、缓存及 transport；不得另发同样的 HTTP 请求或新建不计预算的缓存。

当前 getConcepts 取的是 S8 快照，其 date 参数用于缓存分桶，不证明历史业务日期。卡片不是当前交易日时，页面必须显示“读取于某时间的实时概念快照，不能代表卡片当日”。不能为了看起来完整将 businessDate 填成请求日期。

当前源入口只接受六位代码，不能完整表达同码指数/股票。第一版只对已确认属于现有源支持范围的沪深普通股票启用。指数、通达信自制指标、基金和未验证北交所支持，返回 skipped `UNSUPPORTED_SECURITY`，零出站。资产支持资格由现有路由支持策略和明确身份决定，不由 Agent猜。

### 3.2 结果结构

concept@1 payload 至少包含：

| 字段 | 语义 |
| --- | --- |
| `available` | 此次是否有可用概念记录 |
| `requestedDate` | 本次查询/缓存分桶日期 |
| `businessDate` | 源能证明的业务日期；现有 S8 通常为 null |
| `temporalMeaning` | 固定 `currentSnapshot`，不等于历史记录 |
| `concepts` | 直接保留现有名称、强度、原因、板块编号及逐字段来源 |
| `fetchedAt` | 实际取数时间，不是行情日期 |
| `missing` / `warnings` | 日期、字段缺失及来源说明 |

有记录即 succeeded。有合法空记录时也可以 succeeded，但页面显示“本源未返回概念记录”。传输失败或guard拒绝不伪装成空概念。预算耗尽本日不立即重试；到下次有效窗口或用户显式请求才预检。

首批 `@概念` 先补结构化数据。用户问答中的“概念分析”后续可增加一个明确的 Agent解读阶段，消费这个冻结快照；不能把数据获取和生成分析隐含在同一个“不知道用了什么源”的调用中。第一批页面直接标“概念数据”，不把它标成已完成深度分析。

## 4. 预期当日整理

### 4.1 Skill 的职责

读取本卡片，逐条找出用户表达的条件、预期、失效条件和观察对象。原句原样引用；解释与原句分栏。没有明确条件时保留 null/空数组，不编造价格、涨幅、均线周期或时间。

历史材料用于给用户提供已有思考依据，不把历史观点当成当前事实。模型不能重写源卡片，也不能把“可能”“观察”改成确定性结论。

### 4.2 预期结果结构

```ts
interface ExpectationDraft {
  sourceEvidenceIds: string[];
  userQuote: string;
  dimension: 'index' | 'sentiment' | 'theme' | 'moneyEffect' | 'stock' | 'unspecified';
  subjectText: string | null;
  subjectSecurity: SecurityId | null;
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

模块结果是 `{expectations: ExpectationDraft[], warnings: string[]}`，一张卡片可提取多条。框架在校验后生成 expectationId，模型不选身份或保存路径。

`expectedText` 为 null 或原句仅含“@预期”时，结果标“尚无可验证预期”，不会建立后续跟踪对象。job可 succeeded，因为本次完整完成了识别；它与是否有跟踪条目分开。

### 4.3 可执行规则只接受明确证据

第一版规则支持以下受控字段：指定标的的日收盘价、日最高价、日最低价、成交额，以及与原交易日的比较。操作符只有 gt/gte/lt/lte。价格单位元，指数点位单独声明，成交额单位元，百分比用百分数值并写单位。未知单位拒绝，不自行换算猜测。

例如“收盘不低于3850”可候选提取为 close >= 3850，阈值证据必须引用包含3850的用户原句。**“不跌破3850”没有明确收盘还是盘中，不自动转换成 close规则**，保留 manualJudgment。“跌破今天低点”需要原交易日的可信 low字段，缺数据时规则不可执行。

ExpectationRule必须有role（condition前提/expected预期/invalidation失效）、security（明确市场和代码）、instrumentKind（stock/index/etf）、subjectEvidenceId、metric、operator、comparison（literal/originMetric）、阈值或原日字段及其单位和证据编号。literal和originMetric二选一。规则观察标的可以不同于来源卡片，例如个股卡片里写指数预期，但必须由用户原句及允许上下文明确定位；未能确认指数/市场时subjectSecurity=null、manualJudgment，不能默认评价来源个股。

规则按role分组，组内明确条件全部满足才算该组符合。前提未发生给notApplicable（前提未发生），不是证伪；失效条件是否触发单独报告invalidationTriggered，不改人工状态。规则合法不代表条件充分，无法量化条件时整体仍可manualJudgment。

模型生成的“弱反弹”“承接好”“机器人走强”保持文字判断，不通过自造涨幅阈值强行量化。

### 4.4 跟踪的登记

用户主动写 `@预期` 即声明希望回查，提取后自动登记，不要求每张卡片再次批准机器运行。登记状态为“等待回查”；机器解释不是用户确认的判断。

expectationId由cardId、sourceRevision、来源cardProcess的generation、原句证据跨度及条目顺序生成哈希，写入来源月份tracking目录。登记幂等；若job已成功但写tracking失败，模块记录warnings，恢复扫描从成功结果补建遗漏条目。只有当前选中的成功cardProcess结果能物化活跃跟踪；旧generation只保留历史，不重新激活。

这里也不是跨JSON文件事务：原句提取成功和跟踪登记成功要分别可观察。`trackingReady` 字段标记跟踪已登记；未登记显示“预期已整理，回查登记待恢复”，不能提前显示“已安排”。

## 5. 交易日和市场证据是独立接入条件

### 5.1 当前能力不足必须说清楚

当前 getQuoteSnapshot/getIndexQuote 只提供实时字段和 fetchedAt，没有完整的行情业务日期及每日高低收盘。当前交易日工具也不是未来交易日历。**不能把两者拼起来就声称已完成次日回查**。

市场证据适配器的结果必须同时满足：

- 标的市场与代码匹配。
- 提供源可证的 businessDate，不由 requestedDate/fetchedAt 代填。
- 指明是盘中快照还是收盘日线，规则要求收盘时只能用收盘日线。
- 每个数值含单位、source、fetchedAt和取数执行来源。
- nextTradingDate 的证明覆盖原日之后到目标日的交易日序列；没有完整覆盖时只知道“某个后续交易日”，不能称“下一交易日”。

### 5.2 拟新增适配接口

```ts
interface MarketEvidenceProvider {
  resolveNextTradingDate(input: {
    originTradeDate: string;
    market: MarketPrefix;
  }): Promise<{
    available: boolean;
    targetTradeDate: string | null;
    source: string | null;
    coverageVerified: boolean;
    warnings: string[];
  }>;
  readDailyEvidence(input: {
    security: SecurityId;
    tradeDate: string;
  }): Promise<VerifiedDailyEvidence>;
  validateTradingDate(input: {
    tradeDate: string;
    market: MarketPrefix;
  }): Promise<{ available: boolean; verified: boolean; source: string | null }>;
}
```

VerifiedDailyEvidence包含明确identity、businessDate、sessionComplete、逐字段有来源数据、缺失项和来源证据编号。没有这个provider时实现返回 `available: false`、具体missing；不是返回假数据。

首轮安排专门数据能力探针，核验一个固定第三方只读日线/交易日历提供者或可合规接入的既有官方TQ Skill产物。**来源选型必须以实际历史样本和公开契约通过为启用门槛**，本设计不虚构一个已经可用的历史接口。探针至少包含股票、显式指数、跨周末/长假、源日期错配和停牌。

若使用官方TQ Skill路径，其执行由已验证的宿主能力提供，结果经适配器接收；不得让本插件 TS 直接调用17709行情接口，不能为了回查绕过 `src/data/http.ts` 的只读基础信息白名单。缺合规生产者时保持waitingCapability，仍交付当日预期整理和人工证据回看。

### 5.3 数据尚未接入时的产品行为

预期卡显示“预期已整理；自动回查等待带日期的日线/交易日历能力”。下一次用户整理复盘时仍可以看到原句和后续卡片，但明确这些是用户观点对照，不是已验证客观行情。

因此本轮有两个独立验收点：当日预期结构化；带日期证据的自动回查。后者未通过探针时不能整体宣布预期闭环完成。

## 6. 回查触发与迟到处理

下一交易日目标仅由上述provider确定。目标未知时保留targetTradeDate=null。系统时钟只负责什么时候重试能力预检，不决定市场是否开市。

默认在 Asia/Shanghai 每日17:30发一个后台回查唤醒，若宿主在线；同时在插件启动和“整理今日复盘”前补查未处理条目。不引入系统计划任务或另一套外部定时服务；插件停机期间不保证唤醒，但上线能补处理。

回查需 sessionComplete=true，并且数据businessDate与目标一致。不满足时登记missingData，不用当前实时行情顶替目标日。停牌等合法无成交记录与网络失败不同，均显示具体原因。

错过下一交易日也仍查询那个目标日；如果只拿到再后一天，显示目标数据缺失，不偷改观察窗口。每天按来源月份查所有未结束跟踪，无论是否已超恢复窗口。

回查任务使用同一调度框架，processingKind = `expectationCheck`，与当日 `cardProcess` 分开。它的身份包含expectationId、目标交易日和证据指纹；重复唤醒不重复生成同样建议。数据后续修订可产生新版本评价，旧评价留痕。

## 7. 回查结果与最终状态分开

跟踪记录有kind=expectation，pattern观察另用kind=patternObservation，公共字段共享但业务payload独立。预期至少有：

- 冻结用户原句、条件/预期/失效字段、原交易日、目标交易日。
- `trackingState`：waitingDate、waitingData、readyForEvaluation、waitingConfirmation、closed、withdrawn。
- `confirmedOutcome`：pending、fulfilled、refuted、invalidated；只由人工确认入口修改。
- `evaluations`：追加式机器比对记录，每条带evaluationId、目标日期、数据证据、建议和生成时间。
- `recordVersion`、人工确认记录及来源变化说明。

机器建议为matched、partiallyMatched、notMatched、notApplicable、insufficientEvidence，展示为“符合”“部分符合”“不符合”“前提未发生”“证据不足”。条件未发生不等于证伪；失效触发也不等同预测内容相反。Skill逐条说明前提、预期和失效的证据。

人工确认可兑现、证伪、失效或继续保留。依据机器评价时必须传当前evaluationId；没有机器评价也可basis=manual人工确认，但必须给非空理由并记录缺失评价，不伪造机器结论。继续保留要求新目标晚于旧目标（旧目标未知时晚于原日），经validateTradingDate验证，并保存理由及与旧评价的关系。验证能力不足返回503并保持原记录，不悄悄改自然日；新目标建立新检查请求组，旧窗口/原句/评价不改写。

来源卡片删除、标记删除或正文版本改变，旧条目trackingState变withdrawn，停止新评估。已有confirmedOutcome和历史evaluations保留，不能被机器清空。新版本生成新条目，并显式显示“来自修改后的卡片”。

相同输入显式重跑，来源cardProcess的generation也改变；旧未结束条目撤回，新的成功结果建立新条目。关闭模块再启用或还原原文也不自动复活旧withdrawn记录。confirmedOutcome记录属于旧条目的历史，不自动搬到新条目。

## 8. Skill 的输出展示规范

当日结果：用户原句 → 结构化观察点 → 尚不明确的条件 → 可引用的历史记录。回查结果：原预期 → 指定日期的实际证据 → 机器比对说明 → 待用户确认。

AI写作部分遵守既有研究辅助定位和负向用词约束。用户原句作为独立sourceType=userQuote展示，不能因用户用了某个词被机器改写。扫描和校验区分原句与AI生成解释，不把引用当机器建议。

机器不推荐买卖、仓位或目标价。匹配模式或兑现预期也不意味着给出执行建议。

## 9. 本步骤测试与验收

| 场景 | 必须观察到的结果 |
| --- | --- |
| 两条预期同卡片 | 一个提取job、两条独立expectationId及原句证据 |
| 只有 @预期，无观点 | 整理成功但不登记虚构预期 |
| 只有“走强” | manualJudgment，未造涨幅或均线阈值 |
| 用户原句有明确收盘价阈值 | 规则带匹配的原句span，阈值/单位可核验 |
| 个股卡片写另一个指数预期 | 规则使用明确的观察SecurityId；无法确认对象则人工判断，不查来源个股 |
| getConcepts业务日期未知 | 仍显示实时快照，businessDate保持null |
| 概念无记录/源失败/预算耗尽 | 三种原因可区分，不用空数组掩盖错误 |
| 指数代码调用概念模块 | 不误查同码股票，skipped且零出站 |
| job结果成功、tracking写入失败 | trackingReady=false，重扫后幂等补建 |
| 周末或长假 | 目标来自verified交易日序列，不用日期+1 |
| 只有实时价格和取数时间 | 不能作为目标日收盘证据 |
| 晚两天启动插件 | 查原目标日，缺数据则明确缺失 |
| 条件未发生/触发失效条件 | 不直接判证伪，逐条证据说明 |
| 模型给建议 | confirmedOutcome仍pending，必须人工确认才变 |
| 用户确认期间旧卡片被编辑 | 版本冲突，拒绝确认过期记录并展示最新来源 |

这一步最重要的剩余接入风险是带日期证据提供者的真实覆盖度。文档把它列为独立探针和能力门槛，不用“以后补数据”掩盖一个当前无法闭环的接口。
