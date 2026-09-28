/**
 * 合规扫描脚本（change 5 daily-summary tasks 3.3；spec「合规与写作约束」）。
 *
 * 用法：
 *   node scripts/scan-compliance.mjs <dataRoot>     # 扫描 <dataRoot>/DB/review 下全部 md（含月份子目录）
 *   node scripts/scan-compliance.mjs --self-test    # 临时目录造样本自测（断言命中数）
 *
 * 扫描对象：每份 md 中 `^ainote-` 分节（H2 标题行含 `^ainote-`，至下一 H2 或文件末尾）
 * 的正文——**只看 AI 附注**，不扫用户卡片（用户主观记录不受门禁约束）。
 * 解析口径与迭代一契约 §2 一致：逐行、跳过 fenced code block（``` / ~~~ 围栏）。
 *
 * 检查项：
 * ① 负向词表命中数（判定标准 = **零命中**，任一命中即不通过）：
 *    必须买 / 建议买入 / 目标价 / 必涨 / 可重仓 / 确定性加仓 / 满仓 / 稳赚 / 保证收益
 * ② 每份附注含固定定位声明行「研究辅助、不构成投资建议」。
 *
 * 退出码：0 = 零命中且声明齐备（或未发现任何附注——无检查对象，显式说明）；
 * 1 = 存在命中或声明缺失。
 */

import { readdirSync, readFileSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

export const NEGATIVE_WORDS = [
  '必须买',
  '建议买入',
  '目标价',
  '必涨',
  '可重仓',
  '确定性加仓',
  '满仓',
  '稳赚',
  '保证收益',
]

export const DECLARATION_LINE = '研究辅助、不构成投资建议'

/**
 * 单份文档的扫描结果（typedef）。
 *
 * @typedef {object} FileScanResult
 * @property {string} file
 * @property {number} ainoteCount
 * @property {Array<{word: string, line: number}>} hits  负向词命中：词@行号 清单。
 * @property {string[]} missingDeclaration  缺定位声明的附注锚点清单。
 */

/** 逐行切出 `^ainote-` 分节（跳过 fenced code block 内的行）。 */
export function extractAinoteSections(text) {
  const lines = text.split(/\r?\n/)
  const sections = []
  let current = null // { anchor, startLine, lines[] }
  let inSection = false
  let fence = null // '```' | '~~~' | null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    if (fence !== null) {
      if (current !== null && inSection) current.lines.push({ line, lineNo: i + 1, fenced: true })
      if (trimmed.startsWith(fence)) fence = null
      continue
    }
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      fence = trimmed.startsWith('```') ? '```' : '~~~'
      if (current !== null && inSection) current.lines.push({ line, lineNo: i + 1, fenced: true })
      continue
    }
    if (trimmed.startsWith('## ')) {
      // H2 行：附注分节起点（^ainote-）或其它分节边界。
      const m = /\^ainote-\d{8}-\d{6}-\d{4}(?:-\d+)?/.exec(trimmed)
      if (m !== null) {
        current = { anchor: m[0], startLine: i + 1, lines: [] }
        inSection = true
        sections.push(current)
      } else {
        inSection = false
        current = null
      }
      continue
    }
    if (inSection && current !== null) current.lines.push({ line, lineNo: i + 1, fenced: false })
  }
  return sections
}

/** 扫描单份文档：负向词命中（限附注正文、跳过围栏内行）+ 定位声明检查。 */
export function scanFileText(text, file) {
  const sections = extractAinoteSections(text)
  const result = { file, ainoteCount: sections.length, hits: [], missingDeclaration: [] }
  for (const section of sections) {
    let hasDeclaration = false
    for (const { line, lineNo, fenced } of section.lines) {
      if (fenced) continue
      if (line.includes(DECLARATION_LINE)) hasDeclaration = true
      for (const word of NEGATIVE_WORDS) {
        if (line.includes(word)) result.hits.push({ word, line: lineNo })
      }
    }
    if (!hasDeclaration) result.missingDeclaration.push(section.anchor)
  }
  return result
}

function listMarkdownFiles(rootDir, out = []) {
  let entries
  try {
    entries = readdirSync(rootDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(rootDir, entry.name)
    if (entry.isDirectory()) listMarkdownFiles(full, out)
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

/** 扫描 dataRoot 下 DB/review 的全部 md（含月份子目录）；返回逐文件结果与总命中数。 */
export function scanCompliance(dataRoot) {
  const reviewDir = join(dataRoot, 'DB', 'review')
  const files = listMarkdownFiles(reviewDir)
  const results = []
  for (const file of files) {
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue // 读取失败不阻塞其它文件
    }
    results.push(scanFileText(text, file))
  }
  const totalHits = results.reduce((sum, r) => sum + r.hits.length, 0)
  const totalMissingDeclaration = results.reduce((sum, r) => sum + r.missingDeclaration.length, 0)
  const ainoteCount = results.reduce((sum, r) => sum + r.ainoteCount, 0)
  return { files: results, ainoteCount, totalHits, totalMissingDeclaration, pass: totalHits === 0 && totalMissingDeclaration === 0 }
}

function printReport(dataRoot, report) {
  console.log(`合规扫描：${join(dataRoot, 'DB', 'review')}（负向词表 ${NEGATIVE_WORDS.length} 词；判定标准 = 零命中）`)
  console.log(`检查文档 ${report.files.length} 份，附注 ${report.ainoteCount} 条`)
  for (const r of report.files) {
    const hitText = r.hits.length === 0 ? '命中 0' : r.hits.map((h) => `${h.word}@行${h.line}`).join(', ')
    const declText = r.missingDeclaration.length === 0 ? '' : `；缺定位声明：${r.missingDeclaration.join(', ')}`
    console.log(`- ${r.file}｜附注 ${r.ainoteCount} 条｜${hitText}${declText}`)
  }
  console.log(`负向词命中总数：${report.totalHits}；定位声明缺失：${report.totalMissingDeclaration}`)
  console.log(report.pass ? '结论：PASS（零命中且声明齐备）' : '结论：FAIL（存在命中或声明缺失）')
  if (report.ainoteCount === 0) console.log('说明：未发现任何附注（无检查对象；真实产出验收需 N≥5 份）')
}

// ---------------------------------------------------------------------------
// 自测（tasks 3.3：临时目录造样本断言命中数；node scripts/scan-compliance.mjs --self-test）
// ---------------------------------------------------------------------------

function cleanAinoteDoc(code, name) {
  return [
    '---',
    `code: "${code}"`,
    `name: "${name}"`,
    'tradeDate: "2026-09-24"',
    'subjective: true',
    '---',
    '',
    '## 09:30 ^card-20260924-' + code + '-0930',
    '- writtenAt: 2026-09-24T09:30:00+08:00',
    '',
    '早盘观察（用户主观记录，不受扫描约束）：量能一般',
    '',
    '## 15:01 ^ainote-20260924-' + code + '-1501',
    '- generatedAt: 2026-09-24T15:01:00+08:00',
    '- dataSources: quote.close=tq-local@2026-09-24',
    '',
    '- tradeDate: 2026-09-24',
    '- code: ' + code,
    '- missing: none',
    '- cacheReused: quote=false',
    '',
    '数据完整性：完整',
    '',
    DECLARATION_LINE,
    '',
    '① 事实：数据来自 TQ skill 与 T1（2026-09-24）。',
    '② 当日表现：收盘价来自 tq-local（fetchedAt 见上）。',
    '③ 待跟踪：明日核对量能变化（不构成建议）。',
  ].join('\n')
}

function runSelfTest() {
  const failures = []
  const check = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    if (!ok) failures.push(`${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`)
    else console.log(`ok: ${label}`)
  }

  const root = mkdtempSync(join(tmpdir(), 'dtk-compliance-'))
  try {
    const monthDir = join(root, 'DB', 'review', '202609')
    mkdirSync(monthDir, { recursive: true })
    // 5 份干净附注（每份含声明、零命中）。
    const cleanCodes = ['600000', '600001', '000002', '300750', '430047']
    for (let i = 0; i < cleanCodes.length; i++) {
      writeFileSync(join(monthDir, `${cleanCodes[i]}_样本${i}_20260924.md`), cleanAinoteDoc(cleanCodes[i], `样本${i}`), 'utf8')
    }
    // 1 份含负向词（建议买入 ×2 行）。
    writeFileSync(join(monthDir, '600002_命中_20260924.md'), cleanAinoteDoc('600002', '命中').replace('③ 待跟踪：明日核对量能变化（不构成建议）。', '③ 建议：建议买入（目标价 12.5）。'), 'utf8')
    // 1 份缺定位声明。
    writeFileSync(join(monthDir, '600003_缺声明_20260924.md'), cleanAinoteDoc('600003', '缺声明').replace(DECLARATION_LINE, '本节无声明行'), 'utf8')
    // 1 份用户卡片正文含负向词（附注之外 → 不计入命中）。
    writeFileSync(join(monthDir, '600004_卡片含词_20260924.md'), cleanAinoteDoc('600004', '卡片含词').replace('早盘观察（用户主观记录，不受扫描约束）：量能一般', '早盘观察：这票满仓干'), 'utf8')
    // 1 份附注围栏内含负向词（跳过围栏 → 不计入命中）。
    writeFileSync(join(monthDir, '600005_围栏含词_20260924.md'), cleanAinoteDoc('600005', '围栏含词').replace('③ 待跟踪：明日核对量能变化（不构成建议）。', '③ 引用示例：\n```\n必涨示例文本\n```\n（引用完）'), 'utf8')

    const report = scanCompliance(root)
    check('附注总数', report.ainoteCount, 9)
    check('总命中数（仅附注正文、跳过围栏）', report.totalHits, 2)
    const hitDoc = report.files.find((f) => f.file.includes('600002'))
    check('命中文件命中数', hitDoc.hits.length, 2)
    check('命中词', hitDoc.hits.map((h) => h.word).sort(), ['建议买入', '目标价'])
    const missingDoc = report.files.find((f) => f.file.includes('600003'))
    check('缺声明附注数', missingDoc.missingDeclaration.length, 1)
    check('卡片含词不计入（600004）', report.files.find((f) => f.file.includes('600004')).hits.length, 0)
    check('围栏含词不计入（600005）', report.files.find((f) => f.file.includes('600005')).hits.length, 0)
    check('判定', report.pass, false)

    // 全干净目录 → PASS。
    const cleanRoot = mkdtempSync(join(tmpdir(), 'dtk-compliance-clean-'))
    try {
      const cleanMonth = join(cleanRoot, 'DB', 'review', '202609')
      mkdirSync(cleanMonth, { recursive: true })
      for (const code of cleanCodes) {
        writeFileSync(join(cleanMonth, `${code}_干净_20260924.md`), cleanAinoteDoc(code, '干净'), 'utf8')
      }
      const cleanReport = scanCompliance(cleanRoot)
      check('干净目录命中数', cleanReport.totalHits, 0)
      check('干净目录缺声明数', cleanReport.totalMissingDeclaration, 0)
      check('干净目录判定', cleanReport.pass, true)
      check('干净目录附注数（N≥5）', cleanReport.ainoteCount, 5)
    } finally {
      rmSync(cleanRoot, { recursive: true, force: true, maxRetries: 2 })
    }
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 2 })
  }

  if (failures.length > 0) {
    console.error(`自测失败 ${failures.length} 项：`)
    for (const f of failures) console.error(`- ${f}`)
    return 1
  }
  console.log('自测通过：命中计数、声明检查、围栏/卡片排除全部符合预期。')
  return 0
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

export function main(argv) {
  const arg = argv[2]
  if (arg === '--self-test') return runSelfTest()
  if (arg === undefined || arg === '') {
    console.error('用法：node scripts/scan-compliance.mjs <dataRoot>（或 --self-test）')
    return 2
  }
  const dataRoot = arg.endsWith(sep) ? arg.slice(0, -sep.length) : arg
  if (!statSync(dataRoot, { throwIfNoEntry: false })?.isDirectory()) {
    console.error(`数据根不存在或不是目录：${dataRoot}`)
    return 2
  }
  const report = scanCompliance(dataRoot)
  printReport(dataRoot, report)
  return report.pass ? 0 : 1
}

if (process.argv[1] !== undefined && process.argv[1].replace(/\\/g, '/').endsWith('scripts/scan-compliance.mjs')) {
  process.exit(main(process.argv))
}
