import { build } from 'esbuild';
import './build-native.mjs';
await build({
  entryPoints: [
    'electron/main.ts',
    'electron/preload.ts',
    'electron/health-cli.ts',
    'electron/reliability/worker.ts',
  ],
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['electron'],
  target: 'node22',
  sourcemap: true,
});
