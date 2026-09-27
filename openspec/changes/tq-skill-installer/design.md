## Context

TQ-Local 的 skill 来源已定案为 **TDX 官方 zip 分发通道**，并已有实测事实：源 `https://www.tdx.com.cn/products/autoup/skills/tdx-tq-local.zip` 返回 HTTP 200 / `application/zip` / `Last-Modified: 2026-09-20`，包内为单文件 `SKILL.md`（v1.2.0、215 KB），新于 vault 副本（v1.0.12、106 KB）；**vault `.claude/skills` 副本弃用**（模块文档 D5 —— 仓外文档，未能核验）。

跨 change 的事实源是 `docs/design/iteration-1-contracts.md`（下称 `contracts §n`）：凡本文与 spec 出现「复用 / 依赖 / 口径见」的表述，一律按该文件的具名条目执行（`contracts §0`）。

> **事实核验纪律（`contracts §8`）**：本文件分「已核验 / 已实测」与「待验证」两节；引用宿主源码一律用**符号名**（`<文件>:<符号>`），行号只作旁证且可能失效。宿主源码在本会话**不可达**（`E:\work\code\open\deepseek-harness\packages`、`...\app.asar\dsh` 两条路径都无法访问），故下表核验状态取自 **Round 1 评审的独立核验**，行号未在本会话复核——MUST NOT 当作本会话新核验的结论。

### 已核验 / 已实测的事实

| # | 事实 | 证据（符号名 + 旁证行号） | 核验状态 |
| --- | --- | --- | --- |
| F1 | skill 根与 rank：100 `<projectRoot>/.dsh/skills` → 200 `<projectRoot>/.agents/skills` → 300 `Config.customSkillDirs` → 400 `<dshHome>/skills` → 500 `<agentsHome>/skills` → 600 bundled。**同名前 rank 优先**；胜出顺序为 `rank → providerOrder → localOrder` | `skill-filesystem`：rank 常量（旁证 36-40）、roots 推入（旁证 245-265）；`skill`：`BUNDLED_SKILL_RANK`（旁证 28）、胜出排序（旁证 807-811） | 已核验（Round 1）；行号本会话未复核 |
| F2 | 项目根判定 `findProjectRoot`：从 cwd 向上找最近含 `.git` 的祖先目录，找不到则 `return cwd`。**真实位置约 945-955**；原 design 引的 964-970 实为 `pathExistsInFileSystem`（`.git` 存在性探测） | `skill-filesystem`：`findProjectRoot`、`pathExistsInFileSystem` | 已核验（Round 1）；行号本会话未复核 |
| F3 | **项目根只在 `cwd !== undefined` 时才被推入**：`if (this.includeDefaultRoots && cwd !== undefined)` → `join(projectRoot, '.dsh/skills')`（rank 100）。`SkillViewOptions.cwd` / `scope` 均为可选，而宿主真实消费者一律显式传 `{ cwd: exec.agent?.session.header.cwd, signal, scope: exec.agent }` | `skill-filesystem`：includeDefaultRoots 分支（旁证 245-253）；`skill`：`SkillViewOptions`（旁证 103-119）；`tool-skill`：工具实现的两处调用（旁证 133、222） | 已核验（Round 1）；行号本会话未复核 |
| F4 | 发现逻辑 = 「一层目录 + 其下有 `SKILL.md`」，**无 dot 前缀过滤**；唯一跳过是 `root.skipSystem && entry.name === '.system'`；同一 provider 内 `localOrder` 按目录名 `localeCompare` 升序 | `skill-filesystem`：目录枚举与 `join(entry.path, 'SKILL.md')`（旁证 723-733）、排序与 `.system` 跳过（旁证 726-727） | 已核验（Round 1）；行号本会话未复核 |
| F5 | `SKILL.md` frontmatter 只强制 `name`（`isSkillName`：`/^[a-z0-9]+(?:-[a-z0-9]+)*$/`）与 `description`；**`version` 既非必需也不被解析**，未知键静默忽略 | `skill-filesystem`：frontmatter 解析（旁证 814-840）、`optionalMetadata` 只取 `metadata` 键（旁证 1039-1046） | 已核验（Round 1）；行号本会话未复核 |
| F6 | `ctx.skills.list()/get()` 为只读视图，可用来核对「是否已被发现」 | `skill`：`list` / `get`（旁证 470-500） | 已核验（Round 1）；行号本会话未复核 |
| F7 | 工具注册形态 `ctx.tools.register(defineTool({...}))`（`defineTool` 来自 `@deepseek-ai/dsh-tools`） | `core/tools`：`defineTool`（旁证 554）；本仓可比先例 `DSH-better-sidebar:src/tools.ts` | 已核验（Round 1）；**可比先例版本等价性未核验** |
| F8 | 官方源实测：HTTP 200 / `content-type: application/zip` / `Last-Modified: 2026-09-20`；包内 `SKILL.md` 为 v1.2.0、215 KB | 本 change 立稿时的实测记录（proposal §Why） | 已实测（2026-09-27 首次核验）；**本会话无网络，未复现** |
| F9 | 官方包**无公开哈希/签名**，也没有固定版本归档地址 | 立稿时对源站的观察 | 已实测（同 F8）；仅「未发现」，不排除存在未找到的校验手段 |

### 待验证（任务 + 降级策略）

> 未核验项 MUST NOT 被当作实现依据；每项都落为 `tasks.md` 的 spike / 待办任务并写明降级。

| 待验证事实 | 为何未核验 | 验证任务 | 若证伪 / 未核验的降级 |
| --- | --- | --- | --- |
| 官方包真实布局（`SKILL.md` 在包根还是在 `tdx-tq-local/` 子目录下）、是否支持 `ETag` / 304、是否 30x 跳转、`Last-Modified` 头真实形态（是否合法 HTTP-date） | 本会话无网络；立稿记录只有「单文件」这一条 | tasks 1.2 / 1.3：真实请求一次并把响应头与包清单落 `test/fixtures/` | 布局不定 → 校验按「包内 `SKILL.md` 条目唯一或取路径最短者」并记录其相对路径；不支持条件请求 → 每次取，但按 `version + SHA-256` 判等**零替换**（D-5）；跳转 → `redirect: 'manual'` 下显式报错，不静默跟随 |
| `fs.mkdtemp` 与目录改名在同卷 OneDrive / 杀软占用下的语义 | 无值守环境实测 | tasks 1.5 spike（在目标根真实跑一次 stage→rename→rm） | 改名/删除瞬时失败 → 重试 + 回滚到旧版（D-3 不变量）；清理仍失败 → 显式 warning + `residue[]`，**不报成功** |
| `dsh.plugin.json#contributes.tools/skills` 是否被 bundle / 市场渠道消费 | 宿主源码不可达；无法在 `packages/**` 内 grep `dsh.plugin.json` | tasks 5.3（核验或标注） | 不消费 → 在 README/AGENTS 注明该段属市场渠道约定，避免「skill 靠这里声明」的误解（Issue 20） |
| `Config.skill.*` 与 change 2 `dataRoot` 并入同一 Config 根的宿主合并行为（`schemastery` 单 schema 下两块字段归属） | 宿主 Loader 行为不可达；只有 `Config.listConfigs` 的观察 | tasks 4.1（挂载实测：空 `dataRoot` + `skill` 段共存的加载结果） | 按可比先例 `DSH-better-sidebar:src/config.ts` 的 `export const Config` 形态实现，**版本等价性未核验**；配置读取失败 → 调用期显式报错，不阻塞挂载 |
| M1-Q1（`.dsh/skills` rank 100 裁决）与 M1-Q5（基线 = 配置项 + 手动抬升）的裁决原文 | 需求 / 模块文档（`需求描述-*`、`模块文档 §x`、`M1-Q*`）**不在本仓**，无法核验 | tasks 1.9：把可核验的结论摘录成仓内摘录（`docs/` 由 owner 处置，本 change 只登记回写项） | 引用时一律标注「仓外文档，未能核验」；实现上不依赖其措辞，只依赖 F1（rank 100 已核验） |

## Goals / Non-Goals

**Goals:**

- 一条命令把官方 TQ skill 装到 agent 真正能读到的位置（本地实测验收：DSH 会话 skill 列表可见 `tdx-tq-local` v1.2.0）。
- 更新与降级安全：任何环节失败都不破坏已安装版本；官方源挂了不影响既有能力；**任何降级都必须显式**。
- 松耦合：skill 更新不需要插件发版（插件内不存 skill 内容）。
- 安装器**可被 change 5 复用**：同一套「源 → 目标目录 → 三态判定」实现同时支持「HTTPS zip」与「本地目录源」（`get more info` 之外的部署语义不再各写一份）。

**Non-Goals:**

- 不修改官方 skill 内容（原样安装分发包），不做内容审查 / 裁剪 / 沙箱。
- **安装器不做 skill 内容审查**：官方包正文会由 agent 当作指令执行，这是**已知风险**，由本 Non-Goal 与 Risks 共同承担（不是可以靠校验消除的东西）。
- **解压 MUST NOT 执行包内的任何脚本**：不跑 `postinstall`、不执行包内 `.js/.sh/.ps1/.cmd/.bat`，不把包内文件放进任何可执行搜索路径。
- 不读写 vault `.claude/skills/tdx-tq-local/`（弃用副本，不做迁移也不删除）。
- 不调用任何 TQ 方法（安装器不接触 17709 数据面），不接交易接口。
- 不做 skill 内容的语义校验（例如「TQ 方法名是否存在」）——那不是安装器的职责。
- 不做 skill 内容的人工复核门禁（无官方哈希/签名的前提下，提供的是**可追溯 + 变更告警**，不是审批流）。

## Decisions

### D-1 安装根解析：纯函数 + 记录优先（受限反推）+ 默认对齐宿主 rank 100

**根解析是纯函数、`cwd` 必填**：`resolveProjectRoot(cwd: string): string`（`src/skill/root.ts`）——从 `cwd` 向上找最近含 `.git` 的祖先目录，找不到则返回 `cwd`（与 F2 同规则）；**MUST NOT 使用 `process.cwd()`**（后台启动检查 / 多会话下 `process.cwd()` 会把人装到宿主进程目录或另一个含 `.git` 的仓库，这是「装了但读不到」的头号成因）。根的来源必须显式，且**记录优先**（N1）：

**① 首次安装即持久化**：`resolvedCwd` 与 `projectRoot` 在**首次安装时写入 `meta.json`**（`meta.json.resolvedCwd` / `meta.json.projectRoot`，与 `installDir` 同批写入）。此后 service / `autoCheck` / 工具的复算**一律优先取记录值**（`cwdSource: 'recorded'`），不再反推——反推只是「首装之前」与「记录缺失时」的降级路径。

**② `installDir` 反推的受限规则**：反推**只在**满足以下**全部**条件时使用：

- `installDir` 为**绝对路径**（相对 `installDir` 在无 `cwd` 时没有解析基 → 见 ③）；
- 且满足其一：其**祖先**（`dirname` 逐级向上，至少到 `dirname(dirname(installDir))`）与**记录值一致**；或该祖先目录**含 `.git`**。

否则**拒绝执行并提示**（与工具出口同处置：返回显式错误，含实际 `installDir`、尝试推导的祖先与处置建议），MUST NOT 把推导值写进 `resolvedCwd` / `projectRoot`。反推**不得**假定 `installDir` 形如 `<projectRoot>/<a>/<b>`——`<dshHome>/skills`、`<projectRoot>/skills` 等合法配置下「取两级 dirname」会算出错误的根（N1）。

**③ 相对 `installDir` 且无 `cwd`** → **显式拒绝**（理由 = 无解析基；错误含配置项名与建议动作），MUST NOT 猜测、MUST NOT 回退 `process.cwd()`。

| 出口 | `cwd` 来源（优先级从上到下） | 缺来源时 |
| --- | --- | --- |
| 工具 `tq_skill_manage` | ① `exec.agent?.session.header.cwd`（与 F3 的宿主消费者同源）② `meta.json` 记录值 | 无 session cwd 且无记录值 → **拒绝执行并提示**（不猜） |
| service `skill.status({ cwd? })` | ① 显式入参 ② `meta.json` 记录值 ③ 受限反推（见 ②） | 既无 `cwd`、又无记录值、且反推条件不满足 → **拒绝执行并提示**（不猜） |
| 启动检查（`autoCheck`） | ① `meta.json` 记录值 ② 受限反推（见 ②） | 无可用来源 → **跳过本次检查并记 warning**，不阻塞挂载；相对 `installDir` 且无记录值 → 直接跳过（不做反推） |

解析结果记入状态：`resolvedCwd`、`projectRoot`、`cwdSource: 'session' \| 'explicit' \| 'recorded' \| 'install-dir-derived'`。

**根解析与落点配置是两件事**：`projectRoot` / `resolvedCwd` 按上表确定（**记录优先**）；`targetRoot`（落点根）取 `Config.skill.installDir`，未配置时按 `resolveProjectRoot(cwd)` 计算 `<projectRoot>/.dsh/skills`。三选一取舍（评审 Issue 14 要求论证）：

| 候选根 | rank | 代价 | 推荐场景 |
| --- | --- | --- | --- |
| `<projectRoot>/.dsh/skills`（**默认**） | 100 | 每个工作空间各装一次（同机 N 份）；强依赖 cwd 推断；写进用户的 git 工作树；可能落在 OneDrive / 杀软目录 | 单工作空间、要求**稳定压过**项目内 rank 200 旧副本（M1-Q1 裁决，仓外文档未能核验） |
| `<dshHome>/skills` | 400 | 与 cwd 无关、天然跨工作空间；代价是会被项目根同名副本遮蔽 | 多工作空间、可接受被项目副本压过 |
| `Config.skill.extraSkillRoots`（显式登记的自定义根） | 300（宿主意指） | 落点自定，但仍会被 rank 100/200 遮蔽；需人工与宿主 `customSkillDirs` 保持同步（宿主配置本 change 不可读） | 想明确落点且愿意配置 |

理由：M1-Q1 裁决即 `.dsh/skills`，且该目录是 rank 100，能压过 rank 200/400 的旧副本；若用户希望跨工具通用，可配置为 `.agents/skills`（rank 200，写入配置示例）。**「压过旧副本」不再是隐性特性**：谁被压过必须由 D-6 的遮蔽检测显式报出（Issue 15）。**风险**：若会话工作空间与项目根不一致，可能装到 agent 读不到的位置——用 D-6 的可发现性核对兜底（读到即正确，读不到给显式警告）。

### D-2 zip 解压库选型：fflate（备选 yauzl）+ 解压加固层

选 `fflate`：纯 JS、无原生依赖、体积小、能同步解出单文件包。备选：`yauzl`（流式、校验更严格）、`adm-zip`（体积大、维护一般）；`PowerShell Expand-Archive` 否决（依赖 shell 且 Windows-only，插件不应把解压交给外部命令）。**先做一次选型验证**：用官方包构造「截断 zip」输入，确认所选库能给出完整性失败信号；若 fflate 不够严格则换 yauzl（任务 1.3）。结构校验（必需条目 + frontmatter）作为主判据，不依赖库自身的 CRC 行为。

**加固层与库选型解耦**：`src/skill/zip-guard.ts` 在「解压前（读 central directory 条目表）」与「写出前（逐条目）」两道做校验，库只负责解字节：

| 校验项 | 规则 | 失败处置 |
| --- | --- | --- |
| 绝对路径 / 盘符 / UNC | 条目名 MUST NOT 以 `/`、`\`、`\\`、`X:`（盘符）开头 | 中止 + 清理 + 显式错误（含条目名） |
| `..` 段 | `path.resolve(stageRoot, entryName)` 规范化后 MUST 仍在 `stageRoot` 内（前缀比对，沿用 `data-foundation/design.md:40` 的越界防护先例，提取共用 helper `assertInside`） | 中止 + 清理 + 显式错误 |
| 反斜杠伪装 | 条目名中的 `\` 统一归一为 `/` 后再做上述判定（Windows 下 `..\` 与 `/` 等价） | 同上 |
| 符号链接 / reparse | 拒绝任何 symlink / reparse 条目 | 中止 + 清理 + 显式错误 |
| Windows 保留名 / 尾随空格或点 | `CON|PRN|AUX|NUL|COM1-9|LPT1-9`（含带扩展名形态）与尾随 `.` / 空格 | 中止 + 清理 + 显式错误 |
| 规模上限 | 条目数 ≤ **200**、单文件 ≤ **5 MB**、解压总量 ≤ **50 MB**（均可配置覆盖，`Config.skill.limits`） | 中止 + 清理 + 显式错误（报实际值 / 上限） |
| 完整性 | 库报 CRC/截断错误 → 视为校验失败 | 中止 + 清理 + 显式错误 |

上限判定 MUST 在**写出前**依据 central directory 声明的 `uncompressedSize` 做一次预检，并在写出过程中累计复核（防声明值说谎）。

### D-3 原子替换流程（暂存区基准点 = `dirname(targetRoot)`，且**不在任何 skills 扫描根内**）

**落点由两个具名参数决定**（N2：`tdx-tq-local` 与 `installDir` 只是 https 源的默认实例，MUST NOT 写进共用流程）：`targetRoot`（落点根目录）+ `name`（skill 目录名），落点 = `<targetRoot>/<name>/`。

```ts
// https zip 源默认实例 = 当前行为
type InstallTarget = { targetRoot: string; name: string }
// https 源：targetRoot = Config.skill.installDir（未配置 → <projectRoot>/.dsh/skills）、name = 'tdx-tq-local'
// localDir 源（change 5）：显式给出 targetRoot = <dataRoot>/agent/skills、name = 'review-daily-summary'（D-11）
```

Windows 上目录改名要求目标不存在，因此流程为：

1. 计算暂存区根：`tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')`；
2. **暂存区与登记根的两条独立断言**（N6；两条都 MUST 具备，MUST NOT 互相顶替、MUST NOT 因「相等」而跳过）：
   - **① `assertNotInside(tmpBase, root)` 对 `knownSkillRoots` 的每个 root 生效**（**含本次 `targetRoot` 自身**）：`knownSkillRoots = [targetRoot, <projectRoot>/.dsh/skills, <projectRoot>/.agents/skills, ...Config.skill.extraSkillRoots]`；`tmpBase` 落在任一 root 内或其下 → 显式错误。**「相等」属于「在内」**——`assertNotInside(child, root)` 的语义 = `child === root`（按 `path.resolve` 规范化后比较）**或** `child` 以 `root + path.sep` 为前缀；
   - **② `targetRoot` 与登记根的关系**：`targetRoot` MUST **等于**某个登记 root（默认 = `<projectRoot>/.dsh/skills`；本地目录源 = 显式登记的 `<dataRoot>/agent/skills`），且 MUST NOT 是**其它更前 rank root 的后代**。违反 → 显式错误 `TMP_AREA_IN_SCAN_ROOT`（含冲突路径与配置项名）。**「`targetRoot` 等于自身登记项」是合法态、MUST NOT 报错**（反向控制用例见 tasks 1.5①、4.1②）；
3. 创建唯一运行目录：`runDir = await fs.mkdtemp(path.join(tmpBase, 'run-'))`（**不是**毫秒时间戳，消除 `<ts>` 碰撞；见 D-10）；
4. 下载到 `runDir/<archive 名>`（https 源），或把本地源目录复制到 `runDir/src/`（localDir 源）；
5. 解压/暂存到 `runDir/stage/<name>/`（两级，且整体在扫描根之外）；
6. 校验（D-2 加固 + 结构校验 + D-4 版本解析 + D-5 降级闸门；`minVersion` 基线仅对 https 源生效，见 D-4）；
7. 若 `<targetRoot>/<name>/` 存在：改名 → `runDir/backup/<name>/`（同卷，`dirname(targetRoot)` 与 `targetRoot` 同卷）；
8. 改名 `runDir/stage/<name>` → `<targetRoot>/<name>`；
9. 删除 `runDir`（含 `backup`、`stage`、下载包）；**删除后 MUST 重新 `stat` 断言零残留**。

任一步失败：恢复 backup（若已备份）→ 清理 `runDir` → 返回显式错误。**不变量**：任何时刻要么旧版可用、要么新版可用，不存在半装状态（spec 场景「安装中途失败」）；**且暂存/备份目录不会被宿主当作 skill 发现**（F4：宿主只扫「根的一层子目录 + 其下 `SKILL.md`」，本布局的暂存区根本不在根内）。

**零残留是成功的前提**（消除「装好但 agent 读旧版、状态说 OK」的假绿）：

- `ok === true` **仅当** `residue.length === 0`：`residue` 由第 9 步的 `stat` 断言产出（列出 `runDir` 及其下任何仍存在的路径）；
- 删除失败 → 返回 `outcome: 'installed-with-residue'` + `ok: false` + 显式 warning（含残留路径）+ status 暴露 `residue[]`；
- 残留清理**可重试**：下一次 `install` / `update` / 启动检查时先尝试清理 `tmpBase` 下的历史残留目录，并在状态里保持 `residue[]` 直到清空；
- 因暂存区不在扫描根内，「残留」只影响磁盘卫生，**不影响 agent 实际读到的版本**——这正是布局修正要买到的性质。

理由：`<projectRoot>/.dsh/skills` 可能位于 OneDrive 同步目录或被杀软扫描（本机 vault 即在 OneDrive 下），改名/删除可能瞬时失败——因此每一步都可重试、可回滚，且失败必须可见。

### D-4 版本解析与基线（`minVersion` 仅对 https 源生效）

从 `SKILL.md` frontmatter 的 `version` 值中正则提取 `(\d+)\.(\d+)\.(\d+)`（官方格式 `1.2.0（2026-09-20）` 可解析）；基线为 `Config.skill.minVersion`，默认 `1.2.0`。M1-Q5 的处理即「配置项 + 手动抬升」，不引入自动版本策略（自动抬基线会让「TQ 更新但我没准备」变成静默行为）。**`version` 只是相对基线的辅助判断**，防篡改主判据是内容哈希（D-9）：宿主不解析 `version`（F5）意味着「版本号不动、正文被换」在只用版本判断时永远静默。

**基线只对 `https zip` 源（`tdx-tq-local`）生效**（N2）：`minVersion` 默认值是 TQ 专属，对本地目录源部署的自产 skill（change 5 的 `review-daily-summary`）**MUST NOT** 产生 `version-below-baseline` 假警告——localDir 源只做「版本可解析」与内容哈希比对，不套用 `minVersion`；`baseline` 字段在该源下为 `null`。

### D-5 更新判定、零体下载与降级闸门

**零体下载的精确定义**：判断「源无变化」必须先发一个请求，因此 spec 的「零下载」一律指 **零体下载**，只有两种实现路径：

1. 条件请求命中 **304**（发 `If-None-Match: <etag>`，无 etag 时发 `If-Modified-Since: <lastModified 原始响应头字符串>`）；或
2. **HEAD 比对**响应头标识与本地记录一致。

`meta.json` **原样存储响应头字符串**（`etag`、`lastModified` 不做日期重格式化——立稿记录的 `2026-09-20` 不是合法 HTTP-date，重格式化会让条件请求永久失配）；304 判定依据 = 响应状态码，MUST NOT 用「时间戳相等」之类自造判据。

**双标识皆缺 / 源忽略条件请求的降级**：每次都取（接受一次体下载），下载后按 **`version` + `SKILL.md` SHA-256** 与本地记录判等 → 相等则 `outcome: 'up-to-date'`（**零替换**：不动目标目录、不记新 installedAt），并记录「源不支持条件请求」warning。

**降级闸门（MUST NOT 静默降级）**：解析 stage 内 `SKILL.md` 得到 `remoteVersion`，与 `installedVersion` 比较：

| 情形 | 动作 |
| --- | --- |
| `remoteVersion > installedVersion` | 正常覆盖安装（升级），记录新旧版本 |
| `remoteVersion === installedVersion` 且源标识（etag/lastModified/内容哈希）变化 | **覆盖安装**（源可能重发同版本正文），并在状态记录**新旧源标识**（`source.id` / `previousSourceId`）与 `contentHash` 变化 |
| `remoteVersion < installedVersion` | **拒绝替换**：保留现版，`outcome: 'downgrade-blocked'`，status 标 `downgrade-blocked`（含两版本号与源地址），**显式报错**；仅当调用方显式传 `force: true`（工具入参；service 同名入参）才执行 |
| `remoteVersion` 不可解析 | 按校验失败中止（不猜版本号） |

**源不可达不是错误**：状态置 `source-unreachable`（含原因），已安装版本继续可用，不删除、不降级本地版本。`lastCheckedAt` 除作记录外，另参与 D-12 的**最短检查间隔**节流；业务日期规则属数据面，与本 change 无关。

### D-6 与宿主的耦合面：只写文件系统，只读核对可发现性（`cwd` 必传）

安装器**不注册 skill 到 skills 服务**（写入 `ctx.skills.register` 会造成「文件系统 + 运行时」双份真相，且与宿主的 `skill-filesystem` 扫描重叠，F4/F6）。它只做两件事：往 skill 根写文件；用 `ctx.get('skills')`（可选注入）只读核对。核对按宿主真实签名进行，并且**以 `name` + `targetRoot` 参数化**（N2：`tdx-tq-local` 只是 https 源的默认实例）：

```ts
checkDiscovery({ skills?, projectRoot, targetRoot, name })
// 形式示意；scope 用宿主消费者同款用法
const view = await skills.list({ cwd: projectRoot, signal, scope });
const hit = view.find(s => s.name === name);
```

- **必须传 `cwd`**：F3 已核验——不传 `cwd` 时宿主**不扫 rank 100 项目根**，此时「未发现」是核对的假象（会给出反向的假警告）。因此 `cwd` 必传，值来自 D-1 的根解析，并在状态记录 `discovery.cwdUsed`；
- **实例化路径核对**：断言 `hit.path === path.join(targetRoot, name, 'SKILL.md')`（并对 100/200 同名副本的 `source` 做区分）；
- **「未发现」拆成两类显式警告**（不同原因、不同处置建议）：
  - `not-discovered`：没扫到（`cwd`/根不一致，或该 root 无此目录）→ 提示「检查 `targetRoot` 与会话工作空间，`resolvedCwd=…`、`cwdSource=…`」；
  - `shadowed`：**扫到了同名但不是本落点**（被 rank 100/200 更前的同名副本遮蔽）→ 警告含**遮蔽者路径、rank、版本**（如 `已遮蔽 <路径>（rank 100，版本 1.0.12）`），来源为 D-6 的候选根扫描（`<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`extraSkillRoots`，以及 `list({cwd})` 返回的赢家）。
- **宿主服务不可用时退化为文件系统检查**：`discovery.mode = 'filesystem-only'`，只断言 `<targetRoot>/<name>/SKILL.md` 存在 + 列出可枚举候选根的同名目录；MUST NOT 硬依赖宿主内部服务，也 MUST NOT 把「服务不可用」写成「未发现」。
- **change 5 的落点是 `<dataRoot>/agent/skills`（rank 300 意图，`contracts §10` 白名单区）**：核对同样走本函数，`targetRoot = <dataRoot>/agent/skills`、`name = 'review-daily-summary'`；`dataRoot/agent/skills` 是否真的进了宿主 `customSkillDirs` 由 change 5 文档化，不在本 change 的写入范围。change 5 `tasks.md` 1.4 现写作 `checkDiscovery({ skills?, projectRoot, installDir })`——**该形参名应改为 `targetRoot` 并补 `name`**，已登记回写项 R8。

### D-7 出口：工具 `tq_skill_manage` + service `traderKit.skill.*`（同一实现；`health.status()` 归 change 2）

`tq_skill_manage(action: 'install' | 'update' | 'status' | 'deploy' | 'uninstall')` 给 agent（描述写明「从 TDX 官方源安装/更新 TQ skill，源不可达时保留现版；本地目录源部署供 change 5 复用」）。工具与 service **同一实现**（沿 T-1 的双出口精神）：

- 本 change **只实现并注册** `traderKit.skill.status({ cwd? })`（以及 `traderKit.skill.deployLocalDir({ sourcePath, targetRoot, name })`），由 `src/skill/status.ts` 的 `buildSkillStatus()` 单点产出，**其返回体即 change 2 `health.status()` 两段视图的 `skill` 段**（`contracts §11`：`traderKit.data.*` / `traderKit.health.status()` 唯一 owner = change 2）；
- **本 change MUST NOT 产出、注册或实现 `api.health.status()`**（N3：该出口由 change 2 组装 `{ data, skill }`，本 change 仅提供 `skill` 段数据源；二次产出会造成同一 `src/service.ts` 同一函数的双重拥有）。`src/service.ts` 的装配面归 change 2（`contracts §11`），本 change 只**追加** `api.skill.*` 注册，MUST NOT 重建 `src/service.ts` 或重置 `provide('traderKit')`；
- 字段一致性由用例断言：`buildSkillStatus()` 的输出字段与 change 2 spec 声明的 `skill` 段逐项相等（同一实现的证明），见 tasks 4.3。

### D-8 启动检查异步、不阻塞；`autoCheck` **只检查不安装**

`Config.skill.autoCheck`（默认开启）在挂载后异步执行一次检查；结论进状态与日志，失败不阻断挂载、不影响工具调用。**`autoCheck` 的语义是「只检查、不安装」**（写进 spec 要求）：网络结果只用于更新 `sourceReachable` / 可用版本 / 告警，**安装与替换只能由显式工具 / service 调用触发**。理由：否则第三方或 MITM 可在无任何人工确认下替换 agent 将要执行的指令集。与 change 2 的健康检查共用同一「异步探测 + 状态出口」模式，避免两套机制。

### D-9 内容哈希与保号篡改检测

- 下载校验通过后计算 `SKILL.md` 与 zip 的 **SHA-256**，写入 `meta.json`（`contentHash` / `archiveHash`）；
- `status` 每次**重新计算本地** `SKILL.md` 的 SHA-256 与记录比对，不符 → `state: 'content-drifted'`（版本号不变也告警），并给出「指令集已变更，建议人工复核」的提示；
- `version` 与内容哈希同时作为「相对基线」的判据：任一异常都产生显式警告；
- 哈希**不是**供应链签名（官方无公开哈希，F9），它只能检测「相对上一次安装的本地漂移」，MUST NOT 被描述为「验证了官方性」。

### D-10 并发与重入

- **唯一目录**：`fs.mkdtemp` 生成 `runDir`（D-3 第 3 步），MUST NOT 用毫秒时间戳拼名；
- **进程内互斥**：同一插件实例内一把 mutex，`install` / `update` / `ensure`（启动检查触发的清理重试）串行；
- **跨进程互斥**：锁文件 `<tmpBase>/lock.json`（含 `pid` / `startedAt`）；已存在且未过期 → 拒绝并提示「另一处安装进行中（pid=…，开始于 …）」；过期（> 10 分钟）视为陈旧锁并接管，接管动作记 warning；
- **返回体区分**：并发下第二个调用返回 `outcome: 'rejected'`（原因 = 锁占用），MUST NOT 与 `installed` 混同；
- 单测：并行两次 `install` → 断言恰好 1 个有效安装 + `residue` 为空 + 返回体区分为「已完成 / 被拒绝」。

### D-11 两种源：`https zip` 与 `localDir`（具名签名；供 change 5 复用）

源是判别联合，两条通道共用同一「校验 → 原子替换 → 零残留 → 可发现性核对」实现：

```ts
type SkillSource =
  | { kind: 'https-zip'; url: string }              // 默认官方源（D-1/D-5）
  | { kind: 'local-dir'; path: string }             // 本地目录源（change 5 部署自产 skill）

// 本地目录源的具名签名（N2）：落点由 targetRoot + name 决定，MUST NOT 写死 tdx-tq-local/installDir
type DeployLocalDirInput = {
  sourcePath: string                 // 源目录（如仓库 skills/review-daily-summary/）
  targetRoot: string                 // 落点根（change 5 = <dataRoot>/agent/skills；https 源默认 = Config.skill.installDir）
  name: string                       // skill 目录名（change 5 = 'review-daily-summary'；https 源默认 = 'tdx-tq-local'）
}
type LocalDeployResult = {
  outcome: 'in-sync' | 'user-modified' | 'upgradable' | 'installed' | 'updated'
  name: string
  targetPath: string                 // <targetRoot>/<name>/
  contentHash: string
  version?: string | null
  previousVersion?: string | null
  diff?: string                      // user-modified 时 MUST 非空
  residue: string[]
  warnings: string[]
}
```

**本地目录源三态**（`src/skill/local-source.ts`，导出 `syncLocalDir(input: DeployLocalDirInput): Promise<LocalDeployResult>`；service key `traderKit.skill.deployLocalDir({ sourcePath, targetRoot, name })`；工具出口 `tq_skill_manage(action: 'deploy')`，入参同名）：

| 三态 | 判据 | 动作 |
| --- | --- | --- |
| `in-sync`（一致） | 目标目录内容哈希 == 源目录内容哈希 | **零写入**，返回 `in-sync` + `contentHash` |
| `user-modified`（用户改动） | 目标存在、内容不同、**且源版本 ≤ 目标版本**（或源无 `version`） | **不覆盖**，返回 `user-modified` + **输出 diff**（统一 diff 文本，逐文件 `--- a/… +++ b/…`；仅报差异文件名亦可，但 MUST 非空） |
| `upgradable`（可升级） | 目标存在、内容不同、**且源版本 > 目标版本** | 走 D-3 原子替换（stage → 备份 → 改名 → 零残留断言），返回 `upgradable` → `outcome: 'updated'` 并记录新旧版本 |

首次部署（目标不存在）→ 直接安装并返回 `outcome: 'installed'`。三态判定 MUST 落在代码层（可断言不变量），MUST NOT 交给 agent 自律；change 5 的 `daily-summary` 部署语义因此不再单写一份（该 change `design.md` D-4 的「不静默覆盖用户修改」由本实现承担）。本地目录源的源标识 = `path` + 目录内容哈希 + 最高 `mtime`。

**`targetRoot` 的合法落点（N2 + `contracts §10`）**：change 5 的 `targetRoot = <dataRoot>/agent/skills` **是合法落点**（`§10` 白名单写路径，见 D-13 的「可写目标」规则）；D-13 对 `installDir`（https 下载落点）的 vault / `dataRoot` 禁令**只约束 https 源**，MUST NOT 用于否决 localDir 源的白名单落点。`minVersion` 基线同样**只在 https 源生效**（D-4），localDir 源 MUST NOT 产生 `version-below-baseline`。

### D-12 出站通道边界与替代护栏（`contracts §7` 回写项）

change 2 的旧措辞「所有出站请求的唯一闸门」与 `contracts §7` 的旧断言「除 `src/data/http.ts` 外全仓零 `fetch(`」**均已按收窄前措辞回写完毕**（2026-09-27 核读：`contracts §7` 现为两条具名通道 `src/data/http.ts` + `src/skill/download.ts`；change 2 `design.md` D-5 现为「**数据面**出站请求的唯一闸门」，见回写项 R1/R2「已就位」）。本 change 的下载器必须出站，因此**显式裁决边界**（不留给实现者自由发挥）：

- `src/data/guard.ts` 的闸门范围收窄为**数据面出站**（`traderKit.data.*`）；本 change 的下载器是**第二条具名通道** `src/skill/download.ts`，**豁免 guard**，理由：guard 的语义是「按源 / 按业务日的频控预算」（`contracts §9`），与「一天一次的资产更新」不同族；
- 替代护栏（MUST 全部具备）：①仅接受 `https:`；②`redirect: 'manual'`，或校验 `response.url` 的 host 必须等于配置源 host，否则显式报错；③超时：连接 3 s / 总 60 s；④重试 ≤ 2 次，退避 1 s / 4 s；⑤单次下载字节上限 5 MB（超限中止）；⑥启动检查最短间隔 `Config.skill.checkIntervalHours`（默认 **24**），以 `lastCheckedAt` 节流；
- **进程内去重**：同一进程内重复 `status` / 挂载 MUST NOT 产生额外出站（可断言测试）；
- 需回写 `contracts §7` 的 fetch 白名单由 `src/data/http.ts` 扩为 `src/data/http.ts` + `src/skill/download.ts`，并回写 change 2 `design.md` D-5 的措辞为「**数据面**出站请求的唯一闸门」（本 change 只登记回写项，不改他人文件，见「跨 change 回写清单」）。

### D-13 配置面所有权与 `Config.skill` 段

`Config`（`schemastery` 的 `export const Config`）由 **change 2** 首次引入（该 change `design.md` 的 `Config` + `dataRoot`；具名接口）。`contracts §11` 已裁决：**`src/config.ts` 的唯一 owner = change 2**——本 change **只在该文件落地后追加 `skill` 段**（同一文件、同一 schema），**MUST NOT 新建 / 覆盖 `src/config.ts`，MUST NOT 改 `dataRoot` 的默认值与既有字段**（N4）。

**本 change 追加的 `skill` 段**（同一 `Config` 根，不新建第二个导出）：

```ts
Config.skill = {
  sourceUrl: string,            // 默认官方 zip；MUST 匹配 /^https:\/\//
  installDir: string,           // 默认 ''（空 → 按 D-1 计算）；相对路径以 <projectRoot> 为基
  minVersion: string,           // 默认 '1.2.0'；仅对 https 源生效（D-4）
  autoCheck: boolean,           // 默认 true；语义 = 只检查不安装（D-8）
  checkIntervalHours: number,   // 默认 24（D-12）
  extraSkillRoots: string[],    // 默认 []；用于遮蔽检测与暂存区断言
  limits: { maxEntries: 200, maxFileBytes: 5_242_880, maxTotalBytes: 52_428_800 },
}
```

**「可写目标」规则（N2：https 落点与 localDir 落点分治）**：

- **https 源的 `installDir`**：相对路径以 `<projectRoot>` 为基；绝对路径允许，但 MUST 通过校验——不得位于 `dataRoot` / vault 目录 / 插件包自身目录内，**豁免 `contracts §10` 的白名单区**（`dataRoot/agent/skills/`、`dataRoot/agent/DB/temp/dsh-trader-kit/`、`dataRoot/DB/review/`），且 `targetRoot` 关系校验按 D-3 第 2 步（`MUST NOT` 是更前 rank root 的后代）；
- **localDir 源的 `targetRoot`**：**不受**上述 vault / `dataRoot` 禁令约束（N2）——它按「`contracts §10` 白名单区或 `dataRoot` 之外」判定；change 5 的 `<dataRoot>/agent/skills` 因此合法，MUST NOT 被本条否决；
- 两者共同要求：不得落在插件包自身目录内；校验失败在**配置校验期 / 首次使用期显式报错**（含配置项名与冲突路径），MUST NOT 静默落到别处。`sourceUrl` 限定 `https:`，否则配置校验失败。

### D-14 供应链边界显式化

- **无官方哈希 / 签名**（F9）：本 change 的控制手段只有**结构校验（D-2）+ 只信官方域名（默认源固定 `tdx.com.cn`）+ 记录源地址与获取时间**，再加 D-9 的本地漂移检测；
- **两条边界句（MUST 同时写进 spec）**：①**解压不执行包内任何脚本**；②**安装器不做 skill 内容审查**——官方包内容会被 agent 执行，属已知风险，由 Non-Goals 承担；
- 供追溯的字段：`source.url | source.path`、`source.firstFetchedAt`、`source.lastCheckedAt`、`source.id`（etag / lastModified / 目录哈希）、`archiveHash`、`contentHash`；同一组字段写入 `docs/carryover.md` 的**外部资产台账段**（tasks 5.1，`contracts §10` 与 AGENTS 搬运纪律的溯源要求）。

### D-15 状态视图：本 change 只产出 `skill` 段（`health.status()` 归 change 2）

```ts
// change 2 的具名出口（唯一 owner = change 2，组装 { data, skill } 两段）
traderKit.health.status() -> { data: <change 2 数据源段>, skill: SkillStatus }
// 本 change 唯一产出的状态出口（其返回体即上一行的 skill 段；tool action:'status' 同一实现）
traderKit.skill.status({ cwd? }) -> SkillStatus
```

**本 change MUST NOT 产出 / 注册 / 实现 `api.health.status()`**（N3、`contracts §11`）：change 2 spec `data-tool-contract` 已自行写出两段视图与 `{ data, skill }` 组装，本 change 只提供 `buildSkillStatus()` 作为 `skill` 段数据源，并由用例断言字段一致性（tasks 4.3）。

`SkillStatus` 字段（可判定，MUST 全部存在；`null` 表示不可得，不得省略键）：

| 字段 | 含义 |
| --- | --- |
| `state` | `installed \| missing \| source-unreachable \| shadowed \| not-discovered \| version-below-baseline \| content-drifted \| downgrade-blocked \| unparseable \| state-mismatch \| installed-with-residue` |
| `installed` / `version` / `previousVersion` / `availableVersion` / `baseline` | 是否已装 / 已装版本（**取文件系统**）/ 上次版本 / 最近检查到的可用版本 / `minVersion`（**localDir 源为 `null`**，D-4） |
| `targetRoot` / `name` / `targetPath` / `skillPath` | 落点根 / skill 目录名（https 源默认 `tdx-tq-local`）/ `<targetRoot>/<name>/` / `<targetRoot>/<name>/SKILL.md` 绝对路径（N2 参数化；`tdx-tq-local` 与 `installDir` 只是 https 源的默认实例） |
| `installDir` | https 源的默认 `targetRoot` 别名（值 = `targetRoot` 默认实例时；localDir 源下等于传入的 `targetRoot`）—— 保留以兼容既有消费方 |
| `source` | `{ kind, url \| path, id, firstFetchedAt }` |
| `sourceReachable` | `{ state: 'reachable' \| 'unreachable' \| 'unknown', checkedAt, reason }` —— **缓存结论**；`status` MUST NOT 内联发起网络请求 |
| `contentHash` / `expectedHash` / `drift` | 当前文件系统哈希 / 记录哈希 / `unchanged \| drifted`（D-9） |
| `discovery` | `{ checked, mode: 'host-service' \| 'filesystem-only', cwdUsed, cwdSource, found: boolean, winner: { path, source, rank } \| null }` |
| `shadowed` | `[{ path, rank, version, name }]`（D-6 遮蔽检测结果） |
| `residue` | `string[]`（暂存/备份残留路径，D-3） |
| `resolvedCwd` / `projectRoot` / `cwdSource` | D-1 的根解析证据（`cwdSource ∈ {session, explicit, recorded, install-dir-derived}`） |
| `lastCheckedAt` / `installedAt` | 时间戳 |
| `warnings` | `string[]`（每条含原因与建议动作，中文） |

**事实源优先级（评审 Issue 7）**：`status` 一律**以文件系统为准**；`meta.json` 只是**上一次安装的备忘**，不信任其 `version` / `contentHash`：

- 用户手工删除 skill → `state: 'missing'` + warning「安装记录仍在但落点不存在（残留 `meta.json`，可能被手工删除）」；
- 用户手工替换/编辑 `SKILL.md` → 版本与哈希取自**文件系统**，与 `meta.json` 不一致 → `state: 'state-mismatch'` / `content-drifted` + 显式 warning（列出两个来源的值），MUST NOT 用 `meta.json` 的值覆盖现实；
- `meta.json` 缺失但落点存在 → `state: 'installed'` + warning「安装记录缺失，版本取自文件系统，建议重装以恢复哈希基线」。

## Risks / Trade-offs

- **官方包结构变化（单文件 → 多文件/加目录）** → 校验按「必需条目存在」而非「只能有一个文件」实现；解压保留完整包结构（原样安装），并记录 `SKILL.md` 的相对路径。
- **Windows 文件锁 / OneDrive 同步 / 杀软** → 改名与删除带重试；失败回滚到旧版（D-3 不变量）；清理失败 → `residue[]` + **不报成功**（D-3）。
- **`installDir` 与宿主 `projectRoot` 判定不一致 → 装了但读不到** → D-1 的纯函数根解析（禁 `process.cwd()`）+ D-6 的 `cwd` 必传核对 + `not-discovered` / `shadowed` 两类显式警告。
- **无官方哈希/签名，只能结构校验** → 已知限制：无法防「源被替换为同结构恶意包」；缓解是只信官方域名（默认源固定为 `tdx.com.cn`）、`https:` + 手工重定向 host 校验、D-9 本地漂移告警，并在状态中记录源地址与时间，便于追溯。
- **安装器不做 skill 内容审查（已知风险）** → 官方包正文最终由 agent 执行；不引入审批流，只提供「内容哈希 + 变更告警 + 可追溯来源」；版本不变而正文变化也必须告警（D-9 `content-drifted`）。
- **解压落点是宿主扫描根** → 路径穿越 / symlink / 解压炸弹由 D-2 加固层硬拦；暂存与备份整体移出扫描根（D-3）；**解压不执行包内任何脚本**（Non-Goals）。
- **基线版本过高导致开箱警告** → 基线默认取当前实测版本（1.2.0），随 TQ 大版本手动抬升；警告不阻断功能。
- **版本解析失败（官方改 frontmatter 格式）** → 视为「不可解析」并显式警告，不静默通过（宁可吵，不可假）。
- **误把降级当升级** → D-5 降级闸门默认拒绝，需 `force: true` 才动；`force` 的每次使用都写 warning 与状态。
- **并发安装互相删改** → `mkdtemp` 唯一目录 + 进程内 mutex + 跨进程锁文件（D-10），被拒调用显式返回 `rejected`。
- **`.gitignore` 只保本仓** → 安装落点在**宿主当前项目根**（可能是其它仓库），本 change 无法为其加忽略规则；因此「不污染 git 状态」只对本仓成立，对目标仓库改为**安装后提示**（读目标根 `.gitignore` 判断并提示，不引 shell、不代改文件），状态顺带标注忽略状态（评审 Issue 21）。
- **发布产物纪律（`contracts §10`）** → `cordis.patch.yml` 与 `package.json` MUST NOT 含个人机器绝对路径；**现状核查发现 `cordis.patch.yml` 注释里有一条本机绝对路径**（指向 `DSH-better-sidebar` 的 patch 文件），已列为 tasks 5.4 的清理项；`sourceUrl` 默认值是公开官方地址，属"可对外"，保留。

## Migration Plan

- 首次使用即 `tq_skill_manage(action: "install")`；无历史数据迁移。
- vault `.claude/skills/tdx-tq-local/` **不迁移、不删除、不校验**（仅记录为弃用副本）；若用户自行删除，安装器行为不变。
- 回滚：①`tq_skill_manage(action: "uninstall")` 删除落点 + 清理暂存/备份残留 + 按入参决定是否删除 `meta.json`（幂等；spec「卸载与残留清理出口」）；②禁用插件行即停止安装能力。**回滚可用性不再依赖「手工删目录」**。
- 从旧布局（`.tdx-tq-local.backup-*` 顶层同目录残留）升级：首次 `install/update` 时扫描 `targetRoot` 顶层是否存在 `.*backup-*` / `.*stage-*` 形态的历史残留目录（**它们是会被宿主当 skill 发现的**，F4），迁移到 `tmpBase` 或删除，并记 warning。

## Open Questions

1. **M1-Q5 基线的维护节奏**：当前设计为配置项 + 手动抬升。是否需要「官方源版本变化时提示抬升基线」的辅助提示（本 change 已在更新检查中记录源版本，可作为后续增强）。
2. **是否引入官方包哈希白名单**：官方未公开哈希（F9）；如后续发现稳定校验手段（例如固定版本归档），可加一条校验项。**当前不引入**——没有可信来源的哈希只会制造虚假安全感。
3. **多工作空间场景**：若同一台机器有多个工作空间各自需要该 skill，是否要支持一次安装多处（当前为单一落点根 `targetRoot`，https 源默认 `installDir`）。迭代一不处理，记录在案。
4. **skill 下载是否并入 `src/data/guard.ts`**：当前为独立通道 + 替代护栏（D-12）；`contracts §7` 的 fetch 白名单与 change 2 `design.md` D-5 的措辞**均已回写完毕**（回写项 R1/R2「已就位」）。若 owner 仍要求单一闸门，改为在 guard 内登记 `skill` 源（独立预算与间隔），本 change 的替代护栏保持不变。
5. **`extraSkillRoots` 与宿主 `customSkillDirs` 的人工同步**：宿主配置本 change 不可读，遮蔽检测可能漏报未登记的 root；是否需要读取宿主 Config（依赖宿主能力，未核验）。
6. **`.agents/skills`（rank 200）是否应作默认**：当前默认 rank 100（M1-Q1）；若 owner 更看重跨工作空间，改为 rank 400 或 200，代价是被项目内副本遮蔽。
7. **`dsh.plugin.json#contributes` 同步**：是否被 bundle / 市场渠道消费未核验（Issue 20），核验结论决定是否同步 `tools` 名与 skill 声明。
8. **change 5 复用是否已闭合**（N2 的收尾核验点）：本 change 已给出 `deployLocalDir({ sourcePath, targetRoot, name })`，`targetRoot = <dataRoot>/agent/skills` 属 `contracts §10` 白名单区、**可同时满足**「落点在 vault 内」与「不写 vault」两条约束，故无需降级为「人工放置」；唯一待办是 change 5 侧两处形参名同步（回写项 R8）。**替代路径（仅在 owner 后续把 change 5 落点移出 `§10` 白名单时启用）**：回退为该 change 的 D-4 降级路径「人工放置 + README」，并在 proposal 撤回「供 change 5 复用」的表述。

## 跨 change 回写清单（本 change 只登记，不改他人文件）

| # | 目标 | 回写内容 | 状态 |
| --- | --- | --- | --- |
| R1 | `contracts §7` | fetch 白名单由「除 `src/data/http.ts` 外全仓零 `fetch(`」扩为 `src/data/http.ts` + `src/skill/download.ts`（两条具名通道） | **已就位**（2026-09-27 核读：`contracts §7` 已写两条具名通道，`§7` 第 139-141 行） |
| R2 | change 2 `design.md` D-5 | 「所有出站请求的唯一闸门」→「**数据面**出站请求的唯一闸门」 | **已就位**（2026-09-27 核读：`data-foundation/design.md` D-5） |
| R3 | change 2 spec `data-tool-contract` | `health.status()` 返回体为 `{ data, skill }` 两段（`skill` 段 = change 3 的 `skill.status()` 透传） | **已就位**（2026-09-27 核读：`data-tool-contract/spec.md` 两段视图 Requirement + 场景；**该出口归 change 2**，本 change 不再声明 Modified Capability，见 N3） |
| R4 | `docs/roadmap.md` §5 | 阶段 3 的 TQ 通道 = 官方 skill 安装器 | **已就位**（`docs/roadmap.md` 迭代一重排表已含该行，2026-09-27），无需再改 |
| R5 | `docs/carryover.md` | 新增「外部资产台账」段：源 URL + 首次获取时间 + 版本 + SHA-256 + 适用范围 + 已弃用 vault 副本记录 | 本 change tasks 5.1 执行 |
| R6 | 需求 / 模块文档（`模块文档 §x`、M1-Q1/M1-Q5） | 仓外文档不在本仓：落一份仓内摘录（tasks 1.9） | 待 owner 处置 |
| R7 | `contracts §0` | change 3 的依赖行由「无（可独立先行）」改为「change 2（复用其 `src/config.ts` 的 `Config` 并追加 `skill` 段；只提供 `traderKit.skill.status({cwd?})`，MUST NOT 另建 `health.status()`）」 | **已就位**（**Lead 已落地**；2026-09-27 核读 `docs/design/iteration-1-contracts.md §0` 即该措辞） |
| R8 | change 5 `tasks.md` 1.4 / `design.md` D-4 | `checkDiscovery({ skills?, projectRoot, installDir })` 的形参 `installDir` 改名为 `targetRoot`，并补 `name`（change 5 = `'review-daily-summary'`）；`syncLocalDir` / `deployLocalDir` 按 D-11 的 `{ sourcePath, targetRoot, name }` | 待 owner 回写（N2 的跨 change 一致性项；change 5 现有措辞为泛化引用、不阻塞） |

## 评审处置（Round 1 — 2026-09-27）

> 对照 `reviews/tq-skill-installer-review.md` Round 1 的**全部** issue（1–21）逐条处置；「后置」项指向下文 Open Questions 的编号。

| # | Issue（评审标题） | 处置 |
| --- | --- | --- |
| 1 | 可发现性核对（D-6）按宿主现状必然失败——`list()` 不传 `cwd` 就不扫项目根 | **已采纳**：D-1 引入纯函数 `resolveProjectRoot(cwd)`（`cwd` 必填、禁 `process.cwd()`、记 `resolvedCwd`/`cwdSource`）；D-6 改为 `list({ cwd: projectRoot, scope })` + 断言 `path === <installDir>/tdx-tq-local/SKILL.md`；「未发现」拆 `not-discovered` / `shadowed` 两类警告；spec 新增「可发现性核对与同名遮蔽」Requirement 与场景；tasks 2.3/2.5/2.6（真实 registry + 临时项目根）。 |
| 2 | 备份目录会被宿主当同名 skill 扫描，与新版竞争；清理失败被容忍 → 永久假绿 | **已采纳**：D-3 暂存/备份整体移到 `path.join(path.dirname(installDir), '.dsh-trader-kit-tmp', <唯一运行目录>)/`（两级布局 + 扫描根外断言）；成功路径 MUST 零残留（`stat` 断言），删除失败 → warning + `residue[]` + **不报成功**（`outcome: 'installed-with-residue'`、`ok: false`），并在下次 install/update/启动检查重试清理；spec 新增两条场景（成功无残留 / 清理失败不报成功）+ 「残留 MUST NOT 被宿主发现」断言；tasks 1.5/1.7/2.6。 |
| 3 | 更新路径可静默降级——只要源标识变化就安装，未比较远端版本 | **已采纳**：D-5 新增降级闸门（`remote < installed` → 拒绝 + `downgrade-blocked` + 需 `force: true`；版本持平但源标识变化 → 覆盖并记录新旧标识）；spec 新增「更新不得静默降级」Requirement + 3 场景；tasks 3.6 + 3.5 新增单测（目录字节不变 + 显式告警）。 |
| 4 | zip 解压无路径穿越与规模防护，而落点正是宿主扫描根 | **已采纳**：D-2 新增 `src/skill/zip-guard.ts` 加固层（绝对路径/盘符/UNC、`..`、反斜杠归一、symlink/reparse、Windows 保留名与尾随字符、条目数 ≤200 / 单文件 ≤5 MB / 总量 ≤50 MB，写出前预检 + 累计复核），沿用 `data-foundation/design.md:40` 越界防护先例；spec 新增「压缩包解压加固」Requirement + 恶意/截断/超大包场景；tasks 1.4/1.7（恶意契约测试 4 条）。 |
| 5 | 供应链控制只有「结构校验 + 官方域名」，缺哈希、缺重定向策略、缺自动安装闸门 | **部分采纳**：`https:` only + `redirect: 'manual'`（或校验 `response.url` host）+ 超时/重试/单次字节上限 + `checkIntervalHours`（默认 24）+ 内容哈希与 `content-drifted` + `autoCheck` **只检查不安装（写成 spec 要求）**——D-8/D-9/D-12/D-14。**未采纳**「官方包哈希白名单」：官方未公开哈希（F9），无来源哈希只制造虚假安全感 → 后置（Open Questions 第 2 条）；`archiveHash` 仍记录并进台账。 |
| 6 | 「零下载」在语义上不可判定，条件请求细节与双缺场景未定义 | **已采纳**：spec 改述为「零**体**下载（304 或 HEAD 比对一致）」；`meta.json` **原样存响应头字符串**（不重格式化日期）；新增「双标识皆缺 / 源忽略条件请求」降级 = 每次都取但按 `version + SHA-256` 判等**零替换**；D-5 与 tasks 1.2/3.3/3.5 同步。 |
| 7 | spec 与 design 对「备份残留」硬冲突，且残留有真实后果 | **已采纳**：spec 拆两条场景——「更新成功且清理成功 → 无残留」与「替换成功但清理失败 → 目标为新版 + `residue[]` 进状态与返回体 + 承诺下次清理」，并断言残留目录 MUST NOT 被宿主发现；design D-3 的「删除失败也不影响正确性」改为「不报成功」。 |
| 8 | 并发/重入无保护，`<ts>` 命名可碰撞 | **已采纳**：D-10 —— `fs.mkdtemp` 唯一目录、进程内 mutex、跨进程锁文件（含 pid/持锁时间、过期接管）、被拒返回 `rejected`；spec 新增「并发与重入」Requirement；tasks 1.8 + 1.7 并发单测（1 个有效安装 + 无残留 + 返回体区分）。 |
| 9 | 配置面尚不存在，`config.skill.*` 的所有权与依赖未声明；`installDir` 语义缺失 | **已采纳**：proposal 声明 `Config` 由 **change 2** 引入（具名接口）且本 change 追加 `skill` 段；D-13 给出 `Config.skill` 全字段与 `installDir` 语义（相对路径以 `<projectRoot>` 为基；绝对路径需通过「不在 `dataRoot`/vault/插件包目录内、不是已知 skill 根的后代」校验，失败在配置校验期/首次使用期显式报错）；`sourceUrl` 限定 `https:`；tasks 4.1 + 配置校验单测，`blocked_by` 登记于 tasks 头。 |
| 10 | proposal 说「Modified Capabilities: 无」，design/tasks 却要求扩展 change 2 的健康检查出口 | **已采纳**：proposal 改列 `Modified Capabilities: data-tool-contract`；D-7/D-15 给出两段视图（`health.status() = { data, skill }`，依赖 change 2 具名出口）+ `traderKit.skill.status({ cwd? })` 只读 skill 段；状态枚举与字段清单齐备（含 `shadowed` / `content-drifted` / `downgrade-blocked`）；回写项 R3。 |
| 11 | `version` 被称作「唯一护栏」，强度不足以覆盖「保号篡改」与验收口径 | **已采纳**：D-9 以 **内容哈希为主判据**（`contentHash` / `expectedHash` / `content-drifted`），`version` 降为相对基线的辅助判断；D-4 明确修正「唯一护栏」措辞；proposal §验收按可判定范围收窄（删除/替换/正文变化三类，不再宣称覆盖一切篡改）。 |
| 12 | 下载器绕开 change 2 的「所有出站请求唯一闸门」，两个 change 都自称唯一出入口 | **已采纳（方案 B）**：D-12 把 guard 范围收窄为**数据面出站**，本 change 的下载器为第二条具名通道（豁免 guard，理由 + 6 条替代护栏 + `checkIntervalHours` 节流 + 进程内去重）；回写项 R1/R2；「同一进程内重复 status/挂载不产生额外出站」列为 spec 可断言要求与 tasks 3.8。 |
| 13 | `projectRoot` 的行号引用错位，且「否则 cwd」未说清是哪个 cwd | **已采纳**：Context F2 改为符号名 `findProjectRoot` 并标注真实位置约 **945-955**（原引 964-970 实为 `pathExistsInFileSystem`）；D-1 的 `cwd` 三来源表（工具取 `exec.agent.session.header.cwd`、service 显式 `cwd` / 由 `installDir` 反推、无来源拒绝执行）；tasks 2.2 三条单测（无 `.git` 退化、monorepo 子目录向上、`cwd ≠ projectRoot` 时 status 显式提示）。 |
| 14 | 默认落在 rank 100 项目根的三选一取舍未论证，多工作空间被推迟 | **已采纳**：D-1 补三选一对照表（rank 100 / rank 400 / rank 300）与各自代价、推荐场景；「压过旧副本」不再是隐性特性，改由 D-6 遮蔽检测显式报出；多工作空间仍后置（Open Questions 第 3 条）。 |
| 15 | 同名遮蔽（shadowing）后果未进 spec，且 `list()` 只返回赢家、检测手段未定义 | **已采纳**：spec 新增 Requirement「可发现性核对与同名遮蔽」（安装与 status 都扫可枚举候选根；发现同名列于其它根 → 警告「已遮蔽 <路径>（rank X，版本 Y）」）；D-6 定义候选根清单与检测手段；tasks 2.5 fixture 测试。 |
| 16 | `status` 被要求含「源是否可达」，但未区分实时探测与缓存结论 | **已采纳**：D-15 `sourceReachable: { state, checkedAt, reason }` 为**缓存结论**，`status` MUST NOT 内联发起网络请求；实时探测只发生在 `install/update/autoCheck`；spec 与工具描述同步。 |
| 17 | 缺 `uninstall`/清理出口，回滚路径靠「手工删除目录」 | **已采纳**：工具 action 增 `uninstall`（可选 `purge` 语义：是否删 `meta.json`）；删除落点 + 清理 `residue` + 幂等返回；spec 新增「卸载与残留清理出口」Requirement + 场景（`list({cwd})` 不再命中且落点/残留均不存在）；tasks 4.5；Migration Plan 与验收同步。 |
| 18 | 零 mock 测试清单不足以覆盖真正的风险面（安全/发现/失败路径） | **已采纳**：tasks 1.7/2.5/2.6/3.5/3.8 分三层——①纯函数表驱动单测（根解析 / 条目路径校验 / 版本比对 / 更新判定）；②集成层用真实 registry + 真实临时项目根（含 `.git`）断言 `list({cwd})` 命中与 `source`/`path`；③「不写 vault」改为对真实路径做安装前后清单/哈希 diff，未配置 `dataRoot` 时**显式 skip 并输出说明**（不假成功）；零 mock = `node:http` 真实本地服务桩（随机端口），零 sleep。 |
| 19 | 缺溯源台账与 roadmap 重排——这是**下载的第三方产物**，两条纪律都落在本 change 身上 | **部分采纳**：溯源台账**已采纳**——tasks 5.1 写 `docs/carryover.md`「外部资产台账」段（源 URL + 首次获取时间 + 版本 + SHA-256 + 适用范围 + 已弃用 vault 副本记录），同一组字段进 `status`；roadmap 重排**已就位、无需再改**——`docs/roadmap.md` §5「迭代一重排」已含「阶段 3 的 TQ 通道由搬运转为官方 skill 安装器」（本次核读确认），且 `docs/` 不在本 change 写入范围 → 记入回写清单 R4 为「已就位」。 |
| 20 | `contributes.tools/skills` 与实现面脱节，manifest 是否被消费未能核验 | **部分采纳/后置**：本会话宿主源码不可达，无法核验 `dsh.plugin.json#contributes` 是否被 bundle/市场渠道消费（记为待验证表 + Open Questions 第 7 条）；tasks 5.3 落核验任务与两种结论的处置（消费则同步 `tools` 名与 skill 声明；不消费则在 README/AGENTS 注明属市场渠道约定）。 |
| 21 | `.gitignore 增加 .dsh/` 的作用域被高估，且粒度偏粗 | **已采纳（修正粒度 + 收窄承诺）**：tasks 2.4 改为按需粒度 `.dsh/skills/` + `.dsh-trader-kit-tmp/`（保留 owner 回退整目录 `.dsh/` 的选项）；Risks 明确「本仓 .gitignore 只保本仓，目标仓库改为安装后提示 + status 标注忽略状态」；installation 不代改目标仓库文件。 |

## 评审处置（Round 2 — 2026-09-27）

> 对照 `reviews/tq-skill-installer-review.md` Round 2：**N1–N8** 逐条处置，外加该轮 `Previous Round Tracking` 判为**部分解决**的 Round 1 四条（#1 / #9 / #10 / #20）的收口处置。跨 change 口径一律引 `docs/design/iteration-1-contracts.md §n`；「已采纳」标注改动位置，「后置」指向 Open Questions 编号，「驳回」给出理由。Round 1 的处置表保持原样（见上节）。

| # | Issue（Round 2） | 处置 |
| --- | --- | --- |
| N1 | `installDir` 反推 `projectRoot` 在合法配置下失效（相对 `installDir` / `<dshHome>/skills` / 自定义根都算错根），把假 `not-discovered` 换成因带回来 | **已采纳**（改动位置：D-1 三来源表重写 + tasks 2.2）：① `resolvedCwd`/`projectRoot` 在**首次安装时持久化进 `meta.json`**，此后 service/`autoCheck`/工具一律**优先取记录值**（`cwdSource: 'recorded'`）；② `installDir` 反推仅在「绝对路径 **且**（祖先与记录值一致 **或** 该祖先含 `.git`）」时使用，否则**拒绝执行并提示**（与工具出口同处置，MUST NOT 写进状态）；③ 相对 `installDir` 且无 `cwd` → **显式拒绝**（MUST NOT 回退 `process.cwd()`）；④ spec 新增 Requirement「安装根解析与来源优先级」+ 4 场景；tasks 2.2 补三条用例（`installDir=<projectRoot>/skills`、`installDir=<dshHome>/skills`、相对且无 `cwd`）。 |
| N2 | 「两种源」只泛化了源：目标根 / skill 名 / 可发现性 / 状态写死 `tdx-tq-local`，与 change 5 落点、「不写 vault」、`installDir` 禁令三处正面冲突 | **已采纳**（改动位置：D-3 流程参数化、D-11 具名签名、D-6、D-13、D-15、spec 三处 Requirement、tasks 2.3/4.2/4.4/4.5/5.2 与 proposal D6/D7）：① `deployLocalDir({ sourcePath, targetRoot, name })`（`syncLocalDir(input)` 同签名）为具名接口，`targetRoot` 允许 = `dataRoot/agent/skills`（change 5 落点，`contracts §10` 白名单区）；② 可发现性核对 `checkDiscovery({ skills?, projectRoot, targetRoot, name })`、`SkillStatus.skillPath` = `<targetRoot>/<name>/SKILL.md`、D-3 改名路径一律 `<targetRoot>/<name>`，`tdx-tq-local`/`installDir` 降为 https 源默认实例；③ 「不写 vault」场景收窄为 `<vault>/.claude/**` 与已弃用副本区，并**显式豁免 `contracts §10` 白名单区**（`dataRoot/agent/skills/` 等 MUST 排除在 diff 之外）；④ `installDir` 的 vault / `dataRoot` 禁令**只约束 https 下载落点**，localDir 的 `targetRoot` 按「可写目标」规则另判；⑤ `minVersion` 基线**只在 https 源生效**（localDir 源 `baseline: null`，不产生假 `version-below-baseline`）。三处冲突**全部可同时满足**，无需降级为「change 5 人工放置」（收尾核验点与唯一替代路径见 Open Questions 第 8 条）；change 5 两处形参名同步登记为回写项 **R8**。 |
| N3 | `health.status()` 两段视图被 change 2 与 change 3 双重拥有、双重实现 | **已采纳（唯一 owner = change 2）**（改动位置：proposal Modified Capabilities、D-7、D-15、tasks 4.3 与 tasks 头）：change 3 **不再产出 `api.health.status()`**，只实现并注册 `buildSkillStatus()` / `traderKit.skill.status({ cwd? })`，其返回体**即** change 2 两段视图的 `skill` 段（`contracts §11`/`§12.2`）；`src/service.ts` 装配面归 change 2，本 change 只追加 `api.skill.*`；proposal 的 Modified Capabilities 改为「**无**（该出口归 change 2，本 change 只提供 `skill` 段数据源）」；保留「字段一致性」与「`status()` 不出站」两条用例。 |
| N4 | `src/config.ts` 双份产出 + `contracts §0` 依赖表与 tasks 头矛盾 | **已采纳**（改动位置：tasks 4.1、tasks 头、D-13、回写清单 R7）：4.1 改为「**在 change 2 的 `src/config.ts` 中追加 `skill` 段**（MUST NOT 新建/覆盖该文件，MUST NOT 改 `dataRoot` 默认值与既有字段）」+ `blocked_by: change 2`；删除「`Config` 由本 change 产出/首次引入」的全部表述；回写清单新增 **R7**（`contracts §0` change 3 依赖行，**已由 Lead 落地**，标「已就位」）。 |
| N5 | 「无来源 → 拒绝」只在 design/tasks、spec 无场景；`autoCheck` 验收可空过 | **已采纳**（改动位置：spec 状态查询出口、tasks 3.2）：spec 新增场景「无 `cwd` 且无 `installDir` → **显式拒绝**（含来源说明），MUST NOT 猜测」；原「查询状态」场景改为显式 `skill.status({ cwd })`；tasks 3.2 补**正向控制**（可反推时首次挂载**恰好一次**出站、第二次为零）+「无来源 → 跳过 + warning、**零出站**」用例。 |
| N6 | `knownSkillRoots` 含 `installDir` 自身，`assertNotInside` 自比较语义未定义 | **已采纳**（改动位置：D-3 第 2 步、spec 原子安装 Requirement、tasks 1.5①/4.1②）：拆成两条并写进 spec——① `assertNotInside(tmpBase, root)` 对**所有** root（**含 `targetRoot` 自身**）生效，且「相等」明确属于「在内」；② `targetRoot` MUST **等于**某个登记 root（默认 `<projectRoot>/.dsh/skills`）且 MUST NOT 是**其它更前 rank root** 的后代；补「`installDir` 取默认值 → 不报错」的反向控制用例（spec 新增场景「默认落点不触发暂存区错误」）。 |
| N7 | 回写表状态过期（R1/R2/R3 已落地却仍记「待 owner 回写」）；D-12 仍以过期措辞为前提 | **已采纳**（改动位置：回写清单、D-12 引言）：R1/R2/R3 改标「**已就位（2026-09-27 核读）**」并分别指向 `contracts §7`、`data-foundation/design.md` D-5、`data-tool-contract` 两段视图；只保留 R5/R6/R8 为待办；D-12 引文改为「**收窄前措辞已回写**，见 `contracts §7` 两条具名通道」。 |
| N8 | 产物清单漏 `version.ts` / `gitignore-notice.ts`，未列解压库依赖 | **已采纳**（改动位置：proposal Impact）：新增代码补 `version.ts`、`gitignore-notice.ts`；新增依赖写「zip 解压库（`fflate`，备选 `yauzl`；选型门禁见 tasks 1.3）」。 |
| #1（R1 遗留） | 可发现性核对不传 `cwd` 必然失败 | **已采纳**（本轮随 N1 收口）：`cwd` 必传 + 三来源表改为「记录优先 + 受限反推 + 无来源拒绝」，使 Round 1 Critical #1 的三条路径在**语义**上闭合，而不仅是字面上。 |
| #9（R1 遗留） | 配置面所有权与 `installDir` 语义 | **已采纳**（本轮随 N2/N4 收口）：`src/config.ts` 唯一 owner = change 2（追加式）；`installDir` 语义拆为 https 落点禁令（豁免 `§10` 白名单区）与 localDir `targetRoot` 规则两部分。 |
| #10（R1 遗留） | proposal 误报「Modified Capabilities: 无」 | **已采纳**（本轮随 N3 收口）：改为「**无**（该出口归 change 2，本 change 只提供 `skill` 段数据源）」，与 change 2 已落地的两段视图 Requirement 一致，不再有第二个 owner。 |
| #20（R1 遗留） | `contributes.tools/skills` 与实现面脱节、manifest 是否被消费未核验 | **后置**（理由：本会话宿主源码仍不可达，无法核验）：维持 tasks 5.3 的二选一处置 + 待验证表登记，指向 **Open Questions 第 7 条**；原评级 Low，后置可接受。 |
