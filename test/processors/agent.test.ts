import { describe, expect, it } from 'vitest'
import * as adapter from '../../src/review/processors/agent.ts'

const config = { provider: 'configured-provider', model: 'configured-model', cwd: process.cwd(), maxTokens: 2048, timeoutMs: 10_000 }
const scope = { runId: 'run-1', signal: new AbortController().signal, async log() {}, async onStart() {} }

describe('受控工作流 Agent 的前置拒绝与结果边界', () => {
  it('提供真实宿主适配入口', () => {
    expect(adapter?.createWorkflowAgentAdapter).toBeTypeOf('function')
  })

  it('缺宿主服务明确失败，不能返回假 Agent', () => {
    expect(() => adapter!.createWorkflowAgentAdapter({}, config, scope)).toThrow('KEYWORD_AGENT_UNAVAILABLE')
  })

  it.each([
    { ...config, provider: '' }, { ...config, model: '' }, { ...config, cwd: 'relative' },
    { ...config, maxTokens: 0 }, { ...config, timeoutMs: 0 },
  ])('先拒绝非法配置 %j', invalid => {
    expect(() => adapter!.createWorkflowAgentAdapter({}, invalid, scope)).toThrow('KEYWORD_AGENT_CONFIG_INVALID')
  })

  it('必须存在本次运行身份和持久启动钩子', () => {
    expect(() => adapter!.createWorkflowAgentAdapter({}, config, { ...scope, runId: '' })).toThrow('KEYWORD_AGENT_SCOPE_INVALID')
    expect(() => adapter!.createWorkflowAgentAdapter({}, config, { ...scope, onStart: undefined } as unknown as adapter.WorkflowAgentScope)).toThrow('KEYWORD_AGENT_SCOPE_INVALID')
  })

  it('完成的当前 turn 只接受严格 JSON 结果并保留 data', () => {
    const events = [
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '{"summary":"证据不足","data":{"missing":["行情"]}}' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ]
    expect(adapter!.readWorkflowAgentResult(events)).toEqual({ summary: '证据不足', data: { missing: ['行情'] } })
  })

  it('真实宿主 reasoning 块不参与 JSON 文本收集', () => {
    expect(adapter.readWorkflowAgentResult([
      { type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'reasoning', text: '内部推理' }, { type: 'text', text: '{"summary":"材料不足"}' }] } } },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    ])).toEqual({ summary: '材料不足' })
  })

  it('scoped Skill日志仅记录来源指纹，不泄漏实际路径或正文', () => {
    const facts = adapter.workflowSkillLogFacts({ name: 'expectation', provider: 'filesystem', source: 'C:/private/skills', path: 'C:/private/skills/SKILL.md', content: 'private prompt' })
    expect(facts).toMatchObject({ skillId: 'expectation', provider: 'filesystem' })
    expect(Object.keys(facts).sort()).toEqual(['contentHash', 'provider', 'skillId', 'sourceHash'])
    expect(String(facts.contentHash)).toMatch(/^[0-9a-f]{64}$/)
    expect(String(facts.sourceHash)).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(facts)).not.toContain('C:/private')
    expect(JSON.stringify(facts)).not.toContain('private prompt')
  })

  it.each([
    [],
    [{ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
    [{ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '{}' }] } } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
    [{ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '{"summary":"a","data":1e999}' }] } } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
    [{ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '{"summary":"a","runId":"other"}' }] } } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
    [{ type: 'assistant/message', data: { turn: 1, interrupted: true, message: { content: [{ type: 'text', text: '{"summary":"a"}' }] } } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } }],
    [{ type: 'assistant/message', data: { turn: 1, message: { content: [{ type: 'text', text: '{"summary":"a"}' }] } } }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } }],
  ].map(events => [events]))('idle/无结果/越权结果/截断均拒绝 %j', events => {
    expect(() => adapter!.readWorkflowAgentResult(events)).toThrow('KEYWORD_AGENT_RESULT_INVALID')
  })
})
