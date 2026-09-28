# dsh-trader-kit Agent 指南

个人 A 股交易工作流插件（DSH 宿主）。从 0 构建以掌握 dsh 插件范式与能力边界；
基础设施按需**直接搬运**自 dsh-trading——不是重写、不是运行时依赖、不回流。

## 项目目标

1. **五大需求的工作流闭环（知行合一）**：
   - 需求 1 盘面梳理：TDX 日记 + 关键词提取，控制评论发散；
   - 需求 2 题材推导：题材分类与短线炒作思路归纳 → 知识库 + 导图；
   - 需求 3 每日闭环结论：指数/情绪/题材/个股四层 verdict + 待跟踪核销；
   - 需求 4 历史统计：研究数据快照积累 + web 可观察；
   - 需求 5 策略盯盘：选股语句（通达信量化接口）+ 盘中阶段轮询 + 嵌入页。
2. **学习目标**：通过从 0 构建撞墙，掌握 dsh 插件生态与能力边界——这是
   首类目标，不是副产品。
3. **路线模式**：单包从 0 骨架 + 三层搬运策略（直接搬 / 重新搭 / 不搬），
   见 [docs/carryover.md](docs/carryover.md)。

## 参考目录（全部只读）

| 参考源 | 路径 | 用途 |
| --- | --- | --- |
| 主参考（契约 + 搬运源） | `E:\work\code\open\dsh-plugins\dsh-trading` | 产品线，本工程不为其需求做修改 |
| ├ 契约文档 | `dsh-trading\docs\design\a-share-data-contract.md` | 行情/研究数据口径（单位/时区/信封四态） |
| ├ vault 契约 | `dsh-trading\docs\design\vault-integration.md` | 知识库 vault 化 + 工作流迁移定稿 |
| ├ 议题源 | `dsh-trading\docs\design\ashare-requirements-topics.md` | 五需求 24 议题完整版（本仓 roadmap 是其执行轨） |
| ├ 可搬运包 | `dsh-trading\packages\{connector-tdx, kit-cn, knowledge, strategies, eventbus, holdings}` | 协议与引擎实现（带测试一起搬） |
| └ 规则源 | `dsh-trading\AGENTS.md` | 安全红线与纪律的参照基线 |
| 插件范式参照 | `E:\work\code\open\dsh-plugins\DSH-better-sidebar` | 单包插件 + dsh.plugin.json + cordis.patch.yml 双通道先例、跨插件服务先例 |
| 同类先例 | `E:\work\code\open\dsh-plugins\dsh-market` | 发布流与 preflight 先例（个人工程暂不需要） |
| vault（资产层） | `C:\Users\luoyu\OneDrive\应用\remotely-save\finance` | 阶段 4 起读写，沿 vault-integration 写分区契约（只写既定产物区；本迭代白名单 = `DB/review/` 与 `agent/DB/temp/dsh-trader-kit/`） |

## 工程契约

- **参考源只读**：dsh-trading 对本工程是参考源与搬运源。不为本工程的需求修改
  dsh-trading；上游若需变更，单独决策。搬运进来的代码以本仓为唯一事实源。
- **搬运纪律**（详见 [docs/carryover.md](docs/carryover.md)）：带测试搬（测试是
  可执行的契约）、带溯源搬（台账记录源 commit + 偏离）、搬完冻结并每月对上游
  diff 再对照。
- **安全红线**（沿 dsh-trading 基线）：只读行情——TQ-Local 绝不调用
  `order_stock` / `cancel_order` 等交易账户接口；不内置密钥；输出仅研究辅助、
  不构成投资建议；不写交易指令，任何执行类语义一律 dry-run 默认。
- **轻量门禁**：`pnpm typecheck && pnpm build && pnpm test`。新写测试零 mock、
  零 sleep、断言完整（沿 dsh-trading test:audit 精神，不搬全量棘轮与 CI）。
- **阶段防呆**：严格按 [docs/roadmap.md](docs/roadmap.md) 阶段顺序推进，每阶段
  有可用产物——防止「重建吞掉五需求」；缺基础设施先问「该搬（基础设施）还是
  该自建（工作流）」，判据：市场无关且他人可复用 → 搬；只有本工作流的流程与
  判断 → 自建。
- **宿主 cohort**：`dsh.plugin.json` 的 engines.dsh 是下限占位；宿主与 SDK
  版本以当前实际安装核验，不硬编码旧版本（沿 dsh-trading 契约）。
- **vault 写入**：除本迭代两条白名单路径外（`DB/review/` 复盘卡片产物区；
  `agent/DB/temp/dsh-trader-kit/` 数据工具缓存与运行摘要区），阶段 4 起才触
  vault；写入沿 vault-integration 的写分区与原子写契约，人工判断字段不代改。

## 按需阅读

- [docs/architecture.md](docs/architecture.md) —— 分层架构与能力边界地图
- [docs/roadmap.md](docs/roadmap.md) —— 阶段路线、需求映射、议题裁决状态
- [docs/carryover.md](docs/carryover.md) —— 搬运纪律与溯源台账
- [docs/design/workflow-node.md](docs/design/workflow-node.md) —— 盘后枢纽节点
- [docs/design/daily-loop.md](docs/design/daily-loop.md) —— 每日闭环六步
- [docs/design/pattern-unification.md](docs/design/pattern-unification.md) —— 模式与交易统一
