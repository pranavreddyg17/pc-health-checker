import path from 'node:path';
import type { Component } from '../../src/shared/types';
import { array, check, component, finite, metric, run } from './common';
import { enrichSmart } from './smart';

// Static scripts only. No renderer input is interpolated into PowerShell.
export const WINDOWS_SCRIPTS = {
  stability:
    "$ErrorActionPreference='Stop'; $events=@(); try {$events=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName='Microsoft-Windows-WHEA-Logger';StartTime=(Get-Date).AddDays(-7)} -MaxEvents 257 -ErrorAction Stop)} catch {if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {throw}}; [pscustomobject]@{Events=@($events | Select-Object -First 256 | ForEach-Object {[pscustomobject]@{Id=$_.Id;Time=$_.TimeCreated.ToUniversalTime().ToString('o')}});Truncated=($events.Count -gt 256)} | ConvertTo-Json -Depth 4 -Compress",
  hardware:
    "$ErrorActionPreference='Stop'; [pscustomobject]@{Computer=Get-CimInstance Win32_ComputerSystem; CPU=@(Get-CimInstance Win32_Processor); Memory=@(Get-CimInstance Win32_PhysicalMemory); GPU=@(Get-CimInstance Win32_VideoController)} | ConvertTo-Json -Depth 5 -Compress",
  storage: `$ErrorActionPreference='Stop'; $physical=@(Get-PhysicalDisk); $raw=@(Get-CimInstance Win32_DiskDrive -ErrorAction SilentlyContinue); @($physical | Select-Object -First 64 | ForEach-Object { $d=$_; $r=$null; $problem=$null; try {$r=$d | Get-StorageReliabilityCounter -ErrorAction Stop} catch {$problem=if ($_.Exception -is [System.UnauthorizedAccessException] -or $_.Exception.Message -match 'access.*denied') {'Permission'} else {'Unsupported'}}; $serial=([string]$d.SerialNumber).Trim(); $matches=@(); $same=@(); if ($serial.Length -gt 0) {$matches=@($raw | Where-Object {([string]$_.SerialNumber).Trim() -eq $serial}); $same=@($physical | Where-Object {([string]$_.SerialNumber).Trim() -eq $serial})}; $index=$null; if ($matches.Count -eq 1 -and $same.Count -eq 1) {$index=$matches[0].Index}; [pscustomobject]@{Name=$d.FriendlyName; Serial=$d.SerialNumber; BusType=[string]$d.BusType; MediaType=[string]$d.MediaType; Size=$d.Size; Health=[string]$d.HealthStatus; Reliability=$r; Problem=$problem; DeviceIndex=$index} }) | ConvertTo-Json -Depth 5 -Compress`,
  battery:
    "$ErrorActionPreference='Stop'; $b=@(Get-CimInstance Win32_Battery); $full=@(Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue); $static=@(Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue); [pscustomobject]@{Batteries=$b; Full=$full; Static=$static} | ConvertTo-Json -Depth 4 -Compress",
};
export async function powershell(script: keyof typeof WINDOWS_SCRIPTS, signal: AbortSignal) {
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const text = await run(
    executable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${WINDOWS_SCRIPTS[script]}`,
    ],
    signal,
  );
  return text.trim() ? JSON.parse(text.replace(/^\uFEFF/, '')) : [];
}
export function parseWindowsStorage(data: unknown): Component[] {
  return array<Record<string, any>>(data as any)
    .filter((d) => !['USB', 'Virtual', 'File Backed Virtual'].includes(d.BusType))
    .map((d) => {
      const c = component(
        'storage',
        String(d.Name || 'Internal drive').trim(),
        `${d.MediaType || 'Internal'} storage`,
        d.Serial?.trim() ? `${d.Name}:${d.Serial.trim()}` : undefined,
      );
      c.metrics.push(
        ...metric(
          'windows_health',
          'Windows storage health',
          ['Healthy', 'Warning', 'Unhealthy', 'Unknown'].includes(d.Health) ? d.Health : undefined,
          'Windows Storage API',
        ),
        ...metric('protocol', 'Interface', d.BusType, 'Windows Storage API'),
        ...metric(
          'capacity',
          'Capacity',
          finite(d.Size) !== undefined ? Math.round(d.Size / 1e9) : undefined,
          'Windows Storage API',
          ' GB',
        ),
      );
      const r = d.Reliability;
      for (const [field, key, label, unit] of [
        ['TemperatureMax', 'temperature_max', 'Provider maximum operating temperature', '°C'],
        ['PowerOnHours', 'power_hours', 'Power-on time', ' h'],
        ['ReadLatencyMax', 'read_latency_max', 'Maximum recorded read latency', ' ms'],
        ['WriteLatencyMax', 'write_latency_max', 'Maximum recorded write latency', ' ms'],
        ['FlushLatencyMax', 'flush_latency_max', 'Maximum recorded flush latency', ' ms'],
      ]) {
        const n = finite(r?.[field]);
        if (n !== undefined && n >= 0 && Number.isSafeInteger(n))
          c.metrics.push(...metric(key, label, n, 'StorageReliabilityCounter', unit));
      }
      c.metrics.push(
        ...metric(
          'temperature',
          'Drive temperature',
          finite(r?.Temperature) && r.Temperature > 0 ? r.Temperature : undefined,
          'StorageReliabilityCounter',
          '°C',
        ),
      );
      for (const [field, key, label] of [
        ['ReadErrorsUncorrected', 'windows_read_uncorrected', 'Uncorrected read errors'],
        ['WriteErrorsUncorrected', 'windows_write_uncorrected', 'Uncorrected write errors'],
      ]) {
        const raw = r?.[field];
        const n =
          typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim()))
            ? finite(raw)
            : undefined;
        c.metrics.push(
          ...metric(
            key,
            label,
            n !== undefined && Number.isSafeInteger(n) && n >= 0 ? n : undefined,
            'StorageReliabilityCounter',
          ),
        );
      }
      // Windows Wear has device-dependent semantics; preserve it, do not treat it as NVMe PercentageUsed.
      c.metrics.push(
        ...metric(
          'windows_wear',
          'Reported wear indicator',
          finite(r?.Wear) !== undefined && r.Wear >= 0 && r.Wear <= 255
            ? finite(r.Wear)
            : undefined,
          'StorageReliabilityCounter',
        ),
      );
      c.checks.push(
        check(
          'inventory',
          'Drive identification',
          'available',
          'Physical storage enumerated through Windows.',
          'Get-PhysicalDisk',
        ),
        check(
          'reliability',
          'Reliability counters',
          r &&
            c.metrics.some((m) =>
              [
                'temperature',
                'windows_wear',
                'windows_read_uncorrected',
                'windows_write_uncorrected',
                'power_hours',
              ].includes(m.key),
            )
            ? 'available'
            : d.Problem === 'Permission'
              ? 'permission'
              : 'unsupported',
          r
            ? 'Available counters were read. Generic HealthStatus and Wear are not interpreted as an NVMe endurance estimate.'
            : 'Reliability counters were unavailable. This may require additional permissions or controller support.',
          'Get-StorageReliabilityCounter',
        ),
      );
      return c;
    });
}
export async function windowsStorage(signal: AbortSignal): Promise<Component[]> {
  const raw = array<Record<string, any>>(await powershell('storage', signal)).filter(
    (d) => !['USB', 'Virtual', 'File Backed Virtual'].includes(d.BusType),
  );
  const components = parseWindowsStorage(raw);
  for (const [i, c] of components.entries()) {
    signal.throwIfAborted();
    const index = raw[i].DeviceIndex;
    if (typeof index === 'number' && Number.isInteger(index) && index >= 0 && index <= 9999)
      await enrichSmart(c, `/dev/pd${index}`, signal, raw[i].Serial?.trim());
    else
      c.checks.push(
        check(
          'smart-detail',
          'Detailed device health',
          'unsupported',
          'Windows did not expose an unambiguous serial-based mapping to a physical device number. Raw values were not assigned by guessing a disk index; inspect the storage controller/OEM tool.',
          'Windows disk mapping',
        ),
      );
  }
  return components;
}
export function parseWindowsBattery(data: Record<string, any>): Component[] {
  return array<Record<string, any>>(data.Batteries).map((d, index) => {
    const c = component('battery', d.Name || 'Laptop battery', 'Rechargeable battery');
    // WMI instance mapping is not guaranteed; only combine the unambiguous single-battery case.
    const one =
      array(data.Batteries).length === 1 &&
      array(data.Full).length === 1 &&
      array(data.Static).length === 1;
    const full = one
      ? finite(array<Record<string, any>>(data.Full)[0].FullChargedCapacity)
      : undefined;
    const design = one
      ? finite(array<Record<string, any>>(data.Static)[0].DesignedCapacity)
      : undefined;
    const retention =
      full && design && full > 0 && design > 0 && full / design <= 1.5
        ? Math.round((full / design) * 100)
        : undefined;
    c.metrics.push(
      ...metric('capacity_retention', 'Capacity retention', retention, 'Windows battery WMI', '%'),
    );
    c.checks.push(
      check(
        `battery-${index}`,
        'Battery capacity',
        retention !== undefined ? 'available' : 'unsupported',
        retention !== undefined
          ? 'Estimated from full-charge and design capacities.'
          : 'Comparable capacities or unambiguous battery mapping were unavailable.',
        'Windows battery WMI',
      ),
    );
    return c;
  });
}
