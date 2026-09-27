# A 股标准行情与补充数据契约（a-share-data-contract）

> **搬运副本**（2026-09-22）：源 `dsh-trading/docs/design/a-share-data-contract.md`
> @ commit `70ca2d8`（v0.4.1）。本仓自此以此副本为工作契约，每月对上游 re-diff
> （docs/carryover.md 纪律）；上游修订经裁决后跟进。类型面见
> `src/api-contracts/index.ts`。

> 2026-09-20 立规（superpowers/plans/2026-09-20-a-share-data-plane.md 实施产物）。
> 动机：TDX 为主源的 A 股行情与 vault 侧研究数据（龙虎榜/涨停原因/题材概念）此前
> 只有临时脚本形态——字段单位、时区、失败语义各说各话。本文件固定消费方
> （Agent 工具、GUI 桥、图表）可见的**稳定契约**；上游临时格式不得穿透到 UI 或
> 工作流。

## 1. 标准行情口径

以下口径对 `@dshtrading/api` 的 `Kline` / `QuantBar` / `QuantBarSeries` 及其所有
实现方生效：

| 口径 | 约定 |
| --- | --- |
| symbol | 市场规范词汇（docs/symbol-vocabulary.md）：`600519.SH` / `000001.SZ` / `430047.BJ`。入参宽容，输出一律规范形 |
| 时区 | K 线时间戳按 `Asia/Shanghai`（UTC+8）墙钟折算 epoch ms；日 K 的 openTime = 当日 00:00 UTC+8 |
| 序列方向 | **时间升序**（旧→新），与 K 线序列同向 |
| 成交量单位 | 股（base 单位） |
| 成交额单位 | **元**（人民币）。TDX `Amount` 万元口径由连接器 ×10000 换算后透出 |
| 百分比 | 数值百分比（`5.32` 表示 5.32%），非小数 |
| 复权 | `AdjustedType = 'none' | 'front' | 'back'`，随 `QuantBarSeries.adjusted` 显式透出（连接器配置决定），消费方不得自行猜测 |
| 数据日期 | `QuantBarSeries.dataDate`（YYYY-MM-DD）取序列最后一根的数据源日期；**不回退系统日期** |
| 未收盘 K 线 | `QuantBarSeries.unclosed = true` 表示最后一根正在形成（盘中）；收盘后自然消失 |
| 缺失值 | **不填零**。字段缺省 = 数据源未提供；`0` 与「无数据」语义严格区分 |
| 半截 K 线 | 缺任一 OHLCV 字段的行整条丢弃（不用 0 冒充） |

### 1.1 QuantBar 扩展面

`MarketDataService.getQuantBars?(symbol, interval, limit?): Promise<QuantBarSeries>`
是**可选方法**：未实现的连接器（绝大多数）缺席，消费方回退 `getKlines`。
`QuantBar` 必填字段与 `Kline` 完全同语义，扩展字段（`amount` / `turnoverRate` /
`sourceTimestamp`）全部可缺省。选择独立类型而非 `Kline` 交叉扩展：`getKlines`
签名与其余 connector 消费方零扰动。

### 1.2 TDX 上限红线

`getKlines` / `getQuantBars` 单次上限 **1000 根**（`rest.ts` clamp），**无日期分页
能力**——不得把该接口宣传为完整回测历史接口。长历史需求应走专用的日期窗口方法
（本次不做，见 §4 缺口）。

## 2. 补充研究数据契约

能力枚举（`ResearchCapability`）与取数层（`@dshtrading/kit-cn/research-data`）：

| capability | 内容 | 数据源 | 实现形态 |
| --- | --- | --- | --- |
| `lhb.daily` | 龙虎榜全量（普通榜/净买榜/机构榜/游资图谱）+ 个股上榜记录 | TDX 网页 TQLEX 接口（`page.tdx.com.cn:7615`，协议见 vault tdx-lhb-endpoints.md） | 纯 TS `postTqlex`（vault Python 脚本的同源协议重写） |
| `sentiment.limitReason` | 涨停/异动原因、题材关键词、连板数、首封时间 | 同花顺异动分析接口（flow.10jqka.com.cn + vis.10jqka.com.cn） | 纯 TS fetch |
| `stock.concepts` | 个股题材概念、板块热度（实时快照） | 选股宝 flash-api | 纯 TS fetch |
| `auction.scan` | 集合竞价快照与强弱 | 同花顺数据赋能（需 API Key） | **登记复用** sentiment.ts 既有实现，不重写 |

与存量链路的关系（拍板 2026-09-20）：**补空白、不动存量**——同花顺没有的三个
能力（龙虎榜/涨停原因/题材概念）走新取数层；竞价保留现有 `cn_get_auction_strength`
实现，只在能力枚举里登记。

### 2.1 统一信封

每个能力返回 `ResearchEnvelope<TData>`：

```ts
{
  capability, symbol?, source, dataDate?, retrievedAt,
  status: 'ok' | 'empty' | 'source-unavailable' | 'parse-error',
  data?, errors: string[]
}
```

失败分类语义（红线）：

- `ok` — 有数据；
- `empty` — **源正常但无记录**（当日未上榜 / 非竞价时间 / 无概念记录）——正常态，
  UI 显示空态提示，不报错；
- `source-unavailable` — 上游失败/网络/**凭证缺失**（竞价 Key 未配置归此类，
  绝不伪装成「无数据」）；
- `parse-error` — 响应不合预期 schema。

### 2.2 纪律

- 纯 TS 实现，不 spawn Python 进程、不依赖 vault 路径；vault 脚本继续服务
  Obsidian 归档工作流，两边同源不同职责。
- 上游原始行（TQLEX ColName×Content / 选股宝 plates）在取数层内映射成 wire
  类型，不透传原始响应。
- TQLEX 请求带完整 UA + Referer——**偏离** docs/replication.md「最小 UA」边界的
  已声明例外：Referer 属于该网页接口的上游协议契约（vault 实测必需形态），
  不是浏览器伪装。

## 3. 消费面

| 消费方 | 路径 | 说明 |
| --- | --- | --- |
| Agent 工具 | `cn_get_klines`（QuantBarSeries JSON）、`cn_get_lhb_daily`、`cn_get_limit_reason`、`cn_get_stock_concepts` | 与 GUI 桥共用同一标准化取数层，不得各自重算单位/时区 |
| GUI 桥 | `/klines`（加 `dataDate`/`unclosed`，bar 携带 `amount`）、`/fundamentals`（cn 包加 `limitReason`/`concepts`/`dragonTiger`） | 向后兼容：老客户端忽略新字段 |
| GUI 详情页 | FundamentalsStage「特色研究数据」页签 | 每块显示数据日期、来源与空态/不可用状态 |

## 4. 已知缺口（记录在案，本次不做）

- **换手率**（`turnoverRate`）：TDX 快照不带流通股本口径，首版不透出，字段留空
  （不填零）；待补充流通股本数据源后实现。
- **长历史/回测数据面**：`getQuantBars` 沿用 1000 根上限，无日期窗口分页。
- **`auction.scan` 凭证面**：沿用同花顺 API Key（设置中心 `dshtrading.credentials.hithink.apiKey`
  或环境变量 `HITHINK_FINANCE_API_KEY`）；Key 缺失时 UI 显示「数据源不可用」。
- **数据日期锚定**：龙虎榜 TDX 网页接口通常盘后 17:00 后更新当日数据；盘中查询
  返回的是上一交易日榜单（以接口 `rq` 为准，非系统日期）。
