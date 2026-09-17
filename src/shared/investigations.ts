import type { Platform } from './types';

export const INVESTIGATION_RULE_VERSION = '0.3.0';
export type PowerContext = 'plugged-in' | 'battery' | 'unknown';
export interface CaseInput {
  workload: string;
  onset: 'recent' | 'always' | 'unsure';
  change: string;
}
export interface ObservationInput {
  caseId: string;
  durationSeconds: 60 | 180 | 300 | 600;
  power: PowerContext;
  includeApps: boolean;
  action: string;
}
export interface ResourceSample {
  atMs: number;
  cpuPercent?: number;
  busiestCorePercent?: number;
  availableMemoryMB?: number;
  pagingOutPerSec?: number;
  memoryWaitPercent?: number;
  ioWaitPercent?: number;
  diskMBps?: number;
  apps?: { name: string; cpuPercent: number; memoryMB: number }[];
}
export interface Observation {
  id: string;
  startedAt: string;
  completedAt?: string;
  durationSeconds: number;
  elapsedMs: number;
  platform: Platform;
  ruleVersion: string;
  state: 'recording' | 'complete' | 'stopped' | 'suspended' | 'interrupted' | 'error';
  power: PowerContext;
  observedPower: PowerContext[];
  includeApps: boolean;
  action: string;
  samples: ResourceSample[];
  markers: number[];
  coverage: string[];
  system: { logicalCores: number; memoryMB: number };
  freeSpacePercent?: number;
  outcome: 'not-recorded' | 'improved' | 'unchanged' | 'worse' | 'not-reproduced';
}
export interface Investigation extends CaseInput {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  symptom: 'slow';
  observations: Observation[];
}
export interface InvestigationSnapshot {
  cases: Investigation[];
  active?: { caseId: string; observation: Observation };
  warning?: string;
}
export interface InvestigationSignal {
  key: string;
  title: string;
  evidence: string;
  limitation: string;
  action: string;
}
export const average = (values: (number | undefined)[]) => {
  const valid = values.filter((v): v is number => v !== undefined && Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : undefined;
};
export function durationLabel(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
// Sustained signals use only measured intervals; missing/long gaps never count as pressure.
export function sustainedMs(o: Observation, test: (s: ResourceSample) => boolean) {
  let total = 0;
  for (let i = 1; i < o.samples.length; i++) {
    const gap = o.samples[i].atMs - o.samples[i - 1].atMs;
    if (gap > 0 && gap <= 7000 && test(o.samples[i]) && test(o.samples[i - 1])) total += gap;
  }
  return total;
}
export function observationSignals(o: Observation): InvestigationSignal[] {
  const signals: InvestigationSignal[] = [];
  if (o.samples.length < 10 || o.elapsedMs < 30000) return signals;
  const sustained = (predicate: (s: ResourceSample) => boolean) => {
    const ms = sustainedMs(o, predicate);
    return ms >= 20000 && ms >= o.elapsedMs * 0.2 ? ms : 0;
  };
  const cpu = sustained((s) => (s.cpuPercent ?? -1) >= 80);
  const core = sustained((s) => (s.busiestCorePercent ?? -1) >= 95);
  if (cpu || core)
    signals.push({
      key: 'cpu-demand',
      title: cpu
        ? 'Sustained processor demand deserves a comparison'
        : 'One processor core was frequently busy',
      evidence: `${durationLabel(cpu || core)} of measured intervals had ${cpu ? 'at least 80% total CPU use' : 'a core at 95% or more'}.`,
      limitation:
        'These are investigation thresholds, not hardware limits. Demanding work, background activity, and the observer itself can contribute. This does not establish a worn or faulty CPU.',
      action:
        'Save your work, close one unneeded busy app normally, then repeat the same workload. Do not end unfamiliar system processes.',
    });
  const memory = sustained(
    (s) => (s.memoryWaitPercent ?? -1) >= 5 || (s.pagingOutPerSec ?? -1) >= 10,
  );
  if (memory)
    signals.push({
      key: 'memory-pressure',
      title: 'Memory-related waiting or paging deserves a closer look',
      evidence: `${durationLabel(memory)} of measured intervals showed at least 5% memory wait or 10 page-outs per second.`,
      limitation:
        'Paging can be influenced by other workloads. These provisional thresholds identify a useful comparison, not defective RAM or a proven need to buy memory. Page units vary by OS.',
      action:
        'Save your work and reduce one memory-heavy workload, such as unused browser tabs. Repeat the observation before considering a RAM upgrade.',
    });
  const io = sustained((s) => (s.ioWaitPercent ?? -1) >= 10);
  if (io)
    signals.push({
      key: 'io-pressure',
      title: 'Tasks spent time waiting for storage I/O',
      evidence: `${durationLabel(io)} of measured intervals had at least 10% I/O waiting.`,
      limitation:
        'This is system-wide waiting, not a fault diagnosis or a specific drive measurement. Paging and normal file activity can contribute.',
      action:
        'Let a known copy, sync, or installation finish and repeat the same work. Check the separate hardware scan for storage warnings.',
    });
  if (o.freeSpacePercent !== undefined && o.freeSpacePercent < 10)
    signals.push({
      key: 'free-space',
      title: 'The home volume has limited free space',
      evidence: `${o.freeSpacePercent.toFixed(1)}% was available at the start of this recording.`,
      limitation:
        'Free space is separate from drive health. The home volume may not be the drive involved in your symptom; other volumes were not assessed here.',
      action:
        'Review storage in your operating system and back up important files before deciding what to move or remove. PC Health does not delete files.',
    });
  return signals;
}
export function compareObservations(
  before: Observation,
  after: Observation,
): { comparable: boolean; notes: string[] } {
  const notes: string[] = [];
  if (
    before.platform !== after.platform ||
    before.system.logicalCores !== after.system.logicalCores ||
    before.system.memoryMB !== after.system.memoryMB
  )
    notes.push('The system or hardware configuration differs.');
  if (before.power === 'unknown' || after.power === 'unknown' || before.power !== after.power)
    notes.push('The stated power conditions differ or are unknown.');
  if (
    before.observedPower.length !== 1 ||
    after.observedPower.length !== 1 ||
    before.observedPower[0] !== after.observedPower[0] ||
    before.observedPower[0] === 'unknown'
  )
    notes.push(
      'Matching power conditions could not be confirmed at the sampled points in both sessions.',
    );
  if (
    [before, after].some(
      (o) => o.power !== 'unknown' && o.observedPower.some((p) => p !== 'unknown' && p !== o.power),
    )
  )
    notes.push('The observed power source conflicts with the power condition you selected.');
  if (before.ruleVersion !== after.ruleVersion)
    notes.push('The investigation rule versions differ.');
  if (
    [before, after].some((o) =>
      o.samples.some((s, i) => i > 0 && s.atMs - o.samples[i - 1].atMs > 7000),
    )
  )
    notes.push('A recording contains gaps in the sampled evidence.');
  if (before.state !== 'complete' || after.state !== 'complete')
    notes.push('At least one recording ended early.');
  if (
    before.elapsedMs < 30000 ||
    after.elapsedMs < 30000 ||
    before.samples.length < 10 ||
    after.samples.length < 10
  )
    notes.push('At least one recording is too short for a useful comparison.');
  if (
    Math.max(before.elapsedMs, after.elapsedMs) >
    1.5 * Math.min(before.elapsedMs, after.elapsedMs)
  )
    notes.push('The recording durations differ substantially.');
  const comparable = !notes.length;
  for (const [key, label, unit] of [
    ['cpuPercent', 'Average CPU demand', '%'],
    ['pagingOutPerSec', 'Average paging-out rate', ' pages/s'],
    ['memoryWaitPercent', 'Average memory wait', '%'],
    ['ioWaitPercent', 'Average I/O wait', '%'],
  ] as const) {
    const a = average(before.samples.map((s) => s[key]));
    const b = average(after.samples.map((s) => s[key]));
    if (a !== undefined && b !== undefined)
      notes.push(`${label}: ${a.toFixed(1)}${unit} → ${b.toFixed(1)}${unit}.`);
  }
  notes.push(
    'These are observations, not proof that a change caused an improvement. Confirm that you repeated the same workload and consider your symptom outcome.',
  );
  return { comparable, notes };
}
const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function investigationReport(c: Investigation) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"><title>PC Health investigation</title><style>body{font:16px/1.6 system-ui;color:#263d32;max-width:850px;margin:40px auto;padding:20px}section{border-top:1px solid #ddd;margin-top:24px}small{color:#4c5d51}</style><h1>Slowness investigation</h1><p><b>Workload:</b> ${escape(c.workload)}</p><p><b>Onset:</b> ${escape(c.onset)} · <b>Recent changes:</b> ${escape(c.change || 'Not specified')}</p><p>Local, manually started observations. No hardware failure or compatibility verdict is established by resource demand alone. App names and raw samples are excluded. Workload, change, and action notes are included as previewed by the user.</p>${c.observations
    .map(
      (o) =>
        `<section><h2>${escape(new Date(o.startedAt).toLocaleString())}</h2><p>${escape(o.state)} · ${durationLabel(o.elapsedMs)} · ${escape(o.platform)} · Rules ${escape(o.ruleVersion)}</p><p>Stated power: ${escape(o.power)} · observed: ${escape(o.observedPower.join(', ') || 'unknown')}</p><p>Action: ${escape(o.action || 'Baseline')} · User-reported outcome: ${escape(o.outcome)}</p><p>Symptom markers: ${o.markers.map(durationLabel).join(', ') || 'None recorded'}</p>${
          observationSignals(o)
            .map(
              (s) =>
                `<h3>${escape(s.title)}</h3><p>${escape(s.evidence)}</p><p>${escape(s.action)}</p><small>${escape(s.limitation)}</small>`,
            )
            .join('') ||
          '<p>No sustained investigation signal in the readable sample. This does not rule out the reported problem.</p>'
        }<h3>Coverage and limitations</h3><ul>${o.coverage.map((x) => `<li>${escape(x)}</li>`).join('')}</ul></section>`,
    )
    .join('')}${
    c.observations.length >= 2
      ? `<section><h2>Most recent comparison</h2><ul>${compareObservations(
          c.observations.at(-2)!,
          c.observations.at(-1)!,
        )
          .notes.map((n) => `<li>${escape(n)}</li>`)
          .join('')}</ul></section>`
      : ''
  }</html>`;
}
