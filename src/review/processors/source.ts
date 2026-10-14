import { isAbsolute, relative, resolve } from 'node:path'
import { realpath } from 'node:fs/promises'
import { isValidIsoDate, toCompactDate } from '../../data/date.ts'
import { parseDoc, withVerifiedCardSnapshot } from '../store.ts'
import type { MarketPrefix } from '../ident.ts'
import type { SourceCardRef, SourceCardSnapshot } from './types.ts'

/**
 * 读取本次运行固定来源，复用复盘写锁中的核验。
 * 业务逻辑: 回读整卡；关键判断: 不借旧快照证明当前来源。
 * 异常处理: 来源删除/不可读/歧义透传稳定错误。
 * 参数: dataRoot及来源身份。返回: 当前已核验快照。
 */
export function readCardSource(dataRoot: string, source: SourceCardRef): Promise<SourceCardSnapshot> {
  return withVerifiedCardSnapshot(dataRoot, source, async actual => actual)
}

/**
 * 从已成功写入的复盘文档发现卡片来源。
 * 业务逻辑: 只枚举用户卡片，再逐卡在短锁下核验，附注不产生触发。
 * 关键判断: 文档必须在当前根的复盘月桶；不扫描旧日期或跟随别根通知。
 * 异常处理: 不完整归属/歧义拒绝，不返回部分成功卡片。
 * 参数: 数据根和实际绝对文档路径。返回: 全部来源快照。
 */
export async function readDocumentSources(dataRoot: string, documentPath: string): Promise<SourceCardSnapshot[]> {
  const rel = relative(resolve(dataRoot), resolve(documentPath)).replaceAll('\\', '/')
  if (isAbsolute(rel) || !/^DB\/review\/\d{6}\/((?:sh|sz|bj)?\d{6})_[^/]+_\d{8}\.md$/.test(rel)) throw new Error('SOURCE_PATH_INVALID')
  let real: string
  try { real = await realpath(resolve(documentPath)) } catch (error) {
    throw new Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'SOURCE_REMOVED' : 'SOURCE_UNVERIFIED', { cause: error })
  }
  if (real !== resolve(documentPath)) throw new Error('SOURCE_UNVERIFIED')
  let parsed: Awaited<ReturnType<typeof parseDoc>>
  try { parsed = await parseDoc(documentPath) } catch (error) { throw new Error('SOURCE_UNVERIFIED', { cause: error }) }
  const code = parsed.frontmatter.code
  const tradeDate = parsed.frontmatter.tradeDate
  const identity = /^DB\/review\/(\d{6})\/(sh|sz|bj)?(\d{6})_.+_(\d{8})\.md$/.exec(rel)
  if (typeof code !== 'string' || typeof tradeDate !== 'string' || !isValidIsoDate(tradeDate) || code !== identity?.[3] || identity[4] !== toCompactDate(tradeDate) || identity[1] !== toCompactDate(tradeDate).slice(0, 6)) throw new Error('SOURCE_IDENTITY_MISMATCH')
  if (parsed.warnings.some(w => /^\[(duplicateAnchor|ghostAnchor)\]/.test(w))) throw new Error('SOURCE_AMBIGUOUS')
  const fileId = rel.split('/').at(-1)!.split('_')[0]
  const market = /^(sh|sz|bj)/.exec(fileId)?.[1] as MarketPrefix | undefined
  return Promise.all(parsed.cards.map(card => readCardSource(dataRoot, { relativePath: rel, anchor: card.anchor, market: market ?? null, code, tradeDate })))
}
