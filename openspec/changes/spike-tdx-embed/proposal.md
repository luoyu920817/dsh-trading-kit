## Why

迭代一的两个页面（复盘页面、后续盘中页面）都建立在「DSH 同端口 http 路由页 + 通达信内嵌浏览器 + URL 传参/点击联动」这一形态之上，而该形态**从未实测**：TDX 自定义版面能否指向 http URL、内嵌浏览器是否接受 DSH 的 tokenized URL 认证、`#hash` 传参与 `hashchange` 是否保持、点击联动协议是否存在——全部未知。需求文档 §11 已把它列为首位风险（嵌入页替换失败或 TDX 版本差异 → P1/P3 现场原则落空）。（该需求文档为**仓外文档，未能核验**，沿 `docs/design/iteration-1-contracts.md §8` 标注；引述与摘录归档见 tasks 4.1。）

阶段 1 骨架已完成（`docs/roadmap.md §5`：阶段 1 骨架已完成；`src/index.ts` 为 no-op、无路由无 Config），本 change 是**阶段 1 出口后 / 阶段 2 之前**的可行性闸门：此刻验证改动面最小，且结论直接决定 change 4（review-page）的页面资产形态与认证策略。本 change 实际吃掉了阶段 2 的撞墙内容（宿主 HTTP 面 + tokenized URL 鉴权），因此其路由与认证代码按**临时/诊断资产**对待（见 design D-1），阶段 2 不再作为独立阶段（`docs/roadmap.md §5`），正式桥按其自身 design 重做。

## What Changes

- 新增同端口最小探针路由 `GET /dsh-trader-kit/probe`（`kind: 'exact'`；**未认证 401/403 由插件 handler 产生；未注册路径由宿主 fallback 决定**（登记为实测记录，插件只断言不落入探针页），与 design D-1 / spec「访问不存在的路径」逐字对齐；本 change MUST NOT 占用任何 `prefix` 路由）：离线可用的单文件 HTML，自检输出 URL/hash/query、`hashchange` 时间线、UA 与内嵌内核信息、认证态（由服务端按请求注入），并带一个点击联动测试按钮与一个输入框（验证切换标的不丢输入）。
- 三条承载路径逐条实测：**P1** 直接以 http URL 作为 TDX 页面；**P2** `file://` 本地跳板页 `location.replace(http + #code)`；**P3** 保留 `file://` 就地实现（回退分支）。
- 认证路径实测：**A 层为两步登录**——① 在 TDX 内先打开**根地址** `http://127.0.0.1:<port>/?token=<launchToken>` 铸 cookie（宿主 `authorizeIndex` 只在 `GET /` 且带单个 `?token=` 时铸造并 303 重定向）；② 再导航 `<basePath>/probe`（靠 cookie）。**按原设计直连 `<basePath>/probe?token=…` 必然 401**（`isAuthenticated` 只读 cookie，非根路径的 `?token=` 无消费点），该假结论正是本 change 要防的失败模式。B 层（每请求带 `?token=`、由插件路由自行校验**插件自持诊断 token**）为保留认证语义的中间档，须写明其安全边界（来源 = 插件生成、有效期 = 进程生命周期、作用域 = 仅诊断路由、URL 明文风险），且**仅诊断/只读**；C 层（未认证 loopback 只读诊断页）**须 owner 签字**后才可采纳。**「写接口认证可行性」是本 change 的必输出结论项（design D-7，独立于诊断页）**：A 层 cookie 为写接口硬门槛，cookie 不存活即写路径 FAIL 并显式阻塞 change 4 的写能力；备选「owner 签字的一次性短时效签名 token（绑定路径/用途、进程内短时效）」为待裁决项，未签字不得使用。
- 联动协议探测：在探针页内按前端写法布点多种点击调用，记录 TDX 侧响应范围；探针页无法自动断言的部分明确标注为「人工核对项」。
- 产出 Spike 报告 `docs/spikes/tdx-embed.md`：三态结论（已验证 / 人工核对确认 / 未验证）+ 每条路径四维度（渲染 / 传参 / 认证 / 跨源）的可行 / 受限 / 不可行判定 + 回退决策与触发条件 + 未决项 + 复现前提（TDX 版本、内嵌内核版本、DSH 版本与关键宿主包实测版本、源码检出路径）。
- 探针路由 spike 后保留为诊断页（开关 = 模块常量 `DIAGNOSTICS_DEFAULT = true`，见 design D-1；change 2 落地 `src/config.ts` 后由其接管），**不写任何业务数据**。

## Capabilities

### New Capabilities

- `tdx-embed-probe`: 同端口探针路由与页面（传参/hashchange/认证自检）、点击联动协议探测记录、以及可行性与回退决策报告产出。

### Modified Capabilities

（无。本 change 只做验证与探测，不改动既有需求行为。）

## Impact

- **新增代码**：`src/routes/probe.ts`（探针路由，含 `createProbeHandler` 纯工厂以便零 mock 单测）、`src/client/probe/index.html.ts`（导出 `PROBE_HTML` 常量：探针页**内联为 TS 模板字符串**，随 `tsdown` 编译进 `lib/**`，无需额外拷贝步骤——模板字符串天然落在既有 entry 的模块图里）；`apply(ctx)` 首次接入 `webServer` / `connection` 依赖与 disposer 纪律。
- **配置面（本 change 不引入 `Config`；评审 Issue 10 + Round 2 R2-2 定案）**：沿 `iteration-1-contracts §11`，`src/config.ts`（`export const Config`）的**唯一 owner 是 change 2**，本 change **MUST NOT 引入 `export const Config`、MUST NOT 扩写或保留 `TraderKitConfig`**。探针的 `basePath` 与诊断页开关先用**模块常量**（`PROBE_PATH = '/dsh-trader-kit/probe'`、`DIAGNOSTICS_DEFAULT = true`，落 `src/routes/probe.ts` 并导出以便单测/spec 断言），**不改 `cordis.patch.yml`**。C 层未认证只读开关同样**不是配置项**，而是代码常量（`UNAUTHENTICATED_READONLY_DEFAULT = false`，默认关闭；开启 MUST 先取得 owner 签字，见任务 1.7）。**回写项（change 2 接管）**：`src/config.ts` 落地后由 `Config` 的对应字段接管上述常量，`diagnostics` 子键命名需区分（诊断页开关 vs `probe.*` / `tdx17709.*`）；四项显式移交见 tasks 4.7，且该清单为可核对条目。
- **构建与发包（评审 Issue 7；定案 = 内联 TS 模板字符串，见下）**：探针页 HTML MUST 进构建产物且随包发布。实现期若改判为「copy 到 `lib/assets`」，则 MUST 同步把 `lib/assets` 写入 `package.json#files`、调整 `.gitignore`（不得让发包资产被忽略），并加同等断言。
- **新增文档**：`docs/spikes/tdx-embed.md`（spike 报告，成为 change 4 的输入）；证据落 `docs/spikes/`（二进制需脱敏，见 design D-8）。
- **不改动**：数据面、vault 写入、卡片存储、TQ skill——探针不触碰任何业务路径。
- **下游影响**：change 4（review-page）的页面承载形态（http 同端口 vs `file://` 回退）与认证策略由本 change 决策；结论还需回写 `docs/roadmap.md` **阶段 6 嵌入页行**与**阶段 2 桥取消/口径修正行**（roadmap §5 已登记），以及 `docs/architecture.md` 的能力边界说明。change 4 的 `blocked_by: change 1` 指本 change 的承载绑定层结论。
- **E4 冲突登记（本迭代部分未落地）**：`docs/roadmap.md §4` 拍板 E4 要求「spike 提前，**选股公式方言并入清单**」，而本 change 的 Non-Goals 排除方言探测（design Non-Goals）——两者并存互斥。裁定：**方言探测归阶段 6 前独立 spike**（`docs/roadmap.md §5` E4 行已登记「本迭代部分未落地」），本 change MUST NOT 视为已闭环 E4；design Open Questions 同步登记该移交。
- **TDX 侧人工动作**：需要 owner 在 TDX 中配置页面指向并观察（本 change 含人工核对清单，不可全自动）；**若 TDX 配置入口不可达或 owner 不在场**，结论按「未验证 + 阻塞原因 + 后续动作」出口（design D-9 与 spec），MUST NOT 编造二选一结论。
- **安全面**：C 层（未认证 loopback 只读诊断页）需 owner 签字，其开关是**代码常量**（`UNAUTHENTICATED_READONLY_DEFAULT = false`，签字后方可改动，非配置项——见 design D-1 / R2-6）；**业务写入 MUST NOT 依赖 B/C 层**（`iteration-1-contracts §12.1`：A 层不可用即写入接口不可用），且「写接口认证可行性」是结论节必输出项（design D-7）。P2/P3 在认证与跨源上均受宿主 `trust-fence.ts` 先例（拒 `Origin: null` / `Sec-Fetch-Site: cross-site`）与 cookie `HttpOnly; SameSite=Strict` 限制，处理方式（跳板代理 / 显式 CORS+PNA / 签名 URL）列为待验证项与降级路径（design D-3 与 Open Questions）。
