## ADDED Requirements

### Requirement: 行情快照源（同花顺 realhead，S9）

插件 SHALL 提供行情快照能力（同花顺 realhead JSONP，guard 源标识 `S9`），双出口同一实现：service 出口 `traderKit.data.getQuoteSnapshot(code)`（数据模块 `src/data/quote-name.ts` 的 `fetchQuoteSnapshot`）。口径：

- 单标的轻量 GET（`https://d.10jqka.com.cn/v6/realhead/hs_<code>/last.js`），经 guard 计数（batch=1，不触发全市场级拒绝），出站走 `src/data/http.ts` 唯一传输实现；
- 解析字段（owner 2026-10-05 指示「迁移四个基础数据」，与参考页 `同花顺涨跌停原因.html` 的 fetchThsQuote 同源口径）：`name`、现价（field `10`）、涨跌幅 %（`199112`）、流通市值元（`3475914`）、总市值元（`3541450`）、流通股本股（`407`）；数值字段非有限数值 → `null`（MUST NOT 用 `0` 或空串冒充）；
- `available` = 名称/现价/流通市值任一可得；全缺 → `available=false` + `errors=['notFound']`；护栏拒绝 → `errors=['rateLimited']`；传输失败 → `errors=['quoteProbe: <原因>']`；
- 覆盖范围 = 沪深（`hs_` 前缀）；北交所未验证（`hs_` 不覆盖）→ 显式不可得，MUST NOT 静默套用其它市场规则；
- 实时语义：快照 MUST NOT 进入日级缓存（每次调用一次出站；节流由 guard 统一保证）。

#### Scenario: 四项字段逐字段解析

- **WHEN** realhead 返回含 `10` / `199112` / `3475914` / `3541450` / `407` 的 items
- **THEN** 快照 `available=true` 且现价/涨跌幅/流通市值/总市值/流通股本逐字段对应；个别字段缺失 → 该字段 `null`，不影响其它字段

#### Scenario: 护栏拒绝与传输失败显式分档

- **WHEN** guard 拒绝（预算/间隔）或 realhead 传输失败
- **THEN** `available=false` 且 `errors` 分别为 `['rateLimited']` / `['quoteProbe: …']`；MUST NOT 返回 `0` 或空串冒充成功

#### Scenario: 名称层②复用同一次出站

- **WHEN** 名称层②止于行情源（T2/S8 反查未命中）
- **THEN** 名称取自同一份快照的 `name`（单次 enrich 至多 1 次 S9 出站），`nameSource='quote-ths'`；快照不可得时名称层②显式未命中
