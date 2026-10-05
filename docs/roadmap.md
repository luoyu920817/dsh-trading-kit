# 阶段路线与议题裁决（roadmap）

> 立稿 2026-09-22。完整 24 议题讨论源：
> `E:\work\code\open\dsh-plugins\dsh-trading\docs\design\ashare-requirements-topics.md`
> （本文件是其执行轨；路线已定——从 0 构建 + 直接搬运，住址即本工程）。
> 议题四类：拍板（owner 一句话）/ 立约（先写契约再实现）/ 详设（下一轮）/ spike（实测）。

## 1. 五需求 → 阶段映射

| 需求 | 落点 | 首次可用阶段 |
| --- | --- | --- |
| 1 盘面梳理（TDX 日记 + 关键词） | 盘后枢纽 · 输入侧 | 阶段 5 |
| 2 题材推导归纳（知识库 + 导图） | 周级节点 | 阶段 5（增量）/ 6 后（深度） |
| 3 每日闭环结论（verdict + todo） | 盘后枢纽 · 输出侧 | 阶段 5 |
| 4 历史统计 | 采集半（尽早启动）+ 分析半 | 采集随阶段 3；分析阶段 6 后 |
| 5 策略盯盘闭环（嵌入页 + 事件总线） | 独立线 | 阶段 6（E4 spike 可提前） |

## 2. 阶段路线（学习边界与价值产出对齐）

| 阶段 | 内容 | 来源 | 出口产物（可用性判据） |
| --- | --- | --- | --- |
| 1 骨架 | manifest + patch + 插件入口 + 工具链 | 自建 | 宿主可挂载；typecheck/build/test 绿 |
| 2 桥 | REST + SSE + tokenized URL | 自建 | tokenized URL 可访问的最小端点 + 事件推送 |
| 3 数据面 | connector-tdx + research-data | 搬运 | 会话内 cn 行情/研究数据工具可用；快照采集可启动 |
| 4 知识 | knowledge vault 引擎 | 搬运 + 适配 | knowledge_search/get 命中 vault 内容 |
| 5 工作流 | 盘后例行 job + 复盘 skill | 自建 | 快照每日落盘；复盘两段式落 `DB/daily/` |
| 6 策略 | strategies + patternId/toTdxFormula + 嵌入页 | 搬运 + 扩展 | screener 挂模式；嵌入页显示盯盘告警（E4 结论落地） |

**防呆规则**：严格按序推进、每阶段有可用产物——防止「重建吞掉五需求」；
模式 id 从阶段 5 第一天进 verdict（时间不可逆，粒度可先粗后全）。

## 3. 议题索引（精简版，完整讨论见议题源）

- **A 线 · 知识库（P0）**：roots 纳入 `DB/`（新工程内即 vault-fs 首要 roots
  决策）；frontmatter/canvas 解析细则（详设）。
- **B 线 · 复盘闭环（P1）**：B1 需求 1+3 合并【路线已定，随本工程实施】；
  B2 `DB/daily/` 契约立约；B3 强阻塞 + 老化 N；B4 核销写回边界（「授权回填」
  定义）；B5+C2 盘后例行 job；B6 关键词词表；B7 设施编织。
- **C 线 · 采集（P2）**：C1 快照 schema 立约；C2 程序 job；C3 范围 + 龙虎榜回填。
- **D 线 · 题材 + 统计（P3）**：D1 生命周期四态；D2 mermaid 先行；D3 增量/深度
  节奏；D4 主线合成 SOP；D5 统计视图；D6 模式胜率 join。
- **E 线 · 盯盘（P4）**：E1 新建领域事件服务（不扩 tradingEvents 语义）；
  E2 阶段调度器；E3 告警降噪；E4 TDX 嵌入 spike（含选股语句方言，可提前）；
  E5 `patternId` / `toTdxFormula`。
- **F 线 · 模式统一（横切）**：F1 模式 id 粒度与命名；F2 归属记账分工
  （journal 红线不动）；F3 模式分解（量化半/判断半）；F4 OPT 回路。
- **G 线 · 编排**：dsh-trading instrument-workspace 分支收口（上游事务）；
  E4 spike 提前；模式 id 提前打标。

## 4. 拍板清单（owner 逐条裁决）

| 议题 | 摘要 | 建议 | 裁决 |
| --- | --- | --- | --- |
| B2 | daily 契约先立约；状态复用 vault 事件词表 | 是 | |
| B3 | 闭环强阻塞 + 老化 N=5 | 是 / N=5 | |
| B4 | 会话内确认写回 = 授权回填（写分区细则定义） | 是 | |
| B5+C2 | 17:30 单一「盘后例行」job（快照 + 预热） | 合并 | |
| C3 | 首版快照四项 + 龙虎榜一次性回填 | 按列 | |
| D1 | 生命周期四态 frontmatter，与事件状态正交 | 是 | |
| D2 | mermaid 先行，canvas 后议 | 是 | |
| E1 | 新建领域事件服务，不扩 tradingEvents | 新建 | |
| E4 | spike 提前，选股公式方言并入清单 | 是 | |
| E5 | 加 `patternId` / `toTdxFormula` 可选字段 | 是 | |
| F1 | 首版模式级粒度，id 规范并入 vault 契约 | 是 | |
| F2 | journal 加可选模式指针，红线不动 | 是 | |

（B1 需求 1+3 合并已随路线定型；F1 起源词表建议：`超短` / `价投` / `期货`
三命名空间 + 首批模式级 id 十余个。）

### 5.0 安全面决策（spike-tdx-embed C 层签字）

- **2026-09-27：owner 签字采纳 C 层（未认证 loopback 只读回退）**——动机：TDX 内嵌
  浏览器不保证携带宿主 cookie，探针承载验证需要免认证只读入口。**放宽点**：仅本插件
  探针路由（`/dsh-trader-kit/probe`）、仅 GET 只读、仅救 401（403 跨站栅栏不救援）、
  服务端仅绑 127.0.0.1；**业务写入通道 MUST NOT 走 C 层**（写接口认证 = A 层 cookie
  硬门槛，change 4 落地时不受本签字影响）。落地形态：代码常量
  `UNAUTHENTICATED_READONLY_DEFAULT = true`（`src/routes/probe.ts`，非配置项）。
  关闭态行为由测试以注入方式持续覆盖；17709 TCP 探测同日裁决为默认开
  （`diagnostics.tdx17709.enabled` 默认 `true`，data-foundation D-8）。

- **2026-10-05：owner 签字「全部免签名」——复盘页读通道免认证采纳**（第二次 C 层签字）：放宽点 = 仅本插件
  /review 路由族 GET 只读、服务端仅绑 127.0.0.1；写接口 A 层硬门槛不变。落地 = `ALLOW_UNAUTHENTICATED_READ_DEFAULT=true`。
- **2026-10-05：owner 指示「找到最近期的交易日」与「名称必须显示」**——T0 增会话集合比对（S7 List 无日期字段的
  数据驱动修正，spec 补丁见 trade-date-tool）+ 名称层②增同花顺 realhead 行情源兜底（`S9` 具名源，quote-name.ts）。
  二者均为 spec 先行修订后实现（提交 c25f8a3）。
- **2026-10-05：owner 裁决「写卡免登录——IP 白名单或固定 key」**——写接口认证修订：
  凭据 = A 层 cookie（保留）或「回环来源 + 固定密钥」双因子（宿主仅绑 127.0.0.1；
  密钥 = `config.review.writeKey`，缺省进程随机生成并经页面注入自动携带，页面读者
  与密钥持有者同为回环访问者）。落地 = routes writeCredentialValid + 页面 x-write-key
  自动携带；安全边界：**写接口仍有两道检查（来源 + 密钥），仅绑定形态放宽**。

## 5. 迭代一重排（2026-09-27）

本迭代**刻意不按 §2 阶段顺序推进**（「迭代一」= 复盘卡片最小闭环 + 数据面先行的
裁决轨，优先交付可用产物）。裁决与依据见 `docs/design/iteration-1-contracts.md`
与各 change `design.md` 的「评审处置」节。

| 事项 | 裁决 | 对 §2 / §4 的影响 |
| --- | --- | --- |
| M2-Q2：复盘页面 = DSH 同端口二级页面（页面即插件路由，数据经 service 直取） | 拍板 | **阶段 2「桥（REST + SSE + tokenized URL）」不再作为独立阶段**：宿主 HTTP 面能力由 change 1 探针与 change 4 路由直接验证；SSE 桥只在后续需求出现时再议 |
| M2-Q3：卡片分节 MVP 只写 `writtenAt`，盘面快照 `sourceContext` 后置 | 拍板 | `sourceContext` 仅对后继新卡生效，MUST NOT 回填既有分节（append-only 边界） |
| 数据面分工：TQ 走官方 skill（不固化进 TS），三方接口（S7/S5/S8）封装插件工具 | 拍板 | 阶段 3 的「connector-tdx + research-data 搬运」改为「三方接口工具 + TQ skill 安装器」；connector-tdx / research-data **不搬** |
| 写分区例外：`DB/review/`、`agent/DB/temp/dsh-trader-kit/` | 立约 | 「vault 写入：阶段 4 起才触 vault」在本迭代对这两条白名单路径开例外；其余既定产物区不动（AGENTS.md 与 vault-integration 需同步登记） |
| 阶段 5 折算：本迭代交付「阶段 3 数据面子集 + 阶段 4 写分区子集 + 阶段 5 复盘 skill 子集」 | 立约 | 阶段 1 骨架已完成；阶段 6（嵌入页 + 策略盯盘）不在本迭代 |
| D-TQ：页面所需业务日期/名称的取数边界（R2/R5 的 `get_match_stkinfo` / `HqDate` vs「TQ 不固化」） | **待裁决**（默认处置 = 选项 A） | 默认处置：名称走 T2/S8 → 历史卡 frontmatter → 仅代码；日期走 `resolveTradeDate`（`iteration-1-contracts §1`）。复审触发条件：owner 裁决选项 B，或「插件直调 17709」边界放开的裁决 |
| E4：spike 提前 + 选股公式方言并入清单（§4） | 拍板，但本迭代**部分未落地** | change 1 探针按 Non-Goals 排除方言探测；选股语句方言探测归阶段 6 前独立 spike，本条不再视为已闭环 |
| spike-tdx-embed 结论（2026-09-27 实测） | **P1 受限 → 采用 http 同端口页面**：TDX 内嵌内核 Chrome 81/TdxW，探针页渲染与传参 PASS；联动 6 写法 TDX 侧 0/6（window.open 被拦）、反向跟随不存在；**联动改用 `http://www.treeid/code_<代码>` 导航**（现网生产验证）；C 层免认证只读已签字采纳 | change 4 页面「在 TDX 打开标的」用 treeid 链接；B1 不自动跟随 TDX 选中（输码/页面内点选为入口）；写接口仍只认 A 层（TDX 内未验证存活 → 页面只读降级 + DSH 侧写卡）；报告 `docs/spikes/tdx-embed.md` |

**本迭代 change 映射**：change 1 `spike-tdx-embed`（可行性闸门）/ 2 `data-foundation`
（数据目录范式 + T1/T2 + T0 `get_trade_date`）/ 3 `tq-skill-installer`（TQ skill 安装器）/
4 `review-page`（复盘页面 + 卡片存储）/ 5 `daily-summary`（每日汇总与 AI 附注）。
