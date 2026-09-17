import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Component, ComponentKind, Platform, Progress, Scan } from '../src/shared/types';
import { diagnose, RULE_VERSION } from '../src/shared/diagnostics';
import { array, check, component, failure, metric } from './collectors/common';
import { macStorage, parseMacBattery, parseMacGraphics, profiler } from './collectors/macos';
import { parseWindowsBattery, windowsStorage, powershell } from './collectors/windows';
import { macNative, macServices } from './reliability/macos';
import { windowsOperational } from './reliability/windows';
import { attachOperationalSignals } from './collectors/operational';
import { linuxMemoryPressure, linuxAmdRas } from './reliability/linux';
import {
  linuxBatteries,
  linuxCooling,
  linuxStorage,
  linuxGraphics,
  optionalText,
} from './collectors/linux';
import { macStability, windowsStability, linuxStability } from './collectors/stability';
import { nvidia } from './reliability/platform';
import { APP_VERSION } from '../src/shared/version';

export async function scanComputer(
  signal: AbortSignal,
  progress: (value: Progress) => void,
): Promise<Scan> {
  const platform = os.platform();
  if (!['darwin', 'win32', 'linux'].includes(platform))
    throw new Error('This operating system is not supported.');
  const combined = AbortSignal.any([signal, AbortSignal.timeout(55_000)]);
  const startedAt = new Date().toISOString();
  const components: Component[] = [];
  let machine = 'This computer';
  const cpu = component(
    'cpu',
    os.cpus()[0]?.model.trim() || 'Processor',
    `${os.cpus().length} logical cores · ${os.arch()}`,
  );
  cpu.metrics.push(...metric('cores', 'Logical cores', os.cpus().length, 'Operating system'));
  cpu.checks.push(
    check(
      'inventory',
      'Processor identification',
      'available',
      'Processor and logical core count read from the operating system.',
      'Node.js os',
    ),
    check(
      'cpu-faults',
      'Processor fault diagnosis',
      'not-run',
      'No CPU integrity test was run. Recent system error evidence, when readable, appears under System stability and does not isolate a failed CPU. No wear percentage can be inferred from inventory.',
      'PC Health',
    ),
  );
  const memory = component(
    'memory',
    'System memory',
    `${Math.round(os.totalmem() / 1024 ** 3)} GB installed`,
  );
  memory.metrics.push(
    ...metric(
      'memory_capacity',
      'Installed capacity',
      Math.round(os.totalmem() / 1024 ** 3),
      'Operating system',
      ' GB',
    ),
  );
  memory.checks.push(
    check(
      'inventory',
      'Memory capacity',
      'available',
      'Total OS-visible physical memory.',
      'Node.js os',
    ),
    check(
      'memory-test',
      'Memory integrity test',
      'not-run',
      'An offline memory diagnostic is needed to assess memory integrity. A running inventory scan cannot verify every physical address.',
      'PC Health',
    ),
  );
  components.push(cpu, memory);
  const jobs: { label: string; kind: ComponentKind; run: () => Promise<Component[]> }[] = [];
  if (platform === 'darwin') {
    jobs.push(
      {
        label: 'Identifying your Mac',
        kind: 'system',
        run: async () => {
          const data = await profiler(['SPHardwareDataType', 'SPDisplaysDataType'], combined);
          const hardware = data.SPHardwareDataType?.[0];
          machine = hardware?.machine_name || hardware?.machine_model || 'Mac';
          if (hardware?.chip_type) cpu.name = hardware.chip_type;
          return parseMacGraphics(data);
        },
      },
      { label: 'Reading storage health', kind: 'storage', run: () => macStorage(combined) },
      {
        label: 'Checking battery information',
        kind: 'battery',
        run: async () => parseMacBattery(await profiler(['SPPowerDataType'], combined)),
      },
      {
        label: 'Checking recent stability reports',
        kind: 'system',
        run: () => macStability(combined),
      },
      {
        label: 'Reading thermal, memory and graphics telemetry',
        kind: 'cooling',
        run: async () => {
          attachOperationalSignals(components, await macNative(combined));
          return [];
        },
      },
      {
        label: 'Checking visible service exit results',
        kind: 'system',
        run: async () => {
          attachOperationalSignals(components, await macServices(combined));
          return [];
        },
      },
    );
  } else if (platform === 'win32') {
    jobs.push(
      {
        label: 'Identifying your PC',
        kind: 'system',
        run: async () => {
          const data = await powershell('hardware', combined);
          machine = data.Computer?.Model || 'Windows PC';
          return array<Record<string, any>>(data.GPU).map((gpu) => {
            const c = component('gpu', gpu.Name || 'Graphics processor', 'Graphics hardware');
            c.checks.push(
              check(
                'inventory',
                'Graphics identification',
                'available',
                'Read system graphics inventory.',
                'Win32_VideoController',
              ),
              check(
                'gpu-health',
                'Graphics fault diagnosis',
                'not-run',
                'No GPU/VRAM integrity test was run. OS status and retained driver recoveries are checked separately; use guided display checks and OEM diagnostics for persistent visual defects.',
                'PC Health',
              ),
            );
            return c;
          });
        },
      },
      {
        label: 'Reading storage health',
        kind: 'storage',
        run: () => windowsStorage(combined),
      },
      {
        label: 'Checking battery information',
        kind: 'battery',
        run: async () => parseWindowsBattery(await powershell('battery', combined)),
      },
      {
        label: 'Reading recent hardware-error events',
        kind: 'system',
        run: () => windowsStability(combined),
      },
      {
        label: 'Reading thermal zones, memory, drivers and service events',
        kind: 'cooling',
        run: async () => {
          attachOperationalSignals(components, await windowsOperational(combined));
          return [];
        },
      },
    );
  } else {
    jobs.push(
      {
        label: 'Identifying your computer',
        kind: 'system',
        run: async () => {
          machine = (await optionalText('/sys/class/dmi/id/product_name')) || 'Linux computer';
          return linuxGraphics();
        },
      },
      { label: 'Reading storage health', kind: 'storage', run: () => linuxStorage(combined) },
      { label: 'Checking battery information', kind: 'battery', run: () => linuxBatteries() },
      { label: 'Reading exposed sensors', kind: 'cooling', run: () => linuxCooling() },
      {
        label: 'Reading memory pressure and AMD GPU error counters',
        kind: 'memory',
        run: async () => {
          attachOperationalSignals(components, [
            ...(await linuxMemoryPressure('scan', combined)),
            ...(await linuxAmdRas('scan', combined)),
          ]);
          return [];
        },
      },
      {
        label: 'Reviewing recent kernel diagnostics',
        kind: 'system',
        run: () => linuxStability(combined),
      },
    );
  }
  if (platform !== 'darwin')
    jobs.push({
      label: 'Reading supported NVIDIA management telemetry',
      kind: 'gpu',
      run: async () => {
        if (components.some((c) => c.kind === 'gpu' && /nvidia/i.test(c.name)))
          attachOperationalSignals(components, await nvidia(combined));
        return [];
      },
    });
  for (let i = 0; i < jobs.length; i++) {
    if (combined.aborted) break;
    progress({ stage: jobs[i].label, completed: i, total: jobs.length });
    try {
      const results = await jobs[i].run();
      components.push(...results);
      if (!results.length && jobs[i].kind === 'storage') {
        const c = component('storage', 'Internal storage', 'No supported device data');
        c.checks.push(
          check(
            'storage',
            'Physical drive discovery',
            'unsupported',
            'No supported internal drive was returned. This does not establish that the computer has no storage.',
            'Platform collector',
          ),
        );
        components.push(c);
      }
    } catch (error) {
      components.push(failure(jobs[i].kind, jobs[i].label, error));
    }
  }
  for (const kind of ['storage', 'battery', 'gpu'] as const) {
    if (combined.aborted && !components.some((c) => c.kind === kind)) {
      const c = component(
        kind,
        `${kind[0].toUpperCase()}${kind.slice(1)}`,
        'Scan stopped before collection',
      );
      c.checks.push(
        check(
          'cancelled',
          'Component assessment',
          'not-run',
          'The scan stopped or reached its time limit before this check completed.',
          'PC Health',
        ),
      );
      components.push(c);
    }
  }
  if (!components.some((c) => c.kind === 'cooling')) {
    const cooling = component('cooling', 'Cooling & power', 'Additional checks');
    cooling.checks.push(
      check(
        'cooling',
        'Fans and thermal condition',
        'unsupported',
        'Supported fan/thermal readings are not available through this collector. Dust, paste condition, and PSU wear cannot be determined.',
        'PC Health',
      ),
    );
    components.push(cooling);
  }
  progress({ stage: 'Preparing your report', completed: jobs.length, total: jobs.length });
  return {
    schemaVersion: 1,
    id: randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    platform: platform as Platform,
    arch: os.arch(),
    osVersion: os.release(),
    machine,
    appVersion: APP_VERSION,
    ruleVersion: RULE_VERSION,
    state: combined.aborted ? 'cancelled' : 'complete',
    components,
    findings: diagnose(components),
  };
}
