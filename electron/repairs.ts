import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  captureEvidence,
  repairAssessment,
  repairFlows,
  REPAIR_RULE_VERSION,
  type NewRepair,
  type RepairCase,
  type RepairCommand,
  type RepairEntry,
  type ScanEvidence,
} from '../src/shared/repairs';
import type { Scan } from '../src/shared/types';
const text = (v: unknown, max: number, min = 0): v is string =>
  typeof v === 'string' && v.length >= min && v.length <= max;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d-]{36}$/.test(v);
const date = (v: unknown) => text(v, 40, 1) && Number.isFinite(Date.parse(v));
const kinds = ['storage', 'battery', 'cpu', 'memory', 'gpu', 'cooling', 'system'];
export function validNewRepair(value: unknown): value is NewRepair {
  const c = value as NewRepair;
  return Boolean(
    c &&
    Object.hasOwn(repairFlows, c.symptom) &&
    repairFlows[c.symptom].patterns.some((p) => p.id === c.pattern) &&
    ['this-device', 'other-device'].includes(c.target) &&
    text(c.device, 120, 1) &&
    c.device.trim() &&
    text(c.description, 2000, 1) &&
    c.description.trim() &&
    typeof c.hazard === 'boolean',
  );
}
function validEvidence(s: ScanEvidence): boolean {
  return Boolean(
    s &&
    id(s.id) &&
    date(s.at) &&
    text(s.machine, 500) &&
    ['darwin', 'win32', 'linux'].includes(s.platform) &&
    typeof s.partial === 'boolean' &&
    Number.isInteger(s.completed) &&
    Number.isInteger(s.total) &&
    s.completed >= 0 &&
    s.completed <= s.total &&
    s.total <= 5000 &&
    Array.isArray(s.findings) &&
    s.findings.length <= 500 &&
    s.findings.every(
      (f) =>
        f &&
        kinds.includes(f.kind) &&
        text(f.title, 2000) &&
        text(f.action, 5000) &&
        ['info', 'attention', 'urgent'].includes(f.severity) &&
        Array.isArray(f.evidence) &&
        f.evidence.length <= 100 &&
        f.evidence.every((e) => text(e, 5000)),
    ) &&
    Array.isArray(s.measurements) &&
    s.measurements.length <= 5000 &&
    s.measurements.every(
      (m) =>
        m &&
        kinds.includes(m.kind) &&
        ['component', 'key', 'label', 'value', 'source'].every((k) =>
          text(m[k as keyof typeof m], 5000),
        ),
    ),
  );
}
export function validRepair(c: unknown): c is RepairCase {
  const r = c as RepairCase;
  return Boolean(
    validNewRepair(r) &&
    r.schemaVersion === 1 &&
    id(r.id) &&
    date(r.createdAt) &&
    date(r.updatedAt) &&
    text(r.ruleVersion, 40, 1) &&
    ['open', 'resolved'].includes(r.status) &&
    Array.isArray(r.scans) &&
    r.scans.length <= 6 &&
    r.scans.every(validEvidence) &&
    (r.target !== 'other-device' || r.scans.length === 0) &&
    Array.isArray(r.entries) &&
    r.entries.length <= 100 &&
    r.entries.every((e) => e && id(e.id) && date(e.at) && validEntry(r, e)),
  );
}
function validEntry(c: RepairCase, e: Omit<RepairEntry, 'id' | 'at'>): boolean {
  return Boolean(
    e &&
    text(e.note, 2000) &&
    ((e.kind === 'action' &&
      e.note.trim().length > 0 &&
      e.testId === undefined &&
      e.outcome === undefined &&
      e.status === undefined) ||
      (e.kind === 'status' &&
        e.testId === undefined &&
        e.outcome === undefined &&
        ['open', 'resolved'].includes(e.status ?? '') &&
        e.note.trim().length > 0) ||
      (e.kind === 'test' &&
        e.status === undefined &&
        repairFlows[c.symptom].tests.some((t) => t.id === e.testId) &&
        ['observed', 'not-observed', 'inconclusive'].includes(e.outcome ?? ''))),
  );
}
export class RepairStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory: string) {}
  private get file() {
    return path.join(this.directory, 'repairs.json');
  }
  async load(): Promise<RepairCase[]> {
    try {
      if ((await stat(this.file)).size > 16 * 1024 * 1024) throw Error('Too large');
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (
        !Array.isArray(data) ||
        data.length > 30 ||
        !data.every(validRepair) ||
        new Set(data.map((c) => c.id)).size !== data.length
      )
        throw Error('Invalid schema');
      return data;
    } catch (e: any) {
      if (e.code === 'ENOENT') return [];
      throw Error(
        'Repair cases could not be read. Existing data has been preserved; no changes were saved.',
      );
    }
  }
  private change(fn: (cases: RepairCase[]) => void): Promise<RepairCase[]> {
    const work = this.queue.then(async () => {
      const cases = await this.load();
      fn(cases);
      if (!cases.every(validRepair)) throw Error('Invalid repair case data.');
      const serialized = JSON.stringify(cases);
      if (Buffer.byteLength(serialized) > 16 * 1024 * 1024)
        throw Error('Repair case storage is full. Export and remove an old case.');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(this.file + '.tmp', serialized, { mode: 0o600 });
      await rename(this.file + '.tmp', this.file);
      return cases;
    });
    this.queue = work.catch(() => {});
    return work;
  }
  create(input: unknown, scan?: Scan) {
    if (!validNewRepair(input))
      return Promise.reject(
        Error('Choose a symptom and pattern, and enter a device label and description.'),
      );
    return this.change((cases) => {
      if (cases.length >= 30) throw Error('30-case limit reached. Export and remove a case first.');
      const now = new Date().toISOString();
      // Copy only recognized fields. Scans are supplied by the trusted main process.
      cases.unshift({
        schemaVersion: 1,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        ruleVersion: REPAIR_RULE_VERSION,
        symptom: input.symptom,
        pattern: input.pattern,
        target: input.target,
        device: input.device.trim(),
        description: input.description.trim(),
        hazard: input.hazard,
        status: 'open',
        entries: [],
        scans: input.target === 'this-device' && scan ? [captureEvidence(scan)] : [],
      });
    });
  }
  update(caseId: unknown, input: unknown, scan?: Scan) {
    return this.change((cases) => {
      const c = cases.find((c) => c.id === caseId);
      if (!c) throw Error('Repair case not found.');
      const command = input as RepairCommand;
      if (!command || typeof command !== 'object') throw Error('Invalid case action.');
      if (command.kind === 'attach-scan') {
        if (c.target !== 'this-device')
          throw Error('Host scans cannot be attached to a case for another computer.');
        if (!scan) throw Error('Run a hardware scan first.');
        if (c.scans.some((s) => s.id === scan.id))
          throw Error('This scan is already attached. Run a new scan after the change.');
        if (c.scans.length >= 6) throw Error('This case already has six attached scans.');
        c.scans.push(captureEvidence(scan));
      } else {
        if (!validEntry(c, command))
          throw Error('Enter a valid test result or a note for this action.');
        if (c.entries.length >= 100) throw Error('This case already has 100 log entries.');
        if (c.status === 'resolved' && !(command.kind === 'status' && command.status === 'open'))
          throw Error('Reopen this case before adding results.');
        if (command.kind === 'test' && repairAssessment(c).stop)
          throw Error(
            'Testing is on hold. Address the recorded safety or data-protection concern first.',
          );
        const entry: RepairEntry = {
          id: randomUUID(),
          at: new Date().toISOString(),
          kind: command.kind,
          note: command.note.trim(),
        };
        if (command.kind === 'test') {
          entry.testId = command.testId;
          entry.outcome = command.outcome;
        }
        if (command.kind === 'status') {
          entry.status = command.status;
          c.status = command.status;
        }
        c.entries.push(entry);
      }
      c.updatedAt = new Date().toISOString();
    });
  }
  remove(caseId: unknown) {
    return this.change((cases) => {
      const index = cases.findIndex((c) => c.id === caseId);
      if (index < 0) throw Error('Repair case not found.');
      cases.splice(index, 1);
    });
  }
}
