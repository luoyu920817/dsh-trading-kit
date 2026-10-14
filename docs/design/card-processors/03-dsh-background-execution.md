# 第三步：DSH 后台执行与任务生命周期

状态：详细设计草案。公开 API 已只读核验；本文件列出的真实接线和模型行为尚未实机验收。

## 1. 本步骤的目标

用户在通达信复盘页保存带标记的卡片后，插件通过 DSH 公开 Agent 服务自动运行指定 Skill。执行与主聊天隔离；任务失败、服务缺席和模型超时不影响继续写卡。业务成功以结果校验并持久保存为准。

## 2. 文件清单

| 文件 | 新增/修改 | 具体职责 |
| --- | --- | --- |
| `src/review/processors/scheduler.ts` | 新增 | 领取任务、并发、退避、成本预检、取消和恢复唤醒 |
| `src/review/processors/host-agent.ts` | 新增 | 所有 DSH Agent 公开 API 的唯一适配面 |
| `src/review/processors/context.ts` | 新增 | 冻结指定卡片、角色、历史和市场证据，输出来源编号 |
| `src/review/processors/results.ts` | 新增 | 统一结果信封校验、版本保护提交和模块校验器注册 |
| `src/context-types.ts` | 修改 | 增补可选 agents、skills、llm、attachments 和 scoped tools 的最小类型面 |
| `src/review/processors/index.ts` | 增补 | 注入适配器、清理生命周期、暴露能力状态 |
| `src/config.ts` | 增补 | 后台 provider/model/cwd、并发、尝试数和超时设置 |
| `skills/review-processor-probe/SKILL.md` | 新增 | 最小集成探针：读取固定卡片，使用提交工具产出结构化引用 |
| `test/processors/context.test.ts` | 新增 | 本地卡片证据、角色边界、截断与图片元数据 |
| `test/processors/scheduler.test.ts` | 新增 | 显式时钟推进、队列转换、真实结果文件和取消契约 |
| `test/processors/results.test.ts` | 新增 | schema/证据/版本/token 拒绝及成功提交 |
| `test/processors/host-contract.test.ts` | 新增 | 已安装包公开签名与宿主组合的真实集成验证入口 |
| `docs/spikes/card-processor-agent.md` | 新增 | 宿主接线探针步骤与实测证据，不写假定成功 |

## 3. 已核验的 DSH 公开语义

来源根目录：`C:/Users/luoyu/.dsh/profiles/node_modules/@deepseek-ai/`。本次核验的 agent/agent-loop 为 0.1.7-rc.1；实现时重新核验当前组合，不把版本字符串写成永久约束。

| API | 已核验语义 | 设计使用方式 |
| --- | --- | --- |
| `ctx.agents.create` | 创建独立 session/agent，返回拥有 dispose 能力的句柄 | 每次尝试创建一个独立后台 Agent |
| `setup(agentCtx, agent)` | 发布前配置 scoped 工具、提示与限制；失败回滚；setup 内不驱动 | 先装载 Skill和绑定工具，create 完成后 followup |
| `followup(message)` | 普通下一轮输入，唤醒驱动器 | 正式启动本任务 |
| `inject(message)` | 添加模型上下文，不唤醒 | 不是自动执行入口；本轮无需持续注入全卡片 |
| `steer(message)` | idle 可启动；running 在下个 step 领取 | 不用它打断用户主会话 |
| `whenIdle()` | Agent 全部运行与维护停稳 | 清理等待；不能作为业务成功判据 |
| `cancel(cause)` | 协作取消，默认清空 inbox | 超时、来源撤回或卸载时停止本任务 |
| `handle.dispose()` | 停止并排空 loop、解除 scoped 注册、detach live session、关闭持久句柄 | 每次尝试结束后由适配器释放 |
| `agentCtx.tools.restrict({allow: []})` | 屏蔽继承工具；当前 scope 的注册工具仍可见 | 只暴露本任务的读上下文、读图和提交结果工具 |
| `exec.concludeTurn()` | 成功的最终工具结果结束当前轮次 | 结果保存成功后调用，避免重复写作 |

来源文件包括 `dsh-agent/lib/types/index.d.ts`、`runtime-types.d.ts`、`dsh-tools/lib/types/index.d.ts` 和包 README。`create` 需要 agent-loop 提供 factory；包安装不证明运行中的 factory/model/provider 已齐备。

## 4. 接线与可选能力

### 4.1 主插件继续可用

主入口保持已有 webServer/connection/tools 必需依赖。后台适配作为 `ctx.inject(...)` 绑定的可选作用域注册，宿主的 agents/skills/llm 等能力出现后启用，消失时只卸载后台执行能力。图片附件服务只在图片任务时必需。

不能直接把 agents 加入整个插件不可缺的 inject 数组，导致宿主缺一个后台包时旧复盘页全部消失。数据模块不依赖 Agent，因此概念补全在 Agent 不可用时仍可工作。

`src/context-types.ts` 增补公开结构子集；本轮不为了几个 API 引入整套新依赖。该镜像必须通过宿主类型/真实组合核验，不靠 `any` 或猜测字段绕过编译。

### 4.2 后台模型配置

新增配置示意：

```ts
review.processing = {
  enabled: false,
  registryPath: '',
  agent: {
    provider: '',
    model: '',
    cwd: '',
    reasoningEffort: null,
    maxTokens: 4096
  },
  maxAgentConcurrency: 1,
  maxDataConcurrency: 2,
  maxAttempts: 2,
  agentTimeoutSeconds: 120,
  maxAgentJobsPerDay: 30,
  maxImagesPerJob: 4,
  maxContextCharacters: 24000,
  recoveryDays: 7
}
```

这是拟议默认值。首次交付默认关闭全局能力，完成实机接线、配置具体模型后显式启用；页面展示明确配置状态。没有 provider/model/cwd 时不能假装继承了用户当前聊天设置，更不能硬编码 README 中的示例模型。

cwd 必须是配置的绝对工作目录或由已有安装根元数据可靠解析出的项目根，禁止 `process.cwd()` 或“最近一个聊天”的猜测。dataRoot 是资产路径，不自动等同于 Agent 工作目录。

数字范围均由配置校验，超时限定 10–600 秒、尝试数 1–3、Agent并发 1–2、数据并发 1–4、每日 Agent 任务数 1–200。前端只显示这些框架限额，首版不开放修改。

## 5. Skill 装载必须实际成立

现有 `agent/skills` 部署目录不是宿主默认发现根。必须在后台 Agent 的 scoped 世界中验证 `skills.get(skillId, {cwd, scope: agent, signal})` 能返回完整内容，并记录版本或实际文件哈希。只看到本地文件不算可用。

内置预期、模式 Skill随本插件发布，复用现有 local-dir 部署模式到 `agent/skills`。总装配需要显式提供 scoped Skill provider 或沿宿主 customSkillDirs 注册该根，然后通过实际 get 检查。第一版选 **scoped 注册已校验 Skill**，不修改用户全局 Skill 搜索设置。

适配器通过公开skills.get取得SkillDefinition.content，并携带name/provider/resourceBase的来源说明，把完整正文作为独立指令提供给Agent。resourceBase用于解释资源位置，本轮只支持正文自足或已明确登记的资源，不自动开放任意相对文件读取。无需为了格式化新增dsh-skill运行时依赖；已有宿主可用的renderSkillContent仅在无需新依赖时复用。继承skill工具可被屏蔽，用户原文不会被当成新的Skill指令。

Skill 无法发现、版本无法核实、重复名称遮蔽或正文读取失败：任务 waitingCapability，页面点名 skillId、注册来源和修复方式。代码不能静默改用每日汇总 Skill。

这里分为两次核验，避免出现“尚未创建Agent却要求其scope已经存在”的依赖循环。create之前只读取和校验配置指定的Skill来源，冻结候选正文与哈希；create的setup取得真实agent后，注册该候选并调用带scope的skills.get，核对实际解析出的来源、正文与冻结哈希。第二次核验失败时setup失败并清理，不发followup、不计模型尝试；实际版本变化则重新登记对应版本的请求，不能直接在旧job内替换Skill。只有两次核验一致，才认为本次执行配置可用。

## 6. 单任务尝试的完整流程

1. 调度器在请求组/任务锁内领取，写preparing和preparationToken后释放；不增加attemptCount，也不占已启动模型预算。
2. 构建冻结上下文并复核当前 sourceRevision。已过期则取消，不创建 Agent。
3. 按processingKind选择注册表的当日执行配置或followup配置，冻结到executionProfile；预检Skill候选来源及哈希、outputSchema、上下文、模型路由、图片能力和日尝试预算。此时不调用尚不存在的Agent scope。expectationCheck/patternCheck不可误用原卡片分析Skill。
4. 生成新的sessionId用于本次准备，记录jobId和preparationToken对应关系。
5. `create` 的 setup 内屏蔽继承工具，完成上述scoped Skill核验并注册三类本任务工具。工具闭包先绑定job和准备凭据，但执行入口保持未激活。创建阶段可使用 signal，但这个 signal 在 create 返回后不再作为整个任务的取消机制。
6. create成功后，按卡片→配置→请求组→job锁顺序复核源版本、当前generation、配置及预算；通过才写running、新attemptToken、增加attemptCount和每日已启动尝试计数，把本次token绑定到工具闭包并激活，然后释放锁发followup。未激活工具调用明确拒绝，不能先提交再补计数。创建失败/缺factory仍是预检失败，不耗实际尝试；复核失败则dispose未驱动句柄。
7. Agent 经工具读取证据、图片和提交结构化结果。结果工具闭包固定 jobId/token/目标卡片，模型只能传 payload 和引用编号。
8. 提交服务校验输出、来源、当前版本及 attemptToken，经第 2 份文档的锁顺序原子保存 result+succeeded。
9. 成功工具调用 `concludeTurn`；调度器等待 idle，最后 dispose。
10. idle 时没有有效提交：failed `RESULT_NOT_SUBMITTED`，保留具体原因，不用最后一段聊天文本冒充结果。

创建本任务只使用后台独立 Agent。当前主会话不接收 followup/steer，卡片页不自动切换聊天，不弹“请先问 Agent”的中间步骤。

## 7. 任务工具与权限边界

| scoped 工具 | 模型入参 | 框架固定的内容 |
| --- | --- | --- |
| `review_processor_context` | 无，或已声明的 evidenceId | 当前任务的冻结正文、允许历史、角色与数据 |
| `review_processor_image` | `imageId` | imageId 到本卡片引用及其内容指纹的映射 |
| `review_processor_submit` | 模块 payload、引用 evidenceId | jobId、attemptToken、sourceRevision、routeRevision、存储目标 |

不暴露通用 shell、任意文件写工具、改卡片、改模式库或全 vault 搜索。历史召回由构建器按模块配置先选好，模型不能扩大范围。

`review_processor_submit` 不是供网页或其他普通 Agent 任意调用的全局工具，只在该后台 scope 注册。工具输入/输出按现有 defineTool DSL 声明；schema错误明确返回字段名，记录内不生成半个成功结果。

数据模块直接返回同样的结构化结果，经过同一个 results 提交入口，不为确定性数据创建 Agent。

## 8. 真实图片输入

宿主消息里的图片不是一个 Base64 字符串或绝对路径：

```ts
type ImageBlock = {
  type: 'image';
  attachment: ImageAttachmentRef;
};
```

本机公开附件服务 `attachments.saveImages([{data, mediaType, name}])` 可把校验后的 Uint8Array 转成宿主图片引用。`review_processor_image` 采用宿主 read-image 工具同样的 output.render 模式：执行时真实读图并保存附件，工具输出含文字与 ImageBlock，下一模型请求才能读取图像。

流程为：

1. 只允许本任务冻结的 imageId，重新经 `readImageFile` 校验月目录、路径、MIME和大小。
2. 复核图片字节哈希；文件被外部替换则拒绝本次旧版本读图。
3. 用 `llm.resolveModelInfo(provider, model, signal)` 检查**确切路由**的 `inputModalities` 明确包含 image。
4. 附件保存成功，工具返回宿主格式的 ImageBlock；记录该 imageId 已实际提供给本次尝试。
5. 结果可以引用该图片；未调用读图工具的图片不能在结果中声称“已分析”。

附件服务或图像模型不可用时：`@模式` 任务 waitingCapability，不能猜图。允许纯文本的 `@预期` 可按明确记录的降级策略继续，但结果必须显示未读图片及原因。元数据存在、附件存在、模型实际读图是三个不同事实。

## 9. 上下文来源和预算

默认上下文顺序：当前完整卡片 → 本次模块设置 → 当前标的 `角色` 原文 → 最近的同标的历史卡片 → 模块明确要求且可证的数据。

每条证据分配 evidenceId，携带文档/锚点/交易日/跨度或数据源/业务日期/取数时间。模型提交时引用 evidenceId；框架检查引用属于本次上下文，用户原句必须能在指定 body 的跨度重现。

总文本上限 24,000 字符，历史默认最多 10 张，图片默认最多 4 张。当前卡片不能默默截断：若它本身超过预算，任务失败 `CURRENT_CARD_TOO_LARGE`，页面建议拆卡；历史按日期最新优先截断并报告遗漏数量。

五个复盘维度作为可选分类和召回条件：指数、情绪、题材、赚钱效应、个股/选股。不要求新增五条后台流水线，也不改变现有 brief 四段结构。

每日30个Agent任务默认实际统计已启动尝试（包括重试），是调度上限，不等于Token费用上限。记录attempts数组中的startedAt/provider/model/sessionId/token，跨日重试按该次实际启动的东八区日期计数。maxTokens限制输出，不能完整限制推理Token或provider计费；页面展示尝试计数和可用宿主usage，不能承诺固定费用。

## 10. 超时、重试和卸载

Agent 超时调用 `cancel({kind: 'hook', reason: 'card-processor-timeout'})`。公开 cause 没有 timeout kind，不能构造未定义字段。cancel 是协作取消，必须等待 whenIdle/dispose 排空；不能在旧句柄仍运行时给同一任务启动第二个 Agent。

可重试：暂时模型请求失败、已确认的连接中断、临时记录保存错误。最多两次尝试，第一次后退避 5 秒；测试通过显式调度时钟推进，不 sleep。

不可自动重试：schema错误、未知引用、当前卡片过大、模型不支持图片、缺Skill或能力、源版本改变、用户关闭模块。缺能力进入waitingCapability，不消耗实际尝试。agents/Skill/llm/attachments重新挂载、显式reload或后台能力探测成功时，先重建实际Skill哈希和有效routeRevision；未知版本的旧job被configurationChanged，新generation按可用版本重新登记，再预检。不能一直运行持有未知版本的旧请求。

卸载顺序：停止领取 → 持久标记运行中断 → 对自己持有的 Agent cancel → 排空并dispose → 解除工具、监听器和定时器。任务状态写失败记录日志，重启后按 running恢复规则核验。不能dispose用户主聊天Agent。

## 11. 必须先做的宿主接线探针

在真实临时 dataRoot 中写一张只含固定文字的卡片。执行内置 probe Skill，它只提交该文字原句和来源锚点。收集如下证据：

- 当前实际宿主版本、agent factory、provider/model/cwd 配置来源。
- 主聊天 sessionId 与后台 sessionId 不同，主聊天消息未新增。
- Skill在后台scope实际可见，三种专用工具可见，通用写工具不可见。
- 提交工具成功，记录文件中有匹配 sourceRevision 的结果。
- 主聊天和页面仍能编辑；结果失败时不改变源卡片。
- cancel、超时和插件卸载真正排空句柄。
- 第二个独立探针读取一张有已知视觉内容的测试图，引用正确，未知/文本模型明确拒绝。

探针使用本地测试卡片和测试图片，不写真实 vault 或外部参考仓库。只有这些证据齐备，才能启用正式后台模块；typecheck通过或依赖包存在不替代实机验收。
