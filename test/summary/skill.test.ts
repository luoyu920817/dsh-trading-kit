/**
 * skill 文案校验（change 5 tasks 1.1/1.5/3.1）——读真实仓库文件，
 * 断言 frontmatter 合法 + 正文必需小节齐备 + 负向词表全词条 + 收尾出口要求。
 * 删除任一小节或改坏 name 时用例独立失败（tasks 1.5 验收）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SKILL_PATH = join(import.meta.dirname, '..', '..', 'skills', 'review-daily-summary', 'SKILL.md')
const text = readFileSync(SKILL_PATH, 'utf8')

const NEGATIVE_WORDS = [
  '必须买', '建议买入', '目标价', '必涨', '可重仓',
  '确定性加仓', '满仓', '稳赚', '保证收益',
]

/** 必需小节（tasks 1.1 验收清单：缺一即失败）。 */
const REQUIRED_SECTIONS = [
  'W1 触发', // 触发与定位（盘后/单标的/零打扰）
  'W2 扫描',
  'W3 逐标的取数与数据包组装', // 数据包 schema
  'W4 生成总结', // 写作约束
  'W5 提交',
  '失败判定矩阵与重算指引',
  '预算预检与分批',
  '定位声明',
  // review-loop 追加小节（缺一即失败）
  '触发短语（面板与会话同文）',
  'W6 盘面整理收尾',
  '标的档案格式（数据格式化建议',
]

/** 数据包 schema 必需字段（spec「数据包 schema」）。 */
const REQUIRED_PACKAGE_FIELDS = [
  'quote', 'limitReason', 'profile', 'missing', 'source', 'fetchedAt', 'skillVersion', 'cacheReused',
]

function frontmatter(): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (m === null) throw new Error('SKILL.md 缺 frontmatter')
  const out: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-zA-Z]+):\s*(.*)$/.exec(line)
    if (kv !== null) out[kv[1]] = kv[2].trim()
  }
  return out
}

describe('review-daily-summary skill（tasks 1.1/1.5/3.1）', () => {
  it('W3 实际调用宿主 read_image 并对图片失败明确降级', () => {
    const w3 = text.split('## W3 ')[1].split('## W4 ')[0]
    expect(w3).toContain('read_image({file_path: image.path})')
    for (const keyword of ['available', '去重', '工具隐藏', '模型无视觉', 'missing', 'warnings', '四态', 'MUST NOT 假称已读图']) {
      expect(w3).toContain(keyword)
    }
    expect(text.split('## W4 ')[1]).toContain('图片')
  })
  it('frontmatter 合法：name kebab-case、description 含触发时机、version 版本载体', () => {
    const fm = frontmatter()
    expect(fm.name).toBe('review-daily-summary')
    expect(fm.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    expect(fm.description.length).toBeGreaterThan(10)
    expect(fm.description).toMatch(/盘后|触发/)
    expect(fm.version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('正文含全部必需小节（缺任一独立失败）', () => {
    for (const section of REQUIRED_SECTIONS) {
      expect(text.includes(section), `缺小节: ${section}`).toBe(true)
    }
  })

  it('数据包 schema 含全部字段名与 missing 原因枚举', () => {
    for (const field of REQUIRED_PACKAGE_FIELDS) {
      expect(text.includes(field), `数据包缺字段: ${field}`).toBe(true)
    }
    // missing 原因枚举（§12.8 分档）。
    expect(text.includes('sourceUnavailable')).toBe(true)
    expect(text.includes('noRecord')).toBe(true)
    expect(text.includes('dateMismatch')).toBe(true)
    // 「数据不可得」表述在案；不把 dateUnavailable 写成「无涨停记录」。
    expect(text.includes('数据不可得')).toBe(true)
  })

  it('负向词表全部词条在案（写作约束）+ 固定定位声明行', () => {
    for (const word of NEGATIVE_WORDS) {
      expect(text.includes(word), `负向词表缺词条: ${word}`).toBe(true)
    }
    expect(text.includes('研究辅助、不构成投资建议')).toBe(true)
  })

  it('收尾 SHALL 要求调用 review_daily_report 提交四态 entries（判据由出口断言）', () => {
    expect(text.includes('review_daily_report')).toBe(true)
    for (const status of ['created', 'skipped', 'failed', 'deferred']) {
      expect(text.includes(status), `四态缺: ${status}`).toBe(true)
    }
  })

  it('当日表现经 TQ skill、涨停原因经 T1 的取数来源描述', () => {
    expect(text.includes('tq-local')).toBe(true)
    expect(text.includes('get_limit_reason') || text.includes('T1')).toBe(true)
  })

  it('review-loop：触发短语固定且不带日期字面量（面板与会话同文）', () => {
    expect(text).toContain('整理今日复盘：请按 review-daily-summary 工作流执行')
    const line = text.split('\n').find((l) => l.includes('整理今日复盘：请按')) ?? ''
    expect(line).not.toBe('')
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(line).not.toContain('${')
    expect(text).toContain('MUST NOT 带日期字面量')
  })

  it('review-loop：W3 标的档案步（工具/注入面收窄/数据包字段）在案', () => {
    expect(text).toContain('review_stock_profiles')
    expect(text).toContain('锚点: true')
    expect(text).toContain('MUST NOT')
    expect(text).toMatch(/热点标签[\s\S]{0,40}MUST NOT[\s\S]{0,20}进入生成上下文/)
  })

  it('review-loop：W6 盘面 md（唯一生产者/覆盖重写/独立性/无卡片跳过）在案', () => {
    expect(text).toContain('review_write_brief')
    expect(text).toContain('覆盖重写')
    expect(text).toContain('唯一生产者')
    expect(text).toContain('跳过 W6')
    expect(text).toContain('不改变')
  })

  it('review-loop：标的档案格式（角色/代码/锚点 + 8 个锚点清单）在案', () => {
    for (const key of ['角色', '代码', '锚点']) {
      expect(text.includes(key), `缺档案键: ${key}`).toBe(true)
    }
    for (const name of ['上证指数', '沪深300ETF', '科创50', '平均股价', '全A等权', '中证1000', '微盘股', '昨日涨停']) {
      expect(text.includes(name), `锚点清单缺: ${name}`).toBe(true)
    }
  })
})
