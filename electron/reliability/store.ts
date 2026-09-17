import { mkdir, readFile, writeFile, rename, stat, open, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  categories,
  telemetryStates,
  type HealthSnapshot,
  type HealthSignal,
  type HealthAlert,
  type ReliabilityData,
} from '../../src/shared/reliability';
const string = (v: unknown, max = 6000): v is string => typeof v === 'string' && v.length <= max;
const date = (v: unknown) => string(v, 40) && Number.isFinite(Date.parse(v));
const levels = ['clear', 'warning', 'critical', 'unknown'];
export function validSignal(value: unknown): value is HealthSignal {
  const s = value as HealthSignal;
  return Boolean(
    s &&
    string(s.id, 250) &&
    string(s.label, 1000) &&
    categories.includes(s.category) &&
    levels.includes(s.level) &&
    (s.availability === undefined || telemetryStates.includes(s.availability)) &&
    date(s.observedAt) &&
    ['source', 'scope', 'summary', 'action', 'limitation'].every((k) => string((s as any)[k])) &&
    Array.isArray(s.measurements) &&
    s.measurements.length <= 128 &&
    s.measurements.every(
      (m) =>
        m &&
        string(m.name, 500) &&
        (string(m.value, 2000) || (typeof m.value === 'number' && Number.isFinite(m.value))) &&
        (m.unit === undefined || string(m.unit, 30)),
    ) &&
    (s.counter === undefined ||
      (s.counter &&
        Number.isSafeInteger(s.counter.value) &&
        s.counter.value >= 0 &&
        string(s.counter.epoch, 250))) &&
    (s.trend === undefined ||
      (s.trend &&
        ['baseline', 'increased', 'unchanged', 'reset', 'not-comparable'].includes(s.trend.state) &&
        (s.trend.delta === undefined ||
          (Number.isSafeInteger(s.trend.delta) && s.trend.delta >= 0)) &&
        (s.trend.seconds === undefined ||
          (Number.isFinite(s.trend.seconds) && s.trend.seconds > 0)))),
  );
}
export function validSnapshot(value: unknown): value is HealthSnapshot {
  const s = value as HealthSnapshot;
  return Boolean(
    s &&
    s.schemaVersion === 1 &&
    string(s.id, 100) &&
    date(s.at) &&
    ['darwin', 'linux', 'win32'].includes(s.platform) &&
    string(s.ruleVersion, 40) &&
    Number.isFinite(s.elapsedMs) &&
    s.elapsedMs >= 0 &&
    Array.isArray(s.signals) &&
    s.signals.length > 0 &&
    s.signals.length <= 1536 &&
    s.signals.every(validSignal) &&
    new Set(s.signals.map((s) => s.id)).size === s.signals.length,
  );
}
function validAlert(a: HealthAlert) {
  return Boolean(
    a &&
    ['id', 'signalId', 'title', 'summary', 'action'].every((k) => string((a as any)[k])) &&
    date(a.at) &&
    date(a.lastSeen) &&
    levels.includes(a.level) &&
    Number.isSafeInteger(a.occurrences) &&
    a.occurrences >= 1 &&
    (a.acknowledgedAt === undefined || date(a.acknowledgedAt)),
  );
}
const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export class ReliabilityStore {
  private queue: Promise<unknown> = Promise.resolve();
  private revision?: string;
  constructor(private directory: string) {}
  get file() {
    return path.join(this.directory, 'reliability.json');
  }
  private async read(): Promise<{ data: ReliabilityData; revision: string }> {
    try {
      if ((await stat(this.file)).size > 32 * 1024 * 1024) throw Error('size');
      const text = await readFile(this.file, 'utf8'),
        d = JSON.parse(text);
      if (
        d.schemaVersion !== 1 ||
        !Array.isArray(d.snapshots) ||
        d.snapshots.length > 120 ||
        !d.snapshots.every(validSnapshot) ||
        !Array.isArray(d.alerts) ||
        d.alerts.length > 200 ||
        !d.alerts.every(validAlert)
      )
        throw Error('schema');
      return { data: d, revision: digest(text) };
    } catch (e: any) {
      if (e.code === 'ENOENT')
        return { data: { schemaVersion: 1, snapshots: [], alerts: [] }, revision: 'empty' };
      throw Error(
        'Reliability history is unreadable. Existing data was preserved; monitoring is paused.',
      );
    }
  }
  async load() {
    const result = await this.read();
    this.revision = result.revision;
    return result.data;
  }
  save(data: ReliabilityData): Promise<void> {
    const work = this.queue.then(async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const lock = this.file + '.lock';
      const handle = await open(lock, 'wx', 0o600).catch(() => {
        throw Error(
          'Reliability history is locked by another writer. Verify that no writer is running before removing a stale .lock file.',
        );
      });
      const temp = this.file + '.' + randomUUID() + '.tmp';
      try {
        await handle.writeFile(String(process.pid));
        const current = await this.read();
        if (this.revision !== undefined && this.revision !== current.revision)
          throw Error(
            'Reliability history changed in another process. Restart collection with a dedicated data directory.',
          );
        if (!data.snapshots.every(validSnapshot) || !data.alerts.every(validAlert))
          throw Error('Invalid reliability data.');
        data.snapshots = data.snapshots.slice(0, 120);
        data.alerts = data.alerts.slice(0, 200);
        let json = JSON.stringify(data);
        while (Buffer.byteLength(json) > 30 * 1024 * 1024 && data.snapshots.length > 1) {
          data.snapshots.pop();
          json = JSON.stringify(data);
        }
        if (Buffer.byteLength(json) > 32 * 1024 * 1024) throw Error('Reliability history is full.');
        await writeFile(temp, json, { mode: 0o600 });
        await rename(temp, this.file);
        this.revision = digest(json);
      } finally {
        await handle.close();
        await rm(temp, { force: true });
        await rm(lock, { force: true });
      }
    });
    this.queue = work.catch(() => {});
    return work;
  }
}
