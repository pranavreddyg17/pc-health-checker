import type { Investigation, Observation } from '../src/shared/investigations';

export function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    startedAt: '2026-09-15T12:00:00Z',
    completedAt: '2026-09-15T12:03:00Z',
    durationSeconds: 180,
    elapsedMs: 180000,
    platform: 'darwin',
    ruleVersion: '0.3.0',
    state: 'complete',
    power: 'plugged-in',
    observedPower: ['plugged-in'],
    includeApps: false,
    action: '',
    samples: Array.from({ length: 91 }, (_, i) => ({
      atMs: i * 2000,
      cpuPercent: 20,
      busiestCorePercent: 35,
      availableMemoryMB: 100,
    })),
    markers: [],
    coverage: [],
    system: { logicalCores: 8, memoryMB: 8192 },
    outcome: 'not-recorded',
    ...overrides,
  };
}
export function investigation(observations = [observation()]): Investigation {
  return {
    schemaVersion: 1,
    id: '22222222-2222-4222-8222-222222222222',
    workload: 'Video calls',
    onset: 'recent',
    change: '',
    createdAt: '2026-09-15T12:00:00Z',
    updatedAt: '2026-09-15T12:03:00Z',
    symptom: 'slow',
    observations,
  };
}
