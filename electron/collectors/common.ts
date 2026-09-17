import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import type { Check, Component, ComponentKind, Metric } from '../../src/shared/types';

export function run(
  file: string,
  args: string[],
  signal: AbortSignal,
  acceptOutputOnFailure = false,
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: 15000,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        signal,
        env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
      },
      (error, stdout) => {
        if (error && !(acceptOutputOnFailure && stdout.trim().startsWith('{') && !signal.aborted))
          reject(error);
        else resolve(stdout);
      },
    );
  });
}
export const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 24);
export function component(
  kind: ComponentKind,
  name: string,
  subtitle: string,
  stableKey?: string,
): Component {
  return {
    id: stableKey ? hash(`${kind}:${stableKey}`) : randomUUID(),
    identity: stableKey ? 'stable' : 'session',
    kind,
    name,
    subtitle,
    metrics: [],
    checks: [],
    serviceability: 'unknown',
  };
}
export function metric(
  key: string,
  label: string,
  value: number | string | undefined,
  source: string,
  unit?: string,
): Metric[] {
  return value !== undefined && (typeof value !== 'number' || Number.isFinite(value))
    ? [{ key, label, value, source, unit }]
    : [];
}
export function check(
  id: string,
  label: string,
  status: Check['status'],
  detail: string,
  source: string,
): Check {
  return { id, label, status, detail, source };
}
export function finite(value: unknown): number | undefined {
  if (
    typeof value !== 'number' &&
    (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?%?$/.test(value.trim()))
  )
    return undefined;
  const number = typeof value === 'number' ? value : Number(String(value).replace(/%$/, '').trim());
  return Number.isFinite(number) ? number : undefined;
}
export function array<T>(value: T | T[] | undefined | null): T[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
export function failure(kind: ComponentKind, title: string, error: unknown): Component {
  const c = component(kind, title, 'Collection incomplete');
  const message = error instanceof Error ? error.message : String(error);
  const denied = /permission|access is denied|not permitted|requires.*admin/i.test(message);
  const missing = /ENOENT|not found|not recognized/i.test(message);
  c.checks.push(
    check(
      'collection',
      'Hardware data',
      denied ? 'permission' : missing ? 'unsupported' : 'error',
      denied
        ? 'The operating system denied access. No additional access was requested.'
        : missing
          ? 'The required system utility is not installed or available.'
          : 'This collector could not finish. Other completed checks remain available.',
      'Platform collector',
    ),
  );
  return c;
}
