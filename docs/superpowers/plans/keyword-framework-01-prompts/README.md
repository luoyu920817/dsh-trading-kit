# 分工、模型与完整提示词索引

更新：2026-10-11。最新依据：[四对象、三模块与开放工作流原则](../../../design/keyword-framework/00-simple-agent-workflow-principles.md)、[修订开发计划](../2026-10-11-keyword-agent-framework-revised.md)、[实际源码审查](../../../spikes/keyword-framework-implementation-review-2026-10-11.md)。本目录17份提示词已按新契约重写，可以全文复制；不是旧提示词附警告。原编号沿用方便核对，强制六方法/stage/data-agent及公共预期观察协议不再实施。

## 1. 先看实际完成情况

| 原任务 | 本仓当前状态 | 可以保留 | 下一步 |
| --- | --- | --- | --- |
| 0 宿主和管理槽 | 基础/安装源码/离线Jobs探针存在，正式Agent与日志未验 | Jobs控制、可选服务get、详情槽接线 | 在可用宿主继续实机出口，缺条件列未验 |
| 1 公共契约 | 按旧六方法实现，需要迁移 | 来源快照、DTO安全投影及清理保障 | Codex先落实单执行入口，补唯一活动尝试和DTO信息缺项 |
| 2 解析 | 已有19条测试通过，但Markdown忽略区段有实际误识别 | 原文UTF16、别名/未知词、纯函数主体 | 原ZCode先加失败回归再修边界 |
| 3 注册表 | 未发现registry实现/测试/配置资源/worker交付 | 只存在相关类型声明 | 等新契约及解析回归，再按新任务书首次实现 |

不能把“Codex任务0/1”和“ZCode任务2/3”两个分工组当成组内每项已验收。若另有未合入注册表产物，先核真实文件，不从口头状态推导实现。

当前重核：typecheck/build/合规通过；全量测试874条通过、4条跳过，89文件通过、1文件跳过。历史10处类型错误不是当前阻塞。默认4条skip是宿主安装探针，不能充当live验收；显式本轮Jobs离线2条通过，客户端安装slot入口收集超时，详情页占位仍不是持久日志页面。

## 2. 简单模型和扩展边界

业务只有卡片、关键词、工作流、运行记录；模块只有关键词触发、工作流执行、运行管理与日志。

关键词指向一个工作流，工作流有一个必需execute入口。代码编排与Skill/提示词共享该入口，从第一版可扩展多轮Agent、工具和业务产物。版本/尝试/凭据/原生Jobs是内部机制；预期观察/回查/确认留在预期实现，不要求所有工作流理解。

## 3. 指派对象、模型和全文提示词

| 原任务/用途 | 指派对象 | 模型／思考建议 | 全文提示词 | 启动条件 |
| --- | --- | --- | --- | --- |
| 1迁移，0必要续核 | 已有Codex开发主会话 | GPT-6.1 Sol / high | [公共契约迁移](codex-start-task-0-1.md) | 现在；先核现有types与共享归属 |
| 2解析修复 | 原ZCode解析与注册表会话 | GLM-5.3 / high | [解析修复](zcode-parser.md) | 现在；保持解析签名兼容，不改types |
| 3工作流注册表 | 同一ZCode解析与注册表会话 | GLM-5.3 / high | [新注册表](zcode-registry.md) | 新任务1交接+任务2修复通过 |
| 4运行记录与日志 | ZCode记录会话 | GLM-5.3 / max | [原子记录](zcode-records.md) | 新任务1/3及路径、锁、DTO固定 |
| 5来源/保存触发 | 同一Codex开发主会话 | GPT-6.1 Sol / high | [保存触发](codex-source-task-5.md) | 新任务2–4实际交付 |
| 6工作流接纳/预算 | ZCode接纳与结果会话 | GLM-5.3 / max | [接纳](zcode-scheduler.md) | 新任务3–5真实接口就绪 |
| 7受控上下文子项 | ZCode上下文会话 | GLM-5.3 / high | [上下文](zcode-context.md) | 新定义/记录/读取服务交接 |
| 7统一Jobs/Agent/Skill适配 | 同一Codex开发主会话 | GPT-6.1 Sol / high | [宿主执行](codex-host-task-7.md) | 新任务1/3/4及context契约即可先做；完整联调等5/6和context实现 |
| 8通用结果保存 | 同一ZCode接纳与结果会话 | GLM-5.3 / max | [结果](zcode-results.md) | 新任务7真实运行/提交身份与记录接口 |
| 9取消/卸载/恢复 | 同一Codex开发主会话 | GPT-6.1 Sol / high | [恢复](codex-recovery-task-9.md) | 新任务6–8实际交付 |
| 10独立API/工具 | ZCode管理接口会话 | GLM-5.3 / high | [运行接口](zcode-api.md) | 新任务8/9服务/公共DTO固定 |
| 11独立页面/识别提示 | ZCode管理页面会话 | GLM-5.3 / high | [运行页面](zcode-ui.md) | 只读DTO/parser/槽已固定；正式验收需API |
| 10/11旧鉴权/槽/页面接线 | 同一Codex开发主会话 | GPT-6.1 Sol / high | [装配](codex-wire-api-ui.md) | API/页面独立文件已交付 |
| 12扩展/集成测试 | ZCode集成测试会话 | GLM-5.3 / high | [扩展测试](zcode-integration-tests.md) | 新任务1–11有实现，不调用声明空壳 |
| 12最终安装/实机验收 | 同一Codex开发主会话 | GPT-6.1 Sol / high | [最终验收](codex-final-task-12.md) | 扩展测试及实际宿主可用 |
| 当前新类型错误修复 | ZCode基线会话（默认不启动） | GLM-5.3 / high | [有错误再修](zcode-baseline-types.md) | 当前新失败+明确归属；历史错误不触发 |
| 可选独立只读审查 | 另开的审查会话 | GPT-6 Astra / high，可用模型优先 | [只读审查](codex-independent-review.md) | 有迁移后实际实现差异 |

只有任务1迁移和任务2修复可以立即开始，两者公共类型/解析文件单一修改者。ZCode原会话先修解析，再续接新注册表，不需为每个编号另开会话。接纳/结果也顺序复用同一个会话。不是一次并发所有行。

模型建议针对本项目，不是性能测评。OpenAI将GPT-6.1 Sol用于兼顾时间/成本的复杂任务；档位high是本项目判断。[OpenAI模型选择](https://developers.openai.com/api/docs/guides/model-selection)。ZCode支持GLM-5.3的low/high/max。[ZCode模型设置](https://zcode.z.ai/en/docs/configuration)。实际可选项以账号界面为准；GLM-5.3不可选时可用GLM-5.2 high/max并保持相同验收，不宣称效果相同。

本次没有改变现有会话模型，提示词中的名称不自动切换。不要选账户不支持的固定审查角色模型；独立审查可继承当前可用模型。

## 4. 公共契约迁移的退出证据

- 真实WorkflowDefinition及单execute实现，不以六方法包装或旧data分支冒充开放工作流。
- 卡片/命中/运行ID/取消/日志/受控Agent上下文；代码与Skill两种适配测试。
- 运行记录安全DTO包含触发原因和命中摘要；唯一活动尝试检查完整，私有内容不透出。
- 真实注册配置、定义指纹、来源/记录/后续请求边界与准确服务签名；实现/声明分类写清。
- docs/spikes/keyword-framework-contracts.md更新为实际源码交接，旧日期的“parser未实现”不作为现状。

该阶段不提前实现预期业务，也不把新注册表或未来Agent服务写成已可调用。

## 5. 文件归属与交接

Codex唯一维护types、client/contracts、fixture、旧store/root/auth/slot/KeywordRunsSection及开发共享记录。ZCode仅拥有新任务书明确列出的文件；需要shared变更时提出准确需求，不直接改。源码目录processors沿用，不新建平行系统。

UI包写WorkflowRunsPanel.ts、processors/api.ts和review/processor-view.ts及新测试；Codex接既有KeywordRunsSection和旧复盘页面。scheduler/results转交后任务9修改需先记录顺序接手，不能同时写。

运行管理/日志负责持久状态和结果；Agent内部多轮/工具/业务产物由实现组织，但每次实际Agent启动受控并计额度。RESULT_COMMITTED后不回滚/重复调用模型；业务自己的写入仍需授权、来源/业务版本核验和幂等。

开发规划沿用 .planning/2026-10-10-keyword-framework-01-development/；主会话维护task_plan/findings/progress，worker只写workers/自己的记录，不改活动指针或设计目录。前置必须是实际接口/测试证据，不是计划说应有。

## 6. 现有会话与本轮范围

已有Codex主会话「01 框架开发：宿主核验与公共契约」，threadId=01a12426-9687-7f82-8672-d2071c4cbc43。给该会话复制任务1迁移提示词即可；原ZCode继续用任务2修复提示词。本次只审查和更新文档，没有另建会话、发送开发指令、切换模型、修改源码或自动下发ZCode。

旧600行计划和旧分工表留作历史参考。当前开发动作使用本索引的最新全文和修订计划；不再复制旧六方法任务书继续实施。

## 7. ZCode MCP协作验证补充

2026-10-11已实际通过ZCode MCP完成限定文件的解析复核与同会话续接，记录见[协作验证](../../../spikes/zcode-collaboration-validation-2026-10-11.md)。会话ID为sess_95781864-58c5-47e2-ad51-8162c5103c99，本会话用于验证，不作为任务2修复完成。

plan模式可读文件但不能执行shell；edit模式能回显pwd/Node版本，实际复现命令受缺permission client限制。yolo具备整仓写能力，超出此次五文件只读授权，调用被自动审批拒绝；不能仅凭提示词禁写就下发。需要明确工具权限后才能将实现任务自动委派；也可维持ZCode只读审查、由Codex运行复现。

该MCP接口没有model/思考档位参数，提示词建议不等于实际模型已设置。本轮没有开发改动、没有将任务1/2/3自动标完成。
