# Codex已有开发主会话：任务1契约迁移与任务0续核

日期：2026-10-11。建议模型／思考：GPT-6.1 Sol / high。以下全文可直接复制到指派会话。

仓库：E:/work/code/open/dsh-plugins/dsh-trader-kit。
先读 AGENTS.md、docs/design/keyword-framework/00-simple-agent-workflow-principles.md、
docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md、
docs/spikes/keyword-framework-implementation-review-2026-10-11.md、
docs/superpowers/plans/keyword-framework-01-prompts/README.md。
再读 docs/spikes/keyword-framework-contracts.md 和真实源码，核日期及实际导出；旧交接尚可能是六方法快照，声明不当可调用实现。

业务对象只有卡片、关键词、工作流、运行记录；模块只有触发、执行、运行管理与日志。
统一工作流执行入口从首版支持代码编排，Skill/提示词是同入口的一种实现；内部步骤/工具/业务产物由工作流组织。
不要要求所有工作流实现六方法、公共stage/data-agent协议或预期观察模型。来源/权限/版本/幂等保障保留在受控服务。

你不是独自在仓库工作。先核git状态和文件归属，不撤销他人改动、不整目录覆盖、不自动提交。
公共types、client/contracts、fixture、旧store/root/auth/slot与共享记录由Codex开发主会话唯一维护；ZCode共享需求交主会话合入。
前置未满足列准确缺项，继续独立可做项；不造空壳、假Agent或第二后台运行器。
开发目录沿 .planning/2026-10-10-keyword-framework-01-development/；主会话维护共享记录，worker只写自己的workers记录，不改活动指针，设计目录只读。
行为修改先失败回归，再最小实现；真实临时文件、确定性时间/可控Promise，零mock、零sleep，新函数按AGENTS注释规范。
无新增依赖、上游修改、交易请求、真实vault测试写入、生产预期注册、个人profile部署/重启或自动commit。
实际模型在应用界面设置，本提示词不自动切换模型。源码、安装离线探针与实机验收分开报告。

继续已有「01 框架开发：宿主核验与公共契约」会话，本次只做迁移及必要宿主续核，不重新创建框架。
现状：旧六方法已写入，parser已存在，registry未交付；当前874条通过/4条skip，历史10处类型错误不是现阻塞。
拥有：src/review/processors/types.ts、test/processors/types.test.ts、test/fixtures/processors/text-module.ts、
src/client/processors/contracts.ts、docs/spikes/keyword-framework-contracts.md、keyword-management-jobs.md，
必要host-jobs.ts、context-types.ts、client/index.ts及既有host/client测试。ZCode只修parser/tests，不同时改。

1. 记录当前归属/基线，锁定保留来源身份/DTO白名单/结果深复制、Jobs控制及slot卸载行为。
2. 实现WorkflowDefinition与WorkflowImplementation.execute最小公共契约；准确签名以真实源码测试交接。
上下文含卡片快照、全部命中、选项、运行ID、取消、日志、受控读取/Agent能力。
3. 不把旧六方法藏进execute后仍强迫所有作者补空方法。移除公共必选stage、data-agent分支、业务窗口。
Skill适配和代码编排共享入口，支持多轮Agent/工具/条件步骤，不把旧data函数当作代码工作流能力。
4. 默认整卡指纹、结果保存/来源核验/清理由通用运行服务承接；预期业务保护是实现内的受控能力。
5. 先新增两个不同attemptId均未结束的失败回归，再修唯一活动尝试检查：全体未结束只能一个且匹配当前ID。
6. 运行记录/DTO补触发原因和安全命中摘要；正文、配置、cwd、私有凭据不入公开字段；保留结果深复制。
7. 固定初始/后续运行请求的原来源关联、去重、取消/恢复和不可用能力表达；请求来自代码，不受模型自选身份。
不实现预期交易日或通用流程DSL，不让普通工作流承担业务回查协议。
8. 没有旧生产记录使用者时核消费者后最小迁移，避免长期双协议层。解析processorId可暂桥接workflowId，
需要改parser签名时先与原ZCode顺序交接，不同时编辑。仅注册表/运行服务声明不能说已有实现。
9. 更新keyword-framework-contracts.md准确导出/可用实现/待实现、文件版本和任务3可用定义/指纹/参数。
10. 任务0续核真实安装/运行接口，固定无行情探针；缺实际模型/Skill/管理页列具体缺项，纯契约仍推进。
不假造服务，不任意重启个人profile，不向主聊天followup或自动下发其他会话。

验证：迁移前失败回归，types/fixture/host/client定向与全量门禁；Agent实机另有证据，测试编排不fake宿主。
开发三份共享记录由你维护；只标实际完成，交付任务3/4可启动条件，后续步骤不自动实施。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
