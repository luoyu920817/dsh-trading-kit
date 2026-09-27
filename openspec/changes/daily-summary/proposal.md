## Why

现场卡片只是原料。需求 P2（闭环回到盘面）要求这些记录能被读回并形成结论，且「日记 + 程序提取 + 总结太费时」这个痛点必须被自动化掉。迭代一把它定为**每日汇总工作流**：盘后遍历当日有卡标的 → 取当日表现与涨停原因 → agent 生成当日总结 → 以 **AI 附注**追加进该标的当日 md（与用户主观记录严格分离、只追加、幂等）。

这是「卡片语料 → 当日结论」的第一次闭环，也是后续模式迭代（F2.2 模式片段识别）的直接上游；因此本 change 的 spec 额外收口了两条跨 change 口径：**下游解析默认排除 `^ainote-`**（附注不污染语料与「卡片数」），以及**锚点前缀是唯一的区分依据**（`iteration-1-contracts §2`）。

## What Changes

- **工作流 skill `review-daily-summary`**：落 `<数据根>/agent/skills/`（自产业务 skill 区，经 change 2 `data-root-layout` 的两级映射表解析），经宿主 `customSkillDirs`（rank 300）被 agent 发现；盘后由会话手动触发（W-Q1 裁决），**收尾 SHALL 调用运行摘要出口**（见下条）。frontmatter SHALL 含 `name` / `description` / `version`（版本载体，供 change 3 部署三态判定）。可发现性 SHALL 经宿主 skills 服务核对（**`cwd` 必传**，候选根覆盖 `.dsh/skills`(100) / `.agents/skills`(200) / `customSkillDirs`(300) / `extraSkillRoots`；被同名副本遮蔽时显式警告，含遮蔽者路径/rank/版本）。
- **流程 W2–W5**：扫当日有卡标的清单（按**业务日期**定位 `DB/review/<YYYYMM>/`，交易日缺省由 change 2 的 T0 `traderKit.data.resolveTradeDate`（tool `get_trade_date`）解析，**MUST NOT** fallback 系统日期；不可得 → 显式要求用户指定）→ 逐标的取数（当日表现经 **tq-local skill**，涨停原因经 change 2 的 **T1** `get_limit_reason` 且显式传 `date=<目标交易日>`（canonical `YYYY-MM-DD`，换算经 `src/data/date.ts`）；T1/T2 侧命中列表级缓存零网络可自动断言）→ agent 生成当日总结 → 幂等追加 AI 附注 → **收尾调用 `review_daily_report` 合并写入运行摘要**。
- **四个插件工具（与 service 同一实现，机械不变量在代码层）**：`review_daily_scan`（当日有卡标的清单）、`review_read_daily`（该标的当日用户卡片正文，排除附注）、`review_append_ainote`（幂等 + append-only + 原子写）、`review_daily_report`（运行摘要的**唯一生产者**，service `traderKit.review.dailyReport`，`iteration-1-contracts §12.6`）。前三者 SHALL 复用 change 4 `src/review/store.ts` 的**具名导出** `locateDoc` / `parseDoc` / `appendAinote` / `scanDailyCardTargets`（**五导出均返回 `warnings: string[]`**）、`src/review/format.ts` 的 `formatZonedIso` / `formatAnchorTime` 与 `src/review/anchor.ts` 的 `normalizeCode`（service key `traderKit.review.*`，`iteration-1-contracts §3`），MUST NOT 另写第二份追加/解析/格式化/原子写实现。
- **AI 附注契约**：`## AI 附注 · HH:mm ^ainote-<YYYYMMDD>-<代码>-<HHMM>`（**四段式；附注写入侧 MUST NOT 产生 `-<seq>` 后缀，可选序号仅由 change 4 的同分钟多卡使用**，`iteration-1-contracts §2`）+ 可解析元信息行（六键必填：`generatedAt`（`+08:00`，经 change 4 `src/review/format.ts` 的 `formatZonedIso`）/`tradeDate`/`code`/`dataSources`（逐字段 `字段=源@日期`）/`missing`/`cacheReused`）+ 固定「数据完整性：完整｜部分（缺 X）」行 + 固定「研究辅助、不构成投资建议」行；**只追加，绝不改写用户卡片分节**；写入前由 change 4 的 `appendAinote` 做归属硬校验（frontmatter `tradeDate` + `code` == 目标 `loc`，不符即 `DOC_MISMATCH`）；用户可自行删除。
- **幂等**：同一交易日同一标的重复运行不重复追加（按 `iteration-1-contracts §2` 的受限扫描：只认 H2 标题行、跳过 fenced code block、前缀 `^ainote-<YYYYMMDD>-<代码>-`，**归属基准 = 文档 frontmatter 的 `tradeDate` + `code`**，不一致记 `warnings: string[]` 不静默）；用户删除附注后再次运行可重新生成。跨午夜（23:59 / 次日 00:05）同交易日运行 MUST NOT 产生两条附注。**幽灵告警出口 = `§3` 的 `warnings: string[]`（五个导出均返回，`§12.7`），并汇总进运行摘要 `warnings[]`**——不存在 `storeWarnings[]` 这一幽灵字段。
- **失败隔离与可见性**：某标的取数失败 → 该标的显式标注「附注未生成 + 原因」（按失败判定矩阵），**并经具名出口 tool `review_daily_report` / service `traderKit.review.dailyReport` 合并落入运行摘要** `<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`（`{tradeDate, created[], skipped[], failed[{code,reason}], deferred[{code,reason}], missing[{code,field,reason}], warnings[]}`，`iteration-1-contracts §10` 的 temp 区 + `§12.6`）；该出口入参除 `tradeDate` + `entries` 外，接受**可选回填通道** `missing?` / `warnings?`，并**自身调用 `traderKit.review.scanDailyCardTargets(tradeDate)`** 取得扫描清单以断言「四态并集 ⊇ 扫描清单」（不依赖 agent 传全清单）；不阻塞其它标的；无卡片的标的零打扰。
- **预算与分批**：运行开始前经 change 2 的具名出口 `traderKit.data.guardStatus()`（`§9`：按列表级请求数计）预检剩余预算；不足时显式提示「本次可处理前 N 个标的」并允许续跑，被截断项记 `deferred`（不计 `failed`），MUST NOT 静默排队或静默截断。

## Capabilities

### New Capabilities

- `daily-summary`: 每日汇总工作流的触发与输入枚举、交易日来源（唯一实现）、取数与缓存断言口径、数据包 schema、总结生成与合规约束、AI 附注的幂等落盘（受限扫描 + 字节口径 + 归属硬校验 `DOC_MISMATCH`）与失败判定矩阵、**运行摘要的具名生产者出口（tool `review_daily_report` / service `traderKit.review.dailyReport`）与四态载体**、预算预检与分批、skill 落点与可发现性、下游解析口径。

### Modified Capabilities

（无。**依赖** `review-card-store`（change 4）的具名接口与 `traderKit.review.*` service key（`iteration-1-contracts §3`），不修改其契约；**准入条件**：change 4 侧 spec/tasks 须同步 `§3` 的（五导出 `warnings: string[]` / `src/review/format.ts` 的 `formatZonedIso`·`formatAnchorTime` / 写前硬校验 `DOC_MISMATCH`）三项，未同步即视为依赖未落地，本 change 工具 SHALL 显式报错 `DEPENDENCY_UNAVAILABLE`，不得自实现兜底；跨 change 登记/确认项见 design Open Questions 12–14。）

## Impact

- **新增代码**：`src/tools/review-daily.ts`（四个工具 + service 出口装配，工具与 service 同一实现；其中 `traderKit.review.dailyReport` 由本 change 注册）、`src/summary/run-report.ts`（运行摘要落盘 + 合并写 + 原子写）、`src/summary/package-schema.ts`（数据包 schema 校验）、`skills/review-daily-summary/SKILL.md`（版本化源，frontmatter 含 `version`；部署到数据根 `agent/skills/`）。
- **依赖（blocked_by）**：
  - `change 2`：`traderKit.data.resolveTradeDate`（tool `get_trade_date`）、T1 `get_limit_reason`、`data-root-layout` 两级映射表、`src/data/date.ts` 日期换算单点、列表级缓存（键 = `source + requestedDate`）与**预算预检出口 `traderKit.data.guardStatus()`**（change 2 提供；字段 `remaining`/`budgetLimit`/`budgetUsed`/`minIntervalMs`/`sessionState` 等，**不可用 → `DEPENDENCY_UNAVAILABLE`**，本 change MUST NOT 自建预算计数）；
  - `change 3`：tq-local skill 已安装、`src/skill/local-source.ts` 的 `syncLocalDir(input)` + service `traderKit.skill.deployLocalDir`（三态 `in-sync`/`user-modified`/`upgradable`；未提供则降级为人工放置 + README 命令，见 Open Questions）、`traderKit.skill.status({ cwd? })` 与 `checkDiscovery`/`findShadowedCandidates`（本 change 的 health/状态提示并入此处，不另建）；
  - `change 4`：`src/review/store.ts` 五个具名导出（**均返回 `warnings: string[]`**）与 `DOC_MISMATCH` 硬校验、`src/review/anchor.ts` 的 `normalizeCode`、`src/review/format.ts` 的 `formatZonedIso` / `formatAnchorTime`、service key `traderKit.review.*`（五键）——**change 4 侧须同步 `§3` 这三项，否则本 change 工具报 `DEPENDENCY_UNAVAILABLE`**。
- **验收对照（仓内可核验）**：以本 change 的 `specs/daily-summary/spec.md`（Requirement + Scenario）为主判据，跨 change 口径以 `docs/design/iteration-1-contracts.md`（§1 日期三义与格式唯一口径 / §2 锚点与规范化 / §3 写入契约（含 `warnings` 与 `DOC_MISMATCH`）/ §4 字节口径 / §5 并发 / §8 事实核验 / §9 缓存与预算 / §10 写分区 / §11 所有权 / §12 跨 change 裁决）为准，逐项映射见 `tasks.md` §6。要点：当日有卡标的产出附注、无卡标的零打扰、**「交易日不可得（盘前/源未出数）」与「归属待确认（业务日 X、限流日 Y）」与「该交易日无卡片」三态可区分（不再使用不可判定的「非交易日/长假」命名）**；重复运行不重复追加（含正文引用锚点、代码块内锚点两类不误判）；附注带可解析元信息（六键）且用户卡片分节切片字节不变；**运行摘要由 `review_daily_report` 出口断言**——四态并集 ⊇ 扫描清单、`failed[]`/`deferred[]` 的 `reason` 非空、`warnings[]` 有出口、同键合并幂等。
- **明确不做**：W6 汇总页 `<YYYYMMDD>-summary.md`（P2 后置）；DSH 定时任务触发（W-Q1：迭代一先会话手动）；模式识别与关联草稿（F2.2/F2.3）；点击联动/盘中页面（F5/M7）；`force`/`overwrite` 重算入参（后置，记 Open Questions）；任何交易功能。
- **阶段路线口径**：本迭代刻意打乱 `docs/roadmap.md` §2 的阶段顺序（覆盖阶段 3 数据面子集 + 阶段 4 写分区子集 + 阶段 5 复盘 skill 子集），裁决见 `docs/roadmap.md §5`；vault 写入对本迭代**三条**白名单路径（`DB/review/`、`agent/DB/temp/dsh-trader-kit/`、`agent/skills/`）开例外，「不写 vault」断言的正确范围是「`dataRoot` 下既定业务区之外零写入」；`AGENTS.md` 与 `vault-integration` 写分区契约须同步登记（`iteration-1-contracts §10`，任务见 `tasks.md` 5.1）。
