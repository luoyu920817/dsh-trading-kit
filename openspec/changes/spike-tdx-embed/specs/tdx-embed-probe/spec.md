## ADDED Requirements

### Requirement: 同端口探针路由

插件 SHALL 在宿主 webServer 上注册同端口探针路由 `{ kind: 'exact', path: '<basePath>/probe' }`（`basePath` 默认 `/dsh-trader-kit`；本 change 以模块常量 `PROBE_PATH` 承载，`src/config.ts` 落地后由 change 2 的 `Config` 接管），返回自包含（不依赖 CDN 或任何外部网络资源）的 HTML 探针页；路由 MUST 随插件卸载而被移除（disposer 纪律）。路由 handler MUST 自行调用宿主认证判定（`ctx.connection.requestRejection`）并在拒绝时自行输出状态码，MUST NOT 依赖宿主 fallback 或宿主自动鉴权。探针页 SHALL 至少自检输出：请求 URL 与三类传参原值、`hashchange` 事件时间线、浏览器 UA 与可用内核特征、当前请求的认证判定结果（由服务端在响应时注入 `window.__PROBE__`，附 `Cache-Control: no-store`）、页面加载时间戳。注入的认证取值 SHALL 为 `window.__PROBE__.auth ∈ { 'cookie', 'diagnostic-token', 'none' }`——**拒绝态不设枚举取值**（handler 首行即写 401/403 并 `res.end()`，页面不渲染；拒绝由状态码与 `no-store` 响应本身作证），MUST NOT 注入 `'rejection'` 之类不可达取值。

#### Scenario: 正常访问探针路由

- **WHEN** 已认证请求 `GET <basePath>/probe`
- **THEN** 返回 HTTP 200 与 `text/html`，页面内可见版本/时间戳自检输出，且页面在断网环境下仍可渲染

#### Scenario: 未认证访问探针路由

- **WHEN** 未携带有效认证凭据请求探针路由
- **THEN** 返回 **401**（无有效 cookie）或 **403**（Host/Origin 栅栏不过），响应状态非 200，且探针页不被渲染；响应 MUST 由插件 handler 产生

#### Scenario: 「未认证拒绝」与「跳转」的区分（负向）

- **WHEN** 仅带 `?token=` 直接请求 `<basePath>/probe`（不带 cookie）
- **THEN** 返回 401（`?token=` 只在根路径被消费，`isAuthenticated` 只读 cookie）；报告 MUST 记录该负向结果，MUST NOT 据此判「TDX 不接受 tokenized URL」

#### Scenario: 访问不存在的路径

- **WHEN** 请求 `<basePath>` 下未注册的路径
- **THEN** 响应不落入探针页（插件层面只断言这一点）；具体状态码由宿主 fallback 决定（实测记录为 404 或宿主 SPA 响应），该断言为**集成核对项**

#### Scenario: 与 change 4 路由不冲突

- **WHEN** 探针路由与 change 4 的 `<basePath>/review*` 路由同时注册
- **THEN** 两者路径不重叠、注册不抛错（宿主 `register` 对重复 `(kind, path)` 抛错）；本 change MUST NOT 占用任何 `prefix` 路由

### Requirement: 认证流程（A 层两步登录 / B 层插件自有 token / C 层签字回退）

探针页的认证验证 MUST 按 A→B→C 顺序进行，且各层的安全边界 MUST 在报告中写明。

- **A 层（首选）MUST 为两步**：① 在 TDX 内嵌浏览器中先打开**根地址** `http://127.0.0.1:<port>/?token=<launchToken>`（此时宿主 `authorizeIndex` 铸造 cookie 并 303 重定向）；② 再导航到 `<basePath>/probe`（依赖 cookie）。MUST NOT 以「直连 `<basePath>/probe?token=…`」作为 A 层验证（该请求必然 401，会得出假结论）。
- **B 层（回退 1）**：每个请求自带 `?token=`，由**插件路由自行校验一个插件自有的诊断 token**（挂载时生成、仅内存、仅日志可见）。B 层 MUST NOT 被描述为宿主认证的等价物；其边界 MUST 明写：token 来源 = 插件生成、有效期 = 进程生命周期、作用域 = 仅本插件诊断路由、URL 明文风险 → **业务写入 MUST NOT 依赖 B 层**。**写接口的认证机制由「可行性结论与退出判据」的必输出项「写接口认证结论」定义**：A 层 cookie 为硬门槛，B/C 层 MUST NOT 承接写入（`iteration-1-contracts §12.1`）。
- **C 层（回退 2）**：未认证 loopback 只读诊断页；**采纳前 MUST 取得 owner 签字**，只授予诊断/只读能力，**业务写入 MUST NOT 走该层**；其开关是**代码常量** `UNAUTHENTICATED_READONLY_DEFAULT`（默认 `false`，签字未取得时 MUST 保持 `false`；MUST NOT 作为配置项引入）；`Origin: null` / `Sec-Fetch-Site: cross-site` 的放行范围 MUST 显式定义并申报，MUST NOT 默认放宽。

#### Scenario: A 层根路径登录

- **WHEN** 在 TDX 内嵌浏览器中打开 `http://127.0.0.1:<port>/?token=<launchToken>`
- **THEN** 观察到 303 重定向与 `Set-Cookie`（cookie 属性含 `HttpOnly` 与 `SameSite=Strict`）；报告记录该事实与时间戳

#### Scenario: 带 cookie 访问探针

- **WHEN** 完成 A 层第一步后导航到 `<basePath>/probe`
- **THEN** 返回 200，且页面注入的 `window.__PROBE__.auth` 为 `'cookie'`；`hashchange` 与传参自检正常

#### Scenario: cookie 不存活时进入 B 层

- **WHEN** A 层第一步成功但后续导航未携带 cookie（或 cookie 无法存活）
- **THEN** 采用 B 层：请求带插件自有 `?token=` 且校验通过才返回 200，且页面注入的 `window.__PROBE__.auth` 为 `'diagnostic-token'`（与 A 层的 `'cookie'` 在证据上可区分）；报告写明 B 层的四项安全边界与「业务写入不依赖 B 层」

#### Scenario: 采纳 C 层

- **WHEN** 只有在 A/B 层均不可用、且 owner 已就 C 层签字（含放宽点范围）并把代码常量 `UNAUTHENTICATED_READONLY_DEFAULT` 置为 `true`
- **THEN** 未认证只读诊断页可访问，报告记录签字时间与放宽点；业务写入通道 MUST NOT 走该层

### Requirement: 传参形态探测

探针页 SHALL 解析并原样展示 path 段、query、hash 三类标的编码承载形态，并按固定优先级解析（hash 优先于 query）；SHALL 在 hash 变化时无刷新更新展示、页面不重载、输入框已有内容不丢失；编码缺失或非法时 SHALL 显示显式空态，MUST NOT 猜测或补全代码。

#### Scenario: hash 变化无刷新切换

- **WHEN** 在已打开的探针页中输入框有未保存内容，URL hash 从 `#600000` 变为 `#000001`
- **THEN** 页面不重载、`hashchange` 计数递增、解析结果更新为 `000001`，且输入框内容原样保留

#### Scenario: 三种形态同时提供

- **WHEN** 同一请求同时带 path 段、`?code=` 与 hash
- **THEN** 页面按优先级取值，并记录实际取值形态（hash / query / path）于自检输出

#### Scenario: 编码形态记录

- **WHEN** hash 取值包含前导零、市场前后缀（如 `SH600000` / `600000.SH`）或非 6 位数字
- **THEN** 页面原样记录原始字符串与解析判定（合法 6 位 / 非法），不做静默修正

#### Scenario: 缺失或非法编码

- **WHEN** 三类传参均缺失，或解析结果非 6 位数字
- **THEN** 页面显示显式空态文案，不显示任何推测标的

#### Scenario: P1 路径判据

- **WHEN** 在 TDX 中把页面指向 `http://127.0.0.1:<port>/?token=…` 并在其后访问 `<basePath>/probe`
- **THEN** 报告按判据记录：通过 = 渲染成功且注入的 `auth === 'cookie'` 且 hash 变化无重载；受限 = 逐条列出（配置入口受限 / cookie 不存活 / hash 传参丢失 / 联动仅部分命中）；失败 = TDX 拒绝该 URL，或渲染成功但认证与传参**均**不成立且无签字回退

#### Scenario: P2 路径判据与跨源取证

- **WHEN** 从 `file://` 跳板页 `location.replace(http + '#<code>')`
- **THEN** 报告记录跳转是否发生、hash 是否保留、以及实测请求头（`Origin` / `Sec-Fetch-Site` / `Sec-Fetch-Mode`）、响应码（403/401/200）、是否携带 `dsh-auth-*` cookie、是否触发 CORS 预检与 Private Network Access 拦截

#### Scenario: P3 路径判据与受限期归因

- **WHEN** 在 `file://` 就地页面向本地 HTTP 接口取数
- **THEN** 报告逐项记录：可达（200，含 CORS/PNA 处理方式）→ 可行；可达但需放宽点/仅部分接口 → 受限（列出放宽范围与签字）；被 `Origin: null` 或 `cross-site` 栅栏挡且不放宽、或 `SameSite=Strict` 致认证不可得且 owner 不接受 C 层 → 不可行

#### Scenario: 回退与降级路径可判定

- **WHEN** A 层 cookie 不存活且 P2/P3 被跨源或认证挡住
- **THEN** 报告写入降级路径（B 层诊断 token / 跳板代理 / 显式 CORS+PNA / 签名 URL / C 层签字回退）的选择与触发条件，MUST NOT 只给「不可行」而不给下一步

### Requirement: 时间盒与收敛规则

spike 实测 MUST 遵守时间盒与尝试上限：单路径（P1/P2/P3）总耗时 ≤ 30 min、单次配置尝试 ≤ 10 min、单路径配置尝试次数 ≤ 3 次、点击联动写法枚举 ≤ 6 种、TDX 侧人工实测总计 ≤ 2 h。任一上限触及时 MUST 立即记录当时证据并把该路径收敛为 FAIL/UNKNOWN，MUST NOT 继续试探；到点 MUST 停止实测并按 spec「可行性结论与退出判据」的「探测不可执行」出口写报告。

#### Scenario: 超限收敛

- **WHEN** 某路径已用满 3 次配置尝试或累计 30 min 仍未取得结论
- **THEN** 该路径记为 FAIL 或 UNKNOWN 并进入下一路径；报告未决项列出未覆盖内容与阻塞原因

#### Scenario: 总时间盒到点

- **WHEN** TDX 侧人工实测累计达到 2 h
- **THEN** 停止实测，报告按「未验证 + 阻塞原因 + 后续动作」输出，change 4 承载绑定层标注为被阻塞

### Requirement: 点击联动协议探测

探针页 SHALL 布点 **≤6 种**点击联动写法（页面侧各一个入口并记录调用返回值），并在报告中记录探测方法、TDX 侧实际响应、可用性结论与证据；结论 SHALL 为三值之一：**可行**（有写法命中且证据可复现）/ **受限**（部分写法命中，逐条列出命中与未命中写法）/ **不可行**（全部已尝试写法均无响应）；无法在页面侧断言的部分 SHALL 标注为「人工核对项」，且该维度的判定为 UNKNOWN 时 MUST NOT 记为「可行」。结论为「不可行」时 SHALL 明确写明，MUST NOT 以空白或含糊表述代替。

#### Scenario: 联动探测执行完成

- **WHEN** 在 TDX 内嵌浏览器中点击探针页的联动测试入口
- **THEN** 报告含该次探测的写法、TDX 侧响应、结论与证据位置

#### Scenario: 联动不可行

- **WHEN** 所有已尝试的点击联动写法均未引起 TDX 侧标的变化
- **THEN** 报告结论为「不可行」，并写明受影响范围（F5 盘中页面依赖该方向）

### Requirement: 诊断页开关（本 change 为模块常量，change 2 后转配置）与构建产物随包发布

探针页在 spike 结束后 SHALL 保留为诊断页，并 SHALL 由开关控制：本 change 为模块常量 `DIAGNOSTICS_DEFAULT`（默认 `true`）；`src/config.ts` 落地后 SHALL 由 change 2 的 `Config` 的 `diagnostics` 子键接管（跨 change 移交项，见 tasks 4.7）。**关闭时插件 MUST NOT 注册探针路由**，插件层面 SHALL 断言「不由插件 handler 响应、无残留 handler」；**该请求的实际状态码由宿主 fallback 决定**（可能是 404、也可能是宿主 SPA 的 200 响应），属**集成核对项**，MUST NOT 在插件层面断言「非 200」或「401/404 之一」。探针页资产 MUST NOT 被注销其它路由。C 层未认证只读开关 SHALL 为**代码常量** `UNAUTHENTICATED_READONLY_DEFAULT = false`（默认关闭；置 `true` 前 MUST 取得 owner 签字，签字未取得时 MUST 保持 `false`），MUST NOT 以配置项形式引入。探针页 HTML MUST 进构建产物并随包发布（`tsdown` 内联字符串或 copy 到 `lib/assets` 并写入 `package.json#files`），MUST NOT 依赖仓库内已构建资产或源码目录以外的手工放置。

#### Scenario: 关闭诊断页

- **WHEN** `DIAGNOSTICS_DEFAULT` 置为 `false`（或 change 2 落地后的等效配置）并重新挂载插件
- **THEN** **不注册探针路由**：插件层面可断言「`<basePath>/probe` 不由插件 handler 响应、无残留 handler」；实际状态码由宿主 fallback 决定并**登记为集成核对项**（MUST NOT 断言「非 200」）；其它路径行为不受影响

#### Scenario: 默认开启且认证姿态不变

- **WHEN** 未显式改动 `DIAGNOSTICS_DEFAULT`
- **THEN** 默认值为 `true`，且探针路由**始终**走 `requestRejection` 判定（默认开启 MUST NOT 意味着未认证可读，除非 C 层已签字）

#### Scenario: C 层开关为代码常量且默认关闭

- **WHEN** 审查 C 层未认证只读能力
- **THEN** 该能力由代码常量 `UNAUTHENTICATED_READONLY_DEFAULT` 控制；**签字沿革：owner 于 2026-09-27 签字采纳 C 层，常量自此置为 `true`——放宽点 = 仅本插件探针路由、仅 GET 只读、仅救 401（403 跨站栅栏不救援）、服务端仅绑 127.0.0.1；业务写入通道 MUST NOT 走该层（`§12.1` 不变）**。签字前该常量 MUST 保持 `false`；「未认证请求返回 401/403」的关闭态行为由用例以注入 `unauthenticatedReadonly=false` 的方式继续覆盖；报告记录签字时间与放宽点范围

#### Scenario: 构建产物与发包白名单

- **WHEN** 执行 `pnpm build` 后从 `lib/`（或 `npm pack` 产物）加载插件并请求 `GET <basePath>/probe`
- **THEN** 返回 200 且 `text/html` 非空（无 ENOENT）；资产形态为「内联 TS 模板字符串」时 `package.json#files` MUST 含 `lib`，为「copy 到 `lib/assets`」时 `package.json#files` MUST 含 `lib/assets` 且 `.gitignore` MUST NOT 忽略该资产

### Requirement: 可行性结论与退出判据（三态 + 部分成功 + 不可执行出口）

spike SHALL 产出报告 `docs/spikes/tdx-embed.md`，含「结论 / 证据 / 决策 / 未决项」四节，结论 SHALL 为判定表：`路径（P1/P2/P3）× 维度（渲染/传参/认证/跨源）× 状态（PASS/FAIL/UNKNOWN）+ 证据`。三态口径 SHALL 为：**已验证**（有响应码/请求头/`window.__PROBE__`/自检文本等可复现证据，且至少执行 2 次结果一致）/ **人工核对确认**（记录确认人、时间与确认项）/ **未验证**（写明阻塞原因与后续动作，MUST NOT 记为「不可行」）。每条路径 SHALL 给「可行 / 受限（逐项列出受限点）/ 不可行」之一，且「受限」MUST 由可判定的布尔式触发条件定义（例：`渲染 PASS ∧ 认证 PASS ∧ 传参 FAIL`）；有任一维度为 UNKNOWN 时 MUST NOT 判为「可行」。

**决策映射 SHALL 覆盖第三态（`受限` 的终局映射）**：`可行` → 决策「采用 http 同端口页面」并列出 change 4 可依赖的形态；**`受限` 且满足 `渲染 PASS ∧ 认证 PASS` → 决策仍为「采用 http 同端口页面」**，并在结论节逐条列出受限点与对 change 4 的相应降级要求；**仅当**全部路径均判「不可行」，**或**受限点命中 change 4 的 P1（现场即时）判据（现场、即时、零切换；符号名见 `review-page` proposal 的「P1/P3 现场优先、零切换」与 design 的「切换标的不重载页面、不丢未保存输入（P1/P3）」）时，SHALL 回退 `file://` 就地实现；`不可行` → 回退 `file://` 就地实现并写明资产组织与认证影响。**当三条路径全部停在「受限」时**，报告 MUST 按上述映射收尾（满足布尔式 → 「采用 http 同端口页面」+ 受限点清单；不满足 → 回退），MUST NOT 留空或以「待定」代替。

报告 MUST 含**必输出项「写接口认证结论」（独立于诊断页）**，取值与判据 SHALL 为：**可行** = A 层 cookie 在 TDX 内嵌浏览器中存活（≥2 次一致证据）→ change 4 写接口认证机制 = 宿主 cookie；**不可行** = cookie 不存活 → 写接口认证机制不存在，报告 MUST 显式标注「**change 4 的写能力被阻塞**」并给出页面只读降级，MUST NOT 用 B/C 层承接写入（`iteration-1-contracts §12.1`）；**受限** = 仅 owner 签字的一次性短时效签名 token（作用域 = 单次写入请求、绑定 `POST /review/api/card` 的路径与用途、分钟级、不持久化），未签字时 MUST 记为「未裁决」且 MUST NOT 进结论。该结论 MUST 与认证分层判定互相印证（B 层命中 MUST NOT 被推导为写接口可用）。

报告 MUST 记录复现前提：TDX 版本、内嵌内核版本、DSH 版本、`@deepseek-ai/dsh-host-webserver` 与 `dsh-client-connection` 实测版本、宿主源码检出路径与关键符号。**当探测无法执行时**，决策 MUST 写「未验证 + 阻塞原因 + 后续动作」，并显式标注 change 4 的承载绑定层被阻塞。MUST NOT 留空、以「待定」收尾，或在无证据时编造二选一结论。报告引用仓外需求文档（§11、P1/P3 现场原则、F5 盘中页面）时 MUST 附原文摘录与出处（文件 + 版本/日期）并标注「仓外文档，未能核验」；**当仓外文档在仓内无副本时**，报告 MUST 以「**未能核验 + 缺失项清单**」收尾（缺失项逐条列出文档名 + 需要章节 + 缺它对哪条结论不可复核），MUST NOT 以空白或「影响范围待定」代替。

#### Scenario: 三条承载路径实测完成

- **WHEN** P1 / P2 / P3 三条路径均已实测
- **THEN** 报告含路径 × 维度 × 状态矩阵，每条路径标注可行性（可行/受限/不可行）、受限点与所需 TDX 版本条件

#### Scenario: 部分成功（受限）

- **WHEN** 某路径的渲染与认证为 PASS 而传参或联动为 FAIL（或联动写法仅部分命中）
- **THEN** 该路径记为「受限」，逐项列出受限点与命中的写法清单，并按 D-7 的**第三态映射**给出终局决策（满足 `渲染 PASS ∧ 认证 PASS` → 仍「采用 http 同端口页面」并列出对 change 4 的降级要求；不满足或命中现场即时判据 → 落入下一候选路径）；MUST NOT 用「基本可用」等不可判定措辞

#### Scenario: P1 受限但渲染与认证 PASS

- **WHEN** P1 的渲染与认证为 PASS 而传参或联动为 FAIL / 仅部分命中（即「受限」），且受限点不命中 change 4 的 P1（现场即时）判据
- **THEN** 决策**仍为**「采用 http 同端口页面」，结论节逐条列出受限点与对 change 4 的相应降级要求（例：改走 `?code=` / path 段传参；联动方向标注需人工操作）；MUST NOT 仅因「受限」就直接回退 `file://`

#### Scenario: 三条路径均受限的收尾

- **WHEN** P1/P2/P3 三条路径全部记为「受限」（无一条「可行」，也无一条「不可行」）
- **THEN** 报告 MUST 按第三态映射收尾：在满足 `渲染 PASS ∧ 认证 PASS` 的路径上决策「采用 http 同端口页面」并列出受限点与 change 4 的降级要求；不满足该布尔式时 MUST 决策为「回退 `file://` 就地实现」；MUST NOT 留空或以「待定」收尾

#### Scenario: 写接口认证结论（必输出项）

- **WHEN** 报告结论节成稿
- **THEN** 含独立一条「写接口认证」结论且取值与判据明确：可行（A 层 cookie 存活 → 认证机制 = 宿主 cookie）/ 不可行（cookie 不存活 → 显式标注 change 4 写能力被阻塞 + 页面只读降级）/ 受限（仅 owner 签字的一次性短时效签名 token；未签字记为「未裁决」）；B 层命中 MUST NOT 被推导为写接口可用

#### Scenario: P1 可行

- **WHEN** TDX 可直接打开 http 同端口 URL、完成两步登录且传参成立
- **THEN** 决策为「采用 http 同端口页面」，并列出 change 4 可依赖的具体形态（路由、传参、认证方式）

#### Scenario: P1 与 P2 均不可行

- **WHEN** TDX 无法打开 http URL，跳板页亦不可行（含被 `Origin: null` / `cross-site` 栅栏或 `SameSite=Strict` 挡住且不接受 C 层签字）
- **THEN** 决策为「回退 `file://` 就地实现」，并写明该分支下 change 4 的资产组织变化（静态页就地 + 本地 HTTP 取数）、跨源处理方式与认证影响

#### Scenario: 探测不可执行

- **WHEN** TDX 配置入口不可达，或 owner 不在场，或时间盒耗尽仍无证据
- **THEN** 报告决策节写「未验证 + 阻塞原因 + 后续动作」，显式标注 change 4 承载绑定层被阻塞；MUST NOT 编造二选一结论

#### Scenario: 仓外依据未能核验时收尾

- **WHEN** 报告引用仓外需求文档（§11、P1/P3 现场原则、F5 盘中页面）而该文档在仓内无副本
- **THEN** 报告含原文摘录与出处（文件 + 版本/日期）并标注「仓外文档，未能核验」，且以「**未能核验 + 缺失项清单**」收尾——缺失项逐条列出「文档名 + 需要章节 + 缺它对哪条结论不可复核」；MUST NOT 以空白、含糊或「影响范围待定」代替

### Requirement: 探测不触碰业务数据与证据脱敏

探针路由与探针页 SHALL NOT 写入数据根、卡片目录、vault 或任何业务产物；SHALL NOT 调用行情/交易类接口（含 `order_stock` / `cancel_order` 及其它读取类之外的调用）；spike 期间产生的证据材料 SHALL 落在 `docs/spikes/` 或临时目录。入库的截图等二进制证据 MUST 先裁剪或遮盖账户、资金、持仓、自选股等个人金融信息；无法脱敏者 SHALL 只记录本地路径、不入库。默认只入库文本证据（UA、请求头、返回码、时间戳、自检文本）。

#### Scenario: 探针运行后业务区无变更

- **WHEN** 完整执行一次 spike（含 TDX 侧人工核对）
- **THEN** 数据根下新增/修改文件为 0，仓库内变更仅为 `docs/spikes/`、探针代码与 change 文档

#### Scenario: 无交易接口调用路径

- **WHEN** 审查探针代码与路由
- **THEN** 源码与依赖中不存在 `order_stock` / `cancel_order` / 交易账户类调用

#### Scenario: 截图脱敏检查

- **WHEN** 归档 TDX 侧截图
- **THEN** 每张入库截图通过脱敏检查（账户/资金/持仓/自选股不可见）并在报告标注「已脱敏」；未通过者只记本地路径
