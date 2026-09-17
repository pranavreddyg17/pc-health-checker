import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, rm, access, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { navigate } from './ui-navigation.mjs';
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
if (!executablePath) throw Error('Set PCHEALTH_TEST_EXECUTABLE to the packaged app executable.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-packaged-telemetry-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
await mkdir('test-results', { recursive: true });
const app = await electron.launch({ executablePath, args: [], env });
const page = await app.firstWindow();
try {
  const appPath = await app.evaluate(({ app }) => app.getAppPath());
  expect(appPath.endsWith('app.asar')).toBe(true);
  const resources = path.dirname(appPath);
  await access(path.join(resources, 'vendor', 'sources', 'smartmontools-7.5.tar.gz'));
  await access(
    path.join(
      resources,
      'vendor',
      process.platform,
      process.platform === 'win32' ? 'smartctl.exe' : 'smartctl',
    ),
  );
  if (process.platform === 'darwin')
    await access(path.join(resources, 'vendor', 'darwin', 'pchealth-telemetry'));
  await page.getByRole('button', { name: 'Scan this computer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  const scan = (await page.evaluate(() => window.pcHealth.bootstrap())).scans[0];
  expect(scan.appVersion).toBe(JSON.parse(await readFile('package.json', 'utf8')).version);
  expect(scan.state).toBe('complete');
  const checks = scan.components.flatMap((c) => c.checks);
  if (process.platform === 'darwin') {
    expect(checks.find((c) => c.id === 'operational:thermal:mac-state')?.status).toBe('available');
    expect(checks.find((c) => c.id === 'operational:memory:pressure')?.status).toBe('available');
    expect(checks.find((c) => c.id === 'operational:services:launchd')?.status).toBe('available');
  }
  await page.screenshot({ path: 'test-results/packaged-telemetry-overview.png', fullPage: true });
  await navigate(page, 'Reliability monitor');
  await page.getByRole('button', { name: 'Run reliability check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reliability evidence', exact: true }),
  ).toBeVisible({ timeout: 40000 });
  const state = await page.evaluate(() => window.pcHealth.reliability());
  expect(state.running).toBe(false);
  expect(state.notifications).toBe(false);
  expect(state.snapshots).toHaveLength(1);
  expect(state.snapshots[0].ruleVersion).toBe('0.7.0');
  if (process.platform === 'darwin') {
    expect(state.snapshots[0].signals.find((s) => s.id === 'thermal:mac-state')?.availability).toBe(
      'readable',
    );
    expect(state.snapshots[0].signals.find((s) => s.id === 'memory:pressure')?.availability).toBe(
      'readable',
    );
  }
  await page.screenshot({ path: 'test-results/packaged-telemetry-monitor.png', fullPage: true });
  console.log(
    JSON.stringify(
      {
        packaged: 'passed',
        platform: process.platform,
        version: scan.appVersion,
        completedChecks: checks.filter((c) => c.status === 'available').length,
        externalTests: checks.filter((c) => c.status === 'not-run').length,
        driveFields: scan.components
          .filter((c) => c.kind === 'storage')
          .flatMap((c) => c.metrics.map((m) => m.key)),
        monitor: {
          readable: state.snapshots[0].signals.filter((s) => s.availability === 'readable').length,
          gaps: state.snapshots[0].signals
            .filter((s) => s.availability !== 'readable' && s.availability !== 'not-applicable')
            .map((s) => ({ label: s.label, availability: s.availability })),
        },
      },
      null,
      2,
    ),
  );
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
