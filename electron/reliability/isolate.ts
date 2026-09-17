import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import type { HealthSnapshot } from '../../src/shared/reliability';
import { validSnapshot } from './store';
const observationEpoch = randomUUID();
export function collectIsolated(
  workerPath: string,
  signal: AbortSignal,
  timeoutMs = 30000,
): Promise<HealthSnapshot> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(Error('Collection stopped.'));
      return;
    }
    const child = fork(workerPath, [], {
      execPath: process.execPath,
      execArgv: [],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PCHEALTH_OBSERVATION_EPOCH: observationEpoch,
        PCHEALTH_RESOURCE_DIR:
          (process as typeof process & { resourcesPath?: string }).resourcesPath ||
          process.env.PCHEALTH_RESOURCE_DIR,
      },
      // A private process group lets the POSIX watchdog also terminate our diagnostic children.
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    let done = false;
    const terminate = (settle: () => void) => {
      const killOwnedGroup = () => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* already exited */
        }
      };
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) {
        if (child.pid) killOwnedGroup();
        settle();
        return;
      }
      child.once('exit', () => {
        clearTimeout(kill);
        killOwnedGroup();
        settle();
      });
      if (child.connected) child.send('cancel', () => {});
      const kill = setTimeout(killOwnedGroup, 500);
    };
    const finish = (error?: Error, snapshot?: HealthSnapshot) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
      // Do not resolve/reject while our worker can still run. In particular,
      // an unref'ed cleanup timer can disappear when the test runner exits.
      terminate(() => {
        if (error) reject(error);
        else resolve(snapshot!);
      });
    };
    const timer = setTimeout(
      () => finish(Error('The health worker exceeded its deadline and was terminated.')),
      timeoutMs,
    );
    const cancel = () => finish(Error('Collection stopped.'));
    signal.addEventListener('abort', cancel, { once: true });
    child.once('message', (value: unknown) => {
      if (validSnapshot(value)) finish(undefined, value);
      else finish(Error('The health worker returned invalid data.'));
    });
    child.once('error', () => finish(Error('The health worker could not start.')));
    child.once('exit', () => finish(Error('The health worker exited before returning evidence.')));
  });
}
