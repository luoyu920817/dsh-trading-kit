import { createElement as h, type ReactElement } from 'react'
import type { KeywordRunsSectionProps } from './contracts.ts'

/**
 * 从本插件详情槽打开实际运行管理页。
 * 业务逻辑: 仅本插件bundle详情显示运行与日志入口。
 * 关键判断: 直接消费subject，item/row/其他包返回null；查看不启动工作流。
 * 异常处理: 页面按宿主cookie认证，缺服务或能力在那里明确显示。
 * 参数: 宿主{subject}。返回: 纯文本React元素或null。
 */
export function KeywordRunsSection({ subject }: KeywordRunsSectionProps): ReactElement | null {
  if (subject.kind !== 'bundle' || subject.pkg.name !== 'dsh-trader-kit') return null
  return h('section', { 'data-trader-kit-keyword-runs': true },
    h('h3', null, '关键词任务与执行日志'),
    h('p', null, '查看保存的关键词运行、结果和日志；取消或显式重新运行。'),
    h('a', { href: '/dsh-trader-kit/review/processors', target: '_blank', rel: 'noopener noreferrer' }, '打开运行管理'),
  )
}
