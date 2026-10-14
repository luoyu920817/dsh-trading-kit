# 第一步：关键词识别、模块注册与受限配置

状态：详细设计草案。入口见 [总览](README.md)。本文件定义用户可见语法和配置契约；执行、存储分别见后续文件。

## 1. 本步骤的可用产物

输入一张用户卡片，插件可以确定地回答：识别到哪些标记、每个标记对应哪个模块、是否启用、需要哪些能力、未知词出现在哪个位置。整个步骤只读文本和本地配置，不调用模型或数据接口。

## 2. 文件清单与职责

| 文件 | 新增/修改 | 具体职责 |
| --- | --- | --- |
| `config/card-processors.json` | 新增 | 随插件交付的后端模块注册表，四个默认关键词及参数定义 |
| `src/review/processors/types.ts` | 新增 | 全框架共享的标记、模块、卡片身份、任务和结果类型；不做 I/O |
| `src/review/processors/mentions.ts` | 新增 | 纯函数解析，输出命中、未知词及原文跨度 |
| `src/review/processors/registry.ts` | 新增 | 读取 JSON、校验完整注册表、解析别名、生成有效配置指纹 |
| `src/review/processors/settings.ts` | 新增 | 校验并持久保存页面允许的覆盖设置；同版本冲突检查 |
| `src/config.ts` | 修改 | 增加 `review.processing` 配置段，不改变已有 `review.writeKey` 默认值 |
| `package.json` | 修改 | 将 `config` 与新增业务 Skill 纳入打包文件；不新增运行时依赖 |
| `test/processors/mentions.test.ts` | 新增 | 语法正反例及位置完整断言 |
| `test/processors/registry.test.ts` | 新增 | 实际 JSON 文件读取、无效条目、配置指纹与别名冲突 |
| `test/processors/settings.test.ts` | 新增 | 真实临时目录中的覆盖设置、版本冲突与写失败保真 |

标记解析沿 `src/review/image-refs.ts` 的纯函数与原文跨度做法，但不为本任务把整个 Markdown 解析器重构为新框架。能复用已有辅助函数就复用；未导出的局部逻辑不直接复制成“通用库”。

## 3. 第一版语法

### 3.1 标记边界

- 只识别 ASCII `@`。全角 `＠` 保留文本并提示“请使用 @”，不自动改写。
- `@` 前面必须是行首、空白，或明确分隔符 `（([【{、，,；;：:。！？!?`；不是邮箱或单词的一部分。闭括号之后需有空白或上述分隔符才开启另一个标记。
- 标记名由连续的中文、英文字母、数字、下划线或连字符组成，长度 1–32 个 Unicode 码点。
- 标记结束于空白、行尾或标点。注册名要完整匹配，不做最长前缀触发。
- 前面有奇数个连续反斜杠的 `@` 是转义文本，不触发。反斜杠本身不删除。
- 跳过 fenced code block、行内代码、Markdown 链接目标、图片/Obsidian 图片引用、URL。引用块第一版也不触发，避免摘录旧观点带来新任务。
- 只有 `@` 而没有名字时是编辑中的未完成输入；保存后不报错、不产生任务。

示例：

| 输入 | 识别结果 | 业务原因 |
| --- | --- | --- |
| `@预期 明天回查` | 命中预期 | 明确标记 |
| `观察承接（@模式）` | 命中模式 | 括号内的独立标记 |
| `今天@预期上涨` | 不识别 | 不满足标记前边界 |
| `@预期指数` | 未知词“预期指数” | 不把更长名字截成 `@预期` |
| `a@概念.com` | 不识别 | 邮箱上下文 |
| `` `@模式` `` | 不识别 | 代码示例 |
| `\@预期` | 不识别 | 显式转义 |
| `> 昨天写了 @预期` | 不识别 | 引用旧内容 |
| `@预期 @预期` | 两个位置，一个模块任务 | 位置用于证据，模块执行去重 |
| `@概念、@预期` | 两个模块 | 中文标点分隔 |

第一版没有冒号参数语法：`@预期:三日` 识别 `@预期`，冒号后是普通卡片正文；验证周期由页面设置决定，并显示有效周期。不得把正文里的“三日”偷偷解析为配置。

### 3.2 处理范围和多标记

每个模块收到整张卡片的正文和经过配置筛选的图片/历史。标记旁的文字不构成单独范围。页面帮助文案为“本关键词处理整张卡片”。

同一模块的多个标记保留全部位置，但只建立一个处理任务。例如两处 `@预期` 可以让预期模块产生两条观点对象；不是两次模型调用。不同模块之间不隐含执行顺序。需要依赖其他模块的新功能必须显式声明，首版不开放任意依赖图。

### 3.3 返回结构

```ts
interface ReviewMention {
  raw: string;                 // 原文，如“@预期”
  name: string;                // 去掉 @ 的原名，不改写正文
  start: number;               // 卡片 body 内 UTF-16 起始偏移
  end: number;                 // 不含 end，body.slice(start, end) === raw
  processorId: string | null;  // 注册表模块编号；未知词为 null
  recognition: 'known' | 'unknown';
}
```

偏移针对现有解析器提供的 `Card.body`，不是整份 Markdown 文件的字节偏移。换行、中文和 emoji 均原样保留。解析结果还包含去重后的 `processorIds`、非阻塞提示 `warnings`。模块禁用属于注册表能力状态，不等同于“未知词”。

## 4. 注册表 JSON

注册表有 `schemaVersion: 1`、`revision` 和 `processors`。模块定义至少包含：

| 字段 | 类型 | 含义和校验 |
| --- | --- | --- |
| `id` | 非空字符串 | 模块稳定编号，`^[a-z][a-z0-9-]{0,47}$`；不可重复 |
| `label` | 非空中文字符串 | 页面名称，如“预期回查” |
| `mentions` | 字符串数组 | 不含 @；别名按全名匹配，不跨模块重复 |
| `description` | 字符串 | 告诉用户标记处理什么 |
| `enabled` | 布尔值 | 后端默认开关，不代表能力已经可用 |
| `trigger` | 固定 `after_commit` | 第一版统一提交后处理 |
| `executor` | `data` 或 `agent` | 确定性数据代码或宿主 Agent |
| `handlerId` | 字符串或 null | 已接入data模块指向代码处理器；显式占位模块可以为null |
| `skillId` | 字符串或 null | agent 模块必须指向允许的已安装 Skill |
| `outputSchema` | 字符串 | 结果校验版本，例如 `expectation@1` |
| `context` | 字符串数组 | 允许的 card/images/history/role/marketEvidence |
| `defaults` | 简单 JSON 对象 | 模块默认业务参数 |
| `editableOptions` | 参数声明数组 | 页面可编辑键、类型、范围与中文说明 |
| `implementationState` | `ready` 或 `unavailable` | 后者是已知但尚未接入的模块，必须enabled=false |
| `followup` | 对象或null | 支持未来回查时明确kind、skillId、outputSchema与context，不能套用原分析Skill |

示例条目：

```json
{
  "id": "expectation",
  "label": "预期回查",
  "mentions": ["预期"],
  "description": "整理本卡片的预期原句，并在下一交易日比对实际表现",
  "enabled": true,
  "trigger": "after_commit",
  "executor": "agent",
  "implementationState": "ready",
  "handlerId": null,
  "skillId": "review-expectation",
  "outputSchema": "expectation@1",
  "context": ["card", "images", "history", "role"],
  "defaults": {
    "verifyAfterTradingDays": 1,
    "historyCardLimit": 10,
    "includeImages": false
  },
  "editableOptions": [
    {"key": "historyCardLimit", "label": "最多引用历史卡片数", "type": "integer", "min": 0, "max": 20},
    {"key": "includeImages", "label": "读取卡片图片", "type": "boolean"}
  ],
  "followup": {
    "kind": "expectationCheck",
    "skillId": "review-expectation-check",
    "outputSchema": "expectation-check@1",
    "context": ["card", "tracking", "marketEvidence"]
  }
}
```

context声明允许能力，includeImages只选择本次是否启用已允许的图片能力，不增加权限。首版页面不开放 `verifyAfterTradingDays` 编辑，只展示“下一交易日”。模式模块在能力完成前 `enabled: false`；龙虎榜模块 `implementationState: unavailable`、`enabled: false`、handlerId=null，页面展示“数据模块尚未接入”，不能允许开关绕过能力检查。显式占位条目不使整份注册表失效；ready条目引用未知handler/schema时仍拒绝新注册表。

### 4.1 哪些配置属于代码权威

JSON 只能引用代码注册的 `handlerId`、`outputSchema` 和上下文能力。它不能动态 import 任意文件、设置目标写目录、提交任意工具调用或提供 shell 命令。用户新增 agent 路由可以使用预注册的 `structured-note@1` 通用证据笔记 schema；新增业务结果类型需要增加校验器。

`registry.ts` 建立别名到模块的只读映射。别名不做模糊或同义词猜测。词条相同且归属不同模块时整份新注册表拒绝启用，指出两个模块及冲突词条。

当日分析使用条目顶层handlerId/skillId/outputSchema/context。回查只使用followup明确声明的执行配置。followup.kind仅允许expectationCheck或patternCheck；缺followup的模块不能登记未来检查。context允许card/images/history/role/marketEvidence/tracking，其中tracking只供后续检查读取冻结条目。回查的routeRevision独立计算，并记录来源当日分析jobId与其routeRevision，不拿提取schema校验比对payload。

### 4.2 读取和失败处理

1. 默认读取随包发布的 `config/card-processors.json`，路径由模块位置解析，不使用 `process.cwd()`。
2. 配置 `review.processing.registryPath` 可指定一个绝对 JSON 路径；第一版不支持相对路径，避免 profile 与 Agent cwd 混用。
3. 外部注册表替代内置注册表，不能偷偷把两份拼成不确定优先级。
4. 启动时文件不存在、语法错误、schema 不支持或冲突：关键词能力进入 `configurationInvalid`，旧复盘读写继续工作。
5. 热更新仅由显式“重新载入后端配置”操作触发。新配置完整通过校验后一次性切换；失败保留上一份有效配置，并显示错误字段路径。
6. 禁用全部处理或 `dataRoot` 未配置时不产生任务、不创建衍生目录。标记仍可作为纯文本保存。

JSON 文件最多 256 KiB、模块最多 32 个、每模块别名最多 8 个、每模块可编辑参数最多 16 个。超限属于配置错误。所有上限是本功能的保护性默认值，不是宿主容量保证。

## 5. 页面覆盖设置

页面只提交 `enabled` 和 `editableOptions` 声明过的参数。声明之外的键显式拒绝并说明原因，不静默忽略。

有效配置顺序：内置或外部注册表的默认值 → 已校验的页面覆盖值。代码能力白名单始终不可由覆盖值扩大。关闭全局开关时，单模块开关无权重新启用调度。

设置文件位于 `<dataRoot>/DB/review/processing/settings.json`，沿既有写白名单；由新增路径映射 `processorSettings` 定位。此文件不包含密钥、模型凭证、任意 Prompt 或 Skill 正文。

设置保存请求携带 `settingsRevision`。若已经被另一页面更改，返回 409 `SETTINGS_VERSION_CONFLICT`，页面重新读取后由用户再次保存。成功时版本递增，原子替换整个小型 JSON。失败时旧文件保留；未写成功的设置不能在当前进程提前生效。

有效配置切换和结果提交共用配置互斥锁。保存设置先持该锁原子落盘，再切换内存快照；结果持卡片锁后取得配置锁并直到结果落盘才释放。配置保存期间不等待卡片锁，任务失效通知在释放配置锁后处理。读接口按当前快照实时计算适用状态，不能仅相信旧job里保存的current字样。完整锁顺序见第2份文档。

设置变化不自动重跑全部历史卡片：

- 关闭模块：停止待执行任务，当前卡片显示“模块已关闭”；历史结果仍能展开。
- 开启模块：只处理最近恢复窗口中的卡片和之后提交的卡片；更早历史需显式重扫。
- 参数或 Skill 版本变化：旧结果标记“配置已变化”；新提交使用新版；当前卡片可点“按新配置重新处理”。

## 6. 配置指纹和审计

有效模块版本routeRevision对排序后的执行定义、有效参数、处理器版本、实际Skill哈希、业务只读资源版本做SHA-256；当日和followup分别计算。模式模块的业务资源版本包括选中的patternId及每份实际定义哈希。单纯改页面中文说明不应重跑；改变输入或输出配置必须改变指纹。

模式定义在执行预检、结果提交前、结果读取和人工确认时重新核验实际内容哈希；资源变化通过同一配置互斥切换有效路由快照。不能只在安装时记录一次旧哈希。读取发现变化只把旧结果标过期，不启动模型；显式reload/重处理或已登记后台能力预检再安排新请求。

Skill 暂时不可读取时版本记为不可得，任务进入等待能力。配置重新载入后 Skill 可读，重建有效版本并替换旧的待执行请求；不能把“未知版本”的结果接受为当前版本。

每个任务保存触发时的配置快照。设置后来改变不能影响已经运行的任务输入；提交结果时按当前有效版本判断是否仍适用。具体失效语义见第 2 份文档。

## 7. 回归测试与本步骤验收

- 原文里有两个标记、中文括号、CRLF、emoji：断言每个 `raw/start/end/processorId` 完整正确。
- 代码、图片引用、链接目标、URL、邮箱、转义、引用块：均不产生任务意图。
- 同一词重复：保留两个位置，仅一个模块编号。
- 未知词不会触发已知词的前缀模块；保存仍可成功。
- 禁用模块可识别但不可执行；用户不能通过页面把未接入 handler 变成可用。
- 四个默认词条包含龙虎榜占位时仍能完整载入；只有占位模块不可用。
- JSON 冲突、非法参数、目录不存在、超限和无效热更新均给出具体字段错误，保留旧有效版本。
- 两个真实并发设置提交只有一个接受旧版本号；另一个得到版本冲突，文件仍可解析。
- `pnpm pack` 的清单包含 JSON 和相应 Skill，安装后的读取路径不依赖源码目录。

完成本步骤仅说明“能准确识别和配置”，不说明 Agent 已自动执行。
