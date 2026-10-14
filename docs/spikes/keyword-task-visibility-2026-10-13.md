# 等待任务可见性与执行配置（2026-10-13）

用户保存的上证指数卡片已经触发后台登记：来源`DB/review/202610/sh000001_上证指数_20261013.md`，锚点`card-20261013-000001-2023`，登记时间20:23:49（上海），正文与截图一致。记录状态waiting，原因为workflowDisabled，attempts=0、result=null。此前任务被放在默认配置tab之后的“执行历史”，服务状态JSON占据屏幕；用户容易把“登记”和“执行”混为一谈。

## 页面调整

- 设置→交易工作流→关键词工作流默认显示所选关键词的任务记录，包括等待、排队、运行和终态，不只展示已经执行的任务。
- 列表展示工作流、具体等待原因、市场+代码、交易日和上海登记时间；自动执行未开启与此关键词工作流停用分别说明。
- 运行摘要紧凑显示全局开关、等待任务数和今日预算；原始JSON默认折叠，不把agentFactory函数已接线当成模型已验证可用。
- 触发与执行设置区分单工作流“允许此关键词工作流执行”和所有关键词共用的自动执行、模型服务标识、模型名称、Agent工作目录。关闭单工作流仍可登记，执行需要双开关与实际宿主/模型能力。
- 只有显式点击保存才写配置；模型标识沿用DSH模型设置，工作目录是现有绝对目录。切页舍弃未保存草稿，冲突后须刷新。保存重载会取消清理运行中任务，开启可能接纳已登记等待任务。

## 后端契约

GET `/dsh-trader-kit/review/api/basic-settings`增加`executionEditing`能力和CAS版本，独立于原生目录picker。认证POST `/basic-settings/save-execution`接收`{revision,processing:{enabled,provider,model,cwd}}`，只修改四字段。复用实际ConfigEditor owner、锁内revision核验、持久化和重载，保留目录、密钥、预算和未知字段。启用要求数据根已配置、模型字段非空以及真实绝对工作目录；字段非空不表示真实模型调用已成功。失败或旧宿主能力缺失明确报错，不伪造保存成功。

复盘输入页继续只承担数据/事件源，未恢复登录入口或管理GET。后台单execute协议、来源版本保护、去重、取消和预算不变。

## 修改文件

- 页面：`src/client/processors/page.ts`及`test/routes-review/workflow-page.test.ts`。
- 执行编辑：`src/routes/basic-settings.ts`、`src/routes/directory-settings-host.ts`及3个关联测试。
- 装配/静态：`test/routes-review/review-registration.test.ts`、`test/probe/probe-registration.test.ts`、`test/routes-review/review-structure.test.ts`。
- README与既有开发计划、进度、发现。

实际HTTP页面26项测试覆盖默认等待任务、关键词隔离、四字段显式保存、冲突禁写和迟到响应。后端15项测试覆盖JSON/401/403/409/413/能力缺失、真实SDK持久编辑、自重载、执行配置激活失败后原profile字节与旧配置恢复。所有修改均先基线/新增RED再实现，未引入新依赖或假Agent成功。

## 验收边界

当前真实自动执行仍关闭，真实模型服务/model/cwd尚未设置。本轮不会点击保存或激活模型，不写真实卡片或修改业务目录。只读管理验收和用户启用后的实际模型调用分别记录，未将接口接线或填写配置称作真实模型可用。

## 最终门禁与安装

- `pnpm typecheck`、`pnpm build`、静态与`git diff --check`通过；111文件1063测试全部通过，4个worker，真实SDK离线探针均启用、零跳过。新真实ConfigEditor HTTP探针已登记仅固定随机loopback端口和save-execution路径的静态例外，首轮静态漏登记后补齐，不放宽生产出站通道。
- 独立复审无P1/P2阻断。没有独立lint脚本，沿仓库既有静态门禁，无新依赖或提交。
- 包`dsh-trader-kit-0.1.0-keyword-visibility-20261013.tgz`已安装默认web profile，5个关键编译文件hash一致；精确重启3080 DSH web宿主，新PID38556。
- 实际只读HTTP验证：任务API返回上述expectation记录与相同来源，waiting/workflowDisabled、attempts=[]、result=null；executionEditing.available=true，自动执行仍false，模型仍未配置，今日激活0；新版管理页200，默认任务记录脚本与共用执行配置入口存在。
- 输入页免Cookie200，仍没有管理GET/登录控件；匿名POST save-execution401在业务前拒绝。重启和验收前后真实profile及原任务JSON字节hash一致，没有改真实配置、卡片或执行结果。
- 日志：既有workers目录下`keyword-visibility-*-20261013.log`、`keyword-visibility-live-verification-20261013.json`及状态保留hash记录。HTTP验收和实际页面脚本回归不等同于真实浏览器视觉验收；真实模型调用/用户保存开启后执行尚未验收。
