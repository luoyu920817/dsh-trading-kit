# 实施任务（daily-summary）

> 跨 change 事实源：`docs/design/iteration-1-contracts.md`（下称 `§n`）；迭代一重排裁决见
> `docs/roadmap.md §5`。每条任务一律含 **产物 / 验收 / 依赖** 三要素；验收须写明
> **自动（测试/脚本）** 或 **人工（证据格式）**，两者不得混写。
>
> **依赖与开工闸门**：本 change `blocked_by: change 2 / change 3 / change 4`（见 `§0`）。
> 依赖未就绪时**不得开工**；若先行脚手架，四个工具（含 `review_daily_report`）MUST 返回显式错误
> `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），MUST NOT 以自实现兜底。

## 0. 依赖分组与 blocked_by

- **`blocked_by: change 4`**（存储、写入与格式化实现，`§3`）：`src/review/store.ts` 的
  `locateDoc` / `parseDoc` / `appendCard` / `appendAinote` / `scanDailyCardTargets`
  （**五导出一律返回 `warnings: string[]`**，`§12.7`）与写前归属硬校验 `DOC_MISMATCH`；
  `src/review/anchor.ts` 的 `normalizeCode`（`§2`）；`src/review/format.ts` 的
  `formatZonedIso` / `formatAnchorTime`（`§3` 同源格式化）；service key
  `traderKit.review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets}`。
  对应 `openspec/changes/review-page/tasks.md` §1（1.1 / 1.3 / 1.4 / 1.5 / 1.12）。
  **准入条件**：change 4 的 spec/tasks 若未同步 `§3` 的（五导出 `warnings` / `format.ts` /
  `DOC_MISMATCH`）三项，视为依赖未落地 → 本 change 工具显式报 `DEPENDENCY_UNAVAILABLE`，
  MUST NOT 自行补写（同步请求见 design Open Questions 12）。
- **`blocked_by: change 2`**：`traderKit.data.resolveTradeDate`（tool `get_trade_date`，`§1`）、
  T1 `get_limit_reason`（显式 `date` 入参）、`data-root-layout` 两级映射表（`§6`）、
  `src/data/date.ts` 的日期换算单点、列表级缓存（键 = `source + requestedDate`）与
  **预算预检出口 `traderKit.data.guardStatus()`**（`§9`；字段含 `remaining` / `budgetLimit` / `budgetUsed` / `minIntervalMs` / `sessionState` 等，由 change 2 提供；**不可用 → `DEPENDENCY_UNAVAILABLE`**，本 change MUST NOT 自建预算计数；字段契约确认见 design Open Questions 13）。
- **`blocked_by: change 3`**：tq-local skill 已安装（当日表现路径）、`src/skill/local-source.ts`
  的 `syncLocalDir(input)` + service `traderKit.skill.deployLocalDir`（本地目录源三态
  `in-sync` / `user-modified` / `upgradable`；未提供则走降级分支）、`traderKit.skill.status({ cwd? })`
  与 `src/skill/discovery.ts` 的 `checkDiscovery({ skills?, projectRoot, targetRoot, name })`、
  `src/skill/shadowing.ts` 的 `findShadowedCandidates({ roots, name })`（状态提示并入此处，
  本 change MUST NOT 另建健康出口）。
- **可先行部分**：1.1（skill 文案）、2.6（数据包 schema 校验）、3.3（合规扫描脚本）、
  5.1（文档任务）不依赖上述实现，可在依赖未就绪时先做；其余任务开工前须确认依赖可用。

## 1. skill 与部署

- [x] 1.1 编写 `skills/review-daily-summary/SKILL.md`：frontmatter 合法（kebab-case `name` + 说明触发时机的 `description` + **`version`** 版本载体，供 change 3 部署三态判定）；正文含 W1–W5 流程、**数据包 schema**（见 spec 同名 Requirement）、正向写作骨架 + 负向词表 + 固定定位声明、预算预检与分批语义、失败判定矩阵与重算指引、盘后与单标的取数约束，**收尾 SHALL 要求调用 `review_daily_report` 提交四态 `entries`**（判据由该出口断言，不靠文本约定）
  - 产物：`skills/review-daily-summary/SKILL.md`
  - 验收（自动）：schema 检查 `name` 匹配 `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`、`description` 与 `version` 非空；脚本断言正文含全部必需小节（数据包 schema / 骨架 / 词表 / 定位声明 / 预算 / 重算指引 / **收尾 `review_daily_report` 调用**）与负向词表全部词条
  - 依赖：spec「合规与写作约束」「数据包 schema」「失败判定矩阵与重算指引」「预算预检与分批」「运行摘要与具名生产者出口」
- [x] 1.2 部署到 `<数据根>/agent/skills/review-daily-summary/`（实机部署留波 4；三态自动用例已落地）
  - 实现登记（2026-09-28）：test/summary/deploy.test.ts 四用例（经 change 3 syncLocalDir：installed 首部署 skillPath 断言 / in-sync 零写入 mtime 不变 / user-modified 不覆盖+diff 非空 / 旧版→新版 updated 原子替换零残留）——真实仓库 skills/review-daily-summary 为源：**经 change 3 的具名本地目录源能力**——`src/skill/local-source.ts` 的 `syncLocalDir(input): Promise<LocalDeployResult>` + service key `traderKit.skill.deployLocalDir`（三态枚举 `in-sync`（零写入）/ `user-modified`（不覆盖 + 输出 diff 与源哈希）/ `upgradable`（原子替换并记录新旧哈希与版本））。本 change MUST NOT 自建第二套覆盖逻辑；三态判定所需的版本载体 = `SKILL.md` frontmatter 的 `version`
  - 产物：部署调用代码或部署说明（引用 `syncLocalDir` / `traderKit.skill.deployLocalDir`）+ 三态判定记录
  - 验收（自动）：三态各一条用例（`in-sync` 目标文件字节不变；`user-modified` 不覆盖且 diff 非空；`upgradable` 目标为新源内容、记录新旧 `version`、无残留临时/备份目录）
  - 依赖：`blocked_by: change 3`（`tq-skill-installer`「本地目录源 + 原子替换」）；**降级分支**（change 3 未提供）：人工放置，产物 = README 中的可复制命令 + 目标路径；验收（人工）= 命令 + 输出片段 + 目标文件路径三项证据；记 Open Questions 第 10 条
- [x] 1.3 文档化配置前提：
  - 实现登记（2026-09-28）：customSkillDirs 配置说明落 docs/architecture.md 每日汇总段（波 3 S 线已补）；路径经 data-root-layout 映射表（agentSkills 业务区），禁止手写拼接宿主 profile 的 `customSkillDirs` 需包含 `<数据根>/agent/skills`（写入 README/architecture 说明）；路径经 `data-root-layout` 映射表解析，禁止手写拼接
  - 产物：README / `docs/architecture.md` 对应段落（改动由 5.1 统一收录）
  - 验收（人工）：文档含配置项名、示例值、数据根为空时的报错指引；引用 `§10` 与 `docs/roadmap.md §5`
  - 依赖：`§6`、`§10`、5.1
- [x] 1.4 可发现性核对：
  - 实现登记（2026-09-28）：test/summary/deploy.test.ts 三用例（checkDiscovery filesystem-only 退化命中且路径一致 / findShadowedCandidates 遮蔽警告含路径+rank+版本 / cwd 缺失显式拒绝不猜）；宿主服务态三桩在波 4 实机核验（customSkillDirs 配置后）**复用 change 3 的具名导出** `checkDiscovery({ skills?, projectRoot, targetRoot, name })`（`src/skill/discovery.ts`；`targetRoot = <数据根>/agent/skills`、`name = 'review-daily-summary'`，形参名按 change 3 回写项 R8）与 `findShadowedCandidates({ roots, name })`（`src/skill/shadowing.ts`），**`cwd` 必传**（值来自 change 3 的 `resolveProjectRoot(cwd)`；不传 `cwd` 时宿主不扫 rank 100 项目根，核对结论无意义）；候选根 SHALL 至少覆盖 `<projectRoot>/.dsh/skills`(100)、`<projectRoot>/.agents/skills`(200)、`customSkillDirs`/`extraSkillRoots`(300) 与 `list({ cwd })` 赢家，断言解析路径 == `<数据根>/agent/skills/review-daily-summary/`；遮蔽警告 SHALL 含遮蔽者**路径 + rank + 版本**；宿主服务不可用时退化为文件系统落点比对并标注精度限制
  - 产物：可发现性核对代码（复用上述具名导出，不另写比对逻辑）+ 状态出口接线（并入 change 3 的 `traderKit.skill.status({ cwd? })` 同一实现，本 change 不另建健康出口）
  - 验收（自动）：桩注入「命中且路径一致」「命中但路径为他处（遮蔽）」「服务不可用」三态，各自断言输出（一致=无警告；遮蔽=含实际路径、期望落点与遮蔽者 rank/版本；不可用=标注未核验）；不传 `cwd` 的实现 MUST 被判失败（对照断言）；扫描型断言 MUST 先断言目标非空
  - 依赖：`blocked_by: change 3`（`skill.status()` / discovery 具名导出）；Context「已实测/待验证」宿主事实（**符号名引用，不写行号**，`§8`）；**降级分支**：若 change 3 未在其 spec/tasks 登记「状态视图覆盖 localDir 自产 skill」，本 change 保留只读核对代码并把结果写入**运行摘要 `warnings[]`**（此项输出不叫「健康出口」），记 Open Questions 14
- [x] 1.5 单测：skill frontmatter 校验与正文必需小节断言（零 mock，读真实仓库文件）
  - 实现登记（2026-09-28）：`test/summary/skill.test.ts`（6 用例：frontmatter/必需小节/数据包字段/负向词表/收尾出口/取数来源）；`test/summary/core.test.ts`（21 用例：扫描三态/读卡/附注幂等/归属/依赖不可用/摘要合并/判定矩阵六行/预算分批）；合规脚本自测 `node scripts/scan-compliance.mjs --self-test` 通过
  - 产物：skill 相关测试用例
  - 验收（自动）：`pnpm test` 全绿；删除任一小节或改坏 `name` 时用例独立失败
  - 依赖：1.1

## 2. 插件工具（机械不变量）

- [x] 2.1 `review_daily_scan`：缺省交易日调 change 2 `traderKit.data.resolveTradeDate`（tool `get_trade_date`，`§1`；入参 canonical `YYYY-MM-DD`，兼容紧凑写法经 `src/data/date.ts`）解析，**MUST NOT** 读系统日期或由逐标的 T1 `tradeDate` 推导；扫描复用 `traderKit.review.scanDailyCardTargets(tradeDate)`（**不自行遍历目录**）；返回代码/名称/文档路径/**用户卡片数（不含附注）**/是否已有附注/`warnings[]`（`§3` 的 `warnings: string[]`，`§12.7`；**MUST NOT 出现 `storeWarnings[]` 这一字段名**）
  - 产物：`src/tools/review-daily.ts` 的 `review_daily_scan`
  - 验收（自动）：① 缺省交易日调用 T0（桩断言调用次数与入参）；② 篡改系统时钟不改变已确认交易日；③ 交易日不可得 → 返回显式「要求用户指定交易日」（**与「有交易日但无卡片」返回文案不同**）；④ 扫描路径全部来自映射表（结构断言：源码无手写业务区路径字面量）；⑤ change 4 导出返回的非空 `warnings[]` 原样上抛（断言 `storeWarnings` 字段名不存在）
  - 依赖：`blocked_by: change 2 / change 4`；`§1`、`§6`、`§12.7`、spec「输入枚举」「交易日来源」
- [x] 2.2 `review_read_daily`：经 `traderKit.review.locateDoc` + `traderKit.review.parseDoc` 取用户卡片集合（锚点/`writtenAt`/正文），**排除 `^ainote-` 分节**；代码入参经 `normalizeCode`
  - 产物：`src/tools/review-daily.ts` 的 `review_read_daily`
  - 验收（自动）：含附注文档读回后卡片集合不含附注；`sh600000`/`600000.SH` 入参归一后可读到同一文档；非法代码返回显式参数错误
  - 依赖：`blocked_by: change 4`（`parseDoc`/`normalizeCode`）、`§2`/`§3`
- [x] 2.3 `review_append_ainote`：**调用 `traderKit.review.appendAinote`**（同一实现），MUST NOT 另写追加/原子写；入参含 `code`/`tradeDate`（canonical `YYYY-MM-DD`）/`body`/`generatedAt`/`dataSources`；写前归属硬校验（frontmatter `tradeDate` + `code` == 目标 `loc`，不符即 `DOC_MISMATCH`）由 change 4 的实现承担，本工具 SHALL 原样上抛该错误与 `warnings[]`；工具 schema **MUST NOT 含 `force` / `overwrite`**（`§9` 无幽灵参数）
  - 产物：`src/tools/review-daily.ts` 的 `review_append_ainote`
  - 验收（自动）：① 结构断言「**文档写入（md）唯一实现 = `appendAinote`**；`src/summary/run-report.ts` 的 JSON 摘要为**独立**原子写路径（不同目录、不同锁），不构成第二份文档追加实现」且本工具调用到 `appendAinote`；② schema 快照断言无 `force`/`overwrite`/`refresh`；③ `DOC_MISMATCH` 与 `warnings[]` 原样上抛且磁盘无新增文件
  - 依赖：`blocked_by: change 4`（`§3`）
- [x] 2.4 四个工具的输出 schema 与中文渲染描述（写明幂等、只追加、依赖不可用时显式报错语义）+ service 出口注册（与工具同一实现）。**注册归属（`§11`/`§12.6`）**：本 change **只注册自己的出口**——tool `review_daily_report` 与 service `traderKit.review.dailyReport`；change 4 的五个 key（`traderKit.review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets}`）**只消费、不重复注册**（其所有者是 change 4）
  - 产物：工具注册 + service 装配代码（`src/index.ts` 或等价入口）
  - 验收（自动）：四工具均可在未配置数据根时挂载成功（挂载期不校验），调用期报错；tool 与 service 双出口返回同一结果（同一实现的契约测试）；结构断言本 change 未注册 change 4 的五个 key
  - 依赖：2.1–2.3、`§3`、`§11`、`§12.6`
- [x] 2.5 **依赖不可用显式报错**：当消费面不可用时——`traderKit.review.*`（change 4 五键）或 `src/review/store.ts` / `src/review/anchor.ts` / **`src/review/format.ts`** 的具名导出缺失、`traderKit.data.guardStatus()` 缺失（预算预检阶段）——相应工具/步骤 SHALL 返回 `DEPENDENCY_UNAVAILABLE`（含缺失接口名 + 所属 change 4/2 的任务号），**不产出任何文件**，运行摘要记 `failed`（原因 `dependencyUnavailable`）
  - 产物：依赖探测与错误构造代码 + 用例
  - 验收（自动）：注入空 service 容器 / 缺失 `format.ts` 导出 → 相应工具各自返回显式错误；断言磁盘零新增文件；断言运行摘要 `failed[]` 含 `dependencyUnavailable`；断言**不存在**自实现的兜底追加/格式化路径（结构断言）
  - 依赖：2.1–2.4、`§3`
- [x] 2.6 数据包 schema 校验（评审 Issue 11 / 31）：实现 spec「数据包 schema」的校验函数（字段/类型/`missing` 元素 `{field, reason}` 与原因枚举/必填键含 `cacheReused`/`limitReason.errors[]`）
  - 产物：`src/summary/package-schema.ts`
  - 验收（自动）：合法样本通过；逐项非法样本（缺 `tradeDate`、`missing` 元素为字符串、`available` 非布尔、`quote.fields` 缺 `source`、**`available=false` 时 `fields` 为 `null`**、缺 `cacheReused`）各自失败并点名字段
  - 依赖：spec「数据包 schema」（可先行）
- [x] 2.7 字节级口径 fixture（`§4`，评审 Issue 6）：
  - 实现登记（2026-09-28）：test/summary/ainote-bytes.test.ts 四用例（CRLF/BOM/无尾换行三类：分节切片比较 + 文件前缀比较[无尾换行允许补一个本文件 EOL] + BOM 唯一 + 不混排 + frontmatter 键序逐字节不变——经 appendAinote 同一实现）CRLF / UTF-8 BOM / 无尾换行三类 fixture + **分节切片比较** + **文件前缀比较**断言
  - 产物：测试 fixture（`fixtures/` 或测试内联构造）+ 断言用例
  - 验收（自动）：三类 fixture 各自断言 ① 各 `^card-` 分节字节序列不变；② 结果文件前 `len(原字节)` 字节 == 原字节（无尾换行时额外允许一个本文件 EOL）；③ CRLF 不混排、BOM 唯一、frontmatter 键序/引号不变；MUST NOT 仅做整文件包含/长度比较
  - 依赖：`blocked_by: change 4`（`appendAinote` 落地）、`§4`、spec「写入通道与原子性」
- [x] 2.8 幂等与日期一致性单测（评审 Issue 2 / 5 / 12 / 21 / 22 / 29 / 32）：
  - ① 正文含锚点字样（非 H2 行）→ 不误判、照常产出；
  - ② fenced code block（``` / ~~~）内锚点 → 不参与判定；
  - ③ 异常代码形态（`sh600000` / `600000.SH`）下幂等键一致 → 第二次 `skipped`；
  - ④ 幽灵锚点（锚点段 ≠ frontmatter 基准）→ 不计入并出现在 `parseDoc`/`scanDailyCardTargets` 返回的 `warnings: string[]`（`§3`，编码 `[ghostAnchor] <path> — …`；**字段名不得为 `storeWarnings`**；`ghostAnchor` 的导出归属登记见 design Open Questions 12）；
  - ⑤ `limitReason.tradeDate !== 目标交易日` → 降级 `missing`（`dateMismatch`）且附注标注；
  - ⑥ 23:59 与次日 00:05 对同一 `(交易日, 代码)` 各运行一次 → 第二次 `skipped`，文档只有一条附注且字节不变；
  - ⑦ **frontmatter `tradeDate`/`code` 与文件名/目标 `loc` 不一致** → change 4 抛 `DOC_MISMATCH`；断言**不产生第二条附注**且返回显式告警（归属基准唯一 = frontmatter，`§2`/`§3`）；
  - ⑧ 历史请求 T1 返回 `available=false` + `errors:['dateUnavailable']` → 登记 `sourceUnavailable`，正文 MUST NOT 出现「无涨停记录」（`§12.8`）；
  - ⑨ 附注写入后锚点为四段式、**不含 `-<seq>`**（序号仅 change 4 卡片使用）
  - 产物：幂等/日期一致性测试用例集
  - 验收（自动）：九类各自独立可失败；每条用例含「断言目标非空」（如先断言文档含 ≥1 个 H2 行）避免空过
  - 依赖：2.1–2.4、`§1`/`§2`/`§3`/`§12.8`
- [x] 2.9 运行摘要载体实现（评审 Issue 7 / 23）：`<数据根>/agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/daily-summary-run.json`，schema `{tradeDate, created[], skipped[], failed[{code,reason}], deferred[{code,reason}], missing[{code,field,reason}], warnings[]}`，原子写（临时文件 + 改名），与业务文档**不共用同一把锁**；空清单也落摘要
  - 产物：`src/summary/run-report.ts` + 用例
  - 验收（自动）：① 四态并集 ⊇ 扫描清单；② `failed`/`deferred` 每条 `reason` 非空（`length>0` 的用例同时断言 reason）；③ 中断不留半截 JSON；④ 空清单仍落摘要；⑤ 摘要写失败不影响已完成的文档写入；⑥ `warnings[]` 字段存在且为字符串数组
  - 依赖：2.1–2.4、spec「运行摘要与具名生产者出口」、`§10`
- [x] 2.10 交易日来源断言：缺省交易日只来自 T0；源码级禁止系统日期 fallback 与「逐标的 T1 `tradeDate` 推导扫描日期」
  - 产物：断言用例（源码级 + 行为级）
  - 验收（自动）：篡改系统时钟不改变结果；结构断言 `src/tools/review-daily.ts` 不含 `new Date()` 取目标交易日期的分支（允许用于「运行时刻」展示）
  - 依赖：2.1、`§1`
- [x] 2.11 **运行摘要具名生产者出口**（评审 Issue 19，`§12.6`）：tool `review_daily_report` + service `traderKit.review.dailyReport`（同一实现），入参 `{ tradeDate, entries: [{ code, status: 'created'|'skipped'|'failed'|'deferred', reason? }], missing?: [{code,field,reason}], warnings?: string[] }`（后两者为**可选回填通道**，不改变 `§12.6` 必填入参）；以 `(tradeDate, code)` 为键**合并写入** 2.9 的摘要（同键覆盖、其余保留），沿用 `§5` 互斥语义；出口**自身**调用 `traderKit.review.scanDailyCardTargets(tradeDate)` 取扫描清单，未出现于 `entries` 的代码补 `failed`（`reason='entryMissing'`）并记入返回 `warnings[]`；返回 `{ tradeDate, created[], skipped[], failed[], deferred[], missing[], warnings[] }`
  - 产物：`src/tools/review-daily.ts` 的 `review_daily_report` + service 注册 + 用例
  - 验收（自动）：① 「entries 代码集合 ⊇ scan 清单」**由出口自身完成**（桩注入 `scanDailyCardTargets` 清单 → 提交缺项 entries → 读回摘要断言 `entryMissing` 补入且并集覆盖清单；断言调用方**不传**清单也能成立）；② 入参 `missing`/`warnings` 回填后摘要与返回同值，未传时为 `[]`（字段存在）；③ `failed`/`deferred` 的 `reason` 非空且缺失时入口显式参数错误；④ 两批运行的合并与「同入参重复调用字节不变」幂等；⑤ 依赖不可用时返回 `DEPENDENCY_UNAVAILABLE` 且不写摘要；⑥ 结构断言调用方（skill/agent）无法绕过本出口写摘要文件
  - 依赖：2.9、2.4（注册归属）、`blocked_by: change 4`（自扫调用 `scanDailyCardTargets`）、spec「运行摘要与具名生产者出口」、`§5`、`§12.6`

## 3. 取数集成、合规与预算

- [x] 3.1 数据包组装规格写入 skill（`quote` / `limitReason` / `missing` / `source` / `fetchedAt` / `skillVersion` / `cacheReused`），并说明当日表现经 TQ skill（tq-local `get_more_info`）、涨停原因经 change 2 的 T1 `get_limit_reason`
  - 产物：skill 正文「数据包」小节（1.1 的一部分，独立验收）
  - 验收（自动）：脚本断言 skill 正文含全部字段名与 `missing` 原因枚举；人工复核字段来源描述与 spec 表一致
  - 依赖：1.1、2.6、spec「数据包 schema」
- [x] 3.2 四态结果摘要与单标的失败隔离（含 D-10 判定矩阵，T1 **按 `errors` 三档**）：任一路成功 → `created`（部分，带 `missing` 与「数据完整性」行）；两路皆失败 → `failed`（不写文档）；T1 `errors` 含 `dateUnavailable` → `missing`（原因 `sourceUnavailable`，正文「该日涨停原因数据不可得」，**MUST NOT 写「无涨停记录」**）；`available=false` 且不含 `dateUnavailable` → `noRecord`（不计 `failed`）
  - 产物：编排逻辑（skill 步骤 + 工具返回契约）
  - 验收（自动）：矩阵六行各一条用例（桩注入 TQ/T1 组合），断言状态、`missing` 内容与是否写文档
  - 依赖：2.6 / 2.9、spec「失败判定矩阵与重算指引」
- [x] 3.3 合规门禁（评审 Issue 14）
  - 实现登记（2026-09-28）：`scripts/scan-compliance.mjs`（只扫 ^ainote- 分节、跳围栏、附注声明检查；--self-test 9 样本断言通过）；对真实产出（N≥5）的运行留波 4 实机验收：① skill 含正向骨架 + 负向词表（`必须买`/`建议买入`/`目标价`/`必涨`/`可重仓`/`确定性加仓`/`满仓`/`稳赚`/`保证收益`）+ 固定定位声明行；② 提供扫描脚本 `scripts/scan-compliance.mjs`（或等价）：读 `DB/review/**/*.md` 中 `^ainote-` 分节正文，匹配负向词表并输出命中数；③ 判定标准 **零命中**
  - 产物：skill 文案（1.1）+ 扫描脚本 + 验收记录（命令 + 输出命中数 + 被检查附注路径清单）
  - 验收：**自动**= 脚本对 N≥5 份真实产出运行、断言命中数 `0` 且每份附注含定位声明行；**人工**= 复核「无复述用户主观判断、无补猜缺失值」，记录结论。两类证据分列，缺任一类视为未验收
  - 依赖：1.1、（可先行，脚本不依赖实现）
- [x] 3.4 缓存核对（**范围收窄**，评审 Issue 4）：
  - 实现登记（2026-09-28）：T1/T2 侧自动断言已由 change 2 test/data-cache.test.ts 承载（同日第二次取数出站计数 0、预算用量不变——列表级缓存键 source+requestedDate），此处引用不重复实现；TQ skill 侧人工字段样例（fetchedAt/cacheReused/skillVersion）留波 4 实机粘贴仅 **T1/T2 侧**自动断言「同一交易日第二次取数出站请求计数为 0、预算用量不变」（`§9` 列表级缓存）；**TQ skill 侧**改为人工证据：粘贴数据包字段样例，含 `fetchedAt` 与 `cacheReused`（及 skill 名与版本）
  - 产物：T1 侧自动用例 + TQ 侧人工证据记录
  - 验收：**自动**= T1 侧计数断言（桩计数出口，扫描前先断言目标非空）；**人工**= TQ 字段样例三项（`fetchedAt` / `cacheReused` / `skillVersion`）齐备。spec 与文档 MUST NOT 声称 TQ 路径可自动断言零网络
  - 依赖：`blocked_by: change 2`（计数与缓存出口）、2.6
- [x] 3.5 预算预检与分批（评审 Issue 16 / 25）：运行前经 change 2 的具名出口 `traderKit.data.guardStatus()`（字段 `remaining`/`budgetLimit`/`budgetUsed`/`minIntervalMs`/`sessionState` 等；`§9`：按列表级请求数计）读取剩余预算与批量硬上限；不足时输出「本次可处理前 N 个标的」+ 剩余数，被截断项记 `deferred`（**不计 `failed`**）并提示续跑；MUST NOT 静默排队/静默截断；**出口不可用/字段缺失 → `DEPENDENCY_UNAVAILABLE`**，MUST NOT 自建预算计数、MUST NOT 静默跳过预检
  - 产物：预算预检与分批编排 + 用例
  - 验收（自动）：① 预算充足 → 全量处理；② 预算仅够 N → 断言处理前 N 个、其余 `deferred`、返回信息含「前 N 个」；③ 预算耗尽返回显式失败且**不长时间等待**（假时钟断言无 sleep 型等待）；④ 分批续跑后并集覆盖全清单；⑤ `guardStatus()` 缺失/字段不全 → 预检显式 `DEPENDENCY_UNAVAILABLE`（不静默继续）
  - 依赖：`blocked_by: change 2`（`traderKit.data.guardStatus()`；字段契约确认见 design Open Questions 13）、2.1

## 4. 单测与验收

- [ ] 4.1 端到端验收（人工，盘后）：当日有卡标的产出 AI 附注；无卡标的零打扰；交易日不可得时显式要求指定
  - 产物：证据记录（命令 + 输出片段 + 产物路径 `…/DB/review/<YYYYMM>/<代码>_<名称>_<YYYYMMDD>.md`）
  - 验收：三项证据齐备且可复现；附注含全部固定行（元信息 / 数据完整性 / 定位声明）
  - 依赖：1.x、2.x、3.x
- [ ] 4.2 幂等验收：重复运行不重复追加；删除附注后重跑可重新生成
  - 产物：证据记录（两次运行的返回 + 文档字节对比输出）
  - 验收：第二次全部 `skipped`；删除后重跑 `created` 且用户卡片分节字节不变
  - 依赖：2.8、2.9
- [ ] 4.3 用户卡片零改动验收：按**分节切片 + 文件前缀**口径断言
  - 产物：自动用例（2.7）+ 人工抽查记录
  - 验收：三类 fixture（CRLF/BOM/无尾换行）自动断言全绿；人工抽查 1 份真实文档给出前缀哈希前后一致
  - 依赖：2.7
- [ ] 4.4 数据源与日期不一致验收：T1 主备均失败 → 该标的 `failed`（带原因）或部分附注；`tradeDate` 不一致 → 降级 `missing`（`dateMismatch`）并在附注标注
  - 产物：桩注入用例 + 证据记录
  - 验收：两类场景各自断言；失败标的出现在运行摘要 `failed[]` 且 `reason` 非空
  - 依赖：3.2、2.9
- [ ] 4.5 可发现性验收：经宿主 skills 服务核对解析路径 == 数据根落点；遮蔽时警告可见
  - 产物：证据记录（服务返回的路径字段摘录 + 状态输出）
  - 验收：路径相等；构造遮蔽时状态输出含遮蔽警告（实际路径 + 期望落点）
  - 依赖：1.4
- [ ] 4.6 缓存验收（区分自动/人工）：T1 侧自动计数断言；TQ 侧人工字段样例
  - 产物：3.4 的两类证据
  - 验收：自动用例退出码 0；人工样例三项字段齐备
  - 依赖：3.4
- [ ] 4.7 预算验收：预算不足时行为显式且不静默排队
  - 产物：3.5 的用例输出 + 证据记录
  - 验收：返回含「前 N 个标的」；`deferred` 与 `failed` 在摘要中分列
  - 依赖：3.5

## 5. 文档与门禁

- [ ] 5.1 **文档任务（纳入门禁）**：① `docs/roadmap.md` —— §5「迭代一重排」**仅引用**（本 change 不改 docs；若实现期产生新裁决，由 Lead 统一增补）；② `docs/architecture.md` —— 补每日汇总工作流（skill 落点、运行摘要 temp 路径、`DB/review` 产物位置）与「阶段 5 折算」口径；③ `AGENTS.md` —— 「vault 写入」条目补两条白名单路径例外（`DB/review/`、`agent/DB/temp/dsh-trader-kit/`，阶段 4 起触 vault 的行文改为「除本迭代两条白名单路径外」）；④ `vault-integration` 写分区契约补登这两条路径（`§10`）
  - 产物：四处文档改动（diff 或章节号 + 摘录）
  - 验收（人工但可指认）：四项均有可指认落点；③④ 显式声明两条白名单路径；②含 skill 落点与 temp 摘要路径
  - 依赖：`§10`、`docs/roadmap.md §5`；（本 change 的 tasks 只**登记**这些改动需求；实际改动落在对应文档 owner）
- [ ] 5.2 门禁：`pnpm typecheck && pnpm build && pnpm test` 全绿，且 **5.1 文档任务与 3.3 合规扫描同属门禁项**（未完成视为未通过）
  - 产物：门禁运行输出片段（命令 + 结果行）
  - 验收：三条命令退出码 0；5.1 四项与 3.3 均已勾选
  - 依赖：全部实现任务

## 6. Requirement ↔ task ↔ 测试/证据 映射

| Requirement（spec） | task | 测试 / 证据（自动 / 人工） |
| --- | --- | --- |
| 触发方式 | 2.1 / 2.9 | 2.1（三态返回）；4.1（人工） |
| 输入枚举 | 2.1 | 2.1（映射表结构断言 + 跨月用例） |
| 交易日来源（唯一实现） | 2.1 / 2.10 | 2.10（系统时钟篡改 + 结构断言）；2.8⑥ |
| 取数与缓存 | 3.4 / 3.5 / 2.8⑤ | 3.4（T1 侧自动 / TQ 侧人工）；2.8⑤ |
| 数据包 schema | 2.6 / 3.1 | 2.6（合法/非法样本） |
| 总结生成约束 | 1.1 / 3.3 | 3.3（扫描 + 人工复核） |
| 合规与写作约束 | 3.3 | 3.3（零命中） |
| 失败判定矩阵与重算指引 | 3.2 | 3.2（矩阵六行）；4.4 |
| 预算预检与分批 | 3.5 | 3.5；4.7 |
| 运行摘要与具名生产者出口 | 2.9 / 2.11 / 2.5 | 2.9（四态并集与 `reason` 非空）；2.11（出口自扫 `⊇` 清单、`missing`/`warnings` 回填、合并幂等）；2.5（依赖不可用条目） |
| AI 附注落盘契约 | 2.3 / 2.8 | 2.3（调用同一实现）；2.8①②⑥ |
| 附注元信息行 | 1.1 / 2.3 | 2.3（元信息行可解析断言）；4.1 |
| 幂等 | 2.3 / 2.8 | 2.8①②③④；4.2 |
| 写入通道与原子性 | 2.3 / 2.5 / 2.7 | 2.7（切片/前缀）；2.5（依赖不可用）；4.3 |
| skill 落点与可发现性 | 1.1 / 1.4 | 1.4（三态）；4.5 |
| 部署语义 | 1.2 | 1.2（三态，自动或人工降级分支） |
| 下游解析口径 | 2.2 | 2.2（排除 `^ainote-`）；卡片数口径断言 |

### 证据格式（4.x 强制）

每条人工验收 MUST 落三项证据：① **命令**（可复制执行）；② **输出片段**（关键行，含用例数/退出码/命中数/路径字段）；③ **产物路径**（落盘 md 或 `daily-summary-run.json` 的绝对路径）。仅写「手工验收通过」不构成证据。自动验收 MUST 给出可独立失败的用例名。
