# ZCode原解析与注册表会话：任务2误识别修复

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

任务2主体已实现，本次修误触发，不重建解析器、不做尚未满足前置的任务3。
拥有：src/review/processors/parser.ts、test/processors/parser.test.ts、workers/parser.md。
保持当前ParseMentions/raw/name/start/end/processorId兼容；公共迁移若改workflowId由Codex先交接，不越权改types。

下列每项先加失败断言：recognized/unknown都为空（预期→expectation）。转义字符/反引号原样输入：
~~~text
`a
@预期
b`
``a ``` b ` @预期 c``
```
```text
@预期
```
![a [b] @预期](x.png)
[文档](note(a).md "title @预期")
![alt](img(a).png "title @预期")
[文档](note\).md "title @预期")
HTTPS://x.test/?@预期
~~~

1. 行内代码可跨行，反引号串须精确长度配对，不用长串局部关闭短串；未闭合策略保持明确。
2. 围栏开闭分开，关闭须同字符/足够长度且尾随仅空白；带text的代码行不能关闭围栏。
3. 图片alt、链接目标/标题按嵌套/转义找完整结束，不用首个括号；链接显示文字仍可识别，图片/嵌入整段忽略。
4. 明确大小写URL协议，补回归；导出标点表不允许调用方改变全局语法，最小无依赖修正并同步类型消费者。
5. 保持ASCII @、精确全名、边界、奇偶反斜杠、32码点、UTF16原文slice、CRLF/星面字、unknown原文保留。
重复命中全部返回，去重留触发层；不读文件/网络/登记/模型，不归一化输入造成偏移变化。
6. 不增加Markdown依赖或另造通用解析框架；四空格代码/引用式定义未覆盖策略在交接写清。
新增能力若对满足原承诺必要，说明最小增量，不顺手扩展业务。

验证：pnpm exec vitest run test/processors/parser.test.ts、pnpm typecheck、合规自测、diff。
与主会话迁移签名同步后重跑；每条复现从失败到通过的证据写workers/parser.md。
退出后再按新的zcode-registry提示词和真实新契约启动注册表，不能因parser通过标任务3完成。

交付实际修改文件、失败断言、真实测试结果、旧行为兼容、准确接口交接及未验能力/风险。
主会话收口：pnpm typecheck、pnpm build、pnpm test、node scripts/scan-compliance.mjs --self-test、git diff --check。
没有独立lint脚本不伪称通过；宿主探针skip不算实机成功，不以拟新增文件或占位说明冒认实现。
