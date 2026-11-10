import { build } from 'esbuild';
await build({
  entryPoints: { main: 'electron/main/index.ts', preload: 'electron/preload/index.ts' },
  outdir: 'dist-electron', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', format: 'cjs', target: 'node22',
  external: ['electron', 'better-sqlite3'], sourcemap: !process.argv.includes('--release'),
  define: { FOX_RELEASE: String(process.argv.includes('--release')) },
  minifySyntax: process.argv.includes('--release'),
});
