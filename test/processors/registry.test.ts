/**
 * 关键词→工作流注册表单测（task 3；registry.ts 首次实现）。
 * 零 mock：真实打包 JSON、真实受信实现（expectation.ts）、真实解析器对接；
 * 非法候选一律断言「整表拒绝 + 旧快照不变」——注册表不读盘、不动态加载、不调用模型与网络。
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { expectationWorkflow } from '../../src/review/processors/expectation.ts'
import { parseMentions } from '../../src/review/processors/parser.ts'
import { createWorkflowRegistry } from '../../src/review/processors/registry.ts'
import type { WorkflowImplementation } from '../../src/review/processors/types.ts'

const textImplementation: WorkflowImplementation = {
  id: 'text@1',
  async execute() { return { summary: '文本整理' } },
}
const otherImplementation: WorkflowImplementation = {
  id: 'other@1',
  async execute() { return { summary: '第二实现' } },
}

/** 受信实现表（键 = 实现ID；含真实预期实现，供打包配置对接）。 */
function trustedImplementations(): Map<string, WorkflowImplementation> {
  return new Map([
    [textImplementation.id, textImplementation],
    [otherImplementation.id, otherImplementation],
    [expectationWorkflow.id, expectationWorkflow],
  ])
}

/** 单条定义的合法样板；overrides 只用于构造非法候选。 */
function workflow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'text',
    label: '文本整理',
    mentions: ['文本'],
    enabled: true,
    implementationId: 'text@1',
    options: {},
    ...overrides,
  }
}

function table(workflows: unknown[]): Record<string, unknown> {
  return { schemaVersion: 1, workflows }
}

const PACKAGED_CONFIG = new URL('../../config/card-processors.json', import.meta.url)

describe('打包配置与真实对接', () => {
  it('打包卡片处理器配置通过整体校验，别名与真实解析器精确对接', () => {
    const raw = readFileSync(PACKAGED_CONFIG, 'utf8')
    const registry = createWorkflowRegistry(trustedImplementations(), raw)
    const definition = registry.get('expectation')
    expect(definition).toBeDefined()
    expect(definition?.implementationId).toBe(expectationWorkflow.id)
    expect(definition?.mentions).toEqual(['预期'])
    expect(definition?.enabled).toBe(true)
    expect(definition?.options).toEqual({})
    expect(definition?.definitionRevision).toMatch(/^[0-9a-f]{64}$/)
    expect(registry.list().map(d => d.id)).toEqual(['expectation'])
    expect(registry.aliases().get('预期')).toBe('expectation')
    const parsed = parseMentions('@预期 明日指数企稳；@未注册 观察', registry.aliases())
    expect(parsed.recognized).toHaveLength(1)
    expect(parsed.recognized[0]).toMatchObject({ name: '预期', processorId: 'expectation' })
    expect(parsed.unknown.map(m => m.name)).toEqual(['未注册'])
  })

  it('打包发布清单含该 JSON（安装根定位由装配层处理，注册表零路径依赖）', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { files?: string[] }
    expect(pkg.files).toContain('config/card-processors.json')
  })
})

describe('空表、替换与只读访问面', () => {
  it('空表可用；replace 通过后新表原子生效，可再替换回空表', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([]))
    expect(registry.list()).toEqual([])
    expect(registry.get('text')).toBeUndefined()
    expect(registry.aliases().size).toBe(0)
    registry.replace(table([workflow()]))
    expect(registry.get('text')?.id).toBe('text')
    expect(registry.aliases().get('文本')).toBe('text')
    registry.replace(table([]))
    expect(registry.list()).toEqual([])
    expect(registry.get('text')).toBeUndefined()
  })

  it('候选可为 JSON 文本或已解析 JSON 值', () => {
    const fromText = createWorkflowRegistry(trustedImplementations(), JSON.stringify(table([workflow()])))
    const fromValue = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(fromText.get('text')).toEqual(fromValue.get('text'))
  })

  it('list 返回独立数组、定义与 options 冻结、aliases 返回拷贝', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow({ options: { mode: 'a' } })]))
    const list = registry.list()
    list.pop()
    expect(registry.list()).toHaveLength(1)
    const definition = registry.get('text')!
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.mentions)).toBe(true)
    expect(Object.isFrozen(definition.options)).toBe(true)
    const aliases = registry.aliases() as Map<string, string>
    aliases.set('伪造', 'text')
    expect(registry.aliases().has('伪造')).toBe(false)
  })

  it('关闭的工作流仍进入别名表（登记后由开关裁决；未知词才提示未注册）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow({ enabled: false })]))
    expect(parseMentions('@文本', registry.aliases()).recognized.map(m => m.processorId)).toEqual(['text'])
    expect(registry.get('text')?.enabled).toBe(false)
  })

  it('别名可指向同一定义，且不超过每定义 8 个', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([
      workflow({ mentions: ['文本', '文摘', '摘录', '笔记', '卡片', '整理', '梳理', '归纳'] }),
    ]))
    expect(registry.aliases().get('归纳')).toBe('text')
    expect(registry.aliases().size).toBe(8)
    expect(() => registry.replace(table([workflow({ mentions: ['文本', '文摘', '摘录', '笔记', '卡片', '整理', '梳理', '归纳', '多出'] })])))
      .toThrow('INVALID_MENTIONS')
    expect(registry.aliases().size).toBe(8)
  })
})

describe('整体拒绝并保留旧快照', () => {
  it('未知实现整表拒绝（实现只来自受信 map，不动态 import）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    const before = registry.get('text')
    expect(() => registry.replace(table([workflow({ implementationId: 'unknown@1' })]))).toThrow('UNKNOWN_IMPLEMENTATION')
    expect(registry.get('text')).toBe(before)
    expect(registry.aliases().get('文本')).toBe('text')
  })

  it('受信实现表创建时快照：创建后外部 map 变更不影响校验', () => {
    const implementations = trustedImplementations()
    const registry = createWorkflowRegistry(implementations, table([workflow()]))
    implementations.set('late@1', { id: 'late@1', async execute() { return { summary: '晚到' } } })
    expect(() => registry.replace(table([workflow({ id: 'late', implementationId: 'late@1' })]))).toThrow('UNKNOWN_IMPLEMENTATION')
  })

  it('受信实现表自身不一致（键 ≠ 实现ID）拒绝创建', () => {
    expect(() => createWorkflowRegistry(new Map([['wrong@1', textImplementation]]), table([workflow()])))
      .toThrow('INVALID_IMPLEMENTATIONS')
  })

  it('跨定义重复别名拒绝整表', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(() => registry.replace(table([
      workflow(),
      workflow({ id: 'other', label: '第二', implementationId: 'other@1' }),
    ]))).toThrow('DUPLICATE_ALIAS')
    expect(registry.list().map(d => d.id)).toEqual(['text'])
  })

  it('同定义内重复别名、重复定义ID拒绝', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(() => registry.replace(table([workflow({ mentions: ['文本', '文本'] })]))).toThrow('DUPLICATE_MENTION')
    expect(() => registry.replace(table([workflow(), workflow({ implementationId: 'other@1' })]))).toThrow('DUPLICATE_WORKFLOW_ID')
    expect(registry.list().map(d => d.id)).toEqual(['text'])
  })

  it('未知字段/缺字段/旧 processors+stage 表拒绝（不引入旧双协议）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(() => registry.replace(table([workflow({ stages: { extract: { executor: 'agent' } } })]))).toThrow('UNKNOWN_FIELD')
    expect(() => registry.replace(table([workflow({ moduleId: 'text' })]))).toThrow('UNKNOWN_FIELD')
    const missing = workflow()
    delete missing.options
    expect(() => registry.replace(table([missing]))).toThrow('MISSING_FIELD')
    expect(() => registry.replace({ schemaVersion: 1, processors: [] })).toThrow('UNKNOWN_FIELD')
    expect(() => registry.replace({ processors: [{ id: 'expectation' }] })).toThrow()
    expect(registry.get('text')).toBeDefined()
  })

  it('根形状与 schemaVersion 校验', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(() => registry.replace('{')).toThrow('CONFIG_JSON_PARSE_FAILED')
    expect(() => registry.replace(table([workflow()]))).not.toThrow()
    expect(() => registry.replace(JSON.stringify([1, 2]))).toThrow('CONFIG_NOT_JSON_OBJECT')
    expect(() => registry.replace({ workflows: [] })).toThrow('MISSING_FIELD')
    expect(() => registry.replace({ schemaVersion: 2, workflows: [] })).toThrow('INVALID_SCHEMA_VERSION')
    expect(() => registry.replace({ schemaVersion: 1, workflows: {} })).toThrow('INVALID_WORKFLOWS')
    expect(registry.get('text')).toBeDefined()
  })

  it('上限：33 个定义、超过 256KiB 的候选拒绝', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    const many = Array.from({ length: 33 }, (_, i) => workflow({ id: `w${i}`, label: `第${i}`, mentions: [`词${i}`] }))
    expect(() => registry.replace(table(many))).toThrow('TOO_MANY_WORKFLOWS')
    const huge = JSON.stringify(table([workflow({ options: { filler: 'x'.repeat(256 * 1024) } })]))
    expect(() => registry.replace(huge)).toThrow('CONFIG_TOO_LARGE')
    const manyValue = table(Array.from({ length: 33 }, (_, i) => workflow({ id: `w${i}`, label: `第${i}`, mentions: [`词${i}`] })))
    expect(() => registry.replace(manyValue)).toThrow('TOO_MANY_WORKFLOWS')
    expect(registry.list().map(d => d.id)).toEqual(['text'])
  })

  it('33 个定义上限边界：恰 32 个可用', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table(
      Array.from({ length: 32 }, (_, i) => workflow({ id: `w${i}`, label: `第${i}`, mentions: [`词${i}`] })),
    ))
    expect(registry.list()).toHaveLength(32)
    expect(registry.aliases().get('词31')).toBe('w31')
  })

  it('非法 options 拒绝（数组/字符串/NaN/超深/__proto__）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(() => registry.replace(table([workflow({ options: [] })]))).toThrow('INVALID_OPTIONS')
    expect(() => registry.replace(table([workflow({ options: 'x' })]))).toThrow('INVALID_OPTIONS')
    expect(() => registry.replace(table([workflow({ options: null })]))).toThrow('INVALID_OPTIONS')
    expect(() => registry.replace(table([workflow({ options: { value: Number.NaN } })]))).toThrow('INVALID_OPTIONS')
    expect(() => registry.replace(table([workflow({ options: { value: undefined } })]))).toThrow('INVALID_OPTIONS')
    let deep: Record<string, unknown> = { leaf: 1 }
    for (let i = 0; i < 8; i++) deep = { nested: deep }
    expect(() => registry.replace(table([workflow({ options: deep })]))).toThrow('INVALID_OPTIONS')
    const proto = '{"schemaVersion":1,"workflows":[{"id":"text","label":"文本整理","mentions":["文本"],"enabled":true,"implementationId":"text@1","options":{"__proto__":{"polluted":true}}}]}'
    expect(() => registry.replace(proto)).toThrow('INVALID_OPTIONS')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(registry.get('text')).toBeDefined()
  })

  it('非法关键词名拒绝（超 32 码点、含非名字字符、空名）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    // 星面汉字（U+20000，2 个 UTF-16 单元 / 1 个码点）：32 码点合法，33 码点拒绝。
    expect(() => registry.replace(table([workflow({ mentions: ['𠀀'.repeat(32)] })]))).not.toThrow()
    expect(() => registry.replace(table([workflow({ mentions: ['𠀀'.repeat(33)] })]))).toThrow('INVALID_MENTION_NAME')
    expect(() => registry.replace(table([workflow({ mentions: ['预 期'] })]))).toThrow('INVALID_MENTION_NAME')
    expect(() => registry.replace(table([workflow({ mentions: ['@预期'] })]))).toThrow('INVALID_MENTION_NAME')
    expect(() => registry.replace(table([workflow({ mentions: ['预期!'] })]))).toThrow('INVALID_MENTION_NAME')
    expect(() => registry.replace(table([workflow({ mentions: [''] })]))).toThrow('INVALID_MENTION_NAME')
    expect(() => registry.replace(table([workflow({ mentions: [1] })]))).toThrow('INVALID_MENTION_NAME')
    expect(() => registry.replace(table([workflow({ mentions: [] })]))).toThrow('INVALID_MENTIONS')
    expect(() => registry.replace(table([workflow({ mentions: '文本' })]))).toThrow('INVALID_MENTIONS')
  })

  it('非法 id/label/enabled 拒绝', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow()]))
    expect(() => registry.replace(table([workflow({ id: '文本' })]))).toThrow('INVALID_WORKFLOW_ID')
    expect(() => registry.replace(table([workflow({ id: 'Text' })]))).toThrow('INVALID_WORKFLOW_ID')
    expect(() => registry.replace(table([workflow({ label: '  ' })]))).toThrow('INVALID_WORKFLOW_LABEL')
    expect(() => registry.replace(table([workflow({ label: '' })]))).toThrow('INVALID_WORKFLOW_LABEL')
    expect(() => registry.replace(table([workflow({ enabled: 'yes' })]))).toThrow('INVALID_ENABLED')
    expect(() => registry.replace(table([workflow({ implementationId: '' })]))).toThrow('UNKNOWN_IMPLEMENTATION')
  })

  it('初始定义非法直接抛出（启动期无旧表可保）', () => {
    expect(() => createWorkflowRegistry(trustedImplementations(), table([workflow({ implementationId: 'unknown@1' })])))
      .toThrow('UNKNOWN_IMPLEMENTATION')
    expect(() => createWorkflowRegistry(trustedImplementations(), '{')).toThrow('CONFIG_JSON_PARSE_FAILED')
  })
})

describe('definitionRevision 指纹（sha256）', () => {
  it('别名顺序、options 键序、label、enabled 变化不改变指纹（仅改说明/开关不重跑）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow({ mentions: ['文本', '文摘'], options: { b: 2, a: 1 } })]))
    const base = registry.get('text')!.definitionRevision
    expect(base).toMatch(/^[0-9a-f]{64}$/)
    registry.replace(table([workflow({ mentions: ['文摘', '文本'], options: { a: 1, b: 2 }, label: '另一个名字', enabled: false })]))
    const reordered = registry.get('text')!
    expect(reordered.definitionRevision).toBe(base)
    expect(reordered.label).toBe('另一个名字')
    expect(reordered.enabled).toBe(false)
  })

  it('实现ID、别名集合或参数值变化改变指纹（代码/提示词更新须走实现版本）', () => {
    const registry = createWorkflowRegistry(trustedImplementations(), table([workflow({ options: { mode: 'a' } })]))
    const base = registry.get('text')!.definitionRevision
    registry.replace(table([workflow({ options: { mode: 'b' } })]))
    const byOptions = registry.get('text')!.definitionRevision
    registry.replace(table([workflow({ implementationId: 'other@1' })]))
    const byImplementation = registry.get('text')!.definitionRevision
    registry.replace(table([workflow({ mentions: ['文本', '文摘'] })]))
    const byMentions = registry.get('text')!.definitionRevision
    expect(new Set([base, byOptions, byImplementation, byMentions]).size).toBe(4)
  })

  it('同内容两次构造指纹一致（规范化确定性）', () => {
    const first = createWorkflowRegistry(trustedImplementations(), table([workflow({ options: { z: 1, a: [1, 2] } })]))
    const second = createWorkflowRegistry(trustedImplementations(), table([workflow({ options: { a: [1, 2], z: 1 } })]))
    expect(first.get('text')!.definitionRevision).toBe(second.get('text')!.definitionRevision)
  })
})
