import { navigate } from './ui-navigation.mjs';
import { _electron as electron, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-investigation-ui-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
await mkdir('test-results', { recursive: true });
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
const app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
async function audit(name) {
  const result = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  console.log(
    JSON.stringify({
      view: name,
      violations: result.violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, summary: n.failureSummary })),
      })),
    }),
  );
  expect(result.violations).toEqual([]);
}
try {
  await navigate(page, 'Performance capture');
  await expect(
    page.getByRole('heading', { name: 'When does your computer feel slow?' }),
  ).toBeVisible();
  await audit('Investigation intake');
  await page.getByLabel('What are you doing when it happens?').fill('UI test: normal desktop work');
  await page.getByLabel('When did you first notice it?').selectOption('recent');
  await page.getByLabel(/Anything changed recently/).fill('Development test only');
  await page.getByRole('button', { name: 'Create investigation', exact: true }).click();
  await page.getByLabel('Recording length').selectOption('60');
  await page.getByLabel('Power conditions').selectOption('plugged-in');
  await audit('Recording preparation');
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.pcHealth.investigations())).active.observation.samples
          .length,
      { timeout: 15000 },
    )
    .toBeGreaterThan(1);
  const beforeMarker = await page.evaluate(() => window.pcHealth.investigations());
  await page.waitForTimeout(500); // Verify markers use click time, not the previous sample's timestamp.
  await page.getByRole('button', { name: 'It’s happening now' }).click();
  const marked = await page.evaluate(() => window.pcHealth.investigations());
  expect(marked.active.observation.markers[0]).toBeGreaterThan(
    beforeMarker.active.observation.elapsedMs,
  );
  await page.screenshot({ path: 'test-results/investigation-live.png', fullPage: true });
  // Reload exercises reattachment to a user-started recording without starting another collector.
  await page.reload();
  await page.getByRole('button', { name: 'Open investigation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  const denied = await page.evaluate(async () => {
    try {
      await window.pcHealth.scan();
      return false;
    } catch {
      return true;
    }
  });
  expect(denied).toBe(true);
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toHaveCount(0, {
    timeout: 70000,
  });
  const first = await page.evaluate(() => window.pcHealth.investigations());
  expect(first.cases).toHaveLength(1);
  expect(first.cases[0].observations[0].state).toBe('complete');
  expect(first.cases[0].observations[0].samples.length).toBeGreaterThan(9);
  expect(first.cases[0].observations[0].markers).toHaveLength(1);
  expect(first.cases[0].observations[0].samples.some((s) => s.cpuPercent !== undefined)).toBe(true);
  expect(first.cases[0].observations[0].samples.every((s) => !s.apps?.length)).toBe(true);
  await audit('Observation evidence');
  await page.screenshot({ path: 'test-results/investigation-evidence.png', fullPage: true });
  await page
    .getByLabel('How did this workload feel during this recording?')
    .selectOption('unchanged');
  await page
    .getByLabel('What did you change before this recording?')
    .fill('No change; testing follow-up cancellation');
  await page.getByLabel('Include names of the busiest apps locally').check();
  await page.getByRole('button', { name: 'Start recording', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await page.evaluate(() => window.pcHealth.investigations())).active.observation.samples
          .length,
      { timeout: 15000 },
    )
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Compare carefully: conditions may differ' }),
  ).toBeVisible({ timeout: 10000 });
  const stopped = await page.evaluate(() => window.pcHealth.investigations());
  expect(stopped.active).toBeUndefined();
  expect(stopped.cases[0].observations[1].state).toBe('stopped');
  await audit('Follow-up comparison');
  await page.getByRole('button', { name: 'Preview case export' }).click();
  await audit('Investigation export preview');
  const reportPath = path.join(directory, 'case.html');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, reportPath);
  await page.getByRole('button', { name: 'Choose report location' }).click();
  await expect(page.getByText('Investigation report saved.')).toBeVisible();
  const report = await readFile(reportPath, 'utf8');
  expect(report).toContain('UI test: normal desktop work');
  expect(report).not.toContain(first.cases[0].id);
  await page.reload();
  await navigate(page, 'Performance capture');
  await expect(
    page.getByRole('heading', { name: 'UI test: normal desktop work', exact: true }),
  ).toBeVisible();
  const resumed = await page.evaluate(() => window.pcHealth.investigations());
  expect(resumed.cases[0].observations[0].outcome).toBe('unchanged');
  await page.getByRole('button', { name: 'Remove this investigation', exact: true }).click();
  await page.getByRole('button', { name: 'Keep investigation', exact: true }).click();
  expect((await page.evaluate(() => window.pcHealth.investigations())).cases).toHaveLength(1);
  await page.getByRole('button', { name: 'Remove this investigation', exact: true }).click();
  await page.getByRole('button', { name: 'Remove saved investigation', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'When does your computer feel slow?' }),
  ).toBeVisible();
  expect((await page.evaluate(() => window.pcHealth.investigations())).cases).toHaveLength(0);
  expect(errors).toEqual([]);
  console.log(
    'Investigation flows passed: real timed recording, marker, renderer reattachment, scan exclusion, follow-up cancellation, comparison, redacted export, persistence, removal, and five accessibility views.',
  );
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
