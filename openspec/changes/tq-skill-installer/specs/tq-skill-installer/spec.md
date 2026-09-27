## ADDED Requirements

### Requirement: 官方源配置

插件 SHALL 提供 `skill.sourceUrl` 配置项，默认值为 TDX 官方 zip 源 `https://www.tdx.com.cn/products/autoup/skills/tdx-tq-local.zip`；源地址变更 MUST 可通过配置完成，MUST NOT 要求插件发版。`sourceUrl` 的取值 MUST 匹配 `^https://`（非 `https:` 在配置校验期显式报错）。安装器 SHALL 只信配置的官方域名（默认 `tdx.com.cn`）与官方路径，并 SHALL 在状态与台账中记录**实际使用的源地址、源标识与获取时间**。

#### Scenario: 使用默认官方源

- **WHEN** 未配置 `sourceUrl` 且触发安装
- **THEN** 请求官方默认地址，并在状态中记录实际使用的源地址
- **判据（证据）**：`status().skill.source.url` 等于默认地址；本地 HTTP 服务桩或真实请求日志中出现该 URL

#### Scenario: 配置自定义源

- **WHEN** 配置了另一个 `https:` 的 zip 源地址
- **THEN** 安装走该地址，且状态中记录该地址（不混淆默认源）
- **判据（证据）**：`status().skill.source.url` 等于配置值；桩服务收到该 URL 的请求

#### Scenario: 非 https 源被拒绝

- **WHEN** `skill.sourceUrl` 配置为 `http://…` 或 `file://…`
- **THEN** 配置校验期显式报错（含配置项名与非法值），MUST NOT 发起任何请求

### Requirement: 下载与完整性校验

安装 SHALL 先将 zip 下载到安装目标之外的暂存区，并完成校验：HTTP 状态为成功、`content-type` 指示 zip、zip 可解压、包内必需条目（`SKILL.md`）存在、其 frontmatter `name` 等于本次目标的 `name`（`https-zip` 源默认 `tdx-tq-local`）、`version` 可解析。任一校验失败 SHALL 中止安装、保留旧版本、显式报错（含失败环节与原因），MUST NOT 安装未通过校验的内容。

安装器 MUST NOT 执行包内任何脚本（不跑 `postinstall`，不执行包内 `.js/.sh/.ps1/.cmd/.bat`，不把包内文件加入任何可执行搜索路径）。安装器 MUST NOT 做 skill 内容审查——官方包正文会被 agent 当作指令执行，这属**已知风险**（见 design Non-Goals 与 Risks），不是校验可以消除的项。

#### Scenario: 校验通过

- **WHEN** 下载到合法分发包
- **THEN** 进入原子安装流程，状态记录源标识（ETag / Last-Modified 原样字符串）与解析出的版本
- **判据（证据）**：`status().skill.source` 含源标识；`meta.json` 中 `etag`/`lastModified` 与响应头**逐字符相等**（未重格式化）

#### Scenario: HTTP 失败或非 zip

- **WHEN** 源返回非 2xx 或 `content-type` 非 zip
- **THEN** 中止安装、保留旧版本、返回显式错误（状态码 + URL）
- **判据（证据）**：返回错误体含 `status` 与 `url` 字段；安装目标目录安装前后逐文件哈希不变；`residue` 为空

#### Scenario: 包内容异常

- **WHEN** zip 无法解压（含截断包），或缺少 `SKILL.md`，或 frontmatter `name` 不匹配，或 `version` 不可解析
- **THEN** 中止安装、保留旧版本、返回显式错误（指明具体校验项），暂存区被清理
- **判据（证据）**：错误体含 `failedCheck` 枚举值（`unzip` / `missing-entry` / `name-mismatch` / `version-unparsable`）；`residue` 为空

#### Scenario: 不执行包内脚本

- **WHEN** 分发包内含 `.js` / `.sh` / `.ps1` / `.cmd` 条目
- **THEN** 这些文件只以字节形式落盘，安装器不执行它们、不注册 `postinstall`、不把它们放入可执行搜索路径
- **判据（证据）**：进程树/子进程计数在安装全程为 0（除 HTTP 客户端）；package.json 无新增安装脚本钩子

### Requirement: 压缩包解压加固（路径与规模防护）

安装器 SHALL 在解压前（依据 central directory 条目表）与写出前（逐条目）两处校验，任一项不满足即**中止安装 + 清理暂存区 + 显式报错**（错误含违规条目名与实际值/上限）：

1. 条目名的 `\` MUST 归一为 `/` 后再判定；
2. 条目名 MUST NOT 为绝对路径、盘符路径（`X:`）或 UNC 路径（`\\`）；
3. 条目名 MUST NOT 含 `..` 段；`path.resolve(stageRoot, entryName)` 规范化后 MUST 仍落在 stage 根内（前缀比对，复用 `data-foundation/design.md:40` 的越界防护先例）；
4. MUST NOT 接受任何符号链接 / reparse 条目；
5. MUST NOT 接受 Windows 保留名（`CON|PRN|AUX|NUL|COM1-9|LPT1-9`）或尾随 `.` / 空格的条目名；
6. 规模上限：条目数 ≤ **200**、单文件解压字节 ≤ **5 MB**、解压总量 ≤ **50 MB**（均可经 `Config.skill.limits` 覆盖）；上限判定 MUST 在写出前预检，并在写出过程中累计复核。

#### Scenario: 路径穿越条目

- **WHEN** 包内含 `../escape.md`、`/etc/passwd`、`..\x.md` 或 `C:\x.md` 形态的条目
- **THEN** 中止安装、保留旧版本、显式报错（含条目名与违规类型）、暂存区被清理
- **判据（证据）**：`test/fixtures/malicious-*.zip` 生成的四种包各一条用例；断言 stage 根之外零新增文件（安装前后目标根外哈希 diff 为空）

#### Scenario: 符号链接条目

- **WHEN** 包内某条目声明为 symlink / reparse
- **THEN** 中止安装、保留旧版本、显式报错，MUST NOT 落盘该链接

#### Scenario: 解压规模超限

- **WHEN** 条目数 >200，或单文件 >5 MB，或解压总量 >50 MB
- **THEN** 中止安装、保留旧版本、显式报错（含实际值与上限）、暂存区被清理

### Requirement: 安装根解析与来源优先级（记录优先 + 受限反推）

根解析 SHALL 为纯函数 `resolveProjectRoot(cwd)`（从 `cwd` 向上找最近含 `.git` 的祖先，找不到则返回入参），MUST NOT 使用 `process.cwd()`。根的来源 SHALL 按以下**优先级**确定，取不到时**显式拒绝（含来源说明）**，MUST NOT 猜测：

1. **显式 `cwd`**（工具出口取 `exec.agent?.session.header.cwd`；service 出口取入参 `cwd`）→ `cwdSource: 'session' | 'explicit'`；
2. **`meta.json` 记录值**：`resolvedCwd` 与 `projectRoot` SHALL 在**首次安装时持久化**进 `meta.json`，此后 service / 启动检查 / 工具的复算 SHALL **优先取记录值**（`cwdSource: 'recorded'`）；
3. **`installDir` 反推**（降级路径，仅在 1、2 都不可用时）：SHALL **只**在「`installDir` 为**绝对路径**」**且**满足其一（其祖先（至少到 `dirname(dirname(installDir))`）与记录值一致；或该祖先目录含 `.git`）时使用，`cwdSource: 'install-dir-derived'`；条件不满足 → **拒绝执行并提示**（含实际 `installDir`、尝试推导的祖先与处置建议），MUST NOT 把推导值写进 `resolvedCwd` / `projectRoot`；
4. **相对 `installDir` 且无 `cwd`、无记录值** → **拒绝执行并提示**（理由 = 无解析基），MUST NOT 回退 `process.cwd()`；
5. 显式 `cwd` 与 `meta.json` 记录值**不一致**时 SHALL 以显式 `cwd` 为准（优先级 1 > 2），并把不一致记入 `warnings`（列出两个根与 `cwdSource`），MUST NOT 静默切换落点判定。

`status` SHALL 暴露 `resolvedCwd` / `projectRoot` / `cwdSource` 三项证据。

#### Scenario: 首次安装持久化根

- **WHEN** 首次安装成功（此前 `meta.json` 不存在）
- **THEN** `meta.json` 含 `resolvedCwd` 与 `projectRoot`，且与本次根解析结果逐字符一致
- **判据（证据）**：读 `meta.json` 断言两字段存在且等于 `status().skill.resolvedCwd` / `projectRoot`

#### Scenario: 记录值优先于 installDir 反推

- **WHEN** `meta.json` 已记录 `projectRoot`，而配置的 `installDir` 为绝对路径且其祖先与记录值不一致、也不含 `.git`（如 `<dshHome>/skills`）
- **THEN** `status().projectRoot` 等于**记录值**、`cwdSource === 'recorded'`，MUST NOT 因反推而改变
- **判据（证据）**：`installDir = <dshHome>/skills` 的用例断言 `projectRoot === 记录值`、`cwdSource === 'recorded'`

#### Scenario: 受限反推的正当路径

- **WHEN** 无 `cwd`、无记录值，且 `installDir` 为绝对路径、其祖先与记录值一致或含 `.git`（如 `<projectRoot>/skills`）
- **THEN** 反推得到真实项目根，`cwdSource === 'install-dir-derived'`，并据此执行可发现性核对
- **判据（证据）**：`installDir = <projectRoot>/skills` 的用例断言 `projectRoot === resolveProjectRoot(cwd)` 的真实值

#### Scenario: 反推条件不满足被拒绝

- **WHEN** 无 `cwd`、无记录值，且 `installDir` 为绝对路径但祖先既与记录值不一致、也不含 `.git`（如 `<dshHome>/skills`）
- **THEN** **拒绝执行并提示**（含实际 `installDir`、尝试推导的祖先、处置建议），MUST NOT 发起下载、MUST NOT 写出任何状态字段
- **判据（证据）**：返回显式错误；`resolvedCwd` / `projectRoot` 保持 `null`

#### Scenario: 相对 installDir 且无 cwd 被拒绝

- **WHEN** `skill.installDir` 为相对路径，且调用未提供 `cwd`、`meta.json` 也无记录值
- **THEN** **拒绝执行并提示**（理由 = 相对路径无解析基），MUST NOT 用 `process.cwd()` 兜底
- **判据（证据）**：错误文案含配置项名与「无解析基」；源码断言 `src/skill/**` 无 `process.cwd`

### Requirement: 原子安装到 DSH 可发现的 skill 根

安装落点 SHALL 由两个具名参数决定：`targetRoot`（落点根目录）+ `name`（skill 目录名），落点 = `<targetRoot>/<name>/`。`https-zip` 源的默认实例为 `targetRoot = skill.installDir`（未配置 → `<项目根>/.dsh/skills/`，即宿主 rank 100 扫描目录；M1-Q1 裁决为仓外文档、未能核验）、`name = 'tdx-tq-local'`；本地目录源由调用方显式给出（见「本地目录源部署」）。`tdx-tq-local` 与 `installDir` MUST NOT 被写进共用流程。安装 SHALL 为原子替换（先落暂存目录、校验后改名），任一环节失败 SHALL 保留旧版本并清理中间产物，MUST NOT 留下半安装状态；安装过程 MUST NOT 改动其它 skill 目录。

暂存区与备份区 SHALL 位于 `path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp', <唯一运行目录>)/`，且 SHALL 满足**两条独立断言**（不得互相顶替、不得因「相等」而跳过）：

- ① `assertNotInside(tmpBase, root)` SHALL 对 `knownSkillRoots` 的**每个 root** 成立（**含本次 `targetRoot` 自身**），其中 `knownSkillRoots` = `targetRoot`、`<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`Config.skill.extraSkillRoots`；「相等」在判定上属于「在内」（`assertNotInside(child, root)` 语义 = `child === root`（`path.resolve` 规范化后）或 `child` 以 `root + path.sep` 为前缀），失败即显式错误并拒绝安装；
- ② `targetRoot` MUST **等于**某个登记 root（默认 = `<projectRoot>/.dsh/skills`；本地目录源 = 显式登记的 `<dataRoot>/agent/skills`），且 MUST NOT 是**其它更前 rank root 的后代**；违反即显式错误 `TMP_AREA_IN_SCAN_ROOT`（含冲突路径与配置项名）；
- MUST NOT 在任何扫描根顶层留下含 `SKILL.md` 的目录（否则会与同名 skill 竞争 discovery）。

安装**成功**的定义包含零残留：安装/更新结束后 SHALL 重新 `stat` 断言暂存区、备份区、下载包**零残留**；`ok === true` 仅当 `residue` 为空。删除失败时 SHALL 产生显式 warning、把残留路径写入 `residue[]`，**MUST NOT 报成功**（返回 `outcome: 'installed-with-residue'`、`ok: false`），并在下一次安装/更新/启动检查时重试清理。

#### Scenario: 首次安装

- **WHEN** 目标目录不存在且校验通过
- **THEN** 安装后 `<targetRoot>/<name>/SKILL.md` 存在且内容与分发包一致
- **判据（证据）**：落点文件 SHA-256 == 包内条目 SHA-256；`residue` 为空；`ok === true`

#### Scenario: 更新成功且清理成功

- **WHEN** 目标目录已存在旧版本且新版本校验通过、改名与删除均成功
- **THEN** 更新完成后目标目录为新版本内容，暂存区/备份区/下载包**零残留**
- **判据（证据）**：`residue === []`；`stat` 断言 `<tmpBase>/<runDir>` 不存在；`list({ cwd })` 结果中不含任何备份/暂存目录

#### Scenario: 替换成功但清理失败

- **WHEN** 替换（改名）成功但暂存区目录删除失败（Windows 占用 / 同步盘 / 杀软）
- **THEN** 目标目录为新版本，返回体与状态均含 warning 与 `residue[]`（列出残留路径），`ok === false` 且 `outcome === 'installed-with-residue'`；残留目录 MUST NOT 被宿主发现；下次安装/更新/启动检查重试清理
- **判据（证据）**：注入删除失败的用例断言上述四字段；`list({ cwd })` 结果中**不出现**残留路径（残留位于扫描根之外）

#### Scenario: 暂存区落在扫描根内被拒绝

- **WHEN** `targetRoot` 被配置为某个已知 skill 根**的后代**（导致 `dirname(targetRoot)` 位于该根内），或 `tmpBase` 落在任一 root 内（含与其相等）
- **THEN** 安装前显式报错 `TMP_AREA_IN_SCAN_ROOT`（含冲突路径与配置项名），MUST NOT 开始下载

#### Scenario: 默认落点不触发暂存区错误（反向控制）

- **WHEN** `targetRoot` 取默认值 `<projectRoot>/.dsh/skills`（即等于自身登记项）、`installDir` 未配置
- **THEN** `assertNotInside` 与「`targetRoot` 非更前 rank root 后代」两条断言**均通过**，安装正常进行，MUST NOT 报 `TMP_AREA_IN_SCAN_ROOT`
- **判据（证据）**：默认配置下安装成功；`resolvedCwd`/`projectRoot` 已按根解析 Requirement 得出

#### Scenario: 安装中途失败

- **WHEN** 改名或写入环节失败
- **THEN** 目标目录仍为旧版本（可用），中间产物被清理，返回显式错误
- **判据（证据）**：旧版目录逐文件哈希与安装前一致；`residue` 为空或仅含已告警项

#### Scenario: 同目录其它 skill 不被影响

- **WHEN** `<targetRoot>` 下存在其它 skill 目录
- **THEN** 安装前后这些目录内容零改动

### Requirement: 更新不得静默降级

安装/更新前 SHALL 解析待安装 `SKILL.md` 的 `remoteVersion` 并与已安装 `installedVersion` 比较，按三态处理：

| 情形 | 要求 |
| --- | --- |
| `remoteVersion > installedVersion` | 执行覆盖安装，记录新旧版本 |
| `remoteVersion === installedVersion` 且源标识（ETag/Last-Modified/内容哈希）变化 | 执行覆盖安装，并记录**新旧源标识**（`sourceId` / `previousSourceId`）与内容哈希变化 |
| `remoteVersion < installedVersion` | **默认拒绝替换**：保留现版、状态标 `downgrade-blocked`（含两版本号）、显式报错；仅当调用方显式传 `force: true` 才执行 |

MUST NOT 存在「源标识变化即静默替换」的路径。

#### Scenario: 源返回更低版本

- **WHEN** 源（或回滚的官方源 / 被配错的归档）提供的版本低于已安装版本，且未传 `force`
- **THEN** 拒绝替换：目标目录字节不变，状态为 `downgrade-blocked`，返回显式错误含 `remoteVersion` 与 `installedVersion`
- **判据（证据）**：目标目录安装前后逐文件 SHA-256 一致；错误体含两个版本号

#### Scenario: 显式强制降级

- **WHEN** 调用方显式传 `force: true` 且源版本更低
- **THEN** 执行降级安装，且状态与返回体均保留显式 warning（含两版本号与「强制降级」字样）

#### Scenario: 同版本重发（源标识变化）

- **WHEN** 远端版本与本地相同，但 ETag/Last-Modified 或内容哈希变化
- **THEN** 覆盖安装，状态同时保留新旧源标识与 `contentHash` 变化记录（不静默）

### Requirement: 版本检查与显式警告

插件 SHALL 解析已安装 `SKILL.md` frontmatter 的 `version` 字段（官方格式形如 `1.2.0（2026-09-20）`，取其中的语义化版本号），并与配置基线 `skill.minVersion` 比对；版本缺失、无法解析或低于基线时 SHALL 产生显式警告（日志 + 状态出口可见），MUST NOT 阻断插件挂载或 skill 使用。

**基线只在 `https-zip` 源生效**：`minVersion`（默认 `1.2.0`）是 TQ 专属基线；本地目录源（change 5 的自产 skill）SHALL NOT 套用该基线——`baseline` 为 `null`，MUST NOT 产生 `version-below-baseline` 假警告。该源仍 SHALL 做「`version` 可解析」与内容哈希比对。`installDir`/`targetRoot` 的落点参数化见「原子安装」与「本地目录源部署」两条 Requirement。

防篡改的主判据 SHALL 是**内容哈希**而非版本号：`status` 每次重新计算本地 `SKILL.md` 的 SHA-256 并与记录比对，不符即 `state: 'content-drifted'`（版本号不变也告警），并标注「指令集已变更，建议人工复核」。哈希 MUST NOT 被表述为「验证了官方性」（官方无公开哈希/签名）。

#### Scenario: 版本正常

- **WHEN** 已安装版本为 `1.2.0`、基线为 `1.2.0`、内容哈希与记录一致
- **THEN** 状态为正常，无警告
- **判据（证据）**：`state === 'installed'`、`drift === 'unchanged'`、`warnings === []`

#### Scenario: 版本过低

- **WHEN** 已安装版本低于基线
- **THEN** 状态含警告（已安装版本、基线、建议动作），功能继续可用
- **判据（证据）**：`warnings` 中每条同时含版本号、基线值与建议动作；插件仍可挂载、skill 仍可用

#### Scenario: 文件被删除或不可解析

- **WHEN** 已安装的 `SKILL.md` 被删除，或 frontmatter 无法解析
- **THEN** 状态含显式警告（缺失/不可解析），并提示可执行安装/更新动作
- **判据（证据）**：`state ∈ {'missing','unparseable'}`；`warnings` 含建议动作文本

#### Scenario: 保号篡改（版本不变、正文被换）

- **WHEN** 本地 `SKILL.md` 正文被改动（版本号仍是 `1.2.0`）
- **THEN** `state === 'content-drifted'`、`drift === 'drifted'`，warning 给出 `contentHash` 与 `expectedHash` 两个值并建议人工复核
- **判据（证据）**：改一个字节的用例触发上述断言

### Requirement: 更新策略与源不可达降级

插件 SHALL 支持启动时检查（可配置开关）与手动触发更新两种方式。**启动检查（`autoCheck`）的语义是「只检查、不安装」**：它只更新 `sourceReachable`、可用版本与告警，安装与替换 MUST 只能由显式工具/service 调用触发。启动检查 SHALL 按 `skill.checkIntervalHours`（默认 24）以 `lastCheckedAt` 节流。

「无变化」SHALL 表述为**零体下载**，其判定只有两条路径：①条件请求返回 **304**（`If-None-Match` 优先，无 ETag 时用 `If-Modified-Since` 且值为**原样保存的响应头字符串**）；②**HEAD 比对**标识一致。当 ETag 与 Last-Modified **都缺失**、或源忽略条件请求恒返 200 时，SHALL 退化为「每次都取」，但下载后按 `version + SKILL.md SHA-256` 判等：相等即 `outcome: 'up-to-date'` 且**零替换**（不动目标目录、不更新 `installedAt`），并记录「源不支持条件请求」warning。

官方源不可达时 SHALL 保留已安装版本继续可用，并标注源不可达；插件 MUST NOT 内置 skill 内容副本，skill 更新 MUST NOT 要求插件发版。

#### Scenario: 源有更新

- **WHEN** 启动检查发现源 `Last-Modified`/`ETag` 变化且远端版本更高
- **THEN** 状态记录可用新版本；**但（autoCheck 只检查不安装）目标目录在本轮不发生替换**，替换需显式 `update` 调用；显式 `update` 时走完整校验与原子安装，状态记录新旧版本
- **判据（证据）**：`autoCheck` 路径下目标目录哈希不变；桩服务请求计数 +1；`status().skill.availableVersion` 为新版本

#### Scenario: 源无变化（零体下载）

- **WHEN** 条件请求返回 304，或 HEAD 比对一致
- **THEN** 零体下载，状态标注「已是最新」
- **判据（证据）**：桩服务只收到无 body 的请求；目标目录 `mtimeMs` 与字节不变

#### Scenario: 源不支持条件请求（双标识皆缺）

- **WHEN** 源不返回 ETag 与 Last-Modified，或忽略条件请求恒返 200，且远端 `version` 与 `SHA-256` 与本地一致
- **THEN** 完成一次体下载后判定 `outcome === 'up-to-date'`，**零替换**，并记录「源不支持条件请求」warning
- **判据（证据）**：目标目录 `mtimeMs` 与 `meta.json.installedAt` 均不变；warning 存在

#### Scenario: 官方源不可达

- **WHEN** 下载请求失败或超时
- **THEN** 保留已安装版本继续可用，状态标注「源不可达」并记录原因，MUST NOT 删除或破坏已安装版本
- **判据（证据）**：`state === 'source-unreachable'`、`sourceReachable.reason` 非空、`sourceReachable.checkedAt` 为最近一次探测时间；目标目录逐文件哈希不变

#### Scenario: 状态查询不产生出站

- **WHEN** 同一进程内连续调用 `status()` 多次（含 service 与工具出口）
- **THEN** MUST NOT 产生任何额外出站请求；`sourceReachable` 为**缓存结论**（含 `checkedAt`）
- **判据（证据）**：桩服务请求计数在 `status()` 调用前后不变

#### Scenario: 无插件发版即可升级

- **WHEN** 官方发布新版本 skill
- **THEN** 更新完全由安装器完成，插件代码与版本号不变

### Requirement: 本地目录源部署（具名签名；供 change 5 复用）

安装器 SHALL 泛化为两种源（判别联合）：`{ kind: 'https-zip'; url }` 与 `{ kind: 'local-dir'; path }`。两种源 SHALL 复用同一「校验 → 原子替换 → 零残留断言 → 可发现性核对」实现；MUST NOT 各写一份。本地目录源 SHALL 由**具名签名** `traderKit.skill.deployLocalDir({ sourcePath, targetRoot, name })`（模块导出 `syncLocalDir(input: { sourcePath, targetRoot, name })`）与工具 `tq_skill_manage(action: 'deploy')`（同名入参）暴露，供 **change 5 `daily-summary`** 部署自产 skill 复用（该 change `design.md` D-4 的「不静默覆盖用户修改」由本实现承担）。

`targetRoot`（落点根）与 `name`（skill 目录名）SHALL 全程决定落点 `<targetRoot>/<name>/`、`skillPath`、暂存/备份改名路径与可发现性核对，MUST NOT 写死 `tdx-tq-local` 或 `installDir`：

- `tdx-tq-local` / `installDir` 只是 `https-zip` 源的默认实例；
- `targetRoot = <dataRoot>/agent/skills`（change 5 落点，`iteration-1-contracts §10` 白名单写路径）SHALL 为**合法落点**——针对 `skill.installDir`（https 下载落点）的 vault / `dataRoot` 禁令 **MUST NOT** 用以否决该白名单落点；
- `minVersion` 基线 SHALL **只在 `https-zip` 源生效**；本地目录源 MUST NOT 产生 `version-below-baseline`（`baseline` 为 `null`）。

本地目录源的三态 SHALL 全部落在代码层（可断言），MUST NOT 交给 agent 自律：

| 三态 | 判据 | 动作 |
| --- | --- | --- |
| `in-sync`（一致） | 目标内容哈希 == 源内容哈希 | 零写入，返回 `in-sync` + `contentHash` |
| `user-modified`（用户改动） | 目标存在、内容不同、且源版本 ≤ 目标版本（或源无 `version`） | **不覆盖**，返回 `user-modified` + **非空 diff** 供人工合并 |
| `upgradable`（可升级） | 目标存在、内容不同、且源版本 > 目标版本 | 走原子替换，返回 `upgradable` 并记录新旧版本 |

#### Scenario: 本地源一致

- **WHEN** 部署时源目录与目标目录内容哈希相同
- **THEN** 零写入，返回 `outcome: 'in-sync'`
- **判据（证据）**：目标目录 `mtimeMs` 与文件清单不变

#### Scenario: 用户改动不覆盖

- **WHEN** 目标已存在且与源不同、源版本未高于目标（用户打磨过的版本）
- **THEN** 目标目录字节不变，返回 `outcome: 'user-modified'` + `diff` 非空（统一 diff 文本或差异文件清单），不改写用户内容
- **判据（证据）**：目标目录逐文件哈希不变；`diff` 字段长度 > 0

#### Scenario: 可升级部署

- **WHEN** 源版本高于目标版本且内容不同
- **THEN** 执行原子替换，返回 `outcome: 'updated'`，`residue` 为空，状态记录新旧版本

#### Scenario: 首次部署

- **WHEN** 目标目录不存在
- **THEN** 直接安装，返回 `outcome: 'installed'`，并执行与 https 源相同的可发现性核对

#### Scenario: 部署自产 skill 到数据根白名单区（change 5 形态）

- **WHEN** 以 `{ sourcePath: <仓库 skills/review-daily-summary>, targetRoot: <dataRoot>/agent/skills, name: 'review-daily-summary' }` 首次部署
- **THEN** 落点为 `<dataRoot>/agent/skills/review-daily-summary/`，`skillPath === <targetRoot>/review-daily-summary/SKILL.md`，可发现性核对按该 `name` 执行，MUST NOT 因「落在 `dataRoot` 内」被拒绝，且 MUST NOT 产生 `version-below-baseline`
- **判据（证据）**：`outcome === 'installed'`；`skillPath` 逐字符断言；`baseline === null`；`warnings` 中无 `version-below-baseline`

### Requirement: 可发现性核对与同名遮蔽

安装完成后与每次 `status` SHALL 只读核对本 skill 是否已被宿主发现，**MUST 按宿主签名传 `cwd`**（不传 `cwd` 时宿主不扫 rank 100 项目根，核对结果无意义），并断言实例化路径等于本落点。核对 SHALL **按 `name` + `targetRoot` 参数化**（`tdx-tq-local` / `installDir` 只是 https 源的默认实例），MUST NOT 写死 skill 名或落点根：

- 调用形态：`checkDiscovery({ skills?, projectRoot, targetRoot, name })` → `skills.list({ cwd: projectRoot, signal, scope })`，其中 `cwd` 取自根解析 Requirement 的结果；
- 命中判据：存在 `name === <本次 name>` 且 `path === path.join(targetRoot, name, 'SKILL.md')`；
- 「未发现」SHALL 拆为两类**不同**的显式警告：`not-discovered`（没扫到，提示检查 `targetRoot` 与会话工作空间，附 `resolvedCwd` / `cwdSource`）与 `shadowed`（扫到同名但不是本落点，被更前 rank 的同名副本遮蔽）；
- 遮蔽警告 SHALL 含遮蔽者**路径、rank 与版本**（形如「已遮蔽 `<路径>`（rank 100，版本 1.0.12）」）；候选根至少覆盖 `targetRoot`、`<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`Config.skill.extraSkillRoots` 与 `list()` 返回的赢家；
- 宿主 skills 服务不可用时 SHALL 退化为文件系统检查（`discovery.mode = 'filesystem-only'`），MUST NOT 硬依赖宿主内部服务，也 MUST NOT 把「服务不可用」写成「未发现」。

#### Scenario: 一键安装并被宿主发现

- **WHEN** 调用 `tq_skill_manage(action: "install")` 且源可达
- **THEN** 完成下载/校验/原子安装，返回安装版本与落点路径，且以真实 registry 断言该 skill 已被发现
- **判据（证据）**：证据四项——①命令（工具调用记录）；②产物 `path`（`<targetRoot>/<name>/SKILL.md` 绝对路径；https 源默认实例即 `<installDir>/tdx-tq-local/SKILL.md`）；③`list({ cwd: projectRoot })` 命中且 `path` 与落点逐字符相等、`source` 为项目根 provider；④版本号 + `contentHash`

#### Scenario: 未扫到（cwd/根不一致）

- **WHEN** `targetRoot` 与根解析推出的根不一致
- **THEN** 安装仍可完成，但状态产生 `not-discovered` 警告（含 `resolvedCwd`、`projectRoot`、`cwdSource` 与处置建议），MUST NOT 报「已正确安装」

#### Scenario: 被同名副本遮蔽

- **WHEN** 更前 rank 的候选根（如 `<projectRoot>/.dsh/skills` 或 `<projectRoot>/.agents/skills`）存在同名列（`name`）
- **THEN** `status().skill.shadowed` 非空，warning 含「已遮蔽 `<路径>`（rank X，版本 Y）」
- **判据（证据）**：fixture 构造 rank 100/200 同名副本的用例断言 `shadowed[0]` 含 `path`/`rank`/`version`/`name` 四字段

#### Scenario: 非默认实例同样可核对

- **WHEN** 以 `{ targetRoot: <dataRoot>/agent/skills, name: 'review-daily-summary' }` 部署后核对
- **THEN** 命中判据按该 `name` / `targetRoot` 生效，返回 `skillPath === <targetRoot>/review-daily-summary/SKILL.md`
- **判据（证据）**：写死 `tdx-tq-local` 或 `installDir` 的实现被该用例判失败

#### Scenario: 宿主服务不可用

- **WHEN** 插件拿不到宿主 skills 服务
- **THEN** 退化为文件系统检查（`discovery.mode === 'filesystem-only'`），状态仍报告落点是否存在，MUST NOT 产生假的 `not-discovered` 警告

### Requirement: vault 副本弃用与「不写 vault」的精确范围

安装器 SHALL NOT 读取、写入、校验或依赖 `<vault>/.claude/skills/tdx-tq-local/`（该副本仅作历史示例，已弃用）；MUST NOT 因该路径缺失或内容陈旧产生错误或警告。

「不写 vault」的断言范围 SHALL 按 `iteration-1-contracts §10` **收窄**为：①`<vault>/.claude/**` 与已弃用副本区**零写入**；②`dataRoot` 下**既定业务区之外**零写入——`dataRoot` 下白名单写路径（`agent/skills/`、`agent/DB/temp/dsh-trader-kit/`、`DB/review/`）SHALL **显式豁免**；一切「安装/部署前后全 vault diff 为空」的断言 MUST 把白名单区排除在 diff 之外，否则与「把 skill 装到 `agent/skills/`」自相矛盾。`skill.installDir`（https 下载落点）的 vault / `dataRoot` 禁令 SHALL 豁免同一组白名单路径；本地目录源的 `targetRoot` 按「可写目标」规则判定（见「本地目录源部署」）。

#### Scenario: vault 副本不存在或陈旧

- **WHEN** vault 中无该副本或副本版本落后
- **THEN** 安装器行为与状态不受影响（不报错、不提示升级 vault 副本）

#### Scenario: 不写 vault

- **WHEN** 执行安装、更新、部署或卸载
- **THEN** ①`<vault>/.claude/**` 与已弃用副本区零新增/修改/删除；②`dataRoot` 下既定业务区之外零写入；③`dataRoot` 白名单区（`agent/skills/` 等）的写入**不计为违规**（部署到该区是既定行为）
- **判据（证据）**：对真实 vault 路径做安装前后「文件清单 + 逐文件哈希 diff」，**diff 范围 MUST 排除 `iteration-1-contracts §10` 白名单区**，排除后 diff 为空；**未配置 `dataRoot` 时该断言显式 skip 并输出 skip 说明**（MUST NOT 记为通过）

### Requirement: 事实源优先级（文件系统为准）

`status` SHALL 一律**以文件系统为准**判定 `installed` / `version` / `contentHash`；`meta.json` 只是上一次安装的备忘，MUST NOT 用它的值覆盖落点的现实。两者不一致时 SHALL 产生显式警告并同时给出两个来源的值。`uninstall` 后残留的孤儿 `meta.json` MUST NOT 让状态报告为「已安装」。

#### Scenario: 落点被手工删除但 meta.json 仍在

- **WHEN** 用户手工删除 `<targetRoot>/<name>/`
- **THEN** `state === 'missing'`，warning 含「安装记录仍在但落点不存在」（并指出残留 `meta.json`）

#### Scenario: 落点被手工替换

- **WHEN** 用户手工替换 / 编辑 `SKILL.md`（版本与哈希均变）
- **THEN** `version` 与 `contentHash` 取自**文件系统**，`state ∈ {'state-mismatch','content-drifted'}`，warning 同时列出文件系统值与 `meta.json` 记录值
- **判据（证据）**：fixture 手工改写 `SKILL.md` 后断言上述字段

#### Scenario: 记录缺失但落点存在

- **WHEN** 落点存在而 `meta.json` 缺失（例如手工复制或换机）
- **THEN** `state === 'installed'`（以文件系统为准）并给出「安装记录缺失，版本取自文件系统，建议重装以恢复哈希基线」warning

### Requirement: 并发与重入

安装/更新/部署 SHALL 使用唯一暂存目录（`fs.mkdtemp`，MUST NOT 用毫秒时间戳拼名）；同一插件实例内 SHALL 串行化（进程内互斥）；跨进程 SHALL 用锁文件（含 `pid` 与持锁时间）互斥。锁被占用时后到调用 SHALL 被拒绝并返回 `outcome: 'rejected'`（提示持锁 pid 与开始时间），MUST NOT 与成功结果混同；锁超过 10 分钟视为陈旧并接管（接管动作记 warning）。

#### Scenario: 同进程并发两次安装

- **WHEN** 两个 `install` 调用并发（`Promise.all`）
- **THEN** 恰好产生 1 个有效安装、`residue` 为空，另一个返回 `outcome: 'rejected'`（含持锁 pid）
- **判据（证据）**：返回体 outcome 区分为「已完成 / 被拒绝」；`list({ cwd })` 恰好 1 个候选胜出

#### Scenario: 陈旧锁被接管

- **WHEN** 锁文件的 `startedAt` 早于 10 分钟
- **THEN** 本次调用接管锁并继续，warning 记录接管事实与旧 `pid`

### Requirement: 卸载与残留清理出口

插件 SHALL 提供 `tq_skill_manage(action: 'uninstall', targetRoot, name)`（可选 `purge` 语义：是否同时删除 `meta.json`），SHALL 幂等，并 SHALL 一并清理 `<targetRoot>/<name>/`、暂存区/备份区残留与历史遗留的 `.*backup-*` / `.*stage-*` 目录。

#### Scenario: 卸载后可发现性消失

- **WHEN** 执行 `uninstall`（源与网络无关）
- **THEN** `list({ cwd })` 不再命中 `<name>`，且落点目录与 `residue` 均不存在
- **判据（证据）**：`list({ cwd })` 结果中无该 name；落点路径 `stat` 返回 ENOENT

#### Scenario: 重复卸载幂等

- **WHEN** 对未安装状态再次执行 `uninstall`
- **THEN** 返回 `outcome: 'nothing-to-do'`，不报错，不产生新残留

#### Scenario: 保留或删除安装记录

- **WHEN** `uninstall` 且 `purge: false`
- **THEN** `meta.json` 保留，但状态仍为 `missing`（以文件系统为准），MUST NOT 报告为「已安装」

### Requirement: 出站通道与节流边界

本插件的出站请求分两条**具名通道**：`src/data/http.ts`（数据面，受 change 2 的 `src/data/guard.ts` 唯一闸门约束）与 `src/skill/download.ts`（本 change 的资产下载通道）。skill 下载通道 SHALL 明确豁免 guard，并 SHALL 具备全部替代护栏：①仅 `https:`；②`redirect: 'manual'`，或校验 `response.url` 的 host 必须等于配置源 host，否则显式报错；③超时（连接 3 s / 总 60 s）；④重试 ≤2 次、退避 1 s / 4 s；⑤单次下载字节上限 5 MB；⑥启动检查受 `checkIntervalHours`（默认 24）节流；⑦进程内去重（同一进程内重复 `status`/挂载 MUST NOT 产生额外出站）。`src/skill/**` 与 `src/data/**` MUST NOT 互相 import。

#### Scenario: 重定向被显式处理

- **WHEN** 源返回 30x 且跳转目标 host 与配置源 host 不同
- **THEN** 安装中止并显式报错（含目标 URL），MUST NOT 静默接受

#### Scenario: 单次下载超限

- **WHEN** 响应体超过 5 MB
- **THEN** 中止下载并显式报错（含实际值与上限），暂存区被清理

#### Scenario: 启动检查节流

- **WHEN** 距上次检查不足 `checkIntervalHours` 且触发启动检查
- **THEN** 跳过本次出站并记 warning（含 `lastCheckedAt`），已安装版本不受影响

### Requirement: 状态查询出口

插件 SHALL 提供工具 `tq_skill_manage`（`action` 取 `install` / `update` / `status` / `deploy` / `uninstall`）与 service 出口的状态查询；两者 MUST 指向同一实现。状态视图 SHALL 为**两段**，其**所有权**按 `iteration-1-contracts §11`/`§12.2` 划分：

- `traderKit.health.status() -> { data, skill }`：**唯一 owner 是 change 2**（`data-tool-contract`）——`data` 段为其数据源段，`skill` 段为 change 3 提供；**change 3 MUST NOT 产出、注册或实现该出口**（避免同一函数双重拥有/双重实现）；
- `traderKit.skill.status({ cwd? }) -> SkillStatus`：**本 change 的唯一状态出口**，只返回 `skill` 段，其返回体即上一行 `health.status().skill`（字段逐项相等）。

`skill` 段 MUST 含以下键（`null` 允许，**缺键视为失败**）：`state`、`installed`、`version`、`previousVersion`、`availableVersion`、`baseline`、`targetRoot`、`name`、`targetPath`、`skillPath`、`installDir`、`source`、`sourceReachable`、`contentHash`、`expectedHash`、`drift`、`discovery`、`shadowed`、`residue`、`resolvedCwd`、`projectRoot`、`cwdSource`、`lastCheckedAt`、`installedAt`、`warnings`。其中：

- `state` 取值域为 `installed | missing | source-unreachable | shadowed | not-discovered | version-below-baseline | content-drifted | downgrade-blocked | unparseable | state-mismatch | installed-with-residue`；
- `targetRoot` / `name` / `targetPath` / `skillPath` 按落点参数化（`skillPath === <targetRoot>/<name>/SKILL.md`）；`installDir` 为 https 源的默认 `targetRoot` 别名；
- `sourceReachable` 为 `{ state: 'reachable' | 'unreachable' | 'unknown', checkedAt, reason }` 的**缓存结论**；`status` MUST NOT 内联发起网络请求；
- `cwdSource` 取值域为 `session | explicit | recorded | install-dir-derived`；
- `warnings` 为中文数组，每条含原因与建议动作。

#### Scenario: 查询状态（显式 cwd）

- **WHEN** 调用 `tq_skill_manage(action: "status", cwd: <项目根>)` 或 `traderKit.skill.status({ cwd: <项目根> })`
- **THEN** 返回上述全部字段
- **判据（证据）**：字段清单逐键断言（本 Requirement 列出的键全部存在）；`state` 落在取值域内；调用前后出站计数不变

#### Scenario: 无来源被显式拒绝（不猜测）

- **WHEN** 调用 `traderKit.skill.status()`：既未传 `cwd`，`meta.json` 也无 `projectRoot` 记录值，且 `skill.installDir` 为空（默认 `''`）或为相对路径
- **THEN** **显式拒绝并提示**（拒绝理由含「无可用来源」与三项来源说明：`cwd` 未传 / 无记录值 / `installDir` 不可解析），MUST NOT 猜测项目根，MUST NOT 用 `process.cwd()` 兜底，MUST NOT 返回一份「假装正常」的状态
- **判据（证据）**：返回显式错误；`resolvedCwd === null` 且 `projectRoot === null`；桩服务请求计数为 0

#### Scenario: 两段视图与 skill 段一致

- **WHEN** 同时读取 `health.status().skill`（change 2 组装）与 `skill.status({ cwd })`（本 change）
- **THEN** 两处字段逐项相等（同一实现的证明）；`health.status().data` 与 change 2 的原出口内容一致
- **判据（证据）**：字段级深比较相等；源码断言 `src/skill/**` 无 `health.status` 定义或二次注册

#### Scenario: 手动更新

- **WHEN** 调用 `tq_skill_manage(action: "update")`
- **THEN** 按更新策略执行：有更新则安装并返回新旧版本，无更新则返回「已是最新」，降级则返回 `downgrade-blocked`

### Requirement: 溯源记录与发布产物纪律

同一组溯源字段 SHALL 同时出现在 `status` 与外部资产台账（`docs/carryover.md`）：源地址、首次获取时间、版本、zip 与 `SKILL.md` 的 SHA-256、适用范围、已弃用 vault 副本记录。发布产物 `cordis.patch.yml` 与 `package.json` MUST NOT 含个人机器绝对路径；`package.json#files` SHALL 覆盖安装器的全部产物（`lib/**`）；若安装器带静态资产，SHALL 同时进入构建与 `files`。`sourceUrl` 的默认值（公开官方地址）不属个人路径，允许保留。

仓库卫生 SHALL 按需粒度：本仓 `.gitignore` 增 `.dsh/skills/` 与 `.dsh/.dsh-trader-kit-tmp/`（若 owner 选择整目录忽略，则为 `.dsh/`）。安装落点在**宿主当前项目根**时，安装器 SHALL 只**提示**目标仓库是否忽略 `<targetRoot>`（读取目标根 `.gitignore` 判断，不引 shell、不代改文件），并在状态标注忽略状态。

#### Scenario: 台账与状态字段一致

- **WHEN** 完成一次真实安装
- **THEN** `docs/carryover.md` 台账段与 `status().skill.source` 使用同一组字段，且 SHA-256 逐字符一致
- **判据（证据）**：字段名清单比对 + 哈希比对

#### Scenario: 发布产物无个人路径

- **WHEN** 核查 `cordis.patch.yml` 与 `package.json`
- **THEN** 两者零个人机器绝对路径（含注释）；`files` 覆盖 `lib`；静态资产（若有）已在构建与 `files` 中
- **判据（证据）**：对两文件做绝对路径形态扫描（`[A-Za-z]:\\` 与 `\\\\`），命中数 0

#### Scenario: 目标仓库忽略提示

- **WHEN** 安装落点的项目根存在 `.gitignore`
- **THEN** 若 `<targetRoot>` 未被忽略，返回体给出一条提示（含建议忽略的路径），状态 `installDirIgnored === false`；MUST NOT 修改目标仓库的 `.gitignore`
