import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Component } from '../../src/shared/types';
import { check, component, metric, run } from './common';
import { powershell } from './windows';

const WEEK = 7 * 24 * 60 * 60 * 1000;
const LIMIT = 256;
const stabilityComponent = () =>
  component('system', 'System stability', 'Recent diagnostic evidence');

export interface ReportFile {
  name: string;
  modifiedAt: number;
}
export const isPanicReport = (name: string) =>
  /^(?:kernel[_-]|panic(?:-full)?[_-]|sleep wake failure[_-]).*\.(?:panic|ips)$/i.test(name);

export function parseMacReportFiles(
  files: ReportFile[],
  now = Date.now(),
  limited = false,
): Component {
  const c = stabilityComponent();
  const source = 'macOS diagnostic report metadata';
  const recent = [
    ...new Map(
      files
        .filter(
          (file) =>
            isPanicReport(file.name) &&
            Number.isFinite(file.modifiedAt) &&
            file.modifiedAt >= now - WEEK &&
            file.modifiedAt <= now,
        )
        .map((file) => [file.name, file]),
    ).values(),
  ];
  c.metrics.push(
    ...metric('panic_report_count', 'Recent panic-related report files', recent.length, source),
    ...metric('event_window', 'Scope', 'Report files modified in the last 7 days', source),
  );
  if (recent.length)
    c.metrics.push(
      ...metric(
        'latest_report',
        'Most recently modified report',
        new Date(Math.max(...recent.map((file) => file.modifiedAt))).toISOString(),
        source,
      ),
    );
  c.checks.push(
    check(
      'stability-reports',
      'Recent panic-related reports',
      'available',
      `Read file metadata only; report contents and filenames are not saved. ${limited ? 'The directory scan was limited or some entries were unavailable. ' : ''}A report file does not establish the cause or exact time of a crash. Missing or deleted reports are not detectable.`,
      source,
    ),
  );
  return c;
}

export async function macStability(signal: AbortSignal): Promise<Component[]> {
  const directory = '/Library/Logs/DiagnosticReports';
  const files = await readdir(directory, { withFileTypes: true });
  const matches = files.filter((file) => file.isFile() && isPanicReport(file.name));
  const selected = matches.sort((a, b) => b.name.localeCompare(a.name)).slice(0, 200);
  const records: ReportFile[] = [];
  let limited = matches.length > selected.length;
  for (const file of selected) {
    signal.throwIfAborted();
    try {
      const info = await stat(path.join(directory, file.name));
      records.push({ name: file.name, modifiedAt: info.mtimeMs });
    } catch {
      limited = true;
    }
  }
  if (selected.length && !records.length) {
    throw new Error('Diagnostic report metadata could not be read.');
  }
  return [parseMacReportFiles(records, Date.now(), limited)];
}

export function parseWindowsEvents(data: unknown, now = Date.now()): Component {
  if (
    !data ||
    typeof data !== 'object' ||
    !('Events' in data) ||
    !Array.isArray(data.Events) ||
    !('Truncated' in data) ||
    typeof data.Truncated !== 'boolean'
  ) {
    throw new Error('Windows event output did not contain a readable event collection.');
  }
  const c = stabilityComponent();
  const source = 'Windows System log · WHEA-Logger';
  const valid = data.Events.filter(
    (event) =>
      event &&
      Number.isInteger(event.Id) &&
      event.Id >= 0 &&
      typeof event.Time === 'string' &&
      Number.isFinite(Date.parse(event.Time)),
  );
  if (data.Events.length && !valid.length)
    throw new Error('Windows event records were not readable.');
  const events = valid
    .filter((event) => Date.parse(event.Time) >= now - WEEK && Date.parse(event.Time) <= now)
    .sort((a, b) => Date.parse(b.Time) - Date.parse(a.Time))
    .slice(0, LIMIT);
  c.metrics.push(
    ...metric('whea_event_count', 'Recorded hardware-error events', events.length, source),
    ...metric('event_window', 'Scope', 'Retained WHEA events from the last 7 days', source),
  );
  const latest = events.map((event) => Date.parse(event.Time as string)).sort((a, b) => b - a)[0];
  if (latest)
    c.metrics.push(
      ...metric(
        'latest_event',
        'Most recent recorded event',
        new Date(latest).toISOString(),
        source,
      ),
    );
  c.checks.push(
    check(
      'whea-events',
      'Recent Windows hardware-error events',
      'available',
      `${data.Truncated || data.Events.length > LIMIT ? `Only the latest ${LIMIT} matching events were retained. ` : ''}${valid.length !== data.Events.length ? 'Some records could not be parsed. ' : ''}Counts may include corrected errors and do not identify a failed replaceable part. Only event IDs and timestamps were read; message contents were not collected. Log retention and permissions limit coverage.`,
      source,
    ),
  );
  return c;
}

export async function windowsStability(signal: AbortSignal): Promise<Component[]> {
  return [parseWindowsEvents(await powershell('stability', signal))];
}

export function parseKernelJournal(output: string): Component {
  const c = stabilityComponent();
  const source = 'Linux kernel journal · current boot';
  const lines = output.split('\n').filter((line) => line.trim());
  const categories = { memory: 0, pcie: 0, gpu: 0 };
  let parsed = 0,
    malformed = 0;
  for (const line of lines.slice(-LIMIT)) {
    try {
      const entry = JSON.parse(line);
      if (typeof entry.MESSAGE !== 'string') {
        malformed++;
        continue;
      }
      parsed++;
      const text = entry.MESSAGE;
      // Match specific diagnostic patterns, not generic mentions of a device or "error".
      if (
        /\b(?:EDAC.*\b(?:CE|UE|corrected|uncorrected)\b|mce:.*(?:hardware error|machine check))|\[Hardware Error\]/i.test(
          text,
        )
      )
        categories.memory++;
      else if (/\bAER:.*(?:error|corrected|uncorrected)|PCIe Bus Error/i.test(text))
        categories.pcie++;
      else if (
        /\bNVRM:.*Xid\b|amdgpu.*(?:ring.*timeout|GPU reset|GPU fault)|i915.*GPU HANG/i.test(text)
      )
        categories.gpu++;
    } catch {
      malformed++;
    }
  }
  if (lines.length && !parsed) throw new Error('Kernel journal output was not readable JSON.');
  for (const [key, count] of Object.entries(categories))
    c.metrics.push(
      ...metric(
        `kernel_${key}_events`,
        {
          memory: 'Machine-check / memory messages',
          pcie: 'PCIe error messages',
          gpu: 'Graphics fault / reset messages',
        }[key]!,
        count,
        source,
      ),
    );
  c.metrics.push(
    ...metric(
      'event_window',
      'Scope',
      `Up to ${LIMIT} retained kernel warnings/errors · current boot · last 7 days`,
      source,
    ),
  );
  c.checks.push(
    check(
      'kernel-events',
      'Recent kernel diagnostic messages',
      'available',
      `Inspected ${parsed} retained warning/error entries. ${lines.length > LIMIT || malformed ? 'The sample was limited or some records could not be parsed. ' : ''}One incident can generate several messages. Raw messages are discarded; driver faults do not prove a physical component has failed. Older boots and rotated logs are outside this check.`,
      source,
    ),
  );
  return c;
}

export async function linuxStability(signal: AbortSignal): Promise<Component[]> {
  // Confirm readable kernel entries first; an empty restricted journal is not a clean bill of health.
  const probe = await run(
    '/usr/bin/journalctl',
    ['--dmesg', '--boot=0', '--no-pager', '--output=json', '-n', '1'],
    signal,
  );
  if (!probe.trim()) {
    const c = stabilityComponent();
    c.checks.push(
      check(
        'kernel-events',
        'Recent kernel diagnostic messages',
        'unsupported',
        'No readable kernel journal entries were available. Permissions, journal retention, or the logging system may limit access.',
        'journalctl',
      ),
    );
    return [c];
  }
  parseKernelJournal(probe); // Reject unreadable output before interpreting an empty warning sample.
  const output = await run(
    '/usr/bin/journalctl',
    [
      '--dmesg',
      '--boot=0',
      '--since',
      '7 days ago',
      '--priority=0..4',
      '--no-pager',
      '--output=json',
      '-n',
      String(LIMIT + 1),
    ],
    signal,
  );
  return [parseKernelJournal(output)];
}
