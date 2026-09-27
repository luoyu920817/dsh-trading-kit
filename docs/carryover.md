# 搬运策略与溯源台账（carryover）

> 立稿 2026-09-22。路线决策：不是重写、不是运行时依赖——**直接复制源码进本仓**，
> 本仓成为唯一事实源。dsh-trading 继续作为独立产品演进，两仓不自动同步。

## 1. 三条纪律

1. **带测试搬**。契约细节的真正载体是测试（quant-bars 的口径断言、rest 的
   ErrorId 用例、research-data 的信封四态用例）——测试就是可执行的契约。
   只搬实现不搬测试 = 搬了房子丢了地契。
2. **带溯源搬**。每包搬入时在本台账（§3）记录源 commit、搬入日期与本地偏离；
   搬入代码头部注释指向台账行。分不清「上游契约」和「本地改动」对学习目标
   是毒药。
3. **搬完冻结、定期再对照**。上游（dsh-trading 产品线）继续演进，搬运副本不
   自动跟进。每月对已搬包 `diff` 上游对应包一次，人工裁决是否跟进；diff 本身
   也是掌握两工程差异的复习材料。

## 2. 三层清单

| 层 | 内容 | 处置 |
| --- | --- | --- |
| **直接搬**（协议重、低频改） | connector-tdx、**api 契约子集**（Kline/QuantBar/错误分类/符号词汇）、**indicators**（strategies 硬依赖闭包）、kit-cn research-data、knowledge（store + vault 引擎）、strategies（引擎 + 范式 + screener）、eventbus、holdings store-core、**dsh-home**（home 解析 + `writeJsonAtomic` 原子写）、**watchlist**（TDX 板块镜像同步） | 连同测试一起搬、**按依赖闭包算齐**；源路径与 commit 记入台账 |
| **重新搭**（学习价值最高） | 插件骨架、工具注册、桥（REST+SSE+token）、UI toolview、home 解析、profile 接线 | 从 0 写；范式参照 DSH-better-sidebar |
| **不搬** | 其余 15 个连接器、四市场 bundle、市场复制手册、changesets 发布流、全量 CI 棘轮、桌面壳 | —（个人工程不需要） |

## 3. 溯源台账

| 目标模块 | 源（dsh-trading） | 源 commit | 搬入日期 | 偏离记录 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `src/tdx` | `packages/connector-tdx` | — | — | — | 未搬（阶段 3） |
| `src/research` | `packages/kit-cn/src/research-data.ts` + `research-tools.ts` | — | — | — | 未搬（阶段 3） |
| `src/knowledge` | `packages/knowledge`（store 契约 + graph + validate） | — | — | 无 cards.json 包袱：vault-fs 是唯一 store，frontmatter 契约沿 vault-integration §3 | 未搬（阶段 4） |
| `src/strategies` | `packages/strategies`（engine/types/paradigms/screeners） | — | — | 拟增可选 `patternId?` / `toTdxFormula?`（议题 E5/F1） | 未搬（阶段 6） |
| `src/eventbus` | `packages/eventbus` | — | — | — | 未搬（阶段 2，随桥） |
| `src/holdings` | `packages/holdings`（store-core/normalize） | — | — | — | 未搬（阶段 5 后按需） |
| `src/api-contracts` | `packages/api`（类型/错误分类/符号词汇**子集**） | `70ca2d8` | 2026-09-22 | **已搬（类型子集：Interval/Kline/AdjustedType/QuantBar/QuantBarSeries）**；服务接口面随阶段 3 连接器搬 | ✅ 部分搬 |
| `src/indicators` | `packages/indicators` | `70ca2d8` | 2026-09-22 | **已搬（种子：types + math，原文）**；registry/presets/validate/plugin/tool/chart-* 未搬（阶段 6） | ✅ 种子 |
| `src/home` | `packages/dsh-home` | — | — | home 路径解析 + 原子写，快照/知识落盘地基 | 未搬（阶段 3） |
| `src/watchlist` | `packages/watchlist`（`syncSectorsIntoWatchlistGroups`） | — | — | ZT/LB/炸板镜像同步服务需求 1/2 数据面 | 未搬（阶段 3/5） |
| `src/client/chart` | `client-ui-trading/src/client/`（TvChart/format/axis-width/color-mode/intraday-series + intraday-series.test + store.ts 观测引擎段） | `70ca2d8` | 2026-09-22 | **已搬（渲染核心）**：4 处导入路径改写为仓内相对路径（TvChart→indicators、format→strategies price-format、color-mode→observable、test 路径）；**2 处类型修正**（上游由 typecheck-baseline 计数容忍的已知债，本仓无基线严格门禁）：① `TvIndicatorGroup` 增可选 `title?`（L835 图例读数实际使用）② L496 `setData` 补 `as TvVolume[]`（同文件 L521 既有惯用法）——零运行时行为变化；本地新增 `chart/types.ts`（Kline 转引 + MarketId）；chart-state/marker-state/host-chart-sync/compose-quote-data/Sparkline 未搬（终端接线层） | ✅ 渲染核心 |
| `src/context-types.ts` | **DSH-better-sidebar** `src/context-types.ts`（插件范式参照仓，非 dsh-trading；检出路径 `E:\work\code\open\dsh-plugins\DSH-better-sidebar`，版本等价性未核验） | — | 2026-09-27 | **已搬（结构镜像做法 + 接口形态）**：仅保留本仓消费的 `webServer`/`connection`/`tools` 三面（better-sidebar 的 sessions/slots/settings 等 15+ 面不搬）；`webServer` 补 `port`/`host` getter（探针三行 URL 依赖，spike 设计已核验的宿主符号）；Request/Response/WebRoute 更名 `TraderKit` 前缀；`traderKit` 自有服务不走此文件，在 `src/service/index.ts` 用 declare module 增强 | ✅ 已搬 |
| `src/strategies` | `packages/strategies`（engine/types/paradigms/screeners） | — | 2026-09-22 | `price-format.ts` 已提前搬（图表 format.ts 依赖，原文）；其余未搬（阶段 6） | ⏳ 种子 + 未搬 |
| `src/data`（三方接口） | **脚本口径移植**（非整包）：`vault/agent/skills/a-stock-research-data/scripts/fetch_zt_timeline.py`（S7）、`fetch_limit_reason_local.py`（S5）、`fetch_concepts_xuangubao.py`（S8） | 无 git 仓（vault 内容）；见 §3.1 哈希/状态列 | 2026-09-27 | 见 §3.1「偏离清单」（`fields` 扩写、删本地 HTML 依赖、`firstTime` 只认 S7、两层缓存、`hitRecordDate` 分离、断言方式改结构断言） | ⏳ 迭代一（change `data-foundation`） |

> 填写规则：搬入时回填 commit（dsh-trading 仓 `git rev-parse HEAD`）与日期；
> 此后任何本地改动追加一行偏离记录（日期 + 内容 + 理由）。

### 3.1 脚本口径移植（vault Python 脚本 → `src/data/**`）

> 2026-09-27 增补。本类目既不是「自建工作流」也不是整包搬运：源是 vault 内的
> Python 脚本（`…\finance\agent\skills\a-stock-research-data\scripts\*.py`），
> 只移植**端点/参数/字段口径/兜底顺序**，实现语言与宿主接入均为本仓自建。
> 仍受 §1 三条纪律约束：带测试搬（口径断言进 `test/`）、带溯源搬（本表）、
> 搬完冻结并定期再对照。

| 目标模块 | 源脚本（vault） | 抓取日期 | 脚本哈希 / git 状态 | 偏离清单 | 状态 |
| --- | --- | --- | --- | --- | --- |
| `src/data/s7.ts` | `agent/skills/a-stock-research-data/scripts/fetch_zt_timeline.py` | 2026-09-27 | 待回填（sha256；vault 无 git → 记「无版本控制」） | ① 路由判据改为**请求日 vs 限流日**（脚本按 `beijing_today()` 判定当日）② `tradeDate` 改为从响应体**无条件**取值（脚本 `returned_date` 在 rows 为空时不赋值）③ 历史分支 MUST NOT 回退 List ④ 频控护栏 + 两层缓存（脚本无限流）⑤ 行号引用改符号名（`HSL_SIGN`/`HSL_TS`） | ⏳ |
| `src/data/s5.ts` | `…/fetch_limit_reason_local.py` | 2026-09-27 | 待回填（sha256；无版本控制） | ① 删除本地 HTML 依赖（`D:/TDX_HOME/webs/company/同花顺涨跌停原因.html`）② `marketId`（17/33）表化并写明北交所行为（脚本静默按深市）③ S5 时间值（`first_limit_time` = 最后封板）只进 `lastTime`，MUST NOT 进 `firstTime` ④ 命中记录日期（`_pick_news` 可回退到任意旧记录）拆为 `hitRecordDate` 独立字段/`notes` | ⏳ |
| `src/data/s8.ts` | `…/fetch_concepts_xuangubao.py` | 2026-09-27 | 待回填（sha256；无版本控制） | ① 请求 `fields` 扩为 `core_avg_pcp,plate_name,reason,plate_id,top_n_stocks`（原白名单不含 `reason`/`plate_id`）② `reason`/`plateId` 降为 best-effort（未返回则 `null` + `notes`）③ 列表级缓存复用 | ⏳ |

> 填写规则：抓取日期 = 本仓首次读取该脚本并据此定稿口径的日期；哈希列在本仓可
> 执行校验的环境（有 sha256 命令时）一次性回填，vault 侧脚本无版本控制须显式记
> 「无版本控制」，避免日后误以为可 `git diff` 对照（替代手段：每月人工对脚本
> 内容与「偏离清单」逐条复核）。
> `src/data/**` 模块头注释 MUST 回指本表行（任务见 change `data-foundation` tasks 8.4）。

## 3.2 外部资产台账（下载的第三方产物）

> 2026-09-27 增补（change `tq-skill-installer` tasks 5.1，有网环境实测）。
> TQ skill 是**下载的第三方产物**，非本仓搬运：适用 AGENTS 溯源纪律，字段与
> `traderKit.skill.status()` 输出的 `source` 段同组（源地址 / 首次获取时间 /
> 版本 / SHA-256 / 适用范围）。换机或重建后仅凭本台账可复核来源；换源（配置
> `skill.sourceUrl`）后须追加一行，不覆盖旧行。

| 字段 | 值 |
| --- | --- |
| 资产 | TDX 官方 TQ-Local skill 包（zip 分发，单条目 `SKILL.md`） |
| 源 URL（`skill.sourceUrl` 默认值） | `https://www.tdx.com.cn/products/autoup/skills/tdx-tq-local.zip` |
| 首次获取时间（`source.firstFetchedAt`） | 2026-09-27T11:37:40Z |
| 响应标识（`source.id` = etag\|lastModified 原样） | `"6aafc833-7681"` \| `Sun, 20 Sep 2026 11:49:07 GMT` |
| 版本（`SKILL.md` frontmatter `version`） | `1.2.0（2026-09-20）`（语义化版本 `1.2.0`） |
| zip SHA-256（`archiveHash`） | `09f4c39c4641c14f6c283ca402ea53a351ee4e97a4f3593d159ba13ee16ee0a6`（30337 字节） |
| `SKILL.md` SHA-256（`contentHash`） | `6d5fc828d427dc5e3e5996dcdb951bab44ac6a077736fa2a7b88bbec5140aa59`（215314 字节） |
| 适用范围 | 需求 1–5 的 TQ 数据面前置（agent 以 skill 形态读取执行；change 3 安装器维护、change 5 不消费） |
| 快照与实测清单 | `test/fixtures/official/tdx-tq-local-snapshot.zip` + `test/fixtures/official-zip-manifest.json`（响应头/条目/布局/ETag 实测结论） |
| 已弃用 vault 副本 | `<vault>/.claude/skills/tdx-tq-local/`（v1.0.12 / 106 KB）——**不读、不写、不校验、不迁移、不删除**，仅作历史示例记录 |

> 复核方法：重抓源 URL → 对比 ETag/Last-Modified（不同即有更新）→ 计算新
> SHA-256 并在本表追加一行；`status()` 的 `contentHash` 与本表逐字符比对。

## 4. 简化红利与遗留

- **vault 化无历史包袱**：本工程没有 cards.json，vault-fs 直接是唯一 store
  （实现沿 vault-integration §3 契约：KnowledgeCardStore 接口不动、换引擎）。
- 215 张存量卡（dsh-trading `$DSH_HOME/knowledge/cards.json`）如需并入，用
  vault-integration §3.7 设计的一次性迁移脚本灌入——可选、一次性、无实例运行时执行。
- 迁移 `docs/design/a-share-data-contract.md` 的口径（单位/时区/序列方向/信封
  四态）不重立约：**契约引用 dsh-trading 文档**，实现照搬，测试同源。

## 5. 扩展借鉴图（整包搬运之外的三种形态）

> 2026-09-22 增补：全景盘点 dsh-trading 后的分层借鉴清单——不整包搬的按此取用。

### 5.1 参考实现（读着抄关键段，不整包搬）

| 源（dsh-trading） | 借什么 | 落点阶段 |
| --- | --- | --- |
| `client-ui-trading/src/bridge.ts` | 桥的 tokenized URL、SSE 帧格式、Host 信任围栏、realm 代理模式 | 阶段 2 自建桥的主教材（better-sidebar 为第二参照） |
| `client-ui-trading/src/tasks/runner.ts` + `ledger.ts` | typertGateway 会话调度、agentPreset/权限派发、有界历史侦查账本 | 阶段 5 盘后例行 / 复盘 skill 的会话化执行 |
| `client-ui-strategies` 的 toolview 注册 + `MIDDLE_VIEWS` | 中栏视图注册表模式（视图即注册行） | 阶段 6 统计视图 / 嵌入页 |
| `router` 的「注册 ≠ 激活」语义 | `tradingMarketDataRegistry`：注册后由设置选谁谁激活、`routeAllows` 守门 | 阶段 3 简化自建（tdx 起步，留 qmt/eastmoney 扩展位） |

### 5.2 参考纪律（不搬代码，搬规矩）

- **`.agents/notes` 决策树**：proposed→implemented/rejected 生命周期、
  Alternatives 强制、每非平凡变更同变更记 why——本仓第 0 天建同款（治理
  DNA，学习价值最高的纪律资产）。
- **spikes/ 证据纪律**：外部集成先 spike 留真实响应证据（`impl-*/` +
  `REVIEW-LOG.md` 裁决）——E4 嵌入 spike、选股语句方言 spike 照此办。
- **先立约后实现**：`a-share-data-contract.md` 的契约文档范式（口径表 +
  失败语义 + 已知缺口）——B2 daily 契约、C1 快照 schema 照此产出。
- **测试卫生**：`scripts/test-audit.mjs`（BDD 命名/零 mock/零 sleep 检查器）
  可单独搬为轻量门禁（不搬全量 CI 棘轮）。
- **UI 验证流程**：宿主 tokenized HTTP URL + headless Chrome 截图 + profile
  刷新契约——阶段 2 起的验收手段。
- **BYOK 凭证引用模式**（`dshtrading.credentials.*` 命名空间）：HITHINK key
  等外部凭证的配置位命名沿此先例。

### 5.3 技能内容（md 层搬运/适配，阶段 5 起）

- `weekly-trading-plan`（六道闸门周计划）→ 周级节点消费；
- `trading-notes-setup`（双轨 append-only 日志）→ 日志轨契约；
- `knowledge-curation`（沉淀查重 SOP）→ 阶段 4 沉淀闸门；
- `trading-strategy-paradigms`（6 范式原理/调参/指标研读）→ 阶段 6 策略
  落地的伴读材料。
