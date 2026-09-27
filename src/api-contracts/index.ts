/**
 * 行情数据契约子集 —— 搬自 dsh-trading packages/api/src/index.ts
 * L15-30（Interval）与 L54-104（Kline/AdjustedType/QuantBar/QuantBarSeries），
 * 源 commit 70ca2d8（v0.4.1）。原文照搬（仅省略 Ticker 等本阶段未搬类型）。
 *
 * 口径约定全文：docs/design/a-share-data-contract.md（同源搬运副本）。
 * 服务接口面（MarketDataService.getKlines/getQuantBars 签名）随阶段 3
 * connector-tdx 搬运，不在此文件。
 */

/** K 线周期词汇。 */
export type Interval =
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '2h'
  | '4h'
  | '6h'
  | '8h'
  | '12h'
  | '1d'
  | '3d'
  | '1w'
  | '1M'

/** 单根 K 线。 */
export interface Kline {
  readonly openTime: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
  readonly closeTime: number
}

/** K 线复权口径（A 股数据面 a-share-data-plane；与 TDX dividend_type 同词汇）。 */
export type AdjustedType = 'none' | 'front' | 'back'

/**
 * 量化扩展 K 线（A 股数据面 2026-09-20）：必填字段与 Kline 完全同语义（时间升序、
 * epoch ms、volume 单位=股），扩展字段全部可缺省——数据源缺字段不填零（0 与
 * 「无数据」语义不同）。独立类型而非 Kline 交叉扩展：getKlines 签名与其余
 * connector 消费方零扰动。
 */
export interface QuantBar {
  readonly openTime: number
  readonly open: number
  readonly high: number
  readonly low: number
  readonly close: number
  readonly volume: number
  readonly closeTime: number
  /** 成交额（元）。TDX Amount 万元口径由连接器换算后透出；缺省 = 数据源未提供。 */
  readonly amount?: number
  /** 换手率（数值百分比，如 0.53 表示 0.53%；数据源无流通股本口径时缺省）。 */
  readonly turnoverRate?: number
  /** 数据源侧原始时间戳（epoch ms；与 openTime 无信息增益时缺省）。 */
  readonly sourceTimestamp?: number
}

/** 量化扩展 K 线序列（MarketDataService.getQuantBars 返回面）。 */
export interface QuantBarSeries {
  readonly symbol: string
  readonly interval: Interval
  /** 复权口径（连接器配置决定，如 tdx 的 dividendType）。 */
  readonly adjusted: AdjustedType
  /** 数据来源 slug（如 'tdx'）。 */
  readonly source: string
  /** 序列最后一根所属交易日（YYYY-MM-DD，数据源口径；不回退系统日期）。 */
  readonly dataDate?: string
  /** 序列最后一根是否未收盘（盘中正在形成的 K 线）。 */
  readonly unclosed?: boolean
  /** K 线序列（时间升序，旧→新）。 */
  readonly bars: readonly QuantBar[]
}
