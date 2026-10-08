import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createReviewReadDailyTool, runReadDaily } from '../../src/tools/review-daily.ts'
import { validateDataPackage } from '../../src/summary/package-schema.ts'
import { makeFacades, makeTempRoot, seedDoc, TRADE_DATE } from './helpers.ts'

/**
 * 生成旧版合法数据包。
 * 业务逻辑: 提供完整行情与涨停信封，隔离卡片字段校验。
 * 关键判断: 不添加 images，以验证旧包兼容。
 * 异常处理: 无 IO，不抛业务异常。
 * 参数: 无。
 * 返回: 可独立修改的原始数据包。
 */
function dataPackage() {
  const sourced = { value: null, source: null, fetchedAt: null }
  return {
    code: '600000', name: '浦发银行', tradeDate: TRADE_DATE, generatedAt: '2026-09-24T15:00:00Z',
    cards: [{ anchor: 'card-20260924-600000-1432', writtenAt: '14:32', body: '观察' }],
    quote: { available: true, fields: {}, source: null, fetchedAt: null, cacheReused: 'none', skillVersion: 'unknown' },
    limitReason: { available: false, tradeDate: TRADE_DATE, cause: sourced, firstTime: sourced, lastTime: sourced,
      openCount: sourced, streakDesc: sourced, source: null, fetchedAt: null, notes: [], errors: [] },
    missing: [],
  }
}

describe('旧卡片兼容', () => {
  it('无图片的 read_daily 继续返回原三字段卡片', async () => {
    const root = makeTempRoot()
    try {
      await seedDoc(root, '600000', '浦发银行')
      const result = await runReadDaily(makeFacades(root), { code: '600000', tradeDate: TRADE_DATE })
      expect(Object.keys(result.cards[0]).sort()).toEqual(['anchor', 'body', 'writtenAt'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('旧数据包校验通过并保留原引用', () => {
    const pkg = dataPackage()
    expect(validateDataPackage(pkg)).toBe(pkg)
    const zoned = { ...pkg, generatedAt: '2026-09-24T15:00:00+08:00' }
    expect(validateDataPackage(zoned)).toBe(zoned)
    expect(() => validateDataPackage({ ...pkg, generatedAt: '2026-09-24T15:00:00+09:00' })).toThrow('generatedAt')
  })
})

describe('卡片图片进入 agent 数据包', () => {
  it('read_daily 返回可用与缺失图片，并在渲染中给出路径和状态', async () => {
    const root = makeTempRoot()
    try {
      const body = '观察\n![[files/chart.png]]\n![[files/missing.jpg]]'
      const docPath = await seedDoc(root, '600000', '浦发银行', { body })
      const path = join(dirname(docPath), 'files', 'chart.png')
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=', 'base64'))
      const result = await runReadDaily(makeFacades(root), { code: '600000', tradeDate: TRADE_DATE })
      expect(result.cards[0]).toMatchObject({ body, images: [
        { path, mimeType: 'image/png', available: true },
        { path: '', mimeType: '', available: false },
      ] })
      expect(result.warnings.join(' ')).toContain('missing.jpg')
      const tool = createReviewReadDailyTool(makeFacades(root)) as unknown as {
        output: { schema: { properties: { cards: { items: { properties: Record<string, unknown> } } } };
          render: (args: unknown, value: unknown) => Array<{ text: string }> }
      }
      const rendered = tool.output.render({}, result)[0].text
      expect(rendered).toContain(path)
      expect(rendered).toContain('available=true')
      expect(rendered).toContain('available=false')
      expect(tool.output.schema.properties.cards.items.properties).toHaveProperty('images')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('数据包保留合法 images，并拒绝非法元数据与字段类型', () => {
    const image = { relativePath: 'files/chart.png', path: join(import.meta.dirname, 'chart.png'), mimeType: 'image/png', available: true }
    const pkg = { ...dataPackage(), cards: [{ ...dataPackage().cards[0], images: [image] }] }
    expect(validateDataPackage(pkg)).toBe(pkg)
    for (const [key, value] of Object.entries({ relativePath: '', path: '', mimeType: 'text/plain', available: 'true' })) {
      const invalid = { ...pkg, cards: [{ ...pkg.cards[0], images: [{ ...image, [key]: value }] }] }
      expect(() => validateDataPackage(invalid), key).toThrow(`cards[0].images[0].${key}`)
    }
    expect(() => validateDataPackage({ ...pkg, cards: [{ ...pkg.cards[0], images: null }] })).toThrow('cards[0].images')
    expect(validateDataPackage({ ...pkg, cards: [{ ...pkg.cards[0], images: [] }] }).cards[0].images).toEqual([])
    const missingImage = { relativePath: 'files/missing.jpg', path: '', mimeType: '', available: false }
    const missingPkg = { ...pkg, cards: [{ ...pkg.cards[0], images: [missingImage] }] }
    expect(validateDataPackage(missingPkg)).toBe(missingPkg)
  })
})

