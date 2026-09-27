# 实施任务（spike-tdx-embed）

> 定位：**阶段 1 骨架已完成之后 / 阶段 2 之前**的可行性闸门（`docs/roadmap.md §5`）。
> 事实核验纪律与引用写法沿 `docs/design/iteration-1-contracts.md §8`（符号名 + 已核验标注）；
> 配置面所有权沿 `§11`（**change 1 不引入 `Config`**）、认证与写接口通道沿 `§12.1`、
> 结构断言/出站通道口径沿 `§7`、发布产物纪律沿 `§10`。每条任务含 **产物 / 验收 / 依赖**。

## 0. 时间盒与收敛规则（评审 Issue 5；对应 design D-9）

- 单路径（P1/P2/P3）总耗时 ≤ **30 min**；单次配置尝试 ≤ **10 min**；单路径配置尝试 ≤ **3 次**。
- 点击联动写法枚举上限 **6 种**（与 design D-6 一致，MUST NOT 临时扩写）。
- TDX 侧人工实测总计 ≤ **2 h**；到点 MUST 停止实测并按 2.7 / 4.2 的「探测不可执行」出口写报告。
- 任一上限触及时 MUST 立即记录当时证据（请求头/截图/时间戳）并收敛该路径为 FAIL/UNKNOWN，MUST NOT「再试一次看看」。
- 未覆盖项 MUST 原样落进报告「未决项」，不得因超时省略。

## 1. 探针路由与页面

- [ ] 1.1 `apply(ctx)` 接入 `webServer` / `connection` 依赖（`export const inject`）+ 模块常量 + 三行 URL 打印（**本 change MUST NOT 引入 `export const Config`，MUST NOT 扩写/保留 `TraderKitConfig`，MUST NOT 改 `cordis.patch.yml`**——`iteration-1-contracts §11`，`src/config.ts` 的唯一 owner 是 change 2）
  - 产物：`src/index.ts` 的 `inject` 声明；`src/routes/probe.ts` 导出的模块常量 `PROBE_PATH = '/dsh-trader-kit/probe'`、`DIAGNOSTICS_DEFAULT = true`、`UNAUTHENTICATED_READONLY_DEFAULT = false`（供单测与 spec 断言）
  - 验收：`pnpm typecheck` 通过；**`src/**` 内不存在 `export const Config` 与 `TraderKitConfig`**（扫描型用例：`grep` 断言 + 先断言扫描目标非空）且 `cordis.patch.yml` 无 `config` 段；挂载时经 `ctx.logger`/`console` 打印三行 URL（base = `http://127.0.0.1:${ctx.webServer.port}`、登录 URL = `ctx.connection.authenticatedUrl(base + '/')`、探针 URL = `base + PROBE_PATH`）
  - 依赖：`§11`（change 1 不引入 Config）；design D-1「配置面」段（change 2 接管与四项回写见 4.7）
- [ ] 1.2 注册探针路由 `{ kind: 'exact', path: PROBE_PATH }`，返回 `text/html`；`ctx.effect` 包裹注册并返回 disposer
  - 产物：`src/routes/probe.ts`（路由注册与 handler 接线）
  - 验收：路由注册/注销为**集成核对**（起真实宿主或用 `ctx.effect` disposer 契约做结构断言，MUST NOT 写成「零 mock 单测」）；`DIAGNOSTICS_DEFAULT === false` 时**不注册探针路由**，插件层断言「不由插件 handler 响应、无残留 handler」；该请求的**实际状态码由宿主 fallback 决定，登记为集成核对项，MUST NOT 断言「非 200」或「401/404 之一」**；`UNAUTHENTICATED_READONLY_DEFAULT === false`（默认）时未认证请求仍 401/403
  - 依赖：1.1；design D-1（`register` 对重复 `(kind, path)` 抛错——MUST NOT 与 change 4 的 `/review*` 冲突）；spec「关闭诊断页」
- [ ] 1.3 探针页 HTML 常量：离线自包含、**语法上限 = 基线页已证级别（ES2017 + Fetch + Promise）**、无外链；自检输出 URL / hash / query / UA / 内核特性探测 / 加载时间戳；含输入框 + `hashchange` 时间线显示（变化计数 + 时间 + 解析结果）与点击联动测试按钮区（≤6 种写法）
  - 产物：`src/client/probe/index.html.ts`（导出 `PROBE_HTML` 模板字符串常量，随 `tsdown` 编译进 `lib/**`）
  - 验收：常量含探针页标记、输入框与 hashchange 时间线、联动按钮区（每种写法一个按钮，页面侧记录点击与调用返回值）；单测断言无 `http(s)://` 外链、无基线页未证语法（ES module / 可选链 / 顶层 await）；记录「基线页语法清单 vs 探针页特性探测」供 4.1 报告对照
  - 依赖：design D-2（内联方案，评审 Issue 7/13）、D-6
- [ ] 1.4 请求时注入 `window.__PROBE__ = { auth, status, port, basePath, injectedAt }`（`auth ∈ {'cookie','diagnostic-token','none'}`，**拒绝态不设枚举取值**）+ `Cache-Control: no-store`
  - 产物：`src/routes/probe.ts` 的模板注入逻辑（占位符替换 + JSON 序列化 + `<`/`&`/U+2028/U+2029 转义）
  - 验收：注入值转义单测（构造含 `</script>` 的取值不得逃逸）；响应头含 `no-store`；页面标注「由服务端注入，非页面自证」；401/403 路径不注入、不渲染页面
  - 依赖：1.3；设计 D-2（评审 Issue 12、R2-8）
- [ ] 1.5 认证接入：handler 首行 `const rejection = ctx.connection.requestRejection(req); if (rejection !== undefined) { res.statusCode = rejection; res.end(); return }`
  - 产物：`src/routes/probe.ts` 认证判定代码 + 401/403 拒绝路径
  - 验收：单测断言两种拒绝码（无 cookie → 401；栅栏不过 → 403）且探针页不被渲染；**插件路由 MUST 自行调用**（宿主不代鉴权）
  - 依赖：1.2；design D-1/D-3（评审 Issue 9）
- [ ] 1.6 A 层两步登录与 B 层插件自有诊断 token
  - 产物：登录 URL 打印（1.1）+ 挂载时 `crypto.randomBytes` 生成诊断 token（仅内存 + 日志）+ 路由层常数时间比对（`?token=` 不匹配 → 401）
  - 验收：报告与 README/注释写明 B 层四项边界（来源 = 插件生成、有效期 = 进程生命周期、作用域 = 仅 `<basePath>/probe`、URL 明文风险）；**业务写入 MUST NOT 依赖 B 层**（写接口认证机制由 4.2 的必输出项「写接口认证结论」定义）；单测断言 token 缺失/错误 → 401、正确 → 200 且注入 `window.__PROBE__.auth === 'diagnostic-token'`（与 A 层 `'cookie'` 可区分）
  - 依赖：1.5；design D-3（评审 Issue 1/2、R2-8；**MUST NOT 校验宿主 `launchToken`——无此 API**）
- [ ] 1.7 C 层未认证只读开关（**代码常量，非配置项**：`UNAUTHENTICATED_READONLY_DEFAULT = false`，默认关闭；置 `true` 前 MUST 取得 owner 签字）
  - 产物：C 层开关常量 + 放宽点定义（`Origin: null` / `Sec-Fetch-Site: cross-site` 的例外范围、放行方法与路径白名单）
  - 验收：常量默认值为 `false`，未认证请求仍 401/403；签字未取得时该常量 MUST 保持 `false`（在代码注释与报告中写明签字要求与既定默认值语义）；**MUST NOT 为它新增配置字段**（`Config` 归 change 2，`§11`）；签字时间与范围记入 `docs/roadmap.md`
  - 依赖：1.5；design D-1（配置面）/ D-3（`trust-fence.ts` 先例拒 `Origin: null`/`cross-site`，自述「不是认证」）；spec「C 层开关为代码常量且默认关闭」
- [ ] 1.8 传参解析：hash → query → path 段优先级实现，原样记录形态与合法性判定（不静默修正）
  - 产物：`src/routes/probe.ts` 内或 `src/client/probe/params.ts` 的解析模块
  - 验收：单测覆盖 `#600000` → `600000`、三形态同时提供时的优先级、`SH600000` / `600000.SH` 原样记录、非 6 位与空态（MUST NOT 猜测补全）
  - 依赖：1.3；design D-5
- [ ] 1.9 单测（零 mock，测试 seam；评审 Issue 16 / R2-7）
  - 产物：`test/**` 用例（`createProbeHandler(deps)` 纯工厂 + `IncomingMessage`/`ServerResponse` 桩；端到端时用真实临时 `node:http` server + `node:net` 裸 socket 驱动）
  - 验收：断言 401/403 拒绝码、传参优先级、注入转义、方法不匹配、`no-store` 头、`PROBE_HTML` 标记与无外链；**`test/**` MUST NOT 出现 `fetch(` / `http.request` 调用点**（`§7` 补充口径：结构断言作用域 = `src/**`，显式豁免 `test/**` 与内联 HTML 常量 `PROBE_HTML`）；扫描型用例先断言目标非空（`targets.length > 0`）且 MUST NOT 把 `PROBE_HTML` 文本计入扫描目标
  - 依赖：1.3–1.8；design D-10（含「与 `§7` 出站通道口径的边界」）
- [ ] 1.10 构建产物与发包白名单验收（评审 Issue 7）
  - 产物：构建断言用例 + 验收记录
  - 验收：`pnpm build` 后 `lib/**` 含探针页标记；`package.json#files` 含 `lib`（若改判 `lib/assets` 方案则含之且 `.gitignore` 不忽略）；从 `lib/` 加载时 `GET PROBE_PATH`（`/dsh-trader-kit/probe`）返回 200 且 `text/html` **非空**（无 ENOENT 误判）
  - 依赖：1.3、1.2

## 2. TDX 侧承载验证（人工核对，受 §0 时间盒约束）

- [ ] 2.1 P1：在 TDX 中把页面指向 `http://127.0.0.1:<port>/?token=<launchToken>`（第一步），再导航 `<basePath>/probe`（第二步）
  - 产物：人工核对表记录（实际端口 + 三行 URL 原样、TDX 版本、内嵌 UA、是否 303、页面注入的 `auth` 值、渲染结果、截图路径）
  - 验收：按 design D-4 的 P1「通过/受限/失败」判据给出结论（可观察事实）；记录配置入口路径（哪一处可指向 http URL）
  - 依赖：1.1–1.6；design D-1/D-3/D-4
- [ ] 2.2 P2：准备本地跳板页（`file://` → `location.replace(http + '#' + code)`），验证跳转与 hash 保留
  - 产物：跳板页文件 + 核对表（跳转是否发生、hash 是否保留、实测请求头与响应码、截图路径）
  - 验收：按 D-4 的 P2 判据结论；**MUST 记录跨源/认证障碍的实测值**（见 2.3），否则不足以归因
  - 依赖：2.1；design D-4
- [ ] 2.3 跨源与认证障碍矩阵（评审 Issue 3）：对 P2/P3 的 `file://` → 本地 HTTP 请求逐项取证
  - 产物：证据记录：实测请求头（`Origin` / `Sec-Fetch-Site` / `Sec-Fetch-Mode`）、响应码（403/401/200）、是否携带 `dsh-auth-*` cookie、是否触发 CORS 预检与 Private Network Access 拦截
  - 验收：每项有实测值（允许多次尝试，但受 §0 上限约束）；结论写明「被 `trust-fence` 拒 `Origin: null`/`cross-site`」或「被 `SameSite=Strict` 致 cookie 不携带」中的具体一条
  - 依赖：2.2；design D-3
- [ ] 2.4 认证矩阵：A（两步）/ B（插件诊断 token）/ C（签字回退）三层在 TDX 内嵌浏览器下逐一验证
  - 产物：矩阵记录（cookie 是否落地、页面是否可加载、注入的 `auth` 取值、A 层负向项「仅带 `?token=` 直连 `/probe` → 401」）+ **「写接口认证」结论项**（可行 = A 层 cookie 存活 → 机制 = 宿主 cookie；不可行 = cookie 不存活 → 写入接口认证机制不存在、显式阻塞 change 4 写能力；受限 = 仅 owner 签字的一次性短时效签名 token，未签字记为「未裁决」）
  - 验收：每层给出三态结论（已验证/人工核对确认/未验证）与证据；**写接口认证结论为必输出项**（design D-7、`§12.1`）：A 层 cookie 存活须有 ≥2 次一致证据，不可行时 MUST 写明「change 4 写接口 = 不可用 + 只读降级」，B 层命中 MUST NOT 被推导为写接口可用；C 层未签字时不得测试其未认证读取
  - 依赖：2.1；design D-3 / D-7；spec「认证流程」4 场景 + 「写接口认证结论（必输出项）」
- [ ] 2.5 hashchange 行为核对：在 TDX 内切换标的（触发 hash 变化），确认页面不重载、输入框内容保留
  - 产物：核对记录（hashchange 计数、输入框内容快照、截图路径）
  - 验收：按 D-4 P1/P2 的传参判据给结论；记录实际取值形态
  - 依赖：2.1
- [ ] 2.6 证据归档与脱敏（评审 Issue 17）
  - 产物：`docs/spikes/` 下的文本证据（UA、请求头、返回码、时间戳、自检文本）+ 脱敏检查记录
  - 验收：入库截图逐张通过脱敏检查（账户/资金/持仓/自选股不可见）并标注「已脱敏」；未通过者只记本地路径；标明获取时间与 TDX 版本
  - 依赖：2.1–2.5；design D-8
- [ ] 2.7 「探测不可执行」出口演练（评审 Issue 4；**条件任务**：实测正常完成时只记录「本次未触发」）
  - 产物：出口记录（阻塞原因：TDX 配置入口不可达 / owner 不在场 / 时间盒耗尽；后续动作）或「未触发」记录
  - 验收：若实测无法执行，报告决策节写「未验证 + 阻塞原因 + 后续动作」并标注 change 4 承载绑定层被阻塞；MUST NOT 编造二选一结论
  - 依赖：§0（时间盒）；spec「可行性结论与退出判据」的「探测不可执行」场景

## 3. 点击联动协议探测

- [ ] 3.1 在 TDX 内逐一点击探针页的联动测试按钮（**上限 6 种写法**），记录每次 TDX 侧的实际响应（是否切标的/是否无反应）
  - 产物：逐写法记录表（写法、返回值、TDX 侧响应、证据位置）
  - 验收：6 种写法均有点击记录或明确标注「未尝试」（受时间盒约束）；写满上限即停止
  - 依赖：1.3、§0；design D-6
- [ ] 3.2 汇总可用性结论（可行 / 受限（列出命中写法与失败写法）/ 不可行）并标注为人工核对结论
  - 产物：结论段（含命中写法清单）
  - 验收：与 design D-7 的「部分成功量化」口径一致（受限需可判定布尔式）；MUST NOT 用「基本可用」等措辞
  - 依赖：3.1
- [ ] 3.3 若判定不可行或受限：写明对 F5 盘中页面（点击联动方向）与 P3 零切换原则的影响
  - 产物：影响段（引述依据原文摘录与出处，标注「仓外文档，未能核验」；无仓内副本时给出「未能核验 + 缺失项清单」）
  - 验收：影响范围可指认到具体页面能力项；无原文时 MUST 标注未核验并按缺失项清单收尾（逐条列「文档名 + 需要章节 + 影响哪条结论」）
  - 依赖：3.2；design D-7、spec「仓外依据未能核验时收尾」

## 4. 报告与决策

- [ ] 4.1 撰写 `docs/spikes/tdx-embed.md`：结论 / 证据 / 决策 / 未决项 + **复现前提**（TDX 版本、内嵌内核版本、DSH 版本、`@deepseek-ai/dsh-host-webserver` 与 `dsh-client-connection` 实测版本、宿主源码检出路径与关键符号、适用版本范围）+ **依据原文摘录**（§11 / P1/P3 / F5 定义片段 + 出处文件与版本日期，标注仓外未能核验）
  - 产物：`docs/spikes/tdx-embed.md`（无仓内副本时含**缺失项清单**）
  - 验收：四节齐备；复现前提四项齐全；引用的宿主事实均带符号名与「已核验（本机检出路径，版本等价性未核验）」标注（`§8`）；**结论节含独立一条「写接口认证结论」**（可行/不可行/受限，判据见 4.2）；仓外依据无仓内副本时以「未能核验 + 缺失项清单」收尾
  - 依赖：2.x、3.x；design D-7；spec「可行性结论与退出判据」
- [ ] 4.2 决策判定表与结论（评审 Issue 4 / R2-3 / R2-4）：`路径 × 维度（渲染/传参/认证/跨源）× 状态（PASS/FAIL/UNKNOWN）+ 证据`；决策按**三态映射**出结论 + **写接口认证结论**（必输出项）
  - 产物：判定表 + 决策段 + 触发条件 + 「写接口认证」结论条
  - 验收：每条路径落到「可行 / 受限（逐项列受限点）/ 不可行」之一；有 UNKNOWN 的路径 MUST NOT 判「可行」；**受限且 `渲染 PASS ∧ 认证 PASS` → 决策仍为「采用 http 同端口页面」并逐条列出受限点与对 change 4 的降级要求**；仅当全部路径不可行、或受限点命中 change 4 的 P1（现场即时）判据时才回退 `file://`；**三条路径全部停在「受限」时 MUST 按上述映射收尾**（MUST NOT 留空）；**结论节 MUST 含「写接口认证结论」**（可行/不可行/受限 + 判据，判据见 D-7；B 层命中 MUST NOT 被推导为写接口可用）；决策写明触发条件与对 change 4 的具体影响（路由/传参/认证/资产组织）
  - 依赖：4.1、2.4；spec「可行性结论与退出判据」（含「P1 受限但渲染与认证 PASS」「三条路径均受限的收尾」「写接口认证结论（必输出项）」）
- [ ] 4.3 部分成功处置：按可判定布尔式（如 `渲染 PASS ∧ 认证 PASS ∧ 传参 FAIL`）记录受限点；**按 D-7 第②条映射给出终局决策**（仍采用 http 同端口页面 + 降级要求），不满足布尔式或命中现场即时判据时才落下一候选路径
  - 产物：受限项清单 + 第三态终局映射记录（决策 + 降级要求）
  - 验收：布尔式各项均有证据指认；决策与映射一致（受限 ≠ 自动回退）；MUST NOT 出现不可判定措辞
  - 依赖：4.2；design D-7
- [ ] 4.4 若判定回退 `file://`：写明 change 4 的页面资产组织与取数方式变化（跨源、认证影响 + D-3 的三种处理方式选型与降级路径）
  - 产物：回退分支说明段
  - 验收：写明 CORS/PNA 与 `Origin: null`/`cross-site` 的具体处置与签字要求；业务写入不因回退而放宽认证
  - 依赖：4.2、2.3
- [ ] 4.5 若采纳 C 层（未认证 loopback 只读页）：提交 owner 签字并记录于 `docs/roadmap.md` 的安全面决策（含放宽点范围与时间），**并把代码常量 `UNAUTHENTICATED_READONLY_DEFAULT` 置为 `true`**（签字前 MUST 保持 `false`）
  - 产物：签字记录 + `docs/roadmap.md` 增补行 + 常量改动 diff
  - 验收：签字可见可指认；未签字 MUST NOT 改动常量、MUST NOT 进入报告决策；改动仅涉及该代码常量（MUST NOT 新增配置字段）
  - 依赖：4.2；design D-3 / D-1（R2-6）
- [ ] 4.6 回写 `docs/roadmap.md` **阶段 6 嵌入页行 + 阶段 2 桥取消/口径修正行**（`roadmap.md §5` 已登记），并补 `docs/architecture.md` 的宿主 HTTP 面/嵌入页能力边界说明
  - 产物：`docs/roadmap.md` 与 `docs/architecture.md` 的增补（diff 或章节号 + 摘录）
  - 验收：回写目标为上述两行 + architecture（不是「阶段 2–3」）；本 change 的「横跨阶段 1→2」定位有可指认落点
  - 依赖：4.2
- [ ] 4.7 跨 change 口径移交（评审 Issue 2/10 + **Round 2 R2-2/R2-3/R2-7**）：显式记录需在 **change 2 / change 3 / change 4 侧同步**的条目（**只写在清单里，不跨目录改动其它 change**）
  - 产物：移交清单（写在本 change 的 tasks 或报告附录），**逐条写成可核对条目**（每条含「目标文件/符号 + 现状 + 应改成什么 + 核对方式」）
  - 验收：清单含**四项 + 两项补充**，缺一不可——
    ① **change 2 的 `Config` 落点与 `TraderKitConfig` 去留**：`src/config.ts`（`export const Config`）唯一 owner = change 2；本 change 的 `PROBE_PATH` / `DIAGNOSTICS_DEFAULT` / `UNAUTHENTICATED_READONLY_DEFAULT` 由其接管；`TraderKitConfig` MUST NOT 留两份配置类型；
    ② **`diagnostics` 子键命名区分**：诊断页开关（如 `diagnostics.page.enabled`）与 `probe.*` / `tdx17709.*` MUST 互相区分、不得同名；
    ③ **change 3 的依赖对象**：`Config.skill` 的 `blocked_by` 指向「change 2 首次落地、change 1 不引入」的同一 `Config` 根；
    ④ **proposal 措辞**：`data-foundation/proposal.md` 的「配置面首次落地」改为「change 2 首次落地 `src/config.ts` 的 `Config`（change 1 用模块常量，不引入配置面）」；
    ⑤ **补充（R2-3）**：`review-page` 的 D-3（认证分层与写接口的 A 层依赖）与 tasks「认证接入（A/B/C 分层）」的 B 层语义 = 「**诊断页用 B 层 / 写接口用 D-7 写接口认证结论所指机制**（A 层不可用即写接口不可用）」；
    ⑥ **补充（R2-7）**：`§7` 出站通道口径的补充条目——结构断言作用域 = `src/**`，显式豁免 `test/**` 与内联 HTML 常量；`test/**` MUST NOT 出现 `fetch(` / `http.request`
  - 依赖：1.1（模块常量）、1.6、2.4、4.2；design D-1 / D-3 / D-7 / D-10、`iteration-1-contracts §7/§11/§12.1`
- [ ] 4.8 门禁：`pnpm typecheck && pnpm build && pnpm test` 全绿
  - 产物：门禁运行输出片段（命令 + 结果行）
  - 验收：三条命令退出码 0；1.10 的构建/发包断言与 2.6 的脱敏检查同属验收项
  - 依赖：全部实现任务
- [ ] 4.9 报告需登记「E4 方言探测移交」一行（评审 Issue 6）：本迭代部分未落地，方言探测归阶段 6 前独立 spike，引用 `docs/roadmap.md §5`
  - 产物：报告未决项 + `docs/roadmap.md` 行（已于 §5 登记，此处仅引用）
  - 验收：E4 不被表述为「已闭环」；移交去向与触发条件明确
  - 依赖：4.1

## 5. Requirement ↔ task ↔ 验收映射

| Requirement（spec） | task | 验收 / 证据 |
| --- | --- | --- |
| 同端口探针路由（401/403、exact、不落宿主 fallback 断言） | 1.2 / 1.5 / 1.8 | 1.9 单测（两种拒绝码、传参优先级）+ 路由注册/卸载集成核对 |
| 认证流程（A 两步 / B 插件 token / C 签字常量） | 1.1 / 1.6 / 1.7 / 2.4 | 1.9 单测（token 401/200 + `auth === 'diagnostic-token'`）+ 2.4 认证矩阵（含 A 层负向 401 与**写接口认证结论**） |
| 写接口认证结论（D-7 必输出项，`§12.1`） | 2.4 / 4.1 / 4.2 / 4.7⑤ | 结论节独立结论条（可行/不可行/受限 + 判据）+ 移交清单第⑤项 |
| 传参形态探测 + 路径判据 | 1.8 / 2.1 / 2.2 / 2.5 | 1.9 单测 + 2.1/2.2/2.5 核对表（含实测请求头） |
| 点击联动协议探测 | 1.3 / 3.1 / 3.2 | 3.1 逐写法记录 + 3.2 三值结论（可行/受限/不可行） |
| 诊断页开关（本 change 为模块常量，change 2 后转配置）与构建产物随包发布 | 1.1 / 1.2 / 1.10 | 1.10 构建/发包断言（200 + 非空 HTML）+ **关闭态断言：不注册路由、不由插件 handler 响应、无残留 handler（状态码 = 集成核对项，MUST NOT 断言非 200）** |
| 可行性结论与退出判据（三态 + 部分成功终局映射 + 写接口认证 + 不可执行出口 + 摘录收尾） | 4.1 / 4.2 / 4.3 / 2.7 / 3.3 | 报告判定表（路径 × 维度 × 状态 + 证据）；受限路径的终局决策与降级要求；写接口认证结论条；出口演练记录；仓外依据缺失项清单 |
| 时间盒与收敛规则 | §0 / 2.1–2.7 / 3.1 | 记录表含时间戳与尝试次数；超限收敛记录 |
| 探测不触碰业务数据与证据脱敏 | 2.6 / 1.x | 业务区零变更核对 + 脱敏检查记录 |

**证据格式（强制）**：每条验收 MUST 落三项——① **命令**（可复制执行）；② **输出片段**（关键行，含状态码/用例数/耗时）；③ **产物路径**（截图脱敏后路径、报告路径或 `npm pack` 内路径）。仅写「手工核对通过」不构成证据。
