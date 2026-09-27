## ADDED Requirements

### Requirement: 数据根可配置与相对解析

插件 SHALL 提供 `dataRoot` 配置项作为全部业务产物的解析基准；范式内一切路径 MUST 相对 `dataRoot` 解析，MUST NOT 在代码中硬编码绝对路径。`dataRoot` 的 schema SHALL 带默认空值（`default('')`）以保证插件**挂载期可用**，校验不得在挂载前失败；`dataRoot` 为空时，任何写入操作 SHALL 在**调用期**显式失败并给出配置指引，MUST NOT 回退到系统临时目录、当前工作目录或用户主目录。

#### Scenario: 已配置数据根

- **WHEN** `dataRoot=X` 且请求写入复盘卡片
- **THEN** 落点解析为 `X` 下的范式路径（见业务区映射），实际写入位置与解析结果一致

#### Scenario: 未配置数据根仍可挂载（写入期报错）

- **WHEN** `dataRoot` 为空（未配置或显式空串）时插件挂载
- **THEN** 挂载成功、工具与 service 出口注册成功；任意写入调用返回显式错误（含配置项名与配置位置指引），磁盘上无任何新增文件（用例名：`未配置 dataRoot → 挂载成功且写入报错`）

#### Scenario: 路径越界防护

- **WHEN** 请求的相对路径包含 `..` 或为绝对路径
- **THEN** 拒绝并显式报错，不进行任何文件操作

#### Scenario: 由外部数据拼出的路径段同样受防护

- **WHEN** 路径的某个路径段来自外部数据（如 S8 `stock_chi_name`、脚本抓取名、用户传入名称）并包含 `..`、`/`、`\`、控制字符或为绝对路径
- **THEN** 该段 MUST 经 §「文件名模板与参数白名单」净化/校验后才参与拼接；净化后仍越界时拒绝并显式报错（MUST NOT 让外部数据把写入引出业务区）

### Requirement: 业务区映射（两级：区域目录 + 文件名模板）

插件 SHALL 由**单一映射表**提供业务区路径解析，映射为**两级**：① **区域目录**（相对 `dataRoot` 的目录）② **文件名模板**（仅对「需要文件名的业务区」定义）。映射以既有 vault 目录体系为蓝本、MUST NOT 新造目录名（`DB/review/` 为唯一新增）。模板归属本文件（`data-root-layout` 为唯一事实源，`iteration-1-contracts §6`），其它 change（含 change 4 的 `review-card-store`）MUST 引用本表，MUST NOT 各自定义第二份文件名模板。

| 业务 | 区域目录 | 文件名模板 | 状态 |
| --- | --- | --- | --- |
| 复盘卡片 | `DB/review/<YYYYMM>/` | `<代码>_<名称>_<YYYYMMDD>.md` | 唯一新增 |
| 数据工具缓存产物 | `agent/DB/temp/dsh-trader-kit/<YYYYMMDD>/` | （由缓存层按模块与键生成，见 `data-tool-contract`） | 新增子目录（父区既有） |
| 自产业务 skill | `agent/skills/` | （不定义） | 既有区 |
| 宏观 AI 辅助分析（预留） | `题材调研/00宏观/` | （不定义，仅登记） | 既有区；本迭代仅登记、不解析 |
| 白板思维导图（预留） | 跟随业务归属（先例：`交易系统/平常心/方法论/`） | （不定义） | 既有先例 |
| 模式与模式↔案例映射（预留） | `交易系统/平常心/方法论/模式/` | （不定义） | 既有区，对接随 Q4 |

调用方 MUST NOT 自行拼接业务区路径；未定义业务区时 SHALL 显式报错。需求文档中 `<数据根>/review/…`（复盘卡片MVP R4）与 `DB/review/…`（盘面数据组件 P2）两种表述统一为本表口径——二者指向同一实例，业务区路径以本表为唯一事实源。

#### Scenario: 复盘卡片路径解析

- **WHEN** 请求 `2026-09-24`（canonical 入参，先经 `toCompactDate` 折算为目录段 `20260924`）的 `600000 浦发银行` 卡片路径
- **THEN** 返回 `<dataRoot>/DB/review/202609/600000_浦发银行_20260924.md`（`600000_浦发银行_20260924.md` 即本表文件名模板的渲染结果，模板只有一个来源；模板参数的紧凑写法是 `YYYYMMDD` 允许出现的位置之一）

#### Scenario: 缓存路径解析

- **WHEN** 请求 `limit-reason` 模块在 `requestedDate='2026-09-24'` 的缓存路径（目录段折算为 `20260924`）
- **THEN** 返回 `<dataRoot>/agent/DB/temp/dsh-trader-kit/20260924/` 下的对应文件路径；目录段 MUST 由 `requestedDate`（而非响应内的 `businessDate`）折算（`data-tool-contract` 缓存 Requirement）

#### Scenario: 未定义业务区

- **WHEN** 请求映射表中不存在的业务区名
- **THEN** 显式报错（列出已定义业务区），不猜测路径

#### Scenario: 宏观预留区不解析

- **WHEN** 调用方请求宏观预留区路径
- **THEN** 解析返回既有 `题材调研/00宏观/`（非裸根 `题材调研/`，MUST NOT 新造 `题材调研/宏观*/` 之类目录名）；本 change 该区**仅登记**，故解析函数对「未登记的写入用业务区」SHALL 显式报错（「预留区仅登记、未开放解析」），返回路径本身不构成可写许可

### Requirement: 文件名模板与参数白名单

`resolveArea` SHALL 对模板参数做白名单校验（`iteration-1-contracts §6`），校验不通过 SHALL 显式报错且不进行任何文件操作：

| 参数 | 白名单规则 |
| --- | --- |
| `code` | `^\d{6}$` |
| `date` | `^\d{8}$`（紧凑目录段；调用侧的日期入参为 canonical `YYYY-MM-DD`，`YYYY-MM-DD` → `YYYYMMDD` 的折算 MUST 经 `src/data/date.ts` 的 `toCompactDate`，`resolveArea` MUST NOT 自行 `replace`/`slice`，见 `iteration-1-contracts §1`） |
| `name` | 经 `sanitizeNameSegment(name)`（见下） |

`sanitizeNameSegment(name)` SHALL：NFC 归一；`[\\/:*?"<>|\x00-\x1f]` → `_`；去首尾空格与点号；Windows 保留名（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`）加 `_` 后缀；长度上限 40 字符（超限截断并记 `nameTruncated`）；结果为空 → 用代码段充当名称段。净化后 MUST NOT 改变既有文件名（对已存在文件的同一入参必须渲染出同一文件名）。

#### Scenario: 注入用例被净化

- **WHEN** `name` 取 `../../etc`、`a/b`、`CON`、空串 分别请求卡片路径
- **THEN** 渲染结果的名称段分别为 `.._.._etc`（分隔符与点号处理后）一类不含路径分隔符的段、`a_b`、`CON_`、代码段；四次调用均不越出 `DB/review/` 业务区

#### Scenario: 参数白名单拒绝

- **WHEN** `code='60000'`（5 位）或 `date='2026-09-24'`（canonical 写法直接传给需要紧凑目录段的 `resolveArea`）
- **THEN** 显式报错（指出非法参数与「日期折算须经 `src/data/date.ts`」的指引），不进行任何文件操作；调用方应先 `toCompactDate` 再传入

#### Scenario: 名称超长与保留名

- **WHEN** `name` 超过 40 字符或命中 Windows 保留名
- **THEN** 截断到 40 字符并记 `nameTruncated`、保留名加 `_` 后缀；返回的路径仍可通过越界校验

#### Scenario: 净化不改变既有文件名

- **WHEN** 同一 `(code, date, name)` 在净化规则生效前后请求路径
- **THEN** 渲染出的文件名一致（MUST NOT 因新增净化规则改名既有产物的落点）

### Requirement: 目录自动创建

首次写入时插件 SHALL 自动创建缺失目录（含全部父级）；既有目录 SHALL 直接使用，MUST NOT 重建、清空、迁移或改动其中任何既有文件；创建失败 SHALL 显式报错（含失败路径与原因），MUST NOT 静默改用其它路径。

#### Scenario: 缺失目录首次写入

- **WHEN** `<dataRoot>/DB/review/202609/` 尚不存在（当前 vault 实测不存在 `DB/review`）
- **THEN** 首次落盘前创建该目录链，卡片写入成功

#### Scenario: 既有目录不被改动

- **WHEN** 目标目录已存在且含既有文件（如 `agent/DB/temp/` 下其它 skill 的产物）
- **THEN** 创建逻辑不删除、不改写、不移动其中任何文件

#### Scenario: 创建失败

- **WHEN** 目录创建因权限或路径非法失败
- **THEN** 返回显式错误（路径 + 原因），磁盘上无部分产物

### Requirement: 数据根迁移显式后置

数据根变更时插件 SHALL NOT 自动迁移、复制、移动或删除历史数据；SHALL 仅按新 `dataRoot` 解析新产物；健康检查 SHALL 在检测到历史数据不在当前数据根时给出非阻断提示。迁移策略按 M1-Q6 后置。**本 change 只登记该要求**（检测与提示的实现随 change 4 首次写盘一并落地）；登记口径即实现契约，落地前 MUST NOT 声称已实现。

#### Scenario: 变更数据根后启动

- **WHEN** `dataRoot` 由 A 改为 B 后插件挂载
- **THEN** 新写入落在 B；A 下文件零改动；健康检查给出提示且不阻断挂载
