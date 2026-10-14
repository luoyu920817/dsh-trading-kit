# 关键词二级设置页

用户要求在宿主设置弹框内按关键词切换对应的工作流配置与历史记录，替代平铺的简单开关页。

## 页面与契约

采用已有管理页内的关键词导航与「工作流配置／执行历史」二级页签，保持「设置 → 交易工作流」入口。导航来自真实注册表；当前生产仅有 `@预期`，不添加演示关键词。不同工作流的历史按 `workflowId` 隔离，同一工作流的多个关键词别名共享配置和历史，并明确说明。

配置只编辑当前映射工作流的启用状态，显式提交 `settingsRevision` CAS；工作流标签、关键词映射和版本作为只读信息。公开 DTO 不包含完整 `options`，本轮保持这个边界，不伪造模型／路径／专用参数表单。全局 `review.processing` 仍由宿主「打开配置文件」管理。

打开历史页签才读取对应工作流的任务页，保留分页、详情、结果和日志。历史视图只读，任务取消与显式重跑仍在右侧关键词任务页。先核验详情的 `workflowId` 后读取日志；关键词或页签切换作废旧请求，防止旧结果跨页呈现以及旧请求解除新操作锁。打开和切换页面不调用 Agent、不提交配置、不重扫卡片。

保留 `#runs` 任务页和无 hash 独立完整管理页；不改运行时单 `execute` 契约，不引入依赖或新配置服务。

## 文件归属与验证

`workflow_views` 负责 `src/client/processors/page.ts` 和 `test/routes-review/workflow-page.test.ts`；主协调负责宿主嵌入说明、文档、集成、安装及在线只读验收；`ui_contracts` 只读核查接口与切换保护。

编辑前 10 条管理页测试与 4 条客户端／真实 Slots 基线通过。新增多工作流、别名、目标配置保存、历史分页隔离、迟到结果、空表和切换保护回归先失败后实现。实现后页面16条、相邻结构16条定向通过；只读审查发现的旧请求拒绝路径、注册表失败的在途读取、版本与事件时间字段问题均修复并复审通过。

实际宿主验收后收紧标题、卡片及关键词区间距，让配置区在弹框首屏可见，并合并样式规则；只改呈现，无新请求或写入。最终类型检查、构建、合规自测及diff检查通过，仓库无lint脚本。最终全量106个文件、1018条测试通过，零跳过，真实安装离线探针启用，15秒测试I/O预算。日志位于开发规划目录 `workers/keyword-settings-final-tests.log`。

## 安装与在线验收

已更新CLI web profile至 `dsh-trader-kit-0.1.0-keyword-settings-20261012-r2.tgz`，客户端、管理页与API三产物SHA-256均与最终构建一致。沿用户已授权方式精确核验并重启当前 `web --no-open --port 3080` 宿主，最终PID46896，仍只监听127.0.0.1:3080。

实际浏览器在「设置 → 交易工作流」展示真实 `@预期` 导航、映射「预期整理」、启用状态及「工作流配置／执行历史」页签。配置与历史互斥切换正常，历史当前无匹配记录；无任务取消／重跑／重扫或全工作流筛选入口。当前注册表只有 `@预期`，多工作流与别名的切换由真实HTTP回归验证，未向真实配置添加演示关键词。插件控制台error查询为空，自动执行关闭、今日Agent激活0/20。未点击保存配置、重载或任何任务执行操作，未写真实vault，无提交。

证据：`workers/keyword-settings-config-live.png`、`workers/keyword-settings-history-live.png`。本轮修改文件为 `src/client/processors/page.ts`、`test/routes-review/workflow-page.test.ts`、`src/client/panel/Workspace.ts`（嵌入说明注释）及README、开发规划与本说明。复用既有API和DOM，历史与配置按关键词收纳，原始JSON明细折叠，不新增依赖或后端契约。

真实模型执行和有记录的结果／取消／重跑仍未在真实vault验收；本轮页面只读验收不能替代这些项目。

## 基本设置页补充（2026-10-12）

设置→交易工作流现在默认打开「基本设置」，与「关键词工作流」并列。展示当前运行配置的数据根、标的档案、模式、复盘、工作流记录及业务Skill目录，以及自动执行、Provider、模型、Agent工作目录、并发/预算/Token/超时和TQ-Local只读基础信息兜底开关。

路径来自现有AREA_TABLE与已解析配置。模式目录为`交易系统/平常心/方法论/模式`，明确标注「预留未接入」；标的目录为`DB/stock`。目录展示不探测存在性、不读取或创建文件。缺数据根时仍注册基础设置API与管理页面，完整路径显示未配置；复盘目录保留月份模板。

基础配置只读，修改沿宿主「打开配置文件」并重启后生效。页面刷新读取当前运行快照；关键词「重新加载配置」仅重载工作流定义。基础GET沿宿主认证、不允许写键救援、不允许POST且禁止缓存；只返回白名单，不暴露writeKey、行情签名或完整配置。

新增/修改文件：`src/routes/basic-settings.ts`、`src/review/processors/index.ts`、`src/client/processors/page.ts`、`src/client/panel/Workspace.ts`（注释）、`test/routes-review/basic-settings.test.ts`、`test/routes-review/workflow-page.test.ts`、`test/routes-review/review-registration.test.ts`、README与本开发规划。复用现有页面请求/epoch保护与目录映射，无新依赖或后端配置写服务。

验证：页面16条基线→新增回归RED→19条GREEN，基础API缺模块RED→4条GREEN；组合40条定向验证含安装Slots离线探针通过。根复现并更新新增精确路由注册断言；独立只读复审无阻断。类型、构建、合规自测与diff检查通过；仓库无独立lint命令。

静态门禁补记：新增配置读取面与实际HTTP测试分别在`test/probe/probe-registration.test.ts`和`test/routes-review/review-structure.test.ts`具名登记。其它扫描域保持不变。实际HTTP测试每次请求强制同本次服务器origin与随机端口、固定基础API路径，无重定向或URL凭据；新增非法目标拒绝验证后API5条通过，静态30条通过。

最终门禁为107文件1026测试零跳过通过（115.20秒），含真实安装离线探针；日志basic-settings-final-tests-r2.log。已安装`dsh-trader-kit-0.1.0-basic-settings-20261012.tgz`至CLI web profile，client/page/basic API/装配四产物SHA256匹配。当前3080起初无监听，沿此前用户授权启动原Node/CLI `web --no-open --port 3080`，最终PID37700。

真实浏览器设置→交易工作流默认基本页显示当前finance数据根、标的与模式完整路径、预留状态及实际processing配置；基本→关键词→基本切换正常，插件错误查询为空。截图`.planning/2026-10-10-keyword-framework-01-development/workers/basic-settings-live.png`。未修改运行配置、调用模型或写真实vault；目录存在性不探测，模式工作流及真实模型结果仍未验。页面与安装验收不冒充模型执行验收。

## 数据目录相对路径展示修正

基本页业务目录现在直接展示项目映射的relativePath，不拼接数据根绝对路径，也不重复列出两套路径。例如标的`DB/stock`、模式`交易系统/平常心/方法论/模式`、复盘`DB/review/<YYYYMM>`。数据根仍单独作为解析基准，Agent工作目录仍如实展示配置值。缺根时继续显示既定相对目录并提示缺根；模式保持预留状态。

本次只修改`src/client/processors/page.ts`的目录呈现、`test/routes-review/workflow-page.test.ts`的五目录与缺根回归、README和既有交付规划。删除冗长重复路径，复用原DTO，无配置/后端/依赖变更。19条基线通过，展示回归2条RED后24条页面/API测试GREEN；fixture同步实际active/reserved状态与模式目录契约。

相对目录修正最终验证：类型检查、构建、合规自测与diff通过；107文件1026测试零跳过通过（196.15秒），日志relative-directories-final-tests.log。已安装`dsh-trader-kit-0.1.0-relative-directories-20261012.tgz`至web profile，page/API产物SHA256匹配。当前3080 PID23776；认证HTTP页面200并包含新relativePath渲染、没有旧重复路径提示，基础API返回五条现行相对目录。

本轮原浏览器tab关闭且新页面attach超时，inventory连接报错，未完成新截图/视觉验收；不使用前轮绝对目录截图冒充相对目录证据。已完成实际HTTP页面/DOM回归和真实宿主页面版本核验。配置解析与资产未改，模式仍预留；真实模型未验。

## 标的与模式目录可配置（最新行为）

按用户明确选择，基本设置提供标的、模式两项相对路径草稿及「选择文件夹」「保存并应用」。默认目录复用项目映射，保存字段为`directories.stock/patterns`，始终相对`dataRoot`。其余基础配置保持展示。取消选择或目录错误不改草稿；保存显式带当前配置版本，冲突后刷新，不自动重试。

选择器复用当前宿主`directoryPicker.capability()`的native能力与真实AbortSignal，不使用浏览器webkitdirectory推断宿主路径。返回路径经过realpath/stat校验，只接受数据根内真实文件夹；拒绝根自身、跨盘/外根、占位符、点段、文件及符号链接外逃。没有目录迁移、移动或新建。标的读取、工具、页面快照及首卡create-only均消费同一实例配置，现有档案不改；模式仍为reserved，禁止写入且不声明模式工作流已接入。路径检查不能消除外部进程并发替换路径的全部检查/使用竞态。

持久化使用宿主`configEditor.edit`，锁内读取最新完整raw配置并CAS，仅替换两个目录，保留其它字段和密钥。宿主负责原子保存、失败回滚和Loader重载；界面说明重载会取消/清理在途工作流。成功响应只确认saved，不沿已卸载旧服务查询。缺根、原生选择器、可编辑条目或持久编辑能力时禁用并显示原因。基础GET和两条精确POST均沿宿主cookie/Origin认证，无写键救援；POST字段白名单、8KiB限制。请求断开或插件卸载取消原生窗口并收尾，仍连接请求收到刷新提示。

本次修改文件：`src/config.ts`、`src/paths/resolve.ts`、`src/review/profile.ts`、`src/review/profile-create.ts`、`src/service/index.ts`、`src/routes/review.ts`、`src/tools/review-loop.ts`、`src/routes/basic-settings.ts`、新增`src/routes/directory-settings-host.ts`、`src/client/processors/page.ts`；测试为`test/review/profile-directories.test.ts`、`test/routes-review/basic-settings.test.ts`、`test/routes-review/workflow-page.test.ts`、`test/routes-review/review-registration.test.ts`、`test/probe/probe-registration.test.ts`及新增两条目录host测试文件；README/本交付记录/开发规划同步。复用区域映射、原请求与版本栅栏、原生宿主服务，无新依赖或共享全局目录映射。

验证：目录配置/读取/建档真实文件系统17条；页面基线19条、新行为3条RED→22GREEN；基础API基线5条→6GREEN；配置CAS/真实路径2条RED→GREEN。真实宿主临时profile探针3条，验证普通配置保存/其它字段与密钥保留/销毁重载、激活失败回滚、生产adapter真实ctx.get/fiber.entry能力与staleCAS拒绝及重新读取新版本。NativeDirectoryPicker是真实实例，尚未打开桌面窗口。类型/构建/合规自测/diff检查通过；全量含旧安装探针和新DIRECTORY_SETTINGS_HOST_ROOT探针，不把源码测试、临时profile验证和真实目录更改混称为实机验收。

目录编辑最终交付：并行复盘页修改一度干扰主工作区门禁，未覆盖他人改动；使用`.planning/2026-10-10-keyword-framework-01-development/workers/directory-editor-delivery`隔离源码/测试快照完成完整门禁。最终110文件1052测试零跳过（277.87秒），类型/构建/合规通过，日志directory-editor-snapshot-tests.log。当前主工作区120份src/config文件与验证快照SHA256全部一致，diff检查通过。

已安装`dsh-trader-kit-0.1.0-directory-editor-final-20261012.tgz`至web profile，六个核心产物与快照哈希一致。当前3080 PID38716。实际宿主认证GET确认editing.available=true、revision存在，基本页200且含stock/patterns选择按钮和保存入口，默认相对目录保持原值。未实际提交目录配置或迁移文件。浏览器入口排队打开，当前未附着，未产生新截图；原生窗口实际选择/用户取消以及真实模型运行尚未验。真实临时宿主保存/回滚/重载及pre-aborted选择器验证均已完成，原生窗口不会由该离线probe打开。

用户确认并行任务结束后，已在主工作区重新核查：src/config逐文件SHA256与1052测试通过的交付快照无差异，pnpm typecheck与pnpm build新运行通过，复盘页面/图片/构建/静态边界48测试通过。原图标编译及页面静态阻断已解除，无需额外源码修复或重复安装。
