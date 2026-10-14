# ZCode原解析与注册表会话：任务3工作流注册表

日期：2026-10-11。建议模型／思考：GLM-5.3 / high。以下全文可直接复制到指派会话。

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

当前registry.ts/registry测试/配置资源未在本仓交付，本包按新契约首次实现。
前置：Codex任务1迁移完成并交接真实定义、execute、配置/指纹、解析签名；任务2误识别回归通过。
纯JSON校验可在明确新契约下先做；完整退出等所有前置，不消费旧stages/schema表。

拥有：src/review/processors/registry.ts、test/processors/registry.test.ts、config/card-processors.json、
src/config.ts、test/config.test.ts、package.json；结构测试由Codex接入，types/fixture/root不改。
记录workers/registry.md，不覆盖原parser交付记录。

1. 每关键词/别名绑定一个受信工作流定义，元数据包含定义/实现ID、选项、开关，代码注册map承接实现。
JSON不import任意JS/路径，不把stage、executor=data/agent、业务窗口、schema当所有定义必选。
2. 候选表整体校验后替换；未知实现、别名冲突、非法参数和超限拒绝整表，旧有效快照保留。
沿256KiB/32定义/8别名上限；生产默认空表，schemaVersion和字段按新真实契约，不默认注册预期/测试模块。
3. Skill适配与代码编排均可注册，测试使用真实测试实现；不是把旧六方法white-list改名而已。
4. 指纹覆盖有效执行定义、选项、实现版本及实际有效提示词/Skill内容；改展示说明不重跑。
候选Skill与运行scope实核分开；定义变更与参数版本冲突明确，不以mtime/最近聊天作版本。
5. 全局review.processing.enabled默认false，工作流开关不绕过；仅通用并发/预算/超时设置，不写交易日规则。
旧配置兼容只对真实使用者做，不引入无用途旧stage双协议。
6. package.files发布JSON，从安装包根定位，不依赖process.cwd。临时打包查资源/客户端资产，不安装个人profile。
7. 测试坏JSON/冲突/重载失败保旧、默认关闭、别名汇总、新代码定义接入不改parser或调度器。

验证：pnpm exec vitest run test/processors/registry.test.ts test/config.test.ts、typecheck和包内容。
交付实际加载/查定义/重载/别名接口与版本，不能只交类型；退出后才允许记录/触发包消费。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
