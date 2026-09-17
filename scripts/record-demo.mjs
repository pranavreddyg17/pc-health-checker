// Records the app through its public UI using an isolated, disposable profile.
// Requires ffmpeg on PATH. No personal history or notes are opened.
import { _electron as electron, expect } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { navigate } from './ui-navigation.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-demo-'));
const output = path.resolve('docs/media');
await mkdir(output, { recursive: true });
const env = { ...process.env, PCHEALTH_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PCHEALTH_DEV_URL;
const executablePath = process.env.PCHEALTH_TEST_EXECUTABLE;
const app = await electron.launch({ args: executablePath ? [] : ['.'], executablePath, env });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let encoder;

try {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1440, 800);
  });
  await page.getByRole('button', { name: 'Scan this computer', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Run a new scan' })).toBeVisible({
    timeout: 65000,
  });
  const scan = (await page.evaluate(() => window.pcHealth.bootstrap())).scans[0];
  const storage = scan.components.find((component) => component.kind === 'storage');
  if (!storage) throw Error('A detected drive is required for this demo.');
  await navigate(page, 'Reliability monitor');
  await page.getByRole('button', { name: 'Run reliability check', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Reliability evidence', exact: true }),
  ).toBeVisible({ timeout: 40000 });

  // This example is explicitly separate from the host's real measured evidence.
  await navigate(page, 'Repair workbench');
  await page.getByRole('button', { name: /Battery & charging Separate/ }).click();
  await page.getByLabel('Observed behavior').selectOption('no-charge');
  await page.getByLabel('Computer being repaired').selectOption('other-device');
  await page.getByLabel('Device label').fill('Example repair: laptop');
  await page
    .getByLabel('Problem description')
    .fill(
      'Illustrative case: charging stops with the original adapter. Results in this case are example user reports.',
    );
  await page.getByRole('button', { name: 'Create repair case', exact: true }).click();
  await page.locator('.guided-test').nth(1).getByRole('button', { name: 'View steps' }).click();
  await page
    .getByLabel('Does charging work reliably with the known-working compatible setup?')
    .selectOption('observed');
  await page
    .getByLabel('Test notes / exact diagnostic code')
    .fill('Example user report: charging remained stable with a known-working compatible charger.');
  await page.getByRole('button', { name: 'Save test result', exact: true }).click();
  await navigate(page, 'Overview');

  const captions = [
    '01 / SCAN     Read real hardware evidence. See what could and could not be checked.',
    '02 / STORAGE     Inspect drive endurance, spare capacity and reported errors.',
    '03 / RELIABILITY     Check thermal pressure with explicit sources and limitations.',
    '04 / REPAIR WORKBENCH     Follow guided tests and document findings. Example case shown.',
    '05 / DIAGNOSTIC TOOLS     Check physical key responses without saving typed text.',
    '06 / LOCAL RECORDS     Keep scan history and export evidence. No account or cloud required.',
  ];
  const filters = [
    'scale=1728:960',
    'pad=1920:1080:96:40:color=0x0c0e16',
    "drawtext=fontfile=/System/Library/Fonts/Menlo.ttc:text='PC HEALTH / 0.7.0 / OFFLINE DIAGNOSTICS':fontsize=18:fontcolor=0x6ae7e7:x=96:y=10",
    'drawbox=x=96:y=1008:w=1728:h=2:color=0xf5797c:t=fill',
  ];
  for (let i = 0; i < captions.length; i++) {
    const file = path.join(directory, `caption-${i}.txt`);
    await writeFile(file, captions[i]);
    filters.push(
      `drawtext=fontfile=/System/Library/Fonts/Supplemental/Arial.ttf:textfile=${file}:fontsize=24:fontcolor=0xe7eaf4:x=96:y=1025:enable='gte(t,${i * 5})*lt(t,${(i + 1) * 5})'`,
    );
  }
  encoder = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'image2pipe',
      '-framerate',
      '12',
      '-vcodec',
      'png',
      '-i',
      'pipe:0',
      '-vf',
      filters.join(','),
      '-r',
      '24',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '22',
      '-pix_fmt',
      'yuv420p',
      '-t',
      '30',
      '-movflags',
      '+faststart',
      path.join(output, 'pc-health-demo.mp4'),
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let encodingErrors = '';
  encoder.stderr.on('data', (chunk) => {
    encodingErrors += chunk.toString();
  });
  encoder.stdin.on('error', () => {});
  const completed = new Promise((resolve, reject) => {
    encoder.once('error', reject);
    encoder.once('close', (code) =>
      code === 0 ? resolve() : reject(Error(encodingErrors || `ffmpeg exited ${code}`)),
    );
  });
  // Attach immediately, including when capture later fails before awaiting completion.
  completed.catch(() => {});

  for (let frame = 0; frame < 360; frame++) {
    if (frame === 60) {
      await navigate(page, 'Components');
      await page
        .locator('.component-card')
        .filter({ has: page.getByRole('heading', { name: storage.name, exact: true }) })
        .click();
    } else if (frame === 120) {
      await page.getByRole('button', { name: 'Close component details', exact: true }).click();
      await navigate(page, 'Reliability monitor');
      await page.getByLabel('Component area').selectOption('thermal');
      await page.locator('.health-signal summary').first().click();
      await page.locator('.health-filters').scrollIntoViewIfNeeded();
    } else if (frame === 180) {
      await navigate(page, 'Repair workbench');
    } else if (frame === 210) {
      await page.locator('.guided-test').nth(1).scrollIntoViewIfNeeded();
    } else if (frame === 240) {
      await navigate(page, 'Diagnostic tools');
      await page.getByRole('button', { name: /Keyboard check View physical/ }).click();
      await page.getByRole('group', { name: 'Keyboard test pad' }).click();
    } else if ([250, 260, 270, 280, 290].includes(frame)) {
      await page.keyboard.press(
        { 250: 'a', 260: 's', 270: 'd', 280: 'Space', 290: 'ArrowRight' }[frame],
      );
    } else if (frame === 300) {
      await navigate(page, 'Scan history');
    } else if (frame === 336) {
      await navigate(page, 'Overview');
    }
    const buffer = await page.screenshot({ animations: 'allow' });
    if (!encoder.stdin.write(buffer)) await once(encoder.stdin, 'drain');
    await new Promise((resolve) => setTimeout(resolve, 45));
    if (frame % 60 === 0) console.log(`Captured scene ${frame / 60 + 1} of 6`);
  }
  encoder.stdin.end();
  await completed;
  if (errors.length) throw Error(`Renderer errors: ${errors.join('; ')}`);
  const reliability = await page.evaluate(() => window.pcHealth.reliability());
  if (reliability.running || reliability.notifications)
    throw Error('Demo must not enable background monitoring or notifications.');
  console.log('Saved docs/media/pc-health-demo.mp4 (30 seconds).');
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill();
  await app.close();
  await rm(directory, { recursive: true, force: true });
}
