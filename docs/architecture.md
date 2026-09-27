# 总体架构与能力边界地图（architecture）

> 立稿 2026-09-22。来源：dsh-trading 内三轮需求讨论 + 路线分叉决策
> （从 0 构建 + 直接搬运）。议题完整版：
> `E:\work\code\open\dsh-plugins\dsh-trading\docs\design\ashare-requirements-topics.md`。

## 1. 一句话定位

个人 A 股短线交易工作流的**执行层**：dsh 宿主上的自含插件——盘中挂在通达信
（自定义版面嵌入页），盘后跑收集与总结（agent 会话 + 定时 job），资产沉淀到
Obsidian vault。知（模式定义 + 每日 verdict）与行（journal / 台账 / 策略执行）
在模式 id 这个词汇上会合，由统计层互相验证。

## 2. 架构分层

```
┌─ 交互层 ────────────────────────────────────────────┐
│ 通达信：盘中看盘 / 日记 / 标记（思考的事实源）        │
│         + 自定义版面嵌入本插件 web 页（阶段 6）       │
│ dsh 宿主会话：盘后总结 / 精修 / 确认                  │
└──────────────────────────────────────────────────────┘
┌─ 执行层（本工程 dsh-trader-kit）─────────────────────┐
│ 工作流层（自建）：复盘 skill · 题材推导 · 盯盘调度    │
│ 基础设施层（搬运）：connector-tdx · research-data    │
│   · knowledge vault 引擎 · strategies · eventbus     │
└──────────────────────────────────────────────────────┘
┌─ 资产层 ────────────────────────────────────────────┐
│ Obsidian vault：交易系统/ · 题材调研/ · DB/           │
│ 事实源、看板、阅读面（沿 vault-integration 契约）    │
└──────────────────────────────────────────────────────┘
参考层（运行时无依赖）：dsh-trading —— 产品线，只读参考 + 搬运源
宿主：DSH —— agent 会话（typertGateway）、tokenized URL 桥、插件树
```

**分层判据（缺什么先问这句话）**：市场无关且他人可复用 → 基础设施（搬运自
dsh-trading）；只有本工作流的流程与判断 → 工作流层（自建）。

## 3. 与既有资产的关系

- **dsh-trading**：对外分发的多市场产品，继续独立演进。本工程运行时不依赖它
  （自含），只在搬运与再对照时读它。
- **vault**：资产层，本工程阶段 4 起读写。写入沿 vault-integration 的写分区
  契约（只写既定产物区：events/、知识卡片/、DB/opt/、DB/daily/），原子写，
  人工判断字段不代改，`·归档` 下架约定复用。
- **通达信 TQ-Local**（`127.0.0.1:17709`）：行情与板块数据面，只读。
  协议契约在 dsh-trading 的 connector-tdx 实测代码里，搬运即得。

## 4. 能力边界地图（学习路线即工程路线）

从 0 构建的首要目标是**撞墙**——每个阶段撞一面生态边界，撞过才算掌握：

| 阶段 | 内容 | 来源 | 撞的边界（能力地图） |
| --- | --- | --- | --- |
| 1 骨架 | npm 包 → patch 行 → 插件树 | 自建 | 插件范式：cordis 生命周期、patch insert、dsh.plugin.json 双通道、宿主安装 |
| 2 桥 | REST + SSE + tokenized URL | 自建 | 宿主 HTTP 面：桥的鉴权与事件出口（TDX 嵌入页的地基）——**迭代一裁决（roadmap §5 M2-Q2）：独立桥阶段取消**，宿主 HTTP 面由插件路由直接验证（探针 + 复盘页） |
| 3 数据面 | connector-tdx + research-data | 搬运 | MarketDataService 契约、provider registry、路由选择——**迭代一裁决：改为「三方接口工具（S7/S5/S8）+ TQ skill 安装器」，connector-tdx / research-data 不搬** |
| 4 知识 | knowledge vault 引擎 | 搬运 + 适配 | 宿主服务提供/消费、OneDrive 并发容忍、mtime 增量 |
| 5 工作流 | 盘后例行 job + 复盘 skill | 自建 | 宿主 agent 会话调度（typertGateway / tasks）、技能装配 |
| 6 策略 | strategies + 嵌入页 | 搬运 + 扩展 | UI toolview、嵌入页 token 归属（E4 spike 结论落地） |

### 4.1 宿主 HTTP 面与 TDX 嵌入页能力边界（spike-tdx-embed 实测结论，2026-09-27）

- **宿主 HTTP 面**：插件经 `ctx.webServer.register({kind:'exact'|'prefix', path, handler})` 在宿主同一 node:http 服务器上挂自有路由（**宿主不代插件鉴权**——handler 首行自行调 `ctx.connection.requestRejection`）；URL 经挂载时打印（端口可漂移）。探针页常驻诊断：`GET /dsh-trader-kit/probe`。
- **TDX 内嵌浏览器（实测，Chrome 81 / TdxW UA）**：可直接贴 http URL 打开同端口页面；ES2017 + Fetch + Promise 基线可解析；12 项内核特性探测全命中。**联动边界**：页面 → TDX 切标的用导航 `http://www.treeid/code_<代码>`（现网生产验证；6 种 JS 写法 0/6、window.open 被拦）；**TDX → 页面反向跟随不存在**（切换标的不改写内嵌页 hash）。详见 `docs/spikes/tdx-embed.md`。

## 5. 红线（不可让步项）

- TQ-Local 只调读取接口，绝不调用 `order_stock` / `cancel_order`。
- 不内置密钥；凭证走配置（沿 dsh-trading credentials 语义）。
- 输出仅研究辅助，不构成投资建议；不写交易指令，执行类语义 dry-run 默认。
- vault 只写既定产物区；交易框架 canvas 只读永不写；journal append-only。
- 搬运必带测试与溯源；参考源只读不回流。
