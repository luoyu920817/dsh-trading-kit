## ADDED Requirements

### Requirement: 工具签名与返回结构

插件 SHALL 注册工具 `get_limit_reason`，并在 service 出口暴露等价方法。入参 SHALL 为 `code`（6 位代码）与可选 `date`（canonical `YYYY-MM-DD`，**兼容** `YYYYMMDD` 输入并经 `src/data/date.ts` 归一；缺省表示最近交易日口径）；工具入参 schema MUST NOT 含 `refresh` 或任何刷新开关（本迭代无刷新入口，`iteration-1-contracts §9`）。返回 SHALL 含 `available`、`code`、`requestedDate`、`tradeDate`（数据源业务日期，`YYYY-MM-DD`）、`hitRecordDate`（S5 等备源命中的异动记录日，`YYYY-MM-DD`，不适用时 `null`，见「列表业务日与命中记录日分列」Requirement）、`cause`、`firstTime`、`lastTime`（源提供时）、`openCount`、`streakDesc`（源提供时）、`source`、`fetchedAt`、`notes[]`、`errors[]`，数值与来源规范遵循 `data-tool-contract`。`requestedDate` / `tradeDate` / `hitRecordDate` 一律 `YYYY-MM-DD`（`YYYYMMDD` 只出现在源请求参数与缓存目录段，`iteration-1-contracts §1`）。`tradeDate` SHALL **从响应体无条件取值**——源列表成功返回时即始终可得，即使该标的不在列表中（此时 `available=false` 表示「该标的无涨停记录」），`tradeDate` 仍为列表业务日期；该语义是 `review-page` 交易日归属（最近交易日）的派生来源（依赖 change 4 的 `TradeDateResolver` seam，该 seam MUST 调用 T0 `trade-date-tool` / `traderKit.data.resolveTradeDate`，见 `iteration-1-contracts §1`）。

#### Scenario: 当日调用成功

- **WHEN** 调用 `get_limit_reason('600000')`
- **THEN** 返回当日涨停原因、首封时间与开板次数；每字段带 `source` / `fetchedAt`；`tradeDate` 为数据源返回的业务日期（MUST NOT 用系统日期）

#### Scenario: 历史日调用

- **WHEN** 调用 `get_limit_reason('600000', '2026-09-24')` 且该源返回数据
- **THEN** 返回该日数据；`tradeDate` 与 `requestedDate` 一致时正常呈现（两者同为 canonical `YYYY-MM-DD`）

#### Scenario: 请求日与源业务日不一致

- **WHEN** `requestedDate !== rateLimitDate` 且源返回的业务日期与请求日不一致
- **THEN** 返回 `available=false` + `errors:[dateUnavailable]`（含请求日与实际业务日，两者均 `YYYY-MM-DD`），MUST NOT 用他日数据填充、MUST NOT 仅以 `notes` 标注替代（`iteration-1-contracts §1`）；**例外**：S5 命中且仅 `hitRecordDate` 与请求日不同时，属「命中记录日」差异，按「列表业务日与命中记录日分列」Requirement 只标注，不适用本条（最终可用态见 `主备源路由与兜底` 的聚合表）

#### Scenario: 标的无涨停记录时业务日期仍可得

- **WHEN** 源列表正常返回但该标的不在涨停/炸板列表中
- **THEN** `available=false`（该标的无涨停记录），且 `tradeDate` 仍为源列表的业务日期（MUST NOT 因记录缺失而丢日期）

#### Scenario: 列表成功但为空

- **WHEN** 源列表成功返回但列表为空（当日尚未出数、源端偶发空）
- **THEN** `tradeDate` 仍从响应体取到（MUST NOT 为 `null`）；`available=false` 且 `errors` 说明原因（如「当日无涨跌停数据」）

#### Scenario: 非法参数

- **WHEN** 传入非 6 位代码，或 `date` 非 canonical `YYYY-MM-DD` 且非 8 位 `YYYYMMDD` 兼容写法（如 `'2026/09/24'`）
- **THEN** 返回显式参数错误，且不发出任何网络请求

### Requirement: 主备源路由与兜底

工具 SHALL 按**请求日 vs 限流日**的判据路由（`iteration-1-contracts §1`，本 change 不复述第二份口径）：

- `requestedDate === rateLimitDate` → S7 `surgeLimitList`；当日 **List 空或失败**时 SHALL 可回退 `surgeLimitHistory`（并 MUST 记录实际命中的 endpoint 与 `source`、在 `notes` 标注回退）；
- `requestedDate !== rateLimitDate` → S7 `surgeLimitHistory`（不含当天）；其空或失败 **MUST NOT** 回退 List（List 是当日全市场列表，会把别日数据当请求日数据），该 S7 leg 的失败只进 `notes`，**最终可用态由下条聚合规则决定**。

无论走哪条分支，S7 失败或返回空 SHALL 降级到 S5（`flow.10jqka.com.cn` 异动历史 + `vis.10jqka.com.cn` 涨停明细）；每次返回 SHALL 记录实际使用的源与源返回的业务日期。

**备源聚合优先级（最终 `available`/`errors` 判定表，`iteration-1-contracts §1`/`§12.8`）**——最终 `available` = 「任一源就本次 `requestedDate` 给出可用数据」：

| 条件（按序判定） | `available` | `source` | `errors` | `notes` |
| --- | --- | --- | --- | --- |
| S5 在该业务日**有命中记录**（`hitRecordDate` 可判为同一业务日） | `true` | `'S5'` | `[]`（S7 leg 的 `dateUnavailable`/`sourceUnavailable` MUST NOT 出现在最终 `errors`） | 记「History 为空，已由 S5 兜底」；`hitRecordDate !== requestedDate` 时另按「列表业务日与命中记录日分列」标注 |
| 两源均**无数据**（S7 空且 S5 无命中记录，无网络/解析失败） | `false` | 如实（如 `'S5'`） | `['dateUnavailable']` | 附请求日与已尝试的源 |
| 两源均**失败**（签名失效 / 网络错误 / 响应非法） | `false` | `null` | `['sourceUnavailable']` | 逐源错误摘要 |

「无数据」与「取数失败」MUST 用不同 `errors` 值区分；S5 命中时 MUST NOT 保留 S7 leg 的 `dateUnavailable`（否则 change 5 会把有效数据静默降级为 `missing(sourceUnavailable)`）。

#### Scenario: 请求日等于限流日走 List 端点

- **WHEN** `requestedDate === rateLimitDate`
- **THEN** 使用 `surgeLimitList`（MUST NOT 用不含当天的 `surgeLimitHistory` 取当日数据）

#### Scenario: 当日 List 空/失败可回退 History

- **WHEN** `requestedDate === rateLimitDate` 且 `surgeLimitList` 返回空或失败
- **THEN** 允许回退 `surgeLimitHistory`（History 不含当天，但源在当日尚未出数时可能已有一条收盘记录）；返回体 MUST 记录实际命中的 endpoint 与 `source`，并在 `notes` 标注回退；若 History 亦空 → `available=false` + 原因

#### Scenario: 历史日走 History，不回退 List

- **WHEN** `requestedDate !== rateLimitDate` 且 History 返回空
- **THEN** MUST NOT 回退尝试 List（List 无 `date` 参数，取到的是限流日当日列表）；备源 SHALL 继续（S5 按请求日取历史记录），最终可用态按「备源聚合优先级」判定

#### Scenario: 历史日 S7 空但 S5 命中 → 可用

- **WHEN** `requestedDate !== rateLimitDate`、S7 History 为空或失败，且 S5 在该业务日有命中记录
- **THEN** `available=true`、`source='S5'`、`errors=[]`，`notes` 记「History 为空，已由 S5 兜底」；MUST NOT 保留 `dateUnavailable`（用例名：`历史日 S5 命中不降级`）

#### Scenario: 历史日两源均无数据 → dateUnavailable

- **WHEN** `requestedDate !== rateLimitDate`、S7 History 为空且 S5 无该业务日命中记录（均未发生取数失败）
- **THEN** `available=false` + `errors:['dateUnavailable']`（附请求日与已尝试的源）

#### Scenario: 历史日两源均失败 → sourceUnavailable

- **WHEN** `requestedDate !== rateLimitDate`、S7 与 S5 均因签名失效 / 网络错误 / 响应非法而失败
- **THEN** `available=false` + `errors:['sourceUnavailable']`（逐源错误摘要），MUST NOT 用 `dateUnavailable` 冒充「取数失败」

#### Scenario: 路由中的业务日期一致

- **WHEN** 历史日请求成功
- **THEN** List 不参与该次取数，返回体 `tradeDate` 必须等于源返回的业务日期（用于与 `requestedDate` 比对；不一致 → `dateUnavailable`，但 S5 命中路径的日期差异按「列表业务日与命中记录日分列」处理，不重复触发本条，最终可用态见聚合表）

#### Scenario: S7 不可用降级 S5

- **WHEN** S7 返回空或签名失效
- **THEN** 在 `errors` 记录 S7 失败原因，改用 S5 取数，`source` 反映 S5

#### Scenario: 不含天数的历史端点在当日被拒

- **WHEN** `requestedDate === rateLimitDate` 而某实现路径**直接**用 `surgeLimitHistory` 取当日数据（未经 List 空/失败这一允许的回退路径）
- **THEN** 视为实现缺陷：首取端点 MUST 由请求日/限流日决定，MUST NOT 以「预判 List 会空」为由跳过 List；回退只允许发生在 List 实际返回空或失败之后，且 MUST 被记录

### Requirement: 首封时间口径红线

`firstTime` SHALL **只**来自 S7 的 `first_time`。S5 可得的时间量（`first_limit_time`，语义 = **最后封板时刻**）MUST NOT 进入 `firstTime`，只能进入 `lastTime`（并标 `source=S5`）；S6（对枢）`zt_time` 语义（最后封板时刻）MUST NOT 在任何情况下作为 `firstTime`；`lastTime` 与 `firstTime` MUST 为分列字段并各自标注来源。降级到 S5 时 `firstTime.value` SHALL 为 `null`（不猜、不用最后封板时间代替），并在 `notes` 说明「S5 无首封语义」。

#### Scenario: S7 成功

- **WHEN** S7 提供 `first_time`
- **THEN** `firstTime.source` 标识 S7 的 `first_time` 字段

#### Scenario: 降级 S5 只填 lastTime

- **WHEN** S7 不可用而 S5 返回封板时间（`first_limit_time`）
- **THEN** 该值进入 `lastTime` 且标 `source=S5`；`firstTime.value=null`（`source` 仍标注本次取数来源），`notes` 记录「S5 无首封语义」

#### Scenario: S5 时间 MUST NOT 出现在 firstTime

- **WHEN** 取数路径为 S5（S7 失败/为空）且 S5 返回了任何时间字段
- **THEN** 断言 `firstTime.value === null` 且返回体所有 `source=S5` 的时间值都不位于 `firstTime`（用例名：`S5 时间不得进入 firstTime`）

#### Scenario: 最后封板时刻不得冒充首封

- **WHEN** 数据源提供最后封板时刻（如 `zt_time` / `last_time` / `first_limit_time` 语义）
- **THEN** 该值只可进入 `lastTime`，MUST NOT 写入 `firstTime`

#### Scenario: 首封时间缺失

- **WHEN** 所有可用源均无首封时间
- **THEN** `firstTime.value=null`（不猜、不用最后封板时间代替）

### Requirement: 列表业务日与命中记录日分列

工具 SHALL 区分两个日期概念，MUST NOT 共用一个 `tradeDate` 名（`iteration-1-contracts §1`）：

- **列表业务日** = `tradeDate`：S7 列表响应体的业务日期，是归属与落盘的唯一依据；
- **命中异动记录日** = `hitRecordDate`：S5 异动记录自身携带的日期（源在无精确日期记录时会回退到「≤ 目标日期的最近一条」甚至任意记录），格式 `YYYY-MM-DD`。该值 SHALL 只在 `hitRecordDate` 字段（或 `notes`）中出现，MUST NOT 覆盖或充当 `tradeDate`；`hitRecordDate !== requestedDate` 时 SHALL 在 `notes` 显式标注。不适用（S7 路径、或备源未提供记录日期）时 `hitRecordDate=null`。

#### Scenario: S5 命中记录日期与请求日不同

- **WHEN** S5 返回的记录日期为 `hitRecordDate='2026-09-20'` 而 `requestedDate='2026-09-24'`
- **THEN** `tradeDate` 仍为列表/请求业务日口径的取值，`hitRecordDate='2026-09-20'` 独立呈现，`notes` 标注差异；MUST NOT 让 `hitRecordDate` 冒充 `tradeDate`

#### Scenario: 源无精确日期记录的降级

- **WHEN** S5 无精确日期记录而回退到最近一条历史记录
- **THEN** 返回体带 `hitRecordDate` 与 `notes` 说明「命中非请求日记录」；消费方据此可判不可信，MUST NOT 静默当作请求日数据

### Requirement: S5 备源移植口径

S5 备源实现 SHALL 遵守以下移植口径（偏离参考脚本处见 `docs/carryover.md` 的「脚本口径移植」台账行）：

- **不依赖本地 HTML**：MUST NOT 检查或读取 `D:/TDX_HOME/webs/company/同花顺涨跌停原因.html` 之类本机文件；该文件缺失 MUST NOT 污染降级判定。
- **市场映射表化**：`marketId`（参考脚本的 `17` 沪 / `33` 深）SHALL 落成显式映射表并写明**北交所行为**（本迭代按「显式不支持 + 标注待验证」处理，MUST NOT 静默按深市套用）。
- **时间语义**：S5 时间值只进 `lastTime`（见红线 Requirement）。

#### Scenario: 本地 HTML 缺失不影响降级

- **WHEN** 运行环境不存在通达信本地 HTML 文件且 S7 失败
- **THEN** S5 仍被正常尝试；错误列表 MUST NOT 出现「本地 HTML 不存在」类原因

#### Scenario: 北交所标的不静默按深市处理

- **WHEN** 传入北交所代码（如 `8`/`4` 开头）
- **THEN** 返回显式「市场映射待验证/不支持」标注，MUST NOT 用深市 `marketId` 静默请求后当作成功

#### Scenario: 市场映射为表驱动

- **WHEN** 审查 S5 客户端实现
- **THEN** 市场 id 来自显式映射表（可单点扩展），MUST NOT 在调用处内联魔法数字
