/**
 * 业务区映射表（两级：区域目录 + 文件名模板）——路径唯一事实源
 * （`data-root-layout`「业务区映射」Requirement / design D-2/D-14）。
 *
 * 以既有 vault 目录体系为蓝本、MUST NOT 新造目录名（`DB/review/` 为唯一新增）。
 * 其它 change（含 change 4 的 review-card-store）MUST 引用本表，MUST NOT
 * 各自定义第二份文件名模板。调用方 MUST NOT 自行拼接业务区路径。
 */

export type AreaKey = 'review' | 'cache' | 'processorRuns' | 'agentSkills' | 'stock' | 'brief' | 'macro' | 'whiteboard' | 'patterns'

/** 模板参数名（白名单见 resolve.ts）。 */
export type AreaParam = 'code' | 'name' | 'date'

export interface AreaDefinition {
  /** 相对 dataRoot 的区域目录；`<YYYYMM>`/`<YYYYMMDD>` 段由 `date` 参数折算（经 src/data/date.ts）。 */
  dir: string
  /** 文件名模板；缺省 = 文件名由消费层生成（缓存区）或无文件概念（登记区）。 */
  template?: string
  /** 模板所需参数白名单（声明式，供 resolveArea 校验）。 */
  params?: AreaParam[]
  /** active = 本迭代可写（写入方为对应 change）；reserved = 仅登记、未开放解析写入（design D-14）。 */
  status: 'active' | 'reserved'
  note: string
}

export const AREA_TABLE: Record<AreaKey, AreaDefinition> = {
  review: {
    dir: 'DB/review/<YYYYMM>',
    template: '<code>_<name>_<date>.md',
    params: ['code', 'name', 'date'],
    status: 'active',
    note: '复盘卡片（唯一新增区；写入方 change 4，首次写盘由其触发）',
  },
  cache: {
    dir: 'agent/DB/temp/dsh-trader-kit/<YYYYMMDD>',
    // 文件名由缓存层按模块与键生成（data-tool-contract 缓存 Requirement），模板不在此定义。
    params: ['date'],
    status: 'active',
    note: '数据工具缓存产物（父区 agent/DB/temp/ 既有；按日分桶，非资产中间产物）',
  },
  processorRuns: {
    dir: 'agent/DB/temp/dsh-trader-kit/processors',
    status: 'active',
    note: '关键词工作流的持久运行记录、阶段日志与预算（既有临时产物白名单内，不修改用户资产）',
  },
  agentSkills: {
    dir: 'agent/skills',
    status: 'active',
    note: '自产业务 skill（既有区；部署方 change 3/5）',
  },
  stock: {
    dir: 'DB/stock',
    // 文件名 = owner 命名的标的名称（<名称>.md），无文件名模板；消费层按 code→name 直配。
    status: 'active',
    note: '标的档案（既有区；owner 维护内容 + 插件只建不改——首卡懒创建骨架，review-loop）',
  },
  brief: {
    dir: 'DB/review/<YYYYMM>',
    template: '<date>-summary.md',
    params: ['date'],
    status: 'active',
    note: '当日盘面整理（review-loop 新增产物；与 review 卡片区共目录、文件名不冲突）',
  },
  macro: {
    dir: '题材调研/00宏观',
    status: 'reserved',
    note: '宏观 AI 辅助分析（预留区仅登记、未开放解析写入；指向既有目录，MUST NOT 新造目录名）',
  },
  whiteboard: {
    dir: '交易系统/平常心/方法论',
    status: 'reserved',
    note: '白板思维导图（预留，跟随业务归属既有先例）',
  },
  patterns: {
    dir: '交易系统/平常心/方法论/模式',
    status: 'reserved',
    note: '模式与模式↔案例映射（预留，对接随 Q4）',
  },
}

/** 已登记业务区 key 清单（未定义业务区报错时列出）。 */
export const AREA_KEYS = Object.keys(AREA_TABLE) as AreaKey[]
