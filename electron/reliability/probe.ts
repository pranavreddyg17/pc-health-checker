import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  RELIABILITY_VERSION,
  type HealthCategory,
  type HealthSignal,
  type HealthSnapshot,
} from '../../src/shared/reliability';
import { unavailable, signal, errorCounter, count } from './signals';
import {
  linuxEcc,
  linuxFilesystems,
  linuxNetwork,
  linuxRaid,
  linuxServices,
  linuxThermals,
  optionalZfs,
  linuxMemoryPressure,
  linuxAmdRas,
} from './linux';
import {
  batteryHealth,
  driveHealth,
  macFilesystems,
  macNetwork,
  nvidia,
  windowsReliability,
} from './platform';
import { windowsStability, macStability } from '../collectors/stability';
import { macNative, macServices } from './macos';
import { windowsOperational } from './windows';
const epochFallback = process.env.PCHEALTH_OBSERVATION_EPOCH || randomUUID();
export async function probeHealth(abort: AbortSignal): Promise<HealthSnapshot> {
  const start = Date.now();
  const platform = process.platform;
  if (!['darwin', 'linux', 'win32'].includes(platform))
    throw Error('This OS adapter is not implemented.');
  const epoch =
    platform === 'linux'
      ? await readFile('/proc/sys/kernel/random/boot_id', 'utf8')
          .then((s) => s.trim())
          .catch(() => epochFallback)
      : epochFallback;
  const jobs: {
    id: string;
    category: HealthCategory;
    label: string;
    run: (s: AbortSignal) => Promise<HealthSignal[]>;
  }[] = [
    { id: 'drives', category: 'storage', label: 'Physical drive health', run: driveHealth },
    {
      id: 'battery',
      category: 'power',
      label: 'Battery condition and capacity',
      run: batteryHealth,
    },
    ...(platform !== 'darwin'
      ? [{ id: 'nvidia', category: 'gpu' as const, label: 'NVIDIA reliability', run: nvidia }]
      : []),
  ];
  const initial: HealthSignal[] = [];
  if (platform === 'linux')
    jobs.push(
      {
        id: 'memory:resources',
        category: 'memory',
        label: 'Memory pressure and OOM counters',
        run: (s) => linuxMemoryPressure(epoch, s),
      },
      { id: 'gpu:amd', category: 'gpu', label: 'AMD GPU RAS', run: (s) => linuxAmdRas(epoch, s) },
      {
        id: 'filesystems',
        category: 'filesystem',
        label: 'Filesystem capacity',
        run: linuxFilesystems,
      },
      {
        id: 'edac',
        category: 'memory',
        label: 'ECC memory counters',
        run: (s) => linuxEcc(epoch, s),
      },
      { id: 'thermal', category: 'thermal', label: 'Thermal and fan alarms', run: linuxThermals },
      { id: 'md', category: 'storage', label: 'Software RAID health', run: linuxRaid },
      { id: 'zfs', category: 'storage', label: 'ZFS pools', run: optionalZfs },
      {
        id: 'network',
        category: 'network',
        label: 'Network error counters',
        run: (s) => linuxNetwork(epoch, s),
      },
      { id: 'services', category: 'services', label: 'Failed services', run: linuxServices },
    );
  if (platform === 'darwin') {
    jobs.push(
      {
        id: 'filesystems',
        category: 'filesystem',
        label: 'Data-volume capacity',
        run: macFilesystems,
      },
      { id: 'network', category: 'network', label: 'Network error counters', run: macNetwork },
    );
    jobs.push({
      id: 'panic',
      category: 'system',
      label: 'Kernel panic evidence',
      run: async (s) => {
        const c = (await macStability(s))[0],
          m = c.metrics.find((m) => m.key === 'panic_report_count');
        const n = count(m?.value);
        if (n === undefined)
          return [
            unavailable(
              'panic',
              'system',
              'Kernel panic report metadata',
              'macOS',
              'Panic report metadata unavailable.',
            ),
          ];
        return [
          signal(
            'panic',
            'system',
            'Kernel panic report metadata',
            'macOS diagnostic report metadata',
            'Report files modified in last seven days',
            n > 0 ? 'warning' : 'clear',
            `${n} recent panic-related report files.`,
            'Review the incident trigger and OEM diagnostics before choosing a component.',
            'Panic metadata does not classify ECC, CPU failure or software causes. Raw report contents are not read.',
            [{ name: 'Recent report files', value: n }],
          ),
        ];
      },
    });
    jobs.push(
      {
        id: 'mac-native',
        category: 'thermal',
        label: 'Native thermal, memory and graphics telemetry',
        run: macNative,
      },
      {
        id: 'services:launchd',
        category: 'services',
        label: 'Visible service exit results',
        run: macServices,
      },
    );
    initial.push(
      unavailable(
        'edac',
        'memory',
        'Direct ECC error counters',
        'macOS platform capability',
        'macOS does not expose generic ECC correction counters. Memory pressure and retained panic evidence are checked separately. Use Apple/OEM offline diagnostics to test physical memory; a pressure sample cannot replace an integrity test.',
      ),
    );
  }
  if (platform === 'win32') {
    jobs.push({
      id: 'windows',
      category: 'filesystem',
      label: 'Windows operational checks',
      run: windowsReliability,
    });
    jobs.push({
      id: 'whea',
      category: 'system',
      label: 'Windows hardware error events',
      run: async (s) => {
        const c = (await windowsStability(s))[0],
          n = count(c.metrics.find((m) => m.key === 'whea_event_count')?.value);
        if (n === undefined)
          return [
            unavailable(
              'whea',
              'system',
              'Hardware error events',
              'WHEA-Logger',
              'The retained event count is unreadable.',
            ),
          ];
        return [
          signal(
            'whea',
            'system',
            'Hardware error events',
            'WHEA-Logger',
            'Retained WHEA events in last seven days',
            n > 0 ? 'warning' : 'clear',
            `${n} hardware-error events in the retained window.`,
            'Review event severity, affected device and recurrence in Event Viewer before approving service.',
            'This window count is not a monotonic ECC counter. Corrected and uncorrected events are not classified by this adapter.',
            [{ name: 'WHEA events', value: n }],
          ),
        ];
      },
    });
    jobs.push({
      id: 'windows-operational',
      category: 'thermal',
      label: 'Thermal, memory and graphics operational evidence',
      run: windowsOperational,
    });
  }
  // Independent fixed probes run concurrently inside a disposable worker process.
  // The outer process watchdog kills this worker if a filesystem call or child hangs.
  const results = await Promise.all(
    jobs.map(async (j) => {
      const timeout = AbortSignal.timeout(20000);
      const s = AbortSignal.any([abort, timeout]);
      try {
        return await j.run(s);
      } catch {
        return [
          unavailable(
            j.id,
            j.category,
            j.label,
            'Platform collector',
            s.aborted
              ? 'Collection was cancelled or reached its deadline.'
              : 'The probe could not read its source. The tool, driver, permissions or output format may be unsupported.',
            'error',
          ),
        ];
      }
    }),
  );
  const signals = [...initial, ...results.flat()];
  if (signals.length > 767)
    signals.splice(
      767,
      signals.length - 767,
      unavailable(
        'collection-limit',
        'services',
        'Collection limit',
        'PC Health',
        'More than 767 signals were returned. This preview has bounded coverage; use specialized management for larger hosts.',
      ),
    );
  return {
    schemaVersion: 1,
    id: randomUUID(),
    at: new Date().toISOString(),
    platform,
    ruleVersion: RELIABILITY_VERSION,
    elapsedMs: Date.now() - start,
    signals,
  };
}
