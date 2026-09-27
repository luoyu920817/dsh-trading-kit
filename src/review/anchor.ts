/**
 * 代码与锚点规范化（`iteration-1-contracts §2` 单点实现，change 5 复用）。
 *
 * - `normalizeCode`：去 `sh|sz|bj` 前缀与 `.sh|.sz|.bj` 后缀（大小写不敏感）；
 *   余下须为 6 位数字；保留前导零、不补全、不猜测（非法/不完整 → null）。
 *   归一化 = 去掉已知外壳格式；猜测 = 对不完整/歧义取值做补全——前者必须，
 *   后者一律拒绝（design D-15）。
 * - 锚点正则**唯一版本**（写入/解析/幂等扫描共用同一常量，MUST NOT 出现
 *   第二份锚点正则——结构断言项，见 test/review/structure.test.ts）。
 */

/** 卡片锚点：`card-<YYYYMMDD>-<代码>-<HHmm>(-<seq>)?`。 */
export const CARD_ANCHOR_RE = /^card-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$/
/** 附注锚点：`ainote-<YYYYMMDD>-<代码>-<HHmm>(-<seq>)?`（change 5 写入）。 */
export const AINOTE_ANCHOR_RE = /^ainote-(\d{8})-(\d{6})-(\d{4})(?:-(\d+))?$/

/**
 * 标的编码归一化：trim → 去市场前/后缀 → 余下必须恰为 6 位数字。
 * `SH600000` / `600000.SH` / `sh600000` → `'600000'`；
 * `60000` / `6000000` / `abc` / `''` → `null`（保留前导零：`000001` 合法）。
 */
export function normalizeCode(raw: string): string | null {
  let v = raw.trim()
  v = v.replace(/^(sh|sz|bj)/i, '')
  v = v.replace(/\.(sh|sz|bj)$/i, '')
  return /^\d{6}$/.test(v) ? v : null
}

/**
 * 锚点构造（写入侧唯一入口；解析侧只用上面两个正则）。
 * `seq` 为 null 时不带序号段（同分钟首卡），否则追加 `-<seq>`（-2 起）。
 */
export function buildAnchor(
  kind: 'card' | 'ainote',
  dateCompact: string,
  code: string,
  hhmm: string,
  seq: number | null,
): string {
  const base = `${kind}-${dateCompact}-${code}-${hhmm}`
  return seq === null ? base : `${base}-${seq}`
}
