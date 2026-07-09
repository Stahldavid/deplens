// inspect.mjs — CLI entry point (orchestrates core, types, source, history)
import { runInspectCore } from './inspect-core.mjs';
import { runSourceAnalysis } from './inspect-source.mjs';
import { saveHistoryEntry } from './history-manager.mjs';
import { enrichSymbolsWithSource } from './symbols.mjs';

export async function runInspect(options) {
  const rawOutput = await runInspectCore(options);
  const format = options?.format || 'text';
  const shouldSaveHistory = Boolean(options?.saveHistory);

  // Text mode: pass through core output unchanged unless history needs a
  // structured payload to persist.
  if (format !== 'json' && format !== 'object' && !shouldSaveHistory) {
    return rawOutput;
  }

  // JSON/object modes already have structured data. Text + --save-history
  // creates a quiet object-mode pass so history works without changing output.
  let jsonOutput =
    format === 'json' || format === 'object'
      ? typeof rawOutput === 'string'
        ? JSON.parse(rawOutput)
        : rawOutput
      : await runInspectCore({ ...options, format: 'object', write: undefined, writeError: undefined });

  if (options?.analyzeSource && jsonOutput?.pkgDir) {
    const sourceResult = runSourceAnalysis({
      pkgDir: jsonOutput.pkgDir,
      filterRaw: options.filter || null,
      sourceMaxFiles: options.sourceMaxFiles || 100,
      sourceIncludeBody: options.sourceIncludeBody || false,
      forcedLanguage: options.language || null,
      log: (msg) => {
        if (options?.format !== 'json') {
          console.log(msg);
        }
      },
    });

    jsonOutput.sourceAnalysis = sourceResult.sourceAnalysis;
    if (Array.isArray(jsonOutput.symbols) && sourceResult.sourceAnalysis) {
      jsonOutput.symbols = enrichSymbolsWithSource(jsonOutput.symbols, sourceResult.sourceAnalysis);
    }
    jsonOutput.languageAnalysis = {
      language: sourceResult.detectedLang || 'unknown',
      files: sourceResult.languageAnalysis?.summary?.totalFiles || 0,
      summary: sourceResult.languageAnalysis?.summary || {},
    };
  }

  if (shouldSaveHistory) {
    try {
      const historyResult = {
        package: jsonOutput.package,
        version: jsonOutput.version,
        timestamp: Date.now(),
        data: jsonOutput,
      };
      if (options.historyDir) {
        saveHistoryEntry(historyResult, options.historyDir);
      } else {
        saveHistoryEntry(historyResult);
      }
    } catch (e) {
      // Silent
    }
  }

  if (format === 'object') {
    return jsonOutput;
  }
  if (format !== 'json') {
    return rawOutput;
  }
  return JSON.stringify(jsonOutput, null, 2);
}
