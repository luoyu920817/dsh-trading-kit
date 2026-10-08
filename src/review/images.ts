import { lstat, mkdir, open, readFile, realpath, rename, unlink } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { parseImageEmbeds } from './image-refs.ts'
import { encodeStoreWarning } from './types.ts'

export type ImageUpload = { relativePath: string; dataBase64: string }
export type CardImage = { relativePath: string; path: string; mimeType: string; available: boolean }
const LIMIT = 10 * 1024 * 1024

export class ReviewImageError extends Error {
  /** 业务逻辑: 携带可呈现错误。关键判断: 状态默认400。异常处理: 不改原错误语义。参数: code/message/status。返回: 错误实例。 */
  constructor(public code: string, message: string, public status = 400) { super(message); this.name = 'ReviewImageError' }
}

/** 业务逻辑: 校验单层files图片路径。关键判断: 拒绝穿越、Windows特殊名和非图片扩展。异常处理: 非法输入抛400。参数: path。返回: MIME类型。 */
function pathMime(path: string): string {
  if (!/^files\/[^\\/:*?"<>|\r\n\x00-\x1f]+\.(png|jpe?g|webp|gif)$/i.test(path) || path.includes('..') || /[. ]$/.test(path) || /^files\/(?:con|prn|aux|nul|com\d|lpt\d)\./i.test(path)) throw new ReviewImageError('INVALID_IMAGE_PATH', '图片必须位于当月 files 目录且使用安全文件名')
  const ext = extname(path).toLowerCase()
  return ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
}

/** 业务逻辑: 验证图片头与扩展匹配。关键判断: 仅接受四种图片。异常处理: 伪图片抛400。参数: data/mime。返回: 无。 */
function checkMagic(data: Buffer, mime: string): void {
  const valid = mime === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
    : mime === 'image/gif' ? /^(GIF87a|GIF89a)$/.test(data.subarray(0, 6).toString('ascii'))
    : data.subarray(0,4).toString('ascii') === 'RIFF' && data.subarray(8,12).toString('ascii') === 'WEBP'
  if (!valid) throw new ReviewImageError('INVALID_IMAGE_DATA', '图片内容与扩展名不匹配')
}

/** 业务逻辑: 校验提交附件、引用、编码与大小。关键判断: 单图10MiB合计20MiB，新附件ASCII文件名。异常处理: 无输入返回空，违规抛400/413。参数: images/body。返回: 校验后的附件。 */
export function validateImageUploads(images: unknown, body: string): ImageUpload[] {
  if (images === undefined) return []
  if (!Array.isArray(images)) throw new ReviewImageError('INVALID_IMAGE_UPLOAD', 'images 必须为数组')
  const refs = new Set(parseImageEmbeds(body).map((r) => r.relativePath))
  const seen = new Set<string>()
  let total = 0
  return images.map((raw: unknown) => {
    const item = raw as ImageUpload | null
    if (!item || typeof item.relativePath !== 'string' || typeof item.dataBase64 !== 'string') throw new ReviewImageError('INVALID_IMAGE_UPLOAD', '附件缺少路径或编码')
    const mime = pathMime(item.relativePath)
    if (!/^files\/review-[a-zA-Z0-9_-]+\.(?:png|jpe?g|gif|webp)$/i.test(item.relativePath) || !refs.has(item.relativePath) || seen.has(item.relativePath)) throw new ReviewImageError('INVALID_IMAGE_UPLOAD', '附件必须有正文引用且使用唯一 review 文件名')
    seen.add(item.relativePath)
    const size = item.dataBase64.length / 4 * 3 - (item.dataBase64.endsWith('==') ? 2 : item.dataBase64.endsWith('=') ? 1 : 0)
    total += size
    if (size > LIMIT || total > LIMIT * 2) throw new ReviewImageError('IMAGE_TOO_LARGE', '单图最多10MiB，合计最多20MiB', 413)
    const data = Buffer.from(item.dataBase64, 'base64')
    if (item.dataBase64.length % 4 !== 0 || data.toString('base64') !== item.dataBase64) throw new ReviewImageError('INVALID_IMAGE_DATA', '图片 base64 无效')
    checkMagic(data, mime)
    return { relativePath: item.relativePath, dataBase64: item.dataBase64 }
  })
}

/** 业务逻辑: 将附件绑定到复盘文档所属月。关键判断: root/月/files每级拒绝符号链接，禁止跨月路径。异常处理: 缺失可用于创建，越界抛400。参数: dataRoot/docPath/relativePath。返回: 安全绝对路径。 */
export async function resolveImagePath(dataRoot: string, docPath: string, relativePath: string): Promise<string> {
  pathMime(relativePath)
  const root = resolve(dataRoot)
  const canonicalRoot = await realpath(root)
  const doc = resolve(docPath)
  const rel = relative(root, doc).split(sep)
  if (rel.length !== 4 || rel[0] !== 'DB' || rel[1] !== 'review' || !/^\d{6}$/.test(rel[2]) || extname(doc).toLowerCase() !== '.md') throw new ReviewImageError('INVALID_IMAGE_PATH', '图片文档不在复盘月目录')
  const path = join(dirname(doc), relativePath)
  try { if ((await lstat(doc)).isSymbolicLink()) throw new ReviewImageError('INVALID_IMAGE_PATH', '图片文档不允许符号链接') }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  let cursor = root
  for (const part of [...rel.slice(0, 3), 'files', basename(path)]) {
    cursor = join(cursor, part)
    try {
      const st = await lstat(cursor)
      if (st.isSymbolicLink()) throw new ReviewImageError('INVALID_IMAGE_PATH', '图片路径不允许符号链接')
      const actual = await realpath(cursor)
      if (actual !== canonicalRoot && !actual.startsWith(canonicalRoot + sep)) throw new ReviewImageError('INVALID_IMAGE_PATH', '图片路径越界')
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
  }
  return path
}

/** 业务逻辑: 读取安全图片。关键判断: 大小、头部与扩展复核。异常处理: 缺图抛404，其余错误透传。参数: dataRoot/docPath/relativePath。返回: 字节与MIME。 */
export async function readImageFile(dataRoot: string, docPath: string, relativePath: string): Promise<{data: Buffer; mimeType: string}> {
  const path = await resolveImagePath(dataRoot, docPath, relativePath)
  let data: Buffer
  try {
    const st = await lstat(path)
    if (!st.isFile()) throw new ReviewImageError('INVALID_IMAGE_PATH', '图片目标必须为普通文件')
    if (st.size > LIMIT) throw new ReviewImageError('IMAGE_TOO_LARGE', '单图超过10MiB', 413)
    data = await readFile(path)
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new ReviewImageError('IMAGE_NOT_FOUND', '图片文件不存在', 404); throw e }
  if (data.length > LIMIT) throw new ReviewImageError('IMAGE_TOO_LARGE', '单图超过10MiB', 413)
  const mimeType = pathMime(relativePath)
  checkMagic(data, mimeType)
  return { data, mimeType }
}

/** 业务逻辑: 丰富卡片引用信息。关键判断: 按引用去重，缺失保留不可用状态。异常处理: 不可读图转告警。参数: root/doc/body。返回: images/warnings。 */
export async function readCardImages(dataRoot: string, docPath: string, body: string): Promise<{images: CardImage[]; warnings: string[]}> {
  const images: CardImage[] = [], warnings: string[] = []
  for (const relativePath of new Set(parseImageEmbeds(body).map((r) => r.relativePath))) {
    try { const path = await resolveImagePath(dataRoot, docPath, relativePath); const { mimeType } = await readImageFile(dataRoot, docPath, relativePath); images.push({ relativePath, path, mimeType, available: true }) }
    catch (e) { warnings.push(encodeStoreWarning({ kind: 'imageMissing', path: docPath, detail: `${relativePath}: ${e instanceof Error ? e.message : String(e)}` })); images.push({ relativePath, path: '', mimeType: '', available: false }) }
  }
  return { images, warnings }
}

/** 业务逻辑: 创建本次附件，既有同字节去重。关键判断: wx禁止覆盖，冲突拒绝。异常处理: 失败回收本次新文件。参数: root/doc/uploads。返回: 新文件路径。 */
export async function writeImageUploads(dataRoot: string, docPath: string, uploads: ImageUpload[]): Promise<string[]> {
  const created: string[] = []
  try {
    for (const image of uploads) {
      const path = await resolveImagePath(dataRoot, docPath, image.relativePath)
      await mkdir(dirname(path), { recursive: true })
      await resolveImagePath(dataRoot, docPath, image.relativePath)
      const data = Buffer.from(image.dataBase64, 'base64')
      try {
        const handle = await open(path, 'wx')
        created.push(path)
        try { await handle.writeFile(data) } finally { await handle.close() }
      }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (!(await readFile(path)).equals(data)) throw new ReviewImageError('IMAGE_CONFLICT', '同名图片已存在且内容不同', 409) }
    }
    return created
  } catch (e) { await rollbackImageUploads(created, e); throw e }
}

/** 业务逻辑: 回收本次创建附件并补充失败信息。关键判断: 仅回收创建清单，缺失可忽略。异常处理: 清理失败加入原错误消息，避免吞掉恢复风险。参数: paths/error。返回: 无。 */
export async function rollbackImageUploads(paths: string[], error: unknown): Promise<void> {
  const warnings: string[] = []
  for (const path of paths) {
    try { await unlink(path) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') warnings.push(encodeStoreWarning({ kind: 'imageCleanup', path, detail: e instanceof Error ? e.message : String(e) })) }
  }
  if (warnings.length && error instanceof Error) error.message += `；${warnings.join('；')}`
}

/** 业务逻辑: 删除前同目录暂存图片。关键判断: 缺图无需暂存。异常处理: 中途失败恢复已暂存图片。参数: root/doc/refs。返回: 暂存与原路径对。 */
export async function stageImageDeletes(dataRoot: string, docPath: string, refs: string[]): Promise<Array<{path: string; staged: string}>> {
  const staged: Array<{path: string; staged: string}> = []
  try {
    for (const ref of new Set(refs)) {
      const path = await resolveImagePath(dataRoot, docPath, ref)
      const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString('hex')}.delete`)
      try { await rename(path, temp); staged.push({path, staged: temp}) } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e }
    }
    return staged
  } catch (e) { const warnings = await settleImageDeletes(staged, false); if (warnings.length && e instanceof Error) e.message += `；${warnings.join('；')}`; throw e }
}

/** 业务逻辑: 文档成功后回收，失败后恢复。关键判断: 清理失败显式告警。异常处理: 返回失败列表避免覆盖原错误。参数: staged/commit。返回: warnings。 */
export async function settleImageDeletes(staged: Array<{path: string; staged: string}>, commit: boolean): Promise<string[]> {
  const warnings: string[] = []
  for (const image of staged) {
    try { if (commit) await unlink(image.staged); else await rename(image.staged, image.path) }
    catch (e) { warnings.push(encodeStoreWarning({ kind: 'imageCleanup', path: image.path, detail: e instanceof Error ? e.message : String(e) })) }
  }
  return warnings
}
