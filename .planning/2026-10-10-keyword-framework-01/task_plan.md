# Task Plan: 01 框架与触发机制开发计划

## Goal
把第 01 份设计转成按依赖、文件、接口、测试和验收证据组织的开发计划，补充指派对象、模型和完整提示词，并按用户新增授权创建独立 Codex 开发会话。本会话维护交接文档，新开发会话先实施任务0/1。

## Next Step
源码审查与新任务书已完成；使用docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md。下一步已有Codex会话迁移任务1及必要任务0续核，原ZCode会话修任务2；新任务3注册表等真实新契约交接后开始。本轮未修改业务源码、未自动发送开发指令。

## Current Phase
Phase 10

## Phases

### Phase 1: Requirements & Discovery
- [x] 明确框架先行，预期模块后接入；本轮只编制计划。
- [x] 创建独立规划目录，核对既有变更和 01/04 设计。
- [x] 核对当前接口并记录 findings.md。
- **Status:** complete

### Phase 2: Planning & Structure
- [x] 按文件、接口、回归测试和完成条件拆步骤。
- [x] 写清宿主执行与管理日志最小闭环，限定 03 业务边界。
- **Status:** complete

### Phase 3: Review & Verification
- [x] 检查设计覆盖、文件路径、命令和恢复入口。
- [x] 记录实际校验与未核验项。
- **Status:** complete

### Phase 4: Delivery
- [x] 更新三个规划记录，交付 review 入口。
- **Status:** complete

### Phase 5: Task Allocation
- [x] 明确宿主/契约前置项和可以给 zcode 的实现包。
- [x] 写明文件所有权、启动条件、并行边界和统一验收。
- [x] 保存分工清单并验证链接与依赖。
- **Status:** complete

### Phase 6: Models, Prompts & Development Session
- [x] 核验模型资料，建立具体会话对象与设置建议。
- [x] 每个实现包写完整提示词、文件范围和启动条件。
- [x] 验证交付文件，创建 Codex 开发会话并记录真实返回。
- **Status:** complete

### Phase 7: Simple Keyword-to-Agent Workflow Design
- [x] 对照最新理念核现有设计与已建立的公共契约。
- [x] 写明简单框架、开放工作流的调整稿和旧方案适用范围。
- [x] 校验文档并说明现有开发交接需要调整的部分。
- **Status:** complete

### Phase 8: Extensibility Clarification
- [x] 对照两条批注核对旧、新方案接入边界。
- [x] 修正提示词优先/代码后补及简单复杂分类，明确第一版统一扩展契约。
- [x] 校验文档并解释实际差别与迁移范围。
- **Status:** complete

### Phase 9: Simple Business Model and Module Boundaries
- [x] 核对用户要求与当前扩展设计。
- [x] 固定四个业务对象、三个模块及扩展归属。
- [x] 校验文档，交付简明定义并区分设计与源码状态。
- **Status:** complete

### Phase 10: Implementation Audit and Revised Dispatch
- [x] 核任务0–3源码、实际交付记录和当前门禁，区分实现与实机证据。
- [x] 按四对象/三模块修订后续计划、分工索引与全部提示词，先迁移公共契约。
- [x] 校验链接、文件归属、启动依赖与旧术语残留，交付审查结果和下一入口。
- **Status:** complete

### Phase 11: ZCode MCP Collaboration Verification
- [x] 通过真实MCP派发限定范围的关键词解析复核，记录会话与文件交付。
- [x] 使用返回sessionId续接，独立核对证据、报告和源码边界。
- [x] 保存协作验证结果、执行限制和用户要求的MCP开发者反馈。
- **Status:** complete

## Decisions Made




| Decision | Rationale |
|----------|-----------|
| 设计会话维护文档，独立开发会话实施任务0/1 | 用户新增要求创建新 session 启动开发，避免共享规划记录竞争 |
| 命名目录，根代理维护规划 | 避免与其他任务混用共享文件 |
| 不覆盖既有源码 | 基线存在其他任务的 14 个已跟踪文件变更 |

## Errors Encountered
| Error | Resolution |
|-------|------------|
| ZCode yolo续接被自动审批拒绝，工具整仓写权限超出五文件只读授权 | 此轮未执行；不间接绕过。已说明权限差别并询问保持只读收口或补充授权 |
| ZCode plan禁shell，edit缺Bash permission client，无法运行只读复现 | 保留静态报告且不伪报退出码；按MCP无人值守mode=yolo说明续接，仅运行原授权只读命令，不禁用沙箱 |
| ZCode首个解析复核派发被自动审批拒绝，缺具体源码披露授权 | 用户明确授权五个文件后，将输入严格收窄为五文件重新派发；未绕过或间接执行 |
| 搜索包含不存在的 .codex 目录 | 后续只搜索存在的目录 |
| 插件初始化在沙箱内无法核验真实路径 | 同脚本经自动审查重试成功，没有绕过校验 |
| apply_patch 同一文件 Delete/Add 操作被拒绝 | 改为 Update 操作，首次失败未修改文件 |
| 检索路径 src/paths/safe-path.ts 不存在 | 找到真实的 src/paths/resolve.ts，修正计划引用 |

## Implementation Status
implementation_audited_and_dispatch_revised。任务0宿主基础及任务1旧契约、任务2parser已有实现；任务3在本仓未交付。任务1/2需迁移/修复，完整宿主验收仍缺证据。本轮改文档与交接，不改源码；新版执行计划和17份提示词已更新，待实际开发执行。

## Deliverable
[修订开发计划](../../docs/superpowers/plans/2026-10-11-keyword-agent-framework-revised.md)、[源码审查](../../docs/spikes/keyword-framework-implementation-review-2026-10-11.md)、[17份完整提示词索引](../../docs/superpowers/plans/keyword-framework-01-prompts/README.md)。当前typecheck/build/合规通过，全量874条通过/4条skip；旧10处类型错误不再阻塞，任务0实机日志/Agent未完成验收。

## Task Directory
- PLAN_ID：`2026-10-10-keyword-framework-01`
- 目录：`.planning/2026-10-10-keyword-framework-01/`
- 工具子进程环境变量不会自动固定父会话 hooks；恢复时显式设置 PLAN_ID 并核对解析结果。
