/**
 * 技能源判别联合（tasks 5.2，design D-11）。
 *
 * 两种源共用同一套「校验 → 原子替换 → 零残留断言 → 可发现性核对」实现：
 * - `{ kind: 'https-zip'; url }`：官方 zip 分发通道（默认实例 = tdx-tq-local）；
 * - `{ kind: 'local-dir'; path }`：本地目录源（change 5 部署自产 skill）。
 */

export type SkillSource =
  | { kind: 'https-zip'; url: string }
  | { kind: 'local-dir'; path: string }

/** 默认官方源（公开官方地址，可对外；design Risks「发布产物纪律」）。 */
export const DEFAULT_TQ_SKILL_SOURCE_URL = 'https://www.tdx.com.cn/products/autoup/skills/tdx-tq-local.zip'

/** https 源默认实例的 skill 目录名（仅作默认值，共用流程 MUST NOT 写死它）。 */
export const DEFAULT_TQ_SKILL_NAME = 'tdx-tq-local'

/**
 * 源标识：etag / lastModified 原样字符串组合；两者皆缺时退化为内容哈希
 * （`sha256:<archiveHash>`，供「源不支持条件请求」路径的判等）。
 */
export function composeSourceId(parts: { etag?: string | null; lastModified?: string | null; archiveHash?: string | null }): string | null {
  const head = [parts.etag, parts.lastModified].filter((value): value is string => typeof value === 'string' && value.length > 0)
  if (head.length > 0) return head.join('|')
  if (parts.archiveHash) return `sha256:${parts.archiveHash}`
  return null
}
