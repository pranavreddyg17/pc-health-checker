// macOS development installation: one main application, no retained build copy.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, mkdir, cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
if (process.platform !== 'darwin') throw Error('This local installation script targets macOS.');
const stage = await mkdtemp(path.join(os.tmpdir(), 'pchealth-install-'));
const destination = path.join(os.homedir(), 'Applications', 'PC Health.app');
const builder = JSON.parse(await readFile('node_modules/electron-builder/package.json', 'utf8'));
try {
  execFileSync(
    process.execPath,
    [
      path.resolve('node_modules/electron-builder', builder.bin['electron-builder']),
      '--mac',
      '--dir',
      `--${process.arch}`,
      '--publish',
      'never',
      `--config.directories.output=${stage}`,
    ],
    { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } },
  );
  const bundle = path.join(stage, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'PC Health.app');
  await access(bundle);
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle]);
  // Quit gracefully to flush the existing local history before replacing the app.
  execFileSync('/usr/bin/osascript', [
    '-e',
    'if application id "com.pchealth.desktop" is running then tell application id "com.pchealth.desktop" to quit',
  ]);
  await mkdir(path.dirname(destination), { recursive: true });
  // Only the application's bundle is replaced. Application Support is untouched.
  await rm(destination, { recursive: true, force: true });
  await cp(bundle, destination, { recursive: true, verbatimSymlinks: true });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', destination]);
  console.log(`Installed one main app: ${destination}`);
} finally {
  await rm(stage, { recursive: true, force: true });
}
