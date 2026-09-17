import path from 'node:path';
import { execFileSync } from 'node:child_process';

export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // Clear build-artifact metadata that macOS codesign rejects. This touches only
  // the newly generated bundle, never an installed app or the user's profile.
  execFileSync('/usr/bin/xattr', ['-cr', app]);
}
