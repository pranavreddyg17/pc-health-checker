import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  CaseInput,
  Investigation,
  InvestigationSnapshot,
  Observation,
  ObservationInput,
} from '../src/shared/investigations';
import { createObservation, recordObservation } from './observation/sampler';

const id = (x: unknown): x is string => typeof x === 'string' && /^[\da-f-]{36}$/.test(x);
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const finite = (x: unknown, max = 1e15) =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;
const date = (x: unknown) => typeof x === 'string' && Number.isFinite(Date.parse(x));
const power = (x: unknown) => ['plugged-in', 'battery', 'unknown'].includes(String(x));
export function validCaseInput(v: unknown): v is CaseInput {
  const c = v as CaseInput;
  return Boolean(
    c &&
    text(c.workload, 160) &&
    c.workload.trim() &&
    ['recent', 'always', 'unsure'].includes(c.onset) &&
    text(c.change, 300),
  );
}
export function validObservationInput(v: unknown): v is ObservationInput {
  const o = v as ObservationInput;
  return Boolean(
    o &&
    id(o.caseId) &&
    [60, 180, 300, 600].includes(o.durationSeconds) &&
    power(o.power) &&
    typeof o.includeApps === 'boolean' &&
    text(o.action, 300),
  );
}
export function isObservation(value: unknown): value is Observation {
  const o = value as Observation;
  return Boolean(
    o &&
    id(o.id) &&
    date(o.startedAt) &&
    (o.completedAt === undefined || date(o.completedAt)) &&
    [60, 180, 300, 600].includes(o.durationSeconds) &&
    finite(o.elapsedMs, 610000) &&
    ['darwin', 'win32', 'linux'].includes(o.platform) &&
    text(o.ruleVersion, 40) &&
    ['recording', 'complete', 'stopped', 'suspended', 'interrupted', 'error'].includes(o.state) &&
    power(o.power) &&
    Array.isArray(o.observedPower) &&
    o.observedPower.length <= 3 &&
    o.observedPower.every(power) &&
    typeof o.includeApps === 'boolean' &&
    text(o.action, 300) &&
    ['not-recorded', 'improved', 'unchanged', 'worse', 'not-reproduced'].includes(o.outcome) &&
    o.system &&
    finite(o.system.logicalCores, 10000) &&
    finite(o.system.memoryMB) &&
    (o.freeSpacePercent === undefined || finite(o.freeSpacePercent, 100)) &&
    Array.isArray(o.coverage) &&
    o.coverage.length <= 30 &&
    o.coverage.every((x) => text(x, 800)) &&
    Array.isArray(o.markers) &&
    o.markers.length <= 50 &&
    o.markers.every((x) => finite(x, 610000)) &&
    Array.isArray(o.samples) &&
    o.samples.length <= 601 &&
    o.samples.every(
      (s, i) =>
        s &&
        finite(s.atMs, 610000) &&
        (i === 0 || s.atMs > o.samples[i - 1].atMs) &&
        ['cpuPercent', 'busiestCorePercent', 'memoryWaitPercent', 'ioWaitPercent'].every(
          (key) => (s as any)[key] === undefined || finite((s as any)[key], 100),
        ) &&
        ['availableMemoryMB', 'pagingOutPerSec', 'diskMBps'].every(
          (key) => (s as any)[key] === undefined || finite((s as any)[key]),
        ) &&
        (s.apps === undefined ||
          (Array.isArray(s.apps) &&
            s.apps.length <= 5 &&
            s.apps.every(
              (a) => a && text(a.name, 80) && finite(a.cpuPercent, 100) && finite(a.memoryMB),
            ))),
    ),
  );
}
export function isInvestigation(value: unknown): value is Investigation {
  const c = value as Investigation;
  return Boolean(
    validCaseInput(c) &&
    c.schemaVersion === 1 &&
    id(c.id) &&
    date(c.createdAt) &&
    date(c.updatedAt) &&
    c.symptom === 'slow' &&
    Array.isArray(c.observations) &&
    c.observations.length <= 6 &&
    c.observations.every(isObservation),
  );
}
export class InvestigationStore {
  private tail: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  get file() {
    return path.join(this.directory, 'investigations.json');
  }
  async load(): Promise<Investigation[]> {
    try {
      if ((await stat(this.file)).size > 32 * 1024 ** 2) throw new Error('Too large');
      const data: unknown = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(data) || data.length > 20 || !data.every(isInvestigation))
        throw new Error('Invalid case data');
      return data;
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw new Error(
        'Saved investigations could not be read. The file has been preserved; hardware scan history is unaffected.',
      );
    }
  }
  save(cases: Investigation[]) {
    const write = async () => {
      // Validate and read before replacement so corruption is never silently overwritten.
      await this.load();
      if (cases.length > 20 || !cases.every(isInvestigation))
        throw new Error('Invalid investigation');
      const content = JSON.stringify(cases);
      if (Buffer.byteLength(content) > 32 * 1024 ** 2)
        throw new Error('Investigation storage limit reached. Export and remove older cases.');
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(`${this.file}.tmp`, content, { mode: 0o600 });
      await rename(`${this.file}.tmp`, this.file);
    };
    const task = this.tail.then(write);
    this.tail = task.catch(() => {});
    return task;
  }
}
export class InvestigationService {
  private cases: Investigation[] = [];
  private warning?: string;
  private ready: Promise<void>;
  private controller?: AbortController;
  private active?: { caseId: string; observation: Observation };
  private recordingOrigin = 0;
  private mutating = false;
  constructor(
    private store: InvestigationStore,
    private publish: (snapshot: InvestigationSnapshot) => void,
  ) {
    this.ready = this.initialize();
  }
  private async initialize() {
    try {
      this.cases = await this.store.load();
      let changed = false;
      for (const c of this.cases)
        for (const o of c.observations)
          if (o.state === 'recording') {
            o.state = 'interrupted';
            o.completedAt = new Date().toISOString();
            o.coverage.push(
              'The app closed before this recording finished. Only checkpointed evidence is retained.',
            );
            changed = true;
          }
      if (changed) await this.store.save(this.cases);
    } catch (error) {
      this.warning = (error as Error).message;
    }
  }
  get busy() {
    return Boolean(this.controller || this.mutating);
  }
  async snapshot(): Promise<InvestigationSnapshot> {
    await this.ready;
    return this.snapshotNow();
  }
  private snapshotNow(): InvestigationSnapshot {
    return { cases: this.cases, active: this.active, warning: this.warning };
  }
  private async edit(work: () => void) {
    await this.ready;
    if (this.busy) throw new Error('Finish the active operation first.');
    if (this.warning) throw new Error(this.warning);
    this.mutating = true;
    const old = structuredClone(this.cases);
    try {
      work();
      await this.store.save(this.cases);
      return this.snapshotNow();
    } catch (error) {
      this.cases = old;
      throw error;
    } finally {
      this.mutating = false;
    }
  }
  async create(input: unknown) {
    if (!validCaseInput(input)) throw new Error('Enter a workload and valid onset.');
    return this.edit(() => {
      if (this.cases.length >= 20)
        throw new Error('Export and remove an older investigation before creating another.');
      const now = new Date().toISOString();
      this.cases.unshift({
        workload: input.workload.trim(),
        onset: input.onset,
        change: input.change,
        schemaVersion: 1,
        id: randomUUID(),
        symptom: 'slow',
        createdAt: now,
        updatedAt: now,
        observations: [],
      });
    });
  }
  async remove(caseId: unknown) {
    if (!id(caseId)) throw new Error('Invalid investigation');
    return this.edit(() => {
      this.cases = this.cases.filter((c) => c.id !== caseId);
    });
  }
  async outcome(caseId: unknown, observationId: unknown, outcome: unknown) {
    if (
      !id(caseId) ||
      !id(observationId) ||
      !['improved', 'unchanged', 'worse', 'not-reproduced', 'not-recorded'].includes(
        String(outcome),
      )
    )
      throw new Error('Invalid outcome');
    return this.edit(() => {
      const c = this.cases.find((c) => c.id === caseId);
      const o = c?.observations.find((o) => o.id === observationId);
      if (!c || !o) throw new Error('Recording not found');
      o.outcome = outcome as Observation['outcome'];
      c.updatedAt = new Date().toISOString();
    });
  }
  async start(input: unknown) {
    await this.ready;
    if (!validObservationInput(input)) throw new Error('Invalid recording options');
    if (this.busy) throw new Error('A recording is already active.');
    if (this.warning) throw new Error(this.warning);
    const c = this.cases.find((c) => c.id === input.caseId);
    if (!c) throw new Error('Investigation not found');
    if (c.observations.length && !input.action.trim())
      throw new Error('Describe your change, or enter No change for a repeat baseline.');
    if (c.observations.length >= 6)
      throw new Error('This case has six recordings. Start a new investigation to continue.');
    const controller = new AbortController();
    this.controller = controller;
    const observation = createObservation(input);
    c.observations.push(observation);
    c.updatedAt = observation.startedAt;
    this.active = { caseId: c.id, observation };
    try {
      await this.store.save(this.cases);
    } catch (error) {
      c.observations.pop();
      this.active = undefined;
      this.controller = undefined;
      throw error;
    }
    this.recordingOrigin = performance.now();
    void this.record(c, observation, controller);
    return this.snapshotNow();
  }
  private async record(c: Investigation, o: Observation, controller: AbortController) {
    await recordObservation(
      o,
      controller.signal,
      () => {
        if (o.state === 'recording') this.publish(this.snapshotNow());
      },
      () => this.store.save(this.cases),
    );
    c.updatedAt = o.completedAt!;
    try {
      await this.store.save(this.cases);
    } catch {
      this.warning =
        'The latest recording could not be saved. Keep this window open and export the case; previous checkpoints are preserved.';
    }
    this.active = undefined;
    this.controller = undefined;
    this.publish(this.snapshotNow());
  }
  stop(reason: 'stopped' | 'suspended' | 'interrupted' = 'stopped') {
    if (this.active && this.active.observation.state === 'recording')
      this.active.observation.state = reason;
    this.controller?.abort();
  }
  mark() {
    if (!this.active || this.active.observation.state !== 'recording')
      throw new Error('No recording is active');
    const o = this.active.observation;
    if (o.markers.length >= 50) throw new Error('The marker limit has been reached');
    o.markers.push(
      Math.min(o.durationSeconds * 1000, Math.round(performance.now() - this.recordingOrigin)),
    );
    this.publish(this.snapshotNow());
  }
}
