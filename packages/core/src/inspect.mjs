// inspect.mjs — CLI entry point (orchestrates core, types, source, history)
import { runInspectCore } from './inspect-core.mjs';
import { runSourceAnalysis } from './inspect-source.mjs';
import { saveHistoryEntry } from './history-manager.mjs';
import { enrichSymbolsWithSource } from './symbols.mjs';
import { projectInspectResult } from './output-projector.mjs';
import { throwIfAborted } from './errors.mjs';

function inferSourceLanguage(sourceAnalysis, fallback = 'unknown') {
  const paths = (sourceAnalysis?.files || [])
    .map((file) => file?.path || file?.file || '')
    .filter(Boolean);
  const hasTypeScript = paths.some((file) => /\.(?:ts|tsx|mts|cts)$/i.test(file));
  const hasJavaScript = paths.some((file) => /\.(?:js|jsx|mjs|cjs)$/i.test(file));
  if (hasTypeScript && hasJavaScript) return 'javascript+typescript';
  if (hasTypeScript) return 'typescript';
  if (hasJavaScript) return 'javascript';
  return fallback || 'unknown';
}

export async function runInspect(options) {
  const startedAt = performance.now();
  throwIfAborted(options?.signal, 'inspect');
  const format = options?.format || 'text';
  const shouldSaveHistory = Boolean(options?.saveHistory);
  let capturedResult = null;
  const rawOutput = await runInspectCore({
    ...options,
    ...(format !== 'json' && format !== 'object' && shouldSaveHistory
      ? { captureResult: (result) => (capturedResult = result) }
      : {}),
  });
  const coreCompletedAt = performance.now();

  // Text mode: pass through core output unchanged unless history needs a
  // structured payload to persist.
  if (format !== 'json' && format !== 'object' && !shouldSaveHistory) {
    return rawOutput;
  }

  // JSON/object modes already have structured data. Text + --save-history
  // receives the same inspection snapshot through the internal capture callback.
  let jsonOutput =
    format === 'json' || format === 'object'
      ? typeof rawOutput === 'string'
        ? JSON.parse(rawOutput)
        : rawOutput
      : capturedResult;

  if (options?.analyzeSource && jsonOutput?.pkgDir) {
    throwIfAborted(options?.signal, 'source-analysis');
    const sourceResult = await runSourceAnalysis({
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

    if (sourceResult.warnings?.length) {
      jsonOutput.warnings.push(...sourceResult.warnings);
    }

    jsonOutput.sourceAnalysis = sourceResult.sourceAnalysis;
    if (Array.isArray(jsonOutput.symbols) && sourceResult.sourceAnalysis) {
      jsonOutput.symbols = enrichSymbolsWithSource(jsonOutput.symbols, sourceResult.sourceAnalysis);
    }
    const runtimeLanguage = sourceResult.detectedLang || 'unknown';
    const sourceLanguage = inferSourceLanguage(
      sourceResult.sourceAnalysis || sourceResult.languageAnalysis,
      runtimeLanguage
    );
    const analysisSummary =
      sourceResult.languageAnalysis?.summary || sourceResult.sourceAnalysis?.summary || {};
    jsonOutput.languageAnalysis = {
      language: sourceLanguage,
      runtimeLanguage,
      sourceLanguage,
      files: Number(analysisSummary.totalFiles) || 0,
      summary: analysisSummary,
      ...(sourceResult.languageAnalysis?.error
        ? { error: sourceResult.languageAnalysis.error }
        : {}),
    };
  }

  if (options?.profile && jsonOutput) {
    jsonOutput.meta ??= {};
    jsonOutput.meta.timings = {
      inspectCoreMs: Number((coreCompletedAt - startedAt).toFixed(2)),
      totalMs: Number((performance.now() - startedAt).toFixed(2)),
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

  const focusedOutput = Boolean(
    options?.listSections ||
    options?.docsFor ||
    options?.examplesFor ||
    options?.jsdocOutput === 'only'
  );
  const projectedOutput =
    options?.detail || options?.select || options?.cursor || focusedOutput
      ? projectInspectResult(jsonOutput, {
          detail: options.detail,
          select: options.select,
          include: [
            ...(options.listSections ? ['sections'] : []),
            ...(options.includeDocs || options.docsFor || options.docsSections ? ['docs'] : []),
            ...(options.includeExamples || options.examplesFor ? ['examples'] : []),
            ...(options.jsdocOutput && options.jsdocOutput !== 'off' ? ['jsdoc'] : []),
            ...(options.analyzeSource ? ['sourceAnalysis', 'languageAnalysis'] : []),
          ],
          focused: focusedOutput,
          maxSymbols: options.maxSymbols || options.maxExports,
          cursor: options.cursor,
        })
      : jsonOutput;

  if (format === 'object') {
    return projectedOutput;
  }
  if (format !== 'json') {
    return rawOutput;
  }
  return JSON.stringify(projectedOutput, null, 2);
}
