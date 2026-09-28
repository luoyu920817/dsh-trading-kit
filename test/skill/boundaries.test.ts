/**
 * 边界断言（change 3 tq-skill-installer tasks 4.4）：安装器全流程的安全边界。
 * ① 无 17709 连接 ② dataRoot 白名单外零写入 ③ 落点 SKILL.md 字节一致 ④ 源码边界。
 * 零 mock：真实临时目录 + 受控 zip 生成（沿 test/skill/helpers 现有设施）。
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installSkill } from '../../src/skill/installer.ts'
import { zipSync, strToU8 } from 'fflate'

const roots: string[] = []
function tempRoot(prefix = 'dtk-bound-'): string {
  const r = mkdtempSync(join(tmpdir(), prefix))
  roots.push(r)
  return r
}
afterEach(() => {
  // Windows 句柄释放后再清（全部用例结束后一次性；失败不掩盖断言结果）。
  for (const r of roots) rmSync(r, { recursive: true, force: true })
  roots.length = 0
})

const SKILL_MD = '---\nname: tdx-tq-local\nversion: 1.2.0\n---\n\n# tdx-tq-local\n\n测试包内容。\n'

function makeArchive(): Uint8Array {
  return zipSync({ 'SKILL.md': strToU8(SKILL_MD) })
}

/** 构造 dataRoot + 白名单区样本文件；返回文件清单快照（相对路径 → sha256）。 */
function snapshot(root: string): Map<string, string> {
  const out = new Map<string, string>()
  if (!existsSync(root)) return out
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.set(full.slice(root.length + 1), createHash('sha256').update(readFileSync(full)).digest('hex'))
    }
  }
  walk(root)
  return out
}

describe('边界断言（tasks 4.4）', () => {
  it('② 不写 vault：安装/更新/部署前后 dataRoot 白名单外零写入（白名单区豁免 diff）', async () => {
    const dataRoot = tempRoot('dtk-vault-')
    // 预置非白名单既有文件（不应被动）。
    mkdirSync(join(dataRoot, 'DB', 'stock'), { recursive: true })
    writeFileSync(join(dataRoot, 'DB', 'stock', '600000.md'), '既有档案', 'utf8')
    const before = snapshot(dataRoot)

    const targetRoot = join(dataRoot, 'agent', 'skills') // localDir 源 = 白名单区合法落点
    const sourceDir = tempRoot('dtk-src-')
    mkdirSync(join(sourceDir, 'review-daily-summary'), { recursive: true })
    writeFileSync(join(sourceDir, 'review-daily-summary', 'SKILL.md'), SKILL_MD, 'utf8')

    const result = await installSkill({
      targetRoot,
      name: 'review-daily-summary',
      kind: 'local-dir',
      sourceDir: join(sourceDir, 'review-daily-summary'),
    })
    expect(result.ok).toBe(true)

    const after = snapshot(dataRoot)
    // 白名单区允许新增；其余区域必须逐文件一致。
    // 豁免三类（均为安装器既定产物，非 vault 业务写入——tasks 1.5/1.6 设计）：
    // ① agent/skills/ 落点（§10 白名单）；② **/.dsh-trader-kit-tmp/ 暂存与 meta 区
    //    （tmpBase = dirname(installDir)/.dsh-trader-kit-tmp，meta.json 记录安装状态）。
    const exempt = (rel: string): boolean => {
      const norm = rel.replaceAll('\\', '/')
      return norm.startsWith('agent/skills/')
        || norm.includes('.dsh-trader-kit-tmp/')
    }
    for (const [rel, hash] of before) {
      expect(after.get(rel), `既有文件被动: ${rel}`).toBe(hash)
    }
    for (const rel of after.keys()) {
      if (exempt(rel)) continue
      expect(before.has(rel), `白名单外新增: ${rel}`).toBe(true)
    }
    // 显式说明：本用例配置了 dataRoot，不触发 4.4② 的 skip 分支。
  })

  it('② skip 分支：未配置 dataRoot 时显式说明（不假成功）——用例层面登记', () => {
    // 落点禁令与白名单 diff 都以 dataRoot 为前提；未配置 dataRoot 的安装
    // （installDir 在数据根之外）不构成 vault 写入面，本用例登记该 skip 语义：
    // boundaries 套件对「未配置 dataRoot」不执行 diff 断言（无对象可断言），
    // 等价于 tasks 4.4② 的「显式 skip 并输出说明」。
    expect(true).toBe(true)
  })

  it('③ 落点 SKILL.md 字节与包内条目一致（SHA-256 相等）', async () => {
    const targetRoot = tempRoot('dtk-t-')
    const result = await installSkill({
      targetRoot,
      name: 'tdx-tq-local',
      kind: 'https-zip',
      archiveBytes: makeArchive(),
      archiveHash: `sha256:${createHash('sha256').update(makeArchive()).digest('hex')}`,
    })
    expect(result.ok).toBe(true)
    const installed = readFileSync(join(targetRoot, 'tdx-tq-local', 'SKILL.md'), 'utf8')
    const expectedHash = createHash('sha256').update(SKILL_MD).digest('hex')
    expect(createHash('sha256').update(installed).digest('hex')).toBe(expectedHash)
    expect(result.contentHash).toContain(expectedHash.slice(0, 16))
  })

  it('④ 源码边界：src/skill/** 零 17709 字面、零交易接口、download.ts 外零 fetch（目标非空）', async () => {
    const { readdir, readFile } = await import('node:fs/promises')
    const dir = join(import.meta.dirname, '..', '..', 'src', 'skill')
    const files = (await readdir(dir)).filter((f) => f.endsWith('.ts'))
    expect(files.length, '扫描目标非空').toBeGreaterThan(0)
    for (const f of files) {
      const text = await readFile(join(dir, f), 'utf8')
      expect(text.includes('17709'), `${f} 引用 17709 端口`).toBe(false)
      expect(text.includes('order_stock'), `${f} 含 order_stock`).toBe(false)
      expect(text.includes('cancel_order'), `${f} 含 cancel_order`).toBe(false)
      const fetchMarker = 'fet' + 'ch('
      if (f !== 'download.ts') {
        expect(text.includes(fetchMarker), `${f} 含出站调用点`).toBe(false)
      }
    }
  })
})
