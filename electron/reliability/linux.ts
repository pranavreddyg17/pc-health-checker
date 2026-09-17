import { readFile, readdir, realpath, statfs } from 'node:fs/promises';
import path from 'node:path';
import type { HealthSignal } from '../../src/shared/reliability';
import { hash, run } from '../collectors/common';
import {
  count,
  errorCounter,
  filesystemSignal,
  raidSignal,
  signal,
  thermalSignal,
  unavailable,
  parseZpool,
} from './signals';
const read = async (p: string) => {
  try {
    return (await readFile(p, 'utf8')).trim();
  } catch {
    return undefined;
  }
};
const list = async (p: string) => {
  try {
    return await readdir(p);
  } catch {
    return [];
  }
};
const validName = (name: string) => /^[a-zA-Z0-9_.:-]{1,100}$/.test(name);
export function parseMounts(
  text: string,
): { mount: string; device: string; type: string; readonly: boolean }[] {
  const seen = new Set<string>();
  const result: { mount: string; device: string; type: string; readonly: boolean }[] = [];
  for (const line of text.trim().split('\n')) {
    const [left, right] = line.split(' - ');
    if (!right) continue;
    const p = left.split(' '),
      r = right.split(' ');
    if (
      p.length < 6 ||
      !['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'overlay'].includes(r[0])
    )
      continue;
    const mount = p[4].replace(/\\(040|011|012|134)/g, (_, n) =>
      String.fromCharCode(parseInt(n, 8)),
    );
    if (!mount.startsWith('/') || seen.has(p[2]) || mount.length > 1000) continue;
    seen.add(p[2]);
    result.push({ mount, device: p[2], type: r[0], readonly: p[5].split(',').includes('ro') });
  }
  return result.slice(0, 32);
}
export async function linuxFilesystems(abort: AbortSignal): Promise<HealthSignal[]> {
  const text = await readFile('/proc/self/mountinfo', 'utf8');
  const mounts = parseMounts(text);
  const out: HealthSignal[] = [];
  for (const m of mounts) {
    abort.throwIfAborted();
    const key = `fs:${hash(m.device + ':' + m.mount)}`;
    if (m.readonly) {
      out.push(
        signal(
          key,
          'filesystem',
          m.mount,
          'Linux mount table',
          'Local mounted filesystem',
          'unknown',
          'This filesystem is mounted read-only; write-capacity checks do not apply.',
          'If this is unexpected, review kernel filesystem errors before any remount or repair.',
          'Some systems intentionally use read-only mounts. No failure is inferred from this state alone.',
        ),
      );
      continue;
    }
    try {
      const s = await statfs(m.mount);
      out.push(filesystemSignal(key, m.mount, s.blocks, s.bavail, s.bsize, s.files, s.ffree));
    } catch {
      out.push(
        unavailable(
          key,
          'filesystem',
          m.mount,
          'statfs',
          'Filesystem statistics could not be read.',
        ),
      );
    }
  }
  return out.length
    ? out
    : [
        unavailable(
          'filesystems',
          'filesystem',
          'Local filesystem capacity',
          'Linux mount table',
          'No supported writable local filesystems were found. Network mounts and unsupported filesystems are outside this check.',
        ),
      ];
}
export async function linuxEcc(epoch: string, abort: AbortSignal): Promise<HealthSignal[]> {
  const base = '/sys/devices/system/edac/mc';
  const controllers = (await list(base)).filter((n) => /^mc\d+$/.test(n)).slice(0, 32);
  const out: HealthSignal[] = [];
  for (const c of controllers) {
    abort.throwIfAborted();
    const root = path.join(base, c),
      label = (await read(root + '/mc_name')) || c;
    const reset = await read(root + '/seconds_since_reset');
    for (const [file, uncorrected] of [
      ['ce_count', false],
      ['ue_count', true],
    ] as const) {
      const s = errorCounter(
        `edac:${c}:${file}`,
        'memory',
        `${label} · ${uncorrected ? 'uncorrected' : 'corrected'} ECC`,
        'Linux EDAC memory-controller counters',
        count(await read(root + '/' + file)),
        epoch,
        uncorrected,
      );
      if (count(reset) !== undefined)
        s.measurements.push({ name: 'Seconds since driver reset', value: count(reset)! });
      out.push(s);
    }
  }
  return out.length
    ? out
    : [
        unavailable(
          'edac',
          'memory',
          'ECC memory errors',
          'Linux EDAC',
          'No readable EDAC memory-controller counters. This may mean unsupported hardware, an unloaded driver, restricted access or non-ECC memory.',
        ),
      ];
}
export function parseAmdRas(text: string, id: string, epoch: string): HealthSignal[] {
  const rows = text.trim().split('\n');
  const values = new Map<string, number>();
  for (const row of rows) {
    const m = row.match(/^(ce|ue):\s*(\d+)$/);
    const value = m ? count(m[2]) : undefined;
    if (!m || value === undefined || values.has(m[1]))
      return [
        unavailable(
          id,
          'gpu',
          'AMD RAS error counters',
          'AMDGPU sysfs RAS',
          'Malformed RAS counter data; no zero inferred.',
        ),
      ];
    values.set(m[1], value);
  }
  if (values.size !== 2)
    return [
      unavailable(
        id,
        'gpu',
        'AMD RAS error counters',
        'AMDGPU sysfs RAS',
        'Both corrected and uncorrected counters were not exposed.',
      ),
    ];
  return ['ce', 'ue'].map((key) =>
    errorCounter(
      `${id}:${key}`,
      'gpu',
      `AMD ${id.split(':').at(-1)} · ${key === 'ue' ? 'uncorrected' : 'corrected'} errors`,
      'AMDGPU sysfs RAS',
      values.get(key),
      epoch,
      key === 'ue',
    ),
  );
}
export async function linuxAmdRas(epoch: string, abort: AbortSignal): Promise<HealthSignal[]> {
  const out: HealthSignal[] = [];
  for (const card of (await list('/sys/class/drm'))
    .filter((n) => /^card\d+$/.test(n))
    .slice(0, 16)) {
    abort.throwIfAborted();
    const root = `/sys/class/drm/${card}/device`;
    if ((await read(root + '/vendor')) !== '0x1002') continue;
    const device = await realpath(root).catch(() => root);
    const files = (await list(root + '/ras'))
      .filter((n) => /^[a-z0-9_]+_err_count$/.test(n))
      .slice(0, 16);
    if (!files.length)
      out.push(
        unavailable(
          `amd:${hash(device)}`,
          'gpu',
          `${card} · AMD RAS support`,
          'AMDGPU sysfs',
          'The AMD device does not expose readable RAS counters. Consumer hardware and some driver configurations do not support this feature.',
        ),
      );
    for (const file of files)
      out.push(
        ...parseAmdRas(
          (await read(root + '/ras/' + file)) || '',
          `amd:${hash(device)}:${file.replace('_err_count', '')}`,
          epoch,
        ),
      );
  }
  return out;
}
export async function linuxMemoryPressure(
  epoch: string,
  abort: AbortSignal,
): Promise<HealthSignal[]> {
  abort.throwIfAborted();
  const text = await read('/proc/pressure/memory');
  const mem = await read('/proc/meminfo');
  const vmstat = await read('/proc/vmstat');
  return parseLinuxMemoryPressure(text, mem, vmstat, epoch);
}
export function parseLinuxMemoryPressure(
  text: string | undefined,
  mem: string | undefined,
  vmstat: string | undefined,
  epoch: string,
): HealthSignal[] {
  const metrics: HealthSignal['measurements'] = [];
  for (const mode of ['some', 'full']) {
    const row = text?.split('\n').find((line) => line.startsWith(mode + ' '));
    const m = row?.match(/avg10=(\d+(?:\.\d+)?)/);
    if (m && Number(m[1]) <= 100)
      metrics.push({
        name: `${mode} memory stall time (10s average)`,
        value: Number(m[1]),
        unit: '%',
      });
  }
  const available = mem?.match(/^MemAvailable:\s+(\d+) kB$/m);
  if (available && count(available[1]) !== undefined)
    metrics.push({
      name: 'Available memory',
      value: Math.round(Number(available[1]) / 1024),
      unit: 'MiB',
    });
  const oom = vmstat?.match(/^oom_kill\s+(\d+)$/m);
  const kills = oom ? count(oom[1]) : undefined;
  const out = [
    metrics.length
      ? signal(
          'memory:resources',
          'memory',
          'Memory resource pressure',
          'Linux PSI / proc memory counters',
          'Current memory resources and ten-second stall averages',
          'unknown',
          `${metrics.length} memory resource measurements collected.`,
          'Correlate repeated stalls with workload and a performance capture. Inspect application demand and container limits before considering hardware changes.',
          'Resource pressure is not a physical RAM fault. PSI may be absent on older kernels; missing values are not assumed zero.',
          metrics,
        )
      : unavailable(
          'memory:resources',
          'memory',
          'Memory resource pressure',
          'Linux procfs',
          'No readable pressure or available-memory counters.',
        ),
  ];
  if (kills !== undefined) {
    const s = signal(
      'memory:oom',
      'memory',
      'OS out-of-memory kills',
      '/proc/vmstat oom_kill',
      'Kernel cumulative out-of-memory kill count',
      kills > 0 ? 'warning' : 'clear',
      `${kills} OOM kills recorded since the kernel counter reset; their timing is not established.`,
      'Correlate new increases with workload, memory/container limits and kernel events. OOM kills do not imply a defective RAM module.',
      'A historical cumulative counter does not identify which process or cause was involved.',
      [{ name: 'Recorded OOM kills', value: kills }],
    );
    s.counter = { value: kills, epoch };
    out.push(s);
  }
  return out;
}
export async function linuxThermals(abort: AbortSignal): Promise<HealthSignal[]> {
  const base = '/sys/class/hwmon';
  const out: HealthSignal[] = [];
  for (const d of (await list(base)).filter((n) => /^hwmon\d+$/.test(n)).slice(0, 24)) {
    abort.throwIfAborted();
    const root = path.join(base, d),
      chip = (await read(root + '/name')) || d;
    const device = await realpath(root).catch(() => root);
    const files = await list(root);
    for (const file of files.filter((n) => /^temp\d+_input$/.test(n)).slice(0, 12)) {
      const sensor = file.replace('_input', ''),
        label = (await read(`${root}/${sensor}_label`)) || sensor;
      out.push(
        thermalSignal(
          `temp:${hash(device + sensor)}`,
          `${chip} / ${label}`,
          await read(`${root}/${file}`),
          await read(`${root}/${sensor}_crit`),
          await read(`${root}/${sensor}_crit_alarm`),
          await read(`${root}/${sensor}_fault`),
        ),
      );
    }
    for (const file of files
      .filter((n) =>
        /^(fan\d+_(alarm|min_alarm|fault)|in\d+_(alarm|crit_alarm)|power\d+_crit_alarm)$/.test(n),
      )
      .slice(0, 12)) {
      const n = count(await read(root + '/' + file));
      out.push(
        n === undefined || n > 1
          ? unavailable(
              `alarm:${hash(device + file)}`,
              'thermal',
              `${chip} / ${file}`,
              'Linux hwmon',
              'Alarm value is unreadable.',
            )
          : signal(
              `alarm:${hash(device + file)}`,
              'thermal',
              `${chip} / ${file}`,
              'Linux hwmon',
              'Hardware-reported alarm',
              n === 1 ? 'warning' : 'clear',
              n === 1
                ? 'The driver reports an alarm or sensor fault.'
                : 'The exposed alarm is not asserted.',
              'Inspect the sensor, fan or power channel using the exact model’s service procedure.',
              'A zero-RPM fan alone is not classified as failed; only an exposed alarm or fault is used here.',
              [{ name: 'Alarm state', value: n }],
            ),
      );
    }
  }
  return out.length
    ? out
    : [
        unavailable(
          'thermal',
          'thermal',
          'Thermal and fan alarms',
          'Linux hwmon',
          'No supported temperature or alarm channels were exposed.',
        ),
      ];
}
export async function linuxRaid(abort: AbortSignal): Promise<HealthSignal[]> {
  const out: HealthSignal[] = [];
  for (const d of (await list('/sys/block')).filter((n) => /^md\d+$/.test(n)).slice(0, 32)) {
    abort.throwIfAborted();
    const root = `/sys/block/${d}/md`;
    const s = raidSignal(
      `md:${d}`,
      `RAID ${d}`,
      await read(root + '/degraded'),
      (await read(root + '/array_state')) || '',
    );
    const sync = await read(root + '/sync_action');
    if (sync) s.measurements.push({ name: 'Sync action', value: sync });
    out.push(s);
  }
  if (!out.length)
    out.push(
      unavailable(
        'md',
        'storage',
        'Linux software RAID',
        'Linux MD sysfs',
        'No Linux MD arrays exposed. Hardware RAID and other storage layers are not covered.',
      ),
    );
  return out;
}
export async function optionalZfs(abort: AbortSignal): Promise<HealthSignal[]> {
  let executable: string | undefined;
  for (const p of ['/usr/sbin/zpool', '/sbin/zpool', '/usr/local/sbin/zpool']) {
    try {
      await realpath(p);
      executable = p;
      break;
    } catch {}
  }
  return executable
    ? parseZpool(await run(executable, ['list', '-H', '-o', 'name,health'], abort))
    : [
        unavailable(
          'zfs',
          'storage',
          'ZFS pool health',
          'zpool',
          'Optional ZFS tools are not installed. No pool integrity conclusion is available.',
        ),
      ];
}
export async function linuxNetwork(epoch: string, abort: AbortSignal): Promise<HealthSignal[]> {
  const out: HealthSignal[] = [];
  for (const d of (await list('/sys/class/net'))
    .filter((n) => n !== 'lo' && validName(n))
    .slice(0, 32)) {
    abort.throwIfAborted();
    const root = `/sys/class/net/${d}`;
    if (!(await realpath(root + '/device').catch(() => undefined))) continue;
    const index = (await read(root + '/ifindex')) || d;
    for (const file of ['rx_errors', 'tx_errors', 'rx_dropped', 'tx_dropped']) {
      const s = errorCounter(
        `nic:${index}:${d}:${file}`,
        'network',
        `${d} · ${file.replace('_', ' ')}`,
        'Linux network interface statistics',
        count(await read(`${root}/statistics/${file}`)),
        epoch,
        false,
        file.includes('dropped') ? 'discards' : 'errors',
      );
      s.limitation =
        'Errors can involve cable, optics, switch, driver or interface. Dropped packets can reflect filtering, queue pressure or unsupported protocols; they do not prove a failed NIC.';
      if (!file.includes('dropped'))
        s.action =
          'Compare deltas and switch/driver evidence. Check cable or optics through an approved maintenance action; do not disable the interface automatically.';
      out.push(s);
    }
  }
  return out.length
    ? out
    : [
        unavailable(
          'network',
          'network',
          'Physical network error counters',
          'Linux sysfs',
          'No readable physical device-backed network interfaces.',
        ),
      ];
}
export function parseFailedServices(output: string): HealthSignal[] {
  const lines = output
    .split('\n')
    .map((l) => l.replace(/^\s*●\s*/, '').trim())
    .filter(Boolean);
  if (lines.length && !lines.every((l) => /^\S+\.service\s+\S+\s+failed\s+\S+/.test(l)))
    return [
      unavailable(
        'services',
        'services',
        'Failed system services',
        'systemctl',
        'Unexpected service-list output; no clean state inferred.',
      ),
    ];
  const names = lines.slice(0, 64).map((l) => l.split(/\s+/)[0]);
  return [
    signal(
      'services',
      'services',
      'Failed system services',
      'systemctl --failed',
      'System service manager (up to 64 records)',
      names.length ? 'warning' : 'clear',
      names.length
        ? `${names.length} failed service units are reported.`
        : 'No failed service units were returned.',
      'Review each unit’s logs, dependencies and owner. Restart only after approval, with a rollback plan and a post-restart health check.',
      'A service can be running but unhealthy. Intentional stops, application health endpoints and user-session services are outside this check.',
      names.map((n) => ({ name: 'Failed unit', value: n })),
    ),
  ];
}
export async function linuxServices(abort: AbortSignal) {
  return parseFailedServices(
    await run(
      '/usr/bin/systemctl',
      ['list-units', '--type=service', '--state=failed', '--no-legend', '--no-pager', '--plain'],
      abort,
    ),
  );
}
