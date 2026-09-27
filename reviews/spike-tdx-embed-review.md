# Plan Review: TDX 嵌入可行性 spike（spike-tdx-embed）
**Plan File**: openspec/changes/spike-tdx-embed/（proposal + specs + design + tasks）
**Reviewer**: Independent Reviewer (subagent)

---

## Round 1 — 2026-09-27

### Overall Assessment

这是本仓目前**证据意识最强**的一份 change：把「不能自动断言」显式留成人工核对项、要求报告区分「已验证/人工核对/未验证」三态、并明确禁止以「待定」收尾，方向完全正确。但它的三条技术支柱里有两条与宿主实现相反：A 层认证（`?token=` 打到 `/probe`）在宿主代码里不可能成立，B 层（每请求 token 校验）**没有任何宿主 API 可落地**，而 P2/P3 回退分支又被 design 自己引用的 `trust-fence.ts` 与宿主 cookie 的 `SameSite=Strict` 直接否掉；再叠加「探针 HTML 不进构建产物/发包白名单」这条必然让探针跑不起来的打包缺口，以及退出判据不可判定、无时间盒，本 change 目前**无法产出可信结论**。文档写得漂亮，但验收面与实现面都存在硬伤。

**Rating**: 5/10

### Issues

#### Issue 1 (Critical): A 层认证流程写错——`?token=` 在 `/probe` 上永远不生效，探针会把「认证不可用」系统性误判为 TDX 问题
**Location**: `openspec/changes/spike-tdx-embed/design.md:37`（D-3 A 层）、`specs/tdx-embed-probe/spec.md:5,9`、`tasks.md:9,16`
design D-3 A 层写「tokenized URL（`ctx.connection.authenticatedUrl('http://127.0.0.1:<port>/dsh-trader-kit/probe')`）→ 依赖内嵌浏览器保留 `?token=` 请求与随后 cookie」。宿主事实与之相反：cookie **只在根路径**铸造——`deepseek-harness/packages/client/connection/src/browser-auth.ts:238-264` 要求 `req.method === 'GET' && url.pathname === '/' && tokens.length === 1`，否则落到 `writeUnauthorized`（:274-275,302-310）返回 401；`isAuthenticated`（:287-300）**只读 cookie 头**，从不读 `?token=`；`rpc-host.ts:104-107` 的 `requestRejection` = Host/Origin 栅栏 + `isAuthenticated`。即：一个指向 `/dsh-trader-kit/probe?token=…` 的请求必然 401（除非该 authority 已有 cookie），token 参数在非根路径上根本没有消费点。附带两点还会一起咬人：cookie 名绑定 authority（`browser-auth.ts:106-108`），属性是 `HttpOnly; SameSite=Strict`（:122）。按现设计执行，spike 会得到「TDX 内嵌浏览器不接受 tokenized URL → 认证不可用」的**假结论**，进而可能把 change 4 推向未认证回退。
**Suggestion**: 把 A 层改成**两步登录流程**并写进 spec 与 tasks：① 在 TDX 内嵌浏览器里打开 `http://127.0.0.1:<port>/?token=<launchToken>`（根路径，`authorizeIndex` 铸造 cookie 并 303 到 `./`）；② 再导航到 `/dsh-trader-kit/probe`（此时靠 cookie）。spec 场景拆成两条：`Scenario: A 层根路径登录`（WHEN 在 TDX 内打开根 URL + token THEN 观察到 303 与 Set-Cookie）与 `Scenario: 带 cookie 访问探针`；并补一条负向断言「仅带 `?token=` 直接访问 `/probe` → 401」。`launchToken` 的取得方式见 Issue 11。

#### Issue 2 (Critical): B 层（每请求带 token、插件自行校验）在宿主上无 API 可落地，却被定为优于 C 层的首选回退
**Location**: `design.md:38`（D-3 B 层）、`tasks.md:9`；被下游继承：`openspec/changes/review-page/design.md:49`、`review-page/tasks.md:13`
design 说 B 层「由插件在路由层校验 token 有效性」，tasks 1.7 也只写「B 层 token 查询参数校验」。宿主 `connection` 的完整公共面是 `rpc` / `fetch` / `operator` / `createSharedFetchHandler` / `requestRejection` / `admit` / `authorizeIndex` / `authenticatedUrl`（`deepseek-harness/packages/client/connection/src/rpc.ts:193-238`，与 `cordis_inspect` 实时 Service 目录逐条一致）——**没有任何 token 校验或 token 读取原语**；`launchToken` 是 `BrowserAuth` 私有字段（`browser-auth.ts:20,223-227`），只在 `authenticatedUrl()` 内部拼进 URL。B 层因此没有实现路径，而它恰恰是「cookie 不可用但保留认证语义」的唯一中间档；错误已被 change 4 原样继承（review-page 也写「每请求带 token（B 层）」），不修会连坐。
**Suggestion**: 二选一并落笔：**(a) 删除 B 层**，明确「cookie 不存活时只有两条路：C 层（未认证只读，需 owner 签字）或 P3 `file://` 就地实现」，同时把 review-page 的对应表述一起改；**(b) 保留但重定义**为「插件自有诊断 token」（挂载时 `crypto.randomBytes` 生成，仅内存/日志，路由层比对，并显式声明它**不是**宿主认证、只护诊断页）。任选其一都必须同步改 `review-page/design.md:49`，否则两 change 会各写一套互不相容的认证回退。

#### Issue 3 (Critical): P2/P3 回退分支被 design 自己引用的 trust-fence 与宿主 cookie 语义否掉，且 tasks 没有任何可判定的跨源测试项
**Location**: `design.md:39`（D-3 C 层）、`design.md:51`（D-4 表 P3 行）、`tasks.md:15`（2.2）
D-3 C 层「参照 `DSH-better-sidebar` 的 `trust-fence.ts` 先例」。该文件（`DSH-better-sidebar/src/trust-fence.ts:63-83`）明确拒绝 `Sec-Fetch-Site: cross-site`（:69）与 `Origin: null`（:71-77 注释原文：「The literal "null" (sandboxed iframes, file: pages) is an opaque origin, refused」），其自述还写明「这是 DNS-rebinding/跨站防御，**不是认证**」。而 P3 的形态恰恰是 `file://` 页面向 `http://127.0.0.1` 取数：请求会带 `Origin: null`（跨源）或 `Sec-Fetch-Site: cross-site` → 一律 403。同时宿主 cookie 是 `SameSite=Strict`（`browser-auth.ts:122`），`file://` 发起的跨站请求**不会携带**该 cookie，因此 P3 连认证也拿不到。review-page 自己也点到「跨源请求本地 HTTP 接口需 CORS/Private Network Access 处理」（`review-page/design.md:100`），但本 change 的 P3 行只说「可行性与代价（跨源/认证影响）」，tasks 2.2 也只有「验证跳转与 hash 保留」——**最可能失败的机制没有被列为测试项**，届时无法归因「是 TDX 不行还是栅栏/Cookie 挡住了」。
**Suggestion**: 在 D-4 的 P3 行与 tasks 2.2/2.3 增补可判定项：file:// 页面 fetch 本地 HTTP 时的实测请求头（`Origin` / `Sec-Fetch-Site` / `Sec-Fetch-Mode`）、响应（403/401/200）、是否携带 `dsh-auth-*` cookie、是否触发 CORS 预检与 PNA 拦截；并明写「C 层不得原样复用 trust-fence，需定义并对 Owner 申报放宽点（`Origin: null` 与 `cross-site` 的例外）」。否则 P2/P3 的结论必然含糊。

#### Issue 4 (Critical): 退出判据不可判定——强制二选一、无「部分成功」定义、无「探测无法执行」出口
**Location**: `specs/tdx-embed-probe/spec.md:62,64-77`、`design.md:15`、`proposal.md:13`
spec 要求决策「SHALL 在 P1/P2 可行与 P3 之间明确二选一，MUST NOT 留空或以『待定』收尾」，但没有任何**量化门槛**：`Scenario: P1 可行`（spec.md:69-72）的条件是「认证路径可用（或选定已签字回退方案）」——「可用」没有判据；`Scenario: P1 与 P2 均不可行`（:74-77）只覆盖全败。真实的 spike 结果大概率是「P1 能渲染但 hash 传参丢」「能传参但 cookie 不落地」「联动 5 种写法里 1 种生效」这类**部分成功**，spec 里没有第三态；更糟的是，如果 TDX 侧配置入口找不到 / owner 不在场，spike **无法执行**，而 spec 仍强制二选一 → 只能编一个结论或违反 spec。这与 AGENTS 的「结论可复现」精神相悖。
**Suggestion**: 把结论结构改为「每路径 × 三维度（渲染/传参/认证）× 三态（PASS/FAIL/UNKNOWN）+ 证据」的判定表，并补两条场景：**(1) 部分成功定义**——给出可判定谓词（例：「P1 渲染 PASS 且 hash 传参 PASS 但 cookie 不存活 → 记为 P1 部分可用，按触发条件表落入 P2」），触发条件必须是可判定的布尔式；**(2) 探测未能执行**——WHEN TDX 配置入口不可达或 owner 不在场 THEN 报告写「未验证 + 阻塞原因 + 下一步」，决策节显式标注 change 4 被阻塞，MUST NOT 编造二选一。

#### Issue 5 (High): 没有时间盒与尝试次数上限，spike 可能无界膨胀并吞掉后续阶段
**Location**: `proposal.md:5,13`、`tasks.md:14-18,22-24`（全篇无预算）
proposal 只说「此刻验证改动面最小」，design/tasks 通篇没有时间预算、尝试次数上限或收敛规则。TDX 侧人工核对（2.1–2.4）+ 点击联动（3.1–3.2）在「配置入口未知」（design.md:88 Open Question 2）的前提下极易变成开放式探索——这正是 spike 型 change 最常见的失败模式（也是 AGENTS「阶段防呆」要防的：吞掉后续阶段）。
**Suggestion**: 在 `tasks.md` 顶部加「时间盒与收敛规则」段：总预算 ≤ 1 个工作日；单路径配置尝试 ≤ 3 次、每次 ≤ 15 min；超限即把该路径记为 FAIL 并进入下一路径；联动写法列举上限（如 ≤ 6 种）；到点即写报告，把未覆盖项原样落进「未决项」。再把这套规则写成设计的显式决策（如 D-9「收敛规则」），避免执行时靠自觉。

#### Issue 6 (High): 与 roadmap 阶段防呆/已拍板 E4 冲突——位置（M0?）与范围（选股语句方言）都对不上
**Location**: `proposal.md:5`（「M0 阶段」）、`design.md:22`（Non-Goal 排除方言）、`tasks.md:32`（回写阶段 2–3）；对照 `docs/roadmap.md:16,27,43,62`、`docs/architecture.md:55,59`
三处硬冲突：①「M0」在全仓只出现这一次（`proposal.md:5`），roadmap/architecture 用的是「阶段 1 骨架…阶段 6」，「M0」无定义、无法判读本 change 属哪个阶段；② roadmap 拍板清单第 E4 行（`roadmap.md:62`）写「spike 提前，**选股公式方言并入清单** = 是」，`roadmap.md:43` 亦写「E4 TDX 嵌入 spike（含选股语句方言，可提前）」，而本 change `design.md:22` 明确「不做…选股语句方言——属 E4/后续」——同一件事被同时裁决为「并入」和「排除」；③ roadmap/architecture 把「嵌入页」放在**阶段 6**（`roadmap.md:27`、`architecture.md:59`），tasks 4.5 却要求回写「阶段 2–3 的宿主 HTTP 面/嵌入页能力边界」，目标行不存在。另外本 change 实际吃掉了 stage 2 的撞墙内容（宿主 HTTP 面 + tokenized URL 鉴权，见 `architecture.md:55`、`roadmap.md:23`），却没有声明这是「阶段 2 的第一个切片」，于是可能出现 spike 的临时路由/认证代码与阶段 2 正式桥两套实现。
**Suggestion**: ① 删掉「M0」，改为「阶段 1 出口后 / 阶段 2 之前的可行性闸门」，并在 `roadmap.md` 增一行记录本 change 及其「横跨阶段 1→2」的定位；② 对 E4 方言二选一并改文档（本 change 纳入，或把 `roadmap.md:43,62` 的措辞改为「方言 spike 单列，可后置」），禁止两处并存；③ 把 tasks 4.5 的回写目标改为「roadmap 阶段 2 行 + 阶段 6 行 + architecture §4 表」；④ 明写探针路由是**临时/诊断资产**，阶段 2 的桥按其自身 design 重做（或反过来：把本 change 正式定名为阶段 2 的第一切片并加 SSE 之外的最小桥契约）。

#### Issue 7 (High): 探针页 HTML 不会进构建产物与发包白名单，真实安装下路由必然取不到页面
**Location**: `proposal.md:28`（新增 `src/client/probe/index.html`）、`tasks.md:5`；对照 `tsdown.config.ts:6-13`、`package.json:16-21`、`.gitignore:2`
`tsdown.config.ts:6` 的 `entry` 只有 `src/index.ts`，outDir `lib` 且 `clean: true`——HTML 不在模块图里，**不会被 emit**；`package.json:16-21` 的 `files` 只含 `lib`、`dsh.plugin.json`、`cordis.patch.yml`、`README.md`，即便手工放进 lib 也不在白名单；`.gitignore:2` 又忽略 `lib/`，仓库内不存在已构建资产。design D-2/tasks 1.3 把 HTML 当静态文件，路由按 `readFile` 取它 → 在插件以 `files` 白名单安装、从 `lib/` 运行时必然 ENOENT，探针页打不开，spike 会把「资产没打包」误判成「http 承载不可行」。
**Suggestion**: 二选一定案并写进 tasks：**(a) 内联为 TS 模板字符串**（推荐：零资产风险、`text/html` 直接 `res.end(PROBE_HTML)`，也顺带解决 Issue 12 的注入需求）；**(b) 构建期复制资产**（tsdown 复制步骤或自定义 build 脚本 + `files`/`.gitignore` 同步调整）。无论哪条，都加一条验收：「`pnpm build` 后从 `lib/` 启动宿主，`GET <basePath>/probe` 返回 200 + `text/html`」，并把它写进 tasks 4.6 的门禁或独立验收项。

#### Issue 8 (High): 路由 `kind` 未定——404 场景落不到插件，且与 change 4 的前缀注册互撞（重复 `(kind,path)` 直接抛错）
**Location**: `design.md:29`（D-1 只写 `GET <basePath>/probe`）、`tasks.md:4`、`spec.md:17-20`；宿主语义见 `deepseek-harness/packages/host/webserver/src/index.ts:166-173`、`packages/host/frontend-static/src/index.ts:121-139`
`WebRoute.kind` 只有 `'exact' | 'prefix'`，且 `register()` 对重复 `(kind, path)` **抛错**（webserver/src/index.ts:168-170）。design 通篇没写探针用哪种 kind，两种选择后果完全不同：**exact** → `<basePath>/xyz` 不命中任何命名路由，落到宿主 fallback；fallback 尝试从 dist 读该路径，读不到才 404（frontend-static/src/index.ts:96-103）——**这个 404 由宿主产生、不由插件产生**，spec 场景「不落入探针页或其它路由 → 404」在插件层面无法断言；**prefix** → 插件自己兜 404，但 change 4 之后**不能**再注册同路径 prefix（抛错），review-page 的 `<basePath>/review` 必须挤进本 change 的 handler（跨 change 隐式耦合）。
**Suggestion**: 在 D-1 明写每条路由的 `kind` 与路径所有权。建议：探针用 `kind: 'exact'` 且 `path: '<basePath>/probe'`，spec 场景改写为「未注册路径由宿主 fallback 决定（实测记为 404 或宿主 SPA 响应）」，并把该断言降级为手工/集成核对；同时在 D-1 声明「`<basePath>` 前缀命名空间在 change 4 前不被任何 prefix 路由占用」，作为给 change 4 的显式接口承诺。

#### Issue 9 (High): 「未认证 → 拒绝或跳转」与宿主事实不符，且 tasks 没写 handler 必须自己调 `requestRejection`
**Location**: `spec.md:12-15`、`tasks.md:9`；宿主先例 `deepseek-harness/packages/host/open-in-app/src/index.ts:184-204`、`packages/host/frontend-static/src/index.ts:88-89,136`
spec 场景写「按宿主认证策略处理（拒绝或**跳转**），响应状态非 200」。宿主上只有两条路径：`requestRejection` 返回 `401 | 403 | undefined`（`rpc-host.ts:104-107`，无跳转）；`authorizeIndex` 的 303 跳转只在 index 路径 + 单 token 时发生（`browser-auth.ts:238-263`，且 `frontend-static/src/index.ts:88-89` 只对 dist index 调用）。更关键的是：**插件路由不会被宿主自动鉴权**——同构先例 `open-in-app/src/index.ts:184-191,197,210` 就是自己调 `connectionOf(ctx).requestRejection(req)` 并写 401/403；better-sidebar 甚至自建 fence。tasks 1.7 只写「A 层 tokenized URL 支持」这类模糊表述，**没有一条任务要求 handler 首行做认证检查**，照此实现会是「路由对谁都 200」，spec 场景直接不成立。
**Suggestion**: spec 把「拒绝或跳转」改为「未认证 → 401（无有效 cookie）/ 403（Host/Origin 栅栏不过）」，并新增任务：「handler 首行 `const rejection = ctx.connection.requestRejection(req); if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }`」+ 单测断言两种拒绝码；同时注明 `requestRejection` 接受的是 `{ headers }` 结构体（`rpc.ts:214`、`ConnectionTrustRequest`），直接传 `req` 即可。

#### Issue 10 (High): 配置面归属冲突——`basePath` / `diagnostics.enabled` 需要 Config，但 change 2 已宣称「配置面首次落地」
**Location**: `design.md:29,81`、`tasks.md:4,9`（无任何 config 任务）；现状 `src/index.ts:20-25`（只有空 `TraderKitConfig {}`，无 `export const Config`）、`cordis.patch.yml:10-14`（无 `config` 段）；对照 `openspec/changes/data-foundation/proposal.md:14`
design D-1 用「`basePath` 默认 `/dsh-trader-kit`」、Migration 又要求「配置 `diagnostics.enabled`，默认 true」，但 tasks 里**没有一条**创建 `Config` schema / `config` 段的任务；而 change 2 的 proposal 明确宣称「`src/config.ts`…`cordis.patch.yml` **首次出现** `config` 段」。两个 change 都依赖配置面、都（不）声称首次，结果是实现时要么本 change 静默引入配置面（打脸 change 2 的表述），要么 `basePath`/`diagnostics` 悬空无法配置。
**Suggestion**: 在 `proposal.md` Impact 与 tasks 中显式定案：本 change 只引入**最小** Config（`basePath: string`（默认 `/dsh-trader-kit`）+ `diagnostics.enabled: boolean`）并同步修改 `data-foundation/proposal.md:14` 的「首次落地」措辞；或者本 change 不带配置面（`basePath` 写成常量、诊断页常开），把配置面整体留给 change 2。二者取一，并补 `cordis.patch.yml` 示例行。

#### Issue 11 (High): 端口与登录 URL 的取得方式缺失，人工核对清单（TDX 侧）没有可执行的输入
**Location**: `design.md:37,49`、`tasks.md:14,16`（`http://127.0.0.1:<port>/...` 占位符）
三处人工步骤都要求 owner 在 TDX 里填 URL，但全 change 没有任何任务产出**具体 URL**：`<port>` 始终是占位符。宿主能力其实齐备——`webServer` 有公共 `port`/`host` getter（`deepseek-harness/packages/host/webserver/src/index.ts:150-158`，`config.port` 可配 0 = 由 OS 分配，见 :59-63 与 `cordis_inspect` 的 `include:webserver` schema），官方先例也是这么打印 URL 的（`packages/bundle/web-app/src/index.ts:149-153,261-271`，并注册了 shell 变量 `DSH_WEB_URL`，:242-249）。本 change 既没用 `ctx.webServer.port`，也没用 `$DSH_WEB_URL`。
**Suggestion**: 新增任务（并入 1.1 或单列）：「挂载时经 `ctx.logger`/`console` 输出三行：base URL = `http://127.0.0.1:${ctx.webServer.port}`、登录 URL = `ctx.connection.authenticatedUrl(base + '/')`、探针 URL = `base + '<basePath>/probe'`」，并把「记录本次实际端口与三行 URL」写进 tasks 2.1 人工核对清单首项；同时说明端口来自 `include:webserver` 配置（可能为 0/随机），避免复现时端口漂移。

#### Issue 12 (Medium): 「静态单文件」与 spec 要求的「当前请求认证判定结果」自检项自相矛盾
**Location**: `spec.md:5`（自检输出含「当前请求的认证判定结果」）、`design.md:31-33`
design D-2 定死「原生单文件 HTML…所有资源内联」；但浏览器侧页面**无法得知服务端的认证判定**（cookie 是 `HttpOnly`，`browser-auth.ts:122`，JS 读不到；也无法自证「服务端认为我认证通过」）。要实现该自检项，路由必须按请求把判定结果注入响应（模板替换/注入一段 JSON），这会推翻「纯静态文件」的实现假设，且必须同时声明 `cache-control: no-store`（否则缓存会把别人的判定结果发给下一个请求）。
**Suggestion**: 在 D-2 明确「静态骨架 + 请求时注入一处 `window.__PROBE__ = {auth: 'cookie'|'token'|'none', ...}`」，或删掉该自检项（改为「能打开页面即隐含认证通过」）。若保留注入，补 `no-store` 与注入点转义（防注入）要求，并加一条单测/验收。

#### Issue 13 (Medium): 「内核能力未知」的保守假设与 design 自己的基线证据自相矛盾，且没有任务把基线语法清单沉淀为下限
**Location**: `design.md:6`（TDX 现网基线）vs `design.md:33`（「内核版本未知…只用 ES5–ES2017 安全子集」）、`tasks.md:18`
design:6 已实测同一台机器的被替换页面 `D:/TDX_HOME/webs/company/同花顺涨跌停原因.html`（本评审已核验该文件存在），其代码使用 `await fetch`（:310,334-335,405-406）、模板字符串（:405）、箭头函数（:478,526）、`Promise.all`（:442）——即该内嵌内核**至少**支持 ES2017 + Fetch + Promise。design:33 却把内核写成「未知」并据此设限，浪费了手边最便宜的下限证据；同时 tasks 1.3 也没有要求把基线页的语法/特性清单记入报告，导致「内核能力」这一维度在报告里仍是猜测。
**Suggestion**: 在 design Context 增加一行「已证下限：基线页使用 ES2017+Fetch+Promise（引用其行号）」，把 D-2 的语法约束改为「≤ 基线页所用语法级别」，并在 tasks 1.3/4.1 增加「报告记录基线页语法清单 + 探针页特性探测结果，二者对照」。这样「内核能力」与「承载形态」的变量分离（D-2 的正确意图）才有事实锚点。

#### Issue 14 (Medium): 报告复现前提缺 DSH 宿主版本；`engines.dsh` 下限未针对本 change 依赖核验
**Location**: `spec.md:62`（只要求 TDX 版本 + 内嵌内核版本）、`design.md:5`；对照 `dsh.plugin.json:6-8`、`AGENTS.md:49-50`
本 change 的全部技术前提都压在宿主实现细节上：`webServer` 的 `port` getter、`connection.requestRejection` 的 cookie 语义、cookie 的 `SameSite=Strict`、`authorizeIndex` 只在根路径换 token。这些行为随宿主版本变化（`dsh.plugin.json:6-8` 的下限是 `>=0.1.5-rc.1`），但 spec 的「结论可复现的前提」只列 TDX 与内核版本，**没有宿主/SDK 版本**；AGENTS 也明确要求「宿主与 SDK 版本以当前实际安装核验，不硬编码旧版本」。
**Suggestion**: 在 spec:62 与 tasks 4.1 增加：「记录 DSH 版本 + `@deepseek-ai/dsh-host-webserver` / `dsh-client-connection` 的实测版本与关键实现行号」，并在 tasks 4.2 决策节写明「本结论适用的宿主版本范围」；同时核验 `>=0.1.5-rc.1` 是否已包含 `webServer.port` 与 `connection.requestRejection`，不足则抬高下限。

#### Issue 15 (Medium): 诊断页「保留 + 默认开启」缺 spec 承载与安全面结论
**Location**: `proposal.md:14`、`design.md:29,81`；spec 全文无对应 Requirement/Scenario
proposal/design 决定「spike 后不回滚，转为诊断页（配置可关），默认 true」，但 spec 的四个 ADDED Requirement（spec.md:3,22,46,60,79）没有任何一条覆盖「诊断页常驻及其开关」；对照同类 change，review-page 的 spec 就为页面生命周期专门写了 `Scenario: 路由随插件生命周期`（`review-page/specs/review-page/spec.md:22-25`）。默认开启意味着一个长期存在的路由（含 C 层可能性下的未认证只读面）被静默留在产品里。
**Suggestion**: 增加 Requirement「诊断页可配置关闭」+ 两条场景：`配置关闭 → 路由返回 404、无残留 handler`、`默认值及其认证姿态（默认 true 且始终走 requestRejection）`；把默认值决策写成 D-9 并说明理由（排障复用 vs 攻击面最小化）。若 owner 倾向最小面，改为默认 false。

#### Issue 16 (Medium): 单测落点与「零 mock」纪律在依赖宿主 service 的路由上不可执行
**Location**: `tasks.md:10`（1.8 单测：路由注册/卸载、404、传参优先级…）、`vitest.config.ts:5`（`test/**/*.test.ts`）、`src/index.ts:23-25`
tasks 1.8 要求零 mock 单测「路由注册/卸载」与「404」，但这些行为**只存在于宿主 webServer 内部**（`register` 返回 disposer、重复注册抛错、未命中落到 fallback），本仓没有该实现、也没有宿主包依赖（`package.json:30-44` 里没有 `@deepseek-ai/dsh-*`）。现有 smoke test 之所以能零 mock，是因为 `apply` 是 no-op（`test/smoke.test.ts:15`）；接入 `inject`/路由后，同一个 `apply({} as never)` 会立刻失效。当前写法会让实现者只能二选一地违规：要么给 ctx 打桩（违反零 mock），要么把断言降级为主观人工核对。
**Suggestion**: 在 tasks 中先定测试 seam：把探针 handler 提取为纯工厂 `createProbeHandler(deps): WebRoute['handler']`，对「传参解析/代码合法性/认证拒绝码/404 分支」用**真实 `node:http` req/res 桩对象 + 真实临时 HTTP server** 测（沿 `data-foundation/design.md:74` 的「真实本地服务桩」先例）；「路由注册/卸载」明确标注为集成核对（起真实宿主或用 `ctx.effect` 的 disposer 契约做结构断言），不要写成「零 mock 单测」。

#### Issue 17 (Medium): 证据材料无脱敏规则，截图入仓可能带出账户/持仓信息
**Location**: `design.md:69`（D-8：截图等二进制可放 `docs/spikes/assets/`）、`proposal.md:13`
TDX 截图天然包含账户/资金/自选股/持仓等信息。D-8 只说「或仅记录路径不入库」，没有任何脱敏要求；AGENTS 的安全红线（不内置密钥、输出仅研究辅助）与仓库卫生都要求可提交材料不泄露账户面。
**Suggestion**: D-8 增加硬约束：「入库截图 MUST 先裁剪/遮盖账户、资金、持仓、自选股等个人金融信息；无法脱敏者只记录本地路径不入库」，并在 tasks 2.5 的归档项写明脱敏检查。可选：默认只入库文本证据（UA、请求头、返回码、时间戳）。

#### Issue 18 (Medium): 「首位风险 §11」「P1/P3 现场原则」「F5」等关键依据不可核验，且无归档任务
**Location**: `proposal.md:3`、`design.md:8`、`tasks.md:24`
proposal 的 Why 完全建立在「需求文档 §11 已把它列为首位风险（…→ P1/P3 现场原则落空）」之上，tasks 3.3 又以「对 F5 盘中页面与 P3 零切换原则的影响」为交付内容；但本仓与 `dsh-trading` 都检索不到这些文档（见文末「未能核验」），vault 侧不可访问。第三方（或三个月后的自己）无法判断 §11 原文、P1/P3/F5 的定义与优先级，报告里的「受影响范围」也就无法被复核。
**Suggestion**: 在 change 内（proposal 或报告附录）**引述** §11 相关原文与 P1/P2/P3/F5 的定义片段，或把这些需求文档切成入库副本（`docs/requirements/`）；tasks 4.1 增加「报告含依据原文摘录与出处（文件 + 版本/日期）」。

#### Issue 19 (Suggestion): 宿主源码引用精度与本仓不可解析的路径形态
**Location**: `design.md:5`（`packages/host/webserver/src/index.ts:160`）
行号指向的是 `register` 的 JSDoc 起始行，`register` 实体在 `:166`（本评审已在 `deepseek-harness/packages/host/webserver/src/index.ts:160-173` 核验）；同句另两处引用是精确的（`browser-auth.ts:15` = `TOKEN_QUERY`，`:223-280` = `authenticatedUrl` + `authorizeIndex`）。另外 `packages/...` 这一形态在本仓不可解析（本仓无该目录），第三方复核需要额外知道是哪个检出。
**Suggestion**: 改为 `:166`，并把源码引用统一写成「<DSH 检出>/packages/...」并在报告里记下检出路径与版本，便于复核（见 Issue 14）。

### Evidence Ledger（核验清单）

**已核验为真（逐条读过宿主源码 / 实时 Service 目录）**
- `ctx.webServer.register({kind, path, handler})` 存在；`kind ∈ {'exact','prefix'}`；重复 `(kind,path)` 抛错：`deepseek-harness/packages/host/webserver/src/index.ts:166-173`；实时 Service 目录（`cordis_inspect` host/Service）描述与签名一致。
- `webServer.port` / `webServer.host` 公共 getter 存在：同文件 `:150-158`；第三方包已如此使用（`packages/bundle/web-app/src/index.ts:150,265`）。
- `ctx.connection` 的公共面 = `rpc/fetch/operator/createSharedFetchHandler/requestRejection/admit/authorizeIndex/authenticatedUrl`：`packages/client/connection/src/rpc.ts:193-238`（与实时 Service 目录逐条一致）；**无 token 校验原语**。
- `requestRejection` = Host/Origin 栅栏 + cookie 校验，返回 401/403/undefined；插件须自己调用（先例 `packages/host/open-in-app/src/index.ts:184-191,197`）：`packages/client/connection/src/rpc-host.ts:104-107`。
- cookie 只在 `GET /` + 单个 token 时铸造并 303 到 `./`；`isAuthenticated` 只读 cookie；cookie 名绑定 authority；属性 `HttpOnly; SameSite=Strict`（无 `Secure`）：`browser-auth.ts:106-108,121-122,223-227,238-300`。
- 未注册路径由宿主 fallback 处理，dist 读不到才 404：`packages/host/frontend-static/src/index.ts:88-105,121-139`。
- 登录 URL 的官方打印方式与 `$DSH_WEB_URL` shell 变量：`packages/bundle/web-app/src/index.ts:149-153,242-249,261-271`。
- `include:webserver`（`@deepseek-ai/dsh-host-webserver`）Config schema 含必填 `host`/`port`（port 允许 0）：`cordis_inspect` host/Config。
- TDX 基线页真实存在且与 design:6 描述一致：`D:\TDX_HOME\webs\company\同花顺涨跌停原因.html`（`window.location.hash` :293、`hashchange` 监听 :589、第三方 `fetch` :309-419；语法级别 ES2017+）。
- `DSH-better-sidebar` 的 fence 先例真实存在，且自述「不是认证」，并拒绝 `Sec-Fetch-Site: cross-site` 与 `Origin: null`：`DSH-better-sidebar/src/trust-fence.ts:1-9,63-83`；其插件路由自己 `ctx.effect(() => ctx.webServer.register({...}))`：`src/index.ts:83,884`。
- 本仓现状：`src/index.ts` 为阶段 1 no-op（`:23-25`），无 `src/routes/`、无 `src/client/probe/`、无 `export const Config`；`cordis.patch.yml` 无 `config` 段；`package.json:16-21` 的 `files` 与 `tsdown.config.ts:6-13` 的 entry 决定 HTML 不会被打包；`test/` 只有 `smoke.test.ts` 与 `chart/intraday-series.test.ts`；`reviews/`、`docs/spikes/` 目前不存在（本评审创建 `reviews/spike-tdx-embed-review.md`）。

**未能核验**
- 已安装运行时 asar 内的源码：`...\resources\app.asar\dsh\...` 在文件系统层面不可读（glob 报路径不存在）。本评审改用本机 DSH 源码检出 `E:\work\code\open\deepseek-harness` 逐行核验；**该检出与已安装 `0.1.5-rc.1` 的版本等价性未能核验**，但 `cordis_inspect` 的**实时** Service 契约（webServer/connection 的签名与描述）与检出源码一致，故行为级结论有双重锚点。
- `需求文档 §11`、`需求描述-复盘卡片MVP`、`需求描述-盘面数据组件`、`模块文档 §7/§9`、以及 P1/P3 现场原则、F5 盘中页面：本仓与 `dsh-trading` 全库检索均无此文件，vault 侧检索被权限拒绝（`...\remotely-save\finance\.agent_memory\*` 访问被拒），故这些引用**无法第三方复核**（见 Issue 18）。

### Positive Aspects

- **spike 纪律方向正确**：显式区分「已验证 / 人工核对确认 / 未验证」三态（`design.md:75`），要求「不能自动断言的部分标人工核对项」（`design.md:61`、`spec.md:48`），并禁止报告以「待定」收尾（`spec.md:62`）——这正是沿 `docs/carryover.md:73-74` 的 spikes/ 证据纪律，比多数 spike 计划扎实。
- **变量分离思路正确**：D-2 明确把「内核能力」与「承载形态」拆开，避免「语法不兼容 → 误判 http 不可行」（`design.md:33`）；这是本设计最有价值的判断，只需补上基线页这个现成下限证据（Issue 13）。
- **安全红线守住了**：不写数据根/vault、不调行情与交易接口、证据材料只落 `docs/spikes/`（`spec.md:79-91`、`design.md:69`），且把 C 层降级方案绑定到 owner 签字 + 只读能力（`design.md:41`）。
- **范围收敛**：Non-Goals 明确把 review 页面本体、数据面、skill 安装器、方言探索排除在外（`design.md:20-24`），并点名最大风险「顺手做 review 页面」（`design.md:77`）。
- **宿主事实大体核验过**（这点优于同批其它 change）：D-1/D-3 引用的 `webServer.register`、`connection.requestRejection/authenticatedUrl`、`authorizeIndex`、`trust-fence.ts`、TDX 基线页**全部真实存在**，只有行号与「A 层怎么用」出了错（Issue 1/18）；说明是**推导**而非**引用**环节失守，修起来成本低。
- **跨 change 接口意识**：D-1 主动声明与 change 4 同前缀（`design.md:29`），proposal Impact 也点明结论要回写 roadmap 的阶段 2–3（`proposal.md:31`），只是回写目标写错了行（Issue 6）。

### Summary

Top 3 关键问题：
1. **Critical — A 层认证流程与宿主实现相反**：`?token=` 只在 `GET /` 铸造 cookie（`browser-auth.ts:238-264`），指向 `/probe?token=` 必然 401；按现设计执行会得出「TDX 不接受 tokenized URL」的**假结论**，并直接把 change 4 推向削弱认证的回退分支。
2. **Critical — 回退矩阵不闭环且错误下沉**：B 层（每请求 token）在宿主 `connection` 上没有可用的校验原语，P2/P3 又被 design 自己引用的 trust-fence（拒 `Origin: null` / `cross-site`）与 cookie 的 `SameSite=Strict` 挡死；同一处错误已被 `review-page/design.md:49` 继承。
3. **Critical — 退出判据不可判定**：强制二选一（`spec.md:62`）+ 无「部分成功」定义 + 无「探测无法执行」出口 + 无时间盒（`tasks.md` 全篇），spike 的结论质量完全依赖执行者自觉。

紧随其后的高危项：**探针 HTML 不进构建/发包白名单**（Issue 7，会让 spike 直接跑不起来并触发误判）、**路由 `kind` 未定与 change 4 前缀互撞**（Issue 8）、**spec 要求「未认证非 200」但没有任务让 handler 调 `requestRejection`**（Issue 9）。

**Consensus Status**: NEEDS_REVISION

---

## Round 2 — 2026-09-27

### Overall Assessment

修订是本批 change 中最扎实的一轮：Round 1 的两条 Critical（A 层认证流程、B 层无 API、P2/P3 归因、退出判据、时间盒、探针打包）在正文里都有对应的具体文字，且我逐条复核了宿主实时 Service 契约与源码，修订对宿主的描述**这一轮是对的**（A 层两步不仅「更正确」，而且是唯一合法路径：`authorizeIndex` 读真实 `req.url`/`req.method`，插件自调也无法在 `/probe?token=` 上铸 cookie）。但「部分成功」这条最可能出现的真实结果仍没有终局决策映射，A 层 cookie 失效后 change 4 的**写接口认证机制全 change 未定义**（而 change 4 明写写接口必须认证、且仍按旧语义引用 B 层），再叠加 proposal 在 404 归属上回退到 Round 1 Issue 8 的错误自述、以及 Config 在 change 1/2/3 三处落点与所有权互撞，本 change 尚不能作为下游可靠输入。

**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | A 层 `?token=` 打在 `/probe` 永不生效 | 已解决 | design D-3 第 1 项两步（根 `/?token=` 铸 cookie + 303 → 导航 `<basePath>/probe`）、proposal:11、spec:36 + 负向场景 spec:17-20、tasks 2.1；复核 `browser-auth.ts:238-280` 确认两步为唯一合法路径（见 Positive） |
| 2 | B 层无宿主 API 可落地 | 部分解决 | D-3 第 2 项 + spec:37 已改为插件自有诊断 token（来源/有效期/作用域/URL 明文四项边界 + 业务写入 MUST NOT 依赖）；但仅本 change 内闭合：`review-page/design.md:62,246` 仍按旧语义写「每请求带 token（B 层）= 认证」，且 A 失效后写接口认证机制未定义（见 R2-3） |
| 3 | P2/P3 被 `trust-fence` / `SameSite=Strict` 否掉、无跨源测试项 | 已解决 | design:101-106 预写两条障碍；D-4 矩阵 P2/P3 行要求实测 `Origin`/`Sec-Fetch-Site`/`Sec-Fetch-Mode`/响应码/cookie/预检；spec P2/P3 场景；tasks 2.2/2.3；C 层放宽点须显式定义并申报 |
| 4 | 退出判据不可判定（无部分成功/无不可执行出口） | 部分解决 | D-7 三态表 + 部分成功布尔式 + 「探测不可执行」出口 + spec 5 场景已落地；但决策规则只有「可行→http」「P1/P2 均不可行→file://」，**「受限」无终局映射**（见 R2-4） |
| 5 | 无时间盒与尝试次数上限 | 已解决 | D-9 表 + tasks §0 + spec「时间盒与收敛规则」；三处数值一致（30 min / 10 min / 3 次 / 6 种 / 2 h） |
| 6 | M0 无定义、E4 方言冲突、回写目标错行 | 已解决 | proposal:5 改「阶段 1 出口后 / 阶段 2 之前」；`roadmap §5` 已登记阶段 2 桥取消与 E4 未落地；tasks 4.6 目标 = 阶段 6 行 + 阶段 2 行 + architecture；4.9 登记 E4 移交；D-1 声明临时/诊断资产 |
| 7 | 探针 HTML 不进构建产物/发包白名单 | 已解决 | D-2「构建与发包」定案内联 TS 模板字符串（落 entry 模块图）+ `package.json#files`/`.gitignore` 断言 + spec 场景 + tasks 1.10（从 `lib/` 起测 200 + 非空 HTML） |
| 8 | 路由 `kind` 未定、与 change 4 前缀互撞 | 部分解决 | design D-1 表格 + spec 5 场景（`exact`、401/403、404 降级为集成核对、不占用 prefix）已定案；但 **proposal:9 回退**为「未注册路径 404 均由插件自行返回，不依赖宿主 fallback」，与 design:54 / spec:25 直接矛盾（见 R2-1） |
| 9 | 「拒绝或跳转」与宿主事实不符、无 `requestRejection` 任务 | 已解决 | spec:15 改 401/403；D-1:57 写死 handler 首行代码；tasks 1.5 单测两种拒绝码。实时 Inspect 复核：`ConnectionTrustRequest = { headers }`、返回 `401\|403\|undefined`，传 `req` 成立 |
| 10 | 配置面归属与 change 2 冲突 | 部分解决 | D-1:61-70 定案最小 Config + `cordis.patch.yml` 示例 + tasks 1.1；但只把 `data-foundation/proposal.md` **措辞**列为移交（tasks 4.7），change 2 tasks 1.1 / change 3 D-13,tasks 4.1 的文件落点、所有权与依赖链未修（见 R2-2） |
| 11 | 端口与登录 URL 取得方式缺失 | 已解决 | D-1「URL 打印」+ tasks 1.1/2.1；复核 `webserver/src/index.ts:151 get port()` 存在，实时 Inspect 亦见 webserver Service |
| 12 | 静态单文件 vs 认证判定自检矛盾 | 已解决 | D-2「静态骨架 + 请求时注入 `window.__PROBE__`」+ `no-store` + 转义；tasks 1.4；spec:5,48。残留：注入枚举缺 B 层取值（R2-8） |
| 13 | 内核能力假设与基线证据矛盾 | 已解决 | Context「已证下限 ES2017 + Fetch + Promise」+ D-2 语法上限锚定基线页 + tasks 1.3/4.1 对照要求 |
| 14 | 复现前提缺 DSH 宿主版本 | 已解决 | D-7「复现前提」+ spec Requirement + tasks 4.1/4.2（含 `engines.dsh` 下限核验）；Open Questions 6 保留版本等价性未核验 |
| 15 | 诊断页常驻缺 spec 承载与安全面 | 已解决 | 新增 Requirement + 3 场景 + D-1 Config + Open Questions 7（默认 true 理由）。残留：关闭态断言不成立（R2-5） |
| 16 | 零 mock 单测在宿主路由上不可执行 | 已解决 | D-10 纯工厂 seam + 真实 `node:http` 桩/临时 server + 「注册/卸载 = 集成核对」；tasks 1.2/1.9 拆分。残留：与 `§7` 出站通道口径需对齐（R2-7） |
| 17 | 证据无脱敏规则 | 已解决 | D-8 脱敏硬约束 + spec Requirement + tasks 2.6 |
| 18 | 「§11 / P1-P3 / F5」不可核验、无归档任务 | 部分解决 | proposal Why / Context 已标「仓外文档，未能核验」，spec 场景与 tasks 4.1/3.3 要求摘录；但摘录来源恰被声明不可得，无仓内副本兜底，且该场景挂错 Requirement（R2-9） |
| 19 | 引用精度与不可解析路径形态 | 已解决 | Context 改为「符号名 + 已核验（本机检出路径，版本等价性未核验）」两节；但新引入两处坏引用（R2-9） |

### Issues

#### R2-1 (High): proposal 把「未注册路径 404」写成插件自产，回退到 Round 1 Issue 8 的错误认识
**位置**: `proposal.md:9` vs `design.md:54,57`、`spec.md:22-25`、`tasks.md:24`
proposal 写「未认证 401/403、**未注册路径 404 均由插件自行返回，不依赖宿主 fallback**」；而 D-1 表格明写 `<basePath>` 下未注册路径由**宿主 fallback**产生（404 或宿主 SPA 响应），D-1:57 更以 MUST NOT 禁止依赖它就 404 作断言，spec:25 已把该断言降级为集成核对。实时 Inspect 亦确认 fallback 座位由 SPA dist server 持有。proposal 是 openspec 的规范文档之一，此句会诱导实现者加 `prefix` 路由去「自产 404」——那正是 spec:30 明文禁止（"本 change MUST NOT 占用任何 `prefix` 路由"）且会与 change 4 的 `<basePath>/review` prefix 注册抢占命名空间。
**建议**: 把 proposal:9 改为「未认证 401/403 由插件 handler 产生；未注册路径由宿主 fallback 决定（实测记录，插件只断言不落入探针页）」，与 design/spec 逐字对齐。

#### R2-2 (High): 最小 Config 在 change 1/2/3 三处落点与所有权互撞，移交清单只覆盖了「措辞」
**位置**: `spike-tdx-embed/design.md:61-70`、`tasks.md:17-20,132` vs `data-foundation/tasks.md:1.1`、`data-foundation/proposal.md:17`、`tq-skill-installer/design.md:222`、`tq-skill-installer/tasks.md:3,116-119`
本 change 在 **`src/index.ts`** 落地 `export const Config`（`basePath` + `diagnostics.enabled`）并自称「配置面首次落地」；change 2 tasks 1.1 仍要新建 **`src/config.ts`** 导出 `Config`（`dataRoot`/`sources`/`guard`/`diagnostics.probe.*`/`tdx17709.*`）并要求「处置既有 `src/index.ts` 的 `TraderKitConfig`，MUST NOT 留两份配置类型」——本 change design:64 恰好把该类型原样扩写为 `export interface TraderKitConfig`；change 2 proposal:17 仍称「配置面首次落地 / `cordis.patch.yml` 首次出现 `config` 段」；change 3 D-13 与 tasks 4.1 仍声明「`Config` 由 change 2 首次引入」并把 `blocked_by` 指向 change 2。tasks 4.7 的移交清单只写了「`data-foundation/proposal.md` 的『配置面首次落地』措辞」——**文件落点（`src/index.ts` vs `src/config.ts`）、`TraderKitConfig` 去留、`diagnostics` 键归属（诊断页开关 vs 17709 探测开关）、change 3 的依赖对象**四处均未列入。结果是三份 change 在实现期必然撞车，且 change 2/3 的 `blocked_by` 图会指错对象。
**建议**: tasks 4.7 扩为四项显式移交：① change 2 tasks 1.1 的落点改为「扩展 change 1 引入的单 `Config` 根（或本 change 迁至 `src/config.ts` 并以自己的文件为其唯一 owner）」，② `TraderKitConfig` 去留与本 change 一致，③ `diagnostics` 下两个子键命名区分（如 `diagnostics.page.enabled` vs `diagnostics.probe.*`），④ change 3 的 `Config` 依赖对象改为「change 1 引入、change 2 扩展的同一根」。若 owner 不接受跨 change 改写，则本 change 退化为常量 + 诊断页常开（原 Open Questions 7 的备选），从根上消除撞车。

#### R2-3 (High): A 层 cookie 失效时 change 4 的写接口认证机制全 change 未定义（安全缺口跨 change 传导）
**位置**: `design.md:96,99,191`、`spec.md:37,53,58,102`、`tasks.md:39`、`4.4`；下游 `review-page/design.md:62`
spec:37 与 tasks 1.6 明写「业务写入 MUST NOT 依赖 B 层（URL 明文）」，C 层只授予只读诊断，design:99 只说「业务写入仍走认证路径」——但该「认证路径」就是 A 层 cookie；而 A 层本身是未实测项（cookie 存活未验证，D-3:94）。若实测结论为「cookie 不存活」，change 4 的 `POST /api/card` **没有任何可用认证机制**：B 层被本 change 禁用于写入，C 层只读，而 change 4 `design.md:62,246` 又规定写接口「无论采用哪种承载分支都必须认证」并把「每请求带 token（B 层）」当作 cookie 失效时的答案。D-7 的决策规则与 spec:102 的降级路径清单都没有把「写接口认证可行性」列为必须输出的结论项。
**建议**: 把「写接口认证」升为 D-7 决策表的**必输出项**（独立于诊断页），并预置可判定分支：A 层 cookie 为写接口硬门槛（cookie 不存活即写路径 FAIL → 显式阻塞 change 4 写能力）；或采用一次性短时效签名 token（D-3:106 的选项③）并明确 owner 签字与作用域。同时把 tasks 4.7 的 B 层移交项扩为「诊断页用 B 层 / 写接口用 <结论所指机制>」。

#### R2-4 (Medium): 决策规则对「受限」没有终局映射，最可能的真实结果仍是不可判定
**位置**: `design.md:140-142`、`spec.md:160-164`
D-7 的「部分成功量化」只定义了「受限」的**入判**（可判定布尔式），而「决策规则（两条出口）」只覆盖「P1（或 P2）判**可行** → 采用 http」与「P1、P2 均判**不可行** → 回退 file://」。于是「P1 渲染/认证 PASS、传参或联动受限」这类最可能的结果既不落 http 出口也不落 file:// 出口；spec:163 更只说「落入下一候选路径」，未规定当三条路径都停在「受限」时如何收尾——Round 1 Issue 4 的核心（结论不可判定）并未完全闭合。
**建议**: 在 D-7 决策规则补第三态映射，例如「P1 受限且渲染+认证 PASS → 决策仍为采用 http 同端口页面，并在结论节逐条列出受限点与 change 4 的相应降级要求；仅当所有路径均不可行或受限点命中 change 4 的 P1（现场即时）判据时，才回退 file://」；并把「三条路径均受限」的收尾写成一条 MUST。spec 同步补场景。

#### R2-5 (Medium): 「诊断页关闭」的「非 200 / 401·404 之一」断言不可判定，且与 D-1 表格自相矛盾
**位置**: `spec.md:134,136-139` vs `design.md:54`
spec:134 要求关闭时「返回 401/404 之一且无残留 handler」，spec:139 又要求「不再由插件响应（**非 200**）」；但关闭 = 不注册路由，该请求落到宿主 fallback，而实时 Inspect 明确 fallback 由 **SPA dist server** 持有（"the fallback handler answers every request no named route matches (the SPA dist server in the shipped Web composition)"），SPA 型 fallback 完全可能以 200 返回 index.html。D-1 表格自己也写「未注册路径 → 宿主 fallback → 实测记录为 404 或宿主 SPA 响应」。这是 Round 1 Issue 8 同类缺陷（把宿主产生的响应写成插件断言）。
**建议**: 改为「关闭时不注册探针路由，插件层面断言『不由插件 handler 响应、无残留 handler』；实际状态码由宿主 fallback 决定，登记为集成核对项」，并删去「非 200」这一未经实测的断言（tasks 1.2 的验收口径同改）。

#### R2-6 (Medium): tasks 1.7 的 C 层开关没有配置面——D-1 把 Config 钉死为两项
**位置**: `tasks.md:41-44` vs `design.md:61-68`
task 1.7 要求 C 层「默认关闭，需**显式配置**且 owner 签字后才可开启」，但 D-1 定案 Config「**仅含两项**」（`basePath`、`diagnostics.enabled`），proposal:29 亦同。该开关既无字段也无取值/校验规则，实现者只能自造（丢进 `diagnostics`？环境变量？代码常量？）——一个涉及「未认证 loopback 只读」的安全开关落成自由形态，默认值语义也不可验收。
**建议**: 在 D-1 与 proposal:29 明确该开关的字段名、默认值与校验（例如 `diagnostics.unauthenticatedReadOnly: boolean` 默认 `false`，且开启需 owner 签字记录），或明写「C 层不是配置项，而是代码常量 + 签字后才可改动」，并同步 tasks 1.7/1.2 的验收断言。

#### R2-7 (Medium): D-10 的「真实临时 HTTP server」测试 seam 与 `§7` 的两条具名出站通道口径未对齐
**位置**: `design.md:166-172`、`tasks.md:49-52` vs `docs/design/iteration-1-contracts.md §7`、`review-page/design.md:198`
`§7` 规定「全仓**仅两条具名出站通道**允许 `fetch(` / `http.request`：`src/data/http.ts` 与 `src/skill/download.ts`」，change 4 更把它写成「除 `src/data/http.ts` 外，**全仓零** `fetch(` / `http.request` 调用点」的结构断言（含「扫描目标非空」防空过）。D-10 要求用「真实 `node:http` 请求/响应桩对象 + 真实临时 HTTP server」测 handler——一旦用 `fetch`/`http.request` 驱动该 server，就会在 `test/**` 里出现第三个调用点，直接触红下游的结构断言；探针页内联 JS 若出现 `fetch(` 字面量，同样会被文本型扫描命中。
**建议**: 在 D-10 明写与 `§7` 的边界：结构断言的作用域为 `src/**`（或显式豁免 `test/**` 与内联 HTML 常量），测试侧驱动方式选定（如 `node:net` 裸 socket 或直接调用 handler 并构造 `IncomingMessage` 桩），并把该口径作为 `§7` 的补充条目登记（跨 change，走 tasks 4.7 的移交清单）。

#### R2-8 (Low): 注入状态枚举缺 B 层取值，且 `'rejection'` 永不可观测
**位置**: `design.md:82`、`spec.md:5,48`
注入值为 `auth: 'cookie'|'rejection'|'none'`。但拒绝分支在 handler 首行就 `res.end()` 返回（D-1:57），页面根本不会渲染 → `'rejection'` 是不可达取值；同时 B 层（插件 token 校验通过 200）没有对应取值，页面只能显示 `'none'` 或 `'cookie'`，使 A/B 两层在证据上无法区分（spec:48 也只断言 `auth === 'cookie'`）。
**建议**: 改为 `auth: 'cookie'|'diagnostic-token'|'none'`（拒绝态由状态码与 no-store 响应本身作证），并在 spec 的 B 层场景补 `window.__PROBE__.auth === 'diagnostic-token'` 断言。

#### R2-9 (Low): 三处坏引用 / 措辞不一致 / 场景错位（Round 1 Issue 18/19 的残留）
**位置**: `design.md:70`、`design.md:212`、`spec.md:120,130`、`spec.md:199-202`、`tasks.md:99-102,106`
① design:70（配置面移交）写「见 tasks **1.9** 与 **D-12**」——tasks 1.9 是单测，本 change 的决策只到 D-10，**D-12 是 review-page 的决策号**（正解为 tasks 4.7）；② 评审处置表写「下游 `review-page/design.md:49` 的 B 层表述需同步」，而该文件 :49 是资产形态段，B 层原文在 :62 与 :246——Round 1 Issue 19 的「行号失真」同类缺陷被重新引入（`§8` 已要求符号名/稳定引用）；③ 同一三值结论在 spec:120 / design D-7 作「不可行」，spec:130 与 design D-6 作「不可用」，验收措辞不统一；④ spec:199-202「依据原文摘录可复核」挂在 Requirement「探测不触碰业务数据与证据脱敏」下，属错位；且 tasks 3.3/4.1 要求摘录的正是被声明「不可核验」的仓外文档，无仓内副本兜底（Issue 18 的实质残留）。
**建议**: 修正为 tasks 4.7 + 符号名/章节引用；统一用「可行 / 受限 / 不可行」；把摘录场景移入「可行性结论与退出判据」Requirement；并把「§11/P1-P3/F5 无仓内副本时，报告以『未能核验 + 缺失项清单』收尾」写成可判定出口。

### Positive Aspects

- **A 层修订不仅正确，而且是唯一合法路径**（本轮复核宿主源码）：`authorizeIndex`（`browser-auth.ts:238-280`）从**真实请求**取 `req.url` 与 `req.method`（`new URL(req.url ?? '/', ...)`），并要求 `url.pathname === '/'` 且 token 恰一个才铸 cookie；即便插件在自己的路由里自调这个公共方法，`/probe?token=` 也只会落到 `writeUnauthorized` 401。因此 design D-3 的失败模式与 spec 负向场景不是「偏好」，而是宿主语义的硬结论。
- **host 面引用本轮经实时契约双重锚点**：`connection` 公共面 = `rpc/fetch/operator/createSharedFetchHandler/requestRejection/admit/authorizeIndex/authenticatedUrl`（**确无 token 校验原语**，B 层重定义成立）；`requestRejection(request: ConnectionTrustRequest)` 的入参就是 `{ headers }`（传 `req` 成立）；`webServer.register` 重复 `(kind,path)` 抛错与 `get port()`（webserver/src/index.ts:151）均复核为真。
- **退出判据机件显著增强**：三态定义可判定（「至少执行 2 次一致」「记录谁在何时确认」）、部分成功需布尔式、`MUST NOT` 使用「基本可用」、以及「探测不可执行 → 未验证 + 阻塞原因 + 显式标注 change 4 被阻塞」出口——这三件套比 Round 1 之前任何一份 change 都严。
- **时间盒与写法上限三处一致**（D-9 / tasks §0 / spec），且 D-6 的「≤6 种写法」与 D-9 咬合，堵住了 spike 最典型的无界膨胀。
- **安全问题从「隐性」变「有护栏」**：C 层需 owner 签字 + 只读 + 放宽点显式申报；B 层四项边界；D-8 截图脱敏硬约束 + 默认只入库文本证据；`trust-fence` 的 `Origin: null`/`cross-site` 拒绝与 cookie `SameSite=Strict` 被预先写成 P2/P3 的结论前提。
- **跨 change 接口自觉**：D-1 明写 `<basePath>` prefix 命名空间在 change 4 前不被占用、B 层语义变更与配置面首次落地均列为显式移交项（tasks 4.7）——本轮的问题在于移交清单不够宽，而不在于没有意识。

### Summary

Top 3：
1. **R2-3（High）— A 层 cookie 失效后 change 4 的写接口认证机制未定义**：B 层被本 change 明令禁用于业务写入、C 层只读，而 change 4 又强制写接口必须认证并仍按旧语义把 B 层当作答案；D-7 决策表与 spec 降级清单均未把「写接口认证可行性」列为必输出项 → 认证缺口会原样传导到 change 4 的核心链路。
2. **R2-4（Medium，但性质是 Critical 残留）— 决策规则对「受限」无终局映射**：`可行 → http` / `均不可行 → file://` 两条出口之外，「P1 渲染+认证 PASS、传参/联动受限」这一最可能的真实结果仍不可判定，Round 1 Issue 4 只闭合了一半。
3. **R2-2（High）+ R2-1（High）— 跨 change 契约仍会撞车**：最小 Config 在 change 1（`src/index.ts`）/change 2（`src/config.ts`，自称首次落地且要处置 `TraderKitConfig`）/change 3（`blocked_by` change 2 的 Config）三处互斥，移交清单只覆盖一句措辞；同时 proposal:9 把「未注册路径 404」写成插件自产，回退到 Round 1 Issue 8 的错误认识，可能诱导出与 change 4 prefix 路由抢占命名空间的实现。

**Consensus Status**: NEEDS_REVISION

---

## Round 3 — 2026-09-27

### Overall Assessment

Round 2 的 9 条 issue 与 5 条「部分解决」，我逐条按**正文**（不看处置表自述）核验：R2-1/R2-2/R2-3/R2-4/R2-5/R2-7/R2-8/R2-9 已实质闭合，R2-6 只闭合了三分之二。跨 change 侧这次也真的收敛了——`review-page` 的 D-3「认证分层与写接口的 A 层依赖」、tasks 2.2「认证接入（A/B/C 分层）」、proposal「P1/P3（现场优先、零切换）」、design「切换标的不重载页面、不丢未保存输入（P1/P3）」全部存在且已按 A/B/C 重写；`data-foundation` / `tq-skill-installer` 在「change 1 不引入 Config」的新口径下自洽。剩下的问题集中在两处**正文自相矛盾**：① R2-6 择「代码常量」后，D-1 的回写段、`proposal:29` 与 tasks 4.7① 仍把 C 层开关列进「change 2 的 `Config` 接管」，与 spec「MUST NOT 以配置项形式引入」正面冲突——一个安全闸门（签字后才可开启）的形态在两套指令之间摇摆；② R2-4 新增「三条路径均受限」MUST 时没有同步改 ② 的「仅当」与 ③ 的前置条件，导致同一状态类在 spec 内有相反指令。其余为低危精度项（负向场景 token 未限定、D-1 一行宿主事实错误、若干措辞/覆盖残留）。**本轮无 Critical，问题都是文本级、可定位、几行可修**，但按本系列判据（安全面矛盾 + 决策规则自相矛盾）尚不能直接进入实现。

**Rating**: 8/10

### Previous Round Tracking

| # | 条目 | 终审结论 | 依据（正文核验） |
|---|---|---|---|
| R2-1 | proposal 404 归属自述错误 | 已闭合 | `proposal.md:9` 已改为「未认证 401/403 由插件 handler 产生；未注册路径由宿主 fallback 决定…插件只断言不落入探针页」并重申 MUST NOT 占用 prefix；与 `design.md:54,57`、`spec.md:22-25,30` 逐字同口径 |
| R2-2 | 最小 Config 在 change 1/2/3 三处互撞 | 已闭合（残留见 R3-1） | `design.md:61-69` 改模块常量，明确 MUST NOT 引入 `export const Config`、MUST NOT 扩写/保留 `TraderKitConfig`、不改 `cordis.patch.yml`；`tasks.md:18-21` 验收扫描 `src/**` 无这两者；`tasks.md:133-140` 四项（Config 落点 + TraderKitConfig 去留 / diagnostics 子键 / change 3 依赖 / proposal 措辞）+ ⑤⑥ 两条补充 |
| R2-3 | A 层 cookie 失效后写接口认证机制未定义 | 已闭合 | `design.md:100,151-155` 必输出项 + 三分支（cookie 不存活 → 不可行 → 显式阻塞 change 4 写能力；签名 token 仅签字后成立、未签记为未裁决）；`spec.md:162` + 场景 `:186-189`；`tasks.md:74-76,109-114`；下游 `review-page/design.md:60-72`、`tasks.md:82-85` 已按同一机制重写 |
| R2-4 | 「受限」无终局映射 | 已闭合（引入 R3-2） | `design.md:145`（受限且 `渲染 PASS ∧ 认证 PASS` → 仍采用 http + 逐条列受限点）+ `:149`（三条路径全受限 MUST 收尾）；`spec.md:160,176-184`；`tasks.md:113,115-117` |
| R2-5 | 关闭态「非 200」不可判定 | 已闭合 | `spec.md:134,136-139` 改为「不注册路由 + 插件层断言不由插件 handler 响应 + 状态码登记为集成核对」，并写死 MUST NOT 断言「非 200」/「401/404 之一」；`design.md:210`、`tasks.md:24,159` 同改 |
| R2-6 | C 层开关没有配置面 | **部分解决** | `design.md:98`、`spec.md:38,134`、`tasks.md:42-45`、`proposal.md:36`、`design.md:218`（OQ1）已定案为代码常量 + 默认 false + 签字闸门；但 `design.md:69`、`proposal.md:29`、`tasks.md:134` 仍写由 change 2 的 `Config` 接管（见 R3-1） |
| R2-7 | D-10 与 §7 出站通道口径未对齐 | 已闭合（残留见 R3-6） | `design.md:188-192` 四条边界：作用域 `src/**`、显式豁免 `test/**` 与 `PROBE_HTML`、驱动方式选定（直接调 `createProbeHandler` + `IncomingMessage`/`ServerResponse` 桩；端到端用真实 `node:http` server + `node:net` 裸 socket）、`test/**` MUST NOT 出现 `fetch(`/`http.request` 且扫描先断言非空；`tasks.md:50-53,139` |
| R2-8 | 注入枚举缺 B 层取值、`'rejection'` 不可达 | 已闭合（残留见 R3-5） | 枚举改 `'cookie' / 'diagnostic-token' / 'none'` 且拒绝态不设取值：`design.md:81`、`spec.md:5`、`tasks.md:30`；B 层断言 `spec.md:53`（`auth === 'diagnostic-token'`）+ `tasks.md:40` |
| R2-9 | 坏引用 / 措辞不统一 / 场景错位 | 已闭合 | ① `design.md:70` 已改「见 tasks 4.7」（不再有 D-12）；② 下游引用改符号名，我逐条核到 `review-page` D-3、tasks 2.2、proposal「P1/P3（现场优先、零切换）」、design「切换标的不重载页面、不丢未保存输入（P1/P3）」全部存在；③ 三值统一为可行/受限/不可行（`spec.md:120,158,174`、`design.md:141`）；④ 摘录场景移入 `spec.md:206-209`（位于「可行性结论与退出判据」Requirement 内），出口落 `design.md:159`、`spec.md:164`、`tasks.md:101-103,107-109` |
| R1#2 | B 层无宿主 API（Round 2「部分解决」） | 已闭合 | 由 R2-3 收口（写接口认证机制 + B/C 不得承接写入：`design.md:100,155`、`spec.md:37,162`）；change 4 侧已同步（同上 R2-3 行） |
| R1#4 | 退出判据不可判定（Round 2「部分解决」） | 已闭合（残留见 R3-2） | 第三态映射 + 「三条路径均受限」MUST + spec 两个新场景（`spec.md:176-184`）；「探测不可执行」出口保留（`design.md:147`、`spec.md:201-204`） |
| R1#8 | 路由 kind / 404 归属（Round 2「部分解决」） | 已闭合 | 见 R2-1：`exact` + 不占用 prefix + 404 降级为集成核对，三份文档同口径（`proposal.md:9`、`design.md:45-59`、`spec.md:22-30`） |
| R1#10 | 配置面归属冲突（Round 2「部分解决」） | 已闭合（残留见 R3-1） | 见 R2-2：本 change 不带配置面、全部改模块常量；`data-foundation/proposal.md:18` 的「配置面首次落地」在新口径下已成立，仅剩措辞移交（`tasks.md:137` ④） |
| R1#18 | 仓外依据不可核验（Round 2「部分解决」） | 已闭合 | 「未能核验 + 缺失项清单」可判定出口三处落地（`design.md:159`、`spec.md:164,206-209`、`tasks.md:101-103`），摘录场景归属已正确；原文仍缺属知识缺口，报告有出口兜底 |

### Issues

#### R3-1 (High): R2-6 只落了一半——C 层安全开关在移交段被写成 change 2 的配置字段
**位置**: `design.md:69`（「`diagnostics` 子键接管 `DIAGNOSTICS_DEFAULT` **与 C 层开关**」）、`tasks.md:134`（4.7①「本 change 的 `PROBE_PATH` / `DIAGNOSTICS_DEFAULT` / `UNAUTHENTICATED_READONLY_DEFAULT` 由其接管」）、`proposal.md:29`（「由 `Config` 的对应字段接管**上述常量**」，同段上文刚把 C 层开关定为代码常量）——对照 `design.md:98`（「C 层不是配置项…不得为它引入配置面」）、`spec.md:38,134`（「MUST NOT 作为配置项引入」/「MUST NOT 以配置项形式引入」）、`tasks.md:44`（1.7「MUST NOT 为它新增配置字段」）、`proposal.md:36`、`design.md:218`（OQ1）。
**问题**: 同一形态在 3 处被写成「change 2 的 `Config` 字段接管」，在 5 处被写成「永远是代码常量、不得进配置面」。若按 tasks 4.7① 的移交清单执行，change 2 会把一个「owner 签字后才可置 `true`」的安全闸门实现为 `diagnostics.*` 用户可写字段——用户改一行配置即可放开未认证 loopback 只读面，绕开 R2-6 选定常量形态的唯一理由（签字闸门 + 代码评审）。这不是措辞洁癖：它决定该安全控制是「须改代码并经签字」还是「一行配置」。
**建议**: ① `design.md:69` 的接管清单收窄为 `PROBE_PATH` + `DIAGNOSTICS_DEFAULT`，并写「`UNAUTHENTICATED_READONLY_DEFAULT` MUST NOT 进 `Config`，change 2 亦以代码常量承载」；② `tasks.md:134` 4.7① 同步（把该常量移出「由其接管」，另列一条「保持代码常量、不进配置面」）；③ `proposal.md:29` 把「上述常量」限定为前两项。

#### R3-2 (Medium): R2-4 的修复未同步改「仅当/前置」——「全部受限且不满足布尔式」有两条相反指令
**位置**: `design.md:145`（② 尾部「**仅当**全部路径均判「不可行」，**或**受限点命中 … P1（现场即时）判据 … 时，才写作「回退 `file://`」」）与 `design.md:146`（③「P1、P2 均判「不可行」→ …」）vs `design.md:149`（三条路径全部停在「受限」且不满足布尔式 → 「MUST 按第 ③ 条收尾」，即回退）；`spec.md:160`（同构「仅当 … 时，SHALL 回退 `file://`」）vs `spec.md:184`（「不满足该布尔式时 MUST 决策为「回退 `file://`」」）。
**问题**: 最可能的一类真实结果——P1 渲染 PASS 但 cookie 不存活（认证 FAIL，D-4 明确把「渲染但 cookie 不存活」列为 P1 受限期）、P2/P3 亦受限——恰好是「三条路径全部受限 ∧ 无一路径满足 `渲染 PASS ∧ 认证 PASS`」。此时 ②/③ 的「仅当/前置」不允许回退，149/184 又强制回退；执行者按 145/160 读会得到「无出口」（正是 R2-4 要消灭的状态），按 149/184 读则得「回退 file://」。同一 Requirement 内两条相反规范，且恰好命中 A 层 cookie 存活这一**核心未实测项**的失败分支。
**建议**: 把 ② 的「仅当」补第三条件「**或** 三条路径均停在「受限」且无一路径满足 `渲染 PASS ∧ 认证 PASS`」，把 ③ 的前置从「P1、P2 均判不可行」改为「无路径满足 `渲染 PASS ∧ 认证 PASS` 且不存在「可行」路径」，`spec.md:160` 同改；改完后 ①②③ 对「可行 / 受限且满足布尔式 / 其余」构成互斥完备划分，`:149` 与 `:184` 的 MUST 才有依据。

#### R3-3 (Low): A 层负向场景未限定 token，B 层落地后可能得出相反观察
**位置**: `spec.md:17-20`、`design.md:92`、`tasks.md:75` vs `spec.md:50-53`、`tasks.md:40`；对照 `design.md:63-67`（只有三个常量，无「B 层启用」开关）。
**问题**: 负向断言写「仅带 `?token=` 直接请求 `<basePath>/probe` → 401」，但 B 层落地后插件在同一路由也消费 `?token=`（`tasks.md:40`：正确诊断 token → 200 且 `auth === 'diagnostic-token'`）。执行者若把**插件自有诊断 token** 填进该用例会看到 200，与「401 是宿主语义的硬结论」相反——恰是本 change 要防的假结论类型（该负向用例正是 Round 1 Issue 1 的旗舰断言）。同时「A/B 是同一 handler 同时受理两种凭据」还是「A 失效后切换」在正文未写明。
**建议**: spec 负向场景限定为「仅带**宿主** `?token=<launchToken>`（不带 cookie）→ 401」，并补一句「携带插件自有诊断 token 时 200 属 B 层，不构成反例」；在 D-3 或 spec 明写 B 层凭据是否始终受理（若始终受理，则 A/B 无运行期状态机）。

#### R3-4 (Low): D-1 表格第 5 行的宿主事实不成立（非 `/` 未注册路径没有鉴权点）
**位置**: `design.md:55`（「认证失败后到达 `GET /` 之外的路径 | 宿主 `authorizeIndex`/`writeUnauthorized`（非插件）| 401」）。
**核验**: `webserver/src/index.ts:register`（:166-173，注册不带鉴权）与 `handle`（:222-238：命名路由直交 handler，未命中交 fallback，两者都不做认证）；`frontend-static/src/index.ts:serveStatic`（:71-106）仅在 `target === distRoot || target === distIndex` 时调 `authorizeIndex`（:88-89），其余路径直接 `readFile`，缺失即 404（:96-102）；`rpc-host.ts:requestRejection`（:104-107）只被各服务自己调用（先例 open-in-app）。故非 `/` 的未注册路径不会因未认证返回 401，而是读 dist 失败 → 404（或该路径确有文件 → 200）。
**建议**: 删该行，或改写为「仅 index 路径（`/`、`/index.html`）经 `authorizeIndex` → 303/401；其余未注册路径不经鉴权，由 fallback 读 dist 决定 404/200」。附带：现网 composition 的 fallback 不做「未命中子路径 → index」重写，故 `spec.md:25,134` 的「可能是宿主 SPA 的 200」只在该路径确有 dist 文件时成立——保留为保守措辞可以，但不必当作预期值。

#### R3-5 (Low): 精度残余（不可达取值 / 必输出项缺「未验证」态 / 语法不明 / 移交项措辞过弱）
**位置与建议**:
1. `auth: 'none'` 无可达性定义——默认 `UNAUTHENTICATED_READONLY_DEFAULT = false` 且 handler 首行 `requestRejection`（`design.md:57,66`）下，未认证请求在渲染前即 401/403，`'none'` 只在已签字的 C 层配置下可能出现，但 spec 无场景/断言说明何时应观测到它（R2-8 的同类缺陷只剩这一取值）。建议在 `design.md:81` / `spec.md:5` 补「`'none'` 仅在 C 层签字且常量置 `true` 时出现」。
2. 「写接口认证结论」取值域仅 可行/不可行/受限（`design.md:151-154`、`spec.md:162`），未接上「探测不可执行」出口（`design.md:147` ④）：报告在 ④ 下该必输出项无值可填。建议补第四态「未验证（探测不可执行）→ 同时阻塞 change 4 写能力」。
3. `spec.md:134`「探针页资产 MUST NOT 被注销其它路由」语法/指向不明（疑为「卸载探针路由 MUST NOT 影响其它路由注册」）。建议改写为可判定的 disposer 断言。
4. `tasks.md:134` 4.7① 的「`TraderKitConfig` MUST NOT 留两份配置类型」弱于实际处置：现状是 `src/index.ts:21` 的**单份** `TraderKitConfig`（且是 `apply` 第二参数类型），`tasks.md:20`（1.1 验收：`src/**` 内不存在）已要求本 change 删除它，而 `data-foundation/tasks.md:3` 1.1 仍写「处置**既有** `TraderKitConfig`」。建议 4.7① 写明「既有单份由本 change 删除（现状 `src/index.ts:21`，含 `apply` 第二参数），change 2 的『处置既有』随之变为 no-op」，否则两份 change 的任务描述互相悬空。

#### R3-6 (Low): R2-7 的跨 change 半程未落地——change 4 仍写「全仓零 fetch」
**位置**: `tasks.md:139`（4.7⑥）vs `review-page/design.md:245`（D-16②「除 `src/data/http.ts` 外，**全仓**零 `fetch(` / `http.request` 调用点」）、`review-page/tasks.md:206`（6.3② 同口径）。
**问题**: 本 change 已把结构断言作用域定为 `src/**` 并豁免 `test/**` 与 `PROBE_HTML`（`design.md:189-191`），但被约束的下游文本仍是「全仓」；4.7⑥ 未按 4.7 自己的格式给出「目标文件/符号 + 现状 + 应改成什么」（也未点明要改的就是上述两处），于是「§7 补充条目」只存在于本 change 的清单里，change 4 的实现断言仍会扫到 `test/**` 与内联常量。
**建议**: 4.7⑥ 补 `docs/design/iteration-1-contracts.md §7` 的文件路径与两个 change 4 目标（`review-page/design.md` D-16②、`review-page/tasks.md` 6.3②），并要求把「全仓」改为 `src/**`（保留 `test/**` 禁用 `fetch(`/`http.request` 的自限）。

### Positive Aspects

- **不是处置表自述，是真改了正文**：R2-1 在 `proposal.md:9` / `design.md:54,57` / `spec.md:22-25` 三处同为宿主 fallback 口径；R2-5 的「非 200」在 spec/design/tasks 三处均已删除并替换为集成核对；R2-8 的枚举在 design/spec/tasks 三处一致；R2-9④ 的摘录场景确实位于「可行性结论与退出判据」Requirement 内（`spec.md:206-209`），不再挂在脱敏 Requirement 下。
- **跨 change 的引用与自述这轮经得起核验**：R2-9② 要求的符号名引用全部命中真实符号（`review-page` D-3、tasks 2.2、proposal「P1/P3（现场优先、零切换）」、design「切换标的不重载页面、不丢未保存输入（P1/P3）」）；R2 处置表称「change 4 侧已按 A/B/C 重写」也与 `review-page/design.md:60-72`、`tasks.md:82-85`、`proposal.md:18`、`spec.md:56-78` 的正文一致——R2 的跨 change 自述这次没有虚报。
- **安全侧表述是保守的**：spec 用 `MUST NOT 以配置项形式引入`、写接口「只认 A 层」、B/C 层 MUST NOT 承接写入这类硬约束；R3-1 的矛盾方是「移交段」，规范方（spec）站在安全侧，所以这是文档矛盾而非已放宽的安全面——这也是我只给 High、不给 Critical 的原因。
- **R2-3 的收口可判定**：D-7 的写接口认证结论给出取值域 + 判据 + 「未签字 MUST NOT 进结论」的闸门，并要求与 D-3 分层判定「互相印证、B 层命中 MUST NOT 被推导为写接口可用」（`design.md:155`、`spec.md:162`）——比 Round 1/2 的「业务写入仍走认证路径」强得多。
- **回退矩阵与失败模式写法扎实**：D-4 的判据是「可观察事实」而非「是否可用」；D-3 预写 `trust-fence` 的 `Origin: null`/`cross-site` 拒绝与 `SameSite=Strict` 两条障碍并要求逐项实测请求头（`design.md:102-107,116-117`、`spec.md:89-102`）；D-10 把测试驱动力与 `§7` 出站通道的边界写死（`design.md:188-192`）——这几处已达可执行程度。

### Summary

Top 3：
1. **R3-1（High）— C 层安全开关形态在移交段自相矛盾**：`design.md:69` / `tasks.md:134` / `proposal.md:29` 让 change 2 的 `Config` 接管 `UNAUTHENTICATED_READONLY_DEFAULT`，而 `spec.md:38,134` / `design.md:98` / `tasks.md:44` / `proposal.md:36` 说它永远不得成为配置项；按前者执行会把「签字才可开启」的未认证只读闸门降级为用户可写配置。
2. **R3-2（Medium）— 「全部受限且不满足布尔式」的终局出口有两条相反规范**：`design.md:145,146` 的「仅当/③ 前置」与 `:149` 的 MUST 冲突；`spec.md:160` 与 `:184` 同构冲突；该状态恰是「cookie 不存活」这一核心失败分支的可能落点。
3. **R3-3（Low）— A 层负向用例未限定 token**：`spec.md:17-20` 的「仅带 `?token=` → 401」在 B 层落地后会被插件自有诊断 token 破例为 200；应限定为宿主 `launchToken`，否则旗舰负向断言可被误读为反例。

其余：R3-4（D-1 第 5 行宿主事实错误，已按宿主源码 `webserver`/`frontend-static`/`rpc-host` 核验）、R3-5（`'none'` 不可达 / 必输出项缺「未验证」/ 语法不明 / 移交项措辞过弱）、R3-6（change 4 仍写「全仓零 fetch」，4.7⑥ 未给目标文件）。Round 2 的 9 条 + 5 条「部分解决」中，**R2-6 为部分解决，其余 13 条已闭合**；本轮 6 条问题全部为文本级、可逐行定位。

**Consensus Status**: NEEDS_REVISION
