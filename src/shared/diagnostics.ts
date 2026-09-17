import type { Component, Finding, Scan } from './types';

export const RULE_VERSION = '0.7.0';
export function numeric(component: Component, key: string): number | undefined {
  const value = component.metrics.find((metric) => metric.key === key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
export function metricValue(component: Component, key: string) {
  return component.metrics.find((metric) => metric.key === key)?.value;
}
export function diagnose(components: Component[]): Finding[] {
  const findings: Finding[] = [];
  for (const c of components) {
    const add = (finding: Omit<Finding, 'id' | 'componentId'>) => {
      findings.push({ ...finding, id: `${c.id}:${finding.rule}`, componentId: c.id });
    };
    for (const m of c.metrics.filter((m) => m.key.startsWith('health:'))) {
      if (!['warning', 'critical'].includes(String(m.value))) continue;
      const id = m.key.slice(7);
      add({
        title: m.label,
        severity: m.value === 'critical' ? 'urgent' : 'attention',
        category: 'condition',
        explanation:
          c.checks.find((k) => k.id === `operational:${id}`)?.detail ||
          'The platform reported an operational condition requiring review.',
        action: String(
          metricValue(c, `action:${id}`) || 'Review the platform evidence and OEM diagnostics.',
        ),
        evidence: [`${m.source}: ${m.value}`],
        limitation:
          'Operational evidence does not prove component wear or identify a replaceable defective part. Correlate with symptoms and a repeat observation.',
        rule: `operational:${id}:v1`,
      });
    }
    if (c.kind === 'storage') {
      const windowsHealth = metricValue(c, 'windows_health');
      if (windowsHealth === 'Warning' || windowsHealth === 'Unhealthy') {
        add({
          title: 'Windows reports a storage health problem',
          severity: windowsHealth === 'Unhealthy' ? 'urgent' : 'attention',
          category: 'fault',
          explanation:
            'The Windows storage subsystem reports an abnormal health state for this physical disk.',
          action:
            'Protect important data and review the drive and controller with the manufacturer’s diagnostics before choosing a replacement.',
          evidence: [`Windows storage health: ${windowsHealth}`],
          limitation:
            'This is an operating-system storage status, not a measured endurance percentage. It does not isolate media, controller, connection, or firmware causes.',
          rule: 'windows-storage-health-v1',
        });
      }
      const warning = numeric(c, 'critical_warning');
      if (warning !== undefined && warning > 0) {
        const severe = (warning & 0x1c) !== 0;
        add({
          title: severe ? 'Your drive reports a reliability warning' : 'Your drive needs attention',
          severity: severe ? 'urgent' : 'attention',
          category: 'fault',
          explanation: severe
            ? 'The NVMe controller reports degraded reliability, read-only operation, or a backup-memory failure.'
            : (warning & 0x03) !== 0
              ? 'The NVMe controller reports a temperature or spare-capacity warning.'
              : 'The NVMe controller reports a warning bit this rule does not interpret. Check the manufacturer’s diagnostic guidance.',
          action: severe
            ? 'Protect important data now. Avoid intensive tests and arrange a storage assessment or replacement.'
            : 'Back up important data and review the drive’s cooling and manufacturer diagnostics.',
          evidence: [`NVMe critical warning: 0x${warning.toString(16)}`],
          limitation:
            'The warning concerns the controller; it does not provide a failure date or identify every cause.',
          rule: 'nvme-warning-v1',
        });
      }
      if (metricValue(c, 'smart_passed') === 'Failed') {
        add({
          title: 'Storage reports a failed health check',
          severity: 'urgent',
          category: 'fault',
          explanation: 'The drive’s own health status reports a failure condition.',
          action:
            'Protect important data now and arrange replacement or professional assessment. Avoid intensive tests.',
          evidence: ['Device-reported SMART status: failed'],
          limitation: 'This result cannot determine how long the device will remain accessible.',
          rule: 'smart-failure-v1',
        });
      }
      const endurance = numeric(c, 'endurance_used');
      if (endurance !== undefined && endurance >= 100) {
        add({
          title: 'Estimated SSD endurance has been consumed',
          severity: 'attention',
          category: 'wear',
          explanation:
            'The manufacturer-reported usage estimate has reached or exceeded its rated endurance.',
          action:
            'Keep a current backup and plan a replacement based on your workload and other drive findings.',
          evidence: [`Estimated endurance used: ${endurance}%`],
          limitation:
            '100% does not mean failure. This is not a probability or a countdown; values may exceed 100%.',
          rule: 'nvme-endurance-v1',
        });
      }
      for (const [key, title, severe, explanation] of [
        [
          'ata_pending',
          'Unstable sectors need assessment',
          true,
          'The recognized ATA attribute reports sectors awaiting a successful read or remapping decision.',
        ],
        [
          'ata_offline_uncorrectable',
          'Uncorrectable sectors are recorded',
          true,
          'The recognized ATA attribute reports sectors that could not be corrected during an offline operation.',
        ],
        [
          'ata_reallocated',
          'Reallocated sectors are recorded',
          false,
          'The drive reports sector remapping. A historical count alone does not establish ongoing deterioration.',
        ],
        [
          'ata_crc_errors',
          'Storage interface errors are recorded',
          false,
          'The drive reports interface CRC errors. The cable, connection or controller path may contribute.',
        ],
        [
          'windows_read_uncorrected',
          'Uncorrected storage reads are recorded',
          true,
          'The Windows reliability provider reports uncorrected read errors.',
        ],
        [
          'windows_write_uncorrected',
          'Uncorrected storage writes are recorded',
          true,
          'The Windows reliability provider reports uncorrected write errors.',
        ],
      ] as const) {
        const n = numeric(c, key);
        if (n !== undefined && n > 0)
          add({
            title,
            severity: severe ? 'urgent' : 'attention',
            category: 'fault',
            explanation,
            action: severe
              ? 'Protect important data. Avoid intensive tests until the drive and storage path have been assessed.'
              : 'Keep a backup, compare subsequent counters and inspect the storage path before selecting a replacement.',
            evidence: [`${c.metrics.find((m) => m.key === key)!.label}: ${n}`],
            limitation:
              'Counter meanings depend on the device/provider. Historical errors do not establish their age, a failure date or the exact faulty part.',
            rule: `${key}-v1`,
          });
      }
      const spare = numeric(c, 'spare'),
        threshold = numeric(c, 'spare_threshold');
      if (spare !== undefined && threshold !== undefined && spare < threshold)
        add({
          title: 'Available spare is below the device threshold',
          severity: 'attention',
          category: 'wear',
          explanation: 'The NVMe spare value is below the threshold reported by the same device.',
          action:
            'Protect important data and arrange vendor diagnostics or a maintenance assessment.',
          evidence: [`Available spare: ${spare}%; device threshold: ${threshold}%`],
          limitation: 'The manufacturer threshold is not a remaining-life prediction.',
          rule: 'nvme-spare-v1',
        });
      const errors = numeric(c, 'media_errors');
      if (errors !== undefined && errors > 0) {
        add({
          title: 'Media errors are recorded on this drive',
          severity: 'attention',
          category: 'fault',
          explanation:
            'The controller has recorded unrecovered data-integrity errors during its lifetime.',
          action:
            'Keep a backup. Compare a later scan to establish whether errors are increasing and seek service if problems recur.',
          evidence: [`Lifetime media errors: ${errors}`],
          limitation:
            'A cumulative count does not establish when the errors occurred or prove they are increasing.',
          rule: 'nvme-media-v1',
        });
      }
    }
    if (c.kind === 'battery') {
      const retention = numeric(c, 'capacity_retention');
      const condition = String(metricValue(c, 'condition') ?? '').toLowerCase();
      if (
        /service|replace|poor|check battery/.test(condition) ||
        (retention !== undefined && retention > 0 && retention < 80)
      ) {
        add({
          title: 'Your battery may benefit from service',
          severity: 'attention',
          category: 'wear',
          explanation:
            'Reported battery condition or retained capacity suggests reduced ability to hold charge.',
          action:
            'If runtime no longer meets your needs, check model-specific service guidance. Prefer the operating system’s battery condition when available.',
          evidence: [
            retention !== undefined ? `Reported capacity retention: ${retention}%` : '',
            condition ? `Reported condition: ${metricValue(c, 'condition')}` : '',
          ].filter(Boolean),
          limitation:
            'Capacity estimates can vary with calibration and use. This does not establish a safety fault or an exact replacement date.',
          rule: 'battery-capacity-v1',
        });
      }
    }
    if (c.kind === 'system') {
      const reports = numeric(c, 'panic_report_count') ?? 0;
      const whea = numeric(c, 'whea_event_count') ?? 0;
      const kernel = ['kernel_memory_events', 'kernel_pcie_events', 'kernel_gpu_events'].reduce(
        (total, key) => total + (numeric(c, key) ?? 0),
        0,
      );
      if (reports || whea || kernel) {
        add({
          title: reports
            ? 'Recent restart-related reports deserve a review'
            : 'Recent system error evidence deserves a review',
          severity: 'attention',
          category: 'condition',
          explanation: reports
            ? 'Panic-related diagnostic report files were recently modified on this Mac. Software, connected devices, or hardware can contribute to unexpected restarts.'
            : 'The operating system retained hardware-error or graphics-reset evidence. Some records may be corrected errors or driver-related incidents.',
          action:
            'Compare the timing with symptoms and recent changes. Save your work, keep a backup, and use the relevant OEM or offline diagnostic before replacing a part.',
          evidence: [
            reports ? `Recent panic-related report files: ${reports}` : '',
            whea ? `WHEA records retained in this sample: ${whea}` : '',
            kernel ? `Matching kernel messages in this sample: ${kernel}` : '',
            String(metricValue(c, 'event_window') ?? ''),
          ].filter(Boolean),
          limitation:
            'This check does not establish component wear or identify a faulty CPU, RAM stick, GPU, or motherboard. One incident may create several records, and retained logs do not represent complete history.',
          rule: 'system-stability-evidence-v1',
        });
      }
    }
  }
  const rank = { urgent: 0, attention: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function coverage(components: Component[]) {
  const checks = components.flatMap((c) => c.checks);
  const guided = checks.filter(
    (c) =>
      ['cpu-faults', 'memory-test', 'physical', 'gpu-health'].includes(c.id) &&
      c.status === 'not-run',
  ).length;
  return {
    completed: checks.filter((c) => c.status === 'available').length,
    total: checks.length,
    automatic: checks.length - guided,
    guided,
    unavailable: checks.filter((c) => c.status !== 'available').length - guided,
  };
}
export function compareScans(current: Scan, previous?: Scan): string[] {
  if (!previous)
    return ['Your first scan is a baseline. Run another scan later to compare changes.'];
  const changes: string[] = [];
  for (const component of current.components) {
    if (component.identity !== 'stable') continue;
    const old = previous.components.find((c) => c.id === component.id && c.identity === 'stable');
    if (!old) continue;
    for (const key of ['capacity_retention', 'endurance_used', 'media_errors']) {
      const a = numeric(old, key),
        b = numeric(component, key);
      if (a !== undefined && b !== undefined && a !== b) {
        const metric = component.metrics.find((m) => m.key === key)!;
        changes.push(
          `${component.name}: ${metric.label.toLowerCase()} changed from ${a}${metric.unit ?? ''} to ${b}${metric.unit ?? ''}.${key === 'media_errors' && b < a ? ' The counter may have reset.' : ''}`,
        );
      }
    }
  }
  return changes.length
    ? changes
    : [
        'No comparable wear-counter changes found. Missing measurements and unidentified components cannot establish a trend.',
      ];
}
