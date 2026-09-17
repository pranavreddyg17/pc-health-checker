import { _electron as electron, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { navigate } from './ui-navigation.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-recovery-ui-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
const at = new Date(Date.now() - 300000).toISOString();
const snapshot = {
  schemaVersion: 1,
  id: 'fixture-baseline',
  at,
  platform: process.platform,
  ruleVersion: '0.7.0',
  elapsedMs: 1,
  signals: [
    {
      id: 'fixture:thermal',
      category: 'thermal',
      label: 'Example thermal fault — test fixture',
      source: 'Test fixture',
      scope: 'Synthetic test system',
      observedAt: at,
      level: 'warning',
      availability: 'readable',
      summary: 'Synthetic warning for verification workflow testing.',
      action: 'Example: inspect cooling conditions.',
      limitation: 'Not real device telemetry.',
      measurements: [{ name: 'Example state', value: 'elevated' }],
    },
  ],
};
await mkdir(path.join(directory, 'history'), { recursive: true });
await writeFile(
  path.join(directory, 'history/reliability.json'),
  JSON.stringify({ schemaVersion: 1, snapshots: [snapshot], alerts: [] }),
);
await mkdir('test-results', { recursive: true });
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
const launchOptions = { args: executablePath ? [] : ['.'], executablePath, env };
let app;
try {
  app = await electron.launch(launchOptions);
  let page = await app.firstWindow();
  await navigate(page, 'Reliability monitor');
  await page.getByRole('button', { name: 'Capture fault baseline' }).click();
  await expect(page.getByText('Record your action first', { exact: true })).toBeVisible();
  await page
    .getByLabel('Action performed and workload to repeat')
    .fill('Example test action: restored cooling; repeat the original workload.');
  await page.getByRole('button', { name: 'Record action and start verification' }).click();
  await expect(page.getByText('Waiting for follow-up evidence', { exact: true })).toBeVisible();
  await expect(page.getByText('Action recorded · user reported', { exact: true })).toBeVisible();
  await app.close();
  app = undefined;
  // Seed explicit synthetic follow-up snapshots to test sustained recovery without
  // altering real sensors or waiting two minutes. Unit tests exercise the policy.
  const file = path.join(directory, 'history/recovery.json');
  const records = JSON.parse(await readFile(file, 'utf8'));
  records[0].action.at = new Date(Date.now() - 240000).toISOString();
  await writeFile(file, JSON.stringify(records));
  const samples = [0, 60, 120].map((age) => {
    const time = new Date(Date.now() - age * 1000).toISOString();
    return {
      ...snapshot,
      id: `fixture-${age}`,
      at: time,
      signals: [
        {
          ...snapshot.signals[0],
          observedAt: time,
          level: 'clear',
          summary: 'Synthetic follow-up within checked limits.',
        },
      ],
    };
  });
  await writeFile(
    path.join(directory, 'history/reliability.json'),
    JSON.stringify({ schemaVersion: 1, snapshots: [...samples, snapshot], alerts: [] }),
  );
  app = await electron.launch(launchOptions);
  page = await app.firstWindow();
  await navigate(page, 'Reliability monitor');
  await expect(page.getByText('Stable within the observed checks', { exact: true })).toBeVisible();
  await page.getByText('Original evidence and recommended actions', { exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Example thermal fault — test fixture' }),
  ).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1200, 850));
  await page.locator('.recovery-panel').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/recovery-verification.png' });
  const { violations } = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Remove verification', exact: true }).click();
  await page.getByRole('button', { name: 'Keep verification', exact: true }).click();
  expect(await page.evaluate(() => window.pcHealth.recoveryCases())).toHaveLength(1);
  await page.getByRole('button', { name: 'Remove verification', exact: true }).click();
  await page.getByRole('button', { name: 'Delete verification', exact: true }).click();
  await expect(page.getByText('Stable within the observed checks', { exact: true })).toHaveCount(0);
  console.log(
    'Recovery UI, persisted evidence, verification, deletion, accessibility and compact layout passed.',
  );
} finally {
  if (app) await app.close();
  await rm(directory, { recursive: true, force: true });
}
