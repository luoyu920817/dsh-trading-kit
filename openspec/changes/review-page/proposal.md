## Why

需求的最小可用集是「标的现场 → 即时卡片 → 次日读回」：在盘面现场（通达信内）看标的、写想法、即时落盘为 vault 资产。迭代一把它定为 **DSH 同端口二级页面**（M2-Q2 裁决：页面即插件路由，数据经插件 service 直取，无需独立桥），形态可行性由 change 1（spike）闸门。

这是 P1/P3（现场优先、零切换）唯一可验证的落地形态，也是整条链路的语料入口——跳过它，后续模式迭代（F2）与每日汇总（change 5）都没有原料。

> **跨 change 唯一事实源**：本 change 一律引用 `docs/design/iteration-1-contracts.md`
> （下称 `iteration-1-contracts §n`）的具名条目；凡出现「复用 / 口径见 / 与某 change 共享」
> 的表述，MUST 落到「依赖 change X 的 `<具名接口>`」或契约条目号——无具名接口的「复用」
> 视为无效表述（契约 §0）。第一轮评审 18 条 issue 的逐条处置见
> [`design.md`](./design.md) 末「评审处置（Round 1 — 2026-09-27）」；**第二轮评审 19–28 条的处置见
> 同文件末「评审处置（Round 2 — 2026-09-27）」**（含 Round 1 `#8/#11/#16` 的闭合行）；**第三轮评审
> 29–35 条（1 High / 2 Medium / 4 Low）的处置见同文件末「评审处置（Round 3 — 2026-09-27）」**；
> 重排裁决见 `docs/roadmap.md §5`。

## What Changes

- **页面路由与传参**：`GET <basePath>/review`（宿主同端口）；标的编码经 hash（优先）、`?code=`、或 `GET <basePath>/review/<code>`（path 段，D-1 已补该路由与场景）传入，URL/hash 变化无刷新切换上下文；取值一律先经 `iteration-1-contracts §2` 的 `normalizeCode`（去 `SH/SZ/BJ` 前缀与 `.SH/.SZ/.BJ` 后缀，**只去壳、不补全、不猜测**）；缺失/非法给显式空态（展示原始取值 + 期望格式 `6 位数字` + TDX 侧配置指引），不猜代码。承载形态与认证方式以 change 1 结论为准（路由**不重叠**：change 1 占 `<basePath>/probe`，本 change 占 `<basePath>/review*`）。
- **认证分层与写入可用性**（`iteration-1-contracts §12.1`）：A 层 = 宿主 tokenized URL + cookie（**两步**：先 `GET <base>/?token=` 铸 cookie，再导航业务路径）；**读通道分档**——默认分支页面与读接口走 A 层，回退分支读接口在 C 层未签字前不提供未认证读（只交付文档形态 + 「取数不可用」空态）、签字后仅按显式放宽点只读；B 层 = change 1 定义的**插件自持诊断 token**（仅诊断/只读）；C 层 = `file://` 就地只读（需 owner 签字）。**`POST <basePath>/review/api/card` 与一切写入 MUST NOT 依赖 B/C 层**——A 层不可用即写入接口**不可用**（显式禁用 + 提示 + 页面只读降级），MUST NOT 放宽认证。
- **接口切分（首屏预算）**：本地段与网络段 SHALL 为**独立请求**——`GET <basePath>/review/api/local?code=&date=`（纯本地：代码/名称层①·③（含 `nameSource`）/归属日/当日卡片/有卡日期，冷启动 ≤500 ms，**零出网**）与 `GET <basePath>/review/api/enrich?code=&date=`（网络段：名称层② T2/S8 反查 + 标签/最近涨停原因，异步、可 abort）；首屏 MUST NOT await 网络段。名称三层兜底的分层归属（①本地历史 frontmatter →②T2/S8 网络反查 →③仅代码）见 `iteration-1-contracts §12.4`；B1 回溯按 `§12.5`/`§12.8` 量化（**≤6 次列表级请求**、命中即停、`dateUnavailable` 与「无记录」分档、结论由 `availability: { available, reason }` 驱动），详见 D-1 / D-5 / D-7 / D-8。
- **四区块布局 B1–B4**：B1 标的头部（代码 + 名称三层兜底（分层归属见 `§12.4`）+ 标签 T2 + 最近涨停原因 T1，逐项独立降级）；B2 日期组件（默认**归属交易日**，待确认时显式提示并需一次确认；切换即回读该标的历史卡片）；B3 输入框 + 工具框预留按钮区（v1 仅占位、禁用且不占焦点顺序）；B4 当日卡片区（时间倒序 + 复制 block 引用 + `warnings: string[]` 显式展示）。
- **存储契约**：`<数据根>/DB/review/<YYYYMM>/<代码>_<名称>_<YYYYMMDD>.md`；**一个标的 × 一个交易日 = 一个 md**；卡片为 H2 时间分节 + `^card-<YYYYMMDD>-<代码>-<HHmm>(-<seq>)?` 锚点；**新卡片插入到首个 `^ainote-` 分节之前（卡片区尾部）、附注始终在文档末尾**，既有字节不变（精确口径见 `iteration-1-contracts §4`）；进程内互斥 + 写前 `stat` 校验 + 重试 3 次 50/200/800 ms + 显式 `CONCURRENT_WRITE`（`iteration-1-contracts §5`）；同日同代码以代码定位既有文档（改名不产生第二份文档）。可复用写入接口契约（模块路径 + 导出签名 + service key）见 `iteration-1-contracts §3`，由 change 5 复用。
- **文件名与 frontmatter 净化**：名称段来自外部源（T2/S8 `stock_chi_name`），落盘前 MUST 经 change 2（`data-foundation`）`data-root-layout` 的 `sanitizeNameSegment`（**唯一实现 `src/paths/sanitize.ts`**，规则：NFC、`[\\/:*?"<>|\x00-\x1f]→_`、去首尾空格与点号、Windows 保留名加 `_`、≤40 字符、净化后为空回落代码段；`iteration-1-contracts §6`/`§11`）；本 change MUST NOT 另建 `src/review/sanitize.ts`；frontmatter 值一律双引号包裹并转义。
- **交易日归属**：`tradeDate` 取数据源业务日期、**不用系统日期**；解析封装为结构化 seam（`TradeDateResolver` 返回 `{ value, source, isTradingDay: true|null, confidence }`，默认实现调用 change 2 的 `traderKit.data.resolveTradeDate`）；`isTradingDay === null` 时 MUST 走用户确认（默认 = `value`），`value === null` 时默认留空并要求用户显式填入，均 MUST NOT 静默落盘。⚠ 该来源存在一条与「TQ 不固化进 TS」硬约束相邻的偏离，见 design.md「待裁决 D-TQ」（本 change 按选项 A 实现，不自行定案；台账与复审触发条件见 `docs/roadmap.md §5`）。
- **降级**：数据面不可用不阻塞输入与落盘；写盘失败显式报错且输入保留可重试；每块数据独立失败独立显示，不整体白屏。
- **联动换标的保护**：hash 变化且输入框非空时 MUST NOT 静默换归属——显示「未提交内容属于 `<原标的>`」并要求一次显式确认后才可提交到新标的（D-11）。
- **静态资产安全与打包**：资产由插件构建产物提供（`kind:'prefix'` 路由 + `Content-Type` 白名单 + 拒绝 `..`/绝对路径 → 404 + 无外链离线可用）；资产形态与打包落点（模板字符串内联 `lib` 或 copy 到 `lib/assets` 并写入 `package.json#files`）见 D-13。

## Capabilities

### New Capabilities

- `review-page`: 页面路由与传参/上下文切换、认证与写入通道、B1–B4 布局、本地段与网络段独立请求、B1 数据独立降级、B2 日期回读、B3 输入提交、数据面不可用不阻塞输入、静态资产安全、回退分支（`file://` 就地）。
- `review-card-store`: 卡片存储契约（路径与文件粒度、文档结构、追加/插入语义与原子写、**可复用写入接口契约**、文件名与 frontmatter 净化、并发写纪律、交易日归属、多命中确定性、回显与引用、渲染安全、失败可重试）。

### Modified Capabilities

（无。首次引入页面与卡片存储。）

## Impact

- **新增代码**（与 tasks 实体产物对齐）：`src/routes/review.ts`（页面与 JSON 接口）、`src/client/review/**`（无框架前端资产）、`src/review/store.ts`（卡片读写：定位/解析/插入/原子写/**可复用写入接口契约 `iteration-1-contracts §3`**，含 `DOC_MISMATCH` 写前硬校验与 `warnings` 编码）、`src/review/md/frontmatter.ts`（frontmatter 值级最小修补与键 schema）、`src/review/md/parse.ts`（锚点/H2 解析与 EOL/BOM 探测）、`src/review/anchor.ts`（代码与锚点规范化，`§2`，change 5 复用）、`src/review/format.ts`（**时间格式化单点**：`formatZonedIso` / `formatAnchorTime`，`§3`，change 5 复用）、`src/review/context.ts`（名称分层与交易日归属 seam）、`src/review/enrich.ts`（B1 有界回溯与降级）、service 出口扩展（页面用的读接口）。**文件名净化不新增模块**：MUST 复用 change 2 的 `src/paths/sanitize.ts`（`§6`/`§11`）。
- **依赖**：change 1（页面承载形态与认证——**承载绑定层** blocked_by change 1，见 tasks §2/§7）；change 2（T1/T2 经 service 出口、T0 的 `traderKit.data.resolveTradeDate`、`DB/review` 目录范式与自动创建）；**交易日历来源**为显式依赖（当前未定：TQ skill 结论或 change 2 增补；未定则 tasks 3.2b 标 blocked，`isTradingDay` 维持 `null` 语义）。
- **验收对照（模块文档 §7）**：选中→输入→落盘 ≤2 步交互且 ≤1 s；B1 显示标签与最近涨停原因（真实消费 service 出口）；B2 切换日期加载对应文档；B3 预留区不干扰输入；同标的同日多卡共处一文档且锚点唯一互不覆盖；切换标的不重载页面且不丢输入（非空输入时须显式确认归属）；md 在 Obsidian 可读可检索、block 引用可跳转；`isTradingDay===null` 或来源不可得时提交出现归属确认；写盘失败输入保留可重试；正文不被程序改写；全链路无交易接口调用；**`/api/local` 冷启动 ≤500 ms 且首屏不 await 网络段**。
- **报送 owner 的偏离**：R2 的「TQ `get_match_stkinfo` 名称反查」与 R5 的「`HqDate` 取交易日」在「TQ 不固化进 TS」约束下不可由页面直接实现（见 design.md 待裁决 D-TQ）。台账条目：`docs/roadmap.md §5`「D-TQ」行（默认处置 = 选项 A，复审触发条件 = owner 裁决 B 或「插件直调 17709」边界放开）；seam 契约须含 `source`/`confidence`/可选 `marketSuffix`，使 B 选项可零改动替换调用方。
- **明确不做**：F1.1/F1.2 完整信息面板、完整日历控件（月视图/打标）、模式识别与关联草稿（F2.2/F2.3）、点击联动与盘中页面（F5/M7）、AI 附注写入（change 5）、任何交易功能；本迭代**不引入交易日历数据源**（`isTradingDay` 维持 `null` → 走用户确认，不做「非交易日」推断）。
