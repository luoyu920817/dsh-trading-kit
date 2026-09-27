/**
 * tasks 3.7：内容哈希与漂移检测的哈希原语。
 */
import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { hashDir, listDirHashes, sha256Bytes, sha256File } from '../../src/skill/hash.ts'
import { tempDir, writeSkillDir } from './helpers/tmp.ts'

describe('hash 原语（tasks 3.7）', () => {
  it('sha256Bytes：已知向量', () => {
    expect(sha256Bytes(new TextEncoder().encode('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('sha256File 与 sha256Bytes 一致', async () => {
    const dir = await tempDir()
    try {
      const filePath = path.join(dir.path, 'a.txt')
      await fsp.writeFile(filePath, 'hello hash')
      expect(await sha256File(filePath)).toBe(sha256Bytes(new TextEncoder().encode('hello hash')))
    } finally {
      await dir.cleanup()
    }
  })

  it('hashDir：改一个字节 → 哈希变化（drift 检测的数据基础）', async () => {
    const dir = await tempDir()
    try {
      await writeSkillDir(dir.path, 'sample', { version: '1.2.0' })
      const before = await hashDir(dir.path)
      const filePath = path.join(dir.path, 'sample', 'SKILL.md')
      const text = await fsp.readFile(filePath, 'utf8')
      await fsp.writeFile(filePath, text + ' ', 'utf8') // 一个字节
      const after = await hashDir(dir.path)
      expect(before).not.toBe(after)
    } finally {
      await dir.cleanup()
    }
  })

  it('listDirHashes：稳定排序 + 相对路径 posix 化；目录不存在 → null', async () => {
    const dir = await tempDir()
    try {
      await writeSkillDir(dir.path, 'sample', { version: '1.2.0' })
      await fsp.mkdir(path.join(dir.path, 'sample', 'sub'), { recursive: true })
      await fsp.writeFile(path.join(dir.path, 'sample', 'sub', 'x.md'), 'x')
      const files = await listDirHashes(path.join(dir.path, 'sample'))
      expect(files).not.toBeNull()
      expect(files!.length).toBe(2)
      expect(files!.map((file) => file.relPath)).toEqual(['SKILL.md', 'sub/x.md'])
      expect(await listDirHashes(path.join(dir.path, 'missing'))).toBeNull()
    } finally {
      await dir.cleanup()
    }
  })

  it('表述纪律：hash 模块不含「验证官方性」表述（哈希只测本地漂移）', async () => {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const source = await readFile(fileURLToPath(new URL('../../src/skill/hash.ts', import.meta.url)), 'utf8')
    expect(source).toContain('相对上一次安装的本地漂移')
    expect(source).not.toContain('验证了官方性')
  })
})
