import type { Component } from '../../src/shared/types';
import { array, check, component, finite, metric, run } from './common';
import { enrichSmart } from './smart';

type RecordData = Record<string, any>;
export async function profiler(types: string[], signal: AbortSignal): Promise<RecordData> {
  return JSON.parse(
    await run('/usr/sbin/system_profiler', [...types, '-json', '-detailLevel', 'basic'], signal),
  );
}
function records(nodes: unknown): RecordData[] {
  return array(nodes).flatMap((node: any) =>
    node && typeof node === 'object' ? [node, ...records(node._items)] : [],
  );
}
export function parseMacStorage(data: RecordData): { component: Component; device: string }[] {
  const devices = new Map<string, { component: Component; device: string }>();
  for (const type of ['SPNVMeDataType', 'SPSerialATADataType']) {
    for (const d of records(data[type])) {
      const bsd = d.bsd_name;
      if (
        typeof bsd !== 'string' ||
        !/^disk\d+$/.test(bsd) ||
        d.removable_media === 'yes' ||
        d.detachable_drive === 'yes'
      )
        continue;
      const name = d.device_model || d._name || 'Internal drive';
      const c = component(
        'storage',
        name,
        type === 'SPNVMeDataType' ? 'Internal NVMe storage' : 'Internal SATA storage',
        d.device_serial ? `${name}:${d.device_serial}` : undefined,
      );
      c.serviceability = /APPLE/.test(name) && type === 'SPNVMeDataType' ? 'integrated' : 'unknown';
      c.metrics.push(
        ...metric(
          'protocol',
          'Interface',
          type === 'SPNVMeDataType' ? 'NVMe' : 'SATA',
          'system_profiler',
        ),
      );
      const size = finite(d.size_in_bytes);
      if (size)
        c.metrics.push(
          ...metric('capacity', 'Capacity', Math.round(size / 1e9), 'system_profiler', ' GB'),
        );
      else if (typeof d.size === 'string')
        c.metrics.push(
          ...metric('capacity_text', 'Capacity', d.size.split(' (')[0], 'system_profiler'),
        );
      if (d.smart_status) {
        const raw = String(d.smart_status);
        c.metrics.push(
          ...metric(
            'smart_passed',
            'SMART status',
            /verified|passed/i.test(raw) ? 'Passed' : /fail/i.test(raw) ? 'Failed' : raw,
            'system_profiler',
          ),
        );
      }
      c.checks.push(
        check(
          'inventory',
          'Drive identification',
          'available',
          'Detected a physical internal drive.',
          'system_profiler',
        ),
        check(
          'smart-basic',
          'System-reported SMART status',
          d.smart_status ? 'available' : 'unsupported',
          d.smart_status
            ? `Device status: ${d.smart_status}. A passing status cannot rule out every fault.`
            : 'The system did not expose a basic SMART status.',
          'system_profiler',
        ),
      );
      devices.set(bsd, { component: c, device: `/dev/${bsd}` });
    }
  }
  return [...devices.values()];
}
export function parseMacBattery(data: RecordData): Component[] {
  const devices: Component[] = [];
  for (const d of array<RecordData>(data.SPPowerDataType)) {
    const health = d.sppower_battery_health_info;
    if (!health) continue;
    const model = d.sppower_battery_model_info ?? {};
    const c = component(
      'battery',
      'Internal battery',
      'Rechargeable battery',
      model.sppower_battery_serial_number,
    );
    c.serviceability = 'integrated';
    // Recent macOS uses `health` for condition and a separate maximum-capacity field.
    const retention = finite(
      health.sppower_battery_health_maximum_capacity ?? health.sppower_battery_health,
    );
    const condition =
      health.sppower_battery_condition ??
      (finite(health.sppower_battery_health) === undefined
        ? health.sppower_battery_health
        : undefined);
    c.metrics.push(
      ...metric(
        'capacity_retention',
        'Capacity retention',
        retention && retention <= 150 ? retention : undefined,
        'macOS battery health',
        '%',
      ),
      ...metric(
        'cycles',
        'Charge cycles',
        finite(health.sppower_battery_cycle_count),
        'macOS battery health',
      ),
      ...metric('condition', 'System condition', condition, 'macOS battery health'),
    );
    c.checks.push(
      check(
        'battery',
        'Battery health information',
        c.metrics.length ? 'available' : 'unsupported',
        'Capacity and condition reported by macOS, separate from current charge level.',
        'system_profiler',
      ),
      check(
        'physical',
        'Physical battery condition',
        'not-run',
        'Software cannot inspect swelling or physical damage. Use model-specific service guidance if you notice a physical problem.',
        'Guided inspection',
      ),
    );
    devices.push(c);
  }
  return devices;
}
export function parseMacGraphics(data: RecordData): Component[] {
  return array<RecordData>(data.SPDisplaysDataType).map((d) => {
    const c = component(
      'gpu',
      d.sppci_model || d._name || 'Graphics processor',
      'Graphics hardware',
    );
    c.metrics.push(
      ...metric(
        'gpu_memory',
        'Graphics memory',
        d.spdisplays_vram || d.spdisplays_vram_shared,
        'system_profiler',
      ),
    );
    c.checks.push(
      check(
        'inventory',
        'Graphics identification',
        'available',
        'Detected through system inventory.',
        'system_profiler',
      ),
      check(
        'gpu-health',
        'Graphics fault diagnosis',
        'not-run',
        'No GPU stress test or driver-log diagnosis was run. Identification does not establish hardware health.',
        'PC Health',
      ),
    );
    return c;
  });
}
export async function macStorage(signal: AbortSignal): Promise<Component[]> {
  const list = parseMacStorage(await profiler(['SPNVMeDataType', 'SPSerialATADataType'], signal));
  for (const { component, device } of list) {
    if (signal.aborted) break;
    await enrichSmart(component, device, signal);
  }
  return list.map((d) => d.component);
}
