import { describe, expect, it } from 'vitest';
import { runSourceAnalysis } from '../src/inspect-source.mjs';
import { runInspect } from '../src/inspect.mjs';
import path from 'path';

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

  it('uses Python language analysis as the compact source analysis for path targets', async () => {
    const projectDir = path.join(process.cwd(), '__tests__', 'fixtures', 'python_project');
    const result = await runInspect({
      target: projectDir,
      cwd: process.cwd(),
      format: 'object',
      language: 'python',
      analyzeSource: true,
      sourceMaxFiles: 3,
      runtime: false,
    });

    expect(result.package).toBe('demo-pkg');
    expect(result.sourceAnalysis.files).toBe(3);
    expect(result.languageAnalysis).toMatchObject({
      sourceLanguage: 'python',
      files: 3,
    });
  });
});
