/**
 * 测试专用 zip 生成器（恶意包 / 截断包 / 官方包形态的受控构造）。
 * 仅测试使用：手工拼装 local header + central directory + EOCD，
 * 支持注入非规整条目名、symlink 位、加密位、CRC/大小谎报与 local 名伪造。
 */

import { deflateSync } from 'fflate'

export interface ZipGenEntry {
  /** 原始条目名（可含 `..`、`\`、盘符等恶意形态）。 */
  name: string
  data: Uint8Array | string
  /** 0=store（默认）；8=deflate。 */
  method?: 0 | 8
  /** external attributes（高 16 位为 Unix mode；0o120000 << 16 → symlink）。 */
  externalAttrs?: number
  /** general purpose flags（0x1 = 加密）。 */
  flags?: number
  /** 伪造 central directory 的 CRC。 */
  crcOverride?: number
  /** 伪造 central directory 的 uncompressedSize（谎报规模）。 */
  declaredUncompressedSize?: number
  /** 伪造 local header 的条目名（与 central directory 不一致）。 */
  localName?: string
}

function crc32Table(): Uint32Array {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
}

const CRC_TABLE = crc32Table()

export function testCrc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(): number {
  return 0
}

export function buildZip(entries: ZipGenEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const rawData = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : Buffer.from(entry.data)
    const method = entry.method ?? 0
    const crc = entry.crcOverride ?? testCrc32(rawData)
    let stored: Buffer = rawData
    let uncompressedSize = rawData.length
    if (entry.declaredUncompressedSize !== undefined) {
      uncompressedSize = entry.declaredUncompressedSize // 谎报声明值（写出中复核应捕获）
    }
    if (method === 8) {
      stored = Buffer.from(deflateSync(rawData, { level: 6 }))
    }
    const nameBytes = Buffer.from(entry.name, 'utf8')
    const localNameBytes = Buffer.from(entry.localName ?? entry.name, 'utf8')

    const local = Buffer.alloc(30 + localNameBytes.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.flags ?? 0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(dosTime(), 10)
    local.writeUInt16LE(0x2100, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(rawData.length, 22)
    local.writeUInt16LE(localNameBytes.length, 26)
    local.writeUInt16LE(0, 28)
    localNameBytes.copy(local, 30)
    locals.push(local, stored)

    const central = Buffer.alloc(46 + nameBytes.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // version made by: unix
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.flags ?? 0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(dosTime(), 12)
    central.writeUInt16LE(0x2100, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(uncompressedSize, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE((entry.externalAttrs ?? 0) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    nameBytes.copy(central, 46)
    centrals.push(central)

    offset += local.length + stored.length
  }

  const centralStart = offset
  const centralBuf = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBuf.length, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralBuf, eocd])
}

/** 官方真实形态：单条目 SKILL.md（deflate）。 */
export function buildOfficialLikeZip(skillMd: string | Uint8Array): Buffer {
  return buildZip([{ name: 'SKILL.md', data: skillMd, method: 8 }])
}

/** 在 data 上截断（保完整性失败信号用）。 */
export function truncateZip(zip: Buffer, keepBytes: number): Buffer {
  return zip.subarray(0, Math.max(0, Math.min(keepBytes, zip.length)))
}

/** 破坏某条目的数据字节（CRC 失配用）：翻转第一个数据字节。 */
export function corruptEntryData(zip: Buffer): Buffer {
  const out = Buffer.from(zip)
  // 第一个 local header 数据起点 = 30 + nameLen
  const nameLen = out.readUInt16LE(26)
  out[30 + nameLen] = out[30 + nameLen] ^ 0xff
  return out
}
