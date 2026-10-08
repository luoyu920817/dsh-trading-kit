## MODIFIED Requirements

### Requirement: 触发方式

本迭代的每日汇总 SHALL 由会话内手动触发（用户请求或 skill 被 agent 调用）；MUST NOT 依赖宿主定时任务（W-Q1 裁决：先跑通工作流，定时任务随宿主能力后接）。工作流定位为盘后执行，skill 说明 SHALL 写明「盘后执行、单标的取数、不做全市场扫描」。

**（review-loop 修订，2026-10-06）** 会话内触发另有两种等价入口，二者 MUST 落到同一 skill、同一规范：

- **会话口令**（既有）：用户在会话中直接请求；
- **DSH 面板按钮**（本 change 新增，见 `review-panel` cap）：面板「整理今日复盘」按钮经客户端会话服务 `ctx.conversation.send(text)` 发送**一条固定模板 prompt**（模板 SHALL 在 skill 内声明，面板复用同一文本）；该 prompt 即为一次普通用户请求，MUST NOT 绕过 skill 执行、MUST NOT 由插件自建 agent 运行、MUST NOT 携带日期字面量（交易日缺省仍由 T0 解析）。

#### Scenario: 手动触发执行

- **WHEN** 用户在会话中触发每日汇总（指定或不指定交易日）
- **THEN** 工作流按本规范执行并给出结果摘要（产出数、跳过数、失败数、`deferred` 数），且 `created[]` / `skipped[]` / `failed[]` / `deferred[]` 与运行摘要文件（见「运行摘要与具名生产者出口」）在**同一次运行的返回**中逐项一致

#### Scenario: 无卡片时零打扰

- **WHEN** 目标交易日没有任何标的卡片
- **THEN** 工作流结束并说明「当日无卡片」，不产出任何附注、不报错、不提示补录

#### Scenario: 交易日不可得与「无卡片」显式区分

- **WHEN** 目标交易日**不可得**（`resolveTradeDate` 返回 `businessDate === null` 且未指定 `date`）
- **THEN** 工作流 SHALL 显式要求用户指定交易日，并说明「交易日不可得」（MUST NOT 输出「当日无卡片」这一易误导结论），MUST NOT 以系统日期或限流日顶替

#### Scenario: 面板按钮触发与口令触发等价

- **WHEN** 用户在 DSH 面板点击「整理今日复盘」并确认会话中出现固定模板 prompt
- **THEN** agent 按本规范的同一流程执行，产出与「会话口令触发」在相同输入下一致（附注幂等口径、运行摘要四态、盘面 md 覆盖语义均不变）

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
| `profile` | object? | 标的档案命中项 `{role?, path}`（`role` = 档案**新增键 `角色`** 原文；展示字段 `热点标签`/`板块`/`当前题材`/`题材地位`/`# 股性` **MUST NOT** 进入数据包）；来自 `review_stock_profiles`（本 change `stock-profile` cap，service key `traderKit.review.stockProfiles`） | **可选**：未命中即不出现该键（MUST NOT 写空对象/空串占位）；出现时 `role` 只作生成口径（MUST NOT 当行情事实、MUST NOT 复述为用户判断），且**不改变** `missing` 判定（档案缺失不是数据缺失、不进 `failed`） |
| `missing` | array | 元素 `{field, reason}`；`reason` 枚举：`sourceUnavailable` / `dateMismatch` / `noRecord` / `fieldAbsent` | 空数组表示数据完整；非空即正文标「部分」 |

**判定规则**：① `available=false` **不等于**取数失败（`noRecord` 只进 `missing`），但**必须**先按 `errors` 分档（`dateUnavailable` 属数据不可得，不得写成「无涨停记录」，`§12.8`）；② `missing` 只登记**逐字段**缺失（整块不可得时逐字段登记 `sourceUnavailable`），MUST NOT 用「整块失败」笼统代替；③ 任意数值字段 MUST NOT 用 `0` 冒充缺失（沿 `data-tool-contract` 空值守卫）；④ `source` 与 `fetchedAt` 逐字段携带，MUST NOT 出现无来源的数值；⑤ `cacheReused` 为**必填键**，无 TQ 路径参与时写 `none`；⑥ `profile` 为**可选键**，其存在与否不影响 `missing` 语义与四态判定（档案缺失不是取数失败）。

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

#### Scenario: 标的档案注入（新）

- **WHEN** 某标的命中 `DB/stock/` 档案（`review_stock_profiles` 返回条目）
- **THEN** 该标的的数据包带 `profile: {role?, path}`（仅 `角色` 内容）；附注按 `stock-profile` 的注入语义标注角色要点与档案来源路径；**WHEN** 未命中 **THEN** 数据包不含 `profile` 键、附注无任何档案痕迹，且两种情况下的 `missing` 与四态判定完全一致

## ADDED Requirements

### Requirement: W6 盘面整理收尾（新）

工作流收尾 SHALL 在附注写入与运行摘要提交**之后**增加一步（W6）：把当日卡片/附注与标的档案上下文汇总为四段（指数 / 情绪 / 赚钱效应 / 题材），并调用工具 `review_write_brief`（service key `traderKit.review.writeBrief`，见 `daily-brief` cap）写当日盘面 md。该步 MUST 只产出盘面 md，MUST NOT 修改任何卡片文档或附注分节、MUST NOT 扩展运行摘要 schema；其成败与附注/摘要**相互独立**（见 `daily-brief` 的独立性要求）。当日 `targets=[]`（无卡片）时 SHALL 跳过该步（零打扰，与既有口径一致）。四段的事实来源 v1 限定为现有源：锚点档案（`锚点: true`）当日表现（TQ skill 路径，逐项 `source`/`fetchedAt`）、当日卡片与附注、既有 T1/T2 数据；MUST NOT 引入新的出站源、MUST NOT 读取本地 TDX 文件。skill 文本 SHALL 写明 W6 的步骤、四段骨架、来源纪律与缺失标注口径。

#### Scenario: 收尾产出盘面 md

- **WHEN** 一次运行中附注成功产出 2 个、运行摘要已提交
- **THEN** 工作流随后调用 `review_write_brief` 并落 `<数据根>/DB/review/<YYYYMM>/<YYYYMMDD>-summary.md`，会话返回中同时出现附注结果与盘面 md 路径；`/api/day` 的 `brief.exists=true`

#### Scenario: 无卡片日跳过

- **WHEN** `targets=[]`
- **THEN** 工作流在说明「当日无卡片」后结束，MUST NOT 调用 `review_write_brief`

#### Scenario: 摘要口径不变

- **WHEN** 对比本 change 前后的 `daily-summary-run.json`
- **THEN** schema 与字段名逐项一致（无新增/改名键）；盘面 md 的存在性不经运行摘要表达
