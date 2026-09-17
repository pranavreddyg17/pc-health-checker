import { describe, expect, it } from 'vitest';
import { component, metric } from '../electron/collectors/common';
import { diagnose } from '../src/shared/diagnostics';
import { assessReplacement } from '../src/shared/replacements';

function drive(protocol = 'NVMe', readings: Record<string, number | string | undefined> = {}) {
  const c = component('storage', 'Test SSD', 'Storage');
  for (const [key, value] of Object.entries({ protocol, ...readings }))
    c.metrics.push(...metric(key, key, value, 'Test fixture'));
  return c;
}
describe('component-specific replacement advice', () => {
  it('routes integrated storage to OEM service with no retail candidates', () => {
    const c = drive('NVMe', { endurance_used: 101 });
    c.serviceability = 'integrated';
    expect(assessReplacement(c, diagnose([c]))).toMatchObject({ route: 'service', candidates: [] });
  });
  it('keeps healthy drive candidates as optional upgrade references', () => {
    const c = drive('SATA');
    const result = assessReplacement(c, []);
    expect(result.route).toBe('no-evidence');
    expect(result.candidates.map((p) => p.protocol)).toEqual(['SATA']);
    expect(result.explanation).toContain('independently planning an upgrade');
  });
  it('does not infer a supported interface or a purchase need from missing data', () => {
    const c = drive('Unknown');
    expect(assessReplacement(c, [])).toMatchObject({ route: 'no-evidence', candidates: [] });
  });
  it('recommends investigation for historical media errors, Windows status, and temperature-only warnings', () => {
    for (const readings of [
      { media_errors: 1 },
      { windows_health: 'Warning' },
      { critical_warning: 2 },
    ]) {
      const c = drive('NVMe', readings);
      expect(assessReplacement(c, diagnose([c])).route).toBe('investigate');
    }
  });
  it('supports planning when endurance is consumed or a drive reports failure', () => {
    for (const readings of [
      { endurance_used: 110 },
      { smart_passed: 'Failed' },
      { critical_warning: 4 },
    ]) {
      const c = drive('NVMe', readings);
      expect(assessReplacement(c, diagnose([c])).route).toBe('plan');
    }
  });
  it('does not transfer a different component’s finding to the selected drive', () => {
    const c = drive('SATA');
    const other = drive('NVMe', { smart_passed: 'Failed' });
    expect(assessReplacement(c, diagnose([other]))).toMatchObject({
      route: 'no-evidence',
      evidence: [],
    });
  });
  it('never chooses a replacement CPU based on inventory alone', () => {
    const c = component('cpu', 'Processor', 'Inventory only');
    expect(assessReplacement(c, [])).toMatchObject({ route: 'no-evidence', candidates: [] });
  });
});
