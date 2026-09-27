## Why

change 4/5 都要落盘与取数：复盘页面要写卡片（落哪、怎么建目录）、要显示标签与最近涨停原因（从哪取、主源挂了怎么办）；每日汇总要按标的机会式取数。这些都不是页面自己的事——需要一个**全插件共用的数据基础**：数据目录范式（决定所有产物落点）+ 交易日解析能力（日期事实源）+ 三方接口工具（T1 涨停原因、T2 概念）+ 一套硬纪律（来源标注、缓存幂等、显式降级、**代码强制频控**、只读边界）。

需求已定案分工：**TQ 能力走官方 skill（不固化进 TS 代码），只有三方接口（S7/S5/S8）才封装为插件工具**；数据目录范式以既有 vault 目录体系为蓝本、`dataRoot` 可配置、首次写入自动创建。没有这层，change 4/5 无法实现，且后续宏观/白板/模式能力会各自发明路径。

跨 change 口径以 `docs/design/iteration-1-contracts.md` 为唯一事实源（日期三义与**日期格式唯一口径**见 §1、锚点/代码规范化 §2、写入契约 §3、字节口径 §4、文件名净化 §6、断言方式 §7、事实核验纪律 §8、缓存层级与预算 §9、迭代一重排与发布产物纪律 §10、出口所有权 §11、跨 change 裁决 §12）。本 change 已按该文件与 `reviews/data-foundation-review.md`（Round 1，19 条；Round 2，Issue 20..26；Round 3，Issue 27..33）逐条修订，处置表见 `design.md` 末尾（Round 1 / Round 2 / Round 3 三节）。

## What Changes

- **数据目录范式（P1–P6）**：`dataRoot` 可配置（`default('')`，挂载可用、写入期显式报错）+ 业务区**两级映射表**（区域目录 + 文件名模板）+ 模板参数白名单与 `sanitizeNameSegment` + 首次写入自动创建（含父级）+ 越界防护（含**由外部数据拼出的路径段**）；唯一新增目录 `DB/review/`，数据工具缓存落 `agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/`，自产业务 skill 区 `agent/skills/`，宏观预留区指向既有 `题材调研/00宏观/`（仅登记），白板/模式为预留映射（不新造目录名）。
- **T0 `get_trade_date`（新增能力）**：service `traderKit.data.resolveTradeDate({ date? })` + tool `get_trade_date`，入参 canonical `YYYY-MM-DD`（兼容 `YYYYMMDD` 并经 `src/data/date.ts` 归一），返回 `{requestedDate, businessDate, isTradingDay, source, fetchedAt, evidence, errors[]}`；`isTradingDay` 只能 `true|null`（`businessDate === rateLimitDate` **同格式比较**），**禁止用系统日期推断「非交易日」**；是 change 4 `TradeDateResolver` seam 与 change 5 `review_daily_scan` 的唯一日期事实源（`iteration-1-contracts §1`）。
- **日期格式唯一口径**：工具/service 契约、数据包与缓存 payload 一律 `YYYY-MM-DD`；`YYYYMMDD` 只允许出现在目录/文件名模板参数与锚点、天级缓存目录、第三方源请求参数；转换走单点 `src/data/date.ts`（`toCompactDate`/`fromCompactDate`/`isValidIsoDate`/`rateLimitDate`），`src/data/**` MUST NOT 自行截断或拼接日期串（`iteration-1-contracts §1`）。
- **T1 `get_limit_reason(code, date?)`**：S7 换手率主源（路由判据 = **请求日 vs 限流日**：`requestedDate === rateLimitDate` → `surgeLimitList`，当日 List 空/失败可回退 `surgeLimitHistory` 并记 endpoint 与 notes；否则 → `surgeLimitHistory`，其空/失败 **MUST NOT** 回退 List）→ S5 同花顺备源；产出涨停原因、首封时间、开板次数（+ 源提供的最后封板/连板描述）+ `hitRecordDate`（S5 命中异动记录日，独立字段）；**首封时间红线**：`firstTime` 只认 S7 `first_time`，S5 `first_limit_time` 与 S6 `zt_time`（最后封板语义）**只能进 `lastTime`**；`tradeDate` 从响应体无条件取值（列表为空也不丢）；请求日 ≠ 限流日且业务日不一致 → `available=false` + `errors:[dateUnavailable]`（不用 List 兜底、不只写 `notes`）。
- **T2 `get_concepts(code, date?)`**：S8 选股宝概念（`fields=core_avg_pcp,plate_name,reason,plate_id,top_n_stocks`；`core_avg_pcp` 强度分档）+ 名称 best-effort 反查；`reason`/`plateId` 列为 best-effort（源未返回则 `null` + `notes`）。**T2 无日期语义**：S8 是不带日期参数的实时快照接口，`date` 只用于缓存分桶与列表级键（`concepts + requestedDate`），返回体 `businessDate` 在源无日期字段时为 `null` + `notes`，该 `null` MUST NOT 参与历史回溯或按业务日归档（`iteration-1-contracts §12.5`）。
- **T1 历史日聚合优先级**：历史路由下 S7 History 空/失败 **MUST NOT** 回退 List；最终 `available`/`errors` 按判定表——S5 在该业务日有命中 → `available=true`/`source='S5'`/`errors=[]`（S7 leg 失败只进 `notes`）；两源无数据 → `dateUnavailable`；两源失败 → `sourceUnavailable`（「无数据」与「取数失败」必须区分，`iteration-1-contracts §12.8`）。
- **具名状态出口**：service `traderKit.data.guardStatus()` 为预算/护栏状态唯一查询出口（`{ rateLimitDate, remaining, budgetLimit, budgetUsed, minIntervalMs, fullMarketGuard, sessionState, fetchedAt }`，多源附 `sources[]`），与护栏同一内存计数、**不出站**；护栏拒绝返回具名形态 `{ rejected: true, reason: 'sessionRejected' | 'budgetExhausted' | 'batchLimitExceeded' | 'intervalLimited', limit, used }`，change 4/5 按名消费（`iteration-1-contracts §0`/`§9`）。
- **双出口同一实现（T-1）**：Tool 出口（`ctx.tools.register`，agent 调用）+ service 出口（`traderKit`，页面调用）指向同一实现与同一缓存。
- **规范落地（T-2~T-8）**：字段规范化（`Number()` + 空值守卫；**单位规范仅对携带金额/市值字段的模块生效，本 change 不验收**）、逐字段 `{value, source, fetchedAt}`、**两层缓存**（列表级 `source+requestedDate`（**由入参构造**，payload 内含 `businessDate`）/ code 派生视图级 `requestedDate+code`；预算与最小间隔按列表级请求数计——**一次 History 请求 = 一次列表级请求**；`cacheSchema` 不匹配视为未命中并覆盖写；**本迭代无 `refresh` 入口**）、显式降级（S7→S5→"不可用+原因"）、**频控护栏在数据模块入口以代码强制**（并发/间隔/批量硬上限/盘中拒绝全市场级调用/每日预算；`offSession` **只放宽时段**、不放宽硬上限；默认值标注「经验值、可配置」）、只读边界（无 `order_stock` / `cancel_order`；以**结构断言**验证，扫描域 = `src/data/**` + `src/index.ts`，change 3/4 创建的目标按 `deferred` 用例移交）、启动健康检查（**独立通道**：不计预算/不计 guard 计数/3 秒总硬超时、不阻塞挂载）。
- **配置面首次落地**：`src/config.ts`（导出 `Config`（schemastery）：`dataRoot`、三方源参数、护栏参数、`diagnostics`），`cordis.patch.yml` 首次出现 `config` 段（**只写占位符/注释示例**：MUST NOT 写个人 vault 绝对路径或易失 `sign`/`ts` 现值，`iteration-1-contracts §10`）。
- **搬运台账**：`docs/carryover.md` 增「脚本口径移植」类目（源路径 + 抓取日期 + 哈希/状态 + 偏离清单），`src/data/**` 模块头注释回指台账行。

## Capabilities

### New Capabilities

- `data-root-layout`: 数据根配置与业务区**两级映射**（区域目录 + 文件名模板）、模板参数白名单与名称净化、目录自动创建、越界防护、迁移后置约定。
- `data-tool-contract`: T-1~T-8 的通用规范（双出口/**日期三义分离**/规范化与单位适用边界/来源/两层缓存幂等/显式降级/频控护栏/只读边界/健康检查）。
- `trade-date-tool`: T0 交易日解析（`traderKit.data.resolveTradeDate` + `get_trade_date`；业务日只取数据源、`isTradingDay ∈ {true,null}`）。
- `limit-reason-tool`: T1 涨停原因工具（S7 主 → S5 备、请求日路由判据、首封时间口径红线、列表业务日与命中记录日分列）。
- `concepts-tool`: T2 概念工具（S8 字段白名单与 best-effort 降级、强度分档、名称反查、两层缓存复用）。

### Modified Capabilities

（无。本 change 首次引入数据面规范。）

## Impact

- **新增代码**：`src/config.ts`、`src/paths/**`（两级映射、净化、解析、建目录、迁移提示）、`src/data/**`（出站客户端、护栏、缓存、规范化、**trade-date**、`limit-reason` / `concepts`、健康检查）、`src/service/**`（`traderKit` service 出口）、`src/tools/**`（T0/T1/T2 注册）；`apply(ctx)` 接入 `tools` 依赖。
- **依赖/构建**：`package.json` 增 `schemastery`（dependencies）与 `@deepseek-ai/dsh-tools`（`defineTool` 来源）；`test/smoke.test.ts` 需改造（现断言 `apply({} as never)` 不抛错，接入 `ctx.tools`/`ctx.provide` 后会红）。
- **配置**：`cordis.patch.yml` 增加 `config` 段（占位符 / 注释示例 / 本机 profile；三方源参数默认值、护栏默认值）。
- **文档**：`docs/architecture.md` 的能力边界需补「数据面 = 三方接口工具 + TQ skill」的分工事实（原表按 connector-tdx 搬运描述，已过期），写分区清单补 `DB/review/`、`agent/DB/temp/dsh-trader-kit/`；`docs/carryover.md` 增脚本口径移植台账；`vault-integration` 写分区契约补登两条白名单路径（`iteration-1-contracts §10`）。
- **下游**：change 4（B1 经 service 消费 T0/T1/T2；`TradeDateResolver` seam MUST 调用 `resolveTradeDate`）、change 5（汇总取 T1 + TQ skill；`review_daily_scan` 缺省交易日 MUST 调用 `resolveTradeDate`；预算预检 MUST 调用 `traderKit.data.guardStatus()`，MUST NOT 自建预算计数）；数据根变更后的历史迁移按 M1-Q6 后置。跨 change 引用登记见 `design.md` 的「跨 change 回写清单」（含 change 5 侧 `errors` 分档与 change 4/3 出站通道措辞）。
- **验收对照（模块文档 §9；该文档为仓外引用，未能核验）**：T0/T1/T2 在 DSH 会话 `ctx.tools` 可见、可调，返回规范化数据（**带来源**；本 change 返回体无金额/市值字段，故**不做单位验收**，单位规范仅对携带金额/市值字段的模块生效）；同一数据模块的 service 出口被复盘助手 B1 区块真实消费（页面侧验收属 change 4）；S7 不可用时 T1 走 S5 或显式错误；首次冷启动按**列表级缓存**语义估算时延（单标的也受全局最小间隔约束）；当日二次调用命中缓存零网络；`DB/review/` 与 `agent/DB/temp/<skill>/<YYYYMMDD>/` 等缺失目录在首次写入时自动创建（既有目录不重建）；T-6 频控在盘中对全市场级参数生效（`offSession` 只放宽时段）；全链路无交易接口调用路径（§9 的前两条属 change 3）。
- **明确不做**：T3 盘中状态工具（迭代一非必需）、TQ 方法固化 / MCP server / 网关工具、龙虎榜（T4 后置）、任何 UI、任何交易接口、任何刷新入口（本迭代无 `refresh`）。
