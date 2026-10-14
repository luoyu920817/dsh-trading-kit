# 两批实施：按步骤、按文件与验收出口

> 设计调整（2026-10-10）：先读 [简单关键词入口与开放Agent工作流](00-simple-agent-workflow-principles.md)。原文件拆分涉及六方法和双执行分支的部分需重排，不直接按旧清单继续实施。

状态：详细设计附带实施计划，尚未执行。目标是先交付独立可用的关键词处理框架和DSH管理页执行日志，再接入预期模块。技术栈沿现有TypeScript、Cordis、React/createElement、宿主Jobs/Agent、Node原子文件写，不新增依赖。

实施人员须先读取本目录第01–03份完整契约，按每步“回归失败→最小实现→验证”推进；不得把本文拟新增文件说成当前已有功能。

## 1. 本次设计与清理纪律

- 本轮只写设计文件。现有其他任务的源码、测试和根README/Skill改动全部保留。
- 实施前检查git status及实际宿主包/运行组合。当前已存在write-events、snapshot、history，不能回到旧设计再建事件或缓存系统。
- 每步先锁定旧行为与新增契约，测试零mock、零sleep：真实临时目录/文件，确定性输入时钟，真实宿主接口或明确实机探针。
- 无额外依赖、无上游参考仓修改、无真实vault测试写入、无交易执行接口。
- 新/实质修改函数按AGENTS注释结构解释业务逻辑、关键判断、异常、参数和返回。

最小清理计划：

| 文件 | 必要整理 | 明确保留 |
| --- | --- | --- |
| src/review/store.ts | 增加精确来源短提交核验及不折叠路径的完整性读取小接口 | 不重写locateDoc、锁键、追加/编辑或通知出口 |
| src/review/index.ts | 增补一条processors装配，并在既有review对象追加服务键 | 不另provide traderKit、不替换api.review |
| src/routes/review.ts | 在现有认证外壳接入独立processing分派及POST白名单 | 不改旧鉴权、local预算、读取缓存和图片入口 |
| src/client/index.ts | 沿slots增加本插件detail.section，不重构原复盘面板 | 缺槽时其他客户端功能继续工作 |
| src/paths/mapping.ts | 注册processing任务/设置业务区 | DB/review写分区不扩大，不动DB/stock |

只清理上表所需接口；“删除重复”为设计策略，不删除其他人的实现。

## 2. 第一批步骤一：宿主执行与管理页接线探针

先验证用户最关心的执行日志确实能出现在管理页面，不先接卡片保存或真实预期。

| 文件 | 动作和具体内容 |
| --- | --- |
| src/review/processors/host-jobs.ts | 新增KeywordJobsLike适配，root attachController、unowned start、log/progress、kill和done清理；自有ID集合 |
| src/context-types.ts | 增补jobs/agents/skills/llm/sessionTitle最小公开结构，可选注入，不增加整插件必需依赖 |
| src/client/processors/KeywordRunsSection.ts | 新增最小观察组件，subject精确过滤本插件；测试探针日志和状态 |
| src/client/processors/contracts.ts | 管理页subject/slot和业务观察DTO类型；最小结构镜像，不import不存在的宿主类型依赖 |
| src/client/index.ts | 用slots.inject+register为plugins.detail.section注册组件，ctx.effect注销 |
| test/processors/host-jobs-contract.test.ts | 当前真实宿主接口的start/run/cancel/done、日志非消耗读取、unowned语义验证入口 |
| test/client/keyword-management-section.test.ts | 真实组件/纯投影核本插件显示、其他插件null、纯文本日志、注销 |
| docs/spikes/keyword-management-jobs.md | 新增实机版本、实际槽、native执行/日志/取消/缺服务的证据记录 |

执行动作：

- [ ] 核当前已安装JobSpec/JobHooks、owner省略、root controller和真实管理页槽声明；记录运行组合。
- [ ] 先写“管理页只有安装日志不能通过”“job completed但无业务提交不等于成功”的契约断言。
- [ ] 用固定无行情文本创建原生review-keyword探针，append到channel=log，更新准备/执行/完成progress。
- [ ] 在DSH本插件详情页显示这些事件；验证不是console/聊天里才看得到。
- [ ] 取消探针，done在资源释放后结算；卸载只影响本插件job。
- [ ] 核unowned在所有profile会话可见/可取消、完成不触发主聊天followup。

出口：管理页面真实观察到执行和停止。Jobs或slot不可用就明确登记未通过，不用假组件/假Agent替代；纯解析步骤可独立继续，执行功能保持等待能力。

## 3. 第一批步骤二：关键词、注册表与模块契约

| 文件 | 动作和具体内容 |
| --- | --- |
| src/review/processors/types.ts | 定义模块接口、来源/模块输入、任务/尝试/事件、准备与模块commitGuard；公开attemptId和私有attemptToken分开 |
| src/review/processors/parser.ts | 实现@语法、忽略区段、完整匹配、UTF-16位置及未知词提示 |
| src/review/processors/registry.ts | JSON校验、代码模块注册、参数白名单、stage/schema校验、有效定义指纹 |
| config/card-processors.json | 第一批默认空生产processors列表；第二批再加入第01份预期条目 |
| src/config.ts | processing默认关闭、明确模型/cwd、并发/预算/恢复范围；旧配置缺字段按旧功能兼容 |
| package.json | files中包含config/card-processors.json；不新增依赖；之后加入两份预期Skill发布路径 |
| test/processors/parser.test.ts | 真实文字/Markdown、email/链接/引用/围栏/escape/emoji等完整断言 |
| test/processors/registry.test.ts | 真JSON文件、冲突、非法字段、旧表保留、空表可用、设置白名单 |

执行动作：

- [ ] 先写完整名、未知词、多标记去重和所有忽略区段用例，确认新增接口尚未实现时失败。
- [ ] 实现纯解析和registry验证；解析不读取图像、HTTP或模型。
- [ ] 加载候选配置后整体校验，通过才切快照；失败保留旧配置并给中文原因。
- [ ] 确認打包后JSON资源可以从明确安装根解析，不依赖process.cwd或源仓路径。
- [ ] 在测试装配注入一个确定性模块，生产注册表不出现测试词或伪业务模块。

出口：框架不知道预期规则，仍能识别并路由测试模块；生产空表可启停，未知词不破坏保存。

## 4. 第一批步骤三：来源、持久任务与统一写后通知

| 文件 | 动作和具体内容 |
| --- | --- |
| src/review/processors/identity.ts | 复用ident现有解析，规范真实文档路径+anchor，计算card/source/input版本 |
| src/review/processors/records.ts | 原子task JSON、requestSequence、attempts、结果与timeline同文件、大小及格式校验 |
| src/review/processors/reconcile.ts | 订阅已有path通知；single-flight/generation防旧扫描发布；有界补漏与来源消失判断 |
| src/review/processors/trace.ts | 状态+事件同提交，序号/脱敏/截断，投影native log/progress |
| src/review/processors/index.ts | 构造registerProcessors、可选宿主依赖、生命周期、dirty路径合并和健康态 |
| src/review/index.ts | 增加registerProcessors装配调用，追加review.processing服务面 |
| src/review/store.ts | 导出withVerifiedCardSnapshot；精确相对路径读取与原锁键短提交，完整扫描错误信息 |
| src/paths/mapping.ts | 新增processorRecords、processorSettings；resolve仍限定安全子路径 |
| test/processors/identity.test.ts | 同码不同市场/文档、编辑writtenAt不变、真实保存body偏移 |
| test/processors/records.test.ts | 真实原子文件、版本冲突、同序号拒绝、损坏/大文件、事件顺序 |
| test/processors/reconcile.test.ts | 成功保存、附注不触发、更新/删除、读期间再次写、漏事件与不完整扫描 |

执行动作：

- [ ] 先用现有store写真实卡片，证明parseDoc的保存后正文是唯一输入；旧保存/duplicate行为保持。
- [ ] 在onReviewWrite只排dirty路径，不引入onCardCommitted、不阻塞保存、不取行情。
- [ ] 比较parse后的cards与既有task身份；旧读取generation不得登记当前任务。
- [ ] 创建同任务state/result/timeline的原子记录，第一次登记失败保持原Markdown成功。
- [ ] 验证旧附注、summary和processing子目录不会变成用户卡片或新任务。
- [ ] 恢复扫描覆盖最近7日和所有未结束/投递pending记录；部分目录错误不宣判删除。

出口：异步保存→持久任务成立；日志和任务状态不能半成功；源码写事件与缓存仍只有既有一套。

## 5. 第一批步骤四：接纳、原生执行、结果提交与恢复

| 文件 | 动作和具体内容 |
| --- | --- |
| src/review/processors/scheduler.ts | 只实现持久接纳、有限并发/预算、等待/退避、重启；实际run/cancel用host-jobs |
| src/review/processors/host-jobs.ts | 将一次准备/执行/校验/清理包装JobHooks，保存nativeJob关联，容量拒绝不计尝试 |
| src/review/processors/host-agent.ts | create候选预检→setup实际Skill核验→尝试激活→followup→submit→idle/dispose |
| src/review/processors/context.ts | 受控卡片/角色/历史冻结与evidence编号；复用历史/档案缓存，不任意读vault |
| src/review/processors/results.ts | 模块验证器、固定DECLARATION_LINE、来源/定义/序号/attemptId短核验和原子结果 |
| src/review/processors/index.ts | 可选jobs/Agent服务出现/消失的接纳和清理；读服务不启模型 |
| test/processors/scheduler.test.ts | 明确时钟输入、真实待办、预算/容量/重试/停机恢复，不sleep |
| test/processors/results.test.ts | 结构/证据错误、旧来源/私有尝试凭据、业务guard拒绝、同文件成功、提交后取消不回滚、pending/obsolete投递 |
| test/processors/host-agent-contract.test.ts | 真实宿主接口文本Skill、idle无提交失败、scope限制及取消竞态 |
| test/fixtures/processors/probe-skill/SKILL.md | 仅测试探针使用的固定无行情Skill，不部署生产关键词 |

执行动作：

- [ ] 锁定无提交不成功、晚到旧结果不覆盖、容量拒绝不计模型次数、创建失败不计费尝试这些契约。
- [ ] 实现prepare领取/短锁/日志，所有await宿主调用在锁外；原生run不依赖start返回后才设置ID。
- [ ] 实现scoped Skill两段核验，实际解析哈希与候选不一致时重登记定义版本，不直接替换旧task。
- [ ] running和attemptId写盘后才激活submit工具并发followup。
- [ ] 明确data分支不依赖Agent/Skill/model、不占Agent日预算；两种执行器均经native run、统一提交与清理。
- [ ] 写running的await期间取消已经到达，返回后同步检查abort，不再激活或followup。
- [ ] RESULT_COMMITTED后再取消保留succeeded，重开只补投递；业务窗口已改变则obsolete，不无限恢复。
- [ ] 取消、超时、卸载都kill自有native job并排空执行Agent；清理未完成时不释放并发名额。
- [ ] 重启读取已成功result则只补投递，不重跑模型；中断尝试在限额内恢复。

出口：测试模块和文本Agent探针均经统一链路完成；框架执行阶段不引用任何预期字段。

## 6. 第一批步骤五：管理页持久日志与最小用户接口

| 文件 | 动作和具体内容 |
| --- | --- |
| src/routes/review-processors.ts | 第02份health/registry/tasks/task/events/cards及retry/cancel/settings/reload/rescan纯分派 |
| src/routes/review.ts | 注册新exact接口、统一原鉴权和POST白名单；不改已有/local分段缓存 |
| src/tools/review-processors.ts | list/results只读，rescan显式副作用；共享业务实现 |
| src/client/processors/KeywordRunsSection.ts | 任务筛选、尝试关联、事件分页、截断/等待原因、取消/重试、可选native观察 |
| src/client/processors/api.ts | 受控同源读写、409错误、viewSequence与取消订阅；不存token |
| src/client/processors/contracts.ts | DTO与host响应一致的类型，隐藏attempt/preparation凭据 |
| src/client/review/processor-view.ts | 纯本地识别/状态展示函数，沿现有序列化方式内联，ES2017兼容 |
| src/client/review/index.html.ts | 输入提示、逐卡状态、查看结果，不改保存成功/草稿行为 |
| test/processors/api.test.ts | 真实HTTP服务器、凭据/Host/Origin/参数/游标/只读零执行/409 |
| test/processors/tools.test.ts | 普通工具不启动模型、不提供submit/任意确认 |
| test/client/keyword-management-section.test.ts | page筛选、迟到响应、隐藏暂停、事件去重、缺槽/缺jobs、宿主重启同native编号不能误连接/取消 |
| test/routes-review/review-processors-page.test.ts | 内联脚本真实vm执行，输入/图片草稿保真、未知词保存 |

执行动作：

- [ ] 先测试GET不会排队、写端继续原鉴权，错误不依赖解析中文说明。
- [ ] 管理区读取queued/waiting/preparing阶段，而非只读取已存在native job。
- [ ] 原生流公开服务可用则补观察；缺流或重启后仍读取持久阶段历史。
- [ ] 确认taskId/attemptId/nativeJobId/sessionId各自意义；API不泄露执行凭据。
- [ ] 两次选择任务的迟到响应不混日志；卸载清掉poll与观察订阅。
- [ ] 历史nativeJobId与新宿主同名时仅展示，只有当前runtimeInstanceId及自有集合匹配才可观察/取消。
- [ ] 打包/安装到测试profile后，在真实插件详情页检查section、日志和取消全过程。

第一批最终出口：**框架和管理页可独立验收，尚无生产@预期模块。** 此时可以审阅接口和日志再进入业务批，不把框架可用说成预期已实现。

## 7. 第二批步骤六：接入预期原句整理与稳定观察

| 文件 | 动作和具体内容 |
| --- | --- |
| src/review/processors/modules/expectation-types.ts | 第03份draft/rule/tracking/window及确认类型 |
| src/review/processors/modules/expectation-validation.ts | 原句跨度、受控字段、规则/单位/对象证据和结果schema校验 |
| src/review/processors/modules/expectation-tracking.ts | matchingKey/fingerprint、幂等UUID业务身份、sourceLinks、暂停/恢复/proposal |
| src/review/processors/modules/expectation.ts | ProcessorModule实现，extract stage/context/afterCommit及source reconciliation |
| config/card-processors.json | 添加唯一生产预期条目，不加其他三个关键词 |
| src/review/processors/index.ts | 在模块表注册expectation，不在scheduler/parser中硬编码 |
| skills/review-expectation-extract/SKILL.md | 完整原句整理职责、输入引用、schema、禁止猜条件、submit结束 |
| src/skill/index.ts及现有local-dir装配 | 登记自产业务Skill部署；Scoped注册保证实际可发现，不全局改搜索根 |
| package.json | files发布配置与两份实际Skill目录，不仅把源仓路径写到配置 |
| src/routes/review-processors.ts | GET expectations/expectation，pause/update/confirm受控入口 |
| src/client/processors/KeywordRunsSection.ts | 新增预期清单、原句/解释/证据和暂停/proposal动作 |
| test/processors/expectation-extract.test.ts | 真实body跨度、多条/空预期/模糊条件/跨对象与规则边界 |
| test/processors/expectation-tracking.test.ts | 同输入重跑、编辑精确匹配、暂停原因集合保留userPaused、proposal、人工历史不转移、投递恢复 |

执行动作：

- [ ] 先定义精确原句、空预期、不得猜阈值及不会默认把指数当个股的回归输入。
- [ ] 模块prepare/validate/afterCommit接入现有框架，不增加第二套运行、取消或日志入口。
- [ ] 第一次extract自动登记；相同输入重跑只更新sourceLink，变化提proposal。
- [ ] 编辑先暂停，精确指纹一致恢复；删标记/卡片撤回；关闭为暂停，开启不全量重跑。
- [ ] 人工动作独立businessEvents，结果task日志和业务事件通过expectationId关联。
- [ ] 手动暂停后编辑/关闭/恢复不能清userPaused；确认/恢复/更新必须锁内重读来源，不只看recordVersion。
- [ ] 用测试profile真实卡片跑文本Agent，管理页能追踪任务与每条观察，原Markdown不改。

出口：`@预期`当日整理和持久观察已真实可用；自动目标日评价尚须下一步的数据门槛，页面明确表示。

## 8. 第二批步骤七：带日期证据与后续回查

| 文件 | 动作和具体内容 |
| --- | --- |
| src/review/processors/market-evidence.ts | provider公开契约、日期/单位/资产能力校验、缺能力明确返回 |
| docs/spikes/expectation-market-evidence.md | 实际生产者、样本、交易日序列覆盖、数据源修订与边界证明 |
| src/review/processors/modules/expectation.ts | check stage；到期检查只提出统一FollowupRequest |
| src/review/processors/modules/expectation-tracking.ts | window/target/dateProof、evidenceRevision、评价追加、继续观察新窗口 |
| skills/review-expectation-check/SKILL.md | 原句与目标日数据对比、条件/预期/失效分组、只给机器建议 |
| src/review/processors/index.ts | 17:30东八区唤醒与启动补查；仍交统一接纳器 |
| src/routes/review-processors.ts | 确认eval/manual条件、recordVersion，继续未知交易日返回503 |
| src/client/processors/KeywordRunsSection.ts | 等待交易日/数据原因、目标日期、机器建议与最终人工状态 |
| scripts/scan-compliance.mjs | 沿既有单一负向词表增加生成JSON解释覆盖，跳过可核原句；固定声明 |
| test/processors/market-evidence.test.ts | 真实记录样本文件验证日期/单位/市场/完整交易日序列，不mock网络成功 |
| test/processors/expectation-check.test.ts | 条件/失效/证据、同证据去重、修订追加、旧窗口/已确认/暂停后的迟到评价guard |
| test/processors/expectation-confirm.test.ts | 人工无评价理由、旧eval/版本冲突、继续新窗口、不自动重开 |

执行动作：

- [ ] 先核验实际日线/日历生产者；不能绕过17709边界或伪造日期。
- [ ] 支持原日/目标日的明确历史证据，长假、停牌、指数/个股同码和错日期都验证。
- [ ] 缺provider时当日业务继续可用，check等待且日志说明；数据门槛未通过不标自动回查完成。
- [ ] 同窗口同证据只登记一次check；漏17:30在启动恢复查询原目标日，不用当天替代。
- [ ] 机器评价追加，人工确认才改最终结论，继续观察创建新窗口。
- [ ] 扩展现有合规脚本JSON生成解释/观察项和声明自测，不维护第二词表。

出口：真实指定交易日比对与人工确认闭环；如果生产者尚不可得，交付报告明确阻断和缺项，不用手动流程冒充全自动。

## 9. 第二批步骤八：模块扩展证明与全链路验收

只用测试装配再注册一个最小文字模块，复用现有输出schema与Skill执行方式，不加入生产默认词。检查无需改parser、scheduler、host-jobs、trace或管理页主任务列表；只有模块登记/配置/业务展示变化。这是“框架可扩展”的实证，不实现新业务。

全链路必须看到：

| 用户场景 | 完成证据 |
| --- | --- |
| 无@的旧卡片 | 旧保存/读取/图片/计数不变，零模型请求 |
| 输入未保存 | 本地提示，零任务、零费用 |
| 保存@预期 | 及时返回，排队到日志与业务结果有据可查 |
| 缺模型/Jobs/Skill/数据 | 管理页明确具体等待原因，不出现不可见运行 |
| 附注变化/重复保存 | 不重新触发用户卡片处理 |
| 编辑时旧结果迟到 | 当前结果不被覆盖，观察先暂停，恢复/差异清楚 |
| 同输入重跑 | 新技术任务，稳定业务身份与既有确认历史 |
| 关闭/重新开启 | 暂停/恢复，已closed或withdrawn不复活 |
| 原生满额/预算满 | 持久waiting，不忙循环，不增加模型尝试 |
| 原生取消/插件卸载 | 所属Agent清理，无旧回写，主会话不被打断 |
| 页面关闭/重启 | 页面关闭不取消；重启后历史可读并幂等补齐 |
| 自动回查 | 源日期、目标日、证据日期/单位和人工确认均正确 |
| 源读失败/部分目录 | sourceUnverified，不能误撤回 |
| 管理页日志 | 真plugins.detail.section可见，队列和历史也可见，非install-log |

## 10. 必跑门禁与真实运行证据

每步先运行其新测试及触及模块旧回归；阶段完成运行当前工程门禁：

```powershell
pnpm typecheck
pnpm build
pnpm test
node scripts/scan-compliance.mjs --self-test
git diff --check
```

当前没有lint脚本或独立静态分析配置，不虚构pnpm lint已通过。类型、合规和diff检查是现有静态门禁；后续若有实际lint配置再执行。环境pnpm代理/沙箱失败可用已有node_modules/.bin对应命令，不安装依赖来修验证环境。

示例阶段测试命令（文件创建后才执行）：

```powershell
pnpm exec vitest run test/processors/parser.test.ts test/processors/registry.test.ts
pnpm exec vitest run test/processors/records.test.ts test/processors/reconcile.test.ts
pnpm exec vitest run test/processors/scheduler.test.ts test/processors/results.test.ts
pnpm exec vitest run test/processors/api.test.ts test/client/keyword-management-section.test.ts
pnpm exec vitest run test/processors/expectation-extract.test.ts test/processors/expectation-tracking.test.ts
pnpm exec vitest run test/processors/market-evidence.test.ts test/processors/expectation-check.test.ts test/processors/expectation-confirm.test.ts
```

宿主探针不能用mock Jobs/Agent冒充实机结果。报告至少记录DSH/Jobs/Agent实际版本、profile、原生job与session、管理页截图或可复现交互、结果文件版本和日期来源。source build通过不等于profile tarball已更新；实施部署时比较安装产物和真正路由/页面，只有实际更新后才报告运行完成。

## 11. 回滚与报告

全局enabled=false停止新接纳并协作取消本插件当前运行，保留历史任务和观察；旧复盘页继续工作。回滚代码不删JSON，未知schema只读告警不能覆盖成空记录。停止时保持已closed/withdrawn，不伪装成机器重判。

每批报告：修改文件、实际新增行为、复用/简化、回归与实机证据、未验证能力、成本/日志截断边界、回滚方式。第一批只称框架和管理页完成；第二批分别称当日整理/观察完成与自动目标日回查完成，禁止合并掩盖数据缺口。

## 12. 本次设计交付的检查记录

2026-10-09只新增本目录5份文档，并在前版card-processors/README增加新版入口说明；没有修改业务源代码、运行配置、vault或宿主进程。当前其他任务的未提交改动保留，不归为本设计的实现。

| 检查 | 实际结果 | 含义 |
| --- | --- | --- |
| 文档链接、JSON、围栏、行尾空白和占位检查 | 5份文档、4个本地链接、1个JSON示例通过 | 可按入口逐份审阅 |
| 设计交叉审阅 | 已补业务guard、手动暂停保留、成功后取消、data分支、宿主编号复用等边界；最终无直接冲突 | 仅是文档契约一致性，不是运行验收 |
| 当前构建 | 通过，存在已有external弃用提示 | 当前工作区源码可构建；不证明拟议功能已实现 |
| 当前现有测试 | 86个文件、845条通过 | 实施前基线，包含工作区其他任务的当前改动 |
| 当前类型检查 | 10处错误 | 全量门禁未通过，不借设计改动修其他测试 |
| 现有合规脚本自测、git diff --check | 通过；已有CRLF规范化提示 | 新结构化业务输出尚待实施后扩展覆盖 |

类型错误位于test/routes-review/review-limit-box.test.ts、review-params.test.ts及test/skill/assembly.test.ts、version.test.ts、zip-guard.test.ts；9处回调参数隐式any、1处ToolDefinition不存在name属性，与上一轮基线相同。检查使用现有node_modules/.bin命令；Vitest经自动审批在沙箱外运行，未安装依赖。

没有发起真实模型任务或生产行情请求，也未实际验证管理页扩展槽加载；这些明确保留为步骤一和第二批的实机验收。
