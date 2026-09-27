# 实施任务（review-page）

> 跨 change 事实源：`docs/design/iteration-1-contracts.md`（下称 `§n`）。重排裁决见
> `docs/roadmap.md §5`。每条任务含 **产物 / 验收 / 依赖**；`依赖` 中含
> `blocked_by: change 1` 的条目属**承载绑定层**，在 spike 实测结论（`docs/spikes/`，
> 当前仓内不存在）落地前不得开工。

## 0. 依赖分组（评审 Issue 6）

- **承载无关层（可先行）**：§1 卡片存储、§3 交易日归属与降级、§5 B1 回溯取数。
  依赖 = `change 2`（`traderKit.data.resolveTradeDate`、T1/T2 service 出口、
  `data-root-layout`）；不依赖 spike 结论。
- **承载绑定层（`blocked_by: change 1`）**：§2 页面路由与接口、§4 前端资产、
  §7 资产形态与部署。依赖 = change 1 的「页面能否在 TDX 内嵌浏览器打开 /
  传参行为 / 认证路径 / 资产形态」实测结论。

## 1. 卡片存储（`review-card-store`，承载无关层）

- [x] 1.1 `src/review/md/frontmatter.ts`：frontmatter 读写（含最小键 schema 校验、未知键原样保留、`patterns`/`drafts` 预留键保留、`subjective: true`、**值级最小文本修补**），MUST NOT 整体重序列化
  - 产物：`src/review/md/frontmatter.ts`
  - 验收：读写往返后键序/引号/缩进/未知键逐字节不变；`patterns`/`drafts` 既有值保留；键 schema 见 spec「frontmatter 最小键 schema」
  - 依赖：`§4`（EOL/BOM/最小修补）、spec `review-card-store`「frontmatter 最小键 schema」
- [x] 1.2 `src/review/md/parse.ts`：按锚点解析卡片分节（`^card-`）与排除附注（`^ainote-`），**逐行扫描只认 H2 标题行**、**跳过 fenced code block**、提取 `HH:mm` / `writtenAt` / `clientRequestId` / 正文
  - 产物：`src/review/md/parse.ts`
  - 验收：代码块内锚点不入卡片；正文含行首 `##` 时归入所属卡片正文；返回 `eol` / `bom` 探测结果
  - 依赖：`§2`、spec「解析与幂等规则」
- [x] 1.3 `src/review/anchor.ts`：`normalizeCode(raw)`（去 `sh|sz|bj` 前缀与 `.sh|.sz|.bj` 后缀；余下须 6 位数字；保留前导零、不补全、不猜测）+ **锚点正则唯一版本**（带 `(-<seq>)?`，写入/解析/幂等共用同一常量）
  - 产物：`src/review/anchor.ts`（导出 `normalizeCode`、`CARD_ANCHOR_RE`、`AINOTE_ANCHOR_RE`）
  - 验收：`SH600000`/`600000.SH`/`sh600000` → `600000`；`60000`/`6000000`/`abc` → `null` 且不补全；全仓无第二份锚点正则（结构断言）
  - 依赖：`§2`；change 5 复用该模块
- [x] 1.4 `src/review/store.ts`：文档定位（经 change 2 `data-root-layout` 的 `resolveArea`，禁止自行拼接）+ **插入到首个 `^ainote-` 分节之前（卡片区尾部）** + 进程内按绝对路径互斥（`Map<absPath, Promise>`）+ 写前 `stat`（`mtimeMs`+`size`）校验 + 重试 3 次 50/200/800 ms + 单次写入总超时 5 s + 不可解时 `CONCURRENT_WRITE` + 原子写（临时文件 + 改名）+ 失败清理 + `clientRequestId` 去重（`status: 'duplicate'` 返回既有锚点）
  - 产物：`src/review/store.ts`（`locateDoc`/`parseDoc`/`appendCard`/`appendAinote`/`scanDailyCardTargets`，签名与 spec「可复用写入接口契约」逐字一致）
  - 验收：插入位置正确（附注仍在末尾）；既有字节不变（口径见 `§4`）；重试成功且不留半截文档；重复 `clientRequestId` 不追加第二张卡
  - 依赖：`§3`/`§4`/`§5`、1.1 / 1.2 / 1.3、change 2 `data-root-layout`
- [x] 1.5 `src/review/context.ts`（**跨线登记（2026-09-27）**：未来 2.5/6.3② 的「test/** 零 `fetch(`」断言须沿用探针线的具名豁免——`test/helpers/data-stub.ts`（change 2 本地桩通道，运行时回环断言）与 `test/structure.test.ts`（扫描器自体）；见 `test/probe/probe-registration.test.ts` 边界扫描）：`NameResolver`（层① 本地历史 frontmatter → 层② T2/S8 网络反查 → 层③ 仅代码，层序与归属接口见 `§12.4`）与 `TradeDateResolver`（seam，见 3.1）两个接口 + 默认实现；返回值含 `source` / `confidence` / 可选 `marketSuffix`；`NameResolver` MUST NOT 让本地层出网
  - 产物：`src/review/context.ts`
  - 验收：三层可注入桩逐级验证（层①/③ 无出站网络、层② 只在 enrich 路径）；seam 返回形状满足 D-TQ 选项 B（契约测试）
  - 依赖：`§1`/`§12.4`、change 2 `traderKit.data.resolveTradeDate`、3.1
- [x] 1.6 单测（零 mock，真实临时目录）：首次落盘/同日插入/跨日新文档、既有字节不变、插入位置（附注之前）、frontmatter 预留键与未知键保留、同分钟锚点唯一、名称变化不产生第二份文档、原子写中断不留半截、文件占用失败后重试成功、幽灵锚点、重复锚点、代码块内锚点、**文件名净化（`*ST` / `/` / `:` / 控制字符 / 保留名 / 超长 / 净化后为空 / NFC-北交所）**
  - 产物：`src/review/**/*.test.ts`（或仓内既有测试目录下的对应用例文件）
  - 验收：`pnpm test` 全绿；每类断言独立可失败（不做「大而全」单测）
  - 依赖：1.1–1.5
- [x] 1.7 文件名净化接入（**不新建模块**）：文件名名称段 MUST 经 change 2 的 `resolveArea(key, params)` / `sanitizeNameSegment`（唯一实现 `src/paths/sanitize.ts`，`§6`/`§11`）净化；本 change MUST NOT 另建 `src/review/sanitize.ts` 或第二份「替换非法字符/截断/保留名」实现；`nameTruncated` 只透传到写入响应 `warnings`
  - 产物：store 写入路径的净化接入代码（import change 2 实现或经 `resolveArea`），**无本 change 自有净化模块**；另加 frontmatter 值双引号转义逻辑（落 1.1）
  - 验收：结构断言「全仓不存在 `src/review/sanitize.ts`、净化实现唯一」（先断言扫描目标非空，`§7`）；单测覆盖 spec「文件名与 frontmatter 值净化」全部场景（`*ST` / `/`·`\`·`:` / 控制字符 / 保留名 / 超长→`nameTruncated` / 净化后为空 / NFC-北交所）
  - 依赖：`§6`/`§11`、change 2 `data-root-layout`（`resolveArea` 与 `sanitizeNameSegment`）、1.4
  - 跨 change 回写项（登记，本 change 不自行实现）：change 2 `data-root-layout` spec 的「截断并记 `nameTruncated`」MUST 补明该标志的**返回形状**（返回值/结果字段），否则本 change 的写入响应 `warnings` 无法承载该项；未暴露期间 `warnings` 不含 `nameTruncated`，MUST NOT 在本 change 重算净化规则（Open Questions 9）
- [x] 1.8 并发单测：页面写入与附注写入并发**两条均保留**；写前 `stat` 不一致 → 重读重试；重试 3 次仍冲突 → `CONCURRENT_WRITE`（含路径）；并发后文档同时含新卡片与附注且附注在末尾
  - 产物：并发测试用例（`appendCard` × `appendAinote` 并发 + 外部改动模拟）
  - 验收：断言最终文档同时含两部分内容，且既有字节不变；错误路径返回显式 `CONCURRENT_WRITE`
  - 依赖：1.4、`§5`；与 change 5「共享同一锁/重试纪律」对接
- [x] 1.9 字节口径 fixture 断言：**CRLF / BOM / 无尾换行**三类 fixture + 「原文件字节是结果文件前缀」断言 + frontmatter 最小修补断言（键序不变）
  - 产物：`fixtures/`（或测试内联构造）三类样本 + 断言用例
  - 验收：CRLF 不混排；BOM 保留且唯一；无尾换行先补本文件 EOL（该分隔符不计入既有内容）
  - 依赖：1.1 / 1.4、`§4`
- [x] 1.10 多命中确定性单测：构造两份同日同代码文档 → 取 mtime 最新；mtime 平局 → 按文件名字典序；`warnings` 含两条路径；未被选中文档字节不变
  - 产物：多命中共用测试用例
  - 验收：选择结果稳定可复现；`locateDoc` 返回的 `warnings` 非空
  - 依赖：1.4、`§3`
- [x] 1.11 frontmatter schema 单测：未知键原样保留、`patterns` 为模式 id 字符串数组、`drafts` 保留原样、`name` 为空写空字符串、含 `"`/换行的值可被重新解析
  - 产物：frontmatter schema 测试用例
  - 验收：断言未知键与键序逐字节保留；YAML 可解析
  - 依赖：1.1、`§4`
- [x] 1.12 导出可复用写入接口契约：`src/review/store.ts` 按 spec「可复用写入接口契约」导出 5 个函数（签名与 `§3` 逐字一致，**五个导出一律返回 `warnings: string[]`**）；`appendCard`/`appendAinote` 落**写前归属硬校验**（不一致抛 `DOC_MISMATCH`，含两侧 code/tradeDate）；service key 注册 `traderKit.review.{locateDoc,parseDoc,appendCard,appendAinote,scanDailyCardTargets}`；工具出口（change 5）指向同一实现
  - 产物：`src/review/store.ts` 导出面 + service 注册代码（`src/index.ts` 或等价入口）
  - 验收：结构断言「全仓仅一处原子写/追加实现」；契约测试直接按签名调用 5 个函数并断言每个返回值都含 `warnings` 字段（空告警时为 `[]`）；`DOC_MISMATCH` 用例断言文档字节不变
  - 依赖：1.4、`§3`；供 change 5 复用
- [x] 1.13 `src/review/format.ts`（**新增，时间格式化单点**）：导出 `formatZonedIso(date: Date): string`（`YYYY-MM-DDTHH:mm:ss+08:00`）与 `formatAnchorTime(date: Date): string`（`HHmm`）；卡片 `writtenAt`、锚点时间段与分节标题时间全部经本模块
  - 产物：`src/review/format.ts`
  - 验收：`writtenAt` 与（change 5 的）`generatedAt` 调用同一导出；锚点 `HHmm` 与标题 `HH:mm` 同源（同一次 `formatAnchorTime`）；结构断言「全仓仅一处 `+08:00` 偏移拼装」；`YYYY-MM-DD ⇄ YYYYMMDD` 不在本模块（走 change 2 `src/data/date.ts`）
  - 依赖：`§3`/`§11`；change 5 复用
- [x] 1.14 告警类型与编码：落 `StoreWarning = { kind: 'multiHit'|'ghostAnchor'|'duplicateAnchor'|'nameTruncated'; path; detail; candidates? }` 与**唯一编码函数**（`` `[<kind>] <path> — <detail>` ``，候选追加 `；候选: a, b`）；落 `Card` / `AInote` 最小类型（change 5 的 `cards` 元素 `{anchor,writtenAt,body}` 为其子集）；字段名**一律 `warnings: string[]`**（store 导出 / `/api/local` / 写入响应同名），MUST NOT 出现 `storeWarnings[]`
  - 产物：`src/review/store.ts`（或同级 `types.ts`）的类型导出 + 编码函数
  - 验收：单测断言 `warnings` 元素匹配 `^\[(multiHit|ghostAnchor|duplicateAnchor|nameTruncated)\] ` 且可解析回 `kind`；**枚举中不存在 `docMismatch`**（写前归属不一致走抛错 `DOC_MISMATCH`，不产生 `warnings`，见 1.12）；无 `kind` 前缀的自由文本告警为零；`Card` 形状与 change 5 契约逐字一致
  - 依赖：1.4、1.12、`§3`/`§12.7`

> **§1 实现登记（2026-09-27，存储组）**：① 单测落 `test/review/**`（1.6「仓内既有
> 测试目录」选项；vitest include 仅 `test/**`）。② `scanDailyCardTargets` 增可选尾参
> `dataRoot?`（省略时显式报错；service 出口在 `registerReview` 绑定装配期 dataRoot）——
> 该导出在 `Loc.dataRoot` 之外仍需数据根来源，单参调用形态与 `§3` 逐字兼容；`src/data/**`
> 当前未透出 `dataRoot`，接回到位前该出口按 resolveArea 显式报错降级。③ 进程内互斥键 =
> 月目录 + code + 日期的规范键（与「按绝对路径互斥」等价，且消除「不同名称段并发首次
> 创建」的竞态）。④ 测试注入点：`retryDelaysMs` + `onPhase`（`before-read` /
> `before-verify` / `before-write`）经 `setStoreWriteHooksForTest` 注入，生产不调用。
> ⑤ `+08:00` 唯一拼装的结构断言（1.13）按「src 全树内仅 `src/review/format.ts`
> （`src/data/**` 为数据线辖区）」落界——数据线 `src/data/normalize.ts` / `guard.ts`
> 现存各自的 `+08:00` 拼装，跨线收敛后由 6.3⑧ 全仓断言接管。⑥ 全仓 `pnpm test` 现有
> 1 处非本线报错：并行数据线新增 `test/structure.test.ts`（未跟踪文件）自身含 `fetch(`
> 字样，被 change 1 probe-registration 边界扫描命中——非本线产物，未处置。

## 2. 页面路由与接口（`review-page`，**承载绑定层，`blocked_by: change 1`**）

- [ ] 2.1 `src/routes/review.ts`：`GET /review`（HTML）+ `GET /review/<code>`（path 段直链，匹配优先级在 `/review/api/*` 之后）+ `GET /review/api/local` + `GET /review/api/enrich` + `POST /review/api/card` + `GET /review/api/dates`；`ctx.effect` 注册/disposer 注销
  - 产物：`src/routes/review.ts`
  - 验收：六条路由均可达；卸载/关闭后返回 404 且无残留处理器；**不含 `GET /review/api/context`**（已废止）；**与 change 1 探针路由共存**：`<basePath>/probe`（`exact`）与本 change 路径不重叠，且以结构断言核验「重复 `(kind, path)` 注册会抛错」不被触发（注册顺序 + 路径集合断言，先断言扫描目标非空）；`/review/<code>` 与 `/review/api/*` 的匹配优先级有断言（`/review/api/local` 不被 path 段吞掉）
  - 依赖：`blocked_by: change 1`（路由注册能力实测结论；探针路由共存约定见 change 1 D-1）、1.4、1.5
- [ ] 2.2 认证接入（**A/B/C 分层 + 读通道分档，按 change 1 结论 + `§12.1`**）：A 层 = 宿主 tokenized URL + cookie，**两步**（先 `GET <base>/?token=` 铸 cookie + 303，再导航业务路径）；**读通道分档**——默认分支页面与读接口走 A 层；回退分支未签字前 MUST NOT 提供未认证读（只交付文档形态 + 「取数不可用」空态），C 层签字后仅按显式放宽点只读；**写入通道两分支同 = 只认 A 层**；B 层 = change 1 的**插件自持诊断 token**，仅诊断/只读；C 层 = `file://` 就地只读（需 owner 签字）；**写接口只接受 A 层凭据，MUST NOT 依赖 B/C 层**；A 层不可用即写接口**显式不可用**（明确错误码 + 提示 + 页面只读降级）
  - 产物：认证接入代码 + 未认证/无 A 层凭据的拒绝路径 + 写接口不可用态（错误码 + 提示）+ 回退分支读通道分档判定
  - 验收：未认证 `POST /api/card` 被拒且无写入；仅带 `?token=` 直连业务路径 → 401（负向断言）；**A 层不可用时写接口拒绝用例**（不落盘 + 明确错误 + 页面只读降级标记）；B 层诊断 token 请求写接口被拒；**回退分支：C 层未签字时读接口不返回数据（未认证读被拒）、签字后仅放宽点内只读**；测试以 2.8 的请求桩驱动
  - 依赖：`blocked_by: change 1`（认证路径实测结论；B 层定义见 change 1 D-3）、2.1、2.8
- [ ] 2.3 传参解析：hash 优先 → query → path；经 `normalizeCode` 归一化（去壳不补全）；缺失/非法返回显式空态标记（**原文取值 + 期望格式 + TDX 配置指引**）；非法代码不触发任何读
  - 产物：解析模块（`src/routes/review.ts` 内或 `src/client/review/params.ts`）
  - 验收：`SH600000`/`600000.SH`/`sh600000` 归一化成功；`60000` 拒绝且空态文案含原文与期望格式
  - 依赖：1.3、spec「页面路由与标的上下文」全部场景
- [ ] 2.4 静态资产路由安全：路径穿越防护（`..`/绝对路径/盘符/`%2e%2e`/`%2f`）+ `Content-Type` 白名单 + 白名单外与非白名单扩展名 → 404 + HTML `Cache-Control: no-cache`
  - 产物：资产响应处理器
  - 验收：spec「静态资产安全与打包」全部场景通过；404（非 403）
  - 依赖：`blocked_by: change 1`（资产形态）、7.1
- [ ] 2.5 单测：路由注册/注销、404、传参优先级、未认证写请求被拒、**A 层不可用时写接口拒绝（不落盘 + 只读降级标记）**、**B 层 token 请求写接口被拒**、**与 change 1 探针路由共存/不重复注册**、路径穿越被拒、**MIME/缓存头断言**、**无外链扫描断言**（扫描前先断言目标非空）；上述 handler / 认证判定用例**一律经 2.8 的请求桩**驱动
  - 产物：`src/routes/**` 测试用例
  - 验收：spec「静态资产安全与打包」4 场景与「路由随插件生命周期」场景各自独立通过；`test/**` 内 `fetch(` 命中 0 次（`§7` 仅承认 `src/data/http.ts` 与 `src/skill/download.ts` 两条出站通道）
  - 依赖：2.1–2.4、2.8
- [ ] 2.6 本地段性能与纯本地性：`/api/local` 冷启动 ≤500 ms；**结构断言**其依赖链不含出站网络（不 import `src/data/**` 取数实现，零 `fetch`）
  - 产物：性能/结构断言用例 + 计时输出片段（作为 6.x 证据）
  - 验收：`§7` 结构断言通过且扫描目标非空；冷启动实测 ≤500 ms
  - 依赖：2.1、`§7`
- [ ] 2.7 写入接口入参校验专项断言（R2-Issue 16/27 残留）：`code` 非法、`body` 为空/超 10000 字符、`tradeDate` 形态非法、`name` 超 200 字符、缺 `clientRequestId` → 各自返回 4xx + 原因，且**零写入**（doc 目录无新增/无字节变化）
  - 产物：入参校验断言用例（逐项独立可失败）
  - 验收：spec「写入接口入参校验与幂等」全部场景通过（含「入参上限」场景）；每个用例先断言目标文档状态再断言 4xx
  - 依赖：2.1、1.12
- [ ] 2.8 **handler 工厂与认证判定 seam（R3-Issue 35，沿 change 1 D-10 先例）**：`src/routes/review.ts` 的路由 handler MUST 提为纯工厂 `createReviewHandler(deps)`，`deps` 注入 ① 认证判定（A 层 cookie 有效 / 回退分支 / 不可用）、② 资产读取 `readAsset(path)`、③ 取数 service（`resolveTradeDate` / T1 / T2 出口）；工厂只做「请求对象 → 响应对象」的纯映射（不自行读文件、不自行判 cookie、不自行发请求）
  - 产物：`createReviewHandler(deps)` 工厂 + `deps` 类型 + **请求桩**测试辅助（构造 `Request`/`IncomingMessage` 形状的普通对象，函数注入）
  - 验收（**驱动方式写明**）：单测直接调用工厂产物并以请求桩断言——未认证写请求 / A 层不可用 / B 层 token / 非法入参 / MIME / 穿越 / 无外链；`test/**` 内 MUST NOT 出现第三处 `fetch(`（`§7` 仅承认 `src/data/http.ts` 与 `src/skill/download.ts`）或任何本地 HTTP 客户端真实请求；`ctx.effect` 注册/卸载与宿主 `requestRejection` 真实行为标为**集成核对**（6.1），不在单测内伪造宿主
  - 依赖：2.1、`§7`；被 2.2 / 2.5 / 2.7 复用

## 3. 交易日归属与降级（承载无关层）

- [ ] 3.1 `TradeDateResolver` seam：默认实现返回 `{ value, source, isTradingDay: true|null, confidence, marketSuffix? }`，MUST 调用 change 2 的 `traderKit.data.resolveTradeDate({ date? })`，MUST NOT 自行实现日期推断或系统日期 fallback
  - 产物：`src/review/context.ts` 的 `TradeDateResolver` 默认实现
  - 验收：`value===null` 或 `isTradingDay===null` → 归属待确认；`isTradingDay===true` 才可直接归属；单测注入桩覆盖三种返回
  - 依赖：`§1`、1.5、change 2 T0 能力
- [ ] 3.1b **B 选项最小 stub + 契约测试**：实现一个不接线、不调用 TQ 的 stub（返回 `source: 'TQ-HqDate'` + `marketSuffix`），用契约测试断言「替换 seam 实现后页面/存储层零改动」
  - 产物：stub 实现 + 契约测试用例
  - 验收：契约测试断言返回值形状与调用方无感知；stub MUST NOT 出现在生产注册路径
  - 依赖：3.1、D-TQ 台账（`docs/roadmap.md §5`）
- [ ] 3.2 归属确认：B2 显示待确认归属（含来源与 confidence），提交前一次显式确认；确认前 MUST NOT 落盘；**默认值分路径**：`isTradingDay === null` 且 `value !== null` → 默认 = `value`；`value === null` → 默认留空并 MUST 要求用户显式填入（可预填 `requestedDate` 但标注「待确认」，MUST NOT 当作归属）
  - 产物：前端确认态 + 提交前校验
  - 验收：周末 / 长假第 N 天 / 盘前 / 隔日补写四类场景均出现确认提示；`value === null` 时默认值为空（断言前端不预置归属）；未确认时提交被拒
  - 依赖：3.1、4.3
- [ ] 3.2b **交易日历来源（未定，`blocked`）**：候选 = TQ skill 结论（change 3）或 change 2 增补日历能力；未定期间行为固定为 `isTradingDay === null` → 用户确认
  - 产物：（待来源裁决）日历能力接入点文档 + `TradeDateResolver` 替换实现
  - 验收：来源落地后 `isTradingDay` 可精确判定；未落地前行为与 spec 一致（不阻塞落盘）
  - 依赖：**`blocked`**（change 3 结论 / change 2 增补；登记于 `docs/roadmap.md §5` D-TQ 复审触发条件）
- [ ] 3.3 降级路径测试：业务日期来源不可得 → 走用户确认；确认后落盘成功；确认值写入 frontmatter `tradeDate` 与文件名日期段
  - 产物：降级测试用例
  - 验收：确认前后文档状态可断言（确认前无文件、确认后存在且归属正确）
  - 依赖：3.1 / 3.2
- [ ] 3.4 断言：归属逻辑不使用系统日期作为 fallback（源码级禁止 + 行为断言：系统时钟与业务日期不一致时归属仍取业务日期）
  - 产物：断言用例
  - 验收：篡改系统日期不改变归属结果
  - 依赖：3.1、`§1`

## 4. 前端资产（B1–B4，**承载绑定层，`blocked_by: change 1`**）

- [ ] 4.1 页面骨架：四区块（B1 头部 / B2 日期 / B3 输入 + 预留工具框 / B4 卡片区）；**窄视口可断言**（320 px：无横向滚动、输入框与保存可见可点）；预留按钮区 `disabled` + `tabindex="-1"`
  - 产物：`src/client/review/**`
  - 验收：spec「四区块布局」与「交互态与输入法」场景通过（含焦点顺序断言）
  - 依赖：`blocked_by: change 1`（内嵌内核版本结论）、7.1
- [ ] 4.2 B1：代码 + 名称分层展示（层① 本地 frontmatter / 层③ 仅代码来自 `/api/local` 且带 `nameSource`；层② T2/S8 由 `/api/enrich` 返回，**仅当本地段为 `code-only` 时补位替换**并更新来源标注）、含「名称未获取」态、标签与最近涨停原因（异步补位 + 单项降级显示「不可用 + 原因」+ 按源业务日标注）
  - 产物：B1 渲染逻辑
  - 验收：`/api/enrich` 挂起/失败时 B1 仍显示本地层名称或代码 + 「名称未获取」；层①命中时网络层 MUST NOT 覆盖；不阻塞输入
  - 依赖：2.1、5.2、`§12.4`
- [ ] 4.3 B2：日期切换（默认归属交易日；待确认态可见），切换不重载页面；无该日文档显示空态
  - 产物：B2 组件逻辑
  - 验收：spec「B2 日期组件与历史读回」全部场景
  - 依赖：2.1、3.2
- [ ] 4.4 B3：输入框 + 保存 + `Ctrl+Enter`（**`isComposing` 期间忽略**）+ 提交中防重 + 失败保留输入并可重试（重试复用同一 `clientRequestId`）
  - 产物：B3 组件逻辑
  - 验收：spec「输入与提交」与「交互态与输入法」场景
  - 依赖：2.1、1.12（后端幂等）
- [ ] 4.5 B4：卡片时间倒序渲染、纯文本转义、复制 block 引用、**`warnings: string[]` 显式展示（B4 上方；字段名统一为 `warnings`，无 `storeWarnings[]` 别名）**
  - 产物：B4 组件逻辑
  - 验收：spec「卡片回显与引用」「多命中文档的显式告警」场景；告警展示读取 `warnings`（结构断言见 6.3⑨）
  - 依赖：2.1、1.10
- [ ] 4.6 首屏本地部分 ≤500 ms（本地文件读取），**首屏 MUST NOT await 网络段**；网络段异步补位不阻塞输入
  - 产物：首屏加载编排代码 + 计时证据
  - 验收：网络段人为挂起时首屏仍出屏；`/api/local` ≤500 ms
  - 依赖：2.6、`§7`
- [ ] 4.7 **联动切换保护**：输入绑定 `draftOwnerCode`；hash 变化且输入非空 → 显示「未提交内容属于 `<原标的>`」+ 一次显式确认；未确认提交被拒
  - 产物：前端状态机 + 提交前校验
  - 验收：spec「联动切换标的的未提交内容保护」3 场景 + 前端状态机单测
  - 依赖：2.1、4.4
- [ ] 4.8 交互态与焦点：`idle`/`loading`/`submitting`/`error`/`empty` 五态可区分；焦点顺序 B2 → 输入框 → 保存（跳过预留区）
  - 产物：态渲染逻辑 + 前端测试
  - 验收：spec「交互态与输入法」全部场景
  - 依赖：4.1
- [ ] 4.9 前端手工验收：切换标的（hash 变化）不重载、不丢输入（非空时走确认）；提交后新卡片出现在顶部；切换日期回读对应文档
  - 产物：验收记录（命令 + 输出片段/截图路径 + 产物文件路径）
  - 验收：证据落盘于 `openspec/changes/review-page/` 之外的验收记录或 6.1 记录中
  - 依赖：4.1–4.8

## 5. B1 回溯取数（承载无关层）

- [ ] 5.1 「最近一个有涨停记录交易日」有界回溯（**口径 = `§12.5` + `§12.8`**）：起点 = `resolveTradeDate` 的最近业务日（第 1 次请求即该日）；第 k+1 次请求日 = **第 k 次响应返回的 `businessDate` 的前一自然日**（经 `src/data/date.ts` 折算，MUST NOT 自行拼接日期串、MUST NOT 自行枚举/跳过交易日）；**响应 `businessDate`（非 null）即该次实际评估的交易日**——纳入命中判定，且**无论它与请求日是否相同，下一次请求日 MUST 从响应 `businessDate` 前推**（MUST NOT 从请求日前推）；**`businessDate === null`** → 记「该日数据不可得」，以**该次请求日**前一自然日继续推进（计入 N），MUST NOT 抛错或静默停摆；**`available=false` + `errors` 含 `dateUnavailable`** → 记「数据不可得」，**不计为「未找到涨停记录」**（§12.8 二分），继续推进；上限 **N=6 次 T1 列表级请求**（默认 6，可配置且不超 6）、命中即停；单次页面打开总出站 ≤7（1 次 T2 + ≤6 次 T1）；单请求超时 5 s；导航离开/切标的/切日期即 abort；MUST NOT 使用 `offSession` 旁路护栏；逐日结果复用 change 2 列表级按日缓存（键 = `source + requestedDate`）
  - 产物：`src/review/enrich.ts`（或等价模块）+ 桩测试；结果结构 `availability: { available, reason?: 'noRecord'|'dateUnavailable'|'rateLimited'|'sourceError' }` + `businessDate?`/`requestedDates`/`unavailableDates`
  - 验收：列表级请求数 ≤6、总出站 ≤7、无重复 `businessDate`、abort 后不再发请求；`businessDate === null` 与「回带业务日 < 请求日」两类响应均**不中断回溯、不漏检**；结论由 `availability` 驱动分档（`noRecord` / `dateUnavailable` / `rateLimited` / `sourceError`）
  - 依赖：`§1`/`§9`/`§12.5`/`§12.8`、change 2 T1 service 出口与护栏（**一次 History 请求 = 一次列表级请求**）
- [ ] 5.2 降级与结论文案（**由 `availability` 驱动，MUST NOT 用 `0`/空值冒充**）：`available: true` → 命中日 `businessDate` 的原因与日期；`reason: 'noRecord'` → 「近 N 次查询内未找到涨停记录」（N 取实际配置值）；`reason: 'dateUnavailable'`（**N 次全部数据不可得**）→ 「近 N 次查询内未取得可用数据（数据不可得）」+ 原因，页面与正文 MUST NOT 写「未找到涨停记录」；`reason: 'rateLimited'` → 「近期涨停记录不可得（频控受限）」+ 原因；`reason: 'sourceError'`（**数据模块返回显式错误，任何错误码**）→ 「近期涨停记录不可得（数据源错误 `<错误码>`）」+ 原因；`businessDate ≠ requestedDate` → 标注「按源业务日 `<businessDate>`」
  - 产物：降级文案与 `availability` 状态字段
  - 验收：五类文案均可由响应字段驱动页面显示；**MUST NOT 出现 `sessionRejected` 状态或「盘中限制，盘后重试」文案**（change 2 无该生产者，见 5.6）；文案中的 N 与实际配置一致
  - 依赖：5.1、4.2
- [ ] 5.3 **四类桩测试（具名可注入 seam 驱动）**：① 预算耗尽 → `rateLimited` 文案；② 数据模块返回**显式错误（任何错误码）** → `sourceError` 文案与错误码；③ `businessDate !== requestedDate` → 以源业务日归属展示、**该响应以其 `businessDate` 纳入命中判定**、缓存键仍为 `source + requestedDate`；④ `errors` 含 `dateUnavailable`（含 `businessDate === null`）→ 按「数据不可得」推进且**不计为无记录**
  - 产物：本地取数 seam 桩测试用例
  - 验收：四类各自独立断言（含缓存桶键断言与 `availability.reason` 断言）；**MUST NOT 依赖 `sessionRejected` 或「单标的调用被判为全市场级」这一不可达分支**（见 5.6 与 design Open Questions 7）；零 mock 网络失败面
  - 依赖：5.1、5.2
- [ ] 5.4 单测：当日命中、历史命中、达上限未命中（`noRecord`）、源不可用时的降级显示、**N 次全部数据不可得（`dateUnavailable`）**
  - 产物：回溯测试用例
  - 验收：命中即停（断言后续请求数为 0）；达上限后不再请求（断言请求数 = 6）；`noRecord` 与 `dateUnavailable` 两类终态文案互不混用（断言正文不含错误的「未找到涨停记录」）
  - 依赖：5.1
- [ ] 5.5 回溯推进算法断言（**R3-Issue 29**）：构造桩响应 `businessDate` 序列（含跨周末、**回带上一交易日**、`null` 三类），断言：① 第 k+1 次请求日 = 第 k 次响应 `businessDate` 的前一自然日；② **响应 `businessDate`（非 null）即该次评估的交易日，且不存在「请求日 A、响应业务日 B<A、然后从 A 前推」的路径**（构造 `A=2026-09-27`、`B=2026-09-25`，断言下一次请求日为 `2026-09-24` 且 `B` 的评估结果被记录）；③ `businessDate === null` 时以**请求日**前一自然日推进；④ 请求数 ≤6、同一 `businessDate` 不重复请求、日内折算经 `src/data/date.ts`
  - 产物：推进算法测试用例（可判定日期序列 + `unavailableDates` 断言）
  - 验收：跨周末序列（如 `2026-09-28` → 请求 `2026-09-27`）被正确断言；`null` 与回带日期两类均不中断、不漏检；日历跨度大于请求数不构成违规（不再声明「≤6 业务日」）
  - 依赖：5.1、`§12.5`/`§12.8`、`§1`
- [ ] 5.6 **跨 change 接口对齐登记（回写 change 2，R3-Issue 29/30）**：① 登记本 change 对 `limit-reason-tool` 的三条消费假设——`available` / `errors[]`（含 `dateUnavailable`）/ `tradeDate`（= 源 `businessDate`）；change 2 spec MUST 保证「日期不一致或历史端点为空 → `errors` 含 `dateUnavailable`」「`available=false` 且无 `dateUnavailable` = 无涨停记录」「`dateUnavailable` 时 `tradeDate` 为源业务日或 `null`」；② 登记 `sessionRejected` **不存在**这一事实：本 change 不引用该状态，若 change 2 日后定义时段拒绝语义，只透传其错误码到 `sourceError` 详情文案
  - 产物：跨 change 回写登记（写入 change 2 `limit-reason-tool`/`data-tool-contract` 的待办条目，或本 change 的 Open Questions 7 引用行）
  - 验收：三项假设与 change 2 正文逐条对得上（可 grep `dateUnavailable` / `available` / `tradeDate`）；**本 change 内 `sessionRejected` 命中 0 次**（结构断言，扫描前先断言目标非空）
  - 依赖：5.1、`§12.8`、change 2 `limit-reason-tool` spec（**跨 change**，不阻塞本 change 实现）

## 6. 集成验收与门禁

- [ ] 6.1 端到端手工验收：选中 → 输入 → 落盘 ≤2 步、≤1 s；产物在 Obsidian 可读可检索、block 引用可跳转
  - 产物：**证据记录（证据格式强制：`命令` + `输出片段` + `产物路径`）**——例如 `pnpm test`（输出片段：用例数/耗时）+ 落盘产物绝对路径 `…/DB/review/202609/600000_…_20260924.md` + 关键片段摘录
  - 验收：三项证据齐备且可复现；缺任一项视为未验收
  - 依赖：1.x、2.x、4.x
- [ ] 6.2 数据面全断（拔网/停用源）下仍可落盘卡片（不阻塞输入）；B1 显示不可用 + 原因
  - 产物：证据记录（命令 + 输出片段 + 产物路径）
  - 验收：断网下提交成功且产物存在；首屏不白屏
  - 依赖：4.6、5.2
- [ ] 6.3 **结构断言（替代文本扫描，`§7`）**：① `src/routes/**`、`src/client/**` MUST NOT import `src/data/**`（允许 import service 类型）；② 除 `§7` 的两条具名出站通道（`src/data/http.ts`、`src/skill/download.ts`）外全仓零 `fetch(` / `http.request`（`test/**` 同样零 `fetch(`）；③ 页面层不含第三方 URL 与取数实现；④ 全链路无交易接口调用路径（`order_stock`/`cancel_order`）；⑤ 17709 无 HTTP 请求（仅可配置的 `net.connect` 探测）；⑥ 每类扫描用例先断言 `targets.length > 0`；⑦ **净化实现唯一**（不存在 `src/review/sanitize.ts`，净化只经 change 2 的 `src/paths/sanitize.ts`）；⑧ **时间格式化单点**（全仓仅一处 `+08:00` 偏移拼装，即 `src/review/format.ts`）；⑨ **告警字段名唯一**（全仓源码与前端资产 MUST NOT 出现 `storeWarnings` 标识符，一律 `warnings`）；⑩ **无幽灵状态名**（本 change 内 `sessionRejected` 命中 0 次）；⑪ `StoreWarningKind` 中不存在 `docMismatch`
  - 产物：结构断言用例（AST/依赖图，非 grep）
  - 验收：十一项断言全绿且「扫描目标非空」前置断言存在
  - 依赖：2.1、4.x、1.7、1.13、1.14、5.1
- [ ] 6.4 **文档任务（纳入门禁）**：① `docs/roadmap.md` —— §5「迭代一重排」已由 Lead 补入，本任务**仅引用**（若实现期间产生新裁决则增补对应行）；② `docs/architecture.md` —— 补复盘页面（同端口二级页面）、`DB/review` 产物位置、**「阶段 2 桥取消」结论**；③ `AGENTS.md` —— 「vault 写入」条目补 `DB/review/` 与 `agent/DB/temp/dsh-trader-kit/` 例外（阶段 4 起触 vault 的行文改为「除本迭代两条白名单路径外」）+「既定产物区」补 `DB/review/`；④ `vault-integration` 写分区契约补登 `DB/review/`、`agent/DB/temp/dsh-trader-kit/`（`§10`）
  - 产物：四处文档改动（diff 或引用章节号 + 摘录）
  - 验收：四项均有可指认的落点；③④ 须显式声明两条白名单路径；②须含阶段 2 桥取消
  - 依赖：`§10`、`docs/roadmap.md §5`
- [ ] 6.5 门禁：`pnpm typecheck && pnpm build && pnpm test` 全绿，且 **6.4 文档任务与 6.3 结构断言同属门禁项**（未完成视为未通过）
  - 产物：门禁运行输出片段（命令 + 结果行）
  - 验收：三条命令退出码为 0；6.3/6.4 勾选完成
  - 依赖：全部实现任务

## 7. 资产形态、打包与部署（**承载绑定层，`blocked_by: change 1`**）

- [ ] 7.1 资产形态定案与打包：二选一并落定——① 模板字符串内联进 `lib`（推荐，`src/client/review/index.html.ts`）；② copy 到 `lib/assets` 并写入 `package.json#files`；**构建产物 MUST 随包发布**（不得依赖源码目录）
  - 产物：形态决策记录 + 打包配置改动 + `package.json#files` 覆盖证明
  - 验收：`pnpm build` 后 `lib` 内含资产；`npm pack` 产物内可找到该资产
  - 依赖：`blocked_by: change 1`、4.1
- [ ] 7.2 **回退分支部署资产、读通道分档与写入裁决**：若 spike 判定 `file://` 就地，记录仓库源文件路径 + 构建/复制命令 + 目标路径（`D:/TDX_HOME/webs/company/`）+ 版本标识/时间戳；页面或响应头暴露版本；跨源策略（CORS + Private Network Access，仅放行就地页来源，MUST NOT `*`）；**写入只走 A 层**——该分支 cookie 跨源不携带 → A 层不可用 → 写接口**显式不可用**（明确错误 + 提示 + 页面只读降级），MUST NOT 用 B 层诊断 token / 未认证 loopback 承接写入；**读通道分档**——C 层未签字前 MUST NOT 提供未认证读（只交付文档形态 + 显式「取数不可用」空态，MUST NOT 以「只读页面」暗示取数可用、MUST NOT 用 B 层兜底读）；C 层签字后仅按签字所载**显式放宽点**（来源 / 方法 / 路径白名单）提供只读，放宽点记 `docs/roadmap.md §5`；**写入只认 A 层不受 C 层签字影响**
  - 产物：部署脚本/说明 + 版本标识注入点 + CORS 配置 + 写接口不可用态（错误码 + 提示）+ **读通道分档判定与「取数不可用」空态**
  - 验收：spec「回退分支」5 场景通过；版本可从页面或响应头读取；**A 层不可用时写请求被拒且零落盘、页面只读降级**；**读通道断言**：C 层未签字时 `/api/local` / `/api/enrich` 返回显式不可用且不返回任何数据（断言响应体不含卡片/名称/标签）、页面显示「取数不可用」空态；签字后放宽点内只读、范围外被拒
  - 依赖：`blocked_by: change 1`（承载结论）、2.2、2.4

## 8. Requirement ↔ task ↔ 测试/证据 映射（评审 Issue 16）

| Requirement（spec） | task | 测试 / 证据 |
| --- | --- | --- |
| 页面路由与标的上下文 | 2.1 / 2.3 / 3.1 | 2.5（传参优先级/归一化/path 段/探针共存）；2.6 |
| 本地段与网络段 MUST 为独立请求 | 2.1 / 2.6 / 4.6 | 2.6（≤500 ms + 纯本地结构断言）；4.6（挂起网络段仍出屏） |
| 认证分层与写入通道的 A 层依赖 | 2.2 / 2.8 | 2.8（`createReviewHandler(deps)` + 请求桩驱动）；2.5（未认证写被拒 / 仅带 `?token=` → 401 / B 层写请求被拒 / **A 层不可用时写接口拒绝 + 只读降级**）；7.2（回退分支：写入同断言 + **C 层未签字时读接口不返回数据**） |
| 写入接口入参校验与幂等 | 2.1 / 4.4 / 2.7 / 2.8 | 2.7（4xx 逐项 + 零写入，经 2.8 请求桩）；1.12 + 4.4（同 `clientRequestId` 单卡） |
| 名称三级兜底的分层归属 | 1.5 / 4.2 | 1.5 桩测试（层①/③ 零网络，层② 只在 enrich）；4.2（`code-only` 时补位替换、层① 不被覆盖） |
| 四区块布局 | 4.1 | 4.8（窄视口可断言值 + 焦点顺序） |
| 交互态与输入法 | 4.1 / 4.4 / 4.8 | 4.8（五态 + `isComposing` + 焦点顺序） |
| B1 头部数据与独立降级 | 4.2 / 5.2 | 5.4（源不可用降级）；4.2 |
| B1 有界回溯的量化边界 | 5.1 / 5.2 / 5.5 / 5.6 | 5.3（四类桩：`rateLimited`/`sourceError`/`businessDate≠requestedDate`/`dateUnavailable`）+ 5.4（命中即停/达上限/全不可得）+ 5.5（推进算法：响应业务日前推、`null`、不得漏检）+ 5.6（跨 change 对齐登记） |
| B2 日期组件与历史读回 | 4.3 | 4.3 场景测试 + 3.3 |
| 多命中文档的显式告警 | 1.10 / 4.5 | 1.10（两名命中）+ 4.5（页面展示） |
| 联动切换标的的未提交内容保护 | 4.7 | 4.7 状态机单测 |
| 输入与提交 | 4.4 | 4.4（防重/失败保留/重试）+ 1.12 |
| 数据面不可用不阻塞输入 | 4.6 / 6.2 | 6.2（断网落盘证据） |
| 静态资产安全与打包 | 2.4 / 2.5 / 7.1 | 2.5（MIME/穿越/无外链）+ 7.1（pack 产物） |
| 回退分支 | 7.2 | 7.2 五场景（写：A 层不可用 → 写入不可用；读：C 层未签字 → 取数不可用 + 空态、签字后按放宽点只读；跨源；版本可辨） |
| 存储路径与文件粒度 | 1.4 / 1.7 | 1.6 / 1.7 |
| 文件名与 frontmatter 值净化 | 1.7（经 change 2 唯一实现） | 1.7（净化场景集 + 「不另建净化实现」结构断言） |
| 文档结构与卡片分节 | 1.2 / 1.3 | 1.6（锚点唯一/分节结构） |
| frontmatter 最小键 schema | 1.1 / 1.11 | 1.11 |
| 解析与幂等规则 | 1.2 / 1.3 | 1.6（幽灵/重复/代码块/正文 `##`） |
| 追加/插入语义与原子写 | 1.4 | 1.6（插入位置/原子写/预留键） |
| 「既有内容不变」的精确口径 | 1.1 / 1.4 | 1.9（CRLF/BOM/无尾换行/既有行不变 + 新增键追加） |
| 可复用写入接口契约 | 1.12 / 1.14 | 1.12 契约测试（五导出均含 `warnings`、`DOC_MISMATCH`）；1.14（类型与编码） |
| 时间格式化单点 `src/review/format.ts` | 1.13 | 1.13（`writtenAt`/`generatedAt` 同源 + 唯一 `+08:00` 结构断言） |
| 并发写纪律 | 1.4 | 1.8（并发两条保留 / stat 不一致 / `CONCURRENT_WRITE`） |
| 多命中文档的确定性选择 | 1.4 / 1.10 | 1.10 |
| 交易日归属 | 3.1 / 3.3 / 3.4 | 3.3（确认后落盘 + `value===null` 默认留空）+ 3.4（不 fallback 系统日期） |
| 提交幂等（clientRequestId） | 1.4 / 1.12 | 1.6 / 1.12（同 id 重复 → 既有锚点） |
| `warnings` 的呈现契约 | 1.4 / 1.14 / 4.5 | 1.14（编码/`kind` 可解析、空告警仍返回字段、枚举无 `docMismatch`）+ 4.5（页面展示）+ 6.3⑨（字段名唯一，无 `storeWarnings`） |
| 卡片回显与引用 | 4.5 | 4.5 场景测试 |
| 渲染安全与格式边界 | 4.5 | 4.5（转义）+ 6.1（产物仅 md） |
| 写盘失败可重试 | 1.4 | 1.6（占用后重试成功）+ 1.8 |

### 证据格式（6.x 强制）

每条验收任务 MUST 落三项证据：① **命令**（可复制执行）；② **输出片段**（关键行，含用例数/退出码/耗时）；③ **产物路径**（落盘 md 的绝对路径或 `npm pack` 产物内路径）。仅写「手工验收通过」不构成证据。
