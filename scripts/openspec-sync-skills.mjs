#!/usr/bin/env node
/**
 * 把 OpenSpec 的 skills / commands 生成到 ZCode workspace 位置。
 *
 * OpenSpec CLI 的内置工具表没有 zcode（init --tools 不认 .zcode），所以这里
 * 直接复用 CLI 自己的生成函数（同一套模板、同一套 profile/delivery 过滤），
 * 只把输出路径改为 .zcode/skills/ 与 .zcode/commands/。
 *
 * 用法（仓库根目录）：node scripts/openspec-sync-skills.mjs
 * 时机：openspec 升级后重跑一次，刷新带 generatedBy 版本号的 skill 文件。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function resolveOpenSpecPkg() {
  const roots = []
  try {
    roots.push(execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim())
  } catch {
    // npm 不可用时继续尝试已知位置
  }
  roots.push(path.join(path.dirname(process.execPath), 'node_modules'))
  for (const root of roots) {
    const pkg = path.join(root, '@fission-ai', 'openspec')
    if (fs.existsSync(path.join(pkg, 'package.json'))) return pkg
  }
  throw new Error(
    'Cannot locate @fission-ai/openspec. Install it first: npm install -g @fission-ai/openspec',
  )
}

const pkgRoot = resolveOpenSpecPkg()
const { version } = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'))
const load = (rel) => import(pathToFileURL(path.join(pkgRoot, 'dist', rel)).href)

const { getSkillTemplates, getCommandContents, generateSkillContent } =
  await load('core/shared/skill-generation.js')
const { getGlobalConfig } = await load('core/global-config.js')
const { getProfileWorkflows } = await load('core/profiles.js')
const { CommandAdapterRegistry } = await load('core/command-generation/index.js')

// 与 InitCommand.generateSkillsAndCommands 相同的过滤逻辑
const globalConfig = getGlobalConfig()
const profile = globalConfig.profile ?? 'core'
const delivery = globalConfig.delivery ?? 'both'
const workflows = getProfileWorkflows(profile, globalConfig.workflows)

const skillTemplates = delivery === 'commands' ? [] : getSkillTemplates(workflows)
const commandContents = delivery === 'skills' ? [] : getCommandContents(workflows)

// ZCode 命令路径：.zcode/commands/opsx/<id>.md → /opsx:<id>，
// 与 skill 模板里的 /opsx:* 引用一致（colon 风格，不做 hyphen 变换）。
const adapter = CommandAdapterRegistry.get('claude')

const skillsRoot = path.join(repoRoot, '.zcode', 'skills')
const commandsRoot = path.join(repoRoot, '.zcode', 'commands', 'opsx')
fs.mkdirSync(skillsRoot, { recursive: true })
fs.mkdirSync(commandsRoot, { recursive: true })

// 清理本脚本管理范围内、本次不再生成的陈旧文件（仅 openspec-* / opsx/*）
const freshSkillDirs = new Set()
for (const { template, dirName } of skillTemplates) {
  freshSkillDirs.add(dirName)
  const dir = path.join(skillsRoot, dirName)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), generateSkillContent(template, version))
}
for (const entry of fs.readdirSync(skillsRoot)) {
  if (entry.startsWith('openspec-') && !freshSkillDirs.has(entry)) {
    fs.rmSync(path.join(skillsRoot, entry), { recursive: true, force: true })
  }
}

const freshCommandIds = new Set()
for (const content of commandContents) {
  freshCommandIds.add(content.id)
  fs.writeFileSync(path.join(commandsRoot, `${content.id}.md`), adapter.formatFile(content))
}
for (const entry of fs.readdirSync(commandsRoot)) {
  if (entry.endsWith('.md') && !freshCommandIds.has(entry.slice(0, -3))) {
    fs.rmSync(path.join(commandsRoot, entry), { force: true })
  }
}

console.log(`OpenSpec ${version} → ZCode (profile: ${profile}, delivery: ${delivery})`)
console.log(`  skills:   ${skillTemplates.length} → .zcode/skills/openspec-*`)
console.log(`  commands: ${commandContents.length} → .zcode/commands/opsx/ → /opsx:*`)
