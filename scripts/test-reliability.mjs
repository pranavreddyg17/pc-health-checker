import { navigate } from './ui-navigation.mjs';
import { _electron as electron, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-reliability-ui-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
await mkdir(path.join(directory, 'history'), { recursive: true });
await mkdir('test-results', { recursive: true });
const at = new Date().toISOString();
await writeFile(
  path.join(directory, 'history', 'reliability.json'),
  JSON.stringify({
    schemaVersion: 1,
    snapshots: [],
    alerts: [
      {
        id: 'fixture',
        signalId: 'fixture-ecc',
        at,
        lastSeen: at,
        level: 'warning',
        title: 'Test fixture: ECC review',
        summary: 'Synthetic fixture for acknowledgment testing.',
        action: 'Review test evidence.',
        occurrences: 1,
      },
    ],
  }),
);
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
let app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
let page = await app.firstWindow();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function audit(view) {
  const { violations } = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  console.log(
    JSON.stringify({
      view,
      violations: violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    }),
  );
  expect(violations).toEqual([]);
}
try {
  await navigate(page, 'Reliability monitor');
  await expect(page.getByRole('heading', { name: 'Monitoring is off' })).toBeVisible();
  expect((await page.evaluate(() => window.pcHealth.reliability())).snapshots).toHaveLength(0);
  await audit('Reliability: opt-in and baseline');
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(page.getByText('Reviewed', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run reliability check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reliability evidence', exact: true }),
  ).toBeVisible({ timeout: 40000 });
  let state = await page.evaluate(() => window.pcHealth.reliability());
  expect(state.snapshots).toHaveLength(1);
  expect(state.snapshots[0].platform).toBe(process.platform);
  expect(state.snapshots[0].signals.length).toBeGreaterThan(0);
  expect(state.collecting).toBe(false);
  expect(state.snapshots[0].signals.some((s) => s.category === 'filesystem')).toBe(true);
  await page.locator('.health-signal').first().locator('summary').click();
  await page.getByRole('button', { name: 'Export evidence', exact: true }).click();
  await audit('Reliability: real readings and export preview');
  const exported = path.join(directory, 'evidence.json');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exported);
  await page.getByRole('button', { name: 'Choose evidence location', exact: true }).click();
  await expect(page.getByText('Reliability evidence saved.')).toBeVisible();
  const report = JSON.parse(await readFile(exported, 'utf8'));
  expect(report.snapshots).toHaveLength(1);
  expect(report.snapshots[0].signals.every((s) => !('id' in s) && !s.counter?.epoch)).toBe(true);
  await page.getByLabel('Finding status').selectOption('unknown');
  expect(await page.locator('.health-signal:not(.unknown)').count()).toBe(0);
  await page.getByLabel('Finding status').selectOption('all');
  await page.screenshot({ path: 'test-results/reliability-evidence.png', fullPage: true });
  await page.getByRole('button', { name: 'Enable monitoring', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Monitoring enabled' })).toBeVisible();
  await expect
    .poll(async () => (await page.evaluate(() => window.pcHealth.reliability())).snapshots.length, {
      timeout: 40000,
    })
    .toBe(2);
  await navigate(page, 'Overview');
  await expect(page.getByText('Local reliability monitoring is enabled.')).toBeVisible();
  await page.getByRole('button', { name: 'Open monitor', exact: true }).click();
  await page.getByRole('button', { name: 'Stop monitoring', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Monitoring is off' })).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(980, 700);
  });
  await audit('Reliability: minimum desktop size');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'test-results/reliability-small.png', fullPage: true });
  await app.close();
  app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
  page = await app.firstWindow();
  await navigate(page, 'Reliability monitor');
  await expect(page.getByRole('heading', { name: 'Monitoring is off' })).toBeVisible();
  state = await page.evaluate(() => window.pcHealth.reliability());
  expect(state.snapshots).toHaveLength(2);
  expect(state.alerts.find((a) => a.id === 'fixture').acknowledgedAt).toBeTruthy();
  expect(state.running).toBe(false);
  expect(state.notifications).toBe(false);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      desktop: 'passed',
      snapshots: state.snapshots.length,
      signals: state.snapshots[0].signals.length,
      platform: state.snapshots[0].platform,
    }),
  );
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
// Exercise the Node entry point with no Electron or UI. Do not use the user's profile.
if (!executablePath) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pchealth-reliability-cli-'));
  function run(args) {
    return new Promise((resolve, reject) => {
      const p = spawn(process.execPath, ['dist-electron/health-cli.cjs', ...args], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '',
        stderr = '';
      const timeout = setTimeout(() => {
        p.kill('SIGKILL');
        reject(Error('CLI timed out'));
      }, 45000);
      p.stdout.on('data', (s) => (stdout += s));
      p.stderr.on('data', (s) => (stderr += s));
      p.once('error', reject);
      p.once('exit', (code) => {
        clearTimeout(timeout);
        resolve({ code, stdout, stderr });
      });
    });
  }
  let watcher;
  try {
    const result = await run(['--once', '--data-dir', dir]);
    expect([0, 1, 2, 3]).toContain(result.code);
    const sample = JSON.parse(result.stdout);
    expect(sample.signals.length).toBeGreaterThan(0);
    expect(sample.platform).toBe(process.platform);
    watcher = spawn(
      process.execPath,
      ['dist-electron/health-cli.cjs', '--watch', '--interval', '60', '--data-dir', dir],
      { env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    watcher.stdout.on('data', (s) => (output += s));
    watcher.stderr.on('data', () => {});
    await expect
      .poll(
        async () => {
          try {
            await readFile(path.join(dir, 'probe.lock'));
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 10000 },
      )
      .toBe(true);
    const collision = await run(['--once', '--data-dir', dir]);
    expect(collision.code).toBe(4);
    expect(collision.stderr).toMatch('probe lock');
    await expect.poll(() => output.includes('"type":"snapshot"'), { timeout: 40000 }).toBe(true);
    const ended = new Promise((resolve) => watcher.once('exit', resolve));
    watcher.kill('SIGTERM');
    expect(await ended).toBe(0);
    await expect(readFile(path.join(dir, 'probe.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    console.log(
      JSON.stringify({
        headless: 'passed',
        exitCode: result.code,
        signals: sample.signals.length,
        exclusiveLock: true,
        gracefulStop: true,
      }),
    );
  } finally {
    if (watcher && watcher.exitCode === null) watcher.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
}
