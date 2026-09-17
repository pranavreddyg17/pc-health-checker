import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowDownToLine,
  Check,
  CircleHelp,
  Clock3,
  Flag,
  FolderOpen,
  Play,
  Plus,
  Square,
  Trash2,
  TriangleAlert,
} from './ui/Glyphs';
import {
  average,
  compareObservations,
  durationLabel,
  observationSignals,
  type Investigation,
  type InvestigationSnapshot,
  type Observation,
  type PowerContext,
} from './shared/investigations';
import type { Scan } from './shared/types';

function Timeline({ observation }: { observation: Observation }) {
  const { samples, markers } = observation;
  const duration = Math.max(observation.elapsedMs, ...markers, 1000);
  const series = [
    { key: 'cpuPercent', label: 'Total CPU use', color: '#5de0e6' },
    { key: 'memoryWaitPercent', label: 'Memory wait (where available)', color: '#ffca7a' },
    { key: 'ioWaitPercent', label: 'I/O wait (where available)', color: '#ad9fff' },
  ] as const;
  return (
    <div className="observation-chart">
      <div className="chart-labels">
        <span>100%</span>
        <span>50%</span>
        <span>0%</span>
      </div>
      <svg
        viewBox="0 0 800 170"
        role="img"
        aria-label="Resource use across this recording. A text summary and sampled values follow."
      >
        <path d="M0 5H800 M0 85H800 M0 165H800" stroke="#2b3949" fill="none" />
        {series.map(({ key, color }) => {
          let drawing = '',
            previous = -Infinity;
          for (const sample of samples) {
            const value = sample[key];
            if (value === undefined) {
              previous = -Infinity;
              continue;
            }
            drawing += `${sample.atMs - previous > 7000 ? 'M' : 'L'}${(sample.atMs / duration) * 800},${165 - value * 1.6} `;
            previous = sample.atMs;
          }
          return <path key={key} d={drawing} stroke={color} strokeWidth="2.5" fill="none" />;
        })}
        {markers.map((ms, i) => (
          <path
            key={i}
            d={`M${(ms / duration) * 800} 0V170`}
            stroke="#ffca7a"
            strokeDasharray="4 5"
          />
        ))}
      </svg>
      <div className="chart-legend">
        {series
          .filter(({ key }) => samples.some((s) => s[key] !== undefined))
          .map(({ key, label, color }) => (
            <span key={key}>
              <i style={{ background: color }} />
              {label}
            </span>
          ))}
        <span>
          <Flag size={12} /> Your symptom markers
        </span>
      </div>
      <div className="chart-duration">
        <span>0:00</span>
        <span>{durationLabel(observation.elapsedMs)}</span>
      </div>
    </div>
  );
}
function Metric({ title, value, unit = '' }: { title: string; value?: number; unit?: string }) {
  return (
    <div className="observation-metric">
      <span>{title}</span>
      <strong>{value === undefined ? 'Unavailable' : `${value.toFixed(1)}${unit}`}</strong>
    </div>
  );
}
export default function Investigations({ scanning, scan }: { scanning: boolean; scan?: Scan }) {
  const [snapshot, setSnapshot] = useState<InvestigationSnapshot>({ cases: [] });
  const [selectedId, setSelectedId] = useState<string>();
  const [observationId, setObservationId] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [workload, setWorkload] = useState('');
  const [onset, setOnset] = useState<Investigation['onset']>('unsure');
  const [change, setChange] = useState('');
  const [power, setPower] = useState<PowerContext>('unknown');
  const [duration, setDuration] = useState<60 | 180 | 300 | 600>(180);
  const [includeApps, setIncludeApps] = useState(false);
  const [action, setAction] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [previewExport, setPreviewExport] = useState(false);
  useEffect(() => {
    let mounted = true;
    const api = window.pcHealth;
    if (!api) {
      setLoading(false);
      return;
    }
    const apply = (value: InvestigationSnapshot) => {
      if (mounted) {
        setSnapshot(value);
        setLoading(false);
      }
    };
    void api
      .investigations()
      .then(apply)
      .catch(() => {
        if (mounted) {
          setError('Investigations could not be loaded.');
          setLoading(false);
        }
      });
    const off = api.onObservation(apply);
    return () => {
      mounted = false;
      off();
    };
  }, []);
  const active = snapshot.active;
  const current =
    snapshot.cases.find((c) => c.id === (active?.caseId ?? selectedId)) ?? snapshot.cases[0];
  const observation =
    current?.observations.find((o) => o.id === (active?.observation.id ?? observationId)) ??
    current?.observations.at(-1);
  const locked = pending || Boolean(active) || scanning || loading || !window.pcHealth;
  const signals = observation ? observationSignals(observation) : [];
  const previous =
    observation && current
      ? current.observations[current.observations.findIndex((o) => o.id === observation.id) - 1]
      : undefined;
  const comparison =
    previous && observation ? compareObservations(previous, observation) : undefined;
  const urgentStorage = scan?.findings.some(
    (f) =>
      f.severity === 'urgent' &&
      scan.components.find((c) => c.id === f.componentId)?.kind === 'storage',
  );
  async function execute(operation: () => Promise<InvestigationSnapshot | void | boolean>) {
    setPending(true);
    setError('');
    setNotice('');
    try {
      const result = await operation();
      if (result && typeof result === 'object') setSnapshot(result);
    } catch (error) {
      const message = (error as Error).message.replace(
        /^Error invoking remote method '[^']+': (?:Error: )?/,
        '',
      );
      setError(message || 'The operation could not complete.');
    } finally {
      setPending(false);
    }
  }
  function selectCase(c: Investigation) {
    setSelectedId(c.id);
    setObservationId(undefined);
    setCreating(false);
    setAction('');
    setConfirmRemove(false);
    setPreviewExport(false);
  }
  return (
    <div className="investigations">
      <section className="investigation-intro">
        <div>
          <span className="eyebrow">MANUAL RESOURCE RECORDING</span>
          <h2>Capture a performance problem.</h2>
          <p>
            Record your normal work, mark the slowdown, and choose a useful next step from the
            evidence.
          </p>
        </div>
        <div className="investigation-intro-icon" aria-hidden="true">
          <Activity size={42} strokeWidth={1.4} />
        </div>
      </section>
      {error && (
        <div className="message warning" role="alert">
          {error}
        </div>
      )}
      {snapshot.warning && (
        <div className="message warning" role="alert">
          {snapshot.warning}
        </div>
      )}
      {notice && (
        <div className="message" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {scanning && (
        <div className="message">Finish the hardware scan before starting a recording.</div>
      )}
      {urgentStorage && (
        <div className="message warning">
          <TriangleAlert size={22} />
          <span>
            Your selected hardware scan contains an urgent storage finding. Protect important data
            and follow that finding before reproducing a slowdown. Recordings are disabled while
            this warning applies.
          </span>
        </div>
      )}
      {!loading && (
        <div className="investigation-workspace">
          <aside className="case-list" aria-label="Saved investigations">
            <div className="section-heading">
              <h2>My investigations</h2>
              <button
                className="icon-button"
                aria-label="New investigation"
                disabled={locked}
                onClick={() => {
                  setCreating(true);
                  setConfirmRemove(false);
                  setPreviewExport(false);
                }}
              >
                <Plus size={20} />
              </button>
            </div>
            {snapshot.cases.length ? (
              snapshot.cases.map((c) => (
                <button
                  key={c.id}
                  className={`case-link ${!creating && current?.id === c.id ? 'selected' : ''}`}
                  disabled={Boolean(active)}
                  onClick={() => selectCase(c)}
                >
                  <FolderOpen size={18} />
                  <span>
                    <strong>{c.workload}</strong>
                    <small>
                      {c.observations.length} recording{c.observations.length === 1 ? '' : 's'} ·{' '}
                      {new Date(c.updatedAt).toLocaleDateString()}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="case-empty">
                Your investigations stay here, on this computer. Each one keeps your observations
                and follow-up results together.
              </p>
            )}
            <p className="case-privacy">
              No screen recording. No file contents. No automatic changes.
            </p>
          </aside>
          <div className="case-content">
            {creating || !current ? (
              <form
                className="panel investigation-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void execute(async () => {
                    const result = await window.pcHealth!.createInvestigation({
                      workload,
                      onset,
                      change,
                    });
                    setSelectedId(result.cases[0].id);
                    setCreating(false);
                    setWorkload('');
                    setChange('');
                    setAction('');
                    setObservationId(undefined);
                    return result;
                  });
                }}
              >
                <span className="eyebrow">STEP 1 · DESCRIBE THE PROBLEM</span>
                <h2>When does your computer feel slow?</h2>
                <label>
                  What are you doing when it happens?
                  <input
                    required
                    maxLength={160}
                    value={workload}
                    onChange={(e) => setWorkload(e.target.value)}
                    placeholder="For example: video calls with several browser tabs open"
                  />
                </label>
                <label>
                  When did you first notice it?
                  <select
                    value={onset}
                    onChange={(e) => setOnset(e.target.value as Investigation['onset'])}
                  >
                    <option value="unsure">I’m not sure</option>
                    <option value="recent">It started recently</option>
                    <option value="always">It has always happened with this work</option>
                  </select>
                </label>
                <label>
                  Anything changed recently? <span className="optional">Optional</span>
                  <textarea
                    maxLength={300}
                    value={change}
                    onChange={(e) => setChange(e.target.value)}
                    placeholder="An update, a new app, a connected device, or a hardware change"
                  />
                </label>
                <p className="form-note">
                  Descriptions stay local and will appear in a report if you choose to export it.
                  Avoid including personal information.
                </p>
                <button
                  className="button primary"
                  disabled={locked || !workload.trim() || Boolean(snapshot.warning)}
                >
                  <ArrowRight size={17} />
                  Create investigation
                </button>
              </form>
            ) : (
              <>
                <div className="case-heading">
                  <div>
                    <span className="eyebrow">SLOWNESS INVESTIGATION</span>
                    <h2>{current.workload}</h2>
                    <p>
                      Onset:{' '}
                      {current.onset === 'recent'
                        ? 'recently'
                        : current.onset === 'always'
                          ? 'since using this workload'
                          : 'not sure'}
                      {current.change && ` · Recent change: ${current.change}`}
                    </p>
                  </div>
                  <button
                    className="icon-button"
                    aria-label="Remove this investigation"
                    disabled={locked}
                    onClick={() => setConfirmRemove(!confirmRemove)}
                  >
                    <Trash2 size={18} />
                  </button>
                </div>
                {confirmRemove && (
                  <div
                    className="panel confirmation-inline"
                    role="group"
                    aria-label="Confirm investigation removal"
                  >
                    <h3>Remove this investigation and its recordings?</h3>
                    <p>This cannot be undone. Export a report first if you want a copy.</p>
                    <div className="button-row">
                      <button className="button secondary" onClick={() => setConfirmRemove(false)}>
                        Keep investigation
                      </button>
                      <button
                        className="button secondary"
                        disabled={locked}
                        onClick={() =>
                          void execute(async () => {
                            const result = await window.pcHealth!.removeInvestigation(current.id);
                            setConfirmRemove(false);
                            setSelectedId(undefined);
                            setObservationId(undefined);
                            return result;
                          })
                        }
                      >
                        Remove saved investigation
                      </button>
                    </div>
                  </div>
                )}
                {active ? (
                  <section className="panel recording-live">
                    <div className="recording-heading">
                      <div>
                        <span className="eyebrow">RECORDING YOUR NORMAL WORK</span>
                        <h2>
                          {durationLabel(
                            Math.max(
                              0,
                              active.observation.durationSeconds * 1000 -
                                active.observation.elapsedMs,
                            ),
                          )}{' '}
                          remaining
                        </h2>
                      </div>
                      <span className="recording-dot" aria-label="Recording active" />
                    </div>
                    <p>
                      Switch to the apps involved and use them as usual. Return here to mark the
                      moment the slowdown occurs.
                    </p>
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={pending || active.observation.markers.length >= 50}
                        onClick={() => void execute(() => window.pcHealth!.markObservation())}
                      >
                        <Flag size={17} />
                        It’s happening now
                      </button>
                      <button
                        className="button secondary"
                        disabled={pending}
                        onClick={() => void execute(() => window.pcHealth!.stopObservation())}
                      >
                        <Square size={15} />
                        Stop recording
                      </button>
                    </div>
                    <p role="status">
                      {active.observation.samples.length} samples ·{' '}
                      {active.observation.markers.length} symptom markers ·{' '}
                      {active.observation.includeApps
                        ? 'App names included locally'
                        : 'Aggregate data only'}
                    </p>
                  </section>
                ) : (
                  <section className="panel investigation-form">
                    <span className="eyebrow">
                      {current.observations.length
                        ? 'FOLLOW-UP · TRY ONE CHANGE, THEN REPEAT'
                        : 'STEP 2 · OBSERVE THE PROBLEM'}
                    </span>
                    <h2>
                      {current.observations.length
                        ? 'Repeat the same work and compare'
                        : 'Record while you use your computer'}
                    </h2>
                    <p>
                      Use your usual applications. PC Health samples resource use; it does not
                      create a stress workload or change settings.
                    </p>
                    {current.observations.length > 0 && (
                      <label>
                        What did you change before this recording?
                        <input
                          maxLength={300}
                          value={action}
                          onChange={(e) => setAction(e.target.value)}
                          placeholder="For example: saved my work and closed unused browser tabs"
                        />
                        <small>
                          Describe what you actually did, or enter “No change” for another baseline.
                        </small>
                      </label>
                    )}
                    <div className="form-columns">
                      <label>
                        Recording length
                        <select
                          value={duration}
                          onChange={(e) => setDuration(Number(e.target.value) as typeof duration)}
                        >
                          <option value={60}>1 minute · quick observation</option>
                          <option value={180}>3 minutes · recommended</option>
                          <option value={300}>5 minutes</option>
                          <option value={600}>10 minutes</option>
                        </select>
                      </label>
                      <label>
                        Power conditions
                        <select
                          value={power}
                          onChange={(e) => setPower(e.target.value as PowerContext)}
                        >
                          <option value="unknown">I’m not sure</option>
                          <option value="plugged-in">Plugged in</option>
                          <option value="battery">On battery</option>
                        </select>
                      </label>
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={includeApps}
                        onChange={(e) => setIncludeApps(e.target.checked)}
                      />
                      <span>
                        Include names of the busiest apps locally
                        <small>
                          Names may reveal how you use this computer. No window titles, typing, or
                          command arguments are collected. App names are excluded from exports.
                        </small>
                      </span>
                    </label>
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={
                          locked ||
                          Boolean(snapshot.warning) ||
                          urgentStorage ||
                          current.observations.length >= 6 ||
                          (current.observations.length > 0 && !action.trim())
                        }
                        onClick={() =>
                          void execute(async () => {
                            setObservationId(undefined);
                            setPreviewExport(false);
                            return window.pcHealth!.startObservation({
                              caseId: current.id,
                              durationSeconds: duration,
                              power,
                              includeApps,
                              action: current.observations.length ? action : '',
                            });
                          })
                        }
                      >
                        <Play size={16} />
                        Start recording
                      </button>
                      <span className="form-note">
                        <Clock3 size={14} />
                        Stops automatically · {6 - current.observations.length} recordings remaining
                      </span>
                    </div>
                  </section>
                )}
                {observation && (
                  <>
                    <div className="section-heading recordings-heading">
                      <h2>Your evidence</h2>
                      <select
                        aria-label="Recording to review"
                        disabled={Boolean(active)}
                        value={observation.id}
                        onChange={(e) => {
                          setObservationId(e.target.value);
                          setPreviewExport(false);
                        }}
                      >
                        {current.observations.map((o, i) => (
                          <option value={o.id} key={o.id}>
                            {i === 0 ? 'Baseline' : `Follow-up ${i}`} ·{' '}
                            {new Date(o.startedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            · {o.state}
                          </option>
                        ))}
                      </select>
                    </div>
                    <section className="panel evidence-panel">
                      <div className="recording-heading">
                        <h3>
                          {observation.state === 'recording'
                            ? 'Live resource use'
                            : 'What happened during this recording'}
                        </h3>
                        <span className="tiny-tag">
                          {observation.state} · {durationLabel(observation.elapsedMs)}
                        </span>
                      </div>
                      <Timeline observation={observation} />
                      <div className="observation-metrics">
                        <Metric
                          title="Average CPU use"
                          value={average(observation.samples.map((s) => s.cpuPercent))}
                          unit="%"
                        />
                        <Metric
                          title="Average paging out"
                          value={average(observation.samples.map((s) => s.pagingOutPerSec))}
                          unit=" pages/s"
                        />
                        <Metric
                          title="Average I/O wait"
                          value={average(observation.samples.map((s) => s.ioWaitPercent))}
                          unit="%"
                        />
                      </div>
                      {observation.markers.length > 0 && (
                        <p className="form-note">
                          You marked a symptom at{' '}
                          {observation.markers.map(durationLabel).join(', ')}. These are your
                          observations, not automatic fault detections.
                        </p>
                      )}
                      {observation.includeApps && observation.samples.at(-1)?.apps?.length ? (
                        <details>
                          <summary>Apps in the most recent sample</summary>
                          <table className="app-evidence">
                            <thead>
                              <tr>
                                <th>Process name</th>
                                <th>CPU share*</th>
                                <th>Memory</th>
                              </tr>
                            </thead>
                            <tbody>
                              {observation.samples.at(-1)!.apps!.map((app, i) => (
                                <tr key={i}>
                                  <td>{app.name}</td>
                                  <td>{app.cpuPercent.toFixed(1)}%</td>
                                  <td>{Math.round(app.memoryMB)} MB</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="form-note">
                            *Share of total CPU capacity, per process. Multiple processes may belong
                            to one app. Memory accounting differs by OS. PC Health and system
                            processes may appear here.
                          </p>
                        </details>
                      ) : null}
                      <details>
                        <summary>Coverage and limitations</summary>
                        <ul>
                          {observation.coverage.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                        <p>
                          Power source observed: {observation.observedPower.join(', ') || 'unknown'}
                          . No observation continues after this session ends.
                        </p>
                      </details>
                      <details>
                        <summary>View sampled values</summary>
                        <div className="sample-table">
                          <table>
                            <thead>
                              <tr>
                                <th>Time</th>
                                <th>CPU</th>
                                <th>Paging out/s</th>
                                <th>Memory wait</th>
                                <th>I/O wait</th>
                              </tr>
                            </thead>
                            <tbody>
                              {observation.samples.map((s) => (
                                <tr key={s.atMs}>
                                  <td>{durationLabel(s.atMs)}</td>
                                  <td>{s.cpuPercent?.toFixed(1) ?? '—'}</td>
                                  <td>{s.pagingOutPerSec?.toFixed(1) ?? '—'}</td>
                                  <td>{s.memoryWaitPercent?.toFixed(1) ?? '—'}</td>
                                  <td>{s.ioWaitPercent?.toFixed(1) ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    </section>
                    {observation.state !== 'recording' && (
                      <section className="next-actions">
                        <div className="section-heading">
                          <h2>What to try next</h2>
                          <span className="tiny-tag">Investigation leads</span>
                        </div>
                        {signals.length ? (
                          signals.map((s) => (
                            <article className="panel investigation-finding" key={s.key}>
                              <Activity size={22} />
                              <div>
                                <h3>{s.title}</h3>
                                <p>{s.evidence}</p>
                                <p className="suggested-action">
                                  <ArrowRight size={16} />
                                  {s.action}
                                </p>
                                <details>
                                  <summary>What this does and doesn’t establish</summary>
                                  <p>{s.limitation}</p>
                                </details>
                              </div>
                            </article>
                          ))
                        ) : (
                          <article className="panel investigation-finding">
                            <CircleHelp size={23} />
                            <div>
                              <h3>
                                {observation.elapsedMs < 30000 || observation.samples.length < 10
                                  ? 'Record for longer to gather useful evidence'
                                  : 'This sample did not isolate the slowdown'}
                              </h3>
                              <p>
                                {observation.elapsedMs < 30000 || observation.samples.length < 10
                                  ? 'At least 30 seconds and ten samples are needed before assessing sustained signals. A three-minute recording gives more context.'
                                  : 'No sustained signal crossed the current investigation thresholds. This does not rule out a problem, especially in checks that were unavailable.'}
                              </p>
                              <p className="suggested-action">
                                Repeat while the symptom occurs and mark its timing. If it persists,
                                review the hardware scan, note any recent changes, and use the
                                report to guide a technician.
                              </p>
                            </div>
                          </article>
                        )}
                        <div className="panel outcome-panel">
                          <label>
                            How did this workload feel during this recording?
                            <select
                              disabled={locked}
                              value={observation.outcome}
                              onChange={(e) =>
                                void execute(() =>
                                  window.pcHealth!.setObservationOutcome(
                                    current.id,
                                    observation.id,
                                    e.target.value as Observation['outcome'],
                                  ),
                                )
                              }
                            >
                              <option value="not-recorded">Choose your observation</option>
                              <option value="improved">Better than before</option>
                              <option value="unchanged">About the same</option>
                              <option value="worse">Worse than before</option>
                              <option value="not-reproduced">The problem didn’t happen</option>
                            </select>
                          </label>
                          <p className="form-note">
                            Saved as your report of the symptom, separate from measured evidence.
                          </p>
                        </div>
                      </section>
                    )}
                    {comparison && observation.state !== 'recording' && (
                      <section className="panel comparison-panel">
                        <span className="eyebrow">BEFORE & AFTER</span>
                        <h2>
                          {comparison.comparable
                            ? 'Compare your two observations'
                            : 'Compare carefully: conditions may differ'}
                        </h2>
                        <p>Change you recorded: {observation.action || 'No action recorded'}</p>
                        <ul>
                          {comparison.notes.map((note) => (
                            <li key={note}>{note}</li>
                          ))}
                        </ul>
                      </section>
                    )}
                    {!active && (
                      <section className="panel case-export">
                        <div>
                          <h3>Keep a useful record or bring it to a technician</h3>
                          <p>
                            Export your symptom, actions, recording summaries, next steps, and
                            coverage.
                          </p>
                        </div>
                        <button
                          className="button secondary"
                          disabled={locked}
                          onClick={() => setPreviewExport(!previewExport)}
                        >
                          <ArrowDownToLine size={16} />
                          Preview case export
                        </button>
                        {previewExport && (
                          <div className="export-preview">
                            <h3>Included in your report</h3>
                            <p>
                              <b>Workload:</b> {current.workload}
                            </p>
                            <p>
                              <b>Recent changes:</b> {current.change || 'Not specified'}
                            </p>
                            <ul>
                              {current.observations.map((o) => (
                                <li key={o.id}>
                                  {new Date(o.startedAt).toLocaleString()} ·{' '}
                                  {durationLabel(o.elapsedMs)} · {o.state} · Action:{' '}
                                  {o.action || 'Baseline'} · Outcome: {o.outcome}
                                </li>
                              ))}
                            </ul>
                            <p>
                              Includes findings, coverage notes, power conditions, and symptom
                              markers shown above for each recording. App names, local IDs, and raw
                              samples are excluded. Nothing is uploaded.
                            </p>
                            <button
                              className="button primary"
                              disabled={pending}
                              onClick={() =>
                                void execute(async () => {
                                  if (await window.pcHealth!.exportInvestigation(current.id)) {
                                    setNotice('Investigation report saved.');
                                    setPreviewExport(false);
                                  }
                                })
                              }
                            >
                              Choose report location
                            </button>
                          </div>
                        )}
                      </section>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {loading && <p role="status">Loading your local investigations…</p>}
    </div>
  );
}
