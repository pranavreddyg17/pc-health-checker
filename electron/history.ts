import { mkdir, readFile, rename, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Scan } from '../src/shared/types';

export function isScan(value: unknown): value is Scan {
  if (!value || typeof value !== 'object') return false;
  const s = value as Scan;
  return (
    s.schemaVersion === 1 &&
    typeof s.id === 'string' &&
    /^[\da-f-]{36}$/.test(s.id) &&
    ['darwin', 'win32', 'linux'].includes(s.platform) &&
    ['complete', 'cancelled'].includes(s.state) &&
    ['startedAt', 'completedAt', 'arch', 'osVersion', 'machine', 'appVersion', 'ruleVersion'].every(
      (key) => typeof (s as any)[key] === 'string',
    ) &&
    Number.isFinite(Date.parse(s.completedAt)) &&
    Array.isArray(s.components) &&
    Array.isArray(s.findings) &&
    s.components.every(
      (c) =>
        c &&
        typeof c.id === 'string' &&
        typeof c.name === 'string' &&
        typeof c.subtitle === 'string' &&
        ['storage', 'battery', 'cpu', 'memory', 'gpu', 'cooling', 'system'].includes(c.kind) &&
        ['stable', 'session'].includes(c.identity) &&
        ['unknown', 'integrated', 'replaceable'].includes(c.serviceability) &&
        Array.isArray(c.metrics) &&
        Array.isArray(c.checks) &&
        c.metrics.every(
          (m) =>
            m &&
            typeof m.key === 'string' &&
            typeof m.label === 'string' &&
            typeof m.source === 'string' &&
            (m.unit === undefined || typeof m.unit === 'string') &&
            (typeof m.value === 'string' ||
              (typeof m.value === 'number' && Number.isFinite(m.value))),
        ) &&
        c.checks.every(
          (k) =>
            k &&
            ['available', 'unsupported', 'permission', 'error', 'not-run'].includes(k.status) &&
            ['id', 'label', 'detail', 'source'].every((key) => typeof (k as any)[key] === 'string'),
        ),
    ) &&
    s.findings.every(
      (f) =>
        f &&
        ['info', 'attention', 'urgent'].includes(f.severity) &&
        ['wear', 'fault', 'condition'].includes(f.category) &&
        ['id', 'componentId', 'title', 'explanation', 'action', 'limitation', 'rule'].every(
          (key) => typeof (f as any)[key] === 'string',
        ) &&
        Array.isArray(f.evidence) &&
        f.evidence.every((e) => typeof e === 'string'),
    )
  );
}

export class HistoryStore {
  constructor(private directory: string) {}
  private get file() {
    return path.join(this.directory, 'scans.json');
  }
  async load(): Promise<Scan[]> {
    try {
      if ((await stat(this.file)).size > 16 * 1024 * 1024)
        throw new Error('History exceeds the local size limit.');
      const values: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(values) || !values.every(isScan))
        throw new Error('Unrecognized history format.');
      return values;
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw new Error(
        'Saved history could not be read. Existing data has been preserved. Export this scan or clear history in Settings to start again.',
      );
    }
  }
  async save(scan: Scan): Promise<void> {
    const previous = await this.load();
    const scans = [scan, ...previous.filter((s) => s.id !== scan.id)].slice(0, 100);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(scans), { mode: 0o600 });
    await rename(temp, this.file);
  }
  async clear(): Promise<void> {
    await rm(this.file, { force: true });
  }
}
