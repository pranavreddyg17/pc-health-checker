import { useState } from 'react';
import Recovery from './Recovery';
import {
  Activity,
  ArrowDownToLine,
  Bell,
  Check,
  Clock3,
  Play,
  ShieldCheck,
  Square,
  TriangleAlert,
} from './ui/Glyphs';
import {
  categories,
  categoryNames,
  healthNames,
  telemetryNames,
  telemetryCoverage,
  trendText,
  type HealthCategory,
  type HealthLevel,
  type MonitorState,
} from './shared/reliability';
const when = (s: string) => new Date(s).toLocaleString();
const rank: Record<HealthLevel, number> = { critical: 0, warning: 1, unknown: 2, clear: 3 };
export default function Reliability({
  state,
  blocked,
  onChange,
}: {
  state?: MonitorState;
  blocked: boolean;
  onChange: (s: MonitorState) => void;
}) {
  const [interval, setInterval] = useState(300),
    [notifications, setNotifications] = useState(false);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [category, setCategory] = useState<HealthCategory | 'all'>('all');
  const [level, setLevel] = useState<HealthLevel | 'all'>('all');
  const [selected, setSelected] = useState('latest'),
    [exportPreview, setExportPreview] = useState(false);
  const sample = state?.snapshots.find((s) => s.id === selected) ?? state?.snapshots[0];
  const disabled = pending || Boolean(state?.collecting) || !window.pcHealth || !state;
  async function act(run: () => Promise<unknown>) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      await run();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : 'The operation could not complete.',
      );
    } finally {
      setPending(false);
    }
  }
  const visible =
    sample?.signals
      .filter(
        (s) =>
          (category === 'all' || s.category === category) && (level === 'all' || s.level === level),
      )
      .sort((a, b) => rank[a.level] - rank[b.level]) ?? [];
  return (
    <div className="reliability-page">
      <p className="page-description">
        Track error evidence, lost telemetry and operating limits. Each finding includes its source,
        scope and an action to review.
      </p>
      {(error || state?.warning) && (
        <div className="message warning" role="alert">
          <TriangleAlert size={18} />
          <span>{error || state?.warning}</span>
        </div>
      )}
      {notice && (
        <div className="message" role="status">
          <Check size={18} />
          {notice}
        </div>
      )}
      <section className="panel reliability-control" aria-labelledby="reliability-control-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LOCAL / READ-ONLY</span>
            <h2 id="reliability-control-title">
              {state?.running ? 'Monitoring enabled' : 'Monitoring is off'}
            </h2>
          </div>
          <span className={`monitor-indicator ${state?.running ? 'enabled' : ''}`}>
            <Activity size={16} />
            {state?.collecting
              ? 'Collecting evidence'
              : state?.running
                ? 'Waiting for next check'
                : 'On demand'}
          </span>
        </div>
        <p>
          Checks run on this computer. Monitoring stops when the app closes and starts off each time
          you open it. Repairs and configuration changes are not executed.
        </p>
        <div className="monitor-options">
          <label>
            Check interval
            <select
              value={state?.running ? state.intervalSeconds : interval}
              disabled={disabled || state?.running}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              <option value={60}>Every minute</option>
              <option value={300}>Every 5 minutes</option>
              <option value={900}>Every 15 minutes</option>
            </select>
          </label>
          <label className="notification-option">
            <input
              type="checkbox"
              checked={state?.running ? state.notifications : notifications}
              disabled={disabled || state?.running || !state?.notificationSupport}
              onChange={(e) => setNotifications(e.target.checked)}
            />
            <span>
              Desktop alerts
              <small>
                {state?.notificationSupport
                  ? 'Optional; delivery depends on OS notification settings.'
                  : 'Not available in this desktop environment.'}
              </small>
            </span>
          </label>
        </div>
        <div className="monitor-actions">
          <button
            className="button primary"
            disabled={disabled || blocked}
            onClick={() =>
              void act(async () => {
                onChange(await window.pcHealth!.checkReliability());
                setSelected('latest');
              })
            }
          >
            <ShieldCheck size={17} />
            {state?.collecting ? 'Checking…' : 'Run reliability check'}
          </button>
          {state?.running ? (
            <button
              className="button secondary"
              disabled={pending}
              onClick={() => void act(() => window.pcHealth!.stopReliability())}
            >
              <Square size={15} />
              Stop monitoring
            </button>
          ) : (
            <button
              className="button secondary"
              disabled={disabled || blocked}
              onClick={() =>
                void act(async () => {
                  onChange(
                    await window.pcHealth!.startReliability({
                      intervalSeconds: interval,
                      notifications,
                    }),
                  );
                  setSelected('latest');
                })
              }
            >
              <Play size={16} />
              Enable monitoring
            </button>
          )}
          {state?.collecting && !state.running && (
            <button
              className="button secondary"
              onClick={() => void act(() => window.pcHealth!.stopReliability())}
            >
              Cancel check
            </button>
          )}
          {state?.nextAt && (
            <span className="monitor-next">
              <Clock3 size={14} />
              Next check {new Date(state.nextAt).toLocaleTimeString()}
            </span>
          )}
        </div>
        {blocked && (
          <p className="monitor-hint">
            Finish the hardware scan or performance recording before collecting reliability
            evidence.
          </p>
        )}
      </section>
      {sample ? (
        <>
          <Recovery snapshots={state?.snapshots ?? []} blocked={disabled || blocked} />
          <div className="reliability-summary" aria-label="Latest selected evidence summary">
            {(['critical', 'warning', 'unknown', 'clear'] as const).map((t) => (
              <div key={t} className={`health-count ${t}`}>
                <span>{healthNames[t]}</span>
                <strong>{sample.signals.filter((s) => s.level === t).length}</strong>
              </div>
            ))}
          </div>
          <section className="panel reliability-evidence" aria-labelledby="evidence-title">
            <div className="section-heading">
              <div>
                <span className="eyebrow">EVIDENCE / {sample.ruleVersion}</span>
                <h2 id="evidence-title">Reliability evidence</h2>
              </div>
              <button
                className="button secondary small"
                disabled={disabled}
                onClick={() => setExportPreview(!exportPreview)}
              >
                <ArrowDownToLine size={15} />
                Export evidence
              </button>
            </div>
            <p className="evidence-time">
              Collected {when(sample.at)} · {(sample.elapsedMs / 1000).toFixed(1)} seconds ·{' '}
              {sample.platform}. Clear means only that the exposed check was within its limits.
            </p>
            <p className="evidence-time">
              Telemetry coverage: {telemetryCoverage(sample.signals).readable} readable ·{' '}
              {telemetryCoverage(sample.signals).unavailable} collection gaps ·{' '}
              {telemetryCoverage(sample.signals).notApplicable} not applicable. A readable value can
              still require further assessment.
            </p>
            {exportPreview && (
              <div className="export-disclosure">
                <h3>Review before sharing</h3>
                <p>
                  The JSON report contains all retained snapshots and alerts, timestamps, component
                  labels, mount paths, service names, measurements and recommended actions. Local
                  signal identifiers and counter epochs are omitted. Review the saved file before
                  sending it to anyone.
                </p>
                <button
                  className="button secondary small"
                  disabled={disabled}
                  onClick={() =>
                    void act(async () => {
                      if (await window.pcHealth!.exportReliability()) {
                        setNotice('Reliability evidence saved.');
                        setExportPreview(false);
                      }
                    })
                  }
                >
                  Choose evidence location
                </button>
              </div>
            )}
            <div className="health-filters">
              <label>
                Observation
                <select value={selected} onChange={(e) => setSelected(e.target.value)}>
                  <option value="latest">Latest observation</option>
                  {state!.snapshots.slice(1).map((s) => (
                    <option key={s.id} value={s.id}>
                      {when(s.at)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Component area
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as HealthCategory | 'all')}
                >
                  <option value="all">All areas</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {categoryNames[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Finding status
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as HealthLevel | 'all')}
                >
                  <option value="all">All findings</option>
                  {(['critical', 'warning', 'unknown', 'clear'] as const).map((l) => (
                    <option key={l} value={l}>
                      {healthNames[l]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="health-signals">
              {visible.map((s) => (
                <details className={`health-signal ${s.level}`} key={s.id}>
                  <summary>
                    <span className="health-signal-heading">
                      <span className="signal-category">{categoryNames[s.category]}</span>
                      <strong>{s.label}</strong>
                      <span className="signal-summary">{s.summary}</span>
                    </span>
                    <span className={`health-badge ${s.level}`}>
                      {s.availability === 'not-applicable'
                        ? 'Not applicable'
                        : healthNames[s.level]}
                    </span>
                  </summary>
                  <div className="health-signal-body">
                    {trendText(s) && <p className="counter-trend">{trendText(s)}</p>}
                    <h3>Recommended next step</h3>
                    <p>{s.action}</p>
                    <dl className="signal-provenance">
                      <div>
                        <dt>Collection</dt>
                        <dd>
                          {s.availability
                            ? telemetryNames[s.availability]
                            : 'Legacy observation; collection detail not recorded'}
                        </dd>
                      </div>
                      <div>
                        <dt>Source</dt>
                        <dd>{s.source}</dd>
                      </div>
                      <div>
                        <dt>Scope</dt>
                        <dd>{s.scope}</dd>
                      </div>
                      <div>
                        <dt>Observed</dt>
                        <dd>{when(s.observedAt)}</dd>
                      </div>
                    </dl>
                    {s.measurements.length > 0 && (
                      <dl className="signal-measurements">
                        {s.measurements.map((m, i) => (
                          <div key={i}>
                            <dt>{m.name}</dt>
                            <dd>
                              {m.value}
                              {m.unit ? ` ${m.unit}` : ''}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <p className="signal-limitation">
                      <CircleInfo />
                      {s.limitation}
                    </p>
                  </div>
                </details>
              ))}
            </div>
            {!visible.length && <p className="empty-filter">No findings match these filters.</p>}
          </section>
        </>
      ) : (
        <section className="panel reliability-empty">
          <ShieldCheck size={30} />
          <h2>Establish a reliability baseline</h2>
          <p>
            Run a check to record the error counters and service states this OS exposes. Later
            checks separate new errors from historical counts. Missing capabilities remain visible.
          </p>
          <p>No telemetry has been collected yet.</p>
        </section>
      )}
      <section className="panel health-alerts" aria-labelledby="alert-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">LOCAL / RETAINED HISTORY</span>
            <h2 id="alert-title">
              <Bell size={18} />
              Alert history
            </h2>
          </div>
          <span className="muted">
            {state?.alerts.filter((a) => !a.acknowledgedAt).length ?? 0} unacknowledged
          </span>
        </div>
        <p>
          New warnings, severity changes, lost sources and growing counters are recorded here.
          Acknowledgment records your review; it does not verify a repair. Showing the latest 30
          alerts; exports include all retained alerts.
        </p>
        {!state?.alerts.length && <div className="empty-filter">No alerts recorded.</div>}
        {state?.alerts.slice(0, 30).map((a) => (
          <article className="health-alert" key={a.id}>
            <div>
              <span className={`health-badge ${a.level}`}>
                {a.level === 'unknown' ? 'Telemetry lost' : healthNames[a.level]}
              </span>
              <h3>{a.title}</h3>
              <p>{a.summary}</p>
              <p>{a.action}</p>
              <small>
                First recorded {when(a.at)} · Last observed {when(a.lastSeen)} · {a.occurrences}{' '}
                observations
              </small>
            </div>
            {a.acknowledgedAt ? (
              <span className="alert-acknowledged">
                <Check size={15} />
                Reviewed
              </span>
            ) : (
              <button
                className="button secondary small"
                disabled={disabled}
                onClick={() =>
                  void act(async () =>
                    onChange(await window.pcHealth!.acknowledgeHealthAlert(a.id)),
                  )
                }
              >
                Acknowledge
              </button>
            )}
          </article>
        ))}
      </section>
      <details className="panel reliability-scope">
        <summary>Server operation and coverage limits</summary>
        <p>
          The headless collector runs without Electron or a graphical session. After building the
          app, run <code>node dist-electron/health-cli.cjs --once</code> or{' '}
          <code>--watch --interval 300</code>. Output is local JSON; no daemon or remote endpoint is
          installed.
        </p>
        <p>
          Linux adapters include EDAC, hwmon, MD RAID, optional ZFS and systemd. Windows and macOS
          expose different subsets. Controllers, virtual machines and missing permissions can hide
          hardware. All adapters need qualification on representative hardware before production
          use.
        </p>
        <p>
          This version uses deterministic rules, not an LLM. It does not predict remaining lifetime,
          validate backup restores, detect every silent corruption, or physically repair a
          component. Suggested maintenance remains a human decision.
        </p>
      </details>
    </div>
  );
}
function CircleInfo() {
  return <TriangleAlert size={14} aria-hidden="true" />;
}
