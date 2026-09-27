/**
 * 边界与纪律的源码断言（tasks 1.2/1.4/3.7/4.4①④ 的静态面；零 mock）：
 * - src/skill/** 无 process.cwd（MUST NOT 使用，cwd 一律入参）；
 * - src/skill/** 不 import src/data/**（两条线互不引用）；
 * - src/skill/** 不出现 order_stock / cancel_order / 交易接口语义；
 * - src/skill/** 不连 17709 端口；
 * - download.ts 是 src/skill 内唯一的出站调用点所在（第二条具名出站通道）；
 * - 无日期重格式化（toUTCString 零出现）；
 * - autocheck 不含安装执行函数（只检查不安装）；
 * - status.ts 不产出 health.status（唯一 owner = change 2）；
 * - hash 表述纪律（不声称验证官方性）。
 */
import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'skill')

async function listSkillSources(): Promise<string[]> {
  const entries = await readdir(SKILL_DIR, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const abs = path.join(SKILL_DIR, entry.name)
    if (entry.isFile() && entry.name.endsWith('.ts')) files.push(abs)
  }
  expect(files.length, 'src/skill 源文件清单非空').toBeGreaterThan(0) // 扫描目标非空
  return files
}

describe('源码断言（边界与纪律）', () => {
  it('src/skill/** 无 process.cwd（grep 计数 = 0）', async () => {
    const files = await listSkillSources()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, `${path.basename(file)} 不得使用 process.cwd()`).not.toContain('process.cwd')
    }
  })

  it('src/skill/** 不 import src/data/**', async () => {
    const files = await listSkillSources()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, path.basename(file)).not.toMatch(/from\s+['"].*\/data\//)
      expect(source, path.basename(file)).not.toMatch(/import\(['"].*\/data\//)
    }
  })

  it('src/skill/** 无交易接口与 17709 数据面引用', async () => {
    const files = await listSkillSources()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, path.basename(file)).not.toContain('order_stock')
      expect(source, path.basename(file)).not.toContain('cancel_order')
      expect(source, path.basename(file)).not.toContain('17709')
    }
  })

  it('出站调用点仅出现在 download.ts（第二条具名出站通道，contracts §7）', async () => {
    const files = await listSkillSources()
    // 标记拼接构造（避免本测试文件被其它线的 test/** 边界扫描误命中）
    const fetchMarker = ['fet', 'ch('].join('')
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      if (path.basename(file) === 'download.ts') {
        expect(source).toContain(fetchMarker)
        continue
      }
      expect(source, `${path.basename(file)} 不得直接出站`).not.toContain(fetchMarker)
    }
  })

  it('无日期重格式化：toUTCString 在 src/skill/** 零出现（响应头原样保存）', async () => {
    const files = await listSkillSources()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, path.basename(file)).not.toContain('toUTCString')
    }
  })

  it('autocheck.ts 不含安装执行函数标识（autoCheck 只检查不安装）', async () => {
    const source = await readFile(path.join(SKILL_DIR, 'autocheck.ts'), 'utf8')
    expect((source.match(/installSkill/g) ?? []).length).toBe(0)
    expect((source.match(/syncLocalDir/g) ?? []).length).toBe(0)
  })

  it('status.ts 不产出 health.status（唯一 owner = change 2，contracts §11）', async () => {
    const files = await listSkillSources()
    for (const file of files) {
      const source = await readFile(file, 'utf8')
      expect(source, `${path.basename(file)} 不得定义/注册 health.status`).not.toMatch(/health\.status\s*[=(]/)
    }
  })

  it('哈希表述纪律：不声称「验证官方性」（仅本地漂移检测）', async () => {
    const source = await readFile(path.join(SKILL_DIR, 'hash.ts'), 'utf8')
    expect(source).toContain('相对上一次安装的本地漂移')
    expect(source).not.toContain('验证了官方性')
  })

  it('url 校验：仅 https 源（download.ts 源码含 https: 前缀断言）', async () => {
    const source = await readFile(path.join(SKILL_DIR, 'download.ts'), 'utf8')
    expect(source).toContain("startsWith('https://')")
  })
})
