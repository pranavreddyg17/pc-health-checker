import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
if (process.platform === 'darwin') {
  mkdirSync('vendor/darwin', { recursive: true });
  mkdirSync('.local-data/native-build', { recursive: true });
  for (const arch of ['arm64', 'x86_64']) {
    execFileSync(
      'xcrun',
      [
        'swiftc',
        '-O',
        '-target',
        `${arch}-apple-macosx12.0`,
        'native/macos-telemetry.swift',
        '-o',
        `.local-data/native-build/telemetry-${arch}`,
      ],
      { stdio: 'inherit' },
    );
  }
  execFileSync('xcrun', [
    'lipo',
    '-create',
    '.local-data/native-build/telemetry-arm64',
    '.local-data/native-build/telemetry-x86_64',
    '-output',
    'vendor/darwin/pchealth-telemetry',
  ]);
  execFileSync('codesign', ['--force', '--sign', '-', 'vendor/darwin/pchealth-telemetry']);
  console.log('Built universal macOS read-only telemetry helper.');
}
