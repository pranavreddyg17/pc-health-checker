import path from 'node:path';
import { access, readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { HealthSignal } from '../../src/shared/reliability';
import type { Component } from '../../src/shared/types';
import { run, hash } from '../collectors/common';
import { macStorage, parseMacBattery, profiler } from '../collectors/macos';
import { linuxStorage, linuxBatteries } from '../collectors/linux';
import { windowsStorage, parseWindowsBattery, powershell } from '../collectors/windows';
import { diagnose } from '../../src/shared/diagnostics';
import {
  count,
  errorCounter,
  filesystemSignal,
  signal,
  unavailable,
  parseNvidia,
  parseNvidiaTelemetry,
} from './signals';
const sessionEpoch = process.env.PCHEALTH_OBSERVATION_EPOCH || randomUUID();
export function parseDf(output: string): HealthSignal[] {
  const out: HealthSignal[] = [];
  for (const line of output.trim().split('\n').slice(1)) {
    const m = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(.+)$/);
    if (!m) continue;
    out.push(
      filesystemSignal(`fs:${hash(m[1] + m[5])}`, m[5], Number(m[2]), Number(m[4]), 1024, 0, 0),
    );
  }
  return out.length
    ? out
    : [
        unavailable(
          'filesystems',
          'filesystem',
          'Data-volume capacity',
          'df',
          'Filesystem capacity output was not readable.',
        ),
      ];
}
export async function macFilesystems(abort: AbortSignal) {
  return parseDf(await run('/bin/df', ['-kP', '/System/Volumes/Data'], abort));
}
export async function nvidia(abort: AbortSignal) {
  // Establish absence only from a successfully enumerated hardware inventory.
  let presence: boolean | undefined;
  if (process.platform === 'linux') {
    const devices = await readdir('/sys/bus/pci/devices').catch(() => []);
    const vendors = await Promise.all(
      devices.slice(0, 512).map((d) =>
        readFile(`/sys/bus/pci/devices/${d}/vendor`, 'utf8')
          .then((v) => v.trim())
          .catch(() => undefined),
      ),
    );
    if (vendors.some((v) => v === '0x10de')) presence = true;
    else if (
      devices.length > 0 &&
      devices.length <= 512 &&
      vendors.every((v) => /^0x[\da-f]{4}$/i.test(v || ''))
    )
      presence = false;
  } else if (process.platform === 'win32') {
    const data = await powershell('hardware', abort).catch(() => undefined);
    const gpus = data?.GPU;
    if (
      Array.isArray(gpus) &&
      gpus.length > 0 &&
      gpus.every((g: any) => typeof g.Name === 'string' && g.Name.length)
    )
      presence = gpus.some(
        (g: any) => /nvidia/i.test(g.Name) || /VEN_10DE/i.test(String(g.PNPDeviceID)),
      );
  }
  if (presence === false)
    return [
      unavailable(
        'nvidia:hardware',
        'gpu',
        'NVIDIA management telemetry',
        'Platform hardware inventory',
        'The readable hardware inventory contains no NVIDIA device. OS graphics and supported AMD evidence are checked separately.',
        'not-applicable',
      ),
    ];

  const candidates =
    process.platform === 'win32'
      ? [
          path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe'),
          path.join(
            process.env.ProgramFiles || 'C:\\Program Files',
            'NVIDIA Corporation',
            'NVSMI',
            'nvidia-smi.exe',
          ),
        ]
      : ['/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi'];
  for (const file of candidates) {
    try {
      await access(file);
    } catch {
      continue;
    }
    const detailed = async () => {
      const output = await run(
        file,
        [
          '--query-gpu=uuid,name,ecc.errors.corrected.volatile.total,ecc.errors.uncorrected.volatile.total,retired_pages.pending,retired_pages.double_bit.count',
          '--format=csv,noheader,nounits',
        ],
        abort,
      );
      return parseNvidia(output, sessionEpoch);
    };
    const general = async () =>
      parseNvidiaTelemetry(
        await run(
          file,
          [
            '--query-gpu=uuid,name,temperature.gpu,utilization.gpu,memory.used,memory.total,fan.speed,power.draw',
            '--format=csv,noheader,nounits',
          ],
          abort,
        ),
      );
    // A failed ECC query must not hide ordinary GPU readings on consumer hardware.
    const results = await Promise.all(
      [detailed(), general()].map((p) =>
        p.catch(() => [
          unavailable(
            'nvidia:query',
            'gpu',
            'NVIDIA query coverage',
            'nvidia-smi',
            'This management query failed. Other supported GPU queries remain independent.',
          ),
        ]),
      ),
    );
    return results
      .flat()
      .map((s, i) => ({ ...s, id: hash(s.id === 'nvidia:query' ? s.id + i : s.id) }));
  }
  return [
    unavailable(
      'nvidia',
      'gpu',
      'NVIDIA ECC and page retirement',
      'nvidia-smi',
      'No NVIDIA management tool was found. NVIDIA telemetry requires its supported driver/tool; this does not establish a GPU fault. AMD Linux RAS and OS graphics status are collected separately.',
      'missing-tool',
    ),
  ];
}
export function storageSignals(components: Component[]): HealthSignal[] {
  const findings = diagnose(components);
  const out: HealthSignal[] = [];
  for (const [index, c] of components.entries()) {
    const identity = c.identity === 'stable' ? c.id : `session:${index}:${hash(c.name)}`;
    const matching = findings.filter((f) => f.componentId === c.id);
    const health = c.metrics.filter((m) =>
      [
        'smart_passed',
        'windows_health',
        'critical_warning',
        'endurance_used',
        'spare',
        'spare_threshold',
        'media_errors',
        'ata_pending',
        'ata_offline_uncorrectable',
        'ata_reallocated',
        'ata_crc_errors',
        'windows_read_uncorrected',
        'windows_write_uncorrected',
      ].includes(m.key),
    );
    const hasStatus = c.metrics.some(
      (m) =>
        (m.key === 'smart_passed' && m.value === 'Passed') ||
        (m.key === 'windows_health' && m.value === 'Healthy') ||
        (m.key === 'critical_warning' && m.value === 0),
    );
    out.push(
      signal(
        `drive:${identity}:status`,
        'storage',
        c.name,
        'Device / OS storage health',
        'Passive drive health read',
        matching.some((f) => f.severity === 'urgent')
          ? 'critical'
          : matching.length
            ? 'warning'
            : hasStatus
              ? 'clear'
              : 'unknown',
        matching.map((f) => f.title).join('; ') ||
          (hasStatus
            ? 'No warning in the returned health status.'
            : 'No supported device health status was exposed.'),
        matching.map((f) => f.action).join(' ') ||
          'Keep independent backups and compare later evidence. Review the full scan for coverage.',
        'Passing SMART or generic OS health cannot guarantee that a drive will not fail. RAID controllers and permissions can hide individual devices.',
        health.map((m) => ({ name: m.label, value: m.value, unit: m.unit })),
      ),
    );
    for (const key of [
      'media_errors',
      'ata_reallocated',
      'ata_crc_errors',
      'windows_read_uncorrected',
      'windows_write_uncorrected',
    ]) {
      const m = c.metrics.find((m) => m.key === key);
      if (!m) continue;
      const s = errorCounter(
        `drive:${identity}:${key}`,
        'storage',
        `${c.name} · ${m.label}`,
        m.source,
        count(m.value),
        c.identity === 'stable' ? identity : randomUUID(),
        key.includes('uncorrected'),
      );
      if (key === 'ata_crc_errors')
        s.limitation =
          'Interface CRC errors are a transport-path lead. A cable, controller or connection can contribute; they are not direct evidence of damaged media.';
      out.push(s);
    }
    if (!health.length) {
      out[out.length - 1].summary =
        c.checks
          .filter((k) => k.status !== 'available')
          .map((k) => k.detail)
          .join(' ') || 'No supported health fields.';
    }
  }
  return out.length
    ? out
    : [
        unavailable(
          'drives',
          'storage',
          'Physical drive health',
          'Platform storage collector',
          'No supported drives were returned.',
        ),
      ];
}
export async function driveHealth(abort: AbortSignal) {
  return storageSignals(
    process.platform === 'darwin'
      ? await macStorage(abort)
      : process.platform === 'linux'
        ? await linuxStorage(abort)
        : await windowsStorage(abort),
  );
}
export function batterySignals(components: Component[]): HealthSignal[] {
  const findings = diagnose(components);
  return components.map((c, i) => {
    const readings = c.metrics.filter((m) =>
      ['capacity_retention', 'cycles', 'condition'].includes(m.key),
    );
    const matching = findings.filter((f) => f.componentId === c.id);
    const hasNormalCondition = readings.some(
      (m) => m.key === 'condition' && /^(normal|good)$/i.test(String(m.value)),
    );
    return signal(
      `battery:${c.identity === 'stable' ? c.id : i}:condition`,
      'power',
      c.name,
      'Platform battery condition/capacity API',
      'Passive device-reported battery evidence',
      matching.some((f) => f.severity === 'urgent')
        ? 'critical'
        : matching.length
          ? 'warning'
          : hasNormalCondition
            ? 'clear'
            : 'unknown',
      matching.map((f) => f.title).join('; ') ||
        (readings.length
          ? 'Battery condition/capacity fields collected.'
          : 'No comparable battery condition fields were exposed.'),
      matching.map((f) => f.action).join(' ') ||
        'Compare recurring charging symptoms and capacity evidence; inspect physical safety before testing.',
      'Device-reported condition and capacity cannot detect swelling, leakage or certify battery safety. Charging percentage alone is not wear. Multi-battery mapping may be ambiguous.',
      readings.map((m) => ({ name: m.label, value: m.value, unit: m.unit })),
    );
  });
}
export async function batteryHealth(abort: AbortSignal): Promise<HealthSignal[]> {
  const components =
    process.platform === 'darwin'
      ? parseMacBattery(await profiler(['SPPowerDataType'], abort))
      : process.platform === 'linux'
        ? await linuxBatteries()
        : parseWindowsBattery(await powershell('battery', abort));
  const result = batterySignals(components);
  return result.length
    ? result
    : [
        unavailable(
          'battery:visibility',
          'power',
          'Battery condition visibility',
          'Platform battery API',
          'No OS-visible battery condition was returned. A desktop may have no battery; missing battery evidence does not establish the condition of a UPS or power supply.',
        ),
      ];
}
// Static PowerShell only; renderer input never forms a command or a unit name.
export const RELIABILITY_WINDOWS_SCRIPT = `$ErrorActionPreference='Stop'; $r=[ordered]@{}; try {$r.Volumes=@(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace)} catch {$r.VolumeError=$true}; try {$r.Network=@(Get-NetAdapterStatistics | Select-Object Name,ReceivedPacketErrors,OutboundPacketErrors,ReceivedDiscardedPackets,OutboundDiscardedPackets)} catch {$r.NetworkError=$true}; try {$r.Services=@(Get-CimInstance Win32_Service | Where-Object {$_.StartMode -eq 'Auto' -and $_.State -eq 'Stopped'} | Select-Object -First 64 Name); $r.ServicesCapped=($r.Services.Count -ge 64)} catch {$r.ServiceError=$true}; try {$r.Boot=(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToString('o')} catch {}; [pscustomobject]$r | ConvertTo-Json -Depth 4 -Compress`;
export function parseWindowsReliability(data: Record<string, any>): HealthSignal[] {
  const out: HealthSignal[] = [];
  const epoch = typeof data.Boot === 'string' ? data.Boot : sessionEpoch;
  if (Array.isArray(data.Volumes) && data.Volumes.length) {
    for (const v of data.Volumes.slice(0, 32))
      out.push(
        filesystemSignal(
          `fs:${hash(String(v.DeviceID))}`,
          String(v.DeviceID),
          count(v.Size) ?? NaN,
          count(v.FreeSpace) ?? NaN,
          1,
          0,
          0,
        ),
      );
  } else
    out.push(
      unavailable(
        'filesystems',
        'filesystem',
        'Local disk capacity',
        'Win32_LogicalDisk',
        'Fixed-volume capacity could not be read.',
      ),
    );
  if (Array.isArray(data.Network) && data.Network.length) {
    for (const n of data.Network.slice(0, 32)) {
      for (const key of [
        'ReceivedPacketErrors',
        'OutboundPacketErrors',
        'ReceivedDiscardedPackets',
        'OutboundDiscardedPackets',
      ]) {
        const s = errorCounter(
          `nic:${hash(String(n.Name))}:${key}`,
          'network',
          `${String(n.Name)} · ${key}`,
          'Get-NetAdapterStatistics',
          count(n[key]),
          epoch,
          false,
          key.includes('Discarded') ? 'discards' : 'errors',
        );
        s.limitation =
          'Packet errors or discards do not isolate a failed adapter. Filtering, driver state, load and the link partner can contribute.';
        out.push(s);
      }
    }
  } else
    out.push(
      unavailable(
        'network',
        'network',
        'Network adapter counters',
        'Get-NetAdapterStatistics',
        'Adapter statistics could not be read.',
      ),
    );
  if (Array.isArray(data.Services))
    out.push(
      signal(
        'services',
        'services',
        'Stopped automatic services',
        'Win32_Service',
        'Automatic-start services (up to 64)',
        'unknown',
        `${data.Services.length}${data.ServicesCapped ? '+' : ''} automatic-start services are stopped. Intent has not been established.`,
        'Review service triggers, dependencies and intended state with the service owner before any restart.',
        'Stopped automatic services may be intentional or trigger-started; no fault is inferred.',
        [
          { name: 'Stopped automatic services', value: data.Services.length },
          ...data.Services.slice(0, 64).map((s: any) => ({
            name: 'Stopped automatic service',
            value: String(s.Name),
          })),
        ],
      ),
    );
  else
    out.push(
      unavailable(
        'services',
        'services',
        'Service state',
        'Win32_Service',
        'Service inventory could not be read.',
      ),
    );
  return out;
}
export async function windowsReliability(abort: AbortSignal) {
  const file = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return parseWindowsReliability(
    JSON.parse(
      await run(
        file,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${RELIABILITY_WINDOWS_SCRIPT}`,
        ],
        abort,
      ),
    ),
  );
}

export function parseMacNetwork(output: string, epoch: string): HealthSignal[] {
  const lines = output.trim().split('\n');
  const expected = [
    'Name',
    'Mtu',
    'Network',
    'Address',
    'Ipkts',
    'Ierrs',
    'Ibytes',
    'Opkts',
    'Oerrs',
    'Obytes',
    'Coll',
    'Drop',
  ];
  if (lines[0]?.trim().split(/\s+/).join('|') !== expected.join('|'))
    return [
      unavailable(
        'network',
        'network',
        'Network counters',
        'netstat',
        'Unrecognized interface statistics layout.',
      ),
    ];
  const out: HealthSignal[] = [];
  for (const line of lines.slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (!/^en\d+\*?$/.test(fields[0]) || !/^<Link#\d+>$/.test(fields[2])) continue;
    const values = fields.slice(-8).map(count);
    const name = fields[0].replace(/\*$/, '');
    if (values.some((v) => v === undefined)) {
      out.push(
        unavailable(`nic:${name}`, 'network', name, 'netstat', 'Unusable interface statistics.'),
      );
      continue;
    }
    for (const [key, index] of [
      ['receive errors', 1],
      ['transmit errors', 4],
      ['drops', 7],
    ] as const) {
      const s = errorCounter(
        `nic:${name}:${key}`,
        'network',
        `${name} · ${key}`,
        'macOS netstat interface statistics',
        values[index],
        epoch,
        false,
        key === 'drops' ? 'discards' : 'errors',
      );
      s.limitation =
        'Interface errors or drops do not identify a failed network card. Load, filtering, drivers and the link partner can contribute. No IP or hardware addresses are retained.';
      out.push(s);
    }
  }
  return out.length
    ? out
    : [
        unavailable(
          'network',
          'network',
          'Network counters',
          'netstat',
          'No supported en interface statistics were returned.',
        ),
      ];
}
export async function macNetwork(abort: AbortSignal) {
  return parseMacNetwork(await run('/usr/sbin/netstat', ['-ibdn'], abort), sessionEpoch);
}
