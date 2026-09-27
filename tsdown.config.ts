import { defineConfig } from 'tsdown'

// 沿 dsh-trading 单包先例（packages/eventbus 同款）：单步 tsdown（dts: true），
// 官方两段式 tsc -b 不采纳。
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: true,
  clean: true,
  unbundle: true,
  fixedExtension: false,
})
