import { describe, expect, it } from 'vitest';
import {
  compareObservations,
  investigationReport,
  observationSignals,
  sustainedMs,
  type Investigation,
  type Observation,
} from '../src/shared/investigations';
import {
  counterRate,
  parseCpuTime,
  parseLinuxVm,
  parseProcesses,
  parsePsi,
  parseVmStat,
  parseWindowsObservation,
  processDeltas,
} from '../electron/observation/parsers';
import { cpuDelta } from '../electron/observation/sampler';

import { observation, investigation } from './observation-fixtures';

describe('observation parsing', () => {
  it('reads cumulative swap counters without mistaking inventory for a rate', () => {
    expect(parseVmStat('Swapouts: 12345.').pagingOut).toBe(12345);
    expect(parseLinuxVm('pswpout 456\n').pagingOut).toBe(456);
    expect(counterRate(undefined, 12345, 2)).toBeUndefined();
    expect(counterRate(12345, 12365, 2)).toBe(10);
    expect(counterRate(100, 1, 2)).toBeUndefined();
    expect(counterRate(1, 2, 0)).toBeUndefined();
    expect(() => parseVmStat('Pages free: 10.')).toThrow();
  });
  it('uses PSI cumulative microseconds rather than averages from outside the session', () => {
    expect(
      parsePsi('some avg10=1.00 avg60=4.00 avg300=5.00 total=12345\nfull avg10=0.00 total=99'),
    ).toBe(12345);
    expect(parsePsi('not pressure')).toBeUndefined();
  });
  it.each([
    ['12:34.50', 754.5],
    ['1:02:03', 3723],
    ['2-01:02:03', 176523],
  ])('parses process CPU time %s', (input, seconds) =>
    expect(parseCpuTime(String(input))).toBe(seconds),
  );
  it('discards process paths and malformed entries', () => {
    const data = parseProcesses(
      ' 23 1:02.00 2048 /Users/private-person/Example App\ninvalid\n24 nope 0 bad',
    );
    expect(data).toEqual([{ pid: 23, name: 'Example App', cpuSeconds: 62, memoryMB: 2 }]);
    expect(JSON.stringify(data)).not.toContain('private-person');
  });
  it('normalizes CPU shares and rejects new or reset process counters', () => {
    const before = [{ pid: 1, name: 'App', cpuSeconds: 10, memoryMB: 1 }];
    expect(processDeltas(before, [{ ...before[0], cpuSeconds: 12 }], 2, 4)[0].cpuPercent).toBe(25);
    expect(processDeltas(before, [{ ...before[0], cpuSeconds: 1 }], 2, 4)).toEqual([]);
    expect(processDeltas(before, [{ ...before[0], name: 'New app' }], 2, 4)).toEqual([]);
    expect(processDeltas([], before, 2, 4)).toEqual([]);
  });
  it('reads Windows formatted data while keeping missing data unavailable', () => {
    const result = parseWindowsObservation({
      Memory: { AvailableMBytes: 1024, PagesOutputPersec: 0 },
      Disk: { DiskBytesPersec: 1048576 },
      Cores: 4,
      Processes: [{ Name: 'Example', CPU: 100, Memory: 1048576 }],
    });
    expect(result).toMatchObject({ availableMemoryMB: 1024, pagingOutPerSec: 0, diskMBps: 1 });
    expect(result.apps?.[0].cpuPercent).toBe(25);
    expect(
      parseWindowsObservation({ Memory: { AvailableMBytes: null } }).availableMemoryMB,
    ).toBeUndefined();
    expect(() => parseWindowsObservation(null)).toThrow();
  });
  it('handles CPU resets and core count changes without fabricated zero readings', () => {
    expect(cpuDelta([{ idle: 50, total: 100 }], [{ idle: 60, total: 200 }])).toEqual({
      cpuPercent: 90,
      busiestCorePercent: 90,
    });
    expect(cpuDelta([{ idle: 50, total: 100 }], [{ idle: 0, total: 10 }])).toEqual({});
    expect(cpuDelta([], [{ idle: 0, total: 0 }])).toEqual({});
  });
});
describe('evidence-based investigation signals', () => {
  it('does not prescribe RAM from low available memory or hardware replacement from inventory', () =>
    expect(observationSignals(observation())).toEqual([]));
  it('ignores a brief CPU spike', () => {
    const o = observation();
    o.samples[15].cpuPercent = 100;
    o.samples[15].busiestCorePercent = 100;
    expect(observationSignals(o)).toEqual([]);
  });
  it('surfaces sustained CPU demand as an investigation lead with limitations', () => {
    const o = observation();
    o.samples.forEach((s) => (s.cpuPercent = 95));
    const [result] = observationSignals(o);
    expect(result.key).toBe('cpu-demand');
    expect(result.limitation).toContain('not hardware limits');
    expect(result.action).toContain('Save your work');
  });
  it('recognizes a busy core without calling the entire CPU saturated', () => {
    const o = observation();
    o.samples.forEach((s) => (s.busiestCorePercent = 100));
    expect(observationSignals(o)[0].title).toContain('One processor core');
  });
  it('requires sustained measured paging or memory wait for a memory lead', () => {
    const o = observation();
    o.samples.forEach((s) => (s.pagingOutPerSec = 20));
    expect(observationSignals(o)[0].key).toBe('memory-pressure');
    expect(observationSignals(o)[0].limitation).toContain('not defective RAM');
  });
  it('does not interpolate pressure across unobserved gaps', () => {
    const o = observation({
      samples: [
        { atMs: 0, cpuPercent: 95 },
        { atMs: 180000, cpuPercent: 95 },
      ],
    });
    expect(sustainedMs(o, (s) => s.cpuPercent === 95)).toBe(0);
    expect(observationSignals(o)).toEqual([]);
  });
  it('keeps short recordings inconclusive even if samples are high', () => {
    const o = observation({ elapsedMs: 10000 });
    o.samples.forEach((s) => (s.cpuPercent = 100));
    expect(observationSignals(o)).toEqual([]);
  });
  it('distinguishes space constraints from hardware condition', () => {
    const [s] = observationSignals(observation({ freeSpacePercent: 3 }));
    expect(s.key).toBe('free-space');
    expect(s.limitation).toContain('separate from drive health');
  });
  it('does not interpret throughput alone as a drive fault', () => {
    const o = observation();
    o.samples.forEach((s) => (s.diskMBps = 2000));
    expect(observationSignals(o)).toEqual([]);
  });
});
describe('comparisons and reports', () => {
  it('flags conflicts between selected and observed power conditions', () => {
    const a = observation({ power: 'plugged-in', observedPower: ['battery'] });
    const result = compareObservations(a, a);
    expect(result.comparable).toBe(false);
    expect(result.notes.join(' ')).toContain('conflicts');
  });
  it('flags gaps instead of treating missing periods as comparable observations', () => {
    const a = observation();
    a.samples = a.samples.filter((s) => s.atMs < 20000 || s.atMs > 50000);
    expect(compareObservations(a, observation()).comparable).toBe(false);
  });
  it('flags unknown power, changed conditions, and partial recordings', () => {
    const result = compareObservations(
      observation(),
      observation({ power: 'battery', observedPower: ['unknown'], state: 'stopped' }),
    );
    expect(result.comparable).toBe(false);
    expect(result.notes.join(' ')).toContain('ended early');
  });
  it('preserves causal uncertainty even for matched sessions', () => {
    const result = compareObservations(observation(), observation());
    expect(result.comparable).toBe(true);
    expect(result.notes.at(-1)).toContain('not proof');
  });
  it('escapes user notes and omits app names, identifiers, and raw samples in export', () => {
    const c = investigation();
    c.workload = '<script>danger()</script>';
    c.observations[0].samples[0].apps = [{ name: 'PrivateApp', cpuPercent: 1, memoryMB: 2 }];
    const html = investigationReport(c);
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('PrivateApp');
    expect(html).not.toContain(c.id);
  });
});
