import { describe, expect, it } from 'vitest';
import { runDiff } from '../src/diff.mjs';
import { downloadVersion } from '../src/version-resolver.mjs';

describe('cache offline mode', () => {
  it('fails fast when an exact package version is not cached', async () => {
    await expect(
      downloadVersion('deplens-offline-fixture-does-not-exist', '0.0.0', { offline: true })
    ).rejects.toThrow('--offline was requested');
  });

  it('does not resolve latest in offline diff mode', async () => {
    const result = await runDiff({
      package: 'zod',
      from: 'installed',
      to: 'latest',
      offline: true,
      format: 'json',
    });

    expect(result.error).toBe('--offline diff requires exact versions, except --from installed');
    expect(JSON.parse(result.output).meta.offline).toBe(true);
  });
});
