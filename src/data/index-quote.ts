/**
 * 指数行情源（腾讯行情 qt.gtimg.cn；change 2 data-foundation，owner 追授 2026-10-06
 * 「选择的是科创50 这个情况需要也适配」——复盘页指数/锚点态需要真实行情，而 S9
 * realhead 不覆盖沪市指数：hs_000688 返回同码深市股票（错配）、hs_999999/880xxx
 * 空响应（实测）；腾讯覆盖中证指数与上证指数，为参考页 fetchTencentQuote 备源同源）。
 *
 * spec = index-quote 能力（ADDED）。出站走 src/data/http.ts 唯一传输实现；单标的
 * 轻量 GET，guard 计数（batch=1）。实时语义：不进缓存。
 * 代码语义：999999（TDX 上证指数显示码）→ 别名 000001；88xxxx（通达信自制指标）
 * → 显式不可得且零出站；页面仅在「显式沪市指数态」调用本源。
 */
import { nativeTransport, type DataTransport } from './http.ts'
import type { DataDeps } from './deps.ts'
import { isGuardRejection } from './guard.ts'
import { formatZonedIso } from './normalize.ts'

const TENCENT_QUOTE_URL = 'https://qt.gtimg.cn/q=sh'

export interface IndexQuoteResult {
  available: boolean
  name: string | null
  /** 现价（指数点位）。 */
  price: number | null
  /** 涨跌幅 %。 */
  pct: number | null
  source: 'index-tencent' | null
  errors: string[]
  /** 不可得的显式原因（noExternalSource 等）。 */
  detail: string | null
  fetchedAt: string | null
}

/** GBK 解码（失败回退 utf-8；沿参考页 fetchTencentQuote 策略）。 */
function decodeBuffer(buf: ArrayBuffer): string {
  try {
    return new TextDecoder('gbk').decode(buf)
  } catch {
    return new TextDecoder('utf-8').decode(buf)
  }
}

/** 数值解析：有限数值 → number；其余 → null（MUST NOT 用 0 冒充）。 */
function toNum(v: string | undefined): number | null {
  if (v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * 指数行情探针（失败/未命中 → available=false；MUST NOT 猜测）。
 * 调用方 = 复盘页指数态（显式沪市 000xxx/880xxx/999999），服务端仍全量校验 6 位。
 */
export async function fetchIndexQuote(deps: DataDeps, codeRaw: string): Promise<IndexQuoteResult> {
  const fetchedAt = formatZonedIso(deps.now())
  const unavailable = (errors: string[], detail: string): IndexQuoteResult => ({
    available: false, name: null, price: null, pct: null, source: null, errors, detail, fetchedAt,
  })
  if (!/^\d{6}$/.test(codeRaw)) {
    return unavailable(['invalidCode'], `非法代码 '${codeRaw}'——期望 6 位数字`)
  }
  // 通达信自制指标（880xxx）：任何外部行情源均不覆盖；本地 vipdoc 日线缓存实测停更
  // （2026-10-06：全部 day 文件最后 bar = 2026-06-17，属过时缓存不可采用）→ 显式
  // 不可得、零出站，提示在通达信内查看行情。
  if (codeRaw.startsWith('88')) {
    return unavailable(['noExternalSource'], '通达信自制指标无外部行情源（本地日线缓存实测停更不采用）——行情请在通达信内查看')
  }
  // 999999 = TDX 对上证指数的显示码；外部源的规范代码为 000001（沪）。
  const code = codeRaw === '999999' ? '000001' : codeRaw
  const permit = await deps.guard.acquire({ source: 'S10', batch: 1 })
  if (isGuardRejection(permit)) {
    return unavailable(['rateLimited'], '频控受限')
  }
  try {
    const transport = deps.transport ?? nativeTransport
    const response = await transport(`${TENCENT_QUOTE_URL}${code}&_=${Date.now()}`, { signal: AbortSignal.timeout(5000) })
    const buf = await response.arrayBuffer()
    const text = decodeBuffer(buf)
    const m = new RegExp(`v_sh${code}="([^"]*)"`).exec(text)
    if (m === null || m[1] === '') {
      return unavailable(['notFound'], '腾讯行情无该指数数据')
    }
    const fields = m[1].split('~')
    const name = fields[1] !== undefined && fields[1] !== '' ? fields[1] : null
    const price = toNum(fields[3])
    const pct = toNum(fields[32])
    const available = name !== null || price !== null
    return {
      available,
      name,
      price,
      pct,
      source: available ? 'index-tencent' : null,
      errors: available ? [] : ['notFound'],
      detail: available ? null : '腾讯行情响应字段缺失',
      fetchedAt,
    }
  } catch (cause) {
    return unavailable(
      [`indexQuote: ${cause instanceof Error ? cause.message : String(cause)}`],
      '腾讯行情传输失败',
    )
  } finally {
    permit.release()
  }
}
