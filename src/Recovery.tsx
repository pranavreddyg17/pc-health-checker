import { useEffect, useState } from 'react';
import { recoveryTargets, verifyRecovery, type RecoveryCase } from './shared/recovery';
import type { HealthSnapshot } from './shared/reliability';

export default function Recovery({
  snapshots,
  blocked,
}: {
  snapshots: HealthSnapshot[];
  blocked: boolean;
}) {
  const [records, setRecords] = useState<RecoveryCase[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [deleting, setDeleting] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true;
    window.pcHealth
      ?.recoveryCases()
      .then((value) => {
        if (active) setRecords(value);
      })
      .catch((e) => {
        if (active) setError(String(e));
      });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  async function act(run: () => Promise<RecoveryCase[]>) {
    setBusy(true);
    setError('');
    try {
      setRecords(await run());
      setNow(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery evidence could not be saved.');
    } finally {
      setBusy(false);
    }
  }
  const targets = snapshots[0] ? recoveryTargets(snapshots[0]) : [];
  return (
    <section className="panel recovery-panel" aria-labelledby="recovery-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">FAULT → ACTION → VERIFICATION</span>
          <h2 id="recovery-title">Recovery verification</h2>
        </div>
        <button
          className="button secondary small"
          disabled={busy || blocked || !targets.length}
          onClick={() => void act(() => window.pcHealth!.createRecovery())}
        >
          Capture fault baseline
        </button>
      </div>
      <p>
        Preserve the current fault evidence before changing anything. Record one action, then check
        whether the same sources stay stable under the original workload. No repair commands run
        from this panel.
      </p>
      {error && (
        <p className="message warning" role="alert">
          {error}
        </p>
      )}
      {!records.length && (
        <p className="monitor-hint">
          {targets.length
            ? `${targets.length} findings can be included in a verification baseline.`
            : 'A baseline becomes available when a reliability check reports a warning or critical condition.'}{' '}
          Acknowledging an alert does not count as recovery.
        </p>
      )}
      {records.map((record) => {
        const verdict = verifyRecovery(record, snapshots, Math.max(now, Date.now()));
        return (
          <details
            className={`recovery-case recovery-${verdict.state}`}
            key={record.id}
            open={records.length === 1 ? true : undefined}
          >
            <summary>
              <strong>{verdict.title}</strong>
              <span>
                {record.signalIds.length} findings · {new Date(record.createdAt).toLocaleString()}
              </span>
            </summary>
            <div className="recovery-body">
              <p>{verdict.detail}</p>
              <ol className="recovery-steps">
                <li>
                  <strong>Fault baseline preserved</strong>
                  <span>
                    Original measurements and sources remain attached to this verification.
                  </span>
                </li>
                <li>
                  <strong>
                    {record.action
                      ? 'Action recorded · user reported'
                      : 'Review and perform one action'}
                  </strong>
                  <span>
                    {record.action?.note ??
                      'Use the source recommendations below. Obtain approval for service or configuration changes before performing them.'}
                  </span>
                </li>
                <li>
                  <strong>
                    {verdict.passing} / {verdict.required} comparable checks
                  </strong>
                  <span>
                    At least two minutes of observations. Missing sources, counter resets and new
                    critical findings block verification.
                  </span>
                </li>
              </ol>
              <details>
                <summary>Original evidence and recommended actions</summary>
                {record.baseline.signals
                  .filter((s) => record.signalIds.includes(s.id))
                  .map((signal) => (
                    <article className="recovery-evidence" key={signal.id}>
                      <h3>{signal.label}</h3>
                      <p>{signal.summary}</p>
                      <p>{signal.action}</p>
                      <small>
                        {signal.source} · {signal.scope}
                      </small>
                      <dl>
                        {signal.measurements.map((m, i) => (
                          <div key={i}>
                            <dt>{m.name}</dt>
                            <dd>
                              {m.value} {m.unit}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </article>
                  ))}
              </details>
              {!record.action && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void act(() =>
                      window.pcHealth!.recordRecoveryAction(record.id, notes[record.id] ?? ''),
                    );
                  }}
                >
                  <label htmlFor={`action-${record.id}`}>
                    Action performed and workload to repeat
                  </label>
                  <textarea
                    id={`action-${record.id}`}
                    required
                    maxLength={2000}
                    value={notes[record.id] ?? ''}
                    onChange={(event) => setNotes({ ...notes, [record.id]: event.target.value })}
                    placeholder="Describe what you changed, who approved it, and how you will reproduce the original workload."
                  />
                  <button
                    className="button secondary small"
                    disabled={busy || blocked || !notes[record.id]?.trim()}
                  >
                    Record action and start verification
                  </button>
                </form>
              )}
              {verdict.observations.length > 0 && (
                <details>
                  <summary>Verification observations</summary>
                  <ul>
                    {verdict.observations.map((o, i) => (
                      <li key={i}>
                        {new Date(o.at).toLocaleTimeString()} · {o.result}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {deleting === record.id ? (
                <div className="recovery-delete">
                  <p>Remove this verification and its saved fault baseline?</p>
                  <button className="button secondary small" onClick={() => setDeleting('')}>
                    Keep verification
                  </button>
                  <button
                    className="button danger small"
                    disabled={busy}
                    onClick={() => void act(() => window.pcHealth!.removeRecovery(record.id))}
                  >
                    Delete verification
                  </button>
                </div>
              ) : (
                <button className="button secondary small" onClick={() => setDeleting(record.id)}>
                  Remove verification
                </button>
              )}
            </div>
          </details>
        );
      })}
    </section>
  );
}
