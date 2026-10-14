# 导航与设置页调整

用户要求左侧显示按钮，点击在右侧显示对应页面，并将本插件配置放入设置弹框独立页。

## 修改

- `src/client/index.ts`：侧栏只注册图标；右侧 `main` 使用正确的 `key`，与导航 id 对应。各贡献通过 `slots.inject` 等待声明、卸载释放。移除旧根作用域聊天发送和插件详情配置入口的装配。
- `src/client/panel/Workspace.ts`：右侧复盘卡片/关键词任务页签；卡片显式输入标的，保留市场和前导零，不猜代码。复用同源页面，不另建业务存储或模型执行器。
- `src/client/processors/page.ts`：同一管理页面的 `#runs` 只呈现任务反馈，`#settings` 只呈现配置/能力信息。配置视图不读取任务或自动执行，任务视图阻止配置写入；切换中止旧请求。无 hash 的独立页面保留原完整功能。
- `package.json`：按真实槽提供方声明客户端加载依赖，未新增 npm 依赖。
- `src/routes/review-processors.ts`：真实浏览器暴露 API prefix 尾斜杠错误；宿主按 `p` / `p/子路径` 匹配，注册值修为无尾斜杠，避免请求落到旧复盘 handler。
- `test/client/keyword-management-section.test.ts`、`test/routes-review/{review-loop-panel,workflow-page,review-processors}.test.ts`：真实 keyed SlotRegistry 回归、输入与视图隔离、构建与宿主路由边界契约。

配置页入口为 设置 → 交易工作流。可操作的工作流开关与配置重载沿已有鉴权/CAS API；provider/model/cwd、全局自动执行与目录仍通过宿主“打开配置文件”入口配置。宿主配置表单仅支持 volatile 字段，本插件没有该接口，未伪装成能保存的表单。

## 验证与安装

旧 keyed main 无注册回归先失败后通过；新增视图隔离回归先失败后通过；API 前缀契约先失败后通过。只读复核补出跨视图旧写请求收尾解除新操作锁的问题，真实 HTTP 回归先失败后通过；成功、错误呈现及解锁均检查视图 epoch，停止时作废请求并释放本页锁。最终类型检查、构建、合规自测和 diff 检查通过，仓库无 lint 脚本。全量 106 文件、1012 测试通过，零跳过，真实安装离线 Jobs/SlotRegistry 探针启用，单条测试 I/O 预算15秒。日志位于开发规划目录 `workers/navigation-settings-final-tests.log`。

已安装到 CLI web profile：`dsh-trader-kit-0.1.0-navigation-settings-20261012-r3.tgz`。client.js、工作流页面及 API 产物 SHA-256 与当前构建一致；pnpm会处理 package.json，客户端manifest以结构比较确认一致。保留已有工作区修改，无提交、模型激活或真实 vault 写入。打开/刷新设置页只读不会激活模型；显式保存开关或重载配置沿既有运行时唤醒机制，不能将其表述为所有设置操作都不会激活模型。

实际浏览器已验左侧按钮→右侧页面，以及设置弹框新增“交易工作流”按钮。主页面证据 `workers/navigation-main.png`。

用户随后明确授权重启当前 DSH web 宿主。核验唯一 127.0.0.1:3080 监听者 PID10056 与 Node/CLI/参数后，仅停止该进程，以原 `web --no-open --port 3080` 命令隐藏启动 PID1088；日志保存在开发规划目录。刷新浏览器后实际 `#settings` 仅展示配置/能力/预算，`#runs` 展示运行筛选、详情、日志、结果及显式操作；“未知 API 路径”消失，注册表读取到“预期整理 @预期”，任务列表正常显示“没有匹配的运行记录”，自动执行关闭、今日Agent激活0/20。本轮未点击保存开关、重载、重扫、取消或重跑，未写真实vault。控制台本轮插件error查询为空。

在线证据为 `workers/navigation-settings-live.png`、`workers/navigation-runs-live.png`。页面与只读API验收已完成；真实模型调用、带卡片的执行结果/取消/重跑仍未验，不能据此声明整个模型工作流生产验收完成。
