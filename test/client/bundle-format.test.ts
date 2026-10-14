import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { expect, it } from 'vitest'

it('构建客户端可作为宿主普通脚本解析，注册单文件 loader factory 并共享 React', () => {
  const source = readFileSync(new URL('../../lib/client.js', import.meta.url), 'utf8')
  expect(() => new Script(source, { filename: 'dsh-trader-kit/client.js' })).not.toThrow()
  expect(source).toContain('window.__ModuleLoader__.load(')
  expect(source).toContain('id: "dsh-trader-kit"')
  expect(source).toContain('return module.exports;')
  expect(source).toMatch(/require\(["']react["']\)/)
  expect(source).not.toMatch(/require\(["']\./)
  expect(source).not.toContain('node:')
})
