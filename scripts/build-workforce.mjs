import { build } from 'esbuild';
await build({
  entryPoints: ['src/workforce/main.ts', 'src/workforce/bot-main.ts'],
  outdir: 'dist',
  platform: 'node',
  format: 'esm',
  packages: 'external',
  bundle: true,
  splitting: true,
  sourcemap: true,
});
