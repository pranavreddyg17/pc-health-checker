import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ReliabilityStore } from '../electron/reliability/store';
import { ReliabilityService } from '../electron/reliability/service';
import { collectIsolated } from '../electron/reliability/isolate';
import { errorCounter } from '../electron/reliability/signals';
import type { HealthSnapshot } from '../src/shared/reliability';
const directories: string[] = [];
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pchealth-health-unit-'));
  directories.push(dir);
  return { dir, store: new ReliabilityStore(dir) };
}
function snapshot(value = 0): HealthSnapshot {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    platform: 'linux',
    ruleVersion: '0.5.0',
    elapsedMs: 1,
    signals: [errorCounter('ecc', 'memory', 'ECC', 'EDAC', value, 'boot')],
  };
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
describe('local history and lifecycle', () => {
  it('starts off, saves evidence and restores it without resuming monitoring', async () => {
    const { store, dir } = await setup();
    const notify = vi.fn();
    const service = new ReliabilityService(store, async () => snapshot(1), undefined, notify);
    expect((await service.snapshot()).running).toBe(false);
    await service.check();
    expect(notify).not.toHaveBeenCalled();
    const restored = await new ReliabilityService(new ReliabilityStore(dir), async () =>
      snapshot(),
    ).snapshot();
    expect(restored.snapshots).toHaveLength(1);
    expect(restored.alerts).toHaveLength(1);
    expect(restored.running).toBe(false);
  });
  it('preserves corrupt history and refuses to overwrite it', async () => {
    const { store } = await setup();
    await writeFile(store.file, 'corrupt');
    const service = new ReliabilityService(store, async () => snapshot());
    expect((await service.snapshot()).warning).toMatch('preserved');
    await expect(service.check()).rejects.toThrow();
    expect(await readFile(store.file, 'utf8')).toBe('corrupt');
  });
  it('rejects stale concurrent writers instead of losing another process evidence', async () => {
    const { store, dir } = await setup();
    const other = new ReliabilityStore(dir);
    await store.load();
    await other.load();
    await store.save({ schemaVersion: 1, snapshots: [snapshot()], alerts: [] });
    await expect(
      other.save({ schemaVersion: 1, snapshots: [snapshot(2)], alerts: [] }),
    ).rejects.toThrow('changed in another process');
    expect((await store.load()).snapshots[0].signals[0].counter?.value).toBe(0);
  });
  it('bounded retention and acknowledgment never remove evidence', async () => {
    const { store } = await setup();
    await store.load();
    await store.save({
      schemaVersion: 1,
      snapshots: Array.from({ length: 130 }, () => snapshot()),
      alerts: [],
    });
    expect((await store.load()).snapshots).toHaveLength(120);
    const service = new ReliabilityService(store, async () => snapshot(2));
    const state = await service.check();
    const ack = await service.acknowledge(state.alerts[0].id);
    expect(ack.alerts[0].acknowledgedAt).toBeTruthy();
    expect(ack.snapshots[0].signals[0].level).toBe('warning');
  });
  it('keeps a disappeared source unassessed on subsequent observations', async () => {
    const { store } = await setup();
    let n = 0;
    const collect = async () => {
      const s = snapshot();
      if (n++) s.signals[0].id = 'different';
      return s;
    };
    const service = new ReliabilityService(store, collect);
    await service.check();
    await service.check();
    const state = await service.check();
    expect(state.snapshots[0].signals.find((s) => s.id === 'ecc')?.level).toBe('unknown');
    expect(state.alerts).toHaveLength(1);
  });
  it('prevents overlap and cancels pending evidence without saving it', async () => {
    const { store } = await setup();
    let finish!: (s: HealthSnapshot) => void;
    const service = new ReliabilityService(
      store,
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await service.snapshot();
    const first = service.check();
    await vi.waitFor(() => expect(service.busy).toBe(true));
    await expect(service.check()).rejects.toThrow('already running');
    service.stop();
    finish(snapshot());
    await first;
    expect((await service.snapshot()).snapshots).toHaveLength(0);
  });
  it('defers monitoring around another scan without consuming failure budget', async () => {
    const { store } = await setup();
    const collect = vi.fn(async () => snapshot());
    const service = new ReliabilityService(store, collect, undefined, undefined, () => true);
    await expect(service.check()).rejects.toThrow('Finish');
    await service.start({ intervalSeconds: 300, notifications: false });
    const state = await service.check(true);
    service.stop();
    expect(state.running).toBe(true);
    expect(state.warning).toMatch('Waiting');
    expect(collect).not.toHaveBeenCalled();
  });
  it('stops after three collection failures', async () => {
    const { store } = await setup();
    const service = new ReliabilityService(store, async () => {
      throw Error('worker failed');
    });
    await service.start({ intervalSeconds: 300, notifications: false });
    await service.check();
    await service.check();
    const state = await service.check();
    service.stop();
    expect(state.running).toBe(false);
    expect(state.warning).toMatch('repeated');
  });
  it('requires an explicit notification opt-in and does not repeat unchanged alerts', async () => {
    const { store } = await setup(),
      notify = vi.fn();
    const service = new ReliabilityService(store, async () => snapshot(2), undefined, notify);
    await service.start({ intervalSeconds: 300, notifications: true });
    await service.check(true);
    await service.check(true);
    service.stop();
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('pauses on suspend and schedules after wake only when enabled', async () => {
    const { store } = await setup();
    const service = new ReliabilityService(store, async () => snapshot());
    await service.start({ intervalSeconds: 300, notifications: false });
    service.pauseForSuspend();
    expect((await service.snapshot()).nextAt).toBeUndefined();
    service.resume();
    expect((await service.snapshot()).nextAt).toBeTruthy();
    service.stop();
    service.resume();
    expect((await service.snapshot()).running).toBe(false);
  });
  it('rejects invalid intervals', async () => {
    const { store } = await setup();
    await expect(
      new ReliabilityService(store, async () => snapshot()).start({
        intervalSeconds: 1,
        notifications: true,
      }),
    ).rejects.toThrow('supported');
  });
});
describe('isolated worker watchdog', () => {
  it('terminates a stuck worker within a deadline', async () => {
    const { dir } = await setup();
    const worker = path.join(dir, 'stuck.cjs');
    const pidFile = path.join(dir, 'worker.pid');
    await writeFile(
      worker,
      `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`,
    );
    const started = Date.now();
    await expect(collectIsolated(worker, new AbortController().signal, 300)).rejects.toThrow(
      'deadline',
    );
    expect(Date.now() - started).toBeLessThan(2000);
    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it('rejects malformed worker output', async () => {
    const { dir } = await setup();
    const worker = path.join(dir, 'invalid.cjs');
    await writeFile(worker, 'process.send({healthy:true});setInterval(()=>{},1000);');
    await expect(collectIsolated(worker, new AbortController().signal)).rejects.toThrow(
      'invalid data',
    );
  });
  it('rejects pre-cancelled work before launching', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(collectIsolated('/no-worker', abort.signal)).rejects.toThrow('stopped');
  });
});
