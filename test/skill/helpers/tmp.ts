/**
 * 测试临时目录（零 mock：真实 fs.mkdtemp；用后清理）。
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface TempDir {
  path: string
  cleanup(): Promise<void>
}

export async function tempDir(prefix = 'dsh-skill-test-'): Promise<TempDir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))
  return {
    path: dir,
    cleanup: () => rm(dir, { recursive: true, force: true, maxRetries: 2, retryDelay: 50 }),
  }
}

/** 造一个带 `.git` 的真实临时项目根（可发现性集成测试用）。 */
export async function tempGitProject(prefix = 'dsh-skill-proj-'): Promise<TempDir> {
  const dir = await tempDir(prefix)
  await mkdir(path.join(dir.path, '.git'), { recursive: true })
  return dir
}

/** 写入一个合法 skill 目录（SKILL.md + 可选正文）。 */
export async function writeSkillDir(root: string, name: string, options: { version?: string | null; body?: string; fmName?: string } = {}): Promise<string> {
  const dir = path.join(root, name)
  await mkdir(dir, { recursive: true })
  const fmName = options.fmName ?? name
  const versionLine = options.version === null ? '' : options.version ? `version: ${options.version}\n` : ''
  const text = `---\nname: ${fmName}\n${versionLine}description: test skill ${name}\n---\n\n${options.body ?? `body of ${name}`}\n`
  await writeFile(path.join(dir, 'SKILL.md'), text, 'utf8')
  return dir
}
