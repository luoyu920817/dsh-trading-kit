## ADDED Requirements

> owner 裁决（2026-10-06）：**放开「插件直调 TQ-Local（`127.0.0.1:17709`）」——白名单严限**，用于兜底获取
> **标的名称 + 最小基础信息**（D-TQ 的复审触发条件达成：roadmap §5 的 D-TQ 行由「待裁决/默认处置 A」改为
> 「选项 B（局部放开）」）。动机：通达信内置代码（`999999` 上证指数、`880003` 平均股价、`880008` 全A等权、
> `880823` 微盘股、`880863` 昨日涨停、`880005` 涨跌家数 等）在公开源（T2/S8/行情名称源）中不存在，
> 页面只能显示「名称未获取」（owner 实机截图 2026-10-06）。
>
> **实测证据（2026-10-06 实机，TdxW 在跑）**：`POST http://127.0.0.1:17709/` 的
> `{"method":"get_stock_info","params":{"stock_code":"<code>.SH","field_list":["Name","HSStockKind","J_start"]}}`
> 对全部相关代码返回 `ErrorId="0"`：`999999.SH→上证指数`、`880823.SH→微盘股`、`880863.SH→昨日涨停`、
> `880003.SH→平均股价`、`880008.SH→全Ａ等权`（**全角 Ａ**，原样保留）、`000852.SH→中证1000`、
> `000688.SH→科创50`、`510300.SH→沪深300ETF华泰柏瑞`、`880005.SH→涨跌家数`；对照 `000001.SZ→平安银行`。
> 注意：TQ 官方名与 TDX 报价表短名可能不同（如 510300），页面按原样显示、不做二次加工。

### Requirement: 出口与依赖归属

插件 SHALL 新增**唯一**的 TQ-Local 只读出口：工具 `get_stock_basics`（service key `traderKit.data.stockBasics`，工具与 service **同一实现**，沿 data-tool-contract 双出口纪律），归 `src/data/**`（与 T0/T1/T2 同层，复用 `src/data/date.ts` 时间口径与 `src/data/guard.ts` 的**只读**状态，MUST NOT 自建第二份计数或第二套出站通道）。该出口是插件内**唯一**允许向 `127.0.0.1:17709` 发起 HTTP 请求的代码路径（例外条款见 `data-tool-contract` 的「只读边界」修订）；`src/data/http.ts` 的 17709 拦截规则 SHALL 收窄为「**仅放行本出口的白名单请求**，其余一律拒绝」，MUST NOT 全面解除拦截。

#### Scenario: 单一出口

- **WHEN** 审查全仓对 `127.0.0.1:17709` 的 HTTP 调用点（结构断言）
- **THEN** 仅 `src/data/tq-local.ts`（本出口实现）一处；`src/data/http.ts` 对白名单外的 17709 请求仍抛 `blockedEndpoint`；`/api/local`、面板、卡片写入路径均无该调用

#### Scenario: 依赖不可用显式报错

- **WHEN** 出口实现缺失或 service key 未注册而调用方仍尝试使用
- **THEN** 调用方 SHALL 显式 `DEPENDENCY_UNAVAILABLE`（含缺失接口名与所属 change），MUST NOT 静默回落到猜测名称

### Requirement: 请求契约（method 与字段白名单）

本出口 SHALL 只发送 JSON-RPC 请求至 `http://127.0.0.1:17709/`（仅回环；MUST NOT 使用其它主机名解析结果），且：

- **method 白名单（唯一）**：`get_stock_info`；MUST NOT 调用任何其它 method（尤其 `get_market_data` / `get_market_snapshot` / `order_stock` / `cancel_order_stock` / `subscribe_hq` 等行情与交易接口）；白名单以源码常量**唯一定义点**表达（结构断言：全仓 method 字面量集合 == 白名单集合）；
- **params 白名单**：仅 `stock_code`（string）与 `field_list`（string[]，取值 ⊆ 常量字段白名单 `['Name','HSStockKind','J_start','tdx_dyname','rs_hyname','ActiveCapital','J_zgb']`）；MUST NOT 透传调用方提供的任意 params；
- **代码后缀候选序列**：入参 `code`（6 位数字，经 change 4 `src/review/anchor.ts` 的 `normalizeCode`）→ 依次尝试 `['.SH', '.SZ', '.BJ']`（缺省）或调用方显式给出的 `marketSuffix`（单值，优先）；以「`ErrorId === "0"` 且 `Name` 非空」为命中判据，**首个命中即停**；全部未命中 → `available=false`（`reason='noRecord'`），MUST NOT 猜测后缀语义（不按代码前缀推断市场）；
- **超时与重试**：单次请求硬超时 **2 s**（`AbortSignal.timeout`）；MUST NOT 重试（回环本机服务，重试无收益且拖慢 `/api/enrich`）；候选序列最多 3 次请求，命中即停；
- **响应解析**：`result.ErrorId === "0"` 为成功；`error` 或非 JSON 或非 2xx → `available=false` + `reason='sourceUnavailable'`（原因文本原样保留在 `notes`，MUST NOT 归一化成「无记录」）。

#### Scenario: 后缀候选命中

- **WHEN** 以 `code='999999'` 调用且 `.SH` 命中
- **THEN** 返回 `marketSuffix='.SH'` 与该标的字段；MUST NOT 继续尝试 `.SZ`/`.BJ`（请求计数 == 1）

#### Scenario: 全候选未命中

- **WHEN** 三个后缀候选均返回 `ErrorId !== "0"` 或空 `Name`
- **THEN** `available=false`、`reason='noRecord'`、请求计数 == 3；MUST NOT 返回猜测名称

#### Scenario: 服务不可达

- **WHEN** TdxW 未启动 / 端口拒绝 / 2 s 超时
- **THEN** `available=false`、`reason='sourceUnavailable'` 且 `notes` 含原始原因与「通达信是否已启动并登录」提示；调用方（`/api/enrich`）其余字段不受影响

#### Scenario: method 与字段白名单不可绕过

- **WHEN** 审查实现与测试（含传入任意 `params` 的尝试）
- **THEN** 不存在白名单外 method 的调用路径；`field_list` 恒为白名单子集；调用方无法注入额外 params

### Requirement: 出参契约

出口 SHALL 返回：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `available` | boolean | 是否取到（`false` 时其余业务字段为 `null`） |
| `code` | string | 归一后的 6 位代码 |
| `marketSuffix` | `'.SH' \| '.SZ' \| '.BJ' \| null` | 命中的后缀（未命中 `null`） |
| `name` | `string \| null` | 证券名称（**原样**，含全角字符；不做大小写/全角半角归一） |
| `kind` | `string \| null` | `HSStockKind` 原文（`0`=指数 / `1`=A股主板 / `7`=基金 …） |
| `listedAt` | `string \| null` | `J_start` 原文（`YYYYMMDD` 或 `'0'` 表示无；`'0'` 归一为 `null`） |
| `region` | `string \| null` | `tdx_dyname`（通达信地域） |
| `industry` | `string \| null` | `rs_hyname`（通达信行业） |
| `floatSharesWan` | `string \| null` | `ActiveCapital`（流通股本，万股，**原样字符串**） |
| `totalSharesWan` | `string \| null` | `J_zgb`（总股本，万股，原样字符串） |
| `source` | `'tq-local'` | 源标识（唯一取值） |
| `fetchedAt` | string | 取数时刻（`+08:00`，经 change 4 `src/review/format.ts` 的 `formatZonedIso`） |
| `cacheReused` | boolean | 是否命中本出口缓存 |
| `notes` | string[] | 失败/降级原因原文（不参与业务判断） |

数值字段 SHALL 以**字符串原样**透出（MUST NOT 在插件侧做单位换算或数值转换——换算归消费方，沿 data-tool-contract「不冒充」纪律）；缺失字段一律 `null`，MUST NOT 用 `0`/`''`/`--` 冒充。

#### Scenario: 成功返回

- **WHEN** `code='880863'` 命中
- **THEN** 返回 `available=true`、`name='昨日涨停'`、`kind='0'`、`source='tq-local'`、`fetchedAt` 带 `+08:00`、`cacheReused=false`（首次）

#### Scenario: 字段缺失不冒充

- **WHEN** 某标的 `J_start='0'`、`rs_hyname` 为空串
- **THEN** `listedAt=null`、`industry=null`；MUST NOT 返回 `'0'` / `''` 作为「已取到」的值

### Requirement: 缓存

出口 SHALL 维护**进程内存**缓存（键 = 归一后的 `code`；值 = 成功结果；TTL 24 h；MUST NOT 落盘——避免把 TDX 名称写进 vault）：命中 SHALL 置 `cacheReused=true` 并**零请求**；失败结果 SHALL NOT 缓存（MUST NOT 负缓存，避免 TdxW 稍后启动仍显示不可用）；缓存 SHALL 有显式上限（条目数）以杜绝无界增长。

#### Scenario: 命中零请求

- **WHEN** 24 h 内以同一 `code` 二次调用
- **THEN** `cacheReused=true`、`fetchedAt` 为首次取数时刻、对 17709 零新请求（测试以桩服务请求计数断言）

#### Scenario: 失败不缓存

- **WHEN** 首次调用因服务不可达失败，随后服务恢复并再次调用
- **THEN** 第二次真实出站并成功（MUST NOT 用首次失败结果短路）

### Requirement: 开关与降级

本出口 SHALL 受配置开关 `sources.tqLocal.enabled` 控制（**默认 `true`**——owner 2026-10-06 裁决；纯只读本机信息，不涉交易）。开关关闭时出口 SHALL 返回 `available=false`（`reason='disabled'` 经 `notes` 表达）且**零请求**；开关状态 SHALL 出现在启动健康检查的机器可读状态中（沿既有 `health.status()` 的两段结构，不新建状态出口）。降级 MUST NOT 阻塞任何调用方：`/api/enrich` 其余字段（标签、涨停原因）照常返回；页面显示代码 + 「名称未获取」（沿既有口径）。

#### Scenario: 开关关闭零请求

- **WHEN** `sources.tqLocal.enabled=false` 且调用出口
- **THEN** 立即返回 `available=false`、无任何出站（桩服务零请求）；`/api/enrich` 与页面其余部分不受影响

#### Scenario: 不可达不阻塞接口

- **WHEN** TdxW 未启动且页面请求 `/api/enrich`
- **THEN** 名称兜底项标注不可用原因，标签/涨停原因照常返回；首屏本地段（`/api/local`）行为完全不变（MUST NOT 因本能力引入新的本地段依赖）

### Requirement: 接线与消费（页面名称层）

`/api/enrich` 的名称反查链 SHALL 扩展为：T2/S8 反查 → 行情名称源探针（同花顺 realhead）→ **TQ-Local 兜底（本出口；`nameSource: 'tq-local'`）**；命中 SHALL 以 `nameSource='tq-local'` 返回名称，页面按既有规则补位显示（页面 MUST NOT 展示来源标注，沿 owner 2026-10-05 指示）。基础信息字段（`kind`/`listedAt`/`region`/`industry`/`floatSharesWan`/`totalSharesWan`）SHALL 作为 `/api/enrich` 响应的**独立可选段**（`basics`）返回，供页面展示（B1 四格中的股本两项可用 `floatSharesWan`/`totalSharesWan`；其余字段 v1 可只入库不显示）；本出口 MUST NOT 被 `/api/local` 调用（首屏零网络不变）。

#### Scenario: 通达信内置代码名称显示

- **WHEN** 页面打开 `999999`（历史无 frontmatter 名称、T2/S8 与行情名称源均未命中、TdxW 在跑）
- **THEN** `/api/enrich` 返回 `name='上证指数'`（`nameSource='tq-local'`）与 `basics.kind='0'`；页面以「上证指数」替换代码显示

#### Scenario: 来源优先级不颠倒

- **WHEN** 层①（历史 frontmatter）已命中名称
- **THEN** `/api/enrich` MUST NOT 覆盖该名称（TQ 兜底仅在既有层全部未命中时被调用；测试断言：层①命中时对 17709 零请求）
