# tasks 1.5⑥ spike：暂存区/改名/删除在目标根的真实语义

- 执行日期：2026-09-27（Windows 10.0.26200 x64 + Git Bash + Node v24.9.0，NTFS，本地盘 `E:`）
- 执行位置：**真实目标根旁** `dsh-trader-kit/.dsh/.dsh-trader-kit-tmp/`（即默认落点
  `<projectRoot>/.dsh/skills` 的 `dirname(targetRoot)` 布局），非 os.tmpdir 模拟。
- 执行内容：`fs.mkdtemp('run-')` → 建 `stage/<name>/SKILL.md` → 改名到目标根
  → 改名回 `runDir/backup/<name>`（备份回滚语义）→ 再改名回目标 →
  `fs.rm(runDir, { recursive, force, maxRetries: 2, retryDelay: 50 })` → `stat` 断言零残留。
- 结果（全链路真实执行一次）：

| 步骤 | 耗时 | 结果 |
| --- | --- | --- |
| mkdtemp | 5 ms | 唯一目录创建成功 |
| stage → 目标根改名 | 4 ms | 同卷改名成功（Windows 不要求目标父目录为空，仅要求目标不存在） |
| 备份改名往返（目标 → runDir/backup → 目标） | 3 ms | 成功 |
| rm runDir（recursive + force + 重试） | 2 ms | 成功 |
| `stat(runDir)` 零残留断言 | — | ENOENT（已删净） |
| 同卷判定 | — | `path.parse(root).root` 相同（`E:\`） |

- 结论：
  1. **本机（本地 NTFS 盘）无 OneDrive/杀软占用干扰**，mkdtemp/改名/删除全链
     亚 10ms，D-3 流程在此环境语义正常；design「OneDrive 同步目录」风险在本仓
     目标根未触发（vault 在 OneDrive 下，但本仓默认落点不在其中）。
  2. 改名失败/删除失败的**降级路径已由测试覆盖**（test/skill/installer.test.ts：
     `rmImpl` 注入删除失败 → `installed-with-residue` + `residue[]` + 下次重试清理），
     即使未来目标根迁入 OneDrive 后瞬时失败，行为仍是「回滚旧版 + 显式告警」。
  3. spike 全部痕迹已清理（`spike-probe/` 与 `.dsh-trader-kit-tmp/` 均已删除，
     `stat` 断言 ENOENT）。
- 复现方式：见本仓 tasks 1.5⑥ 的步骤描述（mkdtemp → stage → rename → backup 往返
  → rm → stat），或直接运行 test/skill/installer.test.ts 的等价链路。
