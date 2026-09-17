import { useEffect, useState, useRef, type ElementType } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  BatteryMedium,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cpu,
  Database,
  Fan,
  HardDrive,
  History,
  LockKeyhole,
  MemoryStick,
  Monitor,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  X,
} from './ui/Glyphs';
import { CATALOG_VERSION } from './shared/catalog';
import ReplacementGuide from './ReplacementGuide';
import Investigations from './Investigations';
import RepairWorkbench from './RepairWorkbench';
import Reliability from './Reliability';
import { ConsoleHeader, StatusRail, type Page } from './ConsoleShell';
import SystemOverview from './SystemOverview';
import type { MonitorState } from './shared/reliability';
import DiagnosticTools from './DiagnosticTools';
import { APP_VERSION } from './shared/version';
import { compareScans, coverage } from './shared/diagnostics';
import type { Component, ComponentKind, Finding, Progress, Scan } from './shared/types';

const icons: Record<ComponentKind, ElementType> = {
  storage: HardDrive,
  battery: BatteryMedium,
  cpu: Cpu,
  memory: MemoryStick,
  gpu: Monitor,
  cooling: Fan,
  system: Activity,
};
const pageNames: Record<Page, string> = {
  reliability: 'Reliability monitor',
  repairs: 'Repair workbench',
  tools: 'Diagnostic tools',
  troubleshoot: 'Performance capture',
  overview: 'Overview',
  components: 'Your components',
  history: 'Scan history',
  replacements: 'Replacement guide',
  settings: 'Settings',
};
const formatDate = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
const platformName = (value: string) =>
  ({ darwin: 'macOS', win32: 'Windows', linux: 'Linux' })[value] || 'Desktop';
function statusFor(c: Component, findings: Finding[]) {
  const relevant = findings.filter((f) => f.componentId === c.id);
  if (relevant.some((f) => f.severity === 'urgent'))
    return { text: 'Action needed', tone: 'urgent' };
  if (relevant.length) return { text: 'Review finding', tone: 'attention' };
  return {
    text: c.checks.some((k) => k.status === 'available') ? 'See checked data' : 'Limited coverage',
    tone: 'neutral',
  };
}
export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [scans, setScans] = useState<Scan[]>([]);
  const [viewId, setViewId] = useState<string>();
  const [platform, setPlatform] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [health, setHealth] = useState<MonitorState>();
  const [cancelling, setCancelling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState<Progress>({
    stage: 'Preparing your scan',
    completed: 0,
    total: 1,
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Component>();
  const [replacementComponentId, setReplacementComponentId] = useState<string>();
  const [modal, setModal] = useState<'export' | 'clear' | null>(null);
  const [format, setFormat] = useState<'html' | 'json'>('html');
  const [dialogBusy, setDialogBusy] = useState(false);
  const dialogBusyRef = useRef(false);
  dialogBusyRef.current = dialogBusy;
  const scan = scans.find((s) => s.id === viewId) ?? scans[0];
  const index = scan ? scans.findIndex((s) => s.id === scan.id) : -1;
  const navigate = (value: Page) => {
    setPage(value);
    setSelected(undefined);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [page]);

  useEffect(() => {
    let active = true;
    if (!window.pcHealth) {
      setLoading(false);
      return;
    }
    window.pcHealth
      .bootstrap()
      .then((data) => {
        if (!active) return;
        setScans(data.scans);
        setPlatform(data.platform);
        setError(data.storageWarning ?? '');
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError('The desktop service could not initialize. Restart PC Health to try again.');
          setLoading(false);
        }
      });
    const off = window.pcHealth.onProgress(setProgress);
    const offHealth = window.pcHealth.onReliability(setHealth);
    void window.pcHealth
      .reliability()
      .then((s) => {
        if (active) setHealth(s);
      })
      .catch(() => {
        if (active)
          setError('Reliability history could not load. Existing evidence was preserved.');
      });
    void window.pcHealth
      .investigations()
      .then((data) => {
        if (active) setRecording(Boolean(data.active));
      })
      .catch(() => {});
    const offObservation = window.pcHealth.onObservation((data) =>
      setRecording(Boolean(data.active)),
    );
    return () => {
      active = false;
      off();
      offObservation();
      offHealth();
    };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!modal && !selected) return;
    const previous = document.activeElement as HTMLElement;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !dialogBusyRef.current) {
        setModal(null);
        setSelected(undefined);
      }
      if (e.key === 'Tab') {
        const dialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1);
        const elements = [
          ...(dialog?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [href], input, select, textarea, summary, [tabindex="0"]',
          ) ?? []),
        ];
        const first = elements[0],
          last = elements.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      previous?.focus();
    };
  }, [modal, selected]);

  async function startScan() {
    if (!window.pcHealth || busy || recording || health?.collecting) return;
    setReplacementComponentId(undefined);
    setBusy(true);
    setCancelling(false);
    setElapsed(0);
    setError('');
    setNotice('');
    navigate('overview');
    setProgress({ stage: 'Preparing your scan', completed: 0, total: 1 });
    try {
      const result = await window.pcHealth.scan();
      setScans((previous) => [result.scan, ...previous].slice(0, 100));
      setViewId(result.scan.id);
      setError(result.storageWarning ?? '');
    } catch {
      setError('The scan could not complete. No settings were changed. Please try again.');
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  }
  async function cancelScan() {
    setCancelling(true);
    try {
      await window.pcHealth?.cancel();
    } catch {
      setCancelling(false);
      setError('The stop request did not reach the scanner. It will still stop at its time limit.');
    }
  }
  async function confirmDialog() {
    setDialogBusy(true);
    try {
      if (modal === 'clear') {
        await window.pcHealth!.deleteHistory();
        setScans([]);
        setViewId(undefined);
        setError('');
        setNotice('Local scan history deleted.');
      } else if (scan) {
        if (await window.pcHealth!.exportReport(scan.id, format))
          setNotice('Report exported to the location you selected.');
      }
      setModal(null);
    } catch {
      setError(
        modal === 'clear'
          ? 'History could not be deleted. Please try again.'
          : 'The report could not be saved. Try another location.',
      );
    } finally {
      setDialogBusy(false);
    }
  }
  function ComponentCard({ c }: { c: Component }) {
    const Icon = icons[c.kind];
    const status = statusFor(c, scan?.findings ?? []);
    const wear = c.metrics.find((m) => ['capacity_retention', 'endurance_used'].includes(m.key));
    return (
      <button className="component-card" onClick={() => setSelected(c)}>
        <div className="component-top">
          <span className={`component-icon kind-${c.kind}`}>
            <Icon size={22} strokeWidth={1.7} />
          </span>
          <ChevronRight size={16} />
        </div>
        <span className="component-kind">
          {c.kind === 'gpu' ? 'Graphics' : c.kind === 'cpu' ? 'Processor' : c.kind}
        </span>
        <h3>{c.name}</h3>
        <p>{c.subtitle}</p>
        {wear && (
          <div className="wear">
            <span>{wear.label}</span>
            <strong>
              {wear.value}
              {wear.unit}
            </strong>
          </div>
        )}
        <div className="component-bottom">
          <span className={`status-dot ${status.tone}`} />
          {status.text}
          <span className="check-count">
            {coverage([c]).completed}/{coverage([c]).automatic} auto · {coverage([c]).guided}{' '}
            external
          </span>
        </div>
      </button>
    );
  }
  function Empty({ title, description }: { title: string; description: string }) {
    return (
      <div className="empty-state">
        <div className="empty-icon">
          <ScanLine size={30} strokeWidth={1.3} />
        </div>
        <h2>{title}</h2>
        <p>{description}</p>
        <button
          className="button primary"
          onClick={startScan}
          disabled={!window.pcHealth || busy || recording || Boolean(health?.collecting) || loading}
        >
          <ScanLine size={17} />
          Scan this computer
        </button>
      </div>
    );
  }

  return (
    <div className={`app platform-${platform}`}>
      <div className="titlebar" />
      <ConsoleHeader
        page={page}
        onNavigate={navigate}
        inert={Boolean(modal || selected)}
        alerts={health?.alerts.filter((a) => !a.acknowledgedAt).length ?? 0}
        scans={scans.length}
      />
      <main inert={Boolean(modal || selected)}>
        <header className="page-header">
          <div>
            <div className="eyebrow">
              {scan
                ? `${scan.machine.toUpperCase()} · ${platformName(scan.platform).toUpperCase()}`
                : 'PC HEALTH / LOCAL DIAGNOSTICS'}
            </div>
            <h1>{pageNames[page]}</h1>
          </div>
          <div className="header-actions">
            <span className="offline-label">
              <LockKeyhole size={13} />
              Offline & private
            </span>
            {scan && !['troubleshoot', 'repairs', 'tools', 'reliability'].includes(page) && (
              <button
                className="button secondary small"
                onClick={() => setModal('export')}
                disabled={busy}
              >
                <ArrowDownToLine size={16} />
                Export report
              </button>
            )}
          </div>
        </header>
        {!window.pcHealth && (
          <div className="message warning">
            Desktop preview only. Open PC Health with <code>npm run dev</code> to scan real
            hardware.
          </div>
        )}
        {error && (
          <div className="message warning" role="alert">
            <TriangleAlert size={18} />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="message" role="status">
            <Check size={17} />
            <span>{notice}</span>
            <button aria-label="Dismiss notification" onClick={() => setNotice('')}>
              <X size={16} />
            </button>
          </div>
        )}
        {recording && page !== 'troubleshoot' && (
          <div className="message" role="status">
            <Activity size={18} />A manual recording is in progress.
            <button className="text-button" onClick={() => navigate('troubleshoot')}>
              Open investigation
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {(health?.running || health?.collecting) && page !== 'reliability' && (
          <div className="message" role="status">
            <Activity size={18} />
            {health.collecting
              ? 'Reliability check in progress.'
              : 'Local reliability monitoring is enabled.'}
            <button className="text-button" onClick={() => navigate('reliability')}>
              Open monitor
              <ArrowRight size={15} />
            </button>
          </div>
        )}
        {page === 'reliability' && (
          <Reliability state={health} onChange={setHealth} blocked={busy || recording} />
        )}
        {page === 'repairs' && (
          <RepairWorkbench
            scan={scans[0]}
            platform={platform}
            onPerformance={() => navigate('troubleshoot')}
            onScan={() => navigate('overview')}
          />
        )}
        {page === 'tools' && <DiagnosticTools />}
        {page === 'troubleshoot' && (
          <Investigations scanning={busy || Boolean(health?.collecting)} scan={scans[0]} />
        )}
        {page === 'overview' && (
          <SystemOverview
            scan={scan}
            busy={busy}
            blocked={recording || Boolean(health?.collecting)}
            loading={loading}
            progress={progress}
            elapsed={elapsed}
            cancelling={cancelling}
            onScan={startScan}
            onCancel={cancelScan}
            onNavigate={navigate}
            onSelect={setSelected}
            components={scan?.components.slice(0, 6).map((c) => (
              <ComponentCard key={c.id} c={c} />
            ))}
          />
        )}
        {page === 'components' &&
          (scan ? (
            <>
              <p className="page-description">
                A closer look at your hardware, the evidence we can read, and what still needs
                checking.
              </p>
              <div className="component-grid">
                {scan.components.map((c) => (
                  <ComponentCard key={c.id} c={c} />
                ))}
              </div>
              <div className="message">
                <CircleHelp size={18} />
                Inventory identifies a component. It is not a test of its remaining life.
              </div>
            </>
          ) : (
            <Empty
              title="No component scan"
              description="Run a manual scan to see the hardware in this computer and its available health indicators."
            />
          ))}
        {page === 'history' &&
          (scans.length ? (
            <>
              <p className="page-description">
                Your scans stay on this computer. Conditions between scans are not observed.
              </p>
              <div className="history-list">
                {scans.map((s, i) => (
                  <button
                    className={`history-row ${scan?.id === s.id ? 'selected' : ''}`}
                    key={s.id}
                    onClick={() => {
                      setViewId(s.id);
                      setSelected(undefined);
                    }}
                  >
                    <span className="history-icon">
                      <History size={21} />
                    </span>
                    <div>
                      <strong>
                        {formatDate(s.completedAt)}
                        {i === 0 && <span className="tiny-tag">Latest</span>}
                      </strong>
                      <p>
                        {s.machine} · {platformName(s.platform)} ·{' '}
                        {s.state === 'complete' ? 'Completed' : 'Stopped · partial results'}
                      </p>
                    </div>
                    <span>{s.findings.length} findings</span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <section className="panel changes">
                <div className="section-heading">
                  <h2>Changes between scans</h2>
                  <Clock3 size={19} />
                </div>
                {compareScans(scan!, scans[index + 1]).map((change) => (
                  <p key={change}>{change}</p>
                ))}
                <button className="text-button" onClick={() => navigate('overview')}>
                  View selected scan
                  <ArrowRight size={15} />
                </button>
              </section>
            </>
          ) : (
            <Empty
              title="No saved scans"
              description="Saved scans will appear here so you can compare available readings over time."
            />
          ))}
        {page === 'replacements' && (
          <ReplacementGuide scan={scan} initialComponentId={replacementComponentId} />
        )}
        {page === 'settings' && (
          <>
            <p className="page-description">
              Local storage, collection policy and application version.
            </p>
            <section className="panel settings-panel">
              <h2>Privacy & scanning</h2>
              {[
                {
                  icon: LockKeyhole,
                  name: 'Local processing',
                  description: 'Scans and explanations are processed on this computer.',
                  value: 'Always on',
                },
                {
                  icon: ScanLine,
                  name: 'Reliability monitoring',
                  description:
                    'Optional local checks while the app is open. Starts off each launch; no automatic repairs.',
                  value: health?.running ? 'Enabled' : 'Off',
                },
                {
                  icon: Database,
                  name: 'Local history',
                  description:
                    'The latest 100 scans are stored in the app’s private data directory.',
                  value: `${scans.length} scans`,
                },
                {
                  icon: Activity,
                  name: 'Evidence-based explanations',
                  description:
                    'Versioned diagnostic rules. No cloud AI or downloaded language model.',
                  value: 'Offline',
                },
              ].map(({ icon: Icon, name, description, value }) => (
                <div className="setting-row" key={name}>
                  <Icon size={21} strokeWidth={1.5} />
                  <div>
                    <h3>{name}</h3>
                    <p>{description}</p>
                  </div>
                  <span className="setting-value">{value}</span>
                </div>
              ))}
            </section>
            <section className="panel settings-panel">
              <h2>Your data</h2>
              <div className="setting-row">
                <Database size={21} strokeWidth={1.5} />
                <div>
                  <h3>Clear scan history</h3>
                  <p>
                    Delete all saved scans on this computer. Export a report first if you want to
                    keep it. Copied evidence inside repair cases is kept separately; remove those
                    cases in the repair workbench.
                  </p>
                </div>
                <button
                  className="button danger small"
                  disabled={busy || !window.pcHealth || (!scans.length && !error)}
                  onClick={() => setModal('clear')}
                >
                  Clear history
                </button>
              </div>
            </section>
            <section className="panel settings-panel">
              <h2>About this preview</h2>
              <p>
                PC Health {APP_VERSION} · {platformName(platform)} · Catalog {CATALOG_VERSION}
              </p>
              <p>
                Initial collectors are implemented for macOS, Windows, and Linux. Sensor coverage
                varies. Manual slowness investigations sample real resource use and save follow-up
                comparisons. Recent stability evidence is summarized where readable. Guided repair
                cases and manual keyboard/display tools are available. Reliability monitoring tracks
                supported error counters and records local alerts. Detailed Windows SMART logs,
                automated root-cause diagnosis, verified OEM part matching, and local conversational
                AI are not implemented yet.
              </p>
              <p>
                Optional smartmontools can provide detailed drive health on macOS and Linux when
                already installed and permitted. PC Health never installs it automatically or
                requests elevated access in this preview.
              </p>
            </section>
          </>
        )}
      </main>
      <StatusRail
        inert={Boolean(modal || selected)}
        running={Boolean(health?.running)}
        collecting={Boolean(health?.collecting)}
        busy={busy}
        recording={recording}
      />
      {selected && (
        <div className="drawer-backdrop" onClick={() => setSelected(undefined)}>
          <section
            className="detail-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${selected.name} details`}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close-button"
              aria-label="Close component details"
              onClick={() => setSelected(undefined)}
              autoFocus
            >
              <X size={20} />
            </button>
            <span className="component-icon large">
              {(() => {
                const Icon = icons[selected.kind];
                return <Icon size={30} strokeWidth={1.5} />;
              })()}
            </span>
            <div className="eyebrow">{selected.kind}</div>
            <h2>{selected.name}</h2>
            <p className="page-description">{selected.subtitle}</p>
            {scan?.findings
              .filter((f) => f.componentId === selected.id)
              .map((f) => (
                <div className={`detail-finding ${f.severity}`} key={f.id}>
                  <h3>{f.title}</h3>
                  <p>{f.action}</p>
                  <ul>
                    {f.evidence.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                  <small>{f.limitation}</small>
                </div>
              ))}
            <h3 className="detail-heading">Observed measurements</h3>
            {selected.metrics.length ? (
              <div className="measurement-list">
                {selected.metrics.map((m) => (
                  <div key={m.key}>
                    <span>
                      {m.label}
                      <small>{m.source}</small>
                    </span>
                    <strong>
                      {m.value}
                      {m.unit}
                    </strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="subtle">No supported measurements were returned.</p>
            )}
            <h3 className="detail-heading">What was checked</h3>
            {selected.checks.map((c) => (
              <div className="check-detail" key={c.id}>
                <span className={`check-symbol ${c.status === 'available' ? 'done' : ''}`}>
                  {c.status === 'available' ? <Check size={15} /> : <CircleHelp size={15} />}
                </span>
                <div>
                  <strong>
                    {c.label}
                    <span>
                      {
                        {
                          available: 'Completed',
                          unsupported: 'Unavailable',
                          permission: 'Access denied',
                          error: 'Incomplete',
                          'not-run': [
                            'cpu-faults',
                            'memory-test',
                            'physical',
                            'gpu-health',
                          ].includes(c.id)
                            ? 'External test'
                            : 'Not run',
                        }[c.status]
                      }
                    </span>
                  </strong>
                  <p>{c.detail}</p>
                  <small>Source: {c.source}</small>
                </div>
              </div>
            ))}
            {selected.kind === 'memory' && (
              <div className="guided">
                <h3>Next step: an offline memory test</h3>
                <p>
                  {platform === 'darwin'
                    ? 'Save your work. Apple silicon: shut down, hold the power button until startup options appear, then press Command-D. Intel Mac: start up while holding D.'
                    : platform === 'win32'
                      ? 'Save your work, search Windows for “Windows Memory Diagnostic,” and review its restart options. A test requires restarting your computer.'
                      : 'Use an offline memory diagnostic supported by your distribution and hardware. Prepare compatible boot media separately and save your work before restarting.'}
                </p>
                <small>
                  This guide does not run a test. A memory-test error can involve RAM, the memory
                  controller, CPU, or motherboard.
                </small>
              </div>
            )}
            {['storage', 'battery', 'cpu', 'memory', 'gpu'].includes(selected.kind) && (
              <div className="guided">
                <h3>Before replacing this component</h3>
                <p>Review the evidence and verify the exact computer’s service requirements.</p>
                <button
                  className="text-button"
                  onClick={() => {
                    setReplacementComponentId(selected.id);
                    navigate('replacements');
                  }}
                >
                  Open replacement guide
                  <ArrowRight size={15} />
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop">
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <button
              className="close-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
              disabled={dialogBusy}
            >
              <X size={19} />
            </button>
            <span className="modal-icon">
              {modal === 'export' ? <ArrowDownToLine size={26} /> : <Database size={26} />}
            </span>
            <h2 id="dialog-title">
              {modal === 'export' ? 'Export hardware report' : 'Clear local scan history?'}
            </h2>
            {modal === 'export' ? (
              <>
                <p>Review this summary, then choose where to save. Nothing is uploaded.</p>
                <div className="export-preview">
                  <strong>{scan?.machine}</strong>
                  <span>{scan && formatDate(scan.completedAt)}</span>
                  <p>
                    {scan?.components.length} component records · {scan?.findings.length} findings
                    <br />
                    Coverage, evidence, and limitations included.
                  </p>
                  <small>
                    <ShieldCheck size={13} />
                    Device identifiers are removed from exports.
                  </small>
                </div>
                <label className="field-label" htmlFor="export-format">
                  Report format
                </label>
                <select
                  id="export-format"
                  value={format}
                  onChange={(e) => setFormat(e.target.value as 'html' | 'json')}
                >
                  <option value="html">Readable report (.html)</option>
                  <option value="json">Structured data (.json)</option>
                </select>
              </>
            ) : (
              <p>
                This permanently deletes {scans.length} saved scans from this app. Files you
                previously exported will remain.
              </p>
            )}
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setModal(null)}
                disabled={dialogBusy}
              >
                Cancel
              </button>
              <button
                className={`button ${modal === 'clear' ? 'danger' : 'primary'}`}
                onClick={confirmDialog}
                disabled={dialogBusy}
                autoFocus
              >
                {dialogBusy
                  ? 'Please wait…'
                  : modal === 'clear'
                    ? 'Delete saved scans'
                    : 'Choose save location'}
                {modal === 'export' && <ArrowRight size={16} />}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
