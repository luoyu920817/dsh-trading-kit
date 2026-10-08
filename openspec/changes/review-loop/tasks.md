# review-loop 任务书

> 规格：`specs/review-panel/spec.md`、`specs/stock-profile/spec.md`、`specs/daily-brief/spec.md`、
> `specs/daily-summary/spec.md`（delta）；设计依据：本目录 `design.md`（D-1…D-9）。
> 纪律沿本仓既有：零 mock、零 sleep、断言完整；机械不变量在代码层；「复用」必须落到具名接口。

## 0. 依赖分组与 blocked_by

| 依赖 | 具名接口 | 状态 |
| --- | --- | --- |
| change 2 `data-foundation` | `resolveArea`（区域表 `src/paths/mapping.ts`）、`src/data/date.ts`（`toCompactDate`/`fromCompactDate`/`isValidIsoDate`）、`traderKit.data.resolveTradeDate`、`traderKit.data.guardStatus()` | 已在 |
| change 4 `review-page` | `src/review/store.ts` 的 `scanDailyCardTargets`（`traderKit.review.scanDailyCardTargets`）、`src/review/md/frontmatter.ts`、`src/review/anchor.ts` 的 `normalizeCode`、`src/review/format.ts` 的 `formatZonedIso`、`/review` 路由族与认证分层 | 已在 |
| change 5 `daily-summary` | 四工具、`src/summary/run-report.ts` 的 `readRunReport`/`runReportPath`、`review_daily_report`（运行摘要唯一生产者） | 已在（波 4/5 人工项除外） |
| change 3 `tq-skill-installer` | TQ skill 安装与 `skill.status` | 部分（指数段取数依赖其覆盖，见 D-5） |

- **blocked_by**：§2 起的全部实现任务 blocked_by §1.1–1.3（spike 结论）；§5（client 面）blocked_by §1.2；
  §7.1 端到端验收 blocked_by §6.7（skill 部署）与 §5（面板可用）。
- **本 change MUST NOT 修改**：运行摘要 schema（D-8）、卡片/附注写通道与既有档案内容、`/review` 既有读接口语义、C 层签字放宽点集合、`dataRootWhitelistPaths`（skill 安装白名单保持三条）。
- **本 change 唯一新增写面**：`DB/stock/` 的 **create-only 建档**（首卡懒创建；见 tasks §2.6–2.9 与 §7.6/7.7）。

> **实现进展（2026-10-06，本仓实现）**：§2–§6 代码与单测已落地（§2 区域表/档案读取/首卡懒创建、§3 盘面 md 产物与写工具、§4 `/api/day` 与 TQ-Local 只读兜底、§5 DSH 客户端面板与打包、§6 skill 文本）；§7.6 文档与写分区登记完成；门禁（typecheck/build/test）全绿。**未完成**：§1 波 0 实机 spike（面板槽注册的实机核验——需重装插件到 `web` profile 并在 DSH 界面确认入口）、§6.7 skill 部署与可发现性核对、§7.1–7.5/7.7–7.9 人工验收（盘后实跑、TdxW 开关演练、回滚演练等）。

## 1. 波 0：面板通道 spike（最高风险先行）

- [x] 1.1 **宿主能力核验**：记录运行版本（当前 `0.1.7-rc.1`）与槽位存在性（`sidebar.panellist` / root keyed `main`）、`ctx.conversation.send` 可用性、`dsh.client` 装载路径；产出一份事实清单（命令 + 输出摘录），与 `design.md` 的 Context 表逐项对齐
- [ ] 1.2 **最小面板 spike**：`tsdown` 双入口 + `package.json` 的 `exports["./client"]` 与 `dsh.client`；一个图标 + 一个面板 + 一个按钮（按钮 `ctx.conversation.send('…')`）；经 `file:` 渠道装入 `web` profile 后**实机验证**三项：入口可见 / 面板渲染 / 按钮使会话出现该 prompt
- [x] 1.3 **spike 报告**：落 `docs/spikes/review-panel-slots.md`（结论、证据、未通过判据、回退判定 D-2 / D-2b）
- [ ] 1.4 **回退分支（仅当 1.2 未全通过）**：按 D-2b 切 `sidebar.footer.action` + 弹出面板（或退回会话口令 + 提示文案）；同步修订 spec 的「面板注册与入口」并要求 owner 签字偏离

## 2. 区域表与标的档案复用（stock-profile）

- [x] 2.1 `src/paths/mapping.ts` 增两个区域 key：`stock`（`dir: 'DB/stock'`，无模板，`status: 'active'`，note 写明「owner 维护、插件只读」）与 `brief`（`dir: 'DB/review/<YYYYMM>'`，`template: '<date>-summary.md'`，`params: ['date']`，`status: 'active'`）；补区域表单测（解析 + 未登记 key 报错文案）；**断言写白名单仍为三条**（`dataRootWhitelistPaths` 不由区域表派生，新增区域不放宽写权限）
- [x] 2.2 **工具 `review_stock_profiles` + service `traderKit.review.stockProfiles`（同一实现）**：定位规则（名称直配 → `代码` 索引兜底 → 未命中）、逐文件 frontmatter 解析（复用 change 4 `src/review/md/frontmatter.ts`，宽容接受三种既有变体）、出参 `{entries, warnings}`（`code?`/`name`/`role?`（= **`角色` 键**原文，trim）/`isAnchor`/`hotTags?`（仅供展示，不进上下文）/`path`）、缺省（无 `codes`/`names`）= 目录内全部 `锚点: true` 且含 `代码` 者（按 `code` 升序）
- [x] 2.3 单测（零 mock，真实临时目录 + 真实文件）：目录缺失（`stockDirMissing` + 空表不失败）；名称直配命中 / `代码` 索引兜底 / 双未命中（不入结果、无告警）；`代码` 与目标不一致（warnings + 不注入）；一代码多档案（warnings + mtime 最新）；降级矩阵（仅 `板块` 空壳 / 有 `角色` 无其它 / 有 `热点标签` 无 `角色`）；**注入面收窄断言**（`热点标签`/`板块`/`当前题材`/`题材地位`/`# 股性` 不出现在工具的业务内容出参中）；**零出站 + 只读断言**（网络 seam 未调用；文件字节与 mtime 不变）
- [x] 2.4 依赖不可用显式报错：区域未登记 / 解析导出缺失 → `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），MUST NOT 自实现兜底
- [x] 2.5 **数据格式化建议文档化**：把「档案字段契约（`角色`（agent 重点）/`代码`/`锚点`，展示字段不进上下文）+ 8 个锚点建档清单与模板」写进 skill 文本（§6.5）；`角色`/`锚点` 内容 **MUST NOT 代写**
- [x] 2.6 **懒加载建档实现 `src/review/profile-create.ts`**：命名（`<名称>.md`，经 change 2 `sanitizeNameSegment`；名称空/退化为代码 → 不建 + `warnings: nameUnavailable`）、骨架渲染（`代码` + 主变体四键 + 空 `角色` + `# 股性`/`# 记录` + `![[stock-info.components]]`）、**`wx` 排他创建**（已存在即放弃；无覆写/补键/改名/删除）、半截文件清理、异步触发与**可注入完成等待 seam**（供测试）、至多一次尝试
- [x] 2.7 接线：在卡片写入成功路径触发建档（routes 写卡分支或 store 侧回调，二选一并在 design 记一行）；**断言卡片写入结果与建档结果解耦**（建档失败/慢 → 写卡响应与状态不变）
- [x] 2.8 建档单测（零 mock，真实临时目录）：首建成功（骨架逐键断言）；**二次写卡零改动**（字节 + mtime 不变）；名称为空不建档；同名冲突（目标存在但 `代码` 不同）放弃 + warnings；建档失败不阻塞写卡（只读目录场景）；并发两写卡只建一份（`wx` 语义）
- [x] 2.9 **写路径审计测试**：全仓不存在对 `DB/stock/**` 的覆写/改名/删除路径（除 `wx` 创建）；`src/skill/root.ts` 的 `dataRootWhitelistPaths` 仍为三条

## 3. 盘面 md 产物（daily-brief）

- [x] 3.1 `src/summary/brief.ts`：四段渲染（标题 + 固定行 + `## 一、指数` / `## 二、情绪` / `## 三、赚钱效应` / `## 四、题材`），frontmatter（`tradeDate`/`generatedAt`（`formatZonedIso`）/`kind`/`anchors`/`missing`/`warnings`），生成提示行（「本文件由工作流生成，重跑覆盖」）
- [x] 3.2 **工具 `review_write_brief` + service `traderKit.review.writeBrief`（同一实现）**：入参校验（`tradeDate` canonical、四段非空）、原子写（同目录临时文件 + rename + 失败清理）、**同交易日覆盖重写**、返回 `{path, tradeDate, bytes, generatedAt, replaced, warnings[]}`；schema **无** `force`/`overwrite`/`refresh`
- [x] 3.3 单测：覆盖重写（旧字节不留、目录内无 `-v2`/`.bak`）、原子性失败清理（注入 rename 前失败）、结构校验失败显式报错（点名段/字段）、给定相同入参字节稳定（除 `generatedAt`）
- [x] 3.4 **解耦断言**：工具只写 brief 路径（源码级：唯一写入点为 `brief` 区域）；执行前后卡片文档与附注文件字节不变；盘面 md 不进 `scanDailyCardTargets` 计数
- [x] 3.5 合规行与负向词表：渲染模板固定含「研究辅助、不构成投资建议」与「数据完整性：…」行；词表扫描脚本复用 change 5 既有脚本（不新写第二份）

## 4. 读接口与 TQ-Local 只读兜底（review-panel 后端 + tq-local-lookup）

- [x] 4.1 `GET <basePath>/review/api/day?date=`：`targets`（`traderKit.review.scanDailyCardTargets`）、`runReport`（`readRunReport(runReportPath(dataRoot, tradeDate))`）、`brief`（`{exists, path, generatedAt}` 经 `resolveArea('brief')` + `stat`）、`tradeDate`/`dateSource`；missing 与 warnings 原样上抛
- [x] 4.2 路由注册进既有调度器（不与 `/api/local`、`/api/enrich`、`/api/dates`、`/api/card` 重叠）；非 GET → 405
- [x] 4.3 错误档：`dataRoot` 未配置 → 200 + `DATA_ROOT_UNCONFIGURED` + 指引；日期非法 → 400 + 期望格式；交易日不可得 → `dateSource='unavailable'` + 短提示（MUST NOT 用系统日期）
- [x] 4.4 纯本地断言：该 handler 不产生出站请求（网络 seam 未调用）；缺省日期只经 T0 service 出口
- [x] 4.5 单测（`test/routes-review/`）：三态（未运行 / 已运行 / 无卡片）、非法日期、未配置数据根、读通道认证档（未新增放宽点 + 无写方法）

- [x] 4.6 **TQ-Local 出口 `src/data/tq-local.ts`**：JSON-RPC 请求体构造（`id` 固定、`method` 取白名单常量、`params` 仅 `stock_code`/`field_list`）、**method 与字段白名单常量（全仓唯一字面量定义点）**、代码后缀候选序列（调用方 `marketSuffix` 优先，否则 `.SH`→`.SZ`→`.BJ`；判据 = `ErrorId==="0"` 且 `Name` 非空；命中即停）、2 s 硬超时 + 零重试、出参按 `tq-local-lookup` spec（字符串原样、`J_start==='0'` → `null`、缺失一律 `null`）
- [x] 4.7 **`src/data/http.ts` 拦截规则收窄**：17709 仅放行本出口白名单请求，其余仍 `blockedEndpoint`；保持「数据面唯一 `fetch(` 点」不变式（MUST NOT 新增第三条具名出站通道）
- [x] 4.8 缓存与开关：进程内存 TTL 24 h 缓存（键 = 归一后 `code`、条目上限、失败不缓存）；`config.sources.tqLocal.enabled`（默认 `true`，owner 2026-10-06）关闭时零请求返回 `available=false`；开关状态经既有 `health.status()` 机器可读面透出（不新建状态出口）
- [x] 4.9 工具 `get_stock_basics` + service `traderKit.data.stockBasics`（同一实现）：入参 schema 仅 `code`（必填）+ 可选 `marketSuffix`（枚举），**MUST NOT** 有任意 params 透传口；工具输出经 `formatZonedIso` 带 `fetchedAt`
- [x] 4.10 `/api/enrich` 接线：名称反查层②扩为**内部三级**（T2/S8 → 行情名称源 → TQ-Local，`nameSource: 'tq-local'`），并新增可选段 `basics`（`kind`/`listedAt`/`region`/`industry`/`floatSharesWan`/`totalSharesWan`）；**层①命中时零 TQ 请求**；不可用时其余字段（标签/涨停原因）照常
- [x] 4.11 单测与结构断言（零 mock：真实本机 `node:http` 桩服务，沿仓内先例）：命中（后缀候选命中即停、请求计数 == 1）；全候选未命中（计数 == 3、`reason='noRecord'`）；服务不可达/超时（`sourceUnavailable` + `notes` 原文）；**白名单不可绕过**（传入任意 params 无效、无白名单外 method 路径）；缓存命中零请求、失败不缓存、开关关闭零请求；`/api/enrich` 层①命中零请求；源码级：全仓 17709 调用点唯一 + method 字面量集合 == 白名单

## 5. DSH 客户端面板（client 面）

- [x] 5.1 `src/client/index.ts`：`ctx.slots.register`（`sidebar.panellist` 项 + root keyed `main` 组件，同 id `trader-kit-review`）；注册经 `ctx.effect` 管理（卸载释放、不重复）；槽缺失时记日志跳过（不抛错、不白屏）
- [x] 5.2 面板组件：五块渲染（交易日 + 来源档 / 标的清单 / 四态计数 + 逐条原因 / 盘面 md 状态 / 按钮）；每块独立降级；外部文本纯文本转义
- [x] 5.3 触发按钮：固定 prompt 常量（与 skill 触发短语同文，见 6.1）；发送中/运行中禁用 + 进行中文案；发送失败显示原因 + 重试
- [x] 5.4 打包：`tsdown` 双入口（host + client）；`package.json` 增 `exports["./client"]`、`files` 含 `lib`、`dsh.client = { platform: 'web', inject: [...] }`；宿主 SDK 与 React 家族 external
- [x] 5.5 构建断言测试：`lib/client.js` 存在 + marker 串；`lib/**` 无 `http(s)://` 外链（白名单仅注释内规范链接）；`dsh.client` 字段合法（`platform` 字符串、`inject` 为字符串数组）；无宿主 SDK 实现副本
- [x] 5.6 安全断言：prompt 为常量（无动态插值/无模板拼接）；无新增写方法；不读宿主任意文件；不携带 `writeKey`

## 6. skill 文本（W6 + 标的档案 + 触发短语 + 格式化建议）

- [x] 6.1 `skills/review-daily-summary/SKILL.md` 增「触发短语」段（固定一句，面板复用同文；含「不带日期字面量」约束）
- [x] 6.2 W3 增**标的档案步骤**：经 `review_stock_profiles` 取当日标的档案 + 全量锚点，命中者入数据包 `profile`（未命中不出现该键）
- [x] 6.3 W4 写作约束增「标的档案」条：作生成口径、标注来源路径、MUST NOT 当行情事实、MUST NOT 复述档案为用户判断、过时题材不冒充当日事实
- [x] 6.4 新增 **W6 盘面整理收尾**：四段汇总 → `review_write_brief`；指数段成员 = `锚点: true` 档案；无卡片跳过；独立成败（不改变附注/摘要结果）
- [x] 6.5 **数据格式化建议写入 skill**：档案字段契约表（`角色`（agent 重点）/ `代码` / `锚点`；展示字段不进上下文）+ 首卡懒创建说明（骨架形态）+ 8 个锚点建档清单与模板（含 `角色` 示例），供 owner 在 Obsidian 内建档/填写
- [x] 6.6 skill 文本断言测试（既有 `test/skill/**` 同款）：必需小节（触发短语 / 标的档案 / W6 / 来源与缺失纪律 / 格式化建议）存在
- [ ] 6.7 **部署与可发现性**：skill 落 `<数据根>/agent/skills/review-daily-summary/`（沿 change 5 波 4 未完成时的顺带交付）并经宿主 skills 服务核对解析路径与遮蔽告警

## 7. 验收、文档与门禁

- [ ] 7.1 **端到端（人工，盘后）**：面板按钮触发 → 会话出现固定 prompt → 逐标的附注 + 盘面 md 落盘 → `/api/day` 与面板状态一致；重复触发：附注 `skipped`、盘面 md 覆盖（`replaced=true`），无 `-v2`
- [ ] 7.2 **标的档案验收**：命中档案的附注与盘面 md 出现 `角色` 要点与来源路径（`DB/stock/<名称>.md`），且产物中无新增行情数字（抽样 2 份）、无 `热点标签`/`# 股性` 内容；未命中标的产物无档案痕迹；**既有档案**字节与 mtime 全程不变
- [ ] 7.3 **缺失口径验收**：指数段数据不可得时逐行显式标注 + `missing` 登记；扫描断言无 `0`/`--`/空白冒充
- [ ] 7.4 **合规扫描**：盘面 md 跑既有负向词表脚本（N≥3 份）零命中 + 免责行存在
- [ ] 7.5 **回滚演练**：`web` profile 禁用 `trader-kit` 行 → 面板消失、会话工具与 `/review` 页面不受影响；恢复后入口复现
- [x] 7.6 **文档与写分区登记（必做）**：`AGENTS.md` 的 vault 写入条目新增第 4 条路径 `DB/stock/`（**只建不改**：仅首卡懒创建骨架）；`vault-integration` 写分区契约同步登记；`docs/roadmap.md §5` 登记 owner 裁决（DB/stock 档案复用 + `角色` 新键 / 首卡懒创建建档 / DSH 面板入口+按钮 / 盘面 md 覆盖重写 / **D-TQ 复审结论 = 选项 B 局部放开，放宽点表见 design D-11**）与 review-loop 条目；`docs/architecture.md` 补 client 面、`DB/stock` 写路径与盘面 md 产物位置
- [ ] 7.7 **建档实机验收（人工）**：对一个此前无档案的标的写第一张卡 → 卡片写入即时成功、档案随后出现（骨架正确）；再写第二张卡 → 档案字节与 mtime 不变；名称为空场景不产生 `<代码>.md`；失败场景（只读目录）只告警不阻塞
- [ ] 7.9 **TQ-Local 兜底验收（人工 + 实机）**：TdxW 在跑时页面打开 `999999` / `880823` → 显示名称（`nameSource='tq-local'`）且 `basics` 段到位（股本两项可补位四格）；关闭 TdxW → 名称回落「名称未获取」且标签/涨停原因/输入/卡片区不受影响；桩服务复核「仅 `get_stock_info`、无行情/交易 method」；`sources.tqLocal.enabled=false` → 零请求
- [x] 7.10 **门禁**：`pnpm typecheck && pnpm build && pnpm test` 全绿；2.9 / 6.6 / 5.5 的断言属门禁项；本 change 的 4.11 结构断言同属门禁

## 8. Requirement ↔ task ↔ 验收 映射

| Requirement（cap） | tasks | 验收 |
| --- | --- | --- |
| 面板注册与入口（review-panel） | 1.1–1.4、5.1 | 1.2 实机三项、5.5 |
| 触发按钮与会话注入（review-panel） | 5.3、6.1 | 7.1、5.6 |
| 当日状态读接口（review-panel） | 4.1–4.5 | 4.5 单测、7.1 |
| 面板渲染与降级（review-panel） | 5.2 | 7.1（四态与空态） |
| client 打包与宿主 SDK 纪律（review-panel） | 5.4、5.5 | 5.5 |
| 面板安全边界（review-panel） | 4.3、5.6 | 5.6、7.5 |
| 档案读取（复用 DB/stock）（stock-profile） | 2.1、2.3、2.5 | 2.3 单测 |
| 懒加载建档（首次写卡触发，异步）（stock-profile） | 2.6–2.8 | 2.8 单测、7.7 实机 |
| 写分区与安全边界（stock-profile） | 2.6、2.9、7.6 | 2.9 审计、7.7 |
| 档案字段契约与格式化建议（stock-profile） | 2.2、2.5、6.5 | 2.3（降级矩阵/注入面收窄）、7.2 |
| 读取工具与具名接口（stock-profile） | 2.2–2.4 | 2.3、2.4 |
| 注入语义（stock-profile） | 6.2–6.4 | 7.2 |
| 成员集合维护与边界（stock-profile） | 2.2、6.5 | 2.3（无 TDX 依赖断言）、7.2 |
| 产物路径与命名（daily-brief） | 2.1、3.1 | 3.4 |
| 产物结构（daily-brief） | 3.1、3.5 | 7.3、7.4 |
| 写通道（daily-brief） | 3.2–3.4 | 3.3、3.4、7.1 |
| 合规与写作约束（daily-brief） | 3.5 | 7.4 |
| 独立性（daily-brief） | 3.4、6.4 | 7.1（盘面失败演练） |
| 下游读取口径（daily-brief） | 4.1 | 4.5 |
| 触发方式（daily-summary MODIFIED） | 5.3、6.1 | 7.1 |
| 数据包 schema·profile（daily-summary MODIFIED） | 6.2、6.3 | 7.2 |
| W6 盘面整理收尾（daily-summary ADDED） | 6.4 | 7.1、7.3 |
| 出口与依赖归属（tq-local-lookup） | 4.6、4.9 | 4.11 |
| 请求契约（method/字段白名单）（tq-local-lookup） | 4.6、4.7、4.11 | 4.11（结构断言 + 桩服务） |
| 出参契约（tq-local-lookup） | 4.6、4.9 | 4.11 |
| 缓存（tq-local-lookup） | 4.8 | 4.11 |
| 开关与降级（tq-local-lookup） | 4.8 | 7.9 |
| 接线与消费（tq-local-lookup） | 4.10 | 7.9 |
| 名称三级兜底的分层归属（review-page MODIFIED） | 4.10 | 7.9 |
| 只读边界（data-tool-contract MODIFIED） | 4.7、4.11 | 4.11 结构断言、7.9 |
