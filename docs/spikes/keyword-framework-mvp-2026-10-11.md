# @预期 关键词工作流 MVP 交付

2026-10-12 安装补记：用户授权后已安装到 CLI `web` profile。首次浏览器验收暴露客户端 ESM 与宿主普通脚本 loader 契约不兼容；已改为共享 React 的单文件 CJS factory，增加构建产物回归，重新安装 `dsh-trader-kit-0.1.0-keyword-mvp-20261012-loader-fix.tgz`。实际浏览器刷新后主界面恢复、复盘入口可见，无需重启。下面 10 月 11 日的“未部署/无宿主”描述为当日证据；当前仍未完成真实预期模型执行、结果及取消验收。

本轮完成源码闭环，未部署、重启、提交或写真实 vault。真实宿主模型执行与页面操作仍待宿主可用后验收。此前任务 0/1 的记录属于历史证据；当前契约是单 `execute`，不再沿用六方法或公共 stage。

## 使用方式

保存卡片，例如 `@预期 明天指数企稳，成交额回升。`。解析器排除代码、链接等非正文提及，按配置映射 `预期 → expectation@1`。保存成功后登记任务；相同来源、正文版本和工作流版本去重，AI 附注不改变正文版本。

执行成功需真实宿主 Agent：独立会话读取卡片正文，输出原句、可观察条件与后续核验方式。原句必须来自卡片，结果经过结构及内容校验后保存到运行记录，不修改卡片人工判断。没有次日自动回查、行情取证或交易执行。

复盘页提供状态和管理入口；详情槽也提供管理链接。登录宿主后访问 `/dsh-trader-kit/review/processors`，查看任务、结果、日志，显式取消、重跑。等待原因包括宿主或模型不可用、自动执行关闭、预算耗尽、来源待核验等。GET 不触发执行；重跑创建新序号，保留历史。

默认自动执行关闭。安装本包后，需在宿主插件配置的 `review` 下设置以下字段（这里只给示例，未修改实际配置）：

```yaml
processing:
  enabled: true
  provider: '<宿主真实 provider ID>'
  model: '<宿主真实 model ID>'
  cwd: 'E:/work/code/open/dsh-plugins/dsh-trader-kit'
  maxConcurrency: 1
  agentAttemptLimit: 20
  maxTokens: 4096
  timeoutMs: 120000
```

宿主缺 Jobs 或 Agent 能力、模型配置不完整时仍可持久登记，明确显示等待，不生成成功结果。每次实际独立 Agent 会话激活计入当天预算，包括多轮激活。没有自动定时唤醒；恢复仅处理已登记记录，显式重跑或重新保存可重新发起。

定义来自随包发布的 `config/card-processors.json`。页面设置保存到既有缓存分区的 `processors/settings.json`，优先于包内定义；重新加载保留这个覆盖。全部候选配置校验成功后才替换运行注册表。

## 产物与文件归属

- `src/review/processors/{types,parser,registry,identity,records}.ts`：开放契约、同源浏览器解析、映射、来源与输入身份、原子持久登记和去重。
- `src/review/processors/{source,context,results,scheduler,runtime}.ts`：来源核验、隔离上下文、结果校验、实际激活预算、调度、取消、恢复及迟到结果保护。
- `src/review/processors/{agent,expectation,trigger,index}.ts`：真实独立 Agent 适配、预期案例、保存事件和装配。`src/review/store.ts`、`src/review/write-events.ts` 提供来源短锁与保存通知。
- `src/routes/{review-processors,workflow-page}.ts`、`src/client/processors/page.ts`：鉴权 API 和独立管理页。`src/client/review/index.html.ts` 与 `src/client/processors/KeywordRunsSection.ts` 提供入口、提示和状态。
- `src/config.ts`、`src/paths/mapping.ts`、`src/service/index.ts`、`src/review/index.ts`、`package.json` 与 `config/card-processors.json`：配置、既有缓存分区、服务及发布资源接线。
- `test/processors/`、`test/routes-review/{review-processors,workflow-page,review-context-page}.test.ts` 等：保存闭环、隔离、版本、取消、恢复、预算、解析、鉴权和页面回归；结构测试限定新增文件的合法 HTTP/缓存用途。

已有 ZCode registry 产物经审查保留；无可集成产物的 records/UI 任务已取消。原生子 agent 完成契约/运行时、Agent/记录、解析/页面；其使用额度耗尽后由主协调接管集成、回归与文档。没有重写已可用模块，没有继续启动 ZCode。工作区已有无关修改原样保留，不将完整 git diff 都算作本轮产物。

## 验证证据

- 类型检查、构建、合规扫描自测与 `git diff --check` 通过。仓库没有 lint 脚本，未冒称运行 lint。
- 定向回归通过；真实临时文件验证保存 `@预期`、持久登记、重复保存去重、附注不改版本、正文修改失效旧任务、取消与新序号重跑。缺 Jobs 场景实际停在等待状态，没有假 Agent 成功。
- 全量最终：105 文件、1005 测试全部通过，零跳过。命令为 `pnpm test --pool=threads --maxWorkers=1 --no-file-parallelism --testTimeout=15000`，设置 `KEYWORD_HOST_PROBE_ROOT` 指向开发规划目录里的安装包只读解包。日志：`.planning/2026-10-10-keyword-framework-01-development/workers/final-mvp-tests-io-budget.log`。
- 默认 5 秒超时的上一轮为 1004/1005：旧 `store-images` 文件生命周期测试超过 5 秒；失败日志 `workers/final-mvp-tests.log` 保留。使用 15 秒 I/O 预算后全量通过，未修改该业务实现或全局测试配置。更早旧 Skill 文件 rename EPERM 在定向与后续全量中未复现。
- 安装离线探针使用真实安装 Jobs、Cordis 和 SlotRegistry，验证其公开接口及释放；源码适配测试验证输出与取消约束。构建后实际读取包内配置、执行生成解析脚本并编译复盘内联脚本通过。这些均不等同真实模型会话或浏览器绘制验收。
- 当前只读宿主核查：匹配 DSH 进程 0、3080 监听 0。实际 provider/model、scoped Skill、模型结果、宿主取消清理及 CEF/详情槽页面操作尚未真实验收。未自动安装、部署、重启或连接真实 vault。

## 简化与剩余边界

一个归一化关键词映射一个单 `execute` 开放工作流；预期只做内容整理与核验条件，复用 Jobs、已有保存锁、鉴权和缓存分区，无新依赖。没有强制观察协议、公共 stage、六方法、第二套模型执行器或固定成功结果。

来源按文件/锚点/标的/日期隔离，正文和工作流版本核验阻止迟到结果覆盖当前任务；成功历史可保留但不自动重跑。取消终止自身会话并等待清理，损坏记录和来源不可核验均失败关闭。记录锁/CAS 面向单进程，不声明多个宿主进程共同挂载同一数据根的协调能力。

保存通知不是持久事件日志；保存后在首次登记前进程崩溃或立即卸载可能留下未登记卡片，可在管理页显式按日期范围重扫（最多 31 天）。启动不会扫描全部历史卡片。预算跨日不自动唤醒；真实宿主能力补齐后仍需实际验收独立执行、取消及页面行为。
