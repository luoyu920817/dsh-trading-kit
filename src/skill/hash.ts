/**
 * 内容哈希与目录哈希（tasks 3.7）。
 *
 * 表述纪律：哈希只用于检测「相对上一次安装的本地漂移」（D-9），MUST NOT
 * 被表述为「验证了官方性」——官方无公开哈希/签名（design F9）。
 */

import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

export function sha256Bytes(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** 流式计算单文件 SHA-256。 */
export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256')
  await hash.update(await fsp.readFile(filePath))
  return hash.digest('hex')
}

export interface DirFileHash {
  /** 相对 dir 的 posix 风格相对路径。 */
  relPath: string
  absPath: string
  sha256: string
  size: number
}

/** 递归列出目录内全部文件的哈希（排序后的稳定顺序；目录不存在 → null）。 */
export async function listDirHashes(dir: string): Promise<DirFileHash[] | null> {
  let entries: Awaited<ReturnType<typeof fsp.readdir>>
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return null
  }
  const out: DirFileHash[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const absPath = path.resolve(dir, entry.name)
    const relPath = path.relative(dir, absPath).split(path.sep).join('/')
    const stat = await fsp.stat(absPath)
    out.push({ relPath, absPath, sha256: await sha256File(absPath), size: stat.size })
  }
  out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0))
  return out
}

/**
 * 目录内容哈希：对「相对路径 \0 文件哈希 \0 字节数 \n」序列取 SHA-256。
 * 空目录与不存在目录都产出空序列（调用方需先判断目录存在性）。
 */
export async function hashDir(dir: string): Promise<string> {
  const files = (await listDirHashes(dir)) ?? []
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(`${file.relPath}\0${file.sha256}\0${file.size}\n`)
  }
  return hash.digest('hex')
}
