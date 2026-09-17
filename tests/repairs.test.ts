import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RepairStore, validNewRepair, validRepair } from '../electron/repairs';
import { repairAssessment, repairFlows, repairReport, type NewRepair } from '../src/shared/repairs';
import { fixtureScan } from './fixtures';
const input: NewRepair = {
  symptom: 'charging',
  pattern: 'no-charge',
  target: 'this-device',
  device: 'Test laptop',
  description: 'Stops charging',
  hazard: false,
};
const folders: string[] = [];
async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-repair-'));
  folders.push(directory);
  return { directory, store: new RepairStore(directory) };
}
afterEach(async () => {
  await Promise.all(folders.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
describe('repair cases', () => {
  it('preserves scan evidence separately from scan history', async () => {
    const { store, directory } = await setup();
    const scan = fixtureScan([]);
    await writeFile(path.join(directory, 'scans.json'), 'prior history');
    const [c] = await store.create(input, scan);
    expect(c.scans[0].id).toBe(scan.id);
    expect(c.ruleVersion).toBe('0.4.0');
    expect(await store.load()).toEqual([c]);
    await store.remove(c.id);
    expect(await readFile(path.join(directory, 'scans.json'), 'utf8')).toBe('prior history');
  });
  it('never attaches host scans to another device', async () => {
    const { store } = await setup();
    const [c] = await store.create({ ...input, target: 'other-device' }, fixtureScan([]));
    expect(c.scans).toEqual([]);
    await expect(store.update(c.id, { kind: 'attach-scan' }, fixtureScan([]))).rejects.toThrow(
      'Host scans',
    );
  });
  it('serializes concurrent notes and enforces reopen before editing', async () => {
    const { store } = await setup();
    const [c] = await store.create(input);
    await Promise.all(
      ['one', 'two', 'three'].map((note) => store.update(c.id, { kind: 'action', note })),
    );
    expect((await store.load())[0].entries).toHaveLength(3);
    await store.update(c.id, {
      kind: 'status',
      status: 'resolved',
      note: 'Same workload and power verified',
    });
    await expect(store.update(c.id, { kind: 'action', note: 'late' })).rejects.toThrow('Reopen');
    await store.update(c.id, { kind: 'status', status: 'open', note: 'Issue returned' });
    await store.update(c.id, { kind: 'action', note: 'Rechecking adapter' });
    expect((await store.load())[0].entries).toHaveLength(6);
  });
  it('uses the last result for a specific test and does not infer a failed part', async () => {
    const { store } = await setup();
    const [c] = await store.create(input);
    await store.update(c.id, {
      kind: 'test',
      testId: 'adapter',
      outcome: 'observed',
      note: 'Known good 65W adapter',
    });
    let a = repairAssessment((await store.load())[0]);
    expect(a.results.find((r) => r.test.id === 'adapter')!.interpretation).toContain(
      'one substitution at a time',
    );
    expect(a.next?.id).toBe('charge-limit');
    await store.update(c.id, {
      kind: 'test',
      testId: 'adapter',
      outcome: 'inconclusive',
      note: 'Intermittent',
    });
    a = repairAssessment((await store.load())[0]);
    expect(a.results.find((r) => r.test.id === 'adapter')!.interpretation).toContain(
      'inconclusive',
    );
    await expect(
      store.update(c.id, { kind: 'test', testId: 'colors', outcome: 'observed', note: '' }),
    ).rejects.toThrow('valid test');
  });
  it('blocks testing after reported physical hazards while preserving service notes', async () => {
    const { store } = await setup();
    const [c] = await store.create({ ...input, hazard: true });
    expect(repairAssessment(c).stop).toContain('Stop testing');
    await expect(
      store.update(c.id, { kind: 'test', testId: 'adapter', outcome: 'observed', note: '' }),
    ).rejects.toThrow('hold');
    await store.update(c.id, { kind: 'action', note: 'Powered off and arranged service' });
    expect((await store.load())[0].entries).toHaveLength(1);
  });
  it('does not clear urgent storage evidence because later readings are missing', async () => {
    const { store } = await setup();
    const scan = fixtureScan([]);
    scan.components = [
      {
        id: 'drive',
        identity: 'stable',
        kind: 'storage',
        name: 'Drive',
        subtitle: '',
        checks: [],
        metrics: [],
        serviceability: 'unknown',
      },
    ];
    scan.findings = [
      {
        id: 'f',
        componentId: 'drive',
        title: 'Failed SMART',
        severity: 'urgent',
        category: 'fault',
        explanation: 'Failure reported',
        action: 'Back up',
        evidence: ['SMART failed'],
        limitation: '',
        rule: 'test',
      },
    ];
    const [c] = await store.create(input, scan);
    const empty = fixtureScan([]);
    empty.id = '3e5a0000-0000-4000-8000-000000000002';
    await store.update(c.id, { kind: 'attach-scan' }, empty);
    expect(repairAssessment((await store.load())[0]).stop).toContain('urgent storage');
  });
  it('rejects duplicate attachments and preserves corrupt files', async () => {
    const { store, directory } = await setup();
    const scan = fixtureScan([]);
    const [c] = await store.create(input, scan);
    await expect(store.update(c.id, { kind: 'attach-scan' }, scan)).rejects.toThrow(
      'already attached',
    );
    await writeFile(path.join(directory, 'repairs.json'), 'broken bytes');
    await expect(store.create(input)).rejects.toThrow('preserved');
    expect(await readFile(path.join(directory, 'repairs.json'), 'utf8')).toBe('broken bytes');
  });
  it('validates enum, nested and bounded data including wrong branch fields', async () => {
    expect(validNewRepair({ ...input, symptom: 'toString' })).toBe(false);
    expect(validNewRepair({ ...input, description: ' '.repeat(20) })).toBe(false);
    expect(validNewRepair({ ...input, device: 'x'.repeat(121) })).toBe(false);
    const { store } = await setup();
    const [c] = await store.create(input);
    expect(validRepair({ ...c, scans: [null] })).toBe(false);
    expect(
      validRepair({
        ...c,
        entries: [{ id: c.id, at: c.createdAt, kind: 'action', note: 'note', testId: 'bad-id' }],
      }),
    ).toBe(false);
    await expect(
      store.update(c.id, { kind: 'status', status: 'resolved', note: '' }),
    ).rejects.toThrow('valid');
  });
  it('exports escaped user notes and labels without active content', async () => {
    const { store } = await setup();
    const [c] = await store.create({
      ...input,
      device: '<script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)>',
    });
    await store.update(c.id, {
      kind: 'action',
      note: '<iframe src="https://example.com"></iframe>',
    });
    const report = repairReport((await store.load())[0]);
    expect(report).toContain('&lt;script&gt;');
    expect(report).not.toContain('<script>');
    expect(report).not.toContain('<iframe');
    expect(report).toContain("default-src 'none'");
    expect(report).toContain('user reported');
    expect(report).not.toContain(c.id);
  });
  it('provides complete guidance and bounded results for every symptom', async () => {
    const { store } = await setup();
    for (const [symptom, flow] of Object.entries(repairFlows)) {
      const [c] = await store.create({ ...input, symptom, pattern: flow.patterns[0].id });
      expect(repairAssessment(c).lead).toBeTruthy();
      for (const test of flow.tests) {
        expect(test.question).toBeTruthy();
        expect(test.observed).toBeTruthy();
        expect(test.notObserved).toBeTruthy();
      }
      expect(new Set(flow.tests.map((t) => t.id)).size).toBe(flow.tests.length);
    }
  });
});
