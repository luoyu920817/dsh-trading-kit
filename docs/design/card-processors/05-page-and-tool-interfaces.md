# 第五步：页面交互、HTTP接口与Agent工具

状态：详细设计草案。本文件定义前端看到的对象和可以执行的操作；存储和调度统一使用前述服务。

## 1. 文件清单

| 文件 | 新增/修改 | 具体职责 |
| --- | --- | --- |
| `src/routes/review-processors.ts` | 新增 | 后台处理API的纯分派与参数校验，调用绑定service，不自行鉴权 |
| `src/routes/review.ts` | 修改 | 在现有认证外壳内接入新分派、登记路由和POST写凭据白名单 |
| `src/tools/review-processors.ts` | 新增 | 普通Agent的只读结果工具与显式重扫入口，双出口共享实现 |
| `src/client/review/processor-view.ts` | 新增 | ES2017兼容的纯展示数据与状态标签函数，供现有HTML内联 |
| `src/client/review/index.html.ts` | 修改 | 输入提示、卡片结果块、设置面板、轮询、重试及人工确认按钮 |
| `src/client/panel/Panel.ts` | 修改 | DSH复盘面板显示后台概览和待确认数量，不自动发聊天 |
| `src/review/processors/index.ts` | 增补 | 暴露读状态、设置、重新处理、重扫和确认service |
| `test/processors/api.test.ts` | 新增 | 真实HTTP处理、参数、来源、凭据、冲突和副作用 |
| `test/routes-review/review-processors-page.test.ts` | 新增 | HTML脚本真实vm执行、异步状态过期保护及编辑保真 |
| `test/processors/tools.test.ts` | 新增 | tool/schema/service结果一致、读工具无模型启动副作用 |

现有复盘页含大量内联脚本。仅把新增纯展示/状态函数放在新文件并沿现有函数序列化方式内联，不借本功能重构整个页面。TDX最低基线继续ES2017/Chromium81；不使用optional chaining等未验证内联语法。

## 2. 用户实际看到的界面

### 2.1 输入区

textarea下显示“将处理：概念数据、预期回查”。识别结果随输入本地更新，不启动模型。未知标记显示“未注册关键词：预期指数”，不阻止保存。已知但关闭的模块显示“模式分析：已关闭”。

第一版提供一个“可用关键词”小列表，点击插入 `@名称`；不引入富文本编辑器。插入保留当前光标、现有图片引用和草稿。解析的注册表摘要从后端读取；不能在浏览器维护另一份别名词表。

后端仍对保存后的实际正文再解析，不把前端传来的processorIds当权威。

### 2.2 保存与结果展示

保存成功立即清理既有成功保存草稿，保持目前行为；后台状态单独出现。不能让模型运行时间延长保存disabled状态，也不能自动修改下一张卡片的输入框。

每张卡片按模块展示：名称、中文执行状态、结果摘要、展开按钮。展开后依次为用户原句、机器整理、数据/历史依据、缺失项、处理时间和配置版本。不同来源明确标注。

示例展示文案：

```text
预期回查 · 已整理 · 等待下一交易日数据
原句：明天观察核心票是否重新走强。
整理：走强尚无数值标准，需要人工判断。
依据：本卡片原句；历史卡片2条。
```

这是展示文案示例，不是实际任务结果。`@预期`可以显示为状态标签，但原卡片文本与编辑框保留完整原文。

### 2.3 失败、关闭和过期

- 失败：显示具体原因及“重新处理”，不自动把正文重保存一次。
- 缺能力：显示缺模型/Skill/图像/市场证据的哪个环节；重试前做预检。
- 旧版本：显示“卡片已修改，此结果对应修改前内容”，可展开历史，不当当前结果展示。
- 关闭模块：停止任务，但已生成的历史仍可查看。
- 源文件暂时读失败：显示“来源暂时无法核验”；与“卡片已删除”分开。

### 2.4 配置面板

页面右侧或可折叠区域显示四个模块的名称、功能说明、开关、允许参数和能力状态。技能名称、handler、输出schema、写目录是只读信息，不提供任意输入框。

保存设置单独按按钮提交，不跟每次文字输入一起写盘。每次保存携带settingsRevision。发生409时保留用户填写值、显示最新设置差异，不静默覆盖另一个页面。

### 2.5 预期人工确认

提供“确认兑现”“确认证伪”“确认失效”“继续保留”四个动作。依据机器建议时basis=evaluation，必须传当前evaluationId和跟踪recordVersion。没有机器评价或人自行裁决时basis=manual，evaluationId=null并要求非空理由。继续保留必须有理由和更晚的新目标，且日期经provider验证；未知交易日不能默默写成明天。

这些操作只修改本功能的跟踪JSON；不会修改原用户卡片、股票档案或模式权威。

## 3. HTTP路径与职责

所有路径前缀为 `/dsh-trader-kit/review/api/processing`。新文件负责参数/业务分派，现有review.ts负责同端口注册、Host/Origin栅栏、cookie和回环密钥检查。不得新造免认证写入口。

| 方法/后缀 | 入参 | 返回与副作用 |
| --- | --- | --- |
| GET `/registry` | 无 | 可展示模块、别名、editableOptions、有效设置版本及能力；不泄露密钥或绝对配置路径 |
| GET `/cards` | `code, market?, date, anchors?` | 定位文档并读逐卡片current状态、结果、warnings；仅本地版本复核，不调用模型/网络 |
| GET `/jobs` | `cardId, processorId?, cursor?` | 该卡片处理历史，分页，每页最多20条；不返回attemptToken |
| GET `/expectations` | `code?, market?, state?, cursor?` | 预期清单、目标日、建议和确认状态 |
| GET `/health` | 无 | 队列计数、等待能力、日任务额度、恢复扫描进度 |
| POST `/settings` | `settingsRevision, processors` | 校验允许参数并原子保存，成功200，版本冲突409 |
| POST `/reload` | 无 | 明确重载后端注册表并预检能力；失败保留旧配置 |
| POST `/retry` | `cardId, processorId, expectedSourceRevision` | 在当前版本上新建generation，成功202并返回jobId |
| POST `/rescan` | `dateFrom, dateTo, cursor?` | 分批本地修复任务，成功202；最多31个自然日/请求 |
| POST `/confirm` | `expectationId, recordVersion, basis, evaluationId, action, reason?, newTargetTradeDate?` | 按上述evaluation/manual联合条件复核并保存，成功200，过期409，日期能力不足503 |
| POST `/pattern-confirm` | `observationId, recordVersion, sourceJobId, expectedSourceRevision, routeRevision, patternId, definitionRevision, action, reason?` | 仅accept/reject候选；复核当前原分析、目录及版本，写观察记录，成功200，过期409 |

POST主体上限64KiB；它们不接收图片上传、任意Prompt、任意输出payload或文件路径。代理提交结果走scoped工具，不开放网页 `/submit` 接口。

### 3.1 读接口不启动任务

读取 `/cards` 可发现sourceRevision变化并返回outdated标记，但**GET本身不排队新模型任务**，避免页面刷新/轮询成为隐含付费触发。启动恢复、正式提交事件、显式retry/rescan负责登记和唤醒。发现遗漏时GET返回 `reconciliationNeeded: true`，页面可以提示“需要重扫”，不自动发POST。

总览里“页面读取时恢复”在这里精确限定为本地核验与发现遗漏，不代表读取就运行Agent。实际恢复重建由已授权启动流程或用户显式重扫完成。

### 3.2 响应身份

所有卡片对象返回cardId、relativeDocumentPath、anchor、security{market,code}、tradeDate、sourceRevision。历史与结果不能只用六位code拼接。GET请求定位与现有页面market解析一致；不能把已有显式市场丢掉。

结果数组每个对象带processorId、executionState、applicability、routeRevision、generatedAt、payload和evidence。页面只按这些结构判断，不解析中文错误文本来决定业务状态。

### 3.3 统一错误码

400：INVALID_PARAMETER、INVALID_SETTING、UNKNOWN_PROCESSOR；404：CARD_NOT_FOUND、JOB_NOT_FOUND、EXPECTATION_NOT_FOUND；409：SOURCE_VERSION_CONFLICT、SETTINGS_VERSION_CONFLICT、TRACKING_VERSION_CONFLICT；503：PROCESSING_CAPABILITY_UNAVAILABLE。

鉴权失败沿已有401/403语义。某个模块缺能力不使整份 `/registry` 或 `/health` 503；它在模块capability里说明。retry不满足运行条件时返回503并解释缺什么。

## 4. 新路由必须复用原鉴权外壳

接入时需要同时更新review.ts的三处：路由注册列表、API分派、允许回环密钥认证的POST路径列表。漏一处会使TDX内无cookie时的操作不可用。

现有GET免认证仅限loopback读取，403跨站拒绝仍然拒绝。新写操作仍使用宿主cookie或现有回环+x-write-key规则。复用当前鉴权实现，不借本功能扩大读取范围或改变socket缺省处理。

POST reload/rescan/retry都可能安排模型工作，所以不能放到GET或免写凭据通道。pattern-confirm与预期confirm使用同样写凭据，页面结果块显示接受/排除候选动作；GET/cards中每个候选附observationId、recordVersion及当前确认状态。settings必须白名单参数校验，不能通过页面写provider凭证、handler路径或任意工具名称。

## 5. Agent可用的普通工具

`src/tools/review-processors.ts` 提供以下全局出口，与service共用实现：

| 工具 | 目的 | 运行模型或写状态 |
| --- | --- | --- |
| `review_processor_list` | 查看模块和可用配置 | 否 |
| `review_processor_results` | 读取指定卡片当前/历史结果和证据 | 否 |
| `review_expectation_list` | 读取待回查、待确认预期 | 否 |
| `review_processor_rescan` | 用户明确要求时分批重扫 | 会登记任务，工具说明和schema必须明确 |

首版不提供全局“机器确认预期”工具，最终确认由页面人工动作完成。日汇总Skill可只读引用模块结果，但不自动据此改用户判断或修改旧patterns/drafts。

后台专用context/image/submit三工具见第3份文档，仅注册在独立Agent作用域。模型不能通过全局结果工具把任意文本冒充成功结果。

工具输出完整保留security和来源。没有found结果时返回明确空对象/缺失原因，不用日汇总附注替代新模块结果。

## 6. 页面异步更新与不打断输入

第一版复用Fetch轮询，不新增SSE/WebSocket。页面可见且有queued/running/retryWaiting任务时每3秒读一次当前卡片状态；其他状态每15秒更新概览；页面hidden停止轮询。

每次请求携带页面viewSequence和当前 code/market/date。切换标的、交易日或重新装载卡片后sequence递增。迟到的旧响应只丢弃，不改当前卡片、输入框、图片草稿或滚动位置。

模块结果就地更新对应cardId的结果块，不整页替换。当前正在编辑的卡片内容不被结果刷新覆盖。未知词提示不抢focus、不自动弹对话框；任务失败也不弹modal。

JSON中的用户原句和AI文本以textContent/安全DOM构建显示。历史路径生成受控链接，不innerHTML插入任意模型HTML。导出Markdown若后续增加，采用现有可校验来源格式，不能直接把模型字符串当HTML。

## 7. 本步骤验收

- `@预期`输入提示立即出现，但工具/模型调用计数仍为0；保存后独立出现任务。
- 保存成功状态与后台失败状态同屏可区分，用户能继续输入下一张卡片。
- 同卡片两个模块独立展示；一个失败不隐藏另一个结果。
- 文本/图片编辑草稿不会被轮询清空；迟到旧标的响应不污染新标的。
- 原文、机器解释、历史记录和数据来源可分别识别；未读图不能显示“图片已分析”。
- 未授权POST不写设置不建任务；403不能用回环读回退救援。
- cookie缺席且正确x-write-key的TDX合法操作成功；新POST三处注册完整。
- 读工具/GET零模型启动，显式重扫/重试有清晰任务结果和版本冲突。
- 模块配置只显示允许选项，页面无法修改任意Skill/Prompt/路径。
- pending机器建议经过人工确认才改变confirmedOutcome；过期评价确认返回409。

## 8. 阅读面取舍

第一版分析结果主要通过复盘页和Agent只读工具阅读。Obsidian继续看到原始Markdown与既有每日附注；新JSON结果可查，但不自动插入正文。

若owner希望Obsidian也直接展示逐模块分析，可在后续增加由JSON确定性生成的同区Markdown只读报告。它应是可重建的展示副本，不成为第二份结果权威。本轮先保留这一明确边界，避免改动旧卡片解析和每日附注幂等规则。
