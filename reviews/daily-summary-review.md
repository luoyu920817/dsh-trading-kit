# Plan Review: 每日汇总工作流（daily-summary）
**Plan File**: openspec/changes/daily-summary/（proposal + specs + design + tasks）
**Reviewer**: Independent Reviewer (subagent)

---

## Round 1 — 2026-09-27

### Overall Assessment

设计分层（机械不变量在代码 / 判断在 agent）与「用户卡片字节级不变」的目标是对的，附注契约与 change 4 解析层的 `^ainote-` 排除规则方向一致。但设计从第一条前提起就建立在不存在的依赖上：change 4 只有行为 spec、没有可复用的追加/解析 API，且仓库当前只有阶段 1 骨架（`src/index.ts` 为 no-op，`src/review/` 不存在）；加上幂等前缀扫描的作用域未限定、交易日来源循环依赖、以及「缓存零网络」在 TQ skill 路径上没有拦截点，四条都属不可实施或不可验收。**Rating**: 4/10

### Issues

#### Issue 1 (Critical): 「复用 change 4 的存储实现」是被虚构的既有实现
**Location**: `openspec/changes/daily-summary/design.md:7`、`specs/daily-summary/spec.md:109`、`tasks.md:12`
design 断言「change 4 已定义卡片存储契约…本 change **复用其实现**」，但 `openspec/changes/review-page/specs/review-card-store/spec.md` 只定义**行为**（路径/分节/追加语义/原子写），没有暴露任何可供复用的函数或包接口名（如 `appendSection`/`parseCards`/service key）；`openspec/changes/review-page/tasks.md:3-8` 显示 `src/review/store.ts` 仍是未勾选任务；本仓 `src/` 下无 `review/`、`tools/`、无任何 `ctx.tools.register`，`review-page/specs/review-card-store/spec.md:110` 甚至把附注标注为「由 change 5 写入」。即：被复用对象既无契约也无实现，`review_append_ainote` 的「复用」无法落地，且 change4→change5 的**强制先后依赖**未被声明（proposal §Modified Capabilities 写「无」，tasks 无 blocked_by）。
**Suggestion**: 在 spec 里显式写出被复用接口契约（模块路径 + 导出签名 + service key + 错误类型），或把「卡片存储实现」提升为本 change 的前置 change 并标注依赖；任何「复用实现」的表述都改为「依赖 change 4 的 `<接口名>`，其可用性是本 change 的准入条件」，并在 tasks 加验收断言（缺失时工具显式报依赖不可用）。

#### Issue 2 (Critical): 幂等前缀扫描未限定作用域，用户正文命中即永久漏产出
**Location**: `design.md:44`（D-2）、`specs/daily-summary/spec.md:95`
MUST 扫 `^ainote-<YYYYMMDD>-<代码>-` **前缀**，但没说扫描范围是「H2 标题行」。用户在卡片正文里引用该锚点（复盘时复制引用、贴截图说明、写「见 ^ainote-20260924-600000-0930」）就会命中前缀 → 工具返回 `skipped`「已存在」→ **当日该标的永远不再生成总结**，且用户看到的是成功态，无从察觉。`design.md:88` 只承认「用户改了锚点」这一类风险，未覆盖正文误伤。另外代码段（``` 围栏）内的同名文本同样会被误伤；代码补零/大小写（`600000` vs `sh600000`/`600000.SH`）与 change 4 文件名/卡片锚点使用的代码形态是否同一规范化未定义，可能「写进去的锚点与下次扫的键不同」→ 每次都重复追加。
**Suggestion**: 明确判定范围 = 逐行扫描且仅匹配 `^##\s.*\^ainote-<YYYYMMDD>-<代码>-` 的 H2 标题行，跳过 fenced code block；明确代码规范化（6 位数字、前导零保留、拒绝非 6 位输入）并声明与 change 4 使用同一规范化函数；补两条单测：正文含锚点字样时不误判、异常代码形态下锚点键一致。

#### Issue 3 (Critical): 交易日来源循环依赖，入口日期无事实源
**Location**: `specs/daily-summary/spec.md:19`、`design.md:36`、`design.md:44`
「输入枚举」以业务日期扫 `<数据根>/DB/review/<YYYYMM>/`，而 `design.md:36` 说 `review_daily_scan` 的交易日「缺省取归属业务日期」——但唯一被引用的业务日期来源是 change 2 的 T1 `get_limit_reason().tradeDate`（`limit-reason-tool/spec.md:5`），它是**逐标的**取数结果，而扫描发生在知道任何标的**之前**：先要日期才能扫出标的清单，先要标的才能拿到 T1 的 tradeDate。文档也没说明缺省日期在「未指定」时到底来自哪（change 4 的 `TradeDateResolver` seam 存在于 `review-page/tasks.md:7,20`，本 change 完全未引用），结果是页面写入归属路径与汇总扫描路径可能取到不同日期（非交易日/长假差异），进而在 `202608/` 目录里找 `_20260901.md`。此外全 spec 无「非交易日/长假」场景（只有跨月场景），非交易日运行时按 spec 应输出「当日无卡片」，属**误导性结论**。
**Suggestion**: 复用 change 4 的 `TradeDateResolver` seam 作为唯一业务日期来源并在 spec 写明；定义「未指定交易日」的解析顺序与不可得时的行为（要求用户确认，MUST NOT fallback 到系统日期）；新增场景：目标日为非交易日/长假 → 显式说明「非交易日/无该交易日文档」，与「有交易日但无卡片」区分；补单测断言扫描逻辑不读取系统日期。

#### Issue 4 (Critical): 「命中当日缓存零网络」在 TQ skill 路径无拦截点、不可断言
**Location**: `specs/daily-summary/spec.md:38,45-48`、`design.md:56`、`tasks.md:21`
缓存契约属于数据模块（`data-foundation/specs/data-tool-contract/spec.md:57-62`），只覆盖插件自己的工具/service 调用；而当日表现走的是 **tq-local skill**（agent 执行的技能脚本/工具调用），本插件没有该路径的调用入口与出站计数 seam。因此「当日第二次运行零网络」在 TQ 一半上**无法强制也无法测量**；tasks 3.4 只写「缓存核对…与 change 2 缓存行为一致」，既无自动断言，也无「出站请求计数为 0」的可观测出口（data-tool-contract 的计数语义只对该模块生效）。
**Suggestion**: 二选一：(a) 把当日表现改为经插件数据模块出口取（有缓存与计数），skill 只读工具结果；(b) 降级该要求为「命中缓存时复用上一次结果，且 skill 输出须显式标注 `fetchedAt` 与是否复算」，并把可断言部分（T1 侧零网络）写成自动测试，TQ 侧改为人工步骤+证据格式。

#### Issue 5 (High): 未校验 T1 返回的 `tradeDate` 与目标交易日一致
**Location**: `specs/daily-summary/spec.md:38-53`、`data-foundation/specs/limit-reason-tool/spec.md:15,20`
T1 在历史日请求下允许「返回体 `tradeDate` 与请求日期不一致，仅在 `notes` 标注差异」；若目标日是长假/非交易日或源有滞后，工作流会把**另一天**的涨停原因写进目标日文档，而 spec 只要求数据包「含来源与缺失项标记」，没有任何一致性硬门槛。另外 `get_limit_reason` 的 `date` 是否必须显式传入（缺省为「最近交易日」口径）在本 change 中未交代，容易在补写历史日时静默取到当日数据。
**Suggestion**: 在 Requirement 取数与缓存中加硬约束：`limitReason.tradeDate !== 目标交易日` → 该字段降级为 `missing`（原因「源业务日期不一致」）并在附注中显式标注，MUST NOT 冒充目标日数据；skill 中强制显式传 `date=<目标交易日>`；补对应单测/验收用例。

#### Issue 6 (High): 「用户卡片字节级不变」缺少 EOF/换行/编码与 frontmatter 重序列化策略
**Location**: `specs/daily-summary/spec.md:70-72`、`design.md:19`
断言「用户卡片分节与其正文逐字节未变」，但追加到文件末尾在实现上必然改动最后一节的行尾：文件无尾换行时必须补 `\n`，OneDrive/Obsidian 场景可能存在 CRLF 或 BOM；change 4 的 `frontmatter.ts`（`review-page/tasks.md:3`）读写 frontmatter 也可能重排 YAML/引号，使「字节级不变」在整文件层面不成立。spec 未定义这些边界，测试断言就无法写。
**Suggestion**: 明确：读取→合并→写回 MUST 保留原始换行风格（CRLF/LF 原样）、BOM 原样、frontmatter 原文（只做定位、不改写序列化）；追加时保证「既有字节前缀完全保留，仅在其后新增 `\n` + 新分节」；spec 把断言改成分节切片比较 + 文件前缀（原长度字节）比较，并补 CRLF/无尾换行/BOM 三条单测。

#### Issue 7 (High): `failed` 三态没有落点，运行摘要无载体
**Location**: `design.md:79`（D-8）、`specs/daily-summary/spec.md:53`、`tasks.md:19`
工具返回只有 `created` / `skipped`（`design.md:38`），取数失败的标的根本不会调用写入工具，因此「该标的标记为『附注未生成 + 原因』」**没有任何产物承载**（既不写文档、也没有运行摘要文件/工具）；spec 的「给出结果摘要（产出/跳过/失败数）」也无机器可校验的返回契约，失败信息只存在于 agent 的对话文本。tasks 3.2 只有实现项、无验收断言。
**Suggestion**: 明确三态载体：要么新增只读汇总出口（工具返回 `{created[], skipped[], failed[]}` 由一次运行收集），要么定义「运行摘要」的落盘位置与格式（如 `agent/DB/temp/.../<YYYYMMDD>-run.json`）；并把「失败标的必须出现在摘要且带原因」写成可断言验收。

#### Issue 8 (High): 宿主事实引用自相矛盾，rank 300 会被同类路径遮蔽，health 出口无任务且与 change 3 重复
**Location**: `design.md:9`、`specs/daily-summary/spec.md:123,130-138`、`tasks.md:5-6`
design 把 `customSkillDirs`（rank 300）与 frontmatter 校验的行号分别引为 `packages/skill/skill-filesystem/src/index.ts:76-89` 与 `814-840`，而同一宿主事实在 `openspec/changes/tq-skill-installer/design.md:7` 引的是同文件 `36-40, 245-265` —— 两个 change 对同一事实给出**互斥行号**，说明至少一处未核验（本沙箱内该 checkout 路径不存在，无法复核，见文末限制）。更重要的是 tq-skill-installer 已记录「同名前 rank 优先」，rank 100/200 的 `.dsh/skills` 与 `.agents/skills` 会**静默压过** rank 300 副本；spec 的可见性验收只写「人工核对并记录」，无法发现被遮蔽（tq-skill-installer 的做法是经 `ctx.get('skills').list()` 核对实例化路径，本 change 未采用）。最后 spec 要求「插件的健康/状态输出在未能发现该 skill 时给出提示」，tasks 里**没有**任何实现项，且与 change 3 的 `tq_skill_manage(action:"status")` 出口重复。
**Suggestion**: 用一次实测统一行号并记录宿主版本；把验收改为「经 skills 服务列出该 skill 并断言其解析路径 == 数据根落点，若被 rank 100/200 遮蔽则显式警告」；把 health 提示并入 change 3 已有的状态出口（同一实现），或在本 change 新增明确任务与降级规则（宿主服务不可用时退化为文件系统检查）。

#### Issue 9 (High): D-4 部署语义与 tq-skill-installer 冲突且不可判定
**Location**: `design.md:50-52`、`tasks.md:4`
D-4 规定「目标已存在且与仓库源不同（用户改过）→ 不覆盖，提示差异并人工合并」，并靠 `tasks.md:4` 的**手工复制**完成部署。这既与 tq-skill-installer 的安装语义冲突（那边是「校验后原子替换、可覆盖更新」，`tq-skill-installer/specs/.../spec.md:38,45-48`），又缺少判定「用户改过」的依据：没有源哈希/版本元数据记录，无法区分「用户改了」与「仓库源升级了」，因此每次部署都只能停在「提示差异」——**没有可重复的更新路径**，也不符合 AGENTS「机械不变量在代码层」。
**Suggestion**: 二选一：(a) 复用/泛化 change 3 的安装器语义（记录源哈希 + 原子写 + 三态：一致/用户改动/可升级，改动时不覆盖但输出 diff 与哈希）；(b) 明确本 skill 不自动部署，只由人工放置，并把「部署」从本 change 的实现范围移出（vendor 目录作为唯一源）。无论哪条，都需给出可复现的验收命令/证据。

#### Issue 10 (High): 与 roadmap 阶段路线冲突，未补「迭代一」重排说明
**Location**: `docs/roadmap.md:26`、`AGENTS.md:51`、`proposal.md`（无 roadmap 影响项）、`tasks.md`（无 roadmap 任务）
roadmap 把「工作流（盘后例行 job + 复盘 skill，含 `DB/daily/` 落盘）」定为阶段 5，知识/vault 写入定为阶段 4，AGENTS.md:51 明确「vault 写入：阶段 4 起才触 vault」；本 change 却要在迭代一同时（a）写 `<数据根>/DB/review/`（vault `DB/` 业务区，见 `data-foundation/specs/data-root-layout/spec.md:28`）与（b）往 `<数据根>/agent/skills/` 发 skill。而仓库实际只完成阶段 1（`src/index.ts` 为 no-op），change 2/3/4 均未实现。design 的 Non-Goals/Open Questions 完全没有提这一重排。
**Suggestion**: 在 `docs/roadmap.md` 增补「迭代一重排」小节，写清本迭代实际覆盖的阶段 3/4/5 子集与理由（工作流优先、数据面先行的最小闭环），并在本 change 的 Impact 中引用该重排；tasks 增加一条「更新 roadmap 与 architecture.md 的本迭代口径」的产物项。

#### Issue 11 (Medium): D-6 数据包不是契约，`missing` 与 `quote` 无判定规则
**Location**: `design.md:58-68`、`tasks.md:18`
`quote: { ... TQ skill get_more_info 当日字段 ... }` 是占位符：字段清单、单位、空值语义都没写，也没引用任何已存在 spec（TQ skill 的 `get_more_info` 契约在本仓 openspec 中不存在）。`missing: ["字段名 + 原因"]` 由 skill 侧自由拼装，无枚举、无来源、无「取值失败 vs 源无该记录」的区分规则，因此既不能测也不能被下游消费（F2.2 语料、后续统计都要读它）。
**Suggestion**: 把数据包提升为见诸 spec 的 schema：字段、类型、单位、`source`/`fetchedAt`、`missing` 的取值枚举与判定表（含 `available=false` 的语义）；引用 TQ skill 的字段来源（脚本 + 版本）；把「组装后的数据包必须通过 schema 校验」作为 skill 与验收的一项。

#### Issue 12 (Medium): 锚点形态 spec 与 design 不一致，HHmm 与交易日无约束
**Location**: `specs/daily-summary/spec.md:76`、`design.md:46-48`
spec 的锚点形态是四段式 `^ainote-<YYYYMMDD>-<代码>-<HHmm>`，design D-3 却引入「同分钟序号兜底」（如 `-0930-2`）与 change 4 卡片的 `(-<seq>)?` 形态混用，spec 未收编该形态 → 实现与验收无一致口径（change 4 的解析正则是否容忍该后缀也未说明）。另外 HHmm 取「写入时本地时间」，与 `tradeDate` 完全解耦：跨午夜/次日凌晨运行时，标题时间可能晚于该日所有卡片且属于次日，文档内按锚点排序会错乱；spec 也没规定锚点 HHmm 必须落在交易日盘后区间。
**Suggestion**: 统一锚点正则 `^ainote-<YYYYMMDD>-<代码>-<HHmm>(-<seq>)?$` 并写进 spec 与 change 4 解析契约；规定 HHmm 的来源（本地时钟，Asia/Shanghai）与跨午夜说明（锚点归属仍由 `YYYYMMDD` 决定），并补一条单测：23:59 与 00:05 运行两次不得产生两条附注。

#### Issue 13 (Medium): 附注元信息不可解析，缺失追溯字段
**Location**: `specs/daily-summary/spec.md:76`、`design.md:70-75`
`- dataSources: <skill/源 + 日期>` 是自由文本，无分隔符/无版本/无逐字段对应关系，无法据此复算或审计「哪一天、哪个源、哪次取数」；meta 行也没有 `tradeDate`、`code`、工具/skill 版本；`generatedAt` 只要求「带时区 ISO8601」，未规定时区（本地 `+08:00` 还是 UTC），与 change 4 卡片 `writtenAt` 的格式虽称「同格式」但无共享定义。删除-重算语义（`design.md:96-100`）也依赖这些字段做人工判断。
**Suggestion**: 把 meta 定为可解析的键值清单（`generatedAt`、`tradeDate`、`code`、`dataSources`（逐字段 `字段=源@日期`）、`missing`），规定时区为 `+08:00` 本地偏移，并写明与 change 4 `writtenAt` 共用同一格式化函数（放同一模块，避免两处实现漂移）。

#### Issue 14 (Medium): 合规约束不可执行，缺免责与输出定位
**Location**: `specs/daily-summary/spec.md:55-67`、`design.md:70-75`、`tasks.md:20`
「MUST NOT 出现确定性交易表述」仅以禁止词示例（必须买/满仓/稳赚）落在 prompt 里，无检查机制；`tasks.md:20` 只有「抽查一次真实输出（人工）」。词表遗漏常见变体（建议买入/目标价/可重仓/必涨/确定性加仓），也未要求附注含「研究辅助、不构成投资建议」的定位声明（AGENTS.md 安全红线要求输出为研究辅助）；「MUST NOT 改写或复述为用户主观判断」与「不评价用户主观记录」表述重叠且无判定示例。
**Suggestion**: 在 skill 正文给出正向写作骨架（事实 → 当日表现（含来源）→ 待跟踪）与负向清单（含变体词），要求附注固定含一行免责/定位声明；验收改为「对 N 份真实产出运行一次关键词扫描脚本 + 人工复核」，并在 tasks 里给出该脚本/命令与判定标准（例如零命中才算通过）。

#### Issue 15 (Medium): 部分失败与 `available=false` 语义缺失，且「删除即重算」是隐藏出口
**Location**: `specs/daily-summary/spec.md:50-53`、`design.md:79-88`、`design.md:98-100`
未定义：TQ 成功但 T1 失败时算失败还是产出带 `missing` 的部分附注；标的当日无涨停记录（T1 `available=false`，非取数失败）该如何表述；部分结果是否要在附注里标注「本附注为部分数据」。更麻烦的是幂等：一旦写入部分/错误附注，用户重跑只会得到 `skipped`，唯一修正途径是「自己删除附注」（`design.md:99` 承认），而这在 UI/skill 文案中没有任何指引；`review_append_ainote` 也无 `force`/`overwrite` 入参。
**Suggestion**: 在 spec 写明失败判定矩阵（TQ/T1 × available/error → created(部分,带 `missing` 标注) / failed）；附注正文固定含「数据完整性：完整|部分（缺 X）」一行；为工具增加显式 `force` 重算或至少在 skill 与返回信息中给出「如需重算请删除该附注分节后重跑」的指引与 block 引用；补两条单测。

#### Issue 16 (Medium): 未计频控预算，逐标的调用可能大面积失败
**Location**: `design.md:56`（D-5）、`specs/daily-summary/spec.md:38`
「逐标的取数、不做全市场扫描」不等于安全：data-tool-contract 的护栏含每源并发上限、最小间隔、单次调用标的数上限与**每源每交易日预算**（`data-tool-contract/spec.md:93-110`）。当日有 30 个有卡标的时，逐个调 T1 可能撞预算上限，导致后段标的全部 `failed`；spec 未要求预算预检、顺序节流、`offSession` 声明或分批策略。
**Suggestion**: 在取数与缓存 Requirement 中加：运行前查询/声明剩余预算与批量策略，超预算时显式提示「本次可处理前 N 个标的」并允许分批续跑；skill 写明节流与分批语义，并补一条「预算不足时行为显式且不静默排队」的验收。

#### Issue 17 (Medium): tasks 缺项与验收不可判定
**Location**: `tasks.md:5-6,10-14,19-21`、`proposal.md:30`
缺失：无 service 出口命名/注册项（spec:114 允许「工具或 service」，tasks 2.4 只说「service 出口」）；无「路径一律经 `src/paths/mapping.ts` 映射表、调用方 MUST NOT 自行拼接业务区路径」的要求（`data-root-layout/spec.md:35`），而 tasks 1.2/2.1 直接在描述里拼 `<数据根>/agent/skills`、`<YYYYMM>`；无 change 2/3/4 依赖与 blocked_by；无 roadmap/architecture 文档更新项（见 Issue 10）；验收项 4.1/4.4 无证据格式（命令/日志/产物路径）；`proposal.md:30` 引用「模块文档 §5 验收」但无文件路径与版本，不可核查。
**Suggestion**: 每条 task 补「产物 + 验收命令 + 证据落点」三列式描述；补 service key 与路径映射复用要求；把跨 change 依赖标进 tasks/openspec 依赖元数据；给 proposal 的验收引用补全路径（如 `docs/design/....md#5`）。

#### Issue 18 (Low): frontmatter 语义与下游语料复用未收口
**Location**: `specs/daily-summary/spec.md:86`、`review-card-store/spec.md:29`
附注与用户主观卡片同处一个 `subjective: true` + `patterns`/`drafts` 的文档（change 4 契约），而本 change 定位该文档是「F2.2 模式片段识别的唯一上游语料」（`proposal.md:5`）。spec 只要求「附注不计入用户卡片」，未要求后续语料/统计 ingestion 排除 `^ainote-`，也未说明附注是否影响 frontmatter 与「卡片数」口径。
**Suggestion**: 补一条 Requirement：一切下游解析（页面 B4、语料导出、统计、模式识别）MUST 以锚点前缀区分并默认排除 `^ainote-`；「卡片数」口径明确为「用户卡片数，不含附注」，并写成断言。

### Positive Aspects

- 分工边界清楚：扫描/解析/幂等/原子写归代码，叙述归 agent，并给出了工具入参与返回表（`design.md:30-40`），可直接转成工具 schema。
- 附注锚点前缀 `^ainote-` 与 change 4 的 `^card-` 分离，且 change 4 spec 已含「解析忽略 `^ainote-`」的口径（`review-card-store/spec.md:96,110`），跨 change 的形态约定是可对齐的（只差接口契约）。
- 「以文档为唯一事实源、不引入插件侧状态文件」的幂等思路（`design.md:44`）方向正确，避免了状态与文档不一致的经典缺陷；用户删除附注即重算的语义也符合「资产可生长」。
- 合规意识明确：禁止确定性表述、缺失不补猜、不改写用户主观记录都进了 spec 与 skill 约束（`spec.md:57`、`design.md:72-74`），并明确「任何交易语义不做」。
- Non-Goals/Open Questions 把 W6 汇总页、定时触发、模式识别、重算入口显式后置（`design.md:21-26,96-100`），范围收敛得比多数 change 好。

### Summary

Top 3 关键问题：
1. **Critical — 被复用的 change 4「存储实现」既无接口契约也无实现**（`src/review/*` 不存在，change 4 未完成），本 change 的前提与依赖声明不成立；
2. **Critical — 幂等前缀扫描未限定为 H2 标题行**，用户正文/引用命中即静默漏产出，且与「文档是事实源」的组合会永久固化错误结论；
3. **Critical — 输入枚举的交易日来源循环依赖**（T1 tradeDate 是逐标的取数结果，却在扫描前就需要日期），叠加非交易日/长假场景缺失与 change 4 `TradeDateResolver` 未复用，入口日期无事实源。

（紧随其后：T1 `tradeDate` 一致性无硬校验、TQ skill 路径「缓存零网络」不可验收、`failed` 三态无落点。）

补充限制：本会话 pwsh 被沙箱拒绝，且 `C:\Users\luoyu\AppData\Local\Programs\DeepSeek Harness\resources\app.asar\dsh` 路径在本沙箱不可见（glob 报路径不存在），故 Issue 8 中设计所引的宿主源码行号**未能独立复核**；已用同仓 `tq-skill-installer/design.md:7` 的引用做交叉比对，发现行号互斥。

**Consensus Status**: NEEDS_REVISION

---

## Round 2 — 2026-09-27

### Overall Assessment

Round 1 的 18 条被逐条改动，且这次是**实质改动而非措辞改动**：具名导出与 `§3`／change 4 spec 的「可复用写入接口契约」逐字一致，blocked_by + `DEPENDENCY_UNAVAILABLE` 把「复用」变成准入条件；受限扫描、零网络断言范围收窄、字节口径、失败矩阵、预算分批都落到了可写断言的程度。但「被依赖方是否真的提供该具名物」只核对了 store.ts 这一组：`src/review/format.ts`/`formatZonedIso`、路径互斥助手、剩余预算出口、运行摘要的生产者接口在被依赖侧或本 change 内**均不存在**，而运行摘要的三态编排按 tasks 3.2 仍留在 skill/agent 文本里——Round 1 的 Critical 症状在真实运行路径上只换了一个位置。另有幂等三处契约分叉（幽灵锚点告警无出口、归属校验基准不一致、T1 `available=false` 的 `dateUnavailable` 被并入 `noRecord`）会产出重复或错误结论。**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | 复用 change 4 是被虚构的实现 | 部分解决 | 具名化到位：`proposal.md:11,33`、`design.md:9,62-70`、`spec.md:394-398`、`tasks.md:13-17` 与 `review-card-store/spec.md:200-214`（含 `locateDoc`/`parseDoc`/`appendCard`/`appendAinote`/`scanDailyCardTargets` + `traderKit.review.*`）及 change 4 `tasks.md:63` 逐字一致；`blocked_by` + `DEPENDENCY_UNAVAILABLE` 已加。残余：`src/review/format.ts`/`formatZonedIso` 在被复用侧不存在（新增 20）、锁助手不存在（新增 26） |
| 2 | 幂等前缀扫描未限定作用域 | 已解决 | `design.md:72-76`（只认 `^##\s`、跳 fenced、归属校验、`normalizeCode`）+ `spec.md:350-360` 五条 + 场景 372-390（正文含锚点、代码块、异常代码形态、幽灵锚点）；用例 `tasks.md:80-89` ①–④ |
| 3 | 交易日来源循环依赖 | 已解决 | `design.md:78-80`（D-2b）+ `spec.md:51-82`：唯一走 T0 `traderKit.data.resolveTradeDate`、禁系统日期、禁用逐标的 T1 tradeDate 推导、四场景（含盘前/非交易日/有交易日无卡片/与 change 4 同一实现）、`tasks.md:94-97` 源码级+时钟篡改断言。残余见新增 28 |
| 4 | 缓存零网络不可断言 | 已解决 | `design.md:96-98` D-5b + `spec.md:90,99-107`：仅 T1/T2 侧自动断言，TQ 侧降级为 `fetchedAt`/`cacheReused` 人工证据；`tasks.md:113-115,144-147` 自动/人工分列——如实降级、不假装可断言 |
| 5 | 未校验 T1 `tradeDate` 一致性 | 已解决 | `spec.md:88,114-117`（硬门槛 `dateMismatch` → `missing`，MUST NOT 冒充）+ `spec.md:109-112` 显式传 `date`；用例 `tasks.md:85,136` |
| 6 | 字节级不变缺口径 | 已解决 | `design.md:104-112` D-6b + `spec.md:396,420-428`（前缀口径、EOL/BOM、frontmatter 值级最小修补、分节切片+前缀断言、三 fixture）；`tasks.md:76-78` |
| 7 | `failed` 三态无落点 | 部分解决 | 载体已有：`design.md:126-133` D-9 + `spec.md:253-281`（路径/schema/原子写/空清单）+ `tasks.md:90-93`。但运行摘要**无生产者出口**，`failed` 判定仍在 agent 文本（新增 19），故「失败必带原因」在真实运行中仍不可断言 |
| 8 | 宿主事实行号互斥 / rank 遮蔽 / health 重复 | 部分解决 | 行号已全删改符号（`design.md:16-27`）、已实测/待验证分节与降级策略（`design.md:14-28`）、遮蔽显式警告（`spec.md:434,448-451`）、health 并入 change 3（`spec.md:436`、`design.md:145-149`）。残余：change 3 的 `skill.status()`/`SkillStatus` 是 TQ skill 单实例视图，未登记自产 skill；核对未写 `cwd`（新增 27）。本沙箱仍不可达宿主 checkout，符号本身未能独立复核 |
| 9 | D-4 部署语义冲突、不可判定 | 已解决 | `design.md:86-90` D-4 + `spec.md:463-477`：不再自建覆盖逻辑，依赖 change 3 泛化；change 3 确有该能力（`tq-skill-installer/spec.md:227-237`、`tasks.md:147-149`、service `traderKit.skill.deployLocalDir`）。残余：版本载体与被引用接口名缺失（新增 24） |
| 10 | 与 roadmap 阶段路线冲突 | 已解决 | `proposal.md:36`、`design.md:5` 引用 `docs/roadmap.md §5`（已核验 §5 即迭代一重排）与 `§10`；`tasks.md:155-158` 登记四处文档改动并纳入门禁 |
| 11 | 数据包不是契约 | 已解决 | `spec.md:124-162` 字段/类型/单位/`missing` 枚举/`available=false` 语义/TQ 字段来源/`skillVersion` + 校验 requirement；单位口径与 `data-tool-contract/spec.md:64` 一致；`tasks.md:72-75,101-104`。残余仅写法歧义（新增 31a/31b） |
| 12 | 锚点形态 spec/design 不一致 | 已解决 | `design.md:84` 与 `spec.md:287-293` 同为正则 `^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$`，与 `§2`/change 4 同文；HHMM 来源、跨午夜归属、`tasks.md:86` 23:59/00:05 用例齐备。残余：序号语义（新增 32） |
| 13 | 附注元信息不可解析 | 部分解决 | `spec.md:322-348` 键表（`generatedAt`(+08:00)/`tradeDate`/`code`/`dataSources` 逐字段/`missing`）+ 可解析场景 + 单一来源结构断言。残余：被断言的「同一格式化函数」`src/review/format.ts` 在被复用侧不存在（新增 20） |
| 14 | 合规约束不可执行 | 已解决 | `design.md:114-120` D-7 + `spec.md:183-202`（骨架 + 9 词表含变体 + 定位声明 + 零命中判定 + 人工复核三证据）+ `tasks.md:109-112`（扫描脚本 `scripts/scan-compliance.mjs`） |
| 15 | 部分失败/`available=false`/隐藏重算出口 | 已解决 | `spec.md:204-232` 六行判定矩阵 + 「数据完整性」固定行 + block 引用重算指引 + `force` 后置且 schema 禁幽灵参数（`Open Questions 4`）；`tasks.md:105-108`。残余：T1 `dateUnavailable` 未分档（新增 29） |
| 16 | 未计频控预算 | 部分解决 | `design.md:92-94` D-5 + `spec.md:234-251`（预检、前 N 个、`deferred` 不计 failed、分批续跑、不静默）+ `tasks.md:117-120,148-151`。残余：所查预算接口未具名（新增 25）、摘要 schema 无 `deferred`（新增 23） |
| 17 | tasks 缺项与验收不可判定 | 已解决 | `tasks.md` 全量重写为产物/验收/依赖三要素 + `§0` blocked_by + 自动/人工分列 + evidence 格式；service key 与映射表复用要求已补（2.1/2.4）；仓外引用改为仓内 spec + `§n`。残余：service 注册归属（新增 33） |
| 18 | frontmatter 语义/下游语料复用未收口 | 已解决 | `spec.md:479-496` Requirement：一切下游默认排除 `^ainote-`、卡片数=用户卡片数、附注不改 frontmatter；场景 483-496 |

### Issues

#### Issue 19 (High): 运行摘要没有生产者出口，失败判定仍在 agent 文本里
**Location**: `design.md:122-133`（D-8/D-9）、`design.md:52-58`（D-1 仅三工具）、`tasks.md:90-93`（2.9）、`tasks.md:105-108`（3.2）、`spec.md:253-281`
D-9 定义了载体（路径 + schema + 原子写），但全 change 只有 `src/summary/run-report.ts` 这一个实现文件：D-1 的工具表只有 scan/read/append，`§3` 的 service key 也不含摘要出口，`proposal.md:29` 的新增代码清单同样没有工具/服务。而 TQ×T1 的失败判定按 `tasks.md:106` 属「编排逻辑（skill 步骤 + 工具返回契约）」即 agent 文本；真实运行时谁把 `failed[{code,reason}]` 写进 JSON 没有答案。于是 `spec.md:266`「三态并集 ⊇ 扫描清单」、`tasks.md:92`②、`tasks.md:70`「摘要 `failed[]` 含 `dependencyUnavailable`」都只有在单测直接调内部函数时才成立——Issue 7 的原始症状（失败只存在于对话文本）在真实运行路径上未消除，且与 D-1「机械不变量在代码层」冲突。另注：本 change 明令 agent 不得直接写文件（`spec.md:394`），所以「skill 顺手落摘要」也不成立。
**Suggestion**: 为运行摘要定义具名出口（如 tool `review_daily_run_report` + service `traderKit.summary.reportRun({tradeDate, created, skipped, failed, deferred})`），或把三态编排整体收进一个工具（run id + 幂等追加）；在 D-1 表与 `§0` 补该接口，并把 `spec.md:15`「三态与运行摘要文件一致」写成对同一次运行返回值的断言。

#### Issue 20 (High): `src/review/format.ts` / `formatZonedIso` 在被复用侧不存在
**Location**: `proposal.md:33`、`design.md:84,142`、`spec.md:133,328,343`、`tasks.md:15-16`；被复用方：`iteration-1-contracts §3`（67-88）、`review-card-store/spec.md:198-214`、`review-page/tasks.md` §1
全仓 grep `formatZonedIso` / `review/format`：**只在本 change 命中**。`§3` 的导出清单只有 `store.ts` 的五个函数；change 4 的 spec/tasks 没有 `format.ts`，没有时间格式化任务（`proposal.md:39` 的 change 4 新增代码清单也没有它）。因此「与卡片 `writtenAt` 共用同一格式化函数」「二者调用 `src/review/format.ts` 的同一导出」两个 requirement/场景（`spec.md:328,340-343`）没有可指认的对方，属 Round 1 Issue 1 的同根因（无具名对应物的复用），且 `tasks.md:15-16` 已把它写成 `blocked_by: change 4` 的准入条件——该条件永远不会满足。
**Suggestion**: 二选一并同步两侧：① 在 change 4 spec 的「可复用写入接口契约」与 tasks 增列 `src/review/format.ts`（`formatZonedIso(date) -> string`，`+08:00`）为契约导出 + 实施任务；② 该格式化落本 change（如 `src/summary/format.ts`），并在 spec 写明「change 4 的 `writtenAt` 复用同一实现」需由 change 4 反向引用（否则仍是单向虚构）。

#### Issue 21 (Medium): 幽灵锚点的 `storeWarnings[]` 在 `§3` 里没有出口
**Location**: `spec.md:357`（幂等 rule 4）、`spec.md:387-390`（场景「幽灵锚点不静默」）、`tasks.md:52,84`；对方：`review-card-store/spec.md:205`（`parseDoc` 签名）、`§3:77-78`（`scanDailyCardTargets` 返回项）、`design.md:182`（Open Questions 9）
`§3`/change 4 的 `parseDoc(path)` 返回 `{frontmatter, cards, ainotes, eol, bom}`——**没有 warnings**；且 change 4 的解析规则已按 frontmatter 把幽灵锚点从 `ainotes` 里过滤掉，本 change 用 `parseDoc` 根本看不到它。`scanDailyCardTargets` 的返回项是 `{code,name,path,cardCount,hasAinote}`，也没有 warnings（只有 `locateDoc` 返回 `warnings`）。于是「不一致 SHALL 记入 `storeWarnings[]`」这句在本 change 无数据来源，`tasks.md:52`（scan 返回 `storeWarnings[]`）与 `tasks.md:84`④的断言无从实现；是否落运行摘要还挂在 Open Question 9。
**Suggestion**: 在 `§3`/change 4 契约为 `parseDoc`（或一个具名 `scanAinotes`）定义 `warnings` 字段与幽灵锚点条目形态，并在 change 4 增对应任务；或把「幽灵锚点告警」明确划归 change 4/页面路径，从本 change 的 requirement 与 2.1/2.8④ 中删除，另行说明本 change 只消费达标分节。

#### Issue 22 (Medium): 归属校验基准不一致 → 同一幂等键可产生第二条附注
**Location**: `spec.md:357`（rule 4：目标交易日 + 入参 `normalizeCode(code)`）vs `iteration-1-contracts §2:62-63` 与 `review-card-store/spec.md:118`（锚点日期段 == **frontmatter** `tradeDate`、代码段 == **frontmatter** `code`）；`spec.md:295`（跨午夜说明）
两处基准不同源。实现按 `spec.md:360` 必须用 `parseDoc`，而 `parseDoc` 的判定基准是 frontmatter；当文件名/目标日与 frontmatter 不一致（多命中取错文档、用户改写 frontmatter、跨日改名）时，目标键的既有附注会被 change 4 当幽灵排除，本 change 按「目标交易日」又判定为已存在——两个基准分叉，结果可能是**追加第二条同键附注**，与 `spec.md:295`「同一幂等键下出现两条附注只能由用户删除造成」直接冲突。
**Suggestion**: 指定唯一基准（建议：以 fallback 顺序「frontmatter → 目标交易日」显式写明，并声明不一致时以哪个为准），补一条「frontmatter `tradeDate`/`code` 与文件名不一致」的用例，断言不产生第二条附注且输出显式告警。

#### Issue 23 (Medium): 运行摘要 schema 没有 `deferred`，与预算分批要求互相矛盾
**Location**: `spec.md:257-259`（schema 只有 `tradeDate/created/skipped/failed`）vs `spec.md:236-241`（被截断项记 `deferred`、不计 `failed`）、`tasks.md:119,150`（4.7 断言「`deferred` 与 `failed` 在摘要中分列」）
预算分批要求的状态在摘要 schema 里无处安放，2.9 与 3.5/4.7 的验收断言不可同时成立。
**Suggestion**: schema 增 `deferred[{code, reason}]`（或把三态改为 `{code, status, reason}` 列表并保留 `created/skipped/failed` 视图），并同步 `spec.md:257-259,266`、`tasks.md:90-92,117-120,150`。

#### Issue 24 (Medium): 部署三态缺版本载体，且未引用 change 3 的具名出口
**Location**: `spec.md:463-477`（部署语义）、`spec.md:432`（frontmatter 只要求 `name`/`description`）、`design.md:86-90`、`tasks.md:33-36`；对方：`tq-skill-installer/spec.md:229-237`、`tq-skill-installer/tasks.md:147-149`
change 3 的本地目录源三态判据是「目标存在、内容不同、且**源版本 > 目标版本**」→ `upgradable`，能力挂在 `syncLocalDir(input)`（`src/skill/local-source.ts`）与 service key `traderKit.skill.deployLocalDir`。本 change 的 `SKILL.md` frontmatter **不含 `version`**，而场景（`spec.md:472`）与 `tasks.md:35` 都要求「源已升级 → 原子替换并记录新旧版本」，判定所需元数据缺失 → 升级态不可复现（可能永久停在 `user-modified`），1.2 的自动三态验收不成立。另外全文只写「依赖 change 3 安装器泛化」，未写出上述模块路径/签名/service key，违反本 change 自己引用的 `§0`（contracts 18-19）具名纪律。
**Suggestion**: skill frontmatter 增 `version`（写入 `spec.md:432` 与 1.1 验收），D-4/1.2/部署语义改为引用 `traderKit.skill.deployLocalDir` + `syncLocalDir(input)` 与三态枚举名 `in-sync`/`user-modified`/`upgradable`。

#### Issue 25 (Medium): 预算预检要查的接口未具名
**Location**: `spec.md:236`（「查询 change 2 数据模块当日剩余预算与批量硬上限」）、`tasks.md:117-120`（3.5）；对方：`data-foundation` 侧无该出口
change 2 只有护栏默认值（`data-tool-contract/spec.md:168-186`，预算按列表级请求数、超限显式失败）与一个未具名的 scenario（`spec.md:284`「查询当日预算用量与 guard 出站计数」）；没有任何 service key/tool/schema 用于**预检剩余预算**。本 change 却要求据此写自动用例（`tasks.md:119`②③：预算仅够 N → 前 N 个、耗尽 → 显式失败且不等待），接口不可指认 → 与 Round 1 Issue 1 同类。
**Suggestion**: 在 `§9` 或 change 2 增列具名出口（如 `traderKit.data.guardStatus() -> {budget, used, remaining, batchLimit, concurrency, minIntervalMs}`）+ 任务与用例，本 change 引用之。

#### Issue 26 (Medium): D-11 引用不存在的锁助手；「全仓仅一处原子写」在同一 change 内自相矛盾
**Location**: `design.md:143`（D-11：复用 change 4 导出的「同一路径互斥助手（具名导出）」）、`tasks.md:62`（2.3①）、`tasks.md:90`（2.9 摘要原子写）
`§3`/change 4 未导出任何锁/互斥助手（只有 store.ts 五函数，`§5` 只写纪律不写导出）→ D-11 的复用对象不存在，运行摘要写入的互斥语义无实现来源。同时 2.3① 的结构断言是「全仓仅一处原子写/追加实现」（change 4 `tasks.md:65` 也这么写），而 2.9 明确新增第二处原子写（临时文件 + 改名，还要求「不与业务文档同锁」）→ 该断言在实现后必然失败，属不可验收。
**Suggestion**: 要么在 `§3`/change 4 增列锁助手导出（如 `withPathLock(absPath, fn)`）并同步 change 4 tasks；要么删去 D-11 的复用句、把 2.3①（及 change 4 1.12）改写为「**文档**写入全仓仅一处实现（`src/summary/run-report.ts` 的 JSON 原子写除外）」，并在 spec 写明摘要锁用路径级互斥的不同实现是可接受的。

#### Issue 27 (Medium): 可发现性核对缺宿主调用契约（`cwd`），并入 change 3 未在 change 3 侧登记
**Location**: `spec.md:430-461`（尤其 434/443-446）、`tasks.md:41-44`（1.4）、`design.md:145-149`（D-12）；对方：`tq-skill-installer/spec.md:261-269,384-387`
change 3 的实测结论是「**MUST 按宿主签名传 `cwd`**（不传 `cwd` 时宿主不扫 rank 100 项目根，核对结果无意义）」，且遮蔽警告须含遮蔽者路径/rank/版本、候选根至少覆盖 `.dsh/skills`、`.agents/skills`、`extraSkillRoots` 与 `list()` 赢家。本 change 的核对只写「`ctx.get('skills')` 的 `list()`/`get()`」，对 `cwd`、候选根、遮蔽者清单一字未提 → rank 100 同名副本的遮蔽很可能漏报，正是 Issue 8 要闭合的风险。此外 change 3 的 `skill.status()`/`SkillStatus` 是 TQ skill 单实例视图（`spec.md:384-387`），其 spec/tasks 未见「覆盖 localDir 部署的自产 skill」的登记，而本 change 又禁止自建状态出口（`spec.md:436`）→ 该提示的归属真空。
**Suggestion**: 核对调用写明 `cwd` 与候选根，直接复用 change 3 的 discovery 具名导出（而非另写 `list()` 比对）；并在 change 3 spec/tasks 登记「状态视图覆盖 localDir 自产 skill（含 `not-discovered`/`shadowed` 两类警告）」。若 change 3 不接，本 change 应保留只读核对代码并明确其输出位置（不叫「健康出口」）。

#### Issue 28 (Medium): 「非交易日/长假」这一态不可判定
**Location**: `spec.md:22-25,64-67,74-77`（三态可区分）、`spec.md:56`（MUST NOT 把 `null` 当非交易日）、`proposal.md:34`；对方：`trade-date-tool/spec.md:48-70`、`§1:41-42`
T0 的 `isTradingDay ∈ {true, null}`，`null` 同时覆盖长假、盘前未出数、历史请求、源滞后；可判定的只有「`businessDate===null` → 不可得」与「`businessDate!==null && isTradingDay===null` → 归属待确认」。spec 一方面禁止把 `null` 当「非交易日」结论，一方面又把「非交易日/长假」列为独立可区分的返回态并写进 proposal 验收要点 → 第三态不可证，场景 64 与场景 69（盘前）在返回签名上无法区分。
**Suggestion**: 把返回态统一为「交易日不可得（盘前/源未出数）」「归属待确认（业务日 X、限流日 Y）」「该交易日无卡片」，删去「非交易日/长假」这一不可判定命名（或等交易日历就绪后再引入），并同步 `proposal.md:34` 的验收要点。

#### Issue 29 (Medium): T1 `available=false` 的两种语义被合并，`errors[]` 又被裁掉
**Location**: `spec.md:137`（`limitReason` 裁剪字段清单**不含 `errors`**；判定「`available=false` = 该标的无涨停记录」）、`spec.md:210-215`（矩阵第二行）、`spec.md:154-157`；对方：`§1:31-33`（`requestedDate !== rateLimitDate` 时 MUST NOT 用 List 数据，返回 `available=false` + `errors:[dateUnavailable]`）、`limit-reason-tool/spec.md:5`（返回体含 `errors[]`）
T1 的 `available=false` 至少有两义：「该标的当日无涨停记录」（`noRecord`）与「该日 History 无数据/日期不可用」（`errors:[dateUnavailable]`）。本 change 把 `errors` 从裁剪结果里丢掉，判定规则与矩阵把 `available=false` 一律按 `noRecord` 处理（非失败、照常产出并标「无涨停记录」）→ 会把「该日数据不可得」写成「该标的当日无涨停记录」，产生**误导性结论**（与 Round 1 Issue 3 同类的错归属，只是换了入口）。显式传 `date` 走 History 路径时（历史补写、长假）正是这条分支。
**Suggestion**: `limitReason` 裁剪纳入 `errors[]`，判定表增分支：含 `dateUnavailable` → `missing{reason: sourceUnavailable}`（或 `dateMismatch`），正文写「该日涨停原因数据不可得」，MUST NOT 写「无涨停记录」；补一条「History 空 + `dateUnavailable`」用例。

#### Issue 30 (Low): `§9` 被当作 temp 区的事实源（应为 `§10` + `data-root-layout`）
**Location**: `proposal.md:14`、`design.md:130`、`spec.md:261`、`tasks.md:93`
contracts `§9` 是「缓存层级与预算」，不含 temp 路径；temp 区定义在 `§10:148` 与 `data-root-layout/spec.md:34`（`agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/`）。四处误引削弱「唯一事实源」纪律（同文件其他地方引 `§10` 是对的）。
**Suggestion**: 统一改为 `§10` + `data-root-layout` 映射表，并顺带说明该区语义是「数据工具缓存产物」，运行摘要借用同一目录是否需在映射表登记。

#### Issue 31 (Low): spec 内部三处写法矛盾
**Location**: `spec.md:137`、`spec.md:135-136`、`spec.md:324-338`
(a) `limitReason` 行的条件写成「`tradeDate !== tradeDate`」自比较（正文 `spec.md:88` 才是 `limitReason.tradeDate !== 目标交易日`）；(b) 同表「`available=false` 时 `fields` 值为 `null`」与「每字段 `{value, source, fetchedAt}`、`value=null` 时登记 `missing`」两种写法并存 → `package-schema.ts`（`tasks.md:72-74`）无法判定非法样本，且 `fields` 为 `null` 时「逐字段登记 missing」无字段名可枚举；(c) 键表列 6 键（含 `cacheReused`）而场景 338 断言「五个必填键」，而 `spec.md:107` 又要求 TQ 路径标注 `cacheReused` → 必填性未定。
**Suggestion**: 逐处订正为唯一写法：`limitReason.tradeDate !== tradeDate(目标)`；`available=false` 时 `fields` 保持对象形态、各字段 `value=null` + `source=null`；明确 `cacheReused` 是否必填（建议必填，无 TQ 路径时写 `none`）。

#### Issue 32 (Low): 同分钟序号语义与其唯一触发场景矛盾
**Location**: `spec.md:293,295,312-315`、`design.md:84`
幂等命中前缀即 `skipped`（`spec.md:358`），所以能写第二条的唯一路径是「前一条被用户删除」；但删除后前缀扫描为空、没有既有序号可「+1」，而「`seq` 首条不出现」又要求新锚点不带序号——场景 312 却断言新锚点形如 `-0930-2`，该场景按现规则不可达（对卡片成立，对附注不成立）。
**Suggestion**: 明确序号的真实来源（如按运行内已分配序号、或按「同分钟已删除锚点的历史」不可得则明确不保证），并把场景 312 改为可达路径（删除 + 同分钟重算 → 无 `seq`），或注明 `-<seq>` 仅用于 change 4 卡片。

#### Issue 33 (Low): `traderKit.review.*` 的注册归属矛盾
**Location**: `tasks.md:64`（2.4「service 出口注册：service key 与 `§3` 一致（`traderKit.review.*`）」）、`tasks.md:68-70`（2.5 假设该 service 未注册）、`spec.md:410-413`；对方：change 4 `tasks.md:63`（由 change 4 注册 5 个 key）
同一组 key 被两处登记：change 4 的 1.12 明确由其注册；本 change 2.4 又要求注册同键。若本 change 重复注册，2.5 的「注入空 service 容器 → 返回 `DEPENDENCY_UNAVAILABLE`」前提不成立；若不注册，2.4 的产物描述错误。
**Suggestion**: 本 change 只注册自己的出口（工具 + 摘要/服务，建议独立命名空间如 `traderKit.summary.*`），`traderKit.review.*` 一律只读自 change 4；把 2.4 的措辞改为「消费 change 4 的 service，不重复注册」。

### Positive Aspects

- 处置表可核验：`locateDoc`/`parseDoc`/`appendCard`/`appendAinote`/`scanDailyCardTargets` 与 service key 和 change 4 spec「可复用写入接口契约」（`review-card-store/spec.md:200-214`）、change 4 `tasks.md:63` **逐字一致**，并配 `blocked_by` 与 `DEPENDENCY_UNAVAILABLE` 显式失败——Round 1 最重的「虚构复用」被改成了可指认的依赖。
- 幂等收窄做得很实：H2-only + fenced 跳过 + `normalizeCode` + 归属校验 + 幽灵锚点告警，并给出「正文含锚点」「代码块内锚点」「异常代码形态」「幽灵锚点」四条独立场景与用例（`spec.md:350-390`、`tasks.md:80-89`），正是漏产的根因处。
- 主动降级不假装：TQ 侧零网络明确改为人工证据（`design.md:96-98`、`spec.md:90,104-107`），并禁止在文档中声称可自动断言——这是评审里少见的「宁愿少断言也不虚构断言」。
- 字节口径可写断言：分节切片 + 文件前缀 + CRLF/BOM/无尾换行三 fixture（`spec.md:420-428`、`tasks.md:76-78`），并明确 MUST NOT 只做整文件包含/长度比较。
- 失败与预算不再是「自觉」：六行判定矩阵 + 固定「数据完整性」行 + 重算指引 + `deferred` 状态 + 「不静默排队」，且 `force`/`refresh` 等幽灵参数被明确禁用（`spec.md:204-251`）。
- 事实纪律改善：宿主事实去行号改符号名、拆「已实测/待验证」并各带降级策略（`design.md:14-28`），tasks 重写为产物/验收/依赖三要素并区分自动/人工证据（`tasks.md:3-9,186-188`）。
- 跨 change 依赖这次大体对得上：change 3 确有 localDir 泛化与 `deployLocalDir`（`tq-skill-installer/spec.md:227-237`），change 4 确有 T0 复用（`§1`）与两段视图，未发现上一轮那种「对方根本不存在」的整体性虚构。

### Summary

Top 3 关键问题：
1. **High — 运行摘要只有载体没有生产者**：`src/summary/run-report.ts` 无工具/service 出口，TQ×T1 失败判定按 `tasks.md:106` 仍在 skill/agent 文本，`created+skipped+failed ⊇ 扫描清单`、`failed[].reason` 非空、`dependencyUnavailable` 入摘要三条断言在真实运行中无调用方（Issue 7 只闭合了一半，新增 19）。
2. **High — 被断言的共用格式化函数在被复用侧不存在**：`src/review/format.ts`/`formatZonedIso` 全仓仅在本 change 出现，`§3` 与 change 4 spec/tasks 均无此导出/任务，而 `tasks.md:15-16` 已把它写成 `blocked_by` 准入条件（Issue 1/13 残余，新增 20）。
3. **Medium — 幂等与取数三处契约分叉会产出重复或错误结论**：幽灵锚点 `storeWarnings[]` 在 `§3` 无出口（新增 21）、归属校验基准 frontmatter vs 目标交易日不一致可追加第二条附注（新增 22）、T1 `available=false` 的 `dateUnavailable` 被并入 `noRecord` 会写出「无涨停记录」（新增 29）。

紧随其后：预算预检接口未具名（25）、摘要 schema 缺 `deferred`（23）、部署三态缺 `version` 载体且未引用 `deployLocalDir`（24）、D-11 锁助手不存在且「全仓仅一处原子写」自相矛盾（26）、可发现性缺 `cwd` 且并入 change 3 未在 change 3 侧登记（27）。

核验限制：本会话 pwsh 被沙箱拒绝，宿主 checkout（`…\app.asar\dsh`）仍在沙箱内不可见（glob 报 `os error 3`），故 Issue 8/27 涉及的宿主符号（skill 根解析、frontmatter 校验段、`skills` 服务定义段）**未能独立复核**；本节对 change 2/3/4 与 `docs/` 的判断均基于本仓可读文件（`iteration-1-contracts`、`data-foundation`、`tq-skill-installer`、`review-page`、`docs/roadmap.md §5`）。本轮只写入 `reviews/daily-summary-review.md`，未改动任何 change 文件或其它文件。

**Consensus Status**: NEEDS_REVISION

---

## Round 3 — 2026-09-27

### Overall Assessment

Round 2 的两条 High 这次是**双向核验过的真闭合**：运行摘要有了具名生产者（tool `review_daily_report` / service `traderKit.review.dailyReport`，入参四态 `entries`、返回四态并集 + `missing` + `warnings`，见 `design.md` D-1 表 59、`spec.md:274-333`、`tasks.md:110-113`、`proposal.md:14`，且 `tasks.md:38` 要求 SKILL 收尾必须调用该出口）；`src/review/format.ts` 在被复用侧**确实已定义**（`review-card-store/spec.md:255-276` 新增 Requirement + `review-page/tasks.md:67-70` 1.13 + `design.md` D-19）——Round 2 的两条"被依赖方不存在"已消除。另外 #23（`deferred` 入 schema）、#24（`version` 载体 + `deployLocalDir`/`syncLocalDir` 具名）、#28（三态命名，禁用「非交易日/长假」）、#29（spec 侧 `dateUnavailable` 三档）、#33（只注册自有出口）均可用正文逐条指认，不再是措辞改动。

但本轮逐条核验发现三类**规格级**残余：① 运行摘要出口的入参只有 `{tradeDate, entries}`，而 `missing[]`/`warnings[]` 既在 schema、又在返回与场景（`spec.md:281,284-296,330-333`）中要求有值——没有入参通道，这两个最有价值的字段无法被生产者填充；同一条 Requirement 又声明"`⊇ 扫描清单` 由出口自身完成"，而出口手里没有扫描清单（`tasks.md:112` 实际把该断言放在测试里）。② 预算预检出口 `traderKit.data.guardStatus()` 在 change 2 的 spec/tasks/design/proposal 与 `iteration-1-contracts §9` 中**均不存在**（全仓仅 daily-summary 自己引用），且其"登记请求"指向不存在的 `design Open Questions 13`——预算预检这条 Requirement 与 3.5/4.7 的自动验收仍不可实施。③ 幂等契约三处残差：归属基准 spec（`spec.md:409` 目标交易日）与 design/proposal/tasks（frontmatter）仍分叉（Round 2 #22 未闭合）；`spec.md:409,442` 仍把幽灵字段写成 `storeWarnings[]`（本 change tasks 2.1/2.8 明令禁用、proposal 自称不存在）；`spec.md:345,347,364-367` 要求生成 `-<seq>`，而 `design.md:85` D-3 与 `tasks.md:98` 2.8⑨ 明令附注 MUST NOT 产生序号。此外 `spec.md:460`「全仓仅一处原子写/追加实现」与 D-9/2.9 强制的摘要第二处原子写正面互斥（`tasks.md:71` 已改，spec 未改），结构断言实现后必然失败。

证据面另有短板：`tasks.md`/`proposal.md` 三处引用 `design Open Questions 12/13/14`，而 `design.md` 只有 Open Questions 1–11；本 change 也**没有 Round 2 处置表**（同批 `data-foundation/proposal.md:7` 明载"处置表见 design.md 末尾（Round 1 / Round 2 两节）"）——说明 design.md 的 Round 2 修订是局部落地的，跨 change 登记项没有可落位置。日期格式唯一口径、TQ 侧零网络如实降级、`force`/`overwrite` 幽灵参数封禁、字节口径这些 Round 1/2 成果本轮复核仍然成立。**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | 复用 change 4 是被虚构的实现 | 已解决 | 两侧对得上：`review-card-store/spec.md:205-253`（五导出 + `warnings` + `DOC_MISMATCH`）、`review-page/tasks.md:63-74`（1.12/1.13/1.14）、`design.md` D-19/D-20/D-21；本 change D-1/D-1b + `tasks.md:13-22` 逐字引用。Round 2 残余的 `format.ts` 已补（见 #20）；残留只剩 D-11 的锁助手（见 #26） |
| 7 | `failed` 三态无落点 | 已解决 | 载体 + 生产者齐备：`design.md:127-134`（D-9）、`spec.md:274-333`、`tasks.md:102-104,110-113`、`design.md:52` D-1 表第 4 行、`proposal.md:14`。残余转入新 Issue 1（`missing`/`warnings` 无入参通道） |
| 8 | 宿主事实行号互斥 / rank 遮蔽 / health 重复 | 已解决 | 行号全删改符号（`design.md:16-28`）、遮蔽警告齐备（`tasks.md:50,52`：`cwd` 必传 + 候选根 + 遮蔽者路径/rank/版本 + 服务不可用降级）、health 并入 change 3 且 change 3 确已登记（`tq-skill-installer/spec.md:318,330,455-462`、`tasks.md:68` 含 change 5 形态 fixture）。残留：`checkDiscovery` 形参名（见 Issue 8） |
| 13 | 附注元信息不可解析 | 已解决 | `spec.md:374-400` 键表（六键含 `cacheReused`）+ 可解析/单一来源/逐字段可追溯三场景；被断言的 `src/review/format.ts` 已在 change 4 落地（`review-card-store/spec.md:255-271`） |
| 16 | 未计频控预算 | **未解决** | 语义已收窄（`spec.md:255-272`：预检、前 N 个、`deferred` 不分 `failed`、不静默），但预检所查接口在 change 2 侧不存在（见 Issue 2），3.5/4.7 的自动验收无出口可指认 |
| 19 | 运行摘要没有生产者出口 | 已解决 | `design.md:52,59`（D-1 表）、`spec.md:274-333`（新 Requirement + 8 场景）、`tasks.md:110-113`（2.11 含 `⊇ 扫描清单`/`reason` 非空/合并幂等/`DEPENDENCY_UNAVAILABLE`/绕过结构断言）、`proposal.md:11,14`、`tasks.md:38`（SKILL 收尾必须调用）。残余转入新 Issue 1 |
| 20 | `src/review/format.ts` / `formatZonedIso` 在被复用侧不存在 | 已解决 | 被复用侧**确已定义**：`review-card-store/spec.md:255-276`（新 Requirement + 2 场景）、`review-page/tasks.md:67-70`（1.13）、`review-page/design.md` D-19、`proposal.md:41`；本 change 引用一致（`spec.md:147,380,392-395`、`design.md:85`、`tasks.md:16-17,28`）；change 4 侧还把 `formatAnchorTime` 与标题 `HH:mm` 收成同源 |
| 21 | 幽灵锚点 `storeWarnings[]` 无出口 | 部分解决 | 出口有了（`§12.7` + `review-card-store/spec.md:211,213,245-248,410-433` 五导出 `warnings: string[]` + `[ghostAnchor]` 编码 + `tasks.md:73`），但**本节正文仍写幽灵字段名**（`spec.md:409,442`），与 `tasks.md:61,63,93` 的"MUST NOT 出现 `storeWarnings[]`"直接冲突（见 Issue 4） |
| 22 | 归属校验基准不一致 | **未解决** | design D-2④（`design.md:75`）、proposal（`proposal.md:13`）、tasks 2.8⑦（`tasks.md:96`）均为「基准 = frontmatter」，而验收源 `spec.md:409` 仍写「日期段 == **目标交易日**折算的 `YYYYMMDD`」——分叉原样保留（见 Issue 3） |
| 23 | 摘要 schema 缺 `deferred` | 已解决 | `spec.md:284-296` schema 含 `deferred[{code,reason}]`；`tasks.md:102,104`（2.9）、`tasks.md:110-112`（2.11 返回四态并集）、`spec.md:236` 矩阵行、`tasks.md:166`（4.7 分列断言）齐备 |
| 24 | 部署三态缺版本载体 / 未引用具名出口 | 已解决 | `SKILL.md` frontmatter 增 `version`（`tasks.md:38`、`spec.md:156`、`proposal.md:9`）；改引 `syncLocalDir` / `traderKit.skill.deployLocalDir` 与三态枚举（`design.md:89`、`tasks.md:42-45`）；对方确有该能力且判据含版本比较（`tq-skill-installer/design.md:245-253`、`spec.md:280`） |
| 25 | 预算预检接口未具名 | **未解决** | 名字有了（`traderKit.data.guardStatus()`，`design.md:38,68`、`spec.md` 预算 Requirement、`tasks.md:26,77`、`proposal.md:15,31`），但 change 2 四文件与 `contracts §9` **零命中**；登记请求指向不存在的 `design Open Questions 13`（见 Issue 2） |
| 26 | D-11 锁助手不存在 / 「仅一处原子写」自相矛盾 | 部分解决 | 自相矛盾在 tasks 侧已修（`tasks.md:71` 2.3① 改为「文档写入仅一处，`src/summary/run-report.ts` 的 JSON 原子写为唯一例外」），但验收源 `spec.md:460` 未同步、仍断言"全仓仅一处原子写/追加实现"（见 Issue 5）；D-11（`design.md:144`）仍要求复用 change 4 的"同一路径互斥助手（具名导出）"，而该导出在 `§3`/`§11`/change 4 spec-tasks 中不存在（见 Issue 7） |
| 27 | 可发现性缺 `cwd` / 并入 change 3 未登记 | 部分解决 | `cwd` 必传、候选根、遮蔽者路径+rank+版本、降级分支均已写（`tasks.md:50-53`）；change 3 侧确已登记覆盖 localDir 自产 skill（`tq-skill-installer/spec.md:318,330,462`、`tasks.md:68`）。残余：`checkDiscovery` 形参名过期（见 Issue 8） |
| 28 | 「非交易日/长假」不可判定 | 已解决 | `design.md:81` D-2b + `spec.md:57-89`：三态唯一命名（交易日不可得 / 归属待确认 / 该交易日无卡片）、MUST NOT 引入「非交易日/长假」；`proposal.md:34` 验收要点同步 |
| 29 | T1 `available=false` 两义合并 | 部分解决 | 验收源已闭合：`spec.md:97`（`errors[]` 必须保留）、`spec.md:151` 三档判定、场景 `spec.md:128-131,173-176`、矩阵行 `spec.md:230-232`、`tasks.md:97` 2.8⑧。残余：`design.md:138` D-10 仍无条件写"T1 `available=false` 属 `noRecord`（不是失败）"，与 `§12.8`/spec 三档矛盾（见 Issue 7） |
| 30 | `§9` 被当作 temp 区事实源 | 部分解决 | `spec.md:282`、`proposal.md:14`、`tasks.md:102,105` 已改 `§10`；`design.md:131` D-9 仍写"沿 `§9` 的 temp 区约定"（见 Issue 7） |
| 31 | spec 内部三处写法矛盾 | 部分解决 | (a) 自比较已修为 `limitReason.tradeDate !== 目标交易日`（`spec.md:151`）；(b) `available=false` 时 `fields` 保持对象形态已写死（`spec.md:149,166`）；(c) 残余：`spec.md:154`⑤ 称 `cacheReused` 为必填键、`spec.md:390` 场景却只断言"五个必填键"（`proposal.md:12` 称六键），必填口径仍不唯一（见 Issue 7） |
| 32 | 同分钟序号语义矛盾 | **未解决** | 矛盾升级为 spec ↔ design/tasks 对立：`spec.md:345`（可选序号、第二条起 `2`）、`spec.md:347`（"扫描同前缀既有锚点取最大序号 +1"）、场景 `spec.md:364-367`（删后重算 → 新锚点 `-0930-2`）要求生成序号；`design.md:85` D-3 与 `tasks.md:98` 2.8⑨ 明令附注 MUST NOT 产生 `-<seq>`；且唯一触发场景（前一条被删）使"取最大序号 +1"无既有锚点可依（见 Issue 6） |
| 33 | `traderKit.review.*` 注册归属矛盾 | 已解决 | `tasks.md:73`（2.4）明确"只注册自己的出口（`review_daily_report` / `traderKit.review.dailyReport`），change 4 五键只消费、不重复注册"；与 `§11`/`§12.6`、`review-page/tasks.md:63` 一致；2.5 的空容器前提因此自洽 |

### Issues

#### Issue 1 (Medium): 运行摘要出口的 `missing[]` / `warnings[]` 没有入参通道，且「并集 ⊇ 扫描清单」的断言归属不可实现
**Location**: `spec.md:279-282`（入参仅 `{ tradeDate, entries: [{code,status,reason?}] }`；返回含 `missing[]`/`warnings[]`）、`spec.md:284-296`（schema 含 `missing`/`warnings`）、`spec.md:300-303`（"该断言由出口自身完成"）、`spec.md:330-333`（store 告警 SHALL 进摘要 `warnings[]`）、`tasks.md:102-104`（2.9 schema 同）、`tasks.md:110-112`（2.11 入参/返回）、`design.md:59`（D-1 表）
出口是唯一生产者，但其入参里既没有 `missing[{code,field,reason}]`（`tasks.md:69` 只把 `missing` 作为 `review_append_ainote` 的"内部"入参），也没有 change 4 导出的 `warnings`；`spec.md:281` 要求 `warnings` 是"本次运行内 change 4 五个导出返回的 `warnings[]` 汇总去重"，但没有任何字段把这两类信息交给该出口，`design.md:59` 也没声明它自己去调 change 4 的读接口。结果：schema 与返回中的 `missing`/`warnings` 在真实运行中只能是空数组，`spec.md:330-333` 的场景不可达（与 Round 2 #23「`deferred` 无处安放」同型，只是这次落在 `missing`/`warnings` 上）。同一条 Requirement 的 `spec.md:303`（"由出口自身完成，不依赖 agent 文本复述"）也无法成立：出口手里没有扫描清单，而 `tasks.md:112`① 实际把该断言写在测试里（桩扫描清单 → 提交 entries → 测试比对）。
**Suggestion**: 在 `review_daily_report` 入参补 `warnings?: string[]` 与 `missing?: [{code,field,reason}]`（或让出口按 `tradeDate` 自行调用 `scanDailyCardTargets` 并声明该依赖），并把 `spec.md:303` 改为"由该出口的自动化用例断言（扫描清单作为桩/入参注入）"，使断言主体与入参能力一致。

#### Issue 2 (Medium): 预算预检出口 `traderKit.data.guardStatus()` 无所有者，登记请求指向不存在的 Open Questions 13
**Location**: `design.md:38,68`、`proposal.md:15,31`、`tasks.md:26,77,133-136`（3.5/4.7）；对方：`data-foundation` 全部文件与 `iteration-1-contracts §9`
全仓 grep `guardStatus`：**仅本 change 命中**。change 2 只定义了护栏默认值（`data-foundation/design.md:83,87`、`data-tool-contract/spec.md:198-204`）与一个未具名场景（"查询当日预算用量与 guard 出站计数"，`spec.md:307-310`），没有 service key/tool/schema 可用于**预检剩余预算**；`contracts §9` 也只有规则、没有出口。D-1b 又禁止本 change 自建预算计数——于是预算预检要么永远报 `DEPENDENCY_UNAVAILABLE`（则 `spec.md:255-272` 的预检/前 N 个/deferred 全线失效），要么只能自实现（违反 D-1b）。`tasks.md:26` 把该缺口登记为"design Open Questions 13"，而 `design.md` 的 Open Questions 只到第 11 条 → 登记请求没有落点。
**Suggestion**: 在 `contracts §9` 与 change 2 spec/tasks 增列具名出口（如 `traderKit.data.guardStatus() -> { budget, used, remaining, batchLimit, concurrency, minIntervalMs }`）并同步验收；本 change 引用之。若本轮无法落地，则把 `design.md` Open Questions 补到 13（含理由与降级策略），并明确预检缺失时 `failed(reason: dependencyUnavailable)` 的验收基线。

#### Issue 3 (Medium): 幂等归属基准仍分叉（spec 用「目标交易日」，design/tasks/proposal 用 frontmatter）
**Location**: `spec.md:409`（"日期段 == 目标交易日折算的 `YYYYMMDD`"）vs `design.md:75`（D-2④"基准唯一 = 文档 frontmatter 的 `tradeDate` + `code`"）、`proposal.md:13`、`tasks.md:96`（2.8⑦"归属基准唯一 = frontmatter"）
Round 2 #22 的核心风险是"两个基准分叉 → 同一幂等键追加第二条附注"，本轮只把 design/proposal/tasks 统一到 frontmatter，**验收源 spec 未改**。实现者按 spec 实现即复现 Round 2 描述的分叉（用户改写 frontmatter / 文件名与目标日不一致时）。
**Suggestion**: 把 `spec.md:409` 改为"日期段 == **frontmatter `tradeDate` 折算的** `YYYYMMDD`（与入参 `loc` 不一致时由 change 4 抛 `DOC_MISMATCH`，本 change MUST NOT 追加）"，并保留 2.8⑦ 的用例。

#### Issue 4 (Medium): spec 仍写幽灵字段 `storeWarnings[]`，与本节 tasks/proposal 自相矛盾
**Location**: `spec.md:409`、`spec.md:442`；对照 `tasks.md:61,63,93`（"MUST NOT 出现 `storeWarnings[]` 这一字段名"）、`proposal.md:13`（"不存在 `storeWarnings[]` 这一幽灵字段"）、`iteration-1-contracts §12.7`（"仅存在于文档里的告警字段视为无效"）
出口字段是 `warnings: string[]`（`§3`、`review-card-store/spec.md:211,213`），`storeWarnings` 在 change 4 侧只是 Requirement 名/内部类型名（`review-card-store/spec.md:410-419,299`）。本 change 的验收源仍以数组字段语法写出该名字，实现者的字段名将被 tasks 的结构断言判失败——两条验收互相排斥。附带：`tasks.md:93` 2.8④ 断言幽灵锚点告警出现在 `parseDoc`/`scanDailyCardTargets` 的 `warnings` 中，而 change 4 只把 `ghostAnchor` 列在"存储层告警经五个导出一律上抛"（`review-card-store/spec.md:412,425-428`），未把该 kind 归属到具体导出。
**Suggestion**: `spec.md:409,442` 改为 `warnings: string[]`（幽灵锚点条目形态引用 change 4 的 `[ghostAnchor] …` 编码）；并在 change 4 侧（或本 change 的依赖清单）点明 `ghostAnchor` 由 `parseDoc`/`scanDailyCardTargets` 产出。

#### Issue 5 (Medium): spec 的「全仓仅一处原子写/追加实现」与摘要第二处原子写互斥
**Location**: `spec.md:457-460`（"全仓仅一处原子写/追加实现（结构断言）"）vs `design.md:133`（D-9 摘要原子写）、`tasks.md:102`（2.9）、`design.md:163-164`
`tasks.md:71`（2.3①）已把该断言改写为"**文档**写入全仓仅一处实现（`appendAinote`；`src/summary/run-report.ts` 的 JSON 原子写为唯一例外）"，但验收源 spec 未同步（change 4 侧 `review-page/tasks.md:65` 也仍是旧写法）。按 spec 实现，摘要原子写落地后该结构断言必失败，属不可验收。
**Suggestion**: `spec.md:460` 同步为"文档追加/原子写全仓仅一处（`appendAinote`）；`src/summary/run-report.ts` 的 JSON 原子写为具名例外"，并请 change 4 在 1.12 同步同一措辞。

#### Issue 6 (Medium): 同分钟序号 `-<seq>` 的 spec ↔ design/tasks 对立未消除，且触发场景不可达
**Location**: `spec.md:345,347,364-367` vs `design.md:85`、`tasks.md:98`（2.8⑨）
spec 要求"序号生成 SHALL 扫描同前缀既有锚点取最大序号 +1"并把"删掉前一条后重算 → 新锚点 `-0930-2`"写成场景；design D-3 与 tasks 2.8⑨ 明令附注写入侧 MUST NOT 产生 `-<seq>`（"仅由 change 4 的同分钟多卡使用"）。而且按 spec 自己的幂等规则（`spec.md:410`：命中前缀即 `skipped`），能写第二条的唯一路径是"前一条被用户删除"，此时前缀扫描为空、没有"既有锚点"可取最大序号 → 该场景按现规则不可实现。
**Suggestion**: 二选一并同步三处：① 附注明确"永不产生 `-<seq>`"，`spec.md:345,347,364-367` 删除序号生成与场景（序号仅 change 4 卡片）；或 ② 保留序号形态但给出可达来源（如运行内已分配序号），并把场景改为"删除 + 同分钟重算 → 无 `seq`"。

#### Issue 7 (Low): 引用与命名的零散残差（8 处）
- **`design.md` 无 Round 2 处置表**：`tasks.md:22,26,53` 与 `proposal.md:25,31` 三处引用 `design Open Questions 12/13/14`，而 `design.md` 的 Open Questions 只有 1–11；同批 `data-foundation/proposal.md:7` 明载有 Round 1 + Round 2 两节处置表。登记项（同步 change 4 三项、`guardStatus`、change 3 状态视图覆盖面）因此没有可落位置。
- **`design.md:138`（D-10）**仍无条件写"T1 `available=false` 属 `noRecord`（不是失败）"，未按 `§12.8`/`spec.md:97,151` 的三档先分 `dateUnavailable`——Round 2 #29 的 design 侧残留。
- **`design.md:131`（D-9）**仍写"沿 `§9` 的 temp 区约定"，应为 `§10`（`spec.md:282`、`proposal.md:14`、`tasks.md:105` 均已改）——Round 2 #30 的最后一处。
- **`design.md:144`（D-11）**仍要求"复用 change 4 导出的同一路径互斥助手（具名导出）"，但 `§3` 五导出、`§11` 所有权表、change 4 spec/tasks 都没有该导出（`§5` 只是纪律）——违反本 change 自己的 `§0`「无具名接口的复用视为无效表述」。
- **`spec.md:390`** 场景断言"五个必填键"（`generatedAt`/`tradeDate`/`code`/`dataSources`/`missing`），而 `spec.md:154`⑤ 与 `proposal.md:12` 要求 `cacheReused` 必填（六键）——必填口径不唯一。
- **`tasks.md:193`**（§6 映射表）行名"运行摘要三态载体"≠ spec 的 Requirement 名"运行摘要与具名生产者出口"（`spec.md:274`），映射表按名检索会失配。
**Suggestion**: 一次性补齐：`design.md` 末尾追加 Round 2 处置表并把 Open Questions 扩到 14（含理由/降级）；D-10/D-9/D-11 三处按上文订正；`spec.md:390` 改"六个必填键（含 `cacheReused`）"；`tasks.md:193` 行名对齐。

#### Issue 8 (Low): `checkDiscovery` 形参过期（change 3 已登记 R8 待回写）
**Location**: `tasks.md:30,50`（`checkDiscovery({ skills?, projectRoot, installDir })`）；对方：`tq-skill-installer/spec.md:328`、`design.md:176,188`、`tasks.md:59`（`checkDiscovery({ skills?, projectRoot, targetRoot, name })`）
change 3 的 design 明确记录："change 5 `tasks.md` 1.4 现写作 `checkDiscovery({ skills?, projectRoot, installDir })`——该形参名应改为 `targetRoot` 并补 `name`，已登记回写项 R8"（`tq-skill-installer/design.md:188,375`，状态"待 owner 回写"）。本 change 的 §0 与 1.4 仍是旧签名，1.4 又要"直接复用该具名导出"，按此实现类型/入参即不符（`findShadowedCandidates({ roots, name })` 与 change 3 `tasks.md:67` 一致，无此问题）。
**Suggestion**: 按 R8 把 `tasks.md:30,50` 改为 `checkDiscovery({ skills?, projectRoot, targetRoot, name })`，`targetRoot = <数据根>/agent/skills`、`name = 'review-daily-summary'`。

### Positive Aspects

- **两条 Round 2 High 真闭合且有双向证据**：#19 的生产者从"载体"变成"出口 + SKILL 收尾强制 + 5 条自动验收"（`spec.md:274-333`、`tasks.md:38,110-113`）；#20 的被复用侧确已定义 `src/review/format.ts`（`review-card-store/spec.md:255-276`、`review-page/tasks.md:67-70`），并顺手把"锚点 `HHmm` 与标题 `HH:mm` 同源"写成断言——上一轮那种"断言一个不存在的对方"不再存在。
- **主动补齐了 Round 2 的验收缺口**：`deferred` 进 schema 与失败矩阵（`spec.md:236,284-296`）、`errors[]` 必须保留 + `dateUnavailable` 三档（`spec.md:97,151,173-176`）、`DOC_MISMATCH` 写前硬校验（`spec.md:446-448`）、`version` 载体（`tasks.md:38`）都可直接转成用例。
- **三态命名干净**：`spec.md:57-89` 删去不可判定的「非交易日/长假」，只留"交易日不可得 / 归属待确认 / 该交易日无卡片"，并要求返回信息可区分——Round 1 的误导性结论入口被彻底关掉。
- **注册归属不再重复**：`tasks.md:73` 把"只注册 `traderKit.review.dailyReport`、五键只消费"写死，并配结构断言；`§11`/`§12.6` 与 change 4 `tasks.md:63` 三处一致。
- **可发现性并入 change 3 是对的做法且对方已接**：change 3 的状态视图已参数化 `name`/`targetRoot`，并在 fixture 里显式覆盖 change 5 形态（`tq-skill-installer/spec.md:318,330`、`tasks.md:68`），本 change 只保留只读核对 + 降级分支——避免了第二套健康出口。
- **日期格式唯一口径本轮复核成立**：本 change 出现的所有 `YYYYMMDD` 都落在 `§1` 允许的目录/文件名模板、锚点或"兼容输入"三处，契约/返回/数据包一律 `YYYY-MM-DD`（`spec.md:8-12,35,61,93,146`）。
- **不假装可断言**：TQ 侧零网络明确降级为人工证据并要求标注 `fetchedAt`/`cacheReused`（`spec.md:99,113-116`），`force`/`overwrite`/`refresh` 被明令禁入 schema——这两点是本仓评审里少见的"宁愿少断言也不虚构断言"。

### Summary

Top 3 关键问题：
1. **Medium — 运行摘要出口的契约不闭合**：入参 `{tradeDate, entries}` 没有 `missing`/`warnings` 通道，而 schema、返回与 `spec.md:330-333` 场景都要求它们有值；"`⊇ 扫描清单` 由出口自身完成"也与该入参能力不符（`tasks.md:112` 实际写在测试里）→ Round 2 #19 的"生产者存在"之外，"生产者能产出什么"仍不可验收。
2. **Medium — 预算预检出口无所有者**：`traderKit.data.guardStatus()` 只存在于本 change，change 2 与 `contracts §9` 均无该出口，登记请求指向不存在的 `design Open Questions 13`；D-1b 禁止自建 → 预算预检这条 Requirement 与 3.5/4.7 全线不可实施（Round 2 #25 只完成了"命名"）。
3. **Medium — 幂等与写入三处规格级残差**：归属基准 spec（目标交易日）vs design/tasks（frontmatter）仍分叉（#22 未闭合）；spec 仍写幽灵字段 `storeWarnings[]` 与自身 tasks 冲突；`spec.md:460` 的"全仓仅一处原子写"与摘要第二处原子写互斥；`-<seq>` 在 spec 与 design/tasks 间正反对立（#32 升级为对立）。

紧随其后：`design.md` 无 Round 2 处置表且 Open Questions 12–14 引用悬空（Issue 7），`checkDiscovery` 形参未按 change 3 的 R8 回写（Issue 8）。这四条都是窄幅文档订正，不涉及架构返工。

核验限制：本会话 pwsh 被沙箱拒绝；宿主 checkout（`…\app.asar\dsh`）仍不可达（glob 报 `os error 3`），故 Issue 8/27 涉及的宿主符号（skill 根解析、frontmatter 校验段、`skills` 服务定义段）**仍未独立复核**，本轮结论基于本仓可读文件（`iteration-1-contracts`、`data-foundation`、`tq-skill-installer`、`review-page`、`docs/roadmap.md`）与逐字 diff 式比对。本轮只写入 `reviews/daily-summary-review.md`，未改动任何 change 文件或其它文件。

**Consensus Status**: NEEDS_REVISION
