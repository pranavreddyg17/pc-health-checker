import type { HealthCategory, HealthSignal, TelemetryState } from '../../src/shared/reliability';
export function signal(
  id: string,
  category: HealthCategory,
  label: string,
  source: string,
  scope: string,
  level: HealthSignal['level'],
  summary: string,
  action: string,
  limitation: string,
  measurements: HealthSignal['measurements'] = [],
): HealthSignal {
  return {
    id,
    category,
    label,
    source,
    scope,
    level,
    availability: level !== 'unknown' || measurements.length > 0 ? 'readable' : 'unsupported',
    summary,
    action,
    limitation,
    measurements,
    observedAt: new Date().toISOString(),
  };
}
export function unavailable(
  id: string,
  category: HealthCategory,
  label: string,
  source: string,
  detail: string,
  availability: TelemetryState = 'unsupported',
): HealthSignal {
  return {
    ...signal(
      id,
      category,
      label,
      source,
      'Collector capability',
      'unknown',
      detail,
      'Check platform support, installed vendor tools and read permissions. No access is elevated automatically.',
      'Unavailable telemetry does not establish healthy hardware.',
    ),
    availability,
  };
}
export const count = (v: unknown): number | undefined => {
  if (typeof v !== 'number' && typeof v !== 'string') return;
  if (typeof v === 'string' && !/^\d+$/.test(v.trim())) return;
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : undefined;
};
export const finite = (v: unknown): number | undefined => {
  if (typeof v !== 'number' && (typeof v !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(v.trim())))
    return;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
export function errorCounter(
  id: string,
  category: HealthCategory,
  label: string,
  source: string,
  value: number | undefined,
  epoch: string,
  uncorrected = false,
  kind: 'errors' | 'discards' = 'errors',
): HealthSignal {
  if (value === undefined)
    return unavailable(
      id,
      category,
      label,
      source,
      'This counter was not exposed or was not a safe nonnegative integer.',
    );
  const s = signal(
    id,
    category,
    label,
    source,
    'Cumulative since the source last reset',
    value > 0 ? (uncorrected ? 'critical' : 'warning') : 'clear',
    value > 0
      ? `${value} ${kind === 'discards' ? 'packet discards' : 'errors'} are recorded by this source. This does not establish when they happened.`
      : 'The exposed counter is zero at this observation.',
    uncorrected
      ? 'Protect affected workloads and data. Review vendor diagnostics and plan an approved maintenance or isolation action.'
      : 'Track changes and correlate with workload, kernel/driver events and vendor diagnostics before replacing a component.',
    'A cumulative count is not a failure probability. A reset, reboot, driver reload or missing sample can prevent comparison.',
    [{ name: kind === 'discards' ? 'Recorded packet discards' : 'Recorded errors', value }],
  );
  if (kind === 'discards')
    s.action =
      'Compare later counter changes with network symptoms, traffic and queue or filtering policy. Packet discards alone do not justify replacing the adapter.';
  s.counter = { value, epoch };
  return s;
}
export function filesystemSignal(
  id: string,
  label: string,
  blocks: number,
  bavail: number,
  bsize: number,
  files: number,
  ffree: number,
): HealthSignal {
  if (
    ![blocks, bavail, bsize].every(Number.isFinite) ||
    blocks <= 0 ||
    bsize <= 0 ||
    bavail < 0 ||
    bavail > blocks
  )
    return unavailable(
      id,
      'filesystem',
      label,
      'OS filesystem statistics',
      'Capacity statistics were not usable.',
    );
  const freePct = (bavail / blocks) * 100;
  const freeGiB = (bavail * bsize) / 1024 ** 3;
  const inode =
    Number.isFinite(files) && Number.isFinite(ffree) && files > 0 && ffree >= 0 && ffree <= files
      ? (ffree / files) * 100
      : undefined;
  const critical = freePct <= 1 || (inode !== undefined && inode <= 1);
  const warning = freePct <= 5 || (inode !== undefined && inode <= 5);
  const level = critical ? 'critical' : warning ? 'warning' : 'clear';
  return signal(
    id,
    'filesystem',
    label,
    'OS filesystem statistics',
    'Space available to the current user',
    level,
    `${freePct.toFixed(1)}% capacity available (${freeGiB.toFixed(2)} GiB).${inode === undefined ? ' Inode availability not reported.' : ` ${inode.toFixed(1)}% inodes available.`}`,
    'Review growth and retention policies. Move backed-up data or expand capacity through an approved change; do not delete unknown files.',
    'The 5% warning and 1% critical limits are conservative capacity policies, not hardware-failure predictions. Quotas, shared pools and snapshots can change usable space.',
    [
      { name: 'Available capacity', value: Math.round(freePct * 10) / 10, unit: '%' },
      { name: 'Available space', value: Math.round(freeGiB * 100) / 100, unit: 'GiB' },
      ...(inode === undefined
        ? []
        : [{ name: 'Available inodes', value: Math.round(inode * 10) / 10, unit: '%' }]),
    ],
  );
}
export function thermalSignal(
  id: string,
  label: string,
  input: unknown,
  critical: unknown,
  alarm: unknown,
  fault: unknown,
): HealthSignal {
  const temp = finite(input),
    crit = finite(critical),
    a = count(alarm),
    f = count(fault);
  if ((a !== undefined && a > 1) || (f !== undefined && f > 1))
    return unavailable(
      id,
      'thermal',
      label,
      'Linux hwmon',
      'Unrecognized sensor alarm or fault flag.',
    );
  if (f === 1)
    return signal(
      id,
      'thermal',
      label,
      'Linux hwmon',
      'Driver-reported sensor state',
      'warning',
      'The driver reports a sensor fault.',
      'Check the sensor and its driver; do not treat its temperature as trustworthy.',
      'A sensor fault does not identify the condition of the cooled component.',
    );
  if (temp === undefined || temp < -40000 || temp > 200000)
    return unavailable(
      id,
      'thermal',
      label,
      'Linux hwmon',
      'No plausible temperature was exposed.',
    );
  const limit = crit !== undefined && crit > 0 && crit < 200000 ? crit : undefined;
  const level =
    a === 1 || (limit !== undefined && temp >= limit)
      ? 'critical'
      : limit !== undefined
        ? 'clear'
        : 'unknown';
  return signal(
    id,
    'thermal',
    label,
    'Linux hwmon',
    'Driver-provided critical limit / alarm',
    level,
    `${(temp / 1000).toFixed(1)} °C.${limit === undefined ? ' No usable critical threshold.' : ` Critical threshold ${(limit / 1000).toFixed(1)} °C.`}${a === 1 ? ' Critical alarm asserted.' : ''}`,
    'If an alarm persists, reduce or drain workload through your maintenance policy and inspect cooling. Do not disable thermal protections.',
    'Thresholds come from the driver; configuration or sensor mapping can be wrong. A temperature alone does not measure wear.',
    [
      { name: 'Temperature', value: temp / 1000, unit: '°C' },
      ...(limit === undefined
        ? []
        : [{ name: 'Critical threshold', value: limit / 1000, unit: '°C' }]),
    ],
  );
}
export function raidSignal(
  id: string,
  label: string,
  degraded: unknown,
  state: string,
): HealthSignal {
  const n = count(degraded);
  if (n === undefined)
    return unavailable(
      id,
      'storage',
      label,
      'Linux MD sysfs',
      'The degraded-member count is unreadable.',
    );
  const unhealthy = n > 0;
  const inactive = ['inactive', 'clear', 'suspended'].includes(state);
  return signal(
    id,
    'storage',
    label,
    'Linux MD sysfs',
    'Kernel software RAID array',
    unhealthy
      ? 'critical'
      : inactive
        ? 'warning'
        : ['active', 'active-idle', 'clean', 'readonly', 'read-auto', 'write-pending'].includes(
              state,
            )
          ? 'clear'
          : 'unknown',
    `${n} missing or failed members; array state: ${state || 'not exposed'}.`,
    'Check backups and remaining redundancy. Identify the failed member and controller path before an approved replacement or rebuild. Do not start a rebuild automatically.',
    'This check covers Linux MD only. A zero degraded count does not verify data integrity, backups or hardware RAID.',
    [
      { name: 'Degraded members', value: n },
      { name: 'Array state', value: state || 'unknown' },
    ],
  );
}
export function parseZpool(output: string): HealthSignal[] {
  const rows = output.trim().split('\n').filter(Boolean);
  if (!rows.length)
    return [
      unavailable('zfs', 'storage', 'ZFS pools', 'zpool list', 'No ZFS pools were returned.'),
    ];
  return rows.slice(0, 32).map((line, i) => {
    const [name, health] = line.trim().split(/\s+/);
    const known = [
      'ONLINE',
      'DEGRADED',
      'FAULTED',
      'OFFLINE',
      'UNAVAIL',
      'REMOVED',
      'SUSPENDED',
    ].includes(health);
    if (!known)
      return unavailable(
        `zfs:${i}`,
        'storage',
        'ZFS pool',
        'zpool list',
        'Unrecognized pool health output.',
      );
    return signal(
      `zfs:${name}`,
      'storage',
      `ZFS pool ${name}`,
      'zpool list -H -o name,health',
      'Pool availability',
      health === 'ONLINE' ? 'clear' : health === 'DEGRADED' ? 'warning' : 'critical',
      `Pool health: ${health}.`,
      'Review zpool status, backups and redundancy before an approved repair. Schedule integrity verification according to your storage policy.',
      'ONLINE does not establish a recent successful scrub or rule out undetected data corruption.',
    );
  });
}
export function parseNvidia(output: string, epoch: string): HealthSignal[] {
  const rows = output.trim().split('\n').filter(Boolean);
  const out: HealthSignal[] = [];
  if (!rows.length)
    return [
      unavailable(
        'nvidia',
        'gpu',
        'NVIDIA reliability',
        'nvidia-smi',
        'No supported NVIDIA device returned.',
      ),
    ];
  for (const [index, line] of rows.slice(0, 32).entries()) {
    const p = line.split(',').map((s) => s.trim());
    if (p.length !== 6 || !/^GPU-[a-f\d-]+$/i.test(p[0])) {
      out.push(
        unavailable(
          `nvidia:${index}`,
          'gpu',
          'NVIDIA reliability',
          'nvidia-smi',
          'The expected GPU query fields were not readable.',
        ),
      );
      continue;
    }
    // UUID is used only as a local identity key; export replaces signal IDs.
    const [uuid, name, corrected, uncorrected, pending, retired] = p;
    out.push(
      errorCounter(
        `gpu:${uuid}:ce`,
        'gpu',
        `${name} · corrected ECC`,
        'NVIDIA volatile ECC counters',
        count(corrected),
        epoch,
      ),
      errorCounter(
        `gpu:${uuid}:ue`,
        'gpu',
        `${name} · uncorrected ECC`,
        'NVIDIA volatile ECC counters',
        count(uncorrected),
        epoch,
        true,
      ),
    );
    const r = count(retired);
    out.push(
      signal(
        `gpu:${uuid}:retirement`,
        'gpu',
        `${name} · page retirement`,
        'nvidia-smi',
        'Driver-reported retired pages',
        pending === 'Yes'
          ? 'critical'
          : r !== undefined && r > 0
            ? 'warning'
            : pending === 'No' && r === 0
              ? 'clear'
              : 'unknown',
        `Pending retirement: ${pending}. Retired double-bit pages: ${r ?? 'unavailable'}.`,
        'Review the vendor recovery guidance and running workloads before an approved maintenance action.',
        'Page retirement and ECC are supported only on some NVIDIA GPUs. No GPU reset is run.',
        r === undefined ? [] : [{ name: 'Retired pages (double-bit)', value: r }],
      ),
    );
  }
  return out;
}
export function parseNvidiaTelemetry(output: string): HealthSignal[] {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .slice(0, 32)
    .map((line, i) => {
      const p = line.split(',').map((s) => s.trim());
      if (p.length !== 8 || !/^GPU-[a-f\d-]+$/i.test(p[0]))
        return unavailable(
          `nvidia:telemetry:${i}`,
          'gpu',
          'NVIDIA operational telemetry',
          'nvidia-smi',
          'Unrecognized GPU telemetry layout.',
        );
      const metrics: HealthSignal['measurements'] = [];
      for (const [index, name, unit, max] of [
        [2, 'GPU temperature', '°C', 150],
        [3, 'GPU utilization', '%', 100],
        [4, 'Device memory used', 'MiB', 1000000],
        [5, 'Device memory total', 'MiB', 1000000],
        [6, 'Fan speed', '%', 100],
        [7, 'Power draw', 'W', 5000],
      ] as const) {
        const n = /^\d+(?:\.\d+)?$/.test(p[index]) ? finite(p[index]) : undefined;
        if (n !== undefined && n >= 0 && n <= max) metrics.push({ name, value: n, unit });
      }
      return metrics.length
        ? signal(
            `gpu:${p[0]}:telemetry`,
            'gpu',
            `${p[1]} · operational telemetry`,
            'NVIDIA management query',
            'Current driver-reported GPU readings',
            'unknown',
            `${metrics.length} GPU readings collected. No device-specific fault threshold is assumed.`,
            'Compare readings under the same workload and consult the exact vendor limits. Use the display test and retained driver-error evidence for symptom isolation.',
            'Utilization, temperature, power draw and idle fan speed alone do not establish GPU wear or failure. Unsupported fields remain absent.',
            metrics,
          )
        : unavailable(
            `gpu:${p[0]}:telemetry`,
            'gpu',
            p[1],
            'nvidia-smi',
            'No usable operational fields were exposed.',
          );
    });
}
