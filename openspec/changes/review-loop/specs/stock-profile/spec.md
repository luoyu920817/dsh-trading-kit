## ADDED Requirements

> owner 裁决（2026-10-06，含两处修订）：
> ① **标的相关上下文一律复用 `DB/stock` 下对应的标的档案**（既有目录），**MUST NOT** 新造目录（原方案
> `prompt/关联标的/` 作废）；
> ② **新增键 `角色` 作为给 agent 的提示词重点内容**（键名由 owner 2026-10-06 定名：不叫「提示词」而叫「角色」——值形如 `万科A → 中军`、`上证指数 → 情绪主锚`、`微盘股 → 情绪周期`）；既有 `热点标签` 只用于保存与展示、**不进 agent 上下文**；
> ③ **全部标的都应在 `DB/stock` 有档案**——以**懒加载**方式实现：在**首次写该标的的复盘卡片时异步创建**。
>
> 实况（2026-10-06 实测 766 份）：frontmatter 三种变体并存，主变体为 `板块/当前题材/题材地位/热点标签`（516 份），
> 另有 `板块/概念/标的特性`（164）、`板块/当前题材/题材地位`（79）；`# 股性` 小节普遍存在（多数空，部分含
> `INPUT[inlineList:热点标签]`）；**无任何档案填写 `代码`**；8 个锚点档案（999999 / 510300 / 000688 / 880003 /
> 880008 / 000852 / 880823 / 880863）均不存在。标签在通达信 `mark.dat [TIPWORD]` 另有一份——本 change
> **不读 TDX 本地文件**（不读 `mark.dat` / `blocknew` / `tdxdb`）。

### Requirement: 档案读取（复用 DB/stock）

工作流 SHALL 以 `<数据根>/DB/stock/<名称>.md`（既有目录）为标的上下文的**唯一来源**；该目录 SHALL 登记进 change 2 `src/paths/mapping.ts` 的区域表（新增区域 key `stock`：`dir: 'DB/stock'`，无文件名模板，`status: 'active'` 且注记「owner 维护 + 懒创建建档、内容只读」），路径解析 MUST 经 `resolveArea`。

**定位规则（按序）**：① 由当日处理清单的 `code` + `name`（`scanDailyCardTargets` 返回，缺省回落文件名名称段）直配 `<名称>.md`；② 直配未命中且存在档案含 `代码` 时，经目录索引（`代码` → 路径）兜底；③ 两者皆未命中 → **未命中**（不入结果、不是错误、不产出占位；若该标的当日有卡片，懒加载建档会使其下次运行即命中）。命中后若档案 `代码` 与目标 `code` 不一致 → SHALL 记 `warnings`（含相对路径与两个值）并**不注入**该档案（宁缺勿错）。一代码多档案（异常数据）→ 记 `warnings` 并取修改时间最新者（同时间取文件名字典序首个），沿既有 `scanDailyCardTargets` 的多命中确定性口径。

#### Scenario: 名称直配命中

- **WHEN** 当日标的 `000002` 名称解析为「万科A」且存在 `DB/stock/万科A.md`
- **THEN** 该档案被读取；产物标注来源路径 `DB/stock/万科A.md`

#### Scenario: 代码索引兜底

- **WHEN** 名称段为空/等于代码（历史卡片未解析出名称）但档案 frontmatter 含 `代码: "000002"`
- **THEN** 经索引命中同一档案并读取

#### Scenario: 未命中与不一致的区分

- **WHEN** 某标的无任何同名档案；另一标的档案 `代码` 与目标不一致
- **THEN** 前者**未命中**（结果无该条、无告警、产物无痕）；后者记 `warnings` 且不注入

### Requirement: 档案字段契约（`角色` 为 agent 重点，其余仅保存与展示）

读取面 SHALL 按下表解析；**键缺省即降级，MUST NOT 视为错误**（宽容解析，不要求 owner 统一三种既有变体）：

| 键 / 小节 | 必需性 | 是否进 agent 上下文 | 用途 | 建议 / 骨架格式 |
| --- | --- | --- | --- | --- |
| `角色` | 建议（本 change **新增键**） | **是（唯一业务内容，作为重点）** | 该标的在盘面里的角色：`万科A → 中军`、`上证指数 → 情绪主锚`、`微盘股 → 情绪周期`、`昨日涨停 → 赚钱效应`、`沪深300ETF → 国家队` | 值 = **短角色词（首段）+ 可选一句口径**，以 `｜`（全角竖线，亦接受半角 `\|`）分隔：`角色: "中军"` 或 `角色: "情绪周期｜向上有，向下无"`（单行；解析取原文，首段为角色词） |
| `代码` | 锚点必需；普通标的由懒创建写入 | 否（仅标识与校验） | 定位索引兜底 + 一致性校验 | `代码: "880823"`（6 位字符串） |
| `锚点` | 锚点必需 | 否 | 盘面 md 指数段成员判定 | `锚点: true`（仅锚点填写；**懒创建 MUST NOT 猜测此键**） |
| `热点标签` | 可选 | **否（仅保存与展示）** | owner 自用展示标签（题材热点等，保持既有语义） | 既有键，原样保留 |
| `板块` / `当前题材` / `题材地位` / `概念` / `标的特性` | 可选 | 否 | 档案上下文，供人阅读 | 沿用各变体既有键名（解析 MUST 同时接受三种变体） |
| `# 股性` 小节正文 | 可选 | **否（人的记录）** | owner 自述笔记 | 小节内自由文本（`INPUT[...]` 行按普通文本处理） |

**纪律**：① agent 上下文中的标的相关内容**只含** `角色` 原文（外加 `code`/`name`/`path` 作为标识与来源）；`热点标签`、`板块`、`当前题材`、`题材地位`、`# 股性` 等 MUST NOT 进入 agent 上下文（避免噪音与"把展示字段当事实"的风险）；② `角色` 与 `热点标签` 语义与用途完全分离，MUST NOT 互相覆盖或合并；③ 本 change MUST NOT 代写 `角色` 内容（懒创建只留空键，内容由 owner 填写）。

#### Scenario: 角色值形态（首段角色词 + 可选口径）

- **WHEN** 读取 `角色: "情绪周期｜向上有，向下无"` 与 `角色: "中军"` 两份档案
- **THEN** 两者均正常注入；前者首段「情绪周期」为角色词、其余为口径补充；后者整值为角色词；解析 MUST NOT 因缺分隔符报错或截断

#### Scenario: 角色注入、展示字段不注入

- **WHEN** 某档案同时含 `角色`、`热点标签: [算力, 液冷]`、`当前题材: 算力`、`# 股性` 长文
- **THEN** agent 上下文中只出现 `角色` 原文（与标识/来源）；`热点标签`/`当前题材`/`# 股性` 不出现在上下文与产物正文中

#### Scenario: 字段缺失的降级矩阵

- **WHEN** 分别读取「仅 `板块` 的空壳档案」「有 `角色` 无其它键」「有 `热点标签` 无 `角色`」三类档案
- **THEN** 三者均正常命中、无告警；注入内容分别为：无（不被注入为空标注）、角色原文、无（该标的不注入业务内容）

#### Scenario: 变体共存

- **WHEN** 目录内同时存在三种 frontmatter 变体的档案
- **THEN** 解析逐份成功（缺键不报错）；owner 无需为兼容统一键名

### Requirement: 懒加载建档（首次写卡触发，异步）

当一次**卡片写入**成功且目标 `code` 在 `DB/stock/` 尚无档案时，插件 SHALL 尝试**创建一份骨架档案**（幂等：档案存在即跳过，不读后覆写）。触发时机 = 卡片写入路径（`POST <basePath>/review/api/card` 的成功分支）；已有档案的标的永不重复创建。

**命名**：`<名称>.md`——名称取该次写入所用名称（沿既有名称分层与 change 2 `src/paths/sanitize.ts` 的 `sanitizeNameSegment` 净化）；名称为空或退化为代码段时 **MUST NOT 建档**（记 `warnings`，原因 `nameUnavailable`），待名称可得后的下次写卡再建（MUST NOT 用 `<代码>.md` 替代，MUST NOT 事后改名）。

**骨架**（按主变体，516/766）：

```markdown
---
代码: "<code>"
板块: 
当前题材: 
题材地位: 
热点标签:
角色: 
---

# 股性



# 记录

![[stock-info.components]]
```

**硬约束（MUST）**：① **create-only**——以排他创建（`wx`）写入，目标路径已存在（无论内容）即放弃，MUST NOT 覆写、MUST NOT 截断、MUST NOT 改名、MUST NOT 删除；② 原子写（同目录临时文件 + `rename` 不可用于已存在目标 → 以 `wx` 直写空骨架，写入内容为一次性完整字节，失败清理半截文件）；③ **异步解耦**——建档 MUST NOT 影响卡片写入的成败、返回内容与用户可感延迟；失败只记 `warnings` + 日志，至多尝试一次（MUST NOT 重试暴走）；实现 SHALL 提供可注入的完成等待 seam，供测试断言"建档已完成 / 已跳过"；④ **不猜测**——骨架 MUST NOT 写入 `锚点` 或 `角色` 的取值（留空），MUST NOT 依据代码/名称推断角色或标签；⑤ 目标文件已存在但 `代码` 与本次目标不一致 → 记 `warnings` 并放弃（不修改、不新建第二份）。

#### Scenario: 首次写卡即建档

- **WHEN** 标的 `603919` 首次写入复盘卡片（`DB/review/` 无该代码文档、`DB/stock/金徽酒.md` 不存在）
- **THEN** 卡片写入照常成功返回；随后 `DB/stock/金徽酒.md` 出现，frontmatter 含 `代码: "603919"` 与空的 `角色`，正文含 `# 股性`、`# 记录` 与组件嵌入行；§重复写卡不再触发建档

#### Scenario: 已有档案零改动

- **WHEN** `DB/stock/万科A.md` 已存在（owner 已填写内容）且又有该标的的卡片写入
- **THEN** 档案字节与 mtime **完全不变**（MUST NOT 读取后回写、MUST NOT 补键）

#### Scenario: 名称为空不建档

- **WHEN** 卡片写入时名称层仅得代码（`name === code`）
- **THEN** 不创建 `<代码>.md`；记 `warnings`（`nameUnavailable`）；卡片写入结果不受影响；名称可得后的下次写卡再建

#### Scenario: 建档失败不阻塞写卡

- **WHEN** 建档过程失败（目录只读 / 并发已存在 / `wx` 冲突）
- **THEN** 卡片写入仍成功（状态与内容不变），失败经 `warnings` 与日志显式可见；MUST NOT 重试第二次

#### Scenario: 同名冲突不覆盖

- **WHEN** 目标 `<名称>.md` 已存在但其 `代码` 与本次目标不同
- **THEN** 记 `warnings`（含路径与两个代码）并放弃建档；MUST NOT 修改该文件、MUST NOT 另建第二份

### Requirement: 写分区与安全边界（`DB/stock` 新增只建不改区）

`DB/stock/` SHALL 登记为本插件的**第 4 条写路径**（性质 = **只建不改**：仅允许 create-only 建档，MUST NOT 修改/删除/重命名既有档案），并 SHALL 同步登记 `AGENTS.md` 的 vault 写入条目与 `vault-integration` 写分区契约（沿既有两条路径的登记方式）。运行期写白名单面（`src/skill/root.ts` 的 `dataRootWhitelistPaths`，用于 skill 安装落点校验）**MUST NOT 变更**——`DB/stock` 不进该清单（避免放宽 skill 安装落点）；本 change MUST NOT 引入对 `DB/stock` 的任何删除/改写路径。建档与读取均零出站（纯本机 vault 操作）。

#### Scenario: 写路径审计

- **WHEN** 审查实现与测试
- **THEN** 全仓不存在对 `DB/stock/**` 的写入路径（除建档的 `wx` 创建外）、不存在删除/重命名调用；`dataRootWhitelistPaths` 仍为三条；`AGENTS.md` 与 `vault-integration` 已登记该路径

#### Scenario: 不引入 TDX 依赖

- **WHEN** 审查实现与测试
- **THEN** 不存在对 `mark.dat` / `blocknew` / `tdxdb` / `D:\TDX_HOME` 的读写路径；删除 TDX 安装目录不影响任何调用结果

### Requirement: 读取工具与具名接口

插件 SHALL 新增工具 `review_stock_profiles`（service key `traderKit.review.stockProfiles`，工具与 service 同一实现）：

- 入参：`{ codes?: string[], names?: string[] }`——`codes` 给出时按定位规则取（`names` 与之对齐，缺省回落清单名称段）；两者皆空 = 返回目录内全部 `锚点: true` 且含 `代码` 的档案（按 `code` 升序；供盘面 md 指数段）；
- 出参：`{ entries: Array<{code?, name, role?, isAnchor, hotTags?, path}>, warnings: string[] }`（`role` = `角色` 键原文（已 trim）；`hotTags` 仅供面板/展示复用，**不进 agent 上下文**；`path` = 相对数据根路径）；
- 未命中标的**不入结果**；目录缺失 → `entries: []` + `warnings`（`stockDirMissing`），MUST NOT 失败；
- 解析 SHALL 复用 change 4 `src/review/md/frontmatter.ts`（值级解析）与 change 2 `resolveArea`；`代码` 归一复用 `src/review/anchor.ts` 的 `normalizeCode`；MUST NOT 另写第二份 frontmatter 解析或路径拼接；
- 依赖不可用（区域未登记 / 解析导出缺失）SHALL 显式报错 `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），MUST NOT 自实现兜底。

#### Scenario: 按当日清单取档案

- **WHEN** 以当日 3 个标的的 `codes`/`names` 调用
- **THEN** 返回命中档案（含 `prompt` / `path` / `isAnchor`，`hotTags` 如实带出供展示），未命中的标的不出现且不产生告警

#### Scenario: 全锚点清单（盘面 md 用）

- **WHEN** 不传 `codes` 与 `names`
- **THEN** 返回目录内全部 `锚点: true` 且含 `代码` 的档案（按 `code` 升序；`锚点: true` 但缺 `代码` 者记 `warnings` 并排除——指数段需要代码）

#### Scenario: 零出站与只读

- **WHEN** 调用该工具的任一次
- **THEN** 网络 seam 未被调用；`DB/stock` 内文件字节与 mtime 不变（本工具不建档）

### Requirement: 注入语义（生成依据，非事实）

命中档案的标的，其数据包 SHALL 携带 `profile: { role?, path }`（见 `daily-summary` cap 的 `数据包 schema` 修订；`code`/`name` 已在数据包顶层）。agent 生成 AI 附注与盘面 md 时 SHALL 把 `角色` 作为**生成口径/视角的重点内容**使用，并 SHALL 在产物中标注档案来源路径。

约束（MUST）：① 角色 MUST NOT 被当作行情事实（不得据此编造涨跌幅、家数、资金等数据）；② MUST NOT 被复述为用户观点的替身（沿 `daily-summary` 既有「MUST NOT 改写或复述用户主观判断」纪律）；③ 产物 SHALL 标注档案路径（相对数据根形式）以便回溯；④ `角色` 内的角色词（如「情绪主锚」）可原样出现在产物中，MUST NOT 被扩写为建议语义。

#### Scenario: 附注体现角色口径

- **WHEN** 某标的（如 880823 微盘股）当日有卡片且档案 `角色` 为「情绪周期｜日线趋势向上有、向下无…」
- **THEN** 其附注标注档案来源与角色要点（如「档案：DB/stock/微盘股.md」），正文口径与该角色一致，且无任何新增行情数字

#### Scenario: 未命中无痕

- **WHEN** 某标的既无档案也未即时建档（如名称为空）
- **THEN** 数据包不含 `profile` 键、产物无任何档案痕迹；`missing` 与四态判定与有档案时完全一致（档案缺失不是数据缺失、不进 `failed`）

### Requirement: 成员集合维护与边界

"哪些是锚点"完全由 owner 维护（档案 `锚点: true` 即成员；懒创建 MUST NOT 自动标记）；本 change MUST NOT 自动同步通达信板块（`blocknew`）或 `mark.dat`。`DB/stock/` 与 `DB/review/` 互不影响：档案增删 MUST NOT 改变当日 `targets` 清单与卡片数口径；卡片写入 MUST NOT 改变既有档案内容（除"首次建档"这一新增动作外）。

#### Scenario: 锚点集合由 owner 决定

- **WHEN** owner 在某档案加/去 `锚点: true`
- **THEN** 盘面 md 指数段成员随之变化；插件不自行增删成员、不推断角色

#### Scenario: 双向隔离

- **WHEN** 在 `DB/stock/` 内新增/删除档案
- **THEN** 当日 `targets`（代码/名称/卡片数/`hasAinote`）逐项不变；反之，写卡只可能新增档案，不改变既有档案字节
