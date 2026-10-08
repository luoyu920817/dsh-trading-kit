/**
 * 复盘面板组件（review-loop `review-panel`；DSH 客户端半）。
 *
 * 渲染五块（spec「面板渲染与降级」）：① 目标交易日与来源；② 当日标的清单；
 * ③ 运行摘要四态计数与逐条原因；④ 盘面 md 状态；⑤「整理今日复盘」按钮。
 * 每块独立降级（读取失败只影响该块），外部文本一律纯文本渲染（不注入 HTML）。
 *
 * 触发纪律（spec「触发按钮与会话注入」）：按钮只做一件事——把**固定模板 prompt**
 * 经宿主会话服务 `conversation.send(text)` 发进当前会话（等价于用户手打），
 * agent 随后执行既有 `review-daily-summary` skill；插件 MUST NOT 自建 agent 运行、
 * MUST NOT 直接写产物。发送中/运行中禁用按钮防重复触发。
 *
 * 实现说明：不引入 JSX 转换（tsdown 零额外配置）——以 `createElement` 组装；
 * 宿主客户端包以**结构化类型**消费（不 import 宿主 SDK，避免把宿主包变成构建期
 * 依赖；运行时形状由波 0 spike 实机核验）。
 */
import { createElement as h, useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react'
import { ORGANIZE_DAY_PROMPT, dayApiUrl } from './params.ts'

/** 会话服务最小面（宿主 `@deepseek-ai/dsh-client-ui-conversation` 的 `IConversation.send`）。 */
export interface ConversationLike {
  send(text: string): Promise<void>
}

export interface PanelProps {
  /** 宿主注入的会话服务（缺省 = 按钮禁用并提示）。 */
  conversation?: ConversationLike
}

interface DayTarget {
  code: string
  name: string
  cardCount: number
  hasAinote: boolean
  /** 文件名市场前缀（`sh|sz|bj`；旧式无前缀文档缺省——owner 2026-10-08 P0 透传）。 */
  qualifier?: string
}

interface RunReportView {
  created: Array<{ code: string }>
  skipped: Array<{ code: string }>
  failed: Array<{ code: string; reason?: string }>
  deferred: Array<{ code: string; reason?: string }>
  warnings: string[]
}

interface DayState {
  tradeDate: string | null
  dateSource: 'requested' | 'resolved' | 'unavailable'
  targets: DayTarget[]
  runReport: RunReportView | null
  brief: { exists: boolean; path: string; generatedAt: string | null } | null
  error?: string
  message?: string
  warnings: string[]
}

const box: Record<string, string> = {
  padding: '10px 12px',
  margin: '0 0 10px',
  border: '1px solid #333333',
  borderRadius: '8px',
  background: '#111111',
  color: '#e6e6e6',
  fontSize: '13px',
  lineHeight: '1.6',
}

const muted: Record<string, string> = { color: '#8a8a8a', fontSize: '12px' }
const warn: Record<string, string> = { color: '#e8d48a', fontSize: '12px' }
const errStyle: Record<string, string> = { color: '#ff7a7a', fontSize: '12px' }

const DATE_SOURCE_LABEL: Record<string, string> = {
  requested: '显式指定',
  resolved: 'T0 解析',
  unavailable: '交易日不可得',
}

function row(label: string, value: string, style: Record<string, string> = muted): ReactElement {
  return h('div', { style }, h('span', null, label + '：'), h('span', null, value))
}

export function ReviewPanel(props: PanelProps): ReactElement {
  const [state, setState] = useState<DayState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(dayApiUrl(), { headers: { Accept: 'application/json' } })
      const body = (await res.json()) as DayState
      setState(body)
      setLoadError(null)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onOrganize = useCallback(async (): Promise<void> => {
    const conversation = props.conversation
    if (conversation === undefined) {
      setSendError('会话服务不可用（宿主未注入 conversation）——请在 DSH 会话中手动发送触发短语')
      return
    }
    setSending(true)
    setSendError(null)
    try {
      await conversation.send(ORGANIZE_DAY_PROMPT)
      await load()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }, [props.conversation, load])

  const blocks: ReactNode[] = []
  blocks.push(
    h('div', { key: 'header', style: box },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '复盘闭环'),
      row('交易日', state?.tradeDate ?? '—', state?.tradeDate === null ? warn : muted),
      row('来源', DATE_SOURCE_LABEL[state?.dateSource ?? 'unavailable'] ?? '—'),
      state?.error !== undefined
        ? h('div', { style: warn }, state.message ?? state.error)
        : null,
    ),
  )

  if (loadError !== null) {
    blocks.push(h('div', { key: 'load-error', style: box },
      h('div', { style: errStyle }, '当日状态读取失败：' + loadError),
      h('button', { type: 'button', onClick: () => { void load() } }, '重试'),
    ))
  }

  blocks.push(
    h('div', { key: 'targets', style: box },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } },
        '当日标的（' + String(state?.targets.length ?? 0) + '）'),
      ...(state?.targets ?? []).map((t) => h('div', { key: t.code + (t.qualifier ?? ''), style: muted },
        (t.qualifier ?? '') + t.code + ' ' + t.name + '｜卡片 ' + String(t.cardCount) + '｜附注 ' + (t.hasAinote ? '有' : '无'))),
      state !== null && state.targets.length === 0
        ? h('div', { style: muted }, '当日无卡片')
        : null,
    ),
  )

  const report = state?.runReport ?? null
  blocks.push(
    h('div', { key: 'report', style: box },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '运行摘要'),
      report === null
        ? h('div', { style: muted }, '当日尚未运行')
        : h('div', null,
            row('created / skipped', String(report.created.length) + ' / ' + String(report.skipped.length)),
            ...report.failed.map((e, i) => h('div', { key: 'f' + String(i), style: warn },
              'failed ' + e.code + '（' + (e.reason ?? '原因未记录') + '）')),
            ...report.deferred.map((e, i) => h('div', { key: 'd' + String(i), style: warn },
              'deferred ' + e.code + '（' + (e.reason ?? '原因未记录') + '）')),
            ...report.warnings.map((w, i) => h('div', { key: 'w' + String(i), style: warn }, 'warnings：' + w)),
          ),
    ),
  )

  blocks.push(
    h('div', { key: 'brief', style: box },
      h('div', { style: { fontWeight: 600, marginBottom: '6px' } }, '当日盘面 md'),
      state?.brief?.exists === true
        ? h('div', null,
            row('状态', '已生成（' + (state.brief.generatedAt ?? '时间未记录') + '）'),
            row('路径', state.brief.path),
          )
        : h('div', { style: muted }, '尚未生成'),
    ),
  )

  blocks.push(
    h('div', { key: 'action', style: box },
      h('button', {
        type: 'button',
        disabled: sending,
        onClick: () => { void onOrganize() },
      }, sending ? '已发送，整理中…' : '整理今日复盘'),
      h('div', { style: muted }, '点击后：把固定触发短语发送到当前会话（等于你手打一条消息），由 agent 执行 review-daily-summary。'),
      sendError !== null ? h('div', { style: errStyle }, '发送失败：' + sendError) : null,
      ...(state?.warnings ?? []).map((w, i) => h('div', { key: 'sw' + String(i), style: warn }, w)),
    ),
  )

  return h('div', { style: { padding: '12px', maxWidth: '720px' } },
    h('h2', { style: { fontSize: '15px', margin: '0 0 10px' } }, '复盘'),
    ...blocks,
  )
}
