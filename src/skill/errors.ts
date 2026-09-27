/**
 * skill 安装线的显式错误类型（change 3 tq-skill-installer）。
 *
 * 纪律：所有失败必须「显式报错（含失败环节与原因）」，MUST NOT 静默；
 * 错误信息一律中文、含可判定字段（spec 场景的判据直接读这些字段）。
 */

/** 校验失败环节枚举（spec「下载与完整性校验」/「压缩包解压加固」的 failedCheck）。 */
export type SkillFailedCheck =
  | 'http-status'
  | 'content-type'
  | 'unzip'
  | 'missing-entry'
  | 'name-mismatch'
  | 'version-unparsable'
  | 'entry-path'
  | 'symlink-entry'
  | 'encrypted-entry'
  | 'limits'
  | 'crc-mismatch'
  | 'download-too-large'
  | 'redirect-disallowed'
  | 'timeout'

export interface SkillErrorDetails {
  failedCheck?: SkillFailedCheck
  /** 冲突路径 / 条目名 / 实际值等，键名自述。 */
  [key: string]: unknown
}

export class SkillInstallerError extends Error {
  readonly code: string
  readonly details: SkillErrorDetails

  constructor(code: string, message: string, details: SkillErrorDetails = {}) {
    super(message)
    this.name = 'SkillInstallerError'
    this.code = code
    this.details = details
  }
}

/** 根解析无可用来源（spec「安装根解析与来源优先级」：显式拒绝，不猜测）。 */
export class SkillRootResolutionError extends SkillInstallerError {
  readonly resolvedCwd: null = null
  readonly projectRoot: null = null

  constructor(message: string, details: SkillErrorDetails = {}) {
    super('ROOT_SOURCE_UNAVAILABLE', message, details)
    this.name = 'SkillRootResolutionError'
  }
}

/** 降级被闸门拒绝（spec「更新不得静默降级」：显式报错，含两版本号）。 */
export class DowngradeBlockedError extends SkillInstallerError {
  readonly remoteVersion: string
  readonly installedVersion: string
  readonly outcome: 'downgrade-blocked' = 'downgrade-blocked'

  constructor(remoteVersion: string, installedVersion: string) {
    super(
      'DOWNGRADE_BLOCKED',
      `拒绝替换：源版本 ${remoteVersion} 低于已安装版本 ${installedVersion}（默认拒绝降级；确需降级请显式传 force: true）`,
      { remoteVersion, installedVersion },
    )
    this.name = 'DowngradeBlockedError'
    this.remoteVersion = remoteVersion
    this.installedVersion = installedVersion
  }
}
