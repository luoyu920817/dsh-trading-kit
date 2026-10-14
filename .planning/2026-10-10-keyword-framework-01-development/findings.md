# Findings — keyword-framework-01-development

## Workspace and ownership
- Baseline-status.txt和baseline-diff-stat.txt记录执行前已有改动。既有README、复盘页面、store/context/profile、routes、service和测试全部保留。
- 本轮主代理维护types、host-jobs、client/contracts、详情槽最小组件、client/index、context-types及测试fixture。
- 后续ZCode包的parser/registry/records/scheduler/results/HTTP/正式页面未实现、未下发。
- 无.codegraph目录，跳过CodeGraph；无lint脚本，不编造lint结果。

## Current baseline
- 2026-10-10 pnpm typecheck: exit0，历史10处类型错误不再存在。
- pnpm build: exit0，已有external弃用提示。
- pnpm test: 首次spawn EPERM，允许启动子进程后86文件/845条通过。
- compliance自测和git diff --check通过。

## Host
- 实际包位于DeepSeek Harness app.asar，Jobs/Agent/Skill/slot为0.2.0-rc.2；旧profile路径和旧SDK不能代替当前运行组合。
- 真实实现离线Jobs探针10条定向测试中的1条已过：同步run/root/unowned/readAt非消耗/kill→stopping/等待清理done。
- host-evidence.md有准确安装源码行号和内嵌TS声明；Agent.followup用UserMessage，cancel用结构cause，dispose在create handle；skills.get实际content，sessionTitle.rename实际Session。
- 未找到live DSH进程/3080监听；GET既有复盘HTML返回ECONNREFUSED。因此正式页面和运行中Jobs/Agent未验，不创建假Agent或默认启动探针。

## Contracts
- parseMentions只读Map和原文UTF16跨度；尚未实现parser函数。
- ProcessorModule六方法，ready/waiting明确，preparedSnapshot冻结内容和moduleCommitFacts。
- 候选/实际Skill指纹分开；内部preparationToken/activeAttemptToken与公共DTO隔离。
- 结果显式字段白名单，阻止未知未来字段随对象展开泄露。
- records/scheduler/withVerifiedCardSnapshot/ProcessingService只有类型声明；真实导出实现按后续包推进，不称已可调用。

## Security and scope
- 无依赖新增、无上游修改、无交易、无真实vault写入、无模型调用、无主聊天followup。
- 固定探针只在显式测试环境启用；默认测试跳过该宿主集成项，跳过不算宿主通过。

## Final update
- 全量89文件859测试通过，含14条本轮测试/真实安装探针；默认无解包路径会跳过4条宿主集成项。
- 真实SlotRegistry区段+实际SlotCore/Cordis验证missing detail、延迟声明、声明释放、卸载后不复活；缺slots降级测试通过。
- 实際Cordis公开get绕开未inject时的直接可选属性错误，最小修复只在client/index。
- 独立复审无新必须修复问题。
- 精确匹配Node/Bun/桌面DSH进程0、监听0，无live验收。Agent宽create/meta与SkillLookup完整声明仍待任务7核验，未编造镜像。

## 2026-10-11 MVP coordination
- 用户本轮授权整个预期 MVP，旧仅0/1范围与空生产表由本轮案例授权扩展。保留所有已有改动。
- 无 .codegraph，开发计划沿现有目录，未改活动指针。
- zcode 0.5.0 支持 model/background/reasoning验证；两次启动（指定glm-5.3及省略模型）均因内置provider配置缺失exit1，无session、无命令、无源码改动。
- Codex contracts worker唯一维护types/fixture/contracts；host worker只维护agent.ts与测试，主协调维护旧store/root/auth页面。

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
- 最终完整门禁 exit0：106 文件、1006 测试通过，零跳过，见 workers/client-loader-fix-tests-final.log。

## 2026-10-12 导航/设置交付阶段
- 左侧改为纯图标，main keyed正确key，settings.section新增交易工作流。右侧卡片/任务两页签；配置hash模式不查任务，任务模式不修改配置，默认独立页保留兼容。
- 实际浏览器暴露关键词API prefix尾斜杠，核对真实宿主p/p子路径路由规则，新增失败回归后修为无尾斜杠。
- 最终typecheck/build/compliance/diff通过，全量106文件1011测试零跳过通过（15秒I/O预算、真实安装离线探针）。
- 已更新web profile到navigation-settings-20261012-r2.tgz。客户端/HTML/API SHA256一致，客户端manifest结构一致。
- 实际浏览器已验左按钮右页面及设置新入口；服务端旧HTML/API缓存需要重启加载，依用户此前“不自动重启”要求已通过async请求授权，尚未自行重启。
- 说明 docs/spikes/navigation-settings-2026-10-12.md；截图 workers/navigation-main.png。

- 页面 request 响应 epoch 守卫不足以约束 mutate 的 catch/final 收尾，必须同步约束解锁。复用既有 epoch 而非新增操作抽象；同视图锁禁止并发，stop 递增 epoch 使旧收尾失效。
- 安装已更新服务端磁盘产物不等于运行中 Node 模块已重载。r3安装后设置 iframe仍为旧HTML且请求旧路由；在线内容验收需要用户授权重启。

- 用户授权精确重启后服务端缓存阻断解除，#settings/#runs 内容及新API前缀在线验证通过。实际能力显示只证实宿主执行接口接线，模型配置与真实运行另行验收。

### 关键词二级设置页接口核验
- 当前公开RegistryDTO只含id/label/mentions/enabled/definitionRevision；此页只编辑enabled，保持完整options私有边界。
- tasks现成支持workflowId严格过滤和稳定分页；task带workflowId可核验；events仅runId，必须先核验task属于当前关键词映射后再读取，结果以视图epoch和runId防迟到。
- 同workflow别名共用配置/历史，不虚构alias级隔离。当前生产只有@预期；多关键词能力用离线真实HTTP回归，不向真实配置塞假关键词。
- 14条当前页面/真实Slots基线通过，worker独占页面和交互测试。主协调未并行编辑page.ts。

- PublicWorkflowRunDTO提供workflowId和result/summary，历史详情可先做归属验证再读取events；无需向日志协议加新字段。
- 文档入口已说明关键词→工作流配置/执行历史，别名共用与任务页显式操作入口，避免把配置页历史误称为自动执行。

### 二级页首次只读复核
- 必须修：request网络/JSON失败路径也要epoch与sequence栅栏；registry失败作废在途history/detail/events并清空隐藏旧数据；keywordWorkflow可能null回调需捕获/核验；公开版本字段definitionRevision、事件时间occurredAt。
- worker继续独占页面与测试，根未并行编辑。现阶段14页面GREEN尚不代表最终门禁，等待错误边界回归与修复。

### 二级页最终复核结论
- 首次4项审查问题已修复并有失败回归，独立复审无阻断。请求成功/失败与写操作收尾均受视图epoch保护；registry读取失败清理旧历史，详情验证所属后才取日志。
- 宿主设置内容宽约560px，窄屏关键词导航采用横排，紧凑间距后配置关键控件首屏可见；宽屏保留约140px关键词导航。不扩展宿主弹框或新增后端配置服务。
- 最终源码106文件1018测试零跳过，安装产物哈希核验与真实页面只读验收分别通过。当前web PID46896。安装成功、离线探针和真实模型验收属于不同证据；真实模型及非空运行结果未验。

### 基本设置交付结论
- 当前已解析配置+AREA_TABLE为展示唯一来源；全局写入沿宿主文件入口，无新配置服务。基本API与管理页面不依赖dataRoot或runtime，缺根仍可查看。
- 全量静态边界对新增文件采用具名归属/实际HTTP测试登记，其余门禁不放宽；回环测试每次请求验证同origin、同端口、固定路径，禁凭据与重定向。
- 107文件1026测试与实际安装哈希核验通过，3080 PID37700。真实UI显示finance根与现行目录，模型Provider/model/cwd未配置、自动执行关闭；本轮不改变它们。
- 相对目录展示以DTO.relativePath为准，根存在与否的状态来自dataRoot，不再读取absolutePath作展示；复用业务区域映射，不创建新的相对目录配置。数据根仍单独为解析基准，日期占位符保留。
- 当前相对目录宿主HTTP验收200，页面/接口安装哈希一致，PID23776；浏览器连接阻断导致新截图未验，明确区分服务端页面版本与视觉验收。
- 共享复盘页并行变化通过隔离交付快照避免覆盖；当前全部120生产源文件最终与快照一致。因此1052门禁与目录feature当前源码对应，安装包六核心产物哈希也一致。
- 当前实际web编辑能力可用：原生picker与ConfigEditor真实服务发现成功；metadata revision存在，两个选择按钮/显式保存入口返回，仍使用默认相对dirs。不把服务能力和HTTP页面验收误称实际原生窗口用户选择验收。
# 2026-10-12 通达信登录实现事实（历史方案，已撤销）
- 截图关键词不可用的401与旧免手动密钥卡片保存通道权限不同；本轮保留保存、为管理接口补真实宿主Cookie登录。
- 实际公共服务authorizeIndex支持根请求token→303/set-cookie；可用响应适配器保留Cookie头并改成严格白名单returnTo，不需要读取私有launchToken或自签Cookie。authenticatedUrl只能向已认证用户显式下发。
- 默认Cookie30天，签名secret由宿主持久保存；真实临时SDK连接重建证明Cookie有效而旧进程token失效。TDX是否持久存储为未验边界，不能从HTTP探针推定。
- registry pagehide/abort/pageshow必须沿controller和代际保护，缓存返回一次重读；两处真实HTTP回归已锁定。管理API403必须JSON才能保留UI来源拒绝原因。
- 已安装SDK离线探针路径env REVIEW_LOGIN_HOST_ROOT与DIRECTORY_SETTINGS_HOST_ROOT一致。本轮最终112文件1068测试零跳过，web PID53440及真实HTTP200/303/401/403已验证，不含真实数据写入。

# 2026-10-12 复盘输入事件源职责纠正
- 管理GET401不是卡片保存/后台关键词触发失败：免用户登录保存沿自动写凭据，真实store提交发布notifyReviewWrite，trigger→reconcileDocument→registerSource直接持久登记，不依赖页面注册表读取。
- 为避免输入页承担管理职责，移除管理URL/状态/解析器及登录UI；配置与历史结果留在DSH，管理GET认证没有放开。真实HTTP无Cookie→提交→持久登记组合探针已通过。
- 外部编辑器直接写vault没有fs.watch来源；保存通知不是持久事件日志，登记前崩溃边界保留，启动不擅自扫描旧卡。默认自动执行关闭、模型/provider/cwd未配置与页面登录无关，不将等待冒充执行成功。
- 已撤销上轮登录方案并重新安装、重启默认web宿主PID1292。最终111文件1055项全通过，4worker降低并发但断言不变；实际输入页200/旧登录API404/管理GET401已验证。

# 2026-10-13 关键词任务可见性事实
- 用户20:23:49的@预期真实卡片已有run，管理waitingCounts.workflowDisabled=1与磁盘事实一致；非触发失败。旧页默认config而“执行历史”入口不显著、状态JSON过长导致用户误以为无任务。
- 单工作流enabled不控制识别/登记，仅执行许可，global enabled与其同时为true才尝试接纳；capabilities.agentFactory只证明函数存在，不能据此声明模型可调用。UI分别说明等待/模型未配置/真实执行未验。
- execution编辑只需ConfigEditor/ownLoaderEntry，不需native目录picker；沿现有适配器复用revision+锁内raw merge，给用户显式模型与开关入口。保存开关会重载并恢复等待队列，开启提醒不得缺失。
- 当前宿主源run仍waiting、0Agent；新设置页/编辑能力加载，真实profile/runhash未变。111文件1063门禁通过，无假结果或真实模型激活，当前web PID38556。
