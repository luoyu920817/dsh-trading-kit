## MODIFIED Requirements

### Requirement: 名称三级兜底的分层归属

B1 SHALL 显示标的代码与名称（三层兜底）；**页面不设「复盘卡片」一级标题与「标签」前缀文案**（owner 2026-10-05 指示移除——chips 直接排列）；**页面不展示名称来源标注**（来源保留在 API 响应 `nameSource`；owner 2026-10-05 指示简化显示）；**页面内不提供「在 TDX 中打开标的」跳转链接**（页面本身运行于 TDX 内——owner 2026-10-05 指示移除；spike 决策①的 treeid 通道保留备用），且**层号 = 兜底优先级、每层接口归属唯一**（`iteration-1-contracts §12.4`）：① 该标的历史卡片文档 frontmatter 的 `name`（零网络，归 `/api/local`）；② 数据工具名称反查（best-effort，归 `/api/enrich`，入参含 `code`）：**层②内部按序三级**——先 T2/S8 反查（`nameSource: 'T2-S8'`）→ 再行情名称源探针（同花顺 realhead，`nameSource: 'quote-ths'`）→ **再 TQ-Local 兜底（`get_stock_info` 只读，`nameSource: 'tq-local'`；owner 裁决 2026-10-06：通达信内置代码——`999999` 上证指数、`880003` 平均股价、`880008` 全A等权、`880823` 微盘股、`880863` 昨日涨停、`880005` 涨跌家数等——在公开源中不存在，必须由本机 TQ-Local 兜底，见 `tq-local-lookup` 能力）**；③ 仅显示代码（归 `/api/local`）。

- `/api/local` MUST NOT 执行网络反查，其名称取值域只有 ① 与 ③，并 SHALL 返回 `nameSource: 'frontmatter-history' | 'code-only'`。
- `/api/enrich` SHALL 返回层②的 `name` 与实际来源 `nameSource: 'T2-S8' | 'quote-ths' | 'tq-local'`（层②内部三级按序命中即停：T2/S8 反查 → 行情快照 `name` 兜底（复用同一次 S9 出站）→ TQ-Local 只读兜底）；页面在本地段为 `code-only` 时用层②**补位替换**并更新来源标注；本地段已命中层①时 MUST NOT 被网络段覆盖，且此时 MUST NOT 调用 TQ-Local（零请求）。
- `/api/enrich` SHALL 附带**可选段** `basics`（来源 = `tq-local-lookup` 出口；字段 `kind`/`listedAt`/`region`/`industry`/`floatSharesWan`/`totalSharesWan` 的语义与缺失口径沿该能力），仅在层②命中 `tq-local` 时出现；MUST NOT 因该段缺失或不可用影响其余字段。页面 SHALL 在四格对应字段不可得时用 `basics` 的股本两项补位（换算口径同四格：按「亿股/万股」），其余字段 v1 不要求展示。
- 全部未命中 SHALL 显示代码并明示「名称未获取」，MUST NOT 显示空白或猜测名称。名称结果 SHALL 带来源（`source`）与 `confidence`，以便 D-TQ 裁决为选项 B 时替换 seam 实现而不改调用方（**2026-10-06 已裁决：选项 B 局部放开，落地即本段层②第三级**）。

#### Scenario: 层①命中（本地历史 frontmatter）

- **WHEN** 该标的历史卡片文档存在且 frontmatter 有 `name`
- **THEN** 本地段即返回该名称（零网络）且 `nameSource='frontmatter-history'`；网络段返回后 MUST NOT 覆盖该名称，且对 `127.0.0.1:17709` 零请求

#### Scenario: 本地只有代码时由网络层补位

- **WHEN** 本地段返回 `nameSource='code-only'`，随后 `/api/enrich` 返回层②名称
- **THEN** B1 用层②名称替换代码显示并标注来源；网络段不可用时保持代码 + 「名称未获取」

#### Scenario: 通达信内置代码由 TQ-Local 兜底（新）

- **WHEN** 打开 `880823`（层①无历史、T2/S8 与行情名称源均未命中、TdxW 在跑）
- **THEN** `/api/enrich` 返回 `name='微盘股'`（`nameSource='tq-local'`）与 `basics`（如 `kind='0'`）；页面以名称替换代码显示且不展示来源标注

#### Scenario: 全部未命中

- **WHEN** 三层均未取得名称（含 TQ-Local 不可用/开关关闭）
- **THEN** 显示代码 + 明示「名称未获取」，页面其余部分照常可用

#### Scenario: 本地段不承担网络反查

- **WHEN** 审查 `/api/local` 的调用链
- **THEN** 不存在名称网络反查（不 import `src/data/**` 取数实现、零 `fetch`，结构断言见 `iteration-1-contracts §7`）；名称网络反查与 TQ-Local 调用只出现在 `/api/enrich`
