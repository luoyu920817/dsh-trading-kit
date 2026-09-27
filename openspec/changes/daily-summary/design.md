## Context

每日汇总把「现场卡片」变成「当日结论」，是 P2（闭环回到盘面）在第一迭代内的执行端：卡片刻录现场判断，附注补上程序化事实与结构化的当日总结，次日打开同一标的即可读回。它同时是 F2.2（模式片段识别）的唯一上游语料。

迭代一的重排（本 change 在阶段路线中的位置）见 `docs/roadmap.md §5`：本迭代刻意不按 §2 阶段顺序推进，交付「阶段 3 数据面子集 + 阶段 4 写分区子集 + 阶段 5 复盘 skill 子集」；vault 写入对本迭代**三条**白名单路径（`DB/review/`、`agent/DB/temp/dsh-trader-kit/`、`agent/skills/`）开例外（`iteration-1-contracts §10`）——`agent/skills/` 即本 change 的 skill 落点区，故「不写 vault」断言的正确范围是「`dataRoot` 下既定业务区之外零写入」，白名单区 MUST 排除在 diff 之外（`§10`）。跨 change 事实源一律为 `docs/design/iteration-1-contracts.md`（下称 `§n`）。

关键前提与事实（按 `§8` 分「已实测 / 待验证」）：

- **change 4** 定义了卡片存储的**具名接口**（唯一版本 = `iteration-1-contracts §3`）：模块 `src/review/store.ts` 的 `locateDoc` / `parseDoc` / `appendCard` / `appendAinote` / `scanDailyCardTargets`（**五个导出一律返回 `warnings: string[]`**，`§12.7`）、写前归属硬校验 **`DOC_MISMATCH`**、`src/review/anchor.ts` 的 `normalizeCode`（`§2`）、`src/review/format.ts` 的 `formatZonedIso` / `formatAnchorTime`，service key `traderKit.review.*`；本 change **依赖这些具名导出**（`blocked_by: change 4`），MUST NOT 另写追加/解析/格式化/原子写实现。**准入条件**：change 4 的 spec/tasks 若未同步 `§3` 的这三项（五导出 `warnings`、`format.ts`、`DOC_MISMATCH`），视为依赖未落地 → 本 change 工具显式报 `DEPENDENCY_UNAVAILABLE`（D-1b），MUST NOT 自行补写（同步请求见 Open Questions 12）。
- **change 2** 提供 T1（涨停原因，S7→S5）与数据目录范式（`<数据根>/DB/review/`、缓存区）；**change 3** 提供 TQ skill（`get_more_info` 等当日表现字段由 agent 经该 skill 读取执行）。
- **口径衔接**：模块文档 W3 写的「SK1 当日表现 + SK2 涨停原因」是已作废的旧术语（SK1/SK2 搬运/固化方案已废弃）；现行映射 = **当日表现经 tq-local skill**（`get_more_info`）+ **涨停原因经 T1 工具**。
- **AI 附注契约**（2026-09-26 裁决 B，安全版形态）：同文档末尾独立分节、标注 `generatedAt` 与 `dataSources`、只追加、用户可删。

### 已实测（含证据）

- **宿主 skill 根与 rank 优先级**：skill 发现路径按 rank 100 `<projectRoot>/.dsh/skills` → 200 `<projectRoot>/.agents/skills` → 300 `config.customSkillDirs` → 400/500/600；**同名前 rank 优先**。证据 = change 3 的实测记录（`tq-skill-installer/design.md`「实现必须对齐的宿主事实」小节，含符号引用与实测日期）与同仓既有落点实例：`.dsh/skills/*/SKILL.md`、`.agents/skills/zz-dsh-probe/SKILL.md`（本仓可见）。符号：`packages/skill/skill-filesystem/src/index.ts` 的 skill 根解析与 rank 组装段（**按符号引用，不写行号**，`§8`）。
- **`SKILL.md` frontmatter 校验**：宿主只要求 `name`（`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`）与 `description`，未知键静默忽略。符号：同文件的 frontmatter 校验段；结论与 change 3 design 一致。
- **skills 服务只读面**：`ctx.skills.list()` / `get()` 可用于确认 skill 是否已被发现。符号：`packages/skill/skill/src/index.ts` 的 skills 服务定义段。
- **工具注册**：`ctx.tools.register(defineTool({...}))`。符号：`packages/core/tools/src/schema.ts` 的 `defineTool`。

> `§8` 纪律：上列宿主事实的**行号不写入本文**（行号易失效）；本 change 与 change 3 对同一事实的引用统一为符号名，MUST NOT 出现两处互斥行号。

### 待验证（含降级策略）

- **skills 服务的实例化路径字段形态**（`list()` 返回项是否含可直接比对的路径/来源字段）：本会话沙箱不可达宿主 checkout，未能独立复核。降级策略 = 可发现性核对以 `get(name)` 的返回结构为准，字段缺失时退化为**文件系统落点比对**，并在状态中标注「可发现性未核验之精度限制」（对应 tasks 1.4 的降级分支）。
- **rank 100/200 遮蔽的实际发生条件**：已知「同名前 rank 优先」为事实，但「哪些目录会在目标机器上真实存在同名副本」未实测；降级策略 = 每次核对都输出实际解析路径与期望落点，一旦不同即显式遮蔽警告（不依赖预判）。
- **`customSkillDirs` 是否接受多个目录、是否支持 glob**：未复核；降级策略 = 文档只写「加入 `<数据根>/agent/skills` 这一具体目录」的单一形态，不承诺多目录/通配。
- **change 3 安装器是否泛化为「本地目录源 + 原子替换」**：当前 `tq-skill-installer` 的 spec/tasks 只覆盖「远程 zip 源 + 原子替换」。降级策略 = 若未泛化，本 change 的部署降级为**人工放置 + README 记录命令**（见 D-4 与 Open Questions）。

## Goals / Non-Goals

**Goals:**

- 一次可重复运行、结果幂等的「卡片 → 取数 → 总结 → 附注」闭环。
- 机械不变量（扫描、解析、幂等判定、原子写）落在代码层；判断与叙述留给 agent。
- 用户主观记录绝对安全：可断言「用户卡片分节**切片**字节级不变」（口径与断言方式见 D-6b）。
- 失败可见：四态（`created` / `skipped` / `failed` / `deferred`）结果有**落盘载体**（运行摘要）与**具名生产者出口**（tool `review_daily_report` / service `traderKit.review.dailyReport`，`§12.6`），失败标的必带原因（D-8 / D-9）。
- 依赖显式：change 2/3/4 的依赖可用性（含 `src/review/format.ts`、`traderKit.data.guardStatus()`、change 3 的 `deployLocalDir`）是准入条件，不可用时工具**显式报错**（D-1b）。

**Non-Goals:**

- W6 汇总页（`<YYYYMMDD>-summary.md`，P2 后置）：本迭代不做，验收不依赖它。
- DSH 定时任务触发（W-Q1：迭代一先会话手动；定时触发还牵涉交易日判定来源，见 Open Questions）。
- 模式识别 / 关联草稿（F2.2/F2.3）、点击联动与盘中页面（F5/M7）。
- `force` / `overwrite` 重算入参（本迭代后置，重算语义 = 用户删除附注分节后重跑；见 D-10 与 Open Questions 第 4 条）。
- 任何交易语义；附注不改写、不评分、不给出执行指令。

## Decisions

### D-1 分工：判断在 agent，不变量在代码

**四个**工具承担全部机械动作，且**与 service 同一实现**（`§3`）；其中 `review_daily_report` 是运行摘要的**唯一生产者**（`§12.6`）：

| 工具 | service key（同一实现） | 入参 | 返回 |
| --- | --- | --- | --- |
| `review_daily_scan` | `traderKit.review.scanDailyCardTargets`（缺省交易日另经 `traderKit.data.resolveTradeDate`） | 可选交易日（canonical `YYYY-MM-DD`；缺省调 T0 解析，**MUST NOT** 用系统日期） | 标的清单：代码、名称、文档路径、**用户卡片数**（不含附注）、是否已有附注、`warnings[]`（`§3` 的 `warnings: string[]`，`§12.7`） |
| `review_read_daily` | `traderKit.review.locateDoc` + `traderKit.review.parseDoc` | 代码、交易日 | 用户卡片集合：锚点、`writtenAt`、正文（**排除** `^ainote-` 分节）、`warnings[]` |
| `review_append_ainote` | `traderKit.review.appendAinote` | 代码、交易日、正文、`generatedAt`、`dataSources`、（内部）`missing` | 状态（`created` / `skipped`）、锚点、文档路径、`warnings[]` |
| `review_daily_report` | `traderKit.review.dailyReport`（**本 change 注册**，`§12.6`） | `{ tradeDate, entries: [{ code, status: 'created'｜'skipped'｜'failed'｜'deferred', reason? }], missing?: [{ code, field, reason }], warnings?: string[] }`（后两者为**可选回填通道**，不改变 `§12.6` 必填入参） | 合并写入当日运行摘要；**出口自身**调用 `traderKit.review.scanDailyCardTargets(tradeDate)` 取清单，未出现在 `entries` 的代码补 `failed`（`entryMissing`）；返回 `{ tradeDate, created[], skipped[], failed[], deferred[], missing[], warnings[] }` |

skill（md 指令）只描述：触发时机、逐标的流程、数据包组装要求、写作与合规约束、预算与分批、失败处理与重算指引。理由：幂等/append-only/原子写是可测不变量，靠 prompt 自律必然漂移；而「总结写成什么样」是判断，硬编码则会僵化。

### D-1b 依赖可用性是准入条件（不可用即显式报错）

本 change 对被依赖方的引用一律写成「**模块路径 + 导出签名 + service key**」（`§3`），无具名接口的「复用」视为无效表述。**四个**工具在以下任一依赖不可用时 SHALL 返回显式错误 `DEPENDENCY_UNAVAILABLE`（含缺失接口名与其所属 change），**不产出任何文件**；其中 `review_daily_scan` / `review_read_daily` / `review_append_ainote` 的该次失败经 `review_daily_report` 记入运行摘要 `failed`（原因 `dependencyUnavailable`），而 `review_daily_report` 自身依赖不可用时 SHALL 直接返回该错误并**不写摘要**：

- change 4：`src/review/store.ts` 的 `locateDoc` / `parseDoc` / `appendCard` / `appendAinote` / `scanDailyCardTargets`（含五导出的 `warnings: string[]` 与写前硬校验 `DOC_MISMATCH`）、`src/review/anchor.ts` 的 `normalizeCode`、`src/review/format.ts` 的 `formatZonedIso` / `formatAnchorTime` 与 service key `traderKit.review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets}`；
- change 2：`traderKit.data.resolveTradeDate`（T0）、T1 `get_limit_reason`、`src/data/date.ts` 的日期换算单点、**预算预检出口 `traderKit.data.guardStatus()`**（字段含 `remaining` / `budgetLimit` / `budgetUsed` / `minIntervalMs` / `sessionState` 等；缺失或字段不全时预算预检 SHALL 显式失败 `DEPENDENCY_UNAVAILABLE`，MUST NOT 自建预算计数、MUST NOT 静默跳过预检；字段契约确认见 Open Questions 13）；
- change 3：tq-local skill 已安装（当日表现路径，缺失时按 D-10 部分成功处理）、`src/skill/local-source.ts` 的 `syncLocalDir(input)` / service `traderKit.skill.deployLocalDir`（部署路径）、`checkDiscovery` / `findShadowedCandidates`（可发现性核对）。

理由：被复用对象当前在仓内**尚不存在**（`change 4` 的 `src/review/store.ts` 仍是未勾选任务），若不显式失败，本 change 会退化成「静默自实现第二份追加逻辑」，正是评审 Issue 1 的核心风险。

### D-2 幂等判定：受限扫描 + 按锚点前缀（作用域收窄）

附注锚点形如 `^ainote-<YYYYMMDD>-<代码>-<HHMM>`（本体四段式；正则里的可选 `-<seq>` 仅供解析兼容，**写入侧 MUST NOT 产生**）。幂等判定 SHALL 按 `§2` 的**受限扫描规则**执行：① 逐行扫描，**只认 H2 标题行**（`^##\s`）；② **跳过 fenced code block**（``` / ~~~ 围栏）内的行；③ 在 H2 行内匹配前缀 `^ainote-<YYYYMMDD>-<代码>-`（不比对完整锚点，避免运行时刻变化导致重复追加）；④ **归属基准唯一 = 文档 frontmatter 的 `tradeDate` + `code`**（`§2`/`§3`）：锚点段与该基准不一致即幽灵锚点，记入 `warnings: string[]`（`§3` 五导出的 `warnings`，`§12.7`；MUST NOT 使用 `storeWarnings[]` 这一字段名）不静默。**「扫描基准」与「目标交易日」必然一致**：写前硬校验 = 「文档 frontmatter 的 `tradeDate` + `code`」== 目标 `loc`，不符则 `appendAinote` 抛 `DOC_MISMATCH`、MUST NOT 追加；故成功写入的文档 frontmatter 必然等于目标 `loc`，而扫描基准同为 frontmatter → 二者在可写入的文档上恒等，不存在基准分叉，也不可能追加第二条同键附注；目标交易日与 frontmatter 不一致的情况由硬校验在写入前拦截。命中即返回 `skipped` + 既有锚点。用户删除附注后前缀消失，下次运行自然重新生成（无需额外状态）。

理由：以文档为唯一事实源，不引入插件侧状态文件；而**限定作用域是必需的**——用户正文引用锚点字样（复盘复制引用、贴截图说明）若被当作已存在，该标当日将**永久漏产出**且用户看到的是成功态。实现 SHALL 复用 change 4 的 `parseDoc`（`§3`）做分节/围栏解析（其返回的 `warnings[]` 即幽灵锚点告警出口），MUST NOT 另写第二份扫描实现。代码规范化 SHALL 复用 change 4 `src/review/anchor.ts` 的 `normalizeCode`（`§2`），保证「写进去的锚点」与「下次扫的键」同源同形。

### D-2b 交易日来源：唯一实现，去掉循环依赖

`review_daily_scan` 的缺省交易日 SHALL 调用 change 2 的 T0 `traderKit.data.resolveTradeDate({ date? })`（tool `get_trade_date`，`§1`），与 change 4 的 `TradeDateResolver` seam **同一实现**。入参与返回日期一律 canonical `YYYY-MM-DD`（兼容 `YYYYMMDD` 输入，归一 MUST 经 `src/data/date.ts` 的 `fromCompactDate`）。MUST NOT 用系统日期 fallback、MUST NOT 用「逐标的 T1 `tradeDate`」推导扫描日期（那是循环依赖：先要日期才能扫出标的，先要标的才能取到 T1 日期）。不可得（`businessDate === null`）→ 显式要求用户指定交易日；`isTradingDay === null` → 显式标注归属待确认（本迭代无交易日历，MUST NOT 由 `null` 得出「非交易日」）。三种状态在返回信息中 SHALL 可区分且命名唯一：**交易日不可得（盘前 / 源未出数）** / **归属待确认（业务日 X、限流日 Y）** / **该交易日无卡片**——MUST NOT 使用「非交易日 / 长假」这一不可判定命名（`§1`）。

### D-3 附注锚点：形态统一、时间来源与跨午夜

锚点正则唯一版本（与 change 4 写入/解析共用，`§2`）：`^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$`。四段式 + 可选序号 `-<seq>`（保留该形态以兼容解析），但**附注写入侧 MUST NOT 产生 `-<seq>`**：同一 `(tradeDate, code)` 幂等键下至多一条附注，故不存在「同分钟第二条」，序号仅由 change 4 的同分钟多卡使用。`HHMM` 取写入时本地时钟（固定 `Asia/Shanghai`），SHALL 经 change 4 `src/review/format.ts` 的 `formatAnchorTime(date)` 产出；**归属由 `YYYYMMDD` 决定**，标题时间可属次日。跨午夜（23:59 与次日 00:05）两次运行若目标交易日相同，第二次返回 `skipped`，不产生第二条附注。`generatedAt` 用带时区 ISO8601、偏移固定 `+08:00`，SHALL 经同一模块的 `formatZonedIso(date)` 产出（本 change 只引用，MUST NOT 自写格式化）。

### D-4 部署语义：不自建第二套覆盖逻辑

仓库 `skills/review-daily-summary/SKILL.md` 是版本化源（frontmatter 含 `version`，即版本载体）；部署 SHALL **依赖 change 3 的具名本地目录源能力**——`src/skill/local-source.ts` 的 `syncLocalDir(input): Promise<LocalDeployResult>` 与 service key `traderKit.skill.deployLocalDir`（工具 `tq_skill_manage(action:'deploy')`），三态枚举 `in-sync`（零写入）/ `user-modified`（**不覆盖 + 输出 diff 与源哈希**）/ `upgradable`（原子替换并记录新旧哈希与版本）。本 change MUST NOT 自建第二套覆盖/哈希逻辑。若 change 3 未提供该能力，则**降级为人工放置**（可复制命令 + 目标路径进 README，MUST NOT 覆盖用户改动版本），并记 Open Questions（Issue 9）。

理由：vault 里被用户打磨过的版本才是最终形态（P4「资产可生长」），但「不覆盖」必须可判定——没有源哈希/版本记录就无法区分「用户改了」与「仓库源升级了」，会退化成每次部署都停在「提示差异」的死路。三态 + 哈希判定把这条语义变成机械不变量（在 change 3 的安装器里，而非本 change）。

### D-5 取数：逐标的、盘后、受护栏约束、预算预检

流程对每个标的独立取数（当日表现经 TQ skill、涨停原因经 T1 且**显式传 `date=<目标交易日>`**），不做全市场扫描（change 2 的频控护栏对批量/全市场级调用有硬约束）。运行开始前 SHALL 做**预算预检**：经 change 2 的具名出口 `traderKit.data.guardStatus()` 读取 `remaining` / `budgetLimit` / `budgetUsed` / `minIntervalMs` / `sessionState` 等字段（`§9`：预算与最小间隔按**列表级请求数**计）；该出口不可用 → 预检显式失败 `DEPENDENCY_UNAVAILABLE`（不得自建计数、不得静默跳过）。预算不足时显式提示「本次可处理前 N 个标的」并允许**分批续跑**，MUST NOT 静默排队、MUST NOT 静默截断。单个标的失败只影响该标的（按 D-10 判定矩阵写入状态与原因，不写坏文档）。

### D-5b 零网络断言的适用范围（收窄）

缓存契约属**插件数据模块**（`data-tool-contract`），故「命中当日缓存出站请求计数 0」**只对 T1/T2 侧可自动断言**（列表级缓存，键 = `source + requestedDate`——调用方入参可构造；`§9` 明令 MUST NOT 用 `businessDate` 做键）。当日表现走 tq-local skill（agent 执行的技能路径），本插件**无该路径的调用入口与出站计数 seam**，因此：spec 不声称 TQ 侧零网络，改为要求 skill 输出 SHALL 标注**数据获取时间**（`fetchedAt`）与**是否复用当日缓存**（`cacheReused`），验收降级为**人工证据**（粘贴字段样例 + skill 名与版本）。tasks 中自动/人工两类验收显式区分。

### D-6 数据包结构（见诸 spec 的 schema，工具只提供原料）

数据包由 skill 组装，字段/类型/单位/`missing` 枚举与判定表**写入 spec 的「数据包 schema」Requirement**（含 `available=false` 语义与 TQ 字段来源、`skillVersion`）。`missing` 元素 SHALL 为 `{field, reason}`，`reason` 枚举 `sourceUnavailable` / `dateMismatch` / `noRecord` / `fieldAbsent`；`available=false` **不等于**取数失败。组装结果 MUST 通过 schema 校验（零 mock 单测覆盖合法/非法样本）。

### D-6b 「用户卡片字节级不变」的精确口径与断言方式

追加到文档末尾在实现上必然改动「最后一节的行尾」，故本节替代含糊的「字节级不变」（`§4`）：

- **追加（附注）**：原文件字节内容是结果文件的**前缀**；仅当原文件无尾换行时先补一个**本文件 EOL** 分隔符（该分隔符不计入既有内容）。
- **EOL / BOM**：读取探测 `\r\n` vs `\n` 与 BOM；写入 MUST 保持同一 EOL 风格、BOM 原样（不丢失、不新增）。
- **frontmatter**：只做**值级最小文本修补**（改值、补键），MUST NOT 整体重序列化（键序/引号/缩进/注释/未知键不变）。
- **断言方式（替代含糊表述）**：① **分节切片比较**——写入前后各 `^card-` 分节及其正文的字节序列逐一相等；② **文件前缀比较**——结果文件前 `len(原文件字节)` 字节 == 原文件字节（无尾换行时额外允许一个本文件 EOL）。MUST NOT 只做整文件字符串包含或长度比较。
- **fixture 要求**：CRLF / BOM / 无尾换行三类各一条独立用例（tasks 2.7）。

### D-7 合规与写作约束（写进 skill 正文，可扫描验收）

- **正向骨架**：① 事实（数据来源与日期）→ ② 当日表现（逐项带来源）→ ③ 待跟踪（不构成建议）。
- **负向词表**（含变体）：`必须买`、`建议买入`、`目标价`、`必涨`、`可重仓`、`确定性加仓`、`满仓`、`稳赚`、`保证收益`。
- **固定定位声明**：附注 SHALL 含一行「研究辅助、不构成投资建议」；另含固定「数据完整性：完整｜部分（缺 X）」行。
- 缺失数据显式标注，不推算、不补猜；不改写、不评价用户主观记录。
- **验收可执行**：对 N（≥5）份真实产出运行负向词表扫描脚本（零命中）+ 人工复核（无复述主观判断、无补猜）；证据 = 命令 + 输出（命中数）+ 被检查路径清单。

### D-8 结果摘要四态

运行结束返回 `created` / `skipped` / `failed(原因)` / `deferred(原因)` 四类清单与计数；`created`/`skipped` 至少含 `{code, path, anchor}`，`failed`/`deferred` 至少含 `{code, reason}`（`reason` 非空）。

### D-9 四态载体：运行摘要落盘

「失败标的带原因」不能只存在于 agent 对话文本，故定义**运行摘要**载体：

- 路径：`<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`（沿 `§10` 的 temp 区约定与 `data-root-layout` 的「数据工具缓存产物」区；日期目录 = 运行归属交易日，经 `data-root-layout` 映射表解析）。
- schema：`{ tradeDate, created[]（含 {code,path,anchor}）, skipped[]（同左）, failed[{code,reason}], deferred[{code,reason}], missing[{code,field,reason}], warnings[] }`；`failed` / `deferred` 每条 `reason` 非空（与 spec「运行摘要与具名生产者出口」的 schema 逐键一致）。
- 写入为原子写（临时文件 + 改名），与业务文档写入**不共用同一把锁**（避免摘要写失败阻塞文档写）。
- 空清单也落摘要（区分「当日无卡片」与「运行未发生」）。

### D-10 失败判定矩阵、重算指引与 `force` 后置

TQ × T1 的 `available`/`error` 组合按 spec「失败判定矩阵与重算指引」的表格判定：任一路成功 → `created`（部分，带 `missing` 与「数据完整性：部分（缺 X）」行）；两路皆失败 → `failed`（不写文档）。**T1 `available=false` MUST 先按 `errors` 分档（`§12.8`）**：含 `dateUnavailable` → 该字段降级 `missing`（原因 `sourceUnavailable`），正文写「该日涨停原因数据不可得」，**MUST NOT 写「无涨停记录」**、不计 `failed`；不含 `dateUnavailable` 才是正常「无涨停记录」（原因 `noRecord`，**不是**失败）。附注一旦写入，重跑只返回 `skipped`，故 skill 与工具返回 SHALL 给出显式指引「如需重算：删除该附注分节（block `^ainote-<YYYYMMDD>-<代码>-<HHMM>`）后重跑」。`force` / `overwrite` 入参**本迭代后置**（Open Questions），工具 schema MUST NOT 含该参数（沿 `§9`「无幽灵参数」）。

### D-11 变更与依赖分组（写/读范围）

- **本 change 的写范围**：仅 `src/tools/review-daily.ts`（四工具 + service 出口装配）、`skills/review-daily-summary/SKILL.md`、`src/summary/run-report.ts`（运行摘要落盘）、`src/summary/package-schema.ts`（数据包 schema 校验）、本 change 的测试。
- **本 change 的读依赖（不写）**：change 4 的 `src/review/store.ts` / `src/review/anchor.ts` / `src/review/format.ts`；change 2 的 `traderKit.data.resolveTradeDate` 与 `get_limit_reason`、`traderKit.data.guardStatus()`（预算预检）、`data-root-layout` 映射表；change 3 的安装器与 `skill.status()`。
- 并发纪律：**文档写入** SHALL 复用 change 4 的 `appendAinote`（内含 `§5` 纪律：进程内按绝对路径互斥 + 跨进程 `stat` 快照比对 + 原子写）；**运行摘要写入**的互斥 SHALL 复用 `§5` 的**纪律**（进程内按绝对路径互斥、写入用临时文件 + 改名、失败不阻断已完成的文档写入），自行实现于 `src/summary/**`，**与文档写锁不共用**（`§3` 未导出锁助手，故 MUST NOT 声称复用某个具名锁导出）。

### D-12 skill 落点、可发现性与状态出口（并入 change 3）

- 落点：`<数据根>/agent/skills/review-daily-summary/SKILL.md`（经 `data-root-layout` 映射表解析，MUST NOT 自行拼接）。
- **可发现性核对（替代「人工核对并记录」）**：经宿主 skills 服务（可选注入 `ctx.get('skills')`、只读 `list()`/`get()`，符号见 Context「已实测」）列出该 skill 并**断言解析路径 == 数据根落点**；被 rank 100（`<projectRoot>/.dsh/skills`）或 200（`<projectRoot>/.agents/skills`）的同名副本遮蔽时 SHALL 输出**显式遮蔽警告**（实际解析路径 + 期望落点 + 建议动作）。宿主服务不可用 → 退化为文件系统落点比对，状态标注「可发现性未核验之精度限制」。
- **状态/健康出口并入 change 3**：本 change MUST NOT 另建健康/状态出口；skill 缺失与遮蔽提示并入 change 3 的 `skill.status()`（service）与 `tq_skill_manage(action:"status")`（tool）的**同一实现**的状态视图。

**本 change 新增代码**：`src/tools/review-daily.ts`、`src/summary/run-report.ts`、`src/summary/package-schema.ts`、`skills/review-daily-summary/SKILL.md`（版本化源）。

## Risks / Trade-offs

- **agent 输出质量波动** → skill 给正向骨架、长度上限与负向词表；附注标注 AI 生成且用户可删；用关键词扫描脚本 + 人工复核做门禁式验收。
- **卡片正文长、汇总成本高** → 逐标的独立处理（一次一个标的），不一次性装载全天内容；配合预算预检与分批续跑。
- **TQ skill 未安装或未更新** → 当日表现缺失 → 按 D-10 判定矩阵产出部分附注或 `failed`；依赖 change 3 的安装与版本检查；`skillVersion` 进数据包与 `missing`。
- **`customSkillDirs` 未配置或被 rank 100/200 遮蔽** → skill 不可见或解析到他处 → 状态提示 + 显式遮蔽警告 + 文档指引，其余功能不受影响（D-12）。
- **并发写（页面提交卡片 vs 汇总附注）** → 复用 change 4 的 `appendAinote`（re-read + 原子写 + 重试 + 路径互斥，`§5`），单测覆盖「两次写入均保留」与「写前 stat 不一致重读」。
- **幂等被用户手动编辑破坏**（例如用户改了附注锚点）→ 前缀扫描视为不存在并追加新附注；属可接受（文档是事实源，用户有处置权）；但**正文引用锚点字样**不再构成误判（D-2 受限扫描），幽灵锚点走 `§3` 的 `warnings: string[]` 显式告警。
- **预算不足导致后段标的大面积 `failed`** → 运行前预算预检 + 显式「本次可处理前 N 个标的」+ 分批续跑，被截断标的不计 `failed`（D-5）。
- **依赖未就绪（change 4 的 `src/review/*` 尚不存在）** → 工具显式返回 `DEPENDENCY_UNAVAILABLE`，运行摘要记 `failed`；不静默自实现（D-1b）。
- **summary 文档数量大、摘要文件与文档写入竞争 I/O** → 摘要独立于业务文档锁，且为原子写；摘要失败不阻断已完成的文档写入（D-9）。

## Migration Plan

- 首次部署（依赖 change 3 泛化）：经 change 3 安装器的 local-dir 源部署 `skills/review-daily-summary/` → `<数据根>/agent/skills/review-daily-summary/`（三态：一致/用户改动/可升级）；未泛化时按 D-4 降级为人工放置（README 记命令）。
- 前提条件（写入文档）：宿主 profile 的 `customSkillDirs` 包含 `<数据根>/agent/skills`；数据根 `agent/DB/temp/` 可写。
- 无数据迁移；不修改既有卡片。
- 回滚：删除附注分节即可（用户可自行操作）；删除运行摘要文件无副作用；禁用插件行则工具不可用，文档不受影响。

## Open Questions

1. **W6 汇总页**是否要做、何时做（P2 后置，本迭代不做）。
2. **定时任务触发**（宿主 `tasks`/定时能力）：后置评估；届时须解决「交易日判定来源」——不得用系统日期（统一走 T0 `traderKit.data.resolveTradeDate`，`§1`）。
3. **是否需要显式「重算」入口**：当前语义是「用户删除附注即等于请求重算」（附 D-10 指引）；若实践中希望保留旧附注并追加新版，再评估是否引入版本化附注（本迭代不做）。
4. **`force` / `overwrite` 入参**（评审 Issue 15）：本迭代后置；实现期若体验不足再评估（届时须同时给出「旧附注如何处置」的语义）。
5. **TQ 侧缓存/零网络的自动断言**（评审 Issue 4）：当前无出站计数 seam，只能人工证据；若后续宿主提供 skill 调用计数或 TQ 走插件数据模块出口，再升级为自动断言。
6. **运行摘要的保留期与清理**（D-9）：`agent/DB/temp/` 下的 `daily-summary-run.json` 是否随迭代新增清理策略（当前不清理、不归档）；无清理策略时须评估积压量。
7. **数据包 schema 的校验库选型**：手写校验 vs JSON Schema 库；本迭代先手写（零依赖、可控），若下游消费方增多再抽公共 schema 包。
8. **`skillVersion` 不可解析时的处置**（D-6 表）：当前记 `unknown` + `missing`；是否需要在状态出口升级为警告待评估。
9. **多命中/`warnings` 在汇总路径的呈现**：本 change 在运行摘要中落 `warnings: string[]`（`§3` 五导出的告警汇总去重，`§12.7`）；`storeWarnings` 仅为 change 4 侧的 Requirement 名/内部类型名，本 change MUST NOT 以其作字段名（与 change 4 的告警契约对齐）。
10. **change 3 安装器泛化（local-dir 源 + 原子替换）**（评审 Issue 9）：本 change 的部署依赖该泛化；若 change 3 不提供，本迭代降级为人工放置 + README 记录命令（D-4）。
11. **跨午夜运行的目标交易日归属**（评审 Issue 12）：本 change 固定「归属由 `YYYYMMDD` 决定」并要求用户显式指定或经 T0 确认；是否需要「凌晨运行自动归属前一交易日」的便利语义待评估（不得静默）。
12. **change 4 侧同步项确认**（Round 1/2/3 处置的跨 change 登记）：change 4 的 spec/tasks 须同步 `§3` 的（五导出 `warnings: string[]` / `src/review/format.ts` 的 `formatZonedIso`·`formatAnchorTime` / 写前硬校验 `DOC_MISMATCH`）三项，并把 `ghostAnchor` 这一告警 kind 明确归属到 `parseDoc` / `scanDailyCardTargets` 的 `warnings` 产出；未同步即视为依赖未落地 → 本 change 工具显式报 `DEPENDENCY_UNAVAILABLE`（D-1b）。本 change 不修改 change 4 文件。
13. **预算预检出口的字段契约确认**（评审 Issue 25）：change 2 提供 `traderKit.data.guardStatus()`（字段含 `remaining` / `budgetLimit` / `budgetUsed` / `minIntervalMs` / `sessionState` 等）；本 change 只消费、不注册、不自建预算计数，缺字段/未注册即 `DEPENDENCY_UNAVAILABLE`。change 2 落地时若字段名或语义有变，以 change 2 契约为准并同步本 change spec 的预算 Requirement（本 change 不修改 change 2 文件）。
14. **change 3 状态视图覆盖 localDir 自产 skill**（评审 Issue 27）：本 change 的 skill 缺失/遮蔽提示并入 change 3 的 `skill.status()` / `tq_skill_manage(action:"status")`；若 change 3 未在其 spec/tasks 登记该覆盖面，本 change 保留只读核对代码并把结果写入运行摘要 `warnings[]`（该输出不叫「健康出口」），并在 change 3 落地后回收此降级分支。

## 评审处置（Round 1 — 2026-09-27）

评审源：`reviews/daily-summary-review.md`（18 条 issue，Rating 4/10，NEEDS_REVISION）。逐条处置如下，一条不漏；「改动位置」指本 change 目录内文件 + 节号。

| Issue | 处置 | 说明 / 改动位置 |
| --- | --- | --- |
| 1（Critical）「复用 change 4 存储实现」被虚构 | **已采纳** | 「复用实现」全部具名化：`§3` 的 `locateDoc` / `parseDoc` / `appendAinote` / `scanDailyCardTargets` + service key `traderKit.review.*`；`proposal.md` 的 Modified Capabilities/Impact 与 `tasks.md` 标 `blocked_by: change 4`；新增 D-1b 与 spec「写入通道与原子性」的「依赖不可用显式报错」场景（`DEPENDENCY_UNAVAILABLE`） |
| 2（Critical）幂等前缀扫描未限定作用域 | **已采纳** | D-2 改为受限扫描（只认 H2 `^##\s`、跳过 fenced code block、归属校验、`normalizeCode`）；spec「幂等」新增 4 场景（正文含锚点字样不误判 / 代码块内不误判 / 异常代码形态键一致 / 幽灵锚点不静默）；缺 `normalizeCode` 与 `parseDoc` 复用即为缺陷 |
| 3（Critical）交易日来源循环依赖 | **已采纳** | 新增 D-2b 与 spec「交易日来源（唯一实现，禁循环依赖）」Requirement：缺省调 change 2 `traderKit.data.resolveTradeDate`（tool `get_trade_date`），与 change 4 `TradeDateResolver` 同一实现；MUST NOT fallback 系统日期、MUST NOT 由逐标的 T1 `tradeDate` 推导；新增非交易日/长假、盘前、有交易日但无卡片、与 change 4 同一实现四场景 |
| 4（Critical）「缓存零网络」不可断言 | **已采纳** | 新增 D-5b；spec「取数与缓存」收窄断言范围：仅 T1/T2 侧（`§9` 列表级缓存）可自动断言「出站请求计数 0」；TQ skill 侧改为要求标注 `fetchedAt` 与 `cacheReused`，验收为人工证据（字段样例 + skill 名/版本）；`tasks.md` 3.4/4.6 显式区分自动与人工 |
| 5（High）未校验 T1 `tradeDate` 一致性 | **已采纳** | spec「取数与缓存」加硬门槛：`limitReason.tradeDate !== 目标交易日` → 降级 `missing`（原因 `dateMismatch`）并在附注显式标注；要求对 T1 显式传 `date=<目标交易日>`；新增场景与单测（`tasks.md` 2.8、4.4） |
| 6（High）字节级不变缺口径 | **已采纳** | 新增 D-6b；spec「写入通道与原子性」写明 `§4` 口径（原文件字节为前缀、EOL/BOM 保持、frontmatter 值级最小修补）与**分节切片 + 文件前缀**断言方式，并新增 CRLF / BOM / 无尾换行场景；`tasks.md` 2.7 补三类 fixture |
| 7（High）`failed` 三态无落点 | **已采纳** | 新增 D-9 与 spec「运行摘要三态载体」：schema `{tradeDate, created[], skipped[], failed[{code, reason}]}`，落 `<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`（沿 `§9` temp 区 + `data-root-layout` 映射表），原子写；「失败标的必带原因」「空清单也落摘要」写成可断言场景（`tasks.md` 2.9） |
| 8（High）宿主事实互斥行号 / rank 遮蔽 / health 重复 | **已采纳** | Context 拆「已实测（含证据，符号引用）/ 待验证（含降级策略）」，**删除全部行号**改符号名（`§8`）；可发现性核对改为「经宿主 skills 服务列出并断言解析路径 == 数据根落点，被 rank 100/200 遮蔽时显式警告」（spec「skill 落点与可发现性」）；health/状态提示并入 change 3 的 `skill.status()`（同一实现，D-12），本 change 不另建 |
| 9（High）D-4 部署语义与 change 3 冲突、不可判定 | **已采纳** | D-4 改为「不自建第二套覆盖逻辑」，依赖 change 3 安装器泛化为「本地目录源 + 原子替换」（三态：一致 / 用户改动（不覆盖 + 输出 diff 与源哈希）/ 可升级）；未泛化时降级为人工放置 + README 记录命令 —— **记 Open Questions 第 10 条**；spec「部署语义」两场景 |
| 10（High）与 roadmap 阶段路线冲突 | **已采纳** | Context 引用 `docs/roadmap.md §5` 与 `§10`；spec 在 `proposal.md` Impact 与 `tasks.md` 5.1 增文档任务（architecture / AGENTS 两条白名单路径 / vault-integration 补登），并纳入 `tasks.md` 5.2 门禁 |
| 11（Medium）数据包不是契约 | **已采纳** | 新增 spec「数据包 schema」Requirement（字段/类型/单位/`source`/`fetchedAt`、`missing` 枚举与判定表、`available=false` 语义、TQ 字段来源与 `skillVersion`），并把「数据包 MUST 通过 schema 校验」写成 requirement；`tasks.md` 2.6 实现 + 3.1 规格 |
| 12（Medium）锚点形态 spec/design 不一致 | **已采纳** | 统一正则 `^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$`（D-3 与 spec「AI 附注落盘契约」同文）；HHMM 来源 = 本地时钟 `Asia/Shanghai`；跨午夜说明（归属由 `YYYYMMDD` 决定）+ 单测「23:59 与次日 00:05 不得产生两条附注」（`tasks.md` 2.8） |
| 13（Medium）附注元信息不可解析 | **已采纳** | 新增 spec「附注元信息行」：`generatedAt`（`+08:00`）/`tradeDate`/`code`/`dataSources`（逐字段 `字段=源@日期`）/`missing`/`cacheReused` 可解析键值；与 change 4 `writtenAt` 共用 `src/review/format.ts` 的同一格式化函数（结构断言单一来源） |
| 14（Medium）合规约束不可执行 | **已采纳** | 新增 spec「合规与写作约束」：正向骨架（事实 → 当日表现（含来源）→ 待跟踪）+ 负向词表（含 `建议买入/目标价/必涨/可重仓/确定性加仓` 变体）+ 固定一行「研究辅助、不构成投资建议」；验收改为「N≥5 份真实产出跑关键词扫描脚本（零命中）+ 人工复核」；`tasks.md` 3.3 给出脚本、命令与判定标准 |
| 15（Medium）部分失败/`available=false` 语义缺失、重算是隐藏出口 | **已采纳** | 新增 spec「失败判定矩阵与重算指引」（TQ×T1 → `created`(部分/带 `missing`)/`failed` 判定表）；附注固定含「数据完整性：完整｜部分（缺 X）」行；给出「如需重算：删除该附注分节后重跑」指引与 block 引用；`force` 后置 —— **记 Open Questions 第 4 条**（工具 schema 明令无该参数） |
| 16（Medium）未计频控预算 | **已采纳** | 新增 D-5 与 spec「预算预检与分批」：运行前预算预检（`§9` 列表级请求数）+ 显式提示「本次可处理前 N 个标的」+ 分批续跑（被截断项记 `deferred` 而非 `failed`）+ MUST NOT 静默排队/静默截断；`tasks.md` 3.5 与 4.7 补验收 |
| 17（Medium）tasks 缺项与验收不可判定 | **已采纳** | `tasks.md` 全量重写：每条三要素（**产物 / 验收 / 依赖**）+ `blocked_by`；补 service key 与「路径一律经 `data-root-layout` 映射表」；补文档任务与门禁；`proposal.md` 的仓外引用（「模块文档 §5 验收」）改为仓内可核验引用（openspec spec + `iteration-1-contracts §n`） |
| 18（Low）下游语料复用未收口 | **已采纳** | 新增 spec「下游解析口径（锚点前缀区分）」Requirement：一切下游解析（页面 B4、语料导出、统计、模式识别）MUST 以锚点前缀区分并默认排除 `^ainote-`；「卡片数」= 用户卡片数（不含附注）并写成断言（与 `cardCount` 一致） |

## 评审处置（Round 2 — 2026-09-27）

评审源：`reviews/daily-summary-review.md` Round 2（Issues 19–33，Rating 7/10，NEEDS_REVISION）。逐条处置如下；「残余」列指本轮未闭合、转入 Round 3 表的项。

| Issue | 处置 | 说明 / 改动位置 |
| --- | --- | --- |
| 19（High）运行摘要没有生产者出口 | **已采纳** | 新增 D-1 表第 4 行与 spec「运行摘要与具名生产者出口」Requirement（tool `review_daily_report` / service `traderKit.review.dailyReport`，本 change 注册）+ 8 场景；`tasks.md` 2.11（含 `⊇ 扫描清单`/`reason` 非空/合并幂等/`DEPENDENCY_UNAVAILABLE`/绕过结构断言）与 1.1（SKILL 收尾必须调用）；`proposal.md` 新增代码与验收要点同步 |
| 20（High）`src/review/format.ts` / `formatZonedIso` 在被复用侧不存在 | **已采纳** | 被复用侧已定义（`review-card-store/spec.md` 新增 Requirement + `review-page/tasks.md` 1.13 + `review-page/design.md` D-19）；本 change spec「附注元信息行」「数据包 schema」、D-3、`tasks.md` 1.1/2.3 引用一致，并写明「只引用、MUST NOT 自写格式化」 |
| 21（Medium）幽灵锚点 `storeWarnings[]` 无出口 | **已采纳** | 出口改为 `§3` 五导出**一律**返回的 `warnings: string[]`（`§12.7`）；spec 幂等 Requirement、D-2、`tasks.md` 2.1/2.8 改为该字段名。**残余**：spec 两处正文仍写幽灵字段名 → 转入 Round 3 Issue 4 |
| 22（Medium）归属校验基准不一致 | **已采纳** | D-2④、`proposal.md`、`tasks.md` 2.8⑦ 统一为「基准 = 文档 frontmatter 的 `tradeDate` + `code`」，并写明不一致由 change 4 `appendAinote` 写前硬校验抛 `DOC_MISMATCH`。**残余**：验收源 spec 幂等条款仍写「目标交易日折算」→ 转入 Round 3 Issue 3 |
| 23（Medium）摘要 schema 缺 `deferred` | **已采纳** | spec schema 增 `deferred[{code,reason}]` 与失败矩阵行；`tasks.md` 2.9 / 2.11 / 4.7 的「`deferred` 与 `failed` 分列」断言可成立 |
| 24（Medium）部署三态缺版本载体 / 未引用具名出口 | **已采纳** | `SKILL.md` frontmatter 增 `version`（`tasks.md` 1.1、spec skill 落点 Requirement、`proposal.md`）；改引 `syncLocalDir(input)` / `traderKit.skill.deployLocalDir` 与三态枚举 `in-sync` / `user-modified` / `upgradable`（D-4、`tasks.md` 1.2） |
| 25（Medium）预算预检接口未具名 | **已采纳（命名）+ 后置** | 命名 `traderKit.data.guardStatus()` 并写入 D-1b / D-5 / spec 预算 Requirement / `tasks.md` §0、2.5、3.5 / `proposal.md`；change 2 侧的落地与字段契约确认**后置为 Open Questions 第 13 条**。**残余**：原登记指向不存在的 OQ 13 → 转入 Round 3 Issue 2 |
| 26（Medium）D-11 锁助手不存在 / 「仅一处原子写」自相矛盾 | **部分采纳** | `tasks.md` 2.3① 改为「文档写入全仓仅一处实现（`appendAinote`；`src/summary/run-report.ts` 的 JSON 原子写为唯一例外）」。**残余**：spec 结构断言与 D-11 锁助手复用句未同步 → 转入 Round 3 Issue 5 / 7 |
| 27（Medium）可发现性缺 `cwd` / 并入 change 3 未登记 | **已采纳** | `tasks.md` 1.4 写明 `cwd` 必传（不传则 rank 100 不扫，结论无意义）、候选根覆盖 rank 100/200/300 与 `list()` 赢家、遮蔽警告含遮蔽者路径/rank/版本、服务不可用降级；change 3 侧确已登记 localDir 自产 skill 的状态视图。**残余**：`checkDiscovery` 形参名过期 → 转入 Round 3 Issue 8 |
| 28（Medium）「非交易日/长假」不可判定 | **已采纳** | D-2b 与 spec「交易日来源」统一三态命名（交易日不可得 / 归属待确认 / 该交易日无卡片），MUST NOT 引入「非交易日 / 长假」；`proposal.md` 验收要点同步 |
| 29（Medium）T1 `available=false` 两义被合并 | **部分采纳** | spec 侧闭合：`errors[]` 必须保留、`dateUnavailable` 三档判定、场景与矩阵行、`tasks.md` 2.8⑧。**残余**：D-10 仍无条件写「`available=false` 属 `noRecord`」→ 转入 Round 3 Issue 7 |
| 30（Low）`§9` 被当作 temp 区事实源 | **部分采纳** | spec 预算/摘要、`proposal.md`、`tasks.md` 2.9 已改 `§10` + `data-root-layout`。**残余**：D-9 仍写「沿 `§9` 的 temp 区约定」→ 转入 Round 3 Issue 7 |
| 31（Low）spec 内部三处写法矛盾 | **部分采纳** | (a) 自比较改为 `limitReason.tradeDate !== 目标交易日`；(b) `available=false` 时 `fields` 保持对象形态写死。**残余**：(c) 「五个必填键」与六键口径仍不一致 → 转入 Round 3 Issue 7 |
| 32（Low）同分钟序号语义矛盾 | **部分采纳** | D-3 与 `tasks.md` 2.8⑨ 明令附注写入侧 MUST NOT 产生 `-<seq>`（序号仅由 change 4 卡片使用）。**残余**：spec 仍要求序号生成且场景不可达 → 转入 Round 3 Issue 6 |
| 33（Low）`traderKit.review.*` 注册归属矛盾 | **已采纳** | `tasks.md` 2.4 明确「只注册自有出口（`review_daily_report` / `traderKit.review.dailyReport`），change 4 五键只消费、不重复注册」；与 `§11`/`§12.6`、`review-page/tasks.md` 一致，2.5 的空容器前提自洽 |

## 评审处置（Round 3 — 2026-09-27）

评审源：`reviews/daily-summary-review.md` Round 3（Issues 1–8，Rating 7/10，NEEDS_REVISION）。逐条处置如下（本轮为收口轮，全部 issue 均在 `openspec/changes/daily-summary/` 内定点闭合）。

| Issue | 处置 | 说明 / 改动位置 |
| --- | --- | --- |
| 1（Medium）摘要出口 `missing[]` / `warnings[]` 无入参通道，且「并集 ⊇ 扫描清单」断言归属不可实现 | **已采纳** | spec「运行摘要与具名生产者出口」入参补**可选** `missing?: [{code,field,reason}]` 与 `warnings?: string[]`（不改 `§12.6` 必填入参），并写明「出口**自身** SHALL 调用 `traderKit.review.scanDailyCardTargets(tradeDate)` 取清单，未出现于 `entries` 的代码补 `failed`（`entryMissing`）」；`spec` 场景改为「由出口自身完成（读回摘要断言），MUST NOT 依赖 agent 传全清单」，新增「`missing`/`warnings` 经入参回填」场景；D-1 表第 4 行、`tasks.md` 2.11（入参/自扫/验收）同步 |
| 2（Medium）`traderKit.data.guardStatus()` 无所有者，登记指向不存在的 OQ 13 | **已采纳** | spec 预算 Requirement、D-5、`tasks.md` §0/3.5、`proposal.md` 依赖清单统一改为「change 2 提供 `traderKit.data.guardStatus()`（`remaining`/`budgetLimit`/`budgetUsed`/`minIntervalMs`/`sessionState` 等），不可用 → `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），MUST NOT 自建预算计数」；新增场景「预算预检依赖不可用即显式失败」；**删除**指向不存在的 Open Questions 13 的登记请求；Open Questions 扩至 14 条（第 13 条 = 字段契约确认，无悬空引用） |
| 3（Medium）幂等归属基准 spec（目标交易日）vs design/tasks（frontmatter）分叉 | **已采纳** | spec 幂等条款重写为唯一基准链：rule 3/4 = **扫描基准 = 文档 frontmatter 的 `tradeDate` + `code`**；新增 rule 5 写推理链（写前硬校验 `frontmatter == 目标 loc`，不符抛 `DOC_MISMATCH` 且不追加 → 成功写入者 frontmatter 必等于 `loc` → 扫描基线与目标交易日必然一致、无分叉、不可能追加第二条）；删除「日期段 == 目标交易日折算的 `YYYYMMDD`」句；D-2④ 同步同一推理链；`tasks.md` 2.8⑦ 保留用例 |
| 4（Medium）spec 仍写幽灵字段 `storeWarnings[]` | **已采纳** | spec 幂等 rule 4 与「幽灵锚点不静默」场景改为 `warnings: string[]`（含 `[ghostAnchor] <path> — …` 编码，`§3`/`§12.7`），并保留「MUST NOT 使用 `storeWarnings[]` 这一字段名」的结构断言；Open Questions 第 9 条改写、第 12 条登记「`ghostAnchor` kind 归属 `parseDoc` / `scanDailyCardTargets` 的 `warnings` 产出」的 change 4 同步项；D-2、Risks 条目同步 |
| 5（Medium）spec「全仓仅一处原子写/追加实现」与摘要第二处原子写互斥 | **已采纳** | spec 场景改为可判定表述：① 调用 `appendAinote`；② **文档写入（md）唯一实现 = `appendAinote`**；③ `src/summary/run-report.ts` 的 JSON 摘要为**独立**原子写路径（**不同目录、不同锁**，不构成第二份文档追加实现），二者可同时成立；`tasks.md` 2.3① 同步同一措辞 |
| 6（Medium）`-<seq>` 在 spec 与 design/tasks 间正反对立，且触发场景不可达 | **已采纳** | 三处统一为「**附注写入侧 MUST NOT 产生 `-<seq>`**；`-<seq>` 仅由 change 4 的同分钟多卡使用」：spec 锚点形态统一、跨午夜说明、场景改为「删除后同分钟重算**不产生**序号」（可达路径）、「删除后可重新生成」删除「序号与旧值不同」；D-3 与 `tasks.md` 2.8⑨ 保持一致 |
| 7（Low）引用与命名的零散残差（8 处） | **已采纳** | ① design 追加本表与 Round 2 表，Open Questions 补 12–14 → 三处 `Open Questions 12/13/14` 引用不再悬空；② D-10 改为按 `errors` 三档（含 `dateUnavailable` → `sourceUnavailable`，MUST NOT 写「无涨停记录」）；③ D-9 改 `§10` 的 temp 区；④ D-11 删除「复用 change 4 具名锁助手」，改为「复用 `§5` 的锁/重试**纪律**，自行实现于 `src/summary/**`，与文档写锁不共用」；⑤ spec「元信息行可解析」场景改「**六个必填键**（含 `cacheReused`）」，与键表/`proposal.md` 对齐；⑥ `tasks.md` §6 映射表行名对齐 spec Requirement 名「运行摘要与具名生产者出口」；另：D-9 schema 补 `deferred`/`missing`/`warnings` 键、spec 依赖不可用条款由「三个工具」改为「四个工具」（含 `review_daily_report`） |
| 8（Low）`checkDiscovery` 形参过期 | **已采纳** | 按 change 3 登记的回写项 R8，`tasks.md` §0 与 1.4 改为 `checkDiscovery({ skills?, projectRoot, targetRoot, name })`，并写明 `targetRoot = <数据根>/agent/skills`、`name = 'review-daily-summary'`（与 `tq-skill-installer/design.md` 的 D-11/`tasks.md` 2.3 具名签名一致） |
