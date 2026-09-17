import { diagnose } from '../src/shared/diagnostics';
import type { Component, Scan } from '../src/shared/types';

export function fixtureScan(components: Component[]): Scan {
  return {
    schemaVersion: 1,
    id: '3e5a0000-0000-4000-8000-000000000001',
    startedAt: '2026-09-14T12:00:00Z',
    completedAt: '2026-09-14T12:00:10Z',
    platform: 'darwin',
    arch: 'arm64',
    osVersion: 'test',
    machine: 'Test computer',
    appVersion: '0.1.0',
    ruleVersion: '0.1.0',
    state: 'complete',
    components,
    findings: diagnose(components),
  };
}
