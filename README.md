# dsh-trader-kit（TraderKit）

个人 A 股交易工作流插件（DSH / DeepSeek Harness 宿主）。围绕五大需求构建
「知行合一」闭环：盘面梳理 → 题材推导 → 每日闭环结论 → 历史统计 → 策略盯盘。

**与 dsh-trading 的关系**：dsh-trading 是对外分发的多市场产品（参考源，只读）；
本工程是个人快轨——从 0 构建以掌握 dsh 插件范式与能力边界，基础设施按需
**直接搬运**自 dsh-trading（带测试、带溯源，不重写、不回流）。搬运策略与
溯源台账见 [docs/carryover.md](docs/carryover.md)。

交互面：通达信（盘中 + 嵌入页宿主）+ dsh 宿主会话；资产层：Obsidian vault。

## 目录结构

```
dsh-trader-kit/
├── AGENTS.md            # 项目指南：目标、参考目录、工程契约
├── dsh.plugin.json      # dsh 插件 manifest（registry 通道）
├── cordis.patch.yml     # bundle patch（profile 挂载行）
├── src/
│   └── index.ts         # cordis 插件入口（阶段 1 骨架）
├── test/                # vitest（零 mock 纪律）
└── docs/
    ├── architecture.md  # 总体架构与能力边界地图
    ├── carryover.md     # 搬运策略与溯源台账
    ├── roadmap.md        # 阶段路线与议题裁决状态
    └── design/
        ├── workflow-node.md        # 盘后枢纽节点设计（需求 1/2/3 接入）
        ├── daily-loop.md           # 每日闭环六步（需求 3）
        └── pattern-unification.md  # 模式与交易统一（四统一）
```

## 开发

```bash
pnpm install
pnpm typecheck && pnpm build && pnpm test
```

## 安装（本地，个人插件不入公共市场）

file: 安装或 profile 挂载：`cordis.patch.yml` 的 insert 行（id: `trader-kit`）。
通道范式参照 DSH-better-sidebar 的 bundle patch 注释。
