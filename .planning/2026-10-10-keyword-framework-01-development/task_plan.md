# keyword-framework-01-development

## Goal
2026-10-11 用户授权基于最新分工索引完成关键词到工作流 MVP，以 @预期 为案例。保留已有脏工作；迁移单 execute 契约，修解析，实施注册/持久运行/保存触发/受控Agent/管理页与取消恢复。源码离线与实际宿主验收分开记录。

## Binding
PLAN_ID=2026-10-10-keyword-framework-01-development
PWF_PLAN_ROOT=E:/work/code/open/dsh-plugins/dsh-trader-kit
所有本轮记录显式使用此目录。设计目录只读、共享活动指针未修改。

## Next Step
标的/模式目录选择与相对路径保存已完成安装，宿主实际GET确认编辑能力、版本和按钮可用。后续原生窗口实际选择/取消及真实模型运行仍需桌面验收；本轮未实际更改目录配置、迁移资产或调用模型。

## Current Phase
MVP source/offline complete；目录配置编辑完整交付，隔离快照110文件1052测试零跳过，当前120份生产源码与快照哈希一致。真实宿主编辑能力/页面HTTP确认通过；原生窗口实际选择与真实模型执行仍未验。Earlier 0/1 evidence below is historical; six-method contract superseded by single execute.

### Phase 4: 开放契约及解析
**Status:** complete
- [x] 单 execute、DTO/attempt 不变量及测试
- [x] 原生 parser 修复，同源浏览器脚本与上下文提示回归通过

### Phase 5: 注册与持久运行
**Status:** complete
- [x] registry/records/context/scheduler/results，按真实接口交接
- [x] 来源核验、成功保存后异步触发、版本去重和取消恢复

### Phase 6: 预期案例与管理
**Status:** complete
- [x] 真实独立 Agent 适配与预期整理案例、配置；缺能力等待
- [x] 鉴权 API、运行日志页面、复盘提示与详情槽入口

### Phase 7: 验证交付
**Status:** complete (source/offline); live acceptance blocked
- [x] 定向集成、typecheck/build/compliance/diff；全量 105 文件 1005 测试零跳过通过（15 秒 I/O 预算）
- [x] 使用与证据说明 docs/spikes/keyword-framework-mvp-2026-10-11.md
- [ ] 真实宿主模型、取消清理与页面操作：当前 DSH 进程/3080 监听均为 0

### Phase 1: 任务0当前基线与宿主
**Status:** blocked
- [x] 核工作区归属，保留既有改动；重跑当前门禁。
- [x] 安装0.2.0-rc.2 Jobs/Agent/Skill/管理槽源码和公开内嵌类型核验。
- [x] 最小Jobs适配、详情槽主体/接线、安全get读取。
- [x] 真实安装Jobs/SlotRegistry/Cordis无行情离线探针。
- [ ] live DSH服务、实际模型与scoped Skill、正式详情页执行日志/取消验收：匹配进程0、监听0、3080 ECONNREFUSED。

### Phase 2: 任务1公共契约
**Status:** complete
- [x] 六方法/FollowupRequest/Mention/解析签名/来源/任务/状态/私有与公共凭据。
- [x] preparedSnapshot/moduleCommitFacts/候选实际Skill指纹/信封与投递。
- [x] 状态和DTO白名单测试；测试文字模块，JSON往返/配置副本/幂等投递/guard。
- [x] records/scheduler/短来源核验/受控context/HTTP的准确类型声明，未建空壳。

### Phase 3: 验证与交接
**Status:** complete
- [x] 定向14条及全量89文件859测试通过，类型/构建/合规/diff通过。
- [x] 独立审查问题先复现再修；复审通过。
- [x] 两份spike文档、文件清单、parser可启动、后续包前置与阻断。

## Ownership
本轮原生 contracts 负责契约/运行时；host_adapter 负责 Agent/鉴权 API/records；parser_fix 负责解析/管理页面。主协调负责来源、旧保存/页面装配、预算防线、集成测试与共享记录。子代理额度耗尽后主协调接管收尾，无并行修改同一文件。ZCode registry 已交付并接受；无产物 records/UI 已取消，不再启动新任务。

## Errors and resolutions
- 初始钩子PLAN TAMPERED：未清除设计校验，不使用设计完成状态冒充实现。
- 初始化共享指针安全写入失败：保留指针；显式env绑定成功。
- 初次patch同文件双操作失败：无修改，改为覆盖新创建开发模板。
- 首次测试spawn EPERM：允许子进程后实际运行。
- 新测试先因缺模块失败；结果未知字段回归先失败后修白名单。
- 安装Jobs wait必须有正数超时：按实际wait(id,1000)，不是sleep。
- 审查发现prepare配置引用/清理拒绝吞掉：分别新增失败回归再修复。
- 审查role模型账户不支持：继承模型重试，复审通过。
- 真实slot测试初次fixture生命周期/ID错误：按实际fiber await及PANEL_ID修正。
- 真实slot暴露可选conversation直接属性抛错：按公开get修生产读取并验证真实plugin释放。

## Scope and remaining risks
无新增依赖、上游修改、交易、真实 vault 写入、模型调用、profile 部署、主聊天 followup 或提交。本轮以 MVP 闭环交付，不机械标记分工索引全部扩展完成。来源核验、运行记录校验、取消恢复、预算与结果校验已落地；次日自动回查/行情取证留到后续。真实宿主验收仍阻断；保存通知登记前的崩溃/卸载间隙靠显式重扫恢复，记录锁面向单宿主进程。

## 2026-10-12 导航与设置调整计划（编辑前）
- 用户明确目标：左侧仅按钮，点击在右侧主页面显示功能；插件配置移入设置弹框独立页。
- 清理：移除把 ReviewPanel 正文注册为侧栏图标及错误 main id 接线；根scope不再显示会触发 conversation.send 的旧汇总面板。复用真实宿主 keyed main（key=trader-kit-review）/sidebar icon/settings.section，不接管宿主其它插件导航。
- 主协调：src/client/index.ts、src/client/panel/Workspace.ts、params、package注入、真实Slots回归和交付/安装。
- workflow_views：管理页hash视图#runs/#settings及定向测试；不与主协调同文件修改。
- ui_contracts只读接口核验：sidebar.panellist是图标、main keyed必须key，settings.section是root/list，配置live服务只支持volatile，本轮保留全局模型/目录宿主文件入口，不引入假的配置保存。
- 编辑前锁定侧栏/右侧/设置注册和单脚本构建行为；真实SlotRegistry root声明main keyed复现旧接线失败，再修。
- 验证：定向、类型、构建、全量含离线探针、合规/diff；更新已授权web安装包并在用户浏览器验证导航和设置，不提交、不写真实vault、不自动模型激活。

## 2026-10-12 关键词二级设置页计划（编辑前）
- 目标：设置→交易工作流内关键词导航，右侧按选中关键词切换工作流配置/执行历史。用户要求直接调整，沿自主执行授权不重复审批、不提交。
- 选择：在已有同源管理页实现二级导航与页签，复用registry/settings/tasks/task/events接口；不用每个关键词单独iframe或新后端配置服务。
- 当前公开registry只提供id/label/mentions/enabled/definitionRevision，禁止曝完整options。可编辑项只有启用状态；映射与版本只读，预期无专用参数。别名映射同workflowId共享配置/历史，页面明确。
- 清理：#settings从平铺开关变成关键词详情；移除其任务端全工作流选择与重扫入口。历史仅在用户打开历史页签时GET tasks并固定workflowId，不自动Agent。
- 接口：GET registry返回已有DTO；POST settings {settingsRevision,workflows:[{workflowId,enabled}]}显式CAS保存；GET tasks带workflowId及分页/筛选；task/events仍原接口，当前workflowId再次验证响应身份。settings历史只读，取消/重跑沿右侧任务页，不在配置页新增执行入口。
- 归属：workflow_views独占src/client/processors/page.ts及test/routes-review/workflow-page.test.ts。主协调独占src/client/panel/Workspace.ts、test/client/keyword-management-section.test.ts及README/规划/交付文档。ui_contracts只读审查。
- 回归：先跑10条页面基线+客户端测试；新增2个关键词（含别名）的切换/独立配置CAS/历史限定/迟到响应/空表/隐藏恢复回归先失败，再修改。保留无hash与#runs行为。
- 样式：弹框内关键词导航约140px、详情区flex；窄屏折叠为横向关键词导航；状态徽标、清晰卡片、紧凑历史行与摘要，不默认大片JSON。高级明细可展开。
- 门禁：定向→typecheck/build→全量含真实离线探针→合规/diff。完成包更新授权web安装，实际宿主缓存若需重启，沿用户已明确授权的当前3080宿主加载方式精确核验后执行，不重复请求同一授权。真实vault和模型不激活。
- 完成：14条基线、RED/GREEN及32条定向验证、独立复审、最终106文件1018测试通过；r2安装和当前3080真实页面验收通过。

## 2026-10-12 基本设置页计划（编辑前）
- 用户要求查看基础配置，沿既有直接执行/不提交授权。新增与关键词并列的基本设置tab，默认基本页；保留关键词二级页和任务页行为。
- 基础数据来自当前ResolvedTraderKitConfig和AREA_TABLE：数据根、标的、模式、复盘、缓存运行、业务skill目录；模式显示reserved，未配置根显示未配置，不探测/创建目录。不展示writeKey或完整配置。
- 独立同源认证GET /dsh-trader-kit/review/api/basic-settings，装配在无dataRoot时也注册；仅JSON白名单，禁缓存，无POST。DTO {dataRoot,directories:[{id,label,relativePath,absolutePath,status}],processing:{enabled,provider,model,cwd,maxConcurrency,agentAttemptLimit,maxTokens,timeoutMs},tqLocalEnabled}。
- backend worker独占新src/routes/basic-settings.ts、src/review/processors/index.ts、新test/routes-review/basic-settings.test.ts；frontend worker独占page.ts与workflow-page.test.ts。根负责Workspace注释、README及规划集成安装验收。不得覆盖其他改动。
- 先页面/API基线与RED，再最小实现；复用请求epoch/错误处理和textContent，不读取资产或激活模型。基本页加载时不查历史，切换作废旧请求。
- 定向、typecheck/build、全量带离线探针、合规/diff；授权web安装和精确3080重启，真实只读UI验收，记录未验边界。

## 2026-10-12 数据目录相对路径展示修正（编辑前）
- 用户要求沿项目已有相对目录，基本页业务目录只显示DTO.relativePath，不再展开absolutePath或重复相对目录提示。dataRoot作为解析基准单独展示，Agent cwd仍当前配置值。
- 最小展示修正，清理重复冗长路径；不改AREA_TABLE/配置/后端DTO，不写资产。不新增依赖或抽象。
- 主协调独占page.ts、workflow-page.test.ts和README/既有交付记录；先19条基线，再改现有行为断言RED并锁定完整五目录/缺根仍展示relativePath，再最小实现GREEN。
- 类型/构建/测试/合规/diff门禁，更新已授权web安装，精确3080当前宿主重启及只读浏览器验收。

## 2026-10-12 标的/模式目录选择与保存计划（编辑前）
- 用户明确选择分别调整标的、模式目录并保存相对数据根路径。数据根不在本轮编辑，默认沿AREA_TABLE。使用宿主directoryPicker native能力，不用webkitdirectory伪造路径；浏览模式/缺能力明确不可用。
- 新配置directories.stock/patterns默认现行映射，严格相对路径。resolveArea可受控覆盖这两个目录；业务stock读取与首卡create-only都消费同一已解析配置，模式保留reserved写禁令。其余复盘/缓存/运行记录/skill目录不开放编辑。
- 基础API扩展GET editing:{available,revision,unavailableReason?}；POST /basic-settings/choose-directory {directory:'stock'|'patterns'}返回{directory,relativePath:string|null}，取消null不改草稿；POST /basic-settings/save {revision,directories:{stock,patterns}}经当前配置CAS和realpath+目录校验保存。
- 所选/保存目录只接受数据根内部真实目录；跨盘、外根、..、符号链接外逃、文件而非目录拒绝。不开迁移/移动/新建，不改变真实资产。服务端abort用户关闭/切换与插件卸载时取消nativepicker。
- 配置持久化用实际宿主configEditor.edit当前entry及最新raw config，保留其余字段/密钥，写后宿主正常Loader重载插件；界面明确保存应用会重载，结果只确认保存，不使用旧service读回。能力缺失禁用保存并显示原因，不假成功。
- 文件归属：paths worker配置/resolveArea/stock相关消费者及对应回归；UI workerpage.ts/workflow-page.test.ts；根basic-settings API、hostadapter与其测试、注册数量及集成文档。host_contract只读宿主证据。各自先基线/RED再修改，不交叉写。
- 定向→type/build/全量离线探针/合规/diff，已授权安装与宿主加载。真实UI验收只检查按钮/只读能力，不替用户选择真实目录或点击保存，不改当前vault/model预算。
- 并行复盘页变更连续干扰主工作区门禁（缺常量/外链字面/前后hash变化）。为不覆盖其他任务，保留主工作区，创建workers/directory-editor-delivery隔离源码/测试/文档快照；复用node_modules Junction，不安装新依赖。pnpm自动依赖检查拒绝共享modules后改直接执行现有tsc/tsdown/vitest CLI，无配置修改；快照上完整门禁与打包安装作为交付事实，注明主工作区并行变更另行集成。

## 2026-10-12 通达信登录链接与记住登录计划（编辑前）
- 用户选择方式一，并明确要求发布到默认DSH环境、重启后回来验证；不新增配对协议、不改宿主源码、不提交、不写真实vault或激活模型。
- 复用宿主公共authorizeIndex消费用户提供的登录凭据并建立真实Cookie；已认证设置页才可获取当前进程登录链接。匿名入口不生成/下发登录凭据，Host/Origin拒绝403不能救援。
- 新GET /review/api/login-link仅Cookie认证后返回登录链接；GET /review/login接受单值token与白名单returnTo，代理根登录后保留Cookie响应并303返回本站复盘页。拒绝外域、API、登录循环、控制字符与编码绕过；错误/过期凭据中文提示并可返回重试。
- 复盘401显示连接DSH入口，与403及普通故障区分。显式粘贴同源根登录链接后跳转，回到当前标的/市场/日期；文本草稿按来源隔离临时保留，编辑中或带附件先提示保存，存储不可用不丢稿跳转。
- 基本设置增加复制登录链接；按钮点击时获取，Clipboard不可用可手动复制，切页清除显示和迟到响应。旧首次登录链接重启后需重取，既有Cookie默认30天，实际通达信持久保存待用户验证。
- 文件归属：login_backend独占新review-login路由、context-types、review/index及新后端测试；login_tdx独占review/index.html及新登录页面测试；login_settings独占processors/page及workflow-page测试。主协调独占其他集成断言、README、既有规划/交付记录与安装验证。
- 先现有回归与RED再实现；真实宿主登录/Cookie/401/403/跳转测试采用隔离凭据和临时HTTP服务，不使用假登录结果。定向→typecheck/build→全量含安装宿主离线探针→静态/差异检查，打包安装到web profile，精确重启当前3080宿主，只读真实HTTP验收并准确列出TDX待验证项。

## 2026-10-12 回退登录方案与事件源职责核验（清理前）
- 用户否定上轮登录方案，要求回退相关修改；输入复盘页职责为内容更新/修改，DSH服务端监听变更触发工作流，不要求输入页获取宿主会话。
- 只回退上轮登录桥、复制登录链接UI、复盘登录UI/临时草稿协议及其专项测试/静态豁免；保留既有关键词MVP、卡片免手动登录保存、目录编辑、来源/预算/取消保护与其他任务改动。参照已验证的directory-editor-delivery快照逐文件审查差异，不使用git reset/checkout覆盖整个工作区。
- 先保留当前定向回归证据；已接受的目录/工作流测试不删除。确认快照差异仅本轮登录变更后恢复对应文件；如果有无关变更，只撤销登录hunk。专项新增文件保留到workers快照后从生产/测试删除。开发记录保留，并明确上轮交付已撤销。
- 输入页与管理接口职责分开：先核查实际保存/修订/删除通知如何登记后台关键词任务；不把管理GET401推定为事件触发失败，不放开宿主或整个管理API。默认执行关闭与模型未配置作为独立条件如实交付，不擅自改真实模型配置或激活Agent。
- 门禁仍typecheck/build/全量真实离线探针/静态diff，重新打包安装默认web profile并精确重启3080。验收只读页面与接口，不写真实vault；测试使用临时目录。native只读agent负责事件链证据，主负责精确回退/页面职责/门禁安装。
- 核查确认store成功提交事件已独立驱动后台登记，管理GET401与触发无关。输入页删除registry/cards管理GET、状态DOM与内联解析器依赖，保留静态职责提示；DSH管理页保持原权限与功能。frontend独占HTML/context/page测试，event-source agent独占新增真实宿主HTTP→持久登记组合回归，根独占集成静态登记/文档/安装。
# 2026-10-13 等待任务可见性与关键词配置易用性（编辑前）
- 用户截图任务实际已经登记：expectation、sh000001、2026-10-13、card-20261013-000001-2023；来源原文与截图一致，waiting/workflowDisabled，attempts=0、result=null。当前页面服务状态JSON挤占主区域且关键词默认配置tab、历史命名不包含等待，造成看不到任务。
- 采用紧凑运行摘要，关键词默认任务记录（含等待），显式切换触发设置；关键词开关控制允许执行，关闭仍可识别并登记；与全局自动执行明确区分。显示等待原因与来源标的/日期/本地时间，原始JSON放折叠高级信息。读页面不唤醒任务，不恢复输入页管理职责。
- 配置页新增显式自动执行/模型设置：enabled/provider/model/cwd四字段，CAS保存经现有configEditor真实持久化和插件重载；复用当前hostadapter owner与revision，不引入新依赖。全局能力可编辑性独立于native目录picker；其余目录、预算和密钥保持当前raw配置。
- 新GET basic-settings executionEditing能力/版本；POST /basic-settings/save-execution {revision,processing:{enabled,provider,model,cwd}}仅宿主Cookie、403不可救援、JSON字段白名单与体积限制。启用前须数据根/非空模型服务模型/有效绝对工作目录具备，不虚构可调用模型验证。保存明确告知可能接纳已等待任务；本次验收不实际保存或开启。
- 分工：backend worker独占directory-settings-host.ts/basic-settings.ts及两者关联测试；UI worker独占processors/page.ts/workflow-page.test.ts。根独占其余静态集成断言、README/开发记录与安装验证。不改Agent单execute协议、来源/预算/取消保护，不提交、不写真实vault、不激活模型。
- 先既有回归→RED→最小实现，真实SDK配置编辑离线探针验证CAS/保留字段/重载，不使用假Agent或固定成功。最终typecheck→build→全量4worker含真实宿主探针→静态diff，更新默认web安装及精确3080重启，实际只读验收，外部真实TDX/模型未验明确列出。
- 完成：页面26项/后端15项定向、type/build、111文件1063全量、静态/diff与独立复审通过。keyword-visibility包安装web、5编译hash一致，3080精确重启PID38556；实际API验证原20:23任务仍waiting且0Agent，配置编辑可用，真实profile与run字节未变，输入页仍免登录。未点击保存开启或调用真实模型。

## 2026-10-14 GitHub提交与Web Pro规划交接（清理前）
- 用户明确授权提交并推送当前变更，保持codex/review-switch-p0分支；源码、测试、设计与核心开发Markdown纳入，安装包/worker探针/宿主日志/本地活动指针不公开、不删除。
- 类型、构建、113文件1089测试零跳过已完成；暂存153文件，凭据样式检查未发现真实新凭据。既有dev-cert私钥是已跟踪测试fixture，不在本次新增范围。
- 暂存diff检查报告新增文件末尾空行；仅删除这些尾部多余空行，保持原文本内容与换行风格，不做代码重构或全仓格式化。
- GitHub HTTPS握手失败后以单次命令使用现有本地SOCKS代理成功fetch；未改全局Git/代理配置、未关闭证书校验，不强推。
- 先提交推送当前源码基线，再生成携带固定提交号的联网研究/架构/UX/分阶段验收提示词，保存到docs/prompts并以独立文档提交推送。不虚构Pro子agent能力或仓库访问能力，要求不能访问时明确报告。
