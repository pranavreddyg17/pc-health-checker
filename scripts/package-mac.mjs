import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, readdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
if (process.platform !== 'darwin') throw Error('Build macOS packages on a Mac.');
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const builder = JSON.parse(await readFile('node_modules/electron-builder/package.json', 'utf8'));
const cli = path.resolve('node_modules/electron-builder', builder.bin['electron-builder']);
const destination = path.resolve('release', metadata.version);
// Stage outside Documents/Desktop: cloud/Finder metadata can be reattached to
// app bundles there while codesign is running, even after an afterPack cleanup.
const staging = await mkdtemp(path.join(os.tmpdir(), 'pchealth-mac-release-'));
try {
  execFileSync(
    process.execPath,
    [
      cli,
      '--mac',
      'dmg',
      'zip',
      '--universal',
      '--publish',
      'never',
      `--config.directories.output=${staging}`,
    ],
    { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
  );
  const app = path.join(staging, 'mac-universal', 'PC Health.app');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(staging)) {
    if (entry !== 'mac-universal' && !/\.(dmg|zip|blockmap|yml)$/.test(entry)) continue;
    const target = path.join(destination, entry);
    // Only replace this version's generated artifact; user profiles and older releases are untouched.
    await rm(target, { recursive: true, force: true });
    await cp(path.join(staging, entry), target, { recursive: true, verbatimSymlinks: true });
  }
  // Archives were signed/verified in staging. Cloud metadata can reappear on
  // the convenience unpacked copy; preserve relative framework links exactly.
  console.log(`Verified universal macOS preview packages copied to ${destination}.`);
} finally {
  await rm(staging, { recursive: true, force: true });
}
