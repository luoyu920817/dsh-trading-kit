---
name: review-daily-summary
description: 盘后每日汇总工作流：当日收盘后由用户在会话中触发（或用户要求"跑每日汇总/生成今日复盘附注"时触发）。遍历当日有卡片标的，逐标的取数并生成当日总结，以 AI 附注追加进该标的当日 md，收尾提交运行摘要。不用于盘中、不做全市场扫描。
version: 1.0.0
---

# 每日汇总（review-daily-summary）

把「现场卡片」变成「当日结论」：盘后遍历当日有卡标的 → 逐标的取数 → 生成当日总结 →
以 **AI 附注**追加进该标的当日 md（与用户主观记录严格分离、只追加、幂等）→
**收尾提交运行摘要**。本 skill 是研究辅助工作流，**不构成投资建议，不写交易指令**。

## W1 触发与定位（盘后、单标的、零打扰）

- **触发**：会话内手动触发（用户请求）；**盘后执行**。MUST NOT 依赖定时任务，MUST NOT 盘中运行。
- **取数约束**：**单标的**逐个取数（当日表现经 TQ skill，涨停原因经 T1 工具），
  **不做全市场扫描**（数据面频控护栏对批量/全市场级调用有硬约束）。
- **零打扰**：当日没有任何用户卡片的标的不产出任何附注、不报错、不提示补录。
- **固定定位声明**：每份附注 MUST 含一行 `研究辅助、不构成投资建议`。

## W2 扫描（工具 `review_daily_scan`）

1. 用户指定了交易日 → 以该日为目标交易日（canonical `YYYY-MM-DD`，兼容 `YYYYMMDD` 写法，工具内部归一）。
2. 未指定 → 调用 `review_daily_scan`（缺省交易日由其内部经 T0 `traderKit.data.resolveTradeDate` 解析）。
   **MUST NOT 自己读系统日期推断"今日"**，MUST NOT 用逐标的取数结果反推扫描日期。
3. 返回态三区分（MUST NOT 混淆，MUST NOT 使用"非交易日/长假"命名）：
   - **交易日不可得（盘前 / 源未出数）** → 显式要求用户指定交易日（`date` 入参）；
   - **归属待确认（业务日 X、限流日 Y）** → 显式要求用户确认交易日；
   - **该交易日无卡片** → 结束本工作流，说明"该交易日无卡片"，不产出任何写入。
4. 扫描返回标的清单：代码、名称、文档路径、**用户卡片数（不含附注）**、是否已有附注、`warnings[]`。
   `warnings[]` 非空时（多命中/幽灵锚点等）原样记入待提交的 warnings，MUST NOT 只看日志。

## W3 逐标的取数与数据包组装

对清单内每个标的独立取数（单标的失败只影响该标的）：

- **当日表现**：经 **TQ skill**（tq-local skill 的 `get_more_info` 当日字段；该 skill 由
  `tq-skill-installer` 安装）。TQ 路径由 agent 执行，**无出站计数 seam**，因此 MUST 在数据包
  与附注中标注 `fetchedAt`（数据获取时间）与 `cacheReused`（是否复用当日缓存，无 TQ 路径参与时写 `none`）。
- **涨停原因**：经 T1 工具 `get_limit_reason`，**必须显式传 `date=<目标交易日>`**
  （canonical `YYYY-MM-DD`）。MUST NOT 依赖"缺省为最近交易日"口径（历史/补写时会取到当日数据）。
- **缓存**：T1/T2 侧命中列表级缓存（键 = `source + requestedDate`）时零出站请求；
  同一交易日重复运行不产生重复出站。

**数据包 schema**（逐标的组装，进入 W4 前自检）：

| 字段 | 类型 / 取值 | 缺失与判定 |
| --- | --- | --- |
| `code` | `^\d{6}$` | 必填 |
| `name` | 名称文本；未获取时 `""` | 允许空串 |
| `tradeDate` | `YYYY-MM-DD`，目标交易日 | 必填；缺即该标的 `failed`（`tradeDateUnavailable`） |
| `generatedAt` | ISO8601 带时区，本地偏移 `+08:00` | 必填；工具按写入时刻经 `formatZonedIso` 产出 |
| `cards` | `[{anchor, writtenAt, body}]`，来自 `review_read_daily`（排除附注） | 空数组 = 该日无用户卡片 → 零打扰，跳过该标的 |
| `quote` | `{ available, fields, source, fetchedAt, cacheReused, skillVersion }` | `available=false` 表示源不可用：`fields` **保持对象形态**（各字段 `value=null` + `source=null` 并逐个进 `missing`）；**MUST NOT 把 `fields` 写成 `null`** |
| `quote.fields` | 每字段 `{value, source, fetchedAt}`；金额=万元、市值=亿元、比例=百分数数值 | 每数值字段 MUST 带来源；`value=null` 时逐条进 `missing`；**MUST NOT 用 0 冒充缺失** |
| `limitReason` | T1 输出裁剪（`available/tradeDate/cause/firstTime/lastTime/openCount/streakDesc/source/fetchedAt/notes/errors`，**`errors[]` 必须保留**） | 三档判定见下 |
| `missing` | `[{field, reason}]`；`reason` 枚举：`sourceUnavailable` / `dateMismatch` / `noRecord` / `fieldAbsent` | 空数组 = 数据完整；非空 = 正文标"部分" |
| `source` / `fetchedAt` | 逐字段携带 | **MUST NOT 出现无来源的数值** |
| `skillVersion` | TQ skill 的 `SKILL.md` frontmatter `version` | 不可解析时记 `unknown` 并进 `missing`（`fieldAbsent`），**MUST NOT 伪造版本** |
| `cacheReused` | 必填键 | 无 TQ 路径参与时写 `none` |

**limitReason 三档判定**（MUST 按 `errors` 分档）：
1. `errors` 含 `dateUnavailable` → `missing` 登记 `{limitReason, sourceUnavailable}`，正文写
   **「该日涨停原因数据不可得」**；**MUST NOT 写「无涨停记录」**（数据不可得 ≠ 无记录）。
2. `available=false` 且**不含** `dateUnavailable` → 正常「无涨停记录」，`missing` 登记
   `{limitReason, noRecord}`，**不计 failed**，附注方可写"无涨停记录"。
3. `limitReason.tradeDate !== 目标交易日` → `missing` 登记 `{limitReason, dateMismatch}`，
   **MUST NOT 把该数据写成本交易日事实**；附注标注降级事实。

## W4 生成总结（写作约束）

**正向写作骨架**（附注正文按此三段组织）：
1. **事实**：数据来源与日期（逐项带 `source`/`fetchedAt`，缺失项显式标注"缺失/不可得"，**MUST NOT 补猜、MUST NOT 推算、MUST NOT 用 0/--/空白冒充**）；
2. **当日表现**：逐项带来源引用；
3. **待跟踪**：列出待核实事项（**不构成建议**）。

**负向词表**（正文 MUST 零命中，含变体）：
`必须买`、`建议买入`、`目标价`、`必涨`、`可重仓`、`确定性加仓`、`满仓`、`稳赚`、`保证收益`。

其余约束：
- **MUST NOT 改写或复述用户主观判断**（用户卡片正文保持原样，附注不评价用户记录）；
- 缺失数据显式标注；数据完整性固定行：`数据完整性：完整` 或 `数据完整性：部分（缺 <字段>）`；
- 固定定位声明行：`研究辅助、不构成投资建议`。

## W5 提交（`review_append_ainote` → `review_daily_report`）

1. 逐标的调用 `review_append_ainote`（入参 `code`/`tradeDate`/`body`/`generatedAt`/`dataSources`）
   落盘 AI 附注。工具保证：**只追加、幂等、原子写**；同一交易日同一标的重复运行返回
   `skipped`（含既有锚点）。**MUST NOT 自己编辑 md 文件写附注**，MUST NOT 寻求
   `force`/`overwrite` 类重算入参。
   - `body` **MUST 以下列元信息行开头**（与工具自动写入的 `generatedAt`/`dataSources` 合计六键）：
     `- missing: <字段:原因，多项以「; 」分隔；无缺失写 none>`
     `- cacheReused: <字段=true|false，多项以「; 」分隔；无 TQ 路径写 none>`
   - `dataSources` 逐字段 `字段=源@YYYY-MM-DD`（如 `quote.close=tq-local@2026-09-24`）。
2. 遇 `skipped` 时向用户给出**重算指引**：如需重算，删除该附注分节
   （block `^ainote-<YYYYMMDD>-<代码>-<HHMM>`）后重跑；工具与 schema **不存在** force/overwrite 入参。
3. **收尾（SHALL，机械验收项）**：调用 `review_daily_report` 提交四态 `entries`——
   把本次运行每个标的的结果以 `{code, status: 'created'|'skipped'|'failed'|'deferred', reason?, path?, anchor?}`
   提交（`created`/`skipped` 尽量带 `path`/`anchor`；`failed`/`deferred` 的 `reason` 必填），
   并把取数阶段收集的 `missing`（`[{code, field, reason}]`）与全部 `warnings[]` 一并交回。
   该出口是运行摘要（`agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`）的
   **唯一生产者**，缺收尾调用 = 运行摘要缺失 = 本工作流未完成。

## 失败判定矩阵与重算指引

| 当日表现（TQ） | 涨停原因（T1） | 结果 | 附注与摘要 |
| --- | --- | --- | --- |
| 成功 | 成功 | `created` | 数据完整性：完整 |
| 成功 | `available=false` 且 `errors` 不含 `dateUnavailable` | `created` | 部分（缺 `limitReason`，原因 `noRecord`） |
| 成功 | `errors` 含 `dateUnavailable` | `created` | 部分（缺 `limitReason`，原因 `sourceUnavailable`）；正文「该日涨停原因数据不可得」，**MUST NOT 写「无涨停记录」** |
| 成功 | 失败 / `dateMismatch` | `created` | 部分（缺 `limitReason`，原因 `sourceUnavailable` / `dateMismatch`） |
| 失败 | 成功 | `created` | 部分（缺 `quote`，原因 `sourceUnavailable`） |
| 失败 | `available=false`（含 `dateUnavailable`）或失败 | `failed`（原因 `sourceUnavailable`，含两路原因） | **不写文档** |
| 该标的当日无用户卡片 | —— | `skipped`（零打扰） | 不写文档 |
| 预算不足未处理 | —— | `deferred`（原因 `budgetExhausted`，**不计 failed**） | 不写文档，摘要分列 |

**重算指引**：附注一旦写入，重跑只返回 `skipped`；如需重算，删除该附注分节
（block `^ainote-<YYYYMMDD>-<代码>-<HHMM>`）后重跑。`force` / `overwrite` 入参本迭代不存在。

## 预算预检与分批

- 运行开始前先做**预算预检**（`review_daily_scan` 返回的运行信息含预算状态；按**列表级请求数**计）。
- 预算不足以覆盖全部标的时，显式提示「**本次可处理前 N 个标的**」+ 剩余标的数；
  只处理前 N 个，其余记 `deferred`（原因 `budgetExhausted`，**不计 failed**），并提示续跑方式
  （完成第一批后再次运行，已产出附注的标的返回 `skipped`，未处理标的继续处理）。
- **MUST NOT 静默排队、MUST NOT 静默截断清单**；预算耗尽立即显式失败并停止该批，
  **MUST NOT 长时间等待或静默重试**。
- 节流：单标的调用仍受源全局最小间隔约束；按 `标的数 × 最小间隔` 估算时延并向用户说明。

## 附注结构模板（工具落盘形态，供核对）

```markdown
## HH:mm ^ainote-<YYYYMMDD>-<代码>-<HHMM>
- generatedAt: <YYYY-MM-DDTHH:mm:ss+08:00>
- dataSources: quote.close=tq-local@<YYYY-MM-DD>, limitReason.cause=S7@<YYYY-MM-DD>

- tradeDate: <YYYY-MM-DD>
- code: <代码>
- missing: <字段:原因 或 none>
- cacheReused: <字段=true|false 或 none>

数据完整性：完整｜部分（缺 <字段>）

研究辅助、不构成投资建议

① 事实：…
② 当日表现：…
③ 待跟踪：…
```

用户卡片分节（`^card-`）永远在附注之前；附注只追加、可被用户整节删除；下游解析默认排除
`^ainote-` 分节（"卡片数"口径 = 用户卡片数，不含附注）。
