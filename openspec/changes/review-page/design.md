## Context

复盘页面是迭代一的核心：把「看 → 想 → 记」放到盘面现场（通达信内），产物直接是 vault 资产。形态已定案为 **DSH 同端口二级页面**（M2-Q2），落库契约为「一个标的 × 一个交易日 = 一个 md，卡片为文档内分节」（2026-09-25/26 裁决）。

依赖与前提：

- **跨 change 唯一事实源**：`docs/design/iteration-1-contracts.md`（下称 `iteration-1-contracts §n`）。本 design 的存储、锚点、净化、并发、断言、发布纪律一律指向该文件；重排裁决见 `docs/roadmap.md §5`。凡「复用」一律写成「依赖 change X 的 `<具名接口>`（模块路径 + 导出签名 + service key）」，无具名接口的复用视为无效表述（契约 §0）。
- **change 1（spike）**：页面能否被 TDX 内嵌浏览器打开、传参/hashchange 行为、认证路径——本 change 的**承载绑定层**（路由注册/认证/静态资产形态）按其实测结论实现并 `blocked_by: change 1`；**承载无关层**（存储/解析/降级/名称链/净化）可先行（tasks §1/§3/§5）。若结论为回退 `file://`，页面资产改为就地静态页 + 本地 HTTP 取数（见 Migration Plan 与 spec「回退分支」Requirement）。仓内 `docs/**` 目前**无 spike 报告**（`docs/spikes/` 不存在），故全部承载绑定项在 spike 落地前不得视作可开工。
- **change 2（data-foundation）**：依赖其具名接口——`traderKit.data.resolveTradeDate({ date? })`（T0，`iteration-1-contracts §1`，本 change 的 `TradeDateResolver` 默认实现 MUST 调用它）、T1 `get_limit_reason` / T2 名称反查的 service 出口、`data-root-layout` 的 `resolveArea` 与目录自动创建（契约 §6：文件名模板由该映射表持有，调用方 MUST NOT 自行拼接）。
- **change 5（daily-summary）**：与本 change 共享写入器——本 change 依 `iteration-1-contracts §3` 导出 `src/review/store.ts` 的 `locateDoc/parseDoc/appendCard/appendAinote/scanDailyCardTargets` 与 service key `traderKit.review.*`；change 5 的 `review_append_ainote` MUST 与 `appendAinote` 同一实现（不得第二份追加逻辑），并共享 `§5` 的锁/重试纪律。
- **宿主事实**（符号名引用，行号易失效，沿 `iteration-1-contracts §8`）：同端口路由 `ctx.webServer.register({kind, path, handler})`；认证 `ctx.connection.requestRejection` / `authenticatedUrl`（`packages/client/connection/src/browser-auth.ts:<符号>`）。**核验状态：未实测**——DSH 安装目录为 `app.asar` 归档，read 返回 not found，本仓无 `packages/`；等价性以 change 1 探针实测为准（可比先例：`DSH-better-sidebar`，版本等价性未核验）。
- **vault 现场**：`DB/review` 当前不存在（首次落盘时按范式创建）；`DB/stock/`（Q3 的本地标的库索引）**尚未建索引**，因此本迭代不能依赖「按代码直读本地档案」——这直接决定了名称三层兜底的分层归属（见 D-5）。写分区白名单（`DB/review/`、`agent/DB/temp/dsh-trader-kit/`）见 `iteration-1-contracts §10`。

## Goals / Non-Goals

**Goals:**

- 选中个体 → 输入 → 落盘 ≤ 2 步交互、≤ 1 s，且切换标的不重载页面、不丢未保存输入（P1/P3）。
- 产物符合既有 vault 形态：md、可检索、block 引用可跳转、既有分节永不被改写（P4/P5）。
- 数据面任何一处挂掉都不影响「记录」这条主链路（降级完备）。

**Non-Goals:**

- 不做 F1.1/F1.2 的完整信息面板（本迭代 B1 只取标签 + 最近涨停原因两项）。
- 不做完整日历控件（月视图 / 有卡日期打标）——B2 日期切换即回读形态。
  **（2026-10-05 owner 裁决修订：B2 改用自绘月历选择器并弃用原生 `<input type="date">`；月历仅为日期选择器，「有卡日期打标」禁令仍然有效——不打标、不依赖 `/api/dates`。spec B2 需求已同步。）**
- 不做模式识别/关联草稿（F2.2/F2.3）、不做点击联动与盘中页面（F5/M7）。
- 不做 AI 附注写入（归 change 5），但本 change 需在解析层忽略 `^ainote-` 分节。
- 不引入前端框架与私有存储格式。

## Decisions

### D-1 路由与接口面

前缀路由 `<basePath>/review`（`basePath` 默认 `/dsh-trader-kit`，与 change 1 的探针路由同前缀）：

| 方法 | 路径 | 用途 | 段 |
| --- | --- | --- | --- |
| GET | `/review` | 页面 HTML（离线自包含资产） | 本地 |
| GET | `/review/<code>` | path 段直链（补 D-1 路由，消解 spec「兼容 path 段」与路由表不一致）；匹配优先级在 `/review/api/*` 之后 | 本地 |
| GET | `/review/api/local?code=&date=` | **纯本地**：代码规范化结果与原始取值、名称层①/③（本地历史 frontmatter → 仅代码，含 `nameSource`，**零网络**）、归属交易日与来源、当日卡片列表、有卡日期、`warnings: string[]`；冷启动 ≤500 ms | 本地 |
| GET | `/review/api/enrich?code=&date=` | **网络段**：名称层②（T2/S8 网络反查，返回 `name` + `nameSource: 'T2-S8'`）、B1 标签（T2）与最近涨停原因（T1 有界回溯）及其降级状态；异步、可 abort | 网络 |
| POST | `/review/api/card` | 追加卡片（body/可选 tradeDate/可选 name/**必填 `clientRequestId`**） | 写 |
| GET | `/review/api/dates?code=` | 该标的有卡日期列表（B2 提示用，非月视图） | 本地 |

**接口切分（修订 R1-Issue 2）**：`GET /review/api/context` 单接口聚合**已废止**——它使「本地 500 ms 出屏」与「网络段 ≥9–10 s」（D-8 有界回溯）不可同时成立。现方案把本地段与网络段拆为**两个独立请求**：`/api/local` 无任何出站网络调用（纯文件系统 + seam 缓存），页面首屏 MUST NOT await `/api/enrich`（网络段返回后按段补位，失败只影响 B1 的名称层②与两项网络数据）。`/api/dates` 归入本地段语义，v1 保留为独立路由亦可，但 MUST NOT 引入网络调用。

页面不直接调用 T1/T2 的第三方端点，全部经 service（`iteration-1-contracts §7`：`src/routes/**`、`src/client/**` MUST NOT import `src/data/**`；除 `§7` 的两条具名出站通道外零 `fetch`）。

**可注入的 handler 工厂（R3-Issue 35，沿 change 1 D-10 先例）**：路由 handler MUST 提为**纯工厂** `createReviewHandler(deps)`（`src/routes/review.ts`），`deps` 至少注入 ① 认证判定（A 层 cookie 是否有效 / 是否回退分支）、② 资产读取（`readAsset(path)`）、③ 取数 service（`resolveTradeDate` / T1 / T2 出口）。工厂只做「请求对象 → 响应对象」的纯映射，不自行读文件、不自行判定 cookie、不自行发请求。

- 单测 MUST 用**请求桩**（构造 `Request`/`IncomingMessage` 形状的普通对象）直接调用工厂产物：未认证写请求、A 层不可用（`deps.auth` 返回不可用）、B 层 token、非法入参、MIME、穿越、无外链均可零 mock 断言。
- **注册 / 卸载**（`ctx.effect` / `ctx.webServer.register`）与「宿主 `requestRejection` 真实行为」标为**集成核对**，不在单测内伪造宿主；`test/**` 下 MUST NOT 出现第三处 `fetch(`（`iteration-1-contracts §7` 只承认 `src/data/http.ts` 与 `src/skill/download.ts` 两条出站通道），请求桩 MUST 以函数注入方式构造，MUST NOT 用本地 HTTP 客户端发起真实请求。

### D-2 前端资产：无框架、离线自包含

单 HTML + 少量内联/同源 JS（原生 DOM），不做框架与构建链。理由：四区块 + 一个输入框的状态复杂度很低；spike 已证明内嵌内核版本不可控（change 1 D-2），框架产物会引入不必要的语法/体积风险。资产由插件构建产物提供（`kind: 'prefix'` 路由 + MIME 白名单 + 路径穿越防护），**无 CDN 外链**。

**资产形态与打包（修订 R1-Issue 15）**：二选一并在实现首步定案——

1. **模板字符串内联进 `lib`**（推荐）：`src/client/review/index.html.ts` 导出 HTML 字符串常量，随 TS 编译进 `lib/**`，无需额外打包/拷贝步骤，`package.json#files` 已覆盖 `lib`；
2. **copy 到 `lib/assets`**：构建脚本把 `src/client/review/assets/**` 复制到 `lib/assets/**`，并把 `lib/assets` 写入 `package.json#files`。

无论哪种，路由对静态资产 MUST：按扩展名映射 `Content-Type` 白名单（`text/html; charset=utf-8` / `text/css` / `text/javascript` / `image/png` / `image/svg+xml` / `application/json`），白名单外一律 404；拒绝含 `..` 段、绝对路径、盘符、URL 编码穿越（`%2e%2e`、`%2f`）、以及非常规文件名（404 而非 403，避免目录探测）；HTML 响应带 `Cache-Control: no-cache`（便于随插件版本更新），`ETag` 可后置。**无外链**：资产内 MUST NOT 出现 `http(s)://` 外部资源引用（含字体/图标/CDN）。

### D-3 认证分层与写接口的 A 层依赖（按 change 1 结论 + `iteration-1-contracts §12.1`，修订 R2-Issue 19）

认证语义以 change 1（`spike-tdx-embed`）D-3 的定案为准，分三层，本 change MUST NOT 再写「每请求带 token（B 层）」的旧语义：

| 层 | 形态 | 能力边界 | 本 change 的用法 |
| --- | --- | --- | --- |
| **A 层（唯一业务通道）** | 宿主 tokenized URL + cookie，**必须两步**：先 `GET <base>/?token=<launchToken>`（宿主 `authorizeIndex` 铸造 `HttpOnly; SameSite=Strict` cookie 并 303），**再**导航 `<basePath>/review` | 宿主认证（`requestRejection` 读 cookie） | **读通道分档**：默认分支页面与读接口走 A 层；回退分支未签字前不提供未认证读（见下第 4 条）。**写入通道两分支同**：只认 A 层 |
| **B 层（诊断/只读）** | change 1 定义的**插件自持诊断 token**（每次请求带 `?token=`，由插件路由自行常数时间比对，仅存内存） | 仅诊断页/只读接口；**不是**宿主认证的等价物 | MUST NOT 用 B 层放行任何写入，也 MUST NOT 声称其等价于宿主认证 |
| **C 层（`file://` 就地只读）** | loopback + `Host`/`Origin` 栅栏的未认证诊断页，**需 owner 签字** | 只读 | 仅回退分支在 C 层**签字后按其显式放宽点**只读；**未签字不提供未认证读**；写入两分支均不适用本层 |

**硬约束（契约 §12.1）**：

- `POST /review/api/card` 与一切落盘路径**只接受 A 层凭据**，MUST NOT 依赖 B/C 层；「写接口无论哪种承载分支都必须认证」的落地方式即「只认 A 层」，MUST NOT 放宽为 B 层 token 或未认证 loopback。
- **A 层不可用 → 写入接口不可用**：显式禁用（返回明确错误码 + 提示「认证不可用，卡片不可写入」）+ 页面**只读降级**（B4 仍可读、B3 提交禁用并显示原因），MUST NOT 降级认证、MUST NOT 静默改为未认证写入。（**B4 可读以实现读通道分档为条件**：回退分支按第 4/5 条，C 层未签字时只交付文档形态 + 「取数不可用」空态。）
- **直连业务路径带 `?token=` 必然 401**（change 1 D-3 已实测归因：`?token=` 只在 `GET /` 被消费，`isAuthenticated` 只读 cookie）——作为负向验收项保留，MUST NOT 被误读为「TDX 不支持认证」而放宽。
- 回退分支（`file://`，cookie `SameSite=Strict` 且跨源不透明来源）的写认证**在 owner 裁决前即按「写入不可用」处理**：候选（owner 在 C 层签字 / 签名 URL / 跳板代理）与放宽范围见 change 1 Open Questions 5，并登记于 `docs/roadmap.md §5`。
- **回退分支的读通道分档（R3-Issue 31）**：删除「回退分支下**全部接口**走 A 层」的无条件表述。**默认分支**读接口走 A 层；**回退分支**读接口在 C 层**未签字前 MUST NOT 提供未认证读**——该分支只交付**文档形态（静态资产可加载/渲染）+ 显式「取数不可用」空态**，MUST NOT 以「只读页面」暗示取数可用、MUST NOT 用 B 层诊断 token 兜底读；C 层签字后仅按签字所载**显式放宽点**（来源 / 方法 / 路径白名单）提供只读，放宽点记 `docs/roadmap.md §5`。**写入只认 A 层**在两分支同等生效（不受 C 层签字影响）。

### D-4 写入流程：定位 → 互斥 → re-read → 合并 → 原子写（契约 §3/§4/§5）

可复用写入接口契约原样落入 `review-card-store` spec「可复用写入接口契约」Requirement（模块路径 `src/review/store.ts` + 导出签名 + service key `traderKit.review.*`），change 5 复用。

1. **定位文档**：经 change 2 `data-root-layout` 的 `resolveArea` 拼路径（调用方 MUST NOT 自行拼接）；扫 `<数据根>/DB/review/<YYYYMM>/` 匹配 `<代码>_*_<YYYYMMDD>.md`；命中即复用（防名称变化产生第二份文档）；多命中（历史遗留）按 **mtime 最新、平局按文件名字典序** 确定性取一（D-14），并在 `/api/local` 的 `warnings` 中显式告警（不静默任选）。
2. **进程内互斥**：按**绝对路径**的异步互斥（`Map<absPath, Promise>` 串行链），写卡片/写附注/工具出口共用同一张表（契约 §5）。
3. **re-read + 合并**：读取现有内容（不存在则按模板生成 frontmatter）；保留既有 frontmatter 键（`patterns`/`drafts` 等，未知键原样保留）；既有各分节字节序列原样保留（**字节级**，精确口径见契约 §4）；**写前 `stat`（`mtimeMs` + `size`）与读取快照比对**，不一致 → 重读重试。
4. **插入分节**：`## HH:mm ^card-<YYYYMMDD>-<代码>-<HHmm>` + `writtenAt` + 正文；插入位置 = **首个 `^ainote-` 分节之前**（即卡片区尾部：在所有既有卡片之后、在附注之前）；文档无附注时等价于追加到末尾；再往后的内容（附注及任何尾部内容）整体后移但字节不变。同 `HHmm` 冲突则锚点追加 `-<seq>`（`-2` 起）。`^ainote-` 分节**始终位于文档末尾**，两者 MUST NOT 互换位置（跨 change 语义，与 change 5「附注 = 文档末尾独立分节」一致）。
5. **原子写**：同目录临时文件写入后改名覆盖（Node `fs.rename` 在 Windows 覆盖已存在目标）；失败重试上限 3 次、退避 **50 / 200 / 800 ms**、单次写入总超时 5 s；`EBUSY`/`EPERM`/`EACCES` 视为可重试；冲突不可解 → 显式错误 `CONCURRENT_WRITE`（含路径与处置建议），MUST NOT 静默覆盖；失败则清理临时文件并按 spec「写盘失败可重试」报错，**不产生半截文档**。
6. **提交幂等**：`POST /api/card` 携带 `clientRequestId`；服务端按「文档 + 该 id」去重（在文档内落一条可解析的幂等登记，如分节内 `- clientRequestId: <id>` 元信息行），重复请求返回 `status: 'duplicate'` + **既有锚点**与路径，不追加第二张卡片（D-17）。

### D-5 名称三级兜底的分层归属（`iteration-1-contracts §12.4`，修订 R2-Issue 22）

`DB/stock/` 索引未建（Q3 未完成），本迭代的名称来源共三层；**层号 = 兜底优先级，且每层的接口归属唯一**：

| 层 | 来源 | 归属接口（唯一） |
| --- | --- | --- |
| ① | 该标的历史卡片文档 frontmatter 的 `name`（零网络） | `GET /review/api/local` |
| ② | 数据工具 T2/S8 名称反查（`stock_chi_name`，best-effort） | `GET /review/api/enrich`（入参含 `code`，返回 `name` + `nameSource: 'T2-S8'`） |
| ③ | 仅代码 | `GET /review/api/local`（`nameSource: 'code-only'`） |

- `/api/local` **MUST NOT** 承担网络反查（否则本地段 ≤500 ms 的承诺失效）：其名称取值域只有 ① 与 ③，且 MUST 带 `nameSource: 'frontmatter-history' | 'code-only'`。
- 页面在本地段 `nameSource === 'code-only'` 时，用 `/api/enrich` 返回的层②名称**补位替换**并更新来源标注；本地段已命中层①时**保留本地名**（层序由契约 §12.4 固定，MUST NOT 被网络段覆盖）。
- 文件名名称段按层序派生；③ 情况下以代码充当名称段，且**不事后重命名**（避免破坏已复制的 block 引用与 OneDrive 同步）；网络层②到得更晚也 MUST NOT 触发改名（D-12）。

### D-6 卡片解析：锚点驱动、只认 H2、跳过代码块、忽略附注（契约 §2）

以行内锚点识别卡片分节，**锚点正则唯一版本**（与写入共用，`iteration-1-contracts §2`）：

```
^card-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
```

解析与幂等扫描规则：

- **逐行扫描，只认 H2 标题行**（`^##\s`）；用户正文里出现的锚点字样 MUST NOT 影响判定。
- **跳过 fenced code block**（``` / ~~~ 围栏）内的行——正文里的示例锚点不构成卡片。
- **归属校验**：仅当「锚点日期段 == frontmatter `tradeDate` 折算的 `YYYYMMDD`」且「代码段 == frontmatter `code`」时才算有效卡片/附注；不一致记入 `warnings`（**幽灵锚点告警**），不静默、不计入用户卡片。
- **同前缀重复锚点**（如两个 `^card-20260924-600000-1432`）视为异常：渲染时按首次出现保留、其余去重，并记入 `warnings`（**重复锚点告警**）；写入侧 MUST NOT 再产生重复（`-<seq>` 规则）。
- 分节内 `- writtenAt:` 行取元信息，其余为正文；`^ainote-` 前缀分节一律排除在用户卡片之外（change 5 写入的附注不污染 B4）。解析用正则 + 行扫描（不引 Markdown 解析库：结构受本插件契约约束，解析面可控）。
- **显式取舍**：正文若含行首 `## `，会被切分为多个 H2 分节（结构后果）。本 change **不加工正文**（spec「正文原样写入」），因此该情形按「非锚点 H2 行既不算卡片、也不改变卡片分节边界」处理：卡片分节 = 从锚点 H2 行到下一个锚点 H2 行/附注 H2 行/文件末尾，中间的非锚点 H2 行属于该卡片的正文一部分；MUST NOT 因此判定为幽灵卡片。此取舍写入 spec 场景（D-16 断言）。

### D-7 性能预算与异步补位（修订 R1-Issue 2）

首屏「本地部分」= 代码/名称层①·③（本地历史 frontmatter → 仅代码）/归属交易日显示/当日卡片/`warnings`，**≤ 500 ms 出屏**（纯文件读取，零出站网络）。缓存口径：本 change 首屏统计口径与依赖 change 2（`data-foundation`）design 的 500 ms 结论一致（只约束本地段，不含 T2 的 ~0.35 s/只）；缓存层级见 `iteration-1-contracts §9`。

- `/api/local` MUST 为纯本地：其依赖只有文件系统 + change 2 的**内存缓存读**（无网络、无缓存未命中触发的取数）；无缓存时以「不可得 + 走确认」降级，而不是发请求。
- `/api/enrich` 为独立请求，页面首屏 MUST NOT await 它；网络段返回后按段替换（先渲染降级态）；失败/超时只影响 B1 的名称层②与两项网络数据并展示原因。
- 断言方式（契约 §7）：性能场景以**结构化断言**表达（`/api/local` 路由模块不 import `src/data/**`、其调用链最多命中一次 `stat`/`readFile` 系列），而非仅比对源码文本。

### D-8 B1「最近涨停原因」的回溯策略（`iteration-1-contracts §12.5`/§12.8，修订 R2-Issue 21、R3-Issue 29/30）

「最近一个有涨停记录交易日」无法由单次调用得到，故实现为**有界回溯**。口径与契约 §12.5/§12.8 逐字对齐（原「≤6 业务日 + ≤7 请求 + 禁自然日枚举」三条 MUST 在无交易日历下互斥，已废止）：

| 项 | 定值 | 依据 |
| --- | --- | --- |
| 起点 | `resolveTradeDate` 得到的最近业务日；第 1 次请求即该日 | 契约 §1 |
| 推进 | 第 k+1 次请求日 = **第 k 次响应返回的 `businessDate` 的前一自然日**；每次的 `businessDate` 由源返回、MUST NOT 自行枚举或跳过交易日（不假设周末/节假日），MUST NOT 用请求日顶替响应 `businessDate` | 契约 §12.5 |
| 以响应业务日为基准（防漏检，R3-Issue 29） | 响应回带的 `businessDate`（非 null）即该次**实际评估的交易日**，MUST 纳入命中判定与记录；**无论它与请求日是否相同，下一次请求日 MUST 从响应 `businessDate` 前推**。断言：不得出现「请求日 A、响应业务日 B（B<A）、然后从 A 前推」的路径 | 契约 §12.5；`limit-reason-tool`：源在历史日会回带上一业务日 |
| `businessDate === null` | 该次记为「**该日数据不可得**」（不计为「无涨停记录」），以**该次请求日**的前一自然日继续推进（计入 N）；MUST NOT 抛未捕获错误、MUST NOT 静默停摆 | 契约 §12.8；`data-foundation/design.md`「响应体确无日期 → `tradeDate=null` + `dateUnavailable`」 |
| 分档判据（R3-Issue 29） | `available=false` + `errors` 含 `dateUnavailable` → 「数据不可得」，**不计为「未找到涨停记录」**，按上式继续推进；`available=false` 且无 `dateUnavailable` → 「该日无该标的涨停记录」 | 契约 §12.8（`available`/`errors` 二分）；`limit-reason-tool` spec |
| 请求上限 | **≤6 次 T1 列表级请求**（默认 6，可配置且不可超过 6）；命中即停 | 契约 §12.5；change 2 `data-tool-contract`「缓存幂等与原子写」Requirement（**一次 History 请求 = 一次列表级请求**） |
| 单次页面打开总出站 | ≤7（1 次 T2 标签 + ≤6 次 T1 回溯）；同一 `businessDate` 不重复请求 | 同上；预算桶不被打穿 |
| 单请求超时 | 5 s（超时按该项降级并记录是否继续回溯） | 与 change 2 单次调用超时口径一致 |
| 导航离开/切标的/切日期 | **立即 abort** 未完成的 `/api/enrich` 及其后续回溯（`AbortController`），不再发新请求 | 防止离开页面后仍吞预算 |
| `offSession` 裁决 | **本迭代不使用**（页面不申请护栏旁路）；数据模块返回**显式错误**（任何错误码，含护栏拒绝）时按降级处理并展示错误码与原因，MUST NOT 放宽护栏 | 契约 §9；change 2 护栏 |
| `businessDate ≠ requestedDate` | 结果以**源返回的 `businessDate`** 归属与展示；缓存键仍由 `requestedDate` 构造（契约 §9），差异记入响应字段 | 契约 §1/§9；避免缓存桶键与「同参零网络」被破坏 |
| 结论文案（由 `availability` 驱动） | `available:true` → 命中日原因与日期；`reason:'noRecord'`（任一次为「该日无记录」即终态）→「**近 N 次查询内未找到涨停记录**」；`reason:'dateUnavailable'`（**N 次全部为「数据不可得」**）→「**近 N 次查询内未取得可用数据（数据不可得）**」，正文 MUST NOT 写「未找到涨停记录」；`reason:'rateLimited'` →「近期涨停记录不可得（频控受限）」；`reason:'sourceError'` →「近期涨停记录不可得（数据源错误 `<错误码>`）」 | 契约 §12.5/§12.8；spec「B1 有界回溯的量化边界」 |

**结果结构（响应契约）**：`/api/enrich` 的 B1 涨停原因段 SHALL 返回

```ts
availability: { available: boolean; reason?: 'noRecord' | 'dateUnavailable' | 'rateLimited' | 'sourceError' }
businessDate?: string        // available=true 时 = 命中的源业务日
requestedDates: string[]     // 本次实际请求过的日期（长度 ≤ N）
unavailableDates: string[]   // 其中经 §12.8 判定为「数据不可得」的日期
```

**`sessionRejected` 的处置（R3-Issue 30，择「删除该状态断言」）**：change 2 的 `data-tool-contract` 无名为 `sessionRejected` 的状态、错误码或返回字段，单标的 T1 调用也不命中「全市场级」判据（批量 > 20 **或**显式 `fullMarket`），故该状态**无生产者、零 mock 不可构造**。据此：① `sessionRejected` 及「盘中限制，盘后重试」文案**从本 change 的 spec/design/tasks 删除**，改述为「数据模块返回**显式错误（任何错误码）**时展示原因」（`reason: 'sourceError'`，由**具名可注入的取数 seam** 驱动，可 stub、可断言 `available=false + reason`）；② 本 change MUST NOT 自行发明该状态；③ 若 change 2 日后真的定义时段拒绝语义，本 change 只把其错误码透传到 `reason: 'sourceError'` 的详情文案（登记为跨 change 回写项，见 tasks 5.6）。

**与 change 2 `limit-reason-tool` 的接口对齐项（跨 change 回写项，tasks 5.6）**：本 change 消费其 `available` / `errors[]`（含 `dateUnavailable`）/ `tradeDate`（= 本 change 的源 `businessDate`）。change 2 spec MUST 保证 ① 日期不一致或历史端点为空时 `errors` 含 `dateUnavailable`；② `available=false` 且无 `dateUnavailable` = 「该标的无涨停记录」；③ `dateUnavailable` 时 `tradeDate` 为源业务日或 `null`（本 change 两种取值均已按分档处理）。契约 §12.8 已是二分口径，本 change 不新建第二份口径。

回溯结果由 change 2 的**列表级按日缓存**复用（`iteration-1-contracts §9`：键 = `source + requestedDate`），命中缓存零网络。

### D-9 B2 日期输入的默认与边界（交易日归属结构化，修订 R1-Issue 1）

默认值为「归属交易日」；用户可切到任意 `YYYY-MM-DD`；切换仅触发该标的那一日文档读取（不预取其它日期）。`/api/dates` 返回该标的有卡日期，用于切换控件旁的轻量提示（**不是**月视图/日历打标，Non-Goals）。

**归属日解析 = 依赖 change 2 的 `traderKit.data.resolveTradeDate({ date? })`**（`iteration-1-contracts §1`），seam 契约升级为结构化返回（原「返回 `tradeDate | null`」已废止——它使「非交易日确认」在 T1「缺省返回上一交易日」的语义下**永不触发**，长假/盘前会静默错归属）：

```ts
type TradeDateResult = {
  value: string | null;            // 'YYYY-MM-DD'；null = 不可得
  source: 'T1-tradeDate' | 'TQ-HqDate' | 'user-confirm';
  isTradingDay: true | null;       // true = businessDate === 限流日；null = 无交易日历，归属待确认
  confidence: 'high' | 'low';      // 派生自 source 与是否与限流日一致
  marketSuffix?: '.SH' | '.SZ' | '.BJ';  // 为 D-TQ 选项 B（TQ HqDate 语义）预留
}
```

裁决规则（MUST）：

- `value === null`（数据源不可得）→ **MUST 走用户确认**，且默认值**留空**、MUST 要求用户显式填入（可预填 `requestedDate` 但标注「待确认」，MUST NOT 当作归属）；`isTradingDay === null` 且 `value !== null` → **MUST 走用户确认**，默认值 = `value`。两类确认后 `source = 'user-confirm'`；MUST NOT 静默落盘。
- `isTradingDay === true`（`value === 限流日`）→ 可直接归属，页面显示归属结果与来源。
- **无交易日历时 MUST NOT 用系统日期推断「非交易日」**，也 MUST NOT 用系统日期作为 `value` 的 fallback（契约 §1）。
- 「交易日历来源」为**显式依赖**：候选 = TQ skill 结论（change 3）或 change 2 增补的日历能力；**当前未定**，因此 tasks 3.2b 标 `blocked`（未定期间行为固定为 `isTradingDay === null` → 用户确认，不阻塞实现与落盘）。

**交易日历未定不影响本期可用**：契约 §1 明确 `isTradingDay` 只在 `businessDate === rateLimitDate` 时为 `true`，否则为 `null`；「null = 归属待用户确认」是本期正式语义，而非降级 hack。

### D-10 卡片分节 MVP 仅含 `writtenAt`（M2-Q3 裁决记录）

模块文档 M2-Q3 的裁决：「先只写 `writtenAt`，盘面快照（`sourceContext`）待盘面数据基础可用后补」。本 change 据此把 MVP 的卡片分节固定为只有 `- writtenAt:` 一条元信息行。补充形态沿 append-only 边界推导：`sourceContext` **仅对后继新卡片生效**（作为新分节内的元信息行），MUST NOT 回填既有卡片分节——回填即改写，违反「既有分节字节级不变」。此处记录裁决与推导，避免把 MVP 结构误读为禁止扩展。

## 追加决策（Round 1 评审后）

### D-11 联动切换标的的未提交内容保护（R1-Issue 5）

现网基线就是 TDX 用 `#hash` 联动改标的（change 1 design），用户为 600000 写到一半时可能被自动切到 000001。因此：

- 输入框绑定「**来源标的**」（`draftOwnerCode`，在首次输入时固化）。
- hash 变化时：输入为空 → 正常切换上下文；**输入非空且 `draftOwnerCode !== 新标的`** → MUST NOT 静默换归属：B1/B3 显示「未提交内容属于 `<原标的>`（将写入 `<新标的>`）」，并把保存按钮置为**需一次显式确认**（首次点击 = 确认并提交到新标的；或先点「改归属」清除该标记）。MUST NOT 直接以新标的落盘。
- 提交时若归属标的与输入来源不一致且未确认 → 服务端/前端 MUST 拒绝（返回显式错误），MUST NOT 落盘。
- 补 scenario + 单测（前端状态机测试：hash 变化 → 输入非空 → 断言出现确认态且提交被拦；确认后断言提交目标为原标的或新标的之一且显式可见）。

### D-12 文件名与 frontmatter 净化（R1-Issue 3，契约 §6）

名称段来自外部源（T2/S8 `stock_chi_name`），A 股 ST 名称常带 `*`（`*ST海航`）——在 Windows 上直接 `ENOENT/EINVAL`，且 `\`、`/`、`..` 可造成越界写。因此落盘前 MUST 经 change 2 `data-root-layout` 的 `sanitizeNameSegment(name)`（**唯一实现 `src/paths/sanitize.ts`**，`iteration-1-contracts §6`/`§11`）：

- Unicode **NFC** 归一；
- `[\\/:*?"<>|\x00-\x1f]` → `_`；
- 去首尾空格与点号（防 Windows 尾点/尾空格陷阱）；
- **Windows 保留名**（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`，大小写不敏感，含带扩展名形态）加 `_` 后缀；
- 长度上限 **40 字符**（超限截断，截断事实由 change 2 的实现产生、本 change 只透传到写入响应 `warnings`）；
- 净化后为空 → **回落代码段**充当名称段；
- 净化后 MUST NOT 改变既有文件名（命名只在首次创建时决定；`resolveArea` 对模板参数做白名单校验 `code: ^\d{6}$`、`date: ^\d{8}$`，调用方 MUST NOT 自行拼接）；
- **归属硬约束（R2-Issue 23，契约 §11）**：本 change MUST `import` 该唯一实现（或经 `resolveArea(key, params)` 生效），**MUST NOT 另建 `src/review/sanitize.ts` 或第二份净化实现**；全仓「净化实现唯一」为结构断言项。

frontmatter 值一律**双引号包裹**并转义 `"` 与换行；`name` 为空时写空字符串。单测覆盖：`*ST`、含 `/`、含 `:`、含控制字符、超长、Windows 保留名、净化后为空、NFC/NFD 组合字符、北交所代码。

### D-13 静态资产安全与打包（R1-Issue 15）

见 D-2 的「资产形态与打包」。spec 侧 Requirement 固定三条：① `Content-Type` 白名单（白名单外 404）；② 拒绝 `..`/绝对路径/盘符/URL 编码穿越（404，非 403）；③ **无外链**（离线可用，资产内零外部 URL，含字体/CDN/图标）。tasks 增资产形态定案、`package.json#files` 覆盖、MIME/缓存头断言与「无外链」扫描断言（扫描前先断言目标非空，契约 §7）。

### D-14 多命中确定性（R1-Issue 12，契约 §3）

同一 `(code, date)` 命中多份文档时：**取 `mtime` 最新；平局按文件名字典序（`localeCompare` 的稳定排序，等价于 code unit 序）**。选择结果与其它命中 MUST 通过 `/api/local` 的 `warnings: string[]` 返回（元素含被选路径与其它候选路径），由页面 **B4 上方**显式展示「发现 N 份同日文档，已写入 X，另存在 Y/Z（未改动）」。MUST NOT 静默任选、MUST NOT 自动合并或删除孤儿文档。补单测（构造两名命中 + mtime 平局两种）。

### D-15 幂等与解析规则统一（R1-Issue 14，契约 §2）

- 锚点正则统一为**带 `(-<seq>)?` 的唯一版本**（写入、解析、幂等扫描共用同一常量，禁止第二份正则）。
- 解析/幂等只认 **H2 标题行**，跳过 **fenced code block**；正文中的锚点字样 MUST NOT 影响判定。
- **归属校验**：锚点日期段 == frontmatter `tradeDate` 折算 `YYYYMMDD` 且代码段 == frontmatter `code`；不一致 → **幽灵锚点告警**（`warnings`），不计入卡片。
- **重复锚点** → 保留首次、其余去重并**显式告警**（不静默）。
- **市场前缀归一化**（`normalizeCode`）：去 `sh|sz|bj` 前缀与 `.sh|.sz|.bj` 后缀（大小写不敏感），余下须为 6 位数字；**只去壳，不补全位数**（`60000` → 非法，MUST NOT 补成 `060000`）。这与「MUST NOT 猜测代码」不矛盾：**归一化 = 去掉已知外壳格式；猜测 = 对不完整/歧义取值做补全或推断**。前者允许且必须记录原值，后者一律拒绝并给空态。
- 上述规则同步为 spec 场景 + 单测（幽灵锚点、重复锚点、代码块内锚点、`SH600000` / `600000.SH` / `sh600000` 归一化、`60000` 拒绝）。

### D-16 断言方式（契约 §7，对应评审 Issue 16 的断言部分）

文本扫描断言 MUST 升级为**结构断言**：

- `src/routes/**`、`src/client/**` MUST NOT import `src/data/**`（允许 import service 类型）；用 AST/模块图断言（如 TS 编译 API 或依赖图工具），而非 grep 字符串。
- 除 `§7` 的两条具名出站通道（`src/data/http.ts`、`src/skill/download.ts`）外，全仓零 `fetch(` / `http.request` 调用点（`test/**` 同样零 `fetch(`，请求桩以函数注入构造）。
- **扫描型用例 MUST 先断言「扫描目标非空」**（`targets.length > 0`），避免空过。
- 17709 断言：数据模块对其无 HTTP 请求，仅 `net.connect` 探测（可配置关闭）；交易接口断言：源码与依赖中不存在 `order_stock` / `cancel_order` 调用路径。

### D-17 提交幂等（R1-Issue 16）

`POST /api/card` **必填 `clientRequestId`**（客户端生成，页面一次「提交意图」一个 id，重试复用同一 id）。服务端按「**文档 + 该 id**」去重：命中即返回既有锚点与路径、`status: 'duplicate'`，MUST NOT 追加第二张卡片。落盘形态为分节内 `- clientRequestId: <id>` 元信息行（可解析、可扫描、不引入插件侧状态文件）。缺 `clientRequestId` 的请求 → 400 显式错误（不静默生成）。

### D-18 交互态与输入法（R1-Issue 18）

- **窄视口可断言值**：视口 ≥320 px 时无横向滚动（`documentElement.scrollWidth <= clientWidth`）、输入框与保存按钮**可见可点**（不为 `display:none`/`visibility:hidden`/被遮挡）。
- **态清单**：`idle` / `loading`（本地段加载中，禁用保存）/ `submitting`（防重，按钮 disabled + 文案「保存中」）/ `error`（显式原因，输入保留，可重试） / `empty`（无标的、无该日卡片；`empty` 文案含原始取值 + 期望格式 + TDX 侧配置指引）。
- **输入法**：`Ctrl+Enter` 在 `KeyboardEvent.isComposing === true`（或 `compositionstart` 后未 `compositionend`）期间 MUST 忽略，不提交。
- **预留按钮区**：v1 仅占位，按钮 MUST 为 `disabled` 且 **`tabindex="-1"`（不占焦点顺序）**；焦点顺序 = B2 日期 → B3 输入框 → 保存 → 预留区（跳过）。
- 补前端状态机测试（态切换 + `isComposing` 忽略 + 焦点顺序断言）。

### D-19 时间格式化单点 `src/review/format.ts`（R2-Issue 20，契约 §3）

change 5（`daily-summary`）以 MUST + 结构断言要求「附注 `generatedAt` 与卡片 `writtenAt` 共用 change 4 的同一格式化导出」。原契约下本 change 无该模块，属**具名接口断点**。据此新增 `src/review/format.ts`（唯一所有者，`iteration-1-contracts §11`），导出：

```ts
formatZonedIso(date: Date): string    // 'YYYY-MM-DDTHH:mm:ss+08:00'（偏移固定 +08:00）
formatAnchorTime(date: Date): string  // 'HHmm'（锚点时间段；分节标题 HH:mm 与之同源）
```

- `formatZonedIso` 服务卡片 `writtenAt` 与附注 `generatedAt`；`formatAnchorTime` 服务锚点 `-<HHmm>` 与分节标题的 `HH:mm`。
- change 5 MUST 引用同一导出（契约 §3），MUST NOT 自写 ISO 格式化；结构断言 = 全仓仅一处 `+08:00` 偏移拼装。
- 本模块只接受 `Date`；`YYYY-MM-DD ⇄ YYYYMMDD` 换算**不在**此处（唯一实现是 change 2 的 `src/data/date.ts`，契约 §3）。

### D-20 `warnings` 的类型与唯一编码（R2-Issue 27，契约 §3/§12.7）

契约 §3 规定五个导出**一律**返回 `warnings: string[]`，而 spec 又要求告警元素「含路径 + 类型 + 原因」——两者以「内部结构 + 单一编码函数」统一，避免规格互斥：

```ts
type StoreWarningKind = 'multiHit' | 'ghostAnchor' | 'duplicateAnchor' | 'nameTruncated'
type StoreWarning = { kind: StoreWarningKind; path: string; detail: string; candidates?: string[] }
// 编码（唯一实现）：`[<kind>] <path> — <detail>`；有候选时追加 `；候选: <a>, <b>`
```

- **`docMismatch` 不在枚举内（R3-Issue 34）**：写前归属不一致是**抛错路径**（D-21 的 `DOC_MISMATCH`，不追加、不返回结果体），不存在 `warnings` 产生路径，故该 `kind` MUST NOT 保留（否则编码断言中该支恒为空转）。
- `warnings` 字段名**一律**为 `warnings: string[]`（store 层导出 / `/api/local` / 写入响应同一名字）；`storeWarnings[]` 别名在本 change 内 MUST NOT 出现（`iteration-1-contracts §3`/§12.7；change 5 已明文否定该字段名）。

- 五个导出的 `warnings: string[]` 元素 MUST 由该编码函数产出（页面可直接展示，测试可解析回 `kind`）；MUST NOT 出现无 `kind` 前缀的自由文本告警。
- **`Card` / `AInote` 最小类型**（change 5 复用，契约 §3）：

```ts
type Card   = { anchor: string; writtenAt: string; body: string; heading?: string; clientRequestId?: string }
type AInote = { anchor: string; body: string; generatedAt?: string; tradeDate?: string; code?: string; meta?: Record<string, string> }
```

  change 5 的 `cards` 元素 `{anchor, writtenAt, body}` 是本 `Card` 的子集，两边 MUST NOT 各自定义不同形状。
- **`nameTruncated` 是写时事实**：由 change 2 的净化实现产生信号，经 `locateDoc`/`appendCard` 的响应 `warnings` 透传给页面（首次建文档时展示）；`/api/local`（读时）MUST NOT 被要求重算该告警。该信号的**返回形状由 change 2 的 `sanitizeNameSegment`/`resolveArea` 提供**——change 2 spec 现只写「截断并记 `nameTruncated`」，MUST 补明标志形状（**跨 change 回写项**，见 tasks 1.7 与 Open Questions 9）；未暴露期间 `warnings` 不含该项，本 change MUST NOT 自行重算净化规则。

### D-21 写前归属硬校验 `DOC_MISMATCH`（契约 §3）

`appendCard` / `appendAinote` MUST 在写入前校验「目标文档 frontmatter 的 `tradeDate` + `code`」== 入参 `loc`；不一致 → 抛**显式错误 `DOC_MISMATCH`**（错误体含两边的 `code` 与 `tradeDate`），MUST NOT 追加，MUST NOT 静默改用其它文档（D-14 的多命中选一不得被用作「换一份文档写」的理由）。

## 待裁决 D-TQ：页面所需业务日期与名称的取数边界（本 change 不自行定案）

**台账化（R1-Issue 17）**：本项已在 `docs/roadmap.md §5` 的「D-TQ」行登记（**默认处置 = 选项 A**；**复审触发条件 = owner 裁决选项 B，或「插件直调 17709」边界放开的裁决**）。本 design 引用该条而不另立台账；落地后 MUST NOT 被当作「A 已成既成事实」——D-TQ 未闭环前，seam 契约按「可替换为 B」设计（见下）。

**冲突事实**：`需求描述-复盘卡片MVP` R2 与 R5（及 §8 依赖）要求名称经 **TQ `get_match_stkinfo`** 反查、`tradeDate` 取 **TQ `get_more_info` 的 `HqDate`**；而 `需求描述-盘面数据组件` §2/§8 与本轮硬约束要求「**TQ 能力一律通过 tq-local skill 由 agent 读取执行，不固化进 TS 代码**」，M1-Q4 亦把「插件直调 17709」列为待议边界。**页面不是 agent，无法使用 skill**——两条要求在页面上直接冲突。（该需求文档为**仓外文档，未能核验**；沿 `iteration-1-contracts §8` 标注。）

选项与代价：

| 选项 | 做法 | 代价 | 收益 |
| --- | --- | --- | --- |
| **A（本 change 实现）** | 页面不用 TQ：名称走 T2/S8 → 历史卡 frontmatter → 仅代码；业务日期走 seam（数据源业务日期，不可得则用户确认） | 偏离 R2/R5 字面（无 `get_match_stkinfo` / `HqDate`） | 严格遵守「TQ 不固化」与只读边界；无需新的边界裁决 |
| B | 为页面引入**极窄 TQ 只读适配器**（仅 `get_more_info.HqDate` 与 `get_match_stkinfo` 两个读取用途） | 把 TQ 调用固化进 TS（双维护）；需 owner 就 17709 边界裁决 | 与 R2/R5 字面一致，归属更准 |
| C | 页面请求触发 agent 会话代取 | 引入会话依赖与延迟，违背 P1（现场、即时） | 无需插件直连 TQ |

**本 change 按 A 实现，并以 seam 隔离**（`src/review/context.ts` 的 `TradeDateResolver` / `NameResolver` 两个接口）：若 owner 裁决为 B，只需替换 seam 实现，页面与存储层零改动。seam 返回值 MUST 足以承载 B：

```ts
// TradeDateResolver：见 D-9 的 TradeDateResult（含 source / confidence / marketSuffix?）
// NameResolver：
type NameResult = {
  value: string | null;
  source: 'T2-S8' | 'frontmatter-history' | 'code-only' | 'TQ-match-stkinfo';
  confidence: 'high' | 'low';
  marketSuffix?: '.SH' | '.SZ' | '.BJ';   // 为 B 选项（沪 .SH / 深 .SZ）预留
}
```

**该偏离与裁决请求须报 owner**，并在裁决后回写需求文档 R2/R5（或补注）；tasks 3.1b 补「B 选项最小 stub + 契约测试」（stub 不接线、不调用 TQ，只验证 seam 契约可容纳 B 的返回值，保证替换零改动）。

## Risks / Trade-offs

- **spike 判定回退 `file://`** → 页面资产改为就地静态页（跨源请求本地 HTTP 接口需 CORS/Private Network Access 处理）；本 change 的接口面与存储契约不变，只换承载与取数方式（Migration Plan + spec「回退分支」Requirement）；**该分支的写认证未裁决前按「写入不可用」交付，读通道按 D-3 分档（C 层未签字前只交付文档形态 + 「取数不可用」空态，不以「只读页面」暗示取数可用）**。
- **认证在 TDX 内嵌浏览器不成立（A 层不可用）** → 写接口**不可用**：显式禁用 + 提示 + 页面只读降级（D-3，契约 §12.1）；MUST NOT 用 B 层诊断 token 或未认证 loopback 救写入，MUST NOT 放宽认证。
- **OneDrive 并发写** → 进程内互斥 + 写前 stat 校验 + 重试 3 次（50/200/800 ms）+ 显式 `CONCURRENT_WRITE`（D-4，契约 §5）；既有字节不变与「页面/附注并发两条都保留」均有测试断言。
- **同分钟多卡锚点冲突** → 序号后缀规则 + 唯一性断言（spec 场景）。
- **名称缺失/非法字符导致写失败** → change 2 的 `sanitizeNameSegment`（唯一实现 `src/paths/sanitize.ts`）净化 + 净化后为空回落代码段 + 不事后改名（D-12，契约 §6/§11）；本 change MUST NOT 另建净化模块。
- **页面数据陈旧**（B1 标签/原因按日缓存） → 属 0 成本策略的既定取舍；页面标注数据来源与时间（change 2 的字段级 `fetchedAt` 支持这一点）。
- **B1 回溯吞预算 / 数据源报错** → D-8 量化（**≤6 次列表级请求**、单次打开总出站 ≤7、abort、`availability` 四类结论文案）；不使用 `offSession` 旁路；change 2 未定义「时段拒绝」状态，故该分支改由「数据模块返回显式错误（任何错误码）」的**具名可注入 seam** 驱动（`reason: 'sourceError'`，见 D-8 的 R3-Issue 30 段与 Open Questions 7）。
- **联动换标导致错归属**（TDX 自动 hash 变化） → D-11 显式确认保护。
- **范围膨胀**（顺手做 F1.1/F1.2 全量面板） → Non-Goals 明确；B1 只做两项，其余后置。

## Migration Plan

- **默认分支（spike 结论为 http 同端口）**：本 change 直接实现 D-1 的接口面与 D-2 的资产形态。
- **回退分支（spike 结论为 `file://` 就地）**：页面资产改为 `D:/TDX_HOME/webs/company/` 下的静态页（部署资产，非仓库产物），取数改为请求本地 HTTP 接口；接口面/存储契约/降级逻辑完全复用。**跨源策略**：本地 HTTP 接口需处理 CORS（含 Private Network Access 预检）——只放行「来源为 TDX 就地页 + 指定方法/头」，MUST NOT 用 `*` 通配。**写接口只走 A 层（宿主 cookie），该分支下 cookie 为 `SameSite=Strict` 且来源不透明 → A 层不可用即写入接口不可用（显式禁用 + 提示 + 只读降级）**；owner 裁决（C 层签字 / 签名 URL / 跳板代理）前 MUST NOT 放宽认证、MUST NOT 用 B 层诊断 token 或未认证 loopback 承接写入（D-3，契约 §12.1）。**读通道分档**：该分支在 C 层**未签字前不提供未认证读**——只交付文档形态 + 显式「取数不可用」空态，MUST NOT 以「只读页面」暗示取数可用；C 层签字后仅按签字所载显式放宽点提供只读（放宽点记 `docs/roadmap.md §5`）；**写入只认 A 层不受签字影响**。该回退分支落为 spec Requirement（不再只写在 design）。
- **部署资产版本管理（R1-Issue 6）**：回退分支的静态页为**部署资产**，tasks MUST 记录其版本来源（仓库内源文件路径 + 构建/复制命令 + 目标路径 + 版本标识/时间戳），并在页面显示或响应头暴露版本标识，便于排查「TDX 缓存旧资产」。默认分支无需部署步骤（资产在插件 `lib` 内随包发布）。
- **数据**：无迁移。首次落盘由 `data-root-layout` 自动创建 `DB/review/<YYYYMM>/`；既有 vault 内容零改动。
- **发布产物纪律**（契约 §10）：`cordis.patch.yml`（在 `package.json#files` 内）MUST NOT 写入个人机器绝对路径或易失第三方签章现值；实例路径与 `S7 sign/ts` 走本机 profile / 注释示例 / 占位符。

## Open Questions

1. **待裁决 D-TQ**（上文，已台账化于 `docs/roadmap.md §5`）——本 change 最大的未决项，涉及 R2/R5 字面偏离与 17709 边界；默认处置 A，复审触发条件见台账。
2. **B2 是否需要「有卡日期提示」**（`/api/dates`）：本迭代按轻量提示实现；若 owner 认为无需，删接口即可（不影响契约）。
3. **归属确认的交互形态**：`isTradingDay === null` 或来源不可得时，是在 B2 显示待确认日期并由用户点「确认归属」，还是提交时弹确认——本 change 采用「B2 显示 + 提交前确认」的双重提示（默认值可见、可改），实现中若发现多余可在评审时简化。
4. **`DB/review` 的 vault 写分区契约登记**：需求文档 Q2 已裁决目录名；`iteration-1-contracts §10` 已把它列入白名单写路径，但 vault-integration 写分区契约中尚未登记 `DB/review/`——**已转为显式任务（tasks 6.4）并纳入门禁（tasks 6.5）**（不再以「不阻塞实现」搁置）。
5. **交易日历来源**（D-9）：候选为 TQ skill 结论或 change 2 增补；未定期间 `isTradingDay` 恒为 `null` → 用户确认。tasks 3.2b 标 `blocked`。
6. **spike 报告落点**：仓内 `docs/spikes/` 不存在，承载绑定层（路由/认证/资产形态）在 change 1 实测结论落地前不得视作可开工（tasks §2/§7 标 `blocked_by: change 1`）。
7. **数据模块显式错误的降级驱动（R2-Issue 24 → R3-Issue 30，已裁决）**：change 2 的「全市场级」判据 =「批量标的数 > 硬上限（≤20）**或**调用方显式 `fullMarket`」；`/api/enrich` 的 T1 调用是单标的，**不命中该判据**，且 change 2 全文**无 `sessionRejected` 状态/错误码/返回字段**。故本 change **删除** `sessionRejected` 断言与「盘中限制，盘后重试」文案，改述为「数据模块返回**显式错误（任何错误码）**时展示原因」（`availability.reason = 'sourceError'`），由**具名可注入的取数 seam** 驱动（可 stub、可断言 `available=false + reason`），零 mock 纪律下可复现。**跨 change 回写项（tasks 5.6）**：若 change 2 日后定义时段拒绝语义，本 change 只透传其错误码到 `reason: 'sourceError'` 的详情文案，MUST NOT 由本 change 自行发明该状态。
8. **回溯起点语义（R2-Issue 21 的残留选择）**：本 change 取「第 1 次请求 = `resolveTradeDate` 的起点业务日本身」，若 owner 认为应跳过起点（起点必然已在 B2 展示），仅需把循环起点改为「起点业务日的**前一自然日**」——不影响 N=6 上限、总出站 ≤7 与命中即停口径（改一处定值）。
9. **`nameTruncated` 的信号形状（R2-Issue 27 → R3-Issue 34，**跨 change 回写项**）**：该事实产生于 change 2 的 `sanitizeNameSegment`/`resolveArea`，本 change 只经**写入响应** `warnings` 透传；change 2 `data-root-layout` spec 现只写「截断并记 `nameTruncated`」，MUST 补明该标志的返回形状（登记于 tasks 1.7）。**未暴露期间 `warnings` 不含该项**，MUST NOT 由 change 4 自行重算净化规则、MUST NOT 在读路径推断截断事实。
10. **探针路由共存（R2-Issue 28）**：change 1 的 `<basePath>/probe`（`exact`）与 `GET <basePath>/review`（`exact`）不重叠，但宿主 `register` 对重复 `(kind, path)` 抛错；「注册顺序 + 不重叠」已转为 tasks 2.1 的结构断言项，若实现期发现 change 1 已用 `<basePath>` 前缀路由，则按 change 1 D-1 的移交约定处置（先卸载探针或改前缀），不由本 change 单方改动。
11. **回退分支读通道的 C 层放宽点（R3-Issue 31）**：分档已成文（默认分支走 A 层；回退分支未签字前不提供未认证读；签字后仅按显式放宽点只读）。**具体放宽点（来源 / 方法 / 路径白名单）由 owner 签字时给出**，并记入 `docs/roadmap.md §5`；未签字期间该分支交付「文档形态 + 取数不可用空态」，不阻塞默认分支实现。

## 评审处置（Round 1 — 2026-09-27）

来源：`reviews/review-page-review.md`（18 条 issue，Round 1）。逐条处置如下（「已采纳」标明改动位置；「后置」指向 Open Questions 条目；「驳回」给出理由）。

| Issue | 严重度 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- |
| 1 交易日归属自相矛盾、无日历来源 | Critical | **已采纳** | D-9（`TradeDateResult` 结构化 + `isTradingDay: true\|null` + `null` 必走确认）、D-9「交易日历来源」显式依赖 = 后置（Open Questions 5）+ tasks 3.2b `blocked`；spec `review-card-store`「交易日归属」重写 + 新场景（周末/长假第 N 天/盘前/隔日补写/来源不可得/选项 B 形状）；proposal 交易日归属条目 |
| 2 单接口聚合 vs 本地 500 ms 冲突 | Critical | **已采纳** | D-1 删 `GET /review/api/context`，拆 `/api/local` + `/api/enrich`；D-7 重写；spec `review-page` 新增 Requirement「本地段与网络段 MUST 为独立请求」+ 3 场景；tasks 2.1/2.6/4.6 |
| 3 文件名/frontmatter 无净化（`*ST` 必失败） | Critical | **已采纳** | D-12 + 契约 §6；spec `review-card-store` 新增 Requirement「文件名与 frontmatter 值净化」+ 场景；tasks 1.7 + 1.6 净化单测 |
| 4 并发写无锁无重试参数 | Critical | **已采纳** | D-4 第 2/3/5 步（进程内互斥 + 写前 stat 校验 + 重试 3 次 50/200/800 ms + `CONCURRENT_WRITE`）；spec 新增 Requirement「并发写纪律」+「页面/附注并发两条都保留」场景；tasks 1.4/1.8；change 5 复用路径写入契约 |
| 5 联动切换标的丢归属 | High | **已采纳** | D-11（`draftOwnerCode` + 显式确认）；spec `review-page` 新增 Requirement「联动切换标的的未提交内容保护」+ 场景；tasks 4.7 |
| 6 spike 依赖未消解、无 blocked_by、无回退分支需求 | High | **已采纳** | tasks 拆 §1/§3/§5（承载无关层，可先行）与 §2/§4/§7（承载绑定层，`blocked_by: change 1`）；spec 新增 Requirement「回退分支」；Migration Plan 增部署资产版本管理；tasks 7.2 |
| 7 路由/传参不一致 + 市场前缀永久空态 | High | **已采纳**（择「补路由」） | D-1 增 `GET /review/<code>` 路由（保留 spec「兼容 path 段」，并补场景）；D-15 市场前缀归一化（去壳不补全）+ 空态文案（原文 + 期望格式 + TDX 指引）；spec 空态场景重写；tasks 2.3 |
| 8 回溯成本/失败面未量化 | High | **已采纳** | D-8 量化表（≤6 业务日、≤7 出站请求、5 s 超时、abort、`offSession` 裁决=不使用、`businessDate` 序列推进、三类降级文案）；spec 新增 Requirement「B1 有界回溯的量化边界」+ 场景；tasks 5.1–5.4 |
| 9 roadmap/AGENTS 未重排与 `DB/review` 未登记 | High | **已采纳** | tasks 6.4 扩为 roadmap（仅引用 §5）/`architecture.md`（含阶段 2 桥取消结论）/`AGENTS.md`（vault 写入例外 + `DB/review/`）/vault-integration 写分区补登，并入 6.5 门禁；Open Questions 4 改为「已转显式任务」；proposal 引用 `iteration-1-contracts §10` 与 roadmap §5 |
| 10 卡片与 `^ainote-` 分节插入位置冲突 | High | **已采纳**（择「插入到首个 `^ainote-` 之前」） | 契约 §3 + D-4 第 4 步；spec `review-card-store`「可复用写入接口契约」Requirement 明写插入位置；「文档结构与卡片分节」增场景；tasks 1.4/1.6 |
| 11 字节级不变边界不完整（CRLF/BOM/无尾换行/重序列化） | Medium | **已采纳** | 契约 §4 + spec 新增 Requirement「既有内容不变的精确口径」+ 5 场景；tasks 1.6 fixture（CRLF / BOM / 无尾换行）+ 1.9 |
| 12 多命中取最近修改者无 spec 支撑 | Medium | **已采纳** | D-14（mtime 最新，平局文件名典序）+ `storeWarnings[]`；spec `review-card-store` 新增 Requirement「多命中文档的确定性选择」；`review-page` 新增 Requirement「多命中文档的显式告警」；tasks 1.4/1.10 |
| 13 frontmatter 键语义不可核验 | Medium | **已采纳** | spec `review-card-store` 新增 Requirement「frontmatter 最小键 schema」（类型/允许值/未知键原样保留/`patterns` 对齐 F1 词表/`drafts` 显式「未定，保留原样」）；tasks 1.1/1.11 |
| 14 正文可注入 H2/伪锚点 | Medium | **已采纳** | D-6（只认 H2 + 跳过 fenced code block + 归属校验 + 幽灵/重复锚点告警 + 非锚点 H2 归入正文的显式取舍）；D-15 / 契约 §2；spec `review-card-store` 新增 Requirement「解析与幂等规则」+ 4 场景；tasks 1.2/1.6 |
| 15 前端资产形态与打包未定义 | Medium | **已采纳** | D-2「资产形态与打包」二选一 + D-13；spec `review-page` 新增 Requirement「静态资产安全与打包」+ 场景；tasks 2.4/2.5/7.1 |
| 16 spec ↔ tasks 覆盖不齐、门禁证据格式缺失、提交幂等 | Medium | **已采纳** | tasks 新增「Requirement ↔ task ↔ 测试/证据」映射表 + 6.x 证据格式（命令 + 输出片段 + 产物路径）；D-17 `clientRequestId` 服务端去重 + spec 场景；补 3 个缺失 Requirement（静态资产安全 / 写入入参校验 / 回退分支跨源） |
| 17 D-TQ 未台账化、seam 未按 B 约束设计 | Medium | **已采纳** | D-TQ 节增「台账化」段（引用 `docs/roadmap.md §5` D-TQ 行，默认处置 A + 复审触发条件）；seam 契约升级（`source`/`confidence`/可选 `marketSuffix`，含 `NameResult`）；tasks 3.1b「B 选项最小 stub + 契约测试」；宿主事实引用改符号名 + 标注未核验 |
| 18 交互态与输入法边界缺清单 | Low | **已采纳** | D-18（窄视口可断言值、idle/loading/submitting/error/empty 清单、`isComposing` 忽略、预留区 disabled + `tabindex="-1"` + 焦点顺序）；spec `review-page` 新增 Requirement「交互态与输入法」+ 场景；tasks 4.1/4.4/4.8 |

**未采纳 / 保留意见**：无 issue 被整体驳回。两处选择需 owner 知情：

- **Issue 7** 两个选项（删「兼容 path 段」vs 补 `GET /review/<code>` 路由）中本 change 选**补路由**——保留既有 spec 措辞、为 TDX 直链留出口；若 owner 认为 path 段无必要，删路由与对应场景即可，不影响其它契约。
- **Issue 1 / Open Questions 5（交易日历来源）**：本迭代**不引入日历数据源**（`isTradingDay` 恒 `null` → 用户确认）。这是「不做推测」原则下最小可验收形态；若 owner 要求精确判定「非交易日」，需先由 change 2/change 3 增补日历能力，届时仅替换 `TradeDateResolver` 实现。

## 评审处置（Round 2 — 2026-09-27）

来源：`reviews/review-page-review.md`（Round 2，新增 issue 19–28 + Previous Round Tracking 中 3 条「部分解决」）。逐条处置如下；本次修订一律引用 `iteration-1-contracts §n` 或「依赖 change X 的 `<具名接口>`」。

| Issue | 严重度 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- |
| 19 认证 B 层语义未随 change 1 同步 | High | **已采纳** | D-3 整节重写为 A/B/C 三层（A = 宿主 tokenized URL + cookie，**两步**：先 `GET <base>/?token=` 铸 cookie 再导航；B = change 1 的插件自持诊断 token，仅诊断/只读；C = `file://` 就地只读需签字），并写明 **`POST /review/api/card` 与一切写入 MUST NOT 依赖 B/C 层**、A 层不可用即写入不可用（显式禁用 + 提示 + 页面只读降级）；spec `review-page` Requirement「认证与写入通道」重写为「认证分层与写入通道的 A 层依赖」+ 5 场景（未认证拒绝 / 仅带 `?token=` 直连 → 401 / B 层不得放行写入 / **A 层不可用写接口显式不可用** / 写入经插件）；「回退分支」② 重写 + 场景「A 层不可用即写入不可用」；Migration Plan 与 Risks 同步；tasks 2.2（含「A 层不可用时写接口拒绝」用例）/2.5/7.2；proposal 新增「认证分层与写入可用性」条目。**未放宽任何认证面**（契约 §12.1）；回退分支的写认证裁决仍属 owner（change 1 Open Questions 5 + `docs/roadmap.md §5`），裁决前只交付只读页面 |
| 20 `src/review/format.ts` 在被复用侧不存在 | Medium | **已采纳** | 新增 D-19（`src/review/format.ts` 导出 `formatZonedIso(date): string`（`YYYY-MM-DDTHH:mm:ss+08:00`）与 `formatAnchorTime(date): string`（`HHmm`；卡片 `writtenAt`、锚点段与标题同源））；spec `review-card-store` 新增 Requirement「时间格式化单点 `src/review/format.ts`」+ 2 场景；tasks 1.13（产物/验收含「全仓仅一处 `+08:00` 拼装」结构断言）；6.3⑧；proposal Impact 补该模块。design 引用 `contracts §3`，change 5 的「同一导出」断言由此可满足 |
| 21 D-8 回溯算术互斥、无推进算法 | Medium（承接 #8） | **已采纳** | D-8 整表重写：起点 = `resolveTradeDate` 的最近业务日（第 1 次请求即该日）；推进 = **第 k 次响应 `businessDate` 的前一自然日**（经 `src/data/date.ts`，MUST NOT 自行枚举/跳过交易日）；上限 = **≤6 次 T1 列表级请求**（默认 6，命中即停）+ 单次打开总出站 ≤7；达上限文案 =「近 6 次查询内未找到涨停记录」；删去「≤6 业务日 / 禁自然日枚举」互斥表述，缓存键改回 `source + requestedDate`（原写 `source + businessDate`，与 §9 不符）。spec「B1 有界回溯的量化边界」重写 + 6 场景（含「下一请求日由源业务日前推」）；tasks 5.1–5.5；与 change 2 `data-tool-contract`「一次 History 请求 = 一次列表级请求」对齐。起点是否含起点日本身 → Open Questions 8 |
| 22 名称层①无接口归属 | Medium | **已采纳** | D-5 重写为分层表（① 本地历史 frontmatter → `/api/local`；② T2/S8 网络反查 → `/api/enrich`，入参含 `code`，返回 `name` + `nameSource: 'T2-S8'`；③ 仅代码 → `/api/local`），并规定「本地段 `code-only` 时才由网络层补位、层① 不被覆盖」；D-1 表 `/api/local`、`/api/enrich` 行同步；spec `review-page`「名称三级降级」重写为「名称三级兜底的分层归属」+ 4 场景（含「本地段不承担网络反查」结构断言）；tasks 1.5/4.2；proposal 同步（契约 §12.4） |
| 23 `sanitizeNameSegment` 双实现 | Medium | **已采纳** | **删除**本 change 的 `src/review/sanitize.ts`：tasks 1.7 改为「接入 change 2 的 `resolveArea`/`sanitizeNameSegment`（唯一实现 `src/paths/sanitize.ts`），MUST NOT 另建」，产物改为接入代码 + 单测；D-12 增归属硬约束（契约 §6/§11）；spec `review-card-store` 净化 Requirement 重写 + 场景「不另建净化实现」；6.3⑦ 结构断言；proposal Impact 删该模块 |
| 24 「盘中被护栏拒绝」在 change 2 判据下不可达 | Low/Medium | **已采纳（改述）** | spec 场景与 tasks 5.3② 改为「**数据模块返回时段拒绝态（`sessionRejected`）**」的状态驱动降级（可 stub），不再假定「单标的调用被判为全市场级」；D-8 表格与 Risks 同步。判据关系（是否把 T1 列表级请求计为 `fullMarket`）需 change 2 明示 → Open Questions 7（跨 change 待补，不阻塞实现） |
| 25 「frontmatter 原始文本不变」与「补键」互斥 | Low（承接 #11） | **已采纳** | spec `review-card-store`「既有内容不变的精确口径」改为：**既有行文本不变**；仅允许 ① 对既有键改值、② 按固定格式**追加**缺失键；MUST NOT 重排既有行/整体重序列化；原自相矛盾场景改写为「既有三行文本不变 + `tradeDate` 按固定格式追加」，并把「首次创建必填 `tradeDate`」的遗留文档情形写明 |
| 26 `value === null` 的默认值无来源 | Low | **已采纳** | 默认值分路径落地三处：spec `review-card-store`「交易日归属」（`isTradingDay === null` 且有 `value` → 默认 = `value`；`value === null` → 默认留空 + MUST 用户显式填入，可预填 `requestedDate` 但标注「待确认」）；场景拆为「来源不可得（`value === null`）」「有业务日但非交易日」「周末」；D-9、spec `review-page` B2、tasks 3.2 同步 |
| 27 `Card`/`AInote`/`StoreWarning` 与 `nameTruncated` 通道未定义 | Low | **已采纳** | 新增 D-20：`StoreWarning = { kind: 'multiHit'|'ghostAnchor'|'duplicateAnchor'|'nameTruncated'|'docMismatch'; path; detail; candidates? }` + **唯一编码** `` `[<kind>] <path> — <detail>` ``（`warnings` 仍为 `string[]`，与 §3/§12.7 一致）；定义 `Card`/`AInote` 最小类型（change 5 的 `{anchor,writtenAt,body}` 为其子集）；`nameTruncated` 明确以**写入响应 `warnings`** 为载体、读路径不重算。spec `review-card-store`「可复用写入接口契约」按 `§3` 逐字重写（五导出**一律**含 `warnings`）+ 新增 D-21 写前归属硬校验 `DOC_MISMATCH` 与场景；「storeWarnings 的呈现契约」重写 + 3 场景；tasks 1.12/1.14 |
| 28 proposal Impact 不一致 / 探针共存未登记 / Requirement 名错字 | Low | **已采纳** | proposal Impact 与 tasks 产物对齐（补 `src/review/md/frontmatter.ts`、`src/review/md/parse.ts`、`src/review/format.ts`、`src/review/enrich.ts`，删 `src/review/sanitize.ts`）；tasks 2.1 增「与 change 1 `<basePath>/probe`（`exact`）不重叠 / 重复 `(kind,path)` 注册抛错不被触发 / `/review/api/*` 优先级」断言（2.5 同步），Open Questions 10 登记；Requirement 名修正为「页面路由与标的上下文」（spec 标题 + tasks §8 映射行） |
| Round 1 #8 / #11 / #16（Round 2 标「部分解决」） | — | **已闭合** | **#8** → Issue 21 处置：三条互斥 MUST 收敛为单一可判定口径（≤6 次列表级请求 + 由源 `businessDate` 前推一个自然日 + 达上限文案），并补 tasks 5.5 推进算法断言与 tasks 5.3 可达的降级桩；**#11** → Issue 25 处置：口径改为「既有行文本不变 + 仅允许改值/追加缺失键」，场景可判定；**#16** → 新增 tasks 2.7「写入接口入参校验专项断言」（`body`/`name` 上限、`tradeDate`/`code` 形态、缺 `clientRequestId` → 4xx + 零写入）并在 spec 增「入参上限」场景，`Card`/`AInote` 形状由 Issue 27 定义，§8 映射表补 `时间格式化单点` 行并更新相关行 |

**仍后置（均不构成阻断项，已写入 Open Questions 并注明理由）**：

- **Open Questions 7**：数据模块是否把 T1 列表级请求判为 `fullMarket`（跨 change 待补，归 change 2 裁决；本 change 已把分支改为状态驱动，实现不受阻）。
- **Open Questions 8**：回溯起点是否含起点业务日本身（一处定值选择，两种取法都不违反 N=6 / ≤7 / 命中即停）。
- **Open Questions 9**：`nameTruncated` 的信号形状由 change 2 的净化实现暴露（跨 change 待补；未补期间该告警可为空，MUST NOT 由 change 4 自行重算净化规则）。
- **Open Questions 10**：探针路由共存检查已转为 tasks 2.1 断言项；若 change 1 已占用 `<basePath>` 前缀路由，按 change 1 D-1 的移交约定处置（不由本 change 单方改动）。
- 沿 Round 1 保留：**D-TQ**（Open Questions 1，默认处置 A + 复审触发条件）、**交易日历来源**（Open Questions 5，`isTradingDay` 恒 `null` → 用户确认）、**spike 承载绑定层**（Open Questions 6，`docs/spikes/` 不存在 → tasks §2/§7 `blocked_by: change 1`）。

## 评审处置（Round 3 — 2026-09-27）

来源：`reviews/review-page-review.md`（Round 3，新增 issue 29–35：1 High / 2 Medium / 4 Low）。逐条处置如下；Round 1/2 处置表保持原样，本节对 `Open Questions 7`/`9` 的表述**替代** Round 2「仍后置」中的同名条目。

| Issue | 严重度 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- |
| 29 `§12.8` 未同步：`dateUnavailable` / `businessDate === null` 分支不可判定且可能漏检最近交易日 | High | **已采纳** | **spec `review-page`「B1 有界回溯的量化边界」**：① 明确「响应 `businessDate`（非 null）即该次实际评估的交易日」，下一次请求日 MUST 从**响应业务日**前推，MUST NOT 从请求日前推（断言：不得出现「请求日 A、响应业务日 B<A、然后从 A 前推」的路径）；② `businessDate === null` → 记「该日数据不可得」，以**请求日**前一自然日继续推进（计入 N），MUST NOT 抛错/静默停摆；③ `available=false` + `errors` 含 `dateUnavailable` → **不计为「未找到涨停记录」**（§12.8 二分），继续推进；④ N 次**全部**不可得 → 结论文案「近 N 次查询内未取得可用数据（数据不可得）」，正文 MUST NOT 写「未找到涨停记录」；⑤ 新增结构化 `availability: { available, reason?: 'noRecord'\|'dateUnavailable'\|'rateLimited'\|'sourceError' }` + `businessDate?`/`requestedDates`/`unavailableDates` 与**文案分档表**（响应契约）；⑥ **与 change 2 `limit-reason-tool` 的接口对齐项**（`available`/`errors[dateUnavailable]`/`tradeDate` 三条保证）登记为 tasks 5.6 跨 change 回写项。**design D-8** 整表重写（新增「以响应业务日为基准（防漏检）」「`businessDate === null`」「分档判据」三行 + 结果结构 + 对齐段）。**spec 新增 4 场景**（数据不可得按 §12.8 分档并继续推进 / 源回带业务日不得漏检被跨越的交易日 / 响应无日期 / N 次全部数据不可得），并把「达上限未命中」改为 `noRecord` 终态。**tasks 5.1–5.5 同步**（推进含 `businessDate===null` 与回带日期两类桩；5.5 断言加「响应业务日序列不得漏检」），**新增 5.6** 跨 change 对齐登记 |
| 30 `sessionRejected` 无生产者、零 mock 不可复现（Round 2 `#24` 未真正闭合） | Medium | **已采纳（择 (a)：删除该状态断言）** | change 2 `data-tool-contract` 无 `sessionRejected` 状态/错误码/字段，单标的 T1 调用不命中「全市场级」判据（`tasks 5.6` 保留该事实登记）。**删除**：spec `:208` 的「时段拒绝态（`sessionRejected`）」与场景「时段拒绝态降级（盘中限制，盘后重试）」；design D-8 表 `offSession` 行/Risks 中的同名表述；tasks 5.2②、5.3② 与 §8 映射行的同名引用。**改为**「数据模块返回**显式错误（任何错误码）**时展示原因」→ `availability.reason = 'sourceError'`，由**具名可注入的取数 seam** 驱动（可 stub、可断言 `available=false + reason`）；**MUST NOT 由本 change 自行发明该状态**；若 change 2 日后定义时段拒绝语义，只透传其错误码（登记为 tasks 5.6 回写项）。Open Questions 7 重写为「已裁决」 |
| 31 回退分支读通道认证姿态与「全部接口走 A 层」互斥 | Medium | **已采纳** | 删除无条件的「页面与**全部接口** MUST 走 A 层」。**spec「认证分层」**改为分档：默认分支页面与读接口走 A 层；回退分支读接口在 C 层未签字前 MUST NOT 提供未认证读；**写入两分支同 = 只认 A 层**。**spec「回退分支」**新增第 ③ 条（读通道分档：未签字 → 只交付文档形态 + 显式「取数不可用」空态，MUST NOT 以「只读页面」暗示取数可用、MUST NOT 用 B 层兜底读；签字后仅按**显式放宽点**只读，放宽点记 `docs/roadmap.md §5`）+ 2 新场景（C 层未签字取数接口不可用 / 签字后按放宽点只读）。**design D-3** A 层行改分档 + 硬约束第 4 条重写；**Migration Plan** 同步。**tasks 7.2 补读通道断言**；2.2 同步。Open Questions 11 登记放宽点待 owner 给出 |
| 32 契约 §4 仍留「frontmatter 原始文本不变」 | Low | **已采纳** | `docs/design/iteration-1-contracts.md §4` 该句改为「`frontmatter` **既有行文本不变**（仅允许对既有键改值、按固定格式**追加**缺失键，MUST NOT 重排既有行）」——**仅改这一句**（Lead 所有权范围，已在本轮返回中注明）；本 change spec「既有内容不变的精确口径」（`review-card-store`）已同文，并新增一句「本口径与 §4 逐字同义；MUST NOT 再出现『frontmatter 原始文本不变』这一与『补键』互斥的表述」 |
| 33 `storeWarnings[]` 与 `warnings: string[]` 双名并存 | Low | **已采纳（择「统一为 `warnings`」）** | 本 change 全链路（proposal / design / spec ×2 / tasks）统一为 **`warnings: string[]`**，删除 `storeWarnings[]` 别名：spec `review-page`（`/api/local` 返回、首屏场景、多命中 Requirement 与场景）、spec `review-card-store`（解析/幽灵/重复/多命中/五导出场景）、design（D-1 表、D-4 步 1、D-6、D-7、D-14、D-20）、tasks（4.5、§8 映射行）、proposal。Requirement 名改「`warnings` 的呈现契约」，并写明「字段名一律为 `warnings`；MUST NOT 出现 `storeWarnings[]` 别名（change 5 已明文否定该字段名）」。**结构断言同步**：tasks 6.3⑨「全仓源码与资产 MUST NOT 出现 `storeWarnings` 标识符」（扫描前先断言目标非空） |
| 34 `docMismatch` kind 不可达；`nameTruncated` 信号形状依赖 change 2 | Low | **已采纳** | ① `StoreWarningKind` **删除 `'docMismatch'`**（`'multiHit'\|'ghostAnchor'\|'duplicateAnchor'\|'nameTruncated'`）：写前归属不一致是抛错路径（`DOC_MISMATCH`，不返回结果体），无 `warnings` 产生路径——spec 枚举、spec 告警正则与「告警透传到页面」场景、design D-20、tasks 1.14 的枚举与断言全部同步；spec 另加场景「写前归属不一致不走 warnings」。② `nameTruncated` 明确以**写入响应 `warnings`** 为唯一载体（读路径 MUST NOT 重算），把「change 2 须暴露该标志的返回形状」列为**跨 change 回写项**（spec 改条件句 + 新场景「change 2 未暴露 nameTruncated 信号时」；design D-20 与 Open Questions 9 改写；tasks 1.7/1.14 登记） |
| 35 路由 handler / 认证测试 seam 未定义 | Low | **已采纳** | **design D-1** 新增「可注入的 handler 工厂（沿 change 1 D-10 先例）」段：handler 提为纯工厂 `createReviewHandler(deps)`（注入 ① 认证判定、② 资产读取、③ 取数 service），只做「请求对象 → 响应对象」纯映射；单测以**请求桩**（普通对象形状，函数注入）驱动，未认证写 / A 层不可用 / B 层 token / 非法入参 / MIME / 穿越 / 无外链均可零 mock 断言；**注册/卸载**与宿主 `requestRejection` 真实行为标为**集成核对**；`test/**` MUST NOT 出现第三处 `fetch(`（§7 只承认两条具名出站通道），MUST NOT 用本地 HTTP 客户端发真实请求。**tasks 新增 2.8**（`createReviewHandler(deps)` 工厂 + 请求桩用例 + 驱动方式说明），2.5 指向 2.8，§8 映射行同步 |



