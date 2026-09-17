import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Keyboard, Monitor, Maximize2, RotateCcw } from './ui/Glyphs';
export type ToolKind = 'keyboard' | 'display';
const rows = [
  ['Escape', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
  [
    'Backquote',
    'Digit1',
    'Digit2',
    'Digit3',
    'Digit4',
    'Digit5',
    'Digit6',
    'Digit7',
    'Digit8',
    'Digit9',
    'Digit0',
    'Minus',
    'Equal',
    'Backspace',
  ],
  [
    'Tab',
    'KeyQ',
    'KeyW',
    'KeyE',
    'KeyR',
    'KeyT',
    'KeyY',
    'KeyU',
    'KeyI',
    'KeyO',
    'KeyP',
    'BracketLeft',
    'BracketRight',
    'Backslash',
  ],
  [
    'CapsLock',
    'KeyA',
    'KeyS',
    'KeyD',
    'KeyF',
    'KeyG',
    'KeyH',
    'KeyJ',
    'KeyK',
    'KeyL',
    'Semicolon',
    'Quote',
    'Enter',
  ],
  [
    'ShiftLeft',
    'KeyZ',
    'KeyX',
    'KeyC',
    'KeyV',
    'KeyB',
    'KeyN',
    'KeyM',
    'Comma',
    'Period',
    'Slash',
    'ShiftRight',
  ],
  [
    'ControlLeft',
    'AltLeft',
    'MetaLeft',
    'Space',
    'MetaRight',
    'AltRight',
    'ControlRight',
    'ArrowLeft',
    'ArrowUp',
    'ArrowDown',
    'ArrowRight',
  ],
];
const labels: Record<string, string> = {
  Escape: 'Esc',
  Backquote: '`',
  Minus: '−',
  Equal: '=',
  Backspace: '⌫',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  CapsLock: 'Caps',
  Semicolon: ';',
  Quote: "'",
  ShiftLeft: 'Shift L',
  ShiftRight: 'Shift R',
  Comma: ',',
  Period: '.',
  Slash: '/',
  ControlLeft: 'Ctrl L',
  ControlRight: 'Ctrl R',
  AltLeft: 'Alt L',
  AltRight: 'Alt R',
  MetaLeft: 'Meta L',
  MetaRight: 'Meta R',
  Space: 'Space',
  ArrowLeft: '←',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowRight: '→',
};
const patterns = [
  { name: 'White', color: '#ffffff' },
  { name: 'Black', color: '#000000' },
  { name: 'Red', color: '#ff0000' },
  { name: 'Green', color: '#00ff00' },
  { name: 'Blue', color: '#0000ff' },
  { name: 'Gray', color: '#808080' },
  { name: 'Gradient', color: 'linear-gradient(90deg, #000, #fff)' },
];
export default function DiagnosticTools({
  initial,
  onBack,
}: {
  initial?: ToolKind;
  onBack?: () => void;
}) {
  const [tool, setTool] = useState<ToolKind | undefined>(initial);
  const [seen, setSeen] = useState<string[]>([]);
  const [down, setDown] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [last, setLast] = useState('No events received');
  const [pattern, setPattern] = useState(0);
  const [full, setFull] = useState(false);
  const [controlsTop, setControlsTop] = useState(false);
  const [error, setError] = useState('');
  const pad = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    const blur = () => {
      setDown([]);
      setListening(false);
    };
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      window.removeEventListener('blur', blur);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  return (
    <div className="tools-workspace">
      <div className="section-heading">
        <div>
          <span className="eyebrow">MANUAL • LOCAL • NO INSTALLATION</span>
          <h2>Peripheral checks</h2>
        </div>
        {(tool || onBack) && (
          <button
            className="button secondary small"
            onClick={() => {
              setTool(undefined);
              setListening(false);
              onBack?.();
            }}
          >
            <ArrowLeft size={16} />
            {onBack ? 'Back to repair case' : 'All tools'}
          </button>
        )}
      </div>
      {!tool && (
        <>
          <p className="page-description">
            Direct input and visual checks. Results require your observation; these tools do not
            certify hardware health.
          </p>
          <div className="tool-grid">
            <button className="tool-card panel" onClick={() => setTool('keyboard')}>
              <Keyboard size={28} />
              <h3>Keyboard check</h3>
              <p>
                View physical key events received by this app. Identify missing keys and compare
                keyboards.
              </p>
              <span className="text-button">Open keyboard check →</span>
            </button>
            <button className="tool-card panel" onClick={() => setTool('display')}>
              <Monitor size={28} />
              <h3>Display check</h3>
              <p>
                Inspect solid colors and a grayscale gradient for persistent dots, lines and uneven
                areas.
              </p>
              <span className="text-button">Open display check →</span>
            </button>
          </div>
        </>
      )}
      {tool === 'keyboard' && (
        <section className="panel tool-panel">
          <div className="section-heading">
            <h2>Keyboard check</h2>
            <span className="tiny-tag">{seen.length} unique codes received</span>
          </div>
          <p>
            Click the test pad, then press individual keys. Tab leaves the pad; Escape releases it.
            OS shortcuts and firmware keys may not reach the app. The layout below is a reference,
            not detected hardware.
          </p>
          <div
            ref={pad}
            tabIndex={0}
            role="group"
            aria-label="Keyboard test pad"
            className={`keyboard-pad ${listening ? 'listening' : ''}`}
            onFocus={() => setListening(true)}
            onBlur={() => {
              setListening(false);
              setDown([]);
            }}
            onKeyDown={(e) => {
              if (e.code === 'Escape') {
                e.currentTarget.blur();
                return;
              }
              if (e.code === 'Tab') return;
              if (!e.metaKey && !e.ctrlKey && !e.altKey) e.preventDefault();
              if (!e.code) return;
              setSeen((previous) => (previous.includes(e.code) ? previous : [...previous, e.code]));
              setDown((previous) => (previous.includes(e.code) ? previous : [...previous, e.code]));
              setLast(`${e.code}${e.repeat ? ' · held key repeat' : ' · key down'}`);
            }}
            onKeyUp={(e) => {
              setDown((previous) => previous.filter((k) => k !== e.code));
              if (e.code) setLast(`${e.code} · key up`);
            }}
          >
            <div className="keyboard-state">
              <span className={`status-dot ${listening ? 'live' : ''}`} />
              {listening
                ? 'Receiving keys while this pad has focus'
                : 'Click here to receive key events'}
            </div>
            <div className="keyboard-map" aria-hidden="true">
              {rows.map((row, i) => (
                <div className="key-row" key={i}>
                  {row.map((code) => (
                    <span
                      className={`key ${seen.includes(code) ? 'seen' : ''} ${down.includes(code) ? 'pressed' : ''} ${code === 'Space' ? 'space-key' : ''}`}
                      key={code}
                    >
                      {labels[code] ?? code.replace(/^(Key|Digit)/, '')}
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <p className="key-event">{last}</p>
          </div>
          <div className="button-row">
            <button
              className="button secondary small"
              onClick={() => {
                setSeen([]);
                setDown([]);
                setLast('No events received');
                pad.current?.focus();
              }}
            >
              <RotateCcw size={15} />
              Reset key check
            </button>
            <span className="subtle">
              Physical codes only. No typed text or key history is saved.
            </span>
          </div>
          <details>
            <summary>Received key codes</summary>
            <p>{seen.join(', ') || 'None received.'}</p>
          </details>
          <p className="form-note">
            A received event confirms delivery only for this session. Repeats can be normal while a
            key is held; this is not an automatic switch-chatter diagnosis.
          </p>
        </section>
      )}
      {tool === 'display' && (
        <section className="panel tool-panel">
          <div className="section-heading">
            <h2>Display check</h2>
            <span className="tiny-tag">Static patterns</span>
          </div>
          <p>
            Use a comfortable brightness. Select colors manually and inspect for marks that stay in
            the same position. Press Escape to exit full screen. No automatic cycling or flashing.
          </p>
          <div className="pattern-controls" role="group" aria-label="Display patterns">
            {patterns.map((p, i) => (
              <button
                key={p.name}
                className={`button secondary small ${i === pattern ? 'selected' : ''}`}
                aria-pressed={i === pattern}
                onClick={() => setPattern(i)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div
            ref={screen}
            role="group"
            className={`display-pattern ${full ? 'full' : ''}`}
            style={{ background: patterns[pattern].color }}
            aria-label={`${patterns[pattern].name} display pattern`}
          >
            {full && (
              <div className={`fullscreen-controls ${controlsTop ? 'top' : ''}`}>
                <span>{patterns[pattern].name}</span>
                <button
                  className="button secondary small"
                  onClick={() => setControlsTop(!controlsTop)}
                >
                  Move controls
                </button>
                <button
                  className="button secondary small"
                  onClick={() => setPattern((pattern + 1) % patterns.length)}
                >
                  Next pattern
                </button>
                <button
                  className="button secondary small"
                  onClick={() => void document.exitFullscreen()}
                >
                  Exit full screen
                </button>
              </div>
            )}
          </div>
          <button
            className="button secondary"
            onClick={async () => {
              try {
                await screen.current?.requestFullscreen();
              } catch {
                setError('Full screen is unavailable. The windowed pattern remains usable.');
              }
            }}
          >
            <Maximize2 size={16} />
            Open full screen
          </button>
          {error && <p role="alert">{error}</p>}
          <p className="form-note">
            This is a visual inspection aid. It cannot detect defects automatically, repair pixels
            or measure color accuracy.
          </p>
        </section>
      )}
    </div>
  );
}
