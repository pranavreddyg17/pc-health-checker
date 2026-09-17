import { describe, it, expect } from 'vitest';
import {
  alertChanges,
  enrichTrends,
  healthExitCode,
  type HealthSnapshot,
} from '../src/shared/reliability';
import {
  count,
  errorCounter,
  filesystemSignal,
  parseNvidia,
  parseZpool,
  raidSignal,
  thermalSignal,
} from '../electron/reliability/signals';
import {
  parseDf,
  parseMacNetwork,
  parseWindowsReliability,
  storageSignals,
} from '../electron/reliability/platform';
import { parseMounts, parseFailedServices } from '../electron/reliability/linux';
import { validSnapshot } from '../electron/reliability/store';
import { component } from '../electron/collectors/common';
import { parseSmart } from '../electron/collectors/smart';
import { parseWindowsStorage } from '../electron/collectors/windows';
import { diagnose } from '../src/shared/diagnostics';
export function snapshot(value = 0, at = '2026-09-16T12:00:00Z', epoch = 'boot-1'): HealthSnapshot {
  return {
    schemaVersion: 1,
    id: at,
    at,
    platform: 'linux',
    ruleVersion: '0.5.0',
    elapsedMs: 3,
    signals: [errorCounter('ecc', 'memory', 'ECC', 'EDAC', value, epoch)],
  };
}
describe('reliability evidence and comparisons', () => {
  it.each([null, undefined, '', 'N/A', -1, 1.5, Infinity, '9007199254740993', true])(
    'does not turn missing/invalid counters %s into zero',
    (value) => expect(count(value)).toBeUndefined(),
  );
  it('accepts explicit zero and never blesses an empty snapshot', () => {
    expect(count('0')).toBe(0);
    expect(healthExitCode({ ...snapshot(), signals: [] })).toBe(3);
    expect(validSnapshot({ ...snapshot(), signals: [] })).toBe(false);
  });
  it('compares only counters with matching epochs and bounded time gaps', () => {
    const previous = snapshot(4);
    const now = snapshot(7, '2026-09-16T12:05:00Z');
    expect(enrichTrends(now, previous).signals[0].trend).toEqual({
      state: 'increased',
      delta: 3,
      seconds: 300,
    });
    expect(enrichTrends(snapshot(7, now.at, 'boot-2'), previous).signals[0].trend?.state).toBe(
      'not-comparable',
    );
    expect(
      enrichTrends(snapshot(7, '2026-09-18T12:00:00Z'), previous).signals[0].trend?.state,
    ).toBe('not-comparable');
    expect(
      enrichTrends(snapshot(7, '2026-09-16T11:00:00Z'), previous).signals[0].trend?.state,
    ).toBe('not-comparable');
    expect(enrichTrends(snapshot(1, now.at), previous).signals[0].trend?.state).toBe('reset');
  });
  it('does not infer a rate when an EDAC driver reset even if its counter rose', () => {
    const before = snapshot(4),
      after = snapshot(9, '2026-09-16T12:05:00Z');
    before.signals[0].measurements.push({ name: 'Seconds since driver reset', value: 9000 });
    after.signals[0].measurements.push({ name: 'Seconds since driver reset', value: 300 });
    expect(enrichTrends(after, before).signals[0].trend?.state).toBe('not-comparable');
  });
  it('deduplicates historical faults, permits a new severity, and rate-limits rising counters', () => {
    const first = snapshot(4);
    const initial = alertChanges(first);
    expect(initial.notify).toHaveLength(1);
    const later = enrichTrends(snapshot(4, '2026-09-16T12:05:00Z'), first);
    expect(alertChanges(later, first, initial.alerts).notify).toHaveLength(0);
    const rising = enrichTrends(snapshot(7, later.at), first);
    expect(alertChanges(rising, first, initial.alerts).notify).toHaveLength(0);
    const due = enrichTrends(snapshot(9, '2026-09-16T12:30:00Z'), first);
    expect(alertChanges(due, first, initial.alerts).notify).toHaveLength(1);
    due.signals[0].level = 'critical';
    expect(alertChanges(due, first, initial.alerts).notify).toHaveLength(1);
  });
  it('alerts on lost coverage but does not call it a repaired component', () => {
    const first = snapshot(0),
      after = snapshot(0, '2026-09-16T12:05:00Z');
    after.signals[0].level = 'unknown';
    after.signals[0].availability = 'unsupported';
    const result = alertChanges(after, first);
    expect(result.notify[0].title).toMatch('Telemetry lost');
    expect(healthExitCode(after)).toBe(3);
  });
  it('rejects duplicate identities and impossible saved evidence', () => {
    expect(validSnapshot(snapshot())).toBe(true);
    expect(
      validSnapshot({ ...snapshot(), signals: [...snapshot().signals, ...snapshot().signals] }),
    ).toBe(false);
    const invalid = snapshot();
    invalid.signals[0].counter!.value = NaN;
    expect(validSnapshot(invalid)).toBe(false);
  });
});
describe('OS and vendor parsers', () => {
  it('uses driver temperature limits, sensor-fault flags and explicit unknowns', () => {
    expect(thermalSignal('t', 'CPU', '100000', '95000', '0', '0').level).toBe('critical');
    expect(thermalSignal('t', 'CPU', '50000', undefined, undefined, undefined).level).toBe(
      'unknown',
    );
    expect(thermalSignal('t', 'CPU', '50000', '95000', '0', '1').summary).toMatch('sensor fault');
    expect(thermalSignal('t', 'CPU', '50000', '95000', '2', '0').level).toBe('unknown');
    expect(thermalSignal('t', 'CPU', '50000', '95000', '0', '0').level).toBe('clear');
  });
  it('identifies capacity and inode exhaustion independently', () => {
    expect(filesystemSignal('fs', '/', 100, 50, 4096, 100, 0).level).toBe('critical');
    expect(filesystemSignal('fs', '/', 100, 4, 4096, 0, 0).level).toBe('warning');
    expect(filesystemSignal('fs', '/', 100, 101, 4096, 0, 0).level).toBe('unknown');
    expect(filesystemSignal('fs', '/', 100, 50, 4096, 0, 0).level).toBe('clear');
  });
  it('does not turn unreadable RAID state into a clean array', () => {
    expect(raidSignal('md', 'md0', '1', 'active').level).toBe('critical');
    expect(raidSignal('md', 'md0', '0', 'clean').level).toBe('clear');
    expect(raidSignal('md', 'md0', '0', '').level).toBe('unknown');
    expect(raidSignal('md', 'md0', undefined, 'clean').level).toBe('unknown');
    expect(parseZpool('tank\tDEGRADED\nfast\tONLINE').map((s) => s.level)).toEqual([
      'warning',
      'clear',
    ]);
    expect(parseZpool('tank FUTURE')[0].level).toBe('unknown');
  });
  it('excludes network mounts, handles escaped paths and deduplicates bind mounts', () => {
    const lines = [
      '30 1 8:1 / / rw - ext4 /dev/sda1 rw',
      '31 1 8:1 /data /bind rw - ext4 /dev/sda1 rw',
      '32 1 0:4 / /net rw - nfs server:/ rw',
      '33 1 8:2 / /data\\040volume ro - xfs /dev/sdb1 ro',
    ];
    expect(parseMounts(lines.join('\n'))).toEqual([
      { mount: '/', device: '8:1', type: 'ext4', readonly: false },
      { mount: '/data volume', device: '8:2', type: 'xfs', readonly: true },
    ]);
  });
  it('parses only explicit GPU ECC values and handles N/A fields', () => {
    const signals = parseNvidia('GPU-1234-abcd, Example GPU, 3, 1, Yes, 0', 'session');
    expect(signals.map((s) => s.level)).toEqual(['warning', 'critical', 'critical']);
    expect(
      parseNvidia('GPU-1234-abcd, Example GPU, N/A, N/A, N/A, N/A', 'session').every(
        (s) => s.level === 'unknown',
      ),
    ).toBe(true);
    expect(parseNvidia('bad format', 'session')[0].level).toBe('unknown');
  });
  it('recognizes failed services without treating unknown output as success', () => {
    expect(parseFailedServices('')[0].level).toBe('clear');
    expect(
      parseFailedServices('example.service loaded failed failed Example')[0].measurements[0].value,
    ).toBe('example.service');
    expect(parseFailedServices('Failed to connect to bus')[0].level).toBe('unknown');
  });
  it('reads macOS physical interface counters and discards addresses', () => {
    const header = 'Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll Drop';
    const out = parseMacNetwork(
      header +
        '\nen0 1500 <Link#6> aa:bb:cc:dd:ee:ff 100 3 2000 100 0 2000 0 2\nen0 1500 192.0.2 192.0.2.1 100 3 2000 100 0 2000 0 2',
      'epoch',
    );
    expect(out).toHaveLength(3);
    expect(out[0].counter?.value).toBe(3);
    expect(out[2].summary).toContain('packet discards');
    expect(out[2].action).toContain('do not justify replacing');
    expect(JSON.stringify(out)).not.toMatch(/aa:bb|192\.0\.2/);
    expect(parseMacNetwork('future output', 'epoch')[0].level).toBe('unknown');
  });
  it('reads macOS data-volume capacity with a spaced mount path', () => {
    expect(
      parseDf(
        'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/disk3s1 1000 995 5 100% /System/Volumes/Data',
      )[0].level,
    ).toBe('critical');
    expect(parseDf('bad')[0].level).toBe('unknown');
  });
  it('does not convert null Windows capacity into a full filesystem', () => {
    expect(
      parseWindowsReliability({ Volumes: [{ DeviceID: 'C:', Size: 1000, FreeSpace: null }] }).find(
        (s) => s.category === 'filesystem',
      )?.level,
    ).toBe('unknown');
  });
  it('does not classify a stopped Windows automatic service as failed', () => {
    const data = parseWindowsReliability({
      Volumes: [{ DeviceID: 'C:', Size: 1000, FreeSpace: 10 }],
      Network: [{ Name: 'Ethernet', ReceivedPacketErrors: 0 }],
      Services: [{ Name: 'trigger-service' }],
    });
    expect(data[0].level).toBe('critical');
    expect(data.find((s) => s.id === 'services')?.level).toBe('unknown');
    expect(data.filter((s) => s.category === 'network').map((s) => s.level)).toEqual([
      'clear',
      'unknown',
      'unknown',
      'unknown',
    ]);
  });
});
describe('storage health depth', () => {
  it('interprets only recognized ATA ID/name pairs and separates transport from media', () => {
    const c = component('storage', 'drive', '', 'stable');
    parseSmart(
      {
        ata_smart_attributes: {
          table: [
            { id: 197, name: 'Current_Pending_Sector', raw: { value: 2 } },
            { id: 199, name: 'UDMA_CRC_Error_Count', raw: { value: 6 } },
            { id: 5, name: 'Vendor_Specific', raw: { value: 999 } },
          ],
        },
      },
      c,
    );
    expect(c.metrics.map((m) => m.key)).toEqual(['ata_pending', 'ata_crc_errors']);
    expect(diagnose([c]).some((f) => f.severity === 'urgent')).toBe(true);
    expect(diagnose([c]).find((f) => f.rule === 'ata_crc_errors-v1')?.explanation).toMatch(
      'controller',
    );
  });
  it('compares spare to the reported manufacturer threshold', () => {
    const c = component('storage', 'NVMe', '');
    parseSmart(
      { nvme_smart_health_information_log: { available_spare: 8, available_spare_threshold: 10 } },
      c,
    );
    expect(diagnose([c])[0].rule).toBe('nvme-spare-v1');
  });
  it('treats missing and unknown Windows health as unassessed', () => {
    const drives = parseWindowsStorage([
      {
        Name: 'SSD',
        Health: 'Unknown',
        Reliability: { ReadErrorsUncorrected: null, WriteErrorsUncorrected: 2 },
      },
    ]);
    expect(drives[0].metrics.find((m) => m.key === 'windows_read_uncorrected')).toBeUndefined();
    expect(diagnose(drives)[0].severity).toBe('urgent');
    const missing = parseWindowsStorage([{ Name: 'SSD', Health: 'Unknown' }]);
    expect(storageSignals(missing)[0].level).toBe('unknown');
  });
  it('will not compare unidentified drives across observations', () => {
    const c = component('storage', 'drive', '');
    parseSmart({ nvme_smart_health_information_log: { media_errors: 1 } }, c);
    const first = storageSignals([c]).find((s) => s.counter)!,
      second = storageSignals([c]).find((s) => s.counter)!;
    expect(first.counter!.epoch).not.toBe(second.counter!.epoch);
  });
});
