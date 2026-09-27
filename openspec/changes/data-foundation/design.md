## Context

需求已定案（2026-09-27）：数据基础两条通道——**TQ-Local 走官方 skill（agent 读取执行，不固化进 TS 代码）**，**三方接口（S7/S5/S8）才封装为插件工具**，与复盘页面共享同一数据模块（Tool 出口给 agent、service 出口给页面）。本 change 落地后者 + 全插件的数据目录范式 + **T0 交易日解析**（日期事实源的唯一实现）。

跨 change 的唯一事实源是 `docs/design/iteration-1-contracts.md`（下称 `contracts §n`）；凡本文件与各 spec 出现「复用/口径见」的表述，均按该文件具名条目执行。

### 已实测的事实（证据 + 日期）

> 纪律（`contracts §8`）：本节只写**本会话实测或可复现**的事实；未能核验的一律移入下一节「待验证」，MUST NOT 写成「已核实」。引用宿主源码用**符号名**，不用行号。

| 事实 | 证据（符号名 / 命令 / 现场观察） | 日期 |
| --- | --- | --- |
| 三份脚本存在且实现口径吻合 | `vault/agent/skills/a-stock-research-data/scripts/{fetch_zt_timeline.py, fetch_limit_reason_local.py, fetch_concepts_xuangubao.py}`（TS 侧按此移植，不重新逆向） | 2026-09-27 |
| S7 端点与参数 | `fetch_zt_timeline.fetch_hsl_reasons`：常量 `HSL_SIGN` / `HSL_TS`（另有 `HSL_BLOCK_SIGN` / `HSL_BLOCK_TS`，T1 不使用）；当日 `surgeLimitList`、历史 `surgeLimitHistory`，两条互相兜底；字段 `cause` / `first_time` / `last_time\|ori_last_time` / `open_count` / `surgedays` / `trackback` / `intensity` | 2026-09-27 |
| S7 `List` 不带 `date` 参数 | `fetch_hsl_reasons` 的 List 分支：List = 当日全市场列表（故历史路由 MUST NOT 回退 List，`contracts §1`） | 2026-09-27 |
| S7 `returned_date` 对空列表不成立 | `fetch_hsl_reasons`：`returned_date` 的赋值在「rows 为空 → continue」之后（本 change 必须反着做：**无条件**取响应体日期） | 2026-09-27 |
| S5 端点 | `fetch_limit_reason_local`：`flow.10jqka.com.cn/anomaly/v1/history` + `vis.10jqka.com.cn/infomine3/limit/limitup` | 2026-09-27 |
| S5 时间量 = 最后封板时刻 | `fetch_limit_reason_local`：`first_limit_time` 取自 `boardAnalyses[-1].closeTime`（最后一个板块分析/收盘时刻），**不是首封** | 2026-09-27 |
| S5 的本地依赖与第三套市场后缀 | `fetch_limit_reason_local`：`market_id()` 用 `17`/`33` 区分沪/深（本 change 未记载的第三套约定，北交所会被静默按深市处理）；`local_html_path` 存在性检查把 `D:/TDX_HOME/webs/company/同花顺涨跌停原因.html` 当 error 来源 | 2026-09-27 |
| S5 记录日期可回退 | `fetch_limit_reason_local._pick_news()`：无精确日期记录时回退「≤ 目标日期的最近一条」甚至任意记录 → 其 date 可能是任意旧日期 | 2026-09-27 |
| S8 端点与字段 | `fetch_concepts_xuangubao`：`flash-api.xuangubao.com.cn/api/stage2/plates_by_any_stock`；成功码 `code===20000`；`core_avg_pcp` 为小数；强度分档；`reason` 截断 200 字；名称经 `top_n_stocks.items[].stock_chi_name` 反查；后缀 `.SS`/`.SZ` | 2026-09-27 |
| S8 请求白名单不含 `reason`/`plate_id` | `fetch_concepts_xuangubao`：请求 `fields=core_avg_pcp,plate_name,top_n_stocks`，解析层却读 `plate["reason"]` / `plate["plate_id"]` → 本 change 扩 `fields` 并做 best-effort 降级（见 `concepts-tool` spec 的「源字段白名单与 best-effort 降级」Requirement 与 D-13 相邻说明） | 2026-09-27 |
| vault 现场 | `DB/review` **不存在**（`glob` → os error 2）；`agent/DB/temp/`、`agent/skills/` 存在；`题材调研/`、`题材调研/00宏观/`、`交易系统/平常心/方法论/模式/` 存在 | 2026-09-27 |
| `DB/stock/` 实际形态（Issue 19 复核） | `DB/stock/` 下已有约 **1095** 个标的 md（`DB/stock/爱慕股份.md` 等），文件名为**中文名**而非代码；即「有文件、无 code→文件名 的稳定映射」（无索引）→ 印证 change 4 D-5「本迭代不能按代码直读本地档案」的结论，但 **`DB/stock/` 并非空**，名称第三层降级的现状描述须按此修正。本 change 结论：T2 名称唯一来源仍是 S8 反查（best-effort），`DB/stock/` 不参与本迭代反查 | 2026-09-27 |
| 工作区机制现状 | `src/index.ts` 为阶段 1 no-op（仅 `name` / `TraderKitConfig` / `apply`）；`src/` 内零 `http(s)://`、零 `fetch(`、零 `ctx.tools` / `ctx.provide` / `export const Config`；`package.json` 无 `schemastery` / `@deepseek-ai/dsh-tools`；`cordis.patch.yml` 无 `config` 段 | 2026-09-27 |
| 宿主范式可比先例 | `DSH-better-sidebar`：`src/config.ts` 的 `export const Config`（`import z from 'schemastery'`）、`src/tools.ts` 的 `ctx.tools.register(defineTool({...}))`（`defineTool` 来自 `@deepseek-ai/dsh-tools`）、`src/agent-opens.ts` 的 `ctx.provide(...)`；其 `package.json` 把 `schemastery` 列 dependencies、`@deepseek-ai/dsh-tools` 列 peer/dev；`cordis.patch.yml` 的 config 加载在同一 insert 行上。**版本等价性未核验**（见下节） | 2026-09-27 |
| 宿主 Loader 有配置 schema 概念 | Host Inspect `Config.listConfigs` 可见多个 entry 的 `status` 为 `schema` / `tree` / `absent`（说明 Loader 按插件导出校验配置） | 2026-09-27 |

### 待验证（任务 + 降级策略）

> 未核验项 MUST NOT 被当作实现依据；下表每一项都已落为 `tasks.md` 的 spike/待办任务，并写明降级。

| 待验证事实 | 为何未核验 | 验证任务 | 若证伪的降级 |
| --- | --- | --- | --- |
| TQ 口径：`get_gpjy_value` 参数名 `table_list`；`get_zdt_data` 的 `Code` 全 `.SZ`；`get_zdt_data` 盘后/节假日全 0；涨跌停判据走 `GP15`（涨停 `2` + 封单为正 / 跌停 `-2` + 封单为负） | 本 change 不调用这两个方法、无消费方（T3 已排除），无证据文件 | tasks 8.5（spike：由 `tq-skill-installer` 侧或人工实测记录，证据写入 `docs/carryover.md`） | 不作为本 change 实现依据；相关能力留给阶段 6，MUST NOT 按上表口径直接实现 |
| S8 是否返回 `reason` / `plate_id`（`fields` 是否被按需裁剪） | 本会话无网络取数 | tasks 6.6（实测响应 fixture 落 `test/fixtures/`） | `reason` / `plateId` 降级 best-effort（`null` + `notes`），不阻塞 `available`（见下 D-12） |
| S7 列表为空时的 `data.date` 是否仍存在 | 本会话无网络取数 | tasks 5.8（真实桩 + 人工盘后抽查） | 若响应体确无日期 → 返回 `tradeDate=null` + `dateUnavailable`，MUST NOT 用系统日期兜底 |
| S5 `boardAnalyses` 结构与 `first_limit_time` 语义 | 本会话仅读脚本，无线上响应 | tasks 5.8 | 按「S5 时间 = 最后封板 → 只进 `lastTime`」实现（保守口径） |
| DSH 宿主按插件 config 传递语义（`dataRoot` 空值时 Loader 行为、`tools` 依赖注入写法） | 宿主源码不可达；`vendor/cordis/src/fiber.ts:50` 之类路径在本工作区不存在 | tasks 1.5（挂载实测：空 `dataRoot` 挂载成功、写入报错）+ better-sidebar 先例对照 | 保 `default('')` + 调用期报错形态（已按此写死，不依赖宿主细节） |

## Goals / Non-Goals

**Goals:**

- 一次定义全插件的数据空间（`dataRoot` + 业务区映射 + 两级文件名模板 + 自动创建），后续所有产物（卡片、缓存、skill、宏观/白板/模式）都有唯一落点规则。
- 提供 **T0 交易日解析** + T1/T2 两个三方接口工具，双出口同一实现，供 change 4（页面）与 change 5（汇总）直接消费。
- 把「来源标注 / 缓存幂等 / 显式降级 / 频控护栏 / 只读边界 / 健康检查」做成**代码强制**的模块级不变量，而不是文档嘱咐。

**Non-Goals:**

- 不把任何 TQ 方法固化进 TS 代码（TQ 长尾由 tq-local skill 覆盖）；不建 MCP server、不做网关工具。
- 不做 T3 盘中状态工具（`get_zdt_data` 属迭代一非必需；且其为「Now」缓冲，与「盘中克制」张力最大，留待 M7）——该结论**不依赖**上表待验证的 TQ 口径。
- 不做龙虎榜（T4，无消费方）；不做 `get_relation` enrichment（M1-Q4：v1 仅 S8）。
- 不做 UI（页面归 change 4）；不做任何交易接口；不实现刷新入口（见 D-3）。

## Decisions

### D-1 `dataRoot` 可配置、schema 默认空值，写入期显式报错

代码不硬编码个人机器路径（M1-Q6 迁移与可移植性）。`Config.dataRoot` SHALL 为 `z.string().default('')`：**挂载期可用**（Loader schema 校验不因缺配置失败），空值由写入路径在**调用期**显式报错（含配置项名与指引）。本机的 vault 实例路径只出现在**本机 profile / README 注释示例 / `cordis.patch.yml` 占位符注释**，MUST NOT 写进发布产物（`cordis.patch.yml` 在 `package.json#files` 内，`contracts §10`）。备选：默认取 vault 绝对路径——否决，会把个人环境烧进代码；`dataRoot` 必填无默认——否决，与「未配置时写入显式失败 + 探测失败不阻塞挂载」的形态冲突（`default('')` 保证挂载可用）。

### D-2 业务区映射为**两级**：区域目录 + 文件名模板；参数白名单

`src/paths/mapping.ts` 为唯一路径真相：业务区 key → `{ 区域目录, 文件名模板? }`。所有调用方走 `resolveArea(key, params)`，函数内做两级校验：① `path.resolve` + 前缀校验（拒绝 `..` 逃逸与绝对路径）；② **模板参数白名单**（`code: ^\d{6}$`、`date: ^\d{8}$`、`name` 经 `sanitizeNameSegment`）——`contracts §6` 的分工：**`data-root-layout` 持有文件名模板**，change 4 的 `review-card-store` MUST 引用本表，MUST NOT 第二份定义。理由：范式要求「不新造目录名、预留区跟随业务」，集中一处才能在后续迭代不改调用方地扩映射；而 `<名称>` 来自第三方源（S8 `stock_chi_name`），是**由外部数据拼出的路径段**，必须与「请求相对路径」同等对待（注入用例 `../../`、`a/b`、`CON`、空名进 spec）。

**口径统一记录（回写 vault 需求文档时引用）**：需求文档存在两处路径表述——`需求描述-复盘卡片MVP` R4 写 `<数据根>/review/<YYYYMM>/…`，`需求描述-盘面数据组件` P2 写 `DB/review/<YYYYMM>/…`。二者指向同一实例（当前 vault 实例 = `DB/review/`，2026-09-26 语义化命名裁决）；本范式统一为**业务区 = `DB/review`**，即范式路径 `<数据根>/DB/review/<YYYYMM>/…`，R4 的表述在回写时按此修正。（以上需求文档均为**仓外文档，未能核验**，`contracts §8`。）

### D-3 两层缓存、schema 版本、无刷新入口、日期三义

- **两层缓存**（`contracts §9`）：**列表级**（键 = `source + requestedDate`——调用方入参，**可构造**；payload 内含源返回的 `businessDate` 与 `hitEndpoint`）与 **code 派生视图级**（键 = `requestedDate + code`）。T1/T2 的 per-code 结果都是列表级数据的派生视图。**MUST NOT 用 `businessDate` 做键**：它在响应到达前不可知，写键与读键会不是同一个量（评审 Issue 21）。
- **预算与间隔按列表级请求数计**（**一次 History 请求 = 一次列表级请求**）：同一 `requestedDate` 同一源的整份列表至多取一次；「20 标的 × 6 日回溯」在列表级语义下是 **6 次列表级请求**而非 120 次（修正原 D-3 键设计，评审 Issue 7/21；N=6 见 `contracts §12.5`，评审 Issue 32）。
- **缓存内容**：JSON，含 `cacheSchema`（模块名 + 版本）、`businessDate`（**值，非键**）、`requestedDate`（键的一部分）、`hitEndpoint`、`fetchedAt`、`source`、`payload`、`errors`；路径 `<dataRoot>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/<module>__<key>.json`，其中 `<YYYYMMDD>` 由 `requestedDate` 经 `src/data/date.ts` 的 `toCompactDate` 折算（`YYYYMMDD` 允许出现的三处之一，`contracts §1`）。`cacheSchema` 不匹配 → **视为未命中**并由本轮结果覆盖写（MUST NOT 当命中返回旧数据）。
- **`refresh` 参数：本迭代不提供**（工具 schema 不含该入参，实现与文档 MUST NOT 出现该幽灵参数）；无盘后刷新、无定时任务。
- **日期三义**（`contracts §1`）：限流日（系统时钟，固定 `Asia/Shanghai`，护栏时段 + 预算桶键 + T1 路由判据）、请求日（调用方入参）、业务日（源返回）——三者**一律 `YYYY-MM-DD`**，比较前 MUST 归一（`YYYYMMDD` 只允许出现在目录/文件名模板参数与锚点、天级缓存目录、第三方源请求参数）。T1 路由 = 请求日 vs 限流日：相等 → List（当日 List 空/失败**可**回退 History，记 endpoint 与 `notes`）；`requestedDate !== rateLimitDate` 时 **MUST NOT** 用 List 数据，History 为空/失败 **MUST NOT** 回退 List，且最终 `available`/`errors` 按 **D-17 聚合优先级**判定（S5 命中该业务日 → `available=true` / `source='S5'` / `errors=[]`；两源无数据 → `dateUnavailable`；两源失败 → `sourceUnavailable`）；`tradeDate` 从响应体**无条件**取值。日期归一/折算的单点实现是 `src/data/date.ts`（`toCompactDate` / `fromCompactDate` / `isValidIsoDate` / `rateLimitDate(now)`，评审 Issue 20），`trade-date-tool` 提供日期**事实**（D-12），二者分工：前者是格式唯一实现，后者是「哪一天」的唯一来源。
- 理由：T-4 要求按交易日分桶；`agent/DB/temp/` 已是既有「skill 运行中间产物区」，沿用其语义（P2）。同日重复调用在**入口处**判定命中并直接返回，保证「零网络」可被请求计数断言。

### D-4 出站客户端：原生 fetch + 超时 + 有限重试，且绝不请求 17709

用 Node 20 内置 `fetch`（undici）+ `AbortSignal.timeout`，失败按固定退避重试至多 2 次；不引 Axios（沿 dsh-trading/AGENTS 的取向）。**数据模块不向 `127.0.0.1:17709` 发任何数据请求**——TQ 能力全在 skill 侧；健康检查中的 17709 探测仅为 TCP 可达性（见 D-8）。

### D-5 频控护栏：位置、默认值依据与豁免口径

`src/data/guard.ts` 是**数据面出站请求的唯一闸门**（`src/data/**` 不得绕过直接 fetch；全仓第二条具名出站通道是 change 3 的 `src/skill/download.ts`，见 `iteration-1-contracts §7`），强制：每源并发 ≤2、最小请求间隔 1000 ms、单次调用标的数 ≤20、每源每交易日列表级请求预算 200 次；盘中时段拒绝「全市场级」调用，除非显式 `offSession`。全部参数可配置。

**默认值依据（标注「经验值、可配置」）**：

- 参考脚本**原本无限流**（`page_count: 5000`、`count: 252` 才是真实请求规模），故本组默认值不是实测契约，而是「个人使用、盘后为主、盘中共用」场景下的**保守经验值**：并发 ≤2 与 1000 ms 间隔的目标是让单进程出站速率落在个位数请求/秒量级，避免对第三方公开接口形成压力；批量 ≤20 与 200 次/日则与「一次页面首屏 ≤ 20 标的」、「盘后回溯 ≤ **6** 交易日 × 源数」（`contracts §12.5` 的回溯上限 N=6，早期稿的 10 日不再有效，评审 Issue 32）对齐（详细推导见 Risks 的联合推演）。预算按**列表级请求数**计，且**一次 History 请求 = 一次列表级请求**（历史日回溯同样按日各计 1 次，不因走 History 端点而免计）。
- **依据段落需要 owner 在首次真实使用后回填实测吞吐**（tasks 8.6）；在回填前，本组数字一律按「经验值」对待，MUST NOT 被其它 change 当成容量承诺。

**豁免口径（本 change 唯一版本）**：

- **「全市场级」判据** = 批量标的数 > 硬上限，**或**调用方显式 `fullMarket` 标记。自动识别为可选增强，不作判据。
- **`offSession` 只放宽「时段拒绝」**（护栏③），**不放宽批量硬上限**（②），也不放宽并发/间隔（①）与预算（④）。原 scenario「盘后任务显式豁免 → 允许超过批量上限」据此修正。
- **`guard.sessionOverride`**（`auto|on|off`，默认 `auto`）：只覆盖③的时段判定，用于测试与排障；默认 `auto` 按限流日时钟判定。
- 时段判定用「工作日 09:15–11:30 / 13:00–15:00」，**无交易日历** → 调休工作日/法定假日会误判。误判后果写清：宁可少拦（对第三方压力略增）不可误导数据口径——**误判只影响「拦不拦」，绝不影响业务日期**（业务日期一律取源，D-3）；保守/激进由 `sessionOverride` 显式切换。
- **系统时钟只用于限流判定**，业务日期一律取数据源。
- **单标的调用也受全局间隔约束**（原「单标的调用不受影响」表述修正）：最小间隔按源全局，B1 的 N 日回溯会串行 ≥ N×1 s，见 Risks。

理由：T-6 明确「必须在接口层代码强制」；集中闸门让「未发出网络请求」成为可断言事实。

### D-6 S7 签名参数作为配置项，默认值取自工作区脚本现值

`ts`/`sign` 是页面内置的**公开参数、非密钥**（Provider 契约 §S7 已注明），因此默认内置工作区脚本现值（`fetch_zt_timeline` 的 `HSL_SIGN` / `HSL_TS` 符号，不写行号），同时提供配置覆盖；失效时按 T-5 显式降级（S7 失败 → S5），并在错误里给排障指引（「回到页面重新提取 ts/sign」）。理由：0 摩擦可用 + 失效可修；把它做成必填会让人开箱即不可用。**`sign` / `ts` 现值 MUST NOT 写进发布产物 `cordis.patch.yml`**（易失第三方参数，`contracts §10`）——在那里只留注释示例/占位符。

### D-7 service 出口形状与工具描述

`ctx.provide('traderKit', api)`（+ `declare module '@deepseek-ai/cordis'` 类型增强），`api.data.resolveTradeDate/getLimitReason/getConcepts/guardStatus`、`api.health.status()`（**两段视图** `{ data, skill }`：`skill` 段为 change 3 `skill.status({ cwd? })` 的透传，不重复实现；change 3 未挂载时 `skill === null` 且 `data.warnings` 记明）；工具名 `get_trade_date` / `get_limit_reason` / `get_concepts`，描述用中文写清「取什么、主备源、不可用时的表现」，便于 agent 正确选择与解释失败。页面 MUST 走 service（spec `data-tool-contract` 场景「页面层不含取数实现」）。

### D-8 健康检查是独立通道：不计预算、不进 guard 计数、3s 总硬超时

挂载时探测：三方源（S7/S5/S8 各一次轻量请求）+ 17709（仅 `net.connect`）。三个口径必须同时写明（否则与 D-5 的并发/间隔自相矛盾，评审 Issue 14）：

1. 探测走**独立通道**：**不计频控预算、不计入 guard 出站计数、不得被其它模块复用**；
2. 探测总时长有 **3 秒硬超时**（`AbortSignal.timeout` 截断）——「3 秒」是**总硬超时**而非「每个目标 3 s」，最坏耗时受上界约束，不随「并发 ≤2 × 每目标 3 s」放大；
3. 结论进 service `health.status()` 与日志；任一失败都不影响挂载与工具可用性。

`diagnostics` 配置字段定义（tasks 1.1 同步）：`diagnostics.probe.enabled`（默认 `true`）、`diagnostics.probe.targets`（`s7|s5|s8|tdx17709` 子集，默认全选）、`diagnostics.tdx17709.enabled`（**默认 `true`，owner 裁决 2026-09-27**，关闭后该项记为「未探测」而非「不可用」）。**默认值沿革**：评审 Issue 26③/29 曾收口为默认 `false`（默认不触 17709、仅登记不探测）；**owner 于 2026-09-27 实施开工前裁决改为「默认开」**——默认即做 17709 TCP 可达性探测（「TdxW 未启动」场景在默认配置下适用），显式置 `false` 才关闭（该项记「未探测」）。裁决不影响边界事实：探测仍只是 `net.connect` 敲端口、零 TQ 方法调用，`contracts §11` 把 TQ 能力划给 skill 侧的分工不变；历史备选「若 owner 判定连端口接触也应避免则永久移除探测路径」未被采纳。**把 17709 的 TCP 探测写进 design 是因为它与「TQ 能力不固化进 TS」的边界相邻**：只探端口不调用方法，不构成 TQ 能力实现。

### D-9 规范化单点实现（单位规范在本 change 的适用边界）

`src/data/normalize.ts` 提供 `toNumber(v)`（空值守卫 `""`/`"--"`/`"None"`/`null`→`null`）、`field(value, source, fetchedAt)`（逐字段信封）、单位常量与格式化（万元/亿元/百分数）。所有模块只经此转换，避免各处重写守卫逻辑（Provider §3.1.2 已警示字符串化数值与单位混用）。

**适用范围收口**：单位 Requirement **仅对携带金额/市值字段的模块生效**；本 change 的 T1/T2 返回体（`cause`/`firstTime`/`lastTime`/`openCount`/`streakDesc`/`strengthPct`）**不含任何金额或市值字段**，故该 Requirement 在本 change **不验收**（可保留常量与百分数换算，但不做单位断言）。`proposal.md` 的验收对照据此从「带来源与单位」改为「带来源（本 change 无金额字段，故不做单位验收）」。

### D-10 传输层可替换，测试用真实本地服务桩

`src/data/http.ts` 暴露一个与 `fetch` 同形的传输接口并默认注入原生实现；模块代码只依赖该接口。测试按仓库纪律「零 mock、零 sleep」：用 `node:http` 起**真实本地服务桩**（随机端口）返回固定响应，验证路由/降级/护栏/缓存行为，不引入 mock 库、不依赖外网。理由：数据模块的失败路径（主备切换、空数据、超时）才是本 change 的主要风险面，必须可被真实验证；而第三方源在测试中不可控。

### D-11 名称反查用 S8（不引 TQ 反查）；`DB/stock/` 前提已复核

T2 的 `name` 取 S8 `top_n_stocks.items[].stock_chi_name`（best-effort）。需求 R2 的「TQ `get_match_stkinfo` 反查」不在本 change 实现——它属于「插件直调 17709」的边界问题（M1-Q4 同族，未裁决）；change 4 的名称三级降级链按「S8 反查 → 历史卡片 frontmatter → 仅代码」实现，并把该偏离明确记入 change 4 的开放问题与回写清单。

**前提复核（Issue 19 结论，已写入上文「已实测」表）**：`DB/stock/` 下已有约 1095 个**中文名**标的 md，即**有文件、无 code→文件名 的稳定映射**（无索引）。这支持 change 4 D-5「本迭代不能按代码直读本地档案」的结论，但要求把「`DB/stock/` 未建」改写为「`DB/stock/` 有文件、缺索引」；本 change 的名称来源优先级**不因此改变**（仍以 S8 反查为唯一实现来源）。

### D-12 T0 `trade-date-tool`：日期事实源的单点实现（新增能力）

新增 T0 能力，理由：List/History 路由与预算桶键都需要一个「限流日」事实源，而 change 4 的归属与 change 5 的 `review_daily_scan` 都需要「业务日」。若各处自行推断，日期语义必然漂移（评审 Issue 2/4）。

- service：`traderKit.data.resolveTradeDate({ date? })`；tool：`get_trade_date`；
- 入参 `date` canonical `YYYY-MM-DD`（兼容 `YYYYMMDD`，经 `src/data/date.ts` 的 `fromCompactDate` 归一，MUST NOT 猜测）；缺省 = 限流日；
- 返回 `{ requestedDate, businessDate, isTradingDay, source, fetchedAt, evidence, errors[] }`（`requestedDate`/`businessDate`/`evidence.rateLimitDate` 同为 `YYYY-MM-DD`；`errors[]` 成功时为空数组）；`isTradingDay` **只能 `true | null`**（`businessDate === rateLimitDate` **同格式比较** → `true`，否则 `null`），**禁止**用系统日期推断「非交易日」；
- 不可得（`businessDate === null`）：change 4 → 提交前归属确认；change 5 → 显式要求用户指定交易日，MUST NOT fallback 系统日期（`contracts §1`）；
- 缓存/预算复用列表级口径（键 = `source + requestedDate`），MUST NOT 另建缓存层。

spec 见 `specs/trade-date-tool/spec.md`；消费方接线属 change 4（`TradeDateResolver` seam）与 change 5（`review_daily_scan` 缺省交易日）。

### D-13 S5 备源移植口径修正

原 D 线把 S5 描述为「可直接移植」；按实测事实修正为三条硬口径（评审 Issue 1/11）：

1. **S5 时间量只进 `lastTime`**：`first_limit_time` = 最后封板时刻 → `lastTime`（`source=S5`），`firstTime.value=null` + `notes`；S6 `zt_time` 同理 MUST NOT 进 `firstTime`；
2. **删除本地 HTML 依赖**：不检查 `D:/TDX_HOME/...html`，其缺失不得成为断开备源的理由；
3. **`marketId` 表化 + 北交所写明行为**（本迭代「显式不支持 + 待验证标注」，不静默按深市）；同时区分 **`tradeDate`（列表业务日）** 与 **`hitRecordDate`（命中的异动记录日，只进独立字段/`notes`）**——S7 与 S5 的日期语义不同，MUST NOT 共用一个字段名。

### D-14 宏观预留区指向既有 `题材调研/00宏观/`

原映射把宏观预留区指向裸根 `题材调研/`，与 vault 既有约定（`题材调研/00宏观/`）不符，会让实现者另造 `题材调研/宏观…`，与「MUST NOT 新造目录名」自相矛盾（评审 Issue 15）。修正：预留映射直接指向既有 `题材调研/00宏观/`；`resolveArea` 对**已登记**业务区返回其区域目录（含宏观区），对**未登记**的写入用业务区显式报错；本迭代宏观区「仅登记、返回既有路径、不作为可写许可」，与 `data-root-layout` spec 的 scenario 及 tasks 2.1 验收一致（评审 Issue 26①）。

### D-15 日期格式单点实现 `src/data/date.ts`（格式唯一性）

评审 Issue 20 暴露的硬伤是**同一日期概念两种格式并存**（限流日 `YYYYMMDD` vs 业务日 `YYYY-MM-DD`），会让 `isTradingDay` 判据恒 `false`、下游 `dateMismatch` 门槛恒真。修正为三层：

1. **格式唯一口径**（`contracts §1`）：工具/service 契约、数据包、缓存 payload 一律 `YYYY-MM-DD`；`YYYYMMDD` 只允许出现在 ①目录/文件名模板参数与锚点、②天级缓存目录、③第三方源请求参数。
2. **单点实现** `src/data/date.ts` 导出 `toCompactDate(iso)` / `fromCompactDate(compact)` / `isValidIsoDate(v)` / `rateLimitDate(now)`（限流日 = 系统时钟固定 `Asia/Shanghai` 的 canonical 值）。`src/data/**`、`src/paths/**`（模板参数折算）与 T0/T1/T2 的比较逻辑 MUST 经它；**MUST NOT** 自行 `slice` / `replace` / 拼接日期串。
3. **结构断言**（`tasks.md` 4.3 / 7.3⑥）：扫描 `src/data/**`，除 `src/data/date.ts` 外不得出现自定义日期截断/拼接实现；扫描目标非空（`src/data/**` 与 `src/index.ts` 必然存在）。

理由：`YYYYMMDD` 是**目录段与源参数的表示需求**，不是业务日期的表示；把两种表示混在契约层，等价于把「格式化」与「语义」混为一谈。备选（全仓统一 `YYYYMMDD`）否决：与 vault 既有 frontmatter 习惯（`tradeDate: YYYY-MM-DD`，`contracts §2`/`§3`）及 change 4/5 的落盘口径冲突，改动面更大且更易漂移。

### D-16 频控状态具名出口 `traderKit.data.guardStatus()`（评审 Issue 27/31）

change 5 以 MUST 级要求「运行前查询 change 2 数据模块当日剩余预算」并具名 `traderKit.data.guardStatus()`（缺失时按 D-1b 返回 `DEPENDENCY_UNAVAILABLE`、MUST NOT 自建预算计数），但本 change（`traderKit.data.*` 唯一 owner，`contracts §11`）此前只有 `resolveTradeDate` / `getLimitReason` / `getConcepts` / `health.status()` 四个出口——「无具名接口的复用是无效表述」（`contracts §0`）。据此新增：

- **出口**：service `traderKit.data.guardStatus()`，返回 `{ rateLimitDate, remaining, budgetLimit, budgetUsed, minIntervalMs, fullMarketGuard, sessionState, fetchedAt }`（多源附 `sources[]`）；`rateLimitDate`/`fetchedAt` 为 `YYYY-MM-DD`/带 `+08:00` 的 ISO8601（`contracts §1`）；
- **同一个计数**：与 `guard.ts` 的护栏共用内存计数，MUST NOT 第二份预算计数（避免「查询值与拦截值不同源」）；
- **不出站**：查询不请求、不耗预算、不改 guard 计数与时段状态（只读快照），使 change 5 的预检可被「出站计数不变」断言；
- **拒绝态具名**（评审 Issue 31）：护栏拒绝返回 `{ rejected: true, reason: 'sessionRejected' | 'budgetExhausted' | 'batchLimitExceeded' | 'intervalLimited', limit, used }`，change 4 的 `sessionRejected` 与 change 5 的 `budgetExhausted` 直接引用枚举名，MUST NOT 各自造名或解析文案字符串；
- 理由：预算预检需要的是**可判的剩余量**而非日志；把它做成与护栏同源的只读出口，才能让 change 5「预算不足 → 前 N 个 + `deferred`」在两侧用同一数字验收。

spec 见 `data-tool-contract` 的「频控状态查询出口」Requirement；tasks 3.8 / 7.2。

### D-17 历史日 S7 空 + S5 命中的聚合优先级（评审 Issue 28）

Round 2 的 Issue 22 修正引入「历史路由下 S7 空/失败时继续尝试 S5」，却没定义 S5 **成功**后的聚合语义：spec 字面同时给出「`available=false` + `dateUnavailable`」与「S7 失败降级 S5 → 可用态」两个相反结论，change 5 又只按 `errors` 含 `dateUnavailable` 判定 → S5 的有效涨停原因会被静默降级 `missing(sourceUnavailable)`。故写死判定表（`limit-reason-tool` spec 的「备源聚合优先级」）：

| 条件 | `available` | `source` | `errors` |
| --- | --- | --- | --- |
| S5 在该业务日有命中记录 | `true` | `'S5'` | `[]`（S7 leg 的失败只进 `notes`） |
| 两源均无数据 | `false` | 如实 | `['dateUnavailable']` |
| 两源均失败 | `false` | `null` | `['sourceUnavailable']` |

「无数据」与「取数失败」必须用不同 error 值区分（与 `contracts §12.8` 同族）；S5 命中时 MUST NOT 保留 S7 leg 的 `dateUnavailable`。同步 `limit-reason-tool` spec、`data-tool-contract` 的非当日路由与 tasks 5.1/5.6 断言。

### D-18 T2 `date` 只用于缓存分桶；`businessDate` 允许 `null`（评审 Issue 30）

Round 2 为统一格式给 T2 新增 `date` 入参，但 S8（`plates_by_any_stock`）是**不带日期参数的实时快照**接口：`get_concepts(code, '2026-09-20')` 会拿到当日快照却按历史 `requestedDate` 分桶缓存，且 `data-tool-contract` 把「payload 内含源返回的 `businessDate`」写成通用 MUST，对 T2 不可满足。据此明确：

- **T2 无日期语义**：`date` 可选，**只用于缓存分桶与列表级缓存键**（键 = `concepts + requestedDate`，与 `source + requestedDate` 同构）；请求 S8 MUST NOT 带日期参数；MUST NOT 解释为「取该历史日快照」，MUST NOT 产生 `dateUnavailable`；
- **返回体补 `businessDate`**（`YYYY-MM-DD` | `null`）：源无日期字段时为 `null` 且 `notes` 记「源无日期，按 `requestedDate` 缓存」；`null` MUST NOT 参与历史回溯（`contracts §12.5`）、MUST NOT 用于按业务日归档，归档一律按 `requestedDate` 折算的 `<YYYYMMDD>` 桶；
- `data-tool-contract` 的列表级 payload 要求补「源无日期字段时允许 `null` 并记 `notes`」例外（MUST NOT 用请求日/限流日代填）。
- 理由：T2 的 `date` 与 T1 的 `date` 语义不同（前者是缓存桶，后者是路由判据），把它写成同一个「历史日」语义会产生「当日快照被当成历史数据」的静默错误归属并固化进缓存。

## 跨 change 回写清单（本 change 负责侧）

> 口径来源：`iteration-1-contracts §0`（无具名接口的复用无效）、`§11`（`traderKit.data.*` 属本 change）。本 change 只**登记**跨 change 引用并提交回写文本，跨 change 文件由对应 owner 落地（评审 Issue 27/28/31/33）。
> 落地任务：tasks 8.9；验收：本 change 内引用无悬空符号。

| # | 回写项 | 目标 change | 目标符号 / 位置 | 落地 owner |
| --- | --- | --- | --- | --- |
| 1 | **change 5 的预算预检引用本 change 的具名出口** `traderKit.data.guardStatus()`（`§9` 列表级预算；返回 `budgetLimit`/`budgetUsed`/`remaining`/`minIntervalMs`）；其悬空的「design Open Questions 12/13」指针改指本 change 的「频控状态查询出口」Requirement 与本文件 D-16 | change 5 `daily-summary` | spec「预算预检与分批」、`design.md`、`tasks.md` 2.5/3.5、`proposal.md` | change 5 owner |
| 2 | change 5 的 `errors` 分档与聚合表一致：`dateUnavailable` → `missing(sourceUnavailable)`（无数据），`sourceUnavailable` → 取数失败；S5 命中时 T1 返回 `errors=[]`，故不得再按 `dateUnavailable` 降级 | change 5 `daily-summary` | spec 取数与缓存 / 数据包 schema / 失败判定矩阵 | change 5 owner |
| 3 | 出站通道措辞改为「两条具名通道」（`src/data/http.ts` + `src/skill/download.ts`），并补 `deferred` 结构断言转正条目（change 3 tasks） | change 4 `review-page`、change 3 `tq-skill-installer` | review-page D-16/6.3②；change 3 tasks 验收清单 | change 4 / change 3 owner |
| 4 | 护栏拒绝态改用**具名枚举**：change 4 的降级文案键取 `sessionRejected`、change 5 的 `deferred` 原因取 `budgetExhausted`（不得各自造名或解析文案字符串）；预算用量统一经 `guardStatus()` 读取 | change 4 `review-page`、change 5 `daily-summary` | `review-page` spec/design 的 `sessionRejected`；`daily-summary` spec/tasks 的 `budgetExhausted` | change 4 / change 5 owner |

## Risks / Trade-offs

- **S7 签名失效（页面改版）→ 涨停原因断供**：主备源 + 显式不可用态（不显示 0）；签名作为配置项可快速替换；健康检查给出源状态。
- **S8 无契约、字段可能变**：空数据/非 20000 一律走显式降级；`reason`/`plateId` 为 best-effort（实测未定，见待验证表）；`reason` 截断与分档规则集中在解析层，改口径只改一处。
- **按日缓存与源头当日更新不一致**：接受（T-4 的幂等优先）；当日缓存命中即不再回源；**本迭代无刷新入口**（`refresh` 不入 schema）。
- **`get_concepts` 约 0.35 s/只**：页面 B1 串行调用会拖慢首屏——设计上 B1 先出本地部分（名称/卡片），标签异步补位；change 4 的 ≤500 ms 指标只约束本地部分。
- **单标的调用也受全局最小间隔约束（联合推演）**：最小间隔按源全局，因此 change 4 D-8 的「有界回溯 **N=6** 交易日」（`contracts §12.5`）单源至少 5–6 秒串行；change 5 对 N 个标的逐只取数会到 N 秒级。缓解：列表级缓存（同一交易日整份列表一次取回，D-3）+ 页面异步补位；但**首次冷启动的回溯时延必须按此估算**，MUST NOT 按「单标的不受影响」承诺 ≤500 ms。
- **预算与回溯规模的联合推演**：列表级语义下「20 标的 × 6 日」= 6 次列表级请求（而非 120 次；**一次 History 请求同样计 1 次列表级请求**）；200 次/日预算与「≤20 标的 × ≤6 日 × ≤4 源」的盘后场景兼容（N=6 为 `contracts §12.5` 的回溯上限，早期稿的 10 日不再有效，评审 Issue 32）。若后续出现更高频消费方，预算需重新推演（不是自动扩容）。
- **缓存键必须由入参构造**：`source + requestedDate` 是唯一可构造的列表级键；若实现者改用 `businessDate` 做键，会在「源业务日 ≠ 请求日」的输入上同时破坏「同参零网络」与预算推演（评审 Issue 21），故该点既写进 spec 的 MUST NOT，也由 tasks 3.3 的用例断言。
- **护栏过严影响现场使用**：预算与批量上限全部可配置；`offSession` 放宽时段的语义已收束为「只放宽时段」，硬上限不动（D-5）。
- **时段判定误判（调休/假日）**：无交易日历；误判只影响「拦不拦」，不影响业务日期；可用 `guard.sessionOverride` 显式覆盖（`auto|on|off`）。
- **北交所后缀未验证**：显式标注待验证，不静默套用（spec scenario）。S5 的 `marketId` 映射同样按「显式不支持 + 待验证」处理（D-13）。
- **发布产物泄漏个人环境**：`cordis.patch.yml` 在 `files` 内 → 只允许注释示例/占位符/本机 profile，MUST NOT 写 vault 绝对路径与 `sign`/`ts` 现值（`contracts §10`）。
- **缓存写进 vault 的阶段例外**：`agent/DB/temp/dsh-trader-kit/` 在 vault 内，AGENTS「阶段 4 起才触 vault」需显式例外（`contracts §10` / roadmap §5：缓存属**非资产中间产物**，白名单路径例外；`docs/architecture.md` 与 vault-integration 需同步登记，见 tasks 8.2/8.3）。

## Migration Plan

无既有实现需迁移（首次引入）。落地顺序：配置与依赖 → 目录范式（两级映射 + 净化）→ 出站/护栏/规范化 → 缓存两层 → **T0 交易日解析** → T1 → T2 → 双出口 → 健康检查。回滚：本 change 为纯新增，禁用插件行即回到当前状态；不产生需清理的数据（缓存与目录均在复用既有父区，`DB/review` 由 change 4 首次触发创建）。

## Open Questions

1. **T-8 的 17709 TCP 探测是否被接受**（**已定：默认 `true`，owner 裁决 2026-09-27**）：本 change 的形态是「只探端口、不调方法」+ `diagnostics.tdx17709.enabled` 开关。**默认值沿革**：评审 Issue 26③/29 曾收口为默认 `false`；**owner 于 2026-09-27 裁决改为「默认开」**——默认即做 TCP 可达性探测，显式置 `false` 才关闭（该项记「未探测」），理由与实现口径见 D-8（只探端口不调用方法，不构成 TQ 能力实现；历史备选「永久移除探测路径」未被采纳）。
2. **`agent/DB/temp/` 缓存的生命周期**：既有 temp 区存在 `cleanup/` 等先例，本 change 只按日分桶、不做清理策略；是否需要保留期/清理规则待定（可与 vault 既有 cleanup 约定对齐）。
3. **S7/S5/S8 的字段漂移监测**：本期只在失败时显式报错；是否需要定期的契约自检（字段存在性断言）待后续迭代决定。
4. **频控默认值的实测回填**：本 change 默认值为经验值（D-5）；首次真实使用后是否按实测吞吐调整 200 次/日与 1000 ms，待 owner 裁决（tasks 8.6 负责记录证据）。
5. **历史日 S5 命中的「异动记录日」是否可用**：`hitRecordDate` 语义已分离（D-13）；消费方（change 5）是否允许在 `hitRecordDate !== requestedDate` 时仍采用该条原因，待裁决（当前默认：只标注、不采用）。
6. **`DB/stock/` 索引化**：实测有约 1095 个中文名 md、无 code→文件映射；是否在后续迭代建索引以支撑「按代码直读本地档案」，待 owner 裁决（影响 change 4 名称降级链第三层）。
7. **中文金额文本的承载字段（评审 Issue 24③）**：`data-tool-contract` 的「中文金额文本不参与计算」（如 `"1.6万亿"`）在本 change **没有消费字段**——T1/T2 返回体不含金额/市值字段，规范层保留该要求（`toNumber` 对含单位词文本返回 `null`，不参与计算）并以 `normalize.ts` 的**不 skip**单元用例验收；「该文本应落到哪个字段、是否原样展示」属实现期细节，待后继携带金额字段的 change 承接。**理由**：本 change 无金额字段（D-9 已收口），把它留在 spec 只作为转换层不变量，避免出现「无字段却要求展示口径」的悬空验收。
8. **结构断言的扫描域转正（评审 Issue 25）**：`src/routes/**`、`src/client/**`（change 4 创建）与 `src/skill/download.ts`（change 3 创建）在本 change 时点不存在，故对应断言按 `deferred` 用例实现（目录存在才执行，用例名标记 `deferred`，并计入 change 3/4 的验收清单）；本 change 的可执行扫描域为 `src/data/**` 与 `src/index.ts`。**理由**：保留绝对量词（「全仓零 `fetch(`」）在本时点不可验证，会逼出「放宽目标列表」的空过路径；改为「可验证域 + deferred 移交」后，门禁在两种时点都成立。
9. **跨 change 回写的落地方（评审 Issue 33）**：Issue 33 要求把 change 4 D-16/6.3② 与 change 3 tasks 的断言措辞改为「两条具名通道」并补 `deferred` 转正条目，但这属**跨 change 文件**（`openspec/changes/review-page/**`、`openspec/changes/tq-skill-installer/**`），不在本 change 可改范围（本 change 只改 `openspec/changes/data-foundation/**`）。处置：本 change 已提交登记文本（「跨 change 回写清单」第 3 条 + tasks 7.5/8.9），并在本 change 内保持「两条具名通道」口径自洽（spec 只读边界、D-5、tasks 3.1/7.3）。**理由**：静默丢弃会让 Round 1 Issue 17「绿而无证据」路径复活；登记为具名条目 + owner 归属，使该移交在 change 3/4 验收时可核销。

## 评审处置（Round 1 — 2026-09-27）

> 逐条对应 `reviews/data-foundation-review.md` Round 1 的 Issue 1..19，一条不漏。
> 「已采纳」= 本轮已改；「后置」= 转入 Open Questions；「驳回」= 不采纳并给理由。

| # | 严重度 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- |
| 1 | Critical | 已采纳 | `specs/limit-reason-tool/spec.md` 首封时间红线：S5 时间只进 `lastTime`、`firstTime.value=null` + 新增 scenario「S5 时间 MUST NOT 出现在 firstTime」；`design.md` D-13；`tasks.md` 5.3/5.6 断言扩为对 S5 的断言 |
| 2 | Critical | 已采纳 | `data-tool-contract` 新增 Requirement「日期三义分离」（限流日/请求日/业务日 + 表 + 来源 + 用途 + 路由判据）；`design.md` D-3/D-12；新增 T0 `trade-date-tool` spec；`tasks.md` 第 4 节 |
| 3 | Critical | 已采纳 | 历史日 MUST NOT 回退 List；不一致 → `available=false` + `errors:[dateUnavailable]`（替换「仅 notes 标注」）；`limit-reason-tool` 与 `data-tool-contract` 各补 scenario |
| 4 | Critical | 已采纳 | `tradeDate` 改为**无条件**从响应体取值（列表为空也得）；补 scenario「列表成功但为空」与「标的不在列表」；`tasks.md` 5.4/5.6 + 跨 change 契约用例（依赖 change 4 `TradeDateResolver`） |
| 5 | High | 已采纳 | `data-root-layout` 升级为两级映射（区域目录 + 文件名模板）+ 参数白名单 + `sanitizeNameSegment` + 注入用例（`../../`、`a/b`、`CON`、空名）；模板归属声明（change 4 引用）；越界防护覆盖「外部数据拼出的路径段」；落 `tasks.md` 2.2/2.3/2.6 |
| 6 | High | 已采纳 | `design.md` D-5 补默认值「经验值、可配置」+ 依据段落；`offSession` 只放宽时段、不放宽批量硬上限；「全市场级」判据明确（批量 > 上限 或显式 `fullMarket`）；新增 `guard.sessionOverride`（auto/on/off）与节假日误判后果；「单标的也受全局间隔约束」进 Risks；spec 补 4 条 scenario（fullMarket 拒绝 / offSession 不放宽硬上限 / 单标的间隔 / sessionOverride） |
| 7 | High | 已采纳 | `data-tool-contract` 缓存 Requirement 改为两层缓存（列表级 `source+businessDate` / code 派生视图级），预算与最小间隔按列表级请求数计；补「列表级缓存先行」与「同列表派生多标的只取一次」scenario；`design.md` D-3 + Risks 联合推演 |
| 8 | High | 已采纳 | `tasks.md` 8.2/8.3 增文档与登记任务（roadmap §5 已在仓内本次重排中登记、`docs/architecture.md` 写分区清单补两条路径、vault-integration 登记 `DB/review/` 与 `agent/DB/temp/dsh-trader-kit/`）；Risks 增「缓存写进 vault 的阶段例外」条目；`proposal.md` Impact 补 roadmap/architecture |
| 9 | High | 已采纳 | `design.md` Context 拆成「已实测（证据 + 日期）」与「待验证（任务 + 降级）」两节；TQ 口径（`table_list`/`get_zdt_data` `.SZ`/盘后全 0/`GP15`）移入待验证并落 tasks 8.5；不可达的 `vendor/cordis/src/fiber.ts:50` 换成 `DSH-better-sidebar` 可比先例并注明「版本等价性未核验」；行号引用改符号名（`HSL_SIGN`/`HSL_TS`） |
| 10 | High | 已采纳 | `concepts-tool` 新增 Requirement「源字段白名单与 best-effort 降级」：`fields=core_avg_pcp,plate_name,reason,plate_id,top_n_stocks`；`reason`/`plateId` 缺失 → `null` + `notes`（不阻塞 `available`）；补 scenario 与 `tasks.md` 6.2/6.6（含实测 fixture） |
| 11 | High | 已采纳 | `design.md` D-13 三条：删本地 HTML 依赖、`marketId` 表化并写明北交所行为、「列表业务日 vs 命中异动记录日」分离（新字段 `hitRecordDate`）；`limit-reason-tool` 新增 Requirement「S5 备源移植口径」与「列表业务日与命中记录日分列」+ scenario；落 `tasks.md` 5.2/5.3/5.6 |
| 12 | High | 已采纳 | `tasks.md` 逐条补 7 处覆盖缺口：① 数据根迁移提示用例（2.5）② 空值/缺失/不可用态断言（3.4/3.5）③ 健康检查自动用例（7.1）④ 频控五 scenario 用例（3.6）⑤ 单位 Requirement 收口为「仅对携带金额/市值字段的模块生效，本 change 不验收」（`data-tool-contract` spec + `proposal.md` 验收对照 + 3.4 注释）⑥ T1/T2 缺口断言（5.6/6.5）⑦ 依赖与构建面任务（1.1/1.2/1.4：`schemastery`/`@deepseek-ai/dsh-tools`、导出 `Config`、`TraderKitConfig` 处置、`test/smoke.test.ts` 改造） |
| 13 | High | 已采纳 | `design.md` D-1 改 `dataRoot: z.string().default('')` + 调用期报错（保挂载可用）；`cordis.patch.yml` 只留占位符/注释示例（MUST NOT 写 vault 绝对路径与易失 `sign`/`ts` 现值）；D-6 注明；`tasks.md` 1.1/1.2/1.5 补 `Config`(schemastery) 导出、依赖（`schemastery`/`@deepseek-ai/dsh-tools`）、`TraderKitConfig` 处置与「空 dataRoot 挂载成功 + 写入报错」用例 |
| 14 | Medium | 已采纳 | `data-tool-contract` 健康检查 Requirement 写明探测是**独立通道**（不计预算、不计 guard 计数、不得复用）+ **3 秒总硬超时**（不随并发放大）；新增 `diagnostics` 字段定义 scenario；`design.md` D-8 |
| 15 | Medium | 已采纳 | `data-root-layout` 宏观预留区指向既有 `题材调研/00宏观/` 并声明「仅登记、不解析」+ scenario；`design.md` D-14 |
| 16 | Medium | 已采纳（后半） | 删 `refresh` 幽灵参数：工具 schema 不含该入参、文中改为「本迭代无刷新入口」（`contracts §9`）；补「`cacheSchema` 不匹配 → 视为未命中并覆盖写」Requirement + scenario + 用例。前半「二选一」按删除分支处置（本迭代确无刷新需求） |
| 17 | Medium | 已采纳 | 断言方式改为结构断言：`src/routes/**`、`src/client/**` import 白名单 + 「除 `src/data/http.ts` 外零 `fetch(`」+ 17709 仅 `net.connect` + 交易接口调用路径 + 扫描目标非空断言（`targets.length > 0`）；`tasks.md` 7.3 重写；`data-tool-contract` 只读边界 Requirement 同步 |
| 18 | Medium | 已采纳 | `docs/carryover.md` §3 增「脚本口径移植」行（源路径 + 抓取日期 + 脚本哈希/状态 + 偏离清单）并新增 §3.1 说明；`tasks.md` 8.1 落为任务；`src/data/**` 模块头注释回指台账（tasks 8.4） |
| 19 | Medium | 已采纳 | `design.md`「已实测」表补 `DB/stock/` 现场结论（约 1095 个**中文名** md、无 code→文件稳定映射 → 支持 change 4 D-5 但需改写「未建」表述）；D-11 复述结论；Open Questions 第 6 条登记「是否索引化」 |

## 评审处置（Round 2 — 2026-09-27）

> 逐条对应 `reviews/data-foundation-review.md` Round 2 的 Issue 20..26（含标题），一条不漏；
> 本轮口径以 `docs/design/iteration-1-contracts.md`（§1 日期格式唯一口径 + 路由兜底修正、§9 缓存键修正）为唯一事实源。
> 「已采纳」= 本轮已改（给出改动位置）；「后置」= 转入 Open Questions（给条号）；「驳回」= 不采纳并给理由。

| # | 严重度 | Issue 标题 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- | --- |
| 20 | Critical | 日期三义三种格式并存（限流日 `YYYYMMDD` / 业务日 `YYYY-MM-DD`），跨 change 一致性校验必然误判 | 已采纳 | 新增 `design.md` **D-15**（`src/data/date.ts` 单点实现 + `YYYYMMDD` 三处例外 + 结构断言）；`data-tool-contract` 日期三义 Requirement 加**格式列**与格式唯一口径 bullet + 2 条 scenario（「紧凑写法与带连字符写法判为同一日」「三义不得混淆」扩写）；`trade-date-tool` 入参/返回/判据全部改 canonical（入参兼容 `YYYYMMDD` 经 `fromCompactDate`）+ scenario「归一后同格式比较（不允许恒 false 写法）」；`limit-reason-tool` 入参与 `tradeDate`/`hitRecordDate` 写定 `YYYY-MM-DD`；`concepts-tool` 补 `date` 入参与格式口径；`data-root-layout` 的 `date` 参数白名单注明折算须经 `toCompactDate`；`tasks.md` 新增 **4.5**（`date.ts` 产物/验收/依赖）与 **4.3/7.3⑥** 结构断言 |
| 21 | High | 列表级缓存键 = `source + businessDate` 不可构造（取数前不知道业务日，零网络与预算推演落空） | 已采纳 | `data-tool-contract` 缓存表键改 **`source + requestedDate`**（可构造）+ 派生视图键 `requestedDate + code` + 「键由入参构造，`businessDate` 是值不是键」+ 「一次 History 请求 = 一次列表级请求」；新增 scenario「源业务日 ≠ 请求日时同参仍零网络」「历史请求按列表级计数」；`trade-date-tool`/`concepts-tool` 缓存 Requirement 同步；`design.md` **D-3** 键与预算重算（20 标的 × 10 日 = **10 次列表级请求**）+ Risks 增「缓存键必须由入参构造」；`tasks.md` 3.3/3.7/4.1/6.3 用例同步 |
| 22 | High | 契约 §1 允许「当日 History 为空回退 List」，本 change 却规定互相兜底仅限同一分支 | 已采纳 | 删除「仅限同一路由分支内」表述：`limit-reason-tool` 路由 Requirement 改按 `contracts §1` 分「当日路由」（List 空/失败 → **可**回退 History，记 endpoint 与 `notes`）与「非当日路由」（**MUST NOT** 回退 List → `dateUnavailable`），并新增 scenario「当日 List 空/失败可回退 History」、重写「不含天数的历史端点在当日被拒」（只禁止跳过 List 的**首取**）；`data-tool-contract` 路由 bullet 同步拆两条 + scenario「当日可回退 History（仅限当日分支）」；`design.md` D-3 同步 |
| 23 | Medium | 工具返回体字段声明与自身场景/需求不一致（`hitRecordDate`、`errors` 缺声明），跨 change 裁剪表随之漏字段 | 已采纳 | `limit-reason-tool` spec:5 字段枚举补 **`hitRecordDate`**（`null` 允许，格式 `YYYY-MM-DD`）；`trade-date-tool` spec:10 返回结构补 **`errors[]`**（成功时空数组）；`tasks.md` 5.5 输出 schema 快照断言已含两者、4.1/4.3 增 `errors` 相关验收；下游 change 5 数据包裁剪表的增补以 `contracts §1` 为据**由 change 5 承接**（本 change 只负责声明字段 + 在 Open Questions 第 5 条写明「本迭代只标注、不采用」，跨 change 正文不在本 change 可改范围） |
| 24 | Medium | 契约重复与规范落点缺口（消费方义务写进本 change spec、`refresh` 无 schema 扫描用例、单位 scenario 半落地） | 已采纳（含一条后置） | ① `trade-date-tool` 的消费方义务 scenario 改为「本 change 只保留 `businessDate=null` 时不代填的产出约束」，消费行为指向 `iteration-1-contracts §1`（不再复述第二份口径）；② `tasks.md` **7.3⑥** 增「T0/T1/T2 入参 schema 无 `refresh`」断言，`data-tool-contract` 只读边界 Requirement 同步列出；③ 「中文金额文本」保留要求但明确**不 skip** 的 `normalize.ts` 单元用例（`toNumber("1.6万亿") === null`），承载字段口径后置 → Open Questions 第 7 条 |
| 25 | Medium | 结构断言目标在本 change 时点不存在——门禁必然红或空过 | 已采纳 | `data-tool-contract` 只读边界 Requirement 增**扫描域**定义：本 change 可验证域 = `src/data/**` + `src/index.ts`；`src/routes/**`、`src/client/**`、`src/skill/download.ts` 按「目录存在才断言 + 用例名标记 `deferred` + 计入 change 3/4 验收」处理；scenario「结构断言替代文本扫描」「扫描型用例先断言目标非空」同步改写（去掉本时点不可验证的「全仓」绝对量词）；`tasks.md` 7.3 增扫描域与 `deferred` 口径、8.7 门禁验收改为「可验证域全绿 + deferred 用例登记」；`design.md` Open Questions 第 8 条登记转正条件 |
| 26 | Low | 遗留措辞不一致（宏观预留区解析 vs 报错、manifest `contributes.tools` 仍为空、`diagnostics` 默认值未获 owner 裁决） | 已采纳 | ① `data-root-layout` scenario「宏观预留区不解析」收窄为「返回既有 `题材调研/00宏观/`；未登记业务区才显式报错」，与 `tasks.md` 2.1 验收一致，`design.md` **D-14** 同步；② `tasks.md` **1.3** 增「同步 `dsh.plugin.json#contributes.tools` 为 T0/T1/T2 三项（若判定属市场渠道约定则在 README 注明）」；③ `design.md` **D-8** 标注 `tdx17709.enabled` 默认值待裁决（裁决前按「仅登记、不探测」= 默认 `false`），Open Questions 第 1 条改写为裁决项，`tasks.md` 1.1/1.5 验收按此标注 |

**Round 1「部分解决」4 条的收口（2 / 7 / 12 / 17）**

| Round 1 # | 上轮状态 | 本轮是否闭合 | 依据 |
| --- | --- | --- | --- |
| 2 | 部分解决（三义格式未统一、`businessDate === rateLimitDate` 归一未定义） | **已闭合** | Issue 20 处置：格式列 + 单点 `src/data/date.ts`（D-15）+ `trade-date-tool` 判据「归一后同格式比较」scenario + tasks 4.5 产物/验收 |
| 7 | 部分解决（列表级缓存键不可构造） | **已闭合** | Issue 21 处置：键改 `source + requestedDate`（spec/design/tasks/proposal 四处一致），预算推演按新键重算并写明「一次 History 请求 = 一次列表级请求」 |
| 12 | 部分解决（单位六 scenario 只兑现两条、「中文金额文本」无落点、T0 `errors` 未声明） | **已闭合** | Issue 23/24 处置：`errors[]` 已声明；单位 Requirement 明写「本 change 不验收」且 `src/data/**` 无金额字段（D-9）；「中文金额文本」改为不 skip 的 `toNumber` 用例 + Open Questions 第 7 条 |
| 17 | 部分解决（缺「扫描目标必须存在于本 change 时点」前置） | **已闭合** | Issue 25 处置：扫描域 = `src/data/**` + `src/index.ts`，`deferred` 用例登记并移交 change 3/4，`targets.length > 0` 在可验证域内始终成立 |

## 评审处置（Round 3 — 2026-09-27）

> 逐条对应 `reviews/data-foundation-review.md` Round 3 的 Issue 27..33（含 Issue 26③ 未闭合项与 R1/R2 部分闭合残留），一条不漏。
> 「已采纳」= 本轮已改（给出改动位置）；「后置」= 转入 Open Questions（给条号）；「移交」= 需改跨 change 文件，本 change 只登记（见「跨 change 回写清单」）。
> 本轮口径以 `docs/design/iteration-1-contracts.md`（`§0` 具名接口、`§1` 日期、`§9` 缓存与预算、`§11` 出口所有权、`§12.5` 回溯上限、`§12.8` 降级区分）为唯一事实源。

| # | 严重度 | Issue 标题 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- | --- |
| 27 | High | change 5 的预算预检具名出口 `traderKit.data.guardStatus()` 在本 change 无任何落点 | 已采纳 | `data-tool-contract` 新增 Requirement「**频控状态查询出口（`traderKit.data.guardStatus`）**」：返回 `{ rateLimitDate, remaining, budgetLimit, budgetUsed, minIntervalMs, fullMarketGuard, sessionState, fetchedAt }`（多源附 `sources[]`）+ 4 条 scenario（预算预检可用 / 预算耗尽可判 / 查询不出站 / 消费方不自建预算计数），并注明「与工具同一实现、同一内存计数、**不出站**」；`design.md` **D-16** 决策条目 + D-7 出口清单补 `guardStatus` + **跨 change 回写清单**第 1 条登记「change 5 的预算预检引用该出口」；`tasks.md` **3.8**（产物/验收/依赖）+ 7.2 验收 |
| 28 | High | 历史日 S7 History 空 + S5 命中时最终 `available`/`errors` 未定义（S5 数据被下游丢弃） | 已采纳 | `limit-reason-tool` spec 写死**备源聚合优先级判定表**（S5 命中 → `available=true`/`source='S5'`/`errors=[]`/`notes`「History 为空，已由 S5 兜底」；两源无数据 → `dateUnavailable`；两源失败 → `sourceUnavailable`），删除「SHALL 返回 `available=false` + `dateUnavailable` 并继续尝试 S5」的冲突表述，新增 3 条 scenario；`data-tool-contract` 非当日路由 + scenario 同步；`design.md` **D-17** + D-3；`tasks.md` 5.1/5.6 断言改写（含 `历史日 S5 命中不降级`） |
| 29 | Medium | `tdx17709.enabled` 默认值三处矛盾（spec `true` / design 段内自相矛盾 / tasks `false`） | 已采纳 | 统一为**默认 `false`**：`data-tool-contract` spec 的 `diagnostics` 配置面 scenario 改为「默认 `false`——本迭代仅登记、不探测，需显式开启」；`design.md` **D-8** 删掉「默认 `true`」并把理由写清（默认不触 17709 端口，`contracts §11` 把 TQ 划给 skill 侧；默认关闭使「TdxW 未启动」仅在显式开启后适用）；`tasks.md` 1.1/1.5 措辞改为「已定：默认 `false`」；Open Questions 第 1 条更新为「**已定：默认 `false`**」 |
| 30 | Medium | T2 `date` 入参与列表级缓存不匹配（S8 无日期字段，历史 `requestedDate` 分桶会固化错误归属） | 已采纳 | `concepts-tool` spec：明确 **T2 无日期语义**——`date` 可选且**只用于缓存分桶**，缓存键 = **`concepts + requestedDate`**（与 `source + requestedDate` 同构），请求 S8 MUST NOT 带日期参数、MUST NOT 产生 `dateUnavailable`；返回体补 `businessDate`（`YYYY-MM-DD` \| `null`），`null` 时 `notes` 记「源无日期，按 `requestedDate` 缓存」且 MUST NOT 参与历史回溯/按业务日归档；新增 3 条 scenario；`data-tool-contract` 缓存 Requirement 补 `businessDate=null` 例外 + scenario；`design.md` **D-18**；`tasks.md` 6.3/6.4/6.5 同步（删「T2 必须给出 businessDate」的隐含要求） |
| 31 | Low | 护栏拒绝态与预算用量无具名状态/出口，change 4/5 按名消费 | 已采纳 | 「频控护栏」Requirement 补**具名拒绝形态** `{ rejected: true, reason: 'sessionRejected' \| 'budgetExhausted' \| 'batchLimitExceeded' \| 'intervalLimited', limit, used }` + scenario「拒绝态具名」；预算用量查询由 Issue 27 的 `guardStatus()` 承接；`design.md` D-16 复述；`tasks.md` 3.2 验收补用例 |
| 32 | Low | 示例数字未回写（design 仍写 N=10，change 4/`contracts §12.5` 已定 N=6） | 已采纳 | `design.md` D-3 / D-5 依据段 / Risks 三处示例统一为 **N=6**（`contracts §12.5`）并注明「早期稿 10 日不再有效」；`data-tool-contract` 的「历史请求按列表级计数」scenario 同步改为 6 日（示例与回溯上限一致） |
| 33 | Low | Issue 25 的跨 change 移交不完整（change 4 D-16/6.3② 仍单通道措辞、change 3 无转正条目） | 移交（已登记） | 跨 change 文件不在本 change 可改范围：`design.md` 新增**跨 change 回写清单**第 3 条（目标 change + 符号 + owner）+ Open Questions 第 9 条（编号与理由）；`tasks.md` 8.9 登记核销；本 change 内保持「两条具名通道」口径自洽（spec 只读边界 / D-5 / tasks 3.1/7.3）。**理由**：改 `review-page`/`tq-skill-installer` 违反本轮「只改 data-foundation」约束，且静默丢弃会复活 Round 1 Issue 17 的空过路径 |
| 26③ | — | （Round 2 部分闭合残留）`diagnostics` 默认值未获 owner 裁决 | 已闭合 | 由 Issue 29 处置闭合（spec/design/tasks 三处统一默认 `false` + D-8 理由 + Open Questions 第 1 条「已定」），Round 2 处置表第 26 行的「③未闭合」状态在本轮核销 |
| R2-20 | Critical | 日期格式唯一口径（已完成，本轮复核） | 已复核 | `contracts §1` 格式列 + `src/data/date.ts` 单点 + tasks 4.5/8.8 无回归；本轮新增内容（`guardStatus` 的 `rateLimitDate`、T2 `businessDate`）均沿用 `YYYY-MM-DD` 口径，未引入新格式 |
| R2-21 | High | 列表级缓存键可构造（已完成，本轮扩展） | 已复核 | 键仍为入参可构造量；Issue 30 为 T2 显式写出 `concepts + requestedDate` 并补「源无日期字段 → `businessDate=null`、键与目录仍由 `requestedDate` 构造」scenario，未回退到用 `businessDate` 做键 |
