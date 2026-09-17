import type { ReactNode } from 'react';
import type { Scan, Progress, Component } from './shared/types';
import { coverage } from './shared/diagnostics';
import {
  Activity,
  ArrowRight,
  Cpu,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  Wrench,
} from './ui/Glyphs';
import type { Page } from './ConsoleShell';
function BoardDrawing() {
  return (
    <svg className="board-drawing" viewBox="0 0 250 210" aria-hidden="true" fill="none">
      <path className="board-plane" d="m125 19 110 63v53l-110 64L15 135V82z" />
      <path d="m15 82 110 64 110-64M125 146v53M15 99l110 64 110-64M15 119l110 64 110-64" />
      <path
        className="board-chip"
        d="m125 42 63 37-63 36-63-36zm-63 37v23l63 36 63-36V79M125 115v23"
      />
      <path d="m125 53 44 26-44 25-44-25zM41 97l14 8m-1-20 14 8m-1-20 14 8m-1 39 14 8m-1-20 14 8m44 3 14-8m-1 20 14-8m-1-20 14-8m-1 20 14-8" />
      <path className="board-core" d="m125 64 26 15-26 15-26-15z" />
      <path
        className="board-leads"
        d="M23 43h38l26 15M6 166h41l18-10M181 153l25 15h36M201 44h-21l-17 10"
      />
      <path d="M20 39v8m-4-4h8M239 164v8m-4-4h8" />
    </svg>
  );
}
export default function SystemOverview({
  scan,
  busy,
  blocked,
  loading,
  progress,
  elapsed,
  cancelling,
  onScan,
  onCancel,
  onNavigate,
  onSelect,
  components,
}: {
  scan?: Scan;
  busy: boolean;
  blocked: boolean;
  loading: boolean;
  progress: Progress;
  elapsed: number;
  cancelling: boolean;
  onScan: () => void;
  onCancel: () => void;
  onNavigate: (p: Page) => void;
  onSelect: (c: Component | undefined) => void;
  components: ReactNode;
}) {
  const counts = coverage(scan?.components ?? []),
    urgent = scan?.findings.some((f) => f.severity === 'urgent');
  const findings = scan?.findings ?? [];
  return (
    <div className="system-overview">
      <section
        className={`host-panel ${scan && !busy ? 'has-baseline' : ''} ${busy ? 'scanning' : ''}`}
        aria-labelledby="host-title"
      >
        <div className="host-copy">
          <div className="console-kicker">
            <span />
            HOST / {scan ? 'IDENTIFIED' : 'AWAITING SCAN'}
          </div>
          <h2 id="host-title">
            {scan?.machine ?? 'Your hardware.'}
            {(busy || !scan) && (
              <span>{busy ? 'Reading system evidence' : 'Start with a baseline'}</span>
            )}
          </h2>
          <p>
            {scan
              ? 'Select a component to inspect its readings, check coverage and review the next step.'
              : 'Inspect storage, battery and system evidence. Find out what needs attention, and what still needs testing.'}
          </p>
          {busy ? (
            <div className="scan-progress" aria-live="polite">
              <div className="progress-meta">
                <span>{progress.stage}</span>
                <span>{elapsed}s</span>
              </div>
              <div className="progress-track">
                <div
                  style={{ width: `${Math.max(6, (progress.completed / progress.total) * 100)}%` }}
                />
              </div>
              <button className="button secondary small" disabled={cancelling} onClick={onCancel}>
                {cancelling ? 'Stopping…' : 'Stop scan'}
              </button>
            </div>
          ) : (
            <div className="host-actions">
              <button
                className="button scan-button"
                disabled={loading || blocked || !window.pcHealth}
                onClick={onScan}
              >
                <ScanLine size={20} />
                {loading ? 'Loading…' : scan ? 'Run a new scan' : 'Scan this computer'}
                <ArrowRight size={17} />
              </button>
              <span>
                {scan
                  ? `LAST SCAN / ${new Date(scan.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`
                  : 'PASSIVE CHECK / ON DEMAND'}
              </span>
            </div>
          )}
        </div>
        <div className="host-visual">
          <BoardDrawing />
          <div className="host-visual-label">
            <Cpu size={14} />
            {scan
              ? `${scan.arch.toUpperCase()} / ${scan.components.filter((c) => c.kind !== 'system').length} COMPONENT RECORDS`
              : 'OS-VISIBLE HARDWARE'}
          </div>
        </div>
        <div className="host-metrics" aria-label="Scan summary">
          <div>
            <span>Automatic checks readable</span>
            <strong>
              {scan ? counts.completed : '—'}
              <small> / {scan ? counts.automatic : '—'}</small>
            </strong>
          </div>
          <div>
            <span>Findings to review</span>
            <strong className={findings.length ? 'metric-warning' : ''}>
              {scan ? findings.length : '—'}
            </strong>
          </div>
          <div>
            <span>Collection gaps / external checks</span>
            <strong>
              {scan ? counts.unavailable : '—'}
              <small> / {scan ? counts.guided : '—'}</small>
            </strong>
          </div>
          <p>
            Automatic readings and external integrity tests are separate. Coverage is not a health
            score.
          </p>
        </div>
      </section>
      {scan?.state === 'cancelled' && (
        <div className="message warning">
          <TriangleAlert size={18} />
          This scan stopped or reached its time limit. Results below are partial.
        </div>
      )}
      <div className="overview-workspace">
        <section className="hardware-bay" aria-labelledby="components-title">
          <div className="console-section-heading">
            <h2 id="components-title">Your components</h2>
            <span>{scan ? 'HARDWARE / INVENTORY' : 'NO EVIDENCE YET'}</span>
            {scan && (
              <button className="text-button" onClick={() => onNavigate('components')}>
                Inspect all
                <ArrowRight size={15} />
              </button>
            )}
          </div>
          {scan ? (
            <div className="component-grid">{components}</div>
          ) : (
            <div className="baseline-inventory">
              {[
                {
                  icon: Cpu,
                  label: 'Processing & memory',
                  text: 'Component identification and supported checks.',
                },
                {
                  icon: ShieldCheck,
                  label: 'Storage & power',
                  text: 'Device health, wear indicators and battery condition.',
                },
                {
                  icon: Activity,
                  label: 'System reliability',
                  text: 'Retained error evidence and missing capabilities.',
                },
              ].map(({ icon: Icon, label, text }) => (
                <div key={label}>
                  <Icon size={34} />
                  <h3>{label}</h3>
                  <p>{text}</p>
                  <span>AWAITING SCAN</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="diagnostic-queue">
          <div className="console-section-heading">
            <h2>Diagnostic queue</h2>
            <span>{scan ? String(findings.length).padStart(2, '0') : '—'}</span>
          </div>
          <div className={`queue-state ${urgent ? 'urgent' : findings.length ? 'attention' : ''}`}>
            <TriangleAlert size={20} />
            <div>
              <strong>
                {urgent
                  ? 'Action required'
                  : findings.length
                    ? 'Review findings'
                    : scan
                      ? 'No actionable findings'
                      : 'No scan recorded'}
              </strong>
              <p>
                {scan
                  ? 'Read the evidence before choosing a repair.'
                  : 'Run a scan to establish a starting point.'}
              </p>
            </div>
          </div>
          {findings.map((f) => (
            <article key={f.id} className={`queue-finding ${f.severity}`}>
              <span>{f.severity === 'urgent' ? 'URGENT / PROTECT DATA' : 'INVESTIGATE'}</span>
              <h3>{f.title}</h3>
              <p>{f.action}</p>
              <button
                className="text-button"
                onClick={() => onSelect(scan?.components.find((c) => c.id === f.componentId))}
              >
                See the evidence
                <ArrowRight size={15} />
              </button>
            </article>
          ))}
          {!findings.length && scan && (
            <p className="queue-empty">
              Unavailable checks cannot establish that a component is healthy. Review the coverage
              in each component.
            </p>
          )}
          <div className="queue-actions">
            <span className="console-kicker">AVAILABLE OPERATIONS</span>
            <button onClick={() => onNavigate('repairs')} aria-label="Open repair workbench">
              <Wrench size={20} />
              <span>
                <strong>Repair workbench</strong>
                <small>Isolate a fault. Record the outcome.</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <button onClick={() => onNavigate('reliability')}>
              <ShieldCheck size={20} />
              <span>
                <strong>Reliability monitor</strong>
                <small>Track errors and changes over time.</small>
              </span>
              <ArrowRight size={16} />
            </button>
            <button onClick={() => onNavigate('troubleshoot')}>
              <Activity size={20} />
              <span>
                <strong>Capture a slowdown</strong>
                <small>Measure the workload behind a symptom.</small>
              </span>
              <ArrowRight size={16} />
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
