## ADDED Requirements

> 事实源：宿主侧能力以**本机实机核验**为准——DSH profile `web`（bundles = `@deepseek-ai/dsh-base` +
> `@deepseek-ai/dsh-web-app` + `dsh-trader-kit`），版本 `0.1.7-rc.1`；`@deepseek-ai/dsh-client-ui-slots`
> 的 `SlotMap`、`dsh-client-ui-layout` 声明 root 作用域 keyed `main` 槽、`dsh-client-ui-sidebar`
> 声明 `sidebar.panellist` list 槽（`id` + 可选 `order` + `label`；**同一个 id 寻址 `main` 槽的组件**）、
> `dsh-client-ui-conversation` 的客户端服务 `ctx.conversation.send(text)`（"Send a prompt into the
> caller scope's session (queued turn)"）、`dsh-client-modules` 读包清单 `dsh.client` 声明并把浏览器半
> 服务在 `/plugins/<id>/client.js`。跨 change 引用一律指向具名接口（`scanDailyCardTargets` /
> `readRunReport` / `runReportPath` / `resolveArea` / `formatZonedIso`），MUST NOT 以「复用某实现」
> 之类无具名接口的表述代替。

### Requirement: 面板注册与入口

插件 SHALL 以客户端（浏览器半）插件形态注册 DSH 侧边栏入口与内容页：`ctx.slots.register` 于 `sidebar.panellist` 注册一个 list 项（提供 `id`、可选 `order`、`label`），并于 root 作用域 keyed `main` 槽以**同一个 id** 注册内容组件。面板 id SHALL 为 `trader-kit-review`（kebab-case、带插件前缀，避免与其它插件冲突）。两处注册 SHALL 成对存在（只登记 list 项而无 `main` 组件会致宿主选中该面板时抛错）。注册失败（槽缺失 / 宿主版本不含该槽 / 组件抛错）MUST NOT 使宿主白屏或阻断会话：入口缺席即为降级态，且失败原因 SHALL 记入插件日志。

#### Scenario: 入口可见且可打开

- **WHEN** 宿主以本机 profile 挂载本插件并渲染 Web GUI
- **THEN** 侧边栏出现本插件的面板图标与标题；点击后主面板区域渲染本插件内容页，且不改变会话选择与输入焦点

#### Scenario: 槽不可用时不阻塞宿主

- **WHEN** 注册时 `sidebar.panellist` 或 `main` 槽不存在（宿主版本不含该槽）
- **THEN** 插件记录一条可诊断日志并跳过注册，宿主其余界面与会话功能正常（MUST NOT 抛出未捕获异常、MUST NOT 渲染空白主面板）

#### Scenario: 重复注册与热重载

- **WHEN** 客户端插件被热重载或重复激活
- **THEN** 面板入口不重复出现（注册经 `ctx.effect` 管理，随插件卸载释放）

### Requirement: 触发按钮与会话注入

面板 SHALL 提供「整理今日复盘」按钮；点击后 SHALL 经客户端会话服务 `ctx.conversation.send(text)` 向当前会话发送**一条固定模板 prompt**（文本单块，不含附件），由 agent 执行既有 `review-daily-summary` skill。prompt 模板 SHALL 在 skill 内声明为「触发短语」并由面板复用同一文本；prompt MUST NOT 指定系统日期（交易日缺省由 skill 经 T0 `traderKit.data.resolveTradeDate` 解析）。插件 MUST NOT 自行创建 agent / 会话，MUST NOT 调用宿主 agent 创建接口，MUST NOT 绕过 skill 直接写产物。按钮在「已发送、工作流运行中」SHALL 显示禁用态与进行中文案，避免重复触发；重复点击 MUST NOT 产生第二条并发 prompt。

#### Scenario: 一键触发现有工作流

- **WHEN** 用户点击「整理今日复盘」
- **THEN** 当前会话出现一条用户消息（固定模板 prompt，用户可见可审计），agent 随即按 `review-daily-summary` 的既有规范执行（逐标的附注 → 运行摘要 → 盘面 md），面板状态区随运行摘要刷新

#### Scenario: 不指定日期

- **WHEN** 点击按钮时未指定交易日
- **THEN** prompt 不含任何日期字面量；交易日归属完全由 skill 内既有步骤（T0 / 用户指定）决定，MUST NOT 由面板或浏览器侧系统日期推断

#### Scenario: 运行中防重复

- **WHEN** 一次触发已发送、工作流尚未结束（会话内本轮未完成或运行摘要的当日条目标记为进行中）
- **THEN** 按钮为禁用态并显示进行中文案；该状态下点击 MUST NOT 发送第二条 prompt

#### Scenario: 发送失败显式报错

- **WHEN** `ctx.conversation.send` 拒绝（会话不可用 / 传输失败）
- **THEN** 面板显示错误原因与「重试」入口，MUST NOT 静默吞掉失败

### Requirement: 当日状态读接口

插件 SHALL 提供 `GET <basePath>/review/api/day?date=` 读接口（`<basePath>` = `/dsh-trader-kit`；`date` 可选，canonical `YYYY-MM-DD` 与紧凑 `YYYYMMDD` 兼容，换算经 change 2 `src/data/date.ts`）。响应 SHALL 为 JSON：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `tradeDate` | `string \| null` | 该日查询的目标交易日（显式传入或经 T0 解析） |
| `dateSource` | `'requested' \| 'resolved' \| 'unavailable'` | 目标交易日的来源 |
| `targets` | array | 当日有卡标的：`{code, name, path, cardCount, hasAinote}`，来自 `traderKit.review.scanDailyCardTargets(tradeDate)`（`§3`），`warnings` 原样上抛 |
| `runReport` | `object \| null` | 运行摘要（`src/summary/run-report.ts` 的 `readRunReport(runReportPath(dataRoot, tradeDate))`），null = 该日尚未运行；字段沿用其 schema，MUST NOT 精简或改名 |
| `brief` | `object \| null` | 当日盘面 md 状态：`{exists, path, generatedAt} \| null`（无产物时 `exists=false`） |
| `warnings` | `string[]` | 读取过程中的告警出口（沿 `§12.7`） |

该接口 SHALL 为**纯本地读**：MUST NOT 发起新的出站请求；缺省交易日的解析 SHALL 复用 T0 service 出口 `traderKit.data.resolveTradeDate` 及其既有缓存语义（MUST NOT 读系统日期推断交易日）。路径解析 SHALL 经 `resolveArea`（MUST NOT 自行拼接业务区路径）。`dataRoot` 未配置时 SHALL 返回显式错误体（`DATA_ROOT_UNCONFIGURED` + 配置指引），MUST NOT 返回 500。日期非法 SHALL 返回 400 与期望格式说明。读通道认证沿既有 C 层签字范围（2026-10-05 `/review` 路由族 GET 只读放宽点），本 change MUST NOT 新增放宽点、MUST NOT 放开任何写方法。

#### Scenario: 当日有卡有结果

- **WHEN** 请求 `…/review/api/day` 且当日存在 3 个有卡标的、运行摘要与盘面 md 均已产出
- **THEN** 返回 `targets`（3 项，含卡片数与 `hasAinote`）、`runReport`（四态数组）与 `brief.exists=true` + `generatedAt`，`warnings` 为数组

#### Scenario: 尚未运行

- **WHEN** 当日有卡片但从未触发工作流
- **THEN** `targets` 正常返回、`runReport=null`、`brief.exists=false`；面板展示「未运行」态与触发按钮，MUST NOT 报错

#### Scenario: 交易日不可得

- **WHEN** 未显式传 `date` 且 T0 返回归属待确认/交易日不可得
- **THEN** `tradeDate` 为该解析结果（或 null）、`dateSource='unavailable'`，响应附短提示；MUST NOT 以系统日期填充、MUST NOT 静默返回空清单冒充「当日无卡片」

#### Scenario: 数据根未配置

- **WHEN** 插件 `config.dataRoot` 为空
- **THEN** 返回 200 + `error='DATA_ROOT_UNCONFIGURED'` 与配置指引（MUST NOT 500 / MUST NOT 空对象）

### Requirement: 面板渲染与降级

面板 SHALL 渲染：① 目标交易日（含来源档位）；② 当日标的清单（代码 / 名称 / 卡片数 / 是否已有附注 / 四态结果）；③ 运行摘要四态计数（`created` / `skipped` / `failed` / `deferred`，`failed` 与 `deferred` 逐条展示 `reason`）；④ 盘面 md 状态；⑤ 触发按钮。渲染 MUST 与 `/api/day` 的实际返回一一对应（MUST NOT 显示未取到的数据）；`failed` / `deferred` / `warnings` 非空时 SHALL 可见，MUST NOT 只记日志。任一块数据缺失或读取失败 SHALL 独立降级显示（提示 + 原因），MUST NOT 整体白屏。面板渲染的所有外部文本（名称、缺失原因等）SHALL 按纯文本转义（沿 change 4 复盘页纪律）。面板 MUST NOT 展示或写入任何交易指令/建议语义。

#### Scenario: 四态可见

- **WHEN** 运行摘要含 `created` 2 / `skipped` 1 / `failed` 1（`reason='sourceUnavailable'`）/ `deferred` 1
- **THEN** 面板逐项展示计数与逐条原因，且与 `/api/day` 返回一致

#### Scenario: 部分字段缺失

- **WHEN** `/api/day` 返回的 `runReport` 中某条目缺 `reason`
- **THEN** 面板以「原因未记录」显式占位（MUST NOT 用空串伪装正常），其余区块照常渲染

#### Scenario: 空态可操作

- **WHEN** 当日无卡片（`targets=[]`）
- **THEN** 面板显示「当日无卡片」并保留触发按钮；点击后由 skill 按既有规范给出「当日无卡片」结论（MUST NOT 由面板自行下结论）

### Requirement: client 打包与宿主 SDK 纪律

插件包 SHALL 声明浏览器半：`package.json` 的 `exports["./client"]` 指向构建产物（`./lib/client.js`），并以 `dsh.client = { platform: 'web', inject: [...] }` 声明所需宿主客户端包（与运行版本一致）。`inject` 列表 SHALL 仅含实际导入的宿主包。构建产物 SHALL 将 `@deepseek-ai/dsh-client-*`、`@deepseek-ai/dsh-api-*` 与 React 运行时标记为 external（MUST NOT 内联宿主 SDK 副本），且随 `lib` 进 `files` 白名单。client 产物 MUST NOT 含任何 `http(s)://` 外链字面与第三方 CDN 资源；网络请求仅限同源 `/dsh-trader-kit/review/api/*`（面板组件 `src/client/panel/Panel.ts` 是浏览器上下文里的同源调用点，与复盘页资产同款豁免出站标记扫描——第三方 URL 禁令与零外链断言仍适用）。测试 SHALL 断言：产物存在、含面板 marker 串、无外链字面、`dsh.client` 声明字段合法。

#### Scenario: 构建与打包断言

- **WHEN** 执行 `pnpm build` 与结构断言测试
- **THEN** `lib/client.js` 存在且含 marker；`lib/**` 内无 `http(s)://` 外链字面（注释内的规范链接除外，由测试白名单显式列举）；`package.json` 的 `exports["./client"]`、`files`、`dsh.client` 三项齐备

#### Scenario: 宿主 SDK 不内联

- **WHEN** 审查 client 产物
- **THEN** 不含宿主客户端包的完整实现副本（external 生效），产物体积与导入面一致

### Requirement: 面板安全边界

面板 MUST NOT 新增写通道（写卡仍只经既有 `POST <basePath>/review/api/card` 的 A 层 / writeKey 双因子；面板自身只读）。面板 MUST NOT 读取宿主任意文件、MUST NOT 携带或展示 `config.review.writeKey`、MUST NOT 在本机路径之外发起请求。按钮 prompt 文本 SHALL 为固定模板（MUST NOT 拼接用户输入或页面可变内容），避免注入任意指令。

#### Scenario: 只读边界

- **WHEN** 审查面板与 `/api/day` 的实现与网络面
- **THEN** 除 `GET /review/api/day` 外无新增路由；无写方法；无宿主任意文件读取；prompt 为固定字符串常量（测试断言模板不含动态插值）
