/**
 * tasks 3.6：降级闸门三情形 + force 路径。
 */
import { describe, expect, it } from 'vitest'
import { checkDowngrade } from '../../src/skill/downgrade.ts'

describe('checkDowngrade（tasks 3.6）', () => {
  it('升级：remote > installed → replace', () => {
    const decision = checkDowngrade({ remoteVersion: '1.3.0', installedVersion: '1.2.0' })
    expect(decision.action).toBe('replace')
  })

  it('持平（源标识变化由调用方结合哈希判定）→ replace；零替换短路在 installer 先行', () => {
    const decision = checkDowngrade({ remoteVersion: '1.2.0', installedVersion: '1.2.0' })
    expect(decision.action).toBe('replace')
  })

  it('降级：remote < installed → block（含两版本号与原因）', () => {
    const decision = checkDowngrade({ remoteVersion: '1.0.12', installedVersion: '1.2.0' })
    expect(decision.action).toBe('block')
    if (decision.action === 'block') {
      expect(decision.remoteVersion).toBe('1.0.12')
      expect(decision.installedVersion).toBe('1.2.0')
      expect(decision.reason).toContain('1.0.12')
      expect(decision.reason).toContain('1.2.0')
      expect(decision.reason).toContain('拒绝')
    }
  })

  it('force: true → replace 且 warning 含两版本号与「强制降级」字样', () => {
    const decision = checkDowngrade({ remoteVersion: '1.0.12', installedVersion: '1.2.0', force: true })
    expect(decision.action).toBe('replace')
    if (decision.action === 'replace') {
      expect(decision.warning).toContain('强制降级')
      expect(decision.warning).toContain('1.0.12')
      expect(decision.warning).toContain('1.2.0')
      expect(decision.warning).toContain('force')
    }
  })

  it('首次安装（无 installedVersion）→ replace', () => {
    expect(checkDowngrade({ remoteVersion: '0.0.1', installedVersion: null }).action).toBe('replace')
  })

  it('版本比较语义：1.10.0 > 1.9.9（非字典序）', () => {
    expect(checkDowngrade({ remoteVersion: '1.10.0', installedVersion: '1.9.9' }).action).toBe('replace')
  })
})
