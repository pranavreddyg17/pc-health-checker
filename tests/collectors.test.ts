import { describe, expect, it } from 'vitest';
import { parseMacBattery, parseMacStorage } from '../electron/collectors/macos';
import { parseWindowsBattery, parseWindowsStorage } from '../electron/collectors/windows';
import { parseLinuxBlock } from '../electron/collectors/linux';
import { parseSmart } from '../electron/collectors/smart';
import { component } from '../electron/collectors/common';
import { numeric, diagnose } from '../src/shared/diagnostics';

describe('macOS collection parsing', () => {
  it('supports the current macOS condition and maximum-capacity fields', () => {
    const [c] = parseMacBattery({
      SPPowerDataType: [
        {
          sppower_battery_health_info: {
            sppower_battery_health: 'Check Battery',
            sppower_battery_health_maximum_capacity: '74%',
            sppower_battery_cycle_count: 1000,
          },
        },
      ],
    });
    expect(numeric(c, 'capacity_retention')).toBe(74);
    expect(diagnose([c])[0].severity).toBe('attention');
  });
  it('reads health capacity rather than charge level', () => {
    const [c] = parseMacBattery({
      SPPowerDataType: [
        {
          sppower_battery_health_info: {
            sppower_battery_health: '94%',
            sppower_battery_cycle_count: 104,
            sppower_battery_condition: 'Normal',
          },
          sppower_battery_charge_info: { sppower_battery_current_capacity: 12 },
        },
      ],
    });
    expect(numeric(c, 'capacity_retention')).toBe(94);
    expect(diagnose([c])).toEqual([]);
  });
  it('ignores unsupported capacity sentinels', () => {
    const [c] = parseMacBattery({
      SPPowerDataType: [{ sppower_battery_health_info: { sppower_battery_health: '0%' } }],
    });
    expect(numeric(c, 'capacity_retention')).toBeUndefined();
  });
  it('deduplicates physical devices and drops partitions', () => {
    const disk = {
      _name: 'APPLE SSD',
      bsd_name: 'disk0',
      device_serial: 'fake-test-serial',
      smart_status: 'Verified',
    };
    const result = parseMacStorage({
      SPNVMeDataType: [
        { _name: 'Controller', _items: [disk, { ...disk, bsd_name: 'disk0s1' }, disk] },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].component.serviceability).toBe('integrated');
    expect(JSON.stringify(result)).not.toContain('fake-test-serial');
  });
});
describe('Windows collection parsing', () => {
  it('does not assign NVMe meaning to Windows vendor-dependent Wear', () => {
    const [c] = parseWindowsStorage([
      { Name: 'Test drive', BusType: 'NVMe', Size: 1000000000000, Reliability: { Wear: 100 } },
    ]);
    expect(numeric(c, 'endurance_used')).toBeUndefined();
    expect(diagnose([c])).toEqual([]);
  });
  it('keeps multiple-battery capacity mapping ambiguous', () => {
    const data = {
      Batteries: [{ Name: 'One' }, { Name: 'Two' }],
      Full: [{ FullChargedCapacity: 100 }],
      Static: [{ DesignedCapacity: 200 }],
    };
    expect(
      parseWindowsBattery(data).every((c) => numeric(c, 'capacity_retention') === undefined),
    ).toBe(true);
  });
  it('rejects zero and invalid battery design capacities', () => {
    const [c] = parseWindowsBattery({
      Batteries: [{ Name: 'Battery' }],
      Full: [{ FullChargedCapacity: 100 }],
      Static: [{ DesignedCapacity: 0 }],
    });
    expect(numeric(c, 'capacity_retention')).toBeUndefined();
  });
  it('excludes external and virtual storage from internal parts', () =>
    expect(
      parseWindowsStorage([
        { Name: 'USB', BusType: 'USB' },
        { Name: 'VM', BusType: 'Virtual' },
      ]),
    ).toEqual([]));
});
describe('Linux storage parsing', () => {
  it('accepts internal NVMe but not partitions, removable drives, or unsafe paths', () => {
    const valid = {
      type: 'disk',
      rm: false,
      tran: 'nvme',
      path: '/dev/nvme0n1',
      model: 'Test NVMe',
      serial: 'test-only',
      size: 1e12,
    };
    const result = parseLinuxBlock({
      blockdevices: [
        valid,
        { ...valid, rm: true },
        { ...valid, type: 'part' },
        { ...valid, path: '/tmp/arbitrary' },
      ],
    });
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('test-only');
  });
});
describe('SMART parsing', () => {
  it('does not let a generic passing status hide a later failed device status', () => {
    const c = component('storage', 'SSD', 'Test');
    c.metrics.push({
      key: 'smart_passed',
      label: 'SMART status',
      value: 'Passed',
      source: 'system inventory',
    });
    parseSmart({ smart_status: { passed: false } }, c);
    expect(c.metrics.filter((m) => m.key === 'smart_passed')).toHaveLength(1);
    expect(diagnose([c])[0].severity).toBe('urgent');
  });
  it('keeps malformed or unsafe NVMe counters unavailable', () => {
    const c = component('storage', 'SSD', 'Test');
    parseSmart(
      {
        nvme_smart_health_information_log: {
          percentage_used: 9999,
          media_errors: '999999999999999999999999',
          critical_warning: -1,
        },
      },
      c,
    );
    expect(c.metrics).toHaveLength(0);
    expect(c.checks[0].status).toBe('unsupported');
    expect(diagnose([c])).toEqual([]);
  });
  it('preserves device-reported endurance above 100', () => {
    const c = component('storage', 'SSD', 'Test');
    parseSmart(
      {
        nvme_smart_health_information_log: {
          percentage_used: 121,
          critical_warning: 0,
          media_errors: 0,
        },
      },
      c,
    );
    expect(numeric(c, 'endurance_used')).toBe(121);
  });
  it('does not fabricate a passing status for an unsupported log', () => {
    const c = component('storage', 'SSD', 'Test');
    parseSmart({ smartctl: { exit_status: 2 } }, c);
    expect(c.metrics).toHaveLength(0);
    expect(c.checks[0].status).toBe('unsupported');
  });
  it('does not interpret vendor ATA attributes as a universal wear percentage', () => {
    const c = component('storage', 'SSD', 'Test');
    parseSmart(
      { ata_smart_attributes: { table: [{ id: 177, value: 9 }] }, smart_status: { passed: true } },
      c,
    );
    expect(numeric(c, 'endurance_used')).toBeUndefined();
    expect(diagnose([c])).toEqual([]);
  });
});
