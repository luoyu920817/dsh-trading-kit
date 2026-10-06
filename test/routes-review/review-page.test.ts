/**
 * 复盘页 HTML 常量结构断言（change 4 tasks 4.1–4.8；design D-2/D-11/D-18）：
 * 离线自包含（无外链字面、treeid 拼接构造、同源 API 面固定）、语法上限
 * （ES2017 + Fetch + Promise 保守子集：无 ES module / 可选链 / 空值合并 /
 * 模板字符串 / async / await）、四区块标记、注入占位符唯一、writable 降级
 * 逻辑布点、内联解析函数与单测同一实现。
 */
import { describe, expect, it } from 'vitest'
import { REVIEW_HTML, REVIEW_PAGE_MARKER, REVIEW_STATE_PLACEHOLDER } from '../../src/client/review/index.html.ts'
import { parseReviewParams } from '../../src/client/review/params.ts'

describe('REVIEW_HTML：离线自包含（design D-2；spec「无外链」场景）', () => {
  it('无任何 http(s):// 外链字面（treeid 导航在 JS 内拼接构造）', () => {
    expect(REVIEW_HTML).not.toMatch(/https?:\/\//i)
    // 拼接构造存在且不含完整 URL 字面：
    expect(REVIEW_HTML).not.toContain('http://www.treeid')
    expect(REVIEW_HTML).not.toContain('https://www.treeid')
  })

  it('网络请求仅同源 /review/api/*：无第三方端点、无其它通道', () => {
    expect(REVIEW_HTML).toContain('fet' + 'ch(') // 同源 API 调用（页面上下文，非插件出站通道；拼接构造避免测试自匹配）
    expect(REVIEW_HTML).toContain("'/review/api/local'")
    expect(REVIEW_HTML).toContain("'/review/api/enrich'")
    expect(REVIEW_HTML).toContain("'/review/api/card'")
    expect(REVIEW_HTML).not.toContain('XMLHttpRequest')
    expect(REVIEW_HTML).not.toMatch(/new\s+WebSocket/)
    expect(REVIEW_HTML).not.toMatch(/\bsendBeacon\s*\(/)
    // fetch 目标只能是 basePath 相对拼接（apiUrl 产物），不存在字面 URL 目标。
    expect(REVIEW_HTML).toMatch(/fetch\(url/)            // 本地段/网络段
    expect(REVIEW_HTML).toMatch(/fetch\(basePath \+ '\/review\/api\/card'/) // 写入
  })
})

describe('REVIEW_HTML：语法上限 = 内嵌内核已证级别（ES2017 保守子集）', () => {
  it('无 ES module 语法', () => {
    expect(REVIEW_HTML).not.toMatch(/\bimport\b/)
    expect(REVIEW_HTML).not.toMatch(/\bexport\b/)
    expect(REVIEW_HTML).not.toMatch(/type=["']module["']/)
  })

  it('无可选链 / 空值合并 / async / await / 模板字符串', () => {
    expect(REVIEW_HTML).not.toContain('?.')
    expect(REVIEW_HTML).not.toContain('??')
    expect(REVIEW_HTML).not.toMatch(/\basync\b/)
    expect(REVIEW_HTML).not.toMatch(/\bawait\b/)
    expect(REVIEW_HTML).not.toContain('`')
  })
})

describe('REVIEW_HTML：四区块布局与关键布点（tasks 4.1–4.8）', () => {
  it('四区块自上而下有序：B1 头部 → B2 日期 → B3 输入 → B4 卡片', () => {
    for (const id of ['rv-b1', 'rv-b2', 'rv-b3', 'rv-b4']) {
      expect(REVIEW_HTML).toContain('id="' + id + '"')
    }
    expect(REVIEW_HTML.indexOf('id="rv-b1"')).toBeLessThan(REVIEW_HTML.indexOf('id="rv-b2"'))
    expect(REVIEW_HTML.indexOf('id="rv-b2"')).toBeLessThan(REVIEW_HTML.indexOf('id="rv-b3"'))
    expect(REVIEW_HTML.indexOf('id="rv-b3"')).toBeLessThan(REVIEW_HTML.indexOf('id="rv-b4"'))
  })

  it('B1：代码/名称分层 + 名称未获取态 + 按源业务日标注（服务端预置文案）+ treeid 链接布点', () => {
    expect(REVIEW_HTML).toContain('id="rv-code"')
    expect(REVIEW_HTML).toContain('id="rv-name"')
    expect(REVIEW_HTML).toContain('名称未获取')
    expect(REVIEW_HTML).toContain('frontmatter-history')
    expect(REVIEW_HTML).toContain('T2-S8')
    expect(REVIEW_HTML).toContain('id="rv-limit"')
    expect(REVIEW_HTML).toContain('涨停原因（点击展开）') // 默认收起可展开（owner 2026-10-05）
    expect(REVIEW_HTML).toContain('id="rv-concepts"')
    // owner 2026-10-05：treeid 链接移除（页面本身在 TDX 内，无需联动按钮）。
    expect(REVIEW_HTML).not.toContain('id="rv-treeid"')
    expect(REVIEW_HTML).not.toContain('在 TDX 中打开标的')
  })

  it('B2：自绘月历组件（owner 2026-10-05：原生 date 上下箭头弃用）+ 状态行去冗余', () => {
    expect(REVIEW_HTML).toContain('id="rv-date"')
    expect(REVIEW_HTML).toContain('id="rv-trade-state"')
    expect(REVIEW_HTML).not.toContain('type="date"') // 原生日历输入弃用（含其上下微调控件）
    expect(REVIEW_HTML).toContain('id="rv-cal"')
    expect(REVIEW_HTML).toContain('id="rv-cal-grid"')
    expect(REVIEW_HTML).toContain('rv-cal-sel') // 选中日高亮
    expect(REVIEW_HTML).toContain('id="rv-cal-clear"') // 清除 = 回到服务端自动归属
    expect(REVIEW_HTML).toContain('calSetOpen') // 开合/外点收起布点
    expect(REVIEW_HTML).toMatch(/function applyDateChange\(\)[\s\S]*?loadEnrich\(\)/) // 切日期重跑网络段（B1 按新日期补位）
    // owner 2026-10-05：状态行去冗余保持干净——日期可得时不朗读来源/待确认。
    expect(REVIEW_HTML).not.toContain('归属待确认')
    expect(REVIEW_HTML).not.toContain('查看日期：')
    // owner 2026-10-05：确认勾选框移除——预填最近期交易日，保存即显式提交。
    expect(REVIEW_HTML).not.toContain('id="rv-confirm-date"')
    expect(REVIEW_HTML).not.toContain('确认归属该交易日')
  })

  it('B3：输入 + 保存 + Ctrl+Enter + isComposing 忽略 + 提交中防重文案 + 预留区 disabled+tabindex=-1', () => {
    expect(REVIEW_HTML).toContain('id="rv-input"')
    expect(REVIEW_HTML).toContain('id="rv-save"')
    expect(REVIEW_HTML).toContain('Ctrl+Enter')
    expect(REVIEW_HTML).toContain('isComposing')
    expect(REVIEW_HTML).toContain("'compositionstart'")
    expect(REVIEW_HTML).toContain("'compositionend'")
    expect(REVIEW_HTML).toContain('保存中')
    expect(REVIEW_HTML).toContain('id="rv-reserve"')
    expect(REVIEW_HTML).toMatch(/id="rv-reserve"[^>]*disabled/)
    expect(REVIEW_HTML).toMatch(/id="rv-reserve"[^>]*tabindex="-1"/)
  })

  it('B4：时间倒序渲染 + 纯文本转义（textContent）+ 复制 block 引用 + warnings 显式展示', () => {
    expect(REVIEW_HTML).toContain('id="rv-cards"')
    expect(REVIEW_HTML).toContain('id="rv-warnings"')
    expect(REVIEW_HTML).toContain('list.length - 1') // 文档序的逆序 = 时间倒序
    expect(REVIEW_HTML).toContain('textContent = card.body') // 纯文本转义，不经 innerHTML
    expect(REVIEW_HTML).not.toContain('innerHTML')
    expect(REVIEW_HTML).toContain('复制引用')
    expect(REVIEW_HTML).toContain("'^' + anchor")
    expect(REVIEW_HTML).toContain('renderWarnings')
  })

  it('交互态五态布点 + clientRequestId 幂等复用 + 联动保护 draftOwnerCode/pendingOwner', () => {
    for (const state of ["'idle'", "'loading'", "'submitting'", "'error'", "'empty'"]) {
      expect(REVIEW_HTML).toContain(state)
    }
    expect(REVIEW_HTML).toContain('clientRequestId')
    expect(REVIEW_HTML).toContain('pendingRequestId')
    expect(REVIEW_HTML).toContain('draftOwnerCode')
    expect(REVIEW_HTML).toContain('pendingOwner')
    expect(REVIEW_HTML).toContain('未提交内容属于')
    expect(REVIEW_HTML).toContain('AbortController') // 网络段可中断
  })

  it('writable 降级逻辑布点（A 层不可用 → B3 禁用 + 提示 DSH 侧写卡）', () => {
    expect(REVIEW_HTML).toContain('window.__REVIEW__')
    expect(REVIEW_HTML).toContain('writable')
    expect(REVIEW_HTML).toContain('state.writable !== false')
    expect(REVIEW_HTML).toContain('id="rv-readonly-hint"')
    expect(REVIEW_HTML).toContain('DSH 会话侧写卡')
  })

  it('焦点顺序：B2 日期输入在 B3 输入框之前、B3 输入框在保存按钮之前（预留区 tabindex=-1 跳过）', () => {
    const dateAt = REVIEW_HTML.indexOf('id="rv-date"')
    const inputAt = REVIEW_HTML.indexOf('id="rv-input"')
    const saveAt = REVIEW_HTML.indexOf('id="rv-save"')
    expect(dateAt).toBeLessThan(inputAt)
    expect(inputAt).toBeLessThan(saveAt)
  })

  it('窄视口 320px：无横向滚动的样式约束（box-sizing / overflow-wrap / 100% 宽）', () => {
    expect(REVIEW_HTML).toContain('box-sizing: border-box')
    expect(REVIEW_HTML).toContain('max-width: 100%')
    expect(REVIEW_HTML).toContain('overflow-wrap: anywhere')
    expect(REVIEW_HTML).toContain('width: 100%')
  })
})

describe('REVIEW_HTML：结构与注入占位符', () => {
  it('含页面标记与标题', () => {
    expect(REVIEW_HTML).toContain(REVIEW_PAGE_MARKER)
    expect(REVIEW_HTML).toContain('dsh-trader-kit 复盘卡片')
  })

  it('注入占位符恰出现一次；script 闭合标签恰 2 个', () => {
    expect(REVIEW_HTML.split(REVIEW_STATE_PLACEHOLDER).length - 1).toBe(1)
    expect(REVIEW_HTML.match(/<\/script>/g)).toHaveLength(2)
  })

  it('内联了 parseReviewParams 的运行时序列化（与单测同一实现，tasks 2.3）', () => {
    const src = parseReviewParams.toString()
    expect(src.length).toBeGreaterThan(0)
    expect(REVIEW_HTML).toContain(src)
  })

  it('传参优先级与空态文案布点（原文取值 + 期望格式 + TDX 指引）', () => {
    expect(REVIEW_HTML).toContain('hashchange')
    expect(REVIEW_HTML).toContain('期望 6 位数字')
    expect(REVIEW_HTML).toContain('TDX 联动编码/参数模板')
    expect(REVIEW_HTML).toContain('不补全位数')
  })
})
