## MODIFIED Requirements

### Requirement: 只读边界

数据模块 SHALL 只调用读取类接口；MUST NOT 存在 `order_stock`、`cancel_order` 或任何交易账户接口的调用路径；SHALL 以**结构断言 + 扫描前置非空断言**验证（断言方式见 `iteration-1-contracts §7`）：

- **扫描域（本 change 时点）**：`src/data/**` 与 `src/index.ts`（必然存在，`targets.length > 0` 由此构成）；`src/routes/**`、`src/client/**` 在本 change 时点**尚不存在**（由 change 4 创建）→ 其断言按「目录存在时才执行，并用例名标记 `deferred`、同时计入 change 4 验收」处理，MUST NOT 因其缺失而放宽或跳过 `src/data/**` 的断言；
- `src/routes/**`、`src/client/**`（存在时）MUST NOT import `src/data/**`（允许 import service 类型）；
- **具名出站通道**：允许 `fetch(` / `http.request` 的通道仅 `src/data/http.ts`（**数据面**出站唯一闸门）与 `src/skill/download.ts`（change 3 的 skill 下载器，带替代护栏，见 change 3 design D-12）；在**本 change 时点存在的源码集合**（`src/data/**`、`src/index.ts`）内，除 `src/data/http.ts` 外 MUST 为零命中（`src/skill/download.ts` 由 change 3 创建，同样按 `deferred` 处理）；**二者均不因 review-loop 的 TQ-Local 兜底而增设第三条通道**——该兜底经 `src/data/http.ts` 的同一条通道发出（见下条）；
- `127.0.0.1:17709`：**唯一例外** = `src/data/tq-local.ts` 出口（review-loop `tq-local-lookup` 能力）经 `src/data/http.ts` 通道发出的 `get_stock_info` 只读请求——method 与 `field_list` 均为源码常量白名单、仅回环、受 `sources.tqLocal.enabled` 开关约束（默认 `true`，owner 裁决 2026-10-06）；**除该白名单外**数据模块对其**无任何 HTTP 请求**（`src/data/http.ts` 的 17709 拦截规则收窄为「仅放行该白名单请求，其余一律 `blockedEndpoint`」，MUST NOT 全面解除），且 `net.connect` 可达性探测（可配置关闭）保持不变；
- 交易接口：源码与依赖中不存在 `order_stock` / `cancel_order` 调用路径（**含 TQ-Local 兜底出口：其 method 白名单只有 `get_stock_info`**）；
- 工具入参 schema：T0/T1/T2 的入参 schema MUST NOT 含 `refresh` 或任何刷新开关（见「无刷新入口」scenario 的 schema 扫描用例）；`get_stock_basics` 的入参 schema 亦 MUST NOT 含任意 params 透传口（仅 `code` + 可选 `marketSuffix`）。

任一扫描型用例 MUST 先断言「扫描目标非空」（`targets.length > 0`），避免空过。

执行类语义（若未来引入）SHALL 默认 dry-run。

#### Scenario: 源码审查

- **WHEN** 审查数据模块全部源码与依赖
- **THEN** 不存在交易账户类调用（含被注释的代码）

#### Scenario: 结构断言替代文本扫描

- **WHEN** 运行数据模块测试
- **THEN** 通过 import 白名单断言与出站通道断言验证：`src/data/**`、`src/index.ts` 内除 `src/data/http.ts` 外零 `fetch(`；`src/routes/**`、`src/client/**`、`src/skill/download.ts` 在本 change 时点不存在 → 对应用例标记 `deferred` 并计入 change 4/change 3 验收；MUST NOT 只依赖源码文本扫描

#### Scenario: 扫描型用例先断言目标非空

- **WHEN** 运行任一源码扫描用例
- **THEN** 用例首步断言扫描目标数 > 0（本 change 时点由 `src/data/**` 与 `src/index.ts` 构成；目标缺失即失败，MUST NOT 空过）；对尚不存在的目录不得以「目标为 0」的方式通过

#### Scenario: 17709 白名单例外（原「17709 无 HTTP 请求」修订）

- **WHEN** 审查数据模块对 `127.0.0.1:17709` 的行为（review-loop 落地后）
- **THEN** 只存在两类动作：① `net.connect` 可达性探测（可配置关闭）；② `get_stock_info` 只读请求（method 与 `field_list` 白名单、仅回环、开关控制）；**不存在**任何行情/交易/其它 method 的请求路径；白名单外的 17709 请求一律抛 `blockedEndpoint`（测试以桩服务断言「除白名单外零请求」）；`review-loop` 落地前本场景按原口径（零 HTTP 请求）成立
