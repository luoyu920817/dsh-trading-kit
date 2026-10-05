## ADDED Requirements

### Requirement: 交易日解析工具（T0 `trade-date-tool`）

插件 SHALL 提供 T0 能力 `trade-date-tool`，且**全插件唯一实现**：

- service 出口：`traderKit.data.resolveTradeDate({ date? })`
- Tool 出口：`get_trade_date`
- 入参：可选 `date`，canonical `YYYY-MM-DD`（**兼容** `YYYYMMDD` 输入，经 `src/data/date.ts` 的 `fromCompactDate` 归一；MUST NOT 猜测）；缺省 = 限流日
- 返回：`{ requestedDate, businessDate: 'YYYY-MM-DD' | null, isTradingDay: true | null, source, fetchedAt, evidence, errors[] }`（`requestedDate` / `businessDate` / `evidence.rateLimitDate` 同为 `YYYY-MM-DD`；`errors[]` 在成功时为空数组）

日期三义的来源定义、格式唯一口径、路由判据与消费方约束见 `iteration-1-contracts §1`，本 spec 不复述第二份口径。

> **owner 裁决补丁（2026-10-05，「找到最近期的交易日」）**：S7 List 端点响应体**不含日期字段**（实测：List 仅 fields/page/surgeList/top；History 才有 `data.date`，且该 date 为请求日回显）——List 路径按原口径记 `businessDate=null` 会让交易日归属**永远**待确认。修正（**会话集合比对**，数据驱动、不猜日历）：请求日 = 限流日且 List 行非空时，T0 SHALL 自限流日前一自然日起逐自然日前探（经 `src/data/date.ts` 折算，上限 6 次探针）找到首个「History `surgeList` 非空」的最近日 D（`data.date` 回显），**比对 List 与 D 的代码集合**：完全一致 → List 即 D 日的会话（休市日场景），`businessDate=D`、`isTradingDay=null`（归属待确认，页面预填 D）；List 存在 D 没有的新代码 → List 为请求日的新会话，`businessDate=rateLimitDate`、`isTradingDay=true`；前探 6 日全空 → `businessDate=null`。探针命中即停；探针与 List 同用列表级缓存（键 = `source + requestedDate`），预算按列表级请求数计（T0 至多 1 + 6 次）。已知残余风险：连续两个交易日涨停代码集合完全一致时休市日可能被误归为当日（数据内容一致，归属可由用户显式确认纠正）。

#### Scenario: 工具与 service 双出口同一实现

- **WHEN** session 经 Tool 出口调用 `get_trade_date`，且同年同日随后页面经 `traderKit.data.resolveTradeDate` 调用
- **THEN** 两者返回同一 schema 与同一数据（第二次命中同一缓存，零网络），且注册与提供来自同一实现函数

#### Scenario: 缺省入参取限流日

- **WHEN** 调用时不传 `date`
- **THEN** `requestedDate` = 限流日（系统时钟，固定 `Asia/Shanghai`，输出格式 `YYYY-MM-DD`）

#### Scenario: 显式入参被归一后回声

- **WHEN** 传入 `date='20260924'`（紧凑兼容写法）
- **THEN** `requestedDate='2026-09-24'`（归一为 canonical，MUST NOT 猜测）；路由按「请求日 vs 限流日」判定（见 `data-tool-contract` 日期三义 Requirement）

#### Scenario: canonical 入参被原样接受

- **WHEN** 传入 `date='2026-09-24'`
- **THEN** `requestedDate='2026-09-24'`，与传入 `'20260924'` 时产生**同一** `requestedDate` 与同一缓存键（两写法判为同一日）

### Requirement: 业务日期只取数据源

`businessDate` SHALL 从数据源响应体**无条件**取值（如 S7 `data.date`、TQ `HqDate`），MUST NOT 由系统时钟推导、MUST NOT 由限流日或请求日顶替。`businessDate` 不得因「列表为空」「标的不在列表」而丢失（取值不看记录行，见 `limit-reason-tool`）。不可得时 `businessDate=null`，MUST NOT 用任何其它日期填充。

#### Scenario: 列表为空仍取到业务日期

- **WHEN** 源列表成功返回但列表为空
- **THEN** `businessDate` 仍为响应体的业务日期，MUST NOT 为 `null`、MUST NOT 回退限流日

#### Scenario: 源不可用时为 null

- **WHEN** 所有可用源均不可达或返回非法响应
- **THEN** `businessDate=null`、`isTradingDay=null`，`errors` 说明已尝试的源与原因

#### Scenario: 不得自行推断交易日

- **WHEN** 审查 `src/data/trade-date.ts` 实现
- **THEN** 不存在任何「按系统时钟判定周一至周五 / 排除法定假日 / 推断非交易日」的分支，日期事实只来自响应体

### Requirement: `isTradingDay` 取值域与日期归属

`isTradingDay` SHALL 只允许 `true` 或 `null`：

- `businessDate === rateLimitDate`（限流日，**两者同为 `YYYY-MM-DD`**）→ `true`
- 否则 → `null`

三者（`requestedDate` / `businessDate` / `rateLimitDate`）比较前 MUST 统一为 canonical `YYYY-MM-DD`：canonical 化 MUST 经 `src/data/date.ts`（`isValidIsoDate` 校验 + `fromCompactDate`/`toCompactDate` 转换），MUST NOT 在模块内手工截断或拼接日期串（`slice(0,10)` / `replace(/-/g,'')` 之类自定义实现禁止，仅允许调用 `date.ts` 的单点实现）。

本迭代**无交易日历**，因此 MUST NOT 用系统日期推断「非交易日」，MUST NOT 返回 `false`。`null` 的语义 =「归属待用户确认」，消费方据此走确认路径而不是当作工作日继续。

#### Scenario: 业务日 == 限流日

- **WHEN** `businessDate === rateLimitDate`（同格式比较，如 `'2026-09-24' === '2026-09-24'`）
- **THEN** `isTradingDay=true`，`evidence` 记录判定依据（响应体字段名 + 值 + 限流日，均为 `YYYY-MM-DD`）

#### Scenario: 业务日 != 限流日

- **WHEN** `businessDate !== rateLimitDate`（节假日、盘前未出数、历史请求）
- **THEN** `isTradingDay=null`（归属待确认），MUST NOT 返回 `false`、MUST NOT 用系统日期给出「非交易日」结论

#### Scenario: 归一后同格式比较（不允许恒 false 写法）

- **WHEN** 源以紧凑串返回业务日（如 `20260924`）而限流日为 `'2026-09-24'`
- **THEN** 两者归一为同一 canonical 值后判为**相等** → `isTradingDay=true`；MUST NOT 因书写格式不同而恒为 `null`（判据 MUST NOT 直接比较未归一的两种格式）
- **AND** 审查 `src/data/**` 源码：除 `src/data/date.ts` 外不存在自行截断/拼接日期的实现（结构断言，扫描目标非空）

#### Scenario: 无交易日历不得伪造结论

- **WHEN** 审查 `src/data/trade-date.ts` 与工具输出 schema
- **THEN** `isTradingDay` 的取值域为 `true | null`（类型与 schema 双层约束），源码中不存在 `isTradingDay: false` 的产出路径

### Requirement: 请求日与业务日不一致时如实返回

`requestedDate` 与 `businessDate` 不一致时，返回体 SHALL 两者并存、各自如实，MUST NOT 把请求日写进 `businessDate`、MUST NOT 因不一致而伪造 `isTradingDay`。不一致信息 SHALL 通过 `evidence` 与消费方可见的字段表达（消费方行为见 `iteration-1-contracts §1`：change 4 提交前归属确认；change 5 要求用户显式指定交易日）。

#### Scenario: 历史请求

- **WHEN** 传入 `date='2026-09-24'` 而源返回 `businessDate='2026-09-24'`
- **THEN** `requestedDate='2026-09-24'`、`businessDate='2026-09-24'` 并存（同为 canonical），`isTradingDay` 按「业务日 == 限流日」规则取值（通常为 `null`）

#### Scenario: 业务日不可得时不代填

- **WHEN** `businessDate=null`
- **THEN** 返回体保持 `businessDate=null`、`isTradingDay=null` 并在 `errors` 说明原因；消费方行为（要求用户显式指定交易日 / 提交前归属确认）按 `iteration-1-contracts §1` 执行，本 spec 不复述第二份口径

### Requirement: 参数校验与零网络

入参 `date` SHALL 为 canonical `YYYY-MM-DD`，并**兼容** 8 位 `YYYYMMDD`（归一后接受）；两种写法之外的格式（如 `2026/09/24`、`202609`）SHALL 返回显式参数错误，且不发出任何网络请求。归一与合法性校验 MUST 经 `src/data/date.ts` 的单点实现（`fromCompactDate` / `isValidIsoDate`）。

#### Scenario: 非法日期

- **WHEN** 传入 `date='2026/09/24'`、`'202609'` 或 `'2026-13-01'`
- **THEN** 返回显式参数错误，出站请求计数为 0

#### Scenario: 日期的两种合法写法

- **WHEN** 分别传入 `date='2026-09-24'` 与 `date='20260924'`
- **THEN** 两次返回的 `requestedDate` 均为 `'2026-09-24'`，命中同一缓存键，第二次零网络

#### Scenario: 日期范围异常不猜测

- **WHEN** 传入格式合法但语义不可能的日期（如 `'2026-13-01'`）
- **THEN** 按显式参数错误或显式源错误返回，MUST NOT 就近取整到某交易日

### Requirement: 缓存与预算归属

`resolveTradeDate` 的取数 SHALL 复用 `data-tool-contract` 的**列表级缓存**（键 = `source + requestedDate`，payload 内含 `businessDate`）与频控护栏：命中缓存时零网络、不计预算；未命中时按**列表级请求数**消耗预算与最小间隔。本工具 MUST NOT 另建缓存层。

#### Scenario: 当日重复调用零网络

- **WHEN** 同一 `requestedDate` 内第二次调用 `get_trade_date`（含两种合法写法各一次）
- **THEN** 直接返回缓存结果，出站请求计数为 0、当日预算用量不变

#### Scenario: 复用列表级缓存不重复取数

- **WHEN** 当日已由 T1 完成一次 S7 列表级请求（键 = `source + requestedDate`），随后调用 `get_trade_date`
- **THEN** 命中同一列表级缓存条目（键由入参构造、MUST NOT 用响应内的 `businessDate` 做键），不新增出站请求

#### Scenario: 源业务日不等于请求日时仍零网络

- **WHEN** 首次取数返回的 `businessDate` 与 `requestedDate` 不同，随后以同一 `date` 再次调用
- **THEN** 命中同一 `source + requestedDate` 条目 → 出站请求计数为 0（键可构造性要求见 `data-tool-contract` 缓存 Requirement）
