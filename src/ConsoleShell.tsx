import {
  Cpu,
  History,
  LayoutDashboard,
  LockKeyhole,
  Settings2,
  ShieldCheck,
  Wrench,
} from './ui/Glyphs';
import { APP_VERSION } from './shared/version';
export type Page =
  | 'overview'
  | 'reliability'
  | 'repairs'
  | 'tools'
  | 'troubleshoot'
  | 'components'
  | 'history'
  | 'replacements'
  | 'settings';
const groups = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutDashboard,
    default: 'overview',
    pages: ['overview'],
  },
  {
    id: 'reliability',
    label: 'Reliability',
    icon: ShieldCheck,
    default: 'reliability',
    pages: ['reliability'],
  },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    icon: Wrench,
    default: 'repairs',
    pages: ['repairs', 'troubleshoot', 'tools'],
  },
  {
    id: 'hardware',
    label: 'Hardware',
    icon: Cpu,
    default: 'components',
    pages: ['components', 'replacements'],
  },
  { id: 'records', label: 'Records', icon: History, default: 'history', pages: ['history'] },
] as const;
const secondary: Partial<Record<Page, { page: Page; label: string }[]>> = {
  repairs: [
    { page: 'repairs', label: 'Repair workbench' },
    { page: 'troubleshoot', label: 'Performance capture' },
    { page: 'tools', label: 'Diagnostic tools' },
  ],
  components: [
    { page: 'components', label: 'Components' },
    { page: 'replacements', label: 'Replacement guide' },
  ],
  history: [{ page: 'history', label: 'Scan history' }],
  reliability: [{ page: 'reliability', label: 'Reliability monitor' }],
};
export function ConsoleHeader({
  page,
  onNavigate,
  inert,
  alerts,
  scans,
}: {
  page: Page;
  onNavigate: (page: Page) => void;
  inert: boolean;
  alerts: number;
  scans: number;
}) {
  const active = groups.find((g) => (g.pages as readonly string[]).includes(page));
  const links = secondary[active?.default ?? 'overview'];
  return (
    <header className="console-header" inert={inert}>
      <div className="console-masthead">
        <a
          className="console-brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            onNavigate('overview');
          }}
          aria-label="PC Health overview"
        >
          <span className="brand-sigil" aria-hidden="true">
            <Cpu size={27} />
          </span>
          <span>
            PC<span className="brand-slash">/</span>HEALTH<small>HARDWARE DIAGNOSTICS</small>
          </span>
        </a>
        <nav className="console-navigation" aria-label="Main navigation">
          {groups.map(({ id, label, icon: Icon, default: target }, i) => (
            <button
              key={id}
              className={`console-tab ${active?.id === id ? 'selected' : ''}`}
              aria-current={active?.id === id ? 'page' : undefined}
              onClick={() => onNavigate(target)}
            >
              <span className="nav-index" aria-hidden="true">
                0{i + 1}
              </span>
              <Icon size={19} />
              <span>{label}</span>
              {id === 'reliability' && alerts > 0 && (
                <span className="console-count" aria-hidden="true">
                  {alerts}
                </span>
              )}
              {id === 'records' && scans > 0 && (
                <span className="console-count" aria-hidden="true">
                  {scans}
                </span>
              )}
            </button>
          ))}
        </nav>
        <button
          className={`console-settings ${page === 'settings' ? 'selected' : ''}`}
          aria-label="Settings"
          aria-current={page === 'settings' ? 'page' : undefined}
          title="Settings"
          onClick={() => onNavigate('settings')}
        >
          <Settings2 size={23} />
        </button>
      </div>
      <div className="console-subnav">
        <span className="console-section">
          {active?.label ?? 'System'}
          <span aria-hidden="true"> / </span>
        </span>
        {links ? (
          <nav aria-label="Section navigation">
            {links.map((l) => (
              <button
                key={l.page}
                className={page === l.page ? 'selected' : ''}
                aria-current={page === l.page ? 'page' : undefined}
                onClick={() => onNavigate(l.page)}
              >
                {l.label}
              </button>
            ))}
          </nav>
        ) : (
          <span className="console-context">
            {page === 'settings'
              ? 'Preferences & local data'
              : 'Host status & diagnostic priorities'}
          </span>
        )}
        <span className="console-local">
          <LockKeyhole size={12} />
          LOCAL ACCESS
        </span>
      </div>
    </header>
  );
}
export function StatusRail({
  inert,
  running,
  collecting,
  busy,
  recording,
}: {
  inert: boolean;
  running: boolean;
  collecting: boolean;
  busy: boolean;
  recording: boolean;
}) {
  return (
    <footer className="status-rail" inert={inert}>
      <span className="rail-mode">
        <i />
        OFFLINE SYSTEM
      </span>
      <span>
        {busy
          ? 'HARDWARE SCAN ACTIVE'
          : recording
            ? 'PERFORMANCE RECORDING'
            : collecting
              ? 'READING RELIABILITY'
              : running
                ? 'MONITORING ENABLED'
                : 'MONITORING OFF'}
      </span>
      <span className="rail-version">
        PC HEALTH <b>{APP_VERSION}</b> / PREVIEW
      </span>
    </footer>
  );
}
