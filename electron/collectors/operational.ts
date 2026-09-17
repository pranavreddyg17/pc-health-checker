import type { Component } from '../../src/shared/types';
import type { HealthSignal } from '../../src/shared/reliability';
import { check, component, metric } from './common';

// A check can be readable without establishing physical component integrity.
export function attachOperationalSignals(components: Component[], signals: HealthSignal[]) {
  for (const s of signals) {
    const kind = s.id.startsWith('cpu:')
      ? 'cpu'
      : s.category === 'thermal'
        ? 'cooling'
        : s.category === 'memory'
          ? 'memory'
          : s.category === 'gpu'
            ? 'gpu'
            : 'system';
    let target = components.find(
      (c) => c.kind === kind && (kind !== 'gpu' || s.label.startsWith(c.name)),
    );
    if (!target) {
      target = component(
        kind,
        kind === 'cooling'
          ? 'Cooling & thermal pressure'
          : kind === 'gpu'
            ? 'Graphics operational evidence'
            : 'OS operational evidence',
        'Passive platform telemetry',
      );
      components.push(target);
    }
    const readable =
      s.availability === 'readable' ||
      (s.availability === undefined && (s.level !== 'unknown' || s.measurements.length > 0));
    target.checks.push(
      check(
        `operational:${s.id}`,
        s.label,
        readable
          ? 'available'
          : s.availability === 'permission'
            ? 'permission'
            : s.availability === 'error'
              ? 'error'
              : 'unsupported',
        `${s.summary} ${s.limitation}`,
        s.source,
      ),
    );
    for (const [i, m] of s.measurements.entries())
      target.metrics.push(...metric(`operational:${s.id}:${i}`, m.name, m.value, s.source, m.unit));
    // Only explicit platform fault states generate a finding; readings alone never do.
    if (s.level === 'warning' || s.level === 'critical') {
      target.metrics.push(...metric(`health:${s.id}`, s.label, s.level, s.source));
      target.metrics.push(...metric(`action:${s.id}`, 'Recommended next step', s.action, s.source));
    }
  }
}
