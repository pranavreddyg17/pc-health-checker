import { batterySignals } from '../electron/reliability/platform';
import { parseMacBattery } from '../electron/collectors/macos';
import { describe, it, expect } from 'vitest';
import { parseMacNative, parseLaunchctlList } from '../electron/reliability/macos';
import { parseWindowsOperational } from '../electron/reliability/windows';
import { parseAmdRas, parseLinuxMemoryPressure } from '../electron/reliability/linux';
import { parseNvidiaTelemetry, signal, unavailable } from '../electron/reliability/signals';
import { parseWindowsStorage } from '../electron/collectors/windows';
import { parseSmart, matchesDriveIdentity } from '../electron/collectors/smart';
import { component, check } from '../electron/collectors/common';
import { attachOperationalSignals } from '../electron/collectors/operational';
import { coverage, diagnose, numeric } from '../src/shared/diagnostics';
import { telemetryCoverage, alertChanges } from '../src/shared/reliability';
import { validSnapshot } from '../electron/reliability/store';

const now = Date.parse('2026-09-16T12:00:00Z');
function windows(extra = {}) {
  return parseWindowsOperational(
    {
      Memory: { AvailableMBytes: 2000, PercentCommittedBytesInUse: 25 },
      Thermals: [],
      Sensors: [],
      GPU: [{ Name: 'Test GPU', ConfigManagerErrorCode: 0 }],
      DisplayEvents: [],
      ServiceEvents: [],
      MemoryEvents: [],
      ...extra,
    },
    now,
  );
}
describe('native macOS telemetry', () => {
  it('uses documented thermal and pressure states without estimating component wear', () => {
    const signals = parseMacNative({
      schemaVersion: 1,
      thermalState: 'critical',
      memoryPressure: 4,
      swapUsedBytes: 1024 ** 2,
      gpus: [{ name: 'Apple Test', unifiedMemory: true }],
    });
    expect(signals.map((s) => s.level)).toEqual(['critical', 'warning', 'clear']);
    expect(signals.every((s) => s.availability === 'readable')).toBe(true);
    const components = [component('memory', 'Memory', 'Test')];
    attachOperationalSignals(components, signals);
    expect(diagnose(components).map((f) => f.category)).toEqual(['condition', 'condition']);
    expect(diagnose(components).every((f) => !/replace/i.test(f.action))).toBe(true);
    expect(numeric(components[0], 'operational:memory:pressure:1')).toBe(1);
  });
  it('rejects unknown schemas and missing native fields rather than reporting a clean host', () => {
    expect(() => parseMacNative({ schemaVersion: 2 })).toThrow();
    expect(
      parseMacNative({ schemaVersion: 1 }).every(
        (s) => s.level === 'unknown' && s.availability === 'unsupported',
      ),
    ).toBe(true);
  });
  it('does not classify on-demand services, historical signals or running jobs as failed', () => {
    const [s] = parseLaunchctlList(
      'PID\tStatus\tLabel\n-\t0\tcom.test.demand\n-\t-9\tcom.test.kill\n12\t1\tcom.test.running',
    );
    expect(s.level).toBe('clear');
    expect(parseLaunchctlList('PID Status Label\n- 5 com.test.failed')[0].level).toBe('warning');
    expect(() => parseLaunchctlList('PID Status Label\ninvalid')).toThrow();
  });
});
describe('Windows operational telemetry', () => {
  it('converts ACPI tenths Kelvin and compares only with a firmware critical trip', () => {
    const thermals = windows({
      Thermals: [
        { InstanceName: 'test', CurrentTemperature: 3732, CriticalTripPoint: 3682, Active: true },
      ],
    }).filter((s) => s.id.startsWith('thermal:acpi:'));
    expect(thermals[0].measurements[0].value).toBe(100.1);
    expect(thermals[0].level).toBe('critical');
    expect(
      windows({ Thermals: [{ CurrentTemperature: 3132 }] }).find((s) => s.category === 'thermal')
        ?.availability,
    ).toBe('readable');
    expect(
      windows({
        Thermals: [
          { CurrentTemperature: 2732 },
          { CurrentTemperature: 0 },
          { CurrentTemperature: 3100, Active: false },
        ],
      }).find((s) => s.category === 'thermal')?.availability,
    ).toBe('unsupported');
  });
  it('reads optional fan/voltage providers without inventing thresholds or failed idle fans', () => {
    const sensors = windows({
      Sensors: [
        { Name: 'Fan', SensorType: 'Fan', Value: 0 },
        { Name: 'Bad', SensorType: 'Voltage', Value: 200 },
      ],
    }).filter((s) => s.id.startsWith('thermal:lhm:'));
    expect(sensors).toHaveLength(1);
    expect(sensors[0].level).toBe('unknown');
    expect(sensors[0].availability).toBe('readable');
  });
  it('keeps resource pressure, device errors and retained driver recoveries as separate leads', () => {
    const signals = windows({
      Memory: { AvailableMBytes: 1, PercentCommittedBytesInUse: 98 },
      GPU: [{ Name: 'Test GPU', ConfigManagerErrorCode: 43 }],
      DisplayEvents: [{ Id: 4101, Level: 3, Time: '2026-09-16T11:00:00Z' }],
    });
    expect(signals.find((s) => s.id === 'memory:resources')?.level).toBe('warning');
    expect(signals.find((s) => s.id.startsWith('gpu:device:'))?.level).toBe('warning');
    expect(signals.find((s) => s.id === 'gpu:tdr')?.level).toBe('warning');
    const bad = windows({ DisplayEvents: [{ Id: 4101, Time: 'not-a-date' }] }).find(
      (s) => s.id === 'gpu:tdr',
    )!;
    expect(bad.level).toBe('unknown');
    expect(bad.measurements).toEqual([]);
  });
  it('never turns absence or an informational memory event into a passing physical memory test', () => {
    expect(windows().find((s) => s.id === 'memory:diagnostic-events')?.level).toBe('unknown');
    expect(
      windows({ MemoryEvents: [{ Id: 1201, Level: 4, Time: '2026-09-16T11:00:00Z' }] }).find(
        (s) => s.id === 'memory:diagnostic-events',
      )?.level,
    ).toBe('unknown');
    expect(
      windows({ MemoryEvents: [{ Id: 1202, Level: 2, Time: '2026-09-16T11:00:00Z' }] }).find(
        (s) => s.id === 'memory:diagnostic-events',
      )?.level,
    ).toBe('warning');
  });
  it('does not count an empty storage reliability object as collected', () => {
    const [empty] = parseWindowsStorage([{ Name: 'Disk', Reliability: {} }]);
    expect(empty.checks.find((c) => c.id === 'reliability')?.status).toBe('unsupported');
    const [zero] = parseWindowsStorage([
      { Name: 'Disk', Reliability: { ReadErrorsUncorrected: 0, PowerOnHours: 0 } },
    ]);
    expect(zero.checks.find((c) => c.id === 'reliability')?.status).toBe('available');
  });
});
describe('GPU and storage evidence attribution', () => {
  it('reads AMD corrected/uncorrected counters with no missing or duplicate counter inferred zero', () => {
    expect(parseAmdRas('ue: 1\nce: 0', 'amd:test:umc', 'boot').map((s) => s.level)).toEqual([
      'clear',
      'critical',
    ]);
    for (const input of ['ce: 0', 'ce: 0\nce: 1', 'ce: 0\nue: -1', 'garbage'])
      expect(parseAmdRas(input, 'amd:test', 'boot')[0].level).toBe('unknown');
  });
  it('collects ordinary NVIDIA readings independently of unsupported ECC, retaining explicit idle zeroes', () => {
    const [s] = parseNvidiaTelemetry('GPU-abcd-1234, Test NVIDIA, 42, 0, 100, 200, 0, N/A');
    expect(s.availability).toBe('readable');
    expect(s.measurements).toHaveLength(5);
    expect(s.level).toBe('unknown');
    expect(
      parseNvidiaTelemetry('GPU-abcd-1234, Test, N/A, N/A, N/A, N/A, N/A, N/A')[0].availability,
    ).toBe('unsupported');
  });
  it('records NVMe lifecycle values without treating historical shutdowns as a failing drive', () => {
    const c = component('storage', 'Drive', 'Test');
    parseSmart(
      {
        nvme_smart_health_information_log: {
          unsafe_shutdowns: 10,
          power_cycles: 20,
          data_units_written: 1953125,
          media_errors: 0,
        },
      },
      c,
    );
    expect(numeric(c, 'data_written')).toBe(1);
    expect(numeric(c, 'unsafe_shutdowns')).toBe(10);
    expect(diagnose([c])).toEqual([]);
    const ata = component('storage', 'ATA', 'Test');
    parseSmart({ temperature: { current: 38 }, power_on_time: { hours: 12 } }, ata);
    expect(numeric(ata, 'temperature')).toBe(38);
  });
});
describe('coverage and historical schema compatibility', () => {
  it('separates external tests from automatic failures including a cancelled collector', () => {
    const c = component('memory', 'Memory', 'Test');
    c.checks = [
      check('inventory', 'Inventory', 'available', '', 'test'),
      check('memory-test', 'Integrity', 'not-run', '', 'test'),
      check('cancelled', 'Collector', 'not-run', '', 'test'),
    ];
    expect(coverage([c])).toEqual({
      completed: 1,
      total: 3,
      automatic: 2,
      guided: 1,
      unavailable: 1,
    });
  });
  it('distinguishes readable but unassessed data, unavailable sources and older saved observations', () => {
    const s = signal('test', 'gpu', 'Test', 'Test', 'Test', 'unknown', '', '', '', [
      { name: 'Value', value: 0 },
    ]);
    const old = { ...s, id: 'old', availability: undefined };
    const missing = unavailable('missing', 'gpu', 'Missing', 'Test', 'No tool', 'missing-tool');
    const na = { ...missing, id: 'na', availability: 'not-applicable' as const };
    expect(telemetryCoverage([s, old, missing, na])).toEqual({
      readable: 2,
      unavailable: 1,
      notApplicable: 1,
    });
    const snapshot = {
      schemaVersion: 1,
      id: 'test',
      at: new Date(now).toISOString(),
      platform: 'win32',
      ruleVersion: '0.7.0',
      elapsedMs: 1,
      signals: [s, old],
    };
    expect(validSnapshot(snapshot)).toBe(true);
    expect(validSnapshot({ ...snapshot, signals: [{ ...s, availability: 'invented' }] })).toBe(
      false,
    );
  });
});

describe('memory pressure and drive identity validation', () => {
  it('parses PSI as stall percentages and keeps lifetime OOM kills separate from RAM integrity', () => {
    const signals = parseLinuxMemoryPressure(
      'some avg10=1.25 avg60=0.00 total=1\nfull avg10=0.00 avg60=0.00 total=0',
      'MemAvailable: 2048 kB',
      'oom_kill 3',
      'boot',
    );
    expect(signals[0].availability).toBe('readable');
    expect(signals[0].measurements.map((m) => m.value)).toEqual([1.25, 0, 2]);
    expect(signals[1].counter).toEqual({ value: 3, epoch: 'boot' });
    expect(parseLinuxMemoryPressure(undefined, undefined, undefined, 'boot')[0].availability).toBe(
      'unsupported',
    );
  });
  it('discards raw Windows drive evidence if its serial is absent or disagrees with the mapped disk', () => {
    expect(matchesDriveIdentity({ serial_number: '  TEST-SERIAL ' }, 'test-serial')).toBe(true);
    expect(matchesDriveIdentity({ serial_number: 'other' }, 'test-serial')).toBe(false);
    expect(matchesDriveIdentity({}, 'test-serial')).toBe(false);
  });
});

describe('collection loss semantics', () => {
  it('alerts when readable but unassessed telemetry is lost, without confusing a missing assessment with a missing reading', () => {
    const at = new Date(now).toISOString();
    const reading = signal(
      'sensor',
      'thermal',
      'Sensor',
      'Sensor',
      'Sensor',
      'unknown',
      '',
      '',
      '',
      [{ name: 'Temperature', value: 40 }],
    );
    const before = {
      schemaVersion: 1 as const,
      id: 'before',
      at,
      platform: 'linux',
      ruleVersion: '0.7.0',
      elapsedMs: 1,
      signals: [reading],
    };
    const missing = unavailable(
      'sensor',
      'thermal',
      'Sensor',
      'Sensor',
      'Access denied',
      'permission',
    );
    expect(
      alertChanges({ ...before, id: 'after', signals: [missing] }, before).notify[0].title,
    ).toContain('Telemetry lost');
    expect(
      alertChanges(
        { ...before, id: 'after' },
        { ...before, signals: [{ ...reading, level: 'clear' }] },
      ).notify,
    ).toHaveLength(0);
  });
  it('does not treat boolean or blank WMI fields as collected numbers', () => {
    for (const value of [false, true, ' ', null]) {
      const signals = windows({
        Memory: { AvailableMBytes: value, PercentCommittedBytesInUse: value },
      });
      expect(signals.find((s) => s.id === 'memory:resources')?.availability).toBe('unsupported');
    }
  });
});

describe('battery monitoring', () => {
  it('carries baseline battery condition evidence into reliability alerts without claiming physical safety', () => {
    const [s] = batterySignals(
      parseMacBattery({
        SPPowerDataType: [
          {
            sppower_battery_health_info: {
              sppower_battery_health_maximum_capacity: '74%',
              sppower_battery_health: 'Service Recommended',
            },
          },
        ],
      }),
    );
    expect(s.category).toBe('power');
    expect(s.level).toBe('warning');
    expect(s.availability).toBe('readable');
    expect(s.limitation).toContain('swelling');
  });
});
