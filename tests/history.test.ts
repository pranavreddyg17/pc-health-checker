import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { HistoryStore, isScan } from '../electron/history';
import { component } from '../electron/collectors/common';
import { fixtureScan } from './fixtures';
const folders: string[] = [];
async function setup() {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'pchealth-test-'));
  folders.push(folder);
  return { folder, store: new HistoryStore(folder) };
}
afterEach(async () => {
  await Promise.all(
    folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
  );
});
describe('local history', () => {
  it('saves and reloads a scan without requiring network access', async () => {
    const { store } = await setup();
    const scan = fixtureScan([component('cpu', 'CPU', 'Test')]);
    await store.save(scan);
    expect(await store.load()).toEqual([scan]);
  });
  it('preserves corrupt history instead of silently overwriting it', async () => {
    const { folder, store } = await setup();
    const file = path.join(folder, 'scans.json');
    await writeFile(file, '{broken');
    await expect(store.save(fixtureScan([]))).rejects.toThrow('preserved');
    expect(await readFile(file, 'utf8')).toBe('{broken');
  });
  it('rejects nested invalid measurement data', () => {
    const scan = fixtureScan([component('cpu', 'CPU', 'Test')]);
    (scan.components[0] as any).metrics = [null];
    expect(isScan(scan)).toBe(false);
  });
  it('allows clearing damaged history and starting a new one', async () => {
    const { folder, store } = await setup();
    await writeFile(path.join(folder, 'scans.json'), 'bad');
    await store.clear();
    await store.save(fixtureScan([]));
    expect(await store.load()).toHaveLength(1);
  });
});
