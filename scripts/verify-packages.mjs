import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFile, access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { extractFile } from '@electron/asar';
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js';
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
const release = path.resolve('release', metadata.version);
const mac = path.join(release, 'mac-universal', 'PC Health.app');
const win = path.join(release, 'win-unpacked');
const macResources = path.join(mac, 'Contents', 'Resources');
const winResources = path.join(win, 'resources');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const expectedSource = '690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e';
for (const resources of [macResources, winResources]) {
  const asar = path.join(resources, 'app.asar');
  assert.equal(JSON.parse(extractFile(asar, 'package.json').toString()).version, metadata.version);
  for (const file of ['main.cjs', 'preload.cjs', 'health-cli.cjs', 'reliability/worker.cjs'])
    assert.equal(
      sha(extractFile(asar, `dist-electron/${file}`)),
      sha(await readFile(`dist-electron/${file}`)),
      `Stale package code: ${file}`,
    );
  assert.equal(
    sha(await readFile(path.join(resources, 'vendor', 'sources', 'smartmontools-7.5.tar.gz'))),
    expectedSource,
  );
  await access(path.join(resources, 'vendor', 'sources', 'smartmontools-GPL-2.txt'));
  await access(path.join(resources, 'vendor', 'NOTICE.md'));
}
function assertWindowsX64(bytes) {
  assert.equal(bytes.toString('ascii', 0, 2), 'MZ');
  const offset = bytes.readUInt32LE(0x3c);
  assert.equal(bytes.toString('ascii', offset, offset + 4), 'PE\0\0');
  assert.equal(bytes.readUInt16LE(offset + 4), 0x8664);
}
for (const file of [
  path.join(win, 'PC Health.exe'),
  path.join(winResources, 'vendor', 'win32', 'smartctl.exe'),
])
  assertWindowsX64(await readFile(file));
assert.equal(
  sha(await readFile(path.join(winResources, 'vendor', 'win32', 'smartctl.exe'))),
  sha(await readFile('vendor/win32/smartctl.exe')),
);
if (process.platform === 'darwin') {
  for (const file of [
    'Contents/MacOS/PC Health',
    'Contents/Resources/vendor/darwin/smartctl',
    'Contents/Resources/vendor/darwin/pchealth-telemetry',
  ]) {
    const arch = execFileSync('xcrun', ['lipo', '-archs', path.join(mac, file)], {
      encoding: 'utf8',
    });
    assert.match(arch, /arm64/);
    assert.match(arch, /x86_64/);
  }
  assert.equal(
    execFileSync(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print :LSMinimumSystemVersion', path.join(mac, 'Contents', 'Info.plist')],
      { encoding: 'utf8' },
    ).trim(),
    '13.0',
  );
}
const seven = await getPath7za();
const zipMac = path.join(release, `PC-Health-${metadata.version}-mac-universal.zip`);
const zipWin = path.join(release, `PC-Health-${metadata.version}-win-x64.zip`);
for (const [zip, member, resources] of [
  [zipMac, 'PC Health.app/Contents/Resources/app.asar', macResources],
  [zipWin, 'resources/app.asar', winResources],
]) {
  const bytes = execFileSync(seven, ['e', '-so', zip, member], { maxBuffer: 64 * 1024 * 1024 });
  assert.equal(
    sha(bytes),
    sha(await readFile(path.join(resources, 'app.asar'))),
    'Stale ZIP payload',
  );
}
const installer = path.join(release, `PC-Health-${metadata.version}-windows-x64-Setup.exe`);
const temporary = await mkdtemp(path.join(os.tmpdir(), 'pchealth-installer-verify-'));
try {
  execFileSync(seven, ['e', '-y', `-o${temporary}`, installer, '$PLUGINSDIR/app-64.7z'], {
    stdio: 'ignore',
  });
  const payload = path.join(temporary, 'app-64.7z');
  await access(payload);
  assert.equal(
    sha(
      execFileSync(
        seven,
        ['e', '-so', payload, 'resources/vendor/sources/smartmontools-7.5.tar.gz'],
        { maxBuffer: 4 * 1024 * 1024 },
      ),
    ),
    expectedSource,
  );
  const bytes = execFileSync(seven, ['e', '-so', payload, 'resources/app.asar'], {
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    sha(bytes),
    sha(await readFile(path.join(winResources, 'app.asar'))),
    'Stale NSIS payload',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
if (process.platform === 'darwin') {
  const extracted = await mkdtemp(path.join(os.tmpdir(), 'pchealth-mac-zip-verify-'));
  try {
    execFileSync('/usr/bin/ditto', ['-x', '-k', zipMac, extracted]);
    execFileSync(
      '/usr/bin/codesign',
      ['--verify', '--deep', '--strict', path.join(extracted, 'PC Health.app')],
      { stdio: 'inherit' },
    );
  } finally {
    await rm(extracted, { recursive: true, force: true });
  }
}
if (process.platform === 'darwin') {
  const mount = await mkdtemp(path.join(os.tmpdir(), 'pchealth-dmg-verify-'));
  let attached = false;
  try {
    execFileSync(
      '/usr/bin/hdiutil',
      [
        'attach',
        '-readonly',
        '-nobrowse',
        '-mountpoint',
        mount,
        path.join(release, `PC-Health-${metadata.version}-mac-universal.dmg`),
      ],
      { stdio: 'ignore' },
    );
    attached = true;
    assert.equal(
      sha(await readFile(path.join(mount, 'PC Health.app', 'Contents', 'Resources', 'app.asar'))),
      sha(await readFile(path.join(macResources, 'app.asar'))),
      'Stale DMG payload',
    );
  } finally {
    if (attached) execFileSync('/usr/bin/hdiutil', ['detach', mount], { stdio: 'ignore' });
    await rm(mount, { recursive: true, force: true });
  }
}
async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const artifacts = [
  zipMac,
  zipWin,
  installer,
  path.join(release, `PC-Health-${metadata.version}-mac-universal.dmg`),
];
await writeFile(
  path.join(release, 'SHA256SUMS.txt'),
  (await Promise.all(artifacts.map(async (f) => `${await fileHash(f)}  ${path.basename(f)}`))).join(
    '\n',
  ) + '\n',
);
console.log(
  'Verified both package versions/current code, bundled helpers/source/licenses, universal Mac architectures/integrity, Windows x64 executables, ZIP/NSIS payloads and SHA-256 sums.',
);
