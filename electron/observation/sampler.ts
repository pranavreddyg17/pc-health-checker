import os from 'node:os';
import path from 'node:path';
import { readFile, readdir, statfs } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { run } from '../collectors/common';
import {
  parseAvailableMemory,
  parseLinuxVm,
  parseProcesses,
  parsePsi,
  parseVmStat,
  parseWindowsObservation,
  processDeltas,
  counterRate,
  type Counters,
  type ProcessReading,
} from './parsers';
import {
  INVESTIGATION_RULE_VERSION,
  type Observation,
  type ObservationInput,
  type PowerContext,
  type ResourceSample,
} from '../../src/shared/investigations';
import type { Platform } from '../../src/shared/types';

export function cpuReadings() {
  return os
    .cpus()
    .map((c) => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
}
export function cpuDelta(
  previous: ReturnType<typeof cpuReadings>,
  current: ReturnType<typeof cpuReadings>,
) {
  if (previous.length !== current.length || !previous.length) return {};
  const values = current.map((c, i) => {
    const total = c.total - previous[i].total,
      idle = c.idle - previous[i].idle;
    return total > 0 && idle >= 0 && idle <= total ? (1 - idle / total) * 100 : undefined;
  });
  if (values.some((x) => x === undefined)) return {};
  const valid = values as number[];
  return {
    cpuPercent: valid.reduce((a, b) => a + b, 0) / valid.length,
    busiestCorePercent: Math.max(...valid),
  };
}
const read = (file: string) => readFile(file, 'utf8');
export async function observedPower(platform: string, signal: AbortSignal): Promise<PowerContext> {
  try {
    if (platform === 'darwin') {
      const text = await run('/usr/bin/pmset', ['-g', 'batt'], signal);
      return text.includes("Now drawing from 'AC Power'")
        ? 'plugged-in'
        : text.includes("Now drawing from 'Battery Power'")
          ? 'battery'
          : 'unknown';
    }
    if (platform === 'linux') {
      const names = (await readdir('/sys/class/power_supply')).slice(0, 20);
      let battery = false;
      for (const name of names) {
        const base = `/sys/class/power_supply/${name}`;
        const type = (await read(`${base}/type`)).trim();
        if (type === 'Battery') battery = true;
        if (
          ['Mains', 'USB', 'USB_C', 'USB_PD'].includes(type) &&
          (await read(`${base}/online`).catch(() => '')).trim() === '1'
        )
          return 'plugged-in';
      }
      return battery ? 'battery' : 'unknown';
    }
  } catch {
    /* A missing power source stays unknown. */
  }
  return 'unknown';
}
export function createObservation(input: ObservationInput): Observation {
  return {
    id: randomUUID(),
    startedAt: new Date().toISOString(),
    durationSeconds: input.durationSeconds,
    elapsedMs: 0,
    platform: os.platform() as Platform,
    ruleVersion: INVESTIGATION_RULE_VERSION,
    state: 'recording',
    power: input.power,
    observedPower: [],
    includeApps: input.includeApps,
    action: input.action,
    samples: [],
    markers: [],
    coverage: [],
    system: { logicalCores: os.cpus().length, memoryMB: Math.round(os.totalmem() / 1024 ** 2) },
    outcome: 'not-recorded',
  };
}
export class ResourceReader {
  private counters?: Counters;
  private processes: ProcessReading[] = [];
  private lastAt?: number;
  private powerAt = -Infinity;
  private power: PowerContext = 'unknown';
  readonly notes = new Set<string>([
    'Resource use is an observation of this workload, not a test of hardware integrity. PC Health and its collectors also consume resources.',
    'Temperature, throttle states, GPU demand, and detailed drive latency are not collected in this recording. Use the hardware scan and relevant guided tests separately.',
  ]);
  constructor(
    private platform: string,
    private includeApps: boolean,
  ) {}
  async sample(
    signal: AbortSignal,
    atMs: number,
  ): Promise<{ sample: ResourceSample; power: PowerContext }> {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(2500)]);
    const sample: ResourceSample = { atMs };
    const seconds = this.lastAt === undefined ? 0 : (atMs - this.lastAt) / 1000;
    let counters: Counters | undefined;
    if (this.platform === 'darwin') {
      const [vm, ps] = await Promise.allSettled([
        run('/usr/bin/vm_stat', [], bounded),
        this.includeApps
          ? run('/bin/ps', ['-axo', 'pid=,time=,rss=,comm='], bounded)
          : Promise.resolve(''),
      ]);
      if (vm.status === 'fulfilled') {
        try {
          counters = parseVmStat(vm.value);
        } catch {
          this.notes.add('macOS swap-out counters were unavailable for some samples.');
        }
      } else this.notes.add('macOS swap-out counters were unavailable for some samples.');
      if (this.includeApps && ps.status === 'fulfilled') {
        const current = parseProcesses(ps.value);
        sample.apps = processDeltas(this.processes, current, seconds, os.cpus().length);
        this.processes = current;
      } else {
        this.processes = [];
        if (this.includeApps) this.notes.add('App attribution was unavailable for some samples.');
      }
      this.notes.add(
        'macOS: swap-out counter changes are sampled; this is not Apple’s Memory Pressure indicator. Available-memory and storage-wait counters are not collected here.',
      );
    } else if (this.platform === 'linux') {
      const results = await Promise.allSettled([
        read('/proc/vmstat'),
        read('/proc/pressure/memory'),
        read('/proc/pressure/io'),
        read('/proc/meminfo'),
        this.includeApps
          ? run('/bin/ps', ['-axo', 'pid=,time=,rss=,comm='], bounded)
          : Promise.resolve(''),
      ]);
      counters = {};
      if (results[0].status === 'fulfilled') {
        try {
          Object.assign(counters, parseLinuxVm(results[0].value));
        } catch {
          this.notes.add('Linux swap counters were unavailable.');
        }
      }
      if (results[1].status === 'fulfilled') counters.memoryWait = parsePsi(results[1].value);
      if (results[2].status === 'fulfilled') counters.ioWait = parsePsi(results[2].value);
      if (results[3].status === 'fulfilled')
        sample.availableMemoryMB = parseAvailableMemory(results[3].value);
      if (this.includeApps && results[4].status === 'fulfilled') {
        const current = parseProcesses(results[4].value);
        sample.apps = processDeltas(this.processes, current, seconds, os.cpus().length);
        this.processes = current;
      } else {
        this.processes = [];
        if (this.includeApps) this.notes.add('App attribution was unavailable for some samples.');
      }
      if (counters.memoryWait === undefined || counters.ioWait === undefined)
        this.notes.add('Linux pressure-stall information was unavailable for some or all samples.');
      this.notes.add(
        'Linux: memory and I/O waiting measure time when at least one task was stalled. These system-wide signals do not identify a faulty part.',
      );
    } else if (this.platform === 'win32') {
      const executable = path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      // Only the fixed optional process clause varies; no user text becomes PowerShell.
      const script =
        "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $m=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; $d=Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter \"Name='_Total'\" -ErrorAction SilentlyContinue; $b=@(Get-CimInstance -Namespace root/wmi -ClassName BatteryStatus -ErrorAction SilentlyContinue); [pscustomobject]@{Memory=$m | Select-Object AvailableMBytes,PagesOutputPersec;Disk=$d | Select-Object DiskBytesPersec;Cores=[Environment]::ProcessorCount;PowerOnline=if($b.Count -eq 1){$b[0].PowerOnline}else{$null};Processes=@(" +
        (this.includeApps
          ? "Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object {$_.Name -notin @('_Total','Idle')} | Sort-Object PercentProcessorTime -Descending | Select-Object -First 5 @{n='Name';e={$_.Name}},@{n='CPU';e={$_.PercentProcessorTime}},@{n='Memory';e={$_.WorkingSetPrivate}}"
          : '') +
        ')} | ConvertTo-Json -Depth 4 -Compress';
      try {
        const data = JSON.parse(
          await run(
            executable,
            ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
            bounded,
          ),
        );
        Object.assign(sample, parseWindowsObservation(data));
        this.power =
          data.PowerOnline === true
            ? 'plugged-in'
            : data.PowerOnline === false
              ? 'battery'
              : 'unknown';
      } catch {
        this.notes.add(
          'Windows memory, disk, or app counters were unavailable for some samples. CPU sampling remains independent.',
        );
      }
      this.notes.add(
        'Windows: formatted memory/paging and disk throughput counters are sampled every five seconds. Throughput alone does not establish a storage bottleneck. PowerShell collection contributes to observed CPU demand.',
      );
    }
    if (counters) {
      sample.pagingOutPerSec = counterRate(this.counters?.pagingOut, counters.pagingOut, seconds);
      const mem = counterRate(this.counters?.memoryWait, counters.memoryWait, seconds);
      const io = counterRate(this.counters?.ioWait, counters.ioWait, seconds);
      sample.memoryWaitPercent = mem !== undefined && mem <= 1e6 ? mem / 10000 : undefined;
      sample.ioWaitPercent = io !== undefined && io <= 1e6 ? io / 10000 : undefined;
    }
    this.counters = counters;
    this.lastAt = atMs;
    if (this.platform !== 'win32' && atMs - this.powerAt >= 10000) {
      this.power = await observedPower(this.platform, bounded);
      this.powerAt = atMs;
    }
    return { sample, power: this.power };
  }
}
export async function recordObservation(
  o: Observation,
  signal: AbortSignal,
  update: () => void,
  checkpoint: () => Promise<void>,
) {
  const reader = new ResourceReader(o.platform, o.includeApps);
  const deadline = AbortSignal.timeout(o.durationSeconds * 1000);
  const bounded = AbortSignal.any([signal, deadline]);
  const origin = performance.now();
  let before = cpuReadings(),
    last = 0,
    checkpointAt = 0,
    wall = Date.now();
  const interval = o.platform === 'win32' ? 5000 : 2000;
  try {
    try {
      const fs = await Promise.race([
        statfs(os.homedir()),
        delay(2000, undefined, { signal: bounded }),
      ]);
      if (fs && fs.blocks > 0)
        o.freeSpacePercent = Math.max(0, Math.min(100, (fs.bavail / fs.blocks) * 100));
      else reader.notes.add('Free space on the home volume was unavailable.');
    } catch {
      reader.notes.add('Free space on the home volume was unavailable.');
    }
    while (!bounded.aborted && performance.now() - origin < o.durationSeconds * 1000) {
      const tick = performance.now();
      if (Date.now() - wall > 15000) {
        o.state = 'suspended';
        break;
      }
      const result = await reader.sample(bounded, tick - origin);
      if (bounded.aborted) break;
      const current = cpuReadings();
      if (last > 0) Object.assign(result.sample, cpuDelta(before, current));
      before = current;
      last = tick;
      wall = Date.now();
      o.elapsedMs = Math.round(performance.now() - origin);
      result.sample.atMs = o.elapsedMs;
      o.samples.push(result.sample);
      if (!o.observedPower.includes(result.power)) o.observedPower.push(result.power);
      o.coverage = [...reader.notes];
      update();
      if (o.elapsedMs - checkpointAt >= 10000) {
        await checkpoint();
        checkpointAt = o.elapsedMs;
      }
      await delay(
        Math.max(
          1,
          Math.min(interval - (performance.now() - tick), o.durationSeconds * 1000 - o.elapsedMs),
        ),
        undefined,
        { signal: bounded },
      );
    }
    if (o.state === 'recording') o.state = signal.aborted ? 'stopped' : 'complete';
  } catch {
    if (o.state === 'recording')
      o.state = signal.aborted ? 'stopped' : deadline.aborted ? 'complete' : 'error';
    if (!signal.aborted && !deadline.aborted)
      reader.notes.add(
        'Recording ended because a collector or local checkpoint could not complete. Completed evidence is preserved where possible.',
      );
  } finally {
    o.elapsedMs = Math.min(o.durationSeconds * 1000, Math.round(performance.now() - origin));
    o.completedAt = new Date().toISOString();
    o.coverage = [...reader.notes];
    update();
  }
}
