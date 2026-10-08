/**
 * 解析本地图片嵌入及原文跨度。
 * 业务逻辑: 顺序扫描 Markdown，跳过围栏与行内代码，返回 files 图片引用。
 * 关键判断: 只识别 PNG/JPEG/WebP/GIF；别名不属于文件路径；函数自包含便于页面内联。
 * 异常处理: 无效嵌入忽略，不访问文件系统。
 * 参数: body 为原始正文。
 * 返回: 按原文顺序排列的相对路径及起止偏移。
 */
export function parseImageEmbeds(body: string): Array<{ relativePath: string; start: number; end: number }> {
  var result: Array<{ relativePath: string; start: number; end: number }> = []
  var tick = String.fromCharCode(96)
  var fencePattern = new RegExp('^ {0,3}(' + tick + '{3,}|~{3,})')
  var inlinePattern = new RegExp('^' + tick + '+')
  var fence = ''
  var offset = 0
  for (var line of body.match(/[^\n]*\n|[^\n]+$/g) || []) {
    var marker = fencePattern.exec(line)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''
      offset += line.length
      continue
    }
    if (!fence) {
      var i = 0
      while (i < line.length) {
        if (line[i] === tick) {
          var run = inlinePattern.exec(line.slice(i))![0]
          var close = line.indexOf(run, i + run.length)
          i = close < 0 ? i + run.length : close + run.length
          continue
        }
        if (line.slice(i, i + 3) === '![[' && (i === 0 || line[i - 1] !== '\\')) {
          close = line.indexOf(']]', i + 3)
          if (close >= 0) {
            var relativePath = line.slice(i + 3, close).split('|')[0]
            if (/^files\/[^\r\n]+\.(?:png|jpe?g|webp|gif)$/i.test(relativePath)) result.push({ relativePath, start: offset + i, end: offset + close + 2 })
            i = close + 2
            continue
          }
        }
        i++
      }
    }
    offset += line.length
  }
  return result
}
