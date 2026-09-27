## 依赖与门禁总则

- **依赖（blocked_by）**：任务 4.1（在 change 2 的 `Config` 上追加 `skill` 段）依赖 **change 2 的 `Config` 导出 + `dataRoot`**（具名接口，见 `data-foundation/design.md` 的 `Config`，`contracts §0`/`§11`）；任务 4.3 依赖 **4.1 + 1.6**，并**只提供 `skill` 段数据源**（`buildSkillStatus()` / `traderKit.skill.status({ cwd? })`）——**不再产出、也不依赖 `traderKit.health.status()`**，该出口的唯一 owner 是 change 2（`contracts §11`/`§12.2`），其两段视图的 `skill` 段即本 change 的返回值，字段一致性由用例断言；任务 5.2（本地目录源）的**消费方**是 change 5，但实现可先行（不阻塞）。其余任务无前置。
- **跨 change 口径**：凡写「复用 / 依赖」处，一律引用 `docs/design/iteration-1-contracts.md` 的具名条目（`contracts §n`）或具名 service key / 模块导出签名。
- **每条任务的写法**：一律含「产物 / 验收 / 依赖」三项；验收必须是**可判定**的（命令、产物路径或证据格式）。
- **测试纪律**：零 mock（用 `node:http` 起真实本地服务桩，随机端口）、零 sleep、真实临时目录；扫描型用例 MUST 先断言目标非空；断言完整。
- **网络依赖任务**（2.7、1.3 的真实请求、5.3）需人工在有网环境执行，证据落仓内文件。

## 1. 安装器核心

- [ ] 1.1 `src/skill/version.ts`：`SKILL.md` frontmatter 解析（`name` 校验、`version` 正则提取、失败归类为「不可解析」）与版本三元组比对
  - 产物：`src/skill/version.ts`（导出 `parseSkillFrontmatter(text)`、`compareVersions(a, b): -1 | 0 | 1`）
  - 验收：`pnpm test -- src/skill/version` 全绿；表驱动用例覆盖 `1.2.0（2026-09-20）`、`1.2.0`、缺 `version`、`name` 不合 kebab-case、frontmatter 截断；`compareVersions('1.10.0','1.9.9') === 1`
  - 依赖：无
- [ ] 1.2 `src/skill/download.ts`：条件请求（`If-None-Match` / `If-Modified-Since`）+ 临时区落盘 + 超时与有限重试 + 单次字节上限
  - 产物：`src/skill/download.ts`（导出 `downloadToFile(input): Promise<DownloadResult>`；`DownloadResult = { status: 200 | 304, archivePath?, headers: { etag?, lastModified?, url }, redirectTarget? }`）；**响应头字符串原样保存**（不重格式化日期）
  - 验收：真实本地服务桩（`node:http`）三组用例——返回 200 + zip、返回 304、返回 302 到异 host；断言 304 走「零体下载」分支、302 在 `redirect: 'manual'` 下**显式报错**且错误含目标 URL；`AbortSignal.timeout` 生效（连接 3 s / 总 60 s）可由桩延迟触发；重试次数 ≤2 且退避 1 s/4 s 有源码常量断言
  - 依赖：1.1（无强依赖，可并行）
- [ ] 1.3 zip 解压库选型验证（`fflate` 能否给出完整性失败信号；不达标换 `yauzl`）并把依赖写入 `package.json`
  - 产物：`package.json` 的 `dependencies` 新增所选库；`test/fixtures/official-zip-manifest.json`（真实响应头 + 包内条目清单 + `SKILL.md` 相对路径 + 两枚 SHA-256）
  - 验收：①用官方包（有网执行一次，证据落 fixture）构造「截断 zip」，断言所选库给出完整性失败信号（`pnpm test -- src/skill/validate` 有用例证明）；②`pnpm typecheck && pnpm build` 绿；③fixture 含 F8/F9 待验证项的实测结论（布局 / ETag 是否支持 / 是否 30x / `Last-Modified` 原样形态）
  - 依赖：有网环境（人工）；结论回填 design「待验证」表
- [ ] 1.4 `src/skill/zip-guard.ts` + `src/skill/validate.ts`：解压加固层 + 结构校验
  - 产物：`src/skill/zip-guard.ts`（导出 `assertInside(child, root)`、`inspectEntries(entries, limits): { ok, violations }`、`extractGuarded(zip, stageRoot, limits)`）；`src/skill/validate.ts`（HTTP 状态 / content-type / 可解压 / 必需条目 `SKILL.md` / `name` 匹配 / `version` 可解析）
  - 验收：加固项逐条有单测——绝对路径、盘符、UNC、`..` 段、`..\` 反斜杠伪装、symlink 条目、Windows 保留名（`CON`/`NUL`）、尾随空格/点、条目数 >200、单文件 >5 MB、解压总量 >50 MB；每条断言「中止 + 清理 + 错误含条目名与实际值/上限」；上限判定在写出前依据 central directory 预检，写出中累计复核
  - 依赖：1.3（库选型）
- [ ] 1.5 `src/skill/installer.ts`：原子替换流程（扫描根外暂存区 → 备份旧版 → 改名 → 零残留断言）+ 失败回滚 + 中间产物清理 + 历史残留迁移
  - 产物：`src/skill/installer.ts`（导出 `installSkill(input): Promise<InstallResult>`；入参含 `targetRoot`/`name`；`InstallResult = { ok, outcome, version, previousVersion, path, sourceId, previousSourceId, contentHash, warnings[], residue[] }`）；暂存区 = `path.join(path.dirname(targetRoot), '.dsh-trader-kit-tmp', <mkdtemp 运行目录>)/`
  - 验收：①`assertNotInside(tmpBase, root)` 对 `knownSkillRoots` 的**每个 root**（**含本次 `targetRoot` 自身**）全过，且「`child === root`」判定为「在内」（单测直接覆盖相等输入）；②`targetRoot` 被配成**更前 rank root 的后代** → 显式错误 `TMP_AREA_IN_SCAN_ROOT`；**反向控制：`targetRoot` 取默认值 `<projectRoot>/.dsh/skills`（等于自身登记项）→ MUST NOT 报错、安装正常进行**；③成功路径 `ok === true` 且 `residue.length === 0`（`stat` 断言 `runDir` 已不存在）；④删除失败注入（Windows 占用模拟：桩目录句柄/只读属性）→ `outcome === 'installed-with-residue'`、`ok === false`、`residue` 含实际路径；⑤历史残留（`targetRoot` 顶层的 `.*backup-*`/`.*stage-*`）迁移或删除并记 warning；⑥spike（**在目标根真实执行一次**，证据落 `test/fixtures/tmp-area-spike.md`）：`fs.mkdtemp`/改名/删除在 OneDrive 或杀软环境语义
  - 依赖：1.4
- [ ] 1.6 `src/skill/state.ts`：本地 `meta.json` 记录 + **以文件系统为准**的状态装配
  - 产物：`src/skill/state.ts`（导出 `readMeta` / `writeMeta` / `buildSkillStatus` 的数据装配部分）；`meta.json` 字段：`version`/`contentHash`/`archiveHash`/`etag`/`lastModified`（原样字符串）/`installedAt`/`lastCheckedAt`/`sourceUrl`/`sourceKind`/`sourceId`/`previousSourceId`/**`resolvedCwd`/`projectRoot`/`targetRoot`/`name`**（首次安装即持久化，供 D-1「记录优先」与 N1 的受限反推使用）
  - 验收：单测——①`meta.json` 存在但落点被删 → `state: 'missing'` + warning 含「残留 meta.json」；②落点被手工替换（版本/哈希都变）→ 版本与哈希取自**文件系统**，`state` ∈ {`state-mismatch`,`content-drifted`}，warning 同时列出两个来源的值；③落点在而 `meta.json` 缺失 → `state: 'installed'` + 「安装记录缺失」warning；④**首次安装后 `meta.json` 含 `resolvedCwd`/`projectRoot` 且与本次根解析结果一致**（记录优先的数据基础）
  - 依赖：1.1、1.4
- [ ] 1.7 第一/第二层测试：正常路径 + 回滚 + 零残留 + 恶意包 + 并发
  - 产物：`test/skill/*.test.ts`（真实临时目录 + `node:http` 本地桩；`test/fixtures/malicious-*.zip` 生成器）
  - 验收：①校验失败中止且旧版字节不变；②覆盖安装成功且 `residue` 空；③中途失败（在改名前后各注入一次失败）回滚到旧版且无半装状态；④4 条恶意契约测试（`../x`、绝对路径、symlink 条目、超大包）+ 截断 zip；⑤并发两次 `install`（`Promise.all`）→ 恰好 1 个有效安装、`residue` 空、另一返回 `outcome: 'rejected'`；⑥同目录其它 skill 零改动（安装前后逐文件哈希比对）
  - 依赖：1.5、1.8
- [ ] 1.8 并发与重入：`fs.mkdtemp` 唯一目录 + 进程内 mutex + 跨进程锁文件
  - 产物：`src/skill/lock.ts`（导出 `withInstallLock(fn)`；锁文件 `<tmpBase>/lock.json` 含 `pid`/`startedAt`；过期 >10 分钟接管并记 warning）
  - 验收：单测——同实例并发第二调用返回 `rejected` 且原因含持锁 pid；手工造陈旧锁（`startedAt` 早于 10 分钟）→ 被接管且 warning 存在；`mkdtemp` 目录名两两不同（100 次循环断言无重复）
  - 依赖：1.5
- [ ] 1.9 仓外文档前提落仓内摘录 + 待验证项登记
  - 产物：`test/fixtures/out-of-repo-premises.md`（M1-Q1「`.dsh/skills` rank 100」与 M1-Q5「基线 = 配置项 + 手动抬升」的可核验结论摘录，标注来源与「仓外文档，未能核验」）；本任务同时核对 design「待验证」表每项都有对应 tasks 编号
  - 验收：`grep` 断言 design 待验证表的每个「验证任务」编号都在 tasks.md 存在；摘录文件明确写出「未能核验」字样
  - 依赖：无

## 2. 安装根与宿主可见性

- [ ] 2.1 `src/skill/root.ts`：`resolveProjectRoot(cwd)` 纯函数 + `installDir`/`targetRoot` 解析（**记录优先 + 受限反推**）
  - 产物：`src/skill/root.ts`（导出 `resolveProjectRoot(cwd: string): string`、`resolveTargetRoot({ cwd, installDir, recorded })`、`deriveRootFromInstallDir(installDir, recorded)`）；**MUST NOT 使用 `process.cwd()`**（源码断言 `grep -c 'process.cwd' src/skill` 为 0）；`meta.json` 持久化 `resolvedCwd`/`projectRoot`（1.6 的字段清单同步）
  - 验收：纯函数表驱动用例——无 `.git` 时退化返回入参；多级含 `.git` 时返回最近祖先；`installDir` 为空 → `<projectRoot>/.dsh/skills`；配置相对路径以 `<projectRoot>` 为基；配置绝对路径经 D-13「可写目标」校验（https 源：落在 `dataRoot`/vault/插件包目录内 → 报错，**豁免 `contracts §10` 白名单区**）；`deriveRootFromInstallDir` 仅在「绝对路径 **且**（祖先进与记录值一致 **或** 该祖先含 `.git`）」时返回根，否则返回 `null`（由调用方拒绝）
  - 依赖：无
- [ ] 2.2 根解析单测：记录优先 / 受限反推 / 无来源拒绝 + `cwd ≠ projectRoot` 提示
  - 产物：`test/skill/root.test.ts`、`test/skill/status-cwd.test.ts`
  - 验收：①无 `.git` 的项目根退化用例；②monorepo 子目录向上找到最近 `.git`；③`cwd ≠ projectRoot` 时 `status` 显式提示（warning 含 `resolvedCwd`、`projectRoot`、`cwdSource`）；④工具出口无 session cwd、service 出口无 `cwd` 且无 `installDir` → **拒绝执行并提示**（不猜）；⑤**记录优先**：`meta.json` 有 `projectRoot` 记录值、`installDir = <dshHome>/skills`（绝对、祖先无 `.git`）→ `status().projectRoot` 必须等于**记录值**、`cwdSource === 'recorded'`（MUST NOT 因反推而改变）；⑥**受限反推（正当路径）**：无记录值、`installDir = <projectRoot>/skills`（祖先含 `.git`）→ 反推得到真实项目根、`cwdSource === 'install-dir-derived'`；⑦**受限反推（拒绝路径）**：无记录值、`installDir = <dshHome>/skills`（祖先无 `.git` 且与记录值不一致）→ **显式拒绝**（含实际 `installDir`、尝试推导的祖先、处置建议）；⑧**相对 `installDir` + 无 `cwd`** → **显式拒绝**（理由 = 无解析基）
  - 依赖：2.1
- [ ] 2.3 可发现性核对：**按宿主签名传 `cwd`** + `name`/`targetRoot` 参数化 + 实例化路径断言 + 服务不可用退化
  - 产物：`src/skill/discovery.ts`（导出 `checkDiscovery({ skills?, projectRoot, targetRoot, name })`）；调用形态 `skills.list({ cwd: projectRoot, signal, scope })` 且**必传 `cwd`**；`tdx-tq-local`/`installDir` 只是 https 源默认实例，函数体内 MUST NOT 出现硬编码 name
  - 验收：①用 `node:http` 无关；用**真实 registry**（见 2.6）断言 `hit.path === path.join(targetRoot, name, 'SKILL.md')`；②不传 `cwd` 的实现被用例判失败（对照断言：`list()` 空 vs `list({cwd})` 命中）；③`skills` 注入为 `undefined` → `discovery.mode === 'filesystem-only'`，且**不产生「未发现」警告**；④参数化证明：以 `{ targetRoot: <临时根>, name: 'review-daily-summary' }` 构造 fixture → 命中判据按该 name 生效（`tdx-tq-local` 写死的实现被判失败）
  - 依赖：2.1、1.5
- [ ] 2.4 仓库卫生：`.gitignore` 粒度化 + `package.json#files` 覆盖核查 + 目标仓库忽略提示
  - 产物：`.gitignore` 增 `.dsh/skills/` 与 `.dsh/.dsh-trader-kit-tmp/`（若 owner 选整目录忽略，回退为 `.dsh/`）；`src/skill/gitignore-notice.ts`（读目标根 `.gitignore` 判断并**提示**是否已忽略 `<targetRoot>`，MUST NOT 代改文件、不引 shell）；`status` 增 `installDirIgnored: boolean`
  - 验收：`pnpm test -- src/skill/gitignore-notice` 绿（三种 fixture：无 `.gitignore`、已忽略、未忽略）；`node -e "…"` 或单测断言 `package.json#files` 覆盖安装器全部产物（`lib/**`）+ 本 change 无静态资产；**Risks 承诺**（只保本仓、目标仓库仅提示）在 spec 中有对应 Requirement
  - 依赖：无
- [ ] 2.5 同名遮蔽检测（安装与 `status` 都做，按 `name` 参数化）
  - 产物：`src/skill/shadowing.ts`（导出 `findShadowedCandidates({ roots, name })`）；候选根 = `targetRoot`、`<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`、`Config.skill.extraSkillRoots`、`list({cwd})` 赢家
  - 验收：fixture 目录（临时项目根内造 rank 100/200 同名副本 + 本落点）→ 断言 `shadowed` 数组含 `{ path, rank, version, name }` 且 warning 文案形如「已遮蔽 <路径>（rank 100，版本 1.0.12）」；无同名副本 → `shadowed === []`；以 change 5 形态（`name: 'review-daily-summary'`、`targetRoot` 在 `dataRoot/agent/skills`）重复一条，证明检测与 `tdx-tq-local` 无耦合
  - 依赖：2.3
- [ ] 2.6 第二层集成测试：真实 registry + 真实临时项目根（含 `.git`）
  - 产物：`test/skill/discovery-integration.test.ts`
  - 验收：①安装（`name = 'tdx-tq-local'` 的 https 源默认实例）到临时项目根后 `list({ cwd: projectRoot })` 命中该 name，且 `source`/`path` 与本落点一致；②断言**恰好 1 个候选胜出**；③安装完成后 `list({cwd})` 结果中**不含**任何暂存/备份残留目录（`residue` 相关断言）；④扫描型用例先断言候选数 >0（防空过）；⑤以 change 5 形态补一条：`name = 'review-daily-summary'`、`targetRoot` 指向临时目录（**该目录须登记进候选根或 `extraSkillRoots` 才可断言命中**），证明核对与 `tdx-tq-local` 无耦合
  - 依赖：2.3、2.5、1.5
- [ ] 2.7 真实安装验收（人工，需网络；门禁外的交付验收）
  - 产物：`test/fixtures/real-install-evidence.md`（证据文件）
  - 验收：证据含**四项**——①命令：`tq_skill_manage(action: "install")` 的调用记录；②产物：`<targetRoot>/<name>/SKILL.md` 绝对路径（默认实例即 `<installDir>/tdx-tq-local/SKILL.md`）；③证据：安装版本号（v1.2.0）+ `contentHash`（SHA-256）+ 源 URL + 获取时间；④宿主侧证据：DSH 会话 skill 列表可见 `tdx-tq-local`（贴出列表截图/文本）
  - 依赖：2.3、1.5；有网环境

## 3. 版本检查、更新与降级

- [ ] 3.1 版本比对与警告装配（`minVersion` 仅 https 源）
  - 产物：`src/skill/status.ts` 的 `warnings[]` 生成逻辑（版本缺失/不可解析/低于基线 → 含「已装版本、基线、建议动作」三段）；**基线只在 `source.kind === 'https-zip'` 时参与比对**，localDir 源下 `baseline === null` 且**不产生** `version-below-baseline`
  - 验收：单测四条（缺失 / 不可解析 / 低于基线 / **localDir 源不产生假 `version-below-baseline`**）；断言 `warnings` 每条同时含「原因」与「建议动作」，且**不阻断**（`buildSkillStatus` 正常返回、挂载不受影响）
  - 依赖：1.1、1.6
- [ ] 3.2 启动检查：`autoCheck` **只检查不安装**、异步不阻塞挂载、`checkIntervalHours` 节流
  - 产物：`src/skill/autocheck.ts`（挂载后异步一次；`lastCheckedAt` + `checkIntervalHours`（默认 24）节流；`autoCheck=false` 时不探测；**无可用根来源时不探测**）
  - 验收：①单测断言**检查路径不调用 `installSkill`**（注入替身计数 + 源码断言 `grep -c 'installSkill' src/skill/autocheck.ts` 为 0）；②**正向控制**：`meta.json` 有 `projectRoot` 记录值（或 `installDir` 满足 D-1 受限反推）时，**首次挂载恰好产生 1 次出站**，第二次挂载（`checkIntervalHours: 24` 内）**为 0 次**（桩服务请求计数）；③**无来源用例**：既无记录值、`installDir` 也不可反推（默认 `''`）→ **跳过检查 + warning、零出站**（桩计数为 0），且 `apply` 仍成功返回；④挂载失败不阻断（桩返回 500 时 `apply` 仍成功返回）
  - 依赖：1.2、3.3
- [ ] 3.3 更新判定：**零体下载**（304 / HEAD 比对）+ 双标识缺失降级
  - 产物：`src/skill/update.ts`（导出 `decideUpdate(local, remote): 'up-to-date' | 'download'`）；`meta.json` 原样存响应头字符串
  - 验收：单测——①304 → `'up-to-date'` 且**零替换**（目标目录 `mtimeMs` 与字节不变）；②ETag/Last-Modified 双缺 → 走 `'download'`，下载后按 `version + SHA-256` 判等 → `outcome: 'up-to-date'` + 「源不支持条件请求」warning，**不替换**；③源忽略条件请求恒 200 → 同 ② 判等；④断言实现中无「日期重格式化」（源码无 `new Date(...).toUTCString()` 写入 `meta.json` 的路径）
  - 依赖：1.2、1.6
- [ ] 3.4 源不可达降级
  - 产物：`src/skill/status.ts` 的 `sourceReachable = { state: 'unreachable', checkedAt, reason }` 分支
  - 验收：桩服务关闭/超时/返回 500 三组 → 断言已装版本字节不变、`state === 'source-unreachable'`、`reason` 非空、**无**「降级」动作；`status()` 调用期间桩服务请求计数为 0（缓存结论，不内联探测）
  - 依赖：3.3
- [ ] 3.5 第三层测试补充：篡改 / 降级 / 条件请求失败路径
  - 产物：`test/skill/status.test.ts`、`test/skill/downgrade.test.ts`
  - 验收：①`SKILL.md` 被删除或 frontmatter 不可解析 → 显式警告 + 建议动作；②源返回更低版本 → 目标目录**字节不变** + `state: 'downgrade-blocked'` + 显式报错含两版本号；`force: true` → 安装成功且 warning 记录强制降级；③保号篡改（版本不变、正文被换）→ `state: 'content-drifted'`；④vault 副本缺失/陈旧不产生错误与警告
  - 依赖：3.4、3.6、3.7
- [ ] 3.6 降级闸门实现（`force` 入参）
  - 产物：`src/skill/downgrade.ts`（导出 `checkDowngrade({ remoteVersion, installedVersion, force })`）；工具与 service 同款 `force` 入参
  - 验收：三种情形单测（升级 / 持平且源标识变化 → 覆盖并记 `previousSourceId` / 降级 → 拒绝）；`force: true` 路径必须同时写 warning 到状态
  - 依赖：1.1、1.6
- [ ] 3.7 内容哈希与漂移检测（`content-drifted`）
  - 产物：`src/skill/hash.ts`（导出 `sha256File` / `hashDir`）；`meta.json` 增 `contentHash`/`archiveHash`；`status` 增 `contentHash`/`expectedHash`/`drift`
  - 验收：单测——改一个字节 → `drift === 'drifted'` 且 `state === 'content-drifted'`；哈希只表述为「相对上次安装的本地漂移」（源码注释与 spec 均不得称其为「验证官方性」）
  - 依赖：1.6
- [ ] 3.8 出站节流与进程内去重
  - 产物：`src/skill/download.ts` 的进程内去重（同一 URL 同一 process 内 in-flight/结果共享）+ `checkIntervalHours` 接入
  - 验收：单测断言——同一进程内连续 10 次 `status()` + 2 次挂载 → 桩服务请求计数 ≤1；`install` 显式调用**不受**节流限制（计数 +1）
  - 依赖：1.2、3.2

## 4. 出口与门禁

- [ ] 4.1 `Config.skill` 段（**在 change 2 的 `src/config.ts` 中追加**）+ 配置校验 + 挂载实测
  - 产物：**在 change 2 已落地的 `src/config.ts` 中追加 `skill` 段**（`sourceUrl`/`installDir`/`minVersion`/`autoCheck`/`checkIntervalHours`/`extraSkillRoots`/`limits`）；**MUST NOT 新建或覆盖 `src/config.ts`，MUST NOT 改 `dataRoot` 默认值与既有字段**（`contracts §11`）；`cordis.patch.yml` 的 `config` 段（**占位符/注释示例，不含个人机器路径**）
  - 验收：①挂载实测：空 `dataRoot` + 默认 `skill` 段共存时加载成功（证据落 `test/fixtures/mount-config-evidence.md`）；②配置校验单测：`sourceUrl` 非 `https:` → 报错；`installDir` 落在 `dataRoot`/vault/插件包目录内 → 报错（**豁免 `contracts §10` 白名单区**：`dataRoot/agent/skills/` 等）；`targetRoot` 是**更前 rank root 的后代** → `TMP_AREA_IN_SCAN_ROOT`；**反向控制：`installDir`/`targetRoot` 取默认值 → MUST NOT 报错**；localDir 源的 `targetRoot = <dataRoot>/agent/skills` → **合法**（MUST NOT 被 https 落点禁令否决）；③变更 `skill` 段与 `dataRoot` 并存时字段互不覆盖；④文件级断言：`src/config.ts` 的 `dataRoot` 默认值与 change 2 交付时**逐字符一致**（追加式改动证明）
  - 依赖：**change 2 的 `Config` 导出 + `dataRoot`（blocked_by: change 2）**；1.2、2.1
- [ ] 4.2 注册工具 `tq_skill_manage`（`action: install | update | status | deploy | uninstall`）+ 输出 schema 与渲染
  - 产物：`src/tools/tq-skill.ts`（`ctx.tools.register(defineTool({...}))`）；入参含 `action`、`force?`（降级）、`cwd?`、`purge?`（uninstall）、本地目录源 `sourcePath?` / **`targetRoot?` / `name?`**；描述用中文写明「源不可达时保留现版；`autoCheck` 只检查不安装；降级需 force；deploy 需显式 targetRoot+name」
  - 验收：工具 schema 单测（非法 `action` 拒绝；`force` 默认 false；`cwd` 缺省走 D-1 来源表；`deploy` 缺 `targetRoot`/`name` → 拒绝并提示）；渲染输出含 `outcome`/`version`/`path`/`warnings`/`residue`
  - 依赖：1.5、3.6、4.5
- [ ] 4.3 service 出口：**只提供 `skill` 段数据源**（`buildSkillStatus()` / `traderKit.skill.status({ cwd? })`）
  - 产物：`src/skill/status.ts` 的 `buildSkillStatus()`（单点实现，工具与 service 同一实现）；在 **change 2 的 service 装配面上追加** `api.skill.status({ cwd? })` 与 `api.skill.deployLocalDir({ sourcePath, targetRoot, name })`（**MUST NOT 重建 `src/service.ts`、MUST NOT 重置 `provide('traderKit')`**，`contracts §11`）；**MUST NOT 产出 / 注册 `api.health.status()`**
  - 验收：①字段清单断言：D-15 表中的**每个键都存在**（`null` 允许、缺键失败）；②与 change 2 两段视图的 `skill` 段**字段逐项相等**（同一实现的证明，对照 change 2 spec 声明的 `skill` 段键集/取值域）；③`status()` MUST NOT 内联出站（桩计数不变）；④源码断言：本 change **不存在 `api.health.status()` 的定义或注册**（定义/注册处命中数为 0；`src/service.ts` 只做 `api.skill.*` 的追加注册）
  - 依赖：**4.1、1.6**（change 2 的两段视图由 change 2 自行组装，本 change 只提供 `skill` 段；`contracts §11`/`§12.2`）
- [ ] 4.4 边界断言测试：不碰 17709 / 不写 vault / 不改动官方包内容
  - 产物：`test/skill/boundaries.test.ts`
  - 验收：①安装器全流程中无任何到 17709 的连接（桩 + 端口探针断言）；②**不写 vault（按 `contracts §10` 收窄口径）**：断言范围 = ①`<vault>/.claude/**` 与已弃用副本区零写入；②**`dataRoot` 下既定业务区之外零写入**——安装/更新/部署前后做「文件清单 + 逐文件哈希 diff」，**MUST 把 `contracts §10` 白名单区（`dataRoot/agent/skills/`、`dataRoot/agent/DB/temp/dsh-trader-kit/`、`dataRoot/DB/review/`）排除在 diff 之外**，否则与「把 skill 装到 `agent/skills/`」自相矛盾；未配置 `dataRoot` 时**显式 skip 并输出 skip 说明**（MUST NOT 假成功）；③安装后落点 `SKILL.md` 字节与包内条目字节一致（SHA-256 相等）；④源码断言：`src/skill/**` 不 import `src/data/**`、不调用 `order_stock`/`cancel_order`
  - 依赖：1.5、2.6
- [ ] 4.5 `uninstall` 出口（幂等，按 `name`/`targetRoot` 参数化）+ 残留清理
  - 产物：`src/skill/uninstall.ts`（导出 `uninstallSkill({ cwd?, targetRoot, name, purge? })`：删除 `<targetRoot>/<name>/` + 清理 `residue`/`tmpBase` + 按 `purge` 决定是否删 `meta.json`；幂等返回 `outcome: 'uninstalled' | 'nothing-to-do'`）
  - 验收：单测——①`uninstall` 后 `list({ cwd })` 不再命中，且落点目录与 `residue` 均不存在；②二次 `uninstall` 返回 `nothing-to-do`（不报错）；③`purge: false` 保留 `meta.json` 但状态为 `missing`（以文件系统为准）；④存在历史残留时 `uninstall` 一并清理
  - 依赖：1.5、2.3
- [ ] 4.6 门禁：`pnpm typecheck && pnpm build && pnpm test` 全绿
  - 产物：门禁运行记录（贴出命令与结果摘要）
  - 验收：三条命令全绿；`pnpm test` 无 skip 静默项（除 4.4② 的显式 skip 说明）
  - 依赖：1.x–4.x 全部

## 5. 台账、源泛化与发布卫生

- [ ] 5.1 溯源台账：`docs/carryover.md` 增「外部资产台账」段（`contracts §10` + AGENTS 搬运纪律的溯源要求）
  - 产物：`docs/carryover.md` 新增段落（**需 owner 授权改动 `docs/`**），字段：源 URL、首次获取时间、版本、SHA-256（zip + `SKILL.md`）、适用范围（哪些 change/需求消费）、已弃用 vault 副本记录
  - 验收：台账字段与 `status` 输出的同一组字段一致（字段名清单在 spec 中声明）；换机/重建后仅凭台账可复核来源
  - 依赖：1.3（fixture 实测数据）、owner 授权
- [ ] 5.2 源泛化为两种：`https zip` 与 `localDir`（**具名签名 `{ sourcePath, targetRoot, name }`**；供 **change 5** 部署自产 skill 复用）
  - 产物：`src/skill/local-source.ts`（`syncLocalDir(input: DeployLocalDirInput): Promise<LocalDeployResult>`，`DeployLocalDirInput = { sourcePath, targetRoot, name }`，三态 `in-sync` / `user-modified`（含非空 diff）/ `upgradable`）+ `src/skill/source.ts`（`SkillSource` 判别联合）；service key `traderKit.skill.deployLocalDir({ sourcePath, targetRoot, name })`；工具 `action: 'deploy'`
  - 验收：单测三态各一条（`in-sync` 零写入断言 `mtimeMs` 不变；`user-modified` 目标字节不变 + `diff` 非空；`upgradable` 走原子替换 + 零残留） + 首次部署 `outcome: 'installed'`；本地目录源同样经过 D-6 可发现性核对与 D-10 互斥；**change 5 形态用例**：`targetRoot = <临时 dataRoot>/agent/skills`、`name = 'review-daily-summary'` → 部署成功且 `skillPath === <targetRoot>/review-daily-summary/SKILL.md`（证明 `tdx-tq-local`/`installDir` 未被写死，且 `contracts §10` 白名单落点不被 https 落点禁令否决）；**基线用例**：localDir 源不产生 `version-below-baseline`（`baseline === null`）
  - 依赖：1.5、2.3；消费方为 change 5（本任务不阻塞）
- [ ] 5.3 核验 `dsh.plugin.json#contributes` 是否被 bundle / 市场渠道消费
  - 产物：`test/fixtures/contributes-verification.md`（核验方法与结论）
  - 验收：二选一落定——①消费 → 同步 `contributes.tools` 的工具名（`tq_skill_manage` 等）与 skill 声明，并加回归断言；②不消费 → 在 `README.md`/AGENTS 注明该段属市场渠道约定（避免误以为「skill 靠这里声明」）；未核验成功时明确写「未能核验」并指向 Open Questions 第 7 条
  - 依赖：宿主源码可达或 owner 提供结论；4.2
- [ ] 5.4 发布产物纪律核查（`contracts §10`）
  - 产物：核查记录 + 修正后的 `cordis.patch.yml`
  - 验收：①`cordis.patch.yml` 与 `package.json` **零个人机器绝对路径**——现状已发现 `cordis.patch.yml` 注释内含本机路径（指向 `DSH-better-sidebar` 的 patch 文件），MUST 改为相对/先例名引用；②`package.json#files` 覆盖 `lib`（安装器全部产物）+ 本 change 无静态资产（若有则补进构建与 `files`）；③`sourceUrl` 默认值为公开官方地址，**允许保留**（不属个人路径）
  - 依赖：4.1、4.2
- [ ] 5.5 跨 change 回写清单核实与提交（R1–R8，见 design 末节）
  - 产物：回写清单（R1 `contracts §7` fetch 白名单 / R2 change 2 D-5 措辞收窄 / R3 change 2 spec 两段视图 / R7 `contracts §0` change 3 依赖行 / R8 change 5 的 `checkDiscovery` 形参改名与 `name` 补参）
  - 验收：①R1/R2/R3/R4/R7 逐条**核读确认已就位**并记录核读行号（指向 `contracts §7`、`data-foundation/design.md` D-5、`data-tool-contract` 两段视图、`contracts §0`、`docs/roadmap.md §5`），MUST NOT 重复回写覆盖已正确文本；②R5/R6/R8 给出目标文件与替换文案；本 change 不直接改他人文件
  - 依赖：owner 决策
