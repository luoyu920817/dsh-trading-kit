## ADDED Requirements

### Requirement: 页面路由与标的上下文

页面 SHALL 由宿主同一 HTTP 服务器上的路由提供（`GET <basePath>/review`），承载形态与认证方式 SHALL 依据 change 1（spike）的实测结论。标的编码 SHALL 从 hash（优先）、query（`?code=`）或 path 段（`GET <basePath>/review/<code>`）解析——三种形态 SHALL 均由 D-1 路由表支持；URL/hash 变化 SHALL 无刷新切换上下文；所有取值入参 MUST 先经 `normalizeCode`（去 `sh|sz|bj` 前缀与 `.sh|.sz|.bj` 后缀，大小写不敏感；余下须为 6 位数字；**只去壳、不补全、不猜测**）。编码缺失或非法时 SHALL 显示显式空态，MUST NOT 猜测、补全或沿用上一个标的。

#### Scenario: hash 变化无刷新切换

- **WHEN** 页面已打开且输入框为**空**，URL hash 变为另一个标的代码
- **THEN** 页面不重载、上下文切换到新标的、输入框保持为空

#### Scenario: query 形态兼容

- **WHEN** 以 `?code=600000` 打开页面（无 hash）
- **THEN** 正确解析并加载该标的上下文

#### Scenario: path 段形态兼容

- **WHEN** 以 `GET <basePath>/review/600000` 打开页面（无 hash 与 query）
- **THEN** 正确解析并加载该标的上下文；`/review/api/*` 路由优先匹配，不被该段吞掉

#### Scenario: 缺参或非法代码

- **WHEN** 无任何标的参数，或取值非 6 位数字（如 `60000`、`6000000`、`abc`）
- **THEN** 显示显式空态：**展示原始取值**（如「收到 `60000`」）+ 期望格式（`6 位数字，如 600000`）+ TDX 侧配置指引（检查联动编码/参数模板），不加载任何标的、不猜测代码、MUST NOT 补全位数

#### Scenario: 市场前缀归一化（去壳 ≠ 猜测）

- **WHEN** 取值为 `SH600000` / `600000.SH` / `sh600000` / `600000.sz`
- **THEN** 归一化为 `600000` 并加载该标的；页面/响应可记录原始取值用于排障；除前缀后缀外**不做任何补全或推断**

#### Scenario: 路由随插件生命周期

- **WHEN** 插件卸载或被配置关闭页面
- **THEN** 页面路由不再响应（返回 404），无残留处理器

### Requirement: 本地段与网络段 MUST 为独立请求

首屏本地段与网络段 SHALL 为**独立请求**（或等价的事件流分段），MUST NOT 由单次响应同时承载。本地段 `GET <basePath>/review/api/local?code=&date=` SHALL 为**纯本地**（零出站网络请求：文件系统读取 + change 2 的内存缓存读 + seam 的本地层），SHALL 返回：代码规范化结果与原始取值、名称层①/③（本地历史 frontmatter → 仅代码，含 `nameSource: 'frontmatter-history' | 'code-only'`）、归属交易日与来源、当日卡片列表、有卡日期、`warnings: string[]`；MUST NOT 在其中执行名称的网络反查（`iteration-1-contracts §12.4`）。网络段 `GET <basePath>/review/api/enrich?code=&date=` SHALL 承载名称层②（T2/S8 网络反查，入参含 `code`，返回 `name` + `nameSource: 'T2-S8'`）、B1 的标签（T2）与最近涨停原因（T1 有界回溯）及其降级状态。页面首屏 MUST NOT await 网络段。

#### Scenario: 首屏不依赖网络段

- **WHEN** 网络段请求被挂起（或不可达），页面加载
- **THEN** 本地段照常出屏（代码/名称回退/归属日/当日卡片/`warnings`）；网络段位置显示降级态；输入框与保存可用；页面不出现整体 loading 阻塞

#### Scenario: 本地段冷启动性能

- **WHEN** 冷缓存（无内存缓存）下首次请求 `/api/local`
- **THEN** 在 ≤500 ms 内返回；该路由的依赖链 MUST NOT 触发任何出站网络调用（结构断言，见 `iteration-1-contracts §7`）

#### Scenario: 网络段可中断

- **WHEN** 用户在 `/api/enrich` 未完成时切换标的、切换日期或离开页面
- **THEN** 未完成请求被 abort，其后续回溯不再发出新请求；已返回结果不写入新标的的展示区

### Requirement: 认证分层与写入通道的 A 层依赖

页面 SHALL 注册在宿主同一 HTTP 服务上，并按 change 1（spike）定案的三层认证语义工作（`iteration-1-contracts §12.1`）：

- **A 层（唯一业务通道）** = 宿主 tokenized URL + cookie，**必须两步**：先 `GET <base>/?token=<launchToken>` 铸造宿主 cookie（并 303），**再**导航业务路径。**读通道分档**：**默认分支**（宿主同端口）的页面与读接口 SHALL 走 A 层；**回退分支**（`file://` 就地）的读接口在 C 层**未签字前 MUST NOT 提供未认证读**（页面只交付文档形态 + 显式「取数不可用」空态），C 层签字后才按其**显式放宽点**提供只读（见「回退分支」Requirement）。**写入通道两分支同**：一律只认 A 层。
- **B 层** = change 1 定义的**插件自持诊断 token**，**仅诊断/只读**，MUST NOT 被当作宿主认证的等价物。
- **C 层** = `file://` 就地只读（需 owner 签字），MUST NOT 承载业务写入。

**写接口认证修订（owner 裁决 2026-10-05「写卡免登录，用 IP 白名单或固定 key」）**：写接口 SHALL 接受两类凭据之一——① **A 层 cookie**（原通道，保留兼容）；② **回环来源 + 固定密钥**：宿主 webServer 仅绑 `127.0.0.1`（即 IP 白名单 = 回环），且请求须携带密钥（`x-write-key` 头或 body `writeKey`，值 = `config.review.writeKey`；缺省空串时由插件按进程随机生成并经页面注入自动携带——使用者零手动操作）。密钥经服务端注入页面（页面读者与密钥持有者同为回环访问者，威胁模型一致）。两道检查缺一不可（来源回环 + 密钥匹配）；MUST NOT 在非回棒绑定下放开。
**`POST <basePath>/review/api/card` 与一切落盘路径 MUST NOT 依赖 B/C 层**：写接口只接受 A 层（宿主 cookie）凭据。
**读通道 C 层放宽（owner 签字沿革 2026-10-05）**：owner 签字「全部免签名」——默认分支的页面与**读接口**（GET /review、/api/local、/api/enrich、/api/dates、静态资产）SHALL 免认证只读放行（`allowUnauthenticatedRead = true`）；放宽点 = 仅 GET 只读、仅本插件 /review 路由族、服务端仅绑 127.0.0.1；**写接口的 A 层硬门槛不随本签字放宽**（与 change 1 C 层签字同款边界）。签字时间与范围 SHALL 记入 `docs/roadmap.md §5.0`。**A 层不可用即写接口不可用**——SHALL 显式禁用（返回明确错误码 + 提示「认证不可用，卡片不可写入」）并让页面降级为**只读**（B4 可读、B3 提交禁用并显示原因），MUST NOT 放宽认证、MUST NOT 以 B 层诊断 token 或未认证 loopback 承接写入。页面的取数与写入 MUST 经插件内部实现完成，渲染进程 MUST NOT 直接访问 vault 文件系统、MUST NOT 绕开认证直接写文件。**该要求对默认分支与回退分支同等生效**。

#### Scenario: 未认证请求写入接口

- **WHEN** 未携带 A 层凭据（无有效宿主 cookie）请求写入接口
- **THEN** 请求被拒绝且未发生任何写入

#### Scenario: 仅带诊断 token 直连业务路径

- **WHEN** 以 `GET <basePath>/review?...&token=<诊断/宿主 token>` 的形态直连业务路径（未先经根路径铸造 cookie）
- **THEN** 返回 401（`?token=` 只在根路径被消费，`isAuthenticated` 只读 cookie）；该负向结果 MUST NOT 被解读为「认证不可用」而放宽写接口

#### Scenario: B 层诊断 token 不得放行写入

- **WHEN** 以 B 层（插件自持诊断 token）凭据请求 `POST <basePath>/review/api/card`
- **THEN** 请求被拒绝且无任何写入；写接口 MUST NOT 接受 B/C 层凭据

#### Scenario: A 层不可用时写接口显式不可用

- **WHEN** A 层不可用（cookie 无法铸造或不存活，如回退分支下跨源不携带 `SameSite=Strict` cookie）
- **THEN** 写接口返回显式「不可用」错误与原因（含处置指引），页面进入**只读降级**（B4 可读、B3 提交禁用 + 原因文案）；MUST NOT 发生任何落盘、MUST NOT 改用 B/C 层或未认证方式放行

#### Scenario: 写入经插件而非浏览器

- **WHEN** 用户在页面提交卡片且 A 层可用
- **THEN** 请求到达插件内部实现并落盘，浏览器侧无文件系统 API 参与

### Requirement: 写入接口入参校验与幂等

`POST <basePath>/review/api/card` SHALL 校验入参并拒绝非法请求（显式 4xx + 原因，MUST NOT 静默落盘）：`code` MUST 经 `normalizeCode` 且非空；`body` MUST 为字符串、去空白后非空、长度上限 10000 字符（超限 4xx）；`tradeDate`（可选）MUST 匹配 `^\d{4}-\d{2}-\d{2}$` 且为合法日期；`name`（可选）MUST 为字符串且长度上限 200 字符。请求 SHALL 携带 `clientRequestId`（客户端为一次「提交意图」生成、重试复用同一 id）；缺该字段 SHALL 返回 400。服务端 SHALL 按「**文档 + 该 `clientRequestId`**」去重：命中即返回既有锚点与路径（`status: 'duplicate'`），MUST NOT 追加第二张卡片。

#### Scenario: 缺少 clientRequestId

- **WHEN** 提交请求不含 `clientRequestId`
- **THEN** 返回 400 显式错误，不发生任何写入

#### Scenario: 慢网络重放同一请求

- **WHEN** 同一 `clientRequestId` 的提交因超时被客户端重试（或用户双击越过前端防重窗口）
- **THEN** 服务端返回既有锚点与路径、`status: 'duplicate'`；文档中只存在一张对应卡片

#### Scenario: 非法入参

- **WHEN** `code` 非法、`body` 为空、或 `tradeDate` 形态非法
- **THEN** 返回 4xx 与原因；输入内容在页面保留，可修正后重试

#### Scenario: 入参上限

- **WHEN** `body` 超过 10000 字符，或 `name` 超过 200 字符
- **THEN** 返回 4xx 与原因（说明上限与实际长度）；不发生任何写入（tasks 2.7 专项断言）

### Requirement: 名称三级兜底的分层归属

B1 SHALL 显示标的代码与名称（三层兜底）；**页面不设「复盘卡片」一级标题与「标签」前缀文案**（owner 2026-10-05 指示移除——chips 直接排列）；**页面不展示名称来源标注**（来源保留在 API 响应 `nameSource`；owner 2026-10-05 指示简化显示）；**页面内不提供「在 TDX 中打开标的」跳转链接**（页面本身运行于 TDX 内——owner 2026-10-05 指示移除；spike 决策①的 treeid 通道保留备用），且**层号 = 兜底优先级、每层接口归属唯一**（`iteration-1-contracts §12.4`）：① 该标的历史卡片文档 frontmatter 的 `name`（零网络，归 `/api/local`）；② 数据工具名称反查（best-effort，归 `/api/enrich`，入参含 `code`）：**先 T2/S8 反查（`nameSource: 'T2-S8'`），未命中再行情名称源探针（同花顺 realhead，`nameSource: 'quote-ths'`；owner 指示 2026-10-05「名称必须显示」——S8 反查仅覆盖板块前 N 权重股，非权重股需行情源兜底）**；③ 仅显示代码（归 `/api/local`）。

- `/api/local` MUST NOT 执行网络反查，其名称取值域只有 ① 与 ③，并 SHALL 返回 `nameSource: 'frontmatter-history' | 'code-only'`。
- `/api/enrich` SHALL 返回层②的 `name` 与实际来源 `nameSource: 'T2-S8' | 'quote-ths'`（层②内部两级：T2/S8 反查命中 → `T2-S8`；未命中由行情快照的 `name` 兜底 → `quote-ths`，复用同一次 S9 出站——见 quote-snapshot 能力）；页面在本地段为 `code-only` 时用层②**补位替换**并更新来源标注；本地段已命中层①时 MUST NOT 被网络段覆盖。
- 全部未命中 SHALL 显示代码并明示「名称未获取」，MUST NOT 显示空白或猜测名称。名称结果 SHALL 带来源（`source`）与 `confidence`，以便 D-TQ 裁决为选项 B 时替换 seam 实现而不改调用方。

#### Scenario: 层①命中（本地历史 frontmatter）

- **WHEN** 该标的历史卡片文档存在且 frontmatter 有 `name`
- **THEN** 本地段即返回该名称（零网络）且 `nameSource='frontmatter-history'`；网络段返回后 MUST NOT 覆盖该名称

#### Scenario: 本地只有代码时由网络层补位

- **WHEN** 本地段返回 `nameSource='code-only'`，随后 `/api/enrich` 返回层②名称
- **THEN** B1 用层②名称替换代码显示并标注来源；网络段不可用时保持代码 + 「名称未获取」

#### Scenario: 全部未命中

- **WHEN** 三层均未取得名称
- **THEN** 显示代码 + 明示「名称未获取」，页面其余部分照常可用

#### Scenario: 本地段不承担网络反查

- **WHEN** 审查 `/api/local` 的调用链
- **THEN** 不存在名称网络反查（不 import `src/data/**` 取数实现、零 `fetch`，结构断言见 `iteration-1-contracts §7`）；名称网络反查只出现在 `/api/enrich`

### Requirement: 四区块布局

页面 SHALL 自上而下渲染四个区块：B1 标的头部、B2 日期组件、B3 输入区（含工具框预留按钮区）、B4 当日卡片区；B3 的预留区在 v1 SHALL 仅占位（无业务按钮），MUST NOT 干扰输入主链路。

#### Scenario: 区块齐备且有序

- **WHEN** 页面以任一有效标的打开
- **THEN** 四区块自上而下可见，B3 存在预留按钮区且无实际业务按钮

#### Scenario: 窄视口可用（可断言值）

- **WHEN** 页面在窄视口（如 320 px 宽，TDX 内嵌页宽度）下渲染
- **THEN** 无横向滚动（`documentElement.scrollWidth <= clientWidth`）；输入框与保存动作**可见且可点**（不为 `display:none` / `visibility:hidden` / 被其它元素遮挡）；主链路（输入 → 保存 → 卡片出现在 B4 顶部）全程可用

### Requirement: 交互态与输入法

页面 SHALL 为输入主链路提供可区分的五种状态：`idle`（可输入）、`loading`（本地段加载中，保存禁用）、`submitting`（提交中，保存禁用 + 文案「保存中」）、`error`（显式原因 + 输入保留 + 可重试）、`empty`（无标的或该日无卡片；文案含原始取值/期望格式/TDX 指引）。`Ctrl+Enter` 提交在输入法组合期（`KeyboardEvent.isComposing === true`）MUST 被忽略。B3 的工具框预留按钮区在 v1 SHALL 为 `disabled` 且 `tabindex="-1"`（**不占焦点顺序**）。

#### Scenario: 提交中防重与态可见

- **WHEN** 用户触发保存且请求未返回
- **THEN** 页面进入 `submitting`（保存禁用 + 「保存中」文案），重复触发不产生第二次请求；返回后进入 `idle` 或 `error`

#### Scenario: 输入法组合期不误提交

- **WHEN** 用户在中文输入法组合期按下 `Ctrl+Enter`（`isComposing === true`）
- **THEN** 不触发提交；仅在 `compositionend` 之后的 `Ctrl+Enter` 才提交

#### Scenario: 预留区不占焦点

- **WHEN** 用户以 `Tab` 遍历页面焦点
- **THEN** 焦点顺序为 B2 日期 → B3 输入框 → 保存按钮；预留按钮区被跳过（`disabled` + `tabindex="-1"`）

#### Scenario: 空态文案可排障

- **WHEN** 标的缺失/非法，或该交易日无该标的文档
- **THEN** 显示 `empty` 态：原文取值 + 期望格式/下一步动作 + TDX 侧配置指引（非法标的时）；MUST NOT 显示其它标的或其它日期的卡片

### Requirement: B1 头部数据与独立降级

B1 SHALL 显示该标的的概念标签（T2）、最近一个有涨停记录交易日的原因（T1），以及**行情四格**（owner 2026-10-05 指示自参考页 `同花顺涨跌停原因.html` 迁移：现价（含涨跌幅着色——涨红 `up`、跌蓝 `down`）、流通市值、总市值、流通股本；数据 = S9 行情快照，单位换算「≥1 亿 → 亿、<1 亿 → 万」，股本带「股」）。两项数据 SHALL 经插件 service 出口获取（与 agent 工具同一实现）。任一项不可用 SHALL 独立显示「数据源不可用 + 原因」，MUST NOT 影响其它区块渲染（不整体白屏），MUST NOT 以 `0` 或空值冒充；行情四格不可用时逐格显示占位 `--`（与参考页一致，占位不是冒充——不携带任何数值语义）。

#### Scenario: 数据可用

- **WHEN** T2 与 T1 均返回数据
- **THEN** B1 显示标签与涨停原因，并可分辨各字段来源

#### Scenario: 行情四格渲染

- **WHEN** `/api/enrich` 返回 `quote.available=true`（S9 快照命中）
- **THEN** B1 在代码/名称行下方按参考页样式渲染四格：现价格值着色（涨跌幅 > 0 红、< 0 蓝、无涨跌幅不着色）、流通市值/总市值按「亿/万」换算、流通股本按「亿股/万股」换算；字段缺失的格子显示 `--`

#### Scenario: 行情四格不可用

- **WHEN** S9 快照不可得（护栏受限/源失败/北交所未覆盖）
- **THEN** 四格显示占位 `--`（不显示 0 或空串冒充），标签与涨停原因、输入与 B4 卡片区不受影响

#### Scenario: 单项不可用

- **WHEN** T1 不可用（主备源均失败）
- **THEN** B1 在涨停原因处显示不可用与原因；输入框、B4 卡片区仍正常工作

#### Scenario: 首屏性能

- **WHEN** 切换到某标的
- **THEN** 本地可得信息（代码/名称回退/归属日/当日卡片/`warnings`）在 500 ms 内出屏（不经网络段）；网络字段异步补位且不阻塞输入

### Requirement: B1 有界回溯的量化边界

「最近一个有涨停记录交易日」的解析 SHALL 为**有界回溯**，口径与 `iteration-1-contracts §12.5` 一致、MUST 可判定：

- **起点** = `resolveTradeDate` 得到的最近业务日（第 1 次请求即该日）。
- **推进（唯一算法）**：第 k+1 次请求日 = **第 k 次响应返回的 `businessDate` 的前一自然日**；每次的 `businessDate` MUST 由源返回，MUST NOT 自行枚举或跳过交易日（不假设周末与节假日）、MUST NOT 用请求日顶替响应 `businessDate`。
- **以响应业务日为基准（防漏检）**：响应回带的 `businessDate`（非 null）即该次**实际评估的交易日**，MUST 纳入命中判定与记录；无论它与请求日是否相同，下一次请求日 MUST 从**响应 `businessDate`** 前推，MUST NOT 从请求日前推。断言：实现中不得出现「请求日 A、响应业务日 B（B<A）、然后从 A 前推」的路径——该路径会漏检被跨越的交易日。
- **`businessDate === null`（响应体确无日期）**：该次 MUST NOT 计为「无涨停记录」，而记为「该日数据不可得」，并 SHALL 以**该次请求日的前一自然日**作为下一次请求日继续推进（计入 N 次上限）；MUST NOT 抛未捕获错误、MUST NOT 静默停摆。
- **「数据不可得」与「无记录」MUST 区分**（`iteration-1-contracts §12.8`，对齐 change 2 `limit-reason-tool`）：响应 `available=false` 且 `errors` 含 `dateUnavailable` → 记为「该日数据不可得」，**不计为「未找到涨停记录」**，并按上式继续推进；响应 `available=false` 且**不含** `dateUnavailable` → 记为「该日无该标的涨停记录」。
- **上限**：回溯 SHALL 最多 **N=6 次 T1 列表级请求**（默认 6，可配置且不可超过 6），命中即停；**单次页面打开的最大出站请求数 ≤7**（1 次 T2 标签 + ≤6 次 T1 回溯），同一 `businessDate` MUST NOT 重复请求。
- 单请求超时 5 s；切换标的/日期或离开页面时 SHALL abort 未完成请求且不再续发。
- 本迭代 MUST NOT 使用 `offSession` 旁路 change 2 的护栏（`iteration-1-contracts §9`）；数据模块返回**显式错误**（任何错误码）时 SHALL 按降级处理并展示错误码与原因。

**回溯结果 SHALL 以结构化 `availability` 承载文案分档**（`/api/enrich` 响应的 B1 涨停原因段）：

```ts
availability: {
  available: boolean;
  reason?: 'noRecord' | 'dateUnavailable' | 'rateLimited' | 'sourceError'
}
businessDate?: string        // available=true 时 = 命中的源业务日
requestedDates: string[]     // 本次实际请求过的日期（长度 ≤ N）
unavailableDates: string[]   // 其中经 §12.8 判定为「数据不可得」的日期
```

文案分档 MUST 由 `availability` 驱动（MUST NOT 用 `0`/空值冒充）：

| `availability` | B1 文案 |
| --- | --- |
| `available: true` | 命中日 `businessDate` 的涨停原因与日期（并标注「按源业务日 `<businessDate>`」） |
| `available: false, reason: 'noRecord'` | 「近 N 次查询内未找到涨停记录」（N 取实际配置值） |
| `available: false, reason: 'dateUnavailable'` | 「近 N 次查询内未取得可用数据（数据不可得）」+ 原因 |
| `available: false, reason: 'rateLimited'` | 「近期涨停记录不可得（频控受限）」+ 原因 |
| `available: false, reason: 'sourceError'` | 「近期涨停记录不可得（数据源错误 `<错误码>`）」+ 原因 |

**`reason: 'dateUnavailable'` 的判定条件**：N 次请求**全部**为「数据不可得」（`businessDate === null` 或 `errors` 含 `dateUnavailable`）→ 结论文案 MUST 为「近 N 次查询内未取得可用数据（数据不可得）」，正文与页面 MUST NOT 写「未找到涨停记录」；期间任一次为「该日无记录」则终态为 `noRecord`。

**与 change 2 `limit-reason-tool` 的接口对齐项（跨 change 回写项，tasks 5.6）**：本 change 消费其 `available` / `errors[]`（含 `dateUnavailable`）/ `tradeDate`（= 本 change 的源 `businessDate`）。change 2 spec MUST 保证：① `requestedDate !== rateLimitDate` 或源日期不一致时 `errors` 含 `dateUnavailable`；② `available=false` 且无 `dateUnavailable` = 「该标的无涨停记录」（§12.8 的二分）；③ `dateUnavailable` 时 `tradeDate` 为源业务日或 `null`（本 change 两种取值均按上式处理，不抛错、不误判为无记录）。

（计数口径依据 change 2 的 `data-tool-contract`「缓存幂等与原子写」Requirement：**一次 History 请求 = 一次列表级请求**。）

#### Scenario: 命中即停

- **WHEN** 第 2 次请求即命中涨停记录
- **THEN** 停止回溯，B1 显示该业务日的原因与日期；后续业务日不再请求（断言后续请求数为 0）

#### Scenario: 下一请求日由源业务日前推

- **WHEN** 第 k 次响应返回 `businessDate='2026-09-28'`（周一）且未命中
- **THEN** 第 k+1 次请求日为 `2026-09-27`（其前一自然日），而非跳过周末；请求日折算 MUST 经 `src/data/date.ts`（`iteration-1-contracts §1`/§3），MUST NOT 自行拼接日期串

#### Scenario: 达上限未命中（`noRecord`）

- **WHEN** 连续 6 次列表级请求均**正常返回且该标的无涨停记录**（`available=false` 且不含 `dateUnavailable`）
- **THEN** `availability = { available: false, reason: 'noRecord' }`，B1 显示「近 6 次查询内未找到涨停记录」（N 取实际配置值），不再继续请求；断言列表级请求数为 6、总出站 ≤7

#### Scenario: 数据不可得按 §12.8 分档并继续推进

- **WHEN** 第 k 次请求日恰为非交易自然日（如周日），响应 `available=false`、`errors` 含 `dateUnavailable`，并回带 `businessDate='2026-09-25'`（周五）
- **THEN** 该次**不计为**「未找到涨停记录」（`unavailableDates` 记入请求日，`availability` 不因此判为 `noRecord`）；下一次请求日 = `2026-09-24`（**响应 `businessDate` 的前一自然日**），MUST NOT 从请求日前推

#### Scenario: 源回带业务日不得漏检被跨越的交易日

- **WHEN** 请求日 A 的响应回带 `businessDate = B`（`B < A`）
- **THEN** `B` MUST 被当作一次**实际评估**（纳入命中判定与 `requestedDates`/`unavailableDates` 记录），下一次请求日从 `B` 前推；以 `A='2026-09-27'`（周日）、`B='2026-09-25'`（周五）断言：下一次请求日为 `2026-09-24`，且 `B` 的评估结果（命中/无记录/不可得）被记录——断言实现中不存在「从 A 前推」的路径

#### Scenario: 响应无日期（`businessDate === null`）

- **WHEN** 某次响应回带 `businessDate = null`（响应体确无日期）
- **THEN** 该次记为「该日数据不可得」（记入 `unavailableDates`）；回溯继续，下一次请求日 = 该次**请求日**的前一自然日（计入 N）；MUST NOT 抛未捕获错误、MUST NOT 静默停摆

#### Scenario: N 次查询内全部数据不可得

- **WHEN** N=6 次请求**全部**为「数据不可得」（`businessDate === null` 或 `errors` 含 `dateUnavailable`）
- **THEN** `availability = { available: false, reason: 'dateUnavailable' }`，B1 文案 = 「近 6 次查询内未取得可用数据（数据不可得）」+ 原因；正文与页面 MUST NOT 写「未找到涨停记录」

#### Scenario: 数据模块返回显式错误时展示原因

- **WHEN** 数据模块返回显式错误（任何错误码，含护栏拒绝）
- **THEN** `availability = { available: false, reason: 'sourceError' }`，B1 显示「近期涨停记录不可得（数据源错误 `<错误码>`）」+ 原因；不申请 `offSession`、不放宽护栏

#### Scenario: 预算耗尽

- **WHEN** 频控预算不足或达到最小间隔上限
- **THEN** `availability = { available: false, reason: 'rateLimited' }`，B1 显示「近期涨停记录不可得（频控受限）」+ 原因；输入与 B4 不受影响

#### Scenario: 源业务日与请求日不一致

- **WHEN** 源返回的 `businessDate` ≠ 请求日
- **THEN** 结果以源 `businessDate` 归属与展示，并在 B1 标注「按源业务日 `<businessDate>`」；该次响应 MUST 以其 `businessDate` 纳入命中判定（MUST NOT 因回带日期而漏检）；缓存键仍由 `requestedDate` 构造（`iteration-1-contracts §9`），MUST NOT 用 `businessDate` 当键或以请求日重写归属

### Requirement: B2 日期组件与历史读回

B2 SHALL 默认指向**归属交易日**（由 seam 依 `iteration-1-contracts §1` 的 `resolveTradeDate` 得出），并允许切换到其它日期；切换后 SHALL 加载该标的对应交易日的卡片文档并按时间倒序渲染。日期选择 SHALL 使用页面内**自绘月历组件**（owner 2026-10-05 裁决：弃用原生 `<input type="date">`——其上下微调控件不可用且观感不符；深色主题、月视图、支持年/月跳转与清除），月历仅为日期选择器，MUST NOT 打标或展示有卡日期（不引入 `/api/dates` 依赖）；交易日推断 MUST NOT 来自系统日历（归属证据仍 = 数据源会话集合比对）。归属日展示保持干净（owner 2026-10-05 裁决：不再朗读「待确认/来源」文案——输入框本身已展示日期；仅交易日不可得时保留一行短提示）；保存即视为对预填/自选日期的显式提交（确认勾选框已移除，owner 2026-10-05），MUST NOT 静默按系统日期归属。

#### Scenario: 默认归属交易日

- **WHEN** 页面打开且未指定日期，seam 返回 `isTradingDay === true` 的归属日
- **THEN** B2 预填该归属日（不朗读来源标注），B4 显示该日卡片

#### Scenario: 切换日期

- **WHEN** 用户切换到另一日期
- **THEN** 页面不重载，B4 加载该标的该日文档内容（无该日文档时显示显式空态）；B1 的标签与涨停原因按新日期经 enrich 段重新补位（2026-10-05 修订：涨停原因本就按所选日期取数，切换后 MUST NOT 残留旧日期/清空不补）

#### Scenario: 无该日文档

- **WHEN** 切换到的日期没有该标的文档
- **THEN** B4 显示「该日无卡片」空态，MUST NOT 显示其它日期的卡片

#### Scenario: 归属待确认（无交易日历）

- **WHEN** seam 返回 `isTradingDay === null`（周末/长假第 N 天/盘前/隔日补写）
- **THEN** B2 预填 T0 解析的最近期交易日（`value !== null` 时）；`value === null` 时 B2 留空并显示「交易日不可得」短提示，等待用户经月历显式选择；保存即显式提交该日期（无额外确认步），MUST NOT 以系统日期替代

#### Scenario: 隔日补写

- **WHEN** 用户在次日补写前一日的卡片并确认归属为前一业务日
- **THEN** 卡片落盘到前一业务日文档（文件名日期段与 frontmatter `tradeDate` 一致），当日文档不受影响

### Requirement: 多命中文档的显式告警

当同一 `(code, tradeDate)` 命中多份文档时，`/api/local` SHALL 在 `warnings: string[]` 中返回被选文档与其它候选文档及选择依据；页面 SHALL 在 B4 上方显式展示（如「发现 N 份同日文档，已写入 X，另存在 Y/Z（未改动）」）。MUST NOT 静默任选。（字段名一律为 `warnings`；MUST NOT 出现 `storeWarnings[]` 别名，见 `review-card-store` 的「`warnings` 的呈现契约」。）

#### Scenario: 两名命中

- **WHEN** 当日目录存在 `600000_浦发银行_20260924.md` 与 `600000_浦发B_20260924.md`，且前者 mtime 更新
- **THEN** 选中前者写入；`warnings` 含两条路径与选择依据；页面显示该告警；后者字节不变

### Requirement: B4 卡片头部与显式修订动作（owner 2026-10-05 追授）

B4 卡片头部 SHALL 展示 `writtenAt` 时间与动作按钮；**锚点 id 文本（`^card-…`）MUST NOT 直接展示**（owner 2026-10-05 裁决「原文 cardxxx 不需要显示出来」——锚点仍保留在数据文件与「复制引用」通道中，作为 Obsidian 块引用的数据键）。头部 SHALL 提供**编辑**与**删除**按钮（owner 同日裁决），行为：

- **编辑**：行内进入编辑态（正文进 textarea 预填）→ 保存经 `POST /api/card/update`（锚点不变、仅改正文）→ 成功后静默回读刷新；取消则原样还原。空正文 MUST 拒绝提交（提示走删除通道）。
- **删除**：**两段确认**（首次点击变为「确认删除」态，再次点击才执行 `POST /api/card/delete`；超时自动还原）——删除为破坏性动作 MUST NOT 单击直删。
- **写凭据门控**：两个按钮与「复制引用」同域展示，但仅在写通道可用（writable）时渲染；只读降级（A 层不可用）下 MUST NOT 出现编辑/删除入口。
- 服务端两接口与写卡同款凭据（回环 + `x-write-key`）、同款校验与错误分档（锚点不存在 → 404 `ANCHOR_NOT_FOUND`）。

#### Scenario: 头部布局

- **WHEN** 渲染一张已保存卡片
- **THEN** 头部含 `writtenAt` 时间与「复制引用 / 编辑 / 删除」，MUST NOT 显示 `^card-…` 锚点文本；数据文件中锚点分节不受影响

#### Scenario: 编辑闭环

- **WHEN** 用户点击编辑、修改正文并保存
- **THEN** 文档中该卡锚点与 meta 行不变、正文更新；页面静默回读后展示新正文；Obsidian 块引用不失效

#### Scenario: 删除两段确认

- **WHEN** 用户单击「删除」
- **THEN** 按钮进入「确认删除」态（文档无变化）；再次点击后才移除该分节并静默回读；未确认前任何离开/超时还原按钮态

#### Scenario: 只读降级不出现动作

- **WHEN** 写通道不可用（writable=false）
- **THEN** 卡片头部不渲染编辑/删除按钮（「复制引用」保留）；B4 其余照常

### Requirement: 联动切换标的的未提交内容保护

输入框 SHALL 绑定「来源标的」（首次输入时固化）。hash 变化且输入非空、来源标的与新标的不一致时，页面 MUST NOT 静默把未提交内容归属到新标的：SHALL 显示「未提交内容属于 `<原标的>`（将写入 `<新标的>`）」，并要求一次**显式确认**后方可提交到新标的。未确认时提交 MUST 被拒绝（显式错误），MUST NOT 落盘。

#### Scenario: 联动换标的有未提交输入

- **WHEN** 用户为 600000 输入了未提交内容，TDX 联动把 hash 变为 000001
- **THEN** 页面不重载、输入保留，并显示「未提交内容属于 600000」的确认态；MUST NOT 直接把内容按 000001 落盘

#### Scenario: 确认后提交到新标的

- **WHEN** 用户在确认态下显式确认（一次操作）
- **THEN** 卡片写入 000001 当日文档，确认态清除；写入前无其它标的混写

#### Scenario: 未确认时提交被拦

- **WHEN** 用户未确认直接触发保存
- **THEN** 请求被拒绝并显示显式错误，输入内容保留，文档无变化

### Requirement: 输入与提交

B3 SHALL 提供单输入框与保存动作，并支持 `Ctrl+Enter` 提交（组合期忽略，见「交互态与输入法」）；提交成功后 SHALL 清空输入框、新卡片出现在 B4 顶部；提交进行中 SHALL 防止重复提交（不产生第二张卡片，且前端防重 + 服务端 `clientRequestId` 双重保障）；提交失败 SHALL 保留输入内容并允许重试（重试复用同一 `clientRequestId`）。

#### Scenario: 提交成功

- **WHEN** 输入内容后点击保存（或按 Ctrl+Enter）
- **THEN** 输入框清空，B4 顶部出现新卡片

#### Scenario: 重复提交防护

- **WHEN** 提交尚未完成时再次触发保存
- **THEN** 不产生第二张卡片（前端不重发；若已发出，服务端按 `clientRequestId` 返回既有锚点）

#### Scenario: 提交失败

- **WHEN** 写入失败（权限/占用等）
- **THEN** 页面显示错误与原因，输入内容保留，可重试成功后落盘

#### Scenario: 并发冲突显式可解

- **WHEN** 写入因并发冲突不可解而返回 `CONCURRENT_WRITE`
- **THEN** 页面显示含路径与处置建议的错误，输入保留；重试后可成功，文档不被静默覆盖

### Requirement: 数据面不可用不阻塞输入

数据面（T1/T2/名称反查/交易日来源）不可用 SHALL NOT 阻塞输入与卡片落盘；落盘路径 SHALL 独立于网络数据。（**认证不可用不属本条降级范围**：A 层不可用时写接口显式不可用，见「认证分层与写入通道的 A 层依赖」。）

#### Scenario: 网络完全不可用

- **WHEN** 所有第三方源均不可达
- **THEN** 仍可提交并成功落盘卡片（交易日按 seam 的降级路径处理），B1 显示不可用提示

#### Scenario: 页面资产离线可用

- **WHEN** 页面加载时外网不可达
- **THEN** 页面自身资产（HTML/JS/CSS）正常加载与渲染（无外部依赖）

### Requirement: 静态资产安全与打包

页面静态资产 SHALL 由插件构建产物提供（`kind: 'prefix'` 路由），并满足：① `Content-Type` 按**白名单**映射（`text/html; charset=utf-8` / `text/css` / `text/javascript` / `image/png` / `image/svg+xml` / `application/json`），白名单外 SHALL 返回 404；② 含 `..` 段、绝对路径/盘符、URL 编码穿越（`%2e%2e` / `%2f`）、或非常规文件名的请求 SHALL 返回 404（MUST NOT 返回 403，避免目录探测）；③ 资产内 MUST NOT 出现任何外部 URL 引用（无 CDN/字体/图标外链），保证离线可用。资产形态 SHALL 二选一并在实现首步定案：模板字符串内联进 `lib`，或复制到 `lib/assets` 并把该目录写入 `package.json#files`——构建产物 MUST 随包发布（不得依赖源码目录）。

#### Scenario: 正确 MIME

- **WHEN** 请求 `/review` 与任一白名单资产
- **THEN** 响应头含白名单内的 `Content-Type`（HTML 为 `text/html; charset=utf-8`）；HTML 响应含 `Cache-Control: no-cache`

#### Scenario: 路径穿越被拒

- **WHEN** 请求含 `..`（含 `%2e%2e` 形式）、绝对路径或盘符的资产路径
- **THEN** 返回 404，且不读取资产根之外的任何文件

#### Scenario: 非白名单扩展名

- **WHEN** 请求 `.exe` / `.bat` 等非白名单扩展名
- **THEN** 返回 404

#### Scenario: 无外链

- **WHEN** 扫描构建产物中的 HTML/JS/CSS
- **THEN** 不含 `http://` / `https://` 外部资源引用（测试 MUST 先断言扫描目标非空，见 `iteration-1-contracts §7`）

### Requirement: 回退分支（`file://` 就地 + 跨源策略 + 写入按 A 层可用性裁决）

若 change 1（spike）结论为页面无法在 TDX 内嵌浏览器中以宿主同端口形态打开，则 SHALL 采用回退分支：页面资产改为 TDX 就地静态页（部署资产，非仓库产物），取数改为请求本地 HTTP 接口。回退分支 MUST 满足：① 就地页与本地接口的**跨源策略**显式定义（CORS 只放行「就地页来源 + 指定方法与头」，含 Private Network Access 预检；MUST NOT 用 `*` 通配）；② **写入只走 A 层**（宿主 cookie）——该分支下 cookie 为 `SameSite=Strict` 且来源不透明，A 层不可用即**写入接口显式不可用**（明确错误 + 提示 + 页面只读降级），MUST NOT 因 `file://` 而放宽认证、MUST NOT 以 B 层诊断 token 或未认证 loopback 承接写入（`iteration-1-contracts §12.1`）；**写入通道的 A 层依赖在默认分支与回退分支同等生效**；③ **读通道分档**：默认分支的读接口走 A 层（见「认证分层与写入通道的 A 层依赖」）；**回退分支的读接口在 C 层未签字前 MUST NOT 提供未认证读**——该分支只交付**文档形态（静态资产可加载/可渲染）+ 显式「取数不可用」空态**，MUST NOT 以「只读页面」暗示取数可用、MUST NOT 用 B 层诊断 token 兜底读；C 层签字后，SHALL 仅按签字所载的**显式放宽点**（来源 / 方法 / 路径白名单）提供只读，放宽点与范围 SHALL 记入 `docs/roadmap.md §5`；④ 部署资产 SHALL 有版本标识（构建/复制命令、目标路径、版本号或时间戳），并可从响应头或页面读取，便于排查 TDX 缓存旧资产。

#### Scenario: 回退分支下 A 层不可用即写入不可用

- **WHEN** 回退分支下请求 `POST /api/card`（无有效 A 层 cookie，且就地页跨源不携带 cookie）
- **THEN** 返回显式「认证不可用 → 写入不可用」错误且无任何写入；B3 提交禁用并显示原因；B4 的可得性按**读通道分档**（C 层未签字 → 仅文档形态 + 显式「取数不可用」空态；签字后 → 按放宽点只读）；MUST NOT 用 B/C 层凭据或未认证方式放行读或写

#### Scenario: 回退分支 C 层未签字时取数接口不可用

- **WHEN** 回退分支下、owner 尚未对 C 层签字，就地页请求 `/api/local` / `/api/enrich`（未认证读）
- **THEN** 取数接口返回显式「不可用」错误（含原因与处置指引），MUST NOT 返回卡片/名称/标签等数据（MUST NOT 以未认证 loopback 或 B 层 token 放行读）；页面显示文档形态 + 显式「取数不可用」空态，MUST NOT 暗示数据可用

#### Scenario: 回退分支 C 层签字后按放宽点只读

- **WHEN** owner 已对 C 层签字并载明显式放宽点（来源 / 方法 / 路径白名单）
- **THEN** 仅在放宽点范围内提供只读（如 `GET /api/local`、`GET /api/enrich`），范围外请求被拒；写入接口仍只认 A 层（不受 C 层签字影响）；放宽点记入 `docs/roadmap.md §5`

#### Scenario: 跨源只放行既定来源

- **WHEN** 从就地页发起 `/api/local` 与 `/api/enrich` 请求
- **THEN** CORS 响应只放行该页来源与所需方法与头；其它来源被拒

#### Scenario: 部署资产版本可辨

- **WHEN** 就地部署资产更新
- **THEN** 页面或响应头暴露版本标识，可与仓库源对照（避免 TDX 缓存旧版本无法排障）
