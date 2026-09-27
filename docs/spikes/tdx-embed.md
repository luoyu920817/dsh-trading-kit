# spike 报告：TDX 内嵌浏览器承载探针（spike-tdx-embed）

> 定位：change 1（spike-tdx-embed）的可行性闸门报告——回答「复盘页面能否以
> http 同端口页面承载在 TDX 内嵌浏览器中」。证据归档：`docs/spikes/tdx-embed-evidence.md`
> （E1/E1b/E2）。本报告勾选 tasks 2.x/3.x/4.x 各项的验收记录。

## 1. 结论（三态判定表 + 决策）

### 1.1 判定表（路径 × 维度 × 状态 + 证据）

| 路径 | 维度 | 状态 | 证据 |
| --- | --- | --- | --- |
| **P1** http URL 直开（TDX 内贴 URL / 配置入口） | 渲染 | **PASS** | E2：TdxW UA（Chrome 81 内核）下探针页完整渲染；ES2017 + Fetch + Promise 基线可解析（页面自证行可见）；12 项内核特性探测全命中 |
| P1 | 传参 | **PASS** | E2：`#600000` → `取值 600000（合法 6 位，前导零保留）`，query/path 缺失显式空态；hashchange 机制页面侧 PASS（E1b：写法 6 触发 `#probe-way-4→#probe-way-6` 计数递增、不重载） |
| P1 | 认证 | **PASS（C 层）** | E2：`auth:"none"` 在 TDX 内生效（owner 2026-09-27 签字的免认证只读）；B 层 token 同源机制本机实证；**A 层 cookie 在 TDX 内存活 = 未验证**（见「写接口认证结论」） |
| P1 | 联动（页面 → TDX 切标的） | **FAIL（6 写法）** | E2/E3：owner 目视确认 6 种写法**均未使 TDX 切标的**；写法 4（window.open）返回 null 被 TDX 拦截；**但发现现网已验证的联动通道 = 导航至 `http://www.treeid/code_<代码>`**（`涨停炸板时间轴.html` 等 5+ 生产页面在用，owner 指认） |
| P1 | 联动（TDX → 页面跟随） | **FAIL** | owner 实测（E3）：TDX 内切换标的时页面 hash 不更新（`href` 停在初始 `#880476`）——普通 URL 配置下 TDX 不回写内嵌页 hash；现有生产页面亦无反向接收机制（均为列表页，靠自身 API 取数） |
| **P2** `file://` 跳板页 | 全部 | **未执行（非 FAIL）** | P1 免认证直达成立后跳板失去必要性；跳板文件已备（`docs/spikes/evidence/p2-jumper.html` + TDX 侧 `dtk-probe-*.html`），按时间盒收敛规则不再消耗实测窗口 |
| **P3** `file://` 就地 + 本地取数 | 全部 | **未执行（非 FAIL）** | 同上；C 层签字后 P3 的 CORS/PNA/认证处理动机消失 |

### 1.2 决策（D-7 三态映射）

**P1 = 受限，且 `渲染 PASS ∧ 认证(C 层) PASS` → 终局决策：采用 http 同端口页面**（不回退 `file://`）。

受限点清单与对 change 4（review-page）的降级要求：

1. **联动通道**：页面 → TDX 切标的改用 **`http://www.treeid/code_<代码>` 导航**（现网生产验证过的 TDX 内部伪协议；probe 的 6 种 JS 写法在 TDX 侧 0/6，window.open 被拦截）。change 4 页面的「在 TDX 中打开标的」动作用 treeid 链接；探针页不扩写第 7 种写法（tasks §0 上限纪律），treeid 机制由本报告采纳并经 owner 一条实测确认（见未决项①）。
2. **反向跟随不存在**：B1 头部**不自动跟随** TDX 当前选中标的；现场入口 = B3 输入框手输/页面内列表点选（现场优先原则下可接受：输码一步是既有工作流习惯，涨停炸板时间轴同款）。反向跟随的替代机制（TDX 版本特定绑定）列入未决项②，不阻塞 change 4。
3. **写接口认证结论（必输出项，design D-7）**：**受限**——A 层两步在 TDX 内未实测（owner 未执行 dtk-probe-a → a2）；本机 DSH 桌面壳内 A 层已验证可用（E1：303 铸 cookie → `auth:"cookie"`）。落地口径：**change 4 写接口按「只认 A 层」实现不变**（`§12.1` 红线）；在 TDX 内打开复盘页时若 A 层 cookie 不存活 → 写接口显式不可用（页面只读降级 + 提示改到 DSH 侧写卡）；若 owner 补测 A 层存活 → 升级为 TDX 内可写。**C 层不承接写入；B 层命中不推导写接口可用**。
4. **window.open 不可用**：页面交互不依赖弹窗。
5. 时间盒纪律：TDX 人工实测合计 < 30 分钟（两轮观察 + 一次联动确认），未触及 2h 上限；「探测不可执行」出口未触发（tasks 2.7 = 本次未触发记录）。

## 2. 复现前提（tasks 4.1）

| 项 | 值 |
| --- | --- |
| TDX 版本号 | **未记录**（owner 未提供「帮助→关于」版本号；未决项③） |
| 内嵌内核版本 | Chrome 81.0.4044.138（UA：`Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36 TdxW`） |
| DSH 版本 | 0.1.7-rc.1 |
| `@deepseek-ai/dsh-host-webserver` / `dsh-client-connection` 实测版本 | 随 dsh 0.1.7-rc.1 内置（独立包版本号未能单独读取——pnpm 布局未检出，未决项④） |
| 宿主源码检出路径与关键符号 | `E:\work\code\open\deepseek-harness`（`webserver/src/index.ts:register` 对重复 `(kind,path)` 抛错、`connection/src/rpc-host.ts:requestRejection` 返回 401/403/undefined、`browser-auth.ts:authenticatedUrl` 拼 launchToken——**已核验（本机检出路径，版本等价性未核验）**，沿 spike design §Context 引用） |
| 适用版本范围 | 本次结论适用于「内嵌内核 = Chromium 81 级 + C 层已签字」的组合；内核更老或 C 层收回签字时须重测 |

## 3. 依据原文摘录与核验状态（tasks 3.3 / 4.1）

- **`iteration-1-contracts §11`（配置面所有权）**：`src/config.ts` 唯一 owner = change 2；change 1 用模块常量——**已核验**（仓内文档，probe 实现遵守）。
- **P1/P2/P3 定义**：spike design D-4 承载路径矩阵（本仓内）——**已核验**；P1 判据「hash 变化时 hashchange 计数递增」由 E1b（DSH 壳内）+ E2（TDX 内传参读取）共同覆盖。
- **F5（盘中页面）定义**：**仓外文档，未能核验**。缺失项清单：
  | 缺失文档 | 需要章节 | 影响哪条结论 |
  | --- | --- | --- |
  | `需求说明文档.md` F5（盘中页面） | F5 对点击联动方向与承载形态的要求 | 判定 treeid 通道是否满足 F5；反向跟随缺失是否命中 P1（现场即时）判据 |
  | `盘面数据源Provider说明.md` 联动相关节 | 联动协议定义 | 同上 |
- **E4 方言探测移交**（tasks 4.9）：**未落地、不闭环**——选股公式方言探测归阶段 6 前独立 spike，已登记于 `docs/roadmap.md` §5 E4 行；触发条件 = 阶段 6（嵌入页 + 策略盯盘）开工前。

## 4. 未决项

1. **treeid 正向联动一条实测确认**：在 TDX 内嵌浏览器地址栏贴 `http://www.treeid/code_600000`，确认 TDX 切到浦发银行（本报告决策的最后一环）。
2. **反向跟随替代机制**：TDX 是否存在版本特定的网页绑定/参数回写配置（影响 B1 自动跟随）；调查不阻塞 change 4。
3. **TDX 版本号**（帮助→关于）。
4. **A 层 cookie 在 TDX 内存活**：dtk-probe-a → a2 两步实测（决定 TDX 内写卡是否开通；不测则按写接口在 TDX 内不可用落地）。
5. **webserver/connection 独立包版本号**（未单独读取）。

## 5. 跨 change 口径移交清单（tasks 4.7，六项）

1. **change 2 的 `Config` 落点与 `TraderKitConfig` 去留**：`src/config.ts`（`export const Config`）唯一 owner = change 2 ✅（已落地，含 `diagnostics` 段）；`TraderKitConfig` 已删除、无第二份配置类型；`PROBE_PATH`/`DIAGNOSTICS_DEFAULT`/`UNAUTHENTICATED_READONLY_DEFAULT` 常量在 change 2 后续按需接管（核对方式：`grep -n "TraderKitConfig" src/` 为 0）。
2. **`diagnostics` 子键命名区分**：诊断页开关 = `diagnostics.probe.enabled`（change 2 已定）与 `probe.*` 模块常量、`diagnostics.tdx17709.enabled` 互不同名 ✅（核对：`src/config.ts` diagnostics 段）。
3. **change 3 的依赖对象**：`Config.skill` 段 `blocked_by` 指向 change 2 已落地的同一 `Config` 根 ✅（change 3 tasks 4.1 已按此执行——追加不重建）。
4. **proposal 措辞**：`data-foundation/proposal.md`「配置面首次落地」应读作「change 2 首次落地 `src/config.ts` 的 `Config`（change 1 用模块常量）」✅（现状文本已符合，无需改动）。
5. **（R2-3）change 4 认证分层语义**：B 层 = 仅诊断/只读；**写接口用本报告第 1.2 节第 3 条「写接口认证结论」所指机制（A 层硬门槛）**；change 4 tasks 2.2 的「A 层不可用即写接口显式不可用」在本仓语境下落地为：TDX 内 A 层未存活时页面只读降级 + 提示 DSH 侧写卡（核对：change 4 tasks 2.2 原文与 D-3）。
6. **（R2-7）`§7` 出站通道口径**：结构断言作用域 = `src/**`，显式豁免 `test/**` 与内联 HTML 常量；`test/**` 零 `fetch(`/`http.request` ✅（核对：`test/probe/probe-registration.test.ts` 边界扫描）。

## 6. 门禁与证据索引

- 门禁：`pnpm typecheck && pnpm build && pnpm test` 全绿（282 用例，含 probe 线 64 个）；本报告不影响门禁（文档变更）。
- 证据索引：E1（DSH 桌面壳渲染）/ E1b（DSH 壳交互）/ E2（TDX 渲染+传参+联动页面侧）/ E3（联动 TDX 侧无响应 + 反向跟随 FAIL + treeid 通道指认）→ `docs/spikes/tdx-embed-evidence.md`；脱敏检查全部通过。
- 探针页去留：按 spec 保留为**常驻诊断页**（`DIAGNOSTICS_DEFAULT=true`，C 层只读放行）。
