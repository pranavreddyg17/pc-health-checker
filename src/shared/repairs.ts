import type { ComponentKind, Scan } from './types';

export const REPAIR_RULE_VERSION = '0.4.0';
export type Symptom = 'storage' | 'charging' | 'heat' | 'crash' | 'boot' | 'display' | 'keyboard';
export type TestOutcome = 'observed' | 'not-observed' | 'inconclusive';
export interface RepairTest {
  id: string;
  title: string;
  steps: string[];
  question: string;
  observed: string;
  notObserved: string;
  tool?: 'display' | 'keyboard';
}
export interface RepairFlow {
  title: string;
  summary: string;
  kinds: ComponentKind[];
  patterns: { id: string; label: string; lead: string }[];
  tests: RepairTest[];
}
export const repairFlows: Record<Symptom, RepairFlow> = {
  storage: {
    title: 'Storage & missing files',
    summary: 'Separate capacity pressure, connection issues and drive warnings.',
    kinds: ['storage'],
    patterns: [
      {
        id: 'full',
        label: 'Disk full or almost full',
        lead: 'Capacity pressure can prevent updates and file saves. It does not establish drive wear.',
      },
      {
        id: 'errors',
        label: 'Read errors, damaged files or disappearing drive',
        lead: 'Protect readable files before further testing. Media, connection and filesystem faults remain possible.',
      },
      {
        id: 'slow',
        label: 'Slow copying or opening files',
        lead: 'Throughput depends on workload, free space and the connection. A slow copy alone does not establish drive failure.',
      },
    ],
    tests: [
      {
        id: 'backup',
        title: 'Confirm a usable backup',
        steps: [
          'Check an existing backup on a separate device or service.',
          'Open a few important files from that backup. Do not overwrite your only copy.',
          'If the source drive clicks, disconnects or has unreadable data, stop retrying and seek recovery advice.',
        ],
        question: 'Can you open important files from a separate backup?',
        observed:
          'A separate readable copy was confirmed. This is not a complete backup verification.',
        notObserved:
          'Data protection remains unresolved. Prioritize backup or recovery before repair.',
      },
      {
        id: 'space',
        title: 'Check space on the affected volume',
        steps: [
          'Open the operating system’s storage view for the volume with the problem.',
          'Record free and total capacity. Review large files manually; do not delete unknown system files.',
          'If space was low, move only backed-up personal files, then retry the original save or update.',
        ],
        question: 'Did freeing space resolve the original operation?',
        observed:
          'Capacity pressure is supported as a cause of this operation failing. Drive health remains a separate question.',
        notObserved:
          'Capacity alone has not explained the failure. Review device warnings and filesystem or connection evidence.',
      },
      {
        id: 'disk-check',
        title: 'Record the device diagnostic result',
        steps: [
          'Use the drive or computer manufacturer’s diagnostic instructions for this exact model.',
          'Choose a non-destructive health read first. Do not run erase, repair or extended tests on suspect media before protecting data.',
          'Record the tool, exact result code and affected drive in the notes.',
        ],
        question: 'Did the diagnostic explicitly report a drive failure?',
        observed:
          'A reported device diagnostic failure supports service of that drive. Confirm the exact code and device before ordering parts.',
        notObserved:
          'No failure was reported by this test. Intermittent faults and filesystem issues remain possible.',
      },
    ],
  },
  charging: {
    title: 'Battery & charging',
    summary: 'Separate reduced runtime from adapter, cable and charging-path issues.',
    kinds: ['battery'],
    patterns: [
      {
        id: 'runtime',
        label: 'Short runtime on battery',
        lead: 'Compare battery capacity evidence with workload and power settings; heavy use can shorten runtime even with a serviceable battery.',
      },
      {
        id: 'no-charge',
        label: 'Plugged in but not charging',
        lead: 'A charge limit, temperature restriction, cable, adapter or port can explain this. Battery replacement is not established.',
      },
      {
        id: 'disconnect',
        label: 'Charging connects and disconnects',
        lead: 'The adapter, cable, connector and charging circuit need isolation. Avoid repeatedly moving a damaged connector.',
      },
    ],
    tests: [
      {
        id: 'charge-limit',
        title: 'Check the configured charge limit',
        steps: [
          'Open battery settings and any manufacturer power utility.',
          'Check whether a charge limit or optimized charging pause matches the current level.',
          'Record the displayed reason without disabling protection features.',
        ],
        question: 'Does the system explicitly say charging is paused at a configured limit?',
        observed:
          'The reported pause is consistent with the configured charging policy; it is not proof of a battery fault.',
        notObserved:
          'A configured charge limit has not explained the behavior. Continue with the external power path.',
      },
      {
        id: 'adapter',
        title: 'Isolate the external power path',
        steps: [
          'Check the manufacturer’s required adapter rating and charging port for this exact model.',
          'If available, use a known-working, compatible adapter and cable in a working outlet. Change one item at a time.',
          'Do not use visibly damaged, overheated or unverified power accessories. Record the configuration.',
        ],
        question: 'Does charging work reliably with the known-working compatible setup?',
        observed:
          'The original adapter, cable or outlet is implicated. Repeat one substitution at a time to isolate which one.',
        notObserved:
          'The substitute setup did not isolate an external accessory. Battery, port, policy and charging circuitry remain unresolved.',
      },
      {
        id: 'battery-test',
        title: 'Record the OEM battery diagnostic',
        steps: [
          'Use the computer manufacturer’s battery diagnostic for the exact model.',
          'Save work before any required restart. Record the result code and tool version.',
          'Keep a capacity reading separate from a diagnostic failure result.',
        ],
        question: 'Did the OEM diagnostic explicitly identify a battery failure?',
        observed:
          'The reported battery failure supports a battery service assessment. Verify its serviceability and exact part first.',
        notObserved:
          'This test did not report battery failure. Charging-path faults and intermittent behavior are still possible.',
      },
    ],
  },
  heat: {
    title: 'Heat & fan noise',
    summary: 'Check workload and airflow before treating heat as a damaged part.',
    kinds: ['cpu', 'gpu', 'cooling'],
    patterns: [
      {
        id: 'load',
        label: 'Only during games or demanding work',
        lead: 'Heat and fan speed can rise with demand. Check whether there is throttling, shutdown or performance loss before inferring a cooling fault.',
      },
      {
        id: 'idle',
        label: 'Hot or loud while apparently idle',
        lead: 'Background work and obstructed airflow are worth isolating. Temperature coverage may be unavailable on this model.',
      },
      {
        id: 'noise',
        label: 'Grinding, rattling or a changed fan sound',
        lead: 'Mechanical noise needs physical inspection. Software cannot confirm a bearing fault or safely identify every sound.',
      },
    ],
    tests: [
      {
        id: 'airflow',
        title: 'Check the cooling environment',
        steps: [
          'Place the computer on a hard surface with its external vents unobstructed.',
          'Let it cool during ordinary idle use. Do not open the chassis or insert objects into vents.',
          'Compare the same normal workload and room conditions; stop if it shuts down or smells abnormal.',
        ],
        question: 'Did restoring external airflow reduce the symptom?',
        observed:
          'The environment or external airflow contributes to the symptom. Internal cooling condition is still unknown.',
        notObserved:
          'External airflow alone did not resolve it. Check background work and seek service for persistent abnormal mechanical noise.',
      },
      {
        id: 'background',
        title: 'Separate background work from cooling',
        steps: [
          'Use Performance capture to record the symptom during ordinary use.',
          'Review sustained CPU use and, if opted in, application names.',
          'After saving work, close a known nonessential busy app and compare the same workload.',
        ],
        question: 'Does the symptom improve when the identified background workload ends?',
        observed:
          'The workload contributes to heat or noise. This does not establish CPU wear or rule out cooling problems.',
        notObserved:
          'The tested workload change has not explained the symptom. Temperature, fan operation and service inspection may be needed.',
      },
    ],
  },
  crash: {
    title: 'Crashes & unexpected restarts',
    summary: 'Capture the trigger and test software, peripherals and hardware separately.',
    kinds: ['system', 'memory', 'storage', 'gpu'],
    patterns: [
      {
        id: 'app',
        label: 'One application closes or freezes',
        lead: 'A single-app failure starts with app-specific settings, files and updates. It is not sufficient evidence of faulty RAM or graphics.',
      },
      {
        id: 'restart',
        label: 'The whole computer restarts or shuts down',
        lead: 'Unexpected shutdown records show an incident, not its cause. Power loss, software, thermals and hardware remain possible.',
      },
      {
        id: 'change',
        label: 'Started after a change or new peripheral',
        lead: 'Test the timing by reversing one safe, reversible change. A correlation alone does not prove which part failed.',
      },
    ],
    tests: [
      {
        id: 'peripheral',
        title: 'Isolate a recently added peripheral',
        steps: [
          'Save work and shut down normally before disconnecting a nonessential device.',
          'Keep required input, display, boot storage and power connected.',
          'Retry the same ordinary workload without the new peripheral. Record both configurations and observation time.',
        ],
        question: 'Was the original symptom absent under comparable use without the peripheral?',
        observed:
          'The peripheral, its cable, port or software is a lead. One symptom-free run does not confirm a fix.',
        notObserved:
          'The peripheral removal did not resolve the symptom during this test. Keep the exact crash or stop code.',
      },
      {
        id: 'memory-test',
        title: 'Run a guided memory or OEM diagnostic',
        steps: [
          'Save work and use the platform-specific restart guide below.',
          'Record the exact tool, duration, result and reference code. PC Health does not start or download the test.',
          'A memory-test error can involve RAM, configuration, CPU memory controller or motherboard; it does not identify a DIMM by itself.',
        ],
        question: 'Did the diagnostic report a hardware or memory error?',
        observed:
          'The reported diagnostic error warrants follow-up with its exact code. Identify the affected subsystem before replacing parts.',
        notObserved:
          'This run reported no error. Intermittent hardware faults and software causes remain possible.',
      },
    ],
  },
  boot: {
    title: 'Power & startup',
    summary: 'Distinguish no power, failed startup checks, no display and OS boot failure.',
    kinds: ['system', 'storage'],
    patterns: [
      {
        id: 'no-power',
        label: 'No lights, fan or other sign of power',
        lead: 'Start with the external power path. This app cannot electrically test a power supply, battery or motherboard.',
      },
      {
        id: 'no-display',
        label: 'Power is on but the screen stays blank',
        lead: 'A blank screen can be a display-path issue or a failed startup check. Record any beep or LED pattern.',
      },
      {
        id: 'no-os',
        label: 'Logo or firmware appears but OS will not load',
        lead: 'The device reaches some startup stages. Boot configuration, storage and the operating system need separate checks.',
      },
    ],
    tests: [
      {
        id: 'power-path',
        title: 'Check external power',
        steps: [
          'Confirm the outlet works and check that the model-compatible power cable or adapter is seated.',
          'Disconnect nonessential external devices while the computer is off.',
          'Do not open a power supply or bypass its protections. Record any lights or beep pattern.',
        ],
        question: 'Did the computer reach its startup logo after the external power check?',
        observed:
          'Startup progressed after the power-path change. Record exactly what changed before attributing the cause.',
        notObserved:
          'External checks did not restore startup. Use the model’s LED/beep-code guide or obtain service.',
      },
      {
        id: 'firmware',
        title: 'Identify the last working startup stage',
        steps: [
          'Follow the model’s documented method to view startup or firmware information.',
          'Check whether the expected boot drive is listed; do not change boot mode, encryption or storage settings.',
          'If the drive is absent or intermittently detected, protect data and seek service. Do not reinstall over needed files.',
        ],
        question: 'Is the expected boot drive consistently listed by firmware?',
        observed:
          'Firmware detects the drive. Boot configuration, OS corruption and undetected drive faults still need investigation.',
        notObserved:
          'Drive detection remains unresolved. The drive, connector, controller or firmware configuration could be involved.',
      },
    ],
  },
  display: {
    title: 'Display & visual artifacts',
    summary: 'Separate the panel and connection from app or rendering problems.',
    kinds: ['gpu'],
    patterns: [
      {
        id: 'pixels',
        label: 'Fixed dots, lines or uneven patches',
        lead: 'Compare solid colors and multiple displays. Software cannot electrically test the panel or prove a pixel is permanently defective.',
      },
      {
        id: 'flicker',
        label: 'Flickering or intermittent blank screen',
        lead: 'Cable, adapter, refresh settings, panel and graphics software remain possible. Change one variable at a time.',
      },
      {
        id: 'app',
        label: 'Artifacts in one app or game',
        lead: 'App-specific rendering settings or drivers are leads. A screenshot comparison can help separate rendering from the physical display path.',
      },
    ],
    tests: [
      {
        id: 'colors',
        title: 'Inspect static color patterns',
        steps: [
          'Open Display check. Use a comfortable brightness and manually switch colors.',
          'Record whether the defect stays at the same physical position across colors.',
          'There is no flashing sequence, pixel-repair mode or automatic defect detection.',
        ],
        question: 'Is the defect fixed in the same physical position across the patterns?',
        observed:
          'A persistent physical location supports investigating the panel or display path. This is a visual observation, not a confirmed failed panel.',
        notObserved:
          'The static patterns did not reproduce a fixed defect. Test the original app and connection conditions.',
        tool: 'display',
      },
      {
        id: 'screenshot',
        title: 'Compare a screenshot on another screen',
        steps: [
          'Capture the artifact with the operating system’s screenshot tool if possible.',
          'View that saved image on a different known-working display or device.',
          'Keep the original resolution. Do not upload private screenshots to PC Health; record only the result.',
        ],
        question: 'Is the artifact visible in the saved screenshot on the other screen?',
        observed:
          'The artifact is present in captured output, supporting a rendering/app/driver path lead over only a panel defect.',
        notObserved:
          'The artifact was not captured. Panel, cable, timing and capture limitations remain possible; this does not prove the GPU is healthy.',
      },
      {
        id: 'display-path',
        title: 'Try a known-working display path',
        steps: [
          'If available, connect a known-working display with a compatible cable and supported settings.',
          'Change one cable, port or adapter at a time. Record each configuration.',
          'Repeat the original workload; do not use a stress test.',
        ],
        question: 'Does the original symptom disappear with the alternative display path?',
        observed:
          'The original display path is implicated. Isolate panel, cable, port and adapter individually before replacing one.',
        notObserved:
          'The alternative path did not resolve the symptom. Rendering and shared settings remain leads.',
      },
    ],
  },
  keyboard: {
    title: 'Keyboard & input',
    summary: 'Check delivered key events and compare devices and applications.',
    kinds: [],
    patterns: [
      {
        id: 'missing',
        label: 'A key does not respond',
        lead: 'Check whether the app receives the key. OS shortcuts, remapping and firmware-only keys may not reach an app.',
      },
      {
        id: 'repeat',
        label: 'Unwanted repeats or wrong characters',
        lead: 'Repeat settings, keyboard layout, remapping and switch behavior can each contribute.',
      },
      {
        id: 'disconnect',
        label: 'Whole keyboard stops responding',
        lead: 'Compare power, connection and another input device. This app cannot measure wireless interference.',
      },
    ],
    tests: [
      {
        id: 'key-events',
        title: 'Check received key events',
        steps: [
          'Open Keyboard check and press the affected keys individually while its pad has focus.',
          'Record missing or unexpected physical key codes. Key text is not stored.',
          'Firmware-only keys and operating system shortcuts may be intercepted before reaching the app.',
        ],
        question: 'Does the affected key reliably register the expected physical key code?',
        observed:
          'The app received the key in this session. Investigate layout, app behavior or intermittent failure if symptoms continue.',
        notObserved:
          'The app did not reliably receive the expected event. Remapping, connection and hardware still need isolation.',
        tool: 'keyboard',
      },
      {
        id: 'alternate-keyboard',
        title: 'Compare another keyboard',
        steps: [
          'Connect a known-working keyboard through a supported connection if available.',
          'Use the same application and keyboard layout.',
          'Record whether the same keys and actions work without changing other settings.',
        ],
        question: 'Does the known-working keyboard resolve the symptom?',
        observed:
          'The original keyboard or its connection is implicated. Isolate that connection before replacing the keyboard.',
        notObserved:
          'The alternate keyboard did not resolve the problem. Shared software, layout or settings remain leads.',
      },
    ],
  },
};
export interface ScanEvidence {
  id: string;
  at: string;
  machine: string;
  platform: Scan['platform'];
  partial: boolean;
  completed: number;
  total: number;
  findings: {
    kind: ComponentKind;
    title: string;
    severity: string;
    action: string;
    evidence: string[];
  }[];
  measurements: {
    kind: ComponentKind;
    component: string;
    key: string;
    label: string;
    value: string;
    source: string;
  }[];
}
export interface RepairEntry {
  id: string;
  at: string;
  kind: 'test' | 'action' | 'status';
  note: string;
  testId?: string;
  outcome?: TestOutcome;
  status?: 'open' | 'resolved';
}
export interface RepairCase {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  ruleVersion: string;
  symptom: Symptom;
  pattern: string;
  target: 'this-device' | 'other-device';
  device: string;
  description: string;
  hazard: boolean;
  status: 'open' | 'resolved';
  scans: ScanEvidence[];
  entries: RepairEntry[];
}
export type NewRepair = Pick<
  RepairCase,
  'symptom' | 'pattern' | 'target' | 'device' | 'description' | 'hazard'
>;
export type RepairCommand =
  | { kind: 'test'; testId: string; outcome: TestOutcome; note: string }
  | { kind: 'action'; note: string }
  | { kind: 'status'; status: 'open' | 'resolved'; note: string }
  | { kind: 'attach-scan' };
export function captureEvidence(scan: Scan): ScanEvidence {
  const checks = scan.components.flatMap((c) => c.checks);
  return {
    id: scan.id,
    at: scan.completedAt,
    machine: scan.machine,
    platform: scan.platform,
    partial: scan.state !== 'complete',
    completed: checks.filter((c) => c.status === 'available').length,
    total: checks.length,
    findings: scan.findings.map((f) => ({
      kind: scan.components.find((c) => c.id === f.componentId)?.kind ?? 'system',
      title: f.title,
      severity: f.severity,
      action: f.action,
      evidence: f.evidence,
    })),
    measurements: scan.components.flatMap((c) =>
      c.metrics.map((m) => ({
        kind: c.kind,
        component: c.name,
        key: m.key,
        label: m.label,
        value: `${m.value}${m.unit ?? ''}`,
        source: m.source,
      })),
    ),
  };
}
export function repairAssessment(c: RepairCase) {
  const flow = repairFlows[c.symptom];
  const latest = c.scans.at(-1);
  const urgentStorage = c.scans.some((s) =>
    s.findings.some((f) => f.kind === 'storage' && f.severity === 'urgent'),
  );
  const stop = c.hazard
    ? 'Stop testing. Power down if safe, disconnect external power if safe, and arrange qualified service for swelling, smoke, liquid damage or a burning smell. Do not open, press or charge a damaged battery.'
    : urgentStorage
      ? 'An attached scan reports an urgent storage warning. Protect data and arrange service or recovery before further testing. This case retains the warning even if later checks are unavailable. Record backup or service actions here; start a follow-up case after the issue is addressed.'
      : undefined;
  const results = flow.tests.map((test) => {
    const entry = c.entries.filter((e) => e.kind === 'test' && e.testId === test.id).at(-1);
    return {
      test,
      entry,
      interpretation: !entry
        ? 'Not tested.'
        : entry.outcome === 'observed'
          ? test.observed
          : entry.outcome === 'not-observed'
            ? test.notObserved
            : 'The result is inconclusive. Record what prevented a reliable comparison.',
    };
  });
  return {
    stop,
    lead: flow.patterns.find((p) => p.id === c.pattern)!.lead,
    findings: latest?.findings.filter((f) => flow.kinds.includes(f.kind)) ?? [],
    results,
    next: results.find((r) => !r.entry || r.entry.outcome === 'inconclusive')?.test,
  };
}
export function diagnosticGuide(platform?: string): string {
  if (platform === 'darwin')
    return 'Apple Diagnostics: save work and shut down. Apple silicon: hold the power button until startup options appear, then hold Command-D. Intel: start while holding D. Follow the on-screen prompts and record reference codes. Some models offer Run Offline; others may require a network connection outside PC Health.';
  if (platform === 'win32')
    return 'Windows: save work, search Start for Windows Memory Diagnostic, and review its restart options. After the test, record the result from MemoryDiagnostics-Results in Event Viewer. Your computer maker may also provide a model-specific preboot diagnostic.';
  return 'Use your computer maker’s preboot hardware diagnostic or a memory tester supported by your distribution and hardware. Prepare any boot media separately, save work, and record the exact tool and result. PC Health does not download or run external diagnostics.';
}
const escape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function repairReport(c: RepairCase): string {
  const a = repairAssessment(c),
    flow = repairFlows[c.symptom];
  const p = (v: string) => `<p>${escape(v)}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>PC Health repair case</title><style>body{font:15px/1.6 system-ui;max-width:900px;margin:40px auto;padding:24px;color:#17202b}h1,h2,h3{line-height:1.3}article{border-top:1px solid #bbc;padding:15px 0}small{color:#46515c}li{margin:8px 0}@media print{body{margin:0}}</style></head><body><h1>PC Health repair case</h1>${p(flow.title + ' · ' + c.device)}${p(`Status: ${c.status} (user recorded) · Rules: ${c.ruleVersion}`)}${p('Created: ' + c.createdAt)}${p('User description: ' + c.description)}${p('Reported pattern: ' + flow.patterns.find((p) => p.id === c.pattern)!.label)}${p(a.lead)}${a.stop ? `<h2>Testing hold</h2>${p(a.stop)}` : ''}<h2>Guided test results — user reported</h2>${a.results.map((r) => `<article><h3>${escape(r.test.title)}</h3>${p(r.test.question)}${p(r.entry?.outcome ?? 'Not tested')}${p(r.interpretation)}</article>`).join('')}<h2>Attached scan evidence</h2>${c.scans.length ? c.scans.map((s) => `<article><h3>${escape(s.at)} · ${s.partial ? 'Partial' : 'Complete'}</h3>${p(s.machine + ' · ' + s.platform)}${p(`${s.completed}/${s.total} checks readable; missing checks do not establish health.`)}${s.findings.map((f) => p(`${f.severity}: ${f.title}. ${f.action}`) + f.evidence.map(p).join('')).join('') || p('No actionable findings in completed checks.')}${s.measurements.map((m) => p(`${m.component} / ${m.label}: ${m.value} (source: ${m.source})`)).join('')}</article>`).join('') : p('No scan evidence attached. This case relies on user observations.')}<h2>Chronological repair log</h2>${c.entries.map((e) => `<article><small>${escape(e.at)}</small>${p(`${e.kind}: ${e.testId ? flow.tests.find((t) => t.id === e.testId)!.title : (e.status ?? 'Repair action')} ${e.outcome ?? ''}`)}${p(e.note)}</article>`).join('') || p('No actions recorded.')}<h2>Scope</h2>${p('Test results and repair outcomes are supplied by the user, not independently verified. A symptom-free run does not prove a permanent fix. No exact failed part or remaining lifetime is established by these guides. Export includes the case description, device label, notes and attached scan evidence; review before sharing.')}</body></html>`;
}
