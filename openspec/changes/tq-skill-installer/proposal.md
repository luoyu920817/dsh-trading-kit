## Why

TQ-Local 是盘面数据的主力通道，但需求已定案它**以 skill 形态由 agent 读取执行**（不固化进 TS 代码）。这个 skill 不再使用 vault 里的旧副本：TDX 官方提供了 zip 分发通道（实测 HTTP 200 / `application/zip` / Last-Modified 2026-09-20，包内 `SKILL.md` **v1.2.0、215 KB**，新于 vault 副本 v1.0.12 / 106 KB），且会随 TDX 持续更新。

把「获取与更新」交给人工下载解压是不成立的：TDX 一更新就要人工重复一遍，且**装错位置 agent 就读不到**（DSH 按固定 skill 根发现）。因此需要插件承担**下载 → 校验 → 原子安装 → 版本检查 → 更新降级**这条链路，且更新不要求插件发版（松耦合）。

第一轮对抗性评审（`reviews/tq-skill-installer-review.md`，2026-09-27）指出三处 Critical：可发现性核对不传 `cwd` 必然失败；备份目录本身会被宿主当同名 skill 发现；更新可静默降级且 zip 解压无路径/规模防护。第二轮评审（同文件 Round 2）指出「两种源」只泛化了源、`installDir` 反推 `projectRoot` 失效、`health.status()` 双重拥有等 8 条（N1–N8）。本 proposal 已按两轮评审修订（逐条处置见 `design.md` 末两节）。

## What Changes

- **D1 官方源配置**：`sourceUrl` 可配置（MUST 为 `https:`），默认 `https://www.tdx.com.cn/products/autoup/skills/tdx-tq-local.zip`；源变更不需插件发版；源地址与获取时间记入状态与台账。
- **D2 下载、校验与原子安装**：下载到**扫描根之外**的暂存区（`path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp', <唯一运行目录>)/`；`targetRoot` = 落点根，https 源默认 `installDir`）→ 校验（HTTP 状态 + content-type + **解压加固**（绝对路径/`..`/symlink/Windows 保留名 + 条目数 ≤200、单文件 ≤5 MB、总量 ≤50 MB）+ zip 结构 + 必需条目 + frontmatter `name` 与目标 `name` 匹配）→ 解压安装到 **DSH 可发现的 skill 根**（默认 `<项目根>/.dsh/skills/`，即 M1-Q1 裁决的 rank 100 目录）→ 原子替换（暂存目录 + 改名），**失败保留旧版且不留半装状态**；**暂存/备份/下载包 MUST 零残留**，清理失败 → 显式 warning + `residue[]` 且**不报成功**。
- **D3 版本检查与防篡改**：解析已安装 `SKILL.md` frontmatter `version`（官方格式 `1.2.0（2026-09-20）`）；与配置基线比对，缺失/过低时在日志与状态出口**显式警告**（不阻断使用）。宿主的 skill 子系统不解析 `version`，因此**以内容 SHA-256 为主判据**（版本不变而正文被换 → `content-drifted` 告警），`version` 只作相对基线的辅助判断。
- **D4 更新策略与降级闸门**：启动检查（`autoCheck`）**只检查、不安装**（安装/替换仅由显式调用触发）；手动触发更新；用源 `Last-Modified`/`ETag` 与本地记录判断是否需要重新下载，**「无变化」精确表述为零体下载（304 或 HEAD 比对一致）**；源不支持条件请求时退化为「每次都取 + `version`/SHA-256 判等零替换」；**远端版本低于本地 → 默认拒绝替换并显式报错**，仅 `force: true` 才执行（三态：升级 / 持平且源标识变化 → 覆盖并记新旧标识 / 降级）；**官方源不可达时保留已安装版本继续可用**；插件不内置 skill 内容，skill 更新不要求插件发版。
- **D5 vault 副本弃用**：不读、不写、不校验 `<vault>/.claude/skills/tdx-tq-local/`（仅作历史示例）。
- **D6 可发现性核对与同名遮蔽**：按宿主签名 `list({ cwd: projectRoot, signal, scope })` 核对（**`cwd` 必传**，不传则宿主不扫 rank 100 项目根），断言实例化路径 == `<targetRoot>/<name>/SKILL.md`（`targetRoot`/`name` 参数化；https 源默认 `<installDir>` / `tdx-tq-local`）；「未发现」拆为 `not-discovered` 与 `shadowed` 两类显式警告（遮蔽警告含遮蔽者路径、rank、版本）；宿主服务不可用时退化为文件系统检查。
- **D7 两种源（供 change 5 复用）**：安装器泛化为 `https zip` 与 `localDir` 两源，共用同一套校验/原子替换/零残留/可发现性核对；本地目录源三态（`in-sync` 零写入 / `user-modified` 不覆盖 + 输出 diff / `upgradable` 升级）由具名签名 `traderKit.skill.deployLocalDir({ sourcePath, targetRoot, name })` 与工具 `action: 'deploy'` 暴露，`targetRoot` 允许 = `<dataRoot>/agent/skills`（change 5 落点，`contracts §10` 白名单区），供 **change 5 `daily-summary`** 部署自产 skill。
- **D8 卸载与残留清理**：`action: 'uninstall'`（可选 `purge`）删除落点 + 清理暂存/备份残留 + 处理 `meta.json`，幂等返回；**回滚不再依赖手工删目录**。
- **状态出口**：本 change **只提供 `skill` 段数据源**——`traderKit.skill.status({ cwd? })` 与 `buildSkillStatus()`；`traderKit.health.status()` 两段视图（`{ data, skill }`）的**唯一 owner 是 change 2**（`contracts §11`/`§12.2`），本 change MUST NOT 另建或二次实现该出口。工具 `tq_skill_manage`（`install` / `update` / `status` / `deploy` / `uninstall`）与 service 同一实现。
- **事实源优先级**：`status` 一律**以文件系统为准**，`meta.json` 只是备忘（用户手工删除/替换后不得报 OK）。

## Capabilities

### New Capabilities

- `tq-skill-installer`: 官方 zip 源与本地目录源的 skill 下载/校验/解压加固/原子安装/版本与哈希检查/更新与降级/可发现性核对与遮蔽检测/卸载，以及状态查询出口。

### Modified Capabilities

- **无。** 该出口（`traderKit.health.status()` 的 `{ data, skill }` 两段视图）的**唯一 owner 是 change 2**（`contracts §11`/`§12.2`）：change 2 的 `data-tool-contract` spec 已自行声明两段并透传本 change 的 `skill.status()` 结论。本 change **只提供 `skill` 段数据源**（`buildSkillStatus()` / `traderKit.skill.status({ cwd? })`），MUST NOT 另建或二次实现 `health.status()`，因此不改动任何既有 capability；change 2 侧无需为本 change 追加回写（原 R3 已就位，见 design 末节）。

## Impact

- **新增代码**：`src/skill/{root,download,zip-guard,validate,installer,state,status,update,downgrade,hash,lock,discovery,shadowing,uninstall,local-source,source,autocheck,version,gitignore-notice}.ts`、`src/tools/tq-skill.ts`、service 出口（在 change 2 的装配面上**追加** `api.skill.*`）。
- **新增依赖**：zip 解压库（`fflate`，备选 `yauzl`；选型门禁见 tasks 1.3——先用官方包验证「截断 zip 能给出完整性失败信号」，不达标换 `yauzl`）。
- **配置**：`config.skill`（`sourceUrl`、`installDir`、`minVersion`、`autoCheck`、`checkIntervalHours`、`extraSkillRoots`、`limits`）**追加到 change 2 引入的 `Config` 导出**（`src/config.ts` 唯一 owner = change 2，本 change **MUST NOT 新建/覆盖该文件，MUST NOT 改 `dataRoot` 默认值**；本 change 的 `Config.skill` 段依赖 change 2 的 `Config` + `dataRoot`，`contracts §0`/`§11`）。
- **仓库**：`.gitignore` 按需粒度增 `.dsh/skills/` 与 `.dsh/.dsh-trader-kit-tmp/`（保留回退整目录 `.dsh/` 的选项）；`package.json#files` 覆盖安装器产物（`lib/**`），本 change 无静态资产；`cordis.patch.yml` 与 `package.json` MUST NOT 含个人机器绝对路径（现状核查已发现一条注释内的本机路径，列为 tasks 5.4 清理项）。
- **台账**：`docs/carryover.md` 增「外部资产台账」段（源 URL、首次获取时间、版本、zip/`SKILL.md` 的 SHA-256、适用范围、已弃用的 vault 副本记录）——TQ skill 是**下载的第三方产物**，适用 AGENTS 的溯源纪律。
- **验收对照（按第一轮评审收窄到可判定范围）**：①一键安装后以真实 registry 断言 `list({ cwd: projectRoot })` 命中，且实例化路径 == `<targetRoot>/<name>/SKILL.md`（https 源默认 `<installDir>/tdx-tq-local/SKILL.md`；证据四项：命令 / 落点绝对路径 / 发现结果 / 版本 + `contentHash`）；②官方源不可达时保留已安装版本继续可用（落点字节不变 + `state: 'source-unreachable'` + 原因）；③**可判定的篡改/删除/降级三类**触发警告——删除或不可解析 → `warnings`；正文被换（版本不变）→ `content-drifted`；源版本更低 → `downgrade-blocked` 且目录字节不变（MUST NOT 宣称覆盖一切篡改）。
- **明确不做**：不修改官方 skill 内容（原样安装分发包）；**不做 skill 内容审查**（官方包正文会由 agent 执行，属**已知风险**，由 design 的 Non-Goals 与 Risks 承担）；**解压不执行包内任何脚本**（不跑 `postinstall`、不执行 `.js/.sh/.ps1/.cmd`）；不重建 vault 副本；不调用任何 TQ 方法（安装器不碰 17709 数据面）；不接交易接口。
- **明确不做（跨 change 边界）**：skill 下载通道不走 change 2 的 `src/data/guard.ts`（豁免理由与 7 条替代护栏见 design D-12）；本 change 不直接修改其它 change / `contracts` / `docs/`，跨 change 改动一律登记为回写项（R1–R8，其中 R1–R4、R7 已就位，见 design 末节）。
