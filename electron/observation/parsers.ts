export interface Counters {
  pagingOut?: number;
  memoryWait?: number;
  ioWait?: number;
}
export interface ProcessReading {
  pid: number;
  name: string;
  cpuSeconds: number;
  memoryMB: number;
}
const number = (value: unknown) => {
  if (value === null || value === undefined || value === '') return undefined;
  const v = Number(value);
  return Number.isFinite(v) && v >= 0 ? v : undefined;
};
export function parseVmStat(text: string): Counters {
  const value = /Swapouts:\s+(\d+)\./.exec(text)?.[1];
  if (!value) throw new Error('Swap counters are unavailable.');
  return { pagingOut: number(value) };
}
export function parseLinuxVm(text: string): Counters {
  const value = /^pswpout\s+(\d+)$/m.exec(text)?.[1];
  if (!value) throw new Error('Swap counters are unavailable.');
  return { pagingOut: number(value) };
}
export function parsePsi(text: string) {
  const value = /^some\s+.*\btotal=(\d+)\s*$/m.exec(text)?.[1];
  return number(value);
}
export function parseAvailableMemory(text: string) {
  const kb = number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(text)?.[1]);
  return kb === undefined ? undefined : kb / 1024;
}
export function parseCpuTime(text: string): number | undefined {
  const match = /^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(text);
  if (!match) return undefined;
  return (
    Number(match[1] || 0) * 86400 +
    Number(match[2] || 0) * 3600 +
    Number(match[3]) * 60 +
    Number(match[4])
  );
}
export function safeProcessName(value: string) {
  const name = value
    .replace(/\\/g, '/')
    .split('/')
    .at(-1)!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .slice(0, 80);
  return name || 'Unnamed process';
}
export function parseProcesses(text: string): ProcessReading[] {
  const results: ProcessReading[] = [];
  for (const line of text.split('\n').slice(0, 10000)) {
    const match = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const seconds = parseCpuTime(match[2]);
    if (seconds === undefined) continue;
    results.push({
      pid: Number(match[1]),
      name: safeProcessName(match[4]),
      cpuSeconds: seconds,
      memoryMB: Number(match[3]) / 1024,
    });
  }
  return results;
}
export function processDeltas(
  previous: ProcessReading[],
  current: ProcessReading[],
  seconds: number,
  cores: number,
) {
  if (seconds <= 0 || cores < 1) return [];
  const old = new Map(previous.map((p) => [p.pid, p]));
  return current
    .flatMap((p) => {
      const before = old.get(p.pid);
      if (!before || before.name !== p.name || p.cpuSeconds < before.cpuSeconds) return [];
      const cpuPercent = ((p.cpuSeconds - before.cpuSeconds) / seconds / cores) * 100;
      if (cpuPercent > 100.5) return [];
      return [{ name: p.name, cpuPercent: Math.min(100, cpuPercent), memoryMB: p.memoryMB }];
    })
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, 5);
}
export function counterRate(
  before: number | undefined,
  after: number | undefined,
  seconds: number,
) {
  if (before === undefined || after === undefined || after < before || seconds <= 0)
    return undefined;
  return (after - before) / seconds;
}
export function parseWindowsObservation(data: unknown) {
  if (!data || typeof data !== 'object') throw new Error('Unreadable performance counters.');
  const d = data as Record<string, any>;
  return {
    availableMemoryMB: number(d.Memory?.AvailableMBytes),
    pagingOutPerSec: number(d.Memory?.PagesOutputPersec),
    diskMBps:
      number(d.Disk?.DiskBytesPersec) === undefined
        ? undefined
        : number(d.Disk.DiskBytesPersec)! / 1024 ** 2,
    apps: Array.isArray(d.Processes)
      ? d.Processes.filter(
          (p: any) =>
            p &&
            p.Name &&
            !['_Total', 'Idle'].includes(p.Name) &&
            number(p.CPU) !== undefined &&
            number(p.Memory) !== undefined,
        )
          .map((p: any) => ({
            name: safeProcessName(String(p.Name)),
            cpuPercent: Math.min(100, number(p.CPU)! / Math.max(1, number(d.Cores) || 1)),
            memoryMB: number(p.Memory)! / 1024 ** 2,
          }))
          .sort((a: any, b: any) => b.cpuPercent - a.cpuPercent)
          .slice(0, 5)
      : undefined,
  };
}
