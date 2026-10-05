## ADDED Requirements

### Requirement: 工具签名与返回结构

插件 SHALL 注册工具 `get_concepts`，并在 service 出口暴露等价方法。入参 SHALL 为 `code`（6 位代码），可选 `date`（canonical `YYYY-MM-DD`，**兼容** `YYYYMMDD` 输入并归一；缺省 = 限流日）。**T2 无日期语义**：S8 是不带日期参数的实时快照接口（`plates_by_any_stock`），故 `date` **只用于缓存分桶与列表级缓存键**（键 = `concepts + requestedDate`），MUST NOT 被解释为「取该历史日的概念快照」，MUST NOT 因此产生 `dateUnavailable` 之类日期不可用语义（与 T1 历史路由无关）；请求 S8 时 MUST NOT 传日期参数。返回体内一切非空日期一律 `YYYY-MM-DD`，`YYYYMMDD` 仅出现在源请求参数与缓存目录段（`iteration-1-contracts §1`，转换 MUST 经 `src/data/date.ts`）。工具入参 schema MUST NOT 含 `refresh` 或任何刷新开关（本迭代无刷新入口，`iteration-1-contracts §9`）。返回 SHALL 含 `available`、`code`、`businessDate`（`YYYY-MM-DD` | `null`；S8 响应无日期字段时为 `null`）、`name`（best-effort 反查，未命中为 `null`）、`concepts[]`（每项含 `name`、`strength`、`strengthPct`、`reason`、`plateId`、`source`、`fetchedAt`）、`source`、`fetchedAt`、`notes[]`、`errors[]`。其中 `reason` 与 `plateId` 为 **best-effort** 字段（见「源字段白名单与 best-effort 降级」Requirement）。

`businessDate=null`（源无日期字段）时：SHALL 在 `notes` 标注「源无日期，按 `requestedDate` 缓存」；该 `null` MUST NOT 参与历史回溯（`iteration-1-contracts §12.5`）、MUST NOT 用于按业务日归档（缓存一律落 `requestedDate` 折算的 `<YYYYMMDD>` 桶）、MUST NOT 用请求日或限流日代填（`data-tool-contract` 缓存 Requirement 的同一例外）。

#### Scenario: 调用成功

- **WHEN** 调用 `get_concepts('600000')`
- **THEN** 返回该标的概念列表，每项带来源与抓取时间，列表可用

#### Scenario: 源返回空数据

- **WHEN** 源返回 `data` 为空或状态码非成功
- **THEN** `available=false` + 原因，MUST NOT 用空列表冒充成功

#### Scenario: 非法参数

- **WHEN** 传入非 6 位代码
- **THEN** 返回显式参数错误，且不发出任何网络请求

#### Scenario: `date` 只用于缓存分桶（不解释为历史快照）

- **WHEN** 传入 `date='2026-09-20'`（非限流日）调用 `get_concepts`
- **THEN** 仍向 S8 取**当日实时快照**（源请求 MUST NOT 带日期参数），`businessDate=null` 且 `notes` 记「源无日期，按 `requestedDate` 缓存」，缓存落 `agent/DB/temp/dsh-trader-kit/20260920/`；返回体 MUST NOT 声称这是「2026-09-20 的概念数据」，MUST NOT 产出 `dateUnavailable`

#### Scenario: `businessDate=null` 不参与历史回溯与业务日归档

- **WHEN** 消费方拿到 `businessDate=null` 的结果
- **THEN** MUST NOT 用它推进历史回溯或按业务日归档（`iteration-1-contracts §12.5`）；归属与落盘一律按 `requestedDate`（缺省 = 限流日）

### Requirement: 源字段白名单与 best-effort 降级

S8 请求的 `fields` SHALL 扩为 `core_avg_pcp,plate_name,reason,plate_id,top_n_stocks`（参考脚本原请求白名单不含 `reason` / `plate_id`，见 `docs/carryover.md` 台账偏离清单）。若该源对未列入白名单或未知字段不返回，则：

- `reason` 与 `plateId` SHALL 降级为 best-effort：值缺失时输出 `value=null` 且带 `source` 与 `fetchedAt`（遵循 `data-tool-contract` 字段缺失口径），MUST NOT 用空字符串或概念名顶替；
- 返回体 SHALL 在 `notes` 标注「`reason`/`plateId` 源端未返回（best-effort 降级）」，使消费方可判；
- `reason` 截断规则（200 字）只在值存在时适用。

#### Scenario: 源返回 reason 与 plateId

- **WHEN** S8 响应含 `reason` 与 `plate_id`
- **THEN** 每项概念输出 `reason`（截断 200 字）与 `plateId`，`source` 标识 S8

#### Scenario: 源不返回 reason 与 plateId

- **WHEN** 实测响应不含 `reason` / `plate_id`（字段被 `fields` 裁剪或源不支持）
- **THEN** 两者输出 `null` 且仍带 `source` / `fetchedAt`，`notes` 标注 best-effort 降级原因；`available` 仍按概念列表是否为空判定（不因这两字段缺失而整体不可用）

#### Scenario: reason 截断

- **WHEN** `reason` 超过 200 字
- **THEN** 输出截断到 200 字并在 `notes` 标注截断；用例断言 `value.length <= 200`

### Requirement: 强度分档与排序

概念 SHALL 按源字段 `core_avg_pcp` 降序排列；SHALL 输出 `strengthPct` 为百分数数值（源小数 `0.05` → `5`），并按下述分档给出 `strength`：`>=5` 强 / `>=2` 中 / `>0` 弱 / `<0` 跌 / `=0` 平。

#### Scenario: 强度换算

- **WHEN** 某概念 `core_avg_pcp = 0.062`
- **THEN** `strengthPct = 6.2` 且 `strength = "强"`

#### Scenario: 负强度分档

- **WHEN** 某概念 `core_avg_pcp = -0.01`
- **THEN** `strength = "跌"`

#### Scenario: 降序排列

- **WHEN** 返回多个概念
- **THEN** 列表按 `strengthPct` 降序（越热越前）

### Requirement: 名称反查与市场后缀

工具 SHALL 以 `stock_chi_name` 从响应 `top_n_stocks.items[]` 中反查本标的名称（best-effort）：命中则返回该名称，未命中 MUST 返回 `null`（MUST NOT 用概念名或其它标的名称顶替）。请求 SHALL 使用 S8 的后缀约定（沪 `.SS`、深 `.SZ`，注意与 TQ 的 `.SH` 不同）；未验证市场（如北交所）SHALL 在实现与返回中显式标注为待验证，MUST NOT 静默套用沪深规则。

#### Scenario: 命中名称

- **WHEN** `top_n_stocks.items[]` 中存在与本标的代码匹配的项
- **THEN** 返回其 `stock_chi_name` 作为 `name`

#### Scenario: 未命中名称

- **WHEN** 所有概念的热门股列表中均无本标的
- **THEN** `name=null`（消费方按名称降级链处理，不猜名称）

#### Scenario: 北交所标的

- **WHEN** 请求北交所代码
- **THEN** 返回中包含「后缀规则待验证」标注，且不静默按深市后缀请求后当作成功

### Requirement: 概念缓存

概念结果 SHALL 复用 `data-tool-contract` 的**两层缓存**：列表级（键 = **`concepts:<code> + requestedDate`**——**owner 实测修订 2026-10-05**：S8 `plates_by_any_stock` 响应**按 symbol 裁剪**（不同代码返回不同板块集，未收录代码返回空 `data`），原「`concepts + requestedDate` 按日共享、跨标的派生」的假设证伪（603919 命中 000002 缓存导致标签串股）；键由入参构造且**含 code**；payload 内含 `businessDate`（源无日期字段时允许 `null`）与整份 S8 概念响应——**空响应同样入缓存**（负缓存，未收录标的当日内零重复出站））与 code 派生视图级（键 = `requestedDate + code`）。MUST NOT 用 `businessDate` 做键（响应到达前不可知）。同交易日重复调用零网络；缓存落 `agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/`（按 `requestedDate` 折算，MUST NOT 用 `businessDate=null` 或源返回日期做目录段），写入遵循 `data-tool-contract` 的原子写、幂等与 `cacheSchema` 不匹配即视为未命中的要求。频控预算按列表级请求数计。

#### Scenario: 当日缓存命中

- **WHEN** 当日已缓存某标的且再次调用
- **THEN** 零网络请求返回与首次一致的结果

#### Scenario: 跨标的不串股（键含 code，owner 实测修订 2026-10-05）

- **WHEN** 同一请求日先查 `000002`（S8 返回其板块集）再查 `603919`（S8 返回空）
- **THEN** 两次均为独立列表级请求（列表级请求数 2）；603919 的标签为**显式不可用**（空数据）而非 000002 的板块；603919 的名称反查未命中 → 由行情名称源兜底（review-page 层②）

#### Scenario: 同一列表派生多标的只取一次（修订：同标的同参数）

- **WHEN** 同一交易日对**同一标的**以相同入参重复调用（S8 响应按 symbol 裁剪——响应域 = 该标的）
- **THEN** 列表级请求数为 1、预算用量 +1；后续调用命中列表级/派生视图缓存，零网络（**原「5 个不同标的 → 1 次请求」的语义作废**——跨标的是不同列表）

#### Scenario: 跨日不命中

- **WHEN** 进入新的交易日后再调用同一标的
- **THEN** 不使用前一日缓存，重新取数并写入当日缓存桶

#### Scenario: 缓存 schema 升级

- **WHEN** 概念模块 `cacheSchema` 版本升级后读取到旧版本缓存文件
- **THEN** 视为未命中 → 重新取数 → 原位覆盖写为新版本，MUST NOT 返回旧 schema 数据

#### Scenario: 无日期源的键与目录由入参构造

- **WHEN** S8 响应不含日期字段（`businessDate=null`）且以 `requestedDate='2026-09-20'` 取数
- **THEN** 列表级键为 `concepts + '2026-09-20'`、目录段为 `20260920`；随后以**同一入参**再次调用命中该条目、出站计数为 0；MUST NOT 因 `businessDate=null` 改键、改目录或用天级目录猜日期
