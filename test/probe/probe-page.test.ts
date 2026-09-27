/**
 * 探针页 HTML 常量结构断言（tasks 1.3；design D-2/D-6）：
 * 离线自包含（无外链、页面侧零网络请求）、语法上限（ES2017 基线内、无
 * ES module / 可选链 / 顶层 await）、注入占位符唯一、6 种联动写法布点、
 * 内联的解析函数与单测同一实现。
 */
import { describe, expect, it } from 'vitest'
import { PROBE_HTML, PROBE_PAGE_MARKER, PROBE_STATE_PLACEHOLDER } from '../../src/client/probe/index.html.ts'
import { parseProbeParams } from '../../src/client/probe/params.ts'

describe('PROBE_HTML：离线自包含（design D-2）', () => {
  it('无任何 http(s):// 外链（含注释与属性）', () => {
    expect(PROBE_HTML).not.toMatch(/https?:\/\//i)
  })

  it('页面侧不发起网络请求：无请求调用点（fetch 仅作为 typeof 特性探测名出现）', () => {
    expect(PROBE_HTML).not.toMatch(/fetch\s*\(/)
    expect(PROBE_HTML).not.toContain('XMLHttpRequest')
    expect(PROBE_HTML).not.toMatch(/new\s+WebSocket/)
    expect(PROBE_HTML).not.toMatch(/\bsendBeacon\s*\(/)
  })
})

describe('PROBE_HTML：语法上限 = 基线页已证级别（ES2017 + Fetch + Promise）', () => {
  it('无 ES module 语法', () => {
    expect(PROBE_HTML).not.toMatch(/\bimport\b/)
    expect(PROBE_HTML).not.toMatch(/\bexport\b/)
    expect(PROBE_HTML).not.toMatch(/type=["']module["']/)
  })

  it('无可选链 / 空值合并 / async / await / 模板字符串', () => {
    expect(PROBE_HTML).not.toContain('?.')
    expect(PROBE_HTML).not.toContain('??')
    expect(PROBE_HTML).not.toMatch(/\basync\b/)
    expect(PROBE_HTML).not.toMatch(/\bawait\b/)
    expect(PROBE_HTML).not.toContain('`')
  })
})

describe('PROBE_HTML：结构与注入占位符', () => {
  it('含探针页标记与关键自检结点', () => {
    expect(PROBE_HTML).toContain(PROBE_PAGE_MARKER)
    expect(PROBE_HTML).toContain('dsh-trader-kit 探针页')
    expect(PROBE_HTML).toContain('由服务端注入，非页面自证')
    expect(PROBE_HTML).toContain('id="probe-state"')
    expect(PROBE_HTML).toContain('id="probe-selfcheck"')
    expect(PROBE_HTML).toContain('id="probe-params"')
    expect(PROBE_HTML).toContain('id="probe-input"')
    expect(PROBE_HTML).toContain("addEventListener('hashchange'")
    expect(PROBE_HTML).toContain('id="probe-hash-log"')
    expect(PROBE_HTML).toContain('id="probe-link-log"')
  })

  it('自检输出覆盖 URL / hash / query / UA / 特性探测 / 加载时间戳', () => {
    expect(PROBE_HTML).toContain('location.href')
    expect(PROBE_HTML).toContain('location.search')
    expect(PROBE_HTML).toContain('location.hash')
    expect(PROBE_HTML).toContain('navigator.userAgent')
    expect(PROBE_HTML).toContain('typeof')
    expect(PROBE_HTML).toContain('页面加载时间戳')
  })

  it('注入占位符恰出现一次；script 闭合标签恰 2 个（注入转义测试的基线）', () => {
    expect(PROBE_HTML.split(PROBE_STATE_PLACEHOLDER).length - 1).toBe(1)
    expect(PROBE_HTML.match(/<\/script>/g)).toHaveLength(2)
  })

  it('拒绝态不设枚举取值（页面不出现 rejection 取值文案）', () => {
    expect(PROBE_HTML).not.toContain("'rejection'")
  })
})

describe('PROBE_HTML：点击联动写法布点（D-6，恰好 6 种）', () => {
  it('data-probe-way 布点恰 6 个且编号 1..6', () => {
    const ways = PROBE_HTML.match(/data-probe-way="\d+"/g) ?? []
    expect(ways).toHaveLength(6)
    for (let n = 1; n <= 6; n++) {
      expect(ways).toContain('data-probe-way="' + String(n) + '"')
    }
  })

  it('6 种写法逐一在页面侧有对应实现（onclick 属性 / element.click / dispatchEvent / window.open / postMessage / location.hash）', () => {
    expect(PROBE_HTML).toContain('onclick="probeLinkWay(1)"')
    expect(PROBE_HTML).toContain('.click()')
    expect(PROBE_HTML).toContain('dispatchEvent(')
    expect(PROBE_HTML).toContain('window.open(')
    expect(PROBE_HTML).toContain('postMessage(')
    expect(PROBE_HTML).toContain('location.hash = ')
  })
})

describe('PROBE_HTML：与单测同一份解析实现（tasks 1.8）', () => {
  it('页面内联了 parseProbeParams 的运行时序列化源', () => {
    const src = parseProbeParams.toString()
    expect(src.length).toBeGreaterThan(0)
    expect(PROBE_HTML).toContain(src)
  })
})
