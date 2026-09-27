# Plan Review: 复盘页面与卡片存储（review-page）
**Plan File**: openspec/changes/review-page/（proposal + specs + design + tasks）
**Reviewer**: Independent Reviewer (subagent)

---

## Round 1 — 2026-09-27

### Overall Assessment

方案在「契约先行、跨 change 引用、安全红线、Non-Goals」上明显高于本仓既有水平：跨 change 断言（D-9 → `limit-reason-tool` 的 `tradeDate` 语义、D-5 → T2 名称 best-effort、500 ms 只约束本地段）经逐条核验**基本成立**，D-TQ 偏离也被显式登记而非偷偷实现。但**可执行性**与**边界完备性**存在硬伤：`design.md` 的「单接口聚合」与「本地 500 ms 出屏」自相矛盾；`review-card-store` 的「非交易日归属确认」在 D-9 的 seam 语义下**永不触发**（且全案无交易日历来源）；下游 change 5 明确要求「共享同一锁/重试纪律」，本 change 却未定义任何锁与重试参数；文件名/ frontmatter 对外部来源的 `name` 无净化要求（`*ST` 在 Windows 直接非法）；roadmap/AGENTS 的「阶段 4 起才触 vault」「既定产物区」与本次写入 `DB/review/` 冲突但无重排任务。以上属**实现前必须修订**项。
**Rating**: 5/10

### Issues

#### Issue 1 (Critical): 「非交易日归属确认」在 D-9 的 seam 语义下永不触发，且无交易日历来源
**Location**: `openspec/changes/review-page/specs/review-card-store/spec.md:72,84-87` vs `openspec/changes/review-page/design.md:78`
spec 要求「判定为非交易日 SHALL 在提交前给出归属确认，MUST NOT 静默归属」；而 design.md:78/D-9 把默认归属日固定为「T1 缺省调用（最近交易日口径）返回的 `tradeDate`」（该口径本身经核验成立：`data-foundation/specs/limit-reason-tool/spec.md:5,17-20`）。周末/长假/盘前该调用**必然返回上一交易日**，seam 永不返回 `null`，于是：① 确认分支不可达，spec 场景 84-87 无法满足；② 长假中写的卡片被**静默**归到上一交易日，直接违反 spec:72 的「MUST NOT 静默归属」；③ 全案无任何「交易日历」来源（仓内 `openspec/**` 与 `docs/**` 均无），「判定非交易日」缺实现基础。
**Suggestion**: 把 seam 改为结构化返回 `{ businessDate, isTradingDay: boolean|null, source, confidence }`；明确「目标归属日 = 用户选中日期（缺省=系统日）对应的交易日」，`isTradingDay=null`（无日历）时**必须**走确认而不落盘；补 spec 场景覆盖「周末 / 长假第 N 天 / 盘前 09:00 / 隔日补写」，并把「交易日历来源」登记为显式依赖（TQ skill 结论或 `data-foundation` 增补），未定则 tasks 3.x 标 blocked。

#### Issue 2 (Critical): D-1「单接口聚合」与 D-7「本地 ≤500 ms 出屏」自相矛盾
**Location**: `openspec/changes/review-page/design.md:37,68`、`specs/review-page/spec.md:88-91`
D-1 的 `GET /review/api/context` 声明「一次聚合：名称 + 归属日 + 当日卡片 + **B1 网络段（标签/最近涨停原因）**」，D-7 又说「本地段与网络段**同响应**返回，但页面按段渲染（先渲染降级态，回填后替换）」。单次 HTTP 响应无法在同一响应内「先本地后网络」——页面拿到响应前拿不到本地段；而网络段按 D-8 是「逐日回溯 ≤10 次 × 最小间隔 1 s」（`data-foundation/design.md:54`）即 **≥9-10 s**，本地出屏被整体拖到 10 s 级。spec:88-91 的性能场景因此不可满足，tasks 4.6 无法验收。
**Suggestion**: 拆成 `GET /review/api/local?code=&date=`（纯本地，含名称回退与卡片、日期）与 `GET /review/api/enrich?code=`（网络段），或在 spec 中允许 SSE 分段推送；把「本地段与网络段 MUST 为独立请求（或事件流），首屏 MUST NOT await 网络段」写成 spec Requirement + 断言（`/api/local` 冷启动 <500 ms）。

#### Issue 3 (Critical): 写路径无输入净化 → 文件名/frontmatter 注入与必然写失败（`*ST` 等）
**Location**: `openspec/changes/review-page/specs/review-card-store/spec.md:5,25,29`；`design.md:60`；`specs/review-card-store/spec.md` 全篇无输入校验 Requirement
文件名 `<代码>_<名称>_<YYYYMMDD>.md` 的「名称」来自外部源（T2/S8 `stock_chi_name`，`concepts-tool/spec.md:43`）。A 股 ST 名称常带 `*`（spec:19 自己就以「更名/ST」为例），而 Windows 文件名禁用 `\ / : * ? " < > |`：`600000_*ST海航_20260924.md` 直接 `ENOENT/EINVAL`，spec:127-134 的「写盘失败可重试」救不了（永久失败且输入永远无法落盘）。更严重的是 `\`、`/`、`..` 可造成越界写/建子目录（`data-root-layout/spec.md:17-20` 只覆盖「显式相对路径含 `..`」，不覆盖**由外部数据拼出的**一段）；`name` 未做 YAML 转义时含 `:`/换行会破坏 frontmatter 结构与后续解析。
**Suggestion**: 新增 Requirement「文件名与 frontmatter 值净化」：名称段替换 `[\\/:*?"<>|\x00-\x1f]`→`_`、去首尾点/空格、避开 Windows 保留名（CON/PRN/AUX/NUL/COM1…）、Unicode NFC、长度上限（如 ≤40 字符 / ≤120 字节，超限截断并记 `nameTruncated`）；越界或净化后为空则回落「名称段=代码」并明示；frontmatter 值统一双引号 + 转义；补单测（`*ST`、含 `/`、含 `:`、超长、保留名、北交所）。

#### Issue 4 (Critical): 并发写无锁、无重试参数 —— 与 change 5 的显式契约断裂
**Location**: `openspec/changes/review-page/design.md:51-56`（D-4）vs `openspec/changes/daily-summary/specs/daily-summary/spec.md:109`
change 5 要求「附注写入…SHALL 与页面写入**共享同一锁/重试纪律**，避免并发覆盖」，而本 change 只写「re-read + 原子写 + 失败重试（OneDrive/杀软占用瞬时失败）」，**无锁、无重试次数/退避/超时、无冲突检测**。两写者（页面 vs 附注 vs 人工 Obsidian 编辑）各自 re-read→rename 交错时，后写者覆盖先写者，spec:55-58「外部内容被保留」只在「无并发交错」时才成立，且该场景无并发断言。
**Suggestion**: 在 `review-card-store` 定义可导出契约：① 进程内 per-path 异步互斥（`Map<absPath, Promise>`），② 跨进程以「写前 stat(mtime,size) 校验 + 不等则重读重试」或独占锁文件，③ 重试 N=3、指数退避（如 50/200/800 ms）、超时上限，④ 冲突不可解时显式报错（不静默覆盖）。spec 增 Requirement/场景「页面写入与附注写入并发，两条内容均保留」，并补单测；tasks 明确该实现供 change 5 复用。

#### Issue 5 (High): 联动切换标的时保留未提交输入 → 卡片落错标的
**Location**: `specs/review-page/spec.md:7-10`、`design.md:16`
spec 要求 hash 变化时「不重载、切换上下文、输入框内容**原样保留**」。而现网基线就是 TDX 用 `#hash` 联动改标的（`spike-tdx-embed/design.md:6,57`）：用户为 600000 写到一半，通达信自动联动到 000001，此时提交 → 卡片写入 000001 的文档且归属日按新标的解析。该交互直接影响「事实源」的可信度，spec 却把它当成正面要求。
**Suggestion**: 输入绑定「来源标的」；hash 切换后若输入非空，B1/B3 显示「未提交内容属于 600000，将写入 000001」并需一次显式确认（或提交按钮显示目标标的名）；补场景「联动切标的有未提交输入 → 不静默换归属」+ 测试。

#### Issue 6 (High): spike 依赖未消解 —— 认证/资产部署/跨源三项都在「等结论」，但无 blocked_by、无回退分支需求
**Location**: `openspec/changes/review-page/tasks.md:13`、`design.md:100,110-111`、`specs/review-page/spec.md`（无跨源 Requirement）
`tasks 2.2` 写「按 change 1 结论实现」；Migration Plan 回退分支要求把资产改为 `D:/TDX_HOME/webs/company/` 静态页 + 「跨源请求本地 HTTP 接口需 CORS/Private Network Access 处理」——但 spec 无对应 Requirement，tasks 无 CORS/PNA、无部署资产的版本管理/同步项（design.md:111 又把该问题推回 change 1 报告）。同时仓内 `docs/**` 无 spike 报告（`docs/spikes/` 不存在），change 1 未实测 → 现状下 `tasks 2.2/2.3/4.1/6.x` 不可开工，但 tasks 无依赖标注。
**Suggestion**: 把 tasks 拆为「承载无关层（存储/解析/降级/名称链，可先行）」与「承载绑定层（路由/认证/资产形态）」并给后者显式 `blocked_by: spike-tdx-embed`；spec 增「回退分支：页面资产形态、跨源策略、写接口仍强制认证」Requirement；tasks 增部署资产版本管理条目。

#### Issue 7 (High): 路由/传参 spec 与 D-1 不一致，且市场前缀形态会永久空态
**Location**: `specs/review-page/spec.md:5`、`design.md:32-39`、`tasks.md:14`
spec 要求「兼容 path 段形态」，D-1 路由表只有 `/review` 与 `/api/*`（无 path 形态路由），spec 也无 path 场景；spike 已预见 TDX 可能传 `SH600000`/`600000.SH`（`spike-tdx-embed/design.md:57`），而本 spec 把「非 6 位数字」一律判非法并要求「MUST NOT 猜测、补全」，于是最可能的现网取值形态会导致**永久空态且无排障出口**（v1 还无点击联动，用户无从自救）。
**Suggestion**: 二者择一：删「兼容 path 段」或补 `GET /review/<code>` 路由 + 场景；并显式定义「市场前缀归一化」（去 `SH/SZ`、`.SH/.SZ`，记录原值）与空态文案（展示原始取值 + 期望格式 + TDX 侧配置指引），把「归一化 ≠ 猜测代码」写清（归一化只做去壳、不补全代码位）。

#### Issue 8 (High): D-8 有界回溯的成本/失败面未量化，且与 change 2 护栏的交互未裁决
**Location**: `design.md:70-72`、`tasks.md:37-39`、参照 `data-foundation/design.md:54`、`data-tool-contract/spec.md:95`
change 2 实测护栏为「每源并发 ≤2、最小间隔 1000 ms、单次批量 ≤20、每源每交易日预算 200」，且**盘中（工作日 09:15–11:30 / 13:00–15:00）拒绝全市场级调用**（未声明 `offSession` 时）。D-8 的「默认 10 个交易日回溯」在冷缓存下 = ≥10 次顺序请求、**≥9-10 s**（叠加单次延迟更久），页面恰在盘中现场使用，却未决定 T1 的日列表调用是否需要 `offSession`、是否会被判为全市场级而拒绝；「10 个交易日」无交易日历 → 只能按自然日探测（周末同样发请求）；D-8 称「结果由 change 2 按日缓存复用」，但 T1 对历史日的返回 `tradeDate` 可能与请求日**不一致**（`limit-reason-tool/spec.md:15`），缓存桶键不一致会造成重复请求、预算被吞。
**Suggestion**: 在 spec/design 给出量化策略：回溯上限（建议 ≤6 个业务日）、单次页面打开的最大出站请求数、请求超时与「导航离开即 abort」、是否 `offSession` 的裁决；以「源返回的 `tradeDate` 序列」推进回溯（而非自然日枚举）；明确预算耗尽/被拒时的降级文案（「近期涨停记录不可得 + 原因」）；tasks 5.3 补「预算耗尽 / 盘中拒绝 / tradeDate 不一致」三类桩测试。

#### Issue 9 (High): roadmap/AGENTS 未重排，触及「阶段防呆」与「vault 写入阶段」两条工程契约
**Location**: `AGENTS.md:45,51-52`、`docs/roadmap.md:22-27,52-65`、`docs/architecture.md:42`、`tasks.md:46`、`design.md:119`
AGENTS 规定「严格按阶段顺序推进」「vault 写入：阶段 4 起才触 vault」，architecture:42 把既定产物区固定为 `events/、知识卡片/、DB/opt/、DB/daily/`；而 review-page（spike design.md:21 记为 change 4）要写 `DB/review/`（未登记，design.md:119 自认「需回写时补登、不阻塞实现」），在阶段 3 之后、阶段 4 之前落地；同时 M2-Q2（取消阶段 2 桥，「页面即插件路由」）与 M2-Q3 裁决均未进 roadmap 拍板清单（roadmap:52-65），roadmap:23 仍写着阶段 2 桥、阶段 6 嵌入页。tasks 6.4 只更新 `docs/architecture.md`。
**Suggestion**: tasks 增三项文档任务并作为门禁一部分：① `docs/roadmap.md` 阶段重排 + 登记 M2-Q2 / M2-Q3（含日期与触发条件）；② `docs/architecture.md` 更新埋点（已有 6.4 但需含「阶段 2 桥取消」的结论）；③ `AGENTS.md` 的「vault 写入阶段」与「既定产物区」补 `DB/review/`，并落实 vault-integration 写分区补登（把 design.md:119 的「不阻塞」改为显式任务）；若不便改工程契约，则把实现排到阶段 4 之后。

#### Issue 10 (High): 新卡片与 `^ainote-` 分节的插入位置冲突（跨 change 语义未裁决）
**Location**: `specs/review-card-store/spec.md:48`（「只追加新分节到文档末尾」）vs `openspec/changes/daily-summary/specs/daily-summary/spec.md:76`（「附注 SHALL 追加为**文档末尾**的独立分节」）
文档已含 change 5 写入的附注后，用户再写卡片时：追加到**附注之后**即破坏 change 5「附注在文档末尾」的语义；追加到**附注之前**则需中间插入，与「只追加到末尾」的措辞和原子写/字节级断言口径冲突。本 change 只在 D-6 规定解析忽略 `^ainote-`，未规定写入位置。
**Suggestion**: 二选一并同步 change 5：① 定义「新卡片插入到首个 `^ainote-` 分节之前」，并把 spec 措辞从「追加到末尾」改为「在不改动既有任何字节的前提下插入卡片区尾部」；② 或把附注重定义为「卡片区之后的尾部可选区」，change 5 spec 同步改写。同时补一条单测：文档已含附注时写卡片，附注正文与锚点字节不变。

#### Issue 11 (Medium): 「字节级不变」的边界不完整（CRLF / BOM / 无尾换行 / frontmatter 重序列化）
**Location**: `specs/review-card-store/spec.md:48,51-53`、`proposal.md:11`、`design.md:54`
spec 只保证「既有**卡片分节与正文**字节级不变」，frontmatter 仅要求「保留既有键值」；而写入需要合并 frontmatter（至少补 `tradeDate`/`name`）。若按 utf8 读 + YAML 重序列化写回：BOM 丢失、CRLF 与 LF 混排、键序/缩进/引号被重排 → Obsidian/OneDrive 出现全文件 diff，同时「既有分节字节级不变」的断言口径（从哪一字节起算）不可判定；无尾换行文件的追加行为也未定义。
**Suggestion**: spec 明确断言口径 =「首个卡片 H2 起至文件末尾的既有字节不变 + 文件既有字节**前缀**不变」；新增 Requirement：探测并保持原 EOL 与 BOM、无尾换行时先补一个 `\n`（明确该分隔符不计入「既有内容」）、frontmatter 只做**值级最小文本修补**（禁止整体重序列化）；tasks 1.6 补 CRLF / BOM / 无尾换行三类 fixture。

#### Issue 12 (Medium): 「多命中取最近修改者」无 spec 支撑且不确定性高
**Location**: `design.md:53`、`tasks.md:6` vs `specs/review-card-store/spec.md:5`
「多命中（历史遗留）取最近修改者并在响应中提示异常」只出现在 design 与 tasks，`review-card-store` 无对应 Requirement/场景；OneDrive 同步下 mtime 不可靠（同一内容可能被同步器重写），「提示异常」的载体（页面？日志？响应字段？）与用户处置路径也未定义；且该分支直接决定「写哪一份、另一份是否成为孤儿」。
**Suggestion**: spec 增 Requirement：多名命中时以确定性规则取一（mtime 最新，平局按文件名字典序），并在 `/api/context` 返回 `storeWarnings[]` 由 B4 显式展示「发现 N 份同日文档，已写入 X，另存在 Y/Z（未改动）」；补场景 + 单测（构造两名命中）。

#### Issue 13 (Medium): frontmatter 键语义与来源不可核验
**Location**: `specs/review-card-store/spec.md:29`、`design.md:10,54`
`subjective: true`、预留键 `patterns` / `drafts`（「本迭代恒为空数组」）在本仓无任何来源定义（vault-integration 在仓外，本次未能核验）；`patterns` 与 roadmap F1/F2 的「模式级 id 词表（`超短`/`价投`/`期货` + 十余个 id）」的关系、`drafts` 的元素结构、类型校验一律未定义，但写入必须「保留既有值」。这会给 change 5 / F2 留下不可判定的契约。
**Suggestion**: 在本 change 内定义最小键 schema（类型、允许值、空值与未知键处理、`patterns` 元素为 id 字符串数组并与 F1 词表对齐、`drafts` 元素结构或显式「未定，保留原样」），或给 vault-integration 的可核验引用（章节号 + 摘录）；同时明确「未知键 MUST 原样保留」。

#### Issue 14 (Medium): 「正文原样写入」与文档结构完整性冲突（正文可注入 H2/伪锚点）
**Location**: `specs/review-card-store/spec.md:41-44` vs `:29-39`、`design.md:64`
正文明确「去首尾空白外不做加工」，则用户正文若含行首 `## 12:00 ^card-<同日同代码>-1200`，解析层按 D-6 的「行内锚点 + H2」规则会把它当成一张卡片（幽灵卡片），并可能与真实锚点冲突（违反 spec:39「MUST NOT 出现重复锚点」）；正文含普通 `## ` 也会被切成两段。spec 未定义该情形。
**Suggestion**: 明确解析规则并加测试：只把「H2 行 + 锚点的日期段与代码段等于本文件 frontmatter 的 `tradeDate`/`code`」视为卡片；同前缀重复锚点视为异常（渲染时去重 + 显式告警，不静默）；并记录一条显式取舍（正文含行首 `## ` 的结构后果），或在渲染/写入侧约定缩进，二者择一。

#### Issue 15 (Medium): 前端资产形态与构建管线未定义（D-2 无法落地）
**Location**: `design.md:43-45`、`tasks.md:12,15`、`package.json:16-21`
D-2 要求「单 HTML + 内联/同源 JS」且「资产由插件构建产物提供（`kind:'prefix'` 路由 + MIME 白名单 + 穿越防护）」，宿主侧无文件服务、插件自行输出字节（`spike-tdx-embed/design.md:5`）。但 tasks 没有：资产形态决策（模板字符串内联 vs `lib/assets/**` 复制）、`tsdown` 打包/拷贝配置、`package.json#files` 未含资产目录、MIME/缓存头/ETag/404 兜底；tasks 2.4 只列「穿越防护 + MIME 白名单」。这会导致 2.1/4.1 的产物路径无法确定，也无法断言「离线可用（无外链）」。
**Suggestion**: tasks 增「资产形态与打包」任务（建议：HTML/CSS/JS 以模板字符串内联进 `lib`，或 `copy` 到 `lib/assets` 并写入 `files`），并补 spec Requirement：静态资产响应 SHALL 带正确 `Content-Type`（白名单）、SHALL 拒绝 `..`/绝对路径/非常规文件名（404）、SHALL 无外链（离线可用场景有断言）；tasks 2.5 增 MIME/缓存头断言。

#### Issue 16 (Medium): spec ↔ tasks 覆盖对不齐，门禁/证据格式缺失
**Location**: `tasks.md:1-47`、`specs/review-page/spec.md`、`specs/review-card-store/spec.md`
缺项：spec 无「静态资产安全（MIME/穿越）」「写接口入参校验与幂等（`code`/`date`/`body` 上限）」「回退分支跨源」三个 Requirement，而 tasks 2.4 却实现其中之一；反向 tasks 1.4「多命中告警」无 spec 支撑（见 Issue 12）；spec 场景「页面资产离线可用（无外链）」「不执行 HTML/脚本」「产物仅 md 无伴生文件」无对应测试任务；tasks 6.1/6.2 仅写「手工验收」，无证据格式（命令/产物路径/日志/截图落点），6.5 只列三条命令。另 `specs/review-page/spec.md:121-124`「重复提交防护」只约束前端，慢网络重放/双击在同一「提交中」窗口外仍可产生两张卡片（服务端无幂等键）。
**Suggestion**: 补上述 3 个 Requirement；加一张「Requirement ↔ task ↔ 测试/证据」映射表；tasks 6.x 定义证据格式（命令 + 输出片段 + 产物文件路径）；`POST /api/card` 要求携带 `clientRequestId` 并在服务端按「文档 + 该 id」去重（重复请求返回既有锚点而非追加）。

#### Issue 17 (Medium): D-TQ 未进决策台账，seam 未按「可替换为 B」约束设计
**Location**: `design.md:84-96`、`tasks.md:20`、`docs/roadmap.md:52-65`
D-TQ 声明「按 A 实现并报 owner」，但 roadmap 拍板清单无该条，`design.md:96` 只说「注意回写需求文档 R2/R5」——没有台账条目、没有默认处置与复审触发条件，落地后极易变成「以 A 为既成事实」。seam 接口（`TradeDateResolver`/`NameResolver`）只被描述为「返回日期/名称」，未包含 B 选项所需的（沪 `.SH`/深 `.SZ` 后缀、`HqDate` 语义、来源与置信），替换 B 时会牵动调用方。此外 `design.md:9` 的宿主文件与行号引用（`packages/host/webserver/src/index.ts:160`、`packages/client/connection/src/browser-auth.ts:15,223-280`）**本次未能核验**：本仓无 `packages/` 目录，DSH 安装目录为 `app.asar` 归档（read 返回 not found），需求描述/模块文档（M1-Q4、M2-Q2、M2-Q3、§7/§9）在仓内亦检索不到。
**Suggestion**: roadmap 拍板清单增 D-TQ（默认处置=A、触发复审条件=owner 裁决 B 或 17709 边界放开）；seam 契约升级为 `{value, source: 'T1-tradeDate' | 'TQ-HqDate' | 'user-confirm', confidence, marketSuffix?}`；tasks 3.1 增「B 选项最小 stub + 契约测试」；把「不可复核引用」改为可核验形式（记录核验日期/命令输出摘录，或把需求文档纳入仓内 `docs/`）。

#### Issue 18 (Low): 交互态与输入法边界缺清单
**Location**: `specs/review-page/spec.md:60-72,112-129`、`tasks.md:27-33`
窄视口只有一条定性场景（无最小宽度/是否允许横向滚动的可断言值）；加载态、提交中态、B1 部分失败态的视觉区分无要求（B1 有「不可用 + 原因」，提交中只有「防重」）；`Ctrl+Enter` 未考虑中文输入法组合期（composition）误触发；B3「工具框预留按钮区」无可见性/禁用态口径。
**Suggestion**: 给窄视口一条可断言值（如 ≥320 px 无横向滚动、输入框与保存按钮可见可点）；补交互态清单（idle/loading/submitting/error/empty）与 `Ctrl+Enter` 在 `isComposing` 期间忽略；预留区明确「禁用态 + 不占焦点顺序」。

### Positive Aspects

- **跨 change 断言经核验成立**：`design.md:78`（D-9）声称的「该标的无涨停记录时 `tradeDate` 仍可得」确实已固化在 `data-foundation/specs/limit-reason-tool/spec.md:5` 与场景 `:17-20`，且该 spec 明确写「是 `review-page` 交易日归属（最近交易日）的派生来源」——**行号与语义都对得上**，是本仓少见的可核验跨 change 契约。
- **D-5 与 spec「名称三级降级」一致**：① T2 名称反查（`concepts-tool/spec.md:5,41-53` 定义 `name` best-effort、未命中 `null`、北交所后缀待验证）→ ② 历史卡 frontmatter → ③ 仅代码，链序与 spec:43 相同，且对「名称未获取」给出显式显示要求（`spec.md:25,55-58`）。
- **500 ms 口径与上游一致**：D-7「只约束本地部分」与 `data-foundation/design.md:85` 的结论一致，未把 T2 的 0.35 s/只 混入首屏预算（问题只在 D-1 的接口切分，见 Issue 2）。
- **复用而非自建**：频控/缓存/降级/单位与来源标注全部复用 change 2（`data-tool-contract/spec.md:1-15,55-92`），本 change 明确「页面不直接调用 T1/T2 第三方端点」，并有 tasks 6.3 的源码断言。
- **安全红线条目可测**：tasks 6.3「页面层不含第三方 URL 与取数实现 + 全链路无交易接口调用」把只读边界变成门禁项，与 AGENTS.md:40-42 对齐。
- **append-only 与 M2-Q3 的推导自洽**：D-10 由「既有分节字节级不变」推出「`sourceContext` 仅对新卡生效、不回填」，是设计纪律的正确应用；`^ainote-` 排除与 change 5 的锚点前缀设计互相吻合（`daily-summary/spec.md:76,86`）。
- **Non-Goals 明确**：B1 只做两项、无完整日历、无框架/无私有格式、无 AI 附注写入，有效防范围膨胀。

### Summary

Top 3：
1. **(Critical) 交易日归属语义自相矛盾**：D-9 的 T1 `tradeDate` seam 使「非交易日确认」不可达、长假/盘前静默错归属，且全案无交易日历来源（Issue 1）。
2. **(Critical) 首屏性能与接口切分冲突**：D-1 单接口聚合 vs D-7/ spec「本地 500 ms + 网络异步补位」，配合 10 日回溯 ≥9-10 s 的网络段（Issue 2、Issue 8）。
3. **(Critical) 存储契约缺三块硬边界**：写路径输入净化（`*ST` 直接非法文件名）、并发锁/重试参数（change 5 已显式依赖）、以及字节级不变的精确口径（Issue 3、Issue 4、Issue 11）。

其余必修项按优先级：Issue 5（联动换标落错卡）、Issue 9（roadmap/AGENTS 重排与 `DB/review` 登记）、Issue 10（附注插入位置）、Issue 6/7（spike 门禁与路由一致性）。

**未能核验项**（不在本次结论内，需 owner/实现者补证）：① `design.md:9` 与 `spike design.md:5-6` 的宿主事实（`ctx.webServer.register`、`browser-auth.ts:15,223-280`）——DSH 安装目录为 `app.asar`，read 返回 not found，本仓无 `packages/`；② `需求描述-复盘卡片MVP` / `需求描述-盘面数据组件` / 模块文档 §7/§9 / M1-Q4 / M2-Q2 / M2-Q3——仓内 grep 无此文件；③ vault 侧事实（`DB/review` 不存在、`DB/stock` 无索引、vault-integration 未登记 `DB/review`）——仓外路径不可读；④ change 1 spike 是否已实测——仓内 `docs/**` 无 `docs/spikes/tdx-embed.md`。

**Consensus Status**: NEEDS_REVISION

---

## Round 2 — 2026-09-27

### Overall Assessment

第二轮修订把 Round 1 的 3 条 Critical 与多数 High 实质闭合：`/api/context` 单接口聚合已废止并拆为 `/api/local` + `/api/enrich`（spec 与 design 双向一致、性能场景可满足）；`TradeDateResolver` 结构化后「无交易日历 → 归属待确认」成为可达的正式语义（周末/长假第 N 天/盘前/隔日补写四场景均可由 change 2 的 `isTradingDay: true|null` 取值域推出）；`review-card-store` 补入的「可复用写入接口契约」与 `iteration-1-contracts §3` **逐字一致**，卡片插入位置（首个 `^ainote-` 之前）与 change 5「附注在文档末尾」一致；并发四参数、字节级口径（前缀/CRLF/BOM/无尾换行/值级最小修补）、文件名净化与 `storeWarnings` 均已进 spec + tasks。剩余问题集中在**跨 change 口径未同步**（认证 B 层语义、`src/review/format.ts`）、**D-8 自身两条 MUST 边界互斥**、**名称层①无接口归属**与 **`sanitizeNameSegment` 双实现**，属窄面返工，无 Round 1 级结构性缺陷。
**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | 非交易日归属确认不可达、无日历来源 | 已解决 | D-9 改结构化 `{value, source, isTradingDay: true\|null, confidence, marketSuffix?}` 并 MUST 委托 `traderKit.data.resolveTradeDate`；`businessDate !== rateLimitDate → null`，周末/长假/盘前/隔日补写确可达并走确认；日历来源列为显式依赖 + tasks 3.2b `blocked`（spec store:264-298 覆盖六场景） |
| 2 | 单接口聚合 vs 本地 500 ms 冲突 | 已解决 | D-1 表删 `/api/context`，拆 `/api/local`（纯本地、≤500 ms）+ `/api/enrich`（网络、可 abort）；spec:37-54 独立请求 Requirement + 3 场景；tasks 2.1 验收显式「不含 `/api/context`」、2.6/4.6 |
| 3 | 文件名/frontmatter 无净化（`*ST`） | 已解决 | spec store:27-59（NFC / `[\\/:*?"<>\|\x00-\x1f]→_` / 首尾点空格 / 保留名 / 40 字符 / 空则回落代码段）+ tasks 1.6/1.7 + D-12 + 契约 §6，且与 change 2 `data-root-layout` 净化规则逐条同文（实现归属重叠见 Issue 23） |
| 4 | 并发写无锁/无重试参数 | 已解决 | spec store:226-243 并发写纪律 Requirement（per-absPath 互斥 / 写前 stat / 重试 3 次 50·200·800 ms / 5 s / `CONCURRENT_WRITE`）+「页面与附注并发两条均保留」场景 + tasks 1.8；change 5 spec:394、418 引用同一纪律 |
| 5 | 联动换标丢归属 | 已解决 | D-11（`draftOwnerCode` + 一次显式确认）+ spec:232-249 Requirement 与 3 场景 + tasks 4.7（含前端状态机单测） |
| 6 | spike 依赖未消解、无 blocked_by/回退需求 | 已解决 | tasks §0 拆承载无关层/承载绑定层，§2/§4/§7 逐条 `blocked_by: change 1`；spec:313-330 回退分支 Requirement（CORS/PNA、写认证、部署资产版本）+ Migration Plan + tasks 7.2；`docs/spikes/` 仍不存在，故绑定层依约不可开工（预期内） |
| 7 | 路由/传参与市场前缀永久空态 | 已解决 | D-1 增 `GET /review/<code>`，spec:17-20 path 场景（含 `/review/api/*` 优先）；D-15 `normalizeCode` 去壳不补全 + 空态文案（原文 + 期望格式 + TDX 指引）+ tasks 2.3 |
| 8 | 回溯成本/失败面未量化 | 部分解决 | 量化表与 spec:165-192 三类降级、abort、不用 `offSession`、按源 `businessDate` 归属均已落；但「≤6 业务日」+「≤7 出站请求」+「禁自然日枚举」三 MUST 在无日历下互斥，且「下一业务日」无推导算法（Issue 21） |
| 9 | roadmap/AGENTS 未重排、`DB/review` 未登记 | 已解决 | `docs/roadmap.md §5` 已含 M2-Q2/M2-Q3/数据面分工/写分区例外/D-TQ/E4 六行；tasks 6.4 覆盖 roadmap（仅引用）/architecture（含阶段 2 桥取消）/AGENTS（两条白名单例外）/vault-integration 补登，并纳入 6.5 门禁（AGENTS 与 vault 侧尚未执行，但已是门禁内任务） |
| 10 | 卡片与 `^ainote-` 插入位置冲突 | 已解决 | 契约 §3 + D-4 步 4 + spec store:140-167（插入首个 `^ainote-` 之前、附注恒在末尾 + 「文档已含附注时插入卡片」场景）；change 5 spec:285 末尾语义未改，二者相容 |
| 11 | 字节级不变边界不完整 | 部分解决 | spec store:169-196 五场景（CRLF/BOM/无尾换行/最小修补/前缀口径）与 tasks 1.9 齐备；但同 Requirement 内「frontmatter 原始文本不变」与「补键」互斥（Issue 25） |
| 12 | 多命中取最近修改者无 spec 支撑 | 已解决 | D-14（mtime 最新、平局文件名字典序）+ spec store:245-262 + spec page:223-230 显式告警 + tasks 1.10/4.5（warnings 元素形态见 Issue 27） |
| 13 | frontmatter 键语义不可核验 | 已解决 | spec store:87-114 最小键 schema 表（类型/允许值/缺省/未知键原样保留 + `patterns` 对齐 F1 词表 + `drafts` 显式「未定，保留原样」）+ tasks 1.1/1.11 |
| 14 | 正文可注入 H2/伪锚点 | 已解决 | D-6/D-15 + 契约 §2：只认 H2、跳 fenced code block、归属校验、幽灵/重复锚点告警、非锚点 H2 归入正文的显式取舍；spec store:116-138 四场景 + tasks 1.2/1.6 |
| 15 | 前端资产形态与打包未定义 | 已解决 | D-2「资产形态与打包」二选一 + D-13 + spec page:289-311（MIME 白名单/404 非 403/URL 编码穿越/无外链/静默发布）+ tasks 2.4/2.5/7.1；实测 `package.json#files` 已含 `lib`，方案①成立 |
| 16 | spec↔tasks 覆盖不齐、证据格式、幂等 | 部分解决 | 3 个缺失 Requirement（静态资产安全/写入入参校验/回退分支）已补，tasks §8 映射表 + 证据格式（命令+输出片段+产物路径）+ `clientRequestId` 服务端去重与 4 场景齐备；残留：`body ≤10000` 等入参上限无专项断言任务，`Card`/`AInote` 形状未定义（Issue 27） |
| 17 | D-TQ 未台账化、seam 未按 B 约束设计 | 已解决 | roadmap §5 D-TQ 行（默认处置 A + 复审触发条件）与 design D-TQ 节互指；seam 含 `source`/`confidence`/`marketSuffix?`，`NameResult` 含 `TQ-match-stkinfo`；tasks 3.1b 增 B 选项 stub + 契约测试；宿主事实改符号名并标「未实测」 |
| 18 | 交互态与输入法边界缺清单 | 已解决 | D-18 + spec page:122-144（五态、`isComposing` 忽略、预留区 `disabled` + `tabindex="-1"`、焦点顺序、320 px 无横向滚动可断言值）+ tasks 4.1/4.4/4.8 |

### Issues

#### Issue 19 (High): 认证回退语义未按 change 1 定案同步 → 回退分支的「写接口强制认证」无可用机制
**Location**: `openspec/changes/review-page/design.md:62`（D-3「每请求带 token（B 层）」）、`tasks.md:74`（2.2「tokenized URL / 每请求 token」）、`specs/review-page/spec.md:313-321`（回退分支 Requirement ②）vs `openspec/changes/spike-tdx-embed/design.md:95-99`、`specs/tdx-embed-probe/spec.md:37`、`tasks.md:39,130-132`
change 1 已把 B 层重定义为**插件自有诊断 token**，并三处写明「**业务写入 MUST NOT 依赖 B 层**」，且在 `spike tasks 4.7` 把「`review-page/design.md`/`tasks.md` 的『每请求带 token（B 层）』需同步」列为**显式移交项**——本 change 正文完全未同步。后果有二：① 回退分支（`file://` 就地）下宿主 cookie 为 `SameSite=Strict` 且为跨源不透明来源（change 1 D-3 已实测归因），A 层不可用、B 层被禁用、C 层只读且须 owner 签字 ⇒ spec「写接口仍强制认证（token 校验）」与 `tasks 7.2` 验收**无实现路径**，属不可验收项；② 若按本 change 字面实现，等于把诊断 token 用于业务写入，直接违反 change 1 的安全边界。
**Suggestion**: D-3 删除「B 层救业务写入」，明确「写接口只走宿主 cookie（A 层）；回退分支的写认证须先由 owner 在 C 层签字 / 签名 URL / 跳板代理中裁决；未裁决时回退分支仅保留只读页面、写接口显式不可用（不落盘）」；同步改写 spec 回退分支 ② 与 tasks 2.2/7.2，并把该裁决登记 roadmap §5。

#### Issue 20 (Medium): change 5 依赖的 `src/review/format.ts` 在 change 4 侧无任何落点
**Location**: change 5 `specs/daily-summary/spec.md:133,328,343`、`design.md:84,142`、`proposal.md:33` vs 本 change `specs/review-card-store/spec.md`（无 `format`）、`tasks.md:19-66`（无对应任务）、`proposal.md:39`（新增代码清单）、`iteration-1-contracts §3`
change 5 以 MUST + 结构断言要求「`generatedAt` 与卡片 `writtenAt` 共用 change 4 `src/review/format.ts` 的 `formatZonedIso`，二者无第二份 ISO 格式化实现」。但本 change 的 spec/design/tasks/proposal 与契约 §3 均未定义该模块与导出（tasks 1.12 的「可复用写入接口契约」只含 5 个 store 导出）。⇒ change 5 的「同一导出」断言在原始契约下不可满足，「复用」落到无具名接口，违反契约 §0。
**Suggestion**: 在 `review-card-store` 增最小 Requirement（或纳入 §3/1.12 导出面）：`src/review/format.ts` 导出 `formatZonedIso(date: Date): string`（`+08:00`，`writtenAt`/`generatedAt` 同源）；tasks 增 1.13 与断言；proposal Impact 清单同步。

#### Issue 21 (Medium，承接 Issue 8 未闭合部分): D-8 两条数值边界互斥，且「下一业务日」无推导路径
**Location**: `specs/review-page/spec.md:167`、`design.md:107-118`、`tasks.md:163,177`
三条同时为 MUST：①回溯上限 ≤6 个**业务日**；②单次页面打开出站请求 ≤7（1×T2 + ≤6×T1）；③MUST NOT 按自然日枚举、以「源返回的 `businessDate` 序列」推进。无交易日历时「下一个业务日」只能通过发请求观察 `businessDate` 回退获得：含周末的 6 业务日窗口日历跨度 ≥8 天，逐日探测即 ≥8 次请求 > 7；反之严格 ≤6 次请求则无法保证覆盖 6 个业务日。spec 未给出「从一次响应推出下一请求日期」的算法，故第 ③ 条不可实现，`tasks 5.1/5.4` 的「请求数 ≤7」与「命中即停/超限」断言互相打架。
**Suggestion**: 二选一定值：把上限改为「窗口 ≤7 个自然日 / ≤6 次请求」并去掉「业务日」措辞，或把请求上限放宽为 ≤8 并写明推进伪码（`request = prevBusinessDate - 1`，命中即回退到响应 `businessDate`）；同时补「下一请求日推导」算法断言。

#### Issue 22 (Medium): 名称三级降级层①（T2 网络反查）无接口归属
**Location**: `specs/review-page/spec.md:39`（`/api/local` 返回「名称（含来源层）」）、`:41`（`/api/enrich` 仅列标签 T2 + 涨停原因 T1）、`:89-91`（名称三级降级）、`design.md:99,101`
D-7 要求 `/api/local` **纯本地、零出站网络**，而其返回契约含「名称（含来源层）」；名称层①是 T2 网络反查。`/api/enrich` 未列 `name`。⇒ 层①在网络段无归属：在 `/api/local` 内取数即违反 tasks 2.6 的纯本地结构断言；不取则 spec:93-96「第一层命中」场景在页面路径上不可达，实际只剩层②/③。
**Suggestion**: 把层①划给 `/api/enrich`（响应增 `name` + `nameSource`，页面在 enrich 返回后替换 B1 名称），`/api/local` 只返回层②/③并标注 `nameSource: 'frontmatter-history' | 'code-only'`；同步 D-5/D-7、spec:39/41/89-91、tasks 4.2。

#### Issue 23 (Medium): `sanitizeNameSegment` 双实现归属未定（change 2 与 change 4 各一份）
**Location**: change 2 `tasks.md:30`（`src/paths/sanitize.ts`）、`specs/data-root-layout/spec.md:64-77`（`resolveArea` 对 `name` 净化并自测）vs 本 change `tasks.md:43`（`src/review/sanitize.ts`）、`specs/review-card-store/spec.md:29`、`iteration-1-contracts §6`
§6 只描述净化规则与「`resolveArea` 对模板参数做白名单校验」，未指定实现模块；change 2 按其 spec 必须在 `resolveArea` 内实现/调用净化，change 4 又新建独立 `sanitize.ts` 作为落盘前必经过滤。两处同规则实现存在漂移风险（截断/回落时机、`nameTruncated` 记录方、幂等性），并使「全仓仅一处」类结构断言无法覆盖。
**Suggestion**: 指定唯一实现（建议 change 2 `src/paths/sanitize.ts` 单点，change 4 只经 `resolveArea(key, params)`，删除 tasks 1.7 的独立实现改为「经映射表净化 + 覆盖 spec 净化场景的单测」）；在契约 §6 补模块路径与导出名。

#### Issue 24 (Low/Medium): 「盘中被护栏拒绝」降级路径在 change 2 判据下不可达
**Location**: `specs/review-page/spec.md:179-182`、`design.md:116,118`、`tasks.md:171`（5.3②）vs `openspec/changes/data-foundation/specs/data-tool-contract/spec.md:179`
change 2 的「全市场级」判据唯一版本 =「批量标的数 > 硬上限（≤20）**或**调用方显式标记 `fullMarket`」。`/api/enrich` 的 T1 调用是单标的（批量=1），既不命中也不声明 `fullMarket`，故缺 `offSession` 时盘中**不会被拒**；spec 场景与 tasks 5.3② 桩断言的分支真实护栏不会产生（除非 change 2 裁决「T1 列表级整份列表请求内部即标 `fullMarket`」）。
**Suggestion**: 由 change 2 在 `data-tool-contract` 明示 T1 列表级请求是否自动计为 `fullMarket`；若否，删去该场景与 5.3② 或改述为「数据模块返回 `sessionRejected` 时的文案」。

#### Issue 25 (Low，承接 Issue 11): 「frontmatter 原始文本不变」与「值级最小修补（补键）」互相矛盾
**Location**: `specs/review-card-store/spec.md:174` vs `:176`；`iteration-1-contracts §4:94`；scenario `:193-196`
精确口径先写「插到附注之前（卡片）：`frontmatter` **原始文本不变**」，随后又写「只做**值级最小文本修补**（改值、**补键**）」——补键必然改变 frontmatter 文本。scenario「写入只需补 `tradeDate`」与「`tradeDate` 首次创建时必填」亦自相矛盾，无法据以写出可判定断言。
**Suggestion**: 改为「frontmatter 既有行文本不变；仅允许对既有键改值、以及按固定格式追加缺失键，MUST NOT 重排既有行」；scenario 改为「既有键文本不变 + 新增键按固定格式追加」。

#### Issue 26 (Low): `value === null` 时的「默认最近已知交易日」无来源
**Location**: `specs/review-card-store/spec.md:273,283`、`design.md:140`
要求「`value === null` 或 `isTradingDay === null` → 提交前归属确认（默认最近已知交易日）」；但 `value === null` 的定义即 seam 拿不到任何业务日（change 2 `trade-date-tool` 的 `businessDate=null`），此时「最近已知交易日」无来源，默认值不可判定。
**Suggestion**: 分路径：`isTradingDay === null`（有 `value`）→ 默认 = `value`；`value === null` → 默认留空并 MUST 要求用户显式填入（可预填 `requestedDate` 但标注「待确认」，不得当归属）。

#### Issue 27 (Low): `Card`/`AInote` 类型与 `warnings` 元素形态未定义、`nameTruncated` 产生/呈现通道不接
**Location**: `iteration-1-contracts §3:71-72`、`specs/review-card-store/spec.md:205,355`、`design.md:68`、`specs/daily-summary/spec.md:134`
① §3 与 spec 均直接引用 `Card[]` / `AInote[]`，两处都未定义字段形状；change 5 反向定义 `cards` 元素 = `{anchor, writtenAt, body}`，一旦两边理解不同，`parseDoc` 复用契约即失配。② `warnings: string[]` 与「告警元素 SHALL 含路径 + 类型 + 原因」「含被选路径与其它候选路径」不一致，字符串编码格式未定，页面展示与断言不可判定。③ `nameTruncated` 在**写时**（首次创建文件名）产生，却被要求经 `/api/local`（读时）上抛，读路径无法复现该事实。
**Suggestion**: 落 `Card`、`AInote`、`StoreWarning` 三个最小类型（如 `StoreWarning = { path: string; kind: 'multiHit'|'ghostAnchor'|'duplicateAnchor'|'nameTruncated'; detail: string; candidates?: string[] }`，`locateDoc/appendCard` 返回该结构）；`nameTruncated` 明确以写入响应字段（或分节元信息）为载体，不要求读时重算。

#### Issue 28 (Low): proposal Impact 清单与 tasks 不一致；探针路由共存未登记；Requirement 名错字
**Location**: `proposal.md:39` vs `tasks.md:19,23,164`；`design.md:34` vs change 1 `design.md:59`；`specs/review-page/spec.md:3`
① Impact 只列 `routes/review.ts`、`client/review/**`、`store.ts`、`anchor.ts`、`sanitize.ts`、`context.ts`，缺 `md/frontmatter.ts`、`md/parse.ts`、`enrich.ts`（tasks 实体产物），削弱「新增代码」评审面。② `basePath` 与 change 1 的 `<basePath>/probe`（`exact`）同命名空间，change 1 已登记「`register` 对重复 `(kind,path)` 抛错、change 4 注册 `<basePath>` 前缀前须先处置探针」；本 change 未登记该共存检查（`/review/<code>` 与 `/review/api/*` 的宿主匹配优先级亦无结构断言）。③ Requirement 名「页面路由与**标的**上文」（spec:3、tasks 映射表）疑为「标的上下文」截断，将随归档传播。
**Suggestion**: Impact 对齐 tasks 产物；tasks 2.1 增「与 change 1 探针路由共存/重复注册抛错」断言；修正 Requirement 名。

### Positive Aspects

- **跨 change 一致性已按「具名接口」纪律执行**：`locateDoc`/`parseDoc`/`appendCard`/`appendAinote`/`scanDailyCardTargets` 与 `traderKit.review.*`、`normalizeCode`（`src/review/anchor.ts`）、`resolveTradeDate`（change 2）在 change 4、change 5、契约 §2/§3 三处名称与签名一致；我逐字比对 spec store:200-214 与 §3:67-79，**完全一致**（含 `Card`/`AInote` 未定义这一共同瑕疵，见 Issue 27）。
- **「非交易日确认」从死分支变成正式语义**：`isTradingDay` 的 `true | null` 取值域（change 2 spec:50-55）使「null = 归属待确认」在周末/长假/盘前/隔日补写四种情形**必然可达**，且本 change 明确禁止用系统日期推断「非交易日」；`tasks 3.2b` 把「日历来源未定」标 `blocked` 而非假装已解决，处置正确。
- **写路径的两个硬边界已可断言**：并发四参数（互斥/stat/3 次退避/`CONCURRENT_WRITE`）与「既有内容不变」的精确口径（前缀 + 分节字节序列 + EOL/BOM + 值级最小修补）都写成带场景的 Requirement，并与 change 5 的同一 Requirement 互指，具备「change 5 复用同一实现」的结构断言基础。
- **插入位置跨 change 收口干净**：卡片插入首个 `^ainote-` 之前 + 附注恒在末尾 + 「文档已含附注时插入卡片」场景，既满足 append-only 又不改变 change 5 的「附注 = 文档末尾」语义，是 Round 1 中最难的一处，收得干净。
- **门禁与证据从「手工验收」升级为可检查项**：tasks §8 的 Requirement↔task↔测试/证据映射表覆盖全部 31 条 Requirement；6.4 文档任务与 6.3 结构断言并入 6.5 门禁；扫描型用例统一要求先断言 `targets.length > 0`。
- **安全与发布纪律可测**：MIME 白名单/穿越 404（非 403）/无外链/`npm pack` 产物断言，以及契约 §10 的 `cordis.patch.yml` 纪律，把「离线自包含」与「不写个人路径」变成断言而非声明。

### Summary

Top 3：
1. **(High) 认证回退语义未随 change 1 定案同步**：B 层已被 change 1 限定为「诊断 token、业务写入不得依赖」，本 change D-3/tasks 2.2 仍写旧语义，导致回退分支「写接口强制认证」无实现路径、tasks 7.2 不可验收（Issue 19）。
2. **(Medium) 跨 change 具名接口出现两处断点**：change 5 依赖的 `src/review/format.ts` (`formatZonedIso`) 在 change 4 侧完全未定义（Issue 20）；名称层①（T2 网络反查）在 `/api/local`（纯本地）与 `/api/enrich`（未含 name）之间无归属（Issue 22）。
3. **(Medium) 两处口径自相矛盾削弱可验收性**：D-8 的「≤6 业务日」+「≤7 请求」+「禁自然日枚举」三 MUST 互斥且缺推进算法（Issue 21）；`sanitizeNameSegment` 在 change 2/change 4 各实现一份（Issue 23）。

修复面窄且明确：Issue 19/20 各需 1–2 处 spec/tasks 措辞与导出面补齐；Issue 21/23/22 需 1 处定值/归属裁决。**未核验项**（沿 Round 1，不影响本次结论）：`docs/spikes/` 仍不存在（承载绑定层依约 blocked）；仓外需求文档/模块文档（M1-Q4、M2-Q2/Q3、R2/R5）与 vault 侧（`vault-integration` 写分区）不可读；宿主符号行为以 change 1 探针为准。

**Consensus Status**: NEEDS_REVISION

---

## Round 3 — 2026-09-27

### Overall Assessment

第三轮按「看正文、不信处置表自述」逐条核验：Round 2 的 10 条 issue 中 **9 条实质闭合**，3 条「部分解决」中 `#8`/`#11`/`#16` 在 change 4 正文内已可判定；Lead 本轮在 `iteration-1-contracts` 的裁定（§3 五导出**一律** `warnings: string[]` + 写前 `DOC_MISMATCH`、`src/review/format.ts` 的 `formatZonedIso`/`formatAnchorTime`、`src/data/date.ts` 单点换算、§6 净化唯一实现 `src/paths/sanitize.ts`、§10 写分区、§11 所有权、§12.1/12.4/12.5/12.7）已逐条落到 spec/tasks，且与 change 5 的引用**逐字对得上**（`daily-summary` 的 `warnings[]`/`formatZonedIso`/`DOC_MISMATCH`/§12.8 四处可对上）。仍未闭合的是三处**窄面但实义**的返工：① `§12.8` 的 `dateUnavailable` 与「无记录」区分**未同步进本 change**，而 D-8 的推进步必然发出非交易自然日请求（起点的前一自然日），该分支的推进、命中判定与收尾文案全部无定义，并存在漏检最近交易日的路径（Issue 29）；② Round 2 `#24` 的「改述为 `sessionRejected`」引用了一个 change 2 既未命名、也无生产者、零 mock 下不可构造的状态（Issue 30）；③ 回退分支「只读页面」的**读**通道认证姿态与 spec「全部接口走 A 层」互斥（Issue 31）。无 Round 1/2 级结构缺陷，无数据损坏路径，但 Issue 29/30 落在 spec MUST 的语义与可验收性上，须修订后再进实现。

**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes（本轮核验证据） |
|---|-------|--------|-------|
| 19 | 认证 B 层语义未随 change 1 同步 | **已解决** | D-3 整节重写为 A/B/C 三层（`design.md:60-75`）：A 层两步（`GET <base>/?token=` 铸 cookie + 303 → 再导航）、B 层 = 插件自持诊断 token 仅诊断/只读、**写接口只接受 A 层**且「A 层不可用即写入不可用 + 页面只读降级」；spec 重写为「认证分层与写入通道的 A 层依赖」含 5 场景（未认证拒绝 `:66-69`、仅带 `?token=` → 401 `:71-74`、B 层不得放行写入 `:76-79`、**A 层不可用即写接口显式不可用** `:81-84`、写入经插件 `:86-89`）；tasks 2.2/2.5/7.2 均含「A 层不可用时写接口拒绝 + 零落盘 + 只读降级标记」。与 change 1 D-3「业务写入 MUST NOT 依赖 B/C 层」（`spike-tdx-embed/design.md:95,100`）及 §12.1 一致 |
| 20 | `src/review/format.ts` 在被复用侧不存在 | **已解决** | 新增 D-19（`design.md:240-251`）；spec `review-card-store` 新增 Requirement「时间格式化单点」`:255-276`（含 `formatZonedIso`/`formatAnchorTime` 签名、`+08:00` 正则场景、`YYYY-MM-DD⇄YYYYMMDD` 归 `src/data/date.ts`）；tasks 1.13 产物/验收 + 6.3⑧「全仓仅一处 `+08:00` 偏移拼装」+ §8 映射行 `:258`；change 5 三处引用同一导出（`daily-summary/spec.md:147,380,395`），断点消解 |
| 21 | D-8 三条 MUST 互斥、无推进算法 | **已解决** | D-8 整表重写（`design.md:128-145`），明写「原『≤6 业务日 + ≤7 请求 + 禁自然日枚举』已废止」；spec「B1 有界回溯的量化边界」`:200-210` 单一口径：起点 = `resolveTradeDate` 最近业务日、推进 = **源 `businessDate` 的前一自然日**、上限 = **≤6 次列表级请求** + 总出站 ≤7、达上限文案「近 6 次查询内未找到涨停记录」；tasks 5.1/5.5 补推进算法断言（含跨周末 `2026-09-28 → 2026-09-27`）。**残留同 Requirement 的相邻缺口见 Issue 29** |
| 22 | 名称层①（T2 网络反查）无接口归属 | **已解决** | D-5 重写为分层表（`design.md:88-100`）：① frontmatter-history 与 ③ code-only 归 `/api/local`（带 `nameSource`、零网络）、② T2/S8 归 `/api/enrich`（入参含 `code`，返回 `name` + `nameSource:'T2-S8'`）；spec `:115-141` 四场景含「本地段不承担网络反查」结构断言；tasks 1.5/4.2、§8 映射行 `:238`；与 §12.4 一致 |
| 23 | `sanitizeNameSegment` 双实现 | **已解决** | 全文已无 `src/review/sanitize.ts` 作为产物（仅在负向断言中出现）：tasks 1.7 改为「接入 change 2 `resolveArea`/`sanitizeNameSegment`（唯一实现 `src/paths/sanitize.ts`）、**无本 change 自有净化模块**」；spec `:27-31,58-61` 含「不另建净化实现」场景；6.3⑦ 结构断言；proposal Impact `:41` 明写「文件名净化不新增模块」；与 §6/§11 一致 |
| 24 | 「盘中被护栏拒绝」不可达 | **部分解决** | 已按 Round 2 建议改述为「数据模块返回时段拒绝态（`sessionRejected`）」状态驱动（spec `:208,227-230`；tasks 5.3② `:183`；design `:140,335`），但该状态名在 change 2 侧**无定义、无生产者**，零 mock 下不可构造 → 见 Issue 30 |
| 25 | 「frontmatter 原始文本不变」与「补键」互斥 | **已解决（change 内）** | spec「既有内容不变的精确口径」`:176-203` 改为「**既有各行文本不变**；仅允许 ① 对既有键改值、② 按固定格式**追加**缺失键；MUST NOT 重排既有行/整体重序列化」，矛盾场景改写为「既有三行文本不变 + `tradeDate` 固定格式追加」`并断言 `:200-203`，口径可判定；**残留：契约 §4:110 仍留旧措辞 → 见 Issue 32** |
| 26 | `value === null` 的默认值无来源 | **已解决** | 分路径落地：D-9 `:163-165`、store spec `:325` + 场景「来源不可得（`value===null`）」`:332-335`、「有业务日但非交易日」`:337-340`；page spec B2 `:244`；tasks 3.2/3.3 `:117,125`；`isTradingDay===null` 且有 `value` → 默认 = `value`、`value===null` → 默认留空 + 显式填入，前后可断言 |
| 27 | `Card`/`AInote`/`StoreWarning` 与 `nameTruncated` 通道未定义 | **已解决** | 新增 D-20（`design.md:253-272`）定义 `StoreWarningKind`/`StoreWarning` 与**唯一编码** `` `[<kind>] <path> — <detail>` ``、`Card`/`AInote` 最小类型；store spec「可复用写入接口契约」按 §3 逐字重写 `:205-253`（五导出**一律**含 `warnings`）+ 「storeWarnings 的呈现契约」`:410-438`；`nameTruncated` 明确以**写入响应** `warnings` 为载体、读路径不重算；tasks 1.12/1.14。**残留：`docMismatch` 类型不可达 + `nameTruncated` 信号形状待 change 2 暴露 → 见 Issue 34** |
| 28 | proposal Impact / 探针共存 / Requirement 名 | **已解决** | proposal Impact `:41` 与 tasks 产物对齐（补 `md/frontmatter.ts`、`md/parse.ts`、`format.ts`、`enrich.ts`，删 `sanitize.ts`）；tasks 2.1 `:80` 含「与 change 1 `<basePath>/probe`(`exact`) 不重叠 / 重复 `(kind,path)` 注册抛错不被触发 / `/review/api/*` 优先级」断言，2.5 `:94` 同步，Open Questions 10 `:338` 登记；Requirement 名已修正为「页面路由与标的上下文」（spec:3 + tasks §8:234） |
| R1-8 | 回溯成本/失败面未量化（Round 2 标部分解决） | **已解决** | 经 Issue 21 收敛为单一可判定口径 + 5.5 推进断言 + 5.3 三类可达桩；量化表（≤6 请求/≤7 出站/5 s 超时/abort/不用 `offSession`/按源业务日标注）齐备。**邻近新缺口（§12.8）单列为 Issue 29** |
| R1-11 | 字节级不变边界不完整（Round 2 标部分解决） | **已解决（change 内）** | 五场景齐备（CRLF `:185-188`、BOM `:190-193`、无尾换行 `:195-198`、既有行不变 + 新增键 `:200-203`）+ tasks 1.9；口径可判定。契约 §4 措辞未同步 → Issue 32 |
| R1-16 | spec↔tasks 覆盖不齐、证据格式、幂等（Round 2 标部分解决） | **已解决** | 新增 tasks 2.7 `:102-105`「写入接口入参校验专项断言（`code`/`body ≤10000`/`tradeDate` 形态/`name ≤200`/缺 `clientRequestId` → 4xx + 零写入）」+ spec「入参上限」场景 `:110-113`；§8 映射表 `:237` 指 2.7；`Card`/`AInote` 形状由 D-20 补齐 |

### Issues

#### Issue 29 (High): `§12.8` 未同步 → D-8 回溯在非交易自然日/`dateUnavailable` 路径上不可判定，且可能漏检最近交易日

**Location**: `specs/review-page/spec.md:204-206,212-230`、`design.md:128-145`、`tasks.md:175,177,191-194` vs change 2 `specs/limit-reason-tool/spec.md:42,59,64`、`design.md:37`、`docs/design/iteration-1-contracts.md:216-217`（§12.8）、change 5 已同步处 `daily-summary/specs/daily-summary/spec.md:97`。

D-8 的推进式被写死为「第 k+1 次请求日 = 第 k 次响应 `businessDate` 的**前一自然日**」，并明确「MUST NOT 自行枚举或跳过交易日（不假设周末与节假日）」。于是回溯**必然**发出非交易自然日的 History 请求（起点业务日为周一时，第 2 次请求即周日）；而 change 2 对「请求日 ≠ 限流日、History 空或业务日≠请求日」的定案是 `available=false` + `errors:[dateUnavailable]`、`tradeDate` 可能为源业务日或 `null`（`limit-reason-tool/spec.md:42,59,64`；`data-foundation/design.md:37` 明确「响应体确无日期 → `tradeDate=null` + `dateUnavailable`」）。本轮 grep 核验：本 change 的 spec/design/tasks **`dateUnavailable` 命中 0 次、无 §12.8 引用**（change 5 反而已按 §12.8 分档）。后果三条均为 MUST 级不判定：

1. `businessDate === null` 时推进规则无定义——实现只能抛未捕获错误或静默停摆，与 spec `:207`「abort 后不再发请求」并列的降级路径缺失；
2. 若源在该响应中回带上一交易日（如周日响应回 `businessDate=周五`），循环从周日直接退到周四，**周五从未被单独请求**，B1 可能显示比真实「最近一个有涨停记录交易日」更早的原因——这是用户可见的错误研究数据，而非措辞问题；
3. 6 次请求全部 `dateUnavailable`（长假、历史补写）时仍按 `:225`「近 6 次查询内未找到涨停记录」收尾，把「数据不可得」写成「无记录」，正是 §12.8 禁止的混淆。

**Suggestion**: ① spec「B1 有界回溯的量化边界」增强制分档：响应 `available=false` 且 `errors` 含 `dateUnavailable` → **不计为「无记录」**（按 §12.8 记为「该日涨停原因数据不可得」），并**以该响应回带的 `businessDate`（非 null 时）继续推进**；`businessDate === null` → 终止回溯并按「数据不可得」降级（含原因），不得抛未捕获错误；② 明确「每次响应的 `businessDate` 都必须纳入命中判定/推进」以防跳过交易日，并补断言「不得因源回带日期而漏检任一被跨越的交易日」；③ 新增两个 spec 场景（「周末请求返回 `dateUnavailable` 的推进与文案」/「6 次均不可得 → 文案为数据不可得而非未找到记录」）并在 tasks 5.3/5.4 落两类桩。

#### Issue 30 (Medium): Round 2 `#24` 未真正闭合——`sessionRejected` 在 change 2 无生产者、无字段名，零 mock 不可复现

**Location**: `specs/review-page/spec.md:208,227-230`、`design.md:140,315,335`（Open Questions 7）、`tasks.md:179,183,185` vs change 2 `specs/data-tool-contract/spec.md:191-207`、`tasks.md:57,73`。

处置表称已「改述为『数据模块返回 `sessionRejected`』的状态驱动降级（可 stub）」。核验 change 2：护栏③只规定「盘中拒绝全市场级调用，返回**限额说明**」且判据仍是「批量 > 硬上限（≤20）**或**显式 `fullMarket`」（`data-tool-contract/spec.md:193-204`），全 change 无任何名为 `sessionRejected` 的状态、错误码或返回字段；单标的 T1 调用既不命中判据也不声明 `fullMarket`，故**真实护栏永远不产生该状态**（这正是 Round 2 `#24` 的原判），`guard.sessionOverride` 只改时段判定、不改判据，无法用它构造。于是「状态驱动」既无生产者、也无具名契约，spec 场景「时段拒绝态降级」与 tasks 5.3② 在零 mock 纪律下**不可验收**（Round 2 的第二条建议「删去该场景或改述」只完成了字面改述，未消解可达性）。

**Suggestion**: 二选一并同步：① 由 change 2 在 `data-tool-contract` **具名定义**该状态（如返回体 `errors:[sessionRejected]` 或结构化 guard 拒绝码）并纳入 T1 返回契约，本 change 只引用；同时把 Open Questions 7 从「跨 change 待补、不阻塞」升级为**显式 blocked 依赖**（否则等于把未定状态写进本 change 的 MUST）；② 若 change 2 不新增该状态，删去该 spec 场景与 tasks 5.3②，或改为由**具名可注入的取数 seam** 驱动（可 stub、可断言 `unavailable + reason`），保证该降级分支真实可测。

#### Issue 31 (Medium): 回退分支「只读页面」的**读**通道认证姿态与「全部接口走 A 层」互斥

**Location**: `specs/review-page/spec.md:60,62,64,361-373`、`design.md:66-68`（D-3 表 C 层）、`tasks.md:225-228`（7.2）vs change 1 `design.md:96,117`（D-3 第 3 条 / D-4 P3）。

spec:60 要求「页面与**全部接口** SHALL 走 A 层」，spec:62 与 D-3 表又把回退分支的只读页面归 **C 层**（未认证只读、**需 owner 签字**）；而回退分支的定案是「A 层不可用 → 写入不可用 + 交付**只读页面**」（spec:363②、`365-368`）。此时 B4 卡片读回与 `/api/local`/`/api/enrich` 取数：按 spec:60 必须带 A 层 cookie（该分支 `SameSite=Strict` 跨源不携带），按 C 层则需 owner 签字——两者都未写成该分支的门禁事实；回退分支的 3 个场景（`:365-373`）只定义「写入不可用」与「CORS 只放行既定来源」，**未定义 C 层未签字时只读页面是否可得**，tasks 7.2 验收同样只覆盖写入与 CORS。结果是该分支的交付物「只读页面」自身可能取不到任何数据，而 spec 与 tasks 均不判别。

**Suggestion**: 「回退分支」Requirement 增一条：读接口认证姿态 = C 层未认证只读（**需 owner 签字**），签字前该分支只交付**静态页 + 显式空态**（不得以「只读页面」暗示取数可用）、签字范围与放宽点记 `docs/roadmap.md §5`；同时把 spec:60 的「全部接口」限定为「业务写入只认 A 层；回退分支的只读取数按 C 层签字范围」，tasks 7.2 增一条对应断言（未签字 → 取数接口显式不可用 + 只读空态）。

#### Issue 32 (Low): 契约 §4 仍留「frontmatter 原始文本不变」，Change 4 已改口径 → 跨文档口径不一

**Location**: `docs/design/iteration-1-contracts.md:110` vs `specs/review-card-store/spec.md:181-183`。

spec（Issue 25 处置后）已改为「既有各行文本不变 + 仅允许改值/追加缺失键」，可判定；但契约 §4 的「插到附注之前（卡片）：`frontmatter` **原始文本不变**」与紧随其后的「只做**值级最小文本修补**」仍是 Round 2 Issue 25 指出的同一互斥表述，且契约是「跨 change 唯一事实源」。实现者若以 §4 为准会得到不可判定口径（同一条要求既是「文本不变」又允许补键）。**Suggestion**: 把 §4 该句改为与 spec 同文的「frontmatter 既有行文本不变；仅允许对既有键改值、按固定格式追加缺失键，MUST NOT 重排既有行」。

#### Issue 33 (Low): `storeWarnings[]`（change 4 HTTP）与 `warnings: string[]`（§3/§12.7）双名并存，change 5 又明文否定该字段名

**Location**: `specs/review-page/spec.md:39,273,278`、`specs/review-card-store/spec.md:125,299,410-421`、`design.md:81,208`、`tasks.md:152,263` vs change 5 `proposal.md:13`、`tasks.md:61,65`（「**MUST NOT 出现 `storeWarnings[]` 这一字段名**」「不存在 `storeWarnings[]` 这一幽灵字段」）。

模块层字段名已统一为 `warnings: string[]`（与 §3/§12.7 一致），但页面层 HTTP 响应字段仍叫 `storeWarnings[]` 并有一个同名 Requirement，change 5 又以 MUST NOT 的口吻否定该字段名——读者无法判断这是「不同边界的不同名字」还是「change 4 未按 §12.7 收口」。**Suggestion**: 在 §12.7 或本 change spec 加一句边界说明（如「store 层导出字段 = `warnings`；页面响应字段 = `storeWarnings`，仅供 B4 展示」），或把页面响应字段统一改名为 `warnings` 并同步 tasks 4.5/§8 映射行，消除双名。

#### Issue 34 (Low): `docMismatch` 告警类型不可达；`nameTruncated` 被写成事实但信号形状仍待 change 2 暴露

**Location**: `design.md:258,274-276,337`（D-20 / D-21 / Open Questions 9）、`specs/review-card-store/spec.md:231,417-423`。

① `StoreWarningKind` 含 `'docMismatch'`，但 D-21/spec 均规定归属不一致时**抛显式 `DOC_MISMATCH`**（不追加、不返回），因此该 `kind` 没有产生路径，`warnings` 编码断言（`^\[(...|docMismatch)\] `）中的这一支为空转；② spec:423 以陈述句写「`nameTruncated` …由 change 2 唯一净化实现产生」，而 change 2 `data-root-layout/spec.md:72` 只写「截断并记 `nameTruncated`」，未定义该信号的返回形状，本 change 仅以 Open Questions 9 承接。**Suggestion**: 删除 `docMismatch` 或明确其唯一产生场景（如写入被拦截但调用方仍取响应告警路径）；把 spec:423 改为条件句（「change 2 暴露该信号后透传；未暴露期间 `warnings` 不含该项」），与 Open Questions 9 一致。

#### Issue 35 (Low): 路由 handler/认证的可注入测试 seam 未定义（对比 change 1 D-10），tasks 2.2/2.5 的零 mock 用例落点不明

**Location**: `tasks.md:82-97`（2.2/2.5）、`design.md:32-47`（D-1/D-2）vs change 1 `design.md:181-192`（D-10 `createProbeHandler(deps)`）。

tasks 2.5 要求单测覆盖「未认证写请求被拒 / **A 层不可用时写接口拒绝** / B 层 token 被拒 / 与探针路由共存 / MIME / 穿越 / 无外链」，2.6 还要求 `/api/local` 的纯本地结构断言；但本 change 未定义把「宿主 `requestRejection`/cookie 判定」与「webServer 注册」抽象为可注入依赖的工厂（change 1 已用 D-10 解决同类问题）。零 mock 纪律下，「A 层不可用」只能靠集成核对，与 tasks 的用例形态不一致。**Suggestion**: 沿用 change 1 D-10 先例，在 D-1 增一段「路由 handler 提为 `createReviewHandler(deps)`（注入认证判定、资产读取、service 取数）」，并明确「注册/卸载」标为集成核对、其余用真实 `node:http` 桩，避免实现期才发现用例不可写。

### Positive Aspects

- **§3 逐字一致可核验**：store spec 的 `Loc`/`Result`/五导出签名（`spec.md:210-219`）与 `iteration-1-contracts §3:77-86` 我逐字比对**完全相同**（含 `DOC_MISMATCH` 写前硬校验、`parseDoc` 内联 `warnings`），change 5 三处引用（`daily-summary/spec.md:5-7,147,380`）同源，跨 change 具名接口无第二份定义。
- **D-8 从「三 MUST 互斥」收敛为单一可判定口径**：废止声明写在正文而非处置表，起点/推进/上限/超时/abort/`offSession`/文案七项各有定值，tasks 5.5 用跨周末序列（`2026-09-28 → 2026-09-27`）把推进算法变成可失败断言——这是 Round 2 最难收的一处，收得干净（残留见 Issue 29，属新增相邻缺口而非原矛盾未消）。
- **名称分层归属唯一**：每层的接口归属写进 D-5 表 + spec Requirement + 4 场景（含「本地段不承担网络反查」结构断言），`/api/local` 的 ≤500 ms 承诺不再被层① 的网络反查暗破。
- **净化实现单点收口**：`src/review/sanitize.ts` 已从产物清单消失，tasks 1.7 明写「**无本 change 自有净化模块**」+ 6.3⑦ 结构断言 + spec 负向场景，与 §6/§11 的所有权表一致；`nameTruncated` 的写时/读时职责也一并划清。
- **认证面按 change 1 实测结论收口且不放宽**：A/B/C 三层、写接口只认 A 层、A 层不可用即写接口显式不可用、`?token=` 直连 401 负向断言，三处（spec/tasks/design）+ 契约 §12.1 + change 1 D-3/D-7 互相印证，Round 2 Issue 19 的「无实现路径」已消除。
- **下游（change 5）引用已就绪**：`warnings: string[]`、`formatZonedIso`/`formatAnchorTime`、`DOC_MISMATCH`、§12.8 分档在 change 5 侧均已成文，且 change 5 自身声明了 `DEPENDENCY_UNAVAILABLE` 准入条件——本 change 的导出面缺陷不再向下游放大。

### Summary

Top 3：

1. **(High) `§12.8` 未同步 → 回溯推进的非交易自然日/`dateUnavailable` 分支不可判定**：`businessDate===null` 时无推进规则、源回带上一交易日时可能漏检被跨越的交易日、6 次「数据不可得」被写成「未找到涨停记录」（Issue 29）。
2. **(Medium) Round 2 `#24` 仍未闭合**：`sessionRejected` 在 change 2 无具名生产者、单标的调用永不触发判据，spec 场景与 tasks 5.3② 零 mock 不可复现（Issue 30）。
3. **(Medium) 回退分支的读通道认证姿态缺位**：spec「全部接口走 A 层」与 C 层未签字只读、以及「只读页面」的取数路径互相矛盾（Issue 31）。

其余为 Low 建议（契约 §4 措辞 Issue 32、`storeWarnings` 双名 Issue 33、`docMismatch` 不可达与 `nameTruncated` 信号 Issue 34、路由测试 seam Issue 35）。返工面很窄：Issue 29/31 各约 1 段 spec/design 文字 + 1–2 条场景/断言，Issue 30 需一次跨 change 命名裁决（或删场景）。Round 2 的 19–28 与 `#8/#11/#16` 中，除 `#24` 外**均已实质闭合**。**未核验项**（沿 Round 2，不影响本次结论）：`docs/spikes/` 仍不存在（承载绑定层依约 blocked）；仓外需求文档/模块文档（M1-Q4、M2-Q2/Q3、R2/R5）与 vault 侧写分区登记不可读；宿主符号行为以 change 1 探针实测为准。

**Consensus Status**: NEEDS_REVISION
