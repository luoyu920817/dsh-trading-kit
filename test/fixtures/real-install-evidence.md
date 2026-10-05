# 真实安装验收证据（tq-skill-installer tasks 2.7）

- **执行时间**：2026-10-05T10:54:58+08:00（installedAt meta 记录 02:54:58Z）
- **执行方式**：生产代码路径直调（`runTqSkillManage` —— `tq_skill_manage(action:'install')` 工具的 execute 同一实现；等价调用证据见下方命令）
- **源 URL**：`https://www.tdx.com.cn/products/autoup/skills/tdx-tq-local.zip`（官方地址；网络实取）
- **安装结果**：`outcome=installed`，**version=1.2.2**（高于基线 1.2.0；快照 fixture 时源为 1.2.0，实测日源已升 1.2.2），耗时 273 ms
- **产物**：`E:\work\code\open\dsh-plugins\dsh-trader-kit\.dsh\skills\tdx-tq-local\SKILL.md`
- **SHA-256**：
  - SKILL.md = `d32393c27b53da55c8014a93398fae42820aee246f46d143939a38fe85ce3c20`
  - meta.contentHash 与之一致（`d32393c27b53da55c801…`）
- **warnings**（1 条，预期内）：frontmatter name「通达信TQ-Local」≠ 目录名「tdx-tq-local」——官方包以展示标题为 name；按目录名安装（**owner 未裁决前保持「警告不拦安装」默认**，登记见 tasks 2.3 偏离）
- **residue**：空（零残留断言通过）
- **等价命令**（复现）：
  ```bash
  node -e "(async()=>{const {runTqSkillManage,defaultTqSkillFacades}=await import('./lib/skill/index.js');const {resolveTraderKitConfig}=await import('./lib/config.js');const r=await runTqSkillManage(defaultTqSkillFacades(),resolveTraderKitConfig({}),{action:'install',cwd:process.cwd()});console.log(r.outcome,r.version)})()"
  ```
- **宿主侧证据（DSH 会话 skill 列表可见 tdx-tq-local）**：⏳ 待 owner 在 DSH 会话执行 `tq_skill_manage(action:'status')` 或查看 skill 列表后补记（工具已注册，会话可见性属宿主运行时）
- **测试 fixture 快照**：`test/fixtures/official-zip-manifest.json`（1.2.0 时点快照 + 截断 zip 完整性测试）
