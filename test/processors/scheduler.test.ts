import { expect, it } from 'vitest'
import { admissionReason, createAgentBudget } from '../../src/review/processors/scheduler.ts'

it('调度接纳明确区分开关、宿主缺失、容量等待和可执行', async () => {
  const decide = admissionReason
  expect(decide({ enabled: false, jobsAvailable: true, active: 0, maxConcurrency: 2 })).toBe('workflowDisabled')
  expect(decide({ enabled: true, jobsAvailable: false, active: 0, maxConcurrency: 2 })).toBe('capability')
  expect(decide({ enabled: true, jobsAvailable: true, active: 2, maxConcurrency: 2 })).toBe('hostCapacity')
  expect(decide({ enabled: true, jobsAvailable: true, active: 1, maxConcurrency: 2 })).toBeNull()
})

it('Agent预算按每独立session持久计次，重启和并发不能绕过额度', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createWorkflowRecordStore } = await import('../../src/review/processors/records.ts')
  const root = await mkdtemp(join(tmpdir(), 'workflow-budget-'))
  try {
    const records = createWorkflowRecordStore(root)
    const clock = () => new Date('2026-10-11T16:00:00+08:00')
    const budget = createAgentBudget(root, records, 2, clock)
    expect(await budget.usage()).toBe(0)
    await budget.reserve('run1', 'attempt1', 'session1')
    await budget.reserve('run1', 'attempt1', 'session1')
    expect(await budget.usage()).toBe(1)
    const results = await Promise.allSettled([budget.reserve('run1', 'attempt1', 'session2'), budget.reserve('run2', 'attempt2', 'session3')])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    expect(await createAgentBudget(root, records, 2, clock).usage()).toBe(2)
  } finally { await rm(root, { recursive: true, force: true }) }
})
