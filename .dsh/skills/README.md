# .dsh/skills

DSH 的 rank-100 skill 扫描根（`<projectRoot>/.dsh/skills`）。

## openspec-*

`openspec-propose` / `openspec-apply-change` / `openspec-explore` /
`openspec-sync-specs` / `openspec-archive-change` 是 openspec CLI 生成的托管技能，
**版本化源在 `.zcode/skills/`**（与 `.zcode/commands/opsx/*.md` 同批）。

本目录是为了让 DSH 会话能通过 skill 工具加载而放置的副本。升级 openspec CLI
重新生成技能后，需要把 `.zcode/skills/openspec-*/SKILL.md` 同步覆盖到本目录；
不要只改其中一份。

缺少 `openspec` CLI 时这些技能只能当文档读，正文里的 `openspec ...` 命令无法执行。
