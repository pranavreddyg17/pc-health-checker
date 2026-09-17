import { readFile, readdir, readlink } from 'node:fs/promises';
import path from 'node:path';
import type { Component } from '../../src/shared/types';
import { array, check, component, finite, metric, run } from './common';
import { enrichSmart } from './smart';

export async function optionalText(file: string): Promise<string | undefined> {
  try {
    return (await readFile(file, 'utf8')).trim();
  } catch {
    return undefined;
  }
}

export async function linuxGraphics(): Promise<Component[]> {
  const cards = (await readdir('/sys/class/drm')).filter((name) => /^card\d+$/.test(name));
  const results: Component[] = [];
  for (const card of cards.slice(0, 8)) {
    const base = `/sys/class/drm/${card}/device`;
    const vendor = await optionalText(`${base}/vendor`);
    const device = await optionalText(`${base}/device`);
    const brand =
      ({ '0x1002': 'AMD', '0x10de': 'NVIDIA', '0x8086': 'Intel' } as Record<string, string>)[
        vendor ?? ''
      ] || 'Detected';
    const c = component(
      'gpu',
      `${brand} graphics${device ? ` (${device})` : ''}`,
      'Linux DRM graphics device',
    );
    const driver = await readlink(`${base}/driver`)
      .then((value) => path.basename(value))
      .catch(() => undefined);
    c.metrics.push(...metric('driver', 'Active driver', driver, 'Linux DRM / PCI sysfs'));
    c.checks.push(
      check(
        'inventory',
        'Graphics device enumeration',
        'available',
        'Read the graphics device and driver exposed by the kernel. Device IDs are not a product compatibility match.',
        'Linux DRM / PCI sysfs',
      ),
      check(
        'gpu-health',
        'Graphics integrity test',
        'not-run',
        'No graphics or VRAM test was run. Recent driver messages, when readable, appear under System stability.',
        'PC Health',
      ),
    );
    results.push(c);
  }
  if (!results.length) {
    const c = component('gpu', 'Graphics hardware', 'No readable graphics device');
    c.checks.push(
      check(
        'inventory',
        'Graphics device enumeration',
        'unsupported',
        'No supported DRM card was exposed. This may occur on headless or virtualized systems.',
        'Linux DRM / PCI sysfs',
      ),
    );
    results.push(c);
  }
  return results;
}
export function parseLinuxBlock(
  data: Record<string, any>,
): { component: Component; device: string }[] {
  return array<Record<string, any>>(data.blockdevices)
    .filter(
      (d) =>
        d.type === 'disk' &&
        !d.rm &&
        !['usb', ''].includes(d.tran ?? '') &&
        /^\/dev\/(nvme\d+n\d+|sd[a-z]+|hd[a-z]+|mmcblk\d+)$/.test(d.path),
    )
    .map((d) => {
      const c = component(
        'storage',
        String(d.model || 'Internal drive').trim(),
        'Internal storage',
        d.serial?.trim() ? `${d.model}:${d.serial.trim()}` : undefined,
      );
      c.metrics.push(
        ...metric(
          'protocol',
          'Interface',
          d.tran === 'nvme' ? 'NVMe' : d.tran === 'sata' ? 'SATA' : d.tran,
          'lsblk',
        ),
        ...metric(
          'capacity',
          'Capacity',
          finite(d.size) !== undefined ? Math.round(d.size / 1e9) : undefined,
          'lsblk',
          ' GB',
        ),
      );
      c.checks.push(
        check(
          'inventory',
          'Drive identification',
          'available',
          'Enumerated a non-removable physical drive.',
          'lsblk',
        ),
      );
      return { component: c, device: d.path };
    });
}
export async function linuxStorage(signal: AbortSignal): Promise<Component[]> {
  const list = parseLinuxBlock(
    JSON.parse(
      await run(
        '/usr/bin/lsblk',
        ['--json', '--bytes', '--nodeps', '--output', 'NAME,PATH,MODEL,SERIAL,SIZE,TYPE,TRAN,RM'],
        signal,
      ),
    ),
  );
  for (const { component, device } of list) {
    if (signal.aborted) break;
    await enrichSmart(component, device, signal);
  }
  return list.map((d) => d.component);
}
export async function linuxBatteries(): Promise<Component[]> {
  const list: Component[] = [];
  for (const name of await readdir('/sys/class/power_supply').catch(() => [])) {
    const base = `/sys/class/power_supply/${name}`;
    if ((await optionalText(`${base}/type`)) !== 'Battery') continue;
    const model = await optionalText(`${base}/model_name`);
    const serial = await optionalText(`${base}/serial_number`);
    const c = component(
      'battery',
      model || 'Laptop battery',
      'Rechargeable battery',
      serial ? `${model}:${serial}` : undefined,
    );
    let full = finite(await optionalText(`${base}/energy_full`)),
      design = finite(await optionalText(`${base}/energy_full_design`));
    if (!full || !design) {
      full = finite(await optionalText(`${base}/charge_full`));
      design = finite(await optionalText(`${base}/charge_full_design`));
    }
    const retention =
      full && design && full > 0 && design > 0 && full / design <= 1.5
        ? Math.round((full / design) * 100)
        : undefined;
    c.metrics.push(
      ...metric('capacity_retention', 'Capacity retention', retention, 'Linux power_supply', '%'),
      ...metric(
        'cycles',
        'Charge cycles',
        finite(await optionalText(`${base}/cycle_count`)),
        'Linux power_supply',
      ),
    );
    c.checks.push(
      check(
        'battery',
        'Battery capacity',
        retention !== undefined ? 'available' : 'unsupported',
        retention !== undefined
          ? 'Estimated from matching full and design capacity units.'
          : 'The battery driver did not expose comparable capacity measurements.',
        'sysfs power_supply',
      ),
    );
    list.push(c);
  }
  return list;
}
export async function linuxCooling(): Promise<Component[]> {
  const c = component('cooling', 'Thermal sensors', 'Available hardware sensors');
  for (const name of (await readdir('/sys/class/hwmon').catch(() => [])).slice(0, 20)) {
    const base = `/sys/class/hwmon/${name}`;
    const chip = (await optionalText(`${base}/name`)) || name;
    const files = await readdir(base).catch(() => []);
    for (const sensor of files.filter((f) => /^(temp\d+|fan\d+)_input$/.test(f)).slice(0, 12)) {
      const value = finite(await optionalText(`${base}/${sensor}`));
      const thermal = sensor.startsWith('temp');
      if (value === undefined || (thermal && (value < -40000 || value > 150000))) continue;
      c.metrics.push(
        ...metric(
          `${name}_${sensor}`,
          `${chip} · ${(await optionalText(`${base}/${sensor.replace('_input', '_label')}`)) || sensor.replace('_input', '')}`,
          thermal ? Math.round(value / 100) / 10 : value,
          'sysfs hwmon',
          thermal ? '°C' : ' RPM',
        ),
      );
    }
  }
  c.checks.push(
    check(
      'sensors',
      'Exposed sensor readings',
      c.metrics.length ? 'available' : 'unsupported',
      'Readings are snapshots. Without model-specific thresholds and control state, a temperature or zero RPM is not a fault diagnosis.',
      'sysfs hwmon',
    ),
  );
  return [c];
}
