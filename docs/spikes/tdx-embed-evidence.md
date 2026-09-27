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

## 待办（owner 在 TDX 内操作后追加）

- [ ] E2 · P1：TDX 配置入口指向 http 地址（两步登录）→ 截图 + 记录 TDX 版本、内嵌 UA、`auth` 取值
- [ ] E3 · P2：`file://` 跳板页 → `location.replace(http + '#' + code)` → 截图 + 实测请求头
- [ ] E4 · hashchange：TDX 内切换标的 → 时间线计数、输入框保留快照
- [ ] E5 · 点击联动：逐写法记录 TDX 侧响应（是否切标的）
- [ ] E6 · 跨源/认证障碍矩阵：实测 `Origin` / `Sec-Fetch-Site` / 响应码
