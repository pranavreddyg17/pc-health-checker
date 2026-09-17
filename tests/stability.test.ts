import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  linuxStability,
  parseKernelJournal,
  parseMacReportFiles,
  parseWindowsEvents,
} from '../electron/collectors/stability';
import * as common from '../electron/collectors/common';
import { diagnose, numeric } from '../src/shared/diagnostics';
import { parseWindowsStorage } from '../electron/collectors/windows';

const now = Date.parse('2026-09-15T12:00:00Z');
const day = 86400000;
const journal = (...messages: string[]) =>
  messages.map((MESSAGE) => JSON.stringify({ MESSAGE })).join('\n');
afterEach(() => vi.restoreAllMocks());

describe('macOS stability metadata', () => {
  it('counts recent panic reports, not app crashes, old files, future files, or duplicates', () => {
    const files = [
      { name: 'panic-full-2026-09-14.ips', modifiedAt: now - day },
      { name: 'panic-full-2026-09-14.ips', modifiedAt: now - day },
      { name: 'Kernel_2026-09-13.panic', modifiedAt: now - 2 * day },
      { name: 'Browser_2026-09-14.ips', modifiedAt: now - day },
      { name: 'panic-full-old.ips', modifiedAt: now - 8 * day },
      { name: 'panic-full-future.ips', modifiedAt: now + day },
      { name: 'panic-full-invalid.ips', modifiedAt: NaN },
    ];
    const c = parseMacReportFiles(files, now);
    expect(numeric(c, 'panic_report_count')).toBe(2);
    expect(JSON.stringify(c)).not.toContain('panic-full-2026');
    expect(diagnose([c])[0]).toMatchObject({
      severity: 'attention',
      rule: 'system-stability-evidence-v1',
      componentId: c.id,
    });
    expect(diagnose([c])[0].limitation).toContain('does not establish component wear');
  });
  it('keeps an empty sample free of findings and explains incomplete history', () => {
    const c = parseMacReportFiles([], now, true);
    expect(diagnose([c])).toEqual([]);
    expect(c.checks[0].detail).toContain('limited');
    expect(c.checks[0].detail).toContain('Missing or deleted');
  });
});

describe('Windows stability and health', () => {
  it('counts only valid events in the window and discards message content and identifiers', () => {
    const c = parseWindowsEvents(
      {
        Events: [
          { Id: 19, Time: '2026-09-15T10:00:00Z', Message: 'private machine details' },
          { Id: 18, Time: '2026-09-14T10:00:00Z' },
          { Id: 18, Time: '2026-08-14T10:00:00Z' },
          { Id: 18, Time: '2026-09-16T10:00:00Z' },
          { Id: 'invalid', Time: 'not a date' },
        ],
        Truncated: false,
      },
      now,
    );
    expect(numeric(c, 'whea_event_count')).toBe(2);
    expect(c.checks[0].detail).toContain('could not be parsed');
    expect(JSON.stringify(c)).not.toContain('private machine details');
    expect(diagnose([c])[0].severity).toBe('attention');
  });
  it.each([
    undefined,
    null,
    {},
    [],
    { Events: null, Truncated: false },
    { Events: [null], Truncated: false },
    { Events: [{}], Truncated: false },
  ])('rejects unreadable envelopes and records: %j', (data) => {
    expect(() => parseWindowsEvents(data, now)).toThrow();
  });
  it('accepts a successful empty query without diagnosing complete health', () => {
    const c = parseWindowsEvents({ Events: [], Truncated: false }, now);
    expect(numeric(c, 'whea_event_count')).toBe(0);
    expect(diagnose([c])).toEqual([]);
    expect(c.checks[0].detail).toContain('limit coverage');
  });
  it('caps event counts and exposes sample truncation', () => {
    const Events = Array.from({ length: 300 }, () => ({ Id: 19, Time: '2026-09-15T10:00:00Z' }));
    const c = parseWindowsEvents({ Events, Truncated: true }, now);
    expect(numeric(c, 'whea_event_count')).toBe(256);
    expect(c.checks[0].detail).toContain('latest 256');
  });
  it.each([
    ['Warning', 'attention'],
    ['Unhealthy', 'urgent'],
  ])('surfaces %s without interpreting wear as NVMe endurance', (Health, severity) => {
    const [c] = parseWindowsStorage([
      { Name: 'SSD', BusType: 'NVMe', Health, Reliability: { Wear: 100 } },
    ]);
    expect(diagnose([c])).toHaveLength(1);
    expect(diagnose([c])[0]).toMatchObject({ rule: 'windows-storage-health-v1', severity });
    expect(numeric(c, 'endurance_used')).toBeUndefined();
  });
  it('does not create a fault from Healthy or unknown status', () => {
    for (const Health of ['Healthy', 'Unknown', 'unexpected', undefined]) {
      expect(diagnose(parseWindowsStorage([{ Health }]))).toEqual([]);
    }
  });
});

describe('Linux kernel diagnostics', () => {
  it('recognizes specific fault patterns and discards raw messages', () => {
    const c = parseKernelJournal(
      journal(
        'EDAC MC0: 1 CE memory read error',
        'mce: [Hardware Error]: Machine check events logged',
        '[Hardware Error]: Corrected error, no action required',
        'pcieport 0000:00:01.0: AER: Corrected error received',
        'NVRM: Xid (PCI:0000:01:00): 79 private-identifiers',
        'amdgpu: ring gfx timeout',
        'i915 0000:00:02.0: GPU HANG',
        'nvme 0000:01:00.0: error recovery enabled',
      ),
    );
    expect(numeric(c, 'kernel_memory_events')).toBe(3);
    expect(numeric(c, 'kernel_pcie_events')).toBe(1);
    expect(numeric(c, 'kernel_gpu_events')).toBe(3);
    expect(JSON.stringify(c)).not.toContain('private-identifiers');
    expect(JSON.stringify(c)).not.toContain('0000:');
    expect(diagnose([c])[0].limitation).toContain('One incident');
  });
  it('does not count a generic mention of error handling as a fault', () => {
    const c = parseKernelJournal(
      journal('EDAC driver loaded', 'GPU initialized', 'error reporting enabled'),
    );
    expect(diagnose([c])).toEqual([]);
  });
  it('rejects entirely unreadable entries and discloses partial parsing', () => {
    expect(() => parseKernelJournal('not JSON')).toThrow();
    expect(() => parseKernelJournal('{"MESSAGE": [1, 2]}')).toThrow();
    const c = parseKernelJournal(`${journal('NVRM: Xid 79')}\ninvalid`);
    expect(numeric(c, 'kernel_gpu_events')).toBe(1);
    expect(c.checks[0].detail).toContain('could not be parsed');
  });
  it('retains the most recent messages when the sample is capped', () => {
    const lines = [...Array(256).fill('unrelated warning'), 'NVRM: Xid 79'];
    const c = parseKernelJournal(journal(...lines));
    expect(numeric(c, 'kernel_gpu_events')).toBe(1);
    expect(c.checks[0].detail).toContain('sample was limited');
  });
  it('treats an empty access probe as unavailable', async () => {
    const run = vi.spyOn(common, 'run').mockResolvedValue('');
    const [c] = await linuxStability(new AbortController().signal);
    expect(c.checks[0].status).toBe('unsupported');
    expect(c.metrics).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed access probes before accepting an empty warning query', async () => {
    const run = vi.spyOn(common, 'run').mockResolvedValue('not JSON');
    await expect(linuxStability(new AbortController().signal)).rejects.toThrow();
    expect(run).toHaveBeenCalledTimes(1);
  });
  it('allows an empty warning sample after verifying journal access', async () => {
    vi.spyOn(common, 'run')
      .mockResolvedValueOnce(journal('Linux kernel initialized'))
      .mockResolvedValueOnce('');
    const [c] = await linuxStability(new AbortController().signal);
    expect(c.checks[0].status).toBe('available');
    expect(diagnose([c])).toEqual([]);
  });
});
