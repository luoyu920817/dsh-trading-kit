# Progress — keyword-framework-01-development

2026-10-10
- 读取指定执行文档与技能，创建并显式绑定开发目录；设计记录只读。
- 安全更新共享指针失败，未覆盖指针。记录规划钩子的PLAN TAMPERED及初次patch失败。
- 当前基线typecheck/build/845测试/合规/diff通过；测试沙箱spawn失败后获允许重试。
- 主代理先写types与fixture导入契约，确认缺文件失败，再实现8条契约；后来新增结果未知字段测试先失败，再修白名单。
- 组件/Jobs先测试缺模块失败，后最小实现。真实安装Jobs探针首次wait缺必填超时失败；按实际签名修测试wait(id,1000)，10条定向全部通过（不使用sleep）。
- 只读宿主agent记录实际安装包、来源行号、Agent/Skill/管理槽。未进行live模型/页面验收。
- independent reviewer首次配置模型不被账户支持，未运行；使用继承模型重试审查。
- 最终门禁及接口交接文档进行中。

## Final verification / handoff
- typecheck exit0；build exit0（已有external弃用提示）。
- 显式KEYWORD_HOST_PROBE_ROOT的pnpm test：89文件859条通过，含本轮14条，零跳过宿主探针。
- scan-compliance自测、git diff --check通过；未提供lint脚本。
- 独立审查的两项缺陷各先失败再修复：配置别名漂移、done拒绝吞掉。真实slots再发现可选服务直接访问异常，改get后实际plugin加载/卸载通过。
- 从原样注册器区段评估真实SlotRegistry/SlotCore/Cordis，无React/服务stub、不执行浏览器渲染。
- 当前匹配桌面或Node/Bun DSH进程0，匹配监听0；3080 GET ECONNREFUSED，live阻断明确。
- docs/spikes/keyword-management-jobs.md与keyword-framework-contracts.md交付。parser签名已固定，任务2可启动；后续包仍按依赖启动，无自动下发。
- 开发阶段2/3完成，阶段1live项blocked；不将任务0或框架整波报完整通过。

2026-10-11 MVP
- 已读取最新分工索引/设计/真实旧实现，启动契约及host适配子任务。
- zcode MCP task_mv3srjws_1/task_mv3sszpe_2 启动失败，排查provider资源路径。

- source定向3/3：真实文件名身份伪装回归先失败后通过；附注版本/删除/根外/重复锚点已验证。初次测试启动受EPERM阻断，直接Node并审批spawn后可运行。
- expectation定向2/2：新模块缺失RED后GREEN，原句/字段/交易语义拒绝覆盖。
- paths新增processorRuns既有白名单内路径；首次RED因worker fetch超时仅基础设施失败，GREEN14/14，未冒称RED断言证据。
- zcode指定model通过modelSwapChain串行，已派records和UI等待，registry独立不切model并行。原parser读设计过久，取消后同会话收敛续接；第一次续接model creation失败，无代码变更，换当前可用选择重试。

## 2026-10-11 MVP final delivery
- 用户收敛目标到 @预期 MVP 后停止新增 ZCode 调用。接受已验证 registry 产物；无集成产物的 records/UI 任务取消，原生 workers 接手，使用额度耗尽后主协调完成剩余集成。
- 单 execute 契约、解析映射、原子记录/去重、Jobs 调度、来源版本保护、取消恢复、每次真实 Agent 激活预算、预期输出校验、鉴权 API/管理页面/复盘入口已落地。
- 临时文件保存闭环回归通过；没有假 Agent 成功。缺能力任务持久显示等待。
- 类型检查、构建、合规自测和 diff 检查通过；无 lint 脚本。
- 最终全量：105 文件 / 1005 测试通过，零跳过，包含安装离线 Jobs/Slots 探针。使用 --pool=threads --maxWorkers=1 --no-file-parallelism --testTimeout=15000。日志 workers/final-mvp-tests-io-budget.log。
- 默认 5 秒上一轮 1004/1005，旧 store-images 文件生命周期超时；保留 workers/final-mvp-tests.log，未修改旧业务逻辑或全局测试配置。
- 构建资源、同源解析脚本和复盘内联脚本离线核验通过；不等同真实模型或浏览器验收。
- 当前 DSH 进程 0 / 3080 监听 0，真实模型、scoped Skill、宿主取消和 CEF 页面操作未验。未部署/重启/提交/写真实 vault。
- 最终说明 docs/spikes/keyword-framework-mvp-2026-10-11.md。记录单进程锁与首次登记前通知间隙、显式最多 31 天重扫边界；没有次日自动回查或行情取证。

## 2026-10-12 用户授权安装
- 按前一轮说明的 CLI web profile 安装；没有修改 desktop 等其他 profile。
- pnpm build exit0；pnpm pack --out dsh-trader-kit-0.1.0-keyword-mvp-20261012.tgz exit0。
- dsh plugin --profile web add E:/work/code/open/dsh-plugins/dsh-trader-kit/dsh-trader-kit-0.1.0-keyword-mvp-20261012.tgz exit0，profile 依赖已指向新 tarball。
- 实际安装 runtime/agent/root 装配/API/管理页/复盘页/config.js/card-processors.json 共 9 文件 SHA-256 与当前构建完全一致。
- 包管理器提示 peer dependency 警告，安装成功；真实宿主兼容性仍需启动后核验。
- 未启动/重启宿主，未开启自动执行或填写模型配置，未写真实 vault。安装成功不代表真实模型或页面验收通过。

## 2026-10-12 客户端 import 失败修复
- 用户浏览器 console 原始证据：plugins/??dsh-trader-kit/client.js 的 SyntaxError: Cannot use import statement outside a module。服务端已安装 lib/index.js Node import 通过，错误在客户端产物格式。
- 使用 systematic-debugging，核对宿主 packages/client/tsdown.client.ts 与只读 DSH-better-sidebar 先例：普通脚本必须 window.__ModuleLoader__.load({id,factory})，factory 使用共享 require。
- 修改 tsdown.config.ts 的客户端配置为单文件 CJS closure factory，内部模块打包、React external 不夹带副本；服务端保持 ESM。不新增依赖。
- 新增 test/client/bundle-format.test.ts：原 ESM Script 解析失败 RED；修复后 GREEN。原产物断言改读单文件，保留面板 ID/触发短语与共享 React/SDK/外链约束，8 条定向通过。
- 构建/typecheck/合规自测/diff 通过；完整门禁首次 1004/1006，仅两个旧拆分产物文件断言失败，已按真实单文件契约更新，最终门禁日志 workers/client-loader-fix-tests-final.log。
- 安装包 dsh-trader-kit-0.1.0-keyword-mvp-20261012-loader-fix.tgz；web profile 更新成功；已安装 client.js SHA256 与构建一致。
- 实际用户浏览器刷新后 Failed to load plugins 页面消失，DSH 主界面正常，复盘入口可见。没有重启 DSH、发送聊天、模型激活或写真实 vault。console 保留旧加载失败历史，不冒称删除历史日志。
- 页面证据 workers/client-loader-fixed.png。本次仅验客户端激活与主界面，预期真实执行/结果/取消验收尚未完成。
- 最终完整门禁 exit0：106 文件、1006 测试通过，零跳过；安装离线探针启用，15 秒 I/O 预算。源码类型/构建/合规/diff 全部通过。

## 2026-10-12 导航与设置调整计划（编辑前）
- 用户明确目标：左侧仅按钮，点击在右侧主页面显示功能；插件配置移入设置弹框独立页。
- 清理：移除把 ReviewPanel 正文注册为侧栏图标及错误 main id 接线；根scope不再显示会触发 conversation.send 的旧汇总面板。复用真实宿主 keyed main（key=trader-kit-review）/sidebar icon/settings.section，不接管宿主其它插件导航。
- 主协调：src/client/index.ts、src/client/panel/Workspace.ts、params、package注入、真实Slots回归和交付/安装。
- workflow_views：管理页hash视图#runs/#settings及定向测试；不与主协调同文件修改。
- ui_contracts只读接口核验：sidebar.panellist是图标、main keyed必须key，settings.section是root/list，配置live服务只支持volatile，本轮保留全局模型/目录宿主文件入口，不引入假的配置保存。
- 编辑前锁定侧栏/右侧/设置注册和单脚本构建行为；真实SlotRegistry root声明main keyed复现旧接线失败，再修。
- 验证：定向、类型、构建、全量含离线探针、合规/diff；更新已授权web安装包并在用户浏览器验证导航和设置，不提交、不写真实vault、不自动模型激活。

## 2026-10-12 导航/设置交付阶段
- 左侧改为纯图标，main keyed正确key，settings.section新增交易工作流。右侧卡片/任务两页签；配置hash模式不查任务，任务模式不修改配置，默认独立页保留兼容。
- 实际浏览器暴露关键词API prefix尾斜杠，核对真实宿主p/p子路径路由规则，新增失败回归后修为无尾斜杠。
- 最终typecheck/build/compliance/diff通过，全量106文件1011测试零跳过通过（15秒I/O预算、真实安装离线探针）。
- 已更新web profile到navigation-settings-20261012-r2.tgz。客户端/HTML/API SHA256一致，客户端manifest结构一致。
- 实际浏览器已验左按钮右页面及设置新入口；服务端旧HTML/API缓存需要重启加载，依用户此前“不自动重启”要求已通过async请求授权，尚未自行重启。
- 说明 docs/spikes/navigation-settings-2026-10-12.md；截图 workers/navigation-main.png。

### 导航调整最终复核补记
- 只读复核发现 hash 切换后旧 POST 收尾可能解除新写操作锁；真实 HTTP 回归先失败，修复 epoch 守卫后通过。停止页面时释放本页锁，恢复可操作。
- 最终 106 文件1012测试通过，零跳过，typecheck/build/合规自测/diff检查通过。
- r3 包已更新 CLI web profile；client、HTML、API三产物 SHA256与构建一致，客户端manifest结构一致。
- 实际浏览器左侧按钮→右侧主页面通过，设置入口通过。设置内容仍是旧服务端缓存，显示未知 API 路径；未重启，等待用户对先前不自动重启约束的单独授权。
- 实际截图 workers/navigation-main.png、workers/navigation-settings-entry.png。保留真实模型执行未验项，未写 vault。

### 用户授权重启与在线验收
- 用户明确允许重启当前 DSH web 3080。精确核验 PID10056 后重启为 PID1088，原 Node/CLI/web --no-open --port 3080，隐藏运行并保存stdout/stderr。
- 实际浏览器 #settings 新标题、工作流配置与能力/预算展示正确，无任务区；#runs 新任务视图正常，无配置区，注册表预期整理可读，任务空态正常。未知 API 路径消失，插件error查询为空。
- 在线截图 workers/navigation-settings-live.png、workers/navigation-runs-live.png；页面保持设置→交易工作流，便于用户检查。
- 自动执行关闭，Agent激活0/20；未提交配置或任务操作，未写真实vault。页面与只读API验收完成；真实模型运行及有记录的结果/取消/重跑继续列为未验。

### 关键词二级设置页基线与RED
- 10条实际管理页HTTP回归+4条客户端/真实Slots基线通过。
- worker新增4条多关键词/历史隔离回归已RED；旧测试调整到新保存控件后出现预期缺控件失败，其余基线继续通过。
- 真实接口无需后端修改：settings只目标enabled+CAS，历史按workflowId，task先核所属后events，空表不读任务。
- 页面ID交接 keyword-nav/title/mapping/aliases/enabled/save/config-tab/history-tab；主协调未修改worker所属page或测试。

### 二级页实现与复审
- page.ts与16条页面回归已交接；主协调独立重跑页面+相邻结构32/32通过，typecheck/build/合规自测/diff检查通过。
- 首次复核4必须修全部闭合：旧网络/JSON拒绝同epoch栅栏，registry失败作废并清历史，回调workflow空/可见性核验，真实definitionRevision/occurredAt字段。
- 只读复审无阻断。全量门禁启动，真实安装离线探针启用，15秒测试预算；日志workers/keyword-settings-final-tests.log。
- 沿用户前轮已授权的当前web3080重启方式，在最终产物通过后更新安装并验收二级配置/历史，不再重复请求同一宿主的加载授权。

### 关键词二级页最终交付与在线验收
- 实际设置弹框检查后压缩既有间距与标题尺寸，使关键词选择、配置/历史页签、启用与保存控件在首屏可见；仅样式微调，无新增抽象或依赖。
- 最终typecheck/build/合规自测/diff通过，106文件1018测试零跳过，耗时67.61秒；已启用真实安装离线探针，测试I/O预算15秒。最终日志workers/keyword-settings-final-tests.log。
- 安装dsh-trader-kit-0.1.0-keyword-settings-20261012-r2.tgz至CLI web profile，client/page/API三产物SHA256与构建一致。精确核验并沿既有授权重启当前web，最终3080监听PID46896，原Node/CLI及web --no-open --port 3080。
- 实际浏览器设置→交易工作流：@预期工作流配置/执行历史切换正常，历史按对应工作流显示空态；插件error查询为空。当前自动执行关闭、Agent激活0/20，未提交配置或执行任务，未写真实vault。
- 最终截图workers/keyword-settings-config-live.png与workers/keyword-settings-history-live.png，页面停留配置页供用户检查。当前真实注册只有@预期，多关键词/别名由实际HTTP离线回归覆盖；真实模型及非空历史结果/取消/重跑未在线验收。
- 交付说明docs/spikes/keyword-settings-detail-2026-10-12.md列明修改文件、复用与边界；本轮完成，无提交。

### 2026-10-12 基本设置页实现与集成
- 后端新增独立宿主认证GET basic-settings，路径与processing白名单快照；提前注册页面/API，缺根仍可查看。API4条先RED后GREEN，processor21条基线通过。
- 前端16条基线通过，新增3条实际HTTP页面回归先RED后GREEN；默认基本页只读基础API，关键词页显式选择后才查runtime，切换epoch隔离、读取失败清旧值。
- 根复现注册全量路由数14→16失败，更新真实新增路由精确/唯一/认证/缺根内容断言；独立组合40条全部通过（含真实安装Slots离线探针）。
- 类型检查、构建、合规自测、diff通过；只读复审无阻断。全量测试带离线探针与15秒I/O预算执行中。
- 基础页无新增目录配置能力、无文件系统访问，模式仍reserved；全局修改沿宿主配置+重启，工作流reload仅重载其定义。
- 首次全量1025测试中4项静态边界失败：新增配置读取路由被探针配置扫描覆盖、新HTTP测试未登记。已按具名文件补充配置面归属与回环测试通道，保留其它扫描域；实际传输新增同origin/本次随机端口/固定路径及禁凭据重定向保护，反向断言网络前拒绝非法目标。
- 静态30条及基础API5条通过。生产实现未改；最终全量r2日志basic-settings-final-tests-r2.log执行中。
- 最终全量107文件1026测试零跳过通过，115.20秒；类型/构建/合规与diff检查通过。
- basic-settings-20261012.tgz已安装CLI web profile；client/page/basic API/processor装配四产物SHA256一致。核验3080无监听后沿既有授权启动原Node/CLI web --no-open --port 3080，最终监听PID37700。
- 浏览器沿当前宿主登录入口恢复认证，设置→交易工作流默认基本页显示实际finance数据根、标的/模式等完整目录与processing未配置值；切换关键词配置再返回基本正常，插件error查询为空。页面保留基本设置，截图workers/basic-settings-live.png。
- 未提交配置、写真实vault或激活Agent；模型真实执行仍未验。目录仅展示、不探测存在；模式仍预留。完整交付证据补充docs/spikes/keyword-settings-detail-2026-10-12.md。

### 相对目录展示回归
- 当前19条页面基线通过；完整五目录与缺根目录的两条断言改为相对路径后RED（17通过、2失败），实现改用relativePath并移除重复绝对前缀后页面/API24条GREEN。
- 测试夹具同步生产active/reserved状态和实际模式相对目录；backend DTO、AREA_TABLE与配置未改。
- 类型/构建/合规/diff和最终全量门禁执行中；无提交、配置写入或Agent激活。
- 最终类型/构建/合规/diff通过；107文件1026测试零跳过通过，196.15秒。相对目录包relative-directories-20261012.tgz已安装web profile，page/API哈希一致，沿原授权加载宿主PID23776。
- 实际宿主认证HTTP页面200且包含relativePath新渲染表达式、无旧重复相对目录提示；基础API返回五条现行相对目录。此为真实宿主只读HTTP验收，不冒充浏览器视觉验收。
- 浏览器当前原tab已关闭，创建IAB页等待attach超时，inventory无tabs并连接报错；本轮截图/视觉验收未完成，不复用旧截图作新证据。源码页面实际HTTP+DOM回归覆盖相对目录显示，未改配置或写vault。

### 标的/模式目录配置与原生选择实现
- 用户明确选择分别调整stock/patterns并保存为相对dataRoot路径。配置默认沿AREA_TABLE，resolveArea仅这两个目录可覆盖；实际stock读取/首卡create-only/路由快照/工具传播同一实例目录，缓存键含目录。17条真实文件系统回归通过，覆盖多根/同根隔离、既有档案不变和junction拒绝。
- 页面19条基线、新编辑行为3条RED→22GREEN；用户显式choose/save，取消与错误保留草稿，缺能力禁用；CAS/共享锁/epoch保护与保存重载说明落地。
- root基础API5条基线；新editing/受保护POST契约RED→6GREEN，纯配置CAS/real目录边界2条RED→GREEN。register精确路由数18，缺ctx.get/fiber仍只读可用；静态文件归属具名增加目录宿主适配器，静态/接口38条通过。
- 实际宿主API核验后复用directoryPicker.capability native.pick(signal)和configEditor.edit(entry,change)，不用volatile设置/新依赖/自写profile。chooser request断开及插件dispose取消并清理；仍连接客户端收到冲突提示，避免悬挂响应。保存只确认saved，不读已卸载旧服务。
- 真实宿主临时profile探针3/3：ConfigEditor正常保存保留其它字段/密钥/注释并dispose/reapply，activation失败实际回滚，生产adapter真实ctx.get/fiber.entry正向能力和staleCAS验证。真实NativeDirectoryPicker实例化但未打开窗口。
- 当前typecheck/build通过，合规自测/diff通过；全量同时启用KEYWORD_HOST_PROBE_ROOT与DIRECTORY_SETTINGS_HOST_ROOT执行中，目录原生窗口实际选择/取消仍未验，不写真实目录配置或迁移资产。
- 首次全量1052测试2失败为门禁期间复盘页并行变化，当前src已采用cloneNode且无字符串HTML注入，两条静态测试定向27/27通过。保留他人修改；重新type/build/全量并记录测试前后生产源码SHA256，避免安装混合旧产物。
- 真实NativeDirectoryPicker的预取消信号已补3/3探针：核验Win32实现先拒绝signal再spawn，实际生产choose拒绝且temp profile字节不变，没有打开窗口。
- 主工作区r2类型检查被并行图标改动阻断，恢复后r3全量4失败且源hash变化。全部失败在复盘页外链/编译类断言，目录功能核心11条仍通过。
- 隔离交付快照已创建（workers/directory-editor-delivery），保持原工作区所有源码与测试。快照typecheck/build/合规通过，全量110文件门禁执行中，两个实际宿主probe env均启用。复用依赖，pnpm保护拒绝跨项目modules目录后不尝试删除或重装，改直接调用现有工具CLI。
- 隔离快照最终110文件1052测试零跳过通过（277.87秒），typecheck/build/合规自测通过。当前主工作区120份src/config生产文件与快照SHA256全部一致，未覆盖并行修改；git diff检查通过。
- 从快照npm pack（ignore scripts，复用现有依赖）生成directory-editor-final-20261012.tgz并安装web profile。page/basic API/hostadapter/resolve/config/review HTML六产物SHA256与快照一致。
- 沿既有授权精确加载当前web3080，最终PID38716；实际认证HTTP基本页200，editing.available=true、revision存在，两个choose按钮和save入口存在，stock/patterns仍默认值。未调用POSTchoose/save、未实际更改目录或迁移资产。
- 当前浏览器未附着，open_in_codex当前宿主认证入口返回queued；未声称截图或桌面窗口选择已验。原生窗口实际选中/取消、真实模型运行仍列未验；预取消信号与持久保存在真实临时宿主probe已验。
- 交付完成，包/日志/隔离可复核源码保留于当前开发规划，未提交。

### 用户确认并行任务结束后的主工作区复核
- 用户授权接手剩余编译修复。当前src/config与已验收交付快照逐文件哈希无差异，未发现需要再改的源码。
- 在主工作区新运行pnpm typecheck、pnpm build均exit0；复盘页面/图片/构建/静态边界4文件48测试全部通过。日志directory-editor-main-build-verified.log与directory-editor-main-review-verified.log。
- 之前缺图标常量/HTML注入字面/外链字面阻断已解除，不覆盖已完成并行修改，不重复提交或安装。
# 2026-10-12 通达信方式一登录交付（已按用户要求撤销）
- login_backend/login_tdx/login_settings按独占文件并行完成宿主Cookie登录桥、复盘连接入口与草稿保护、设置显式复制链接；未启动zcode，未覆盖现有工作区。
- 已认证GET login-link才下发链接，匿名401/来源403封闭；宿主authorizeIndex实际兑换Cookie并安全303回来源页面。query白名单仅code/market/date，不复建认证算法。
- 独立复审的registry缓存恢复/迟到响应和403 JSON交接问题均RED→GREEN修复。最终typecheck/build、112文件1068测试（真实离线宿主探针全启用、零跳过）、静态/diff通过。
- 新包tdx-login-20261012已安装web profile，6产物hash一致；精确重启3080宿主为PID53440。实际HTTP的链接获取、Cookie兑换、来源返回、registry、设置入口与来源403通过；宿主宣告客户端包200，正确loader包装。
- 不改真实vault/目录/model/自动执行开关，不自动Agent。随后用户否定该方案；相关源码、专项测试与交付文档已撤销，留存workers/tdx-login-reverted，不再要求通达信配对或复制登录链接。

# 2026-10-12 复盘事件源交付与登录方案撤回
- 用户否定复制链接/登录方案后，逐文件核验与上轮前快照的差异并精准撤回10文件登录修改、3个新增专项文件，历史文件保留workers/tdx-login-reverted；未reset其他工作区改动。
- 输入页删除processors registry/cards管理GET、内联解析、任务状态DOM及相关控制器，不影响内容保存/修改/删除与来源/附件/幂等。DSH后台仍沿真实store提交事件解析、映射、持久登记并去重。
- 新真实SDK+HTTP+store+runtime组合回归覆盖无cookie保存@预期、重复、修订旧源取消、新源登记、删除取消保留历史、Origin403不写入，明确等待且0 Agent/行情，不冒充成功。
- typecheck/build/静态diff通过；首轮全量3项并发超时后不改断言或生产逻辑，以4个worker复测111文件1055项全部通过、真实离线探针零跳过。独立复审无P1/P2。
- review-event-source-20261012包已装默认web profile，6关键编译hash一致且无旧登录路由。精确3080重启为PID1292；实际免Cookie输入页200、去掉登录和管理GET、旧登录link404、管理registry仍401。
- 不写真实vault，不改真实模型/自动执行配置，不自动Agent，不提交。详见docs/spikes/review-event-source-2026-10-12.md；真实TDX输入和真实模型执行由用户验收。

# 2026-10-13 等待任务与配置易用性交付
- 核对真实来源原文、上证sh000001日期2026-10-13/card-20261013-000001-2023：20:23:49已登记expectation，waiting/workflowDisabled、0attempts/null结果。任务未运行是自动执行关闭，原页面默认配置且巨型状态JSON/“执行历史”入口隐藏等待任务。
- UI默认任务记录含等待、市场代码/交易日/上海登记时间、明确全局vs关键词开关、JSON默认折叠。共用执行表单显式保存enabled/provider/model/cwd，填写配置不冒充模型可用，冲突禁写、迟到隔离。
- 复用实际ConfigEditor/owner/hashCAS的执行编辑不依赖picker，仅四字段，保留原预算/秘密/未知字段；实际SDK成功和执行激活失败回滚验证通过，不操作真实配置或Agent。
- 页面26项/后端15项定向、typecheck/build、111文件1063全量零跳过、静态diff及复审通过。keyword-visibility-20261013包已装web，5产物hash一致，精确3080重启PID38556。
- 实际API仍返回原任务waiting、自动执行false、模型未配置、今日调用0；executionEditing可用、设置页200、输入页免Cookie200、匿名执行保存401。原profile与原任务JSON前后hash相同。详见docs/spikes/keyword-task-visibility-2026-10-13.md，真实浏览器视觉/实际模型执行未验。
