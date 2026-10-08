import { parseImageEmbeds } from '../../review/image-refs.ts'

export interface DraftImage { relativePath: string; dataBase64: string; size: number; url: string }

/**
 * 校验草稿图片容量。
 * 业务逻辑: 只允许四种位图，限制单图10MiB与草稿总量20MiB。
 * 关键判断: 等于上限可用；未知类型拒绝。
 * 异常处理: 空文件或非有限大小返回提示。
 * 参数: mime为文件类型，size为字节，total为已占用字节。
 * 返回: 空串表示有效，否则返回中文原因。
 */
export function imageDraftError(mime: string, size: number, total: number): string {
  if (['image/png', 'image/jpeg', 'image/webp', 'image/gif'].indexOf(mime) < 0) return '只支持 PNG、JPEG、WebP、GIF 图片'
  if (!isFinite(size) || size <= 0) return '图片文件为空或大小无效'
  if (size > 10 * 1024 * 1024) return '每张图片最大 10MiB'
  if (total + size > 20 * 1024 * 1024) return '本次图片总量最大 20MiB'
  return ''
}

/**
 * 在正文选区插入图片引用。
 * 业务逻辑: 用Obsidian嵌入替换选区，并把光标移到引用末尾。
 * 关键判断: 空正文也能生成图片卡片。
 * 异常处理: 浏览器选区由调用方提供，slice自然裁剪越界。
 * 参数: body为正文，start/end为选区，relativePath为已经校验的附件路径。
 * 返回: 新正文及插入后的光标位置。
 */
export function insertImageEmbed(body: string, start: number, end: number, relativePath: string): { body: string; cursor: number } {
  var embed = '![[' + relativePath + ']]'
  return { body: body.slice(0, start) + embed + body.slice(end), cursor: start + embed.length }
}

/**
 * 筛选仍被正文引用的草稿图片。
 * 业务逻辑: 按有效引用匹配草稿，保留完整草稿项（含预览 URL）。
 * 关键判断: 跳过代码里的引用；草稿项按添加顺序输出，每项只出现一次。
 * 异常处理: 不在草稿中的历史引用不返回。
 * 参数: body为最终正文，draft为内存图片，parse为可序列化的共享解析函数。
 * 返回: 仍被引用的草稿项（上传与缩略图预览共用同一筛选口径）。
 */
export function imagePreviewItems(body: string, draft: DraftImage[], parse: typeof parseImageEmbeds = parseImageEmbeds): DraftImage[] {
  var refs = parse(body)
  return draft.filter(function (image) {
    return refs.some(function (ref) { return ref.relativePath === image.relativePath })
  })
}

/**
 * 筛选仍被正文引用的待保存图片。
 * 业务逻辑: 复用引用筛选，上传只保留路径与base64。
 * 关键判断: 与缩略图预览同一事实源，二者口径不得分叉。
 * 异常处理: 不在草稿中的历史引用不上传。
 * 参数: body为最终正文，draft为内存图片，parse为可序列化的共享解析函数。
 * 返回: 当前请求的附件列表。
 */
export function selectDraftImages(body: string, draft: DraftImage[], parse: typeof parseImageEmbeds = parseImageEmbeds): { relativePath: string; dataBase64: string }[] {
  return imagePreviewItems(body, draft, parse).map(function (image) { return { relativePath: image.relativePath, dataBase64: image.dataBase64 } })
}
/**
 * 从卡片锚点确定图片交易日。
 * 业务逻辑: 将锚点中的YYYYMMDD转换为日期，旧卡片回退到渲染日。
 * 关键判断: 优先卡片锚点，避免日期切换改变历史图片归属。
 * 异常处理: 不符合锚点结构时保留回退日期。
 * 参数: anchor为卡片锚点，fallback为渲染时交易日。
 * 返回: 图片所属日期。
 */
export function cardImageDate(anchor: string, fallback: string | null): string | null {
  var match = /^card-(\d{4})(\d{2})(\d{2})-/.exec(anchor)
  return match ? match[1] + '-' + match[2] + '-' + match[3] : fallback
}

/**
 * 判断图片读取是否仍属于当前编辑上下文。
 * 业务逻辑: 上下文与草稿代际必须同时匹配。
 * 关键判断: 取消、切换标的/市场/日期后拒绝迟到读取。
 * 异常处理: 编辑器失效时直接拒绝。
 * 参数: context/liveContext为页面代际，generation/liveGeneration为草稿代际，active为有效状态。
 * 返回: 是否可写入正文。
 */
export function imageReadIsCurrent(context: number, liveContext: number, generation: number, liveGeneration: number, active: boolean): boolean {
  return active && context === liveContext && generation === liveGeneration
}
/**
 * 计算当前正文仍引用的附件占用。
 * 业务逻辑: 仅已引用草稿和在途读取占用本次上传额度，未引用缓存留给撤销恢复。
 * 关键判断: 同一图片多次引用只计一次，不删除草稿缓存。
 * 异常处理: 正文无有效引用时仅返回读取预留量。
 * 参数: body为正文，draft为全部缓存，reserved为在途字节，parse为共享解析器。
 * 返回: 当前准备上传的总字节数。
 */
export function imageDraftBytes(body: string, draft: DraftImage[], reserved: number, parse: typeof parseImageEmbeds = parseImageEmbeds): number {
  var refs = parse(body)
  return draft.reduce(function (total, item) {
    return total + (refs.some(function (ref) { return ref.relativePath === item.relativePath }) ? item.size : 0)
  }, reserved)
}
