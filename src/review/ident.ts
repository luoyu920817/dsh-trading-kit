/**
 * 标的代码标识（owner 2026-10-06 追授「整体添加代码标识添加一个沪深」）：
 * 全链路代码标识 = `sh|sz|bj` 前缀 + 6 位数字（如 `sh000001`、`sz000002`）。
 *
 * 动机：同码跨市场共存（000001=上证指数(沪)/平安银行(深)、000688=科创50(沪)/国城矿业(深)）
 * ——文件与显示层的代码标识带市场前缀后从根上唯一化；名称段匹配（store 选择序）
 * 作为既有文档的兼容与更名复用语义保留。
 *
 * 市场来源优先级：① 显式（URL 前缀 `#!!xxxxxx` 由 TDX 替换，或写卡 payload.market）；
 * ② 按代码段推断（**仅用于标识/展示**——MUST NOT 参与任何取数决策；推断口径与
 * TDX 板块文件（`市场|代码`）及 A 股代码段一致：88xxxx 为 TDX 自制指标按沪存取，
 * 6/9/5 → 沪，0/1/2/3 → 深，4/8 → 北交所）。
 */

export type MarketPrefix = 'sh' | 'sz' | 'bj'

/** 按代码段推断市场前缀（仅用于标识；88xxxx 判定在前——TDX 自制指标挂沪）。 */
export function marketPrefixForCode(code: string): MarketPrefix {
  if (/^88\d{4}$/.test(code)) return 'sh'
  const head = code.charAt(0)
  if (head === '6' || head === '9' || head === '5') return 'sh'
  if (head === '0' || head === '1' || head === '2' || head === '3') return 'sz'
  if (head === '4' || head === '8') return 'bj'
  return 'sz'
}

/**
 * 存储层代码标识（文件名段）：**仅显式市场**（URL 前缀 `#!!xxxxxx` / 写卡 payload.market）
 * 时加 `sh|sz|bj` 前缀——指数/锚点族（000001 上证指数 vs 000001 平安银行等）由此
 * 与同码股票天然区分；缺省保持 6 位（既有文档零迁移、股票间无同码冲突）。
 * 显示层标识（页面 chip）不受此限——一律带市场前缀（见 marketPrefixForCode）。
 */
export function qualifyCode(code: string, market?: string | null): string {
  if (market === 'sh' || market === 'sz' || market === 'bj') return market + code
  return code
}

export interface QualifiedCode {
  /** `sh|sz|bj` 前缀（缺省 = 既有文档的无前缀形态 → null）。 */
  market: MarketPrefix | null
  /** 6 位数字代码。 */
  code: string
}

/** 拆分带前缀代码标识（`sh000001` / `000001` → 结构；非法 → null）。 */
export function splitQualified(value: string): QualifiedCode | null {
  const m = /^(sh|sz|bj)?(\d{6})$/.exec(value)
  if (m === null) return null
  return { market: m[1] === undefined ? null : (m[1] as MarketPrefix), code: m[2] }
}
