// inspect.mjs — CLI entry point (orchestrates core, types, source, history)
import { runInspectCore } from './inspect-core.mjs';
import { runSourceAnalysis } from './inspect-source.mjs';
import { saveHistoryEntry } from './history-manager.mjs';
import { enrichSymbolsWithSource } from './symbols.mjs';

export async function runInspect(options) {
  const rawOutput = await runInspectCore(options);

  // Text mode: pass through core output unchanged
  if (options?.format !== 'json') {
    return rawOutput;
  }

  // JSON mode: parse and enrich
  let jsonOutput = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput;

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

  if (options?.saveHistory) {
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

  return JSON.stringify(jsonOutput, null, 2);
}
