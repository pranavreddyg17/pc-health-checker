import { navigate } from './ui-navigation.mjs';
import { _electron as electron, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-repair-ui-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
await mkdir('test-results', { recursive: true });
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
const app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
const page = await app.firstWindow();
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
  await page.getByRole('button', { name: 'Open repair workbench', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What needs fixing?' })).toBeVisible();
  await audit('Repair intake');
  await page.screenshot({ path: 'test-results/repair-intake.png', fullPage: true });
  await page.getByRole('button', { name: /Battery & charging Separate/ }).click();
  await page.getByLabel('Observed behavior').selectOption('no-charge');
  await page.getByLabel('Computer being repaired').selectOption('other-device');
  await page.getByLabel('Device label').fill('Bench laptop');
  await page
    .getByLabel('Problem description')
    .fill('Charging stops with original adapter. Test case only.');
  await page.getByRole('button', { name: 'Create repair case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bench laptop', exact: true })).toBeVisible();
  expect((await page.evaluate(() => window.pcHealth.repairCases()))[0].scans).toEqual([]);
  await page.locator('.guided-test').nth(1).getByRole('button', { name: 'View steps' }).click();
  await page
    .getByLabel('Does charging work reliably with the known-working compatible setup?')
    .selectOption('observed');
  await page
    .getByLabel('Test notes / exact diagnostic code')
    .fill('Known working compatible adapter. Charging stayed connected for 20 minutes.');
  await page.getByRole('button', { name: 'Save test result', exact: true }).click();
  await expect(page.getByText(/original adapter, cable or outlet is implicated/)).toBeVisible();
  await page
    .getByLabel('Action taken or verification note')
    .fill(
      'Replaced the damaged external cable. Original workload repeated for 30 minutes without disconnection.',
    );
  await page.getByRole('button', { name: 'Save repair note', exact: true }).click();
  await expect(page.locator('.repair-timeline article')).toHaveCount(2);
  await page
    .getByLabel('Action taken or verification note')
    .fill('Verified again next day under the same workload and charger.');
  await page.getByRole('button', { name: 'Mark resolved with note', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen with note', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export case', exact: true }).click();
  await audit('Repair evidence, resolution and export preview');
  await page.screenshot({ path: 'test-results/repair-evidence.png', fullPage: true });
  const reportPath = path.join(directory, 'repair.html');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, reportPath);
  await page.getByRole('button', { name: 'Choose report location', exact: true }).click();
  await expect(page.getByText('Repair report saved.')).toBeVisible();
  const report = await readFile(reportPath, 'utf8');
  expect(report).toContain('Bench laptop');
  expect(report).toContain('user reported');
  expect(report).toContain('next day');
  await page.reload();
  await navigate(page, 'Repair workbench');
  await expect(page.getByRole('heading', { name: 'Bench laptop', exact: true })).toBeVisible();
  const cases = await page.evaluate(() => window.pcHealth.repairCases());
  expect(cases[0].status).toBe('resolved');
  expect(cases[0].entries).toHaveLength(3);
  await navigate(page, 'Diagnostic tools');
  await audit('Diagnostic tool center');
  await page.getByRole('button', { name: /Keyboard check View physical/ }).click();
  const pad = page.getByRole('group', { name: 'Keyboard test pad' });
  await pad.click();
  await page.keyboard.press('a');
  await page.keyboard.press('b');
  await expect(page.getByText('2 unique codes received')).toBeVisible();
  await expect(page.locator('.key.seen')).toHaveCount(2);
  await page.keyboard.press('Tab');
  await expect(pad).not.toBeFocused();
  await page.getByRole('button', { name: 'Reset key check' }).click();
  await expect(page.getByText('0 unique codes received')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pad).not.toBeFocused();
  await audit('Keyboard check');
  await page.screenshot({ path: 'test-results/keyboard-check.png' });
  await page.getByRole('button', { name: 'All tools', exact: true }).click();
  await page.getByRole('button', { name: /Display check Inspect/ }).click();
  await page.getByRole('button', { name: 'Gray', exact: true }).click();
  await expect(page.locator('.display-pattern')).toHaveCSS(
    'background-color',
    'rgb(128, 128, 128)',
  );
  // Wait for the native transition as well as the DOM state before clicking screen coordinates.
  await app.evaluate(({ BrowserWindow }) => {
    globalThis.testFullscreenEntered = false;
    BrowserWindow.getAllWindows()[0].once('enter-full-screen', () => {
      globalThis.testFullscreenEntered = true;
    });
  });
  await page.getByRole('button', { name: 'Open full screen' }).click();
  await expect
    .poll(() => app.evaluate(() => globalThis.testFullscreenEntered), { timeout: 10000 })
    .toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  await page.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(false);
  await audit('Display check');
  await navigate(page, 'Repair workbench');
  await page.getByRole('button', { name: 'Remove case', exact: true }).click();
  await page.getByRole('button', { name: 'Keep case', exact: true }).click();
  expect(await page.evaluate(() => window.pcHealth.repairCases())).toHaveLength(1);
  await page.getByRole('button', { name: 'Remove case', exact: true }).click();
  await page.getByRole('button', { name: 'Delete repair case', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'What needs fixing?' })).toBeVisible();
  expect(await page.evaluate(() => window.pcHealth.repairCases())).toHaveLength(0);
  // Host cases retain both scan snapshots even after hardware history is cleared.
  await navigate(page, 'Overview');
  await page.getByRole('button', { name: 'Scan this computer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  await navigate(page, 'Repair workbench');
  await page.getByLabel('Problem description').fill('Local scan attachment verification.');
  await page.getByRole('button', { name: 'Create repair case', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Attach latest scan' })).toBeDisabled();
  expect((await page.evaluate(() => window.pcHealth.repairCases()))[0].scans).toHaveLength(1);
  await page.getByRole('button', { name: 'Open hardware scan' }).click();
  await page.getByRole('button', { name: 'Run a new scan' }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  await navigate(page, 'Repair workbench');
  await page.getByRole('button', { name: 'Attach latest scan' }).click();
  await expect
    .poll(async () => (await page.evaluate(() => window.pcHealth.repairCases()))[0].scans.length)
    .toBe(2);
  await page.evaluate(() => window.pcHealth.deleteHistory());
  expect((await page.evaluate(() => window.pcHealth.repairCases()))[0].scans).toHaveLength(2);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 700));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/repair-small-window.png' });
  // IPC refuses unrelated tests, malformed input and unknown commands independently of UI controls.
  const rejected = await page.evaluate(async () => {
    try {
      await window.pcHealth.createRepair({ symptom: '__proto__' });
      return false;
    } catch {
      return true;
    }
  });
  expect(rejected).toBe(true);
  expect(errors).toEqual([]);
  console.log('Repair and manual-tool workflows passed.');
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
