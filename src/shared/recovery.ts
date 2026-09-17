import type { HealthSnapshot, HealthSignal } from './reliability';

export interface RecoveryCase {
  id: string;
  createdAt: string;
  baseline: HealthSnapshot;
  signalIds: string[];
  action?: { at: string; note: string };
}
export interface RecoveryVerdict {
  state: 'awaiting-action' | 'inconclusive' | 'fault-present' | 'observing' | 'stable';
  title: string;
  detail: string;
  passing: number;
  required: number;
  observations: { at: string; result: string }[];
}
export const recoveryTargets = (snapshot: HealthSnapshot) =>
  snapshot.signals.filter((s) => s.level === 'warning' || s.level === 'critical');
const readable = (s: HealthSignal) => s.availability === 'readable';

// A verification policy, not a statistically validated prediction model.
// Require three independent observations spanning at least two minutes.
export function verifyRecovery(
  record: RecoveryCase,
  snapshots: HealthSnapshot[],
  now = Date.now(),
): RecoveryVerdict {
  const base = { passing: 0, required: 3, observations: [] as RecoveryVerdict['observations'] };
  if (!record.action)
    return {
      ...base,
      state: 'awaiting-action',
      title: 'Record your action first',
      detail:
        'The original fault evidence is preserved. Review the recommended steps, perform an approved action, then record what changed.',
    };
  const after = [
    ...new Map(
      snapshots
        .filter((s) => Date.parse(s.at) > Date.parse(record.action!.at) && Date.parse(s.at) <= now)
        .map((s) => [s.id, s]),
    ).values(),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!after.length)
    return {
      ...base,
      state: 'observing',
      title: 'Waiting for follow-up evidence',
      detail:
        'Run reliability checks after the action, or opt in to monitoring. Three comparable observations spanning at least two minutes are required.',
    };
  const latest = after[0];
  if (now - Date.parse(latest.at) > 15 * 60_000)
    return {
      ...base,
      state: 'inconclusive',
      title: 'Evidence is stale',
      detail: 'Run another reliability check. The latest follow-up is more than 15 minutes old.',
    };
  let passing = 0;
  const observations: RecoveryVerdict['observations'] = [];
  let firstPass: number | undefined;
  const seenTimes = new Set<number>();
  let previousTime = Date.parse(latest.at);
  for (const sample of after) {
    const time = Date.parse(sample.at);
    if (seenTimes.has(time)) continue;
    seenTimes.add(time);
    // Widely separated or old observations do not establish sustained stability.
    if (now - time > 60 * 60_000 || previousTime - time > 20 * 60_000) break;
    previousTime = time;
    let result = 'Within the verification policy';
    let failure: 'inconclusive' | 'fault-present' | undefined;
    if (
      sample.platform !== record.baseline.platform ||
      sample.ruleVersion !== record.baseline.ruleVersion
    ) {
      failure = 'inconclusive';
      result = 'Platform or interpretation rules changed.';
    }
    for (const id of record.signalIds) {
      if (failure) break;
      const before = record.baseline.signals.find((s) => s.id === id);
      const current = sample.signals.find((s) => s.id === id);
      if (
        !before ||
        !current ||
        !readable(before) ||
        !readable(current) ||
        before.source !== current.source ||
        before.scope !== current.scope ||
        Date.parse(current.observedAt) <= Date.parse(record.action.at) ||
        Math.abs(Date.parse(current.observedAt) - Date.parse(sample.at)) > 120_000
      ) {
        failure = 'inconclusive';
        result = 'A target source is missing, unreadable, stale or no longer comparable.';
        break;
      }
      if (before.counter || current.counter) {
        // Counter reset or reboot is not recovery. We only assess whether this
        // error counter has accumulated new errors since the captured baseline.
        if (
          !before.counter ||
          !current.counter ||
          before.counter.epoch !== current.counter.epoch ||
          current.counter.value < before.counter.value
        ) {
          failure = 'inconclusive';
          result = 'An error counter reset or its identity changed; recovery cannot be inferred.';
        } else if (current.counter.value > before.counter.value || current.level === 'critical') {
          failure = 'fault-present';
          result = 'New errors accumulated or a critical condition remains.';
        } else if (current.level === 'unknown') {
          failure = 'inconclusive';
          result = 'The target condition is unassessed.';
        }
      } else if (current.level === 'unknown') {
        failure = 'inconclusive';
        result = 'The target condition is unassessed.';
      } else if (current.level !== 'clear') {
        failure = 'fault-present';
        result = 'At least one original fault is still reported.';
      }
    }
    const regression = sample.signals.find(
      (s) =>
        s.level === 'critical' &&
        !record.signalIds.includes(s.id) &&
        record.baseline.signals.find((b) => b.id === s.id)?.level !== 'critical',
    );
    if (regression) {
      failure = 'fault-present';
      result = `A new critical finding blocks verification: ${regression.label}.`;
    }
    observations.push({ at: sample.at, result });
    if (failure) {
      if (passing === 0)
        return {
          ...base,
          passing,
          observations,
          state: failure,
          title:
            failure === 'inconclusive' ? 'Recovery cannot be verified' : 'Fault evidence remains',
          detail: result,
        };
      break;
    }
    passing++;
    firstPass = Date.parse(sample.at);
    if (passing >= 3 && Date.parse(latest.at) - firstPass >= 120_000) break;
  }
  const span = firstPass === undefined ? 0 : Date.parse(latest.at) - firstPass;
  const stable = passing >= 3 && span >= 120_000;
  return {
    passing,
    required: 3,
    observations,
    state: stable ? 'stable' : 'observing',
    title: stable ? 'Stable within the observed checks' : 'Gathering sustained evidence',
    detail: stable
      ? 'The selected faults cleared or their error counters stopped increasing across at least three checks over two minutes. This is observed stability, not proof of physical repair or that the action caused it. Repeat the original workload.'
      : `${passing} comparable checks so far; ${Math.floor(span / 1000)} seconds observed. Require three consecutive comparable checks spanning at least 120 seconds.`,
  };
}
