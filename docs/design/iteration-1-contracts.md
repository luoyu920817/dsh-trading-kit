# 迭代一共用契约（iteration-1-contracts）

> 立稿 2026-09-27，来源：openspec 迭代一 5 个 change 的第一轮对抗性评审
> （`reviews/*-review.md`）。本文件是**跨 change 的唯一事实源**：凡 openspec change
> 里出现「复用 X / 口径见 Y / 与 Z 共享」的表述，MUST 指向本文件的具名条目；
> 引用本文件时写 `iteration-1-contracts §<编号>`。

## 0. Change 编号与依赖

| 编号 | change | 依赖（blocked_by） |
| --- | --- | --- |
| change 1 | `spike-tdx-embed` | 无（阶段 1 骨架已完成的可行性闸门）；**不引入 `src/config.ts` / `export const Config`**（见 §11） |
| change 2 | `data-foundation` | 无强依赖（数据面可独立先行）；**`src/config.ts` 与 `traderKit.health.status()` 的唯一所有者** |
| change 3 | `tq-skill-installer` | change 2（复用其 `src/config.ts` 的 `Config` 并追加 `skill` 段；只提供 `traderKit.skill.status({cwd?})`，MUST NOT 另建 `health.status()`） |
| change 4 | `review-page` | change 2（service 出口 + `resolveArea`/`sanitizeNameSegment`）；**承载绑定层**（路由/认证/资产形态）blocked_by change 1 |
| change 5 | `daily-summary` | change 2、change 3、change 4（存储实现与共享写入器 `§3`） |

「复用实现」一律写成 **模块路径 + 导出签名 + service key**（见 `§3`）；无具名接口的
「复用」视为无效表述。

## 1. 日期三义分离与 `resolveTradeDate`（T0）

三个日期概念 MUST 分开定义、不得互相顶替：

| 名称 | 来源 | 用途 |
| --- | --- | --- |
| **限流日** `rateLimitDate` | 系统时钟，固定 `Asia/Shanghai` | 护栏时段判定（09:15–11:30 / 13:00–15:00）、预算桶键、T1 端点路由判据 |
| **请求日** `requestedDate` | 调用方入参；缺省 = 限流日 | 选择 S7 `surgeLimitList` / `surgeLimitHistory` |
| **业务日** `businessDate` | 数据源返回（S7 响应 `data.date` / TQ `HqDate`） | 归属、缓存桶、落盘目录；**一切消费方的唯一日期依据** |

- **日期格式唯一口径**：工具/service 契约、数据包、缓存 payload 中的日期一律 `YYYY-MM-DD`；
  `YYYYMMDD` **只允许**出现在 ①目录/文件名模板参数与锚点（`<YYYYMM>`/`<YYYYMMDD>`）、②天级缓存
  目录、③第三方源请求参数。两格式的转换 MUST 经单点工具 `src/data/date.ts`
  （`toCompactDate(iso)` / `fromCompactDate(compact)` / `isValidIsoDate` / `rateLimitDate(now)`），
  各处 MUST NOT 自行拼接或截断字符串。
- 路由：`requestedDate === rateLimitDate` → 用 `surgeLimitList`；当日 **List 空/失败**时可回退
  `surgeLimitHistory`（必须记 `source`/endpoint 与 `notes`）。`requestedDate !== rateLimitDate` →
  只用 `surgeLimitHistory`；其空/失败 **MUST NOT** 回退 List（List 是当日全市场列表，会把别日数据
  当请求日数据），返回 `available=false` + `errors:[dateUnavailable]`。
- `tradeDate`（= `businessDate`）MUST 从响应体无条件取值，**不得**因「列表为空」而丢失。

**T0 能力 `trade-date-tool`（change 2 新增，唯一实现）**

- service：`traderKit.data.resolveTradeDate({ date? })`
- tool：`get_trade_date`
- `date` 入参：canonical `YYYY-MM-DD`（兼容 `YYYYMMDD` 输入，经 `fromCompactDate` 归一，**MUST NOT 猜测**）
- 返回：`{ requestedDate, businessDate: 'YYYY-MM-DD' | null, isTradingDay: true | null, source, fetchedAt, evidence }`
- `isTradingDay`：`businessDate === rateLimitDate` → `true`；否则 `null`（**无交易日历，
  禁止用系统日期推断「非交易日」**）。`null` 的语义 = 「归属待用户确认」。三者同格式（`YYYY-MM-DD`）比较。
- 消费方：change 4 的 `TradeDateResolver` seam MUST 调用本能力；change 5 的
  `review_daily_scan` 缺省交易日 MUST 调用本能力。二者 MUST NOT 各自实现日期推断。
- 不可得（`businessDate === null`）：change 4 → 提交前归属确认；change 5 →
  显式要求用户指定交易日，MUST NOT fallback 系统日期。

## 2. 代码与锚点规范化（单点实现）

- `normalizeCode(raw) -> '600000' | null`：trim；去 `sh|sz|bj` 前缀与 `.sh|.sz|.bj`
  后缀（大小写不敏感）；余下须为 6 位数字；**保留前导零、不补全、不猜测**。
  实现落 `src/review/anchor.ts`（change 4），change 5 复用；页面与工具入参 MUST 经它。
- 锚点正则（唯一版本，写入与解析共用）：

```
^card-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
```

- 解析与幂等扫描规则：**逐行扫描，只认 H2 标题行**（`^##\s`），并跳过 fenced code
  block（``` / ~~~ 围栏）内的行。用户正文中出现锚点字样 MUST NOT 影响判定。
- 归属校验：锚点日期段 == frontmatter `tradeDate` 折算的 `YYYYMMDD`，且代码段 ==
  frontmatter `code` 时才算有效卡片/附注；不一致记入 `storeWarnings`，不静默。

## 3. 文档写入契约（change 4 实现，change 5 复用）

`src/review/store.ts` MUST 导出（签名即契约）：

```ts
type Loc = { dataRoot: string; code: string; name?: string; tradeDate: string }  // tradeDate: YYYY-MM-DD
type Result<T> = T & { warnings: string[] }   // 五个导出**一律**返回 warnings: string[]（可为空数组）
locateDoc(loc: Loc): Promise<Result<{ path: string }>>
parseDoc(path: string): Promise<{ frontmatter: Record<string, unknown>; cards: Card[]; ainotes: AInote[]; eol: '\n' | '\r\n'; bom: boolean; warnings: string[] }>
appendCard(input: { loc: Loc; body: string; now?: Date; clientRequestId?: string }):
  Promise<Result<{ status: 'created' | 'duplicate'; anchor: string; path: string }>>
appendAinote(input: { loc: Loc; body: string; generatedAt: string; dataSources: string[]; now?: Date }):
  Promise<Result<{ status: 'created' | 'skipped'; anchor: string; path: string }>>
scanDailyCardTargets(tradeDate: string):
  Promise<Result<Array<{ code: string; name: string; path: string; cardCount: number; hasAinote: boolean }>>>
```

- **归属校验（写前硬校验）**：`appendCard` / `appendAinote` MUST 校验「目标文档 frontmatter 的
  `tradeDate` + `code`」== 入参 `loc`；不一致 → 抛显式错误 `DOC_MISMATCH`（含两边的 code/tradeDate），
  MUST NOT 追加，MUST NOT 静默改用其它文档。
- **日期/时间格式化单点**：`src/review/format.ts`（change 4 实现）导出 `formatZonedIso(date): string`
  （`YYYY-MM-DDTHH:mm:ss+08:00`，供卡片 `writtenAt` 与附注 `generatedAt` 共用）与
  `formatAnchorTime(date): string`（`HHmm`）；change 5 MUST 引用它，MUST NOT 自写格式化。
- **日期换算**：`src/data/date.ts`（change 2 实现）为 `YYYY-MM-DD ⇄ YYYYMMDD` 的唯一实现。

- **插入位置**：卡片分节插入到**首个 `^ainote-` 分节之前**（卡片区尾部）；附注分节
  **始终追加到文档末尾**。两者 MUST NOT 互换位置。
- service key：`traderKit.review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets}`；
  工具出口 `review_daily_scan` / `review_read_daily` / `review_append_ainote` 与之
  **同一实现**（不得第二份追加逻辑）。
- 幂等键：附注 = `(tradeDate, code)` + `§2` 前缀扫描；卡片 = `clientRequestId`（可选）。
- 冲突/多命中：同 `(code, date)` 命中多份文档时，取 `mtime` 最新（平局按文件名字典序），
  并在响应里返回 `storeWarnings[]` 由页面显式展示；MUST NOT 静默任选。

## 4. 「既有内容不变」的精确口径

- **追加到末尾**（附注）：原文件字节内容是结果文件的**前缀**；仅当原文件无尾换行时先补
  一个本文件 EOL 分隔符（该分隔符不计入「既有内容」）。
- **插到附注之前**（卡片）：`frontmatter` **既有行文本不变**（仅允许对既有键改值、按固定格式**追加**缺失键，MUST NOT 重排既有行）+ 既有各分节字节序列不变 +
  既有附注字节不变。
- EOL 与 BOM：读取时探测（`\r\n` vs `\n`、BOM）；写入 MUST 保持同一 EOL 风格、BOM 原样；
  frontmatter 只做**值级最小文本修补**，MUST NOT 整体重序列化（键序/引号/缩进不变）；
  未知键 MUST 原样保留。

## 5. 并发写纪律（页面 / 附注 / 人工编辑共用）

- 进程内：按绝对路径的异步互斥（`Map<absPath, Promise>` 串行链）。
- 跨进程：写前 `stat`（`mtimeMs` + `size`）与读取快照比对；不一致 → 重读重试。
- 重试：上限 3 次，退避 50 / 200 / 800 ms；`EBUSY`/`EPERM`/`EACCES` 视为可重试；
  单次写入总超时 5 s。
- 冲突不可解 → 显式错误 `CONCURRENT_WRITE`（含路径与处置建议），MUST NOT 静默覆盖。

## 6. 文件名与 frontmatter 净化

- 文件名模板由 `data-root-layout` 的两级映射表持有（区域目录 + 文件名模板
  `<代码>_<名称>_<YYYYMMDD>.md`）；`resolveArea` 对模板参数做白名单校验
  （`code: ^\d{6}$`、`date: ^\d{8}$`、`name` 见下）；调用方 MUST NOT 自行拼接。
- `sanitizeNameSegment(name)` **唯一实现**在 `src/paths/sanitize.ts`（change 2）：NFC 归一；
  `[\\/:*?"<>|\x00-\x1f]` → `_`；去首尾空格与点号；Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9）
  加 `_` 后缀；长度上限 40 字符（超限截断并记 `nameTruncated`）；结果为空 → 用代码段充当名称段。
  change 4 的文件名拼装 MUST `import` 该实现，MUST NOT 另建 `src/review/sanitize.ts`；
  净化后 MUST NOT 改变既有文件名。
- frontmatter 值一律双引号包裹并转义 `"` 与换行；`name` 为空时写空字符串。

## 7. 断言方式（禁止只用源码文本扫描）

- 结构断言替代字符串扫描：`src/routes/**`、`src/client/**` MUST NOT import `src/data/**`
  （允许 import service 类型）；全仓**仅两条具名出站通道**允许 `fetch(` / `http.request`：
  `src/data/http.ts`（数据面，受 guard 闸门）与 `src/skill/download.ts`（skill 安装器的下载器，
  带 6 条替代护栏 + `checkIntervalHours` 节流，见 change 3 design D-12）。
- 扫描型用例 MUST 先断言「扫描目标非空」（`targets.length > 0`），避免空过。
- 17709 断言：数据模块对其**无 HTTP 请求**，仅 `net.connect` 探测（且可配置关闭）。
- 交易接口断言：源码与依赖中不存在 `order_stock` / `cancel_order` 调用路径。

## 8. 事实核验纪律（design 的写法）

- design 的「事实」分两节：**已实测**（含证据、日期、可复现命令）与**待验证**（列为
  spike/待办任务 + 降级策略）。未核验项 MUST NOT 写成「已核实」。
- 引用宿主源码一律用**符号名**（`<文件>:<符号>`），行号易失效；引用不可达路径时改用
  可比先例（如 `DSH-better-sidebar`）并注明「版本等价性未核验」。
- 需求文档/模块文档（`需求描述-*`、`模块文档 §x`、M1-Q*/M2-Q*）当前**不在本仓**：引用
  它们时 MUST 标注「仓外文档，未能核验」或落一份仓内摘录。

## 9. 缓存层级与预算（change 2）

- 两层缓存：**列表级**（键 = `source + requestedDate`——调用方入参，**可构造**；payload 内含源返回的
  `businessDate`）与 **code 派生视图级**（键 = `requestedDate + code`；返回体携带 `businessDate`）。
  MUST NOT 用 `businessDate` 做键（它在响应到达前不可知，会使「同参重复调用零网络」不可实现）。
- 频控预算与最小间隔按**列表级请求数**计；`cacheSchema` 版本不匹配 → 视为未命中并覆盖写。
- `refresh` 参数：本迭代**不提供**（工具 schema 不含该入参，文中不得出现幽灵参数）。
- 本迭代无盘后刷新、无定时任务。

## 10. 迭代一重排与写分区登记

- 本迭代刻意打乱 `docs/roadmap.md` 的阶段顺序，覆盖阶段 3/4/5 的子集（详见 roadmap §5）。
- 新增白名单写路径（vault）：`DB/review/`、`agent/DB/temp/dsh-trader-kit/`、`agent/skills/`
  （skill 落点区，见 `§11`）；其余 vault 区域（`events/`、`知识卡片/`、`DB/opt/`、`DB/daily/`）
  本迭代只读或不触。`vault-integration` 写分区契约 MUST 补登这三条路径。
- **「不写 vault」断言的正确范围**：指「`dataRoot` 下既定业务区之外零写入」。一切
  「安装/部署前后全 vault diff 为空」的断言 MUST 把 `dataRoot` 下白名单区排除在 diff 之外，
  否则与「把 skill 装到 `agent/skills/`」自相矛盾。
- `installDir` 的「禁止落在 vault 内」校验 MUST 豁免 `dataRoot` 下的 `agent/skills/`、
  `agent/DB/temp/dsh-trader-kit/` 与 `DB/review/`；其余 vault 路径仍禁。
- 发布产物纪律：`cordis.patch.yml`（在 `package.json#files` 内）MUST NOT 写入个人机器绝对
  路径或易失第三方签章现值；实例路径与 `S7 sign/ts` 走本机 profile / 注释示例 / 占位符。

## 11. 文件与出口所有权（避免双份产出）

| 文件 / 出口 | 唯一所有者 | 其它 change 的义务 |
| --- | --- | --- |
| `src/config.ts`（`export const Config`） | **change 2** | change 3 MUST 在其落地后**追加** `skill` 段（同一文件、同一 schema），MUST NOT 另建配置文件；change 1 **不引入** Config（探针的 `basePath`/开关先用模块常量，change 2 落地后由其接管）；各 change MUST NOT 在 `Config` 之外另留配置类型（含 `TraderKitConfig`） |
| `src/index.ts` 的 `apply(ctx)` 装配 | **change 2**（骨架：`tools` 依赖、`provide('traderKit')`、类型增强） | change 1/3/4/5 只**追加**注册调用（路由/工具/service 注册），MUST NOT 重建装配面或重置 service 根 |
| `traderKit.data.*` / `traderKit.health.status()` | **change 2** | change 3 只提供 `traderKit.skill.status({ cwd? })`，由 change 2 的 `health.status()` 透传为 `{ data, skill }` 的 `skill` 段；MUST NOT 二次产出 `health.status()` |
| `src/data/**`（含 `src/data/date.ts`、`src/data/http.ts`） | **change 2** | 其它 change 只经 service 消费 |
| `src/skill/**`（含 `src/skill/download.ts`） | **change 3** | 第二条具名出站通道（`§7`） |
| `src/paths/sanitize.ts`、`src/paths/mapping.ts` | **change 2** | change 4 MUST import，MUST NOT 另建 `src/review/sanitize.ts` / 第二份路径映射 |
| `src/review/store.ts`、`src/review/format.ts`、`src/review/anchor.ts` | **change 4** | change 5 MUST 复用（`§3`），MUST NOT 另写追加/解析/格式化 |
| `src/routes/**` | change 1（探针路由）/ change 4（`/review*`） | 路径命名空间：change 1 用 `<basePath>/probe`，change 4 用 `/review*`，MUST NOT 重叠 |
| `src/summary/**` | **change 5** | 运行摘要的唯一生产者（见 §12.6） |

## 12. 跨 change 冲突裁决（Lead，2026-09-27）

1. **认证语义以 change 1 结论为准**：A 层 = 宿主 tokenized URL + cookie（**两步**：先
   `GET <base>/?token=` 铸 cookie，再导航业务路径）；B 层 = **插件自持诊断 token**
   （每次请求带 `?token=`，由插件路由自行校验），**仅诊断/只读**；C 层 = `file://` + 就地
   取数，需 owner 签字且只读。**业务写入（`POST /review/api/card`）MUST NOT 依赖 B/C 层**：
   A 层不可用即写入接口不可用（显式禁用 + 提示），MUST NOT 放宽认证。
2. **`health.status()` 单点产出**：change 2 产出 `{ data, skill }`；change 3 只产出
   `traderKit.skill.status({ cwd? })`（见 `§11`）。
3. **`Config` 单点产出**：change 2 拥有；change 3 追加 `skill` 段；change 1 不引入。
4. **名称解析三级兜底的分层**：①本地历史卡片 frontmatter（`/review/api/local`）→
   ②T2/S8 网络反查（**`/review/api/enrich`**，入参含 `code`）→ ③仅代码。MUST NOT 让
   `/api/local` 承担网络反查（否则本地段 ≤500 ms 的承诺失效）。
5. **回溯算术唯一口径**：以 `resolveTradeDate` 得到的最近业务日为起点，逐次以
   `date = 上一次 businessDate 的前一自然日` 请求 History，**最多 N 次列表级请求（默认 6）**，
   命中即停；每次的 `businessDate` 由源返回（MUST NOT 自行枚举交易日）；达上限 →
   「近 N 次查询内未找到涨停记录」。禁止同时声明「≤6 业务日 + ≤7 请求 + 禁自然日枚举」三套互斥约束。
6. **运行摘要必须有生产者**：change 5 提供 tool + service
   （`review_daily_report` / `traderKit.review.dailyReport`），入参
   `{ tradeDate, entries: [{ code, status: 'created'|'skipped'|'failed'|'deferred', reason? }] }`，
   行为 = 合并写入当日运行摘要（沿用 `§5` 互斥与原子写），返回三态并集与缺失清单；
   「entries 代码集合 ⊇ 扫描清单」「`failed[].reason` 非空」MUST 由该出口断言，MUST NOT 只靠 agent 文本约定。
7. **`storeWarnings` 有出口**：`§3` 的五个导出**一律**返回 `warnings: string[]`；
   仅存在于文档里的告警字段视为无效。
8. **`dateMismatch` 与「无记录」必须区分**：T1 返回 `errors` 含 `dateUnavailable` →
   数据完整性问题（`missing`）；`available=false` 且无 `dateUnavailable` → 「无涨停记录」（正常）。
