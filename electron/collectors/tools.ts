import path from 'node:path';
import { access } from 'node:fs/promises';

// Resource directory is set by the main process when forking an isolated worker.
// No renderer input chooses the executable or its arguments.
export function bundledToolCandidates(name: string): string[] {
  const resources =
    (process as typeof process & { resourcesPath?: string }).resourcesPath ||
    process.env.PCHEALTH_RESOURCE_DIR;
  return [
    ...(resources ? [path.join(resources, 'vendor', process.platform, name)] : []),
    path.resolve(
      typeof __dirname === 'string' ? __dirname : path.join(process.cwd(), 'dist-electron'),
      '..',
      'vendor',
      process.platform,
      name,
    ),
  ];
}
export async function findTool(candidates: string[]): Promise<string | undefined> {
  for (const file of candidates) {
    try {
      await access(file);
      return file;
    } catch {
      /* try another trusted location */
    }
  }
}
