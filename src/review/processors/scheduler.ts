import type { WaitingReason } from './types.ts'

export interface AdmissionState { readonly enabled: boolean; readonly jobsAvailable: boolean; readonly active: number; readonly maxConcurrency: number }

/**
 * 解释本轮运行接纳条件。
 * 业务逻辑: 依次检查开关、真实Jobs能力、工作流容量。
 * 关键判断: 纯代码也由Jobs托管；Agent预算只在实际启动时登记。
 * 异常处理: 非法容量/计数拒绝，不悄悄修补配置。
 * 参数: 当前开关/能力/运行数/上限。返回: 等待原因或null。
 */
export function admissionReason(state: AdmissionState): WaitingReason | null {
  if (!Number.isSafeInteger(state.maxConcurrency) || state.maxConcurrency < 1 || !Number.isSafeInteger(state.active) || state.active < 0) throw new Error('ADMISSION_CONFIG_INVALID')
  if (!state.enabled) return 'workflowDisabled'
  if (!state.jobsAvailable) return 'capability'
  if (state.active >= state.maxConcurrency) return 'hostCapacity'
  return null
}

import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveArea } from '../../paths/resolve.ts'
import type { JsonValue, WorkflowRecordStore } from './types.ts'

interface BudgetEntry { runId: string; attemptId: string; executionSessionId: string; startedAt: string }
interface BudgetLedger { schemaVersion: 1; day: string; entries: BudgetEntry[] }

/**
 * 用中国时区确定配额自然日。
 * 业务逻辑: UTC时间加八小时后取日期；关键判断: 不依赖宿主时区。
 * 异常处理: 非法时钟拒绝。参数: 日期。返回: YYYY-MM-DD。
 */
export function budgetDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('BUDGET_CLOCK_INVALID')
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
}

/**
 * 读取小型预算台账，缺失视为零。
 * 业务逻辑: 按精确schema读取当日session事实；关键判断: 损坏不重置额度，拒绝文件链接和超限。
 * 异常处理: 仅ENOENT为空；其余失败关闭预算接纳。
 * 参数: 固定预算路径。返回: 台账或null。
 */
async function readBudget(path: string): Promise<BudgetLedger | null> {
  try {
    if (await realpath(path) !== path) throw new Error('BUDGET_PATH_INVALID')
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 2 * 1024 * 1024) throw new Error('BUDGET_STORAGE_INVALID')
    const ledger = JSON.parse(await readFile(path, 'utf8')) as BudgetLedger
    if (!ledger || ledger.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.day) || !Array.isArray(ledger.entries) || ledger.entries.some(entry => !entry || typeof entry.runId !== 'string' || typeof entry.attemptId !== 'string' || typeof entry.executionSessionId !== 'string' || typeof entry.startedAt !== 'string') || new Set(ledger.entries.map(entry => entry.executionSessionId)).size !== ledger.entries.length) throw new Error('BUDGET_STORAGE_INVALID')
    return ledger
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
}

/**
 * 在受控运行区原子保存小型JSON产物。
 * 业务逻辑: 逐层确认真实路径，写临时文件sync后rename。
 * 关键判断: 根内固定processorRuns目录，不跟随链接逃逸。
 * 异常处理: 越界/存储失败拒绝并清理临时文件。
 * 参数: root、受控单段文件名、JSON值。返回: 持久完成。
 */
export async function writeRuntimeJson(root: string, fileName: string, value: JsonValue): Promise<void> {
  const path = resolveArea(root, 'processorRuns', { fileName }, { forWrite: true }).absPath
  const absolute = resolve(root)
  if (await realpath(absolute) !== absolute) throw new Error('BUDGET_PATH_INVALID')
  let current = absolute
  for (const segment of relative(absolute, dirname(path)).split(sep)) {
    current = resolve(current, segment)
    await mkdir(current, { recursive: false }).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST') throw error })
    if (await realpath(current) !== current) throw new Error('BUDGET_PATH_INVALID')
  }
  const temp = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temp, 'wx')
    try { await file.writeFile(JSON.stringify(value), 'utf8'); await file.sync() } finally { await file.close() }
    await rename(temp, path)
  } finally { await rm(temp, { force: true }) }
}

/**
 * 建立按实际Agent onStart计次的持久预算。
 * 业务逻辑: 在全局预算锁下读改写每个独立session；重复session幂等。
 * 关键判断: GET usage只读，重启/多轮/并发不绕额度，时钟回退不重置事实。
 * 异常处理: 缺存储/超额明确拒绝，保守计入已授权但激活前崩溃的session。
 * 参数: root、真实记录锁、每日额度、时钟。返回: usage/reserve受控服务。
 */
export function createAgentBudget(root: string, records: WorkflowRecordStore, limit: number, now: () => Date = () => new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('BUDGET_CONFIG_INVALID')
  const path = resolveArea(root, 'processorRuns', { fileName: 'agent-budget.json' }, { forWrite: true }).absPath
  return {
    /** 业务逻辑: 只读当日计数；关键判断: 不创建文件或清理旧日；异常处理: 损坏拒绝。参数: 无。返回: 已授权session数。 */
    async usage(): Promise<number> { const ledger = await readBudget(path); const day = budgetDay(now()); if (ledger && ledger.day > day) throw new Error('BUDGET_CLOCK_INVALID'); return ledger?.day === day ? ledger.entries.length : 0 },
    /** 业务逻辑: 在启动前写入额度事实；关键判断: session幂等、额度锁内检查；异常处理: 超额/坏台账拒绝。参数: 固定运行/尝试/session。返回: 已持久授权。 */
    async reserve(runId: string, attemptId: string, executionSessionId: string): Promise<void> {
      if (![runId, attemptId, executionSessionId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 256)) throw new Error('BUDGET_ID_INVALID')
      await records.withRecordLocks(['agent-budget'], async () => {
        const date = now(); const day = budgetDay(date)
        const old = await readBudget(path)
        if (old && old.day > day) throw new Error('BUDGET_CLOCK_INVALID')
        const ledger: BudgetLedger = old?.day === day ? old : { schemaVersion: 1, day, entries: [] }
        if (ledger.entries.some(entry => entry.executionSessionId === executionSessionId)) return
        if (ledger.entries.length >= limit) throw new Error('AGENT_BUDGET_EXCEEDED')
        ledger.entries.push({ runId, attemptId, executionSessionId, startedAt: date.toISOString() })
        await writeRuntimeJson(root, 'agent-budget.json', ledger as unknown as JsonValue)
      })
    },
  }
}
