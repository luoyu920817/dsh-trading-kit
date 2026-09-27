/**
 * 指标系统搬运出口（阶段 6 全量搬运前的类型种子）。
 * 已搬：types.ts（契约类型）+ math.ts（纯数学核）——原文照搬自
 * dsh-trading packages/indicators/src（源 commit 70ca2d8）。
 * 未搬：registry/presets/validate/plugin/tool/chart-*（阶段 6 随策略面搬运，
 * 见 docs/carryover.md 台账）。
 */
export * from './types.ts'
export type { Series } from './math.ts'
