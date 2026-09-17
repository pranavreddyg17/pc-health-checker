import path from 'node:path';
import type { HealthSignal } from '../../src/shared/reliability';
import { array, hash, run } from '../collectors/common';
import { count, finite, signal, unavailable } from './signals';

// Fixed, local queries. No event message bodies, command lines, serials or remote CIM sessions.
export const WINDOWS_OPERATIONAL_SCRIPT = `
$ErrorActionPreference='Stop'; $r=[ordered]@{};
try {$r.Memory=Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory | Select-Object AvailableMBytes,PercentCommittedBytesInUse} catch {$r.MemoryError=$true};
try {$r.Thermals=@(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -First 32 InstanceName,CurrentTemperature,CriticalTripPoint,Active)} catch {$r.ThermalError=if ($_.Exception.Message -match 'access.*denied') {'Permission'} else {'Unsupported'}};
try {$r.Sensors=@(Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor | Where-Object {$_.SensorType -in @('Temperature','Fan','Voltage')} | Select-Object -First 64 Name,Identifier,SensorType,Value)} catch {$r.SensorError=$true};
try {$r.GPU=@(Get-CimInstance Win32_VideoController | Select-Object -First 16 Name,ConfigManagerErrorCode,DriverVersion)} catch {$r.GpuError=$true};
try {$r.CPU=@(Get-CimInstance Win32_Processor | Select-Object -First 16 Name,CurrentClockSpeed,MaxClockSpeed,Status)} catch {$r.CpuError=$true};
foreach ($q in @(@{Key='DisplayEvents';Provider='Display';Ids=@(4101)},@{Key='ServiceEvents';Provider='Service Control Manager';Ids=@(7000,7001,7009,7011,7023,7024,7031,7034)},@{Key='MemoryEvents';Provider='Microsoft-Windows-MemoryDiagnostics-Results';Ids=@(1101,1102,1201,1202)})) {
  try {$events=@(); try {$events=@(Get-WinEvent -FilterHashtable @{LogName='System';ProviderName=$q.Provider;Id=$q.Ids;StartTime=(Get-Date).AddDays(-7)} -MaxEvents 257 -ErrorAction Stop)} catch {if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') {throw}}; $r[$q.Key]=@($events | Select-Object -First 256 | ForEach-Object {[pscustomobject]@{Id=$_.Id;Level=$_.Level;Time=$_.TimeCreated.ToUniversalTime().ToString('o')}}); $r[$q.Key+'Capped']=($events.Count -gt 256)} catch {$r[$q.Key+'Error']=$true}
}; [pscustomobject]$r | ConvertTo-Json -Depth 5 -Compress`;

export function parseWindowsOperational(
  data: Record<string, any>,
  now = Date.now(),
): HealthSignal[] {
  const out: HealthSignal[] = [];
  const available = finite(data.Memory?.AvailableMBytes),
    commit = finite(data.Memory?.PercentCommittedBytesInUse);
  out.push(
    available !== undefined &&
      available >= 0 &&
      commit !== undefined &&
      commit >= 0 &&
      commit <= 100
      ? signal(
          'memory:resources',
          'memory',
          'Memory resource pressure',
          'Windows formatted memory counters',
          'Current OS memory/commit resources',
          commit >= 95 ? 'warning' : 'clear',
          `Available memory ${Math.round(available)} MiB; committed capacity ${commit}%.`,
          'Correlate sustained commit pressure with slowdowns and paging using a performance capture. Inspect application demand before replacing RAM.',
          'Commit includes backing by RAM and page files; a single sample is not a physical memory integrity test or an upgrade recommendation.',
          [
            { name: 'Available memory', value: available, unit: 'MiB' },
            { name: 'Committed capacity used', value: commit, unit: '%' },
          ],
        )
      : unavailable(
          'memory:resources',
          'memory',
          'Memory resource pressure',
          'Windows memory counters',
          'The OS did not expose usable formatted memory counters.',
        ),
  );
  for (const [i, zone] of array<Record<string, any>>(data.Thermals).slice(0, 32).entries()) {
    if (zone.Active === false) continue;
    const raw = finite(zone.CurrentTemperature),
      rawLimit = finite(zone.CriticalTripPoint);
    const temp = raw === undefined ? undefined : Math.round((raw / 10 - 273.15) * 10) / 10;
    const limit =
      rawLimit === undefined ? undefined : Math.round((rawLimit / 10 - 273.15) * 10) / 10;
    if (temp === undefined || temp < -40 || temp > 150 || raw === 2732 || raw === 0) continue;
    const threshold = limit !== undefined && limit > 0 && limit <= 150 ? limit : undefined;
    out.push(
      signal(
        `thermal:acpi:${hash(String(zone.InstanceName || i))}`,
        'thermal',
        `ACPI thermal zone ${i + 1}`,
        'MSAcpi_ThermalZoneTemperature',
        'Firmware-reported thermal zone and critical trip point',
        threshold === undefined ? 'unknown' : temp >= threshold ? 'critical' : 'clear',
        `${temp} °C${threshold === undefined ? '; no usable critical trip point' : `; critical trip point ${threshold} °C`}.`,
        'If the firmware reports a critical trip, reduce workload and inspect cooling before further testing.',
        'A firmware zone is not necessarily the CPU package. Values may be stale or absent; generic Win32_TemperatureProbe is not used as a substitute.',
        [
          { name: 'Zone temperature', value: temp, unit: '°C' },
          ...(threshold === undefined
            ? []
            : [{ name: 'Firmware critical trip', value: threshold, unit: '°C' }]),
        ],
      ),
    );
  }
  for (const [i, sensor] of array<Record<string, any>>(data.Sensors).slice(0, 64).entries()) {
    const value = finite(sensor.Value),
      type = sensor.SensorType;
    if (
      value === undefined ||
      !['Temperature', 'Fan', 'Voltage'].includes(type) ||
      (type === 'Temperature' && (value < -40 || value > 150)) ||
      (type === 'Fan' && (value < 0 || value > 50000)) ||
      (type === 'Voltage' && (value < 0 || value > 60))
    )
      continue;
    out.push(
      signal(
        `thermal:lhm:${hash(String(sensor.Identifier || i))}`,
        'thermal',
        String(sensor.Name || type).slice(0, 250),
        'Existing LibreHardwareMonitor WMI provider',
        'Provider-reported sensor reading',
        'unknown',
        `${type}: ${value}. No device-specific fault threshold has been established.`,
        'Compare the reading with the exact OEM specification and workload. Zero fan speed can be intentional; no automatic replacement advice is derived.',
        'PC Health reads an already-running provider; it does not install its kernel driver or modify fan control. Sensor names/mapping are provider dependent.',
        [{ name: type, value, unit: type === 'Temperature' ? '°C' : type === 'Fan' ? 'RPM' : 'V' }],
      ),
    );
  }
  if (!out.some((s) => s.category === 'thermal'))
    out.push(
      unavailable(
        'thermal:windows',
        'thermal',
        'Thermal and fan telemetry',
        'ACPI / optional LibreHardwareMonitor provider',
        data.ThermalError === 'Permission'
          ? 'Windows denied thermal-zone access. No elevation was requested.'
          : 'Firmware did not expose usable ACPI thermal zones and no running LibreHardwareMonitor WMI provider returned sensors. Use the OEM sensor tool or an approved existing provider; no temperatures are invented.',
        data.ThermalError === 'Permission' ? 'permission' : 'unsupported',
      ),
    );
  for (const [i, gpu] of array<Record<string, any>>(data.GPU).slice(0, 16).entries()) {
    const code = count(gpu.ConfigManagerErrorCode);
    out.push(
      code === undefined
        ? unavailable(
            `gpu:device:${i}`,
            'gpu',
            String(gpu.Name || 'Graphics device'),
            'Win32_VideoController',
            'No usable device-manager status.',
          )
        : signal(
            `gpu:device:${hash(String(gpu.Name) + i)}`,
            'gpu',
            `${String(gpu.Name || 'Graphics device')} · device status`,
            'Win32_VideoController.ConfigManagerErrorCode',
            'Windows device-manager status',
            code === 0 ? 'clear' : 'warning',
            `Device-manager code: ${code}${code === 0 ? ' (no reported device problem)' : ' (review required)'}.`,
            'Review the matching device status, driver and OEM diagnostics before considering replacement.',
            'A zero code verifies OS enumeration/status only. It does not test GPU silicon or VRAM.',
            [
              { name: 'Device-manager code', value: code },
              ...(typeof gpu.DriverVersion === 'string'
                ? [{ name: 'Driver version', value: gpu.DriverVersion }]
                : []),
            ],
          ),
    );
  }
  if (!out.some((s) => s.category === 'gpu'))
    out.push(
      unavailable(
        'gpu:device',
        'gpu',
        'Graphics device status',
        'Win32_VideoController',
        'No graphics device status was returned.',
      ),
    );
  for (const [i, cpu] of array<Record<string, any>>(data.CPU).slice(0, 16).entries()) {
    const current = finite(cpu.CurrentClockSpeed),
      maximum = finite(cpu.MaxClockSpeed);
    const measurements: HealthSignal['measurements'] = [];
    if (current !== undefined && current > 0 && current <= 20000)
      measurements.push({ name: 'Reported clock', value: current, unit: 'MHz' });
    if (maximum !== undefined && maximum > 0 && maximum <= 20000)
      measurements.push({ name: 'Reported maximum clock', value: maximum, unit: 'MHz' });
    if (typeof cpu.Status === 'string' && cpu.Status.length <= 50)
      measurements.push({ name: 'OS processor status', value: cpu.Status });
    out.push(
      measurements.length
        ? signal(
            `cpu:resources:${i}`,
            'system',
            `${String(cpu.Name || 'Processor')} · operating state`,
            'Win32_Processor',
            'OS-reported processor operating state',
            'unknown',
            'Processor operating fields collected; no fault inferred from clock speed.',
            'Correlate slowdowns with workload, power settings and thermal pressure using a performance capture.',
            'Clock reporting varies by firmware and power policy. A lower clock can be intentional; this is not a silicon integrity test.',
            measurements,
          )
        : unavailable(
            `cpu:resources:${i}`,
            'system',
            'Processor operating state',
            'Win32_Processor',
            'No usable processor operating fields.',
          ),
    );
  }
  for (const [key, id, category, label, provider] of [
    ['DisplayEvents', 'gpu:tdr', 'gpu', 'Display driver recoveries', 'Windows Display event 4101'],
    [
      'ServiceEvents',
      'services:events',
      'services',
      'Recent service failure events',
      'Windows Service Control Manager',
    ],
    [
      'MemoryEvents',
      'memory:diagnostic-events',
      'memory',
      'Retained Windows memory diagnostic results',
      'Windows MemoryDiagnostics-Results',
    ],
  ] as const) {
    if (!Array.isArray(data[key])) {
      out.push(
        unavailable(
          id,
          category,
          label,
          provider,
          'The retained event source could not be read. Log access or provider support may be restricted.',
        ),
      );
      continue;
    }
    const entries = data[key].filter(
      (e: any) =>
        e &&
        Number.isInteger(e.Id) &&
        typeof e.Time === 'string' &&
        Date.parse(e.Time) >= now - 7 * 86400000 &&
        Date.parse(e.Time) <= now,
    );
    if (entries.length !== data[key].length) {
      out.push(
        unavailable(
          id,
          category,
          label,
          provider,
          'Malformed or out-of-window event records were returned; no zero result inferred.',
        ),
      );
      continue;
    }
    const failed =
      key === 'MemoryEvents'
        ? entries.filter((e: any) => e.Level === 1 || e.Level === 2).length
        : entries.length;
    // No retained memory-test result means no test has been established, not a passing test.
    const level = failed > 0 ? 'warning' : key === 'MemoryEvents' ? 'unknown' : 'clear';
    out.push(
      signal(
        id,
        category,
        label,
        provider,
        'Up to 256 retained events from the last seven days',
        level,
        key === 'MemoryEvents'
          ? `${entries.length} retained diagnostic result events; ${failed} have a critical/error event severity. A passing full memory test is not inferred.`
          : `${entries.length}${data[key + 'Capped'] ? '+' : ''} matching events in the retained window.`,
        key === 'MemoryEvents'
          ? 'Review diagnostic details and rerun an offline OEM memory test if errors recur. PC Health never schedules a restart or memory test automatically.'
          : 'Correlate event timing with symptoms, drivers and service dependencies before an approved recovery action.',
        'Only IDs, event severity and timestamps are inspected. Retention, event duplication and provider access limit coverage. Events do not identify a defective replaceable component.',
        [
          { name: 'Retained result events', value: entries.length },
          { name: 'Error result events', value: failed },
        ],
      ),
    );
  }
  return out;
}
export async function windowsOperational(abort: AbortSignal) {
  const executable = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return parseWindowsOperational(
    JSON.parse(
      await run(
        executable,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${WINDOWS_OPERATIONAL_SCRIPT}`,
        ],
        abort,
      ),
    ),
  );
}
