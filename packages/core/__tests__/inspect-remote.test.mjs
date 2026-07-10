import { beforeEach, describe, expect, it, vi } from 'vitest';

const downloadVersion = vi.fn();
const resolveVersionAsync = vi.fn();

vi.mock('../src/version-resolver.mjs', async (importOriginal) => ({
  ...(await importOriginal()),
  downloadVersion,
  resolveVersionAsync,
}));

const { runInspectCore } = await import('../src/inspect-core.mjs');

describe('remote inspection failures', () => {
  beforeEach(() => {
    downloadVersion.mockReset();
    resolveVersionAsync.mockReset();
  });

  it('fails without falling back to an installed package', async () => {
    resolveVersionAsync.mockResolvedValue('9999.99.99');
    downloadVersion.mockRejectedValue(new Error('version not found'));

    const result = await runInspectCore({
      target: 'zod',
      cwd: process.cwd(),
      remote: true,
      remoteVersion: '9999.99.99',
      runtime: false,
      format: 'object',
    });

    expect(result.package).toBeNull();
    expect(result.error).toContain('version not found');
    expect(result.resolution?.cache).toBeNull();
  });

  it('resolves tags before selecting a cache key', async () => {
    resolveVersionAsync.mockResolvedValue('4.3.6');
    downloadVersion.mockRejectedValue(new Error('stop after resolution'));

    await runInspectCore({
      target: 'zod',
      cwd: process.cwd(),
      remote: true,
      remoteVersion: 'latest',
      runtime: false,
      format: 'object',
    });

    expect(resolveVersionAsync).toHaveBeenCalledWith('zod', 'latest', process.cwd(), {
      signal: undefined,
      timeoutMs: undefined,
    });
    expect(downloadVersion).toHaveBeenCalledWith('zod', '4.3.6', expect.any(Object));
  });
});
