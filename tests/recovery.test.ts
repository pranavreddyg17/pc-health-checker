import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyRecovery, type RecoveryCase } from '../src/shared/recovery';
import type { HealthSnapshot } from '../src/shared/reliability';
import { RecoveryStore } from '../electron/recovery';
const start = Date.now() - 600000;
function sample(
  seconds: number,
  level: 'clear' | 'warning' | 'critical' | 'unknown' = 'clear',
): HealthSnapshot {
  const at = new Date(start + seconds * 1000).toISOString();
  return {
    schemaVersion: 1,
    id: `sample-${seconds}`,
    at,
    platform: 'darwin',
    ruleVersion: '0.7.0',
    elapsedMs: 1,
    signals: [
      {
        id: 'thermal',
        category: 'thermal',
        label: 'Thermal pressure',
        source: 'native',
        scope: 'system',
        observedAt: at,
        availability: 'readable',
        level,
        summary: level,
        action: 'Inspect cooling',
        limitation: 'Not CPU temperature',
        measurements: [],
      },
    ],
  };
}
function record(): RecoveryCase {
  return {
    id: 'case',
    createdAt: sample(0).at,
    baseline: sample(0, 'warning'),
    signalIds: ['thermal'],
    action: { at: sample(10).at, note: 'Example action' },
  };
}
const steady = () => [sample(200), sample(140), sample(80)];
describe('recovery verification', () => {
  it('requires an action and three observations over two minutes', () => {
    expect(verifyRecovery({ ...record(), action: undefined }, steady()).state).toBe(
      'awaiting-action',
    );
    expect(verifyRecovery(record(), [sample(200), sample(190), sample(180)]).state).toBe(
      'observing',
    );
    expect(verifyRecovery(record(), steady()).state).toBe('stable');
  });
  it('does not count duplicate snapshots or pre-action evidence', () => {
    expect(verifyRecovery(record(), [sample(200), sample(200), sample(200)]).passing).toBe(1);
    expect(verifyRecovery(record(), [sample(0)]).passing).toBe(0);
    expect(
      verifyRecovery(record(), [sample(200), { ...sample(200), id: 'duplicate-time' }]).passing,
    ).toBe(1);
  });
  it('blocks missing, stale and unreadable target evidence', () => {
    for (const modify of [
      (s: HealthSnapshot) => {
        s.signals = [];
      },
      (s: HealthSnapshot) => {
        s.signals[0].availability = 'permission';
      },
      (s: HealthSnapshot) => {
        s.signals[0].observedAt = sample(0).at;
      },
      (s: HealthSnapshot) => {
        s.ruleVersion = 'changed';
      },
      (s: HealthSnapshot) => {
        s.signals[0].scope = 'other device';
      },
    ]) {
      const samples = steady();
      modify(samples[0]);
      expect(verifyRecovery(record(), samples).state).toBe('inconclusive');
    }
    expect(verifyRecovery(record(), steady(), start + 2000000).state).toBe('inconclusive');
  });
  it('never mistakes counter reset or disappearing telemetry for recovery', () => {
    const r = record();
    r.baseline.signals[0].counter = { value: 10, epoch: 'boot' };
    const samples = steady();
    for (const s of samples) s.signals[0].counter = { value: 10, epoch: 'boot' };
    expect(verifyRecovery(r, samples).state).toBe('stable');
    samples[0].signals[0].counter!.value = 11;
    expect(verifyRecovery(r, samples).state).toBe('fault-present');
    samples[0].signals[0].counter!.value = 0;
    expect(verifyRecovery(r, samples).state).toBe('inconclusive');
    samples[0].signals[0].counter = { value: 10, epoch: 'new-boot' };
    expect(verifyRecovery(r, samples).state).toBe('inconclusive');
  });
  it('requires consecutive passes and blocks unrelated critical regressions', () => {
    const samples = steady();
    samples[1].signals[0].level = 'warning';
    expect(verifyRecovery(record(), samples).passing).toBe(1);
    const more = steady();
    more[0].signals.push({ ...more[0].signals[0], id: 'disk', level: 'critical' });
    expect(verifyRecovery(record(), more).state).toBe('fault-present');
  });
});
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
describe('recovery persistence', () => {
  async function setup() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'pchealth-recovery-test-'));
    directories.push(dir);
    return { dir, store: new RecoveryStore(dir) };
  }
  it('captures server evidence, preserves one action and survives reload', async () => {
    const { dir, store } = await setup();
    const [created] = await store.create(sample(0, 'warning'));
    await store.action(created.id, 'Changed cooling conditions; repeat original workload.');
    await expect(store.action(created.id, 'Rewrite history')).rejects.toThrow('already');
    const restored = await new RecoveryStore(dir).list();
    expect(restored[0].baseline.signals[0].level).toBe('warning');
    expect(restored[0].action?.note).toContain('cooling');
    expect(await store.remove(created.id)).toEqual([]);
  });
  it('rejects stale or fault-free baselines and invalid action notes', async () => {
    const { store } = await setup();
    await expect(store.create(sample(-10000, 'warning'))).rejects.toThrow('fresh');
    await expect(store.create(sample(0))).rejects.toThrow('No warning');
    await expect(store.action('bad', '')).rejects.toThrow('note');
  });
  it('preserves corrupt evidence instead of overwriting it', async () => {
    const { dir, store } = await setup();
    const file = path.join(dir, 'recovery.json');
    await writeFile(file, 'corrupt');
    await expect(store.create(sample(0, 'warning'))).rejects.toThrow('preserved');
    expect(await readFile(file, 'utf8')).toBe('corrupt');
  });
});
