export const RELIABILITY_VERSION = '0.7.0';
export const telemetryStates = [
  'readable',
  'not-applicable',
  'permission',
  'missing-tool',
  'unsupported',
  'error',
] as const;
export type TelemetryState = (typeof telemetryStates)[number];
export const telemetryNames: Record<TelemetryState, string> = {
  readable: 'Readable',
  'not-applicable': 'Not applicable to the detected hardware',
  permission: 'OS access denied',
  'missing-tool': 'Required tool missing',
  unsupported: 'Hardware / driver source unavailable',
  error: 'Collector failed or timed out',
};
export function telemetryCoverage(signals: HealthSignal[]) {
  const notApplicable = signals.filter((s) => s.availability === 'not-applicable').length;
  const readable = signals.filter(
    (s) =>
      s.availability === 'readable' ||
      (s.availability === undefined && (s.level !== 'unknown' || s.measurements.length > 0)),
  ).length;
  return { readable, notApplicable, unavailable: signals.length - readable - notApplicable };
}
export const categories = [
  'power',
  'storage',
  'filesystem',
  'memory',
  'thermal',
  'gpu',
  'network',
  'services',
  'system',
] as const;
export type HealthCategory = (typeof categories)[number];
export type HealthLevel = 'clear' | 'warning' | 'critical' | 'unknown';
export interface HealthSignal {
  id: string;
  category: HealthCategory;
  label: string;
  source: string;
  scope: string;
  observedAt: string;
  level: HealthLevel;
  availability?: TelemetryState;
  summary: string;
  action: string;
  limitation: string;
  measurements: { name: string; value: string | number; unit?: string }[];
  counter?: { value: number; epoch: string };
  trend?: {
    delta?: number;
    seconds?: number;
    state: 'baseline' | 'increased' | 'unchanged' | 'reset' | 'not-comparable';
  };
}
export interface HealthSnapshot {
  schemaVersion: 1;
  id: string;
  at: string;
  platform: string;
  ruleVersion: string;
  elapsedMs: number;
  signals: HealthSignal[];
}
export interface HealthAlert {
  id: string;
  signalId: string;
  at: string;
  lastSeen: string;
  level: HealthLevel;
  title: string;
  summary: string;
  action: string;
  occurrences: number;
  acknowledgedAt?: string;
}
export interface ReliabilityData {
  schemaVersion: 1;
  snapshots: HealthSnapshot[];
  alerts: HealthAlert[];
}
export interface MonitorState extends ReliabilityData {
  running: boolean;
  collecting: boolean;
  intervalSeconds: number;
  nextAt?: string;
  notifications: boolean;
  notificationSupport: boolean;
  warning?: string;
}
export const healthNames: Record<HealthLevel, string> = {
  clear: 'Within checked limits',
  warning: 'Investigate',
  critical: 'Action required',
  unknown: 'Not assessed',
};
export const categoryNames: Record<HealthCategory, string> = {
  power: 'Battery condition',
  storage: 'Storage integrity',
  filesystem: 'Filesystem capacity',
  memory: 'Memory / ECC',
  thermal: 'Cooling & power sensors',
  gpu: 'GPU reliability',
  network: 'Network errors',
  services: 'Service failures',
  system: 'System error evidence',
};
export function enrichTrends(snapshot: HealthSnapshot, previous?: HealthSnapshot): HealthSnapshot {
  return {
    ...snapshot,
    signals: snapshot.signals.map((s) => {
      if (!s.counter) return s;
      const before = previous?.signals.find((p) => p.id === s.id);
      const seconds = previous ? (Date.parse(snapshot.at) - Date.parse(previous.at)) / 1000 : 0;
      const resetBefore = before?.measurements.find(
        (m) => m.name === 'Seconds since driver reset',
      )?.value;
      const resetNow = s.measurements.find((m) => m.name === 'Seconds since driver reset')?.value;
      const sourceReset =
        typeof resetBefore === 'number' && typeof resetNow === 'number' && resetNow < resetBefore;
      const comparable =
        !sourceReset &&
        before?.counter &&
        before.source === s.source &&
        before.counter.epoch === s.counter.epoch &&
        previous?.platform === snapshot.platform &&
        previous?.ruleVersion === snapshot.ruleVersion &&
        seconds > 0 &&
        seconds <= 86400;
      const trend: HealthSignal['trend'] = !before?.counter
        ? { state: 'baseline' }
        : !comparable
          ? { state: 'not-comparable' }
          : s.counter.value < before.counter.value
            ? { state: 'reset' }
            : {
                state: s.counter.value > before.counter.value ? 'increased' : 'unchanged',
                delta: s.counter.value - before.counter.value,
                seconds,
              };
      return { ...s, trend };
    }),
  };
}
export function alertChanges(
  snapshot: HealthSnapshot,
  previous?: HealthSnapshot,
  alerts: HealthAlert[] = [],
): { alerts: HealthAlert[]; notify: HealthAlert[] } {
  const now = snapshot.at;
  const next = alerts.map((a) => ({ ...a }));
  const notify: HealthAlert[] = [];
  for (const s of snapshot.signals) {
    const before = previous?.signals.find((p) => p.id === s.id);
    const existing = next.find((a) => a.signalId === s.id && a.level === s.level);
    // Missing telemetry must never imply recovery. Warn once when an available probe is lost.
    const lost =
      s.availability !== 'not-applicable' &&
      before &&
      (s.availability === undefined
        ? s.level === 'unknown' && before.level !== 'unknown'
        : s.availability !== 'readable' && telemetryCoverage([before]).readable === 1);
    const active = s.level === 'warning' || s.level === 'critical' || lost;
    if (!active) continue;
    const first =
      !before || before.level !== s.level || (lost && telemetryCoverage([before]).readable === 1);
    const rising = s.trend?.state === 'increased';
    const repeatDue = !existing || Date.parse(now) - Date.parse(existing.at) >= 30 * 60 * 1000;
    if (first || (rising && repeatDue)) {
      const a: HealthAlert = {
        id: `${snapshot.id}:${s.id}`,
        signalId: s.id,
        at: now,
        lastSeen: now,
        level: lost ? 'unknown' : s.level,
        title: lost ? `Telemetry lost: ${s.label}` : s.label,
        summary: s.summary,
        action: s.action,
        occurrences: 1,
      };
      next.unshift(a);
      if (s.level !== 'unknown' || lost) notify.push(a);
    } else if (existing) {
      existing.lastSeen = now;
      existing.summary = s.summary;
      existing.action = s.action;
      existing.occurrences++;
    }
  }
  return { alerts: next.slice(0, 200), notify };
}
export function trendText(signal: HealthSignal): string | undefined {
  const t = signal.trend;
  if (!t) return;
  if (t.state === 'increased')
    return `+${t.delta} since the previous sample (${Math.round(t.seconds!)} seconds).`;
  if (t.state === 'unchanged')
    return 'Counter unchanged since the previous comparable sample. Historical errors remain recorded.';
  if (t.state === 'reset')
    return 'Counter decreased: reset or device reinitialization; no error rate calculated.';
  if (t.state === 'not-comparable')
    return 'Baseline changed or the sampling gap exceeded 24 hours; no delta calculated.';
  return 'First observation of this counter. Its age is unknown; no increase has been established.';
}
export function healthExitCode(s: HealthSnapshot): number {
  if (!s.signals.length) return 3;
  return s.signals.some((c) => c.level === 'critical')
    ? 2
    : s.signals.some((c) => c.level === 'warning')
      ? 1
      : s.signals.some((c) => c.level === 'unknown' && c.availability !== 'not-applicable')
        ? 3
        : 0;
}
