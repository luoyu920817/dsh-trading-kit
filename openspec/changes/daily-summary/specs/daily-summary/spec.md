## ADDED Requirements

> 跨 change 事实源：`docs/design/iteration-1-contracts.md`（下称 `§n`）；迭代一重排裁决见
> `docs/roadmap.md §5`。凡「复用」均指向 `§3` 的**具名导出**（五个导出一律返回
> `warnings: string[]`：`locateDoc` / `parseDoc` / `appendCard` / `appendAinote` /
> `scanDailyCardTargets`）与 `src/review/anchor.ts` 的 `normalizeCode`、`src/review/format.ts`
> 的 `formatZonedIso` / `formatAnchorTime`，以及 service key `traderKit.review.*` 的上述五键；
> MUST NOT 以「复用存储实现」之类无具名接口的表述代替。**日期格式唯一口径**（`§1`）：工具 /
> service 契约、数据包、缓存 payload 中的日期一律 `YYYY-MM-DD`；`YYYYMMDD` **只允许**出现在
> 目录 / 文件名模板参数与锚点、天级缓存目录、第三方源请求参数三处；两格式换算 MUST 经 change 2
> 的 `src/data/date.ts`（`toCompactDate` / `fromCompactDate` / `isValidIsoDate`），各处 MUST NOT
> 自行拼接或截断日期串。

### Requirement: 触发方式

本迭代的每日汇总 SHALL 由会话内手动触发（用户请求或 skill 被 agent 调用）；MUST NOT 依赖宿主定时任务（W-Q1 裁决：先跑通工作流，定时任务随宿主能力后接）。工作流定位为盘后执行，skill 说明 SHALL 写明「盘后执行、单标的取数、不做全市场扫描」。

#### Scenario: 手动触发执行

- **WHEN** 用户在会话中触发每日汇总（指定或不指定交易日）
- **THEN** 工作流按本规范执行并给出结果摘要（产出数、跳过数、失败数、`deferred` 数），且 `created[]` / `skipped[]` / `failed[]` / `deferred[]` 与运行摘要文件（见「运行摘要与具名生产者出口」）在**同一次运行的返回**中逐项一致

#### Scenario: 无卡片时零打扰

- **WHEN** 目标交易日没有任何标的卡片
- **THEN** 工作流结束并说明「当日无卡片」，不产出任何附注、不报错、不提示补录

#### Scenario: 交易日不可得与「无卡片」显式区分

- **WHEN** 目标交易日**不可得**（`resolveTradeDate` 返回 `businessDate === null` 且未指定 `date`）
- **THEN** 工作流 SHALL 显式要求用户指定交易日，并说明「交易日不可得」（MUST NOT 输出「当日无卡片」这一易误导结论），MUST NOT 以系统日期或限流日顶替

### Requirement: 输入枚举

工作流 SHALL 以业务日期为准，扫描 `<数据根>/DB/review/<YYYYMM>/` 下文件名日期字段等于该交易日的文档，得到标的清单（含代码、名称、文档路径、用户卡片数、是否已有附注、`warnings[]`），MUST NOT 依据系统日期判断「当日」。`tradeDate` 与入参日期一律 canonical `YYYY-MM-DD`；`<YYYYMM>` 与文件名模板中的 `YYYYMMDD` 属 `§1` 允许的「目录/文件名模板参数」例外，其换算 MUST 经 `src/data/date.ts`。路径 SHALL 一律经 change 2 `data-root-layout` 的映射表解析（两级：区域目录 + 文件名模板，`resolveArea`），调用方 MUST NOT 自行拼接业务区路径（`§6`）。扫描 SHALL 复用 change 4 `src/review/store.ts` 的 `scanDailyCardTargets(tradeDate)`（service key `traderKit.review.scanDailyCardTargets`），MUST NOT 另写一份目录遍历/解析实现；该导出的 `warnings: string[]` SHALL 原样上抛（`§12.7`），MUST NOT 只记日志。跨月边界 SHALL 按该交易日的 `YYYYMM` 定位目录。

#### Scenario: 枚举当日标的

- **WHEN** 目标交易日为 `2026-09-24` 且 `DB/review/202609/` 下存在 3 个该日文档
- **THEN** 清单返回 3 个标的（含各自卡片数与附注存在标记），同一标的只出现一次

#### Scenario: 跨月边界

- **WHEN** 目标交易日为月末/月初（如 `2026-08-31`，而运行日为 `2026-09-01`）
- **THEN** 扫描目录为 `DB/review/202608/`，MUST NOT 误扫运行日所在月份

#### Scenario: 清单为空

- **WHEN** 扫描结果为空
- **THEN** 返回空清单并说明原因，不产生任何写入

#### Scenario: 路径一律经映射表

- **WHEN** 审查扫描实现
- **THEN** 业务区路径全部来自 `data-root-layout` 映射表解析结果，源码中不存在手写拼接的 `<数据根>/DB/review/...` 字面量（结构断言）

### Requirement: 交易日来源（唯一实现，禁循环依赖）

`review_daily_scan` 的**缺省交易日** SHALL 调用 change 2 的 T0 能力——service `traderKit.data.resolveTradeDate({ date? })` / tool `get_trade_date`（`§1`）——作为唯一日期来源，MUST NOT 读取系统日期作 fallback，MUST NOT 依赖任何**逐标的**取数结果（如 T1 `get_limit_reason().tradeDate`）推导扫描日期（否则构成「先要日期才能扫出标的、先要标的才能取到日期」的循环依赖）。该实现 SHALL 与 change 4 的 `TradeDateResolver` seam 调用**同一实现**（同一 service key），MUST NOT 另写日期推断分支。

- 用户显式传入 `date` 时 SHALL 按 canonical `YYYY-MM-DD` 使用该日期作为目标交易日；兼容 `YYYYMMDD` 紧凑写法，归一 MUST 经 `src/data/date.ts` 的 `fromCompactDate`（`§1`），MUST NOT 自行截断/拼接。
- `businessDate === null`（不可得）时 SHALL **显式要求用户指定交易日**；`isTradingDay === null`（无法判定，本迭代无交易日历）时 SHALL **显式标注归属待确认**，MUST NOT 以系统日期推断「非交易日」。
- 任一情形 MUST NOT 以系统日期、限流日或「最近已知交易日」静默顶替目标交易日；用户确认后的值 SHALL 与该标的文档的 `tradeDate`、锚点日期段一致（`§1`/`§2`）。
- **返回态命名唯一口径（`§1`：本迭代无交易日历）**：只有「**交易日不可得（盘前 / 源未出数）**」「**归属待确认（业务日 X、限流日 Y）**」「**该交易日无卡片**」三态；MUST NOT 引入「非交易日 / 长假」这一不可判定命名（`isTradingDay` 的取值域为 `true | null`，`null` 不得当作「非交易日」结论）。

#### Scenario: 缺省交易日经 T0 解析

- **WHEN** 用户未指定交易日
- **THEN** 目标交易日取自 `traderKit.data.resolveTradeDate`（tool `get_trade_date`）的返回；源码中不存在读取系统日期作为目标交易日的路径（源码级禁止 + 行为断言：篡改系统日期不改变已确认的目标交易日）

#### Scenario: 归属待确认（业务日 ≠ 限流日）

- **WHEN** 运行日处于周末/长假/历史请求等情形，T0 返回 `isTradingDay === null`（`businessDate !== 限流日`）
- **THEN** 工作流 SHALL 标注「归属待确认（业务日 X、限流日 Y）」并要求用户指定交易日；MUST NOT 把 `isTradingDay === null` 当作「非交易日 / 长假」结论（`§1` 无交易日历）、MUST NOT 按运行日扫描；用户指定的交易日若确有文档，则照常处理

#### Scenario: 交易日不可得（盘前 / 源未出数）

- **WHEN** 交易日盘前运行或源未出数，T0 返回 `businessDate === null`
- **THEN** 工作流 SHALL 显式说明「交易日不可得（盘前 / 源未出数）」并要求用户指定交易日，MUST NOT 静默按运行日扫描、MUST NOT 输出「当日无卡片」

#### Scenario: 有交易日但无卡片

- **WHEN** 目标交易日已明确（用户指定或 `isTradingDay === true`）且该日目录下无任何文档
- **THEN** 工作流输出「该交易日无卡片」，且该态与「交易日不可得（盘前 / 源未出数）」「归属待确认（业务日 X、限流日 Y）」在返回信息中可区分；MUST NOT 出现第四种「非交易日 / 长假」命名

#### Scenario: 与 change 4 同一实现

- **WHEN** 审查本 change 与 change 4 的日期获取路径
- **THEN** 二者调用同一 service key `traderKit.data.resolveTradeDate`，不存在第二份日期推断实现（结构断言）

### Requirement: 取数与缓存

工作流 SHALL 逐标的取当日表现（经 tq-local skill）与涨停原因（经 change 2 的 T1 工具 `get_limit_reason`，`§1` 的日期三义与路由判据），并组装结构化数据包（schema 见「数据包 schema」），MUST NOT 做全市场扫描。调用 T1 时 SHALL 显式传 `date=<目标交易日>`（canonical `YYYY-MM-DD`；兼容 `YYYYMMDD` 紧凑写法，归一 MUST 经 `src/data/date.ts` 的 `fromCompactDate`，`§1`），MUST NOT 依赖「缺省为最近交易日」口径——缺省口径在历史／补写时会取到当日数据。`requestedDate !== rateLimitDate`（历史请求）时 MUST NOT 回退 List 端点（`§1`）；此时 T1 返回 `available=false` + `errors:[dateUnavailable]`，该语义 MUST 按「数据不可得」处理，MUST NOT 当作「无涨停记录」。

**T1 日期一致性硬门槛**：T1 返回的 `limitReason.tradeDate !== 目标交易日` 时，该字段 SHALL 降级为 `missing`（原因 `dateMismatch`），MUST NOT 冒充目标交易日数据；降级事实 SHALL 在附注中显式标注（正文「数据完整性」行 + `missing` 元信息行）。

**T1 `dateUnavailable` 与「无涨停记录」必须区分（`§12.8`）**：`limitReason` 的裁剪结果 SHALL 保留 `errors[]`；其中含 `dateUnavailable`（该日 History 无数据／日期不可用，含长假、历史补写）→ 该字段降级为 `missing`（原因 `sourceUnavailable`），数据完整性为「部分」，正文 SHALL 写「该日涨停原因数据不可得」，**MUST NOT 写「无涨停记录」**；`available=false` **且不含** `dateUnavailable` → 属正常「无涨停记录」（`missing` 原因 `noRecord`，不计 `failed`），附注方可写「无涨停记录」。

**零网络断言的适用范围收窄**：仅 T1/T2 侧（经插件数据模块出口、命中 `§9` **列表级缓存**，键 = `source + requestedDate`）SHALL 断言「出站请求计数为 0」；当日表现经 TQ skill（agent 执行的 skill 路径，本插件无出站计数 seam）**不可自动断言**，改为要求 skill 输出 SHALL 标注**数据获取时间**与**是否复用当日缓存**（人工证据，字段样例见「附注元信息行」）。

单标的数据源失败 SHALL 只影响该标的，MUST NOT 阻塞其它标的。

#### Scenario: 逐标的组装数据包

- **WHEN** 某标的取数成功
- **THEN** 数据包含当日表现与涨停原因字段、来源标注（`{value, source, fetchedAt}`）与 `missing` 列表，并通过「数据包 schema」的校验

#### Scenario: T1 侧缓存命中零网络（可自动断言）

- **WHEN** 同一交易日第二次取同一标的的 T1 数据
- **THEN** 命中列表级缓存（键 = `source + requestedDate`），断言出站请求计数为 0、当日预算用量不变（自动测试；计数出口属 change 2 数据模块）

#### Scenario: TQ skill 侧标注获取时间与缓存复用（人工证据）

- **WHEN** 当日表现来自 tq-local skill
- **THEN** 数据包与附注 SHALL 标注该字段的 `fetchedAt` 与 `cacheReused: true|false`；验收为**人工证据**（粘贴字段样例，含 skill 名与版本），MUST NOT 声称已在本 change 内自动断言 TQ 路径零网络

#### Scenario: T1 显式传 target date

- **WHEN** 目标交易日为 `2026-09-24`
- **THEN** 对 T1 的调用入参含 `date='2026-09-24'`（canonical；兼容写法 `'20260924'` 归一后为同一请求日，MUST NOT 省略为缺省口径）

#### Scenario: T1 业务日与目标交易日不一致

- **WHEN** `limitReason.tradeDate !== 目标交易日`（源滞后、或路由取到他日）
- **THEN** `limitReason` 降级为 `missing`（原因 `dateMismatch`），附注「数据完整性」行标为部分、`missing` 行含该字段与原因；MUST NOT 把该数据写成本交易日事实、MUST NOT 仅标注 `notes` 后照常使用

#### Scenario: History 空 + `dateUnavailable` 不写成「无涨停记录」

- **WHEN** 历史请求（`requestedDate !== rateLimitDate`）且 T1 返回 `available=false` + `errors:['dateUnavailable']`
- **THEN** `limitReason` 降级为 `missing`（原因 `sourceUnavailable`）、附注「数据完整性」行为「部分（缺 `limitReason`）」、正文写「该日涨停原因数据不可得」；MUST NOT 写「无涨停记录」，MUST NOT 因此把该标的计入 `failed`

#### Scenario: 单标的失败隔离

- **WHEN** 某标的取数失败（TQ skill 不可用 / T1 主备均失败）
- **THEN** 该标的按「失败判定矩阵」计入 `failed`（原因）或产出部分附注，其余标的照常处理

### Requirement: 数据包 schema

数据包 SHALL 为 skill 组装的 JSON 结构，字段、类型、单位与缺失语义如下表；组装结果 MUST 通过 schema 校验（JSON Schema 校验函数；零 mock 单测覆盖合法与非法样本），校验不通过 SHALL 显式失败并点名非法字段，MUST NOT 静默丢弃字段。

| 字段 | 类型 | 单位 / 取值 | 缺失与判定 |
| --- | --- | --- | --- |
| `code` | string | `^\d{6}$`，经 change 4 `src/review/anchor.ts` 的 `normalizeCode`（`§2`） | 必填；`normalizeCode` 失配即显式失败 |
| `name` | string | 名称文本；未获取时 `""` | 允许空串（不阻断） |
| `tradeDate` | string | `YYYY-MM-DD`（canonical `^\d{4}-\d{2}-\d{2}$`），目标交易日 | 必填；缺即 `failed`（`tradeDateUnavailable`） |
| `generatedAt` | string | 带时区 ISO8601，本地偏移 `+08:00` | 必填；SHALL 由 change 4 `src/review/format.ts` 的 `formatZonedIso(date)` 产出（`§3` 同源） |
| `cards` | array | 元素 `{anchor, writtenAt, body}`，来自 `review_read_daily`（即 `parseDoc` 的卡片集合，排除 `^ainote-`） | 空数组合法（该日无用户卡片 → 零打扰，不产出附注） |
| `quote` | object | `{ available, fields, source, fetchedAt, cacheReused, skillVersion }` | `available=false` 表示**源不可用/未取到**：`fields` **保持对象形态**，各字段 `value=null` + `source=null` 并逐个进 `missing`（MUST NOT 把 `fields` 写成 `null`，否则无字段名可枚举） |
| `quote.fields` | object | 每字段 `{value, source, fetchedAt}`；单位沿 change 2 `data-tool-contract`（金额=万元、市值=亿元、比例=百分数数值） | 每数值字段 MUST 带来源；`value=null` 时 MUST 在 `missing` 逐条登记 |
| `limitReason` | object | T1 `get_limit_reason` 输出裁剪（`available/tradeDate/cause/firstTime/lastTime/openCount/streakDesc/source/fetchedAt/notes/errors`，**`errors[]` 必须保留**） | 三档判定（`§12.8`）：① `errors` 含 `dateUnavailable` → `missing` 原因 `sourceUnavailable`，**MUST NOT 写「无涨停记录」**；② `available=false` 且不含 `dateUnavailable` → 正常「无涨停记录」（`missing` 原因 `noRecord`，不计 `failed`）；③ `limitReason.tradeDate !== 目标交易日` → `missing` 原因 `dateMismatch` |
| `missing` | array | 元素 `{field, reason}`；`reason` 枚举：`sourceUnavailable` / `dateMismatch` / `noRecord` / `fieldAbsent` | 空数组表示数据完整；非空即正文标「部分」 |

**判定规则**：① `available=false` **不等于**取数失败（`noRecord` 只进 `missing`），但**必须**先按 `errors` 分档（`dateUnavailable` 属数据不可得，不得写成「无涨停记录」，`§12.8`）；② `missing` 只登记**逐字段**缺失（整块不可得时逐字段登记 `sourceUnavailable`），MUST NOT 用「整块失败」笼统代替；③ 任意数值字段 MUST NOT 用 `0` 冒充缺失（沿 `data-tool-contract` 空值守卫）；④ `source` 与 `fetchedAt` 逐字段携带，MUST NOT 出现无来源的数值；⑤ `cacheReused` 为**必填键**，无 TQ 路径参与时写 `none`。

**TQ 字段来源**：`quote.fields` 的字段名与取值来源 SHALL 标注为 tq-local skill（change 3 安装，落点经 `skill.installDir`）的 `get_more_info` 当日字段，并记录 `skillVersion`（取该 `SKILL.md` frontmatter 的 **`version`** 值，见「skill 落点与可发现性」）；skill 版本不可解析时 SHALL 记 `unknown` 并进 `missing`（原因 `fieldAbsent`），MUST NOT 伪造版本。

#### Scenario: 数据包通过 schema 校验

- **WHEN** 组装完成的任一份数据包
- **THEN** 通过 schema 校验（必填字段齐备、类型正确、`missing` 元素形如 `{field, reason}`）；不通过则本次运行显式失败并点名字段

#### Scenario: 字段级缺失与整块不可用可区分

- **WHEN** `quote.available=true` 但某字段无值
- **THEN** 该字段 `value=null` + 进 `missing`（原因 `fieldAbsent`），附注标部分；**WHEN** `quote.available=false` **THEN** `fields` 保持对象形态、各字段 `value=null` + `source=null` 并逐条登记 `sourceUnavailable`，两者在运行摘要中可区分

#### Scenario: T1 无记录不是失败（仅限无 `dateUnavailable`）

- **WHEN** T1 返回 `available=false`、`tradeDate === 目标交易日` **且 `errors` 不含 `dateUnavailable`**（该标的当日无涨停记录）
- **THEN** 不计入 `failed`，仅登记 `noRecord`；附注照常产出并标注「无涨停记录」而非「取数失败」

#### Scenario: T1 `dateUnavailable` 与无记录分档

- **WHEN** T1 返回 `available=false` 且 `errors` 含 `dateUnavailable`（该日 History 无数据 / 日期不可用）
- **THEN** 登记 `missing{limitReason, sourceUnavailable}`、数据完整性为「部分」、正文写「该日涨停原因数据不可得」；MUST NOT 写「无涨停记录」，MUST NOT 与「无涨停记录」在日志/摘要中同名同类

#### Scenario: 数值不冒充

- **WHEN** 审查数据包与附注正文
- **THEN** 不存在以 `0` / `--` / 空白替代缺失数值的路径（断言 `missing` 覆盖全部 `value=null` 字段）

### Requirement: 总结生成约束

agent SHALL 依据数据包生成该标的当日总结。总结 MUST NOT 改写或复述为用户主观判断（用户卡片正文 SHALL 保持原样）；MUST NOT 出现确定性交易表述（负向词表见「合规与写作约束」）；数据缺失项 SHALL 显式标注，MUST NOT 补猜或推算未提供的数据。

#### Scenario: 合规输出

- **WHEN** 生成任一标的的总结
- **THEN** 正文不含负向词表命中项，附注固定含「研究辅助、不构成投资建议」一行

#### Scenario: 缺失数据显式标注

- **WHEN** 数据包中某字段缺失（如首封时间不可得）
- **THEN** 总结中标注该字段缺失或不可用，MUST NOT 用推测值填充；正文固定含「数据完整性：完整｜部分（缺 X）」行

#### Scenario: 用户卡片不被改写

- **WHEN** 总结生成并落盘后
- **THEN** 该文档的用户卡片分节与其正文未变（字节口径见「写入通道与原子性」及 `§4`）

### Requirement: 合规与写作约束

skill 正文 SHALL 给出**正向写作骨架**：① 事实（数据来源与日期）→ ② 当日表现（逐项带来源）→ ③ 待跟踪（不构成建议）。同时 SHALL 给出**负向词表**（至少含以下及其变体）：`必须买`、`建议买入`、`目标价`、`必涨`、`可重仓`、`确定性加仓`、`满仓`、`稳赚`、`保证收益`。附注 SHALL 固定含一行定位声明：**「研究辅助、不构成投资建议」**。

验收 SHALL 为「对 N 份真实产出运行关键词扫描脚本 + 人工复核」：脚本对附注正文与用户卡片之外的 agent 生成段落做负向词表匹配，**判定标准 = 零命中**（任一命中即不通过）；人工复核确认无「复述用户主观判断」「补猜缺失值」两类问题。

#### Scenario: 关键词扫描零命中

- **WHEN** 对 N（N ≥ 5）份真实附注运行负向词表扫描脚本
- **THEN** 命中数为 0，且每份附注含「研究辅助、不构成投资建议」行与其他固定行

#### Scenario: 人工复核记录

- **WHEN** 完成扫描后人工复核
- **THEN** 证据含：脚本命令、扫描输出（命中数）、被检查的附注路径清单、复核结论；缺任一项视为未验收

#### Scenario: 写作骨架存在

- **WHEN** 审查 skill 正文
- **THEN** 含三段式骨架与负向词表（含变体），且明确「MUST NOT 评价/改写用户主观记录」

### Requirement: 失败判定矩阵与重算指引

TQ（当日表现）与 T1（涨停原因）两路取数的结果 SHALL 按下列矩阵判定，MUST NOT 出现未定义的中间态：

| TQ | T1 | 结果 | 附注与摘要 |
| --- | --- | --- | --- |
| 成功 | 成功 | `created` | 数据完整性：完整 |
| 成功 | `available=false` 且 `errors` **不含** `dateUnavailable` | `created` | 部分（缺 `limitReason`，原因 `noRecord`） |
| 成功 | `errors` 含 `dateUnavailable` | `created` | 部分（缺 `limitReason`，原因 `sourceUnavailable`）；正文「该日涨停原因数据不可得」，MUST NOT 写「无涨停记录」（`§12.8`） |
| 成功 | 失败 / `dateMismatch` | `created` | 部分（缺 `limitReason`，原因 `sourceUnavailable` / `dateMismatch`） |
| 失败 | 成功 | `created` | 部分（缺 `quote`，原因 `sourceUnavailable`） |
| 失败 | `available=false`（含 `dateUnavailable`）或失败 | `failed`（原因 `sourceUnavailable`，含两路原因） | 不写文档 |
| 二者皆无用户卡片 | —— | `skipped`（零打扰） | 不写文档 |
| 预算不足未处理 | —— | `deferred`（原因 `budgetExhausted`，不计 `failed`） | 不写文档，摘要分列 |

**重算指引**：附注一旦写入，重跑只返回 `skipped`；skill 与工具返回信息 SHALL 给出**显式指引**：「如需重算：删除该附注分节（block 引用 `^ainote-<YYYYMMDD>-<代码>-<HHMM>`）后重跑」。`force` 入参本迭代**后置**（记 Open Questions），工具 schema MUST NOT 含 `force` / `overwrite` 等幽灵参数（`§9` 的「无幽灵参数」精神）。

#### Scenario: 部分产出带 missing

- **WHEN** TQ 成功而 T1 失败
- **THEN** 产出附注，正文「数据完整性」行为「部分（缺 `limitReason`）」，`missing` 元信息行含 `{limitReason, sourceUnavailable}`，该标的计入 `created`（非 `failed`）

#### Scenario: 两路皆失败

- **WHEN** TQ 与 T1 均失败
- **THEN** 该标的计入 `failed`（带两路原因），MUST NOT 写入半成品附注

#### Scenario: 重算指引存在

- **WHEN** 某标的返回 `skipped`
- **THEN** 返回信息含「删除该附注分节后重跑」的指引与 block 引用；且工具 schema 中不存在 `force` / `overwrite` 入参

### Requirement: 预算预检与分批

运行开始前 SHALL 做**预算预检**：经 change 2 的**具名出口** `traderKit.data.guardStatus()` 读取当日剩余预算与批量硬上限（字段含 `remaining` / `budgetLimit` / `budgetUsed` / `minIntervalMs` / `sessionState` 等；`§9`：预算与最小间隔按**列表级请求数**计），并声明本次批量策略。**该出口不可用（未注册或字段缺失）→ 预算预检 SHALL 显式失败 `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change）**，MUST NOT 自建第二份预算计数、MUST NOT 静默跳过预检（D-1b）。预算不足以覆盖全部标的时 SHALL 显式提示「本次可处理前 N 个标的」并允许**分批续跑**，MUST NOT 静默排队、MUST NOT 静默截断清单、MUST NOT 让后段标的以无提示的 `failed` 收场。skill 说明 SHALL 写明节流与分批语义（单标的调用仍受源全局最小间隔约束，消费方须按 `标的数 × 间隔` 估算时延）。

#### Scenario: 预算预检依赖不可用即显式失败

- **WHEN** `traderKit.data.guardStatus()` 未注册或返回体缺 `remaining` / `budgetLimit` 等字段
- **THEN** 预检返回显式错误 `DEPENDENCY_UNAVAILABLE`（含缺失接口名与其所属 change），MUST NOT 自建预算计数、MUST NOT 静默跳过预检后照常全量取数

#### Scenario: 预算不足显式提示

- **WHEN** 当日剩余预算不足以覆盖全部标的
- **THEN** 运行摘要与返回信息显式给出「本次可处理前 N 个标的」与剩余标的数；被截断的标的**不**计为 `failed`（状态为 `deferred` 或等价显式状态），并提示续跑方式

#### Scenario: 分批续跑

- **WHEN** 用户完成第一批后再次运行
- **THEN** 已产出附注的标的返回 `skipped`，未处理标的继续处理，最终覆盖全部标的（无静默遗漏）

#### Scenario: 不静默排队

- **WHEN** 预算耗尽（`data-tool-contract` 的「每日预算耗尽」返回显式失败）
- **THEN** 工作流立即显式提示并停止该批，MUST NOT 长时间等待或静默重试

### Requirement: 运行摘要与具名生产者出口

每次运行 SHALL 生成**运行摘要**，且该摘要 SHALL 由**具名出口**产生（`iteration-1-contracts §12.6`），MUST NOT 只存在于 agent 对话文本或 skill 步骤描述中：

- tool：`review_daily_report`；service：`traderKit.review.dailyReport`（**同一实现**；该 key 由本 change 注册，见 `tasks.md` 2.4 与 `§11`）。
- 入参：`{ tradeDate: 'YYYY-MM-DD', entries: [{ code, status: 'created' | 'skipped' | 'failed' | 'deferred', reason? }], missing?: [{ code, field, reason }], warnings?: string[] }`（`code` 经 `normalizeCode`；`status` 为 `failed` / `deferred` 时 `reason` 非空）。`missing` / `warnings` 为**可选回填通道**：取数阶段产生的逐字段缺失与 change 4 五个导出返回的 `warnings: string[]` 由调用方在本入参交回；调用方未提交时出口 MUST NOT 因此丢弃其自身汇总所得（扫描告警、`entryMissing` 等）。该扩展**不改变 `§12.6` 的必填入参**（`tradeDate` + `entries`），仅为可选字段。
- 行为：**合并写入**当日运行摘要——以 `(tradeDate, code)` 为键合并 `entries`（同键后写覆盖、其余键保留），沿用 `§5` 的进程内按绝对路径互斥 + 跨进程 `stat` 快照比对语义与原子写（临时文件 + 改名）；日期目录 = 运行归属交易日，经 `data-root-layout` 映射表解析。**出口自身 SHALL 调用 `traderKit.review.scanDailyCardTargets(tradeDate)` 取得本次扫描清单**，并与 `entries` 的代码集合比对：清单中未出现于 `entries` 的代码 SHALL 由出口补为 `failed`（`reason = 'entryMissing'`）并记入返回 `warnings[]`；「四态并集 ⊇ 扫描清单」由**出口自身**完成，MUST NOT 依赖 agent 传全清单（该依赖不可用时按 D-1b 显式返回 `DEPENDENCY_UNAVAILABLE`，不写摘要）。
- 返回：`{ tradeDate, created[], skipped[], failed[], deferred[], missing[], warnings[] }`（四态并集；`missing` 元素 `{code, field, reason}`；`warnings` = 入参 `warnings?` ∪ 本次运行内 change 4 五个导出返回的 `warnings: string[]` ∪ 出口自扫产生的告警，去重后原样保留，`§12.7`）。
- 摘要文件路径：`<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`（沿 `§10` 的 temp 区约定与 `data-root-layout` 的「数据工具缓存产物」区；`<YYYYMMDD>` 属 `§1` 允许的目录模板例外，换算经 `src/data/date.ts`）。

摘要文件 schema SHALL 为：

```json
{
  "tradeDate": "2026-09-24",
  "created": [{ "code": "600000", "path": "…", "anchor": "ainote-20260924-600000-1932" }],
  "skipped": [{ "code": "600001", "path": "…", "anchor": "ainote-20260924-600001-1932" }],
  "failed": [{ "code": "600002", "reason": "sourceUnavailable" }],
  "deferred": [{ "code": "600003", "reason": "budgetExhausted" }],
  "missing": [{ "code": "600000", "field": "limitReason", "reason": "dateUnavailable" }],
  "warnings": ["…change 4 导出的告警原文…"]
}
```

`created` / `skipped` 元素 SHALL 至少含 `{code, path, anchor}`（`skipped` 含既有锚点）；**`failed` / `deferred` 标的一律 SHALL 出现在摘要中并带非空 `reason`**。

#### Scenario: entries 代码集合覆盖扫描清单

- **WHEN** 调用 `review_daily_report` 提交某交易日的 `entries`，而清单中某标的未出现在 `entries`
- **THEN** **出口自身**调用的 `traderKit.review.scanDailyCardTargets(tradeDate)` 清单位点该标的，出口将其补为 `failed`（`reason = 'entryMissing'`）后写入摘要，使 `created + skipped + failed + deferred` 的代码并集 ⊇ 本次扫描清单（无静默丢失）；该断言由出口在读回摘要的行为用例中断言，MUST NOT 只靠 agent 文本复述或外部测试自备清单

#### Scenario: missing 与 warnings 经入参回填

- **WHEN** 调用方在入参中提交 `missing: [{code, field, reason}]` 与 `warnings: ['[ghostAnchor] …']`
- **THEN** 摘要文件的 `missing[]` / `warnings[]` 含这些条目（去重后原样保留），且返回体同值；未提交这两个可选字段时摘要对应键为 `[]`（字段存在），MUST NOT 缺字段或静默置为 `undefined`

#### Scenario: failed 必带原因

- **WHEN** 某标的取数失败并以其 `status='failed'` 提交
- **THEN** 该标的出现在 `failed[]` 且 `reason` 非空；断言 `failed.length > 0` 的用例 MUST 同时断言每条 `reason` 非空

#### Scenario: 已存在摘要的合并与幂等

- **WHEN** 同一交易日分两批运行（第一批 3 个标的、第二批 2 个标的），第二次调用提交第二批 `entries`
- **THEN** 摘要保留第一批条目并新增第二批条目（`(tradeDate, code)` 同键覆盖）；以**完全相同入参**重复调用两次，摘要文件字节不变（幂等）

#### Scenario: 四态与摘要文件一致

- **WHEN** 工作流结束并返回结果摘要
- **THEN** 返回的 `created[]` / `skipped[]` / `failed[]` / `deferred[]` 与 `<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json` 的同一次运行结果逐项一致

#### Scenario: 摘要为原子写

- **WHEN** 摘要写入过程中进程中断
- **THEN** 目标路径下不存在半截 JSON

#### Scenario: 空清单也落摘要

- **WHEN** 当日扫描清单为空（出口自扫 `scanDailyCardTargets(tradeDate)` 返回空数组，调用方提交 `entries: []`）
- **THEN** 仍落一份各清单为空的摘要（含 `tradeDate`），供事后核对「当日确实无卡片」与「运行未发生」的区分；清单**非空**时 `entries: []` 不属本场景——缺项 SHALL 按「entries 代码集合覆盖扫描清单」补为 `failed`（`entryMissing`）

#### Scenario: store 层 warnings 有出口且进摘要

- **WHEN** 本次运行中 change 4 的任一导出返回非空 `warnings[]`（多命中、幽灵锚点、重复锚点、`nameTruncated` 等）
- **THEN** 该告警 SHALL 出现在 `review_daily_report` 的返回 `warnings[]` 与该日摘要文件的 `warnings[]` 中（合并去重后原样保留）；MUST NOT 只记日志、MUST NOT 只存在于返回信息，`§12.7`

### Requirement: AI 附注落盘契约

附注 SHALL 追加为该标的当日文档末尾的独立分节，结构为：H2 标题含可读时间与锚点 `^ainote-<YYYYMMDD>-<代码>-<HHMM>`，其后为元信息行（见「附注元信息行」），再其后为总结正文。附注 SHALL 只追加，MUST NOT 修改任何用户卡片分节或既有附注；锚点前缀 MUST 与用户卡片（`^card-`）区分。

**锚点正则（唯一版本，写入与解析共用，`§2`）**：

```
^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
```

**锚点形态统一**：本体为四段式 `<YYYYMMDD>-<代码>-<HHMM>`；正则中的可选 `-<seq>` 段**只用于解析兼容**，且 `-<seq>` **仅由 change 4 的同分钟多卡使用**——本 change 的**附注写入侧 MUST NOT 产生 `-<seq>`**（同一 `(tradeDate, code)` 幂等键下至多一条附注，不存在「同分钟第二条附注」）。**HHMM 来源** = 写入时的本地时钟（固定 `Asia/Shanghai`）；**归属**由锚点日期段 `YYYYMMDD` 决定，与 HHMM 是否跨午夜无关——即标题时间可属次日，而该附注仍归属 `YYYYMMDD` 对应的交易日。

**跨午夜说明**：23:59 与次日 00:05 的两次运行，只要目标交易日相同（如用户显式指定或 T0 解析为同一日），第二次 SHALL 命中 §「幂等」的前缀扫描返回 `skipped`，MUST NOT 产生第二条附注；文档内**同一幂等键下出现两条附注**只能由「先前附注已被用户删除后重算」产生。附注锚点 MUST NOT 携带序号（本 change 无「取最大序号 +1」的生成逻辑）；同分钟重复写入 MUST NOT 产生重复锚点（由幂等前缀扫描保证返回 `skipped`）。

#### Scenario: 附注结构正确

- **WHEN** 某标的的附注写入成功
- **THEN** 文档末尾存在符合上述结构的附注分节（元信息六键 `generatedAt` / `tradeDate` / `code` / `dataSources` / `missing` / `cacheReused` 齐备、定位声明行与「数据完整性」行齐备）

#### Scenario: 附注与卡片分离

- **WHEN** 页面或解析层读取该文档
- **THEN** 附注（`^ainote-`）与用户卡片（`^card-`）可区分，附注不计入用户卡片

#### Scenario: 用户可删除

- **WHEN** 用户手动删除附注分节
- **THEN** 文档其余内容不受影响（附注不是事实源，用户有最终处置权）

#### Scenario: 删除后同分钟重算不产生序号

- **WHEN** 用户删除前一附注后在同一分钟（HHMM 相同）重算同一 `(tradeDate, code)`
- **THEN** 新锚点为四段式且**不带 `-<seq>`**（序号不存在可达来源：前缀扫描已为空），文档内锚点唯一，MUST NOT 出现重复锚点；若实现产出 `-0930-2` 这类序号即违反「附注写入侧 MUST NOT 产生 `-<seq>`」

#### Scenario: 跨午夜不产生两条附注

- **WHEN** 23:59 与次日 00:05 对同一 `(交易日期, 代码)` 各运行一次
- **THEN** 第二次返回 `skipped`（既有锚点），文档中该幂等键下只有一条附注、字节不变

### Requirement: 附注元信息行

附注元信息行 SHALL 为**可解析的键值清单**（逐行 `- <key>: <value>`，键名固定、值不含裸换行）：

| 键 | 取值与格式 | 说明 |
| --- | --- | --- |
| `generatedAt` | 带时区 ISO8601，SHALL 为本地偏移 `+08:00`（如 `2026-09-24T19:32:10+08:00`） | 与 change 4 的 `writtenAt` **共用同一格式化函数**：落 change 4 的 `src/review/format.ts`（导出如 `formatZonedIso(date) -> string`），本 change 仅引用，MUST NOT 另写格式化 |
| `tradeDate` | `YYYY-MM-DD` | 与 frontmatter / 锚点日期段一致（`§2` 归属校验） |
| `code` | `^\d{6}$` | 经 `normalizeCode` 归一 |
| `dataSources` | 逐字段 `字段=源@YYYY-MM-DD`，多个以 `; ` 分隔（如 `quote.close=tdx-tq-local@2026-09-24; limitReason.cause=S7@2026-09-24`） | 可据此复算与审计「哪一天、哪个源、哪次取数」 |
| `missing` | `字段:原因`，多个以 `; ` 分隔；无缺失时写 `none` | 与数据包 `missing` 一致 |
| `cacheReused` | `字段=true|false`，多个以 `; ` 分隔 | TQ 路径的「是否复用当日缓存」人工可核证据 |

#### Scenario: 元信息行可解析

- **WHEN** 用正则逐行解析附注元信息
- **THEN** **六个必填键**（`generatedAt` / `tradeDate` / `code` / `dataSources` / `missing` / `cacheReused`；与 `proposal.md` 的「六键必填」及本 Requirement 键表逐项一致）均可提取，`generatedAt` 匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$`

#### Scenario: 格式化函数单一来源

- **WHEN** 审查 change 4 与本 change 的时间戳格式化
- **THEN** 二者调用 `src/review/format.ts` 的同一导出；本 change 无第二份 ISO 格式化实现（结构断言）

#### Scenario: dataSources 逐字段可追溯

- **WHEN** 附注含多个数据来源字段
- **THEN** 每个 `字段=源@日期` 项可独立解析，且与数据包中该字段的 `source` / `fetchedAt` 日期一致

### Requirement: 幂等

同一交易日同一标的重复运行 SHALL NOT 重复追加附注。幂等判定 SHALL 按 `§2` 的**受限扫描规则**执行：

1. **逐行**扫描，**只认 H2 标题行**（`^##\s`）；
2. **跳过 fenced code block**（``` / ~~~ 围栏，含各类语言标记与更长围栏）内的行；
3. H2 标题行内匹配**前缀** `^ainote-<YYYYMMDD>-<代码>-`（其中 `<YYYYMMDD>` / `<代码>` 一律取自**文档 frontmatter 的 `tradeDate` / `code`**；不比对完整锚点，避免 HHMM 变化导致重复追加）；
4. **归属基准唯一 = 文档 frontmatter 的 `tradeDate` + `code`**（`§2`/`§3`）：锚点日期段/代码段与该基准不一致即为幽灵锚点，SHALL 记入 `warnings: string[]`（`§3` 五个导出返回的字符串数组，`§12.7`；本 change MUST NOT 使用 `storeWarnings[]` 这一字段名），MUST NOT 静默计入；
5. **「扫描基准」与「目标交易日」必然一致的推理链**：写入由 change 4 的 `appendAinote` 执行**写前硬校验**——「目标文档 frontmatter 的 `tradeDate` + `code`」== 入参 `loc`，不一致即抛显式错误 `DOC_MISMATCH` 且 MUST NOT 追加（`§3`）→ 凡成功写入的附注，其文档 frontmatter 必然等于目标 `loc`；而幂等扫描基准（本条 3/4）同为 frontmatter → **在可写入的文档上二者必然一致**，不存在两个基准分叉，故不可能追加第二条同键附注。目标交易日与 frontmatter 不一致的文档**由写前硬校验在写入前拦截**（不追加、不改用其它文档），而非由幂等扫描二次判定；`DOC_MISMATCH` 的告警经 `warnings: string[]` 上抛（`§12.7`）；
6. 命中即返回 `skipped` + 既有锚点；用户删除附注后前缀消失，下次运行自然重新生成（以文档为唯一事实源，MUST NOT 引入插件侧幂等状态文件）。

实现 SHALL 复用 change 4 的 `parseDoc(path)`（service key `traderKit.review.parseDoc`）做分节与围栏解析，MUST NOT 另写第二份扫描实现。

#### Scenario: 二次运行跳过

- **WHEN** 同一交易日第二次运行汇总
- **THEN** 已存在附注的标的被跳过（返回状态与既有锚点），文档内容不变

#### Scenario: 删除后可重新生成

- **WHEN** 用户删除附注后再次运行
- **THEN** 该标的重新生成附注（锚点 HHMM 由写入时刻产生，MUST NOT 产生 `-<seq>`），用户卡片仍零改动

#### Scenario: 正文含锚点字样不误判

- **WHEN** 用户卡片正文中出现 `^ainote-20260924-600000-0930` 字样（复制引用、截图说明）但该行不是 H2 标题行
- **THEN** 判定为「不存在附注」，照常产出附注，MUST NOT 返回 `skipped`

#### Scenario: 代码块内锚点不误判

- **WHEN** 用户正文含 ```` ``` ```` / `~~~` 围栏，块内含 `## 09:30 ^ainote-20260924-600000-0930`
- **THEN** 该行不参与幂等判定，照常产出附注

#### Scenario: 异常代码形态下键一致

- **WHEN** 工具入参为 `sh600000` / `600000.SH` / `SH600000`，而文档中的附注锚点代码段为归一形态 `600000`
- **THEN** 入参经 `normalizeCode` 归一为 `600000`，与锚点代码段一致 → 幂等键相同（第二次运行返回 `skipped`，MUST NOT 重复追加）；未归一（直接以 `sh600000` 比对 `600000`）导致「写进去的锚点与下次扫的键不同 → 每次重复追加」属实现缺陷

#### Scenario: 幽灵锚点不静默

- **WHEN** 文档 H2 行含 `^ainote-20260923-600000-0930`，而该文档 frontmatter 的 `tradeDate` 为 `2026-09-24`（锚点段 ≠ frontmatter 基准）
- **THEN** 该分节不计入本交易日幂等判定（基准 = frontmatter），`warnings: string[]` 记录日期不一致（编码形如 `[ghostAnchor] <path> — …`，`§12.7`）；MUST NOT 静默当作已存在，MUST NOT 使用 `storeWarnings[]` 这一字段名

### Requirement: 写入通道与原子性

附注写入 SHALL 经插件工具 `review_append_ainote` 完成，其实现 SHALL 调用 change 4 `src/review/store.ts` 的**具名导出 `appendAinote(input)`**（service key `traderKit.review.appendAinote`，`§3`），MUST NOT 由 agent 直接写文件、MUST NOT 另写追加/原子写实现。文档定位 SHALL 经 `locateDoc(loc)`、解析 SHALL 经 `parseDoc(path)`、扫描 SHALL 经 `scanDailyCardTargets(tradeDate)`（service key 同名前缀）。写入 SHALL 与页面写入共享同一并发纪律（`§5`：进程内按绝对路径互斥、跨进程 `stat` 快照比对 + 重试 3 次 50/200/800 ms + 5 s 超时、不可解返回 `CONCURRENT_WRITE`）。

**「既有内容不变」的精确口径（`§4`）**：追加 SHALL 满足「原文件字节内容是结果文件的**前缀**」；仅当原文件无尾换行时先补一个**本文件 EOL** 分隔符（该分隔符不计入既有内容）；EOL（`\n` vs `\r\n`）与 BOM 读取探测、写入原样保持；frontmatter 只做**值级最小文本修补**，MUST NOT 整体重序列化。

**依赖不可用时显式报错**：`traderKit.review.*` service 或 `src/review/store.ts` 具名导出不可用时，**四个工具**（含 `review_daily_report`——其自扫清单与告警汇总经 change 4 的 `scanDailyCardTargets`）SHALL 返回显式错误（如 `DEPENDENCY_UNAVAILABLE`，含缺失的模块路径/服务键与 change 4 的对应任务号），MUST NOT 静默降级为自实现的追加逻辑、MUST NOT 静默成功。

#### Scenario: 经工具写入

- **WHEN** 执行落盘
- **THEN** 调用为 `review_append_ainote`（工具或 service），agent 不直接操作文件

#### Scenario: 复用同一实现（文档写入唯一实现）

- **WHEN** 审查写入路径
- **THEN** ① 存在对 `traderKit.review.appendAinote`（或同签名的 `src/review/store.ts` 导出）的调用；② **文档写入（md）的唯一实现 = `appendAinote`**（结构断言：全仓不存在第二份文档追加/原子写实现）；③ `src/summary/run-report.ts` 的 JSON 摘要为**独立**原子写路径（**不同目录、不同锁**：`<数据根>/agent/DB/temp/dsh-trader-kit/…`，不与业务文档写锁共用），不构成第二份文档追加实现，故 ② 与摘要写入可同时成立

#### Scenario: 依赖不可用显式报错

- **WHEN** change 4 的 `src/review/store.ts` 未提供或在运行时未注册 service（依赖未就绪）
- **THEN** `review_daily_scan` / `review_read_daily` / `review_append_ainote` / `review_daily_report` 均返回显式依赖错误（含缺失接口名与所属 change），**不产出任何文件**；前三者的失败经 `review_daily_report` 记入运行摘要 `failed`（原因 `dependencyUnavailable`），而 `review_daily_report` 自身依赖不可用时 SHALL 直接返回该错误且**不写摘要**

#### Scenario: 并发与页面写入一致

- **WHEN** 页面提交卡片与汇总附注几乎同时发生
- **THEN** 两次写入均保留（无覆盖），文档最终同时含新卡片与新附注，且卡片在附注之前

#### Scenario: 分节切片与文件前缀断言

- **WHEN** 断言「用户卡片字节级不变」
- **THEN** 断言方式为 ① **分节切片比较**：写入前各 `^card-` 分节及其正文切片的字节序列与写入后逐一相等；② **文件前缀比较**：结果文件的前 `len(原文件字节)` 字节 == 原文件字节（无尾换行时额外允许一个本文件 EOL 分隔符）。MUST NOT 只做整文件字符串包含/长度比较

#### Scenario: CRLF / BOM / 无尾换行

- **WHEN** 目标文档分别为 CRLF、带 UTF-8 BOM、末行无换行
- **THEN** 写入后 CRLF 不混排、BOM 仍存在且唯一、无尾换行先补本文件 EOL 再追加；三种 fixture 各自独立断言

### Requirement: skill 落点与可发现性

工作流 skill SHALL 以 `SKILL.md` 形式落在 `<数据根>/agent/skills/review-daily-summary/`（自产业务 skill 区，经 `data-root-layout` 映射表解析，`MUST NOT` 自行拼接路径），frontmatter SHALL 含合法的 `name`（`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`）与 `description`。

**可发现性核对**：SHALL 经宿主 skills 服务（可选注入 `ctx.get('skills')`，只读 `list()` / `get()`）列出该 skill，并断言其**解析路径 == 数据根落点**（同一实操先例见 change 3 `tq-skill-installer` 的 `status` 出口）；宿主服务不可用时 SHALL 退化为文件系统检查（比对落点路径是否存在），MUST NOT 硬依赖宿主内部服务。该 skill 经 `customSkillDirs`（宿主 rank 300）被发现，属**前提条件**；当同名前 skill 位于 rank 100（`<projectRoot>/.dsh/skills`）或 rank 200（`<projectRoot>/.agents/skills`）时，SHALL 输出**显式遮蔽警告**（含解析到的实际路径、被遮蔽的落点与处置建议），MUST NOT 只写「人工核对并记录」。

**健康/状态提示并入 change 3**：本 change MUST NOT 另建一套健康/状态出口；skill 缺失与遮蔽提示 SHALL 并入 change 3 的 `skill.status()`（service）与 `tq_skill_manage(action:"status")`（tool）的**同一实现**的状态视图。

#### Scenario: skill 文件合法

- **WHEN** 检查落点的 `SKILL.md`
- **THEN** frontmatter 的 `name` 为 kebab-case 合法名、`description` 说明触发时机，正文含 W1–W5 流程、数据包 schema、写作骨架与负向词表、预算与分批、重算指引

#### Scenario: 经 skills 服务核对解析路径

- **WHEN** `customSkillDirs` 已包含 `<数据根>/agent/skills` 且会话加载 skill 列表
- **THEN** 断言 `skills.list()` 命中 `review-daily-summary` 且其解析路径 == `<数据根>/agent/skills/review-daily-summary/`（证据：服务返回的路径字段）

#### Scenario: 被 rank 100/200 遮蔽时显式警告

- **WHEN** 同名前 skill 存在于 rank 100/200 目录，宿主解析到的是该副本而非数据根落点
- **THEN** 状态输出含显式遮蔽警告（实际解析路径 + 期望落点 + 建议动作），MUST NOT 静默

#### Scenario: 未配置发现路径

- **WHEN** `customSkillDirs` 未包含该目录
- **THEN** 状态输出给出显式提示与配置指引，插件其余功能不受影响

#### Scenario: 宿主服务不可用降级

- **WHEN** skills 服务不可注入或调用失败
- **THEN** 退化为文件系统检查（落点 `SKILL.md` 是否存在 + 路径比对），状态标注「已安装但可发现性未核验」，MUST NOT 报错阻断

### Requirement: 部署语义（不自建第二套覆盖逻辑）

本 change MUST NOT 自建第二套部署/覆盖逻辑。部署 SHALL 依赖 change 3 安装器**泛化为「本地目录源 + 原子替换」**（local-dir 源：仓库 `skills/review-daily-summary/` 为源目录；原子替换；三态 = 一致 / 用户改动（**不覆盖 + 输出 diff**）/ 可升级）。

若 change 3 未提供该泛化能力，本迭代 SHALL 降级为**人工放置**（复制命令 + 目标路径写进 README，且 MUST NOT 覆盖已存在的用户改动版本），并记入 Open Questions（Issue 9 处置）。

#### Scenario: 依赖 change 3 的本地目录源安装

- **WHEN** 调用 change 3 的安装器（local-dir 源）部署本 skill
- **THEN** 三态判定可复现：源与目标一致 → 跳过（零写入）；目标被用户改动 → 不覆盖、输出 diff 与源哈希；源已升级 → 原子替换并记录新旧哈希

#### Scenario: 降级为人工放置

- **WHEN** change 3 未泛化本地目录源
- **THEN** README/文档含可复制的放置命令与目标路径；MUST NOT 覆盖已存在的用户改动版本；验收证据 = 命令 + 输出片段 + 目标文件路径

### Requirement: 下游解析口径（锚点前缀区分）

一切下游解析（页面 B4 卡片回显、语料导出、统计、模式识别/F2.2）SHALL 以**锚点前缀**区分分节，并**默认排除** `^ainote-`；`^card-` 为唯一用户卡片前缀。「卡片数」口径 SHALL 明确为**用户卡片数**（不含附注），并写成断言。附注 SHALL NOT 影响 frontmatter 语义（写入附注 MUST NOT 改动 frontmatter 既有键值，`§4`）。

#### Scenario: 下游默认排除附注

- **WHEN** 任一消费方（B4 / 语料导出 / 统计 / 模式识别）解析当日文档
- **THEN** `^ainote-` 分节被排除，结果中不出现附注内容与附注锚点（断言：导出结果中 `^ainote-` 命中数为 0）

#### Scenario: 卡片数口径

- **WHEN** 某文档含 3 张用户卡片与 1 条附注
- **THEN** 「卡片数」为 3（附注不计入）；`scanDailyCardTargets().cardCount` 与页面 B4 显示数一致且相等

#### Scenario: 附注不改动 frontmatter

- **WHEN** 写入附注后检查 frontmatter 原始文本
- **THEN** 既有键值逐字节不变（值级最小修补之外的键序、引号、未知键均不变）
