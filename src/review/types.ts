/**
 * 复盘存储的告警与最小类型（`iteration-1-contracts §3`/§12.7，design D-20）。
 *
 * - 五个 store 导出**一律**返回 `warnings: string[]`——元素由本模块的
 *   `encodeStoreWarning` 唯一编码：`[<kind>] <path> — <detail>`（有候选时追加
 *   `；候选: a, b`）；MUST NOT 出现无 kind 前缀的自由文本告警。
 * - 写前归属不一致是**抛错路径**（`DOC_MISMATCH`，见 store.ts），不产生
 *   `warnings`——故 `StoreWarningKind` 枚举不含「归属不一致」这一不可达 kind。
 * - 字段名一律 `warnings`；历史别名（store + Warnings 复合拼写）在本 change 内
 *   MUST NOT 出现（结构断言项，见 test/review/structure.test.ts）。
 */

export type StoreWarningKind = 'multiHit' | 'ghostAnchor' | 'duplicateAnchor' | 'nameTruncated'

export interface StoreWarning {
  kind: StoreWarningKind
  /** 相关文档绝对路径（multiHit 时为被选中的文档）。 */
  path: string
  detail: string
  /** multiHit 时的其余候选文档路径。 */
  candidates?: string[]
}

/** 告警唯一编码：`[<kind>] <path> — <detail>`；候选追加 `；候选: <a>, <b>`。 */
export function encodeStoreWarning(w: StoreWarning): string {
  const base = `[${w.kind}] ${w.path} — ${w.detail}`
  if (w.candidates === undefined || w.candidates.length === 0) return base
  return `${base}；候选: ${w.candidates.join(', ')}`
}

/**
 * 卡片最小类型（契约 §3；change 5 的 `cards` 元素 `{anchor, writtenAt, body}`
 * 是本类型的子集，两边 MUST NOT 各自定义不同形状）。
 */
export interface Card {
  anchor: string
  writtenAt: string
  body: string
  /** H2 标题行文本（`## ` 之后）。 */
  heading?: string
  clientRequestId?: string
}

/** AI 附注最小类型（契约 §3；change 5 写入、本 change 解析排除于用户卡片）。 */
export interface AInote {
  anchor: string
  body: string
  generatedAt?: string
  tradeDate?: string
  code?: string
  meta?: Record<string, string>
}
