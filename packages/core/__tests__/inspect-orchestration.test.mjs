import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runInspectCore: vi.fn(),
  runSourceAnalysis: vi.fn(),
  saveHistoryEntry: vi.fn(),
}));

vi.mock('../src/inspect-core.mjs', () => ({ runInspectCore: mocks.runInspectCore }));
vi.mock('../src/inspect-source.mjs', () => ({ runSourceAnalysis: mocks.runSourceAnalysis }));
vi.mock('../src/history-manager.mjs', () => ({ saveHistoryEntry: mocks.saveHistoryEntry }));

const { runInspect } = await import('../src/inspect.mjs');

describe('inspect orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('captures text-mode history from a single core inspection', async () => {
    const snapshot = {
      schemaVersion: 1,
      package: 'demo-pkg',
      version: '1.0.0',
      warnings: [],
    };
    mocks.runInspectCore.mockImplementation(async (options) => {
      options.captureResult?.(snapshot);
      return 'formatted inspection';
    });

    const output = await runInspect({
      target: 'demo-pkg',
      format: 'text',
      saveHistory: true,
    });

    expect(output).toBe('formatted inspection');
    expect(mocks.runInspectCore).toHaveBeenCalledTimes(1);
    expect(mocks.saveHistoryEntry).toHaveBeenCalledWith(
      expect.objectContaining({ package: 'demo-pkg', version: '1.0.0', data: snapshot })
    );
  });

  it('keeps rich sections requested by inspect flags in compact output', async () => {
    mocks.runInspectCore.mockResolvedValue({
      schemaVersion: 1,
      package: 'demo-pkg',
      version: '1.0.0',
      docs: { readme: 'Usage' },
      sections: [{ title: 'Usage' }],
      examples: { ranked: [{ code: 'demo()' }] },
      symbols: [],
      warnings: [],
    });

    const output = await runInspect({
      target: 'demo-pkg',
      format: 'object',
      detail: 'compact',
      includeDocs: true,
      listSections: true,
      includeExamples: true,
    });

    expect(output).toMatchObject({
      docs: { readme: 'Usage' },
      sections: [{ title: 'Usage' }],
      examples: { ranked: [{ code: 'demo()' }] },
    });
  });

  it('separates runtime language from analyzed source language', async () => {
    mocks.runInspectCore.mockResolvedValue({
      schemaVersion: 1,
      package: 'demo-pkg',
      version: '1.0.0',
      pkgDir: '/demo',
      symbols: [],
      warnings: [],
    });
    mocks.runSourceAnalysis.mockResolvedValue({
      detectedLang: 'javascript',
      sourceAnalysis: {
        files: [{ path: 'src/index.ts', functions: [] }],
        summary: { totalFiles: 1, totalFunctions: 0 },
      },
      languageAnalysis: null,
      warnings: [],
    });

    const output = await runInspect({
      target: 'demo-pkg',
      format: 'object',
      detail: 'compact',
      analyzeSource: true,
    });

    expect(output.languageAnalysis).toMatchObject({
      runtimeLanguage: 'javascript',
      sourceLanguage: 'typescript',
      files: 1,
    });
    expect(output.sourceAnalysis).toEqual({
      files: 1,
      summary: { totalFiles: 1, totalFunctions: 0 },
    });
    expect(output).not.toHaveProperty('symbols');
    expect(output).not.toHaveProperty('pagination');
  });
});
