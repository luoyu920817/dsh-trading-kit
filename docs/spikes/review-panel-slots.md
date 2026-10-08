# review-loop 波 0 spike：DSH 面板通道（sidebar.panellist + conversation.send）

> 日期：2026-10-06。范围：review-loop tasks 1.1–1.3（面板注册与触发通道的可行性）。
> 结论状态：**宿主侧事实已核验 + 打包/安装已落地；GUI 三项（入口可见 / 面板渲染 / 按钮发送 prompt）
> 待 DSH 重启后人工确认**（本机当前无 DSH 进程）。

## 1. 已核验事实（tasks 1.1）

| 事实 | 证据 |
| --- | --- |
| 本插件挂载 profile = `web`（bundles：`@deepseek-ai/dsh-base` + `@deepseek-ai/dsh-web-app` + `dsh-trader-kit`） | `~/.dsh/profiles/web/package.json` |
| 宿主版本 `0.1.7-rc.1`（`dsh-base` / `dsh-web-app` / `dsh-client-modules` / `dsh-client-locale` 同版本） | `~/.dsh/profiles/node_modules/@deepseek-ai/*/package.json` |
| 侧边栏入口机制存在：`sidebar.panellist`（list 槽：`id` + 可选 `order` + `label`），**同一个 id 寻址**布局 root 作用域 keyed `main` 槽组件 | `dsh-client-ui-sidebar/README.zh.md`「面板入口」；`dsh-client-ui-layout` 的 `SlotMap['main']` 声明 |
| `sidebar.panellist` 在当前产品组合下**零占用**（官方包不注册示例面板） | 全包 grep 无注册点 + README 原文 |
| 会话注入 API：`ctx.conversation.send(text)`（"Send a prompt into the caller scope's session (queued turn)"） | `dsh-client-ui-conversation/lib/types/client/service.d.ts` |
| 浏览器半装载路径：包清单 `dsh.client = { platform, inject }` 由 `dsh-client-modules` 读取；`exports["./client"]` 产物由宿主服务在 `/plugins/<id>/client.js` | `dsh-client-modules/lib/client.js`；外部插件 `@linxin666/dsh-client-ui-git-graph@0.4.2` 同款声明 |

## 2. 已落地的实机侧准备（tasks 1.2 的可验证部分）

- `pnpm build` 产出 `lib/client.js` + `lib/panel/{Panel,params}.js`（宿主 SDK 与 React 全部 external）。
- `pnpm pack` 产出新 tgz；包内含 `package/lib/client.js`、`dsh.plugin.json`、`package.json`（`exports["./client"]` + `dsh.client` 声明）。
- 重装到 `web` profile（`pnpm install`，因 pnpm 对 `file:` 依赖按 lockfile 完整性缓存，需先移除 lockfile 条目再安装）：
  - `node_modules/dsh-trader-kit/lib/client.js` 存在；
  - `node_modules/dsh-trader-kit/package.json` 含 `dsh.client` 与 `exports["./client"]`。

## 3. 待人工确认（tasks 1.2 的 GUI 三项）

启动 DSH（`web` profile）后确认：

1. 侧边栏出现「复盘」入口（图标 + 标题，`order=60`）；
2. 点击后主面板渲染五块（交易日 / 当日标的 / 运行摘要 / 当日盘面 md / 触发按钮）；
3. 点「整理今日复盘」后，当前会话出现固定触发短语（= skill 的「触发短语」逐字一致）。

**回退判定（design D-2b）**：若 ①/② 任一不成立（槽行为与文档不符），改走
`sidebar.footer.action`（list 槽，footer 按钮）+ 弹出面板；仍不可用则退回「会话口令 + 提示文案」
并在 `docs/roadmap.md §5` 登记偏离。回退只影响 `src/client/**` 与面板打包，不影响 host 侧
（`/api/day`、TQ-Local 兜底、盘面 md、档案读取）。

## 4. 备注（与页面侧「整理」按钮的关系）

复盘卡片页（TDX 内嵌）已有「整理」按钮（owner 2026-10-06 追授，`POST /api/organize` 登记意图
并返回固定指令供用户粘贴到会话）。两者边界不同且互补：

- **页面按钮**：登记当前**标的**的整理意图 + 复制指令（页面与 agent 无推送通道是既定边界）；
- **DSH 面板按钮**：直接经 `conversation.send` 把**当日**触发短语发进当前会话（一步触发）。

两条路径都不自建 agent 运行；实际执行统一由 `review-daily-summary` skill 承担。
