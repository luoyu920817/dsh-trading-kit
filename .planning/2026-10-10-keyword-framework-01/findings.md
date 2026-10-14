# Findings & Decisions

## Requirements
- 为第 01 份设计编制可执行开发计划，框架先行、@预期后接入。
- 写清每步文件、接口、测试、完成条件，尤其生命周期和触发机制。
- 本轮不改业务代码、不部署、不调用真实模型、不写 vault。

## Research Findings
- 01 第 9 节的框架验收包括管理页日志，需纳入 02 的最小执行和日志接线。
- 测试模块经统一接口接入，生产表保持空，不提前增加不能使用的预期模块。
- RESULT_COMMITTED 后恢复只补投递，不能重新运行模型。
- 当前已有写事件/缓存/性能相关源码变更，计划必须基于它们，不新建重复系统。
- 已核当前 registerReview：先 attachReviewService，再 routes/daily/loop；processing 应在已有 review 上追加，不能再次 provide 或整体替换。
- AREA_TABLE 当前无 processing 区域；现有 resolveArea 只支持 code/name/date/fileName，需明确月桶根和固定 settings 文件，再由内部 ID 校验组成 task 子路径，不扩开放任意路径参数。
- package.json 只有 typecheck/build/test，发布 files 没有 config；计划必须覆盖 JSON 资源的安装包解析和发布验证。
- onReviewWrite 仅同步捕获异常，异步 listener 的 Promise 拒绝不会被捕获。同步标 dirty，后台 Promise 显式 catch，并保留 registrationError。
- resolveRelativeUnderRoot 在 src/paths/resolve.ts，只做词法防越界；来源短核验仍须校验实际路径、市场/代码/日期/anchor 与正文。
- 01 完成需带 02 的最小原生 Jobs、独立文本 Agent 与管理日志；03 的预期 schema、日历/行情、17:30、人工确认保留到业务批。
- 已实际重跑 tsc：仍有 10 处测试错误，位置为 review-limit-box、review-params、skill/assembly、version、zip-guard；基线没有全绿，不引用旧设计测试通过数充当当前结果。
- 采用 writing-plans 的 docs/superpowers/plans 作为主交付文件；命名 .planning 目录保存执行入口和三个状态记录，不复制两份主计划。
- 主计划 13 个任务与四个 review 点已完整：原生执行和管理页是完成条件，生产空表/预期后接入是范围边界。
- 交叉复核已修正：新逻辑请求才递增序号而非仅手动 retry；固定声明校验在框架结果信封层；prepare 冻结 guard 事实和真实证据持久化，重启不能借新版业务状态给旧结果授权。
- pending 恢复必须区分 taskId 幂等登记自身的版本推进与人工改条件；前者 complete，后者 obsolete。新增对应重启测试要求。
- 当前构建、86 个文件/845 条既有测试、合规自测均通过；未做真实宿主探针或新框架运行，明确留在任务 0/7/12。
- 新请求是任务分配：zcode 按编码执行器划分，当前没有暴露 zcode 工具且 PATH 无该命令，本轮仅形成可转交任务书，不冒称已下发。
- 并行边界需澄清：任务3整体依赖任务2，纯注册表校验在类型冻结后可独立编写；任务6实际接线依赖任务5，不能以并行名义提前完成接纳。

## Technical Decisions
- ZCode真实协作验证：首轮plan静态复核返回会话；同sessionId续接正确回忆口令且撤回过度断言。edit报告pwd/Node版本成功，解析node -e受permission client缺失限制；yolo整仓能力被主机自动审批拒绝未执行。用户要求开发者建议，不继续扩大权限；建议优先受限无人值守、能力预检及结构化证据/进度，尚未查看MCP源码不定位具体实现根因。
- 2026-10-11 ZCode MCP已实际暴露zcode_task：支持当前项目cwd、mode和sessionId续接；接口不提供model/thinking参数。本轮用plan模式解析复核验证派发、返回和续接，不把工具发现本身写成协作成功。
- 2026-10-11源码审查：本仓仅types/parser/host-jobs及最小slot组件，registry/config资源/registry测试未交付。任务1六方法与最新四对象/三模块不一致；任务2有跨行代码/非精确反引号/非法围栏关闭/嵌套图片链接目标误识别，Node直接复现；活动尝试校验只筛当前ID会漏另一未结束尝试，触发原因与命中摘要未持久公开。
- 本轮当前typecheck/build/合规通过；全量89文件通过+1跳过，874条通过+4跳过。显式Jobs离线探针2条通过，客户端安装slot探针收集超时；普通默认skip不能算实机成功。未执行真实Agent/Skill/浏览器日志。
- 新修订计划保留原任务编号，17份全文按统一execute重写，Codex先迁移公共契约，原ZCode先修解析，再新注册表；公共文件单一负责人，UI独立新面板由worker、旧KeywordRunsSection和装配由主会话维护。
- 2026-10-11 用户再次限定：高扩展性前提下仍保持简单业务定义与模块划分。明确公共模型仅卡片/关键词/工作流/运行记录，模块仅关键词触发/工作流执行/运行管理与日志；版本、尝试、凭据和宿主会话归内部机制，预期业务模型留在工作流内部。
- 2026-10-11 两条批注：外部触发流程没有实质变化，必须说明区别是强制接入协议/编排归属；用户强调代码工作流是高扩展性，不接受只做提示词、以后再补开放入口。修订为首版统一注册/执行契约，Skill只是一个适配实现，代码工作流及后续运行请求边界必须预先落定。
- 2026-10-10 新设计澄清：用户希望卡片关键词作为入口，一个关键词对应一个 Agent 工作流，工作流实现开放且框架简单。当前触发、独立执行和管理日志符合，但强制六方法、agent/data双分支及统一业务回查机制使简单工作流接入过重。
- 已直接读取 types.ts 和接口交接，六方法公共契约已经存在；不能只改文字后声称实现已符合。开发会话当前 idle/首轮完成，任务2–12尚未实施；后续契约需按简化方案调整，不撤销任务0/1产物。
- 用户已明确要求创建新的 Codex 开发会话；真实匹配项目为 b2ac3843-5943-4525-baf3-9dcdba7b9c51，本地路径为当前仓库。创建保留用户默认模型，任务提示词建议 GPT-6.1 Sol/high。
- 已打开 OpenAI 官方模型选择与 ZCode 官方配置说明；建议 GLM-5.3/high 执行边界清晰的实现包，持久化、接纳、结果事务建议 max。模型档位是项目判断，未做性能测评或核验账号权限。
- 交付目录 docs/superpowers/plans/keyword-framework-01-prompts/ 含 17 份完整提示词和索引；主会话先执行任务0/1，ZCode 按真实接口交接启动，同会话的后续提示词不提前下发。
- 新开发会话使用独立命名规划目录 keyword-framework-01-development；设计规划目录由当前会话维护，避免共享状态文件竞争。

| Decision | Rationale |
|----------|-----------|
| 单独命名规划目录 | 插件支持独立任务，可恢复且不混用 |
| 并行只读核对 | 根代理维护共享规划，避免覆盖 |

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 初始化脚本路径校验首次失败 | 同脚本自动审批后成功，未改插件脚本 |
| 搜索了不存在的 src/paths/safe-path.ts | 已定位到真实 src/paths/resolve.ts，采用该文件接口 |

## Resources
- [01 框架与触发机制](../../docs/design/keyword-framework/01-framework-lifecycle-and-triggers.md)
- [02 执行与日志](../../docs/design/keyword-framework/02-dsh-execution-and-management-logs.md)
- [04 总实施计划](../../docs/design/keyword-framework/04-file-plan-and-acceptance.md)
- [本轮开发计划](development_plan.md)（已编制）
