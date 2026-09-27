/**
 * 数据根迁移提示（`data-root-layout`「数据根迁移显式后置」Requirement / M1-Q6）。
 *
 * 本 change 只登记检测函数与状态字段：检测到历史数据不在当前 dataRoot 时给出
 * **非阻断**提示；MUST NOT 自动迁移/复制/移动/删除任何历史数据（迁移策略后置，
 * 由 owner 裁决后另行实现）。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface DataRootMismatch {
  /** 非空 = 检测到历史数据落在其它候选根；null = 无发现。 */
  notice: string | null
  /** 恒为 false：提示不阻断挂载与写入（迁移显式后置）。 */
  blocking: false
}

/** 产物标记：候选根下存在任一标记目录即视为「有历史数据」。 */
const PRODUCT_MARKERS = ['DB', join('agent', 'DB', 'temp', 'dsh-trader-kit')] as const

/**
 * 检测历史数据根残留：调用方提供**此前用过**的候选根（来自记录值/ profile
 * 历史），函数检查各候选根下是否存在产物标记目录。
 *
 * 设计为纯检测：不扫描文件系统任意位置（只看给定候选），不产生任何写入。
 */
export function detectDataRootMismatch(
  currentRoot: string,
  candidateRoots: readonly string[],
): DataRootMismatch {
  const currentAbs = currentRoot !== '' ? join(currentRoot) : null
  for (const candidate of candidateRoots) {
    if (candidate === '' || candidate === currentRoot) continue
    if (currentAbs !== null && join(candidate) === currentAbs) continue
    const hasProducts = PRODUCT_MARKERS.some((marker) => existsSync(join(candidate, marker)))
    if (hasProducts) {
      return {
        notice: `检测到历史数据根 ${candidate} 下仍存在业务产物（DB/ 或 agent/DB/temp/dsh-trader-kit/），`
          + `当前数据根为 ${currentRoot === '' ? '（未配置）' : currentRoot}。`
          + '迁移策略按 M1-Q6 后置：插件不会自动迁移/删除，历史数据保持原样，可自行处置。',
        blocking: false,
      }
    }
  }
  return { notice: null, blocking: false }
}
