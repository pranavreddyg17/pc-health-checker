import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(os.tmpdir(), 'pchealth-dev-'));
const server = await createServer();
await server.listen();
const env = {
  ...process.env,
  PCHEALTH_DATA_DIR: directory,
  PCHEALTH_DEV_URL: 'http://127.0.0.1:5173',
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ['.'], env });
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await expect(page.getByRole('button', { name: 'Scan this computer', exact: true })).toBeEnabled();
  expect(page.url()).toBe('http://127.0.0.1:5173/');
  expect(errors).toEqual([]);
  console.log('Development renderer and preload initialized successfully.');
} finally {
  await app?.close();
  await server.close();
  await rm(directory, { recursive: true, force: true });
}
