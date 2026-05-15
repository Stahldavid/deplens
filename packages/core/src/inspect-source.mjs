// inspect-source.mjs — Source code analysis (JS/TS + multi-language)
import { analyzePackageSource } from './parse-source.mjs';
import { analyzePythonPackage } from './analyze-python.mjs';
import { detectLanguage } from './language-detector.mjs';

/**
 * Execute source code analysis for a package directory.
 * @param {Object} args
 * @param {string} args.pkgDir
 * @param {string|null} args.filterRaw
 * @param {number} args.sourceMaxFiles
 * @param {boolean} args.sourceIncludeBody
 * @param {string|null} args.forcedLanguage
 * @param {(msg: string) => void} args.log
 * @returns {{ sourceAnalysis: any, detectedLang: string|null, languageAnalysis: any }}
 */
export function runSourceAnalysis({
  pkgDir,
  filterRaw,
  sourceMaxFiles,
  sourceIncludeBody,
  forcedLanguage,
  log,
}) {
  let sourceAnalysis = null;
  let detectedLang = null;
  let languageAnalysis = null;

  // Detectar linguagem (ou usar forçada)
  detectedLang = forcedLanguage || detectLanguage(pkgDir);
  log(`\n📝 Source/Language Analysis (${detectedLang || 'any'}):`);

  // JS/TS analysis
  try {
    sourceAnalysis = analyzePackageSource(pkgDir, {
      filter: filterRaw,
      maxFiles: sourceMaxFiles,
      includeBody: sourceIncludeBody,
      maxBodyLines: 10,
    });
    if (sourceAnalysis.error) {
      log(`   ⚠️  JS Analysis: ${sourceAnalysis.error}`);
    } else {
      log(
        `   JS/TS: ${sourceAnalysis.summary.totalFiles} files, ${sourceAnalysis.summary.totalFunctions} functions`
      );
    }
  } catch (jsErr) {
    log(`   ❌ JS Analysis error: ${jsErr.message}`);
  }

  // Additional language analysis
  if (detectedLang === 'python') {
    try {
      languageAnalysis = analyzePythonPackage(pkgDir, {
        filter: filterRaw,
        maxFiles: sourceMaxFiles,
        includeBody: sourceIncludeBody,
      });
      if (languageAnalysis.error) {
        log(`   ⚠️  Python Analysis: ${languageAnalysis.error}`);
      } else {
        log(
          `   Python: ${languageAnalysis.summary.totalFiles} files, ${languageAnalysis.summary.totalFunctions} functions, ${languageAnalysis.summary.totalClasses} classes`
        );
      }
    } catch (pyErr) {
      log(`   ❌ Python Analysis error: ${pyErr.message}`);
    }
  }
  // Future: add Rust, Go here

  return { sourceAnalysis, detectedLang, languageAnalysis };
}
