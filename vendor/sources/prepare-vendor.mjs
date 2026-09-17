// Build-time downloads only. The installed app never downloads diagnostic tools.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
const version = '7.5';
const root = process.cwd();
const work = path.join(root, '.local-data', 'vendor-build');
const sources = path.join(root, 'vendor', 'sources');
await mkdir(work, { recursive: true });
await mkdir(sources, { recursive: true });
async function download(name, checksum, destination) {
  let bytes;
  try {
    bytes = await readFile(destination);
  } catch {
    const response = await fetch(
      `https://downloads.sourceforge.net/project/smartmontools/smartmontools/${version}/${name}`,
    );
    if (!response.ok) throw Error(`Vendor download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash('sha256').update(bytes).digest('hex') !== checksum)
    throw Error(`Checksum mismatch: ${name}`);
  await writeFile(destination, bytes);
}
const archive = path.join(sources, `smartmontools-${version}.tar.gz`);
await download(
  `smartmontools-${version}.tar.gz`,
  '690b83ca331378da9ea0d9d61008c4b22dde391387b9bbad7f29387f2595f76e',
  archive,
);
execFileSync('tar', ['-xzf', archive, '-C', work]);
const source = path.join(work, `smartmontools-${version}`);
await copyFile(path.join(source, 'COPYING'), path.join(sources, 'smartmontools-GPL-2.txt'));
if (process.platform === 'darwin') {
  const destination = path.join(root, 'vendor', 'darwin');
  await mkdir(destination, { recursive: true });
  const flags = '-arch arm64 -arch x86_64 -mmacosx-version-min=12.0';
  execFileSync(
    './configure',
    [
      '--without-selinux',
      '--without-libcap-ng',
      '--without-libsystemd',
      '--with-drivedbdir=',
      '--with-smartdscriptdir=',
      `CXXFLAGS=-O2 ${flags}`,
      `LDFLAGS=${flags}`,
    ],
    { cwd: source, stdio: 'inherit' },
  );
  execFileSync('make', ['-j4', 'smartctl'], { cwd: source, stdio: 'inherit' });
  await copyFile(path.join(source, 'smartctl'), path.join(destination, 'smartctl'));
  execFileSync('codesign', ['--force', '--sign', '-', path.join(destination, 'smartctl')]);
}
// Extract the official Windows x64 executable without running its installer.
const installer = path.join(work, `smartmontools-${version}.win32-setup.exe`);
await download(
  `smartmontools-${version}.win32-setup.exe`,
  '896337fcc253220614cf8cdbd5cf2321c5aa326a37a04160a672a281e6104c70',
  installer,
);
const { getPath7za } = await import('app-builder-lib/out/toolsets/7zip.js');
const extracted = path.join(work, 'windows-extracted');
execFileSync(await getPath7za(), ['x', '-y', `-o${extracted}`, installer], { stdio: 'inherit' });
await mkdir(path.join(root, 'vendor', 'win32'), { recursive: true });
for (const file of ['smartctl.exe', 'drivedb.h']) {
  const original = path.join(extracted, 'bin', file);
  await access(original);
  await copyFile(original, path.join(root, 'vendor', 'win32', file));
}
await copyFile(new URL(import.meta.url), path.join(sources, 'prepare-vendor.mjs'));
console.log('Prepared pinned smartctl tools and corresponding unmodified source/license.');
