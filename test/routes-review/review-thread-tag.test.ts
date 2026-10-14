import { describe, expect, it } from 'vitest'
import { appendThreadTag, loadThreadTag, saveThreadTag, THREAD_STORAGE_KEY, THREAD_TAGS } from '../../src/client/review/thread-tag.ts'
import type { ThreadStorage } from '../../src/client/review/thread-tag.ts'
import { Script } from 'node:vm'
import { REVIEW_HTML } from '../../src/client/review/index.html.ts'

function memoryStorage(initial: Record<string, string> = {}): ThreadStorage & { map: Record<string, string> } {
  const map: Record<string, string> = { ...initial }
  return {
    map,
    getItem(key: string) { return Object.prototype.hasOwnProperty.call(map, key) ? map[key]! : null },
    setItem(key: string, value: string) { map[key] = value },
  }
}

describe('思考线条标签（owner 2026-10-13：交易日下方单选，卡片末行打 #标签）', () => {
  it('候选与四段工作流/锚点领域词汇对齐，另有模式与盘中记录线（owner 2026-10-13 追授盘中）', () => {
    expect(THREAD_TAGS).toEqual(['指数', '情绪周期', '题材', '赚钱效应', '模式', '盘中'])
    expect(THREAD_STORAGE_KEY).toBe('rvThreadTag')
  })

  it('保存时末行独立追加 #标签，尾随空白先收掉', () => {
    expect(appendThreadTag('盘面观察', '指数')).toBe('盘面观察\n#指数')
    expect(appendThreadTag('盘面观察\n\n', '指数')).toBe('盘面观察\n#指数')
    expect(appendThreadTag('指数尾盘缩量', '赚钱效应')).toBe('指数尾盘缩量\n#赚钱效应')
  })

  it('幂等：正文已含同名标签（手打/失败重试复跑）不重复追加', () => {
    expect(appendThreadTag('盘面观察\n#指数', '指数')).toBe('盘面观察\n#指数')
    expect(appendThreadTag('#情绪周期 主导', '情绪周期')).toBe('#情绪周期 主导')
  })

  it('未选 / 非候选标签原样返回', () => {
    const text = '盘面观察'
    expect(appendThreadTag(text, null)).toBe(text)
    expect(appendThreadTag(text, '追高')).toBe(text)
  })

  it('「保留上一次」：切选即落存储，跨会话恢复；只收候选内取值', () => {
    const storage = memoryStorage()
    expect(loadThreadTag(storage)).toBeNull()
    saveThreadTag(storage, '题材')
    expect(loadThreadTag(storage)).toBe('题材')
    saveThreadTag(storage, '模式')
    expect(loadThreadTag(storage)).toBe('模式')
    expect(loadThreadTag(memoryStorage({ rvThreadTag: '已废弃的旧值' }))).toBeNull()
    expect(loadThreadTag(null)).toBeNull()
  })

  it('存储抛错不致命：读取得 null，写入静默放弃', () => {
    const broken: ThreadStorage = {
      getItem() { throw new Error('SecurityError') },
      setItem() { throw new Error('QuotaExceededError') },
    }
    expect(loadThreadTag(broken)).toBeNull()
    expect(() => saveThreadTag(broken, '指数')).not.toThrow()
  })

  it('内联页里纯函数执行相同行为（与 image-draft 同范式）', () => {
    const inlineAppend = new Function('THREAD_TAGS', 'return (' + appendThreadTag.toString() + ')')(THREAD_TAGS) as typeof appendThreadTag
    expect(inlineAppend('盘面观察', '指数')).toBe('盘面观察\n#指数')
    expect(inlineAppend('盘面观察\n#指数', '指数')).toBe('盘面观察\n#指数')
    const inlineLoad = new Function('THREAD_TAGS', 'THREAD_STORAGE_KEY', 'return (' + loadThreadTag.toString() + ')')(THREAD_TAGS, THREAD_STORAGE_KEY) as typeof loadThreadTag
    const inlineSave = new Function('THREAD_STORAGE_KEY', 'return (' + saveThreadTag.toString() + ')')(THREAD_STORAGE_KEY) as typeof saveThreadTag
    const storage = memoryStorage()
    inlineSave(storage, '情绪周期')
    expect(inlineLoad(storage)).toBe('情绪周期')
    expect(inlineLoad(null)).toBeNull()
    expect(REVIEW_HTML).toContain(appendThreadTag.toString())
    expect(REVIEW_HTML).toContain(loadThreadTag.toString())
    expect(REVIEW_HTML).toContain(saveThreadTag.toString())
  })
})

describe('REVIEW_HTML：思考线条行布点（B2 交易日下方）', () => {
  const b2 = REVIEW_HTML.slice(REVIEW_HTML.indexOf('id="rv-b2"'), REVIEW_HTML.indexOf('id="rv-b3"'))

  it('单选行在 B2 内、交易日行之下，五个候选项齐全且醒目样式布点（行标签文案已去——owner 2026-10-13）', () => {
    expect(b2).toContain('id="rv-thread-row"')
    expect(b2).not.toContain('当前线条')
    expect(b2).not.toContain('rv-thread-label')
    for (const tag of THREAD_TAGS) {
      expect(b2).toContain('value="' + tag + '"')
      expect(b2).toContain('>' + tag + '</span>')
    }
    expect(b2.indexOf('id="rv-trade-state"')).toBeLessThan(b2.indexOf('id="rv-thread-row"')) // 交易日行下方
    expect(REVIEW_HTML).toContain('#rv-thread-row { margin-top: 8px; white-space: nowrap; }') // 单行展示（owner 2026-10-13 追授：窄面板不换行）
    expect(REVIEW_HTML).toContain('input:checked + .rv-thread-pill') // 选中态高亮
    expect(REVIEW_HTML).toContain('input:focus + .rv-thread-pill') // 键盘可达
    expect(REVIEW_HTML).toContain('type="radio"')
  })

  it('提交接线：末行追加 → payload 正文与图片同源 finalBody，成功回显用最终正文', () => {
    expect(REVIEW_HTML).toContain('var finalBody = appendThreadTag(text, threadTag);')
    expect(REVIEW_HTML).toContain('body: finalBody,')
    expect(REVIEW_HTML).toContain('selectDraftImages(finalBody, draftImages.items, parseImageEmbeds)')
    expect(REVIEW_HTML).toContain('prependCard({ anchor: r.body.anchor, writtenAt: r.body.writtenAt || \'\', body: finalBody })')
  })

  it('「保留上一次」接线：加载恢复选中 + 切选落存储 + 状态行即时提醒', () => {
    expect(REVIEW_HTML).toContain('loadThreadTag(threadStorage())')
    expect(REVIEW_HTML).toContain('threadRestoredInput.checked = true')
    expect(REVIEW_HTML).toContain("saveThreadTag(threadStorage(), threadTag)")
    expect(REVIEW_HTML).toContain('已选线条：')
  })

  it('完整内联脚本可编译', () => {
    const scripts = Array.from(REVIEW_HTML.matchAll(/<script>([\s\S]*?)<\/script>/g))
    expect(scripts).toHaveLength(2)
    expect(() => new Script(scripts[1]![1]!)).not.toThrow()
  })
})
