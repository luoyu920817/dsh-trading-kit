## Why

复盘线已有「现场卡片（change 4）」与「后置 agent 总结（change 5）」两段，但**闭环缺三块**：① 触发只能靠在会话里说口令，DSH 页面里没有入口；② **标的上下文**没有进入工作流——`DB/stock/` 下 owner 已维护的标的档案（板块/题材地位/股性）与关联标的（通达信「Z指标」板块 8 个锚点：上证指数/沪深300ETF/科创50/平均股价/全A等权/中证1000/微盘股/昨日涨停）的**角色**（给 agent 的口径：`中军` / `情绪主锚` / `赚钱效应` / `情绪周期` …）都没被读取，agent 把它们当普通个股处理，语义缺失；③ 没有任何**日级产物**，当天地面事实只散落在各标的 md 的附注里，读回只能逐个文件翻。

本 change 把这条链补成**最小可用闭环**：DSH 侧入口 + 一键触发 → 逐标的整理（复用既有附注 + **注入 `DB/stock` 标的档案上下文**）→ 当日盘面 md（指数/情绪/赚钱效应/题材四段）落盘。至此「写卡 → 触发 → 整理 → 读回」闭环成立，且不引入任何行情取数新能力（v1 只用现有源，缺项显式标注）。

## What Changes

- **DSH 客户端面板（本插件首个 client 面）**：经宿主 slot 系统注册 `sidebar.panellist` 入口（图标 + 标题）与 `main` 作用域内容页；面板含**「整理今日复盘」按钮**——按钮 SHALL 经客户端会话服务 `ctx.conversation.send(text)` 发送一条固定 prompt，由 agent 执行既有 `review-daily-summary` skill（等价于会话内手动触发，**MUST NOT** 另造绕过 skill 的执行路径，**MUST NOT** 由插件自建 agent 运行）。
- **面板状态读接口**：新增 `GET <basePath>/review/api/day?date=`（纯本地、零出站）：当日有卡标的清单、运行摘要四态、盘面 md 存在性；面板据此渲染当日状态与运行结果（读通道沿既有 C 层签字范围，不新增放宽点）。
- **TQ-Local 只读兜底（名称 + 最小基础信息；D-TQ 裁决落地）**：新增出口工具 `get_stock_basics`（service key `traderKit.data.stockBasics`）——经 `src/data/http.ts` 同一条出站通道向 `127.0.0.1:17709` 发**唯一白名单 method `get_stock_info`**（params 仅 `stock_code`/`field_list`（常量白名单）、仅回环、2 s 硬超时、零重试、进程内存 TTL 缓存、开关 `sources.tqLocal.enabled` 默认 `true`）。接线到 `/api/enrich` 的名称反查链**层②第三级**（T2/S8 → 行情名称源 → TQ-Local，`nameSource: 'tq-local'`）并附带可选段 `basics`（`kind`/`listedAt`/`region`/`industry`/股本两项）。动机：通达信内置代码（`999999`/`880003`/`880008`/`880823`/`880863`/`880005` 等）在公开源中不存在，页面只能显示「名称未获取」；**实测证据**：`get_stock_info` 对上述代码全部返回 `ErrorId=0` 与正确名称（见 design D-11）。边界放宽点严格限定于该 method，MUST NOT 调用行情（`get_market_*`）与任何交易接口。
- **标的档案上下文（复用既有 `DB/stock/`，owner 裁决 2026-10-06 修订）**：不新造目录——工作流 SHALL 读 `<数据根>/DB/stock/<名称>.md`（既有 766 份标的档案），取**新增键 `角色`**（= 给 agent 的提示词重点内容）与 `代码`，新工具 `review_stock_profiles`（`traderKit.review.stockProfiles`）。命中标的数据包带 `profile: { role?, path }`，作为**生成依据**注入——MUST NOT 当作行情事实、MUST NOT 改写用户卡片、MUST NOT 回复述为用户判断。**`热点标签` 与 `板块`/`当前题材`/`题材地位`/`# 股性` 只用于保存与展示，MUST NOT 进 agent 上下文**（owner 裁决）。
- **全部标的建档 = 懒加载（owner 裁决）**：期望"每个标的在 `DB/stock` 都有档案"，实现方式 = **首次写该标的复盘卡片时异步创建骨架**（create-only、幂等、不阻塞卡片写入、失败只告警）：命名 `<名称>.md`（名称退化则不建、待下次）；骨架 = `代码` + 主变体四键 + 空 `角色` + `# 股性`/`# 记录` + 组件嵌入；**MUST NOT 猜测** `锚点`/`角色` 取值。`DB/stock/` 因此成为本插件**第 4 条写路径（只建不改）**，须同步登记 `AGENTS.md` 与 `vault-integration`（运行期 skill 安装白名单 **不变**）。
- **数据格式化建议**：新增键 `角色`（agent 重点）与 `代码`（定位兜底）、`锚点: true`（仅锚点，指数段成员）；解析对既有三种 frontmatter 变体**宽容共存**（缺键即降级，不要求统一）；8 个锚点档案由 owner 手工建档（清单与模板见 skill 文本），懒创建不代写内容。
- **当日盘面 md（新产物）**：`<数据根>/DB/review/<YYYYMM>/<YYYYMMDD>-summary.md`，一交易日一份；结构 = frontmatter + 四段 H2（一、指数 / 二、情绪 / 三、赚钱效应 / 四、题材）+ 数据完整性行 + 「研究辅助、不构成投资建议」行；**逐段事实带来源、缺失逐项显式标注**。写通道 = 新工具 `review_write_brief`（唯一生产者，service key `traderKit.review.writeBrief`）：原子写、**同交易日覆盖重写**（owner 2026-10-06 裁决）、MUST NOT 触碰用户卡片与 AI 附注分节。
- **工作流收尾增步（W6）**：`review-daily-summary` skill 在附注与运行摘要之后 SHALL 汇总四段并调用 `review_write_brief`；盘面 md 失败**不**改变既有附注/摘要的成败口径（独立性，沿 D-11 精神）。
- **反转既有非目标**：change 5 `daily-summary` 的「明确不做：W6 汇总页 `<YYYYMMDD>-summary.md`」由本 change 提前（owner 2026-10-06 裁决）；同时 MODIFIED 其 `触发方式`（新增 DSH 面板按钮入口）与 `数据包 schema`（新增可选 `profile` 字段）两条需求。

## Capabilities

### New Capabilities

- `review-panel`: DSH 客户端面板契约——`sidebar.panellist` 入口与 `main` 内容页注册、触发按钮与会话注入语义、`/review/api/day` 读接口、当日状态渲染与降级、client 打包声明（`exports["./client"]` + `dsh.client`）与宿主 SDK external 纪律。
- `stock-profile`: 标的档案契约（**复用既有 `DB/stock/`，不新造目录**）——区域登记、定位规则（名称直配 → `代码` 索引兜底 → 未命中）、**档案字段契约与数据格式化建议**（新增键 `角色`（agent 重点）/`代码`/`锚点`；`热点标签` 等仅保存与展示、不进 agent 上下文）、**懒加载建档**（首次写卡触发、异步、create-only、幂等、不猜取值）、**写分区与安全边界**（第 4 条写路径「只建不改」+ 文档登记）、读取工具 `review_stock_profiles` 的具名接口与 `warnings`、注入语义（生成依据、非事实、来源标注）。
- `daily-brief`: 当日盘面 md 产物契约——路径与命名、四段结构与固定行、逐段来源与缺失标注、`review_write_brief` 唯一生产者与覆盖重写语义、合规约束、与附注/摘要的写入独立性、下游读取口径。
- `tq-local-lookup`: TQ-Local 只读兜底契约——出口与依赖归属（唯一出口 + `http.ts` 通道内建白名单）、请求契约（method/字段白名单、后缀候选序列、超时与零重试）、出参契约（名称与最小基础信息、字符串原样、缺失不冒充）、进程内存缓存、开关与降级、接线与消费（`/api/enrich` 层②第三级 + `basics` 段）。

### Modified Capabilities

- `daily-summary`: ① `触发方式`——新增「DSH 面板按钮触发」等价入口（仍为会话内触发，prompt 固定模板在 skill 内声明）；② `数据包 schema`——新增可选 `profile` 字段（标的档案命中项，缺失不阻塞）；③ 新增 `W6 盘面整理收尾` 需求（调用 `review_write_brief`，独立成败口径）。
- `review-page`: 「名称三级兜底的分层归属」——层②扩为**内部三级**（T2/S8 → 行情名称源 → **TQ-Local 兜底**，`nameSource` 增加 `'tq-local'`）并新增可选段 `basics`（股本两项可补位四格）。
- `data-tool-contract`（change 2）: 「只读边界」——`127.0.0.1:17709` 由「无任何 HTTP 请求」修订为**唯一白名单例外**（仅 `get_stock_info` 只读、经 `http.ts` 同一条通道、开关约束、其余一律 `blockedEndpoint`）；具名出站通道**不新增第三条**。

## Impact

- **新增代码**：`src/client/panel/**`（面板组件与状态渲染）、`src/client/index.ts`（client 装配与 slot 注册）、`src/routes/review.ts` 增 `GET /review/api/day`、`src/tools/review-profile.ts`（`review_stock_profiles`）、`src/review/profile-create.ts`（懒加载建档：命名净化 + `wx` 排他创建 + 骨架渲染 + 异步触发 seam）、`src/tools/review-brief.ts`（`review_write_brief` + service 出口）、`src/summary/brief.ts`（四段渲染 + 原子写 + 覆盖语义）、`src/paths/mapping.ts` 增区域 key（`stock` 只读 / `brief` 复用 `DB/review/` 目录）、`src/data/tq-local.ts`（TQ-Local 只读出口：白名单 + 后缀候选 + 缓存 + 降级）、`src/data/http.ts`（17709 拦截规则收窄为白名单放行）、`src/config.ts`（`sources.tqLocal.enabled`，默认 `true`）、`src/routes/review.ts`（`/api/enrich` 层②第三级 + `basics` 段）、`skills/review-daily-summary/SKILL.md` 增标注步与 W6 + 档案格式化模板。
- **打包与构建**：`package.json` 增 `exports["./client"]` → `./lib/client.js` 与 `dsh.client = { platform: 'web', inject: [...] }`；`tsdown.config.ts` 改双入口（host `src/index.ts` + client `src/client/index.ts`，client 产物标记 external：`@deepseek-ai/dsh-client-*`、`@deepseek-ai/dsh-api-*`、`react` 家族）。
- **宿主依赖（全部本机已核验存在）**：DSH 0.1.7-rc.1 的 `@deepseek-ai/dsh-client-ui-slots` / `dsh-client-ui-layout`（声明 root keyed `main` 槽）/ `dsh-client-ui-sidebar`（声明 `sidebar.panellist` list 槽）/ `dsh-client-ui-conversation`（`ctx.conversation.send`）/ `dsh-client-locale` / `dsh-client-ui-primitives` / `dsh-client-store` / `dsh-client-ui-renderer` / `dsh-client-modules`（读 `dsh.client` 声明并服务 `/plugins/<id>/client.js`）。当前 profile = `web`（`dsh-base` + `dsh-web-app` + `dsh-trader-kit`），`sidebar.panellist` **零占用**——本插件为宿主该槽首个占用者，注册行为须先经实机验证（见 tasks 波 0）。
- **写分区（本 change 有新增）**：盘面 md 落既有 `DB/review/`；**新增第 4 条写路径 `DB/stock/`（性质 = 只建不改：仅 create-only 建档，MUST NOT 修改/删除/重命名既有档案）**，须同步登记 `AGENTS.md` vault 写入条目与 `vault-integration` 写分区契约；运行期 skill 安装白名单面 `src/skill/root.ts` 的 `dataRootWhitelistPaths` **保持三条不变**（不把 `DB/stock` 加入，避免放宽 skill 安装落点）。
- **安全面登记**：本 change 触发 roadmap §5 的 **D-TQ 复审**并作出裁决（选项 B 局部放开）——放宽点 = 仅 `get_stock_info`、仅 `127.0.0.1`、仅经 `src/data/http.ts` 通道、仅 `/api/enrich` 调用链（MUST NOT 进 `/api/local`）、开关可关；**MUST NOT** 放开任何行情/交易接口。登记动作见 tasks §7.6 与 design D-11。
- **跨 change 依赖**：change 4 `review-page` 的 `scanDailyCardTargets` / `parseDoc` / `src/review/md/frontmatter.ts` / `normalizeCode` / 路由族与读写认证分层（`§12.1`）、change 5 `daily-summary` 的四工具与运行摘要出口（`§12.6`）、change 2 的映射表 `resolveArea` 与 `data.ts` 日期换算——一律引用具名接口，MUST NOT 另写第二份实现。
- **验收对照（仓内可核验）**：面板入口可发现且不阻塞宿主；按钮 → 会话出现固定 prompt → 工作流按既有 spec 执行；通达信内置代码（`999999`/`880823` 等）在 TdxW 在跑时可取到名称与基础信息（`nameSource='tq-local'`）；TdxW 未跑时显式不可用且不影响其余字段；命中档案的标的在附注与盘面 md 中出现 `角色` 要点与来源路径（MUST NOT 作为行情事实）、未命中者无痕、`热点标签`/`# 股性` 不出现在上下文与产物正文；**首次写卡异步建档**（骨架含 `代码` 与空 `角色`、二次写卡零改动、名称为空不建档、失败不阻塞写卡）；既有档案字节与 mtime 全程不变；同交易日重复运行盘面 md 被覆盖且旧字节不留、附注仍幂等（第二次 `skipped`）；盘面 md 四段齐备、完整性行与免责行固定、缺项显式；`pnpm typecheck && pnpm build && pnpm test` 全绿。
- **明确不做**：**TQ 行情与交易接口**（`get_market_data` / `get_market_snapshot` / `order_stock` / `cancel_order_stock` 等一律不调；现价与市值仍走既有 S9 快照路径）；**TQ method 的可配置扩展**（白名单为源码常量，不做配置面）；日历与详情页（owner 2026-10-06 裁决：另起一个 change）；**新造标的目录**（`prompt/关联标的/` 方案作废，一律复用 `DB/stock/`）；**批量预建全部档案**（只做首卡懒创建）；**代写/回填档案内容**（`角色` 与 `锚点` 由 owner 填写，懒创建只留空键；不提供批量回填命令）；**改写既有档案**（含补键、改名、删除）；TDX 本地文件读取器（不读 `mark.dat` / `blocknew` / `tdxdb`）；宿主定时任务；盘面 md 的版本化保留（重跑覆盖）；任何交易功能。
