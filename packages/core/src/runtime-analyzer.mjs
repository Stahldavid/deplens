import path from 'path';
import { pathToFileURL } from 'url';

export function normalizeCjsExports(exportsValue) {
  if (exportsValue === null || exportsValue === undefined) return { default: exportsValue };
  if (typeof exportsValue === 'object' || typeof exportsValue === 'function') {
    const namespace = Object.create(null);
    Object.defineProperties(namespace, Object.getOwnPropertyDescriptors(exportsValue));
    Object.defineProperty(namespace, 'default', {
      value: exportsValue,
      enumerable: true,
      configurable: true,
    });
    return namespace;
  }
  return { default: exportsValue };
}

export function detectModuleFormat(resolvedPath, pkg) {
  const extension = path.extname(resolvedPath);
  if (extension === '.cjs' || extension === '.cts') return 'cjs';
  if (extension === '.mjs' || extension === '.mts') return 'esm';
  return pkg?.type === 'module' ? 'esm' : 'cjs';
}

export function isProbablyClass(value) {
  if (typeof value !== 'function') return false;
  const source = Function.prototype.toString.call(value);
  if (source.startsWith('class ')) return true;
  const prototypeNames = value.prototype
    ? Object.getOwnPropertyNames(value.prototype).filter((name) => name !== 'constructor')
    : [];
  return prototypeNames.length > 0;
}

export async function loadModuleExports(resolvedPath, requireFunction, pkg) {
  const format = detectModuleFormat(resolvedPath, pkg);
  if (format === 'cjs') {
    return { module: normalizeCjsExports(requireFunction(resolvedPath)), format };
  }
  return { module: await import(pathToFileURL(resolvedPath).href), format };
}
