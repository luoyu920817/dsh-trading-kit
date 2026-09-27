# Plan Review: 数据基础（data-foundation）
**Plan File**: openspec/changes/data-foundation/（proposal + specs + design + tasks）
**Reviewer**: Independent Reviewer (subagent)

---

## Round 1 — 2026-09-27

### Overall Assessment
这是本仓目前**可核验度最高**的一份 change：design 直接指向 vault 内三份脚本，我逐条核验了端点、字段与行号，绝大部分吻合；vault 现场三条主张（`DB/review` 不存在、`agent/DB/temp` 与 `agent/skills` 已存在）实测成立；「唯一新增目录 + 复用既有父区」的收敛方向与仓库纪律一致。但它在**日期语义**上留下了本 change 最要命的空洞：spec 一边禁止系统时钟充当业务日期，一边要求「当日走 List / 历史日走 History」和「每源每交易日预算」——后两者都需要一个「今天」的事实源（参考实现用的是 `beijing_today()`），design 未裁决；叠加「历史日回退 List」「不一致仅 notes 标注」，会让**别的交易日数据被当作请求日数据**返回，而 change 4/5 正是靠它做交易日归属。此外「首封时间红线」在 S5 降级路径上自我否定（S5 的时间实为最后封板时刻），tasks 对 spec 的覆盖存在多处缺口且缺少依赖/测试改造项。

**Rating**: 5/10

### Issues

#### Issue 1 (Critical): 「首封时间红线」在 S5 降级路径上自我否定——S5 的值就是最后封板时刻
**Location**: `openspec/changes/data-foundation/specs/limit-reason-tool/spec.md:46-48,56-58`、`openspec/changes/data-foundation/design.md:12`
spec 定红线「`zt_time`（最后封板）MUST NOT 写入 `firstTime`」（scenario「最后封板时刻不得冒充首封」），却又规定降级 S5 时「S5 返回封板时间 → `firstTime` 标 `source=S5`」。核验参考实现：`fetch_limit_reason_local.py:101` 的 `first_limit_time` 取自 `boardAnalyses[-1].closeTime`（`boards[-1]`，即**最后一个**板块分析/收盘时刻），并非首封；`fetch_zt_timeline.py:22` 自述「对枢『涨停时刻』= 最后封板时刻（有开板则不是首封）；首封时间看换手率 `first_time`」。即：S5 唯一可得的时间量与红线要防的语义是同一个（最后封板），把它塞进 `firstTime` 等于用另一个字段名绕开红线，且消费方（change 5 的 `limitReason`）只看字段名与 `source`，无法分辨。
**Suggestion**: S5 的时间值只允许进 `lastTime`，或新增独立字段 `firstTimeAlt`（`source=S5`、`semantic: "board-close"`）；spec 补一条 scenario「S5 时间 MUST NOT 出现在 `firstTime`」+ 对应用例（tasks 4.3 的 `zt_time` 断言扩成对 S5 的断言）。

#### Issue 2 (Critical): 三个日期概念未分离——List/History 路由与「每交易日预算」都没有事实源
**Location**: `openspec/changes/data-foundation/specs/data-tool-contract/spec.md:95,112-115`、`specs/limit-reason-tool/spec.md:27-34`、`design.md:54`
spec 规定「系统时钟 SHALL 仅用于限流判定，MUST NOT 用作业务日期」，但同一份 spec 又要求：①「当日 → `surgeLimitList`／历史日 → `surgeLimitHistory`」——「当日」必须与某个「今天」比较才成立；②「每源每交易日请求预算」——预算桶必须有一个日期键，否则无法定义重置点。参考实现的事实源是**系统时钟**：`fetch_zt_timeline.py:59-61`（`beijing_today()`，UTC+8）与 `:319`（`is_today = date_compact == beijing_today()`）。design 把这段照抄进 TS 后，就会出现「用系统时钟决定取数端点」（违反 spec 字面）与「预算按源返回日期分桶」（预算在首次请求前不存在，无法限流）两种都错的实现。时区也未定义（脚本用 UTC+8，spec 未写）。
**Suggestion**: 在 `data-tool-contract` 显式区分三义并各自指定来源：**限流日**（系统时钟，固定 `Asia/Shanghai`，用于时段判定与预算桶）／**请求日**（调用方入参）／**业务日**（源返回 `HqDate`/`date`）。写明 List/History 路由的判据是「请求日 vs 限流日」，并补 scenario 断言「同一入参在跨零点/节假日下路由稳定」。

#### Issue 3 (Critical): 历史日回退 List 会把他日数据当请求日数据，而 spec 只要求「notes 标注」
**Location**: `specs/limit-reason-tool/spec.md:13-15,36-39`、`specs/data-tool-contract/spec.md:74-76`
Scenario「历史日优先 History」明确「History 返回空 → 回退尝试 List，并记录实际命中的端点」。而 `surgeLimitList` 是**当日**列表（`fetch_zt_timeline.py:302-311,322-325`：`List` 不带 `date` 参数），于是「请求 20260924、History 无数据」会拿到**当日**的全市场列表；spec 对此的约束仅是「保留数据 + 在 `notes` 标注差异」。change 5 的 daily-summary 会把 T1 结果写进目标交易日文档，其 spec 对 `tradeDate` 不一致**没有**任何硬门槛（`openspec/changes/daily-summary/specs/daily-summary/spec.md` 只要求数据包带来源与 `missing`），因此「另一天的涨停原因」会被写进历史日文档。这不是显示问题，而是数据污染。
**Suggestion**: 把回退 List 限制为「请求日 == 限流日」时可用；请求日 ≠ 返回业务日时默认 `available=false` + `errors: dateMismatch`（附请求日与实际业务日），仅在调用方显式声明 `allowMismatchedDate` 时保留数据并在 `notes` 标注；补 scenario 与用例。

#### Issue 4 (Critical): change 4 赖以定位交易日的 `tradeDate` 语义，在实现与 tasks 里都没有落点
**Location**: `specs/limit-reason-tool/spec.md:5,17-20`、`tasks.md:30`、消费方 `openspec/changes/review-page/design.md:78`
spec 承诺「源列表成功返回时 `tradeDate` 始终可得——即使该标的不在列表中」，review-page D-9 把它作为**唯一**的「最近/归属交易日」来源。核验参考实现：`fetch_zt_timeline.py:339-342` 的 `returned_date` 在 **`rows` 为空时根本不赋值**（`if not rows: continue` 先于 `out["returned_date"] = ...`），所以「当日涨停列表为空」（节假日、盘前尚未出数据、源端偶发空）时 `tradeDate` 会丢失 → review-page 的 seam 返回 `null` → 落到「用户确认归属」；而 tasks 里**没有**「标的不在列表」「列表为空」两条断言（4.6 只覆盖主源成功/空走备源/主备失败/非法参数/缓存）。
**Suggestion**: 实现改为从响应体的 `data.date` **无条件**取值（不看 `rows`）；spec 增加 scenario「列表成功但为空 → `tradeDate` 仍可得 + `available=false`（原因：当日无涨跌停数据）」；tasks 4.6 补两条断言，并与 review-page D-9 做一条跨 change 契约用例。

#### Issue 5 (High): 卡片文件名模板出现第二事实源，且源派生名称直接进路径
**Location**: `specs/data-root-layout/spec.md:24,37-45`、`specs/data-root-layout/spec.md:17-20`、`openspec/changes/review-page/specs/review-card-store/spec.md:5`
mapping 表只到目录（`DB/review/<YYYYMM>/`）并声称「业务区路径以本表为唯一事实源」，但同文件的 scenario 断言完整文件名 `<代码>_<名称>_<YYYYMMDD>.md`——该模板同时也是 review-page spec 的 Requirement（`review-card-store/spec.md:5`）。两处独立定义同一格式，改名时必然漂移。更实际的风险是**越界**：`<名称>` 来自第三方源（S8 `stock_chi_name`，见 `specs/concepts-tool/spec.md:43`），若含 `/`、`\`、`..`、Windows 保留名（`CON`）或控制字符，就会让写入逃出 `DB/review/`；而 `data-root-layout` 的越界防护只覆盖「请求的相对路径包含 `..` 或为绝对路径」（spec:17-20），没有约束模板参数。
**Suggestion**: mapping 拆成「区域目录」与「文件名模板」两级并声明模板归属（建议归 `data-root-layout`，change 4 改为引用）；`resolveArea` 对每个模板参数做白名单（`code: ^\d{6}$`、`date: ^\d{8}$`、`name: 去路径分隔符与控制字符 + 限长 + 保留名拒绝`），补注入用例（`../../`、`a/b`、`CON`、空名）。

#### Issue 6 (High): 频控默认值无依据，「单标的调用不受影响」与「最小间隔 1000ms」冲突，且 offSession/全市场级语义自相矛盾
**Location**: `specs/data-tool-contract/spec.md:93-110`、`design.md:52-54,86`
四处具体问题：(a) **参数值与来源**：≤2 并发、1000ms 间隔、≤20 批量、200/日 均无实测或推导依据（参考脚本无限流，`page_count: 5000`、`count: 252` 才是真实规模）；(b) **「单标的调用不受影响」不成立**（`design.md:86`）：间隔是**按源全局**的，review-page D-8 的有界回溯（默认 10 交易日）逐日请求 → 至少 9–10 秒串行，change 5 对 N 个标的逐只取数 → N 秒级；(c) **offSession 与批量上限矛盾**：护栏②「单次调用标的数上限」是硬上限，而 scenario「盘后任务显式豁免 → 允许超过批量上限」又允许豁免，tasks 3.2 同样含糊——需明确「批量上限是否可被 offSession 放宽」；(d) **「全市场级」无定义**：唯一判据是调用方自报的 `fullMarket` 标记，不自报即绕过，盘中 scenario「超过批量上限的调用被拒绝」在盘后同样成立，使豁免规则失去意义；(e) 盘中窗口用「工作日」判定，无交易日历，调休工作日/法定假日会误判（spec 只承认时钟"仅用于限流"，但该判定实际是**语义闸门**，误判不是限流误差）。
**Suggestion**: 给出默认值的推导（每分钟请求数上限 = 源可承受量，或直接对齐参考脚本实测吞吐）；把时段判定的误判后果写清（宁可少拦不可误导），或引入可配置交易日历/豁免清单；明确 offSession 只放宽「全市场级标记」不放宽批量硬上限（或反之），并把 `fullMarket` 之外的自动识别口径定义为可选增强；把「单标的受限流影响」写入 design 的 Risks，别写成"不受影响"。

#### Issue 7 (High): 缓存键 = 业务日期 + 代码，与消费方「每天至多一次全量列表请求」直接冲突
**Location**: `design.md:44-46`（D-3）、消费方 `openspec/changes/review-page/design.md:72`
T1 的 S7 请求本质是**全市场列表**（`page_count: 5000`），而 D-3 的缓存键是「业务日期 + 代码」。于是：同一交易日同一份列表会被 N 个代码各下载一次；review-page D-8 声称「每天至多一次全量列表请求」不成立；按「20 只标的 × 10 日回溯 = 200 次」计算，**一次页面首屏就能打满 200/日预算**（数字恰好等于预算，说明预算与回溯规模没有联合推演）。同理，T1 的 `available=false`（标的不在列表）也应该被列表级缓存覆盖，否则每次都要重下。
**Suggestion**: 引入**列表级缓存**（键 = `source + businessDate`，保存整份列表 + `tradeDate`），T1/T2 的 per-code 结果作为派生视图缓存；预算与间隔按「列表级请求数」计；spec 明确两层缓存与「零网络」的判定层级。同时与 review-page D-8 的措辞对齐。

#### Issue 8 (High): 与 roadmap / architecture / AGENTS 的冲突只覆盖了 architecture 一句，写分区契约缺登记
**Location**: `AGENTS.md:51-52`、`docs/roadmap.md:20-27`、`docs/architecture.md:22-26,42-44,56`、`tasks.md:47`（仅 6.6）
(a) AGENTS 规定「vault 写入：**阶段 4 起**才触 vault」，而本 change 在迭代一把缓存写进 `<dataRoot>/agent/DB/temp/…`——实测该路径就在 vault（`…\remotely-save\finance\agent\DB\temp\`）内，属明文越阶，需要显式豁免或明确「缓存不算资产写入」；(b) roadmap 阶段 3 写的是「connector-tdx + research-data 搬运」，本 change 改写为「三方接口工具 + TQ skill」，proposal `Impact` 与 task 6.6 **只提 architecture**，roadmap 的「迭代一重排」没有任何任务；(c) architecture.md:44 的写分区清单（`events/`、`知识卡片/`、`DB/opt/`、`DB/daily/`）既没有 `DB/review/` 也没有 `agent/DB/temp/`，而红线要求「只写既定产物区」，登记被 review-page Open Q4 推给"回写"——即两条新路径**当前无契约支撑**。
**Suggestion**: 在本 change 增加任务：roadmap 补「迭代一重排（三方接口工具 + TQ skill 取代 connector-tdx 搬运）」、architecture 写分区清单补两处路径、vault-integration 登记 `DB/review/` 与 `agent/DB/temp/dsh-trader-kit/`；并在 AGENTS/roadmap 说明缓存写入的阶段豁免。

#### Issue 9 (High): 「已核实的事实」标签把实测、引用与假设混在同一节
**Location**: `design.md:5-15`
核验结果（本会话实测，证据见文末附录）：**成立**——三份脚本存在且端点/字段/常量核对吻合；`DB/review` 不存在；`agent/DB/temp`、`agent/skills` 存在。**引用不准**——`design.md:8` 说「`HSL_TS`/`HSL_SIGN` 常量在 53–56 行」，实际 `53=HSL_SIGN`、`54=HSL_TS`、`55–56=HSL_BLOCK_SIGN/TS`（T1 不使用后两者）；`design.md:14` 的 `vendor/cordis/src/fiber.ts:50` 在本工作区**不存在**（无 `vendor/`，DSH 安装目录 `app.asar\dsh\` 路径不可达），该引用点无法核验（但 `ctx.tools.register(defineTool)` / `ctx.provide` / `export const Config` 三项在 `DSH-better-sidebar` 中有可比先例，可换成该引用）。**未能核验却写成已核实**——`design.md:11` 的 TQ 口径（`get_gpjy_value` 参数名 `table_list`、`get_zdt_data` 全 `.SZ`、盘后全 0、`GP15` 判涨停）本 change 无消费方，却是 Non-Goals 排除 T3 的论据；`design.md:10` 的 S8 `reason` 字段（见 Issue 10）。
**Suggestion**: design 拆成「已实测（附证据/日期/可复现命令）」与「待验证（列入 tasks 的 spike + 降级策略）」两节；未能核验项统一改成 spike 任务；行号引用改成符号名（`HSL_SIGN`/`HSL_TS`）而非行区间，避免脚本一改就失真。

#### Issue 10 (High): S8 移植口径失真——请求 `fields` 不含 `reason`/`plate_id`，spec 却把它们写成必返字段
**Location**: `specs/concepts-tool/spec.md:5,22-24`、`design.md:10`、`tasks.md:35`
`fetch_concepts_xuangubao.py:137-140` 的请求参数是 `fields=core_avg_pcp,plate_name,top_n_stocks`，而解析层读取 `plate.get("reason")`（:78）与 `plate.get("plate_id")`（:98）——两个字段**不在请求白名单里**。若该 API 按 `fields` 裁剪响应，`reason` 将恒为空、`plateId` 恒为 `null`，而 spec 把 `reason` 写成必返字段并给了「截断 200 字」的处理要求（tasks 5.2），proposal 验收对照还要求「返回规范化数据」。
**Suggestion**: 移植时把 `fields` 扩为 `core_avg_pcp,plate_name,reason,plate_id,top_n_stocks`；若源不支持按需返回，则构造一次真实响应 fixture（或记录实测响应）再定稿，并把 `reason`/`plateId` 降级标注为 best-effort；tasks 5.5 补一条「`reason` 非空」或「显式 `null` + 原因」的断言。

#### Issue 11 (High): S5 移植会带上不该有的本地依赖、未记载的第三套代码后缀与「任意历史记录」语义
**Location**: `design.md:9`、`tasks.md:26`
核验 `fetch_limit_reason_local.py` 三处会被照抄进 TS 的问题：(a) `market_id()`（:42-44）用 `17`/`33` 区分沪/深——这是本 change **未记载的第三套后缀约定**（S7 用 `stock_code`、S8 用 `.SS/.SZ`），北交所同样会被静默按深市处理（与 `concepts-tool` spec:55-58 的"北交所待验证"口径不一致）；(b) `local_html_path` 存在性检查（:114-116）把 `D:/TDX_HOME/webs/company/同花顺涨跌停原因.html` 当作 error 来源——插件侧不该依赖该本地 HTML，照抄会让"未装通达信 HTML"污染降级判定；(c) `_pick_news()`（:51-67）在无精确日期记录时会回退到「≤ 目标日期的最近一条」甚至「任意 UP/涨停记录」，返回的 `date`（:145,162）可能是**任意旧日期**——与 S7 的 `tradeDate = 列表业务日期` 是两种语义，spec 却共用一个 `tradeDate` 名。
**Suggestion**: 移植时删除本地 HTML 依赖；把 `marketId` 映射表化并写明北交所行为（拒绝或标注待验证）；为 `tradeDate` 区分『列表业务日』与『命中的异动记录日』（后者只允许进 `notes` 或独立字段），并在 spec 补 scenario。

#### Issue 12 (High): Requirement 与 tasks 的覆盖缺口（逐条列出，含门禁会被现有测试打破）
**Location**: `tasks.md:1-48` 对照四份 spec
目前对不上的至少七处：① `data-root-layout` R4「数据根迁移显式后置」要求「检测到历史数据不在当前数据根时给出非阻断提示」——无任务、无验收；② `data-tool-contract` 场景「原位刷新不追加」「字段缺失仍带 source/fetchedAt」「不可用态不被渲染成零值」无断言（tasks 3.5 只覆盖空值全表/拒绝路径/二次调用/中断）；③ 健康检查整章（`spec:131-148` 四个 scenario，含 TdxW 未启动文案、探测超时 3s）没有任何**自动**用例，tasks 6.2 只有实现项；④ 频控四个 scenario 里「预算耗尽」「offSession 豁免」「时钟解耦」无用例（3.5 只笼统写"各拒绝路径"）；⑤ **单位规范无落点**：`data-tool-contract` 要求「金额=万元／市值=亿元／比例=百分数」，但 T1 的返回结构（spec:5）只有 `cause/firstTime/lastTime/openCount/streakDesc`，T2 只有 `strengthPct`——本 change 的返回体里**没有任何金额或市值字段**，该 Requirement 不可验收，而 proposal 验收对照却把「带来源与单位」写成判据；⑥ T1 缺「`tradeDate` 不一致 → notes」「标的不在列表 → `tradeDate` 可得」；T2 缺「跨日不命中」「降序」「`reason` 截断」；⑦ **没有任务给 `package.json` 加依赖**（参考先例 `export const Config` 需 `schemastery`：`DSH-better-sidebar/src/config.ts:64,8`；`defineTool` 来自 `@deepseek-ai/dsh-tools`，better-sidebar 放 peerDependencies），也没有任务更新 `test/smoke.test.ts`——它现在断言 `apply({} as never)` 不抛错，而 tasks 1.3 要 `apply(ctx)` 接入 `ctx.tools`，不改测试就会红。
**Suggestion**: 按 spec 的 Requirement/Scenario 逐条补 tasks 与验收证据格式（`pnpm test` 用例名 + 断言要点）；单位 Requirement 二选一：删掉（本 change 无金额字段）或明确它只在 change 5 的 TQ 字段上生效并标注"本 change 不验收"；补依赖/构建/smoke 测试改造任务。

#### Issue 13 (High): 配置面把个人绝对路径与失效签章默认值发进发布产物，且「必填无默认」与 Loader 校验时序冲突
**Location**: `design.md:34-36,56-58`、`tasks.md:4`、`package.json:16-21`、`src/index.ts:21`
两处矛盾：(a) D-1 声明「代码不硬编码个人机器路径」，tasks 1.2 却把 vault 绝对路径写进 `cordis.patch.yml`，而该文件在 `package.json` 的 `files` 里（`package.json:19`）是**发布产物**——个人环境路径被移出代码、移进了版本化发布物；同一处还会内置 `fetch_zt_timeline.py:53-54` 的 `sign/ts` 现值（易失的第三方页面参数）。(b) `dataRoot` 若在 `Config` 里必填无默认，Cordis Loader 的 schema 校验在**挂载前**就可能失败，与 spec「未配置时写入显式失败（含配置项名与指引）」以及「探测失败不阻塞挂载」的形态不一致；另外 `src/index.ts:21` 现有的 `export interface TraderKitConfig` 与新 `Config` 的关系（改名/删除）无人交代。
**Suggestion**: `dataRoot: z.string().default('')`，由写入路径在调用期显式报错（保挂载可用）；示例路径与 `sign/ts` 只写进 README/注释或 profile 层示例（不进发布 patch），或在 patch 里用占位符；tasks 1.1/1.3 补「导出 `Config`（schemastery）+ 增加 `schemastery`/`@deepseek-ai/dsh-tools` 依赖 + 处理 index.ts 既有 `TraderKitConfig`」；补一条「未配置 dataRoot → 挂载成功且写入报错」的用例。

#### Issue 14 (Medium): 健康检查与「唯一闸门 + 3 秒」「预算」互相打架
**Location**: `design.md:48-50,64-66`、`specs/data-tool-contract/spec.md:93-95,131-138`
D-5 声明「`guard.ts` 是所有出站请求的唯一闸门（模块代码不得绕过直接 fetch）」，D-8 又要求挂载时并行探测 4 个目标并在 3 秒内给出结论。在「并发 ≤2 + 最小间隔 1000ms」下，3 个源探测最坏为 2+1 两批、每批 3s 超时 → 可能 >3s，直接违反 spec 的 3 秒结论；若探测绕过 guard 走独立 fetch，又违反"唯一闸门"。同时探测会消耗**当日预算**（3/200）并让「出站请求计数为 0」类断言在真实挂载环境下不稳；`diagnostics` 配置（tasks 1.1）语义未定义，只有 17709 一路有开关（Open Q1）。
**Suggestion**: spec/design 写明探测是**独立通道**（不计预算、不计入 guard 计数，且不得被其它模块复用），或把「3 秒」改为「启动探测总硬超时 3s（`AbortSignal.timeout` 截断）」并说明最坏耗时；`diagnostics` 增加 `probe.enabled/targets` 定义与默认值。

#### Issue 15 (Medium): 宏观预留区映射到 `题材调研/` 裸根，与既有 `00宏观` 约定不符
**Location**: `specs/data-root-layout/spec.md:31`
实测 vault 既有约定是 `题材调研/00宏观/…`（如 `题材调研\00宏观\三驾马车数据跟踪.md`），且 `题材调研/` 根下另有 `盘面.canvas`、`题材日历.md` 等散文件。把预留区映射到裸父目录、再写「结构随功能定稿」，等于允许实现者另造 `题材调研/宏观…`——与「MUST NOT 新造目录名」的自我约束相悖。
**Suggestion**: 预留映射直接指向既有 `题材调研/00宏观/`；或明确「预留区仅登记、不可解析（调用即显式报错）」，等结构定稿再开放。

#### Issue 16 (Medium): `refresh` 是幽灵参数，缓存 `schema` 版本没有失效规则
**Location**: `design.md:46,84`、`specs/data-tool-contract/spec.md:55-57`
(a) `design.md:84` 写「如需刷新由调用方显式传 `refresh`（本迭代不开放给页面）」，但 T1/T2 spec 的入参只有 `code`/`date`，tasks 也没有该项——工具 schema 是否含 `refresh` 未知，而它与「入口命中即零网络」的契约直接互相影响（agent 无法用它，测试也无法断言）。(b) D-3 的缓存 JSON 含 `schema`（模块名+版本），但 spec 没有任何「版本不符 → 未命中/显式报错」的要求；升级后旧文件会被当命中返回，形成静默脏数据。
**Suggestion**: 二选一：在 `data-tool-contract` 增加 `refresh` Requirement（含护栏/预算/`notes` 语义与用例），或删除该表述并声明"本迭代无刷新入口"；同时补「`schema` 不匹配 → 视为未命中并覆盖写」的要求与用例。

#### Issue 17 (Medium): 只读边界与「页面层无取数实现」的断言方式可绕过，且当前会空过
**Location**: `tasks.md:44`（6.3）、`specs/data-tool-contract/spec.md:12-15,117-129`
两条断言都靠**源码文本扫描**：`order_stock`/`cancel_order` 字符串拼接（`'order'+'_stock'`）、间接调用（动态 import、被依赖包代理）都能绕过；「页面/路由层不含第三方 URL」同理（URL 可来自常量/配置）。更要紧的是**当前扫描目标不存在**：本仓 `src/` 内没有任何 `http(s)://` 或 `fetch(`（我复核过），扫描型用例现在只会"绿而无证据"；review-page 的页面层尚未实现。
**Suggestion**: 换成结构性断言——① 页面/路由层 import 白名单（只允许 service 类型与 UI 依赖，禁止 import `src/data/**`）；② 出站唯一闸门（除 `src/data/http.ts` 外全仓零 `fetch`/`http.request`，用 ESLint 规则或扫描 `src/**` 实现，含 `src/client/**` 与后续 review 层）；③ 17709 断言改为「数据模块对 17709 无 HTTP 请求，仅 `net.connect` 探测」；④ 测试需在扫描路径缺失时报失败（`expect(targets.length).toBeGreaterThan(0)`），避免空过。

#### Issue 18 (Medium): 「按脚本口径移植」没有搬运台账落点
**Location**: `docs/carryover.md:26-45`、`proposal.md:31-32`、`AGENTS.md:37-39`
本 change 新增的 `src/data/**` 既不是「自建工作流」，也不是 carryover 台账里的**整包搬运**——源是 vault 里的 Python 脚本（`agent/skills/a-stock-research-data/scripts/*.py`）。台账没有「脚本移植」行，也没有记录源 commit/抓取日期/本地偏离（如 Issue 10 的 `fields` 扩写、Issue 11 的删依赖），违反 AGENTS「带测试搬 + 带溯源搬、搬完冻结并每月再对照」：三个月后无法判断某段逻辑是上游契约还是本仓改动。
**Suggestion**: 在 `docs/carryover.md` §3 增加「脚本口径移植」类目与行（源路径 + 抓取日期 + 脚本哈希/`git` 状态 + 偏离清单），要求 `src/data/**` 模块头注释回指台账行；tasks 增补该文档任务（与 6.6 并列）。

#### Issue 19 (Medium): 消费方前提需复核——`DB/stock/` 并非"未建索引"
**Location**: `openspec/changes/review-page/design.md:10,60`
review-page D-5 以「`DB/stock/`（Q3 的本地标的库索引）尚未建索引，本迭代不能按代码直读本地档案」为由，把名称降级链第三层定为"仅代码"。实测 `DB/stock/` 下已有约 1095 个标的 md（如 `DB\stock\爱慕股份.md`）。这不否定 D-5 的结论（"按代码直读"确实需要一个索引），但本 change 的 T2 `name` 反查（`design.md:76-78`）与「名称唯一来源是 S8」的分工建立在该前提上，前提未经核实就会让"名称三层降级"的现状判断失真。
**Suggestion**: 由本 change 或 review-page 复核 `DB/stock/` 的实际形态（是否有 code→文件 的稳定映射），在 design 的 vault 现场一节补上该事实与结论；若不成立，名称来源优先级需重排。

### Positive Aspects
- **vault 现场三条主张实测成立**：`DB/review` 确不存在（`glob` 报 `os error 2`）、`agent/DB/temp/` 与 `agent/skills/` 确存在；mapping 表里的「既有区」也经复核（`题材调研/`、`交易系统/平常心/方法论/模式/` 均在）。这在本仓历史 change 里是少见的"可复核的现场"。
- **三份脚本的核验质量高**：`HSL_SIGN`/`HSL_TS` 在 53–54 行、`fetch_hsl_reasons` 起于 314 行、`surgeLimitList`/`surgeLimitHistory` 互兜底、`cause/first_time/last_time|ori_last_time/open_count/surgedays`、S8 的 `code===20000`/`core_avg_pcp` 小数/200 字截断/`top_n_stocks.items[].stock_chi_name`/`.SS`·`.SZ` —— 逐条吻合，"不重新逆向"的策略站得住。
- **把纪律做成代码而不是嘱咐**：空值守卫全表、逐字段 `{value, source, fetchedAt}`、显式不可用态（禁止用 `0`/空列表冒充）、原子写 + 写前 re-read、出站唯一闸门，全部写成了可断言要求。
- **边界划分正确**：TQ 走官方 skill（不固化 TS）、三方接口才封装工具、双出口同一实现、页面层零取数实现 —— 与 `tq-skill-installer` 的 Non-Goals（"不接触 17709 数据面"）方向一致。
- **D-10 的测试策略**：用 `node:http` 真实本地桩替代 mock，符合仓库「零 mock、零 sleep」纪律；失败路径（主备切换/空数据/超时/护栏）确实是本 change 的主要风险面。
- **Open Questions 诚实**：17709 TCP 探测的边界、缓存生命周期、字段漂移监测三项都显式上交 owner，没有自行拍板。

### Summary
1. **首封时间红线在 S5 降级路径自我否定**（Issue 1，Critical）：S5 唯一可得的时间量就是最后封板时刻，spec 却允许它进 `firstTime`——红线必须改成"只有 S7 `first_time` 能进 `firstTime`"。
2. **日期语义未分离**（Issue 2 + Issue 3 + Issue 4，Critical）：List/History 路由与「每交易日预算」都没有合法事实源（参考实现用系统时钟，spec 又禁止）；历史日回退 List 会把他日数据当请求日数据且仅"notes 标注"；change 4 唯一依赖的 `tradeDate` 语义在参考实现里对"列表为空"不成立、tasks 也无断言。
3. **契约与执行力缺口**（Issue 6/7/12/13，High）：频控默认值无依据且与消费方的回溯策略互相放大（缓存键应下沉到"列表级"）；单位规范在本 change 无任何承载字段；依赖（schemastery / `@deepseek-ai/dsh-tools`）与 `test/smoke.test.ts` 改造未列入任务；个人绝对路径与易失签章默认值将被写进**发布产物**。

**Consensus Status**: NEEDS_REVISION

### 附录：核验证据与未能核验项

**本会话已实测并给出证据的事实**
- vault 脚本存在且内容吻合：`…\finance\agent\skills\a-stock-research-data\scripts\{fetch_zt_timeline.py, fetch_limit_reason_local.py, fetch_concepts_xuangubao.py}`；`fetch_zt_timeline.py:53-54`（`HSL_SIGN`/`HSL_TS`）、`:302-311`（List/History 参数）、`:314-359`（`fetch_hsl_reasons`，含 `is_today = beijing_today()`）、`:339-342`（`returned_date` 仅在 rows 非空时赋值）。
- `fetch_limit_reason_local.py:17-18`（两个端点）、`:42-44`（`marketId 17/33`）、`:51-67`（`_pick_news` 回退）、`:101`（`first_limit_time ← boardAnalyses[-1].closeTime`）、`:114-116`（本地 HTML 依赖）。
- `fetch_concepts_xuangubao.py:21`（API URL）、`:34`（`.SS/.SZ`）、`:44-46`（200 字截断）、`:60`（`code===20000`）、`:82-92`（分档）、`:104-108`（名称反查）、`:137-140`（`fields` 不含 `reason`/`plate_id`）。
- vault 现场：`DB/review` 不存在（`glob` → `os error 2`）；`agent/DB/temp/` 与 `agent/skills/` 存在；`题材调研/`、`题材调研/00宏观/`、`交易系统/平常心/方法论/模式/` 存在；`DB/stock/` 下已有约 1095 个标的 md。
- 工作区「已有实现/配置面」：`src/index.ts` 为阶段 1 no-op（仅 `name`/`TraderKitConfig`/`apply`），`src/` 内**零** `http(s)://`、零 `fetch(`、零 `ctx.tools`/`ctx.provide`/`export const Config`；`package.json` 无 `schemastery`/`@deepseek-ai/dsh-tools`（上架依赖亦未列）；`cordis.patch.yml` 无 `config` 段（其注释仍写"阶段 2 起 config 将按需扩展"）。
- 宿主范式佐证（替代 design 里不可达的 `vendor/cordis` 引用）：`DSH-better-sidebar\src\agent-opens.ts:204`、`src\tools.ts:91`（`ctx.tools.register(defineTool({...}))`，`defineTool` 来自 `@deepseek-ai/dsh-tools`）、`src\client\index.tsx:143`（`ctx.provide('betterSidebar', …)`）、`src\config.ts:8,64`（`import z from 'schemastery'` + `export const Config: z<SidebarConfig> = z.object({...})`，且 `package.json` 将 `schemastery ^3.18.0` 列为 dependencies、`@deepseek-ai/dsh-tools` 列为 peer/dev）、`cordis.patch.yml:46-49`（config 加载在同一条 insert 行上）。

**未能核验（本会话读不到，已按"待办/降级"处理）**
- `vendor/cordis/src/fiber.ts:50`：工作区无 `vendor/`；DSH 安装目录 `…\resources\app.asar\dsh` 报"系统找不到指定的路径" → **未能核验**，且该引用对 `export const Config` 的校验机制无独立证据（仅 better-sidebar 用法佐证）。
- design:11 的 TQ 口径（`get_gpjy_value.table_list`、`get_zdt_data` 的 `.SZ` 异常与"盘后全 0"、`GP15` 涨停/跌停判据）：无证据文件、本 change 无消费方 → **未能核验**。
- S7/S5/S8 的**线上实际响应**（S8 是否返回 `reason`、S7 列表为空时的 `data.date`、S5 `boardAnalyses` 结构）：本会话无网络取数 → **未能核验**（Issue 10/11 按"参考实现推断"记，需以实测响应定稿）。
- DSH 宿主的按插件 config 传递语义（`dataRoot` 必填时的 Loader 行为、`tools` 依赖注入写法）：宿主源码不可达 → **未能核验**（Issue 13 的结论以 better-sidebar 用法与 spec 自述为据）。

---

## Round 2 — 2026-09-27

### Overall Assessment

修订方向正确且执行度高：Round 1 的三个 Critical 空洞（日期三义、历史日回退 List、`tradeDate` 无条件取值）在**正文**中确已闭合，S5 时间红线、`refresh` 幽灵参数、两层缓存、健康检查两段视图、出站两条具名通道、脚本口径移植台账等改动都能在 spec/design/tasks 三处对齐，不再只是「处置表自述」。但本轮暴露出一条**跨 change 的日期格式硬伤**（限流日 `YYYYMMDD` / 业务日与 `tradeDate` `YYYY-MM-DD` 并存，直接卡死 change 5 的 `dateMismatch` 硬门槛与 change 4 的 `isTradingDay` 判定），并发现**列表级缓存键的循环定义**（键含 `businessDate`，但取数前无法构造该键）、**契约 §1 与工具 spec 对「当日 History 为空回退 List」的相反表述**，以及返回体字段声明与场景的缺口。这些仍属实现第一步就会踩到的返工点。

**Rating**: 6.5/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | 首封时间红线在 S5 降级路径自我否定 | 已解决 | 正文核验：`limit-reason-tool` spec:68「S5 可得时间量 MUST NOT 进入 `firstTime`」+ scenario 80-83「S5 时间 MUST NOT 出现在 firstTime」（断言 `firstTime.value===null` 且 `source=S5` 时间值不在 `firstTime`）、scenario 85-88、spec:118；design D-13 三条（150）、tasks 5.3 验收含该用例名。无残留「firstTime 标 source=S5」。 |
| 2 | 三个日期概念未分离 | 部分解决 | 三义 Requirement 表（`data-tool-contract` spec:17-30）在 spec/`contracts §1`/design D-3 三处一致，限流日=系统时钟固定 `Asia/Shanghai`、路由=请求日 vs 限流日，新增 T0 单点实现。**残留见 Issue 20/21**：三义格式未统一（限流日 `YYYYMMDD` vs 业务日 `YYYY-MM-DD`），且「业务日 == 限流日」判据未定义比较前的规范化。 |
| 3 | 历史日回退 List 把他日数据当请求日数据 | 已解决 | `requestedDate !== rateLimitDate` → `available=false` + `errors:[dateUnavailable]` 已成硬要求（`data-tool-contract` spec:28、`limit-reason-tool` spec:19-20、design D-3/D-13、tasks 5.1/5.4）且明写「MUST NOT 仅以 `notes` 标注替代」。**但契约 §1 允许的当日回退与本 change 措辞冲突，见 Issue 22**。 |
| 4 | `tradeDate` 语义无落点、列表为空即丢 | 已解决 | design 已实测表（16）承认脚本缺陷并声明「必须反着做」；spec:29、`trade-date-tool` spec:31、`limit-reason-tool` spec:5 均为「无条件取值」；scenario「标的不在列表仍可得」（22-25）与「列表成功但为空」（27-30）齐备；tasks 4.1/5.4/5.6/5.7 + 跨 change seam 用例（tasks:127）。 |
| 5 | 卡片文件名模板第二事实源 + 源派生名称进路径 | 已解决 | `data-root-layout` spec:27-40 升级为两级（区域目录 + 文件名模板）并声明模板归属本表（29）、change 4 MUST 引用；参数白名单（62-72）+ `sanitizeNameSegment`（72）+ 「由外部数据拼出的路径段同样受防护」scenario（22-25）+ 注入 scenario（74-77）；tasks 2.2/2.3/2.6。 |
| 6 | 频控默认值无依据、「单标的调用不受影响」、offSession 豁免、全市场级无定义 | 已解决 | design D-5（83-99）：默认值标注「经验值、可配置」+ 依据段落 +「全市场级」判据（92）+ `offSession` 只放宽时段（93）+ `sessionOverride`（94）+ 节假日误判后果（95）+「单标的也受全局间隔约束」（97）；spec:173-184 + 13 条 scenario；Risks 联合推演（164-165）。proposal:41 亦已改写。 |
| 7 | 缓存键=业务日期+代码 与「每天至多一次全量列表」冲突 | 部分解决 | 两层缓存已成规范（`data-tool-contract` spec:105-117、`concepts-tool` spec:85、design D-3、tasks 3.3），预算与间隔按列表级请求数计，Risks（165）给出「20 标的 × 10 日 = 10 次」联合推演。**键的构造性缺陷见 Issue 21**。 |
| 8 | 与 roadmap/architecture/AGENTS 冲突、写分区缺登记 | 已解决（仓内文档未落地，任务已具名） | roadmap §5 已登记两条白名单与阶段豁免（roadmap:81）、`contracts §10`（147-152）与 carryover 台账 §3.1 均在；tasks 8.2（architecture 两处）、8.3（vault-integration + AGENTS/roadmap 登记请求）、8.4（模块头回指台账）；design Risks（170）登记阶段例外。注意 `docs/architecture.md:24/42-46/56` 目前仍是旧文本（connector-tdx 搬运）——落点存在但未核销——收尾由 tasks 8.2/8.3 完成，本 change 门禁不含该文件。 |
| 9 | 「已核实」把实测/引用/假设混一起 | 已解决 | design 拆为「已实测的事实（证据 + 日期）」（7-27）与「待验证（任务 + 降级策略）」（29-39）；TQ 口径移入待验证并落 tasks 8.5；不可达的 `vendor/cordis` 引用换成 better-sidebar 先例并注明「版本等价性未核验」（26）；行号引用改符号名（14、18-22）。 |
| 10 | S8 移植口径失真（`fields` 无 `reason`/`plate_id`） | 已解决 | `concepts-tool` 新增「源字段白名单与 best-effort 降级」Requirement（22-43）：`fields` 扩为 5 字段、缺失 → `null` + `notes` 且不阻塞 `available`；tasks 6.1（query 序列化断言）/6.2/6.6（真实 fixture 定稿）；carryover §3.1 s8 行（59）记偏离。 |
| 11 | S5 本地依赖、第三套后缀、「任意历史记录」语义 | 已解决 | 三项各自成文：`limit-reason-tool`「S5 备源移植口径」Requirement（112-133，删本地 HTML / `marketId` 表化 / 北交所显式不支持）；「列表业务日与命中记录日分列」Requirement（95-110，`hitRecordDate` 独立字段）；design D-13（146-152）；tasks 5.2/5.3/5.6；carryover s5 行（58）。 |
| 12 | Requirement ↔ tasks 覆盖缺口（7 处） | 部分解决 | ① 迁移提示 tasks 2.5；②③④⑤⑥ 空值/缺失/不可用态（3.4/3.5）、健康检查自动用例（7.1）、频控 5 用例（3.6）、单位收口（spec:64 + proposal:41 + tasks 3.4 注释）、T1/T2 缺口断言（5.6/6.5）；⑦ 依赖与 smoke 改造（tasks 1.1/1.2/1.4）。**残留见 Issue 24/23**：单位 Requirement 六条 scenario 只兑现两条、「中文金额文本不参与计算」无落点；`trade-date-tool` 的 `errors` 字段未声明。 |
| 13 | 配置面个人路径 + 必填无默认 + `traderKitConfig` 无人处置 | 已解决 | D-1（58-60）改 `z.string().default('')` + 调用期报错；D-6（103）MUST NOT 把签章现值写进发布产物；tasks 1.1（`Config` 导出 + `TraderKitConfig` 处置 + MUST NOT 留两份类型）、1.2（验收含 grep 无盘符/无实际 sign/ts）、1.5（空 `dataRoot` 挂载成功 + 写入报错用例）；`data-root-layout` spec:5 + scenario 12-15。 |
| 14 | 健康检查与「唯一闸门 + 3 秒 + 预算」打架 | 已解决 | design D-8（109-117）三条口径（独立通道/3 秒总硬超时/不阻塞）+ `diagnostics` 字段定义；spec:261-295 含 scenario「探测超时」「探测不计预算与护栏计数」「`diagnostics` 配置面」；tasks 7.1 含「预算 0 + guard 计数 0」用例；D-5 措辞已收窄为「数据面唯一闸门」（83）。 |
| 15 | 宏观预留区映射到裸根 | 已解决（措辞待收窄） | `data-root-layout` spec:36 指向 `题材调研/00宏观/` +「仅登记、不解析」+ scenario 57-60；design D-14（154-156）；tasks 2.1 验收要求解析结果为 `题材调研/00宏观/`（非裸根）。轻微偏差：spec:60 的「或显式报错」与 tasks 2.1 的「必须返回路径」不一致，见 Issue 26。 |
| 16 | `refresh` 幽灵参数 + `cacheSchema` 无失效规则 | 已解决 | `refresh` 在三份 spec 均已显式禁止（`data-tool-contract` spec:117 + scenario「无刷新入口」144-147、`limit-reason-tool` spec:5、`concepts-tool` spec:5），design D-3（73）、Risks（162）、proposal:42 一致；无残留。`cacheSchema` 不匹配 → 视为未命中 + 覆盖写成 Requirement（115）+ scenario（129-132）+ tasks 3.3/3.7。 |
| 17 | 只读边界与「页面层无取数实现」断言可绕过且会空过 | 部分解决 | 断言方式已改结构断言（spec:228-259 + scenario 246-254 + `targets.length > 0`；tasks 7.3 五条）；但仍缺「扫描目标必须存在于本 change 时点」的前置，见 Issue 25。 |
| 18 | 脚本口径移植无台账落点 | 已解决 | `docs/carryover.md` 已新增行（42）+ §3.1 专节（47-65，三行脚本记录 + 偏离清单 + 哈希规则 + 回指要求）；tasks 8.1（验收含 grep 命中）、8.4（模块头回指）、8.5（TQ spike 行）。 |
| 19 | `DB/stock/` 并非「未建索引」前提需复核 | 已解决 | design 已实测表（24）记「约 1095 个中文名 md、有文件无 code→文件名稳定映射」并给出结论与表述修正要求；D-11（129-133）复述；Open Questions 第 6 条登记索引化议题。 |

### Issues

#### Issue 20 (Critical): 日期三义三种格式并存——限流日 `YYYYMMDD` / 业务日 `YYYY-MM-DD`，跨 change 一致性校验必然误判
**Severity**: Critical
**Location**: `openspec/changes/data-foundation/specs/trade-date-tool/spec.md:10,22,27,36,52,59,64,78-79`、`specs/limit-reason-tool/spec.md:5,15,20,104`、`specs/data-tool-contract/spec.md:23-25,29,55`、`docs/design/iteration-1-contracts.md:27-34`；消费方 `openspec/changes/daily-summary/specs/daily-summary/spec.md:88,114-117,132,137`、`openspec/changes/review-page/specs/review-page/spec.md:191-192`
**Description**: 同一份文本里三种格式对同一日期概念并存：① 限流日/请求日 `YYYYMMDD`（`trade-date-tool` spec:22 `requestedDate` 格式 `YYYYMMDD`、spec:27 示例 `'20260924'`）；② 业务日返回类型为 `'YYYY-MM-DD'`（spec:10、`contracts §1` line 40、scenario 78-79 `businessDate='2026-09-24'`）；③ `limit-reason-tool` 的 `tradeDate` 只写「数据源业务日期」不写格式——参考实现取自响应体 `data.date`（原脚本比较口径是 `YYYYMMDD` 紧凑串），而 `contracts §1` line 34 规定 `tradeDate`（= `businessDate`）。由此产生两处**实际数据错误**：(a) `trade-date-tool` spec:52/59 的判据 `businessDate === rateLimitDate` 在「业务日 `2026-09-24` vs 限流日 `20260924`」下**恒为 false** → `isTradingDay` 永远 `null`、change 4 的归属确认被无谓触发；(b) change 5 的硬门槛 `limitReason.tradeDate !== 目标交易日`（daily-summary spec:88/114-117；目标交易日为 `YYYYMMDD`，见其 spec:132 的 `tradeDate` 列虽写 `^\d{4}-\d{2}-\d{2}$`，但调用入参 spec:112 明写 `date='20260924'`）在格式不同时**恒为真** → 每个标的的 `limitReason` 被静默降级 `missing(dateMismatch)`，附注永远标「部分」。这不是显示问题，是「数据被系统性丢弃」。
**Suggestion**: 在 `contracts §1` 与 `data-tool-contract` 的日期三义 Requirement 中各加一行**格式列**（例如统一 `businessDate`/`tradeDate`/`date` 入参 = `YYYY-MM-DD`，或统一紧凑 `YYYYMMDD`），并由 `src/data/trade-date.ts` 导出唯一 `normalizeDate()` 作为跨边界比较的前置；所有 cross-change 比较（`isTradingDay` 判据、`dateMismatch` 门槛、缓存桶键、`<YYYYMMDD>` 目录段）MUST 经它；spec 补一条 scenario「同一业务日的紧凑/带连字符两种写法必须判为相等」。

#### Issue 21 (High): 列表级缓存键 = `source + businessDate` 不可构造——取数前不知道业务日，零网络与预算推演落空
**Severity**: High
**Location**: `specs/data-tool-contract/spec.md:105-117,111,124-127`、`specs/trade-date-tool/spec.md:102,109-112`、`specs/limit-reason-tool/spec.md:54`、`specs/concepts-tool/spec.md:85`、`design.md:70-72`、`tasks.md:61`；消费方 `openspec/changes/review-page/design.md:117,120`
**Description**: 两层缓存的列表级键被定义为 `source + businessDate`，而 `businessDate` 只能来自列表响应体（`data-tool-contract` spec:25、`trade-date-tool` spec:31「无条件从响应体取值」）。「入口命中判定（零网络）」（tasks 3.3）因此无法在取数前构造键：唯一可行的实现只能用 `requestedDate` 查，于是——① 缓存条目的**写键**与**读键**不是同一个量；② 当源返回的业务日 ≠ 请求日（历史请求、跨零点、源滞后）时，下次同参数请求读不到刚写的条目 → 重复出网、重复消耗预算，「同一交易日同一输入重复调用 MUST 零网络」（spec:116）在这一类输入上不成立；③ `trade-date-tool` spec:109-112 的「T1 先取完列表 → T0 命中同一列表级缓存条目（`source + businessDate` 键）」在实现上描述的是一次读键已存在的结果，未说明第一次请求如何把条目放到 `businessDate` 这个键上；④ change 4 task 5.1（`review-page/tasks.md:163,171`）明确用返回的 `businessDate` 推进并以 `source + businessDate` 为桶键，而它的第一次查询同样只有日期入参 → 与本 change 的实现约定必须逐字对齐，否则「≤7 次出站」预算推演失效。
**Suggestion**: 把列表级键改为**可构造的请求侧量** `source + requestedDate`（负载内保存 `businessDate` 与 `hitEndpoint`），或明确双键（请求键 + 业务日别名索引）；在 `data-tool-contract` 的缓存 Requirement 里写清「键由入参构造、`businessDate` 是值不是键」并补 scenario「请求日 ≠ 源业务日时第二次同参调用仍零网络」；`trade-date-tool` spec:109-112 与 review-page 的桶键措辞同步。

#### Issue 22 (High): 契约 §1 允许「当日 History 为空回退 List」，本 change 却规定互相兜底仅限同一分支
**Severity**: High
**Location**: `docs/design/iteration-1-contracts.md:31-33` 对照 `specs/limit-reason-tool/spec.md:39,46-49`、`specs/data-tool-contract/spec.md:28,42-45`
**Description**: `contracts §1` 写「History 为空**仅当** `requestedDate === rateLimitDate` 时可回退 List」——即当日 History 返回空是允许回退 List 的（且这一条是实现上唯一有用的兜底：History 不含当天）；`data-tool-contract` spec:28 与 42-45 的禁止口径只覆盖 `requestedDate !== rateLimitDate`，与契约一致。但 `limit-reason-tool` spec:39 写成「两者 SHALL 互相兜底**仅限同一路由分支内**（历史分支不得用 List 兜底）」，字面含义是 List 分支也不得回退 History、任何分支都不得跨端点——与契约「当日可回退」相抵触；spec:46-49 的 scenario 又以「List 无 `date` 参数」为理由禁止回退，未区分当日/历史。实现者按 spec:39 会把当日的 History 兜底也删掉，按契约 §1 又必须保留，判据在跨 change 唯一事实源与本 change spec 之间悬空。
**Suggestion**: 统一为契约口径：只禁止 `requestedDate !== rateLimitDate` 时用 List 数据（保留 `dateUnavailable` 硬失败），并显式写明「`requestedDate === rateLimitDate` 时 List 与当日 History 可互为兜底」；`limit-reason-tool` spec:39 与 scenario 46-49 按此改写，避免「同一分支内」这种既未定义分支边界、又与契约冲突的措辞。

#### Issue 23 (Medium): 工具返回体字段声明与自身场景/需求不一致（`hitRecordDate`、`errors` 缺声明），跨 change 裁剪表随之漏字段
**Severity**: Medium
**Location**: `specs/limit-reason-tool/spec.md:5` 对照 `95-110`、`tasks.md:119,121`；`specs/trade-date-tool/spec.md:10` 对照 `38-41`；`openspec/changes/daily-summary/specs/daily-summary/spec.md:137`
**Description**: ① `limit-reason-tool` spec:5 枚举返回字段时**没有** `hitRecordDate`，但新增的「列表业务日与命中记录日分列」Requirement（95-110）要求它以独立字段出现，tasks 5.5/5.6 验收也断言该字段 → 字段清单与需求互斥；下游 change 5 的数据包裁剪表（daily-summary spec:137）同样没有 `hitRecordDate`，`Open Questions` 第 5 条还挂着「是否采用」——即本 change 新引入的字段在契约面没有任何消费方落点。② `trade-date-tool` spec:10 的返回结构不含 `errors`，但 scenario 38-41 要求「源不可用时 `errors` 说明已尝试的源与原因」→ 场景断言一个未声明的字段；下游（change 4/5）据字段名判断失败原因时口径缺失。两处都会让「输出 schema 快照断言含 `hitRecordDate`」（tasks 5.5）在实现时自相矛盾。
**Suggestion**: 在 `limit-reason-tool` spec:5 的字段枚举补 `hitRecordDate`（并注明 `null` 允许），`trade-date-tool` spec:10 补 `errors[]`；同步登记为 change 5 数据包 schema 的可选裁剪字段（或明确本迭代不消费并在 Open Question 5 里写死「只标注不采用、无消费方」）。

#### Issue 24 (Medium): 契约重复与规范落点缺口——消费方义务写进本 change spec、`refresh` 无 schema 扫描用例、单位 scenario 半落地
**Severity**: Medium
**Location**: `specs/trade-date-tool/spec.md:81-84`、`tasks.md:177`（7.3 五条）、`specs/data-tool-contract/spec.md:62-84`（尤其 76-79）、`tasks.md:63-67`
**Description**: ① `trade-date-tool` spec:81-84 的 scenario 直接约束 change 4/5 的消费行为（「消费方 MUST 要求用户指定交易日」），与 `contracts §1` line 43-46 重复，构成跨 change 的第二份口径——本 change 因此凭空依赖尚未开工的 change 4/5（违反 `contracts §1` 的「唯一事实源」原则），且措辞若与 change 4 spec:196/change 5 spec:56 漂移将无法判定谁对。② `data-tool-contract` 已有 scenario「无刷新入口」（spec:144-147）要求审查 T0/T1/T2 工具入参 schema，但 tasks 7.3 的五条结构断言（177）只覆盖 import 白名单/`fetch(` 通道/17709/交易接口/目标非空，**没有** `refresh` schema 扫描用例——该 scenario 目前不可验收。③ 「中文金额文本不参与计算」scenario（spec:76-79）无任何任务落点（tasks 3.4/3.5 只覆盖空值守卫、信封、比例换算、不可用态），且 tasks 3.4 明写「单位用例标记 `todo`/不设断言」，而 tasks 8.7 验收要求「`pnpm test` 无 skip 的扫描型用例」——`todo` 与「无 skip」的相容性未裁决。
**Suggestion**: 将 spec:81-84 的消费方义务改为「指向 `contracts §1`」（本 change 只保留 `businessDate=null` 时不填充的产出约束）；tasks 7.3 增第 ⑥ 条「T0/T1/T2 入参 schema 无 `refresh`」；对「中文金额文本」要么删除该 scenario（声明本 change 无金额字段、整体不验收）要么补一条不 skip 的断言。

#### Issue 25 (Medium): 结构断言目标在本 change 时点不存在——门禁必然红或空过
**Severity**: Medium
**Location**: `specs/data-tool-contract/spec.md:232-235,246-254`、`tasks.md:177-180`（7.3）、`tasks.md:212-214`（8.7）；对照 `openspec/changes/tq-skill-installer/tasks.md:3,15`（change 3 无 `blocked_by`、`src/skill/download.ts` 由 change 3 实现）
**Description**: tasks 7.3 要求断言「`src/routes/**`、`src/client/**` 不 import `src/data/**`」且「全仓仅 `src/data/http.ts` 与 `src/skill/download.ts` 两条通道允许 `fetch(`」，并对每条扫描型用例强制 `targets.length > 0`。但本仓现状：`src/` 下既无 `src/routes/`、`src/client/`，也无 `src/skill/`（change 3 才创建 `src/skill/download.ts`，且 change 3 自述无前置依赖、不阻塞于 change 2），唯一存在的目标只有 `src/data/http.ts`。于是 tasks 8.7 的「`pnpm test` 无 skip 的扫描型用例」在本 change 内**不可能同时成立**：① 目标非空断言会让 7.3 直接红；或 ② 实现者把目标列表放宽/跳过，等于回到 Round 1 Issue 17 的「绿而无证据」。spec:249 的措辞「运行数据模块测试 THEN 通过…断言」把尚未存在的目录当成既有事实。
**Suggestion**: 明确两点并二选一落地：使 ① 目标由「已存在的 `src/data/**` 与 `src/index.ts`」构成（对尚未存在的 `src/routes/**`/`src/client/**` 写「目录存在时才断言，且用例名标记 deferred 并计入 change 4 验收」）；② 或在 tasks 增一条前置任务声明「`src/routes/`、`src/skill/` 由 change 4/change 3 创建后本用例才转正，本迭代以 `src/data/**` 为扫描域」，spec:232-235 同步去掉「全仓」这种在本时点无法验证的绝对量词。

#### Issue 26 (Low): 遗留措辞不一致（宏观预留区解析 vs 报错、manifest `contributes.tools` 仍为空、`diagnostics` 默认值未获 owner 裁决）
**Severity**: Low
**Location**: `specs/data-root-layout/spec.md:57-60` 对照 `tasks.md:26-28`（2.1）；`tasks.md:11`（1.3）对照 `dsh.plugin.json:9-12`；`design.md:117,178`（D-8/Open Q1）对照 `tasks.md:3`（1.1）
**Description**: ① spec:60 允许宏观预留区「显式报错**或**返回既有路径」，tasks 2.1 验收却要求「宏观区解析返回 `题材调研/00宏观/`（非裸根）」→ 按 spec 实现成报错即验收失败，二选一未定。② tasks 1.3 写「沿用 `dsh.plugin.json` 的 `contributes.tools` 声明口径（工具名与注册项一致）」，但该文件当前 `contributes.tools: []`，且本 change 任务清单**没有**同步 `contributes.tools` 的任务或验收（tq-skill-installer 只把「是否为市场渠道约定」列为待核验 tasks 5.3）。③ `diagnostics.tdx17709.enabled` 默认 `true`（tasks 1.1 验收项之一），design D-8 却把「连端口接触是否可接受」列为待 owner 裁决（Open Q1），Open Q1 没有对应任务/验收来源——默认值先于裁决落地。
**Suggestion**: ① 把 spec:57-60 收窄为与 tasks 2.1 一致（返回既有路径；未开放时显式报错只对调用解析开放后）；② tasks 1.3 增「同步 `dsh.plugin.json#contributes.tools` 为 T0/T1/T2 三项（若不消费则在 README 注明属市场渠道约定）」；③ 在 tasks 1.1 验收里标注 `tdx17709.enabled` 默认值待 Open Q1 裁决、裁决前按「仅登记不探测」或写明默认即为裁决结果。

### Positive Aspects

- **三个 Critical 空洞在正文（非处置表）里真正闭合**：今日/历史路由判据、`dateUnavailable` 硬失败、`tradeDate` 无条件取值在 spec/design/tasks 三处逐字对齐，且补了 `trade-date-tool` 作为单点实现——change 4 的 `TradeDateResolver` 与 change 5 的 `review_daily_scan` 都明确指向 `traderKit.data.resolveTradeDate`，跨 change 不再各推日期。
- **「幽灵参数」与「红线」类修正是彻底的**：`refresh` 在三份 spec + design + proposal + tasks 全部消失并改成可扫描的负向要求；S5 时间只手 `lastTime` 有 Requirement + 两条 scenario + 两个任务验收断言，无一处「firstTime 标 source=S5」残留。
- **频控与健康检查从「声明唯一」改到「三个口径同时写明」**：`offSession` 只放宽时段、`fullMarket` 判据、`sessionOverride`、独立探测通道（不计预算/不计 guard 计数/3 秒**总**硬超时）四处自相矛盾均已消解，且都配了「出站计数 == 0」的可断言形式——这是本轮质量提升最大的部分。
- **任务面质量显著提高**：每条任务都带产物/验收/依赖，验收具体到用例名与命令，第 8 节把文档、登记、依赖回填、门禁单列，`contracts §10` 的三处回写都有具名任务指向（8.2/8.3/8.4），`docs/carryover.md` §3.1 与本轮同步落地。
- **跨 change 回写已被吸收**：`contracts §7` 的两条出站通道、`contracts §1` 的 T0、`health.status()` 两段视图在 spec/design/tasks 三处一致，tq-skill-installer 的 R1/R2/R3 回写项已由本 change 实际改入正文，不再是「双方都自称唯一出入口」。

### Summary

1. **日期格式不一致是本轮唯一的 Critical**（Issue 20）：限流日 `YYYYMMDD` 与业务日/`tradeDate` `YYYY-MM-DD` 并存，会让 `trade-date-tool` 的 `isTradingDay` 判据恒 false，并让 change 5 的 `dateMismatch` 硬门槛（daily-summary spec:88/114-117）对所有标的恒真、静默降级——不修则 change 5 的附注全部「部分」，且 change 4 每次提交都要求无谓归属确认。
2. **列表级缓存键不可构造**（Issue 21）：键含取数后才知道的 `businessDate`，导致「同参重复调用零网络」「20 标的 ×10 日 = 10 次请求」的推演与 change 4 的 ≤7 次出站预算在实现上对不上，需先定键再谈预算。
3. **契约与 spec 对「当日回退 List」相反表述**（Issue 22）+ 返回体字段缺声明（Issue 23）+ 结构断言目标不存在（Issue 25）：三条都属「实现第一步就会踩到」的返工面，且都会让 tasks 的验收在同一 change 内自相矛盾。

**Consensus Status**: NEEDS_REVISION

---

## Round 3 — 2026-09-27

### Overall Assessment

Round 2 的 Critical 硬伤在**正文**里确已闭合：日期格式唯一口径（`contracts §1` 格式列 + `design.md` D-15 + `src/data/date.ts` 单点 + tasks 4.5/4.3/7.3⑥/8.8）使 `isTradingDay` 判据改为「归一后同格式比较」并配「不允许恒 false 写法」用例；列表级缓存键改为可构造的 `source + requestedDate` 并连带重算预算（「一次 History 请求 = 一次列表级请求」）；路由口径与 `contracts §1` 逐字对齐。但本轮在**跨 change 具名接口**上又出现两处会直接导致返工/数据错误的新空洞：change 5 的「预算预检」所依赖的 `traderKit.data.guardStatus()` 在 change 2 的 spec/design/tasks 中**完全没有落点**（其登记指针还指向 change 5 不存在的 Open Questions 13），以及「历史日 S7 History 空、S5 命中」时最终 `available`/`errors` 未定义——该分支下 S5 的有效数据会被 change 5 按 `dateUnavailable` 静默降级为 `missing`。叠加 Issue 26③ 未闭合（`tdx17709.enabled` 默认值 spec 与 design/tasks 相反），本 change 仍不宜直接作为实现依据。

**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 20 | 日期三义三种格式并存，跨 change 校验必然误判 | 已解决 | 正文核验：`contracts §1:31-35` 格式唯一口径 + 三处例外；`data-tool-contract` spec:21-27（格式列）/54-57/69-72；`trade-date-tool` spec:9/57-60/74-78（归一后同格式比较 + 「不允许恒 false 写法」）；`limit-reason-tool` spec:5/19-20；`concepts-tool` spec:5；`data-root-layout` spec:69；`design.md` D-15（159-167）；tasks 4.5（含「格式唯一性」结构断言）/4.3/7.3⑥/8.8。全仓 `YYYYMMDD` 命中（35 处）逐条归入目录模板/天级缓存目录/源参数三处，无契约或 payload 残留紧凑写法。 |
| 21 | 列表级缓存键 = `source + businessDate` 不可构造 | 已解决 | 键统一为 `source + requestedDate`（`contracts §9:157-160`、`data-tool-contract` spec:123/126、「源业务日 ≠ 请求日时同参仍零网络」142-145、「历史请求按列表级计数」147-150、`trade-date-tool` spec:120/127-135、`concepts-tool` spec:85、`design.md` D-3:70-72 + Risks:177、tasks 3.3/3.7/4.1/6.3）；change 4 已同步（`review-page/design.md:141,145`、`specs/review-page/spec.md:206,240`、tasks 5.1/5.3/5.5 的 `source + requestedDate`）。预算推演自洽（10 日回溯 = 10 次列表级请求）。 |
| 22 | 契约 §1 允许「当日 History 空回退 List」，本 change 规定仅限同一分支 | 已解决 | 「仅限同一路由分支内」已从正文删除；当日可回退 History 与非当日 MUST NOT 回退 List 分别成条（`limit-reason-tool` spec:41-42/51-54/71-74、`data-tool-contract` spec:29-30/59-62、`design.md` D-3:74），与 `contracts §1:36-39` 一致。**残留为新 Issue 28**（S5 命中时的最终 `available`/`errors` 未定义），非本条未闭合。 |
| 23 | `hitRecordDate`/`errors` 缺声明 | 已解决 | `limit-reason-tool` spec:5 字段枚举含 `hitRecordDate`（`YYYY-MM-DD`\|null）；`trade-date-tool` spec:10 返回含 `errors[]`（成功时空数组）+ `design.md` D-12:141；tasks 5.5 快照断言含两者、4.1/4.3 含 `errors`。下游 change 5 裁剪表不含该字段与 `design.md` Open Q5「只标注、不采用」自洽。 |
| 24 | 消费方义务写进本 spec、`refresh` 无 schema 扫描、单位 scenario 半落地 | 已解决 | ① `trade-date-tool` spec:12/87/97 消费方行为一律指向 `contracts §1`；② tasks 7.3⑥ + spec:260「T0/T1/T2 入参 schema 无 `refresh`」；③ 「中文金额文本」保留为**不 skip** 用例（spec:88-91 + tasks 3.4「MUST NOT 用 skip/todo 掩盖」+ Open Q7）。 |
| 25 | 结构断言目标在本 change 时点不存在 | 已解决 | 扫描域分层成文（`data-tool-contract` spec:255-257/271-279「对尚不存在的目录不得以目标为 0 通过」）；tasks 7.3（⑥ 项齐全）/7.5/8.7；`design.md` Open Q8。可验证域 `src/data/**` + `src/index.ts` 使 `targets.length > 0` 恒成立。跨 change 移交仍有措辞缺口 → 见 Issue 33（Low）。 |
| 26 | 遗留措辞不一致（宏观区解析 vs 报错、`contributes.tools`、`diagnostics` 默认值） | 部分解决 | ①②已闭合：宏观区收窄为「返回既有 `题材调研/00宏观/`；未登记写入业务区才报错」（spec:57-60 与 tasks 2.1 一致，D-14:157 同步）；tasks 1.3 增 `dsh.plugin.json#contributes.tools` 同步 + 验收。③**未闭合**：`data-tool-contract` spec:320 仍写 `tdx17709.enabled`「默认 `true`」，而 `design.md` D-8:117 同段先写「默认 `true`」后写「裁决前默认值 = 关闭」、tasks 1.1:3 与 1.5:19-21 断言默认 `false`/「未探测」→ 见 Issue 29。 |
| R1-2 | 三义格式未统一、`businessDate === rateLimitDate` 归一未定义 | 已解决 | 由 Issue 20/21 处置闭合（格式列 + `src/data/date.ts` 单点 + 同格式比较 scenario + tasks 4.5）。 |
| R1-7 | 列表级缓存键不可构造 | 已解决 | 由 Issue 21 处置闭合（spec/design/tasks/proposal/change 4 五处一致）。 |
| R1-12 | 单位六 scenario 只兑现两条、T0 `errors` 未声明 | 已解决 | `errors[]` 已声明；单位 Requirement 明写「本 change 不验收」（spec:76/93-96、D-9:119-123、proposal:42）；中文金额文本转为不 skip 用例。 |
| R1-17 | 缺「扫描目标必须存在于本 change 时点」前置 | 已解决 | 由 Issue 25 处置闭合（扫描域 + deferred + `targets.length > 0`）。 |

### Issues

#### Issue 27 (High): change 5 的预算预检具名出口 `traderKit.data.guardStatus()` 在本 change 无任何落点
**Severity**: High
**Location**: `openspec/changes/daily-summary/specs/daily-summary/spec.md:255-257`（Requirement「预算预检与分批」）、`daily-summary/design.md:68,93-95`、`daily-summary/tasks.md:26,77,133-135`、`daily-summary/proposal.md:15,31`；对照 `openspec/changes/data-foundation/design.md:107`（D-7 出口清单）、`tasks.md:177`（7.2 service 出口）、`specs/data-tool-contract/spec.md:191-249,286-320`
**Description**: change 5 以 MUST 级要求「运行前查询 change 2 数据模块当日剩余预算」，并把该能力具名为 `traderKit.data.guardStatus()`（缺失时按 D-1b 返回 `DEPENDENCY_UNAVAILABLE`、预算预检 SHALL 显式失败、MUST NOT 自建预算计数）。但 change 2 是本插件的 `traderKit.data.*` 唯一 owner（`contracts §11`），其全部正文只有 `data.resolveTradeDate` / `getLimitReason` / `getConcepts` 与 `health.status()` 四个出口（`design.md` D-7、tasks 7.2），spec 里也没有任何关于「预算/护栏用量查询出口」的 Requirement 或 scenario——`data-tool-contract` spec:309 只在健康检查场景里**假定**「挂载后可查询当日预算用量与 guard 出站计数」，却未把该查询定为任何 export。更具体地：change 5 的登记指针「见 design Open Questions 13」在该 change 内**不存在**（其 Open Questions 只到第 11 条，`daily-summary/design.md:175-185`；design:9 另引「Open Questions 12」同样悬空）。结果是 change 5 的「预算预检与分批」Requirement 无法验收（它不能自建，也不能经 service 拿到），必须回到 change 2 增补具名出口——这正是 `contracts §0:18-19`「无具名接口的『复用』视为无效表述」要阻止的返工面。
**Suggestion**: 在 `data-tool-contract` 增一条 Requirement（或扩「频控护栏」）：service `traderKit.data.guardStatus(): { source, rateLimitDate, used, remaining, budget }[]`（或等价签名，按列表级请求数计）为**预算/护栏状态唯一出口**，补一条 scenario 与 tasks 7.2 验收项；同时由 Lead 把 change 5 的登记指针改指到该具名条目并修正其悬空的 Open Questions 12/13 引用（跨 change 文件由对应 owner 落地）。

#### Issue 28 (High): 历史日 S7 History 空、S5 命中时最终 `available`/`errors` 未定义——S5 有效数据会被下游丢弃
**Severity**: High
**Location**: `specs/limit-reason-tool/spec.md:42`（「SHALL 返回 `available=false` + `errors:[dateUnavailable]` 并继续尝试 S5」）对照同文件 `44`、`56-59`（scenario「备源可继续」）与 `172-184`（`data-tool-contract` 显式降级：主源失败 SHALL 换备源、主备均失败才 `available=false`）；消费方 `openspec/changes/daily-summary/specs/daily-summary/spec.md:95,97,151,231`
**Description**: Round 2 的 Issue 22 修正引入了「继续尝试 S5」这一句，却没定义 S5 **成功**后的聚合语义。按 spec:42 字面，历史路由下 S7 History 空即产出 `available=false` + `errors:[dateUnavailable]`；按 spec:44 与显式降级 Requirement，S7 失败应降级 S5，S5 成功即应为可用态（`source=S5`）——两条要求在同一 spec 内对同一输入给出相反结论，且没有任何优先级/覆盖规则。下游把这层歧义放大成数据错误：change 5 spec:97/151 只按「`errors` 含 `dateUnavailable`」判定，一旦实现保留该 error（spec:59 的 scenario 正是「记 `errors:[dateUnavailable]`…备源可继续」），S5 真实提供的 `cause`/`firstTime` 会被静默降级为 `missing(sourceUnavailable)`、正文写「该日涨停原因数据不可得」；若实现反过来在 S5 命中后清空该 error，则同一输入在不同实现下产出两种结果。这是「历史补写」这一 change 5 主用途路径上的确定性分歧，属实现第一步就会踩到的返工点。
**Suggestion**: 在 `limit-reason-tool` 路由/降级 Requirement 补一句聚合优先级，并与 `contracts §1` 同步：最终 `available` = 「任一源就该 `requestedDate` 给出数据」；S5 命中且 `hitRecordDate`/业务日与请求日一致时 `available=true`、`source=S5`，此时 `dateUnavailable` **MUST NOT** 保留在 `errors`（S7 leg 的失败只进 `notes`/`source` 说明），并补 scenario「历史日 S7 History 空但 S5 命中 → `available=true`、`errors` 不含 `dateUnavailable`」。change 5 侧同口径回写（`daily-summary` spec:97/151）。

#### Issue 29 (Medium): `diagnostics.tdx17709.enabled` 默认值在 spec/design/tasks 三处相反——Issue 26③ 未闭合
**Severity**: Medium
**Location**: `specs/data-tool-contract/spec.md:320`（「默认 `true`」）对照 `design.md:117`（同段先「默认 `true`」后「裁决前…默认值 = 关闭」）、`tasks.md:3`（「默认 `false`」）、`tasks.md:19-21`（1.5 断言「默认配置下 17709 项为『未探测』」）、`design.md:190`（Open Q1）
**Description**: 处置表自称按「裁决前默认 `false`」落地，但正文只有 design/tasks 改了，**spec 未改**：`data-tool-contract` spec:320 仍是无条件「布尔，默认 `true`」，而 spec 是 Requirement 层（实现者与验收的权威依据）。同时 design D-8:117 段内自相矛盾（同一段先说「默认 `true`，关闭后记为未探测」，后说「裁决前按仅登记、不探测（默认值 = 关闭）」）。按 spec 实现 → tasks 1.5「关闭 17709 探测记为未探测」/「默认配置下 17709 项为未探测」红；按 tasks 实现 → spec scenario「TdxW 未启动」在默认配置下不可达。这正是「处置表与正文不一致 = 未闭合」。
**Suggestion**: 把 spec:320 收窄为「默认值待 `design.md` Open Q1 裁决；裁决前默认 `false`（仅登记、不探测）」并把 D-8:117 的「默认 `true`」删掉（只保留裁决后的目标值），tasks 1.1/1.5 的断言与之一致。

#### Issue 30 (Medium): T2 `get_concepts` 的 `date` 入参无语义保障，且列表级 payload 的 `businessDate` 对 S8 不可满足
**Severity**: Medium
**Location**: `specs/concepts-tool/spec.md:5,85,97-100`；对照 `specs/data-tool-contract/spec.md:25,123`、`contracts §9:157-158`
**Description**: Round 2 为统一格式给 T2 **新增**了 `date` 入参（「用于选择 S8 的概念快照口径；缺省 = 限流日」，spec:5），但 S8 是不带日期参数的实时快照接口（`design.md` 已实测：`plates_by_any_stock`，无日期入参），正文也没有任何「`date` ≠ 限流日时拒绝/标注」的约束。于是 `get_concepts(code, '2026-09-20')` 会拿到**当日**快照，却按 `requestedDate` 写入 `agent/DB/temp/dsh-trader-kit/20260920/` 天级桶（spec:85、`data-tool-contract` spec:126/129），返回体里既无 `businessDate` 也无 `errors:[dateUnavailable]`（spec:5 字段表不含 `businessDate`），消费方无从察觉被归属到历史日；下一个同参请求命中该桶 → 缓存永久固化错误归属。同时 `data-tool-contract` spec:123 把「payload 内含源返回的 `businessDate`」写成列表级层级的通用 MUST（`concepts-tool` spec:85 复述），而 S8 响应没有日期字段，该 requirement 对 T2 不可满足且未声明降级（`null` + `notes`）。
**Suggestion**: 二选一并写进 spec：① T2 的 `date` 仅接受限流日，其它值显式参数错误或返回 `available=false` + `errors:[dateUnavailable]`（与 T1 历史路由同族）；或 ② 明确「S8 无日期字段 → `businessDate=null` + `notes` 标注『源无日期，按 `requestedDate` 缓存』」，并把 T1/T2 的返回体都补 `businessDate`（T2 spec:5 字段表），`data-tool-contract` 缓存表的 `businessDate` 要求加「源无日期字段时允许 `null` 并记 `notes`」的例外。

#### Issue 31 (Low): 护栏拒绝态与预算用量无具名状态/出口，change 4/5 按名消费
**Severity**: Low
**Location**: `specs/data-tool-contract/spec.md:209`（「任一超限 SHALL 显式失败并说明限额与实际用量」）对照 `openspec/changes/review-page/specs/review-page/spec.md:208,229`、`review-page/design.md:140,315,335`（`sessionRejected`）、`review-page/tasks.md:179,183`；`daily-summary/specs/daily-summary/spec.md:236,292`（`budgetExhausted`）
**Description**: change 4 明确按「数据模块返回时段拒绝态（`sessionRejected`）」驱动降级文案（并已开放问题登记「是否把 T1 列表级请求内部标 `fullMarket` 由 change 2 裁决」），change 5 的 `deferred` 原因用 `budgetExhausted`；但 change 2 只要求「显式失败并说明限额与实际用量」，未定义任何可判别、可 stub 的状态名/错误码。两处消费方因此各自造名或只能 stub，跨 change 无法对齐（`contracts §0` 的具名接口原则）。
**Suggestion**: 在「频控护栏」Requirement 里给拒绝结果一个具名形态（如 `{ rejected: true, reason: 'sessionRejected' | 'budgetExhausted' | 'batchLimitExceeded' | 'intervalLimited', limit, used }`），并同步 change 4/5 的降级文案键。

#### Issue 32 (Low): 示例数字未回写——design 仍写「回溯 N=10 交易日」，change 4/`contracts §12.5` 已定 N=6
**Severity**: Low
**Location**: `design.md:87`（「盘后回溯 ≤ 10 交易日 × 源数」）、`design.md:175`（「change 4 D-8 的『有界回溯 N=10 交易日』单源至少 9–10 秒串行」）、`design.md:176`（「20 标的 × 10 日 = 10 次」）对照 `contracts §12.5:205-208`、`openspec/changes/review-page/specs/review-page/spec.md:206`、`review-page/tasks.md:175`
**Description**: change 4 已把上限收敛为「N=6 次 T1 列表级请求（默认 6，可配置且不超 6）+ 总出站 ≤7」，change 2 的 D-5 依据段与 Risks 仍以 10 交易日举例并据此估算时延/预算。数值本身不破坏实现（预算推演结论不变），但跨 change 引用的参数已过期，会误导实现者按 10 秒级时延与 10 日回溯写断言。
**Suggestion**: 把 D-5/ Risks 的示例统一改为 N=6（并保留「N 可配置」），或注明「示例取 change 4 默认 N=6；早期稿的 10 日不再有效」。

#### Issue 33 (Low): Issue 25 的跨 change 移交不完整——change 4 的结构断言仍是单通道措辞
**Severity**: Low
**Location**: `openspec/changes/review-page/design.md:224`（D-16）、`review-page/tasks.md:206`（6.3②）「除 `src/data/http.ts` 外全仓零 `fetch(`」对照 `docs/design/iteration-1-contracts.md:139-141`、`specs/data-tool-contract/spec.md:257`、`openspec/changes/tq-skill-installer/specs/tq-skill-installer/spec.md:436`
**Description**: Round 2 已把出站通道口径改为两条具名通道（`src/data/http.ts` + `src/skill/download.ts`），但被移交的断言方（change 4 D-16/6.3②）仍是旧的单通道表述，且 change 3 的 tasks 中没有对应的结构断言/转正条目（`grep` 在 `tq-skill-installer/tasks.md` 无「结构断言/targets.length/转正」命中）。change 3 落地 `src/skill/download.ts` 后，change 4 的「全仓零 `fetch(`（除 `http.ts`）」会直接红，或被迫放宽——即 Round 1 Issue 17「绿而无证据」的路径又被打开；本 change tasks 7.5/8.7 要求「在 change 3/4 验收清单各有一条登记」在当前仓内也无落点。
**Suggestion**: 由 Lead 回写 change 4 的 D-16/6.3② 为「除 `src/data/http.ts` 与 `src/skill/download.ts` 两条具名通道外零命中」，并在 change 3 tasks 增一条指向 `test/structure.test.ts` deferred 用例的转正条目（跨 change 文件由对应 owner 落地）。

### Positive Aspects

- **Critical 修复是正文级的、可复核的**：Issue 20 的收口不只加了一句声明——`contracts §1:31-35` 给格式唯一口径与三处例外，`data-tool-contract` spec:21-27 加格式列，`trade-date-tool` spec:74-78 把「归一后同格式比较」写成带**负向断言**的 scenario（「MUST NOT 因书写格式不同而恒为 `null`」），`design.md` D-15 给出 `src/data/date.ts` 的四个导出与「MUST NOT 自行 slice/replace」的禁令，tasks 4.5 用结构断言（扫描 `src/data/**` + `src/index.ts`，先断言目标非空）兜底——格式漂移的每条退路都被堵上，且 `YYYYMMDD` 全仓 35 处命中逐条落入三类允许位置。
- **缓存键修正做到了「改一处、连带重算」**：键改 `source + requestedDate` 之后，`contracts §9`、四份 spec、design D-3、tasks 3.3/3.7、proposal 与消费方 change 4（design:141/145、spec:206/240、tasks 5.1/5.3/5.5）全部同步，并显式写入「一次 History 请求 = 一次列表级请求」与「20 标的 × 10 日 = 10 次」的联合推演，还补了「源业务日 ≠ 请求日时同参仍零网络」这一专杀旧键的反例 scenario。
- **路由口径在四处（contracts/spec×2/design）逐字一致**：当日 List 空/失败可回退 History 并记 endpoint 与 `notes`，非当日 MUST NOT 回退 List → `dateUnavailable` 硬失败，且「不含天数的历史端点在当日被拒」scenario 只禁止跳过 List 的**首取**——把 Round 1 Issue 3 的「仅 notes 标注」彻底换成硬失败。
- **跨 change 所有权已收敛且正文互指**：`health.status() = { data, skill }`（spec:290/312-315 + change 3 D-15/tasks 4.3 只提供 `skill.status({cwd?})` + `contracts §11/§12.2`）、`Config` 单点产出（change 1 不引入、change 3 只追加 `skill` 段）、两条具名出站通道——三处不再是「双方各称唯一」。
- **结构与反空过纪律被升级为可失败的断言**：扫描域分层 + `targets.length > 0` + `deferred` 命名（spec:255-279、tasks 7.3/7.5/8.7），并给了「临时创建 `src/routes/index.ts` 使 deferred 用例转红」的手工证据要求，正是 Round 1 Issue 17 想要的形态。
- **未核验项没有被伪装成事实**：design 的「已实测 / 待验证」两节继续成立（`DB/stock/` 形态、S7 `returned_date` 缺陷、S5 `first_limit_time` 语义都带证据与降级策略），`errors[]`/`hitRecordDate`/`refresh` 等新增字段与 tasks 验收一一对应。

### Summary

1. **change 5 依赖的 `traderKit.data.guardStatus()` 在 change 2 无任何具名落点**（Issue 27，High）：预算预检 Requirement 只能走 `DEPENDENCY_UNAVAILABLE`，且 change 5 的登记指针指向不存在的 Open Questions 12/13——须由本 change（`traderKit.data.*` 唯一 owner）增补出口 + scenario + tasks 验收，否则 change 5 门禁不可能通过。
2. **历史日「S7 History 空 + S5 命中」的最终 `available`/`errors` 未定义**（Issue 28，High）：同一 spec 内「返回 `available=false + dateUnavailable`」与「S7 失败降级 S5」相反，而 change 5 只按 `errors` 含 `dateUnavailable` 判 `missing(sourceUnavailable)`——S5 的有效涨停原因会被系统性丢弃或依实现而异，须补聚合优先级 scenario。
3. **Issue 26③ 未闭合 + T2 日期语义空洞**（Issue 29/30，Medium）：`tdx17709.enabled` 默认值 spec 写 `true`、design 同段自相矛盾、tasks 断言 `false`；`get_concepts` 新增的 `date` 入参在无日期的 S8 响应下会把当日快照按历史 `requestedDate` 分桶缓存，且列表级 `businessDate` 要求对 T2 不可满足。

**Consensus Status**: NEEDS_REVISION
