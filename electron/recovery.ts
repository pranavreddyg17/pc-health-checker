import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { recoveryTargets, type RecoveryCase } from '../src/shared/recovery';
import type { HealthSnapshot } from '../src/shared/reliability';
import { validSnapshot } from './reliability/store';

export class RecoveryStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private get file() {
    return path.join(this.directory, 'recovery.json');
  }
  async list(): Promise<RecoveryCase[]> {
    await this.queue;
    return this.read();
  }
  private async read(): Promise<RecoveryCase[]> {
    try {
      if ((await stat(this.file)).size > 16 * 1024 * 1024) throw Error('oversize');
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        !Array.isArray(data) ||
        data.length > 20 ||
        !data.every(
          (r: RecoveryCase) =>
            r &&
            typeof r.id === 'string' &&
            r.id.length <= 100 &&
            Number.isFinite(Date.parse(r.createdAt)) &&
            validSnapshot(r.baseline) &&
            Array.isArray(r.signalIds) &&
            r.signalIds.length > 0 &&
            r.signalIds.length <= 1536 &&
            new Set(r.signalIds).size === r.signalIds.length &&
            r.signalIds.every((id) => recoveryTargets(r.baseline).some((s) => s.id === id)) &&
            (!r.action ||
              (Number.isFinite(Date.parse(r.action.at)) &&
                typeof r.action.note === 'string' &&
                r.action.note.length > 0 &&
                r.action.note.length <= 2000)),
        )
      )
        throw Error('invalid');
      return data;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw Error('Recovery records could not be read. The existing file was preserved.');
    }
  }
  private update(change: (records: RecoveryCase[]) => RecoveryCase[]): Promise<RecoveryCase[]> {
    const job = this.queue.then(async () => {
      const records = change(await this.read());
      const text = JSON.stringify(records, null, 2);
      if (Buffer.byteLength(text) > 16 * 1024 * 1024)
        throw Error('Recovery evidence storage limit reached.');
      await mkdir(this.directory, { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
      await rename(temporary, this.file);
      return records;
    });
    this.queue = job.catch(() => {});
    return job;
  }
  create(snapshot: HealthSnapshot): Promise<RecoveryCase[]> {
    return this.update((records) => {
      if (!validSnapshot(snapshot) || Date.now() - Date.parse(snapshot.at) > 15 * 60_000)
        throw Error('Run a fresh reliability check before capturing a baseline.');
      const targets = recoveryTargets(snapshot);
      if (!targets.length) throw Error('No warning or critical evidence to verify.');
      if (records.length >= 20) throw Error('Remove an old verification before creating another.');
      return [
        {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          baseline: structuredClone(snapshot),
          signalIds: targets.map((s) => s.id),
        },
        ...records,
      ];
    });
  }
  action(id: unknown, note: unknown): Promise<RecoveryCase[]> {
    return this.update((records) => {
      if (typeof id !== 'string' || typeof note !== 'string' || !note.trim() || note.length > 2000)
        throw Error('Enter an action note of 1–2000 characters.');
      const record = records.find((r) => r.id === id);
      if (!record || record.action)
        throw Error(
          'This verification is missing or already has an action. Capture a new baseline for another change.',
        );
      record.action = { at: new Date().toISOString(), note: note.trim() };
      return records;
    });
  }
  remove(id: unknown): Promise<RecoveryCase[]> {
    return this.update((records) => records.filter((r) => r.id !== id));
  }
}
