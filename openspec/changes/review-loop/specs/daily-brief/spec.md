## ADDED Requirements

> owner 裁决（2026-10-06）：**另出当日盘面 md**，四段（指数 / 情绪 / 赚钱效应 / 题材）；**重跑覆盖重写**；
> v1 **只用现有数据源**（不新增 TDX 本地文件读取器、不新增出站源）。本 capability 只定义**产物与写通道**；
> 工作流内的收尾步归 `daily-summary` cap（见其 ADDED `W6 盘面整理收尾`）。跨 change 引用指向具名接口：
> `resolveArea`（change 2 映射表）、`formatZonedIso`（change 4 `src/review/format.ts`）、
> `scanDailyCardTargets`（change 4）、`review_stock_profiles`（本 change `stock-profile`）。

### Requirement: 产物路径与命名

当日盘面 md SHALL 落 `<数据根>/DB/review/<YYYYMM>/<YYYYMMDD>-summary.md`——**一个交易日一份**；区域 SHALL 登记进 change 2 `src/paths/mapping.ts` 的区域表（新增区域 key `brief`：`dir: 'DB/review/<YYYYMM>'`，`template: '<date>-summary.md'`，`params: ['date']`，`status: 'active'`），路径 SHALL 一律经 `resolveArea` 解析，MUST NOT 自行拼接。`<YYYYMM>`/`<YYYYMMDD>` 折算 MUST 经 change 2 `src/data/date.ts`（`§1` 允许的目录/文件名模板参数例外）。该文件 MUST NOT 与卡片文档（`<code>_<name>_<date>.md`）互相覆盖；MUST NOT 影响 `scanDailyCardTargets` 的卡片扫描口径（其文件名正则按代码匹配，`<date>-summary.md` 不构成卡片文档）。

#### Scenario: 落点正确

- **WHEN** 为 `2026-09-30` 产出盘面 md
- **THEN** 文件路径为 `<数据根>/DB/review/202609/20260930-summary.md`（经 `resolveArea('brief', { date })`），同交易日重复运行始终同一路径

#### Scenario: 不干扰卡片扫描

- **WHEN** 某日同时存在卡片文档与 `<date>-summary.md`
- **THEN** 当日 `targets`（`scanDailyCardTargets`）逐项与无盘面 md 时一致；盘面 md 不计入任何 `cardCount`

### Requirement: 产物结构

盘面 md SHALL 为 UTF-8、LF 换行，结构固定：

1. **frontmatter**（值一律双引号包裹，沿 change 4 最小修补纪律）：`tradeDate`（canonical）、`generatedAt`（`+08:00`，经 `formatZonedIso`）、`kind: daily-brief`、`anchors`（本次参与指数段的锚点档案代码数组 = `锚点: true` 且含 `代码` 者，可为空数组）、`missing`（逐项 `{field, reason}` 的 ASCII 化简写，见下）、`warnings`；
2. **标题**：`# 盘面整理 · <tradeDate>`；
3. **固定行**：`数据完整性：完整｜部分（缺 <字段>）` 与 `研究辅助、不构成投资建议`（各占独立行，位置固定在标题与四段之间）；
4. **四段**（顺序固定，标题字面固定）：`## 一、指数` / `## 二、情绪` / `## 三、赚钱效应` / `## 四、题材`；
5. 段内正文：**事实逐条带来源**（行内 `（来源：<source>@<date>）` 或等价标注）；取不到的项 SHALL 显式标注「数据不可得」并进 `missing`，MUST NOT 用 `0` / `--` / 空白冒充缺失，MUST NOT 编造。

四段各自的**内容下限**（v1）：指数段 SHALL 逐一列出锚点档案（`DB/stock/` 内 `锚点: true` 且含 `代码`）对应标的（名称(代码) + 涨跌幅，可得时含收盘/成交额，逐项带来源）；情绪段、赚钱效应段、题材段 SHALL 各给出至少一条带出处的当日结论，无卡片或数据不足时 SHALL 显式写「卡片未覆盖」/「数据不可得」（MUST NOT 留空段、MUST NOT 以泛泛套话填充）。

#### Scenario: 四段齐备且标注齐全

- **WHEN** 审查任一份产出
- **THEN** 五段结构（标题+固定行+四段 H2）齐备、顺序与字面一致；四段均非空；段内每条数值均有来源标注；`missing` 中的每一项在对应段内均有「数据不可得」类显式标注

#### Scenario: 缺数据不冒充

- **WHEN** 某锚点标的当日表现不可得（TQ skill 不可用）
- **THEN** 指数段该行标「数据不可得（原因：sourceUnavailable）」，并在 frontmatter `missing` 登记该项；MUST NOT 写 `0` / `--` / 省略该行 / 编造数值

#### Scenario: 无卡片日不产盘面

- **WHEN** 当日 `targets=[]`（无任何用户卡片）
- **THEN** 工作流按既有「零打扰」口径结束，**不产出**盘面 md（沿用 `daily-summary` 的「无卡片时零打扰」，不在本 v1 内变更）；若盘面 md 已存在（历史产出）则 MUST NOT 被删除或改写

### Requirement: 写通道（唯一生产者与覆盖语义）

盘面 md 的写 SHALL 由工具 `review_write_brief`（service key `traderKit.review.writeBrief`，工具与 service 同一实现）承担，它是该文件的**唯一生产者**（agent MUST NOT 直接编辑该文件）。入参：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `tradeDate` | string | canonical `YYYY-MM-DD`，必填 |
| `sections` | object | `{ index, sentiment, moneyEffect, theme }` 四段正文（string，各段 MUST 非空，含各自的来源/缺失标注） |
| `anchors` | string[]? | 本次参与指数段的锚点档案代码（`锚点: true` 且含 `代码`；缺省空数组） |
| `missing` | array? | `[{field, reason}]`（`reason` 枚举沿 `daily-summary`：`sourceUnavailable` / `dateMismatch` / `noRecord` / `fieldAbsent`） |
| `warnings` | string[]? | 告警出口原样落入产物（`§12.7`） |
| `generatedAt` | string? | 缺省 = 写入时刻（经 `formatZonedIso`） |

行为约束（MUST）：**同 `tradeDate` 覆盖重写**（owner 2026-10-06 裁决；重复运行结果确定，除 `generatedAt` 外字节稳定）；**原子写**（同目录临时文件 + `rename` 覆盖 + 失败清理，中断不留半截文件）；写入互斥沿进程内互斥表（键 = 目标绝对路径），MUST NOT 复用卡片文档的写锁实现之外的第三份锁逻辑；**MUST NOT 触碰**卡片文档与 AI 附注（含 `^card-` / `^ainote-` 分节）；schema MUST NOT 含 `force` / `overwrite` / `refresh`（幂等即覆盖，无第二套重算语义）。返回 `{ path, tradeDate, bytes, generatedAt, replaced, warnings[] }`（`replaced` = 本次是否覆盖既有文件）。本 change MUST NOT 扩展运行摘要（`daily-summary-run.json`）的 schema——盘面 md 的状态由 `/api/day` 的存在性体现（见 `review-panel`）。

#### Scenario: 覆盖重写

- **WHEN** 同一交易日第二次调用 `review_write_brief`
- **THEN** 原文件被整体覆盖（内容 = 第二次入参渲染结果，`replaced=true`），目录内不出现 `-v2` / `.bak` 等第二份产物；卡片文档与附注文件字节不变

#### Scenario: 原子性与失败清理

- **WHEN** 写入过程在 `rename` 前失败（模拟）
- **THEN** 目标路径不存在半截文件，原文件（若存在）保持上次内容完整可用；工具显式报错并附原因

#### Scenario: 结构校验失败显式报错

- **WHEN** `sections` 缺段或某段为空串、`tradeDate` 非法
- **THEN** 工具显式失败（点名字段），不写任何文件

#### Scenario: 不写第二份

- **WHEN** 审查仓库与工具 schema
- **THEN** 除 `review_write_brief` 外不存在第二处写 `<date>-summary.md` 的实现；工具 schema 无 `force`/`overwrite`

### Requirement: 合规与写作约束

盘面 md SHALL 遵守与 AI 附注**同一份**负向词表与正向骨架（`daily-summary` cap 的「合规与写作约束」：`必须买`、`建议买入`、`目标价`、`必涨`、`可重仓`、`确定性加仓`、`满仓`、`稳赚`、`保证收益` 及其变体 MUST 零命中）；MUST 含固定定位声明行「研究辅助、不构成投资建议」；MUST NOT 出现交易指令、仓位建议或对未来的确定性承诺；段落结论 MUST 可回溯到卡片/附注/具名数据源，MUST NOT 复述用户主观判断为 agent 结论。

#### Scenario: 词表零命中

- **WHEN** 对任一份产出跑关键词扫描
- **THEN** 负向词表零命中，且「研究辅助、不构成投资建议」行存在

#### Scenario: 结论可回溯

- **WHEN** 审查情绪段与题材段的每一条结论
- **THEN** 每条均可回溯到当日卡片锚点、附注或具名数据源（行内出处标注），否则以「卡片未覆盖」显式占位

### Requirement: 独立性（与附注/摘要解耦）

盘面 md 的产出 SHALL 位于附注写入与运行摘要提交**之后**，且其成败**独立**：盘面 md 写失败 MUST NOT 改变既有附注的 `created` / `skipped` 结果、MUST NOT 使运行摘要缺失或改名、MUST NOT 触发附注重算；失败 SHALL 在会话返回中显式可见（工具错误 + `warnings`）。反向亦然：附注阶段的单标的失败 MUST NOT 阻止盘面 md 汇总其余标的。

#### Scenario: 盘面失败不影响附注

- **WHEN** 附注全部成功、`review_write_brief` 失败（如磁盘只读）
- **THEN** 附注与运行摘要保持成功状态；会话显式报出盘面 md 失败与原因；`/api/day` 的 `brief.exists=false`

#### Scenario: 单标的失败不阻断汇总

- **WHEN** 当日某标的附注 `failed`、其余成功
- **THEN** 盘面 md 照常产出，并在对应段落标注该标的「附注未生成（原因：…）」而非静默省略

### Requirement: 下游读取口径

本 change 内，`/api/day`（见 `review-panel`）SHALL 只暴露盘面 md 的**存在性元信息**（`{exists, path, generatedAt}`），MUST NOT 解析正文（详情页渲染归后续 change）。盘面 md MUST NOT 进入卡片扫描与附注解析口径（不改 `scanDailyCardTargets`、不改 `^ainote-` 排除规则）。

#### Scenario: 只读元信息

- **WHEN** 面板读取当日状态
- **THEN** 仅得到 `exists` / `path` / `generatedAt`；正文渲染与分 tab 展示不在本 change 内
