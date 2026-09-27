/**
 * 日期格式单点实现（iteration-1-contracts §1 / design D-15）。
 *
 * 全仓日期格式的唯一实现：`YYYY-MM-DD`（canonical，契约层唯一表示）⇄
 * `YYYYMMDD`（只允许出现在 ①目录/文件名模板参数与锚点 ②天级缓存目录
 * ③第三方源请求参数）。`src/data/**`、`src/paths/**`（模板参数折算）与
 * T0/T1/T2 的比较逻辑 MUST 经本模块，MUST NOT 自行 slice/replace/拼接日期串。
 *
 * 台账指向：本模块为**自建**（无脚本来源），docs/carryover.md 台账无对应
 * 搬运行——此注释即该事实的登记（design D-15 / tasks 4.5）。
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const COMPACT_DATE_RE = /^\d{8}$/

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false
  const dayInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const max = month === 2 && leap ? 29 : dayInMonth[month - 1]
  return day <= max
}

/** 严格校验 canonical `YYYY-MM-DD`（含真实日历：闰年、每月天数；非法返回 false）。 */
export function isValidIsoDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false
  return isRealCalendarDate(Number(v.slice(0, 4)), Number(v.slice(5, 7)), Number(v.slice(8, 10)))
}

/** canonical → 紧凑 `YYYYMMDD`；非法输入显式抛错（MUST NOT 猜测）。 */
export function toCompactDate(iso: string): string {
  if (!isValidIsoDate(iso)) {
    throw new Error(`非法 ISO 日期 '${iso}'——期望 YYYY-MM-DD（日期折算必须经 src/data/date.ts）`)
  }
  return iso.replace(/-/g, '')
}

/** 紧凑 `YYYYMMDD` → canonical；非法输入返回 null（调用方据此显式拒绝）。 */
export function fromCompactDate(compact: string): string | null {
  if (!COMPACT_DATE_RE.test(compact)) return null
  const iso = `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`
  return isValidIsoDate(iso) ? iso : null
}

/**
 * 紧凑 `YYYYMMDD` → 月目录段 `YYYYMM`（复盘卡片业务区 `<YYYYMM>` 目录段的
 * 唯一折算点；仍属日期格式逻辑，故归本单点实现而非 paths 模块）。
 */
export function toMonthSegment(compact: string): string {
  if (!COMPACT_DATE_RE.test(compact) || fromCompactDate(compact) === null) {
    throw new Error(`非法紧凑日期 '${compact}'——期望 YYYYMMDD（目录段折算必须经 src/data/date.ts）`)
  }
  return compact.slice(0, 6)
}

/**
 * 双格式入参归一为 canonical：canonical 直接返回（仍校验），紧凑写法经
 * `fromCompactDate` 归一；两者都非法 → null（调用方显式拒绝，不猜测）。
 */
export function normalizeToIsoDate(v: string): string | null {
  if (isValidIsoDate(v)) return v
  return fromCompactDate(v)
}

/**
 * 限流日：系统时钟**固定**按 Asia/Shanghai（UTC+8）取日。
 * 系统时钟只用于限流判定（时段、预算桶键、T1 路由判据）；
 * 业务日期一律取数据源（design D-3/D-5）。
 */
export function rateLimitDate(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const y = String(shifted.getUTCFullYear())
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const d = String(shifted.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
