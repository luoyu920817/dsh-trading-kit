# 第二步：卡片变更事件、任务存储与结果失效

状态：详细设计草案。本文件是后续后台执行和页面状态的共同契约。

## 1. 为什么需要卡片级记录

现有卡片锚点包含交易日、六位代码和时间，但不含市场；现有 AI 附注又按标的和交易日去重。仅用这两个现有标识，不能可靠区分同码指数与股票、同一天多张卡片、同一张卡片的多个模块和不同编辑版本。

本设计新增“具体卡片身份”“输入版本”“模块处理任务”三层。源 Markdown 继续是用户正文权威，JSON 是可恢复的任务状态和有来源的衍生成果，不代替用户正文。

## 2. 文件清单

| 文件 | 新增/修改 | 具体职责 |
| --- | --- | --- |
| `src/review/processors/identity.ts` | 新增 | 规范相对文档路径、计算卡片编号和正文/图片版本 |
| `src/review/processors/records.ts` | 新增 | 任务与跟踪 JSON 读写、版本比较、进程内互斥和原子替换 |
| `src/review/processors/reconcile.ts` | 新增 | 有界扫描源卡片，补漏任务、核实来源消失、发现版本变化 |
| `src/review/processors/index.ts` | 新增 | 总装配、为存储绑定提交观察器、服务出口和生命周期 |
| `src/review/processors/types.ts` | 增补 | 本文件定义的身份、事件、任务、结果、跟踪记录类型 |
| `src/review/store.ts` | 修改 | 四种成功变更的锁内快照与提交观察器；版本保护提交；不折叠路径的完整性扫描 |
| `src/review/index.ts` | 修改 | 绑定存储观察器；把修改/删除出口与路由统一接到同一个绑定服务 |
| `src/routes/review.ts` | 修改 | 使用绑定后的四个存储出口，不自行发另一份事件 |
| `src/paths/mapping.ts` | 修改 | 登记 processorRecords 与 processorSettings 业务区域 |
| `src/tools/review-daily.ts` | 修改 | 补齐 qualifier/market 相关类型，不改变旧字段含义 |
| `test/processors/identity.test.ts` | 新增 | 跨市场、文档路径、锚点、正文和图片版本 |
| `test/processors/records.test.ts` | 新增 | 真实 JSON 文件、原子失败、并发与版本冲突 |
| `test/processors/commits.test.ts` | 新增 | 真实卡片存储成功/失败与变更观察 |
| `test/processors/reconcile.test.ts` | 新增 | 漏事件、重启、删除、损坏文件和恢复窗口 |

## 3. 卡片身份与输入版本

### 3.1 身份字段

```ts
interface ProcessorCardIdentity {
  cardId: string;
  relativeDocumentPath: string;
  anchor: string;
  security: SecurityId;      // 复用 market: sh/sz/bj/null 与六位 code
  declaredMarket: MarketPrefix;
  marketEvidence: 'explicit' | 'file-prefix' | 'legacy-file';
  tradeDate: string;         // YYYY-MM-DD
}
```

`cardId` = 对 `[规范相对文档路径, anchor]` 做 SHA-256。路径以 dataRoot 为根，规范成 `/` 分隔，禁止绝对路径和 `..`，由实际已定位文档提供，模型不能传入路径。哈希使用完整 64 个十六进制字符。

路径不是从证券名称重新猜出来的。卡片定位继续使用当前 `locateDoc` 的市场过滤、名称与旧文件兼容规则。新接口携带身份和实际定位路径，不能只传裸六位代码。

采用实际文档路径，是为了避免两个同市场同代码的异常候选文档里存在同样锚点时被错误合并。**本轮不自动识别外部文档改名的等价关系**：外部改名视作旧来源消失、新来源出现，历史结果保留并标明旧路径。插件现有名称变更复用规则不主动改名，因此正常写卡不会因此迁移。

`declaredMarket` 仅延续存储定位与显示口径。`legacy-file` 推断不是调用指数或股票数据接口的权限；取数仍需要明确市场与相应资产支持，不能用显示推断绕过当前数据边界。

### 3.2 输入快照

```ts
interface ProcessorCardSnapshot {
  identity: ProcessorCardIdentity;
  writtenAt: string;
  body: string;
  images: Array<{
    imageId: string;
    relativePath: string;
    available: boolean;
    mimeType: string | null;
    contentHash: string | null;
  }>;
  sourceRevision: string;
}
```

`sourceRevision` = 按固定顺序序列化原始 body 与去重图片引用的 `[relativePath, available, contentHash]` 后做 SHA-256。图片字节必须实际读取后计算，不仅比较文件名/mtime；同名文件内容改变也会使输入失效。图片缺失记 `available: false`、`contentHash: null`，不凭空补图。

图片读取复用 `src/review/images.ts` 的 `readImageFile` 校验。单图、总量沿已有上传限制；失败进入 warnings，不使已提交的文字卡片变成失败。

解析器返回的位置针对 snapshot.body。所有模块取得同一冻结快照。历史、角色和市场证据在执行前单独冻结，形成 `contextRevision`，记录本次实际上读取了哪些内容；它不修改源卡片版本。

## 4. 卡片提交观察器

### 4.1 为何放在存储成功出口

HTTP `POST /api/card` 不是唯一写入口，`traderKit.review.appendCard` 也能直接写卡。只在页面或 HTTP handler 发事件会漏 service 使用者。新增、编辑、整卡删除、删除单图，都在 `src/review/store.ts` 的真实提交成功出口生成通知。

```ts
interface ReviewCardCommit {
  operation: 'created' | 'updated' | 'deleted';
  identity: ProcessorCardIdentity;
  previousSnapshot: ProcessorCardSnapshot | null;
  nextSnapshot: ProcessorCardSnapshot | null;
  committedAt: string;
}
```

新增没有 previousSnapshot，删除没有 nextSnapshot；更新同时提供两者。删除事件必须在删除前捕获身份和旧正文，不能等收到事件后重读已消失的锚点。

### 4.2 最小接线方式

存储输入增补可选 `onCardCommitted` 观察器，默认未提供时行为与当前一致。它是正式生产接口，不复用 `setStoreWriteHooksForTest`。`src/review/index.ts` 建立绑定后的存储函数，为所有公开写服务和路由统一注入观察器。原始导出继续可被现有测试或非装配调用使用。

拟新增存储入口：

- `appendCard`：观察器传入内部追加流程；仅 `kind === 'card' && status === 'created'` 通知。
- `updateCard`、`deleteCard`、`deleteCardImage`：统一传入 `transformDailyDoc`，实际文档原子替换成功后通知。
- `appendAinote`：不通知，不把 Agent 写作当用户新意图。

幂等重提返回 `duplicate` 时不重复发布“创建”事件。若当时事件登记遗漏，由恢复扫描补齐，而不是伪造新创建。

通知发生在现有卡片锁内，包含与本次提交一致的快照。观察器只做本地任务登记及失效标记，不取行情、不检索全历史、不创建 Agent。成功登记后，通过内存唤醒通知调度器；内存通知只是加速信号，不是唯一事实源。

### 4.3 用户正文和任务 JSON 不是跨文件事务

源 Markdown 已保存、任务 JSON 登记失败时：

1. 保留已成功保存的卡片，不回滚、不返回“写卡失败”。
2. 原写结果 `warnings` 增加具体路径和原因：“卡片已保存，后台任务登记失败，可重扫恢复”。
3. 页面显示保存成功和独立后台告警，不能让用户重复保存正文来重试 Agent。
4. 恢复扫描依据实际源卡片重建遗漏任务。

这是明确的可靠性边界，不称作“事务性事件队列”。现有本地原子写只能保证一份文件不半截，不能保证 Markdown 与 JSON 同时成功。

## 5. 任务、结果和文件布局

### 5.1 权威文件布局

```text
DB/review/
  processing/
    settings.json
  202610/
    sh000001_上证指数_20261008.md
    processing/
      <cardId>/
        jobs/
          <jobId>.json
        tracking/
          <expectationId>.json
```

尖括号表示由框架计算的完整哈希编号，不是用户输入的文件名。任务按来源卡片月份存放；次日回查和跨月确认继续更新同一来源月份下的跟踪记录。

`processorRecords` 目录映射为 `DB/review/<YYYYMM>/processing`，`processorSettings` 为 `DB/review/processing/settings.json`。这些属于既有 DB/review 白名单。子路径仅由验证过的哈希和固定目录名组成，通过 `resolveArea` 与 `resolveRelativeUnderRoot` 两层检查；读写时继续拒绝符号链接越界。

一份 job JSON 同时保存任务状态和经校验的结果。**没有另一个需要同步成功标志的 result 文件**，从而减少第二次跨文件提交缺口。图片字节不进入这些 JSON，只保留相对引用、内容指纹及宿主附件引用元数据。

现有顶层 Markdown 清单只扫描合法复盘文档，不能把 processing 子目录当作卡片。测试同时确认 summary.md、processing/settings.json、job JSON 都不会增加卡片数。

### 5.2 核心任务字段

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 记录格式版本，第一版为 1 |
| `recordVersion` | 每次原子更新递增，用于状态写入冲突 |
| `jobId` | 对requestGroupKey、cardId、sourceRevision、processorId、routeRevision、generation及后续检查的证据版本做规范序列化后计算哈希；当日分析的检查证据版本为null |
| `processingKind` | cardProcess（当日卡片分析）、expectationCheck（预期回查）、patternCheck（模式观察） |
| `requestGroupKey` | 当日分析按cardId+processorId+cardProcess分组；后续检查按trackingId+processingKind+targetTradeDate分组 |
| `trackingId` / `targetTradeDate` | 后续检查的具体条目及目标交易日；当日分析为null |
| `generation` | 同一requestGroupKey的单调请求序号；新输入、重新处理、撤回后恢复均递增；自动重试不递增 |
| `processorId` / `routeRevision` | 模块身份及执行时配置/Skill版本 |
| `executionProfile` | 实际处理种类对应的handler/Skill、outputSchema、context与资源版本快照 |
| `sourceSnapshot` | 触发时的用户卡片快照，作为当时证据 |
| `mentions` | 触发该模块的全部原文位置 |
| `optionsSnapshot` | 本次冻结的有效业务参数 |
| `executionState` | 排队、运行、重试或完成等状态 |
| `applicability` | 结果是否仍对应当前卡片和配置 |
| `attemptCount` / `attemptToken` | 已启动尝试总数和本次执行能力凭据；第一次实际启动即计为1，尚未启动不计数 |
| `attempts` | 已启动尝试的追加记录，含startedAt、provider、model、sessionId及attemptToken；跨日预算按每条startedAt的东八区日期统计 |
| `preparationToken` | 领取/预检阶段凭据，不代表已经启动模型尝试 |
| `sessionId` | 本次后台 Agent 会话编号，可空 |
| `createdAt` / `startedAt` / `finishedAt` | 东八区有偏移时间，统一复用现有格式函数 |
| `nextAttemptAt` | 调度退避唤醒时刻，可空 |
| `contextRevision` | 实际上下文快照指纹，可空 |
| `result` | 经当前模块 schema 校验的结果信封，可空 |
| `error` / `warnings` | 具体错误码、中文说明和非致命缺失 |

结果信封含 `outputSchema`、`processorId`、`sourceRevision`、`routeRevision`、`generatedAt`、`evidence`、`payload`和`declaration`。declaration由框架固定写入现有DECLARATION_LINE，模型不能改写；payload 由模块校验器验证，不是无约束的 `content: {}`。数据任务也记录startedAt和attemptToken，provider/model/sessionId为null；只统计有实际Agent启动记录的尝试进入每日Agent预算。

**当前请求选择**：完整读取同卡片jobs目录后按requestGroupKey筛选，generation最大的记录为该组当前选定请求；同序号重复或读取不完整报冲突，不猜mtime。创建新请求在该组锁内取最大值+1并写盘。最大记录落盘是选择切换点，不维护第二份current指针。只有该请求同时匹配当前正文、有效配置、有效跟踪来源且模块启用时结果才是current；旧generation永远不能重新成为当前结果。jobId的哈希材料同时加入requestGroupKey和后续检查的证据版本，防止不同检查条目复用记录。

当日cardProcess选中结果用于卡片主展示；expectationCheck与patternCheck分别更新各自跟踪条目，不参与当日分析的generation竞争，也不会挤掉原句整理。后续检查还必须核验跟踪对象仍未撤回、引用的来源分析generation仍有效。

### 5.3 两种状态必须分开

执行状态 `executionState`：

| 值 | 页面含义 | 是否可能继续执行 |
| --- | --- | --- |
| `queued` | 等待处理 | 是 |
| `preparing` | 正在核验上下文和能力 | 尚未启动模型，不计实际尝试 |
| `waitingCapability` | 缺模型、Skill、宿主服务或日期能力 | 能力恢复后可以 |
| `running` | 正在处理 | 本次尝试执行中 |
| `retryWaiting` | 暂时失败，等待重试 | 是 |
| `succeeded` | 结果已通过校验并保存 | 自动不重复 |
| `failed` | 本次处理未完成，显示原因 | 显式重试可继续 |
| `skipped` | 已确定不适用，例如不支持的标的 | 不自动重试 |
| `canceled` | 任务被关闭或来源撤回 | 不执行 |

适用状态 `applicability`：`current`（仍是当前版本）、`sourceChanged`（正文或图片改变）、`sourceRemoved`（卡片或标记删除）、`configurationChanged`（配置/Skill改变）、`sourceUnverified`（文件暂时无法核验）。已经成功的历史结果仍是 succeeded，但可以不再 current。

预期的“兑现、证伪、失效”是另一个业务状态，不能塞进 executionState。

## 6. 原子更新、锁顺序和旧结果防护

`records.ts` 沿当前 brief/run-report 的模式使用本模块私有 Promise 锁、同目录临时文件、rename 和失败清理。没有可直接复用的通用导出，因此只实现本模块所需的少量记录写入；不把现有三个存储文件整仓重构成新抽象。

任务领取在请求组锁和job锁内将queued改为preparing，生成preparationToken后释放锁。上下文和能力预检不增加attemptCount。创建Agent成功且即将followup，或数据请求即将发送时，短锁内复核后才写running、增加attemptCount并生成attemptToken。任何网络或模型执行都在锁外。

结果提交采用 `src/review/store.ts` 新增的 `withVerifiedCardSnapshot` 服务：

1. 取得与当前卡片写入完全相同的现有锁；锁键继续沿原来的月份、代码和交易日语义，不擅自增加 market 分割锁。
2. 按记录的规范relativeDocumentPath直接读取这份文档，核对security/tradeDate/anchor和正文图片版本。不得重新按名称/mtime选另一份候选；旧路径缺失不能追随同码另一文档。
3. 条件不满足则拒绝成为当前结果；原任务标记不适用，不能覆盖新任务。
4. 条件满足时，在卡片锁内依次取得配置锁、请求组锁和job锁，核对有效routeRevision、当前最大generation/jobId、recordVersion/attemptToken并原子写入result+succeeded。关闭模块、切配置或新generation不能与该短提交交错。
5. 释放锁后通知页面可读取新状态。

锁顺序固定为“卡片锁 → 配置锁 → requestGroupKey请求组锁 → job/跟踪记录锁”。不需要源卡片的操作可从后面某层开始，但不得倒序等待。设置保存只持配置锁及其设置文件锁，不在锁内发起卡片或任务失效；通知在释放后处理。调度领取组/job锁后先释放，再进行源核验，不能反向等卡片锁。网络、Skill运行、历史检索不在这些锁内。若一次动作涉及多个请求组/记录，按完整键字典序取得同层锁，禁止互相倒序。

防重试迟到还要校验 attemptToken：第一次尝试超时，第二次已经启动时，第一次即使晚到也不能提交。提交工具闭包绑定它，模型不选择凭据。

## 7. 修改、删除和重新处理

- **保存相同内容**：计算出的 sourceRevision 未变；已有 current 任务复用，不重跑。
- **编辑正文或删除图片**：旧任务 sourceChanged，运行中的请求协作取消，新版本按仍在的标记建立任务。
- **删除标记**：对应模块任务 sourceRemoved，停止未来回查；其他模块独立继续。
- **删除整卡**：按 cardId 使所有任务和预期跟踪失效，不依赖删除后重新读正文。
- **图片文件在外部被同名替换**：版本复核与重扫发现指纹变化，按图片改变处理。
- **显式重新处理**：保留旧结果，generation 递增；界面展示最新 current 结果，并可展开旧版本。
- **网络重试**：同一 generation、attemptCount 增加，成功提交只接受当前 attemptToken。
- **暂时无法读源文件**：标为 sourceUnverified，不认定用户删除、不自动核销预期。
- **撤回后还原相同原文或重新开启模块**：不能复用canceled/sourceRemoved终态。创建新的generation；历史withdrawn预期仍撤回，新请求建立独立跟踪编号（编号包含generation），避免意外复活人工已确认的旧记录。

框架不自动删除历史 JSON；来源撤回会停止调度并隐藏当前结果。清理历史是独立后续功能，不能借取消任务永久删掉证据。

重新处理当日分析时，旧未结束跟踪标记withdrawn/reprocessing，已确认历史保留；新请求成功后才从其结果登记新的跟踪。恢复时只物化当前选中的成功cardProcess结果，历史旧结果不产生新的活跃跟踪。

## 8. 漏事件修复与重启恢复

恢复入口有三个：插件启动、页面读取当前卡片状态、用户显式重扫。不能依赖 fs.watch 作为主要触发，也不能把 OneDrive mtime 当唯一版本。

启动恢复默认扫描最近7个自然日的本地复盘文件；这只是I/O范围，不推断交易日。同时遍历非终态任务、未结束跟踪和succeeded但trackingReady=false的预期/模式当日任务，**不受7日窗口限制**。成功result是来源权威，跟踪是可幂等物化的业务记录。物化前重新核当前generation、来源、配置和资源版本；过期结果不创建活跃跟踪。物化失败在启动、显式重扫和调度空闲恢复时重试，不漏掉后续回查。

恢复流程：

1. 读取 settings 和有效注册表。
2. 真实读取任务文件；损坏文件保留原字节，作为独立告警，不静默重写。
3. 对原running/preparing任务标记尝试中断；本轮不自动恢复旧Agent会话。核验源版本后preparing可重新预检，running在剩余尝试额度内重新排队，次数耗尽则failed并供显式重新处理。
4. 对已有任务核验源存在、标记、版本和配置，撤回旧来源和旧版本。
5. 对窗口内本地卡片逐张解析，补建没有记录的任务。相同指纹不重复建。
6. 更新页面读模型并唤醒调度器。

不能直接把现有scanDailyCardTargets当完整枚举：它会跳过某些读取失败并把同市场同码候选折叠成一个winner。新增 `scanProcessorSourceDocs`（store.ts正式导出）复用合法文件名和归属规则，但保留每个实际文档路径，并返回 `{documents, complete, errors, continuationCursor}`。新扫描不取行情、不选候选winner、不调用带预算的review_daily_scan。扫描上限默认500张卡片、分页100张；未完分页complete=false，页面显示尚未扫描数量。

若源目录读取失败、候选文档出现冲突或解析告警使身份不可确认，则 sourceUnverified，保留记录。只有完整成功扫描或直接确证锚点已删，才可认定 sourceRemoved。空列表和读失败不能混用。

## 9. 本步骤验收场景

1. 通过 HTTP 和 service 写入同样卡片，两者均登记任务；直接原始 store 未传观察器时仍通过旧测试。
2. 源文档失败：不产生提交事件、不创建任务。JSON 登记失败：卡片成功，告警明确，重扫后恢复。
3. duplicate 请求不产生第二个任务；新增、编辑、整卡删除、单图删除四种通知完整。
4. 同一天同代码沪深两份文档、相同锚点，cardId 和结果不同，身份不互串。
5. 相同文件名图片被实际换字节，sourceRevision 改变。
6. Agent A 执行时用户编辑，A 迟到结果无法变成 current；版本 B 的提交不被 A 覆盖。
7. 第一次尝试超时后返回，不能使用旧 token 修改第二次尝试。
8. JSON 原子替换失败、并发设置冲突、损坏文件和外部文档临时读失败均不破坏源 Markdown。
9. 重启恢复原 running 任务，去重后只建立一次新尝试；已登记的跨月预期不因恢复窗口被遗漏。
10. sourceRemoved 和 sourceUnverified 展示不同，后者不能被误认为用户取消预期。

多进程同时写同一个 dataRoot 不属于本轮支持范围：沿当前单 profile 单写者契约。恢复记录不宣称分布式锁或严格一次执行；保证的是结果版本校验、幂等登记和可恢复遗漏。

OneDrive/Obsidian等外部进程不持插件锁。对外部文件变更只能通过提交前内容核验和随后读接口/扫描复核发现，不宣称跨进程强事务；外部修改竞态产生的结果在再次核验后必须转为非current，不能长期使用。
