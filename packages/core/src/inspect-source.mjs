// inspect-source.mjs — Source code analysis (JS/TS + multi-language)
import { analyzePackageSource } from './parse-source.mjs';
import { analyzePythonPackageAsync } from './analyze-python.mjs';
import { analyzeJavaPackage } from './analyze-java.mjs';
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
export async function runSourceAnalysis({
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
  const warnings = [];

  // Detectar linguagem (ou usar forçada)
  detectedLang = forcedLanguage || detectLanguage(pkgDir);
  log(`\n📝 Source/Language Analysis (${detectedLang || 'any'}):`);

  // JS/TS analysis
  if (!detectedLang || detectedLang === 'javascript' || detectedLang === 'typescript') {
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
  }

  // Additional language analysis
  if (detectedLang === 'python') {
    try {
      languageAnalysis = await analyzePythonPackageAsync(pkgDir, {
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
  if (detectedLang === 'java') {
    try {
      languageAnalysis = analyzeJavaPackage(pkgDir, {
        filter: filterRaw,
        maxFiles: sourceMaxFiles,
        includeBody: sourceIncludeBody,
      });
      if (languageAnalysis.error) {
        log(`   ⚠️  Java Analysis: ${languageAnalysis.error}`);
      } else {
        log(
          `   Java: ${languageAnalysis.summary.totalFiles} files, ${languageAnalysis.summary.totalFunctions} methods/ctors, ${languageAnalysis.summary.totalClasses} classes`
        );
      }
    } catch (javaErr) {
      log(`   ❌ Java Analysis error: ${javaErr.message}`);
    }
  }
  if (detectedLang === 'rust' || detectedLang === 'go') {
    const message = `${detectedLang} source analysis is not implemented yet`;
    warnings.push(message);
    languageAnalysis = { error: message, files: [] };
    log(`   ⚠️  ${message}`);
  }

  return { sourceAnalysis, detectedLang, languageAnalysis, warnings };
}
