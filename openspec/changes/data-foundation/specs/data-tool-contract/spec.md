## ADDED Requirements

### Requirement: 双出口同一实现

数据模块 SHALL 同时提供 Tool 出口（`ctx.tools.register`，供 agent 会话调用）与 service 出口（插件提供服务，供复盘页面与其它模块调用）；两个出口 MUST 指向同一实现函数与同一缓存，MUST NOT 各自实现一份取数逻辑。

#### Scenario: 页面与工具返回一致

- **WHEN** 页面经 service 出口取某标的标签，且同年同日随后 agent 经工具取同一标的
- **THEN** 两次调用返回同一 schema、同一数据（第二次命中同一缓存，零网络）

#### Scenario: 页面层不含取数实现

- **WHEN** 审查页面/路由层代码
- **THEN** 不存在第三方接口 URL、签名参数或取数逻辑，仅调用 service 出口；且以**结构断言**（import 白名单）验证，MUST NOT 仅以文本扫描代替（断言方式见 `iteration-1-contracts §7`）

### Requirement: 日期三义分离（限流日 / 请求日 / 业务日）

三个日期概念 SHALL 分开定义、MUST NOT 互相顶替（`iteration-1-contracts §1`）：

| 名称 | 来源 | 用途 | 格式 |
| --- | --- | --- | --- |
| **限流日** `rateLimitDate` | 系统时钟，固定 `Asia/Shanghai` | 护栏时段判定（09:15–11:30 / 13:00–15:00）、预算桶键、T1 端点路由判据 | `YYYY-MM-DD` |
| **请求日** `requestedDate` | 调用方入参（canonical；兼容 `YYYYMMDD` 写法，经 `src/data/date.ts` 归一）；缺省 = 限流日 | 选择 S7 `surgeLimitList` / `surgeLimitHistory`；列表级缓存键与天级缓存目录 | `YYYY-MM-DD` |
| **业务日** `businessDate` | 数据源返回（S7 响应 `data.date` / TQ `HqDate`） | 归属与落盘内容的日期依据（含文档归属）；**一切消费方的唯一日期依据**。缓存**键**不用它（键由 `requestedDate` 构造）、缓存**payload** 保存它 | `YYYY-MM-DD` |

- **日期格式唯一口径**（`iteration-1-contracts §1`）：工具/service 契约、数据包与缓存 payload 中的日期**一律** `YYYY-MM-DD`（含 `rateLimitDate` / `requestedDate` / `businessDate` / `tradeDate`；三者比较前 MUST 同格式）。`YYYYMMDD` **只允许**出现在 ①目录/文件名模板参数与锚点（`<YYYYMM>`/`<YYYYMMDD>`）、②天级缓存目录（按 `requestedDate` 折算）、③第三方源请求参数。两格式转换 MUST 经单点工具 `src/data/date.ts`（`toCompactDate` / `fromCompactDate` / `isValidIsoDate` / `rateLimitDate(now)`）；`src/data/**` 内各处 MUST NOT 自行拼接或截断日期字符串。
- T1 的 List/History 路由判据 SHALL 是**请求日 vs 限流日**（相等 → List；否则 History），MUST NOT 以「源返回日期」或系统时区的其它近似量充当判据。
- **当日路由**：`requestedDate === rateLimitDate` → 用 `surgeLimitList`；当日 **List 空或失败**时可回退 `surgeLimitHistory`，并 MUST 记 `source` / endpoint 与 `notes`。
- **非当日路由**：`requestedDate !== rateLimitDate` → 只用 `surgeLimitHistory`；其空或失败 **MUST NOT** 回退 List（List 是当日全市场列表，会把别日数据当请求日数据），MUST NOT 仅以 `notes` 标注替代（`iteration-1-contracts §1`）。该分支的**最终可用态** SHALL 按 `limit-reason-tool` 的「备源聚合优先级」判定：S5 在该业务日有命中记录 → `available=true` / `source='S5'` / **`errors=[]`**（S7 leg 的 `dateUnavailable` MUST NOT 保留在最终 `errors`，只允许进 `notes` 记「History 为空，已由 S5 兜底」）；两源均无数据 → `available=false` + `errors:[dateUnavailable]`（附请求日与实际业务日）；两源均失败 → `available=false` + `errors:[sourceUnavailable]`（「无数据」与「取数失败」MUST 用不同 error 值区分，`iteration-1-contracts §12.8`）。
- `tradeDate`（= `businessDate`）MUST 从响应体**无条件**取值，MUST NOT 因「列表为空」而丢失。
- 本 change 的日期事实源统一由 T0 `trade-date-tool` 提供（service `traderKit.data.resolveTradeDate` / tool `get_trade_date`，见 `trade-date-tool` spec）；本 change 内其它模块 MUST NOT 各自实现日期推断。

#### Scenario: 请求日等于限流日走 List

- **WHEN** `requestedDate === rateLimitDate`
- **THEN** T1 使用 `surgeLimitList`；护栏时段判定与预算桶键均使用同一 `rateLimitDate`

#### Scenario: 请求日不等于限流日走 History

- **WHEN** `requestedDate !== rateLimitDate`
- **THEN** T1 使用 `surgeLimitHistory`；MUST NOT 使用 `surgeLimitList` 的数据

#### Scenario: 历史日 History 为空不回退 List

- **WHEN** `requestedDate !== rateLimitDate` 且 History 返回空
- **THEN** MUST NOT 用 List 数据填充；最终可用态按备源聚合优先级——S5 命中该业务日 → `available=true` + `source='S5'` + `errors=[]`（`notes` 记「History 为空，已由 S5 兜底」）；两源均无数据 → `available=false` + `errors:[dateUnavailable]`；两源均失败 → `available=false` + `errors:[sourceUnavailable]`

#### Scenario: 历史日 S5 命中不因 S7 空而降级

- **WHEN** `requestedDate !== rateLimitDate`、S7 History 为空或失败，且 S5 在该业务日有命中记录
- **THEN** `available=true`、`source='S5'`、最终 `errors` **不含** `dateUnavailable`（MUST NOT 把 S7 leg 的失败写进最终 `errors`），`notes` 记「History 为空，已由 S5 兜底」；消费方（change 5）据此按可用数据处理，MUST NOT 因 `dateUnavailable` 降级为 `missing(sourceUnavailable)`

#### Scenario: 跨零点与节假日路由稳定

- **WHEN** 同一入参 `date='2026-09-24'` 在跨零点、周末与法定假日调用
- **THEN** 路由判据（请求日 vs 限流日）、预算桶键与业务日取值三者各自稳定：路由只随限流日变化而变化，业务日只随源返回变化而变化，互不污染

#### Scenario: 紧凑写法与带连字符写法判为同一日

- **WHEN** 同一交易日分别以 `'20260924'`（源请求参数或入参兼容写法）与 `'2026-09-24'`（canonical）出现
- **THEN** 归一后两者判为相等：`requestedDate === rateLimitDate`、`businessDate === rateLimitDate` 的比较结果不受书写格式影响（比较前 MUST 经 `src/data/date.ts` 归一）

#### Scenario: 当日可回退 History（仅限当日分支）

- **WHEN** `requestedDate === rateLimitDate` 且 `surgeLimitList` 返回空或失败
- **THEN** 允许回退 `surgeLimitHistory` 取当日数据；返回体 MUST 记录实际命中的端点与 `source`，并在 `notes` 标注回退（MUST NOT 静默）

#### Scenario: 列表为空不丢业务日期

- **WHEN** 源列表成功但为空
- **THEN** `tradeDate` 仍为响应体的业务日期（MUST NOT 为 `null`、MUST NOT 用限流日替换）

#### Scenario: 三义不得混淆

- **WHEN** 审查数据模块实现
- **THEN** 不存在把系统时钟用作业务日期、或把源返回日期用作护栏时段判据的代码路径；预算桶键只由 `rateLimitDate` 生成；且跨概念比较（`requestedDate` vs `rateLimitDate`、`businessDate` vs `rateLimitDate`）MUST 统一为 `YYYY-MM-DD` 后比较，`YYYYMMDD` 仅出现在目录/文件名参数、天级缓存目录与源请求参数三处

### Requirement: 字段规范化与单位标注

字符串数值 SHALL 统一 `Number()` 转换并做空值守卫（`""`、`"--"`、`"None"`、`null`、`undefined` → `null`）；MUST NOT 用 `0` 代替缺失值。输出字段 SHALL 带单位标注：金额类 = 万元（除非该源原生单位为元，须在字段名或标注中显式区分）、市值类 = 亿元、比例类 = 百分数数值（`0.05` → `5`）。单位规范 SHALL 仅对**携带金额/市值字段的模块**生效；本 change 的 T1/T2 返回体（`cause/firstTime/lastTime/openCount/streakDesc`、`strengthPct` 及其同类）**不含金额与市值字段**，故该 Requirement 在本 change **不验收**，由携带金额/市值字段的后继 change 验收（本 change 只要求 `.SS`/`.SZ` 后缀、百分数比例换算与空值守卫的落点）。

#### Scenario: 字符串数值转换

- **WHEN** 源返回 `"16009.27"` 作为封单额
- **THEN** 输出为数值 `16009.27` 且标注单位为万元

#### Scenario: 空值守卫

- **WHEN** 源返回 `""` / `"--"` / `"None"` / `null`
- **THEN** 输出 `null`（MUST NOT 输出 `0`）

#### Scenario: 中文金额文本不参与计算

- **WHEN** 源返回含单位词的文本金额（如 `"1.6万亿"`）
- **THEN** 原样保留文本并标注「未解析/单位待确认」，MUST NOT 参与数值计算或直接展示为数值（用例：以 `toNumber("1.6万亿")` 为输入断言返回 `null` 且保留原文本，**不做 skip**）；该路径当前无真实消费字段，故仅以 `normalize.ts` 的单元用例验收（详见 `design.md` Open Questions 第 7 条）

#### Scenario: 本 change 无金额字段

- **WHEN** 审查 T1/T2 的返回结构与 `src/data/normalize.ts` 的单位常量导出
- **THEN** 确认 T1/T2 不含金额/市值字段，单位 Requirement 在本 change 标记「不验收」（单位常量可先建但无消费方断言）

### Requirement: 来源标注

每一条返回字段 SHALL 携带 `{value, source, fetchedAt}`；MUST NOT 出现无来源的数值。主备源切换时，每个字段的 `source` MUST 反映实际提供该值的源。

#### Scenario: 主源成功

- **WHEN** S7 成功返回涨停原因
- **THEN** 该字段 `source` 标识 S7，`fetchedAt` 为本次取数时间

#### Scenario: 降级到备源

- **WHEN** 主源失败而 S5 提供该值
- **THEN** 该字段 `source` 标识 S5（MUST NOT 冒用主源标识）

#### Scenario: 字段缺失

- **WHEN** 源未提供某字段
- **THEN** 该字段 `value=null`，仍带 `source` 与 `fetchedAt`（表明是哪次取数判定的缺失）

### Requirement: 缓存幂等与原子写（两层缓存）

缓存 SHALL 分两层（`iteration-1-contracts §9`）：

| 层级 | 键 | 内容 |
| --- | --- | --- |
| **列表级** | `source + requestedDate`（调用方入参，**可构造**） | 整份列表（全市场级响应），payload 内含源返回的 `businessDate` 与 `hitEndpoint`（源无日期字段时 `businessDate=null`，见下条例外） |
| **code 派生视图级** | `requestedDate + code` | 由列表派生的单标的视图（T1/T2 的 per-code 结果），返回体携带 `businessDate`（允许 `null`，同上例外） |

- **键由入参构造，`businessDate` 是值不是键**：`businessDate` 在响应到达前不可知，MUST NOT 用它做键（否则读键与写键不是同一个量，「同参重复调用零网络」在「源业务日 ≠ 请求日」的输入上不成立）。天级缓存目录同样按 `requestedDate` 折算 `<YYYYMMDD>` 分桶。
- **`businessDate=null` 的例外**：源响应本身**不含日期字段**时（如 S8 `plates_by_any_stock` 实时快照），payload 与工具返回体的 `businessDate` SHALL 为 `null`，并在 `notes` 标注「源无日期，按 `requestedDate` 缓存」。`businessDate=null` MUST NOT 参与历史回溯（`iteration-1-contracts §12.5`）、MUST NOT 用于按业务日归档（归档一律按 `requestedDate` 折算的 `<YYYYMMDD>` 桶）、MUST NOT 被消费方当作某个具体业务日；MUST NOT 用请求日或限流日代填该字段。
- **一次 History 请求 = 一次列表级请求**：预算与最小间隔按列表级请求数计，History 端点请求同样计 1 次列表级请求；code 派生视图命中 MUST NOT 计预算、MUST NOT 出网。
- `cacheSchema`（模块名 + 版本）不匹配 SHALL 视为**未命中**并由本轮结果覆盖写，MUST NOT 当命中返回旧 schema 数据。
- 缓存 SHALL 按 `requestedDate` 折算的 `<YYYYMMDD>` 分桶；同一交易日同一输入的重复调用 MUST 零网络开销（命中即返回）；写缓存 SHALL 为原子写（临时文件 + 改名）且写前 re-read（OneDrive 并发容忍），MUST NOT 整目录重写。
- `refresh` 参数：本迭代**不提供**（工具 schema 不含该入参，实现与文档 MUST NOT 出现该幽灵参数）；本迭代无盘后刷新、无定时任务。

#### Scenario: 当日重复调用零网络

- **WHEN** 同一交易日内第二次调用同一模块同一标的
- **THEN** 返回与首次一致的结果，且出站请求计数为 0

#### Scenario: 列表级缓存先行

- **WHEN** 同一交易日、同一源，串行请求 20 个不同标的
- **THEN** 列表级请求数为 1（整份列表一次取回），其余 20 次 per-code 查询命中列表级缓存或派生视图，零网络；当日预算用量按列表级请求数计（不按标的数计）

#### Scenario: 源业务日 ≠ 请求日时同参仍零网络

- **WHEN** 以 `requestedDate='2026-09-24'` 首次取数、源返回的 `businessDate` 与之不同（跨零点或源滞后），随后用**同一入参**再次调用
- **THEN** 命中同一 `source + requestedDate` 列表级缓存条目 → 出站请求计数为 0、预算用量不变（键由入参构造，业务日只作为 payload 值参与展示与一致性判定）

#### Scenario: 源无日期字段时 `businessDate=null`

- **WHEN** 源响应不含日期字段（如 T2 的 S8 实时快照 `plates_by_any_stock`）
- **THEN** payload 与工具返回体的 `businessDate=null` 且 `notes` 记「源无日期，按 `requestedDate` 缓存」；缓存键与天级目录仍由 `requestedDate` 构造（MUST NOT 用 `null` 当键或目录段）；该 `null` MUST NOT 参与历史回溯、MUST NOT 用于按业务日归档，MUST NOT 用请求日/限流日代填

#### Scenario: 历史请求按列表级计数

- **WHEN** 盘后回溯 6 个历史交易日（每日一次 History 请求）后再请求第 7 日
- **THEN** 当日预算用量为 6（**一次 History 请求 = 一次列表级请求**），第 7 日新增 1 次；`agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/` 目录按各自 `requestedDate` 分桶（示例 N=6 与 `iteration-1-contracts §12.5` 的回溯上限一致）

#### Scenario: `cacheSchema` 不匹配视为未命中

- **WHEN** 磁盘上缓存文件的 `cacheSchema` 与当前模块版本不一致
- **THEN** 视为未命中 → 重新取数 → 以新 schema 原位覆盖写该文件（MUST NOT 当命中返回、MUST NOT 另开垃圾文件）

#### Scenario: 原位刷新不追加

- **WHEN** 当日缓存文件已存在
- **THEN** 刷新为原位覆盖，不产生新文件、不产生副本文件

#### Scenario: 写入中断不留半截文件

- **WHEN** 缓存写入过程中进程被中断
- **THEN** 目标路径下不存在半截 JSON（原子写保证）

#### Scenario: 无刷新入口

- **WHEN** 审查 T0/T1/T2 的工具入参 schema 与实现
- **THEN** 不存在 `refresh` 参数或等价刷新开关；文中亦无该参数表述

### Requirement: 显式降级

主源失败 SHALL 换备源；主备均失败 SHALL 返回显式不可用态（`available=false` + 原因 + 已尝试的源与各自错误），MUST NOT 用 `0`、空列表或空字符串冒充数据。

#### Scenario: 主源失败走备源

- **WHEN** S7 返回空或签名失效
- **THEN** 记录 S7 失败原因，改用 S5 取数

#### Scenario: 主备均失败

- **WHEN** S7 与 S5 均不可用
- **THEN** 返回 `available=false` + 各源错误摘要，消费方据此显示「数据源不可用 + 原因」

#### Scenario: 不可用态不被渲染成零值

- **WHEN** 消费方渲染不可用态
- **THEN** 显示不可用文案与原因，MUST NOT 显示 `0`、`--` 或空白

### Requirement: 频控护栏（代码强制）

护栏 SHALL 在数据模块入口以代码强制，MUST NOT 仅以文档嘱咐实现。护栏至少包含：

- ① **每源并发上限**（默认 ≤2）与**最小请求间隔**（默认 1000 ms）；
- ② **单次调用标的数硬上限**（默认 ≤20）——硬上限不受任何豁免放宽；
- ③ **盘中时段**（工作日 09:15–11:30、13:00–15:00）拒绝「全市场级」调用，除非调用方显式声明 `offSession`；
- ④ **每源每交易日请求预算**（默认 200 次 / 源 / 交易日，按**列表级请求数**计）。

口径细则：

- **「全市场级」判据**（本 change 唯一版本）：批量标的数 > ② 的硬上限，**或**调用方显式标记 `fullMarket`。自动识别（例如请求参数覆盖全市场）属可选增强，不作为本 change 的判据。
- **`offSession` 的作用域**：只放宽**③ 的时段拒绝**，MUST NOT 放宽 ①（并发/间隔）、②（批量硬上限）与 ④（预算）。`offSession` 只能由盘后任务显式声明，MUST NOT 由实现自动置位。
- **`guard.sessionOverride`**（`auto` | `on` | `off`，默认 `auto`）：`auto` = 按限流日时钟判定时段；`on` = 强制视为盘中（用于测试与保守模式）；`off` = 强制视为盘后（用于人工排障，需显式配置）。该字段只影响 ③ 的时段判定，不影响 ①/②/④。
- **单标的调用也受全局间隔约束**：最小间隔是**按源全局**的，单标的调用同样排队等待（有界回溯 N 日 = 至少 N×间隔 串行），消费方 MUST 按此估算时延（见 design Risks）。
- **默认值的性质**：①~④ 的默认值是**经验值、可配置**，不是实测契约；依据段落见 design D-5。
- **系统时钟 SHALL 仅用于限流判定**（限流日、时段判定、预算桶键），MUST NOT 用作业务日期；三个日期概念的定义见本 spec 的「日期三义分离」Requirement。

任一超限 SHALL 显式失败并说明限额与实际用量（含「未发出网络请求」的明确结论），且失败结果 SHALL 为**具名形态**（`iteration-1-contracts §0`：无具名接口/状态的跨 change 消费视为无效表述）：`{ rejected: true, reason: 'sessionRejected' | 'budgetExhausted' | 'batchLimitExceeded' | 'intervalLimited', limit, used }`——change 4 的 `sessionRejected`（`review-page`）与 change 5 的 `budgetExhausted`（`daily-summary`）SHALL 直接引用本枚举名，MUST NOT 各自造名或解析自由文本。

#### Scenario: 盘中拒绝全市场级调用

- **WHEN** 盘中（工作日 10:00）发起超过批量上限的调用
- **THEN** 调用被拒绝，返回限额说明，且出站请求计数为 0

#### Scenario: 盘中显式 fullMarket 标记被拒绝

- **WHEN** 盘中且标的数未超上限，但调用方显式标记 `fullMarket=true`
- **THEN** 调用被拒绝（全市场级判据命中），出站请求计数为 0

#### Scenario: 盘后 offSession 只放宽时段闸门

- **WHEN** 盘后任务声明 `offSession=true` 且标的数 **未超**批量硬上限
- **THEN** 调用被允许；同时断言最小间隔与预算仍被强制（连续两次调用仍受 1000 ms 间隔约束、仍消耗预算）

#### Scenario: offSession 不放宽批量硬上限

- **WHEN** 调用方声明 `offSession=true` 但标的数超过批量硬上限
- **THEN** 调用仍被拒绝（硬上限不可豁免），返回限额说明与实际用量，出站请求计数为 0

#### Scenario: 每日预算耗尽

- **WHEN** 某源当日列表级请求数达到预算上限
- **THEN** 后续调用显式失败并说明预算与用量，MUST NOT 静默排队或长时间等待

#### Scenario: 限流时钟与业务日期解耦

- **WHEN** 系统时钟日期与数据源业务日期不一致（如节假日）
- **THEN** 限流仍按系统时钟判定，业务日期仍取自数据源，两者互不污染

#### Scenario: 单标的调用仍受全局间隔约束

- **WHEN** 同一源上先后发起两个单标的调用（均未超批量上限）
- **THEN** 第二次调用等待至最小间隔（默认 1000 ms）到期后才出网，MUST NOT 因为「单标的」而跳过间隔

#### Scenario: 时段误判可被显式覆盖

- **WHEN** 调休工作日或法定假日导致 `auto` 判定与实际交易状态不符
- **THEN** 可通过 `guard.sessionOverride` 显式覆盖时段判定（`on`/`off`），且该覆盖 MUST NOT 影响批量硬上限与预算

#### Scenario: 拒绝态具名

- **WHEN** 任一护栏（时段 / 预算 / 批量硬上限 / 间隔）拒绝调用
- **THEN** 返回体含 `rejected=true` 与 `reason` ∈ `sessionRejected | budgetExhausted | batchLimitExceeded | intervalLimited`，并含 `limit` 与实际用量 `used`；消费方按 `reason` 分支（change 4 `sessionRejected`、change 5 `budgetExhausted`），MUST NOT 解析文案字符串判定

### Requirement: 频控状态查询出口（`traderKit.data.guardStatus`）

数据模块 SHALL 提供 service 出口 `traderKit.data.guardStatus()`，作为**预算与护栏状态的唯一查询出口**（`iteration-1-contracts §9`/`§11`；change 5 的「预算预检与分批」、change 4 的降级文案均按此具名消费，无具名出口的「复用」视为无效表述）。该出口 SHALL 返回：

`{ rateLimitDate, remaining, budgetLimit, budgetUsed, minIntervalMs, fullMarketGuard, sessionState, fetchedAt }`（字段可扩展，但 MUST 至少包含以上语义；多源场景 SHALL 附 `sources: [{ source, budgetLimit, budgetUsed, remaining }]`）。字段语义：

- `rateLimitDate`：限流日（`YYYY-MM-DD`，系统时钟固定 `Asia/Shanghai`；预算桶键，`iteration-1-contracts §1`）；
- `budgetLimit` / `budgetUsed` / `remaining`：每源每交易日**列表级请求**预算上限 / 已用量 / 剩余量（`remaining = max(0, budgetLimit - budgetUsed)`）；多源时按 `sources[]` 分列，顶层字段取保守值（最小值）；
- `minIntervalMs`：当前生效的最小请求间隔（消费方按 `标的数 × minIntervalMs` 估算时延）；
- `fullMarketGuard`：当前时段「全市场级」判定的闸门状态（含 `offSession` 声明后的放宽结果）；
- `sessionState`：`inSession | offSession | overridden`（对应 `guard.sessionOverride` 的 `auto|on|off` 生效结果）；
- `fetchedAt`：状态快照时间（ISO8601 带 `+08:00` 偏移）。

该出口 SHALL：① 与 T0/T1/T2 工具出口共用**同一 `guard.ts` 实现与同一内存计数**（MUST NOT 第二份预算计数，`iteration-1-contracts §11`）；② **不出站**——查询本身 MUST NOT 发出任何网络请求、MUST NOT 消耗预算、MUST NOT 改动 guard 计数与时段状态（只读快照）；③ 消费方 MUST NOT 自建预算计数（change 5 的预算预检 MUST 走本出口；出口缺失时消费方 SHALL 显式 `DEPENDENCY_UNAVAILABLE`（change 5 D-1b），MUST NOT 静默跳过预检——`iteration-1-contracts §0`）。

#### Scenario: 预算预检可用

- **WHEN** 当日某源已发生 3 次列表级请求后调用 `traderKit.data.guardStatus()`
- **THEN** `budgetUsed=3`、`remaining = budgetLimit - 3`、`rateLimitDate` 为当前限流日；调用前后 guard 出站计数**相同**（查询不计预算）

#### Scenario: 预算耗尽时预检可判

- **WHEN** `budgetUsed === budgetLimit`
- **THEN** `remaining=0` 且返回体足以支撑消费方的分批决策（change 5 可据此算出「本次可处理前 N 个标的」，N 可为 0）；MUST NOT 需要消费方自行读缓存文件或推算

#### Scenario: 查询不出站

- **WHEN** 在监控出站计数（含 `127.0.0.1:17709`）的条件下调用 `guardStatus()`
- **THEN** 调用前后出站计数与预算用量均不变；对 `127.0.0.1:17709` 零 HTTP 请求（数据模块对该端口的唯一动作是独立探测通道的 `net.connect`，且默认关闭，`iteration-1-contracts §7`）

#### Scenario: 消费方不自建预算计数

- **WHEN** 审查 change 5 的预算预检实现（结构断言）
- **THEN** 只调用 `traderKit.data.guardStatus()` 取 `remaining`/`budgetLimit`/`minIntervalMs`，源码中不存在自建计数器或自读缓存预算文件；出口缺失时走显式 `DEPENDENCY_UNAVAILABLE`

### Requirement: 只读边界

数据模块 SHALL 只调用读取类接口；MUST NOT 存在 `order_stock`、`cancel_order` 或任何交易账户接口的调用路径；SHALL 以**结构断言 + 扫描前置非空断言**验证（断言方式见 `iteration-1-contracts §7`）：

- **扫描域（本 change 时点）**：`src/data/**` 与 `src/index.ts`（必然存在，`targets.length > 0` 由此构成）；`src/routes/**`、`src/client/**` 在本 change 时点**尚不存在**（由 change 4 创建）→ 其断言按「目录存在时才执行，并用例名标记 `deferred`、同时计入 change 4 验收」处理，MUST NOT 因其缺失而放宽或跳过 `src/data/**` 的断言；
- `src/routes/**`、`src/client/**`（存在时）MUST NOT import `src/data/**`（允许 import service 类型）；
- **具名出站通道**：允许 `fetch(` / `http.request` 的通道仅 `src/data/http.ts`（**数据面**出站唯一闸门）与 `src/skill/download.ts`（change 3 的 skill 下载器，带替代护栏，见 change 3 design D-12）；在**本 change 时点存在的源码集合**（`src/data/**`、`src/index.ts`）内，除 `src/data/http.ts` 外 MUST 为零命中（`src/skill/download.ts` 由 change 3 创建，同样按 `deferred` 处理）；
- `127.0.0.1:17709`：数据模块对其**无 HTTP 请求**，仅 `net.connect` 探测（且可配置关闭）；
- 交易接口：源码与依赖中不存在 `order_stock` / `cancel_order` 调用路径；
- 工具入参 schema：T0/T1/T2 的入参 schema MUST NOT 含 `refresh` 或任何刷新开关（见「无刷新入口」scenario 的 schema 扫描用例）。

任一扫描型用例 MUST 先断言「扫描目标非空」（`targets.length > 0`），避免空过。

执行类语义（若未来引入）SHALL 默认 dry-run。

#### Scenario: 源码审查

- **WHEN** 审查数据模块全部源码与依赖
- **THEN** 不存在交易账户类调用（含被注释的代码）

#### Scenario: 结构断言替代文本扫描

- **WHEN** 运行数据模块测试
- **THEN** 通过 import 白名单断言与出站通道断言验证：`src/data/**`、`src/index.ts` 内除 `src/data/http.ts` 外零 `fetch(`；`src/routes/**`、`src/client/**`、`src/skill/download.ts` 在本 change 时点不存在 → 对应用例标记 `deferred` 并计入 change 4/change 3 验收；MUST NOT 只依赖源码文本扫描

#### Scenario: 扫描型用例先断言目标非空

- **WHEN** 运行任一源码扫描用例
- **THEN** 用例首步断言扫描目标数 > 0（本 change 时点由 `src/data/**` 与 `src/index.ts` 构成；目标缺失即失败，MUST NOT 空过）；对尚不存在的目录不得以「目标为 0」的方式通过

#### Scenario: 17709 无 HTTP 请求

- **WHEN** 审查数据模块对 `127.0.0.1:17709` 的行为
- **THEN** 只有 `net.connect` 可达性探测，无任何 HTTP 请求；该探测可配置关闭

### Requirement: 启动健康检查

插件挂载 SHALL 完成依赖可达性探测并给出结论：TQ-Local 端点（仅 TCP 可达性，不调用任何 TQ 方法）与三方源（S7 / S5 / S8）可达性；探测 SHALL 是**独立通道**——不计频控预算、不计入 guard 计数、不得被其它模块复用；探测总时长 SHALL 有 **3 秒硬超时**（`AbortSignal.timeout` 截断），超时以超时结论记录。失败 SHALL 给出显式文案与排障指引，MUST NOT 阻塞插件挂载，MUST NOT 因探测失败使工具与 service 出口不可用。

健康状态出口 `health.status()` SHALL 返回**两段视图** `{ data, skill }`：`data` 段为本 change 探测结论，`skill` 段为 change 3（`tq-skill-installer`）`skill.status()` 的透传（两段为组合读取，MUST NOT 各自重复实现；change 3 未挂载时 `skill` 段为 `null` 并在 `data.warnings` 记明）。

#### Scenario: TdxW 未启动

- **WHEN** 探测时 `127.0.0.1:17709` 不可达且 `diagnostics.tdx17709.enabled=true`
- **THEN** 健康状态标记 TQ-Local 不可达并给出「通达信客户端是否已启动并登录」文案，插件仍正常挂载、工具仍可调用（默认 `false` 时该项记为「未探测」、本场景不适用）

#### Scenario: 三方源不可达

- **WHEN** S7 / S5 / S8 中某源探测失败
- **THEN** 标记该源不可用（含原因），相关工具按显式降级规则返回不可用态

#### Scenario: 探测超时

- **WHEN** 探测超过 3 秒（总硬超时）
- **THEN** 以超时结论记录并继续挂载，MUST NOT 长时间挂起启动流程；最坏耗时受硬超时上界约束（不随并发上限 × 3s 放大）

#### Scenario: 探测不计预算与护栏计数

- **WHEN** 挂载后立即经 `traderKit.data.guardStatus()` 查询当日预算用量与 guard 出站计数
- **THEN** 探测消耗为 0（不计预算、不计入 guard 计数）；且探测通道 MUST NOT 被其它模块调用复用

#### Scenario: 健康状态两段视图

- **WHEN** change 3（`tq-skill-installer`）已挂载并调用 `health.status()`
- **THEN** 返回 `{ data, skill }` 两段：`data` 为本 change 的 TQ-Local 与三方源结论，`skill` 与 change 3 的 `skill.status({ cwd? })` **同一实现**的结论（不重复探测、不重复实现）；change 3 未挂载时 `skill === null` 且 `data.warnings` 记明原因

#### Scenario: `diagnostics` 配置面

- **WHEN** 审查 `src/config.ts` 的 `diagnostics` 字段
- **THEN** 字段定义含 `probe.enabled`（布尔，默认 `true`）与 `probe.targets`（`s7`/`s5`/`s8`/`tdx17709` 子集，默认全选）、`tdx17709.enabled`（布尔，**默认 `false`**——本迭代「仅登记、不探测」，需 owner 显式置 `true` 才做 17709 TCP 探测；理由见 `design.md` D-8 与 Open Questions 第 1 条）；关闭后探测项状态记为「未探测」而非「不可用」
