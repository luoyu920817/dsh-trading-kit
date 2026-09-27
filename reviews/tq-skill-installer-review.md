# Plan Review: TQ skill 安装器（tq-skill-installer）
**Plan File**: openspec/changes/tq-skill-installer/（proposal + specs + design + tasks）
**Reviewer**: Independent Reviewer (subagent)

---

## Round 1 — 2026-09-27

### Overall Assessment

设计的方向与边界感是好的：不注册 `ctx.skills.register`（避免「文件系统 + 运行时」双份真相）、源不可达不视为错误、不碰 17709、不写 vault、更新不要求插件发版，且宿主事实这次**大体被我独立核验为真**（rank 常量、roots、frontmatter 必填项、`list/get`、`defineTool` 全部对齐；仅 `projectRoot` 一处行号引错）。但两处关键不变量在实现层面会被自己的流程打破：D-6 的可发现性核对按宿主现状**永远扫不到 rank 100 项目根**（`cwd` 未传），以及 D-3 的备份目录**本身会被宿主当作同名 skill 发现**并可能与新版竞争、在「备份删除失败被容忍」时形成「装好了但 agent 读旧版、状态说新版 OK」的假绿。叠加更新路径可静默降级、zip 解压无路径/规模防护、autoCheck 默认开且供应链无任何内容判据，安全面缺一整块。
**Rating**: 5/10

### Issues

#### Issue 1 (Critical): 可发现性核对（D-6）按宿主现状必然失败——`list()` 不传 `cwd` 就不扫项目根
**Location**: `openspec/changes/tq-skill-installer/design.md:62`（D-6）、`design.md:33`、`specs/tq-skill-installer/spec.md:119`、`tasks.md:15`
宿主 `skill-filesystem` 只在 `cwd !== undefined` 时才推入项目根（已核验 `packages/skill/skill-filesystem/src/index.ts:245-253`：`if (this.includeDefaultRoots && cwd !== undefined)` → `join(projectRoot, '.dsh/skills')` rank 100）；`SkillViewOptions.cwd`/`scope` 都是可选（`packages/skill/skill/src/index.ts:103-119`），而宿主真实消费者一律显式传：`{ cwd: exec.agent?.session.header.cwd, signal, scope: exec.agent }`（`packages/skill/tool-skill/src/index.ts:133,222`）。因此 D-6 写的「`ctx.get('skills').list()` 核对 `tdx-tq-local` 已被发现」在**不传 cwd 时看不到项目根**，只会返回空/别处的同名 skill → 每次安装都给出「已安装但未被宿主发现」的假警告；反之若实现者为了「让它出现」而改默认根，又把安装语义偷改了。spec `状态查询出口` 的「SHALL 尽可能经宿主 skills 服务确认」因此不可实施、不可验收。
**Suggestion**: 把根解析与核对都契约化：①统一纯函数 `resolveProjectRoot(cwd)`，`cwd` 必填（工具出口取 `exec.agent.session.header.cwd`；service 出口加显式 `cwd` 入参，无则用已配置的 `installDir` 推导出的根，并把 `resolvedCwd` 记进状态）；②核对写成 `list({ cwd, scope }).find(s => s.name === 'tdx-tq-local')`，断言 `source === 'project-dsh'` 且 `path === <installDir>/tdx-tq-local/SKILL.md`；③把「未发现」拆成两类显式警告：未扫到（cwd 不同/根不同）与命中但不是本落点（被遮蔽）。补一条集成单测：真实 registry + 真实临时项目根（含 `.git` 标记）断言命中路径。

#### Issue 2 (Critical): 备份目录 `.tdx-tq-local.backup-<ts>/` 会被宿主当成同名 skill 扫描，与新版竞争；清理失败被容忍 → 永久假绿
**Location**: `design.md:41-50`（D-3 第 4/6 步）、`design.md:48`（「删除 backup 失败也不影响正确性」）、`specs/tq-skill-installer/spec.md:48,53`
宿主发现逻辑只跳过「一层目录 + 其下有 `SKILL.md`」，且**没有 dot 前缀过滤**（`skill-filesystem/src/index.ts:723-733`：`entry.type === 'directory'` → `locator = join(entry.path, 'SKILL.md')`；唯一的跳过是 `root.skipSystem && entry.name === '.system'`，见 `:727`）。D-3 第 4 步把 `tdx-tq-local/` 整个改名为 `.tdx-tq-local.backup-<ts>/`，该目录**顶层就有 `SKILL.md`** → 它本身是一个合法的 rank 100 同名候选。胜出顺序是 `rank → providerOrder → localOrder`（`packages/skill/skill/src/index.ts:807-811`），同一 provider 内 localOrder 跟着目录名升序（`skill-filesystem:726` 的 `sort((a,b)=>a.name.localeCompare(b.name))`）；`.` 前缀通常排在 `t` 之前 → **备份目录很可能赢得 discovery**，即「新版装好了，agent 仍读到被降级的旧目录」，而 D-3 第 6 步（删备份）失败是被明确容忍的（`design.md:48`），于是这个状态可以长期存在且无告警——版本检查读的是 `<installDir>/tdx-tq-local/`（新版），自检说 OK。这直接推翻了「任何时刻要么旧版可用、要么新版可用」的可观测含义（不变量形式成立，事实失真）。另外 `spec.md:48` 硬要求「无临时/备份目录残留」，与 `design.md:48` 自相矛盾。
**Suggestion**: 让暂存/备份在扫描面上**不可见**：备份与 stage 一律放到根外（如 `<projectRoot>/.dsh/.tdx-tq-local.tmp/<ts>/`，仍需同卷以便原子改名）或包成两层（`.tdx-tq-local.backup-<ts>/tdx-tq-local/`，使一层目录下没有 `SKILL.md`）；`.download-*.zip` 因非 `.md` 是安全的。同时：把「清理失败」从「仅需清理」升级为显式警告 + status 暴露残留路径 + 下次启动或下次安装时重试清理；spec 改为「成功路径 MUST 无残留，清理失败 MUST 告警并列出残留路径」。补断言：安装/更新完成后用真实 registry `list()` 断言 `tdx-tq-local` 恰好 1 个候选中选、`path` 落在 `tdx-tq-local/SKILL.md`。

#### Issue 3 (Critical): 更新路径可静默降级——只要源标识变化就安装，未比较远端版本
**Location**: `design.md:56-58`（D-5）、`specs/tq-skill-installer/spec.md:83-96`
「无变化零下载」之外，唯一被禁止的降级场景是「源不可达」（`spec.md:96`）。若官方源回滚/临时提供旧包，或 `sourceUrl` 被配到旧归档（配置项允许），Last-Modified/ETag 变化即触发下载 → 走完整校验与原子替换 → **本地 skill 从 1.2.0 降到 1.0.x 且静默成功**；`minVersion` 只是警告（`spec.md:62`「MUST NOT 阻断」），D-3 的安装流程里也没有任何版本比较步骤。对「agent 要执行的指令集」来说，降级与内容替换同等危险。
**Suggestion**: 安装前把 `remoteVersion` 与 `installedVersion` 比对，`remote < installed` → 默认拒绝替换、保留现版、状态标 `downgrade-blocked`（含两版本号），仅当显式 `allowDowngrade`（或 `force`）时才执行；把该三态（升级/持平/降级）写进 spec 的新场景与 `tq_skill_manage` 的返回；补单测「源返回更低版本 → 目录字节不变 + 显式告警」。

#### Issue 4 (Critical): zip 解压无路径穿越与规模防护，而落点正是宿主扫描根
**Location**: `spec.md:19`（校验清单只有 6 项）、`design.md:37`（D-2「解压保留完整包结构（原样安装）」）、`design.md:44`（解压到 `<installDir>/…stage-<ts>/`）
spec 的校验项全部是「内容正确性」，没有一项约束**条目路径**：`../`、绝对路径、`..\`（Windows 反斜杠）、盘符/UNC、符号链接/reparse 条目、以及解压炸弹（zip 条目数、单条目与总解压字节）。「原样安装完整包结构」恰好是 zip-slip 的标准放大条件，且目标目录是被宿主 chokidar 监视、被 agent 当指令读取的目录。这个缺口在评审要点里被点名而 design/spec 通篇未提。
**Suggestion**: 在 `validate` 增加硬校验并写进 spec 场景（失败=中止+保留旧版+清理）：①每条目 `path.resolve` 规范化后必须仍在 stage 根内（沿用 `data-foundation/design.md:40` 的越界防护先例，提取共用 helper）；②拒绝绝对路径、`..` 段、盘符、UNC、尾随空格/点、Windows 保留名（`CON`/`NUL` 等）；③拒绝任何 symlink/reparse 条目；④限制压缩包字节、解压总字节、条目数、单条目字节（默认值可配置）；⑤补三条恶意契约测试（`../x`、绝对路径、symlink 条目）与一条超大包测试。

#### Issue 5 (High): 供应链控制只有「结构校验 + 官方域名」，缺哈希、缺重定向策略、缺自动安装闸门
**Location**: `design.md:12,24-27,77`、`design.md:70`（autoCheck 默认开启）、`spec.md:81`
已正视「无公开哈希/签名」，但缓解只有「默认源固定为 tdx.com.cn 并在状态记录源地址与时间」。缺口有三：①`fetch` 默认跟随重定向，30x 跳到别处会静默接受，安装器并不校验最终 URL/证书（HTTPS 亦未被要求为 MUST）；②无内容判据 → 无法区分「官方正常更新」与「同结构替换」，而 `status` 只读 frontmatter `version`，保号篡改（版本不变、正文被换）永远不告警，但 skill 正文就是 agent 要执行的指令集；③`autoCheck` 默认开，design 未说明启动检查是「只检查」还是「检查并自动安装」——若是后者，第三方（或 MITM）可在无任何人工确认下静默替换 agent 指令集。proposal §验收「人为篡改能触发警告」也被高估（spec 场景只覆盖删除/不可解析）。
**Suggestion**: ①`autoCheck` 默认**只检查不安装**，安装/更新仅由显式工具调用触发，并把这条写进 spec 要求（不是 design 口头约定）；②下载后计算 zip 与 `SKILL.md` 的 SHA-256 存进 `meta.json` 并在 status 暴露；status 每次校验本地哈希 → 新增 `content-drifted` 态（版本不变也能告警）；③`redirect: 'manual'`（或校验 `response.url` 的 host 必须等于配置源 host）且只接受 `https:`；④明示超时/重试次数/退避与单次下载字节上限的默认值；⑤内容哈希或大版本变化时状态显式标注「指令集已变更，建议人工复核」。

#### Issue 6 (High): 「零下载」在语义上不可判定，条件请求细节与双缺场景未定义
**Location**: `spec.md:88-91`、`design.md:58`、`design.md:3`
要判断「源无变化」必须**先发一个请求**：只有条件请求命中 304（或 HEAD + 比对）才可能零体下载；spec 写「跳过下载（零下载）」在实现上只有这一种解释，却没有定义。同时 `If-Modified-Since` 要求存储并在下次发送**精确 HTTP-date**，而 design Context 记录的 `Last-Modified: 2026-09-20` 不是合法 HTTP-date 形态（缺时间/GMT）——若真按此记录，条件请求会失配（永远 200 或误判 304）；`ETag` 与 `Last-Modified` **都缺失**、或源忽略条件请求直接回 200 的行为均未定义（后果是每次检查都拉 215 KB）。
**Suggestion**: spec 改述为「零**体**下载：条件请求返回 304 或 HEAD 比对一致」；明确规定 `meta.json` 原样存储响应头字符串（不做日期重格式化）与 304 判定依据；补「源不支持条件请求/两标识皆缺」的降级策略（每次都取，但用 `version + SHA-256` 判等 → 零安装、零替换）与对应测试三条。

#### Issue 7 (High): spec 与 design 对「备份残留」硬冲突，且残留有真实后果（见 Issue 2）
**Location**: `spec.md:48`（覆盖安装 THEN「无临时/备份目录残留」）vs `design.md:48`（「删除 backup（失败也不影响正确性，仅需清理）」）
前者是 MUST 级场景断言，后者明确容忍失败；在 Windows + OneDrive/杀软占用场景下后者几乎必然触发，测试若按 spec 断言则「成功」与「失败」无法二分（因为成功路径本身允许失败项）。
**Suggestion**: 拆成两条：`更新成功且清理成功` → 无残留；`替换成功但清理失败` → 目标目录为新版、残留路径出现在 status 警告与返回体中（附下次清理承诺），并把「残留目录不得被宿主发现」作为断言（配合 Issue 2 的布局修正）。

#### Issue 8 (High): 并发/重入无保护，`<ts>` 命名可碰撞
**Location**: `design.md:43-47`（`stage-<ts>` / `backup-<ts>` / `download-<ts>`）、`design.md:70`（挂载后异步 autoCheck）、`tasks.md:9,21`
`autoCheck`（挂载异步）与手动 `install/update` 可并发；同一项目根被两个会话/两个插件实例同时使用时也可并发。`<ts>` 若是毫秒时间戳，同毫秒碰撞并非不可能（且 Windows 计时器精度本就有坑），碰撞后两次安装互相删改对方目录，D-3 的不变量失效且无检测。design 通篇没有互斥或锁。
**Suggestion**: 唯一目录用 `fs.mkdtemp`；进程内加一把 mutex（同插件实例串行）；跨进程用锁文件（已存在则拒绝并提示「另一处安装进行中」，含持锁时间与 PID）；补并发单测：并行两次 install 后断言 1 个有效安装 + 无残留 + 返回体区分为「已完成/被拒绝」。

#### Issue 9 (High): 配置面尚不存在，`config.skill.*` 的所有权与依赖未声明；`installDir` 语义缺失
**Location**: `src/index.ts:21`（`TraderKitConfig {}`，无 `export const Config`）、`proposal.md:30`、`design.md:33`、`spec.md:38`、`tasks.md:13`
本仓仍是阶段 1 骨架：无 schemastery Config、无 service、无工具（`src/skill/` 不存在）。配置管道由 change 2（`data-foundation/design.md:14,36`：`export const Config` + `dataRoot`）首次引入，但本 change 既不声明对 change 2 的依赖，也没说 `skill.*` 与 `dataRoot` 如何并入同一个 Config 根（schemastery 单 schema 下两块字段谁写、默认值谁定）。此外 `installDir` 只说「配置优先」，未定义相对路径的解析基（cwd / projectRoot / 配置文件位置）、绝对路径是否允许、是否允许指到 `dataRoot`/vault/插件自身源码目录，也没有 change 2 D-2 那样的 `path.resolve` + 前缀校验（越界防护先例）。
**Suggestion**: 明确「Config 由 change 2 引入、本 change 追加 `skill` 段」并写入依赖与 `blocked_by`；定义 `installDir` 语义（建议：相对路径以 `<projectRoot>` 为基；绝对路径需通过「不得位于 `dataRoot`/vault/插件包目录内」校验，失败则配置校验期报错）；把 `sourceUrl` 限定为 `https:`；补配置校验单测。

#### Issue 10 (High): proposal 说「Modified Capabilities: 无」，design/tasks 却要求扩展 change 2 的健康检查出口
**Location**: `proposal.md:22-24`（Modified Capabilities「（无。）」）、`proposal.md:28`、`design.md:66`（D-7）、`tasks.md:29`、`spec.md:119`
design D-7 与 tasks 4.2 明确要求「`skill.status()` 与 change 2 的健康检查合并为同一状态视图（`health.status()` 含数据源与 skill 两段）」，但 change 2 的 spec 已把健康检查内容与前缀写死（`data-foundation/specs/data-tool-contract/spec.md:133`：仅 TQ 端口 TCP + S7/S5/S8 三源，且「MUST NOT 因探测失败使工具与 service 出口不可用」）。本 change 声称不改任何既有 capability，实际必然改 change 2 的 spec 与出口形状；同时 `skill.status()` 与宿主 `ctx.skills` 同名易混，change 2 已定的形状是 `ctx.provide('traderKit', api)` + `api.data.*` / `api.health.status()`。
**Suggestion**: 二选一并落地：①proposal 改列 `Modified Capabilities: data-tool-contract`（增 skill 段，并同步 change 2 spec 的出口描述）；或②本 change 只提供 `api.skill.status()`，由 `api.health.status()` 组合读取。无论哪条，给出 `status()` 的字段与状态枚举（`installed|missing|source-unreachable|shadowed|version-below-baseline|content-drifted|downgrade-blocked`）。

#### Issue 11 (High): `version` 被称作「唯一护栏」，但强度不足以覆盖「保号篡改」与「本 change 验收口径」
**Location**: `design.md:9,11`（D3）、`spec.md:74-77`、`proposal.md:32`
宿主确实不解析 `version`（已核验：`skill-filesystem:814-840` 只取 `name`/`description`/`whenToUse`/invocation，`1039-1046` 的 `optionalMetadata` 只取 `metadata` 键，未知键确实不报错）——这点 design 是对的。但由此推出的护栏只有「解析 `version` 并与 `minVersion` 比大小」，于是：正文被替换而版本号不动 → 无警告；版本号被抬高 → 无警告；正文被替换成任意指令 → 无警告，而这段正文正是 agent 要执行的内容。proposal 的验收「人为篡改/删除已安装版本能触发警告」只在「删除/不可解析」两种情形成立。
**Suggestion**: 以内容哈希为主判据（Issue 5②），`version` 只做「相对基线」的辅助判断；status 增加 `content-drifted`（哈希不符，含版本不变）与 `installed-hash` 字段；proposal §验收按实际可判定的范围收窄措辞。

#### Issue 12 (High): 下载器绕开 change 2 的「所有出站请求唯一闸门」，两个 change 都自称唯一出入口
**Location**: `design.md:43,70`、`data-foundation/design.md:54`（D-5）、`data-foundation/design.md:48`（D-4）
change 2 规定 `src/data/guard.ts` 是「所有出站请求的唯一闸门（模块代码不得绕过直接 fetch）」，含并发 ≤2、最小间隔 1000 ms、每源每交易日预算 200；本 change 直接 fetch 官方源且未声明豁免，`autoCheck` 默认开还意味着挂载即出站。两者若都按字面实现必然冲突；更要紧的是「检查频率」没有任何节流——`lastCheckedAt` 被记录却「不参与任何业务日期判断」，也没被用作最短间隔。
**Suggestion**: 明确下载器复用 guard（或为 `skill` 源登记独立预算/间隔），或在本 change 写明豁免理由与替代护栏（超时/重试/单次字节上限/启动检查最短间隔）；新增 `skill.checkIntervalHours`（默认 24）并以 `lastCheckedAt` 节流；补一条「同一进程内重复 status/挂载不产生额外出站」的可断言测试。

#### Issue 13 (Medium): `projectRoot` 的行号引用错位，且「否则 cwd」未说清是哪个 cwd（真实错装根因）
**Location**: `design.md:8`（引 `skill-filesystem/src/index.ts:964-970`）、`design.md:33`
核验结果：`findProjectRoot` 的实际位置是 **`945-955`**（`while(true)` 向上找 `join(current,'.git')`，找不到时 `return cwd`）；`964-970` 是 `pathExistsInFileSystem`（`.git` 存在性探测的实现细节），语义相关但不是被引的那段。更关键：宿主起算点是**会话的 `session.header.cwd`**（`tool-skill:133,222`），而 design 只说「否则 cwd」——若实现按 `process.cwd()` 推断，后台启动检查/多会话场景会装到宿主进程目录或另一个含 `.git` 的仓库里，且这是「装了但读不到」的头号成因（design.md:76 只把它列为风险，未消除）。
**Suggestion**: 修正行号为 `945-955`；把根解析实现为纯函数 `resolveProjectRoot(cwd: string)` 并禁止使用 `process.cwd()`（工具出口用 `exec.agent.session.header.cwd`，service/启动检查用配置的 `installDir` 或显式 `cwd`，无来源时**拒绝执行并提示**）；补三条单测：无 `.git` 退化、monorepo 子目录向上找到最近 `.git`、cwd≠projectRoot 时 status 显式提示。

#### Issue 14 (Medium): 默认落在 rank 100 项目根的三选一取舍未论证，多工作空间问题被推迟到「记录在案」
**Location**: `design.md:33`（D-1）、`design.md:91`（Open Q3）、`spec.md:38`
rank 100 的唯一理由是「能压过 rank 200/400 的旧副本」，代价是：每个工作空间要各装一次（同一台机器 N 份）、强依赖 cwd 推断、写进用户的 git 工作树、可能落在 OneDrive/杀软目录（D-3 自己承认改名可能瞬时失败）。相对地 `<dshHome>/skills`（rank 400）与 cwd 无关、天然跨工作空间，代价是会被项目根旧副本遮蔽。design 没有把这条取舍摆出来对比。
**Suggestion**: 在 D-1 补一段三选一对照表（rank 100 项目根 / rank 400 用户根 / rank 300 `customSkillDirs`），写清各自代价与推荐场景；把「旧副本遮蔽」从「特性」变成 status 的显式检测项（发现同名列存在于其它已知根 → 警告），否则用户只会看到「压过」而不知道压过了谁。

#### Issue 15 (Medium): 同名遮蔽（shadowing）后果未进 spec，且 `list()` 只返回赢家、检测手段未定义
**Location**: `spec.md:55-58`、`design.md:7`
spec 只有「同目录其它 skill 不被影响 / MUST NOT 改动其它 skill 目录」——这是「不写」，而 rank 100 的**真实副作用**是「让别处的同名 skill 不可达」（design.md:7 明说「稳定压过其它位置的旧副本」）。这个副作用在 spec 里没有对应要求、没有警告、没有场景。同时 `ctx.skills.list()` 只返回胜出者，`source`/`path` 只能告诉你赢家是谁，无法直接暴露被遮蔽者；design 也没写如何检测。
**Suggestion**: 新增 Requirement/场景：安装与 status 时扫描本插件可枚举的候选根（`<projectRoot>/.agents/skills`、`<dshHome>/skills`、`<agentsHome>/skills`、本插件配置的 `customSkillDirs`），若存在同名 `SKILL.md` → status 警告「已遮蔽 <路径>（rank X，版本 Y）」；用 fixture 目录补一条测试。

#### Issue 16 (Medium): `status` 被要求含「源是否可达」，但未区分实时探测与缓存结论
**Location**: `spec.md:119,123-124`、`tasks.md:28`
「源是否可达」若在 status 内联探测，则页面（change 4）与健康检查（change 2）每次读状态都会发一次外网请求，与「状态查询」的只读语义和目标（页面 ≤500 ms、健康检查非阻塞）冲突；spec 也没写清 `sourceReachable` 的时效。
**Suggestion**: status 返回缓存结论 `sourceReachable: { state, checkedAt, reason }`，MUST NOT 内联发起网络请求；实时探测只发生在 `install/update/autoCheck`；把这条写成 spec 要求并在工具描述里说明。

#### Issue 17 (Medium): 缺 `uninstall`/清理出口，回滚路径靠「手工删除目录」
**Location**: `design.md:85`（Migration Plan 回滚）、`spec.md:119,126-134`（出口只有 install/update/status）、`tasks.md:28`
一个自更新安装器的回滚动作写成「禁用插件行 + 手工删目录」，既不可验收，也管不了 `meta.json`、stage/backup 残留与「插件已禁用但 skill 仍在宿主里可被发现」的遗留状态；禁用后再启用时 status 还会读到孤儿 `meta.json`。
**Suggestion**: 增加 `tq_skill_manage(action: 'uninstall')`（可选 `purge` 语义）：删除本插件的落点 + 清理临时/备份 + 处理 `meta.json`（保留或删除可选）、幂等返回；spec 出口表与 tasks 同步；验收写成「uninstall 后 `list({cwd})` 不再命中且落点目录与残留均不存在」。

#### Issue 18 (Medium): 零 mock 测试清单不足以覆盖真正的风险面（安全 / 发现 / 失败路径）
**Location**: `tasks.md:9`（1.7）、`tasks.md:30`（4.3）、`tasks.md:24`（3.5）
1.7 的 5 条断言都是「正常路径 + 回滚」，缺：zip-slip/恶意路径、超大包、条件请求双缺、源忽略条件请求、并发两次安装、降级、保号篡改、cwd≠projectRoot、遮蔽检测。更根本的是两个关键断言在纯单测里无法验证：**「装到宿主真能发现的位置」**（需要真实 registry）与**「不写 vault」**（vault 在 change 2 才由 `dataRoot` 定义，本 change 无该配置面，对一个未配置路径断言「没有写」是空断言）。
**Suggestion**: 分三层：①纯函数（根解析 / 条目路径校验 / 版本比对 / 更新判定）表驱动单测；②集成层用真实 `@deepseek-ai/dsh-skill` registry + 真实临时项目根断言 `list({cwd})` 命中与 `source/path` 一致（这才能真正验收「可被发现」）；③「不写 vault」改为对真实 vault 路径做安装前后清单/哈希 diff（未配置 `dataRoot` 时显式 skip 并输出说明，而不是假成功）。

#### Issue 19 (Medium): 缺溯源台账与 roadmap 重排——这是**下载的第三方产物**，两条纪律都落在本 change 身上
**Location**: `proposal.md`（无台账/roadmap 项）、`tasks.md`（无）、`AGENTS.md:37-39`、`docs/roadmap.md:24`
TQ skill 既不是本仓代码也不是从 dsh-trading 搬运，而是从 TDX 官方 zip 获取的外部资产；AGENTS 的搬运纪律要求「带溯源（台账记录来源 + 偏离）」且 `docs/carryover.md` 是唯一台账，但本 change 无任何记录动作，来源/版本/哈希只存在本机 `meta.json`（换机/重建即丢）。同时 roadmap 仍把阶段 3 写成「connector-tdx + research-data 搬运」（`docs/roadmap.md:24`），与「TQ 能力走 skill、不固化进 TS」的定案冲突，而本 change 恰恰是这个转向的执行件却没有 roadmap 影响项（与 `reviews/daily-summary-review.md` Issue 10 同类）。
**Suggestion**: tasks 增加「写入 `docs/carryover.md`（或新增外部资产台账段）：源 URL + 首次获取时间 + 版本 + SHA-256 + 适用范围 + 已弃用的 vault 副本记录」，status 输出同一组字段；同时在 `docs/roadmap.md` 补「迭代一重排」小节，写明阶段 3 的 TQ 通道由「搬运连接器」改为「官方 skill 安装器」，并引用本 change。

#### Issue 20 (Low): `contributes.tools/skills` 与实现面脱节，manifest 是否被消费未能核验
**Location**: `dsh.plugin.json:9-12`（`contributes: { tools: [], skills: [] }`）、`design.md:11`
本 change 的工具注册走 `ctx.tools.register(defineTool(...))`（已核验 `packages/core/tools/src/schema.ts:554`），manifest 里仍是空数组；我在 `E:\work\code\open\deepseek-harness\packages` 内 grep `dsh.plugin.json` **无任何命中**（清单渠道可能只存在于 app.asar 或不消费该字段，未能核验），因此无法判断此处不同步是否有后果。
**Suggestion**: 核验 bundle/市场渠道是否消费 `dsh.plugin.json.contributes`；若消费则同步 `tools` 名与 skill 声明，若不消费则在 AGENTS/文档注明该段属市场渠道约定（避免后来者以为「skill 要靠这里声明」而误判本 change 的安装方式）。

#### Issue 21 (Low): `.gitignore 增加 .dsh/` 的作用域被高估，且粒度偏粗
**Location**: `proposal.md:31`、`tasks.md:14`、`.gitignore:1-5`
本仓 `.gitignore` 当前只有 5 行（`node_modules/`、`lib/`、`coverage/`、`*.tsbuildinfo`、`.DS_Store`）。加 `.dsh/` 只能保住**本仓**的 git 状态干净，而安装落点是**宿主当前项目根**（可能是用户其它仓库），本 change 无法为其加忽略规则；「不应污染 git 状态」的承诺因此在多数使用场景不成立。粗粒度忽略整个 `.dsh/` 也可能在未来误伤 DSH 在项目 `.dsh/` 下的可版本化内容。
**Suggestion**: 改为按需粒度（`.dsh/skills/`）；把「可选：在安装目标仓库忽略 `<installDir>`」写成安装后提示（用读取目标根 `.gitignore` 判断并提示，不引 shell/依赖）；status 里可顺带标注忽略状态。

### Positive Aspects

- **宿主事实这次基本可信**：rank 常量（`skill-filesystem/src/index.ts:36-40`：100/200/300/400/500）、roots 推入顺序与 `.dsh/skills` rank 100（`:245-265`）、frontmatter 只强制 `name`+`description` 且 `name` 走 `isSkillName`（`:814-840`）、`ctx.skills.list()/get()`（`skill/src/index.ts:470-500`）、`defineTool`（`core/tools/src/schema.ts:554`）、`BUNDLED_SKILL_RANK=600`（`skill/src/index.ts:28`）全部逐条核对为真；`version` 不被宿主解析的判断也成立（`optionalMetadata` 只取 `metadata` 键）。
- 顺带澄清了一处历史疑问：`reviews/daily-summary-review.md` Issue 8 认为 `76-89` 与 `36-40/245-265` 是「互斥行号」，实测**两者都成立**（`:76-89` 是 Config schema，`customSkillDirs` 在 `:81`；`:36-40` 是 rank 常量；`:245-265` 是 roots 推入），不矛盾——本 change 唯一引错的行号是 `964-970`（见 Issue 13）。
- D-6「不注册 `ctx.skills.register`」是正确判断：宿主已有 `skill-filesystem` 扫描，双写会造成两层真相；只写文件 + 只读核对的方向对，只是核对参数写漏了（Issue 1）。
- 边界三条（不碰 17709 / 不写 vault / 不内置 skill 内容）与 AGENTS 安全红线、「TQ 能力不固化进 TS」的定案一致，且「不依赖 PowerShell Expand-Archive（依赖 shell 且 Windows-only）」的否决理由站得住。
- 失败语义写得好且正确：源不可达不是错误、保留现版、警告不阻断挂载（`design.md:58,70`；`spec.md:96`），与 change 2 的「异步探测 + 状态出口」模式同构，避免了把网络故障升级为插件不可用。
- D-2 有 spike 意识：先验证所选库能否给出「截断 zip」的完整性失败信号，不达标换 `yauzl`（`design.md:37`、`tasks.md:5`），比直接拍板选型好；「结构校验为主判据、不依赖库的 CRC 行为」也是对的。
- Open Questions 与 Risks 诚实：公开哈希缺失、多工作空间、基线维护节奏都写出来了，评审可以直接在此基础上补控制项而不是重新发现。

### Summary

Top 3 关键问题：
1. **Critical — 可发现性核对必然失败**：`ctx.skills.list()` 不传 `cwd`（宿主只在 `cwd !== undefined` 时才扫 rank 100 项目根），D-6 与 spec `状态查询出口` 的「经宿主 skills 服务确认」不可实施，且会给出反向的假警告；
2. **Critical — 备份目录本身被宿主发现为同名 skill**：D-3 把旧目录改名成根下一层含 `SKILL.md` 的目录（宿主无 dot 过滤），在「删除失败被容忍」时形成「装好了但 agent 读旧版、状态说新版 OK」的长期假绿，同时 `spec.md:48` 的「无残留」与 `design.md:48` 直接冲突；
3. **Critical — 更新路径可静默降级 + 解压无防护**：源标识变化即替换且不比较远端版本（可把 1.2.0 静默降回旧版），zip 校验完全没有条目路径/符号链接/解压规模防护，而落点是宿主的 skill 扫描根。

（紧随其后：无哈希因而保号篡改不可检、`autoCheck` 默认开且未定义是否自动安装 + 重定向不校验、配置面与出口所有权未定且 proposal 谎报「无 Modified Capabilities」、并发/`<ts>` 碰撞无锁。）

补充限制（未能核验项，见文末）：M1-Q1/M1-Q5 裁决原文与「模块文档 D5/§9」不在本仓，无法核验；官方 zip 的真实包内布局（`SKILL.md` 在根还是 `tdx-tq-local/` 下）、`Last-Modified` 头真实形态、是否支持 ETag/304、是否 30x 跳转均未实测；`dsh.plugin.json` 是否被 DSH 消费未能核验；OneDrive/杀软下的目录改名语义未实测。

**Consensus Status**: NEEDS_REVISION

---

## Round 2 — 2026-09-27

### Overall Assessment

这轮修订是实质性的、不是文档润色：Round 1 的 4 条 Critical 有 3 条在 **spec 层**拿到可测场景（解压加固 6 项 + 恶意包/规模场景、降级闸门三态 + `force`、暂存/备份移出扫描根 + `ok===false` 残留语义、`list({cwd})` 必传），`contracts §7` 与 change 2 的「两条具名通道」也确实已回写落地，21 条里 16 条完全闭合。但修订把安装器泛化为「两种源」时只泛化了**源**，没有泛化**目标根 / skill 名 / 可发现性 / 状态**：于是与 change 5 的落点（`<数据根>/agent/skills/<name>`，在 vault 内）以及本 change 自己的「不写 vault」场景、「`installDir` 不得位于 `dataRoot`/vault 内」校验正面冲突；同时 `installDir` 反推 `projectRoot` 的启发式在合法配置下会算出错误的根（把 Round 1 Critical #1 的假 `not-discovered` 换了个成因带回来），`health.status()` 两段视图又被 change 2 与 change 3 双重实现。这些属返工/不可验收级，不属实现期细节。
**Rating**: 7/10

### Previous Round Tracking

| # | Issue | Status | Notes |
|---|-------|--------|-------|
| 1 | 可发现性核对不传 `cwd` 必然失败 | 部分解决 | `cwd` 必传已进 spec（`spec.md:263-266`）与 D-6，三来源表在 `design.md:60-66`；但「由 `installDir` 反推」在相对 `installDir`（D-13 明确允许）与 `<dshHome>/skills`（D-1 自己推荐）上推出错误 `projectRoot` → 见 N1。 |
| 2 | 备份目录被宿主当同名 skill | 已解决 | 暂存/备份移到 `dirname(installDir)/.dsh-trader-kit-tmp/<mkdtemp 运行目录>/`（`design.md:100-108`、`spec.md:85-88`）；`ok===true` 仅当 `residue` 空、清理失败 `installed-with-residue`+`ok:false`（`spec.md:90,104-108`）；旧布局 `.*backup-*` 迁移（`design.md:298`）。 |
| 3 | 更新可静默降级 | 已解决 | `spec.md:126-152` 三态表 + 3 场景，显式禁止「源标识变化即替换」（`spec.md:136`）；`force` 入参（`tasks.md:101-104`）。 |
| 4 | zip 无路径/规模防护 | 已解决 | `spec.md:54-79` 六项 + 穿越/symlink/规模三场景；写出前中央目录预检 + 写出中累计复核（`spec.md:63`）；`tasks.md:23-25` 逐条单测。 |
| 5 | 供应链：哈希/重定向/自动安装闸门 | 已解决 | `https:`+`redirect:'manual'`+超时/重试/字节上限（`spec.md:365`）、`autoCheck` 只检查不安装（`spec.md:186`）、`content-drifted`（`spec.md:158`）；官方哈希白名单**显式后置并写明「无来源哈希只制造虚假安全感」**（`design.md:303`）——残余风险已声明，不算未解决。 |
| 6 | 「零下载」不可判定 | 已解决 | `spec.md:188`（304 或 HEAD、响应头原样存储、双缺退化为 `version+SHA-256` 判等零替换）+ `design.md:129-134` + `tasks.md:89-92`。 |
| 7 | spec 与 design 备份残留硬冲突 | 已解决 | 拆两条场景（`spec.md:98-108`），`design.md:112-117` 改「不报成功」。 |
| 8 | 并发/重入无保护、`<ts>` 碰撞 | 已解决 | `fs.mkdtemp` + 进程内 mutex + 锁文件（含 pid/持锁时间/10 分钟接管）（`design.md:183-189`、`spec.md:328-341`）；`rejected` 与成功区分。 |
| 9 | 配置面所有权与 `installDir` 语义 | 部分解决 | 依赖与字段已声明（`tasks.md:3,116-119`、`design.md:220-236`），但 `src/config.ts` 被 change 2 与 change 3 同时声明为产物，且 `contracts §0` 仍写 change 3「无依赖」——见 N4。 |
| 10 | proposal 谎报「Modified Capabilities: 无」 | 部分解决 | `proposal.md:28-30` 已改列 `data-tool-contract`；但 Lead 同期把两段视图直接落地进 change 2 自己的 spec/design/tasks（`data-foundation/.../data-tool-contract/spec.md:265`、`design.md:107`、`tasks.md:172`），change 3 的「本 change 扩展其返回体」由此变成双重拥有——见 N3。 |
| 11 | `version` 被称唯一护栏 | 已解决 | D-9 以内容哈希为主判据（`design.md:176-181`、`spec.md:158,178-182`）；`proposal.md:39` 验收收窄到三类可判定情形。 |
| 12 | 下载器绕开「唯一出站闸门」 | 已解决 | `spec.md:363-380` 两条具名通道 + 7 条替代护栏；`contracts §7:139-141`、`data-foundation/design.md:83`、`tasks.md:53` 均已回写为「数据面唯一闸门 + 第二条具名通道」。（回写表状态过期见 N7。） |
| 13 | 行号引用错位 / 「否则 cwd」 | 已解决 | F2 改符号名并标 945-955（`design.md:14`）；D-1 三来源 + 禁 `process.cwd()`（`design.md:58`）；`tasks.md:54-56` 三条用例。 |
| 14 | rank 100 三选一取舍未论证 | 已解决 | `design.md:68-74` 对照表（rank 100/400/300）+ 代价与推荐场景；遮蔽改由 D-6 显式报出。 |
| 15 | 同名遮蔽未进 spec | 已解决 | `spec.md:261-291` Requirement + 4 场景（含「已遮蔽 `<路径>`（rank X，版本 Y）」）；`tasks.md:66-69` fixture 断言三字段。 |
| 16 | `sourceReachable` 实时/缓存未区分 | 已解决 | `spec.md:392` + 场景「状态查询不产生出站」（`spec.md:216-220`）；`design.md:263`。 |
| 17 | 缺 uninstall / 回滚靠手工删目录 | 已解决 | `spec.md:343-361`（幂等、`purge`、`nothing-to-do`）；`design.md:297` 回滚改 uninstall；`tasks.md:132-135`。 |
| 18 | 零 mock 测试面不足 | 已解决 | 三层分工（`tasks.md:35-46,58-73,97-112`）+ 零 mock 纪律（`tasks.md:6`）+「不写 vault」改真实路径 diff、未配置 `dataRoot` 显式 skip（`spec.md:302-306`）。**但**该场景与 change 5 落点冲突，见 N2。 |
| 19 | 缺溯源台账与 roadmap 重排 | 已解决 | `tasks.md:143-146` 外部资产台账；我独立核读确认 `docs/roadmap.md:80` 确已含「阶段 3 … 改为三方接口工具 + TQ skill 安装器」，R4「已就位」为真。 |
| 20 | `contributes` 与实现面脱节 | 部分解决 | 仍不可核验（本会话宿主源码不可达；`dsh.plugin.json:9-12` 现为空数组）；已落 `tasks.md:151-154` 二选一处置 + Open Q7。原为 Low，后置可接受。 |
| 21 | `.gitignore` 作用域高估、粒度粗 | 已解决 | `tasks.md:62-65` 粒度化 + 目标仓库只提示；`spec.md:415` + `installDirIgnored` 字段；Risks（`design.md:290`）。 |

### Issues

#### N1 (High): `installDir` 反推 `projectRoot` 在合法配置下失效，把 Round 1 Critical #1 的假 `not-discovered` 换了成因带回来
**位置**: `design.md:63-64`（D-1 表第 2/3 行「由已配置的 `installDir` 反推 … 取两级 dirname」）、`design.md:227`（相对路径以 `<projectRoot>` 为基）、`design.md:72-74`（把 `<dshHome>/skills` 列为推荐候选）、`tasks.md:56,86`
**描述**: 三来源表把「`installDir` 反推」当成已闭合路径，但「取两级 dirname」只在 `installDir` 恰好形如 `<projectRoot>/<a>/<b>`（默认 `<projectRoot>/.dsh/skills`）时等号成立。① 相对 `installDir`（D-13 明确允许）在无 `cwd` 时根本无法解析，反推无输入；② 绝对 `<dshHome>/skills`（D-1 自己推荐的跨工作空间候选）两级 dirname 得到 `<dshHome>` 的父目录，`projectRoot` 直接算错；③ 任意自定义根（如 `<projectRoot>/skills`）同理。错误 `projectRoot` 会被写进 `resolvedCwd`/`projectRoot`/`cwdSource`（`design.md:66`）并用于 `list({cwd})`（`spec.md:265`），核对再次给出假 `not-discovered`；而 `autoCheck`（默认开启）走的正是这条路径。Issue 1 的「三路径闭合」在字面上成立、在语义上未闭合。
**建议**: `resolvedCwd`/`projectRoot` 在首次安装时**持久化**（如 `meta.json.projectRoot`），此后 service/autoCheck 优先取记录值；`installDir` 反推仅在「绝对路径且其祖父与记录值一致或含 `.git`」时使用，否则**拒绝执行并提示**（与工具出口同处置）；补三条用例：`installDir = <projectRoot>/skills`、`installDir = <dshHome>/skills` 下 `status().projectRoot` 必须等于真实项目根，相对 `installDir` 且无 `cwd` 时必须显式拒绝。

#### N2 (High): 「两种源」只泛化了源——目标根/skill 名/可发现性/状态未参数化，且与 change 5 落点、「不写 vault」、「`installDir` 校验」三处正面冲突
**位置**: `spec.md:227-237`（本地目录源）、`spec.md:261-291`（`name === 'tdx-tq-local'`、`path.join(installDir,'tdx-tq-local','SKILL.md')` 写死）、`spec.md:293-306`（「不写 vault」场景把 `部署` 纳入并对整仓 vault 做 diff）、`design.md:191-209`（D-11）、`design.md:236`（D-13「不得位于 `dataRoot`、vault 目录…内」）、`design.md:100-108`（D-3 步骤 7/8 写死 `tdx-tq-local`）、`tasks.md:121`（deploy 入参只有 `sourcePath?`）；对照 `daily-summary/specs/daily-summary/spec.md:432-434`、`daily-summary/design.md:143-149`、`daily-summary/proposal.md:32`。
**描述**: change 5 明确要求经 change 3 的 local-dir 源部署**自产 skill**，落点在 `dataRoot`（vault）内的 `<数据根>/agent/skills/review-daily-summary/`。而 change 3：① `deploy` 的目标根与 skill 名没有入参语义，可发现性核对与 `SkillStatus.skillPath`、D-3 改名路径一律写死 `tdx-tq-local`/`installDir`，因此「两种源复用同一可发现性核对」（`spec.md:229`）对 change 5 不可用；② `installDir` 校验禁止落在 `dataRoot`/vault 内——那正是 change 5 的合法落点；③「不写 vault」场景把 `部署` 也纳入并对真实 vault 做全目录 diff，change 5 的部署必然使其失败。叠加后果：change 5 要么违反 change 3 的 spec，要么退回它自己的降级路径「人工放置 + README」（其 Open Q10），即本 change「供 change 5 复用」的 D7 卖点不成立。另：`minVersion` 基线（默认 `1.2.0`）是 TQ 专属，对 change 5 的 skill 会产生假 `version-below-baseline`。
**建议**: 为 deploy 给出具名签名与目标语义（如 `deployLocalDir({ sourcePath, targetRoot, name })`），可发现性核对/状态/`skillPath` 全部由 `name` + `targetRoot` 参数化（`tdx-tq-local` 只是默认实例）；把「不写 vault」收窄到 `<vault>/.claude/**` 与已弃用副本，并显式豁免 `contracts §10` 与 change 2 的 `agent/skills/` 自产 skill 区；`installDir` 的 `dataRoot`/vault 禁令限定在 https 下载落点；`minVersion` 基线只在 https 源生效。若不做，需在 proposal/design 明写「change 5 走人工放置」，并撤回「供 change 5 复用」的表述。

#### N3 (High): `health.status()` 两段视图被 change 2 与 change 3 双重拥有、双重实现
**位置**: change 3 `proposal.md:19,30`、`design.md:164-170`（D-7「本 change 扩展其返回体为两段」）、`design.md:244-253`（D-15）、`tasks.md:124-127`（4.3 产物含 `api.health.status()`）；对照 change 2 `specs/data-tool-contract/spec.md:265,287-290`、`design.md:107`、`tasks.md:172`（7.2 已自行实现两段并透传 change 3 的 `skill.status()`）。
**描述**: Issue 10 的处置方向（proposal 改列 Modified Capability）已完成，但同期 change 2 已把两段视图写成**自己的** Requirement 与任务，于是同一 `health.status()` 有两个 owner：change 2 说「`skill` 段为 change 3 的 `skill.status()` 透传（由本 change 组装）」，change 3 说「本 change 扩展 `health.status()` 返回体」。两个 change 都产出同一个 `src/service.ts` 的同一函数，change 2 spec 的「组合读取、MUST NOT 各自重复实现」在落地时无判据；change 3 的 `Modified Capabilities: data-tool-contract` 也已过期。
**建议**: 唯一 owner = change 2（组装 `{data, skill}`）；change 3 只提供 `skill.status({cwd?})` + `buildSkillStatus()`。change 3 的 Modified Capabilities 改为「无（该出口由 change 2 拥有）」或撤回 R3；`tasks.md` 4.3 删去 `api.health.status()` 产出，改为「实现 `buildSkillStatus()`/`skill.status()`，其返回值即 change 2 两段视图的 `skill` 段」，保留字段一致性与「`status()` 不出站」用例。

#### N4 (Medium): 跨 change 产物所有权与依赖登记不一致——`src/config.ts` 双份产出、`contracts §0` 仍写 change 3 无依赖
**位置**: change 3 `tasks.md:3`（blocked_by change 2 的 `Config`/`dataRoot`、`health.status()`）、`tasks.md:116-119`（4.1 产物 `src/config.ts`「含 change 2 的 `dataRoot` 与本 change 的 `skill` 段」）、`proposal.md:36`；对照 change 2 `tasks.md:3`（1.1 同样产出 `src/config.ts`/`export const Config`）与 `docs/design/iteration-1-contracts.md:14`（`change 3 | 无（可独立先行）`）；回写清单 R1–R6（`design.md:310-319`）无 `§0` 项。
**描述**: 配置面被两个 change 各自声明为产物、且都要写同一个 `export const Config`（单 package、单文件）；`contracts §0` 的依赖表与 change 3 tasks 头的 `blocked_by` 直接矛盾（一个说可独立先行，一个说依赖 change 2），而回写清单没有 `§0` 条目。这不是措辞问题：change 3 若先于 change 2 实现，`Config` 归谁、`dataRoot` 是否由它补，落地时无判据。
**建议**: 明确「`src/config.ts` 唯一 owner = change 2；change 3 只在其后**追加** `skill` 段，不改 `dataRoot` 默认值与既有字段」，并写进 tasks 4.1 的产物/依赖；新增回写项 R7：`contracts §0` 的 change 3 依赖改为「change 2（`Config`/`dataRoot`、`health.status()` 接口）」。

#### N5 (Medium): 「无 `cwd` 来源 → 拒绝执行」只在 design/tasks，spec 无场景；`autoCheck` 验收可被空过
**位置**: `design.md:60-66`（D-1 表）、`tasks.md:56`（2.2④）；`spec.md:382-399`（「查询状态」场景在**不传任何入参**的 `traderKit.skill.status()` 下仍要求返回全部字段）；`spec.md:186`、`tasks.md:85-88`（3.2②「第二次挂载零出站」）。
**描述**: D-1 规定无来源必须拒绝，但 spec 没有对应场景，且「查询状态」场景的字面（无 `cwd` 的 `skill.status()`）与「无 `cwd` 且无 `installDir` 即拒绝」冲突——默认 `installDir` 为 `''`，该场景在默认配置下必失败。同一处使 3.2② 成为空过：默认配置下 autoCheck 只会「跳过 + warning」，永不出站，「第二次挂载不出站」无需节流逻辑即通过，而「第一次确实出站一次」的正向控制没有断言。
**建议**: spec「状态查询出口」补场景「无 `cwd` 且无 `installDir` → 显式拒绝（含来源说明），MUST NOT 猜测」，并把「查询状态」场景改为显式 `skill.status({ cwd })`；tasks 3.2 增加正向控制：可反推 `installDir` 时首次挂载恰好一次出站、第二次为零，另立「无来源 → 跳过 + warning、零出站」用例。

#### N6 (Medium): 「`installDir` 不是任何 root 的后代」与 `knownSkillRoots` 含 `installDir` 自身，语义未定义
**位置**: `design.md:100-101`（D-3 第 2 步把 `installDir` 放进 `knownSkillRoots`，同时要求断言 `installDir` 不是任何 root 的后代）、`spec.md:87,110-113`、`tasks.md:29①,118②`（`TMP_AREA_IN_SCAN_ROOT`）。
**描述**: `knownSkillRoots` 第一个元素就是 `installDir`，`assertNotInside(installDir, installDir)` 在「前缀比对」实现下是否因相等而失败，两种实现都说得通：可能让**每次安装**都报 `TMP_AREA_IN_SCAN_ROOT`，也可能因实现者顺手排除 self 而漏掉真正该拦的情形（`installDir` 落在更前 rank root 内）。用例只覆盖「是后代 → 报错」，没覆盖「等于默认根 → 正常」。
**建议**: 拆成两条并写进 spec：① `assertNotInside(tmpBase, root)` 对所有 root（含 `installDir`）；② `installDir` MUST 等于某个登记 root（默认 `<projectRoot>/.dsh/skills`）且 MUST NOT 是其它更前 rank root 的后代；补「`installDir` 取默认值 → 不报错」的反向控制用例。

#### N7 (Low): 回写表状态与仓内现状不一致，D-12 仍以过期措辞为前提
**位置**: `design.md:213`（仍引「change 2 规定 guard 是所有出站请求的唯一闸门 / `contracts §7` 的断言是除 `src/data/http.ts` 外全仓零 `fetch(`」）、`design.md:314-316`（R1/R2/R3 标「待 owner 回写」）；对照 `docs/design/iteration-1-contracts.md:139-141`、`openspec/changes/data-foundation/design.md:83`、`data-foundation/tasks.md:53`、`data-foundation/specs/data-tool-contract/spec.md:257`。
**描述**: R1/R2/R3 的目标内容**已经落地**（`§7` 已写两条具名通道；change 2 D-4/D-5 已改「数据面出站唯一闸门 + 第二条具名通道」；change 2 spec/tasks 7.2 已有两段视图），change 3 却仍记为待回写、D-12 仍在复述旧措辞。按表执行「回写」会覆盖已正确的文本。
**建议**: R1/R2/R3 标「已就位（2026-09-27 核读，指向具体行）」或直接删除；D-12 引文改为「收窄前措辞已回写，见 `contracts §7` 两条通道」；只保留 R5/R6/R7 为待办。

#### N8 (Low): 产物清单与 tasks 不一致（漏 `version.ts` / `gitignore-notice.ts`，未列解压库依赖）
**位置**: `proposal.md:34`（`src/skill/{root,download,zip-guard,validate,installer,state,status,update,downgrade,hash,lock,discovery,shadowing,uninstall,local-source,source,autocheck}.ts`）、`design.md:78-80`（选型 `fflate`/备选 `yauzl`）、`tasks.md:11`（1.1 `version.ts`）、`tasks.md:63`（2.4 `gitignore-notice.ts`）。
**描述**: Impact 的「新增代码」漏了两个 tasks 明确产出的模块；「新增依赖」只写「设计选型见 design.md D-2」，未给出库名或候选（库名要到 tasks 1.3 才定）。
**建议**: 清单补 `version.ts`、`gitignore-notice.ts`；依赖写「zip 解压库（`fflate`，备选 `yauzl`；选型门禁见 tasks 1.3）」。

### Positive Aspects

- **Round 1 的 Critical 不是口头认领**：解压加固 6 项、「更新不得静默降级」三态表、暂存/备份移出扫描根、`residue` 进状态、`force`、`uninstall` 幂等——全部落成 spec 场景，并给出可判定证据形态（`residue === []`、目标目录逐文件 SHA-256 不变、注入式「删除失败」用例、`list({cwd})` 不出现残留路径），这是本轮最大的进步。
- **暂存区布局的修正切中根因**：`dirname(installDir)` 的兄弟目录 `.dsh-trader-kit-tmp/<mkdtemp>/stage/<name>/` 从结构上让宿主「一层目录 + 其下 `SKILL.md`」的发现逻辑扫不到临时物，而不是靠 dot 前缀或删除时序碰运气；还补了旧布局 `.*backup-*`/`.*stage-*` 的迁移与残留重试清理。
- **「零下载」与降级两处语义被写成可实现形态**：零**体**下载（304 / HEAD 比对）、响应头字符串原样存储（明确拒绝日期重格式化）、双标识皆缺退化为 `version + SHA-256` 判等零替换、`remote < installed` 默认拒绝并记 `downgrade-blocked` + 新旧源标识。
- **zip-guard 与库解耦**：中央目录预检 + 写出中累计复核（防 `uncompressedSize` 说谎），并以「结构校验为主判据、不依赖库 CRC 行为」收口，比单纯选一个「更严格的库」稳。
- **事实核验纪律升级且自我设限**：符号名引用 +「已核验/已实测 vs 待验证」两节 + 每项待验证都带降级策略，并明写「行号本会话未复核」；Round 1 指出的 `964-970` 错位已按此收口为 `findProjectRoot`（约 945-955）。
- **两条跨 change 纪律真的接上了**：`tasks 5.1` 外部资产台账、`tasks 5.4` 发布产物个人路径核查。我独立核读确认 `cordis.patch.yml:11` 注释里确有本机绝对路径（指向 `DSH-better-sidebar`），该清理项是实证而非猜测；`docs/roadmap.md:80` 的重排也已就位（R4 属实）。
- **tasks 质量**：35 条全部含「产物 / 验收 / 依赖」，验收多为可判定证据（哈希、字段名清单、桩服务计数、`mkdtemp` 100 次无重复、`grep -c` 为 0），并明令零 mock（`node:http` 真实桩）与扫描型用例先断言目标非空。

### Summary

Top 3：
1. **High — 「两种源」只泛化了源（N2）**：目标根/skill 名/可发现性/状态写死 `tdx-tq-local`，导致 change 5 的部署复用不成立，且与「不写 vault」场景、`installDir` 的 `dataRoot`/vault 禁令正面冲突——本 change 的第一卖点（D7 供 change 5 复用）在 spec 层不可用。
2. **High — `installDir` 反推 `projectRoot` 失效（N1）**：相对 `installDir`、`<dshHome>/skills`、任意自定义根下算出错误 `projectRoot`（写进状态并用于 `list({cwd})`），`autoCheck` 默认路径重新制造 Round 1 Critical #1 的假 `not-discovered`。
3. **High — `health.status()` 双重拥有（N3）**：change 2 已自行落地两段视图并透传 change 3 的 `skill.status()`，change 3 仍声明「扩展其返回体」并产出同一个 `api.health.status()`，「同一实现」不变量与 `src/service.ts` 写范围都无判据。

（紧随其后：`src/config.ts` 双份产出与 `contracts §0` 依赖表矛盾（N4）；「无来源拒绝」只在 design/tasks、`autoCheck` 验收可空过（N5）；`knownSkillRoots` 自比较语义未定义（N6）；以及回写表状态过期、产物清单漏项两处 Low。）

补充限制（未能核验项）：宿主源码在本会话仍不可达，F1–F7 与变更后的宿主行为**未在本轮复核**，我仅核读了仓内文件（change 1–5、`contracts`、`roadmap`、`.gitignore`、`cordis.patch.yml`、`dsh.plugin.json`）；官方 zip 真实布局/ETag/304/30x 与 OneDrive-杀软下的改名语义仍未实测（沿 design 待验证表）；`dsh.plugin.json#contributes` 是否被市场渠道消费未核验。

**Consensus Status**: NEEDS_REVISION

---

## Round 3 — 2026-09-27

### Overall Assessment

Round 2 的 N1–N8 我逐条核**正文**（`contracts §0/§7/§10/§11/§12.2`、design 的 D-1/D-3/D-4/D-6/D-7/D-11/D-13/D-15 与两轮处置表、spec、tasks、proposal）而不采信处置表自述：**8 条全部实质闭合**，Round 2 Tracking 里 4 条「部分解决」也已收口（#1/#9/#10 真闭合；#20 按 Low 后置且已进 Open Questions）。记录优先的根解析、`deployLocalDir({ sourcePath, targetRoot, name })` 目标参数化、`health.status()` 单一 owner、`src/config.ts` 追加式、spec 的无来源拒绝场景、两条独立暂存区断言、回写表状态、Impact 清单——都落成了可判定的正文，不再是口头认领。

但本轮找出**两处新引入的跨 change 矛盾**（都由 Round 2 的修订引入，且都在 spec 级）：① N5 的「无来源 → 显式拒绝」与 change 2 `health.status()` 的 `skill` 段透传没有裁决——change 2 spec 只定义「change 3 **未挂载** → `skill: null`」，未定义「**已挂载但拒绝**」，而首装前/无记录值正是该拒绝的常态，`health.status()` 因此会违背自己的两段场景；② D-3 的暂存区公式在 change 5 的合法落点下把目录写进 `contracts §10` 白名单之外的 vault 路径，与本 change 自己的「不写 vault」MUST 正面冲突。两条都属返工级，不属实现期细节。

**Rating**: 7.5/10

### Previous Round Tracking

（N1–N8 + Round 2 判为「部分解决」的 #1/#9/#10/#20；状态基于本轮独立核读正文）

| # | Issue | Status | 核验证据（正文） |
|---|-------|--------|------------------|
| N1 | `installDir` 反推 `projectRoot` 失效 | 已闭合 | `design.md:60-77`（首装持久化 `meta.json.resolvedCwd`/`projectRoot` + 三来源表 + 受限反推 + 拒绝）、`spec.md:81-121`（Requirement + 5 场景，含「反推条件不满足被拒绝」「相对 `installDir` 被拒绝」）、`tasks.md:32,51,56`（1.6④、2.1、2.2⑤–⑧）。残余：反推只在「无记录值」时启用，「祖先与记录值一致」分支实际不可达（见 Low-2）。 |
| N2 | 两种源只泛化了源 | 已闭合（本 change 侧） | `design.md:109-116,226-245,255,286-287,313`、`spec.md:280-287,318-322,326-331,362-377`、`tasks.md:121,130,147-150`：具名签名 + `targetRoot`/`name` 全参数化 + `<dataRoot>/agent/skills` 合法 + 「不写 vault」收窄并豁免 §10 白名单 + `installDir` 禁令只约束 https + `minVersion` 仅 https。**但** vault 落点的暂存区新增矛盾（N10），change 5 侧形参仍未同步（Low-4/R8）。 |
| N3 | `health.status()` 双重拥有 | 已闭合 | `proposal.md:28-30`（Modified = 无）、`design.md:194-195,296-305`、`tasks.md:3,124-127`（4.3 明写 MUST NOT 产出/注册 `api.health.status()`）、`spec.md:455-458,480-484`；change 2 侧 `data-tool-contract/spec.md:341,363-365`、`design.md:107`、`tasks.md:172` 与 `contracts §11`/`§12.2` 一致。**但**组合调用点的拒绝态未定义（N9）。 |
| N4 | `src/config.ts` 双份产出 / `§0` 依赖矛盾 | 已闭合 | `tasks.md:3,116-119`（在 change 2 的 `src/config.ts` 追加 + `blocked_by: change 2`）、`design.md:268`、`proposal.md:36`；独立核读 `contracts §0`（`iteration-1-contracts.md:14`）已是 change 2 依赖行（R7 属实）。 |
| N5 | 无来源拒绝只在 design/tasks；autoCheck 可空过 | 已闭合 | `spec.md:468-472`（查询状态改为显式 `cwd`）、`spec.md:474-478`（无来源显式拒绝场景）、`tasks.md:85-88`（3.2② 首次 1 次/第二次 0 次正向控制 + ③ 无来源零出站）。**但**拒绝语义未与 change 2 出口对接（N9）。 |
| N6 | `knownSkillRoots` 自比较语义未定义 | 已闭合 | `spec.md:127-131`（两条独立断言，明写「相等属于在内」+ `targetRoot` 必须等于某登记 root）、`spec.md:158-162`（默认落点反向控制场景）、`tasks.md:29,118`。 |
| N7 | 回写表状态过期 / D-12 措辞 | 已闭合 | `design.md:259,366-375`（R1/R2/R3/R4/R7 标「已就位」）；独立核验：`contracts §7:139-141`（两条具名通道）、`data-foundation/design.md:83`（「数据面唯一闸门」）、`data-tool-contract/spec.md:308,341`、`contracts §0:14`——四条均为真。 |
| N8 | Impact 漏 `version.ts`/`gitignore-notice.ts` 与库 | 已闭合 | `proposal.md:34-35`（补两模块 + `fflate`/备选 `yauzl` 与选型门禁）。 |
| #1（R1 遗留） | 可发现性核对不传 `cwd` | 已闭合 | `design.md:171-188`、`spec.md:324-332`、`tasks.md:58-60`；`cwd` 必传 + 记录优先的根来源 + `not-discovered`/`shadowed` 两类警告。 |
| #9（R1 遗留） | 配置面所有权与 `installDir` 语义 | 已闭合 | 随 N2/N4：`src/config.ts` 唯一 owner = change 2（追加式）、`installDir` 分治（https 禁令 vs localDir `targetRoot`），见 `design.md:266-288`。 |
| #10（R1 遗留） | proposal 误报 Modified Capabilities | 已闭合 | `proposal.md:28-30` 与 `design.md:413` 一致，唯一 owner = change 2。 |
| #20（R1 遗留） | `contributes` 是否被消费 | 后置（已登记，不阻断） | `tasks.md:151-154`（5.3 二选一）+ `design.md:31,361`（待验证表 + Open Q7）；本会话宿主源码仍不可达，仍不可核验；原评级 Low，进 Open Questions 后不作为返工项。 |

### Issues

#### N9 (Medium)：`health.status()` 的 `skill` 段透传与「无来源显式拒绝」冲突——「已挂载但拒绝」没有裁决点
**位置**: `specs/tq-skill-installer/spec.md:455-458,474-478,480-484`、`design.md:74,194-196`、`tasks.md:124-127`；对照 `data-foundation/specs/data-tool-contract/spec.md:341,363-365`、`data-foundation/design.md:107`。
**描述**: change 2 的两段场景要求 `health.status()` 在 change 3 已挂载时返回 `{ data, skill }`，且只把 `skill: null` 留给「change 3 **未挂载**」；而 change 3 的新场景规定 `traderKit.skill.status()` 在「无 `cwd`、无 `meta.json` 记录值、`installDir` 为空/相对」时**显式拒绝 + 返回显式错误**。`health.status()` 没有 `cwd` 可传，首装前 `meta.json` 也不存在——即**最常见状态**恰好落在拒绝分支。两边 spec 都没写这一情形：change 2 的 `health.status()` 会不会因此抛错/退化、`skill` 段该是 `null`、错误段还是 `{ state: 'missing', warnings }`，没有任何文本可判；由于 `health.status()` 是 change 2 的具名出口（并被 change 4 页面/诊断消费），这条歧义让上一轮刚收口的「单一 owner」在集成点重新裂开。tasks 4.3 的字段一致性用例（`spec.md:480-484`）显式传了 `cwd`，绕开了该分支，因此不会被自动发现。
**建议**: 二选一并写进 spec：①本 change 的拒绝**以返回体表达**（`state: 'missing'` + `resolvedCwd`/`projectRoot` 为 `null` + 拒绝原因进 `warnings`，仅工具出口抛显式错误）；或②保留拒绝语义，但由 change 2 的 `health.status()` 捕获并把 `skill` 置为 `null` 或 `{ state: 'unavailable', reason }`（登记为回写项 **R9**，并写明 `health.status()` MUST NOT 因 `skill` 段失败而失败）。无论哪条，补一条用例：**change 3 已挂载但无可解析根来源时调用 `health.status()`**，断言返回体形状与 `data.warnings`。

#### N10 (Medium)：change 5 形态下暂存区落在 `contracts §10` 白名单之外的 vault 路径——与自身「不写 vault」Requirement 正面冲突
**位置**: `design.md:120`（`tmpBase = path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp')`）、`spec.md:127`（暂存区 SHALL 同式）、`spec.md:285,318-322`（`targetRoot = <dataRoot>/agent/skills` 为合法落点）、`spec.md:362-377` 与 `tasks.md:130`（「不写 vault」= `dataRoot` 下既定业务区之外零写入，仅豁免 `agent/skills/`、`agent/DB/temp/dsh-trader-kit/`、`DB/review/`）；对照 `docs/design/iteration-1-contracts.md:167-174`。
**描述**: 对 change 5 的合法落点，`dirname(<dataRoot>/agent/skills)/.dsh-trader-kit-tmp = <dataRoot>/agent/.dsh-trader-kit-tmp`——**不在 §10 三条白名单内**，即「暂存区」本身就把新目录写进了 vault 的非白名单区；`installDir` 若被配到白名单内的 https 落点，同样触发。成功路径尚可争辩「已删除」，但 spec 的成功判据只对 `runDir` 做 `stat`（`design.md:130,136`），`tmpBase` 与 `<tmpBase>/lock.json` 属另一层，且**残留场景（`installed-with-residue`）是被 spec 允许的合法结果**——此时 `<dataRoot>/agent/.dsh-trader-kit-tmp/...` 会长期存在，直接违反「`dataRoot` 下既定业务区之外零写入」与 `tasks.md:130` 要求的 diff 断言；而 `contracts §10` 已为这套工具登记了 `agent/DB/temp/dsh-trader-kit/` 作暂存区，设计却另起了一个未登记的路径。Round 2 只核了「落点白名单豁免」，未把暂存区放进同一条判据（这是 N2 修复带出的新矛盾）。
**建议**: 让暂存区根也落在白名单内（vault 落点 → `<dataRoot>/agent/DB/temp/dsh-trader-kit/skill-tmp/`，非 vault 落点保留现式），或把该路径写进 `contracts §10` 白名单并登记回写项；同时把「`tmpBase` 及空目录在成功后零残留」写进 spec 的成功判据，并补一条 change 5 形态的 vault diff 用例（部署前后 diff 排除白名单后为空）。

#### Low（实现期细节，不构成返工）
- **Low-1 `meta.json` 路径未定义**：`tasks.md:31-33` 定义了字段与语义，但全文（design/spec/tasks）从未给出 `meta.json` 的存放位置；而 `spec.md:383-386`（落点被删但 `meta.json` 仍在）与 `uninstall` 的 `purge`（`spec.md:416,429-432`）**要求它不在落点目录内**。N1 之后它已是根解析的事实源，位置不定会让「记录优先」「孤儿记录」「残留」三组断言无法落地。建议在 D-3/D-13 写明路径。
- **Low-2 受限反推的死分支**：反推按定义只在「无记录值」时启用（`spec.md:87`、`design.md:74`），此时「祖先与记录值一致」恒不成立，实际只剩「含 `.git`」一条通道；用例（`tasks.md:56⑥`）也只用 `.git`。建议删掉该条件或改为「与本次会话 `cwd` 推出的根一致」。
- **Low-3 状态键清单与场景不一致**：`spec.md:460` 的 `skill` 段 MUST 键清单没有 `installDirIgnored`，但 `spec.md:512` 场景与 `tasks.md:63` 都要求该字段。补进清单即可。
- **Low-4 R8 仍待回写（跨 change）**：change 5 `tasks.md:30,50` 仍写 `checkDiscovery({ skills?, projectRoot, installDir })`，而本 change 的签名是 `{ skills?, projectRoot, targetRoot, name }`（`spec.md:328`、`design.md:176`）。已登记为 R8 且不阻塞本 change，但「供 change 5 复用」在字面上尚未成立。

### Positive Aspects

- **Round 2 的 8 条不是文档润色**：每条都能在 spec 找到可判定场景/断言形态——根解析 Requirement 的 5 场景（含两条拒绝）、`deployLocalDir` 具名签名 + 三态表、`health.status()` 的 MUST NOT 条款（含源码断言）、`src/config.ts` 的追加式与「`dataRoot` 逐字符一致」验收、默认落点反向控制、R1–R7 的核读行号。评审可以直接在正文上验收而不是靠信任。
- **N1 的处置方向正确**：把「反推」降级为记录缺失时的兜底、并让首装把 `resolvedCwd`/`projectRoot` 写进 `meta.json`，是从根因（根来源不可靠）而不是从症状（假 `not-discovered`）修。
- **N2 的四处分治干净**：目标根/名字参数化、`minVersion` 仅 https、`installDir` 禁令只约束 https 落点、「不写 vault」按 §10 收窄并显式豁免白名单——跨 change 依赖单独登记为 R8 并给了替代路径（Open Q8），没有把别人的文件偷改。
- **N6 用定义消歧**（「相等属于在内」+ 反向控制场景），比在实现里顺手加 `self` 例外更难被绕过。
- **回写表与事实一致**：R1/R2/R3/R4/R7 我逐条核读为真（`contracts §7:139-141`、`data-foundation/design.md:83`、`data-tool-contract/spec.md:308,341`、`contracts §0:14`、`roadmap §5`），把已就位项标出而不是重复回写，是上一轮 N7 的正确处置。
- **诚实的边界仍在**：官方哈希白名单显式不引入并给理由、`autoCheck` 只检查不安装、解压不执行脚本、内容审查列为 Non-Goal + Risks，未用「结构校验」冒充供应链安全。

### Summary

1. **N9 — Medium（本轮唯一新的集成阻断项）**：`health.status()`（change 2，无 `cwd` 可传）透传 `skill.status()`，而后者在无 `cwd`/无记录值时按新场景**显式拒绝**；两边 spec 都只写了「未挂载 → `null`」，没写「已挂载但拒绝」——首装前正是该状态，集成点语义空缺且无用例覆盖。
2. **N10 — Medium**：暂存区公式在 change 5 的合法落点（及白名单内的 https 落点）下写到 `<dataRoot>/agent/.dsh-trader-kit-tmp`，**不在 `contracts §10` 白名单内**，与自身「不写 vault」MUST 冲突，残留场景下长期成立；§10 已备有 `agent/DB/temp/dsh-trader-kit/` 可用。
3. **其余**：N1–N8 全部闭合；Round 2 的 4 条「部分解决」中 #1/#9/#10 已闭合、#20 按 Low 后置；仅剩 4 条 Low（`meta.json` 路径、反推死分支、`installDirIgnored` 键、R8 待回写），均属实现期细节，不单独构成返工。

补充限制（本轮未能核验项）：宿主源码在本会话仍不可达（`E:\work\code\open\deepseek-harness\packages` 与 `app.asar\dsh` 两条路径不可访问），F1–F7 与变更后的宿主行为**未复核**，我仅核读仓内文件（change 2/3/5、`contracts`、`roadmap`、`reviews`）；官方 zip 的真实布局/ETag/304/30x 与 OneDrive/杀软下改名语义仍未实测；`dsh.plugin.json#contributes` 是否被市场渠道消费仍未核验（#20）。

**Consensus Status**: NEEDS_REVISION
