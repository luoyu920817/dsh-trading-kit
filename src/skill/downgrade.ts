/**
 * 降级闸门（tasks 3.6，design D-5；spec「更新不得静默降级」）。
 *
 * 三态：升级（覆盖，记新旧版本）/ 持平且源标识变化（覆盖，记 previousSourceId，
 * 由调用方处理）/ 降级（默认拒绝替换并显式报错，仅 force: true 执行）。
 * MUST NOT 存在「源标识变化即静默替换」的路径。
 */

import { compareVersions } from './version.ts'

export type DowngradeDecision =
  | { action: 'replace'; warning?: string }
  | { action: 'block'; reason: string; remoteVersion: string; installedVersion: string }

export interface CheckDowngradeInput {
  remoteVersion: string
  installedVersion: string | null
  force?: boolean
}

/**
 * 版本三态判定（纯函数）：
 * - remote > installed → replace（升级）；
 * - remote === installed → replace（持平：源标识是否变化由调用方结合哈希判定，
 *   内容同源标识同的「零替换」短路在 installer 先于本函数执行）；
 * - remote < installed → force ? replace（含强制降级警告） : block。
 */
export function checkDowngrade(input: CheckDowngradeInput): DowngradeDecision {
  const { remoteVersion, installedVersion, force } = input
  if (installedVersion === null) {
    return { action: 'replace' } // 首次安装无降级可言
  }
  const cmp = compareVersions(remoteVersion, installedVersion)
  if (cmp > 0) {
    return { action: 'replace' }
  }
  if (cmp === 0) {
    return { action: 'replace' }
  }
  if (force) {
    return {
      action: 'replace',
      warning:
        `警告：强制降级——远端版本 ${remoteVersion} 低于已安装版本 ${installedVersion}，因显式 force: true 而执行；` +
        '降级会替换 agent 将要执行的指令集，请确认来源可信。',
    }
  }
  return {
    action: 'block',
    reason: `拒绝替换：远端版本 ${remoteVersion} 低于已安装版本 ${installedVersion}（默认拒绝降级）`,
    remoteVersion,
    installedVersion,
  }
}
