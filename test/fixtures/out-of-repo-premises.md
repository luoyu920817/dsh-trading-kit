# 仓外文档前提摘录（tasks 1.9）

> 本文落 dsh-trader-kit 仓内，摘录本 change 实现所依赖的两条**仓外文档裁决**。
> 摘录纪律沿 `docs/design/iteration-1-contracts.md §8`：需求/模块文档
> （`需求描述-*`、`模块文档 §x`、`M1-Q*`）不在本仓，一律标注
> **「仓外文档，未能核验」**；实现不依赖其措辞，只依赖已在宿主侧核验的
> 事实（design Context F1–F7）。

## 摘录 1：M1-Q1 —— 默认落点为 `.dsh/skills`（宿主 rank 100）

- **裁决内容（摘录自 change 立稿时的引述）**：TQ skill 的默认安装落点取
  `<项目根>/.dsh/skills/`，即宿主 skill 扫描根体系中的 **rank 100** 目录；
  该 rank 高于 `<项目根>/.agents/skills`（rank 200）、`customSkillDirs`
  （rank 300）与 `<dshHome>/skills`（rank 400），能压过项目内/用户目录的
  旧副本。
- **来源**：M1-Q1 裁决（`需求描述-*` / `模块文档 §x` 系列文档）。
- **核验状态**：**仓外文档，未能核验**（本会话与立稿会话均不可达）。
- **实现依赖方式**：实现只依赖 design Context **F1**（rank 常量 100/200/300/400/500/600
  与胜出顺序 `rank → providerOrder → localOrder`，Round 1 独立评审已在宿主源码
  核验，行号旁证未在本会话复核）与 **F3**（项目根只在 `cwd !== undefined` 时
  推入 rank 100）。M1-Q1 的措辞本身不进入代码路径。

## 摘录 2：M1-Q5 —— 版本基线 = 配置项 + 手动抬升

- **裁决内容（摘录自 change 立稿时的引述）**：TQ skill 的最低版本基线
  （`minVersion`，默认 `1.2.0`）以**配置项**形式存在，由人工随 TDX 大版本
  **手动抬升**；不引入自动版本策略（自动抬基线会让「TQ 更新但我没准备」
  变成静默行为）。基线仅产生**显式警告，不阻断使用**。
- **来源**：M1-Q5 裁决（同上，仓外）。
- **核验状态**：**仓外文档，未能核验**。
- **实现依赖方式**：实现按 D-4/D-13 直接以 `Config.skill.minVersion`（默认
  `1.2.0`、仅 https 源生效、localDir 源 `baseline: null`）落地；无任何
  「自动抬升」代码路径。

## design「待验证」表 ↔ tasks 编号对照（1.9 第二项验收）

| design 待验证项 | 对应 tasks 编号 | tasks.md 中存在 |
| --- | --- | --- |
| 官方包真实布局 / ETag / 30x / Last-Modified 形态 | tasks 1.2、1.3 | ✅（1.3 已实测回填 `test/fixtures/official-zip-manifest.json`） |
| `fs.mkdtemp` 与改名/删除在同卷 OneDrive/杀软下的语义 | tasks 1.5⑥ | ✅（spike 已执行，证据 `test/fixtures/tmp-area-spike.md`） |
| `dsh.plugin.json#contributes` 是否被 bundle/市场渠道消费 | tasks 5.3 | ✅（本会话未核验，待宿主源码可达） |
| `Config.skill.*` 与 change 2 dataRoot 并入同一 Config 根的合并行为 | tasks 4.1 | ✅（group 4 波次执行；`src/config.ts` 已由 change 2 并行落地） |
| M1-Q1 / M1-Q5 裁决原文摘录 | tasks 1.9（本文） | ✅ |

> 对照方式说明：摘录自 `openspec/changes/tq-skill-installer/design.md`
> 「待验证（任务 + 降级策略）」表的「验证任务」列，逐项在 tasks.md
> 中核对存在（本表由 tasks 1.9 人工核对落档，2026-09-27）。
