import { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowDownToLine,
  Check,
  ClipboardList,
  Plus,
  TriangleAlert,
  Trash2,
  Wrench,
} from './ui/Glyphs';
import {
  repairFlows,
  repairAssessment,
  diagnosticGuide,
  type RepairCase,
  type Symptom,
  type RepairCommand,
  type TestOutcome,
} from './shared/repairs';
import type { Scan } from './shared/types';
import DiagnosticTools, { type ToolKind } from './DiagnosticTools';
const when = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const outcomeLabels: Record<TestOutcome, string> = {
  observed: 'Yes — observed',
  'not-observed': 'No — not observed',
  inconclusive: 'Inconclusive / could not test',
};
export default function RepairWorkbench({
  scan,
  platform,
  onPerformance,
  onScan,
}: {
  scan?: Scan;
  platform: string;
  onPerformance: () => void;
  onScan: () => void;
}) {
  const [cases, setCases] = useState<RepairCase[]>([]);
  const [selected, setSelected] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [symptom, setSymptom] = useState<Symptom>('storage');
  const [pattern, setPattern] = useState('full');
  const [device, setDevice] = useState('');
  const [target, setTarget] = useState<'this-device' | 'other-device'>('this-device');
  const [description, setDescription] = useState('');
  const [hazard, setHazard] = useState(false);
  const [activeTest, setActiveTest] = useState('');
  const [result, setResult] = useState<TestOutcome>('inconclusive');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [exportPreview, setExportPreview] = useState(false);
  const [tool, setTool] = useState<ToolKind>();
  useEffect(() => {
    let active = true;
    if (!window.pcHealth) {
      setLoading(false);
      return;
    }
    void window.pcHealth
      .repairCases()
      .then((v) => {
        if (active) {
          setCases(v);
          setSelected(v[0]?.id);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError('Repair cases could not be loaded. Existing data has been preserved.');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  const current = cases.find((c) => c.id === selected);
  const flow = current ? repairFlows[current.symptom] : undefined;
  const assessment = current ? repairAssessment(current) : undefined;
  function reset() {
    setActiveTest('');
    setNote('');
    setAction('');
    setConfirmRemove(false);
    setExportPreview(false);
    setTool(undefined);
    setNotice('');
    setError('');
  }
  async function mutate(fn: () => Promise<RepairCase[]>) {
    setPending(true);
    setError('');
    try {
      const updated = await fn();
      setCases(updated);
      return updated;
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setPending(false);
    }
  }
  async function update(command: RepairCommand) {
    if (!current) return;
    const updated = await mutate(() => window.pcHealth!.updateRepair(current.id, command));
    if (updated) {
      setActiveTest('');
      setNote('');
      setAction('');
      setNotice('Case updated locally.');
    }
  }
  if (tool) return <DiagnosticTools initial={tool} onBack={() => setTool(undefined)} />;
  return (
    <div className="repair-workspace">
      <div className="workbench-intro">
        <div>
          <span className="eyebrow">FAULT ISOLATION / REPAIR RECORD</span>
          <h2>Symptom → test → repair → verify</h2>
          <p>Choose a symptom, test one cause at a time, and record what changed.</p>
        </div>
        <button className="button secondary" onClick={onPerformance}>
          Performance capture
          <ArrowRight size={16} />
        </button>
      </div>
      {error && (
        <div role="alert" className="message warning">
          {error}
        </div>
      )}
      {notice && (
        <div className="message" role="status">
          <Check size={16} />
          {notice}
        </div>
      )}
      <div className="repair-layout">
        <aside className="case-list">
          <button
            className="button primary"
            disabled={pending || loading}
            onClick={() => {
              reset();
              setCreating(true);
              setSelected(undefined);
            }}
          >
            <Plus size={16} />
            New repair case
          </button>
          <div className="case-list-label">
            {cases.filter((c) => c.status === 'open').length} OPEN / {cases.length} TOTAL
          </div>
          {cases.map((c) => (
            <button
              key={c.id}
              disabled={pending}
              className={`case-link ${c.id === selected ? 'selected' : ''}`}
              onClick={() => {
                reset();
                setCreating(false);
                setSelected(c.id);
              }}
            >
              <Wrench size={15} />
              <span>
                <strong>{c.device}</strong>
                <small>
                  {repairFlows[c.symptom].title}
                  <br />
                  {c.status === 'resolved' ? 'Resolved by user' : 'Open'} · {when(c.updatedAt)}
                </small>
              </span>
            </button>
          ))}
          <p className="case-privacy">
            Cases stay on this computer. Up to 30 cases, 100 log entries and 6 scan snapshots per
            case.
          </p>
        </aside>
        <div className="case-content">
          {loading ? (
            <p>Loading repair cases…</p>
          ) : creating || !current ? (
            <form
              className="panel repair-intake"
              onSubmit={async (e) => {
                e.preventDefault();
                const updated = await mutate(() =>
                  window.pcHealth!.createRepair({
                    symptom,
                    pattern,
                    target,
                    device:
                      device || (target === 'this-device' ? scan?.machine || 'This computer' : ''),
                    description,
                    hazard,
                  }),
                );
                if (updated) {
                  setSelected(updated[0].id);
                  setCreating(false);
                  setDescription('');
                  setDevice('');
                  setHazard(false);
                }
              }}
            >
              <span className="eyebrow">NEW CASE</span>
              <h2>What needs fixing?</h2>
              <div className="symptom-grid">
                {Object.entries(repairFlows).map(([id, f]) => (
                  <button
                    type="button"
                    aria-pressed={symptom === id}
                    className={`symptom-option ${symptom === id ? 'selected' : ''}`}
                    key={id}
                    onClick={() => {
                      setSymptom(id as Symptom);
                      setPattern(f.patterns[0].id);
                    }}
                  >
                    <span>{f.title}</span>
                    <small>{f.summary}</small>
                  </button>
                ))}
              </div>
              <label>
                Observed behavior
                <select value={pattern} onChange={(e) => setPattern(e.target.value)}>
                  {repairFlows[symptom].patterns.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="form-columns">
                <label>
                  Computer being repaired
                  <select
                    value={target}
                    onChange={(e) => {
                      setTarget(e.target.value as typeof target);
                      setDevice('');
                    }}
                  >
                    <option value="this-device">This computer — attach latest scan</option>
                    <option value="other-device">Another computer — manual evidence only</option>
                  </select>
                </label>
                <label>
                  Device label
                  {target === 'this-device' && <span className="optional">optional</span>}
                  <input
                    value={device}
                    onChange={(e) => setDevice(e.target.value)}
                    maxLength={120}
                    required={target === 'other-device'}
                    placeholder={
                      target === 'this-device'
                        ? scan?.machine || 'This computer'
                        : 'Model or job reference'
                    }
                  />
                </label>
              </div>
              <label>
                Problem description
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                  maxLength={2000}
                  placeholder="When it happens, exact messages, recent changes, and what you have already tried."
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={hazard}
                  onChange={(e) => setHazard(e.target.checked)}
                />
                <span>
                  Swelling, smoke, burning smell or liquid damage is present.
                  <small>This puts testing on hold and creates a service record.</small>
                </span>
              </label>
              <p className="form-note">
                {target === 'other-device'
                  ? 'No readings from this computer will be attached to the other device’s case.'
                  : scan
                    ? `Attaches the latest scan from ${when(scan.completedAt)}. Scans are snapshots, not live readings.`
                    : 'No scan is available. You can attach one later.'}
              </p>
              <button
                className="button primary"
                disabled={pending || !window.pcHealth || !description.trim()}
              >
                <Plus size={16} />
                Create repair case
              </button>
            </form>
          ) : (
            <>
              <div className="case-heading">
                <div>
                  <span className="eyebrow">
                    {current.status === 'resolved' ? 'RESOLVED • USER REPORTED' : 'OPEN CASE'} /{' '}
                    {current.target === 'this-device' ? 'THIS COMPUTER' : 'OTHER COMPUTER'}
                  </span>
                  <h2>{current.device}</h2>
                  <p>
                    {flow!.title} · Created {when(current.createdAt)}
                  </p>
                </div>
                <button
                  className="button secondary small"
                  disabled={pending}
                  onClick={() => setExportPreview(!exportPreview)}
                >
                  <ArrowDownToLine size={16} />
                  Export case
                </button>
              </div>
              {exportPreview && (
                <section className="panel case-export">
                  <h3>Review before exporting</h3>
                  <p>
                    The HTML report contains the device label, description, all notes and test
                    results, attached scan measurements, and finding evidence. Test outcomes are
                    marked as user reported. Review the case before sharing it.
                  </p>
                  <button
                    className="button primary small"
                    disabled={pending}
                    onClick={async () => {
                      setPending(true);
                      try {
                        if (await window.pcHealth!.exportRepair(current.id))
                          setNotice('Repair report saved.');
                      } catch {
                        setError('Could not save the repair report.');
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    <ArrowDownToLine size={15} />
                    Choose report location
                  </button>
                </section>
              )}
              <section className="panel case-summary">
                <p className="case-description">{current.description}</p>
                <div className="lead-block">
                  <span className="eyebrow">STARTING HYPOTHESIS</span>
                  <p>{assessment!.lead}</p>
                </div>
                {assessment!.stop && (
                  <div className="message warning">
                    <TriangleAlert size={20} />
                    {assessment!.stop}
                  </div>
                )}
                <div className="case-stats">
                  <span>
                    <strong>
                      {assessment!.results.filter((r) => r.entry).length}/{flow!.tests.length}
                    </strong>
                    guided results recorded
                  </span>
                  <span>
                    <strong>{current.scans.length}</strong>scan snapshots
                  </span>
                  <span>
                    <strong>{current.entries.filter((e) => e.kind === 'action').length}</strong>
                    repair actions
                  </span>
                </div>
              </section>
              <section className="panel evidence-review">
                <div className="section-heading">
                  <h3>Hardware evidence</h3>
                  {current.target === 'this-device' && (
                    <button
                      className="text-button"
                      disabled={pending || !scan || current.scans.some((s) => s.id === scan.id)}
                      onClick={() => void update({ kind: 'attach-scan' })}
                    >
                      Attach latest scan
                      <Plus size={14} />
                    </button>
                  )}
                </div>
                {current.scans.length ? (
                  <>
                    <p className="subtle">
                      Latest attached: {when(current.scans.at(-1)!.at)} ·{' '}
                      {current.scans.at(-1)!.completed}/{current.scans.at(-1)!.total} checks
                      readable{current.scans.at(-1)!.partial ? ' · Partial scan' : ''}
                    </p>
                    {assessment!.findings.length ? (
                      assessment!.findings.map((f, i) => (
                        <div className={`evidence-item ${f.severity}`} key={i}>
                          <strong>{f.title}</strong>
                          <p>{f.action}</p>
                          <details>
                            <summary>Recorded evidence</summary>
                            <ul>
                              {f.evidence.map((e, j) => (
                                <li key={j}>{e}</li>
                              ))}
                            </ul>
                          </details>
                        </div>
                      ))
                    ) : (
                      <p>
                        No relevant findings in the completed checks. Unavailable checks and
                        intermittent faults remain unresolved.
                      </p>
                    )}
                    <details>
                      <summary>View attached measurements and previous snapshots</summary>
                      {current.scans.map((s) => (
                        <div className="snapshot-block" key={s.id}>
                          <h4>
                            {when(s.at)} · {s.partial ? 'Partial' : 'Complete'}
                          </h4>
                          <p>
                            {s.completed}/{s.total} checks readable
                          </p>
                          <ul>
                            {s.measurements
                              .filter((m) => flow!.kinds.includes(m.kind))
                              .map((m, i) => (
                                <li key={i}>
                                  {m.component} / {m.label}: <strong>{m.value}</strong>
                                  <small> · {m.source}</small>
                                </li>
                              ))}
                          </ul>
                          {s.findings
                            .filter((f) => flow!.kinds.includes(f.kind))
                            .map((f, i) => (
                              <p key={i}>{f.title}</p>
                            ))}
                        </div>
                      ))}
                    </details>
                  </>
                ) : (
                  <p>
                    {current.target === 'other-device'
                      ? 'Manual evidence only. Record the other device’s tool names and result codes below.'
                      : 'No scan attached. Run a hardware scan, then return and attach its evidence.'}
                  </p>
                )}
                {current.target === 'this-device' && (
                  <button className="text-button" onClick={onScan}>
                    Open hardware scan
                    <ArrowRight size={14} />
                  </button>
                )}
              </section>
              <div className="section-heading">
                <h3>Guided fault isolation</h3>
                <span className="subtle">Results are user reported</span>
              </div>
              {!assessment!.stop && current.status === 'open' && (
                <p className="next-test">
                  {assessment!.next
                    ? `Next unresolved check: ${assessment!.next.title}`
                    : 'All guided results recorded. Review the evidence and verify the original symptom after any repair.'}
                </p>
              )}
              {assessment!.results.map(({ test, entry, interpretation }, i) => (
                <section
                  className={`panel guided-test ${activeTest === test.id ? 'expanded' : ''}`}
                  key={test.id}
                >
                  <div className="test-heading">
                    <span className="step-number">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{test.title}</h3>
                      <span className="subtle">
                        {entry ? outcomeLabels[entry.outcome!] : 'Not tested'}
                      </span>
                    </div>
                    <button
                      className="button secondary small"
                      disabled={pending}
                      onClick={() => {
                        setActiveTest(activeTest === test.id ? '' : test.id);
                        setResult('inconclusive');
                        setNote('');
                      }}
                    >
                      {activeTest === test.id
                        ? 'Close steps'
                        : entry
                          ? 'Review / retest'
                          : 'View steps'}
                    </button>
                  </div>
                  {entry && <p className="interpretation">{interpretation}</p>}
                  {activeTest === test.id && (
                    <div className="test-body">
                      <ol>
                        {test.steps.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                      {test.id === 'memory-test' && (
                        <p className="guided-platform">
                          {diagnosticGuide(current.target === 'this-device' ? platform : undefined)}
                        </p>
                      )}
                      {test.tool && (
                        <button
                          className="button secondary small"
                          disabled={Boolean(assessment!.stop)}
                          onClick={() => setTool(test.tool)}
                        >
                          Open {test.tool === 'display' ? 'display' : 'keyboard'} check
                          <ArrowRight size={14} />
                        </button>
                      )}
                      {test.id === 'background' && (
                        <button className="button secondary small" onClick={onPerformance}>
                          Open performance capture
                          <ArrowRight size={14} />
                        </button>
                      )}
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void update({ kind: 'test', testId: test.id, outcome: result, note });
                        }}
                      >
                        <label>
                          {test.question}
                          <select
                            value={result}
                            onChange={(e) => setResult(e.target.value as TestOutcome)}
                          >
                            {Object.entries(outcomeLabels).map(([id, label]) => (
                              <option key={id} value={id}>
                                {label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Test notes / exact diagnostic code
                          <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            maxLength={2000}
                            placeholder="Tool, code, configuration, duration, and what you observed."
                          />
                        </label>
                        <button
                          className="button primary small"
                          disabled={
                            pending || current.status === 'resolved' || Boolean(assessment!.stop)
                          }
                        >
                          <Check size={15} />
                          Save test result
                        </button>
                      </form>
                    </div>
                  )}
                </section>
              ))}
              <section className="panel repair-log">
                <div className="section-heading">
                  <h3>Repair log & follow-up</h3>
                  <ClipboardList size={19} />
                </div>
                <p>
                  Record one change at a time. Repeat the original workload or guided check before
                  recording a resolution.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void update({ kind: 'action', note: action });
                  }}
                >
                  <label>
                    Action taken or verification note
                    <textarea
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                      maxLength={2000}
                      placeholder="What changed? Was the symptom reproduced under the same conditions? For how long?"
                    />
                  </label>
                  <div className="button-row">
                    <button
                      className="button secondary small"
                      disabled={pending || !action.trim() || current.status === 'resolved'}
                    >
                      Save repair note
                    </button>
                    <button
                      type="button"
                      className="button primary small"
                      disabled={pending || !action.trim()}
                      onClick={() =>
                        void update({
                          kind: 'status',
                          status: current.status === 'open' ? 'resolved' : 'open',
                          note: action,
                        })
                      }
                    >
                      {current.status === 'open' ? 'Mark resolved with note' : 'Reopen with note'}
                    </button>
                  </div>
                </form>
                <div className="repair-timeline">
                  {[...current.entries].reverse().map((e) => (
                    <article key={e.id}>
                      <span className="timeline-dot" />
                      <div>
                        <small>
                          {when(e.at)} ·{' '}
                          {e.kind === 'test'
                            ? 'Test result'
                            : e.kind === 'status'
                              ? 'Status change'
                              : 'Repair action'}
                        </small>
                        <h4>
                          {e.testId
                            ? flow!.tests.find((t) => t.id === e.testId)!.title
                            : e.status
                              ? `${e.status} — user reported`
                              : 'Action recorded'}
                        </h4>
                        {e.outcome && <span className="tiny-tag">{outcomeLabels[e.outcome]}</span>}
                        {e.note && <p>{e.note}</p>}
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <div className="case-delete">
                {confirmRemove ? (
                  <div className="confirmation-inline panel">
                    <p>
                      Delete this repair case and its copied evidence? Saved hardware scans remain
                      in scan history.
                    </p>
                    <div className="button-row">
                      <button
                        className="button danger small"
                        disabled={pending}
                        onClick={async () => {
                          const updated = await mutate(() =>
                            window.pcHealth!.removeRepair(current.id),
                          );
                          if (updated) {
                            reset();
                            setSelected(updated[0]?.id);
                          }
                        }}
                      >
                        Delete repair case
                      </button>
                      <button
                        className="button secondary small"
                        onClick={() => setConfirmRemove(false)}
                      >
                        Keep case
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="text-button"
                    disabled={pending}
                    onClick={() => setConfirmRemove(true)}
                  >
                    <Trash2 size={14} />
                    Remove case
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
