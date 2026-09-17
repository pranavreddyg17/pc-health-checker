import { navigate } from './ui-navigation.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-desktop-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
await mkdir('test-results', { recursive: true });
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
const app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Scan this computer', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => typeof window.require)).toBe('undefined');
  await page.screenshot({ path: 'test-results/01-welcome.png' });
  await page.getByRole('button', { name: 'Scan this computer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  await expect(page.getByRole('heading', { name: 'Your components', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/02-real-scan.png', fullPage: true });
  const bootstrap = await page.evaluate(() => window.pcHealth.bootstrap());
  expect(bootstrap.scans).toHaveLength(1);
  expect(bootstrap.scans[0].components.some((c) => c.kind === 'cpu')).toBe(true);
  console.log(
    `Real ${bootstrap.platform} scan: ${bootstrap.scans[0].components.length} component records.`,
  );

  await navigate(page, 'Components');
  await page.locator('.component-card').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What was checked' })).toBeVisible();
  await page.screenshot({ path: 'test-results/03-component.png' });
  await page.getByRole('button', { name: 'Close component details' }).click();
  await navigate(page, 'Replacement guide');
  const cpu = bootstrap.scans[0].components.find((c) => c.kind === 'cpu');
  await page.getByLabel('Which component are you considering?').selectOption(cpu.id);
  await expect(
    page.getByRole('heading', { name: 'No replacement need established' }),
  ).toBeVisible();
  await expect(page.locator('.product-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Browse reference catalog' }).click();
  await page.locator('.product-card summary').first().click();
  await expect(page.getByText('SATA data and power connections', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/04-catalog.png', fullPage: true });
  await navigate(page, 'Components');
  await page.locator('.component-card').first().click();
  await page.getByRole('button', { name: 'Open replacement guide' }).click();
  await expect(page.getByLabel('Which component are you considering?')).toHaveValue(cpu.id);
  const drive = bootstrap.scans[0].components.find((c) => c.kind === 'storage');
  if (drive) {
    await page.getByLabel('Which component are you considering?').selectOption(drive.id);
    if (drive.serviceability === 'integrated') {
      await expect(
        page.getByRole('heading', { name: 'Check the model’s service options' }),
      ).toBeVisible();
      await expect(page.locator('.product-card')).toHaveCount(0);
    }
  }
  await page.screenshot({ path: 'test-results/05-replacement-guidance.png', fullPage: true });

  const reportPath = path.join(directory, 'export.html');
  await app.evaluate(({ dialog }, reportPath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: reportPath });
  }, reportPath);
  await page.getByRole('button', { name: 'Export report' }).click();
  await page.getByRole('button', { name: 'Choose save location' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await readFile(reportPath, 'utf8')).toContain('<h1>PC Health</h1>');

  const jsonPath = path.join(directory, 'export.json');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, jsonPath);
  await page.getByRole('button', { name: 'Export report' }).click();
  await page.getByLabel('Report format').selectOption('json');
  await page.getByRole('button', { name: 'Choose save location' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const json = JSON.parse(await readFile(jsonPath, 'utf8'));
  expect(json.components[0].id).toBe('component-1');
  expect(JSON.stringify(json)).not.toContain(bootstrap.scans[0].components[0].id);

  await page.reload();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible();
  await navigate(page, 'Scan history');
  await expect(page.locator('.history-row')).toHaveCount(1);

  await navigate(page, 'Overview');
  await page.getByRole('button', { name: 'Run a new scan' }).click();
  await page.getByRole('button', { name: 'Stop scan', exact: true }).click();
  await expect(
    page.getByText('This scan stopped or reached its time limit. Results below are partial.'),
  ).toBeVisible({ timeout: 15000 });
  const cancelled = await page.evaluate(() => window.pcHealth.bootstrap());
  expect(cancelled.scans[0].state).toBe('cancelled');

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  await page.getByRole('button', { name: 'Delete saved scans' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const empty = await page.evaluate(() => window.pcHealth.bootstrap());
  expect(empty.scans).toHaveLength(0);
  expect(errors).toEqual([]);
  console.log(
    'Desktop flows passed: real scan, details, catalog, export, history reload, cancellation, deletion.',
  );
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
