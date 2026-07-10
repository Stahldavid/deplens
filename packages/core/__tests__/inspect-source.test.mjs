import { describe, expect, it } from 'vitest';
import { runSourceAnalysis } from '../src/inspect-source.mjs';

describe('runSourceAnalysis', () => {
  it.each(['rust', 'go'])('reports unsupported %s analysis explicitly', async (language) => {
    const result = await runSourceAnalysis({
      pkgDir: process.cwd(),
      filterRaw: null,
      sourceMaxFiles: 1,
      sourceIncludeBody: false,
      forcedLanguage: language,
      log: () => {},
    });

    expect(result.languageAnalysis.error).toContain('not implemented');
    expect(result.warnings).toContainEqual(expect.stringContaining(language));
  });
});
