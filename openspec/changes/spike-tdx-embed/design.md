## Context

本 change 是迭代一的**可行性闸门**：先证明「TDX 内嵌浏览器能打开 DSH 同端口 http 路由页，且传参/联动/认证三件事成立」，再决定复盘页面的承载形态。事实分两节（沿 `docs/design/iteration-1-contracts.md §8`：引用宿主源码一律用**符号名**，行号易失效；不可达路径改记「已核验（本机检出路径，版本等价性未核验）」）。

### 已核验（本机 DSH 源码检出 `E:\work\code\open\deepseek-harness`；与已安装版的**版本等价性未核验**，行为级结论另有 `cordis_inspect` 实时 Service 契约双重锚点）

- **宿主侧已具备同端口能力**：`ctx.webServer.register({kind, path, handler})`（符号名 `webserver/src/index.ts:register`，**已核验**）注册在同一 `node:http` 服务器上，无文件服务、由插件自行输出字节；SSE/静态资源均为插件自持。`WebRoute.kind` 只有 `'exact' | 'prefix'` 两值，且 `register` 对重复 `(kind, path)` **抛错**（同符号，已核验）——路由命名空间因此是**排他资源**，跨 change 必须显式分工（见 D-1）。
- **端口与 base URL 可编程取得**：`webServer.port` / `webServer.host` 为公共 getter（符号名 `webserver/src/index.ts:port`/`:host`，已核验），`include:webserver` 配置的 `port` 允许 `0`（由 OS 分配），故复现时端口可能漂移——URL 必须由插件打印而非人工猜（见 D-1）。
- **认证面（关键修正，评审 Issue 1/2）**：`ctx.connection` 的公共面为 `rpc` / `fetch` / `operator` / `createSharedFetchHandler` / `requestRejection` / `admit` / `authorizeIndex` / `authenticatedUrl`（符号名 `connection/src/rpc.ts:ConnectionService`，已核验）——**没有任何 token 校验或 token 读取原语**。逐条语义：
  - cookie **只在根路径铸造**：`authorizeIndex` 要求「`GET` + `pathname === '/'` + 恰一个 `?token=`」，否则落 `writeUnauthorized` 返回 401（符号名 `connection/src/browser-auth.ts:authorizeIndex`，已核验）；铸造成功时 303 重定向到 `./`。
  - `isAuthenticated` **只读 cookie 头**，从不读 `?token=`（符号名 `browser-auth.ts:isAuthenticated`，已核验）；cookie 名绑定 authority，属性为 `HttpOnly; SameSite=Strict`（符号名 `browser-auth.ts` 的 cookie 属性常量，已核验——名字不逐字引用以免误指；`HttpOnly` 意味着页面 JS 读不到认证态）。
  - `requestRejection` = Host/Origin 栅栏 + cookie 校验，返回 `401 | 403 | undefined`，**无跳转**（符号名 `connection/src/rpc-host.ts:requestRejection`，已核验）；**插件路由不会被宿主自动鉴权**，必须自行调用（同构先例：`host/open-in-app/src/index.ts` 自调 `requestRejection` 后写 401/403；`DSH-better-sidebar` 甚至自建 fence——先例检出，版本等价性未核验）。
  - `launchToken` 是 `BrowserAuth` 私有字段，只在 `authenticatedUrl()` 内部拼进 URL（符号名 `browser-auth.ts:authenticatedUrl`，已核验）——这直接决定 B 层没有「校验宿主 token」的实现路径（见 D-3）。
- **未注册路径由宿主 fallback 处理**：fallback 先尝试从 dist 读该路径，读不到才 404（符号名 `host/frontend-static/src/index.ts:handler`，已核验）——即**非命名路由的 404 由宿主产生，插件层面无法断言**（见 D-1）。
- **TDX 侧现网基线**：被替换页面 `D:/TDX_HOME/webs/company/同花顺涨跌停原因.html`（**已核验：文件存在且内容与描述一致**）是 `file://` 本地页，以 `window.location.hash` 取 6 位代码并监听 `hashchange`；页面内纯前端 fetch 第三方接口（无本地数据层、无写入能力）。该机制证明「TDX → 页面」方向的 URL 传参存在，但**只证明 `file://` + hash，不证明 http URL**。
- **已证下限（内核能力，评审 Issue 13）**：同一台机器的上述基线页使用 `await fetch`、模板字符串、箭头函数、`Promise.all`——即该内嵌内核**至少**支持 ES2017 + Fetch + Promise。这是手边最便宜的下限证据，D-2 的语法约束据此锚定，而不是写成「内核版本未知」的空假设。
- **约束**：需求文档 §11 首位风险即本项（**仓外文档，未能核验**）；spike 结论未出前，change 4 不得假定页面形态。另一方面，「阶段防呆」（`docs/roadmap.md §2`）要求本 change MUST NOT 无界膨胀——收敛规则与时间盒见 D-9。

### 待验证（列为 spike 任务 + 降级策略，MUST NOT 写成「已核实」）

- TDX 自定义版面能否配置 http（含非 80 端口 loopback）URL；配置入口在哪一处。
- 内嵌浏览器是否接受「根路径 token 换 cookie + 303」两步登录（A 层），cookie 是否在后续导航中存活。
- `hashchange` 在 http 页面上是否同样无刷新；点击联动（页面 → TDX）协议是否存在及其写法。
- P2/P3 的 `file://` 场景下，跨源请求的实际请求头（`Origin` / `Sec-Fetch-Site`）、是否携带宿主 cookie、是否触发 CORS 预检与 Private Network Access 拦截（D-3 / D-4；已知障碍：`trust-fence.ts` 先例拒 `Origin: null` 与 `cross-site`，cookie 为 `SameSite=Strict`）。

## Goals / Non-Goals

**Goals:**

- 用最小代价（一个探针路由 + 一个离线单文件页）回答上述未验证项，并留下可复现的证据。
- 产出**可判定的承载结论**：每条路径按四维度（渲染 / 传参 / 认证 / 跨源）给「可行 / 受限（逐项列出受限点）/ 不可行」，并在「采用 http 同端口页面」与「回退 `file://` 就地实现」之间给出明确选择 + 触发条件；无法执行时给「未验证」出口（D-7、D-9）。
- 把「不能自动断言」的部分显式留成人工核对项，避免用推测当结论；结论三态 = **已验证 / 人工核对确认 / 未验证**。

**Non-Goals:**

- 不实现复盘页面本体（R1–R8、B1–B4 归 change 4）；探针页不含任何业务 UI 与数据展示。
- 不实现数据面（T1–T2 归 change 2）、不实现 skill 安装器（归 change 3）。
- 不做点击联动之外的 TDX 交互（例如 K 线标注）。**选股语句方言探测不在本 change**：`docs/roadmap.md §4` 拍板 E4 要求「选股公式方言并入清单」，与本 Non-Goal 并存互斥——裁定见 Open Questions 第 4 条（归阶段 6 前独立 spike），本 change MUST NOT 视为已闭环 E4。
- 不写 vault/数据根，不调用行情或交易接口。

## Decisions

### D-1 探针独立成路由（`kind: 'exact'`）、路由命名空间分工与配置面

**路由形态（评审 Issue 8/9 定案）**：注册**命名路由** `{ kind: 'exact', path: '<basePath>/probe' }`，`basePath` 默认 `/dsh-trader-kit`（与 change 4 路由前缀一致，但此刻只注册探针）。理由：spike 必须能在 change 4 未实现时独立跑；探针页在 spike 后保留为诊断页（本 change 由模块常量 `DIAGNOSTICS_DEFAULT` 开关，change 2 落地 `Config` 后转其 `diagnostics` 子键），后续排障复用。备选：写死一个临时端口独立起服务——否决，因为要验证的正是「同端口、同认证、同插件生命周期」这一形态本身。

`exact` 的后果与必须自担的响应（这是本 change 对 spec 的硬约束）：

| 情形 | 谁产生响应 | 状态码 |
| --- | --- | --- |
| 命中 `<basePath>/probe` 且认证通过 | 插件 handler | 200 `text/html` |
| 命中但无有效 cookie | **插件 handler**（首行调 `requestRejection`） | 401 |
| 命中但 Host/Origin 栅栏不过 | **插件 handler**（同上） | 403 |
| `<basePath>` 下未注册路径（如 `<basePath>/xyz`） | 宿主 fallback（读 dist 失败才 404） | 实测记录为 404 或宿主 SPA 响应 |
| 认证失败后到达 `GET /` 之外的路径 | 宿主 `authorizeIndex`/`writeUnauthorized`（非插件） | 401 |

**MUST**：探针 handler 首行 `const rejection = ctx.connection.requestRejection(req); if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }`（`requestRejection` 接受 `{ headers }` 结构体，直接传 `req` 即可；宿主不代插件鉴权）。**MUST NOT** 依赖宿主 fallback 产出 404 作为验收断言——非命名路由的 404 不由插件产生，spec 只断言「不落入探针页」，具体形态降级为手工/集成核对。

**路由命名空间分工（给 change 4 的显式接口承诺）**：`<basePath>` 前缀命名空间在 change 4 前**不被任何 `prefix` 路由占用**；本 change 占用 `<basePath>/probe`（`exact`）。change 4 的 `/review*` 路径 MUST NOT 与本路由冲突（`register` 对重复 `(kind, path)` 抛错）；若 change 4 将来要注册 `<basePath>` 的 `prefix` 路由，MUST 在本 change 卸载探针或改用其它前缀后实施（跨 change 耦合点，此处登记）。

**配置面（本 change 不引入 `Config`；评审 Issue 10 + Round 2 R2-2 定案）**：沿 `iteration-1-contracts §11`，`src/config.ts`（`export const Config`）的**唯一 owner 是 change 2**，**change 1 MUST NOT 引入 `export const Config`，也 MUST NOT 扩写或保留 `TraderKitConfig`**（各 change MUST NOT 在 `Config` 之外另留配置类型）。因此本 change 的 `basePath` 与诊断页开关先用**模块常量**（落 `src/routes/probe.ts` 并导出，便于单测与 spec 逐字断言）：

```ts
export const PROBE_PATH = '/dsh-trader-kit/probe'      // 默认 basePath 内联于此；'/' 开头 / 不以 '/' 结尾的校验由 change 2 的 Config 承担
export const DIAGNOSTICS_DEFAULT = true                // 诊断页开关默认值（spike 后常驻为诊断页）
export const UNAUTHENTICATED_READONLY_DEFAULT = false  // C 层未认证只读开关：代码常量，默认 false，开启需 owner 签字（见 D-3）
```

本 change **不带配置面**：不改 `cordis.patch.yml`（不新增 `config` 段示例）、不新增配置类型。**回写项（change 2 落地 `src/config.ts` 后由其接管）**：`Config` 的 basePath 字段接管 `PROBE_PATH`，`diagnostics` 子键接管 `DIAGNOSTICS_DEFAULT` 与 C 层开关；`diagnostics` 下「诊断页开关」与「`probe.*` / `tdx17709.*`」的命名 MUST 互相区分。四项显式移交（Config 落点与 `TraderKitConfig` 去留、`diagnostics` 子键命名区分、change 3 的依赖对象、`data-foundation/proposal.md` 措辞）见 tasks 4.7，且 MUST 逐条可核对。

**URL 打印（评审 Issue 11）**：挂载时经 `ctx.logger`/`console` 输出三行（端口来自 `ctx.webServer.port`，可能为 `0`/随机，故 MUST 由插件打印而非人工猜）：base URL = `http://127.0.0.1:${ctx.webServer.port}`、登录 URL = `ctx.connection.authenticatedUrl(base + '/')`、探针 URL = `base + '<basePath>/probe'`；数值以本次实际打印为准，写入人工核对清单首项。

**定位**：本 change 的路由与认证代码按**临时/诊断资产**对待（它吃掉了阶段 2 的撞墙内容）；阶段 2 不再作为独立阶段（`docs/roadmap.md §5`），正式桥按其自身 design 重做，探针路由不承担业务职责。

### D-2 探针页用原生单文件 HTML（无框架、无构建、无外链）+ 请求时注入

探针页必须能在内嵌浏览器里渲染，因此：不引 React/打包产物，**语法上限 = 现网基线页已证级别（ES2017 + Fetch + Promise，见 Context「已证下限」）**，不使用基线页未证的特性（ES module / 可选链 / 顶层 await）；所有资源内联（无 CDN、无外部字体/样式）。理由：spike 若因语法不兼容而失败，会误判为「http 承载不可行」——必须把「内核能力」与「承载形态」两个变量分开暴露，探针页本身把内核能力作为一项自检输出（UA + 特性探测结果）而不是失败原因。

**静态骨架 + 请求时注入（评审 Issue 12）**：页面**无法**自证服务端认证判定（cookie 为 `HttpOnly`，JS 读不到）。因此实现为「静态骨架 + 服务端在响应时注入一处状态」，而不是「纯静态文件」：

- 路由按请求把 `window.__PROBE__ = { auth: 'cookie'|'diagnostic-token'|'none', status: <number>, port: <number>, basePath: '<string>', injectedAt: '<ISO>' }` 注入 HTML（模板占位符替换；注入值 MUST 经 JSON 序列化 + `<`/`&`/U+2028/U+2029 转义，防注入）。**拒绝态不作为枚举取值**：拒绝分支在 handler 首行即以 401/403 `res.end()` 结束，页面根本不会渲染，故不设 `'rejection'` 之类的不可达取值——拒绝由状态码与 `no-store` 响应本身作证（评审 R2-8）；
- 响应头 MUST 带 `Cache-Control: no-store`（否则缓存会把 A 请求的判定结果发给 B）；
- 页面展示该状态并标注「由服务端注入，非页面自证」。

**构建与发包（评审 Issue 7，定案 = 内联）**：`src/client/probe/index.html.ts` 导出 `PROBE_HTML` 模板字符串常量，落在既有 entry（`src/index.ts`）的模块图内，`pnpm build` 必然 emit 进 `lib/**`；`package.json#files` 已含 `lib`（MUST 加断言防误删），且 MUST NOT 依赖仓库内已构建资产（`.gitignore` 忽略 `lib/`）。若改判为 copy 到 `lib/assets`，MUST 同步 `package.json#files` 与 `.gitignore`。验收断言：`pnpm build` 后 `lib/**` 含探针页标记，且从 `lib/` 加载时 `GET <basePath>/probe` 返回 200 + 非空 `text/html`（否则运行时 ENOENT 会被误判为「承载不可行」）。

### D-3 认证验证按「先正规、后回退」三层推进（A 层两步、B 层重定义、C 层受限）

1. **A 层（首选）——两步登录，MUST 两步**：
   - 第一步：在 TDX 内嵌浏览器里打开**根地址** `http://127.0.0.1:<port>/?token=<launchToken>`（`<launchToken>` 取自挂载时打印的 `ctx.connection.authenticatedUrl('http://127.0.0.1:<port>/')`）→ 宿主 `authorizeIndex` 铸造 `HttpOnly; SameSite=Strict` cookie 并 **303** 重定向到 `./`；
   - 第二步：再导航 `<basePath>/probe`（此时靠 cookie 通过 `requestRejection`）。
   - **失败模式（必须写进报告与 spec 负向场景）**：按原设计直连 `<basePath>/probe?token=…` **必然 401**——`?token=` 只在 `GET /` 上被消费，`isAuthenticated` 只读 cookie；若按旧设计执行，spike 会得到「TDX 内嵌浏览器不接受 tokenized URL → 认证不可用」的**假结论**，进而把 change 4 推向未认证回退。
   - 判定要点：303 与 `Set-Cookie` 是否在 TDX 内嵌浏览器中发生、cookie 是否在后续导航/新窗口存活（`SameSite=Strict` 在同源顶层导航下应携带，但**未实测**）。
2. **B 层（回退 1，重定义；评审 Issue 2 择 (b)）**：宿主 `connection` **没有 token 校验原语**（`launchToken` 为 `BrowserAuth` 私有字段，只在 `authenticatedUrl()` 内拼进 URL），因此「校验宿主 token」无实现路径。B 层改为：**每次请求带 `?token=`，由插件路由自行校验一个插件自有诊断 token**——挂载时 `crypto.randomBytes` 生成、仅存内存并打印到日志，路由层比对（常数时间比较），不匹配即 401。
   - **安全边界（MUST 在报告与 spec 写明）**：① token 来源 = 插件自身生成（**不是**宿主认证，不得声称等价）；② 有效期 = 进程生命周期（重启即失效，无持久化）；③ 只对自己的路由生效（`<basePath>/probe`），不改动也不代表宿主其它路径的认证姿态；④ 明文出现在 URL 查询串（可能进日志/历史），故**只护诊断页**，业务写入（change 4 的写接口）MUST NOT 依赖 B 层。
3. **C 层（回退 2）**：loopback + `Host`/`Origin` 栅栏的未认证诊断页（只读、无写能力）。**先例不可原样复用**：`DSH-better-sidebar/src/trust-fence.ts`（已核验存在，版本等价性未核验）明确拒绝 `Sec-Fetch-Site: cross-site` 与 `Origin: null`（其注释：`"null"` 是不透明来源，沙箱 iframe / `file:` 页面一律拒），且自述「这是 DNS-rebinding/跨站防御，**不是认证**」。因此若采纳 C 层，MUST 定义并对 owner 申报**放宽点**（`Origin: null` 与 `cross-site` 的例外范围、放行的方法与路径白名单），不得默认放宽。

**MUST 的护栏**：C 层引入本地安全面（同机进程可读），**若被选中必须 owner 签字**（签字时间与范围记入 `docs/roadmap.md`），且只授予诊断/只读能力。**开关形态已定案（R2-6 择 ②）**：C 层**不是配置项**，而是代码常量 `UNAUTHENTICATED_READONLY_DEFAULT = false`（默认关闭；置 `true` 前 MUST 取得 owner 签字，签字未取得时该常量 MUST 保持 `false`），因此不需要、也不得为它引入配置面（`Config` 归 change 2）。A 层不可用时优先 B 层（保留认证语义：至少诊断页不被无凭据读取），C 层仅作最后手段。

**写接口认证（`iteration-1-contracts §12.1`，评审 R2-3）**：业务写入（卡片落盘）**MUST NOT 依赖 B 层或 C 层**——A 层（宿主 cookie）是写接口的**硬门槛**；A 层 cookie 不存活即 change 4 的写接口**认证不可用**（显式禁用，而非降级认证）。「写接口认证可行性」因此是 D-7 决策表的**必输出结论项**（独立于诊断页），不得以「业务写入仍走认证路径」这类未定表述代替。

**P2/P3 的认证/跨源障碍（评审 Issue 3，MUST 作为结论前提写明）**：P2（`file://` 跳板页 `location.replace(http + #hash)`）与 P3（就地 `file://` 页面 + 本地 HTTP 取数）都被两条既有事实挡住——

- `trust-fence.ts` 先例拒绝 `Origin: null`（`file:` 页面发起的跨源请求即不透明来源）与 `Sec-Fetch-Site: cross-site` → 403；
- 宿主 cookie 为 `SameSite=Strict` → `file://` 发起的跨站请求**不携带**该 cookie，故 P3 连认证也拿不到。

因此 P2/P3 需要**额外处理**才可能成立，处理方式列为**待验证项与降级路径**（不预设结论）：① 跳板代理（`file://` 页 → 本地 HTTP 代理端点，由代理加同源头）；② 显式 CORS + Private Network Access 预检处理（只放行指定来源/方法/头，MUST NOT `*`）并定义 `Origin: null` 的窄例外；③ 签名 URL（一次性、短时效、绑定路径与用途）。上述任一若落入 C 层语义，均需 owner 签字；**本 change 不预先放宽任何安全面**。

### D-4 承载路径矩阵、逐路径判据与记录方式

三条路径逐一实测并留证。**每条路径 MUST 按「渲染 / 传参 / 认证 / 跨源」四维度给三态判定**（见 D-7），判据为**可观察事实**而非「是否可用」：

| 路径 | 形态 | 通过判据（PASS） | 受限判据（LIMITED，逐项列出受限点） | 失败判据（FAIL） |
| --- | --- | --- | --- | --- |
| P1 | http URL 直接作为 TDX 页面（自定义版面/页面配置指向） | TDX 接受 `http://127.0.0.1:<port>/?token=…` 并完成 303 → 探针页在 TDX 内渲染出 `window.__PROBE__.auth === 'cookie'`；hash 变化时 `hashchange` 计数递增且页面不重载、输入框内容保留 | 能渲染但①只在某配置入口可用（记录入口）；②渲染但 cookie 不存活（仅 B 层可救）；③hash 传参丢失或页面重载；④联动探测部分写法无响应——受限点逐条记录 | TDX 拒绝该 URL（无法配置/打开即空白/明确报错），或渲染成功但认证与传参**均**不成立且无签字回退 |
| P2 | `file://` 跳板页 `location.replace('http://127.0.0.1:<port>/…/probe#<code>')` | 跳转发生、探针页渲染、hash 随跳转保留（`location.hash === '#<code>'`）、且跨源/认证障碍已被 D-3 的三种处理之一解决（有实测请求头证据） | 跳转与渲染成立但 hash 丢失、或请求被 403/401 挡（记录实测请求头 `Origin` / `Sec-Fetch-Site` / `Sec-Fetch-Mode`、响应码、是否带 `dsh-auth-*` cookie、是否触发预检/PNA 拦截） | 跳转被禁止（内嵌浏览器不离开 `file://`）、或跨源与认证双双无解且不接受 C 层签字 |
| P3 | 保留 `file://` 就地实现（静态页 + 本地 HTTP 取数） | `file:` 页面对本地 HTTP 端点的请求返回 200 且数据可用（需 CORS/PNA 已处理），认证姿态经 owner 签字确认 | 请求可达但需放宽点（记录放宽范围与签字）/ 仅部分接口可达 / 需用户手动放行 | 请求被 `Origin: null` 或 `cross-site` 栅栏挡且不放宽，或 `SameSite=Strict` 致认证不可得且 owner 不接受 C 层 |

记录方式：探针页自检输出（可直接截图）+ 手工核对表（TDX 版本、内核 UA、各路径结果、实测请求头与响应码）写入报告；无法自动断言项标「人工核对」。P2/P3 的跨源与认证障碍（D-3）MUST 在矩阵中逐项落为实测值，避免「是 TDX 不行还是栅栏/Cookie 挡住」无法归因。

### D-5 传参优先级：hash 优先

TDX 联动的实际通道是 `#hash`（现网基线），因此解析优先级为 **hash → query → path 段**，并以「实际取值形态」为自检输出的一部分。理由：change 4 需要一条确定规则；把 query/path 作为兼容形态保留，是为了在 P2/P3 分支下仍能传参。编码不做静默修正（`SH600000` / `600000.SH` 原样记录 + 判定），因为「猜代码」会污染后续卡片归属（P1）。

### D-6 联动探测「页面侧布点 + TDX 侧人工核对」

页面侧按 D-9 的写法上限布点 **6 种**点击调用写法（普通 `onclick`、`element.click()`、手动 `dispatchEvent(MouseEvent)`、`window.open`、`postMessage`、`location.hash` 变更），逐一点击并记录 TDX 侧行为（MUST NOT 临时扩写写法数量）。**探针页无法自我断言 TDX 是否切换了标的**——该判定只能由 owner 目视确认，报告中明确列为人工核对项；该维度未获确认时 MUST NOT 记为「可行」，也 MUST NOT 记为「不可行」（结论三值统一为**可行 / 受限 / 不可行**，未获证据即 UNKNOWN）。

### D-7 报告落点、形态与退出判据（评审 Issue 4：三态 + 部分成功量化 + 「探测不可执行」出口）

`docs/spikes/tdx-embed.md`，固定四节：结论 / 证据 / 决策 / 未决项。报告是 change 4 design 的输入文档（change 4 的 design.md 引用其结论，不重复记录）。

**结论 = 判定表**：`路径 × 维度（渲染 / 传参 / 认证 / 跨源）× 状态（PASS / FAIL / UNKNOWN）+ 证据（截图路径 / 请求头 / 返回码 / 时间戳）`。三态口径：

| 三态 | 定义（可判定） |
| --- | --- |
| **已验证** | 有自动或可复现的观察证据（响应码、请求头、`window.__PROBE__` 输出、页面自检文本），至少执行 2 次一致 |
| **人工核对确认** | owner 目视确认（如 TDX 是否切换标的），报告记录「谁在何时确认了哪一项」 |
| **未验证** | 未能执行或证据不足；MUST 写明阻塞原因与后续动作，MUST NOT 记为「不可行」 |

**部分成功（量化）**：每条路径的判定为「**可行** / **受限**（逐项列出受限点）/ **不可行**」三值之一；「受限」必须给出可判定的布尔式触发条件，示例（P1）：`渲染 PASS ∧ 认证 PASS ∧ (hash 传参 FAIL ∨ 联动写法命中数 < 已尝试写法数)` → 记为「P1 受限：传参/联动受限」，并把命中的写法清单落入报告。**MUST NOT** 用「基本可用」「大体可行」这类不可判定的措辞；有任一项 UNKNOWN 时该路径 MUST NOT 判为「可行」。

**决策规则（三态映射 + 出口，禁止空收尾）**：
① **可行出口**——P1（或 P2）判「可行」→ 决策为「采用 http 同端口页面」并列出 change 4 可依赖的形态（路由 / 传参 / 认证）；
② **受限出口（第三态映射，评审 R2-4）**——P1（或 P2）判「受限」且满足布尔式 `渲染 PASS ∧ 认证 PASS` → **决策仍为「采用 http 同端口页面」**，并在结论节逐条列出受限点与对 change 4 的**相应降级要求**（例：hash 传参受限 → change 4 改走 `?code=` / path 段；联动写法部分命中 → 标注哪些方向需人工操作）。**仅当**全部路径均判「不可行」，**或**受限点命中 change 4 的 **P1（现场即时）判据**（符号名：`review-page` proposal 的「P1/P3 现场优先、零切换」与 design 的「切换标的不重载页面、不丢未保存输入（P1/P3）」——即「现场、即时、零切换」这类不可降级的现场约束）时，才写作「回退 `file://` 就地实现」；
③ **回退出口**——P1、P2 均判「不可行」→ 决策为「回退 `file://` 就地实现」并写明资产组织与认证影响；
④ **「探测不可执行」出口**——TDX 配置入口不可达、owner 不在场、或时间盒耗尽仍无证据时，决策节 MUST 写「**未验证**」+ 阻塞原因 + 后续动作（重排时间 / 找入口 / 降级到 P3 预研），并显式标注 **change 4 的承载绑定层被阻塞**（`blocked_by: change 1` 保持未消解）。**MUST NOT** 在无证据时编造二选一结论。

**MUST（三条路径均受限的收尾，评审 R2-4）**：若 P1/P2/P3 三条路径**全部**停在「受限」（无一条「可行」、也无一条「不可行」），MUST 按第 ② 条收尾——在满足 `渲染 PASS ∧ 认证 PASS` 的路径上决策「采用 http 同端口页面」并逐条列出受限点与 change 4 的降级要求；不满足该布尔式时 MUST 按第 ③ 条收尾。**MUST NOT** 因路径判「受限」而留空决策、以「待定」收尾，或把「受限」当成不出决策的理由。

**写接口认证结论（必输出项，独立于诊断页；评审 R2-3 / `iteration-1-contracts §12.1`）**：结论节 MUST 含一条**可判定**的「写接口认证」结论，取值域与判据固定为：
- **可行**：A 层 cookie 在 TDX 内嵌浏览器中存活（至少 2 次一致证据）→ change 4 写入接口的认证机制 = **宿主 cookie（A 层）**；
- **不可行（FAIL）**：A 层 cookie 不存活 → 写入接口的认证机制**不存在**；结论节 MUST 写「change 4 写接口认证不可用 → **显式阻塞 change 4 的写能力**（页面只读降级）」，MUST NOT 用 B/C 层承接写入；
- **受限（备选，待裁决）**：仅在 owner 就「**一次性短时效签名 token**」签字后成立——作用域 = 单次写入请求、绑定 `POST /review/api/card` 的路径与用途、进程内短时效（分钟级）、不复用不持久化；**裁决状态**：未签字（后置 Open Questions 第 5 条）时该备选 MUST 记为「未裁决」，MUST NOT 进结论。
该结论 MUST 与 D-3 的 A/B/C 层判定互相印证（B 层命中 MUST NOT 被推导为写接口可用）。

**复现前提（评审 Issue 14/19）**：报告 MUST 记录 TDX 版本、内嵌浏览器 UA 与内核版本、DSH 版本、`@deepseek-ai/dsh-host-webserver` 与 `dsh-client-connection` 的实测版本、宿主源码检出路径 + 关键符号（`authorizeIndex` / `isAuthenticated` / `requestRejection` / `register`）及其本机行为；决策节标注「本结论适用的宿主版本范围」。`dsh.plugin.json` 的 `engines.dsh` 下限为占位，需核验其是否已包含 `webServer.port` 与 `connection.requestRejection`（不足则抬高下限）。

**依据原文摘录的可判定出口（评审 R2-9④）**：报告引用仓外需求文档（§11、P1/P3 现场原则、F5 盘中页面）时 MUST 附原文摘录 + 出处（文件 + 版本/日期）并标注「仓外文档，未能核验」；**当仓外文档在仓内无副本（当前即如此）时**，报告 MUST 以「**未能核验 + 缺失项清单**」收尾——缺失项清单逐条列出「文档名 + 需要的章节 + 缺它对哪条结论不可复核」，MUST NOT 以空白、含糊或「影响范围待定」代替。该出口是结论节的组成部分（对应 spec「可行性结论与退出判据」的「仓外依据未能核验时收尾」场景）。

### D-8 探针不触碰业务数据 + 证据脱敏（评审 Issue 17）

探针页与路由只读自身与请求元信息，不写数据根/vault，不调用行情/交易接口；证据材料落 `docs/spikes/`。

**脱敏硬约束**：TDX 截图天然包含账户/资金/持仓/自选股信息，因此入库截图 MUST 先裁剪或遮盖账户、资金、持仓、自选股等个人金融信息；**无法脱敏者只记录本地路径不入库**。默认只入库文本证据（UA、请求头、返回码、时间戳、自检文本）；二进制放 `docs/spikes/assets/` 时 MUST 逐张通过脱敏检查并在报告标注「已脱敏」。

### D-9 收敛规则与时间盒（评审 Issue 5）

spike 的典型失败模式是开放式探索吞掉后续阶段（`docs/roadmap.md §2` 阶段防呆）。因此设硬性收敛规则，**到点即写报告**：

| 项 | 上限 | 超限处置 |
| --- | --- | --- |
| 单路径（P1/P2/P3）总耗时 | ≤ 30 min | 该路径记为 FAIL/UNKNOWN，进入下一路径 |
| 单次配置尝试 | ≤ 10 min | 记一次失败，换写法或换入口 |
| 单路径配置尝试次数 | ≤ 3 次 | 该路径收敛，取现有证据出结论 |
| 联动写法枚举 | ≤ 6 种（D-6 布点即上限） | 不再新增写法 |
| 整个 spike 实测（TDX 侧人工部分） | ≤ 2 h | 停止实测，按「未验证」出口写报告（D-7 决策规则②） |

规则：任一上限触及时 MUST 立刻记录当时证据（请求头/截图/时间戳）并按上表处置，MUST NOT「再试一次看看」；未覆盖项原样落进报告「未决项」，不得因超时省略。

### D-10 测试 seam：探针 handler 提为纯工厂（评审 Issue 16）

本仓无宿主 `webServer` 实现、也无 `@deepseek-ai/dsh-*` 依赖，**零 mock 纪律下不可能测「路由注册/卸载」与「宿主 404」**（那些行为只存在于宿主内部）。因此：

- 探针 handler MUST 提取为纯工厂 `createProbeHandler(deps): WebRoute['handler']`（`deps` 含注入模板、诊断 token、认证判定函数、base URL），使「传参解析 / 注入转义 / 认证拒绝码 / 方法不匹配」可用**真实 `node:http` 请求/响应桩对象 + 真实临时 HTTP server**（沿 change 2 design「真实本地服务桩」先例）零 mock 测；
- 「路由注册/卸载」MUST 标注为**集成核对**（起真实宿主验证，或用 `ctx.effect` 的 disposer 契约做结构断言），MUST NOT 写成「零 mock 单测」；
- 探针 HTML 内联常量 MUST 可被单测断言（标记存在、无 `http(s)://` 外链、无 ES2018+ 语法特征），以覆盖 D-2 的构建与语法约束。
- **与 `§7` 出站通道口径的边界（评审 R2-7，跨 change 补充条目）**：`§7` 规定「全仓仅两条具名出站通道允许 `fetch(` / `http.request`：`src/data/http.ts` 与 `src/skill/download.ts`」，且 change 4 把它写成「除 `src/data/http.ts` 外全仓零 `fetch(` / `http.request` 调用点」的结构断言。为免把测试 seam 或内联页面判成第三个调用点，本 change 明确：
  1. **结构断言作用域 = `src/**`**，并**显式豁免** `test/**` 与内联 HTML 常量（`PROBE_HTML` 的模板字符串正文不计入扫描目标）；
  2. **测试侧驱动方式已选定**：优先**直接调用 `createProbeHandler` 并构造 `IncomingMessage` / `ServerResponse` 桩**（不起服务、零出站调用）；需要端到端形态时用**真实临时 `node:http` server + `node:net` 裸 socket**驱动（`createServer` 属服务端监听、不是出站通道）；
  3. `test/**` MUST NOT 出现 `fetch(` / `http.request` 调用点；扫描型用例 MUST 先断言扫描目标非空（`targets.length > 0`）且 MUST NOT 把 `PROBE_HTML` 常量文本计入目标；
  4. 该口径为 `§7` 的**补充条目**，跨 change 生效，登记于 tasks 4.7 移交清单。

## Risks / Trade-offs

- **按旧设计直连 `<basePath>/probe?token=` 得到「认证不可用」假结论**（最高风险）→ A 层强制两步登录（D-1 打印登录 URL + D-3 第一步），并在 spec 加负向断言「仅带 `?token=` 直接访问 `/probe` → 401」；报告 MUST 记录该负向结果，防把宿主语义误判为 TDX 缺陷。
- **B 层被误当作「宿主认证的等价物」** → D-3 明文声明它是插件自有诊断 token（来源/有效期/作用域/明文风险四项边界），业务写入 MUST NOT 依赖。
- **A 层 cookie 失效后写接口认证机制无人定义，认证缺口下沉到 change 4**（评审 R2-3）→ D-7 把「写接口认证可行性」升为**必输出项**并预置三分支（可行 = A 层 cookie 为唯一机制；不可行 = 显式阻塞 change 4 的写能力 + 只读降级；受限 = 仅 owner 签字的一次性短时效签名 token，未签字记为未裁决）；D-3「写接口认证」段 + spec「可行性结论与退出判据」+ tasks 2.4/4.2/4.7 同步。
- **P2/P3 被 `trust-fence` 与 `SameSite=Strict` 挡死而被含糊归因** → D-3 预先写死两条障碍，D-4 矩阵要求逐项落实测请求头与响应码，「跳板代理 / 显式 CORS+PNA / 签名 URL」列为待验证处理方式与降级路径。
- **探针页不进构建产物/发包白名单 → 运行时 ENOENT 被误判为「承载不可行」** → D-2 定案内联 TS 模板字符串（落在 entry 模块图内）+ `package.json#files`/`.gitignore` 断言 + 「从 `lib/` 启动返回 200 且 HTML 非空」验收。
- **内嵌内核过旧导致探针页自身渲染失败** → 语法上限锚定基线页已证级别（ES2017 + Fetch + Promise）；失败时改用「最小 HTML + pre 输出」降级版重测，并把内核能力单独记为结论项（D-2）；报告对照「基线页语法清单 vs 探针页特性探测」。
- **TDX 版本差异使结论不可迁移** → 报告记录 TDX 版本、内嵌 UA、DSH 版本与宿主包实测版本（D-7 复现前提）；决策附「适用版本范围」；升级后重跑探针页（诊断页保留的意义）。
- **联动协议无法在页面侧断言，被误读成结论** → 强制标注人工核对项（D-6），报告结论节区分「已验证 / 人工核对确认 / 未验证」三态（D-7）。
- **未认证回退（C 层）被顺手采纳而无人复核** → C 层需 owner 签字（D-3），报告写明能力边界（只读诊断，业务写入不适用），签字时间记入 `docs/roadmap.md`。
- **spike 范围膨胀 / 探测无法执行**（配置入口不明、owner 不在场）→ 时间盒与收敛规则（D-9）+「探测不可执行」出口（D-7 决策规则②）；Non-Goals 明确探针页不含业务 UI，change 4 独立成 change。
- **误动业务数据或泄漏个人金融信息** → D-8（不触碰业务区 + 截图脱敏硬约束 + 默认只入库文本证据）。

## Migration Plan

- 探针路由随插件挂载即在（无数据迁移）；spike 后**不回滚**，转为诊断页（开关 = 模块常量 `DIAGNOSTICS_DEFAULT = true`；change 2 落地 `src/config.ts` 后转由其 `diagnostics` 子键接管。关闭时**不注册探针路由** → 插件层面断言「不由插件 handler 响应、无残留 handler」；**实际状态码由宿主 fallback 决定，登记为集成核对项**，见 spec Requirement「诊断页开关（本 change 为模块常量，change 2 后转配置）」）。
- 若决策为 P3（回退 `file://`）：change 4 的页面资产改为「就地静态页 + 本地 HTTP 取数」，本 change 只需在报告写明影响与 P2/P3 的跨源/认证处理方式（D-3），不预先改造 change 4。
- 若 A 层 cookie 不存活而采纳 B 层：报告与 change 4 的接口文档 MUST 写明「**诊断页用 B 层 / 写接口用 D-7 写接口认证结论所指机制**」；D-7 结论为「不可行」时写「写接口 = 不可用（A 层不可用）」，MUST NOT 用 B/C 层承接写入（`iteration-1-contracts §12.1`）。
- 若 A/B 层认证均不可用而采纳 C 层：在 `docs/roadmap.md` 记录该安全面决策、放宽点与签字时间。
- 若结论为「未验证」（探测不可执行）：在 `docs/roadmap.md` 与本 change 的 tasks 记录阻塞原因与后续动作，change 4 的承载绑定层保持 `blocked_by: change 1`。

## Open Questions

1. **未认证 loopback 回退（C 层）是否可接受**——涉及本地安全面与 `trust-fence` 放宽点（`Origin: null` / `cross-site` 例外），需 owner 签字；本 change 只准备方案与证据，不代替裁决。该开关**不是配置项**而是代码常量 `UNAUTHENTICATED_READONLY_DEFAULT = false`（默认关闭；签字前 MUST 保持 `false`，见 D-1 / R2-6）。
2. **TDX 侧的配置入口**：哪一处（自定义版面 / 系统设置 / 页面文件替换）可以指向 http URL，需要 owner 在 TDX 实机确认；探针报告记录实际入口路径，便于 change 4 的部署说明复用。
3. **P2 跳板页的长期形态**：若采纳 P2，跳板页属于部署资产（放在 `D:/TDX_HOME/webs/company/`），其版本管理与同步方式待 change 4 落地时确定（本 change 只验证可行性）。
4. **E4 方言探测的移交（评审 Issue 6 冲突登记）**：`docs/roadmap.md §4` 拍板 E4 要求「选股公式方言并入清单」，而本 Non-Goals 排除方言探测——本迭代**部分未落地**（`docs/roadmap.md §5` 已登记）。裁定：方言探测归**阶段 6 前独立 spike**，本 change 不纳入；该独立 spike 的清单口径（方言枚举范围、判定输出）待立。
5. **P2/P3 的跨源与认证处理方式选型**（D-3：跳板代理 / 显式 CORS+PNA / 签名 URL）——三者代价与安全面不同，本 change 只给实测证据与受限点，选型与放宽范围需 owner 裁决（与第 1 条同批）。**同一裁决也覆盖「写接口认证」的受限分支**（D-7）：若 A 层 cookie 不存活，唯一备选是 owner 签字的一次性短时效签名 token，作用域 = 单次写入请求 / 绑定 `POST /review/api/card` 的路径与用途 / 分钟级 / 不持久化；**裁决状态 = 未裁决**，裁决前该分支 MUST NOT 进结论（B/C 层不得承接写入，`§12.1`）。
6. **宿主版本等价性**：本机 DSH 源码检出与已安装 `0.1.5-rc.1` 的版本等价性**未核验**（沿 `iteration-1-contracts §8` 标注）；若 `engines.dsh` 下限不足以覆盖 `webServer.port` / `connection.requestRejection`，需抬高下限并在报告中记录。
7. **诊断页默认开启的安全面**：模块常量 `DIAGNOSTICS_DEFAULT = true` 的理由是排障复用（spike 后仍在）；若 owner 倾向最小攻击面，把该常量改为 `false`（change 2 落地 `src/config.ts` 后即为一次配置改动；spec 已覆盖两态）。本 change 不为它引入配置面（`§11`）。

## 评审处置（Round 1 — 2026-09-27）

来源：`reviews/spike-tdx-embed-review.md`（19 条 issue，Round 1；该评审已逐行核验宿主源码）。逐条处置如下（「已采纳」标明改动位置；「后置」指向 Open Questions 条目；「驳回」给出理由）。**无驳回项。**

| Issue | 严重度 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- |
| 1 A 层认证流程写错（`?token=` 在 `/probe` 上不生效） | Critical | **已采纳** | D-3 A 层改为**两步**（根路径 `GET /?token=` 铸 cookie + 303 → 再导航 `<basePath>/probe`），并写明失败模式「直连 `/probe?token=` 必然 401 → 假结论」；proposal What Changes/Why；spec 新增 Requirement「认证流程」+ 4 场景（含负向断言）；tasks 1.1/1.6/2.1/2.4 |
| 2 B 层无宿主 API 可落地 | Critical | **已采纳（择 (b) 重定义）** | D-3 B 层改为「插件自有的诊断 token，由插件路由自行校验」，并写明四项安全边界（来源/有效期/作用域/明文）；Context 记录 `connection` 无 token 校验原语、`launchToken` 为私有字段；spec Requirement「认证流程」B 层场景；tasks 1.6/2.4；**下游 `review-page` 的 D-3（认证分层与写接口的 A 层依赖）与 tasks「认证接入（A/B/C 分层）」条目的 B 层表述需同步**（本 change 不跨目录改，列为移交项，见 tasks 4.7） |
| 3 P2/P3 被 trust-fence 与 `SameSite=Strict` 否掉、无跨源测试项 | Critical | **已采纳** | D-3 增「P2/P3 的认证/跨源障碍」段（`trust-fence.ts` 拒 `Origin: null`/`cross-site`；cookie `HttpOnly; SameSite=Strict`）；D-4 矩阵为 P2/P3 增「通过/受限/失败判据」并列出必测请求头与响应码；「跳板代理 / 显式 CORS+PNA / 签名 URL」= 后置（Open Questions 5）+ 降级路径；tasks 2.2/2.3/2.4；spec 场景「P2 路径判据与跨源取证」「P3 路径判据与受限期归因」「回退与降级路径可判定」；C 层护栏（owner 签字、只读诊断、业务写入不走 C 层）保留 |
| 4 退出判据不可判定（强制二选一、无部分成功、无不可执行出口） | Critical | **已采纳** | D-7 重写为「判定表 `路径 × 维度 × 三态` + 部分成功量化（可行/受限（逐项列受限点）/不可行，受限需可判定布尔式）+ 两条出口（正常 / **未验证**并显式阻塞 change 4 承载绑定层）+ 复现前提」；spec 新增 Requirement「可行性结论与退出判据」+ 5 场景；tasks 4.1/4.2/4.3/2.7 |
| 5 无时间盒与尝试次数上限 | High | **已采纳** | 新增 D-9「收敛规则与时间盒」（单路径 ≤30 min、单次尝试 ≤10 min、每路径 ≤3 次、联动写法 ≤6、总计 ≤2 h，到点即写报告）；tasks 顶部新增「时间盒与收敛规则」段（§0）+ spec 新增 Requirement「时间盒与收敛规则」+ 2 场景；D-6 写法枚举与 D-9 对齐 |
| 6 与 roadmap 冲突：M0 无定义、E4 方言、回写目标行号 | High | **已采纳** | proposal Why 改「阶段 1 骨架已完成 / 阶段 2 之前」并引用 `roadmap.md §5`；Non-Goals + Open Questions 4 登记 E4 冲突移交；tasks 4.6 回写目标改为「阶段 6 嵌入页行 + 阶段 2 桥取消/口径修正行 + architecture」；tasks 4.9 登记 E4 移交；D-1 声明探针路由为**临时/诊断资产**（阶段 2 桥按自身 design 重做）。**`docs/roadmap.md` 增行记录本 change 与「横跨阶段 1→2」定位 = 移交项**（本 change 只改自身目录，tasks 4.6 已含该动作） |
| 7 探针 HTML 不进构建产物与发包白名单 | High | **已采纳（择内联方案）** | D-2「构建与发包」定案内联 TS 模板字符串（落在既有 entry 模块图内）+ `package.json#files`/`.gitignore` 断言 + 「从 `lib/` 启动返回 200 且 HTML 非空」验收；proposal Impact；spec 新增 Requirement「诊断页可配置关闭与构建产物随包发布」+ 场景；tasks 1.3/1.10/4.8 |
| 8 路由 `kind` 未定、与 change 4 前缀互撞 | High | **已采纳** | D-1 表格定案 `kind: 'exact'` + `path = '<basePath>/probe'`，逐情形列出状态码来源（401/403 由插件产生，未注册路径由宿主 fallback，插件层面不断言）；D-1 增「路由命名空间分工（给 change 4 的接口承诺）」；spec 场景改写为 401/403，404 断言降级为「不落入探针页 + 集成核对」，并新增「与 change 4 路由不冲突」场景 |
| 9 「未认证 → 拒绝或跳转」与宿主事实不符、无 `requestRejection` 任务 | High | **已采纳** | spec Requirement「同端口探针路由」把「拒绝或跳转」改为「401（无有效 cookie）/ 403（Host/Origin 栅栏）」；D-1 写死 handler 首行调用 `requestRejection` 的代码与「插件不被自动鉴权」事实；tasks 1.5 单测断言两种拒绝码 + 1.2 路由注册/卸载集成核对 |
| 10 配置面归属与 change 2 冲突 | High | **已采纳** | D-1 定案**最小 Config**（`basePath` + `diagnostics.enabled`）+ `cordis.patch.yml` 示例；proposal Impact 声明「首次落地」并把 `data-foundation/proposal.md` 的「首次出现 `config` 段」措辞列为**跨 change 移交项**（本 change 不跨目录改）；tasks 1.1 + 4.7 |
| 11 端口与登录 URL 取得方式缺失 | High | **已采纳** | D-1「URL 打印」段（三行 URL 由插件输出，端口取 `ctx.webServer.port`，说明 `port: 0` 会漂移）；tasks 1.1 产物含三行 URL 输出、2.1 人工核对清单首项「记录实际端口与三行 URL」 |
| 12 静态单文件 vs 「请求认证判定结果」自检矛盾 | Medium | **已采纳** | D-2 改为「静态骨架 + 请求时注入 `window.__PROBE__`」，要求 `Cache-Control: no-store` 与注入值转义；spec Requirement「同端口探针路由」明确该自检为「服务端注入、非页面自证」；tasks 1.4/1.9 |
| 13 内核能力假设与基线证据矛盾、无基线语法清单任务 | Medium | **已采纳** | Context 增「已证下限：基线页使用 ES2017+Fetch+Promise（已核验）」；D-2 语法约束改为「≤ 基线页所用语法级别」；tasks 1.3/4.1 要求报告记录「基线页语法清单 vs 探针页特性探测」对照 |
| 14 报告复现前提缺 DSH 宿主版本 | Medium | **已采纳** | D-7「复现前提」段要求记录 DSH 版本 + `@deepseek-ai/dsh-host-webserver` / `dsh-client-connection` 实测版本 + 关键符号行为 + 适用版本范围，并核验 `engines.dsh` 下限是否覆盖 `webServer.port`/`requestRejection`；spec Requirement「可行性结论与退出判据」同步；tasks 4.1/4.2 |
| 15 诊断页保留 + 默认开启缺 spec 承载与安全面结论 | Medium | **已采纳** | spec 新增 Requirement「诊断页可配置关闭与构建产物随包发布」+ 3 场景（关闭 → 不可达且无残留 handler；默认 true 且始终走 `requestRejection`；构建产物与发包白名单）；D-1 Config + D-3 认证姿态；默认值理由 = 后置 Open Questions 7；tasks 1.2/1.10 |
| 16 单测落点与「零 mock」在依赖宿主 service 的路由上不可执行 | Medium | **已采纳** | 新增 D-10（`createProbeHandler(deps)` 纯工厂 + 真实 `node:http` 桩对象/临时 server 测传参/注入/拒绝码；「路由注册/卸载」标注为集成核对）；tasks 1.9 单测 + 1.2 集成核对（拆为两条） |
| 17 证据材料无脱敏规则 | Medium | **已采纳** | D-8 增脱敏硬约束（截图 MUST 裁剪/遮盖账户、资金、持仓、自选股；无法脱敏者仅记本地路径不入库；默认只入库文本证据）；proposal Impact；spec Requirement「探测不触碰业务数据与证据脱敏」+ 2 场景；tasks 2.6 |
| 18 「§11」「P1/P3 现场原则」「F5」依据不可核验、无归档任务 | Medium | **已采纳** | proposal Why + Context 标注「仓外文档，未能核验」（沿 `§8`）；spec 新增场景「依据原文摘录可复核」；tasks 4.1 增「报告含依据原文摘录与出处（文件 + 版本/日期）」；未决项保留「原文不可复核」的显式标注 |
| 19 宿主源码引用精度与不可解析路径形态 | Suggestion | **已采纳** | Context 全节重写为「符号名 + 已核验（本机检出路径，版本等价性未核验）」两节结构（`iteration-1-contracts §8`）；`register` 引用改符号名 `webserver/src/index.ts:register`（不再是行号）；检出路径与版本记入报告（同 Issue 14），tasks 4.1 |

**未采纳 / 存疑项**：无 issue 被驳回。三处选择需 owner 知情：

- **Issue 2**：本 change 择「(b) 保留但重定义 B 层」而非「(a) 删除」——理由：TDX 侧 cookie 存活是**未实测项**，删除 B 层会让「cookie 不存活」直接掉到需签字的 C 层；但 B 层已降格为**插件自有诊断 token**，并明写「业务写入 MUST NOT 依赖」。**跨 change 风险（Round 2 已收敛）**：`review-page` 的 D-3（认证分层与写接口的 A 层依赖）与 tasks「认证接入（A/B/C 分层）」条目已在 change 4 侧按 A/B/C 三层重写（本 change 不跨目录改，仅登记移交项 tasks 4.7）；**写接口认证机制**由 D-7 的必输出结论项定义（R2-3）。
- **Issue 6 / E4**：本 change **不纳入**选股语句方言探测（纳入了也会把时间盒打爆），故 E4 在本迭代按「部分未落地」处理——但这与 `roadmap.md §4` 的拍板字面不一致，`docs/roadmap.md §5` 的登记（「本条不再视为已闭环」）是移交依据，**需 owner 在复评时确认该裁定**。
- **Issue 10（Round 2 修订：由 R2-2 取代原处置）**：原处置「本 change 引入最小 Config」**已废弃**——沿 `iteration-1-contracts §11`，`src/config.ts`（`export const Config`）的唯一 owner 是 change 2，本 change 改为**模块常量**（`PROBE_PATH` / `DIAGNOSTICS_DEFAULT` / `UNAUTHENTICATED_READONLY_DEFAULT`）、**不引入 `Config`、不改 `cordis.patch.yml`、不保留 `TraderKitConfig`**；配置化统一留给 change 2，接管与回写见 D-1 配置面段与 tasks 4.7（原 Open Questions 7 的「常量 + 诊断页常开」备选即本轮所采纳的形态）。

## 评审处置（Round 2 — 2026-09-27）

来源：`reviews/spike-tdx-embed-review.md` 的 **Round 2 段**（R2-1…R2-9 + Previous Round Tracking 的 5 条「部分解决」）。**Round 1 处置表与未采纳/存疑项保持原样**（仅按 R2-9② 把对下游的行号引用改为符号名；#10 的原处置已由 R2-2 取代，见下）。**无驳回项**；后置项统一指向 Open Questions。

| # | 严重度 | 处置 | 改动位置 / 理由 |
| --- | --- | --- | --- |
| R2-1 proposal 把「未注册路径 404」写成插件自产 | High | **已采纳** | `proposal.md` What Changes 第 1 条改为「未认证 401/403 由插件 handler 产生；未注册路径由**宿主 fallback** 决定（登记为实测记录；插件只断言不落入探针页）」，重申「MUST NOT 占用任何 `prefix` 路由」，与 design D-1 表格 + spec「访问不存在的路径」逐字对齐 |
| R2-2 最小 Config 在 change 1/2/3 三处互撞 | High | **已采纳** | 沿 `iteration-1-contracts §11`：D-1 配置面段重写为**模块常量**（`PROBE_PATH` / `DIAGNOSTICS_DEFAULT` / `UNAUTHENTICATED_READONLY_DEFAULT`，落 `src/routes/probe.ts` 并导出），**删除 `export const Config`、`TraderKitConfig` 扩写与「配置面首次落地」表述**，写明「change 2 落地 `src/config.ts` 后由其接管（回写项）」；`proposal.md` Impact 配置面条目重写；tasks 1.1/1.2 改口径；**tasks 4.7 扩为四项可核对移交**（Config 落点与 `TraderKitConfig` 去留 / `diagnostics` 子键命名区分 / change 3 的依赖对象 / proposal 措辞）；spec「诊断页可配置关闭」改按模块常量表述 |
| R2-3 A 层 cookie 失效后 change 4 写接口认证机制未定义 | High | **已采纳** | D-7 新增**必输出项**「写接口认证结论」（独立于诊断页），预置可判定三分支：可行 = A 层 cookie；不可行 = cookie 不存活 → 写路径 FAIL 并**显式阻塞 change 4 写能力**（结论节写明）；受限 = 仅 owner 签字的一次性短时效签名 token（作用域 = 单次请求 / 绑定 `POST /review/api/card` / 分钟级 / 不持久化；**裁决状态 = 未裁决**，后置 Open Questions 第 5 条）；D-3 增「写接口认证」段 + Risks 增条目；spec 新增 Scenario「写接口认证结论为题面必输出」；tasks 2.4/4.2 验收同步；4.7 增「诊断页用 B 层 / 写接口用 <结论所指机制>」 |
| R2-4 「受限」无终局映射（Critical 残留） | Medium | **已采纳** | D-7 决策规则重写为**三态映射**：① 可行 → 采用 http；② **受限且 `渲染 PASS ∧ 认证 PASS` → 决策仍为「采用 http 同端口页面」**并逐条列出受限点与 change 4 降级要求，仅当全部路径均不可行或受限点命中 change 4 的 P1（现场即时，符号名：`review-page` proposal「P1/P3 现场优先、零切换」+ design「切换标的不重载页面、不丢未保存输入（P1/P3）」）才回退 `file://`；③ 均不可行 → 回退；④ 探测不可执行出口；并新增 **MUST**「三条路径均停在受限」的收尾规则；spec 新增 Scenario「P1 受限但渲染与认证 PASS」「三条路径均受限的收尾」 |
| R2-5 「诊断页关闭」断言不可判定 | Medium | **已采纳** | spec Requirement 更名并改写为「诊断页开关（本 change 为模块常量，change 2 后转配置）」：关闭时**不注册探针路由**，插件层断言『不由插件 handler 响应、无残留 handler』；**实际状态码由宿主 fallback 决定，登记为集成核对项**，**删去「非 200」**与「401/404 之一」；design Migration Plan 同步；tasks 1.2 验收口径同改 |
| R2-6 C 层开关没有配置面 | Medium | **已采纳（择 ②「代码常量」）** | D-1 与 `proposal.md` 明写：C 层**不是配置项**，而是代码常量 `UNAUTHENTICATED_READONLY_DEFAULT = false`（**默认关闭**；置 `true` 前 MUST 取得 owner 签字，签字未取得时 MUST 保持 `false`；签字时间与范围记入 `docs/roadmap.md`）；Open Questions 1 同步；tasks 1.7/1.2 验收断言改为「常量默认 `false` → 未认证仍 401；签字前 MUST NOT 改动常量」 |
| R2-7 D-10 测试 seam 与 `§7` 出站通道口径未对齐 | Medium | **已采纳** | D-10 增「与 `§7` 出站通道口径的边界」四条：结构断言作用域 = **`src/**`** 且**显式豁免 `test/**` 与内联 HTML 常量 `PROBE_HTML`**；测试侧驱动方式选定 = **直接调用 `createProbeHandler` + 构造 `IncomingMessage`/`ServerResponse` 桩**，端到端用**真实临时 `node:http` server + `node:net` 裸 socket**；`test/**` MUST NOT 出现 `fetch(` / `http.request`；该口径为 `§7` 的**补充条目**并由 tasks 4.7 登记跨 change 移交（清单第⑥项） |
| R2-8 注入状态枚举缺 B 层取值、`'rejection'` 永不可观测 | Low | **已采纳** | D-2 注入枚举改为 `auth: 'cookie' \| 'diagnostic-token' \| 'none'`，并写明拒绝态不设枚举取值（handler 首行即 `res.end()`，页面不渲染；拒绝由状态码与 `no-store` 响应作证）；spec「cookie 不存活时进入 B 层」场景补 `window.__PROBE__.auth === 'diagnostic-token'` 断言 |
| R2-9 三处坏引用 / 措辞不一致 / 场景错位 | Low | **已采纳** | ① design 配置面移交引用改 **tasks 4.7**（删「D-12」）；② 处置表对下游的引用改为**符号名**（`review-page` 的 D-3「认证分层与写接口的 A 层依赖」与 tasks「认证接入（A/B/C 分层）」），不再写行号；③ 三值结论统一为**可行 / 受限 / 不可行**（spec 联动场景、design D-6 与三态表、D-4 P1 FAIL 判据）；④ 场景「依据原文摘录可复核」移入 Requirement「可行性结论与退出判据」，并补可判定出口「**仓外文档无仓内副本时，报告以『未能核验 + 缺失项清单』收尾**」（design D-7 同步） |
| Round 1 #2 B 层无宿主 API（原「部分解决」） | Critical | **已采纳（R2-3 收口）** | B 层仍按重定义保留（仅诊断/只读）；**A 层失效后的写接口认证机制**由 D-7 必输出项定义（B/C 层不得承接写入，`§12.1`）；下游 `review-page` 的 D-3 与 tasks「认证接入（A/B/C 分层）」条目已在 change 4 侧按 A/B/C 三层重写，本 change 仅登记移交（tasks 4.7） |
| Round 1 #4 退出判据不可判定（原「部分解决」） | Critical | **已采纳（R2-4 收口）** | 「受限」第三态终局映射 + 「三条路径均受限」MUST 收尾 + spec 两个新场景；Round 1 Issue 4 的核心缺陷本轮闭合 |
| Round 1 #8 路由 `kind` / 404 归属（原「部分解决」） | High | **已采纳（R2-1 收口）** | `proposal.md` 的「未注册路径 404 由插件自产」自述改为宿主 fallback 口径，与 design D-1 表格、D-1 的 MUST NOT、spec「访问不存在的路径」逐字一致；`exact` + 不占用 `prefix` 的口径不变 |
| Round 1 #10 配置面归属冲突（原「部分解决」） | High | **已采纳（R2-2 取代原处置）** | Round 1 表内「最小 Config」处置作废：本 change 不带配置面，改用模块常量；四项移交清单（含 change 2 落点、`TraderKitConfig` 去留、`diagnostics` 子键命名、change 3 依赖对象）落 tasks 4.7 |
| Round 1 #18 仓外依据不可核验（原「部分解决」） | Medium | **已采纳（R2-9④ 收口）** | 摘录场景移入 Requirement「可行性结论与退出判据」，并补可判定出口「未能核验 + 缺失项清单」；原「仓外文档，未能核验」标注与 tasks 4.1 摘录要求不变。**§11 / P1-P3 / F5 原文仍为仓外文档**——此为知识缺口而非本 change 可解项（报告按缺失项清单收尾，不新增 Open Questions 条目） |

**后置项（均指向 Open Questions，非驳回）**：**第 5 条**（P2/P3 处理方式选型 + 写接口认证「受限」分支的一次性短时效签名 token 裁决；裁决前记为「未裁决」）、**第 1 条**（C 层签字；开关为代码常量，签字前保持 `false`）、**第 7 条**（诊断页默认值由 owner 决定 `DIAGNOSTICS_DEFAULT` 取值）、**第 4 条**（E4 方言探测归阶段 6 前独立 spike）、**第 6 条**（宿主版本等价性未核验）。R2-1…R2-9 **无一项被驳回**。
