# spike-tdx-embed 证据归档（tasks 2.6）

> 纪律：每条证据标注「获取时间 / 环境（含 UA）/ 脱敏检查 / 证明什么 / 不证明什么」。
> 截图脱敏检查 = 账户、资金、持仓、自选股不可见；未通过者只记本地路径不入仓。

## E1 · DSH 桌面壳内渲染验证（**非 TDX**）

- **获取时间**：2026-09-27T13:13:16Z（页面注入时间戳）/ 归档 21:14 本地
- **环境**：DSH web profile（dsh 0.1.7-rc.1）· 打开容器 = DSH 桌面壳（ZCode/3.14.3，Chrome/146.0.7680.80，Electron/41.0.3）——**注意：这不是 TDX 内嵌浏览器**，UA 为准
- **路径**：A 层两步（token 登录 303 → 导航 `/dsh-trader-kit/probe`）在桌面壳内完成
- **证据文件**：`docs/spikes/evidence/E1-dsh-shell-render.png`（已脱敏检查通过：页面仅探针自检内容，无账户/资金/持仓信息）
- **观察到的事实**：
  1. 页面完整渲染，`window.__PROBE__ = {"auth":"cookie","status":200,"port":3080,"basePath":"/dsh-trader-kit","injectedAt":"2026-09-27T13:13:16.161Z"}`——**A 层两步登录在真实宿主成立**（SameSite=Strict cookie 在该容器内落地并随请求携带）；
  2. 自检输出：ES2017 + Fetch + Promise 基线语法在该内核可解析；`Promise/Fetch/WebSocket/EventSource/localStorage/sessionStorage/URLSearchParams/JSON/Object.assign/Array.prototype.includes/performance.now/navigator.sendBeacon` 全部可用（typeof 探测）；
  3. 传参三形态全缺 → 显式空态（「不显示任何推测标的」），符合 spec 空态要求；
  4. hashchange 时间线 boot 行正常（计数从 0 起）；6 种联动写法按钮区渲染完整。
- **证明什么**：探针页与认证链路在 Chromium 146 / Electron 41 级内核上完全可用；服务端注入与「非页面自证」标注生效。
- **不证明什么**：**不构成 TDX 内嵌浏览器的任何结论**——TDX 内核版本更低（P1/P2/P3 待 owner 在 TDX 内操作，见下「待办」）；也不证明点击联动（TDX 侧响应须 owner 目视确认）。

## E1b · DSH 桌面壳内交互验证（**非 TDX**；E1 的交互加深）

- **获取时间**：2026-09-27T13:14:21–28Z（页面注入/事件时间戳）/ 归档 21:16 本地
- **环境**：同 E1（DSH 桌面壳，ZCode/3.14.3，Chrome/146，Electron/41.0.3）——**不是 TDX**
- **证据文件**：`docs/spikes/evidence/E1b-dsh-shell-interaction.png`（脱敏检查通过）
- **观察到的事实**（全部符合 spec 预期）：
  1. **写法 5（postMessage）回环成立**：页面发出 message → 收到同源回环 `origin=http://127.0.0.1:3080, data={"from":"dsh-trader-kit-probe","way":5,...}`（页面侧记录链路通）；
  2. **写法 6（location.hash）生效**：hash 置为 `#probe-way-6`，hashchange 时间线记录 `#1: #probe-way-4 → #probe-way-6`（含前后 URL、解析结果、输入框快照）；
  3. **传参解析口径正确**：hash 值 `probe-way-6` 非 6 位数字 → 原样记录 + 显式标注「非法——非 6 位数字，原样记录不猜测补全」（不静默修正、不回退其它形态）；
  4. **输入框内容实时显示**（7 字符 `2344324`），hashchange 事件携带输入框快照（机制在位）；
  5. 页面二次 boot（13:14:21 新加载）后时间线计数从 0 重现——「若计数归零 = 发生重载」的反证判据可用。
- **证明什么**：探针页全部页面侧机制（自检/传参解析/hashchange 时间线/联动按钮布点/postMessage 回环）在 Chromium 146 内核上端到端可用；A 层 cookie 会话持续有效（第二次加载仍 `auth:"cookie"`）。
- **不证明什么**：同 E1——TDX 内嵌浏览器（更低版本内核）的渲染、传参、联动响应仍待 E2–E6。

## E2 · **TDX 内嵌浏览器实机验证（P1 主判据）——渲染/传参 PASS**

- **获取时间**：2026-09-27T13:51:21Z（页面注入时间戳）/ owner 粘贴页面自检全文 / 归档 22:0x 本地
- **环境**：**TDX 内嵌浏览器**，UA = `Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36 TdxW`（Chrome 81 内核 + TdxW 标识；NT 6.1 兼容层）
- **进入方式**：owner 在 TDX 内嵌浏览器地址栏直接粘贴 `http://127.0.0.1:3080/dsh-trader-kit/probe#600000`（免认证 C 层入口）——**P1 配置入口事实：TDX 内嵌浏览器可直接导航到任意 http URL**
- **观察到的事实（页面自检全文，owner 提供）**：
  1. `window.__PROBE__ = {"auth":"none","status":200,"port":3080,"basePath":"/dsh-trader-kit","injectedAt":"2026-09-27T13:51:21.899Z"}`——**C 层免认证放行在 TDX 内生效**；
  2. **渲染 PASS**：页面完整渲染，ES2017 + Fetch + Promise 基线语法在 Chrome 81 可解析（页面脚注自证行可见）；
  3. **内核特性全可用**（Chrome 81 下 typeof 探测全命中）：Promise / fetch / WebSocket / EventSource / localStorage / sessionStorage / URLSearchParams / JSON / Object.assign / Array.prototype.includes / performance.now / navigator.sendBeacon；
  4. **传参 PASS**：`hash 原值 600000` → `取值 600000（取自 hash，合法 6 位，前导零保留）`，query/path 缺失显式空态；
  5. 输入框内容 `123123` 实时回显（6 字符）；
  6. **点击联动·页面侧**：写法 1（onclick）触发；写法 2（element.click()）与写法 3（dispatchEvent）均派发（isTrusted=false/true 两条均有）；**写法 4（window.open）返回 null（被 TDX 拦截或未响应）**；写法 5（postMessage）发送且同源回环收到（origin=http://127.0.0.1:3080）；写法 6（location.hash）本次粘贴中未见记录（未点击或截断）。
- **证明什么**：P1 判据中「渲染 PASS ∧ 传参 PASS」成立；TDX 内嵌浏览器可承载探针页；内核能力足够支撑 B1–B4 前端（ES2017 基线 + 全部探测 API）。
- **不证明什么（三个待补维度）**：
  ① **联动 TDX 侧响应 UNKNOWN**——页面侧派发 ≠ TDX 切标的，须 owner 目视确认（写法 4 已证实被拦）；
  ② **hashchange UNKNOWN**——本次时间线只有 boot 行，owner 尚未在 TDX 内切换标的验证反向联动；
  ③ **A 层 cookie 存活 UNKNOWN**——`auth:"none"` 只证明 C 层；写接口认证结论须 dtk-probe-a → a2 两步实测。
- **脱敏检查**：通过（仅 UA、测试代码 600000/123123，无账户信息）。

## E3 · 联动与反向跟随（owner 口述结论，2026-09-27）

1. **正向联动 TDX 侧 0/6**：点击探针页 6 种写法按钮，TDX 主界面**均未切换标的**（owner 目视确认）；写法 4（window.open）另证被 TDX 拦截（返回 null）。页面侧派发记录见 E2。
2. **反向跟随 FAIL**：以 `http://127.0.0.1:3080/dsh-trader-kit/probe#xxxxxx` 作为配置入口时，TDX 内切换标的页面不跟随——`href` 停在初始 `#880476`（owner 实测）。
3. **现网联动通道指认**：owner 指认 `file:///D:/TDX_HOME/webs/company/涨停炸板时间轴.html` 为可联动先例；仓内核读（只读）确认其联动实现 = **导航至 `http://www.treeid/code_<代码>`**（L615；同机制另见 `AAAAjxbkpl*.html`、`ZTGJ2NIU.html`、`Excel文档转网页.html` 等 5+ 生产页面）——TDX 内嵌浏览器拦截该内部伪协议并切换主界面标的。该页无反向接收机制（列表页，数据走自身 API）。
- 脱敏：无截图（口述 + 仓内核读），无敏感信息。

## 待办（owner 在 TDX 内操作后追加）

- [ ] E2 · P1：TDX 配置入口指向 http 地址（两步登录）→ 截图 + 记录 TDX 版本、内嵌 UA、`auth` 取值
- [ ] E3 · P2：`file://` 跳板页 → `location.replace(http + '#' + code)` → 截图 + 实测请求头
- [ ] E4 · hashchange：TDX 内切换标的 → 时间线计数、输入框保留快照
- [ ] E5 · 点击联动：逐写法记录 TDX 侧响应（是否切标的）
- [ ] E6 · 跨源/认证障碍矩阵：实测 `Origin` / `Sec-Fetch-Site` / 响应码
