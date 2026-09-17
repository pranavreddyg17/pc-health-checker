import { navigate } from './ui-navigation.mjs';
import { _electron as electron, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-accessibility-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
const app = await electron.launch({ args: ['.'], env });
const page = await app.firstWindow();
let failures = 0;
async function audit(label) {
  const { violations } = await new AxeBuilder({ page })
    .setLegacyMode()
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  failures += violations.length;
  console.log(
    JSON.stringify({
      view: label,
      violations: violations.map((v) => ({
        id: v.id,
        nodes: v.nodes.map((n) => ({ target: n.target, problem: n.failureSummary })),
      })),
    }),
  );
}
try {
  await expect(page.getByRole('button', { name: 'Scan this computer', exact: true })).toBeEnabled();
  await audit('Welcome');
  await navigate(page, 'Replacement guide');
  await page.locator('summary').first().click();
  await audit('Catalog');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await audit('Settings');
  await navigate(page, 'Overview');
  await page.getByRole('button', { name: 'Scan this computer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  await audit('Scan results');
  await page.getByRole('button', { name: 'Export report' }).click();
  await audit('Export dialog');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('.component-card').first().click();
  await audit('Component details');
  await page.getByRole('button', { name: 'Open replacement guide' }).click();
  await audit('Component replacement assessment');
  expect(failures).toBe(0);
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
