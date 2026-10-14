import { resolve } from 'node:path'
import { readDocumentSources } from './source.ts'
import type { ControlledContextReader, SourceCardSnapshot } from './types.ts'

/**
 * 绑定原卡片及同一文档的只读材料。
 * 业务逻辑: 原卡片使用冻结正文，历史只读本同文档其他卡片。
 * 关键判断: 不接收任意路径，不提供role/market/tracking，不把新正文冒充原输入。
 * 异常处理: 越权/缺能力/超限/取消明确拒绝，文件错误传播。
 * 参数: dataRoot、已核验source、signal。返回: 授权读取能力。
 */
export function createWorkflowContextReader(dataRoot: string, source: SourceCardSnapshot, signal: AbortSignal): ControlledContextReader {
  const frozen = structuredClone(source)
  return {
    /** 业务逻辑: 返回授权证据；关键判断: 数量1至50且请求只有kind/limit；异常处理: 非法/缺能力/取消拒绝。参数: 受控请求。返回: 独立证据。 */
    async read(request) {
      signal.throwIfAborted()
      if (!request || Object.keys(request).some(key => key !== 'kind' && key !== 'limit') || (request.limit !== undefined && (!Number.isSafeInteger(request.limit) || request.limit < 1 || request.limit > 50))) throw new Error('CONTEXT_REQUEST_INVALID')
      if (request.kind === 'card') return [{ id: frozen.anchor, kind: 'card', content: frozen.body, revision: frozen.sourceRevision }]
      if (request.kind !== 'history') throw new Error('CONTEXT_CAPABILITY_UNAVAILABLE')
      const sources = await readDocumentSources(dataRoot, resolve(dataRoot, frozen.relativePath))
      signal.throwIfAborted()
      return sources.filter(card => card.anchor !== frozen.anchor).slice(0, request.limit ?? 20).map(card => ({ id: card.anchor, kind: 'history' as const, content: card.body, revision: card.sourceRevision }))
    },
  }
}
