## ADDED Requirements

### Requirement: 存储路径与文件粒度

卡片 SHALL 落于 `<数据根>/DB/review/<YYYYMM>/<代码>_<名称>_<YYYYMMDD>.md`（数据根解析与目录自动创建遵循 change 2 的 `data-root-layout`；文件名模板由该映射表的 `resolveArea` 持有，调用方 MUST NOT 自行拼接，见 `iteration-1-contracts §6`）。**一个标的 × 一个交易日 SHALL 对应一个 md 文档**；同标的同日的多张卡片 MUST 共处同一文档，MUST NOT 每卡一个文件。文档定位 SHALL 以「代码 + 日期」为准（扫描当日目录匹配 `<代码>_*_<YYYYMMDD>.md`）：已存在文档时 MUST 复用，MUST NOT 因名称变化（更名/ST 等）新建第二个文档；多命中时 SHALL 按「多命中文档的确定性选择」Requirement 处理。

#### Scenario: 首次落卡片

- **WHEN** 某标的某交易日首次提交卡片
- **THEN** 目录（含父级）按范式自动创建，生成文件名为 `<代码>_<名称>_<YYYYMMDD>.md`

#### Scenario: 同日第二张卡片

- **WHEN** 同标的同日已有文档，再次提交卡片
- **THEN** 不产生新文件，内容插入既有文档的卡片区尾部

#### Scenario: 名称变化不产生第二份文档

- **WHEN** 已有当日文档，但本次解析到的名称与文件名中的名称不同
- **THEN** 复用既有文档（以代码 + 日期定位），MUST NOT 新建第二个文档

#### Scenario: 名称未获取

- **WHEN** 名称三层降级均未命中
- **THEN** 以代码充当文件名名称段并照常落盘（不阻断），frontmatter 的 `name` 记为空字符串，且 MUST NOT 事后自动重命名既有文件

### Requirement: 文件名与 frontmatter 值净化

名称段来自外部数据源（T2/S8 `stock_chi_name`），落盘前 SHALL 经 change 2（`data-foundation`）`data-root-layout` 的 `sanitizeNameSegment(name)` 净化——**唯一实现位于 `src/paths/sanitize.ts`**（`iteration-1-contracts §6`/`§11`）：Unicode **NFC** 归一；`[\\/:*?"<>|\x00-\x1f]` 替换为 `_`；去首尾空格与点号；**Windows 保留名**（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`，大小写不敏感）加 `_` 后缀；长度上限 **40 字符**（超限截断）；净化后为空 SHALL 回落为**代码段**充当名称段。frontmatter 值 SHALL 一律双引号包裹并转义 `"` 与换行；`name` 为空时写空字符串。净化 MUST NOT 改变既有文件名。

**归属硬约束**：本 change 的文件名拼装 SHALL `import` 该唯一实现、或经 `resolveArea(key, params)`（change 2）生效，**MUST NOT 另建 `src/review/sanitize.ts` 或第二份净化实现**（结构断言：全仓净化实现唯一）。`nameTruncated` 由该唯一实现在截断时产生，本 change 只把它**透传到写入响应的 `warnings`**（见「`warnings` 的呈现契约」），MUST NOT 在读路径重算净化结果。

#### Scenario: ST 名称含 `*`

- **WHEN** 名称为 `*ST海航`
- **THEN** 文件名名称段为 `_ST海航`（`*` → `_`），落盘成功，MUST NOT 出现非法文件名字符

#### Scenario: 含路径分隔符或冒号

- **WHEN** 名称含 `/`、`\` 或 `:`
- **THEN** 均替换为 `_`；MUST NOT 建子目录、MUST NOT 越出 `DB/review/<YYYYMM>/`

#### Scenario: Windows 保留名

- **WHEN** 名称为 `CON` / `NUL` / `com1`
- **THEN** 名称段加 `_` 后缀（如 `CON_`），落盘成功

#### Scenario: 超长名称

- **WHEN** 名称超过 40 字符
- **THEN** 由 change 2 的唯一实现截断至 40 字符；截断事实经本 change 的**写入响应 `warnings`** 以 `nameTruncated` 上报（编码见「`warnings` 的呈现契约」），读路径 MUST NOT 被要求重算

#### Scenario: 净化后为空

- **WHEN** 名称全由非法字符组成（净化后为空串）
- **THEN** 名称段回落为 6 位代码段，落盘成功

#### Scenario: 不另建净化实现

- **WHEN** 审查本 change 源码
- **THEN** 不存在 `src/review/sanitize.ts`、也不存在第二份「替换非法字符/截断/保留名」实现（结构断言，扫描前先断言目标非空，`iteration-1-contracts §7`）

#### Scenario: frontmatter 值转义

- **WHEN** 名称含 `"` 或换行
- **THEN** 写入 frontmatter 的值被双引号包裹并转义，YAML 可被后续解析（结构不被破坏）

### Requirement: 文档结构与卡片分节

文档 SHALL 为「文件级 frontmatter + 卡片分节」结构。frontmatter SHALL 至少含 `code`、`name`、`tradeDate`、`subjective: true`，并 SHALL 保留 F2 预留键 `patterns`、`drafts`（本迭代恒为空数组，但既有值 MUST NOT 被清空）。每张卡片 SHALL 为一个 H2 分节：标题含本地时间 `HH:mm` 与行内 block 锚点，分节内 SHALL 含 `- writtenAt: <带时区 ISO8601>` 元信息行，其后为用户正文；提交幂等启用时 SHALL 另含 `- clientRequestId: <id>` 行。卡片分节 MVP SHALL 仅含 `writtenAt`（与 `clientRequestId`）元信息行；盘面快照 `sourceContext` 按 M2-Q3 裁决后置，届时补充仅对后继新卡片生效，MUST NOT 回填改写既有分节。

**锚点正则（唯一版本，写入与解析共用，`iteration-1-contracts §2`）**：

```
^card-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$
```

#### Scenario: 新卡片分节结构

- **WHEN** 提交一张卡片
- **THEN** 文档中出现形如 `## 14:32 ^card-20260924-600000-1432` 的分节，含 `writtenAt` 行与用户正文

#### Scenario: 同分钟多卡锚点唯一

- **WHEN** 同一分钟（同一 `HHmm`）内提交第二张卡片
- **THEN** 新卡片锚点追加序号（如 `-1432-2`），文档内锚点唯一，MUST NOT 出现重复锚点

#### Scenario: 正文原样写入

- **WHEN** 用户提交含换行、Markdown 记号的正文
- **THEN** 正文原样（去首尾空白外不做加工）写入，不格式转换、不改写措辞

### Requirement: frontmatter 最小键 schema

frontmatter 的键语义 SHALL 按下表校验；**未知键 MUST 原样保留**（MUST NOT 删除、MUST NOT 重排、MUST NOT 重序列化）。

| 键 | 类型 | 允许值 / 说明 | 缺省行为 |
| --- | --- | --- | --- |
| `code` | string | `^\d{6}$`（经 `normalizeCode`） | 首次创建时写入，必填 |
| `name` | string | 任意（写入时双引号转义）；未获取时为空字符串 `""` | 首次创建时写入 |
| `tradeDate` | string | `^\d{4}-\d{2}-\d{2}$`，归属交易日（`iteration-1-contracts §1`） | 首次创建时写入，必填 |
| `subjective` | boolean | 恒 `true`（用户主观记录标记） | 首次创建时写入 |
| `patterns` | string[] | **模式 id 字符串数组**，与 roadmap F1 词表对齐（`超短`/`价投`/`期货` 三命名空间 + 模式级 id）；本迭代恒为空数组 `[]` | 保留既有值 |
| `drafts` | array | **未定，保留原样**（元素结构待 F2.2/F2.3 裁决）；本迭代恒为空数组 | 保留既有值 |
| 其它键 | 任意 | 未知键 | MUST 原样保留 |

#### Scenario: 预留键保留

- **WHEN** 文档 frontmatter 的 `patterns` 为 `["超短-首板"]`、`drafts` 含未知结构元素
- **THEN** 本次写入后两者值逐字节不变（MUST NOT 重置为空数组、MUST NOT 重排）

#### Scenario: 未知键保留

- **WHEN** frontmatter 含本 schema 未定义的键（如后续迭代新增键）
- **THEN** 该键与其值原样保留，键序与引号形态不变

#### Scenario: `patterns` 元素形态

- **WHEN** 写入或读取 `patterns`
- **THEN** 元素为模式 id 字符串（与 F1 词表同命名空间），MUST NOT 为对象或空串

### Requirement: 解析与幂等规则（只认 H2、跳代码块、归属校验）

解析与幂等扫描 SHALL **逐行扫描并只认 H2 标题行**（`^##\s`），SHALL **跳过 fenced code block**（``` / ~~~ 围栏）内的行——用户正文中出现的锚点字样 MUST NOT 影响判定。仅当「锚点日期段 == frontmatter `tradeDate` 折算的 `YYYYMMDD`」且「代码段 == frontmatter `code`」时，该分节才算有效卡片/附注；不一致（**幽灵锚点**）或同前缀重复锚点 SHALL 记入 `warnings` 显式告警，MUST NOT 静默计入卡片。附注的幂等键为 `(tradeDate, code)` + `^ainote-<YYYYMMDD>-<代码>-` 前缀扫描；卡片的幂等键为 `clientRequestId`。

#### Scenario: 代码块内锚点不入卡片

- **WHEN** 用户正文包含 ```` ``` ```` 围栏代码块，块内含 `## 12:00 ^card-20260924-600000-1200`
- **THEN** 该行不被识别为卡片分节，不计入 B4，不产生告警

#### Scenario: 幽灵锚点告警

- **WHEN** 文档 H2 行含 `^card-20260923-600000-1200`，而 frontmatter 的 `tradeDate` 为 `2026-09-24`
- **THEN** 该分节不计为用户卡片，`warnings` 记录日期不一致的幽灵锚点与行信息

#### Scenario: 重复锚点告警

- **WHEN** 文档中存在两个相同锚点 `^card-20260924-600000-1432`
- **THEN** 渲染时按首次出现保留、其余去重，`warnings` 记录重复锚点；写入侧 MUST NOT 再产生重复

#### Scenario: 正文含行首 `##`（显式取舍）

- **WHEN** 用户正文含行首 `## ` 但不含锚点
- **THEN** 该行归入所属卡片的正文（不切成新卡片、不产生幽灵卡片）；卡片分节边界只由锚点 H2 行、附注 H2 行与文件末尾决定

### Requirement: 追加/插入语义与原子写

写入 SHALL 遵守插入位置契约：**卡片分节插入到首个 `^ainote-` 分节之前**（即卡片区尾部；无附注时等价于追加到末尾）；**附注分节始终位于文档末尾**；两者 MUST NOT 互换位置（与 change 5「附注 = 文档末尾独立分节」一致）。写入前 SHALL re-read 现有文档并合并（OneDrive/外部编辑并发容忍）；写入 SHALL 为原子写（同目录临时文件 + 改名，失败不留半截文档）。**既有卡片分节与其正文 SHALL 字节级不变**；frontmatter 的既有键值 SHALL 保留（只做值级最小文本修补，见「既有内容不变的精确口径」）。

#### Scenario: 既有内容字节级不变

- **WHEN** 已有 N 张卡片，提交第 N+1 张
- **THEN** 前 N 张分节与其正文逐字节不变（可用对比断言）

#### Scenario: 文档已含附注时插入卡片

- **WHEN** 文档已含 change 5 写入的 `^ainote-` 分节，用户再提交卡片
- **THEN** 新卡片插入到该附注之前；附注分节的正文与锚点逐字节不变；附注仍在文件末尾

#### Scenario: 写前 re-read 合并

- **WHEN** 本次写入前，文档被外部（Obsidian/OneDrive 同步）追加了内容
- **THEN** 外部内容被保留，新卡片插入在卡片区尾部、附注之前（无附注则在末尾），无覆盖

#### Scenario: 原子写

- **WHEN** 写入过程中进程中断
- **THEN** 文档不存在半截状态（要么旧内容、要么含新卡片）

#### Scenario: 预留键不被清空

- **WHEN** frontmatter 中 `patterns` / `drafts` 已有值（后续迭代回填）
- **THEN** 本次写入保留其值，MUST NOT 重置为空数组

### Requirement: 「既有内容不变」的精确口径（契约 §4）

写入 SHALL 满足以下**精确**口径（替代含糊的「既有内容不变」）：

- **追加到末尾**（附注）：原文件字节内容是结果文件的**前缀**；仅当原文件无尾换行时先补一个**本文件 EOL** 分隔符（该分隔符不计入「既有内容」）。
- **插到附注之前**（卡片）：**既有各行文本不变**（含 frontmatter 的既有行）+ 既有各分节字节序列不变 + 既有附注字节不变（插入点之后的既有字节整体后移，内容不变）。
- **EOL 与 BOM**：读取时探测 `\r\n` vs `\n` 与 BOM；写入 MUST 保持同一 EOL 风格、BOM 原样（MUST NOT 丢失、MUST NOT 新增）。
- **frontmatter**：只做**值级最小文本修补**——**既有行文本不变**；仅允许 ① 对既有键改值、② 按固定格式**追加**缺失键到既有行之后；MUST NOT 重排既有行、MUST NOT 整体重序列化（键序、引号形态、缩进、注释与未知键一律不变）。

本口径与 `iteration-1-contracts §4` 逐字同义；本 change 与契约文档中 MUST NOT 再出现「frontmatter 原始文本不变」这一与「补键」互斥的表述。

#### Scenario: CRLF 文档

- **WHEN** 目标文档为 CRLF 行尾
- **THEN** 写入后仍为 CRLF（新插入行亦用 CRLF），不出现混排

#### Scenario: BOM 文档

- **WHEN** 目标文档带 UTF-8 BOM
- **THEN** 写入后 BOM 仍在文件首部（且仅一个）

#### Scenario: 无尾换行文档

- **WHEN** 目标文档最后一行无换行符
- **THEN** 先补一个本文件 EOL 再插入/追加；该分隔符不计入「既有内容」，前缀断言按「原字节 + 该分隔符」计算

#### Scenario: frontmatter 既有行不变 + 新增键追加

- **WHEN** 现有 frontmatter 键序为 `name, code, subjective`，写入需追加缺失键 `tradeDate`
- **THEN** 既有三行文本逐字节不变，`tradeDate` 按固定格式（`tradeDate: "YYYY-MM-DD"`）追加在这三行之后；MUST NOT 输出重排后的 YAML、MUST NOT 改写既有引号形态

### Requirement: 可复用写入接口契约（契约 §3）

本 change SHALL 导出可复用写入接口，change 5（`daily-summary`）MUST 复用它而不得另写追加逻辑。模块路径 `src/review/store.ts`，导出签名即契约（MUST 与 `iteration-1-contracts §3` 逐字一致）：

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

**最小类型（与 `§3` 同源，change 5 复用）**：

```ts
type Card   = { anchor: string; writtenAt: string; body: string; heading?: string; clientRequestId?: string }
type AInote = { anchor: string; body: string; generatedAt?: string; tradeDate?: string; code?: string; meta?: Record<string, string> }
```

change 5 的 `cards` 元素 `{anchor, writtenAt, body}` 是本 `Card` 的子集，两边 MUST NOT 各自定义不同形状（change 5 的 `review_read_daily` 即 `parseDoc` 的卡片集合、排除 `^ainote-`）。

**写前归属硬校验（`§3`）**：`appendCard` / `appendAinote` MUST 校验「目标文档 frontmatter 的 `tradeDate` + `code`」== 入参 `loc`；不一致 → 抛**显式错误 `DOC_MISMATCH`**（错误体含两侧 `code` 与 `tradeDate`），MUST NOT 追加、MUST NOT 静默改用其它文档（多命中选一不得被当作「换一份文档写」）。

service key：`traderKit.review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets}`；工具出口 `review_daily_scan` / `review_read_daily` / `review_append_ainote`（change 5）与 `appendAinote` **同一实现**（不得第二份追加逻辑）。幂等键：附注 = `(tradeDate, code)` + 前缀扫描；卡片 = `clientRequestId`。

#### Scenario: change 5 复用同一实现

- **WHEN** change 5 的 `review_append_ainote` 写入附注
- **THEN** 调用路径为 `traderKit.review.appendAinote`（或同签名的 `src/review/store.ts` 导出），不存在第二份追加/原子写实现（结构断言：全仓仅一处 rename 覆盖写）

#### Scenario: 签名可被独立调用

- **WHEN** 以本契约中的签名直接调用 `appendCard` / `appendAinote`
- **THEN** 行为与本 spec 的插入位置、字节口径、并发纪律一致（同一实现的契约测试）

#### Scenario: 五个导出均返回 warnings

- **WHEN** 调用五个导出中的任意一个（含无告警路径）
- **THEN** 返回值均含 `warnings: string[]`（无告警时为空数组，MUST NOT 缺字段）；字符串元素符合「`warnings` 的呈现契约」的编码格式

#### Scenario: 写前归属不一致

- **WHEN** `loc` 为 `{code:'600000', tradeDate:'2026-09-24'}` 而目标文档 frontmatter 为 `code: '000001'`（或 `tradeDate: '2026-09-23'`）
- **THEN** 抛出显式 `DOC_MISMATCH`（含两侧 code/tradeDate），文档字节不变；MUST NOT 写入、MUST NOT 改用其它候选文档

### Requirement: 时间格式化单点 `src/review/format.ts`（契约 §3）

本 change SHALL 提供时间格式化**唯一实现** `src/review/format.ts`（`iteration-1-contracts §3`/§11），导出：

```ts
formatZonedIso(date: Date): string    // 'YYYY-MM-DDTHH:mm:ss+08:00'（本地偏移固定 +08:00）
formatAnchorTime(date: Date): string  // 'HHmm'（锚点时间段；分节标题 HH:mm 与之同源）
```

- 卡片的 `writtenAt` 与（change 5 的）附注 `generatedAt` MUST 共用 `formatZonedIso`；锚点 `-<HHmm>` 与分节标题的 `HH:mm` MUST 共用 `formatAnchorTime`。
- change 5 MUST 引用本导出（`generatedAt` 与 `writtenAt` 同源），MUST NOT 自写 ISO 格式化；结构断言 = 全仓仅一处 `+08:00` 偏移拼装。
- 本模块只接受 `Date`；`YYYY-MM-DD ⇄ YYYYMMDD` 的换算 MUST 经 change 2 的 `src/data/date.ts`（`iteration-1-contracts §1`/§3），MUST NOT 在本模块或调用处自行拼接/截断日期串。

#### Scenario: writtenAt 与 generatedAt 同源

- **WHEN** change 4 写卡片 `writtenAt`、change 5 写附注 `generatedAt`
- **THEN** 二者均调用 `formatZonedIso`（同一导出），输出匹配 `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$`；全仓无第二份 ISO 格式化实现

#### Scenario: 锚点时间与标题同源

- **WHEN** 写卡片锚点 `^card-<YYYYMMDD>-<代码>-<HHmm>` 与分节标题 `## HH:mm`
- **THEN** 两者的时间部分来自同一 `formatAnchorTime` 结果（`HHmm` 与 `HH:mm` 一致），MUST NOT 各取一次时钟

### Requirement: 并发写纪律（契约 §5）

页面写入、附注写入与工具出口 SHALL 共用同一并发纪律：① **进程内**：按**绝对路径**的异步互斥（`Map<absPath, Promise>` 串行链）；② **跨进程**：写前 `stat`（`mtimeMs` + `size`）与读取快照比对，不一致则重读重试；③ **重试**上限 3 次，退避 **50 / 200 / 800 ms**，`EBUSY`/`EPERM`/`EACCES` 视为可重试，单次写入总超时 5 s；④ 冲突不可解 SHALL 返回**显式错误 `CONCURRENT_WRITE`**（含路径与处置建议），MUST NOT 静默覆盖。

#### Scenario: 页面写入与附注写入并发

- **WHEN** 页面提交卡片与 change 5 写入附注几乎同时发生
- **THEN** 两次写入**均保留**（无覆盖）；文档最终同时含新卡片与附注，且卡片在附注之前、既有字节不变

#### Scenario: 外部编辑导致快照不一致

- **WHEN** 写前 `stat` 与读取快照不一致（Obsidian/OneDrive 期间改动）
- **THEN** 重读后重试写入；外部内容保留，最终写入成功或返回显式错误

#### Scenario: 冲突不可解

- **WHEN** 重试 3 次后冲突仍存在
- **THEN** 返回 `CONCURRENT_WRITE`（含路径与建议），MUST NOT 静默覆盖或产生半截文档

### Requirement: 多命中文档的确定性选择

同一 `(code, tradeDate)` 命中多份文档时，选择 SHALL 确定：**取 `mtime` 最新；平局按文件名字典序（code unit 序）**。选择结果与其它候选 SHALL 通过 `warnings: string[]` 返回（含被选路径与其它候选路径），MUST NOT 静默任选、MUST NOT 自动合并或删除候选文档。

#### Scenario: mtime 最新优先

- **WHEN** 命中两份文档，其中一份 mtime 更新
- **THEN** 写入 mtime 最新的文档；`warnings` 含两条路径

#### Scenario: mtime 平局

- **WHEN** 两份文档 mtime 完全相同
- **THEN** 按文件名字典序取一（结果稳定可复现），另一份字节不变

#### Scenario: 多命中时另一份成为孤儿但不改动

- **WHEN** 多命中且页面写入成功
- **THEN** 未被选中的文档字节不变（不删除、不合并），告警由页面显式展示

### Requirement: 交易日归属

`tradeDate` SHALL 取自数据源的业务日期，MUST NOT 以系统日期作为归属依据。业务日期的获取 SHALL 封装为可替换来源（seam），其默认实现 MUST 调用 change 2 的 `traderKit.data.resolveTradeDate({ date? })`（`iteration-1-contracts §1`），MUST NOT 自行实现日期推断。seam SHALL 返回结构化结果：

```ts
{ value: string | null; source: 'T1-tradeDate' | 'TQ-HqDate' | 'user-confirm';
  isTradingDay: true | null; confidence: 'high' | 'low'; marketSuffix?: '.SH' | '.SZ' | '.BJ' }
```

`value === null` **或** `isTradingDay === null` 时，SHALL 在提交前给出归属确认，MUST NOT 静默归属或按系统日期归属；**默认值分路径**：`isTradingDay === null` 且 `value !== null` → 默认 = `value`（最近已知业务日）；`value === null` → **默认留空**并 MUST 要求用户显式填入（可预填 `requestedDate` 但标注「待确认」，MUST NOT 当作归属）。无交易日历时 MUST NOT 用系统日期推断「非交易日」。

#### Scenario: 业务日期可得且为交易日

- **WHEN** seam 返回 `value` 且 `isTradingDay === true`（`value` == 限流日）
- **THEN** 提交直接归属该日期，页面显示归属结果与来源/置信度

#### Scenario: 来源不可得（`value === null`）

- **WHEN** seam 返回 `value === null`（数据源不可达，`businessDate=null`）
- **THEN** 提交前出现归属确认，**默认值为空**且 MUST 要求用户显式填入（可预填 `requestedDate` 并标注「待确认」，MUST NOT 当作归属）；用户确认前 MUST NOT 落盘

#### Scenario: 有业务日但非交易日（`isTradingDay === null`）

- **WHEN** seam 返回 `value='2026-09-25'` 且 `isTradingDay === null`
- **THEN** 归属确认的**默认值 = `value`**（该业务日）；用户确认前 MUST NOT 落盘

#### Scenario: 周末

- **WHEN** 系统日期为周六，seam 返回 `value` 且 `isTradingDay === null`
- **THEN** 出现归属确认提示（默认 = `value`），用户确认前 MUST NOT 落盘

#### Scenario: 长假第 N 天

- **WHEN** 系统日期处于长假第 3 天，seam 返回 `isTradingDay === null`
- **THEN** 出现归属确认提示；MUST NOT 静默归到上一交易日（长假中静默错归属为明确禁止项）

#### Scenario: 盘前

- **WHEN** 交易日 09:00（盘前）提交，seam 返回 `isTradingDay === null`
- **THEN** 出现归属确认提示（`value` 可得时默认 = `value`；`value` 不可得时默认留空并 MUST 要求用户显式填入），不静默落盘

#### Scenario: 隔日补写

- **WHEN** 用户在次日补写卡片并确认归属为前一业务日
- **THEN** 落盘到前一业务日文档（文件名日期段、frontmatter `tradeDate`、锚点日期段三者一致）

#### Scenario: 系统日期与业务日期不一致

- **WHEN** 系统日期与数据源业务日期不同
- **THEN** 归属以业务日期为准，页面标注来源

#### Scenario: seam 结果足以承载 D-TQ 选项 B

- **WHEN** owner 裁决为选项 B（TQ `HqDate` / `get_match_stkinfo`）
- **THEN** 仅替换 seam 实现即可：返回值含 `source` / `confidence` / `marketSuffix`，页面与存储层零改动（契约测试断言返回值形状）

### Requirement: 卡片回显与引用

B4 SHALL 解析当日文档的卡片分节并按时间倒序渲染；每张卡片 SHALL 提供复制 block 引用（`[[文件名#^card-id]]`）的能力。解析 SHALL 忽略 AI 附注分节（锚点前缀 `^ainote-`），MUST NOT 将附注当作卡片展示。

#### Scenario: 时间倒序渲染

- **WHEN** 当日文档含多张卡片
- **THEN** 页面按时间倒序渲染，最新在前

#### Scenario: 引用可跳转

- **WHEN** 复制某卡片的 block 引用
- **THEN** 得到形如 `[[600000_浦发银行_20260924#^card-20260924-600000-1432]]` 的文本，在 Obsidian 中可跳转

#### Scenario: 附注不计入卡片

- **WHEN** 文档末尾存在 `^ainote-` 分节（由 change 5 写入）
- **THEN** 该分节不出现在卡片列表（仍可只读展示于页面其它位置或不展示，但 MUST NOT 计为用户卡片）

### Requirement: 提交幂等（clientRequestId）

`appendCard` 的调用方（`POST /api/card`）SHALL 传入 `clientRequestId`；写入实现 SHALL 按「**文档 + 该 id**」去重，命中时返回 `status: 'duplicate'` + **既有锚点**与路径，MUST NOT 追加第二张卡片。去重登记 SHALL 落在文档内（分节内 `- clientRequestId: <id>` 元信息行，可扫描、可解析），MUST NOT 引入插件侧状态文件。

#### Scenario: 同 id 重复提交

- **WHEN** 同一 `clientRequestId` 第二次提交同一文档
- **THEN** 返回 `duplicate` 与既有锚点/路径，文档字节不变（可用对比断言）

#### Scenario: 不同 id 正常追加

- **WHEN** 两个不同 `clientRequestId` 先后提交
- **THEN** 追加两张卡片，锚点唯一

#### Scenario: 缺 id

- **WHEN** 调用未提供 `clientRequestId`
- **THEN** 写入接口返回显式错误（400），不落盘（页面层必填，见 `review-page` 的「写入接口入参校验与幂等」）

### Requirement: `warnings` 的呈现契约

本 change 的告警字段名**一律为 `warnings: string[]`**（`iteration-1-contracts §3`/§12.7；契约条目名沿用历史措辞，字段名以 `§3` 为准）——store 层导出、`/api/local` 响应与写入响应同名字段，MUST NOT 出现 `storeWarnings[]` 别名（change 5 已明文否定该字段名）。

存储层产生的告警（多命中、幽灵锚点、重复锚点、`nameTruncated`）SHALL 经五个导出的 `warnings: string[]`（`§3`：**一律**返回）上抛到 `/api/local` 或写入响应，由页面显式展示；MUST NOT 只记日志或静默吞掉。写前归属不一致属**抛错路径**（显式错误 `DOC_MISMATCH`），MUST NOT 走 `warnings`（该路径不返回结果体，故 `kind` 枚举 MUST NOT 含 `docMismatch`）。

告警的内部结构 SHALL 为：

```ts
type StoreWarningKind = 'multiHit' | 'ghostAnchor' | 'duplicateAnchor' | 'nameTruncated'
type StoreWarning = { kind: StoreWarningKind; path: string; detail: string; candidates?: string[] }
```

对外 `warnings: string[]` 元素 SHALL 由**唯一编码函数**产出，格式为 `` `[<kind>] <path> — <detail>` ``（有候选时追加 `；候选: <a>, <b>`）——即字符串元素 MUST 同时携带类型、路径与原因，页面可直接展示、测试可解析回 `kind`；MUST NOT 出现无 `kind` 前缀的自由文本。

`nameTruncated` 是**写时**事实（由 change 2 唯一净化实现产生）：SHALL 经 `locateDoc` / `appendCard` 的**写入响应** `warnings` 上报并在页面（首次建文档/提交响应）展示；`/api/local`（读时）MUST NOT 被要求重算该告警。该标志的产生信号由 change 2 的 `sanitizeNameSegment` / `resolveArea` 返回值承载——**跨 change 回写项**：change 2 `data-root-layout` spec 仅写「截断并记 `nameTruncated`」，MUST 补明该标志的返回形状（见 tasks 1.7 的回写登记）；**change 2 未暴露该信号期间，`warnings` 不含 `nameTruncated` 项**（本 change MUST NOT 自行重算净化规则）。

#### Scenario: 告警透传到页面

- **WHEN** 任一类告警产生
- **THEN** 相应响应含 `warnings[]`，元素匹配 `^\[(multiHit|ghostAnchor|duplicateAnchor|nameTruncated)\] `，页面在 B4 上方（或提交响应处）显式展示；卡片列表本身不含被判定为幽灵/重复的条目

#### Scenario: 空告警仍返回字段

- **WHEN** 本次调用无任何告警
- **THEN** `warnings` 仍为字段存在且为 `[]`（MUST NOT 省略字段）

#### Scenario: 写前归属不一致不走 warnings

- **WHEN** `appendCard` / `appendAinote` 命中写前归属不一致
- **THEN** 抛显式错误 `DOC_MISMATCH`（错误体含两侧 code/tradeDate），无结果体、无 `warnings`；`StoreWarningKind` 中不存在 `docMismatch` 这一不可达类型

#### Scenario: nameTruncated 由写入响应承载

- **WHEN** 首次建文档时名称被截断至 40 字符，且 change 2 的净化实现已暴露该标志
- **THEN** 写入响应（与页面）出现 `nameTruncated` 告警；该事实 MUST NOT 依赖读路径重新计算

#### Scenario: change 2 未暴露 nameTruncated 信号时

- **WHEN** change 2 的净化实现尚未暴露 `nameTruncated` 标志
- **THEN** `warnings` 不含 `nameTruncated` 项，页面展示与写入均正常；本 change MUST NOT 自行重算净化结果、MUST NOT 在读路径推断截断事实

### Requirement: 渲染安全与格式边界

页面 SHALL 以纯文本方式渲染卡片正文与所有来自文件/接口的文本（转义 HTML），MUST NOT 执行其中的 HTML 或脚本。落盘产物 SHALL 为 Obsidian md（人类可读、可检索），MUST NOT 引入私有格式或伴生二进制。

#### Scenario: 正文含 HTML/脚本

- **WHEN** 卡片正文包含 `<script>` 或原始 HTML
- **THEN** 页面显示为纯文本且不执行；文件内容原样保留

#### Scenario: 产物为 md

- **WHEN** 审查落盘产物
- **THEN** 仅 `.md` 文件（无私有索引/二进制伴生文件）；Obsidian 可读可检索，block 引用可跳转

### Requirement: 写盘失败可重试

写盘失败 SHALL 返回显式错误（含原因与目标路径）；页面 SHALL 保留输入内容并允许重试；MUST NOT 静默丢弃或部分写入。

#### Scenario: 文件被占用导致失败

- **WHEN** 目标文件被占用（如 OneDrive 正在同步）导致写入失败
- **THEN** 返回显式错误；重试后成功落盘，内容与输入一致
