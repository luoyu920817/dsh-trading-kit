import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveTraderKitConfig } from '../../src/config.ts'
import { AREA_TABLE } from '../../src/paths/mapping.ts'
import { resolveArea } from '../../src/paths/resolve.ts'
import { createStockProfileIfMissing } from '../../src/review/profile-create.ts'
import { readStockProfiles, stockProfileSnapshot } from '../../src/review/profile.ts'
import { createReviewLoopFacades, runStockProfiles } from '../../src/tools/review-loop.ts'
import type { Context } from '../../src/context-types.ts'
import { createReviewHandler, REVIEW_PAGE_PATH } from '../../src/routes/review.ts'
import { jsonBody, makeDeps, makeReq, makeRes } from '../routes-review/helpers.ts'

const roots: string[] = []
/** 业务逻辑: 创建真实独立测试根。关键判断: 每例使用不同根。异常处理: I/O错误透传。参数: 无。返回: 临时根。 */
async function root(): Promise<string> { const path = await mkdtemp(join(tmpdir(), 'dtk-directories-')); roots.push(path); return path }
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

describe('可配置相对目录', () => {
  it('默认沿映射表，自定义目录不污染默认表或其他配置', () => {
    expect(resolveTraderKitConfig().directories).toEqual({ stock: AREA_TABLE.stock.dir, patterns: AREA_TABLE.patterns.dir })
    expect(resolveTraderKitConfig({ directories: { stock: '研究/标的', patterns: '研究/模式' } }).directories).toEqual({ stock: '研究/标的', patterns: '研究/模式' })
    expect(resolveTraderKitConfig().directories.stock).toBe('DB/stock')
    expect(AREA_TABLE.stock.dir).toBe('DB/stock')
  })
  it.each(['', '.', '../逃逸', 'a/../b', 'C:/outside', 'C:outside', '/outside', '\\outside', 'a\u0000b', '<YYYYMM>', 'a//b'])('拒绝不安全目录 %j', value => {
    expect(() => resolveTraderKitConfig({ directories: { stock: value } })).toThrow()
    expect(() => resolveTraderKitConfig({ directories: { patterns: value } })).toThrow()
  })
  it('只为标的和模式覆盖目录，模式仍禁止写入', () => {
    const dataRoot = 'C:/data'
    expect(resolveArea(dataRoot, 'stock', {}, { directory: '研究/标的' }).relPath).toBe('研究/标的')
    expect(resolveArea(dataRoot, 'patterns', {}, { directory: '研究/模式' }).relPath).toBe('研究/模式')
    expect(() => resolveArea(dataRoot, 'patterns', {}, { directory: '研究/模式', forWrite: true })).toThrow(/预留/)
    expect(() => resolveArea(dataRoot, 'agentSkills', {}, { directory: '研究/标的' })).toThrow()
  })
  it('两个根使用不同目录，读取和首卡建档均使用绑定目录且既有档案不改', async () => {
    const [a, b] = await Promise.all([root(), root()])
    const directories = ['研究/标的', '另一套/股票']
    for (const [index, dataRoot] of [a, b].entries()) {
      const directory = directories[index]
      await mkdir(join(dataRoot, directory), { recursive: true })
      expect(await createStockProfileIfMissing({ dataRoot, directory, code: '600000', name: '浦发银行' })).toMatchObject({ status: 'created', path: `${directory}/浦发银行.md` })
      const path = join(dataRoot, directory, '浦发银行.md')
      const before = { text: await readFile(path, 'utf8'), mtime: (await stat(path)).mtimeMs }
      expect(await createStockProfileIfMissing({ dataRoot, directory, code: '600000', name: '浦发银行' })).toMatchObject({ status: 'skipped', reason: 'exists' })
      expect(await readFile(path, 'utf8')).toBe(before.text)
      expect((await stat(path)).mtimeMs).toBe(before.mtime)
      expect((await readStockProfiles(dataRoot, { codes: ['600000'] }, { directory })).entries).toMatchObject([{ path: `${directory}/浦发银行.md`, code: '600000' }])
      expect((await readStockProfiles(dataRoot, { codes: ['600000'] })).entries).toEqual([])
      const ctx = { traderKit: { data: { dataRoot, directories: { stock: directory, patterns: '研究/模式' } } } } as unknown as Context
      expect((await runStockProfiles(createReviewLoopFacades(ctx), { codes: ['600000'] })).entries).toMatchObject([{ path: `${directory}/浦发银行.md` }])
    }
    const first = stockProfileSnapshot(a, undefined, { directory: directories[0] })
    const second = stockProfileSnapshot(a, undefined, { directory: directories[1] })
    expect(first).not.toBe(second)
    await Promise.all([first.refresh(), second.refresh()])
    expect(first.value?.profiles).toHaveLength(1)
    expect(second.value?.profiles).toEqual([])
  })
  it('复盘路由的档案快照绑定自定义目录，忽略默认目录的同代码档案', async () => {
    const dataRoot = await root()
    await Promise.all([mkdir(join(dataRoot, '自选/标的'), { recursive: true }), mkdir(join(dataRoot, 'DB/stock'), { recursive: true })])
    await writeFile(join(dataRoot, '自选/标的/微盘股.md'), '---\n代码: "880823"\n锚点: true\n角色: "自选目录"\n---\n')
    await writeFile(join(dataRoot, 'DB/stock/旧档.md'), '---\n代码: "880823"\n锚点: true\n角色: "旧目录"\n---\n')
    await stockProfileSnapshot(dataRoot, undefined, { directory: '自选/标的' }).refresh()
    const { deps } = makeDeps({ dataRoot })
    deps.stockDirectory = '自选/标的'
    const { res, rec } = makeRes()
    await createReviewHandler(deps)(makeReq({ url: REVIEW_PAGE_PATH + '/api/local?code=880823', headers: { cookie: 'dsh-auth=ok' } }), res)
    expect(rec.status).toBe(200)
    expect(jsonBody<{ anchor: { name: string; role: string } }>(rec).anchor).toMatchObject({ name: '微盘股', role: '自选目录' })
  })
  it('自定义目录符号链接越界时不读、不创建或删除外部档案', async () => {
    const [dataRoot, outside] = await Promise.all([root(), root()])
    const external = join(outside, '浦发银行.md')
    await writeFile(external, '---\n代码: "600000"\n角色: "外部"\n---\n')
    await symlink(outside, join(dataRoot, 'escaped'), 'junction')
    await expect(readStockProfiles(dataRoot, { codes: ['600000'] }, { directory: 'escaped' })).rejects.toThrow(/越界|符号链接/)
    await expect(createStockProfileIfMissing({ dataRoot, directory: 'escaped', code: '600000', name: '浦发银行' })).rejects.toThrow(/越界|符号链接/)
    await expect(createStockProfileIfMissing({ dataRoot, directory: 'escaped', code: '600001', name: '其他' })).rejects.toThrow(/越界|符号链接/)
    expect(await readFile(external, 'utf8')).toContain('外部')
    await expect(stat(join(outside, '其他.md'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('档案目标本身为目录链接时建档拒绝，外部目标字节保持不变', async () => {
    const [dataRoot, outside] = await Promise.all([root(), root()])
    await mkdir(join(dataRoot, '标的'), { recursive: true })
    const external = join(outside, 'real.md')
    const text = '---\n代码: "600000"\n角色: "人工"\n---\n'
    await writeFile(external, text)
    await symlink(outside, join(dataRoot, '标的/浦发银行.md'), 'junction')
    await expect(createStockProfileIfMissing({ dataRoot, directory: '标的', code: '600000', name: '浦发银行' })).rejects.toThrow(/符号链接/)
    expect(await readFile(external, 'utf8')).toBe(text)
    expect((await readStockProfiles(dataRoot, { codes: ['600000'] }, { directory: '标的' })).entries).toEqual([])
  })
})
