import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { linuxGraphics } from '../electron/collectors/linux';
import { diagnose } from '../src/shared/diagnostics';

vi.mock('node:fs/promises', () => ({ readdir: vi.fn(), readFile: vi.fn(), readlink: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe('Linux graphics inventory', () => {
  it('enumerates cards without treating connectors as extra GPUs or claiming health', async () => {
    vi.mocked(fs.readdir).mockResolvedValue(['card0', 'card0-HDMI-A-1', 'renderD128'] as any);
    vi.mocked(fs.readFile).mockImplementation(async (file) =>
      String(file).endsWith('/vendor') ? '0x8086\n' : '0x1234\n',
    );
    vi.mocked(fs.readlink).mockResolvedValue('../../../private-path/i915');
    const result = await linuxGraphics();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Intel graphics (0x1234)');
    expect(result[0].metrics[0].value).toBe('i915');
    expect(JSON.stringify(result)).not.toContain('private-path');
    expect(result[0].checks[1].status).toBe('not-run');
    expect(diagnose(result)).toEqual([]);
  });
  it('marks absent cards as unsupported', async () => {
    vi.mocked(fs.readdir).mockResolvedValue([]);
    const [c] = await linuxGraphics();
    expect(c.checks[0].status).toBe('unsupported');
    expect(c.metrics).toEqual([]);
  });
  it('propagates enumeration errors so the coordinator can report missing coverage', async () => {
    vi.mocked(fs.readdir).mockRejectedValue(new Error('Permission denied'));
    await expect(linuxGraphics()).rejects.toThrow('Permission denied');
  });
});
