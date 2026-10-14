# 第六步：模式分析、次日观察与自定义模块扩展

状态：详细设计草案。模式模块安排在框架、图片链路和首批模块验收后；本文件把其后续文件和结果契约先定清楚。

## 1. 本步骤要解决的实际问题

用户用 `@模式` 声明当前卡片是模式观察，希望系统组织文字和K线/分时图片，找出可能属于哪个已有模式、符合哪些条件、哪些条件尚未满足，并在后续交易日收集新证据。

模式识别输出是“候选及依据”。它不是宣布形态一定成立，也不是根据图形生成新的买卖指令。用户原句、模式定义原文和机器观察必须可以区分。

## 2. 文件清单

| 文件 | 新增/修改 | 具体职责 |
| --- | --- | --- |
| `config/pattern-catalog.json` | 新增 | 缺少vault内稳定模式编号时的人维护映射；默认空目录，不编造已有模式 |
| `src/review/processors/pattern-catalog.ts` | 新增 | 只读模式定义、稳定编号、来源路径和版本；校验映射与原文 |
| `src/review/processors/modules/pattern.ts` | 新增 | 校验模式候选、条件/图片证据、用户确认和观察对象 |
| `skills/review-pattern/SKILL.md` | 新增 | 基于指定模式目录、原文和实际图片做候选组织 |
| `skills/review-pattern-check/SKILL.md` | 新增 | 在指定后续交易日比对模式条件，提出持续性建议 |
| `src/review/processors/tracking.ts` | 增补 | 模式观察记录的共同时间/证据规则，不复制调度器 |
| `src/review/processors/results.ts` | 增补 | pattern@1、pattern-check@1、structured-note@1 校验器 |
| `config/card-processors.json` | 修改 | 开启模式模块，声明可用模式目录/图片设置/结果schema |
| `src/client/review/processor-view.ts` | 增补 | 模式候选、已满足/缺失条件、证据和确认状态展示 |
| `test/processors/pattern-catalog.test.ts` | 新增 | 实际临时模式md、映射、同编号冲突、缺目录和版本变化 |
| `test/processors/pattern.test.ts` | 新增 | 未知模式编号、未读图引用、候选条件、证据及过期确认 |
| `test/processors/extension.test.ts` | 新增 | 仅新增JSON+已安装Skill即可接入通用结构化笔记 |

## 3. 模式目录的权威和读取

模式规则来自已有vault定义，优先读取模式Markdown中明确的稳定编号与规则。沿 `docs/design/pattern-unification.md` 的“命名空间.模式”口径。不能凭文件名自动发明稳定编号，也不能把股票档案的热点标签当模式定义。

若vault还没有稳定编号，使用本插件 `config/pattern-catalog.json` 的人工维护映射，明确每个id对应的实际相对文件路径。它只提供编号和阅读定位，规则正文仍来自对应vault文件；文件不存在则该条不可用。映射可通过明确的绝对外部JSON路径替换，与关键词注册表一样完整校验后切换。

第一版模式目录默认空，由已审阅映射或已有合法frontmatter条目填充。没有任何模式时模块显示“模式定义尚未登记”，不能返回想象中的历史模式。设置里只列实际可读、id唯一的模式供勾选。

默认读取区域为已登记只读patterns区，额外模式根必须在后端明确声明并经过真实路径验证。只读Markdown，目录级canvas推导后置；不会写模式、canvas或交易框架。

每个目录条目提供：patternId、中文name、sourceRelativePath、definitionText、definitionRevision。允许读取的条目上限20个，单定义上限6000字符；超限指明文件，不能把半个规则伪装成完整定义。

模式定义可以是自然语言，不强迫改为某种复杂YAML。现有frontmatter解析器不是完整YAML引擎，本轮不新增依赖去支持任意嵌套结构。条件划分由Skill提出候选，并引用原规则句子。

## 4. 模式分析输入与图像

输入包括：本卡片完整正文、用户选择且已登记的模式定义、配置允许的历史卡片、`角色`原文、实际读取的本卡片图片。

includeImages默认true，模型或附件服务不支持时模块waitingCapability；用户明确关闭读图后可以只分析文字，但结果固定显示“未分析图片”。图片引用不作为标记文本的OCR输入。

图片不明示交易日、周期、市场/代码时记录imageContextMissing，不据图推断为当前标的当日K线。可以描述看见的形状，不能把某个模糊价格刻度当高精度行情数值。截断图、过小图、多个标的混图分别给出原因。

图像工具按第3份文档真实读取和传给模型。结果只允许引用本次成功提供的imageId；模型声明“看过图片”却没有实际工具记录时拒绝结果。

## 5. 模式结果结构

pattern@1 payload包含candidates数组、unclassifiedReason及warnings。每个候选至少有：

| 字段 | 含义与校验 |
| --- | --- |
| `patternId` | 必须属于本次冻结目录，拒绝模型自由造id |
| `definitionRevision` | 本次读到的规则版本 |
| `userQuoteEvidenceIds` | 用户文本依据，可空但必须说明 |
| `imageEvidenceIds` | 实际读过的图像证据 |
| `matchedConditions` | 条件原文、模式定义证据、当前观察证据 |
| `missingConditions` | 尚无证据的条件与原因，不自动当不成立 |
| `contradictingConditions` | 与观察不一致的条件及对应证据 |
| `interpretation` | 机器解释，和用户原句分开 |
| `setupCategory` | 对既有模式中机会位置的分类；无规则依据时null |
| `nextObservationItems` | 后续应该收集哪些证据，不能当买卖建议 |

用户问答里的“归类到模式、买点”在这里解释为**已有模式定义中的机会位置分类**。例如匹配某个已有条件条目及其原规则引用；不生成“现在买入”、仓位或目标价。规则中没有该分类，就保持null。

不要求模型给数值置信度，避免把主观百分比当统计可靠性。页面显示“候选”“证据不足”“存在矛盾”，让用户通过来源判断。

无匹配也是合法结构化结果：unclassifiedReason解释没有足够模式依据。不能为了看起来成功必须选一个模式。

## 6. 确认模式与既有字段

新增模式确认操作记录在本功能JSON内：确认哪个candidate及其definitionRevision、时间和理由。不自动写文档frontmatter `patterns`，也不修改vault模式权威文件。模块confirmation是另一个受版本保护的记录更新，不能直接改变原job已校验的payload。

确认请求需当前sourceRevision、routeRevision和候选结果版本。规则文件改变、源图被替换或新generation已经选定时拒绝旧候选确认，显示需要重新处理。

可以把这些确认记录提供给后续每日整理只读消费，但“确认了一个候选”不代表规则未来必然兑现。

## 7. 后续交易日的模式观察

用户明确使用 `@模式` 后，可在页面默认参数显示“下一交易日收集后续证据”。模式输出至少有可说明的nextObservationItems时，建立patternObservationId，存储在来源月份tracking目录。

每个已校验候选都物化一个kind=patternObservation记录供确认；无后续观察项时trackingState=notScheduled，不安排检查。原pattern结果保存时trackingReady=false；候选记录全部幂等建成后才置true。启动/空闲恢复扫描覆盖该终态job，物化前核原分析仍是当前适用generation，历史过期结果不创建活跃观察。

来源使用当前模式候选、冻结定义、原卡片和已读图片。patternObservationId包含cardId、sourceRevision、来源cardProcess的generation、patternId与definitionRevision。同源重跑产生新观察，旧未结束观察撤回；旧人工确认历史保留。观察对象是这个候选的持续性，不是自动核验整套交易策略。

与预期回查共享：verified交易日、日线/市场证据、缺失登记、17:30唤醒、迟到补查和人工最终确认。不同之处是业务payload，因此使用pattern-check@1校验器与patternCheck处理种类，不让它覆盖原始pattern分析任务。

目标日缺图片时只能比对已有可证数据和新用户卡片，不凭空重建K线图片。需要判断形状而只有日收盘价时，结果insufficientEvidence。条件已不符合、尚缺数据、规则已变分别显示。

followup显式声明kind=patternCheck、skillId=review-pattern-check、outputSchema=pattern-check@1及允许card/tracking/marketEvidence/images上下文。执行版本含原模式定义哈希和本次检查Skill；不以pattern@1校验后续比对。

没有可验证日期或历史数据提供者时，模式当日候选可交付，自动持续性观察保持等待能力；不能把“次日运行了一次Agent”当模式跟踪成功。

## 8. 自定义关键词怎样增加

### 8.1 只用现有能力的自定义Agent模块

例如添加“历史对照”模块：

1. 编写并安装一个Skill，规定原句、历史引用和分析解释的组织方式。
2. JSON添加稳定id、中文label、mentions、skillId、允许context和业务参数。
3. 采用已注册 `structured-note@1` 输出schema，包含userQuotes、observations、references、missing和warnings。
4. 显式reload完整校验，实际Skill可见后显示可用。
5. 用户输入新标记，通过同一调度/结果/页面链运行。

此流程不修改mentions.ts、scheduler.ts或records.ts。注册表将词绑定工作流，Skill组织业务，框架仍掌握上下文和结果保存。

### 8.2 新数据模块或新业务结果

如果增加新的数据来源或独有payload，需要新增处理器文件和校验器，并在模块注册处显式登记。JSON不会下载运行未知实现。复用既有网络transport、guard和缓存规则，不因新标记绕过预算。

没有追踪需求的自定义模块只返回结构化笔记。若要产生新的未来业务对象，必须增加它的日期、失效、证据和确认契约，不能只通过JSON打开任意后台计划任务。

## 9. 龙虎榜后续接入

第一版保留已知 `@龙虎榜`，显示“数据模块尚未接入”。正式启用前新增：

- `src/data/dragon-tiger.ts`：固定只读来源，历史业务日期、币种/金额单位、记录完整性、缓存和guard。
- `src/review/processors/modules/dragon-tiger.ts`：将data结果转成卡片模块结果。
- `test/data/dragon-tiger.test.ts`、`test/processors/dragon-tiger.test.ts`：真实HTTP测试服务、合法无上榜记录、错日期、源失败和金额规范。
- 注册dragon-tiger@1，更新JSON的implementationState/handlerId/enabled。

“未上榜”是合法无记录；“暂未公布”“请求失败”“日期错配”各自保留。席位属性如果源没有明确机构分类，就不通过席位名字猜为机构或游资。

可选解释阶段由另一个明确Agent处理步骤消费已经保存的数据，不能让模型自行搜索并把未具名网页内容当源数据。

## 10. 本步骤验收

1. 实际目录只有两个模式，模型提交第三个未知id被拒绝。
2. 原卡片有图片但模型没有调用图像工具，不能声称图片条件匹配。
3. 模式目录缺id/重复/丢文件，明确不可用，不造临时不稳定id。
4. 同一图形有两个候选，均展示条件来源；无匹配时有明确原因。
5. 模型推断买点但原模式无定义，setupCategory=null或拒绝无依据字段。
6. 模式定义更新后旧结果configurationChanged，不能确认旧规则。
7. 新JSON+已安装Skill+通用schema能接入自定义标记，解析器/调度器不改。
8. 下一交易日只有日线而形态需分时图，返回insufficientEvidence，不假装满足模式。
9. 跟踪与原分析有不同请求组，后续回查不挤掉当日候选展示。
10. 模式分析、候选确认和观察文件不会修改DB/stock、模式库或既有frontmatter。
