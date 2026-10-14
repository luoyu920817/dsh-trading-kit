# 关键词管理槽与Jobs：任务0实证

核验日期：2026-10-10。任务0的安装源码与真实实现离线探针完成；**运行中profile、文本Agent、正式详情页验收尚未完成**。本文件不把纯源码、离线实现和live页面合并称通过。

## 当前基线与归属

本轮执行前状态保存在 `.planning/2026-10-10-keyword-framework-01-development/baseline-status.txt` 和 `baseline-diff-stat.txt`。已有复盘缓存、store、routes、service、README/Skill及测试改动保持。本轮只维护指定公共契约和最小宿主/客户端接线，没有reset、提交或部署全部工作区。

当前重新执行的基线：typecheck/build通过；86文件845测试通过；合规脚本自测及diff检查通过。历史10处类型错误已不存在。没有lint脚本；构建仍有已有external弃用提示。首次测试因沙箱spawn EPERM失败，允许子进程后实际运行成功。

## 实际安装组合

实际来源为 `C:/Users/luoyu/AppData/Local/Programs/DeepSeek Harness/resources/app.asar` 内 `dsh/node_modules/@deepseek-ai/`。Jobs、Jobs-local、Agent、Skill、Skill-filesystem、UI-slots的package.json均为 `0.2.0-rc.2`。profile的旧tarball标识为 `dsh-trader-kit-0.1.0-p0-20261009-r2.tgz`，不能证明本轮源码已加载。

仓内dsh-tools为0.1.5-rc.2，其Agent为0.1.5-rc.3，不能拿旧SDK推断当前桌面行为。单独.d.ts未打包，但宿主typert元数据含内嵌公开TypeScript声明。逐项来源见开发记录 `workers/host-evidence.md`。

## Jobs公开接口与实现

以 `<ASAR>/dsh/node_modules/@deepseek-ai/` 为以下虚拟绝对路径前缀：

| 当前事实 | 来源与行号 |
| --- | --- |
| root attachController覆盖所有owner层；scope controller仅覆盖自己的组合 | dsh-jobs-local/lib/index.js:518–545；dsh-jobs/lib/index.js:77–105 |
| start同步调用spec.run(handle)，之后才登记/返回ID | dsh-jobs-local/lib/index.js:412–491，run在437，返回在491 |
| 省略owner为unowned；各caller可读；archive不杀unowned | dsh-jobs-local/lib/index.js:493–566；dsh-jobs/lib/index.js:19–42 |
| cancel同步，kill先请求再变stopping，done结算 | dsh-jobs-local/lib/index.js:611–621 |
| readAt不消耗观察游标；read会移动模型游标 | dsh-jobs-local/lib/index.js:501–507、598–608 |
| wait必须有正数毫秒参数 | dsh-jobs-local/lib/index.js:510–511、624 |
| 第一方通知监听器排除unowned结算，不发聊天followup | dsh-tool-jobs/lib/index.js:268–271；其他自定义订阅行为未验 |

本轮 `host-jobs.ts` 仅实现root绑定、unowned启动、job.id关联、自有取消和done后的卸载；不创建第二队列，不接卡片保存，不包含Agent运行器或生产启动探针。done拒绝会关闭接纳，卸载汇总为AggregateError，不伪称资源排空成功。生产者必须自行保证done在资源清理后结算；正式超时/取消恢复属于任务7/9。

## 固定无行情真实实现探针

从ASAR只读抽取Jobs/Cordis及必要依赖到开发目录 `workers/host-extracted/node_modules`，没有修改被抽取实现。探针构造真实Cordis Context并加载真实LocalJobRegistry。使用可控Promise，不用mock、sleep、模型、行情、工具或vault。

安装实现SHA-256：

- dsh-jobs-local/lib/index.js：`3BED0CD38C649F39B148752E742FF1EF57696A6B9B11B15FF8CC6CD1D4F08F26`
- dsh-jobs/lib/index.js：`909240E722C34877282C6868CD0E06915669E0CEAEF690B1738AE72B4C3EF049`

显式测试入口：设置 `KEYWORD_HOST_PROBE_ROOT` 为上述node_modules绝对路径，然后执行 `pnpm exec vitest run test/processors/host-jobs-contract.test.ts`。默认未提供路径会跳过这两个集成探针，跳过不等于通过。

真实观测：root controller成功；run在start返回前执行，得到本次 `review-keyword-1`；owner未设置；任意caller可读；固定中文文本出现在log，progress为“准备完成”；readAt(0)重复读取相同；kill同步触发cancel且状态先为stopping；只有释放清理Promise并完成done后为killed；历史ID被拒绝取消。第二探针证明done拒绝时dispose报KEYWORD_JOB_CLEANUP_FAILED且不能再start。

首轮探针wait无超时参数真实失败，修为wait(id,1000)后通过；这个参数是最大等待期限，不是sleep。独立审查发现清理拒绝被吞掉，先写失败回归再修复，两条真实探针均通过。

## Agent/Skill准确边界

- 当前公开Agent声明来自dsh-cordis-host-runner/lib/typert.host.js:873–933：followup(UserMessage):void；cancel结构化cause；whenIdle():Promise<void>。不能followup(string)，不能agent.dispose()。
- create返回 `{agent,dispose}`，dispose在handle上并等待idle：dsh-agent-loop/lib/index.js:1677–1690、1754–1757。setup(ctx,agent)先于发布，安全子集返回void；不是返回任意disposer。
- provider/model缺失时真正执行失败：dsh-agent-loop/lib/index.js:1185。此处没有假Agent、模型调用或“已配置”声明。
- skills.get(name,{scope,cwd,signal})取实际正文，字段是content；来源有source/provider/path。候选list不能替代实际scope读取及哈希。来源：dsh-skill/lib/index.js:224–270、471–489；dsh-skill-filesystem/lib/index.js:115–133。
- vault的agent/skills不是自动发现根，需后续按公开scope注册/读取面核验，不能靠文件存在宣称可用。
- sessionTitle.rename接收精确live Session对象，不能传sessionId：dsh-session-title/lib/index.js:295–310。
- create的完整seed/meta、工具组合、LLM配置装配未核成可执行契约，未为其编造Context宽类型或空适配器；任务7接线前必须补核。

## 正式管理槽与当前阻断

官方slot为root/list的 `plugins.detail.section`：dsh-client-ui-plugin-manager/lib/client.js:3749–3752；item/row/bundle三处渲染都传 `{subject}`（2334、2404、2534）。bundle为 `{kind:'bundle',pkg}`，不是owner包装（2420–2423）。

最小React组件仅本插件bundle显示标题和“尚未接入持久任务读取服务”；其他subject返回null。不把说明文字当持久日志验收。客户端沿slots.inject/register和effect注册释放，没有新依赖或主聊天发送。任务10/11才接真实任务/事件读取和操作。

另外使用原样UI-renderer/client.js注册器区段（ROOT_INSTANCE_KEY至registry区段末尾）和真实Cordis/SlotCore执行注册生命周期探针，不提供ReactDOM替身，不执行浏览器渲染。实际ctx.plugin(apply)证明缺详情声明时旧双槽保留、延迟声明时详情组件注册、声明释放及插件卸载时贡献清除、卸载后新声明不重新注册。初轮真实测试暴露直接可选conversation属性访问在未inject时抛错；按当前Cordis公开get(name)改为安全可选读取后通过。get公开语义依据真实Cordis lib/index.js:750–760。缺slots服务的降级也单独验证。

2026-10-10只读进程/监听检查没有发现live DSH；请求旧3080复盘HTML得到ECONNREFUSED。尚无运行中Jobs/Agent服务、provider/model/cwd、实际scoped Skill或页面加载证据。没有自动修改profile、重启、创建模型任务或下发ZCode。

因此任务0正式详情页/Agent出口保留阻断；任务1和纯解析不受此阻断。后续恢复实际宿主后，需要正式详情页执行/日志/取消/清理证据，不能以本轮离线探针代替。
