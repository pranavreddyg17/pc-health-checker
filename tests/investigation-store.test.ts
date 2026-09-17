import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  InvestigationService,
  InvestigationStore,
  isInvestigation,
  validCaseInput,
  validObservationInput,
} from '../electron/investigations';
import { investigation, observation } from './observation-fixtures';

const folders: string[] = [];
async function setup() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'pchealth-cases-test-'));
  folders.push(folder);
  return { folder, store: new InvestigationStore(folder) };
}
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
describe('investigation persistence', () => {
  it('round-trips new case records without touching existing scan history', async () => {
    const { folder, store } = await setup();
    await writeFile(path.join(folder, 'scans.json'), 'legacy scan bytes');
    await store.save([investigation()]);
    expect(await store.load()).toEqual([investigation()]);
    expect(await readFile(path.join(folder, 'scans.json'), 'utf8')).toBe('legacy scan bytes');
  });
  it('preserves damaged investigation data', async () => {
    const { store } = await setup();
    await writeFile(store.file, 'broken');
    await expect(store.save([investigation()])).rejects.toThrow('preserved');
    expect(await readFile(store.file, 'utf8')).toBe('broken');
  });
  it('rejects malformed nested or excessive data', () => {
    const c = investigation();
    (c.observations[0].samples as any) = [null];
    expect(isInvestigation(c)).toBe(false);
    expect(isInvestigation(investigation(Array(7).fill(observation())))).toBe(false);
    const o = observation();
    o.samples[0].cpuPercent = Infinity;
    expect(isInvestigation(investigation([o]))).toBe(false);
  });
  it('recovers active checkpoints as interrupted without restarting collection', async () => {
    const { store } = await setup();
    await store.save([investigation([observation({ state: 'recording' })])]);
    const service = new InvestigationService(store, () => {});
    const result = await service.snapshot();
    expect(result.active).toBeUndefined();
    expect(result.cases[0].observations[0].state).toBe('interrupted');
    expect((await store.load())[0].observations[0].state).toBe('interrupted');
  });
  it('persists outcomes and explicitly removes a chosen case', async () => {
    const { store } = await setup();
    const c = investigation();
    await store.save([c]);
    const service = new InvestigationService(store, () => {});
    await service.outcome(c.id, c.observations[0].id, 'improved');
    expect((await store.load())[0].observations[0].outcome).toBe('improved');
    await service.remove(c.id);
    expect(await store.load()).toEqual([]);
  });
  it('validates narrow operation inputs', () => {
    expect(validCaseInput({ workload: '', onset: 'recent', change: '' })).toBe(false);
    expect(validCaseInput({ workload: 'work', onset: 'not valid', change: '' })).toBe(false);
    expect(
      validObservationInput({
        caseId: investigation().id,
        durationSeconds: 0,
        power: 'unknown',
        includeApps: false,
        action: '',
      }),
    ).toBe(false);
    expect(
      validObservationInput({
        caseId: investigation().id,
        durationSeconds: 60,
        power: 'unknown',
        includeApps: false,
        action: '',
      }),
    ).toBe(true);
  });
});
