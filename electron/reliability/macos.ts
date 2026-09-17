import type { HealthSignal } from '../../src/shared/reliability';
import { hash, run } from '../collectors/common';
import { bundledToolCandidates, findTool } from '../collectors/tools';
import { count, signal, unavailable } from './signals';

export function parseMacNative(data: Record<string, any>): HealthSignal[] {
  if (data.schemaVersion !== 1) throw Error('Unknown native telemetry schema.');
  const out: HealthSignal[] = [];
  const states = ['nominal', 'fair', 'serious', 'critical'];
  const state = data.thermalState;
  out.push(
    states.includes(state)
      ? signal(
          'thermal:mac-state',
          'thermal',
          'System thermal pressure',
          'Apple ProcessInfo.thermalState',
          'OS-reported current system thermal state',
          state === 'critical' ? 'critical' : state === 'serious' ? 'warning' : 'clear',
          `System thermal state: ${state}.`,
          'For serious or critical pressure, save work, reduce workload and inspect ventilation. Review recurring pressure under the same workload.',
          'This is a system thermal-pressure state, not a CPU temperature, fan test or wear estimate.',
          [{ name: 'Thermal state', value: state }],
        )
      : unavailable(
          'thermal:mac-state',
          'thermal',
          'System thermal pressure',
          'Apple ProcessInfo',
          'The native API returned an unrecognized thermal state.',
        ),
  );
  const pressure = count(data.memoryPressure);
  out.push(
    [1, 2, 4].includes(pressure!)
      ? signal(
          'memory:pressure',
          'memory',
          'Memory pressure',
          'Apple kernel memory-pressure level',
          'Current OS memory resource pressure',
          pressure === 4 ? 'warning' : 'clear',
          `Memory pressure is ${pressure === 1 ? 'normal' : pressure === 2 ? 'elevated' : 'critical'}.`,
          'If pressure persists with slowdowns, inspect workload and run a performance capture before considering an upgrade.',
          'Resource pressure is not evidence of a defective RAM chip. Swap use alone is not a fault.',
          [
            { name: 'Pressure level', value: pressure! },
            ...(count(data.swapUsedBytes) === undefined
              ? []
              : [
                  {
                    name: 'Swap used',
                    value: Math.round(data.swapUsedBytes / 1024 ** 2),
                    unit: 'MiB',
                  },
                ]),
          ],
        )
      : unavailable(
          'memory:pressure',
          'memory',
          'Memory pressure',
          'Apple kernel',
          'The kernel did not expose a recognized memory-pressure level.',
        ),
  );
  if (Array.isArray(data.gpus)) {
    for (const [i, gpu] of data.gpus.slice(0, 16).entries()) {
      if (typeof gpu.name !== 'string' || !gpu.name.length) continue;
      out.push(
        signal(
          `gpu:metal:${hash(gpu.name + i)}`,
          'gpu',
          `${gpu.name} · Metal availability`,
          'Apple Metal MTLCopyAllDevices',
          'Graphics devices available to the current application',
          'clear',
          'The OS exposes this device through the Metal API.',
          'If visual defects or crashes occur, use the display checks and OEM diagnostics; retain the incident timing.',
          'API availability verifies driver/device enumeration only. It does not test VRAM or GPU silicon.',
          [
            { name: 'Metal device', value: gpu.name },
            { name: 'Memory model', value: gpu.unifiedMemory ? 'Unified' : 'Dedicated / separate' },
          ],
        ),
      );
    }
  }
  if (!out.some((s) => s.category === 'gpu'))
    out.push(
      unavailable(
        'gpu:metal',
        'gpu',
        'Metal graphics availability',
        'Apple Metal',
        'No Metal device was returned. Unsupported hardware or the current execution environment can prevent enumeration.',
      ),
    );
  return out;
}
export async function macNative(abort: AbortSignal): Promise<HealthSignal[]> {
  const file = await findTool(bundledToolCandidates('pchealth-telemetry'));
  if (!file) throw Error('Bundled telemetry helper is missing; rebuild the native helper.');
  return parseMacNative(JSON.parse(await run(file, [], abort)));
}

export function parseLaunchctlList(output: string): HealthSignal[] {
  const lines = output.trim().split('\n');
  if (!/^PID\s+Status\s+Label$/.test(lines[0]?.trim()))
    throw Error('Unrecognized launchctl layout.');
  let total = 0,
    running = 0,
    exited = 0,
    signalled = 0;
  const examples: { name: string; value: string }[] = [];
  for (const line of lines.slice(1, 2049)) {
    const m = line.match(/^(\d+|-)\s+(-?\d+)\s+([\w.-]{1,250})$/);
    if (!m) {
      if (line.trim()) throw Error('Malformed launchctl row.');
      continue;
    }
    total++;
    if (m[1] !== '-') running++;
    // A historical signal (including OS SIGKILL) is not a failed service or a repair target.
    if (Number(m[2]) < 0) signalled++;
    if (m[1] === '-' && Number(m[2]) > 0) {
      exited++;
      if (examples.length < 32)
        examples.push({ name: 'Nonzero last exit', value: `${m[3]}: ${m[2]}` });
    }
  }
  if (!total) throw Error('No launchd jobs returned.');
  return [
    signal(
      'services:launchd',
      'services',
      'User-domain service exit results',
      'launchctl list',
      'Jobs visible to the current login session; latest exit results',
      exited > 0 ? 'warning' : 'clear',
      `${exited} stopped jobs have a nonzero last exit; ${running} jobs currently run (${total} inspected${lines.length > 2049 ? ', capped' : ''}).`,
      'Correlate repeat nonzero exits with symptoms and service ownership. Do not restart a job based on a historic exit code alone.',
      'On-demand jobs can be stopped intentionally. Negative statuses describe termination by a signal and are not classified as faults. The system/root domain is outside this check.',
      [
        { name: 'Inspected jobs', value: total },
        { name: 'Running jobs', value: running },
        { name: 'Stopped jobs with nonzero exit', value: exited },
        { name: 'Historical signal terminations', value: signalled },
        ...examples,
      ],
    ),
  ];
}
export async function macServices(abort: AbortSignal) {
  return parseLaunchctlList(await run('/bin/launchctl', ['list'], abort));
}
