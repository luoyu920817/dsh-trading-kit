/**
 * 时间格式化单点（`iteration-1-contracts §3`，design D-19）。
 *
 * - `formatZonedIso`：卡片 `writtenAt` 与（change 5 的）附注 `generatedAt`
 *   共用同一导出；输出 `YYYY-MM-DDTHH:mm:ss+08:00`（偏移固定 +08:00，
 *   不用系统本地时区）。
 * - `formatAnchorTime`：锚点 `-<HHmm>` 段；分节标题的 `HH:mm` 由调用方用
 *   同一次结果折算（`HHmm` 与 `HH:mm` 同源，MUST NOT 各取一次时钟）。
 *
 * 本模块只接受 `Date`；`YYYY-MM-DD ⇄ YYYYMMDD` 换算不在本模块
 * （唯一实现是 `src/data/date.ts`）。
 */

const P_MS_OFFSET = 8 * 60 * 60 * 1000

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** `YYYY-MM-DDTHH:mm:ss+08:00`（偏移固定 +08:00；全仓唯一偏移拼装点）。 */
export function formatZonedIso(date: Date): string {
  const shifted = new Date(date.getTime() + P_MS_OFFSET)
  return (
    `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`
    + `T${pad2(shifted.getUTCHours())}:${pad2(shifted.getUTCMinutes())}:${pad2(shifted.getUTCSeconds())}`
    + '+08:00'
  )
}

/** `HHmm`（锚点时间段；分节标题 HH:mm 与之同源折算）。 */
export function formatAnchorTime(date: Date): string {
  const shifted = new Date(date.getTime() + P_MS_OFFSET)
  return `${pad2(shifted.getUTCHours())}${pad2(shifted.getUTCMinutes())}`
}

/** `HHmm` → 分节标题的 `HH:mm`（与 formatAnchorTime 同一次结果折算）。 */
export function anchorTimeToHeading(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`
}
