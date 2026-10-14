# 复盘输入页回归事件源职责（2026-10-12）

用户撤销登录链接方案：通达信内置复盘页只承担内容更新和修改，DSH接收成功存储提交事件并触发关键词工作流，输入页无需宿主登录动作或手动填写token。

## 本轮范围

- 回退上一轮新增的登录路由、宿主登录兑换镜像、设置复制入口、复盘登录表单、登录临时草稿协议及专项测试。
- 已审查与登录前交付快照的差异，逐文件恢复，未使用整个工作区reset。上一轮文件与文档保留到既有workers/tdx-login-reverted供追溯。
- 保留既有关键词MVP、目录编辑、卡片保存/修订/删除、图片、来源隔离、幂等、迟到结果保护、取消清理、恢复和实际Agent激活预算。
- 输入页移除管理注册表及单卡任务状态GET，配置、执行历史、结果、取消和显式重跑在DSH管理页。输入页的保存反馈不冒充工作流执行成功。

## 现有服务端链路

1. 输入页打开与保存不要求Cookie会话。写请求沿已有本机来源检查和自动注入的写凭据，用户无需输入或复制凭据。
2. `review/store.ts`在真实追加、修订、删除成功后发布`notifyReviewWrite`；幂等重放和失败不重复发布。
3. `attachKeywordTrigger`按数据根与复盘月桶筛选提交事件，异步串行交给runtime，保存返回不等待Agent。
4. runtime回读真实卡片内容，解析关键词、映射注册表，在来源锁内持久登记和去重；修订使旧版本失效，删除取消旧来源但保留历史。
5. 宿主能力与执行配置具备后，独立工作流执行。实际Agent激活前记预算，结果提交前再次核来源版本，取消与迟到结果沿既有保护处理。

管理接口GET401只影响管理读取，不参与上述链路。当前自动执行关闭，provider/model/cwd未配置；任务登记可验证，不能把等待当成真实Agent执行成功。登录桥的撤销不改变这些配置。

## 边界

当前订阅插件存储成功提交事件，没有外部文件系统watcher。直接用其他编辑器修改vault不是本次即时新增任务的事件来源；显式重扫沿已有管理能力。保存通知不是持久事件日志，提交后首次登记前崩溃仍有既有恢复边界，不在本轮扩展新协议。

真实宿主验收只读取页面/API，不写真实vault、业务目录或模型配置，不自动激活Agent。本轮源码门禁、安装与HTTP验证结果补录于既有开发progress及workers日志；真实模型产出没有验收，须在实际配置模型和开启执行后验证。

## 本轮交付证据

- 修改文件：回退`src/context-types.ts`、`src/review/index.ts`、`src/client/processors/page.ts`及上轮专项测试/静态登记；删除新增登录路由与两个专项测试。收敛`src/client/review/index.html.ts`、`test/routes-review/review-context-page.test.ts`、`review-page.test.ts`；新增`review-event-source.test.ts`。README与既有开发记录同步维护。其余前序源码与测试保留。
- 新组合探针使用实际已安装HostConnectionService、LocalCredentials、随机loopback HTTP、真实store/trigger/runtime/records，验证无Cookie保存、幂等去重、来源修订失效、删除取消保留历史及Origin403拒绝，明确缺能力等待、Agent激活0、result=null。
- 类型检查、构建、静态门禁与diff检查通过。第一次全量在构建并发负载下三项真实宿主测试超时；没有改生产逻辑或断言，降低至4个测试worker后最终111文件1055测试全部通过，真实离线探针零跳过。仓库没有独立lint脚本。
- 打包`dsh-trader-kit-0.1.0-review-event-source-20261012.tgz`安装默认web profile；6个关键编译产物hash一致，已安装包没有残留编译登录路由。
- 精确确认并重启当前3080 DSH web宿主，新PID1292。实际HTTP：无Cookie复盘直链200，页面无登录控件/管理请求/不可用警告，已撤销login-link API404，未登录管理registry仍401。
- 日志位于既有workers目录`review-event-source-*`；真实输入页保存和修改可由用户在通达信验证，真实Agent执行尚未验收。未写真实vault、未修改模型或开关、未提交代码。
