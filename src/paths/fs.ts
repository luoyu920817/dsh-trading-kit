/**
 * 目录自动创建（`data-root-layout`「目录自动创建」Requirement）。
 *
 * 递归创建缺失目录（含全部父级）；既有目录直接使用，MUST NOT 重建/清空/
 * 迁移/改动其中任何既有文件；失败显式报错（含路径与原因）。
 */
import { mkdir } from 'node:fs/promises'

/**
 * 确保目录存在。`node:fs` 的 recursive mkdir 对既有目录是幂等 no-op
 * （不触碰 mtime/内容），满足「既有目录不被改动」。
 */
export async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    throw new Error(`目录创建失败：${dir}（${reason}）`, { cause })
  }
}
