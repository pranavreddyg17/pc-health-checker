import { describe, expect, it } from 'vitest';
import { component, metric } from '../electron/collectors/common';
import { diagnose, compareScans } from '../src/shared/diagnostics';
import { candidates, compatibilityLabel } from '../src/shared/catalog';
import { htmlReport, redactedReport } from '../src/shared/report';
import { fixtureScan } from './fixtures';
function storage(values: Record<string, number | string>) {
  const c = component('storage', 'Test SSD', 'Test device', 'test-serial');
  c.metrics = Object.entries(values).flatMap(([key, value]) =>
    metric(key, key, value, 'Test fixture'),
  );
  return c;
}
describe('evidence-based diagnosis', () => {
  it.each([100, 120, 255])('does not declare a drive failed at %s endurance used', (value) => {
    const findings = diagnose([storage({ endurance_used: value })]);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('attention');
    expect(findings[0].limitation).toContain('does not mean failure');
    expect(findings[0].evidence[0]).toContain(String(value));
  });
  it('keeps missing health data inconclusive', () => expect(diagnose([storage({})])).toEqual([]));
  it('does not diagnose CPU wear from load, temperature, or age', () => {
    const c = component('cpu', 'Test CPU', 'Processor');
    c.metrics.push(
      ...metric('temperature', 'Temperature', 95, 'test'),
      ...metric('age', 'Age', 7, 'test'),
    );
    expect(diagnose([c])).toEqual([]);
  });
  it('prioritizes a reliability warning on a first scan', () => {
    const findings = diagnose([storage({ critical_warning: 4 })]);
    expect(findings[0].severity).toBe('urgent');
    expect(findings[0].action).toContain('Avoid intensive tests');
  });
  it('does not equate a temperature warning with confirmed failure', () =>
    expect(diagnose([storage({ critical_warning: 2 })])[0].severity).toBe('attention'));
  it('treats a historic error count as evidence without inventing a trend', () => {
    const finding = diagnose([storage({ media_errors: 5 })])[0];
    expect(finding.severity).toBe('attention');
    expect(finding.limitation).toContain('does not establish when');
  });
  it('does not use current battery charge as wear', () => {
    const battery = component('battery', 'Battery', 'Test');
    battery.metrics = metric('charge', 'Charge level', 23, 'test', '%');
    expect(diagnose([battery])).toEqual([]);
  });
  it('reports capacity loss as service guidance, not an imminent safety fault', () => {
    const battery = component('battery', 'Battery', 'Test');
    battery.metrics = metric('capacity_retention', 'Capacity retention', 70, 'test', '%');
    expect(diagnose([battery])[0]).toMatchObject({ severity: 'attention', category: 'wear' });
  });
  it('does not alert when idle fan RPM is zero', () => {
    const fan = component('cooling', 'Fan', 'Test');
    fan.metrics = metric('rpm', 'Fan RPM', 0, 'test');
    expect(diagnose([fan])).toEqual([]);
  });
  it('does not infer battery wear from invalid capacity', () => {
    const battery = component('battery', 'Battery', 'Test');
    battery.metrics = [
      { key: 'capacity_retention', label: 'Capacity', value: NaN, source: 'test' },
    ];
    expect(diagnose([battery])).toEqual([]);
  });
});
describe('manual scan comparisons', () => {
  it('compares only a reliably identified component', () => {
    expect(
      compareScans(
        fixtureScan([storage({ media_errors: 7 })]),
        fixtureScan([storage({ media_errors: 3 })]),
      )[0],
    ).toContain('from 3 to 7');
  });
  it('starts a new baseline after a component replacement', () => {
    const replaced = storage({ media_errors: 0 });
    replaced.id = 'new-physical-device';
    expect(
      compareScans(fixtureScan([replaced]), fixtureScan([storage({ media_errors: 8 })]))[0],
    ).toContain('No comparable');
  });
  it('does not merge ambiguous identities', () => {
    const c = storage({ media_errors: 7 });
    c.identity = 'session';
    expect(
      compareScans(fixtureScan([c]), fixtureScan([storage({ media_errors: 3 })]))[0],
    ).toContain('No comparable');
  });
  it('explains decreasing counters instead of declaring a repair', () => {
    expect(
      compareScans(
        fixtureScan([storage({ media_errors: 2 })]),
        fixtureScan([storage({ media_errors: 8 })]),
      )[0],
    ).toContain('may have reset');
  });
});
describe('replacement catalog boundaries', () => {
  it('excludes standard parts for integrated storage', () => {
    const c = storage({ protocol: 'NVMe' });
    c.serviceability = 'integrated';
    expect(candidates(c)).toEqual([]);
    expect(compatibilityLabel(c)).toBe('OEM service required');
  });
  it('does not substitute SATA for NVMe', () =>
    expect(candidates(storage({ protocol: 'SATA' })).map((p) => p.protocol)).toEqual(['SATA']));
  it('does not invent compatibility from an unknown interface', () =>
    expect(candidates(storage({}))).toEqual([]));
  it('does not present a protocol match as verified', () =>
    expect(compatibilityLabel(storage({ protocol: 'NVMe' }))).toContain('not yet verified'));
});
describe('local report export', () => {
  it('escapes untrusted device names and includes coverage limits', () => {
    const c = storage({});
    c.name = '<script>alert(1)</script>';
    const result = htmlReport(fixtureScan([c]));
    expect(result).not.toContain('<script>');
    expect(result).toContain('&lt;script&gt;');
    expect(result).toContain('Unavailable and unperformed');
  });
  it('removes stable local identifiers from JSON exports', () => {
    const c = storage({ critical_warning: 4 });
    const result = JSON.stringify(redactedReport(fixtureScan([c])));
    expect(result).not.toContain(c.id);
    expect(result).toContain('component-1');
  });
});
