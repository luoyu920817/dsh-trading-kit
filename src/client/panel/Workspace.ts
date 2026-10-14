import { createElement as h, useState, type ReactElement } from 'react'

export const WORKSPACE_PAGES = {
  cards: { title: '复盘卡片', path: '/dsh-trader-kit/review' },
  runs: { title: '关键词任务', path: '/dsh-trader-kit/review/processors#runs' },
} as const

/**
 * 为用户显式选择的标的构造固定同源卡片页面。
 * 业务逻辑: 保留市场外壳，仅去空白；不猜代码或补全。
 * 关键判断: 只允许六位数字与既有市场前后缀，不接受任意URL。
 * 异常处理: 空值或非法输入返回null。参数: 用户标的代码。返回: 同源地址或null。
 */
export function reviewCardPage(raw: string): string | null {
  const code = raw.trim()
  if (!/^(?:(?:sh|sz|bj)?\d{6}|\d{6}\.(?:sh|sz|bj))$/i.test(code)) return null
  return WORKSPACE_PAGES.cards.path + '/' + encodeURIComponent(code)
}

/**
 * 左侧导航只提供图标。
 * 业务逻辑: 返回复盘图标，正文交给main槽。
 * 关键判断: 尺寸由宿主给出，不发送请求或聊天。
 * 异常处理: 不依赖可选服务。参数: 图标尺寸。返回: SVG元素。
 */
export function ReviewPanelIcon({ size = 20 }: { size?: number }): ReactElement {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, 'aria-hidden': true },
    h('rect', { x: 4, y: 3, width: 16, height: 18, rx: 2 }), h('path', { d: 'M8 8h8M8 12h8M8 16h5' }))
}

/**
 * 右侧主区域呈现复盘卡片与关键词任务。
 * 业务逻辑: 页签切换固定同源页面，复用鉴权和功能。
 * 关键判断: 配置在设置页；根作用域不发送会话消息。
 * 异常处理: iframe内的服务、认证和网络异常由已有页面显示。
 * 参数: 无。返回: 主页面React元素。
 */
export function ReviewWorkspace(): ReactElement {
  const [page, setPage] = useState<keyof typeof WORKSPACE_PAGES>('cards')
  const [draftCode, setDraftCode] = useState('')
  const [cardPage, setCardPage] = useState<string | null>(null)
  const [codeError, setCodeError] = useState('')
  const selected = WORKSPACE_PAGES[page]
  return h('section', { 'data-trader-kit-workspace': true, style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', color: 'inherit' } },
    h('header', { style: { padding: '18px 20px 10px', borderBottom: '1px solid #444' } },
      h('h1', { style: { margin: '0 0 12px', fontSize: 20 } }, '复盘'),
      h('nav', { 'aria-label': '复盘页面', style: { display: 'flex', gap: 8 } },
        ...Object.entries(WORKSPACE_PAGES).map(([id, info]) => h('button', {
          key: id, type: 'button', 'aria-pressed': page === id,
          style: { padding: '7px 12px', border: '1px solid #555', borderRadius: 6, background: page === id ? '#334155' : 'transparent', color: 'inherit', cursor: 'pointer' },
          /** 业务逻辑: 切换固定页签。关键判断: id来自常量表。异常处理: 无外部输入。参数: 无。返回: 无。 */
          onClick: () => setPage(id as keyof typeof WORKSPACE_PAGES),
        }, info.title)),
      ),
      page === 'cards' ? h('form', {
        style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 },
        /** 业务逻辑: 加载用户选定标的。关键判断: 非法输入不替换当前页面。异常处理: 就地提示。参数: 表单事件。返回: 无。 */
        onSubmit: (event: { preventDefault(): void }) => {
          event.preventDefault()
          const next = reviewCardPage(draftCode)
          if (!next) { setCodeError('请输入六位代码，可带 sh、sz、bj 前缀或后缀'); return }
          setCodeError(''); setCardPage(next)
        },
      }, h('label', null, '标的代码 ', h('input', {
        value: draftCode, maxLength: 12, placeholder: '600000 或 sh600000',
        style: { background: 'transparent', color: 'inherit', border: '1px solid #555', borderRadius: 4, padding: 6 },
        /** 业务逻辑: 编辑输入草稿。关键判断: 不自动读取标的。异常处理: 提交时校验。参数: 输入事件。返回: 无。 */
        onChange: (event: { target: { value: string } }) => setDraftCode(event.target.value),
      })), h('button', { type: 'submit', style: { padding: '6px 12px', cursor: 'pointer' } }, '查看卡片'),
      h('span', { role: 'status', style: { color: '#e8c26a' } }, codeError)) : null,
    ),
    page === 'cards' && !cardPage
      ? h('p', { style: { padding: 20, color: '#999' } }, '输入标的代码，查看与编辑复盘卡片。')
      : h('iframe', { key: page, title: selected.title, src: page === 'cards' ? cardPage! : selected.path, style: { flex: 1, width: '100%', minHeight: 0, border: 0 }, referrerPolicy: 'same-origin' }),
  )
}

/**
 * 宿主设置弹框的交易工作流页。
 * 业务逻辑: 同源嵌入基本设置和关键词配置与历史视图。
 * 关键判断: 基础配置展示当前生效快照，历史按关键词映射读取；全局修改沿宿主配置入口。
 * 异常处理: 鉴权和能力缺失由页面显式提示。
 * 参数: 无。返回: 设置页React元素。
 */
export function TraderKitSettings(): ReactElement {
  return h('iframe', { title: '交易工作流设置', src: '/dsh-trader-kit/review/processors#settings',
    style: { width: '100%', height: '65vh', minHeight: 360, border: 0 }, referrerPolicy: 'same-origin' })
}
