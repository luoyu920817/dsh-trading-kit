# 关键词 Agent 框架：简化契约后的开发与分工计划

日期：2026-10-11。依据 [简单业务模型与开放工作流原则](../../design/keyword-framework/00-simple-agent-workflow-principles.md)，取代原任务0–12中六方法、公共业务观察、stage/data-agent分支的实施要求。任务编号保持，方便对照已完成工作；这里的类型和文件是下一阶段要求，尚未实现的部分不能冒称已有服务。

## 1. 模型与模块

业务对象只有复盘卡片、关键词、工作流、运行记录。关键词只绑定一个工作流，别名可指向同一定义；同一卡片命中同一工作流只发起一次运行。不同卡片分别运行，正文不变不因重复通知运行，显式重新运行保留旧记录。

模块只有关键词触发、工作流执行、运行管理与日志。模块可以有多个文件；保留processors历史目录，不再新建一套同职责workflow目录。

工作流从首版支持代码实现：一个执行入口可以取数、调用工具、多轮Agent和组织内部业务步骤。Skill/提示词通过同一个入口的适配实现接入。交易日、预期观察、确认和业务输出校验属于工作流内部；必要的授权/来源版本/幂等写入保障仍通过受控服务实现。

## 2. 当前真实交付与立即顺序

[源码审查记录](../../spikes/keyword-framework-implementation-review-2026-10-11.md) 为本轮事实依据。

- 任务0：Jobs/详情槽有最小实现与安装源码证据；正式Agent/Skill/管理日志尚未完成实机出口，不能标完整验收。
- 任务1：旧六方法公共契约存在，需要迁移；来源身份、输入快照、安全DTO和宿主Jobs保障可复用。
- 任务2：纯解析已实现，测试通过仍存在Markdown误识别；先补失败回归再修。
- 任务3：本仓未找到registry.ts、registry测试或配置资源，不按“已完成”接纳。

立即顺序：Codex迁移任务1公共契约；原ZCode会话修任务2解析边界。两个工作不同时改公共类型，迁移者保持解析签名兼容或顺序交接。任务3必须等新契约固定及解析回归通过，后续依次推进，不一次下发全部任务。

## 3. 任务1必须先固定的最小接入面

工作流定义提供稳定ID、名称、关键词/别名、开关、受信实现标识、有效选项和定义版本；不公开stage、executor=data/agent、业务窗口等必选字段。

工作流实现有一个必需执行入口：接收本次卡片/命中/选项及受控运行上下文，返回明确结果或失败。名称建议WorkflowImplementation.execute，准确TypeScript签名由Codex在真实源码/测试中确定后写入接口交接。不要只把原六方法隐藏在这个入口里面又要求每个实现补空方法。

运行上下文提供取消信号、阶段日志、受控材料读取和Agent执行能力。Agent可用性、工具权限、来源路径和提交凭据由框架控制；工作流不能自行指定别人的运行身份。Skill适配器与代码工作流共享入口，结果结构由实现决定，公共结果仅保存摘要/合法数据及受控产物引用。

上下文还需明确后续运行请求的登记、来源关联、取消和恢复契约。框架不理解业务日期条件；实现提出代码生成的请求，未具备执行条件明确不可用/等待，不返回伪成功。无需求的工作流无需实现后续回调，也不新增业务观察对象。

公共记录区分运行与内部尝试，保存卡片输入/定义版本和来源有效性；运行记录可以保留内部准备状态，但公共业务模型仍只有四对象。取消与日志能力统一提供，工作流不自行管理槽位或建独立后台队列。

当前尚无旧生产持久运行数据或注册表，迁移时先核工作区再定删除范围；不创建无使用者的长期双协议兼容层。解析recognized.processorId可暂作为工作流ID桥接，是否改名由公共契约负责人决定，必须同步现有解析测试，不交多个会话同时改。

## 4. 按原编号的文件分工

| 任务 | 职责模块/负责人 | 文件范围 | 实际退出条件 |
| --- | --- | --- | --- |
| 0 宿主核验续接 | 工作流执行/Codex | host-jobs.ts、context-types.ts、client/index.ts、宿主契约测试和keyword-management-jobs.md | 区分离线与live；真实Agent/Skill/详情日志能力未验须列缺项 |
| 1 公共契约迁移 | 跨三模块/Codex唯一负责人 | types.ts、types.test.ts、fixtures/processors/text-module.ts、client/processors/contracts.ts、keyword-framework-contracts.md，必要host/slot测试 | 单执行入口；两个实现方式契约测试；唯一未结束尝试完整检查；无必选六方法 |
| 2 解析修复 | 关键词触发/原ZCode | parser.ts、parser.test.ts、workers/parser.md | 多行行内代码、非法围栏关闭、嵌套图片/链接目标等误触发回归通过；UTF16/旧语法保持 |
| 3 关键词到工作流注册表 | 关键词触发/原ZCode | registry.ts、registry.test.ts、config/card-processors.json、config.ts、package.json、config.test.ts | 新定义校验、受信实现映射、空生产表、重载失败保留旧表、安装资源验证 |
| 4 运行记录/日志 | 运行管理/ZCode记录包 | identity.ts、records.ts、trace.ts、对应测试、paths/mapping.ts及必要resolve.ts/paths.test.ts | 原子记录、版本冲突、来源/尝试/截断/私有信息保护，真实文件测试 |
| 5 来源/保存触发 | 关键词触发/Codex | store.ts的短来源核验、processors/source.ts、reconcile.ts、index.ts、对应测试，必要write-events/结构测试 | 保存后异步启动、不改用户正文、同工作流去重、附注不递归、来源变化拒绝旧结果 |
| 6 接纳与预算 | 工作流执行/ZCode接纳包 | scheduler.ts、scheduler.test.ts、自己的workers记录 | 只接纳工作流运行；能力/额度/容量等待；每次实际Agent激活计额度；有限重试 |
| 7 运行上下文子项 | 工作流执行/ZCode上下文包 | context.ts、context.test.ts | 受控材料、取消、能力不可用表达；不复制Agent运行器 |
| 7 Jobs/Agent/Skill适配 | 工作流执行/Codex | agent.ts、host-jobs.ts、fixtures及对应测试、宿主证据 | 单执行入口的Skill与代码实现均可运行；真实Agent工具/Skill作用域核验 |
| 8 通用结果保存 | 运行管理/ZCode结果包 | results.ts、results.test.ts | 来源/定义/尝试绑定；成功不可回滚；旧结果仅历史；不统一业务观察投递 |
| 9 取消/卸载/恢复 | 工作流执行+运行管理/Codex | reconcile.ts、index.ts、必要scheduler/results顺序接手及恢复测试 | 清理后释放槽；重启区分中断与成功；恢复已登记运行，不自动扫7日旧卡 |
| 10 管理接口 | 运行管理/ZCode接口包 | routes/review-processors.ts、tools/review-processors.ts、对应新测试 | tasks历史路由内部可保留，面向运行DTO；GET无执行，写入口原鉴权及冲突处理 |
| 11 管理页/识别提示 | 运行管理/ZCode页面包 | 新WorkflowRunsPanel.ts、processors/api.ts、client/review/processor-view.ts及对应新测试；既有KeywordRunsSection.ts/contracts.ts由Codex接线 | 来源卡片、关键词/工作流、状态/等待、日志/结果、取消/重跑；迟到响应隔离 |
| 10/11 接线 | 跨三模块/Codex | routes/review.ts、review/processors/index.ts、service/index.ts、client/index.ts、client/review/index.html.ts和结构测试 | 原鉴权/root/槽唯一接线，旧复盘行为兼容；共享contracts只由主会话改 |
| 12 扩展/集成测试 | 跨三模块/ZCode测试包 | 新processors集成/扩展测试；fixtures变更由Codex接手 | 新工作流加入不改触发/调度/页面；两类实现使用同一契约，不fake宿主 |
| 12 最终验收 | 跨三模块/Codex | 包资产/真实宿主证据/交接与开发记录 | 新框架端到端、真实正式日志与取消恢复、全量门禁；缺实机证据不冒充通过 |

types、client/contracts、测试fixture、旧root/auth/slot/store和开发共享记录始终由Codex唯一维护。worker需要改共享接口时提准确签名，由主会话合入。scheduler/results已移交后，任务9修改必须先明确顺序接手，不能同时写。

避免任务6/7及context/host循环等待：任务7宿主适配可在新任务1/3/4和任务1的context契约就绪后独立核验/实现，不以ZCode context完整实现为前置；context在实际Agent适配交接后完成能力集成，材料读取部分可以先做。任务6依真实能力与错误类型做接纳；完整联调在来源/接纳和context实现可用后完成。纯接纳测试使用实际测试工作流，不fake宿主，不把声明或纯测试当Agent已接通。

## 5. 接纳、结果和恢复的共同保障

- 登记持久成功后才允许实际执行；保存卡片的成功不能因后台登记失败改成失败。登记失败可观察并显式重扫修复。
- 同卡片、同工作流、同输入和定义重复通知复用运行；手动重跑生成新记录。请求序号/尝试凭据是内部机制。
- 短锁中核来源、配置和当前运行；网络/Jobs.start/Agent.create/dispose在锁外。取消后完成生产者清理才释放并发。
- 唯一未结束尝试要检查整条运行的attempts，而不是只筛当前attemptId；私有凭据只在内部记录/闭包，不入HTTP/日志。
- 多轮Agent每次真实启动都受权限、超时和额度控制，不能因同属一次工作流而绕过预算。
- 同一次合法结果只提交一次，保存成功后不因取消/清理失败改回取消或再次调用模型。日志/产物后续处理不得放松来源有效性。
- 来源改变、删标记、删卡时协作取消旧执行；旧结果保留历史，不能成为新输入的当前结果。
- 只恢复已登记未完成记录；旧nativeJobId跨重启不当作可控制的新进程任务。历史补处理使用明确日期范围。
- 预期自己的持久业务写入必须核版本/授权且幂等，留在预期实现，不增加公共观察/窗口模型。

## 6. 验证与交接

每包先写失败回归，再最小实现；真实临时目录、可控Promise/确定性时间，零mock、零sleep，不为低影响文档变化写实现镜像测试。新增函数业务注释沿AGENTS。

使用pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test和git diff --check；仓库无独立lint脚本，不伪称lint通过。宿主探针默认skip必须单独列，不当作live成功。涉及parse/records/恢复等行为运行相应定向测试；最终才做实际安装与页面验证。

各提示词见 [对象、模型和提示词索引](keyword-framework-01-prompts/README.md)，包含精确文件归属和启动条件。开发目录使用既有 .planning/2026-10-10-keyword-framework-01-development/；主会话维护三份共享记录，workers只维护自己的文件。不改活动指针或另建竞争规划。

本轮只审查和更新文档；本计划不等于接口/注册表已实现，也不自动发送到Codex或ZCode。下一条应给已有Codex开发主会话 [公共契约迁移提示词](keyword-framework-01-prompts/codex-start-task-0-1.md)，原ZCode会话 [解析修复提示词](keyword-framework-01-prompts/zcode-parser.md)。
