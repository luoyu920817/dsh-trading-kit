/**
 * 图表簇本地类型（本地新增，非搬运）：Kline 转引自 api-contracts——与上游
 * client-ui-trading `src/client/types.ts` 的 re-export 语义一致（该文件的其余
 * wire 类型随阶段 2 桥搬运再定）；MarketId 词汇与上游逐字一致。
 */
export type { Kline } from '../../api-contracts/index.ts'

/** Markets served by the bridge (subset = installed connector set)。 */
export type MarketId = 'crypto' | 'us' | 'cn' | 'hk' | 'futures' | 'global'
