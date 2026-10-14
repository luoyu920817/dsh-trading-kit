# 任务0–3实现审查与新设计符合性

日期：2026-10-11。范围：当前工作区源码、任务0/1交接、任务2 worker记录及测试。不修改业务源码，不把类型/离线探针当作正式宿主运行成功。

## 1. 结论与交付状态

| 任务 | 当前证据 | 是否符合最新预期 |
| --- | --- | --- |
| 0 宿主/管理槽 | host-jobs.ts、context-types可选Jobs镜像、client详情槽和占位组件；安装源码与离线探针 | 基础可保留；正式Agent/Skill/管理日志尚无完成证据 |
| 1 公共契约 | types.ts六方法、data/agent、stage、业务guard及测试文字模块 | 按旧设计实现，需迁移成单执行入口；安全来源/DTO保障保留 |
| 2 纯解析 | parser.ts、19条测试、workers/parser.md | 主体可复用；有实际Markdown误识别，应先补失败回归并修复 |
| 3 注册表 | 当前无registry.ts、registry.test.ts、config/card-processors.json及registry worker交付 | 尚未在本仓交付，只有相关DTO/接口声明，不能标完成 |

任务0/1和任务2/3是两个分工组，不等于组内每一项都已通过。若任务3产物在另一未合入目录，需要提供实际文件/差异后重新审查；本轮只依据本仓证据。

## 2. 必须先调整的公共契约

- [types.ts](../../src/review/processors/types.ts) 148–161行强制projectInput、prepare、commitGuard、validateResult、afterCommit、reconcileSource。普通文字fixture也要实现空guard/后处理/来源协调；缺单execute入口。
- 同文件59–61行固定data/agent，Agent必须绑定Skill；不能把data分支当作可编排多轮Agent的代码工作流能力。
- stage贯穿请求、记录、DTO和注册表；必须从公共业务模型移出，保留为工作流自己的内部步骤日志即可。
- moduleCommitFacts、公共业务锁及强制结果投递/业务键协议不再作为所有工作流必选条件。工作流自己的业务写入仍需权限、版本核验和幂等。
- 通用注册表/上下文/运行记录/启动服务以卡片、关键词、工作流、运行记录表达。保留精确来源、输入/定义版本、私有凭据、日志与取消恢复。

这些是最新设计引起的迁移要求，不能简单称旧任务1从未完成，也不能只改接口名称却继续要求所有实现补六个方法。

## 3. 已复现的正确性缺口

### 3.1 解析器泄漏代码与链接内的关键词

当前Node直接导入parser.ts得到如下结果；别名表为预期→expectation：

| 输入（换行写作\\n） | 实际错误命中 | 应有结果 | 源码位置 |
| --- | --- | --- | --- |
| 单反引号包围的a\\n@预期\\nb | @预期，[3,6) | 无命中，代码跨度可以跨行 | parser.ts:43、66 |
| 双反引号开闭，中间有三反引号和单反引号的代码跨度 | @预期，[12,15) | 无命中，反引号串须按精确长度配对 | parser.ts:65–67 |
| 三反引号\\n三反引号text\\n@预期\\n三反引号 | @预期，[12,15) | 无命中，带text的行不是关闭围栏 | parser.ts:44–48 |
| `![a [b] @预期](x.png)` | @预期，[8,11) | 无命中，属于图片alt | parser.ts:78、84 |
| `[文档](note(a).md "title @预期")` | @预期，[23,26) | 无命中，属于链接目标/标题 | parser.ts:93 |
| `![alt](img(a).png "title @预期")` | @预期，[25,28) | 无命中，属于图片目标/标题 | parser.ts:84 |
| `[文档](note\\).md "title @预期")` | @预期，[22,25) | 无命中，转义括号不能提前结束目标 | parser.ts:93 |

完整可复制输入列在 [解析修复提示词](../superpowers/plans/keyword-framework-01-prompts/zcode-parser.md)。现有19条测试没有锁定这些范围，测试通过不代表所有触发边界正确。当前尚未接保存/执行链，证明的是解析缺陷，未证明已经启动错误模型任务。

另有HTTPS大写URL误识别、可导出Set运行时可变的建议项。四空格缩进代码及引用式链接定义属于当前明确未覆盖范围，应在新语法交接中说明，不能与承诺跳过但泄漏的缺陷混称。

### 3.2 唯一活动尝试未完整检查

[types.ts](../../src/review/processors/types.ts) 第222行只筛activeAttemptId对应的未结束尝试。两个不同ID、finishedAt都为null的running记录被assertTaskInvariants接受。应要求全体未结束尝试仅一个且等于activeAttemptId；现有测试仅复制同ID。

此helper尚未接持久服务，是待迁移契约漏洞，不是已发生的宿主并发事故。公共契约迁移提示词要求先加失败回归。

### 3.3 管理页信息缺项

登记请求有triggerReason，KeywordTaskRecord和PublicTaskDTO没有持久/公开触发原因；关键词命中仅在私有moduleInput。迁移时补触发原因和安全命中摘要，不能为页面展示关键词暴露整卡正文/准备快照/凭据。

## 4. 本轮实际验证

| 检查 | 结果与限制 |
| --- | --- |
| pnpm typecheck | 通过，无错误；历史10处错误不能继续作为当前阻塞 |
| pnpm build | 通过，现有external配置弃用提示；不是安装或部署 |
| pnpm test | 89文件通过、1文件跳过；874条通过、4条跳过（总878）；parser现有19条通过 |
| 合规脚本自测 | 通过 |
| 显式安装Jobs离线探针 | 审查代理本轮重跑types9条与Jobs2条通过；不是真实live Agent |
| 显式客户端slot探针 | 审查代理收集fetch(/src/client/index.ts, ssr)超时；不能标此轮探针通过，也不据此断言业务源码错误 |
| git diff --check | 通过，既有CRLF提示不属于新增空白错误 |
| 当前正式宿主 | 本轮未发现匹配DSH/Harness进程名或3080监听；这不能排除其他启动方式/端口。未执行实际模型、scoped Skill或浏览器日志验收 |
| lint | package.json没有独立lint脚本；不伪称通过 |

全量测试的4条skip包括默认未传路径的Jobs与客户端安装探针。一次普通测试启动被沙箱spawn EPERM阻止，允许本地子进程后全量通过。审查代理另一次客户端probe超时是不同入口的证据，不能与常规单测混写。

## 5. 文档与下一步

[新开发计划](../superpowers/plans/2026-10-11-keyword-agent-framework-revised.md) 和 [新分工/提示词索引](../superpowers/plans/keyword-framework-01-prompts/README.md) 取代旧六方法任务书，编号保持方便追溯。

下一步Codex迁移公共契约并修唯一尝试/DTO缺项；原ZCode修解析范围。新注册表须等迁移后的真实导出、指纹、配置和服务签名交接，不能直接消费旧stage/schema表。

本轮保存设计/任务书，没有改上述缺陷源码、自动提交、部署、写真实vault、运行模型或向现有开发会话发送消息。parser交付已存在，应避免继续引用10月10日接口文档开头“parser未实现”作为当前状态。
