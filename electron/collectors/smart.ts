import path from 'node:path';
import type { Component, Metric } from '../../src/shared/types';
import { check, finite, metric, run } from './common';
import { bundledToolCandidates, findTool } from './tools';

export function matchesDriveIdentity(data: Record<string, any>, expectedSerial: string): boolean {
  return (
    typeof data.serial_number === 'string' &&
    data.serial_number.trim().toLowerCase() === expectedSerial.trim().toLowerCase()
  );
}

export function parseSmart(data: Record<string, any>, component: Component): void {
  const source = 'smartctl / device SMART log';
  const nvme = data.nvme_smart_health_information_log;
  const passed = data.smart_status?.passed;
  const observed: Metric[] = [];
  const counter = (value: unknown, maximum = Number.MAX_SAFE_INTEGER): number | undefined => {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value.trim())))
      return;
    const result = finite(value);
    return result !== undefined && Number.isSafeInteger(result) && result >= 0 && result <= maximum
      ? result
      : undefined;
  };
  if (typeof passed === 'boolean')
    observed.push(...metric('smart_passed', 'SMART status', passed ? 'Passed' : 'Failed', source));
  if (nvme && typeof nvme === 'object') {
    observed.push(
      ...metric(
        'endurance_used',
        'Estimated endurance used',
        counter(nvme.percentage_used, 255),
        source,
        '%',
      ),
      ...metric(
        'critical_warning',
        'Critical warning bits',
        counter(nvme.critical_warning, 255),
        source,
      ),
      ...metric('media_errors', 'Lifetime media errors', counter(nvme.media_errors), source),
      ...metric('spare', 'Available spare', counter(nvme.available_spare, 100), source, '%'),
      ...metric(
        'spare_threshold',
        'Manufacturer spare threshold',
        counter(nvme.available_spare_threshold, 100),
        source,
        '%',
      ),
      ...metric('temperature', 'Drive temperature', finite(nvme.temperature), source, '°C'),
      ...metric('power_hours', 'Power-on time', counter(nvme.power_on_hours), source, ' h'),
      ...metric(
        'unsafe_shutdowns',
        'Recorded unsafe shutdowns',
        counter(nvme.unsafe_shutdowns),
        source,
      ),
      ...metric('power_cycles', 'Power cycles', counter(nvme.power_cycles), source),
      ...metric(
        'data_written',
        'Host data written',
        counter(nvme.data_units_written) === undefined
          ? undefined
          : Math.round(((nvme.data_units_written * 512000) / 1e12) * 100) / 100,
        source,
        ' TB',
      ),
    );
  }
  if (!nvme) {
    const temperature = finite(data.temperature?.current);
    observed.push(
      ...metric(
        'temperature',
        'Drive temperature',
        temperature !== undefined && temperature >= -40 && temperature <= 150
          ? temperature
          : undefined,
        source,
        '°C',
      ),
    );
    observed.push(
      ...metric('power_hours', 'Power-on time', counter(data.power_on_time?.hours), source, ' h'),
    );
    observed.push(
      ...metric('power_cycles', 'Power cycles', counter(data.power_cycle_count), source),
    );
  }
  // Interpret only known ID/name pairs; raw ATA attributes are vendor dependent.
  const ataFields = [
    [5, 'Reallocated_Sector_Ct', 'ata_reallocated', 'Reallocated sectors'],
    [197, 'Current_Pending_Sector', 'ata_pending', 'Pending sectors'],
    [198, 'Offline_Uncorrectable', 'ata_offline_uncorrectable', 'Offline uncorrectable sectors'],
    [199, 'UDMA_CRC_Error_Count', 'ata_crc_errors', 'Interface CRC errors'],
  ] as const;
  const table = data.ata_smart_attributes?.table;
  if (Array.isArray(table))
    for (const [id, name, key, label] of ataFields) {
      const row = table.find((a) => a?.id === id && a?.name === name);
      observed.push(...metric(key, label, counter(row?.raw?.value), source));
    }
  // More detailed, later observations replace a duplicate generic system field.
  component.metrics = [
    ...new Map([...component.metrics, ...observed].map((m) => [m.key, m])).values(),
  ];
  const available = observed.length > 0;
  component.checks.push(
    check(
      'smart-detail',
      'Detailed device health',
      available ? 'available' : 'unsupported',
      available
        ? 'Read device-reported values. No self-test was started.'
        : 'The device did not expose supported health fields. Administrator access or another device interface may be required.',
      source,
    ),
  );
  if (!nvme)
    component.checks.push(
      check(
        'endurance',
        'SSD endurance estimate',
        'unsupported',
        'No standardized NVMe endurance field. Vendor-specific ATA wear estimates are not interpreted. Only explicitly recognized error counters are read.',
        source,
      ),
    );
}

export async function enrichSmart(
  component: Component,
  device: string,
  signal: AbortSignal,
  expectedSerial?: string,
): Promise<void> {
  if (
    !/^\/dev\/(disk\d+|nvme\d+n\d+|sd[a-z]+|hd[a-z]+|mmcblk\d+)$/.test(device) &&
    !(process.platform === 'win32' && /^\/dev\/pd\d{1,4}$/.test(device))
  )
    return;
  const paths = [
    ...bundledToolCandidates(process.platform === 'win32' ? 'smartctl.exe' : 'smartctl'),
    '/usr/sbin/smartctl',
    '/usr/bin/smartctl',
    '/opt/homebrew/sbin/smartctl',
    '/opt/homebrew/bin/smartctl',
    '/usr/local/sbin/smartctl',
    ...(process.platform === 'win32'
      ? [
          path.join(
            process.env.ProgramFiles || 'C:\\Program Files',
            'smartmontools',
            'bin',
            'smartctl.exe',
          ),
        ]
      : []),
  ];
  const executable = await findTool(paths);
  if (!executable) {
    component.checks.push(
      check(
        'smart-detail',
        'Detailed device health',
        'unsupported',
        'The packaged drive reader is missing and no installed smartmontools was found. Reinstall the complete PC Health package to restore detailed drive readings.',
        'smartctl',
      ),
    );
    return;
  }
  try {
    const output = await run(
      executable,
      ['-j', '-i', '-H', '-A', '-n', 'standby', device],
      signal,
      true,
    );
    const data = JSON.parse(output);
    if (expectedSerial && !matchesDriveIdentity(data, expectedSerial)) {
      component.checks.push(
        check(
          'smart-detail',
          'Detailed device health',
          'error',
          'The raw drive identity did not match the Windows inventory. Values were discarded to avoid attributing wear to the wrong drive.',
          'smartctl',
        ),
      );
      return;
    }
    parseSmart(data, component);
    const detail = component.checks.find((c) => c.id === 'smart-detail');
    if (detail && detail.status !== 'available') {
      const messages = Array.isArray(data.smartctl?.messages)
        ? data.smartctl.messages.map((m: any) => String(m.string ?? '')).join(' ')
        : '';
      if (/permission|denied|not permitted|administrator/i.test(messages)) {
        detail.status = 'permission';
        detail.detail =
          'The OS denied the raw drive read. On Windows, close PC Health and use Run as administrator only if you approve that access. No elevation or drive changes occur automatically.';
      } else if (/standby|sleep|low.power/i.test(messages)) {
        detail.detail =
          'The drive is in a low-power state. Retry during normal use; PC Health does not deliberately wake it or start a self-test.';
      }
    }
  } catch (error) {
    if (signal.aborted) throw error;
    component.checks.push(
      check(
        'smart-detail',
        'Detailed device health',
        /permission|denied|not permitted/i.test(String(error)) ? 'permission' : 'error',
        'Detailed health was not readable. The drive may be asleep, access may be restricted, or the controller may not support this interface.',
        'smartctl',
      ),
    );
  }
}
