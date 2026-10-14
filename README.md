# dsh-trader-kit（TraderKit）

个人 A 股交易工作流插件（DSH / DeepSeek Harness 宿主）。围绕五大需求构建
「知行合一」闭环：盘面梳理 → 题材推导 → 每日闭环结论 → 历史统计 → 策略盯盘。

**与 dsh-trading 的关系**：dsh-trading 是对外分发的多市场产品（参考源，只读）；
本工程是个人快轨——从 0 构建以掌握 dsh 插件范式与能力边界，基础设施按需
**直接搬运**自 dsh-trading（带测试、带溯源，不重写、不回流）。搬运策略与
溯源台账见 [docs/carryover.md](docs/carryover.md)。

交互面：通达信（内嵌复盘页）+ dsh 宿主会话与侧边栏面板；资产层：Obsidian vault。

**当前状态（2026-10）**：迭代一「复盘卡片最小闭环 + 数据面先行」已落地——
复盘页、复盘面板、11 个会话工具、TQ skill 安装器均可用。策略盯盘（需求 5）、
知识库检索、历史统计分析半、定时盘后 job **尚未开工**。阶段裁决与路线见
[docs/roadmap.md](docs/roadmap.md)；目标与工程契约见 [AGENTS.md](AGENTS.md)。

## 当前可用什么

### 会话工具（DSH 会话内，host 半注册）

| 工具 | 用途 |
| --- | --- |
| `get_trade_date` | T0 交易日解析（唯一日期事实源，不读系统日期） |
| `get_limit_reason` | T1 涨停原因（S7 主源 / S5 备源，有界回溯） |
| `get_concepts` | T2 概念板块（S8 实时快照） |
| `get_stock_basics` | 通达信内置代码（999999 / 880xxx）名称兜底——TQ-Local `get_stock_info` 只读白名单 |
| `tq_skill_manage` | TQ 行情技能包（tdx-tq-local）install / update / status / deploy / uninstall |
| `review_daily_scan` `review_read_daily` `review_append_ainote` `review_daily_report` | 每日汇总四件套：扫当日有卡标的 → 读卡片与图片 → AI 附注追加（幂等 append-only）→ 运行摘要 |
| `review_stock_profiles` `review_write_brief` | 读 `DB/stock` 标的档案（`角色` 为口径）/ 写当日盘面 md（四段，唯一生产者） |

### HTTP 页面（宿主同端口，服务端仅绑回环）

- `GET /dsh-trader-kit/probe` —— 探针诊断页（TDX 内核特性探测 + S7/S5/S8/17709 可达性）。
- `GET /dsh-trader-kit/review` —— **复盘页**（TDX 内嵌浏览器可直开）：直链
  `/review/<code>` 与 hash/query 传参（`#sh000688`、`?code=sz000002`，显式市场前缀）；
  行情四格 + 概念标签 + 涨停原因；月历选日；卡片增删改 + 图片上传/删除；
  指数态（沪市指数 → S10 专用源，避免同码错配）；「整理」按钮复制固定指令到会话。
  产物落 `<dataRoot>/DB/review/<YYYYMM>/<代码>_<名称>_<YYYYMMDD>.md`。
- 认证：读通道默认免认证（owner 签字、仅 GET、仅回环）；写接口 = A 层 cookie
  或「回环 + 固定密钥」（`config.review.writeKey`，缺省进程随机生成、页面自动携带）。

### DSH 客户端半（浏览器）

- 侧边栏「复盘」面板（`sidebar.panellist` + `main` 槽）：目标交易日与来源、
  当日标的清单、运行摘要四态计数、盘面 md 状态、「整理今日复盘」按钮——
  按钮只把固定短语发进会话触发 skill，插件不自建 agent 运行。

### Skills

- `tdx-tq-local`：官方 zip 分发的 TQ 行情技能包，经 `tq_skill_manage` 安装；
  启动 autocheck 只检查不安装（`skill.autoCheck`）。
- `review-daily-summary`：盘后每日汇总工作流（本仓 `skills/` 维护），经
  `tq_skill_manage action=deploy` 部署到 `<dataRoot>/agent/skills/`。

### 数据源与落盘

- 出站源：S7/S5（涨停原因）、S8（概念实时快照）、S9 同花顺 realhead（名称 + 行情快照）、
  S10 腾讯（指数行情）、TQ-Local（**仅** `get_stock_info` 白名单，`sources.tqLocal.enabled` 可关）。
  全部经频控护栏（默认并发 2 / 间隔 1s / 单批 20 / 日预算 200，可配置）与两层缓存。
- vault 写分区（仅四条白名单路径）：`DB/review/`（卡片 + 当日盘面 md）、
  `agent/DB/temp/dsh-trader-kit/`（缓存与运行摘要）、`agent/skills/`（自产 skill 部署）、
  `DB/stock/`（标的档案——**只建不改**，首卡懒创建骨架）。

## 核心模块导航

不在此维护完整目录树；模块职责以本表为准，架构细节见 docs。

| 模块 | 职责 |
| --- | --- |
| `src/index.ts` | cordis 插件入口：四条线装配（probe / data / skill / review），只保留四行调用 |
| `src/config.ts` | schemastery 配置面（`dataRoot` / `sources` / `guard` / `skill` / `review.writeKey`） |
| `src/service/` | `traderKit` 服务唯一装配面：数据面出口 + 健康两段视图 |
| `src/data/` | 三方行情源适配（S5/S7/S8/S9/S10）+ TQ-Local 白名单闸（`http.ts`）+ 频控 guard + 缓存 |
| `src/tools/` | 会话工具 facade（与 service 出口「双出口同一实现」） |
| `src/skill/` | TQ skill 安装器：zip 加固、版本基线、遮蔽检测、localDir 部署 |
| `src/routes/` | probe + review 路由族（宿主 `webServer.register` exact/prefix） |
| `src/review/` | 复盘存储：append-only 卡片、md 解析、标的档案、沪深市场前缀标识 |
| `src/client/` | 客户端半：DSH 复盘面板（React）+ 复盘页内联 HTML（ES2017 子集）+ 图表基座（TvChart，阶段 6 接线） |
| `src/summary/` | 每日汇总：盘面 brief、运行摘要、AI 附注包 schema |
| `src/paths/` | dataRoot 解析与写分区白名单 |
| `src/indicators/` `src/strategies/` | 搬运种子（指标数学内核 / 价格精度约定）；阶段 6 随策略面全量搬运 |

## 5 分钟运行路径

前置：DSH 宿主可用（`dsh web` 能跑）、Node ≥ 20、pnpm ≥ 10。

```bash
pnpm install                                # ① 依赖
pnpm typecheck && pnpm build && pnpm test   # ② 轻量门禁（三绿）
pnpm pack                                   # ③ 产出 dsh-trader-kit-0.1.0.tgz
```

④ 挂进 profile（个人插件不入公共市场；本机实践 = web profile 两处登记）：

- profile 的 `package.json` dependencies 加本地 file: 依赖：
  `"dsh-trader-kit": "file:<绝对路径>/dsh-trader-kit-0.1.0.tgz"`；
- profile 的 `cordis.patch.yml` 加挂载行（模板即本仓 `cordis.patch.yml`），
  需要时同处写 config（不配置 `dataRoot` 也能挂载，写入/扫描类操作会显式报错）：

```yaml
- insert:
    - id: trader-kit
      name: 'dsh-trader-kit'
      config:
        dataRoot: '<你的 vault 数据根>'      # 含 DB/review、agent/skills 等
        review:
          writeKey: '<可选：固定写密钥；缺省进程随机、页面自动携带>'
```

npm 包通道（`dsh plugin --profile <name> add <pkg>`）的先例见
DSH-better-sidebar README 的安装节。

⑤ 验证（按序）：

1. 启动日志里找探针 URL（端口可漂移），浏览器打开 `GET /dsh-trader-kit/probe`；
2. 点击 DSH 左侧「复盘」按钮，在右侧主区域查看复盘卡片和关键词任务；配置入口为「设置 → 交易工作流」；
3. 会话内调 `tq_skill_manage`（`action: 'status'`）确认 TQ skill 状态；
4. TDX 内嵌浏览器贴 `http://127.0.0.1:<port>/dsh-trader-kit/review`（或直链
   `/review/<code>`），写一张卡片，确认 `DB/review/` 落盘。

## @预期 关键词工作流 MVP

保存含 `@预期` 的卡片后，登记并去重工作流；真实独立 Agent 整理原句、可观察条件和后续核验方式，结果与日志可在 `/dsh-trader-kit/review/processors` 查看、取消和显式重跑。默认自动执行关闭；缺宿主或模型配置时显示等待原因。

通达信复盘页只承担内容和事件来源，打开、保存、修订、删除不要求宿主登录或手动填写 token。成功保存后，服务端发布文档变更事件，DSH 回读真实卡片、解析关键词并持久登记工作流；输入页不读取管理接口。配置、执行历史、结果、取消与重跑在 DSH 内查看和操作。后台继续保留版本核验、去重、迟到结果保护和实际 Agent 激活预算；是否执行由宿主能力和当前执行配置决定。

当前事件来源为插件保存/修订/删除的实际存储提交；外部编辑器直接修改 vault 文件不在本次事件订阅范围。写接口沿既有本机来源检查与页面自动携带的写凭据，不需要用户登录动作。此前新增的登录链接、Cookie 登录桥和输入页管理信息展示已撤回。

「设置 → 交易工作流」提供「基本设置／关键词工作流」两页。「基本设置」展示当前生效的数据根、标的档案、模式、复盘与运行记录目录，以及 Agent、预算和只读数据开关。业务目录沿项目相对路径展示，数据根单独作为解析基准。标的、模式目录可分别点击「选择文件夹」或输入相对路径，选中数据根内的现有文件夹后点击「保存并应用」；默认值沿项目映射（如 `DB/stock`）。选择取消不保存，数据根外的目录及越界链接会被拒绝，不移动或迁移原文件。保存沿宿主配置编辑器持久化并重载插件，进行中的工作流会取消清理；保存后手动刷新查看当前值。缺原生选择器或持久配置能力时显示原因并禁用编辑。

模式目录当前仍为预留区，不表示模式工作流已接入。自动执行、模型服务、模型名称和 Agent 工作目录可在关键词页显式保存；预算等其余全局配置通过宿主「打开配置文件」修改。关键词页的「重新加载配置」仅重载工作流定义。目录配置为 `directories.stock` 和 `directories.patterns`，始终相对 `dataRoot`；标的档案读取和首卡只建不改使用同一目录配置。

「关键词工作流」按关键词导航，默认显示「任务记录」，包含已登记但尚未执行的等待任务，展示等待原因、来源标的、交易日和上海时间。切换「触发与执行设置」可调整该关键词工作流是否允许执行，以及所有关键词共用的自动执行、模型服务、模型名称和 Agent 工作目录。关键词开关关闭时仍可登记任务；只有自动执行及对应工作流都开启，且真实宿主与模型能力具备时才运行。高级 JSON 默认折叠，同一工作流的别名共享配置与任务记录。取消和显式重跑位于右侧「复盘 → 关键词任务」。

执行配置点击「保存执行配置」后才持久保存并重载插件，不自动选择或调用模型。服务标识和模型名称沿用 DSH 模型设置；Agent 工作目录为现有绝对目录，与业务数据目录相对路径的含义不同。开启可能接纳已有等待任务，重载会取消并清理运行中工作流。版本冲突须刷新后重新填写，缺宿主编辑能力时禁用保存并显示原因。当前实际模型可用性仍须真实执行验证。

配置示例、修改文件、验证证据和真实宿主验收阻断见 [MVP 交付说明](docs/spikes/keyword-framework-mvp-2026-10-11.md)。最新客户端安装与页面验收见 [导航与设置调整](docs/spikes/navigation-settings-2026-10-12.md)。未写真实 vault；次日自动回查和行情取证留待后续。

## 开发

```bash
pnpm typecheck && pnpm build && pnpm test
```

新写测试零 mock、零 sleep、断言完整；阶段严格按 [docs/roadmap.md](docs/roadmap.md)
顺序推进。安全红线（只读行情、不内置密钥、输出仅研究辅助、dry-run 默认）与
TQ-Local 边界见 [AGENTS.md](AGENTS.md)。

## 文档索引

- [docs/architecture.md](docs/architecture.md) —— 分层架构与能力边界地图
- [docs/roadmap.md](docs/roadmap.md) —— 阶段路线、议题裁决状态
- [docs/carryover.md](docs/carryover.md) —— 搬运策略与溯源台账
- [docs/design/](docs/design/) —— 迭代契约、每日闭环、盘后枢纽节点、数据契约、复盘页图像
- [Web Pro 架构与交互规划提示词](docs/prompts/chatgpt-web-pro-workflow-architecture-2026-10-14.md) —— 固定源码版本，联网调研最佳实践，输出可扩展架构、页面设计与可执行迭代计划
- [docs/spikes/](docs/spikes/) —— TDX 嵌入实测结论与证据
