import { defineConfig } from 'tsdown'

// 沿 dsh-trading 单包先例（packages/eventbus 同款）：单步 tsdown（dts: true），
// 官方两段式 tsc -b 不采纳。
//
// review-loop 起为**双入口**：host（`src/index.ts` → `lib/index.js`）+ client
// （`src/client/index.ts` → `lib/client.js`，宿主经 `dsh.client` 声明装载的浏览器半）。
// 两条配置顺序固定：host 先（`clean: true` 清目录）→ client 后（`clean: false`
// 追加产物）；client 按宿主普通脚本契约注册 CJS closure factory，React
// 由 loader module table 提供。内部相对模块打进单文件，避免浏览器 require 相对路径。
export default defineConfig([
  {
    entry: ['src/index.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    dts: true,
    clean: true,
    unbundle: true,
    fixedExtension: false,
  },
  {
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    target: 'es2020',
    dts: false,
    clean: false,
    unbundle: false,
    fixedExtension: false,
    external: [/^react($|\/)/, 'react-dom', /^@deepseek-ai\/dsh-client-/, /^@deepseek-ai\/dsh-api-/],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-trader-kit", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
      codeSplitting: false,
    },
  },
])
