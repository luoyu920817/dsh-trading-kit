# review-loop 设计（DSH 面板触发 + 标的档案复用 + 当日盘面 md）

> 立稿 2026-10-06。需求来源：owner 会话裁决（同日四条：**复用 `DB/stock` 标的档案**（修订，取代新造
> `prompt/关联标的/` 目录）/ vault 目录维护（已作废）/ DSH 侧边栏入口+按钮 / 另出当日盘面 md）；
> 前置分析见本 change `proposal.md`。凡「复用」一律落到具名接口（见 §1.3 依赖表）。

## Context

### 已核验事实（本机实机，2026-10-06）

| 事实 | 证据 |
| --- | --- |
| 本插件挂载的 DSH profile = `web`（bundles = `@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `dsh-trader-kit`），profile patch 已配 `config.dataRoot` = vault 数据根 | `~/.dsh/profiles/web/package.json` 与 `cordis.patch.yml` |
| 宿主版本 `0.1.7-rc.1`；`@deepseek-ai/dsh-client-*` 全套在 profile `node_modules` 内（slots / layout / sidebar / conversation / locale / primitives / store / renderer / modules） | `~/.dsh/profiles/node_modules/@deepseek-ai/` |
| 侧边栏入口机制：`sidebar.panellist`（list 槽，`id` + 可选 `order` + `label`）**同一个 id 寻址**布局 root 作用域 keyed `main` 槽的组件 | `dsh-client-ui-sidebar/README.zh.md` §面板入口；`dsh-client-ui-layout` 的 `SlotMap['main']` 声明 |
| `sidebar.panellist` 在当前组合下**零占用**（README：「产品随附的组合不注册示例面板」） | 同上 + 全包 grep 无注册点 |
| 会话注入：客户端服务 `ctx.conversation.send(text)`（"Send a prompt into the caller scope's session (queued turn)"） | `dsh-client-ui-conversation/lib/types/client/service.d.ts` |
| 插件浏览器半装载：包清单 `dsh.client = { platform, inject, external }` 由 `dsh-client-modules` 读取；`exports["./client"]` 的产物服务在 `/plugins/<id>/client.js` | `dsh-client-modules/lib/client.js`；外部插件 `@linxin666/dsh-client-ui-git-graph@0.4.2` 的清单与注释 |
| **标的档案现状（本 change 的复用对象）**：`<数据根>/DB/stock/` 766 个 `<名称>.md`；frontmatter 三种变体，占比 = `板块/当前题材/题材地位/热点标签` 516 / `板块/概念/标的特性` 164 / `板块/当前题材/题材地位` 79（其余 7）；`# 股性` 小节普遍存在（多数空，部分含 `INPUT[inlineList:热点标签]`）；**无任何文件填写 `代码`**；8 个锚点档案均不存在 | 实读 vault `DB/stock/`（全量 766 份按键分布统计 + 60 余份逐份核对） |
| 关联标的背景（**不读**，仅作语义对照）：通达信「Z指标」自定义板块（`blocknew/ZZB.blk`，实测 = 8 个锚点 + `12#A_DJI`）；标签在 `T0002\mark.dat` `[TIPWORD]`、长备注在 `[TIP]`（GB2312，键 = 市场前缀 `01`沪/`00`深 + 6 位代码） | 实读 `D:\TDX_HOME\x64\772\T0002\`（本机现网安装，仍在更新） |
| 写白名单为硬编码三条（`agent/skills`、`agent/DB/temp/dsh-trader-kit`、`DB/review`），**不由区域表派生** → 新增区域 key 不会放宽写权限 | `src/skill/root.ts` 的 `dataRootWhitelistPaths` |
| **TQ-Local 只读查名/基础信息能力（本 change 新增出口）**：`POST http://127.0.0.1:17709/` 的 `{"method":"get_stock_info","params":{"stock_code":"<code>.SH","field_list":[...]}}` 对通达信内置代码（`999999`/`880003`/`880008`/`880823`/`880863`/`880005` 等）全部返回 `ErrorId="0"` 与名称（上证指数/平均股价/全Ａ等权/微盘股/昨日涨停/涨跌家数；510300 → 沪深300ETF华泰柏瑞）| 2026-10-06 实机探针（TdxW 在跑；脚本见 `.dsh/.dsh-trader-kit-tmp/tqprobe.py` 的等价调用） |
| 当日清单自带 `name`（frontmatter `name` 非空优先，否则取文件名名称段）→ 档案可按名称直配 | `src/review/store.ts` 的 `scanDailyCardTargets` |
| 既有工作流不碰本地 TDX 文件（数据面 = TQ skill + T1/T2 + 卡片存储）；`limit-reason-tool` spec 有同向口径「不依赖本地 HTML」 | `openspec/changes/daily-summary/specs/daily-summary/spec.md`；`data-foundation` spec |
| 来宾参考：vault 前身 `agent/skills/tdx-diary-review`（Python、只读 TDX）已产出「指数/情绪/赚钱效应/题材」四段素材 + `digest.json` | 实读（该 skill 的 SKILL.md 与 `config/watchlist.json`） |

### 缺口（本 change 要补的三块）

1. **触发**：工作流只能靠会话口令；DSH 页面无入口（页面只有 TDX 内嵌用的 `/review` 单标的页）。
2. **标的上下文**：`DB/stock/` 里 owner 已维护的标的档案没有进入工作流（agent 按普通个股口径写，语义缺失）；档案当前**无 `代码` 键**、也没有承载"给 agent 的提示词"的键（展示用 `热点标签` 语义不同）→ 需新增 `角色` 键并给出**数据格式化建议**；同时 8 个锚点档案与"全部标的都要有档案"的目标需要**懒加载建档**这一新动作。
3. **日级产物**：没有「当日盘面」文档，四段结论无处落盘、无法读回。

## Goals / Non-Goals

**Goals**

- DSH 侧可发现入口 + 一键触发既有的 `review-daily-summary` 工作流（不新建第二套执行路径）。
- **标的档案上下文**（`DB/stock/` 既有档案的标签与 `# 股性`）进入工作流，作为生成依据，且产物可回溯来源；档案缺字段时给出**可执行的数据格式化建议**（契约 + 模板，owner 手工增补）。
- 当日盘面 md（四段）落盘，格式固定、来源可核、缺失显式、可覆盖重跑。
- 全程零新增出站源、零交易语义、写分区不变。

**Non-Goals**

- 日历入口与详情页（owner 2026-10-06 裁决：另起 change；本 change 的 `/api/day` 只为其留接口）。
- **新造标的目录**（`prompt/关联标的/` 方案作废）；**代写/回填 `DB/stock` 档案**（只给格式契约）。
- TDX 本地文件读取器（不读 `mark.dat` / `blocknew` / `tdxdb` / `D:\TDX_HOME`）。
- 定时/自动触发（W-Q1 保持不变）。
- 盘面 md 的版本化保留、分 tab 渲染、正文解析。
- 运行摘要（`daily-summary-run.json`）schema 的任何变更。
- 任何交易功能与投资建议语义。

## Decisions

### D-1 触发通道：面板按钮 → `ctx.conversation.send`（而非 host 侧起 agent）

**选择**：按钮只发送一条**固定模板 prompt** 到当前会话；agent 随后按既有 skill 执行。

**理由**：① 用户可见可审计（就是一条用户消息），不产生"后台偷偷跑"的语义；② 复用既有 agent loop 与会话权限模型，不需要 `dsh-agent-loop` / `AgentRegistry` 等 host 内部面（跨层、未验证、且本项目一贯避免把 DSH 内部面固化进 TS）；③ 与 W-Q1「迭代一先会话手动触发」的裁决一致——按钮只是把"手动"从打字变成点击。

**备选与否决**：host 侧新路由 + 程序化创建 agent（否决：依赖未公开的宿主内部服务，且绕过用户可见面）；插件自带"无 agent"的整理实现（否决：总结正文是 agent 产物，机器人写不出归纳）。

**约束**： prompt 文本 SHALL 是固定常量（MUST NOT 拼接页面可变内容），模板在 skill 内声明为「触发短语」，面板复用；按钮在运行中禁用防重复触发。

### D-2 面板注册形态：宿主原生 slot（`sidebar.panellist` + `main`）

**选择**：`ctx.slots.register({ name: 'sidebar.panellist', id: 'trader-kit-review', order, label })` + `ctx.slots.register({ name: 'main', id: 'trader-kit-review' }, Panel)`。

**理由**：① 本机 `web` profile **未挂载** better-sidebar（那是另一个 profile 的 bundle），走 better-sidebar 的 `registerTab` 需新增第三方依赖；② 原生槽是产品设计的扩展点（「插件在 `sidebar.panellist` 注册图标，id 寻址 `main` 面板」），无额外依赖；③ 宿主 SDK 已在 profile 内，插件只声明 `dsh.client.inject`。

**风险前置（波 0 spike）**：该槽在当前组合零占用，**注册行为未经实机验证**——本 change 的波 0 = 最小面板（一个图标 + 一个面板 + 一个按钮）实机验证「入口可见 / 面板渲染 / 按钮能发出 prompt」，验证不通过则按 D-2b 回退。

**D-2b 回退**：若 `sidebar.panellist`/`main` 在本机版本不可用，则改用 `sidebar.footer.action`（list 槽，footer 按钮）+ 弹出面板；仍不可用则回退「会话口令 + 提示文案」并在 roadmap §5 登记偏离。

### D-3 标的上下文 = **复用 `DB/stock/` 既有标的档案**（owner 裁决修订，2026-10-06）

**选择**：不新造目录——读 `<数据根>/DB/stock/<名称>.md`；新工具 `review_stock_profiles`（`traderKit.review.stockProfiles`）。档案承担两个角色：① **`角色`（本 change 新增键）= 给 agent 的提示词重点内容**（owner 2026-10-06 定名：不叫「提示词」；值 = 短角色词，如 `万科A → 中军`、`上证指数 → 情绪主锚`、`微盘股 → 情绪周期`，可选 `｜` 接一句口径）；② `锚点: true` 标记盘面 md 指数段成员；`代码` 供定位兜底与校验。

**理由**（owner 裁决）：① **单一事实源**——owner 已在 `DB/stock` 维护 766 份档案，另起一套目录等于同一知识写两处；② **用途分离**——`角色` 是"给 agent 看的口径"，`热点标签`（既有）是"给人看/存的展示标签"，两者语义与受众不同，因此**新键承载角色**、展示字段不进 agent 上下文（owner 明确裁决）；③ 既有目录不新造（沿 `data-root-layout`「以既有 vault 目录体系为蓝本」纪律）。

**注入面收窄（相对前稿）**：agent 上下文中的标的相关内容 = **仅 `角色` 原文**（+ `code`/`name`/`path` 标识与来源）；`热点标签`、`板块`、`当前题材`、`题材地位`、`# 股性` MUST NOT 进上下文——因此前稿的"档案题材过时被当事实"风险随之消失（这些字段不再进入生成面）。

**数据格式化建议（owner 侧；本 change 不代写内容）**——对既有三种变体宽容，只增不改：

| 键 / 小节 | 必需性 | 进 agent 上下文 | 建议格式 |
| --- | --- | --- | --- |
| `角色`（新增键） | 建议（不填 = 该标的不注入业务内容） | **是（唯一业务内容）** | 短角色词 + 可选一句口径（`｜` 分隔）：`角色: "中军"`、`角色: "情绪周期｜向上有，向下无"` |
| `代码`（新增键） | 锚点必需；其余由懒创建自动写入 | 否 | `代码: "880823"` |
| `锚点`（新增键） | 仅锚点 | 否 | `锚点: true` |
| `热点标签` / `板块` / `当前题材` / `题材地位` / `概念` / `标的特性` | 可选 | 否（仅保存与展示） | 原样保留 |
| `# 股性` | 可选 | 否（人的记录） | 小节自由文本 |

**锚点建档清单（8 份，当前均不存在；owner 手工建档）**：`上证指数.md`(999999) / `沪深300ETF.md`(510300) / `科创50.md`(000688) / `平均股价.md`(880003) / `全A等权.md`(880008) / `中证1000.md`(000852) / `微盘股.md`(880823) / `昨日涨停.md`(880863)——每份含 `代码` + `锚点: true` + `角色`（建议值：999999→`情绪主锚`、510300→`国家队`、000688→`科技`、880003→`高价股`、880008→`整体`、000852→`小盘科技`、880823→`情绪周期｜向上有，向下无`、880863→`赚钱效应`；口径补充可从 TDX 备注起笔）。

**定位规则**：名称直配（`scanDailyCardTargets` 已返回 `name`）→ `代码` 索引兜底（名称段为空/等于代码时）→ 未命中（不入结果、不是错误）；`代码` 与目标不一致 → `warnings` 且**不注入**；一代码多档案 → `warnings` + mtime 最新。

**解析纪律**：路径经 `resolveArea('stock')`；frontmatter 解析复用 change 4 `src/review/md/frontmatter.ts`；零出站。

### D-10 「全部标的都有档案」= 首卡懒创建（create-only、异步、不猜取值）

**选择**：不批量预建、不代写内容——**首次写某标的的复盘卡片时异步创建骨架档案**（owner 裁决）。骨架 = `代码` + 主变体四键（516/766 使用 `板块/当前题材/题材地位/热点标签`）+ 空 `角色` + `# 股性`/`# 记录` + `![[stock-info.components]]`。

**理由**：① 766 份批量预建会制造大量空档案噪音，且档案质量取决于"何时真正用到"；② 首卡时刻正好是 owner 最可能补充 `角色` 的时刻（卡片写完即写口径），懒创建把"建档"变成零额外动作；③ 幂等（存在即跳过）使实现简单、无需记录"已建档"状态。

**硬约束（安全第一）**：**create-only**（`wx` 排他创建；已存在即放弃，MUST NOT 读取后覆写/补键/改名/删除）；**异步解耦**（建档成败不影响卡片写入结果与可感延迟；失败只告警、至多一次尝试；提供可注入等待 seam 供测试）；**不猜取值**（`锚点`/`角色` 留空，MUST NOT 按代码/名称推断角色）；**命名**：`<名称>.md`（经 `sanitizeNameSegment`），名称为空/退化为代码则**不建**（记 `warnings`，下次再试；MUST NOT 用 `<代码>.md` 或事后改名）；同名冲突（目标存在但 `代码` 不同）→ `warnings` + 放弃。

**备选与否决**：批量扫描 `DB/review/` 全历史一次性补齐（否决：会突然在 owner 的档案区制造几百个文件，且多数当下无用）；由 `daily-summary` 运行时补建（否决：写卡是"建档时机"的语义最自然，且即时可见）。

**写分区影响**：`DB/stock/` 成为本插件**第 4 条写路径（只建不改）**，须登记 `AGENTS.md` 与 `vault-integration`；`src/skill/root.ts` 的 `dataRootWhitelistPaths` **保持三条不变**（该白名单用于 skill 安装落点校验，加入 `DB/stock` 会放宽无关能力）。

### D-4 盘面 md：唯一生产者 + 原子写 + **覆盖重写**

**选择**：工具 `review_write_brief` 是 `<YYYYMMDD>-summary.md` 的唯一写入方；同交易日覆盖、原子写（临时文件 + rename）、失败清理。

**理由**（owner 裁决：覆盖重写）：① 盘面 md 的性质是**当日结论**（不是语料）——卡片与附注是 append-only 的语料（改了会污染历史），结论则应当"重跑即最新"，与既有 append-only 纪律不冲突（对象不同）；② 覆盖让"重跑"语义最简单，页面/详情页永远读最新；③ 版本化保留会让 `DB/review/` 目录碎片化并给下游"取哪份"制造歧义。

**取舍**：旧结论不留档 → 若 owner 需要留档，后续可加"归档到 `agent/DB/temp/`"旁路（不在本 change）。

### D-5 四段事实来源：v1 只用现有源（owner 裁决）

**选择**：指数段 = **档案 `锚点: true` 的标的**（经 `review_stock_profiles()` 全量取）当日表现（TQ skill 路径，逐项 `source`/`fetchedAt`）；情绪 / 赚钱效应 / 题材段 = 当日卡片与附注 + 档案上下文 + 既有 T1/T2 数据。取不到的**显式**写「数据不可得」并进 `missing`。

**已知风险**：TQ skill（`get_more_info`）对**板块指数**（880003/880008/880823/880863）的覆盖未验证——若不可得，指数段会大面积「数据不可得」。**处置**：v1 接受显式缺失（这本身是可核验的事实）；**触发条件** = 连续 3 个交易日指数段缺失超过一半 → 开新 change 评估「本地 `tdxdb` 日线只读读取器」（前身 `tdx-diary-review` 的离线口径，含 `lday/*.day` 解析）并同步 roadmap。

**纪律**：段内每条数值必须带来源；缺失 MUST NOT 用 `0`/`--`/空白冒充；结论必须可回溯到卡片/附注/具名源。

### D-6 无卡片日不产出盘面 md

**选择**：`targets=[]` → 跳过 W6（沿既有「零打扰」）。

**理由**：本工作流的定位是"把当日卡片语料整理成结论"；无卡片 = 无语料。**代价**：纯行情日没有盘面 md。**复审触发**：owner 若要求"无卡片也要盘面"，取消该跳过即可（一处判断），届时需明确"盘面 md 是否等同于行情日报"的定位问题。

### D-7 区域登记与写分区

| 区域 key | 目录 | 模板 | 状态 | 写入方 |
| --- | --- | --- | --- | --- |
| `stock`（新） | `DB/stock` | 无（文件名 = 名称，owner 命名） | `active` + 注记「owner 维护内容；插件**只建不改**（首卡懒创建骨架）」 | `src/review/profile-create.ts`（create-only 建档；无覆写/改名/删除） |
| `brief`（新） | `DB/review/<YYYYMM>` | `<date>-summary.md` | `active` | `review_write_brief` |

`DB/review/` 已在白名单内 → **写分区白名单不新增**（已核验 `dataRootWhitelistPaths` 为硬编码三条、不由区域表派生，新增区域 key 不放宽写权限）；`AGENTS.md` 与 `vault-integration` 的写分区条目不动（仅区域表登记一个只读区域）。卡片扫描正则按代码匹配，`<date>-summary.md` 不构成卡片文档（已核验 `src/routes/review.ts` 的 `scanCardedDates` 用 `^<code>_.+_(\d{8})\.md$`，与该文件名不匹配）。

### D-8 运行摘要 schema 冻结

盘面 md 的存在性**不经**运行摘要表达（`/api/day` 直接查文件）；`daily-summary-run.json` 的 schema、唯一生产者（`review_daily_report`）与合并语义**零变更**——避免改动 `§12.6` 的既有契约与下游解析。

### D-9 client 面构建与打包

**选择**：`tsdown` 双入口（host `src/index.ts` + client `src/client/index.ts`），client 产物 `lib/client.js`；`package.json` 增 `exports["./client"]`、`dsh.client = { platform: 'web', inject: [...] }`；`@deepseek-ai/dsh-client-*` 与 `react`/`react-dom` 标记 external（运行期由宿主提供）；React 家族进 `devDependencies`。

**理由**：① 宿主经 `dsh.client` 声明装载浏览器半，`exports["./client"]` 是其入口约定（本机 external 插件同款）；② external 保证插件不夹带第二份宿主 SDK（版本漂移风险）；③ 面板是 React 组件（槽系统的组件契约），React 由宿主提供运行时。

**纪律**：client 产物**无外链**（不引 CDN/字体/图片），网络请求仅同源 `/dsh-trader-kit/review/api/*`；构建断言（产物存在 + marker + 无外链 + 清单字段合法）进 `test/`。

### D-11 TQ-Local 只读兜底：D-TQ 裁决为「选项 B（局部放开）」（owner 2026-10-06）

**选择**：放开「插件直调 `127.0.0.1:17709`」，但**白名单严限**——新增唯一出口 `src/data/tq-local.ts`（工具 `get_stock_basics` + service `traderKit.data.stockBasics`）：method 白名单**只有 `get_stock_info`**、params 只有 `stock_code`/`field_list`（字段白名单常量）、仅回环、2 s 硬超时、零重试、进程内存 TTL 缓存（24 h、条目上限、失败不缓存）、开关 `sources.tqLocal.enabled`（默认 `true`）。请求经 `src/data/http.ts` 同一条出站通道发出（**不新增第三条具名通道**），该通道的 17709 拦截规则收窄为「仅放行本白名单，其余一律 `blockedEndpoint`」。

**理由**：① **需求实证**——通达信内置代码（`999999`/`880xxx`）在公开源（T2/S8、行情名称源）中不存在，页面只能显示「名称未获取」（owner 实机截图）；② **TQ 是这些代码的唯一权威源**（本机 TDX 自己的代码体系），且 `get_stock_info` 是最轻的只读接口（单标的、无行情序列、无交易语义）；③ **边界可控**——method 级白名单是源码常量，可结构断言（全仓 17709 调用点唯一、method 字面量集合 == 白名单），比"放开端口"精细得多；④ 旧的「TQ 不固化进 TS」口径的真实意图是**防止把 TQ 变成行情/交易主链路**，本方案只借它做名称/基础信息兜底，不构成主链路（现价市值仍走 S9 快照）。

**放宽点（写入 roadmap §5 D-TQ 行，随 tasks §7.6 登记）**：

| 维度 | 限定 |
| --- | --- |
| method | 仅 `get_stock_info`（MUST NOT `get_market_data` / `get_market_snapshot` / `order_stock` / `cancel_order_stock` / `subscribe_hq` 等） |
| params | 仅 `stock_code` + `field_list`（⊆ 常量白名单 7 字段） |
| 目标 | 仅 `127.0.0.1:17709`（仅回环） |
| 调用链 | 仅 `/api/enrich`（异步网络段）；MUST NOT 进 `/api/local`（首屏零网络不变）、MUST NOT 进写卡路径 |
| 开关 | `sources.tqLocal.enabled` 默认 `true`，关闭即零请求 |
| 失败 | 显式 `available=false` + 原因；MUST NOT 阻塞其余字段、MUST NOT 缓存失败 |

**字段取舍**（owner 裁决「名称 + 最小基础信息」）：`Name` / `HSStockKind`（品种类型）/ `J_start`（上市日）/ `tdx_dyname`（地域）/ `rs_hyname`（行业）/ `ActiveCapital`（流通股本，万股）/ `J_zgb`（总股本，万股）——**MUST NOT** 一并取现价/市值（那要 `get_market_snapshot`，属行情，须单独裁决）。

**已知偏差（登记）**：TQ 官方名与 TDX 报价表短名可能不同（`510300` → 「沪深300ETF华泰柏瑞」、`880008` → 全角「全Ａ等权」）；页面按**原样**显示、不做二次加工（MUST NOT 归一化全角/半角）。

**备选与否决**：① 不动边界、只让 workflow 侧经 skill 写回名称到档案/frontmatter（否决：页面首屏仍显示「名称未获取」，正是要解决的问题）；② 让浏览器端直接调 17709（否决：跨源/CORS 不可控，且绕开插件的数据面纪律）；③ 全面放开 17709（否决：与「只读边界」纪律冲突，且无必要）。

## Risks / Trade-offs

| 风险 | 缓解 |
| --- | --- |
| `sidebar.panellist`/`main` 槽零占用 → 注册行为未验证（**最高风险**） | 波 0 spike：最小面板实机验证后再铺开；D-2b 回退链；spike 结论记 `docs/spikes/` |
| 宿主版本升级（0.1.7-rc.x → 后续）导致槽/服务签名变化 | `dsh.client.inject` 只列实际导入包；面板注册失败降级为「入口缺席 + 日志」不阻塞宿主（spec 已要求）；宿主版本核验进 tasks 波 0 |
| TQ skill 对板块指数覆盖未知 → 指数段大面积缺失（D-5） | 显式标注（可核验事实）；**D-11 落地后**指数段/名称可由 TQ-Local 兜底补齐（同一出口可复用为 workflow 侧取数路径，另行评估） |
| 17709 白名单被绕过或扩张（安全面） | method/params 白名单为源码常量 + 结构断言（唯一调用点、字面量集合 == 白名单）+ 桩服务零请求断言 + 开关可关 + roadmap §5 登记放宽点 |
| TdxW 未启动时兜底不可用 | 显式 `available=false` + 原因与「通达信是否已启动并登录」提示；失败不缓存，恢复后立即生效 |
| 面板读接口在 C 层签字范围外被误放宽 | spec 明确：本 change MUST NOT 新增放宽点；只读 GET、仅 127.0.0.1（沿既有签字） |
| 标的档案被 agent 当"事实"写进产物 | spec 三处硬约束（注入语义：非事实 / 不复述 / 不复述为用户判断）+ **注入面收窄到仅 `角色`**（展示字段不进上下文）+ 验收抽样核对 |
| 懒创建误伤 owner 档案（最严重） | **create-only**（`wx`；存在即放弃，无覆写/补键/改名/删除路径）+ 测试断言既有档案字节与 mtime 不变 + 同名冲突放弃并告警 |
| 建档失败影响写卡体验 | 异步解耦 + 失败只告警 + 至多一次尝试 + 验收演练（目录只读场景） |
| 档案定位失败（无 `代码` 键 + 名称段退化为代码）导致上下文缺失 | 名称直配为主路径（`scanDailyCardTargets` 已给 `name`）；`代码` 索引为兜底；命中失败即"无上下文"（不影响附注成败）；格式化建议已把 `代码` 列为建议项 |
| owner 未及时增补档案字段 → 锚点集合为空、指数段无成员 | 降级为「指数段数据不可得/无锚点」（显式、不报错）；tasks 把建档清单与模板列为交付物；不阻塞其余链路 |
| 覆盖重写误删 owner 内容 | 盘面 md 全文件由工具生成（owner 手改会被覆盖——**spec 需在产物首行注明"本文件由工作流生成，重跑覆盖"**，见 tasks 3.4） |
| 无卡片日不产盘面（D-6）可能不符预期 | 单点判断可改；已登记复审触发条件 |

## Migration / Rollout

1. 波 0 spike 通过后再写实现代码（spike 结论决定 D-2 或 D-2b）。
2. 实现顺序：区域表与工具 → 读接口 → client 面板 → skill W6 文本 → 部署与验收。
3. **部署**：`package.json` 变更后需重建 tgz 并在 `web` profile 重新安装（`file:` 渠道）；宿主重启加载新 client 面。回滚 = 卸载/禁用 `trader-kit` 行（面板消失、既有会话工具不受影响）。
4. **owner 侧动作**（数据格式化建议，见 D-3）：① 为 8 个锚点手工建档（`代码` / `锚点: true` / `角色`）；② 其余标的**无需任何动作**——首卡写入会异步建出骨架，owner 之后按需补 `角色`。本 change **不代写**档案内容。

## Open Questions

1. 盘面 md 是否需要"归档旧版"旁路（写 `agent/DB/temp/`）——本 change 不做，待 owner 遇到"想回看旧结论"时再议。
2. 面板是否要在本 change 内展示盘面 md 正文（v1 = 只显示存在性）——留待详情页 change。
3. 8 个锚点的建档模板（含 `角色` 示例）是否需要本 change 写成 repo 内模板文件（当前方案：写入 skill 文本供 owner 照抄，见 tasks 6.5）。
4. 是否需要"读 `mark.dat [TIPWORD]` 的只读同步工具"（D-3 偏差的后续）——触发条件：owner 明确表示两处维护不可接受。
5. 面板入口的中文标题与顺序（建议「复盘」；`order` 暂缺省）——owner 可在实现期一句话改。
6. `# 股性` 是否也要进 agent 上下文（当前裁决：不进，只有 `角色` 进）——若日后希望"人的记录也作参考"，改一处读取面即可（登记备查）。
8. 键名 `角色` 为默认定名（备选 `标记`（对齐通达信「标记信息」列）/ `定位`）——owner 改字一处即可（spec 表 + 骨架常量 + skill 文本）。
7. 骨架键是否随主变体演化（当前固定为主变体四键）——若 owner 调整模板习惯，改 `src/review/profile-create.ts` 一处常量。
