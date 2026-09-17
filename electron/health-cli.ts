import path from 'node:path';
import os from 'node:os';
import { mkdir, open, rm } from 'node:fs/promises';
import { collectIsolated } from './reliability/isolate';
import { ReliabilityStore } from './reliability/store';
import { ReliabilityService } from './reliability/service';
import { healthExitCode } from '../src/shared/reliability';
const usage = `PC Health reliability probe
  node dist-electron/health-cli.cjs --once
  node dist-electron/health-cli.cjs --watch --interval 300 --data-dir /path/to/local/state

Read-only probes, local JSON output. No services, disks, drivers or settings are modified.
--once exit codes: 0 checked limits clear; 1 warning; 2 critical; 3 incomplete coverage; 4 collector/storage error.
--watch emits newline-delimited JSON snapshots and alerts until SIGINT/SIGTERM; error exit 4.
No daemon is installed. Use a dedicated local state directory for each monitored host.
Node.js 22.12+ is required; Electron and a graphical session are not required.
`;
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(usage);
    return;
  }
  let interval = 300,
    directory = path.join(os.homedir(), '.pchealth-reliability');
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--once', '--watch', '--interval', '--data-dir'].includes(key) || seen.has(key))
      throw Error('Unknown or duplicate argument. Use --help.');
    seen.add(key);
    if (key === '--interval') {
      interval = Number(args[++i]);
      if (![60, 300, 900].includes(interval))
        throw Error('Interval must be 60, 300 or 900 seconds.');
    }
    if (key === '--data-dir') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw Error('Missing data directory.');
      directory = path.resolve(args[++i]);
    }
  }
  const watch = seen.has('--watch');
  if (watch && seen.has('--once')) throw Error('Choose --once or --watch.');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, 'probe.lock');
  const handle = await open(lock, 'wx', 0o600).catch(() => {
    throw Error(
      'A probe lock already exists. Use a separate directory, or verify the prior process has stopped before removing probe.lock.',
    );
  });
  try {
    await handle.writeFile(String(process.pid));
    const store = new ReliabilityStore(directory),
      before = (await store.load()).snapshots[0]?.id;
    const collect = (signal: AbortSignal) =>
      collectIsolated(path.join(__dirname, 'reliability/worker.cjs'), signal);
    if (!watch) {
      const service = new ReliabilityService(store, collect);
      const cancel = () => service.stop();
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      try {
        const state = await service.check();
        if (state.warning || !state.snapshots[0] || state.snapshots[0].id === before)
          throw Error(state.warning || 'Collection stopped without new evidence.');
        process.stdout.write(JSON.stringify(state.snapshots[0], null, 2) + '\n');
        process.exitCode = healthExitCode(state.snapshots[0]);
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
    } else {
      let last = before,
        warning = '',
        stopping = false;
      let finished: () => void = () => {};
      const completion = new Promise<void>((resolve) => {
        finished = resolve;
      });
      const service = new ReliabilityService(
        store,
        collect,
        (state) => {
          const latest = state.snapshots[0];
          if (latest && latest.id !== last) {
            last = latest.id;
            process.stdout.write(JSON.stringify({ type: 'snapshot', snapshot: latest }) + '\n');
          }
          if (state.warning && state.warning !== warning) {
            warning = state.warning;
            process.stderr.write(warning + '\n');
          }
          if (!state.running && !state.collecting && (stopping || state.warning)) {
            if (!stopping) process.exitCode = 4;
            finished();
          }
        },
        (alerts) => {
          for (const alert of alerts)
            process.stdout.write(JSON.stringify({ type: 'alert', alert }) + '\n');
        },
      );
      const shutdown = () => {
        stopping = true;
        service.stop();
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
      try {
        await service.start({ intervalSeconds: interval, notifications: true });
        await completion;
      } finally {
        service.stop();
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
      }
    }
  } finally {
    await handle.close();
    await rm(lock, { force: true });
  }
}
void main().catch((e) => {
  process.stderr.write((e as Error).message + '\n');
  process.exitCode = 4;
});
