---
name: review-daily-summary
description: 盘后每日汇总工作流：当日收盘后由用户在会话中触发、或由 DSH 复盘面板「整理今日复盘」按钮把触发短语发进会话触发（用户要求"跑每日汇总/生成今日复盘附注/整理今日复盘"时同样触发）。遍历当日有卡片标的，逐标的取数并生成当日总结，以 AI 附注追加进该标的当日 md；读取 DB/stock 标的档案（角色 作为口径）；收尾提交运行摘要并汇总四段（指数/情绪/赚钱效应/题材）写入当日盘面 md。不用于盘中、不做全市场扫描。
version: 1.3.0
---

# 每日汇总（review-daily-summary）

把「现场卡片」变成「当日结论」：盘后遍历当日有卡标的 → 逐标的取数 → 生成当日总结 →
以 **AI 附注**追加进该标的当日 md（与用户主观记录严格分离、只追加、幂等）→
**收尾提交运行摘要**。本 skill 是研究辅助工作流，**不构成投资建议，不写交易指令**。

## 触发短语（面板与会话同文）

DSH 复盘面板的「整理今日复盘」按钮发送的**固定模板**（用户也可在会话里直接粘贴同一句）：

```
整理今日复盘：请按 review-daily-summary 工作流执行——扫描当日有卡标的并逐标的生成 AI 附注，读取 DB/stock 标的档案（角色 作为口径）后在收尾汇总四段（指数/情绪/赚钱效应/题材）写入当日盘面 md。交易日缺省按 T0 解析。
```

- 该短语 **MUST NOT 带日期字面量**：交易日缺省由 W2 经 T0 解析；需要指定交易日时由用户另行说明。
- 面板按钮只做「把这句话发进会话」一件事——MUST NOT 绕过本 skill、MUST NOT 由插件自建 agent 运行。

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

- **用户卡片与图片**：先调用 `review_read_daily`（`code`、`tradeDate`）取得该标的卡片，
  原样保留 `anchor`、`writtenAt`、`body` 与可选 `images`（`relativePath`、绝对 `path`、`mimeType`、`available`）。
  **同码跨市场（owner 2026-10-08 P0）**：`code` 用清单原样代码——带市场前缀（如 `sh000688`）时原样传，
  或对带 `qualifier` 的清单条目显式传 `market`；MUST NOT 把指数/锚点条目的附注落到同码股票文档。
  无卡片时跳过该标的；没有 `images` 的旧卡片照常按文字处理。
  对 `available=true` 的图片逐个明确调用宿主原生 `read_image({file_path: image.path})`，
  以绝对 `path` 在本次运行内去重；相同图片只读一次并将结果关联到引用它的各卡片。
  宿主返回的 image 附件才是视觉输入；读图成功后结合卡片文字进入 W4。
  `available=false`、读图失败、工具隐藏或模型无视觉能力时，按图片逐条登记
  `missing`（如 `{field: 'cards[0].images[0]', reason: 'sourceUnavailable'}`）与 `warnings`
  （卡片锚点、图片路径、具体原因）；继续文字处理，**MUST NOT 假称已读图**，也不能据路径或文件名猜图。
  图片缺失或视觉能力不足只降低完整性，不改变既有 `created`/`skipped`/`failed`/`deferred` 四态判据。
- **当日表现**：经 **TQ skill**（tq-local skill 的 `get_more_info` 当日字段；该 skill 由
  `tq-skill-installer` 安装）。TQ 路径由 agent 执行，**无出站计数 seam**，因此 MUST 在数据包
  与附注中标注 `fetchedAt`（数据获取时间）与 `cacheReused`（是否复用当日缓存，无 TQ 路径参与时写 `none`）。
- **涨停原因**：经 T1 工具 `get_limit_reason`，**必须显式传 `date=<目标交易日>`**
  （canonical `YYYY-MM-DD`）。MUST NOT 依赖"缺省为最近交易日"口径（历史/补写时会取到当日数据）。
- **标的档案（review-loop）**：经工具 `review_stock_profiles` 读取 `DB/stock` 档案——
  入参 `codes` + `names` 与当日清单按下标对齐（名称退化时工具自行回落 `代码` 索引）；
  另**不传参**调用一次取得全部 `锚点: true` 档案（= 盘面 md 指数段的锚点集合）。
  命中档案的 `role`（= 档案 `角色` 键原文，MUST NOT 为空串）SHALL 作为该标的的**生成口径**
  写入数据包 `profile` 字段；**未命中即不出现该字段**（不是错误、不进 `missing`）。
  **注入面收窄**：档案的 `热点标签`/`板块`/`当前题材`/`题材地位`/`# 股性` **MUST NOT**
  进入生成上下文（只保存与展示）；`角色` MUST NOT 被当作行情事实、MUST NOT 复述为用户判断。
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
| `cards[].images` | 可选 `[{relativePath, path, mimeType, available}]`，原样保留工具返回元数据 | `path` 是宿主 `read_image` 的绝对路径；可用仅表示文件存在，不表示已经读图；未能读取的图片逐项进 `missing` 与 `warnings` |
| `quote` | `{ available, fields, source, fetchedAt, cacheReused, skillVersion }` | `available=false` 表示源不可用：`fields` **保持对象形态**（各字段 `value=null` + `source=null` 并逐个进 `missing`）；**MUST NOT 把 `fields` 写成 `null`** |
| `quote.fields` | 每字段 `{value, source, fetchedAt}`；金额=万元、市值=亿元、比例=百分数数值 | 每数值字段 MUST 带来源；`value=null` 时逐条进 `missing`；**MUST NOT 用 0 冒充缺失** |
| `limitReason` | T1 输出裁剪（`available/tradeDate/cause/firstTime/lastTime/openCount/streakDesc/source/fetchedAt/notes/errors`，**`errors[]` 必须保留**） | 三档判定见下 |
| `profile` | `{ role, path }`（review-loop；来自 `review_stock_profiles`） | **可选**：未命中档案即不出现；`role` 只作生成口径（MUST NOT 当事实/复述），不影响 `missing` 与四态 |
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
- **图片证据**：仅使用 W3 实际读图成功后获得的视觉内容，结合对应卡片文字生成总结；
  图片事实标注卡片锚点与 `relativePath`，视觉不清的字段显式待核实，未读或缺失的图片不得作为事实来源。
- **MUST NOT 改写或复述用户主观判断**（用户卡片正文保持原样，附注不评价用户记录）；
- **标的档案（review-loop）**：数据包有 `profile` 时，按其 `role` 选择叙述口径，并在附注中标注
  档案来源路径（如 `档案：DB/stock/微盘股.md`）；`role` 是 owner 自述口径，MUST NOT 当作行情事实、
  MUST NOT 复述为用户判断、MUST NOT 扩写为建议语义；
- 缺失数据显式标注；数据完整性固定行：`数据完整性：完整` 或 `数据完整性：部分（缺 <字段>）`；
- 固定定位声明行：`研究辅助、不构成投资建议`。

## W5 提交（`review_append_ainote` → `review_daily_report`）

1. 逐标的调用 `review_append_ainote`（入参 `code`/`tradeDate`/`body`/`generatedAt`/`dataSources`；带市场前缀的清单条目原样传 `code` 或显式传 `market`——同码跨市场定位，owner 2026-10-08 P0）
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

## W6 盘面整理收尾（`review_write_brief`）

附注与运行摘要**完成之后**，把当日卡片/附注与档案口径汇总为**四段**并落盘：

1. 汇总四段正文（各段 MUST 非空；事实逐条带来源，缺项显式写「数据不可得」/「卡片未覆盖」）：
   - **指数**：逐一列出锚点档案（`锚点: true`）对应标的的当日表现（名称(代码) + 涨跌幅，可得时含收盘/成交额），
     逐项带来源（如 `来源：tq-local@YYYY-MM-DD`）；不可得项逐行标「数据不可得（原因：…）」并进 `missing`；
   - **情绪**：当日情绪面结论（连板/一字/负反馈等），每条带出处（卡片锚点或附注来源）；
   - **赚钱效应**：昨日涨停等锚点表现 + 卡片中的赚钱效应证据，逐条带出处；
   - **题材**：当日卡片标的方向聚合，逐条带出处。
2. 调用 `review_write_brief`（**唯一生产者**）：
   - 入参：`tradeDate`（canonical）、`sections`（`index`/`sentiment`/`moneyEffect`/`theme`）、
     `anchors`（本次锚点代码）、`missing`（`[{field, reason}]`）、`warnings`；
   - 落 `<数据根>/DB/review/<YYYYMM>/<YYYYMMDD>-summary.md`；**同交易日重复运行 = 覆盖重写**
     （原子写；无 `force`/`overwrite` 入参；MUST NOT 手工编辑该文件——会被覆盖）；
   - MUST NOT 触碰用户卡片与 AI 附注分节；MUST NOT 扩展运行摘要 schema。
3. **独立性**：盘面 md 失败**不改变**附注与运行摘要的既有结果（反向亦然：单标的附注失败不阻断汇总，
   但须在该段标注「附注未生成（原因：…）」）。当日 `targets=[]`（无卡片）时**跳过 W6**（零打扰）。

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

## 标的档案格式（数据格式化建议；owner 维护 + 首卡懒创建）

`DB/stock/<名称>.md` 为标的档案（既有区；owner 维护内容，插件**只建不改**——首次写该标的复盘卡片时
异步创建一份骨架，MUST NOT 覆盖既有档案）。本工作流消费的字段：

| 键 / 小节 | 必需性 | 是否进生成上下文 | 说明与建议格式 |
| --- | --- | --- | --- |
| `角色` | 建议（不填 = 该标的不注入业务内容） | **是（唯一业务内容，作为口径重点）** | 短角色词 + 可选一句口径（`｜` 分隔）：`角色: "中军"`、`角色: "情绪周期｜向上有，向下无"` |
| `代码` | 锚点必需；其余由懒创建自动写入 | 否 | `代码: "880823"`（6 位字符串，定位兜底与一致性校验） |
| `锚点` | 仅锚点 | 否 | `锚点: true`（盘面 md 指数段成员；插件 MUST NOT 自动标记） |
| `热点标签` / `板块` / `当前题材` / `题材地位` / `# 股性` | 可选 | **否（只保存与展示）** | 原样保留，本工作流不读取进上下文 |

**锚点建档清单（9 份；owner 手工建档，模板如下）**：

| 档案 | 代码 | 建议 `角色` |
| --- | --- | --- |
| `上证指数.md` | 999999 | 情绪主锚 |
| `沪深300ETF.md` | 510300 | 国家队 |
| `科创50.md` | 000688 | 科技 |
| `平均股价.md` | 880003 | 高价股 |
| `全A等权.md` | 880008 | 整体 |
| `中证1000.md` | 000852 | 小盘科技 |
| `微盘股.md` | 880823 | 情绪周期｜向上有，向下无 |
| `昨日涨停.md` | 880863 | 赚钱效应 |
| `昨日连板.md` | 880812 | 短线接力 |

```markdown
---
代码: "880823"
板块: 
当前题材: 
题材地位: 
热点标签:
角色: 
---

# 股性



# 记录

![[stock-info.components]]
```

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
