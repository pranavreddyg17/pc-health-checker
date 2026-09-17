import { navigate } from './ui-navigation.mjs';
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-layout-'));
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
await mkdir('test-results/design', { recursive: true });
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
const app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const destinations = [
  'Overview',
  'Reliability monitor',
  'Repair workbench',
  'Performance capture',
  'Diagnostic tools',
  'Components',
  'Replacement guide',
  'Scan history',
  'Settings',
];
try {
  await page.getByRole('button', { name: 'Scan this computer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  for (const { width, height, zoom } of [
    { width: 1360, height: 840, zoom: 1 },
    { width: 980, height: 700, zoom: 1 },
    { width: 980, height: 700, zoom: 1.25 },
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, { width, height, zoom }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setSize(width, height);
        win.webContents.setZoomFactor(zoom);
      },
      { width, height, zoom },
    );
    for (const destination of destinations) {
      await navigate(page, destination);
      await expect(page.locator('main h1')).toBeVisible();
      // A user must be able to read a page without horizontal window scrolling.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
          message: `${destination} fits at ${width}px / ${zoom * 100}%`,
        })
        .toBeLessThanOrEqual(1);
      // Electron's renderer screenshot clips at non-default zoom; capture the native content.
      const screenshot = await app.evaluate(async ({ BrowserWindow }) => {
        const capture = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
        return capture.toPNG().toString('base64');
      });
      await writeFile(
        `test-results/design/${width}-${zoom}-${destination.toLowerCase().replaceAll(' ', '-')}.png`,
        Buffer.from(screenshot, 'base64'),
      );
    }
    const navigation = page.getByRole('navigation', { name: 'Main navigation' });
    for (const label of ['Overview', 'Reliability', 'Diagnostics', 'Hardware', 'Records']) {
      const tab = navigation.getByRole('button', { name: label, exact: true });
      await tab.focus();
      await page.keyboard.press('Enter');
      await expect(tab).toHaveAttribute('aria-current', 'page');
      await expect(tab).toBeInViewport();
    }
    console.log(
      `All nine screens fit at ${width}×${height}, ${zoom * 100}% zoom; keyboard navigation passed.`,
    );
  }
  expect(errors).toEqual([]);
} finally {
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
