# 第七步：按文件实施的顺序、回归测试与验收

状态：详细设计草案附带实施拆分。尚未实施，不是未经测试就可直接合并的代码。完整业务接口以第1–6份文档为准；本文把实施出口落实到文件和检查动作。

## 1. 执行纪律

- 每步先写能锁定现有行为或新契约的真实回归测试，再修改生产代码。
- 新测试零mock、零sleep：文件系统使用真实临时目录，HTTP使用真实本地服务器；时间相关状态通过明确时钟输入驱动，不等待墙钟。宿主行为用真实组合或实机探针，不能用假的whenIdle证明运行成功。
- 不新增依赖，不修改只读参考仓，不写真实vault以验收功能。
- 不为本功能重构store.ts、整页HTML或全仓存储工具。增加正式小接口和独立模块。
- 新写或实质修改的函数/方法注释需包括业务逻辑、关键判断、异常处理、参数与返回。设计里的字段说明不能替代代码注释。
- 代码/文档分批可审阅；每步通过后才进入下个依赖步骤。提交信息默认中文Conventional Commit；提交动作在实现阶段按实际差异组织，不在本次未审阅设计上自动提交。

## 2. 实施前的最小清理计划

这里只允许与本功能直接有关的整理：

| 文件 | 最小整理 | 为什么必须做 | 保留的行为 |
| --- | --- | --- | --- |
| `src/review/store.ts` | 补齐scan返回qualifier类型；导出精确来源扫描和版本保护短提交接口 | 避免身份遗漏与错误来源删除 | 现有locateDoc、追加/修改、锁键及旧文档选取不变 |
| `src/tools/review-daily.ts` | 补齐DailyLoc/DailyScanTarget等market/qualifier类型 | 当前运行时有字段而类型遗漏 | 工具名、旧字段、每日附注规则不变 |
| `src/review/index.ts` | 将路由和service绑定同一个提交观察器 | 防止HTTP路径之外漏事件 | 原五存储出口继续可用 |
| `src/routes/review.ts` | 新API分派放新文件，仅保留现有鉴权和接线 | 大文件里避免堆入第二套业务实现 | 现有认证、读取、写卡、图片行为不变 |
| `src/client/review/index.html.ts` | 新纯函数放processor-view，沿已有序列化内联 | 控制新增脚本范围、便于vm测试 | 输入、Enter保存、图片草稿、TDX参数和跳转不变 |

先运行已有review存储、页面和summary测试，确认当前基线。已有未提交README与每日汇总Skill不属于本任务，不能覆盖或混入实现提交。

## 3. 实施步骤一：宿主接线探针

先验证最不确定的接口，尚不连接真实页面保存事件。

| 文件 | 本步动作 |
| --- | --- |
| `src/review/processors/host-agent.ts` | 新增最小公开适配，create/setup/followup/提交/idle/dispose流程 |
| `src/context-types.ts` | 增补本步用到的可选宿主最小类型，不改主插件必需inject |
| `skills/review-processor-probe/SKILL.md` | 固定测试文字/图片任务，不取股票行情 |
| `test/processors/host-contract.test.ts` | 用实际宿主接口确认scoped工具、结果完成和取消语义 |
| `docs/spikes/card-processor-agent.md` | 登记真实版本、组合、模型、可见工具与成功/失败证据 |

执行顺序：

- [ ] 读取当前实际宿主包类型，核对本文所有API签名与factory服务。
- [ ] 先写“Agent idle但没有提交不能算成功”“图片只有路径不能算已读”的契约断言。
- [ ] 在真实临时目录运行文本探针，结果经绑定提交工具写入测试JSON。
- [ ] 核对独立session、主聊天不新增消息、限定工具可见。
- [ ] 执行取消和卸载探针，确认排空。
- [ ] 用已知内容的测试图片核验真实图片链，另用文本模型核验明确拒绝。

出口：真实宿主可以执行、提交与清理，图像能力单独有证据。不满足则保留探针报告，继续可独立实现的纯识别与数据模块；Agent模块仍显示等待能力，不能假称完成自动执行。

## 4. 实施步骤二：关键词与配置

| 文件 | 本步动作 |
| --- | --- |
| `config/card-processors.json` | 四个默认条目，包含显式不可用龙虎榜占位 |
| `src/review/processors/types.ts` | 按第1–2份文档定义共享类型和状态联合 |
| `src/review/processors/mentions.ts` | 只解析用户body，不改原文 |
| `src/review/processors/registry.ts` | 完整校验、别名索引、有效版本和配置读写互斥 |
| `src/review/processors/settings.ts` | 真实设置文件、参数白名单、版本冲突 |
| `src/config.ts` | 新增review.processing，旧配置无此键也能运行 |
| `package.json` | 打包JSON和Skill，保留现有依赖 |

对应测试：mentions.test.ts、registry.test.ts、settings.test.ts。

- [ ] 为旧无关键词文字、未知词、重复词、引用/代码/邮箱/图片编写完整输入输出断言。
- [ ] 为占位模块与图片能力配置写合法/非法JSON测试。
- [ ] 为settings并发旧版本提交写真实文件测试。
- [ ] 实现纯解析，再实现本地注册表和设置，不接模型。
- [ ] 验证pack清单与安装目录读取，运行时不依赖process.cwd。

出口：页面/工具可以拿到完整的已知、未知、关闭和能力不足说明；旧卡片保存不受影响。

## 5. 实施步骤三：身份、记录与存储观察

| 文件 | 本步动作 |
| --- | --- |
| `src/review/processors/identity.ts` | cardId、sourceRevision和图片真实哈希 |
| `src/review/processors/records.ts` | 每卡片任务、请求组generation、原子状态更新 |
| `src/review/processors/reconcile.ts` | 完整性扫描、窗口恢复、来源撤回、成功结果跟踪补偿 |
| `src/review/store.ts` | 可选正式观察器；scanProcessorSourceDocs；withVerifiedCardSnapshot |
| `src/review/index.ts` | 绑定四种写入的观察器并把同一函数给路由/service |
| `src/paths/mapping.ts` | 两个processing区域，既有白名单内路径 |
| `src/tools/review-daily.ts` | 只补市场相关类型 |

对应测试：identity.test.ts、records.test.ts、commits.test.ts、reconcile.test.ts，扩充已有store和paths真实测试。

- [ ] 先锁定现有新增、duplicate、更新、整卡删除、单图删除、BOM/CRLF保真、跨市场定位行为。
- [ ] 写“源写失败无任务”“源成功JSON失败仍保存成功”的真实文件回归。
- [ ] 写同锚点沪深文档和异常同市场两候选路径不合并测试。
- [ ] 实现身份/记录，再接四种提交观察；此时调度可只登记不执行。
- [ ] 写同输入重跑新generation、撤回后恢复同原文、源临时不可读等失效用例。
- [ ] 写完整性扫描保留候选、不吞月目录错误、分页未完不判删除的测试。

出口：任务登记可恢复，源保存契约未破坏，事件遗漏与删除后的源失效均有真实验证。

## 6. 实施步骤四：统一执行与校验提交

| 文件 | 本步动作 |
| --- | --- |
| `src/review/processors/scheduler.ts` | preparing/能力预检/running区分、并发、重试和日预算 |
| `src/review/processors/context.ts` | 全卡片证据、历史与角色限定、预算和contextRevision |
| `src/review/processors/results.ts` | 信封和引用校验、current generation/token/source/config保护 |
| `src/review/processors/host-agent.ts` | 从探针扩成绑定任务的真实后台适配 |
| `src/review/processors/index.ts` | 总装配、可选能力、生命周期清理与服务出口 |
| `src/review/index.ts` | 接总装配；继续共享现有随机/固定writeKey |

对应测试：context.test.ts、scheduler.test.ts、results.test.ts及host-contract.test.ts。

- [ ] 能力缺失不增加尝试；create成功但尚未followup时源改变，句柄清理无模型启动。
- [ ] 网络和模型不在卡片/配置/记录锁内；短提交锁序完整验证。
- [ ] A任务运行中创建B generation，B完成后A迟到不能成为current。
- [ ] 配置保存与结果提交并发，最终读投影只认可当前有效routeRevision。
- [ ] 超时取消排空后才可重试；旧attemptToken永远不能回写第二次尝试。
- [ ] 图像工具只接受本任务imageId，实际保存附件并提供ImageBlock后才允许引用。

出口：通用框架的后台处理可以成功、失败、取消和恢复，且不会产生错误版本的当前结果。

## 7. 实施步骤五：概念和当日预期

| 文件 | 本步动作 |
| --- | --- |
| `src/review/processors/modules/concept.ts` | 同源服务补全，股票支持检查，无历史日期伪装 |
| `src/review/processors/modules/expectation.ts` | 原句跨度、条件/阈值候选、条目身份与trackingReady |
| `skills/review-expectation/SKILL.md` | 原句结构化与证据提交 |
| `src/review/processors/tracking.ts` | 从成功result幂等建立预期记录 |
| `src/review/processors/results.ts` | concept/expectation校验器 |
| `config/card-processors.json` | 实际能力可用后启用两条路由 |

对应测试：concept.test.ts、expectation.test.ts、tracking.test.ts。

- [ ] 概念合法无记录与源失败不同，businessDate=null不能变成卡片日期。
- [ ] 一个提取job产生两条独立预期；模糊原句不造量化标准。
- [ ] 成功提取而tracking写失败，启动恢复能从终态job补偿，编号不重复。
- [ ] 无观点的@预期成功返回空条目，不安排虚构未来验证。

出口：数据与Agent两种执行器通过同一框架，结果有清晰来源；预期可登记，自动回查尚需下一步证据能力。

## 8. 实施步骤六：交易日证据与回查

| 文件 | 本步动作 |
| --- | --- |
| `docs/spikes/expectation-market-evidence.md` | 实测历史日线和交易日序列来源；明确支持标的和日期 |
| `src/review/processors/market-evidence.ts` | 实现verified provider或明确不可得模式 |
| `src/review/processors/tracking.ts` | nextTradingDate、17:30唤醒、错过补查、人工状态记录 |
| `skills/review-expectation-check/SKILL.md` | 冻结原句与目标日证据逐条件比对 |
| `src/review/processors/results.ts` | expectation-check结果和证据日期校验 |
| `src/review/processors/scheduler.ts` | 后续检查请求组独立于原分析 |
| `scripts/scan-compliance.mjs` | 覆盖模块JSON中的AI解释和评价，跳过用户原句，沿既有负向词表 |

对应测试：market-evidence.test.ts、tracking.test.ts、scheduler.test.ts。

- [ ] 数据源在股票/指数、长假和停牌样本上提供可证业务日期及单位。
- [ ] 没有provider、历史日期或sessionComplete时明确等待，不用实时价格代替。
- [ ] 周末/长假目标来自交易日序列；错过启动仍查原目标。
- [ ] 机器建议不改变confirmedOutcome，人工确认前保持pending。
- [ ] 后续evaluation不会替代原预期提取job，也不会关闭另一个观点条目。

出口：自动回查在实际数据覆盖范围内闭环；能力未通过时必须报告“当日整理完成，自动回查未完成”，不能整体标成功。

## 9. 实施步骤七：页面、API和工具

| 文件 | 本步动作 |
| --- | --- |
| `src/routes/review-processors.ts` | 实现第5份文档路径和参数校验 |
| `src/routes/review.ts` | 新分派、注册、写凭据白名单；共享原鉴权 |
| `src/tools/review-processors.ts` | 只读结果/预期工具及显式重扫 |
| `src/client/review/processor-view.ts` | 中文状态、结果投影、证据和过期提示 |
| `src/client/review/index.html.ts` | 关键词提示、设置、逐卡结果、轮询与确认 |
| `src/client/panel/Panel.ts` | 后台概览/待确认数，不自动向聊天发消息 |

对应测试：api.test.ts、tools.test.ts、review-processors-page.test.ts及已有页面测试。

- [ ] 先写旧输入、Enter保存、图片草稿和切标的行为的回归，保证新增结果刷新不破坏草稿。
- [ ] GET零任务登记/模型启动，POST显式操作走原凭据。
- [ ] 迟到响应不覆盖新标的/日期；正在编辑卡片不被结果渲染改写。
- [ ] 409保留用户设置草稿并显示冲突；人工确认复核评价和来源版本。
- [ ] TDX Chromium81实机检查文本、图片、配置和结果展开。

出口：用户可完整使用首批模块；后台运行与保存、编辑状态互不混淆。

## 10. 实施步骤八：模式与扩展证明

创建/修改第6份文档列出的pattern-catalog、pattern模块、两个Skill、tracking补充、结果校验、视图和配置；不提前把龙虎榜占位宣称成数据模块。

同时修改src/routes/review-processors.ts及review.ts的新POST注册/凭据白名单，加入pattern-confirm；processor-view及HTML显示接受/排除候选；api.test.ts、pattern.test.ts覆盖模式定义变化、原分析重跑、确认recordVersion冲突。不能只有结果类型而没有实际确认入口。

- [ ] 模式库实际读到稳定id和规则，缺目录时清晰不可用。
- [ ] 图片实际进入图像模型，有已知图像探针证据。
- [ ] 模式候选、满足/缺失/矛盾条件都有原句或图像证据。
- [ ] 用户确认只改本功能JSON，不改模式权威和原frontmatter。
- [ ] 模式次日观察与原分析使用独立请求组。
- [ ] 增加一个受控自定义Skill路线，仅改JSON和Skill，核心解析/调度零修改。

出口：中间方案的扩展价值有实际证明，而非只有接口命名。

## 11. 必跑检查命令

实施中按改动运行相应文件，不靠只扫字符串证明业务逻辑。对应阶段的命令如下：

```powershell
pnpm exec vitest run test/processors/mentions.test.ts test/processors/registry.test.ts test/processors/settings.test.ts
pnpm exec vitest run test/processors/identity.test.ts test/processors/records.test.ts test/processors/commits.test.ts test/processors/reconcile.test.ts
pnpm exec vitest run test/processors/context.test.ts test/processors/scheduler.test.ts test/processors/results.test.ts
pnpm exec vitest run test/processors/concept.test.ts test/processors/expectation.test.ts test/processors/tracking.test.ts test/processors/market-evidence.test.ts
pnpm exec vitest run test/processors/api.test.ts test/processors/tools.test.ts test/routes-review/review-processors-page.test.ts
pnpm exec vitest run test/processors/pattern-catalog.test.ts test/processors/pattern.test.ts test/processors/extension.test.ts
pnpm typecheck
pnpm build
pnpm test
node scripts/scan-compliance.mjs --self-test
git diff --check
```

新测试文件只在对应阶段创建后运行。当前仓库没有lint脚本或独立静态分析配置，不能报告不存在的 `pnpm lint` 已通过；类型检查、合规扫描及diff检查是当前可执行的静态门禁。若仓库届时增加lint脚本，则按实际配置执行，不为本功能临时新增依赖。

合规扫描现有脚本只覆盖旧附注和brief。实现时扩展它识别新模块JSON中的AI生成文本，跳过sourceType=userQuote的原句，并补自测；否则自测通过不能证明新输出已扫描。记录新增JSON/schema覆盖，避免维护第二份负向词表。

新扫描对象限interpretation、AI observations、比对explanation及nextObservationItems；userQuote和有可核验来源的模式definitionQuote独立跳过，不免检模型伪造引用。定位声明由结果展示模板固定提供，结构化JSON结果的声明字段固定为既有DECLARATION_LINE，结果校验要求它存在。原quote证据合法性由results校验，不能靠词表扫描替代。

## 12. 最终真实运行验收

基于测试dataRoot和明确的实际宿主组合，至少验证：

| 完整用户场景 | 完成证据 |
| --- | --- |
| 无标记旧卡片 | 原格式、计数、写入与读取相同，无新模型请求 |
| 同卡@概念+@预期 | 两种执行器独立结果，来源和身份正确 |
| 模型执行时继续写卡 | 保存不等模型，输入与图片草稿保留 |
| 编辑/删图后旧结果迟到 | 不覆盖新版本，页面明确旧结果 |
| 相同输入显式重跑 | 新generation选中，旧请求不能写成current |
| 删除/撤回后恢复同原文 | 新请求可运行，旧跟踪不被意外复活 |
| 缺Agent/Skill/图像能力 | 旧复盘页和确定性模块仍可用，状态与修复提示正确 |
| 重启、漏事件、跟踪登记失败 | 本地恢复幂等，成功预期终态也补建遗漏跟踪 |
| 源目录暂时不可读 | sourceUnverified，不误判删除或自动失效 |
| 下一交易日回查 | 原日/目标日/证据日期、规则条件和人工确认均可追溯 |
| @模式含图 | 实际图片读取、已登记模式id、候选条件与来源完整 |
| 自定义关键词 | 新JSON+Skill通过现有通用schema，不改解析/调度 |

验收需检查宿主加载的是当前打包产物。源码build通过不证明profile安装包或运行进程已经更新；核对安装文件与真实路由/工具结果后才可报告运行完成。

## 13. 各批的交付报告

每批列：修改文件、实际新增用户行为、复用了什么及删除/简化了什么、测试/探针证据、尚未支持的标的/日期/宿主能力、回滚方式。

全局processing.enabled关闭能停止新任务领取，但历史记录保留、旧复盘功能继续运行。代码回滚不删除JSON；遇到不支持的新记录schema显式报告，不能覆盖成旧空文件。

本次仅交付设计，后续首个实现批建议先做宿主探针和纯识别配置。概念/预期当日处理、带日期回查、模式分析分别验收，避免把一个未验证数据源拖成整轮不可用的大变更。

## 14. 本次设计交付的检查记录

本次只新增本目录8份Markdown。工作区原有的根README和每日汇总Skill改动没有混入本次设计；没有新增依赖，没有修改生产代码或vault，没有运行宿主业务任务。

| 检查 | 2026-10-08结果 | 对后续实施的意义 |
| --- | --- | --- |
| 文档链接、JSON示例、代码围栏、行尾空白 | 8份文档、8个本地链接、1个JSON代码块均通过 | 文档可按入口逐份审阅 |
| 当前构建 | 本地tsdown命令通过；有既存external弃用提示 | 仅证明当前源码可构建，不能证明拟议功能已实现 |
| 当前测试 | 80个文件、811条测试通过 | 是实施前基线；新功能仍须逐步增加上述测试 |
| 当前类型检查 | 本地tsc --noEmit发现10处错误 | 实施前需独立修复现有测试类型问题，不能称全量门禁已通过 |
| 现有合规脚本自测与git diff --check | 通过 | 新JSON结果覆盖尚待第6步实现，不提前宣称已覆盖 |

类型错误位于test/routes-review/review-limit-box.test.ts、review-params.test.ts及test/skill/assembly.test.ts、version.test.ts、zip-guard.test.ts；其中9处为回调参数隐式any，1处为ToolDefinition不存在name属性。本次文档没有改动这些文件，不借详细设计顺带修改测试逻辑。

本机pnpm入口曾因沙箱realpath权限失败，改用现有node_modules/.bin内对应命令完成检查，没有安装依赖。Vitest首次同样在依赖realpath阶段被阻止、未收集测试；在自动审批允许的沙箱外重跑后取得上述811条通过结果。
