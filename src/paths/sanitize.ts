/**
 * 文件名名称段净化（`data-root-layout`「文件名模板与参数白名单」的唯一实现）。
 *
 * `<名称>` 来自第三方源（S8 `stock_chi_name` 等），是「由外部数据拼出的路径段」，
 * 与请求相对路径同等对待。change 4/5 MUST 引用本模块，MUST NOT 另建
 * 第二份「替换非法字符/截断/保留名」实现（iteration-1-contracts §6/§11）。
 *
 * 返回形状（跨 change 契约，review-page tasks 1.7 登记）：`{ value, nameTruncated }`——
 * `nameTruncated=true` 由调用方透传到写入响应 `warnings`。
 */

/** Windows 保留设备名（不区分大小写；COM/LPT 含 1–9）。 */
const RESERVED_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

/** 名称段长度上限（超限截断并记 nameTruncated）。 */
export const NAME_SEGMENT_MAX = 40

export interface SanitizedSegment {
  /** 净化后的名称段（可能已截断/加保留名后缀；空名由调用方用代码段兜底）。 */
  value: string
  /** 是否因超长被截断（调用方透传到 warnings）。 */
  nameTruncated: boolean
}

/**
 * NFC 归一 → 非法字符（`\/:*?"<>|` 与控制字符）→ `_` → 去首部空格、去尾部
 * 空格与点号 → Windows 保留名加 `_` 后缀 → 40 字符截断（记 nameTruncated）→
 * 截断后再收敛尾部。全程确定性：同一入参必得同一输出（「净化不改变既有文件名」）。
 *
 * 口径解释（spec 场景为可执行验收口径）：`data-root-layout` 场景断言
 * `'../../etc'` 的名称段渲染为 `'.._.._etc'`——前导点号在分隔符替换后**保留**；
 * 故「去首尾点号」落地为：首部只去空格，尾部去空格**与**点号（Windows 文件名
 * 不得以点号/空格结尾，尾部截断是硬约束）。
 */
export function sanitizeNameSegment(name: string, fallback?: string): SanitizedSegment {
  let value = name.normalize('NFC')
  value = value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
  value = value.replace(/^[ ]+/, '').replace(/[ .]+$/, '')
  if (RESERVED_NAMES.has(value.toUpperCase())) value = `${value}_`
  let nameTruncated = false
  if (value.length > NAME_SEGMENT_MAX) {
    value = value.slice(0, NAME_SEGMENT_MAX)
    nameTruncated = true
    // 截断面可能重新暴露尾部点号/空格（如原名 40 字符处恰为「名.」），再收敛一次。
    value = value.replace(/[ .]+$/, '')
  }
  if (value === '' && fallback !== undefined) return { value: fallback, nameTruncated }
  return { value, nameTruncated }
}
