## ADDED Requirements

> owner 追授（2026-10-06，「选择的是科创50 这个情况需要也适配」）：复盘页指数/锚点态需要真实行情。
> 实测（2026-10-06）：S9 realhead **不覆盖沪市指数**——`hs_000688` 返回同码深市股票国城矿业（错配风险，
> 股本 11.85 亿股可证）、`hs_999999` / `hs_880823` 空响应；腾讯行情（`qt.gtimg.cn`，参考页备源同源）
> 覆盖中证指数（`sh000688`=科创50）与上证指数（`sh000001`），故引入 S10 为**指数专用源**。

### Requirement: 指数行情源（腾讯行情，S10）

插件 SHALL 提供指数行情能力（腾讯行情 GET，guard 源标识 `S10`），service 出口 `traderKit.data.getIndexQuote(code)`（数据模块 `src/data/index-quote.ts` 的 `fetchIndexQuote`）。口径：

- 单标的轻量 GET（`https://qt.gtimg.cn/q=sh<code>`），出站走 `src/data/http.ts` 唯一传输实现，经 guard 计数（batch=1）；
- 响应为 GBK 编码 `v_sh<code>="~"` 分隔字段串：解析 `name`（字段 1）、现价（字段 3）、涨跌幅 %（字段 32）；解码用 `TextDecoder('gbk')`（失败回退 utf-8，沿参考页 fetchTencentQuote 策略）；数值非有限 → `null`（MUST NOT 用 0 冒充）；
- **代码语义**（页面仅在「显式沪市指数态」调用，见 review-page 传参需求）：`999999`（TDX 上证指数显示码）SHALL 别名映射为 `000001` 后出站；`88xxxx`（通达信自制指标，无任何外部行情源）SHALL **显式不可得且零出站**（`errors=['noExternalSource']`）；其余 6 位代码按沪市出站；
- 空响应 / 字段缺失 → `available=false` + `errors=['notFound']`；护栏拒绝 → `['rateLimited']`；传输失败 → `['indexQuote: <原因>']`；
- 实时语义：不进缓存（每次调用一次出站；节流由 guard 统一保证）。

#### Scenario: 科创50 指数解析

- **WHEN** 以 `000688` 调用且腾讯返回 `v_sh000688="1~科创50~000688~1530.01~…~-39.33~-2.51~…"`
- **THEN** `available=true`、`name='科创50'`、`price=1530.01`、`pct=-2.51`（MUST NOT 返回同码深市股票的数据）

#### Scenario: 上证指数显示码别名

- **WHEN** 以 `999999` 调用（TDX 对上证指数的显示码）
- **THEN** 别名映射为 `000001` 出站，返回 `name='上证指数'` 的行情

#### Scenario: 通达信自制指标显式不可得

- **WHEN** 以 `880823` 调用（自制指标，外部无源）
- **THEN** `available=false` + `errors=['noExternalSource']`，**零出站**（不出站到腾讯）

#### Scenario: 空响应与护栏拒绝

- **WHEN** 腾讯返回空 payload，或 guard 预算/间隔拒绝
- **THEN** `available=false` 且 `errors` 分别为 `['notFound']` / `['rateLimited']`；MUST NOT 返回 0 冒充
