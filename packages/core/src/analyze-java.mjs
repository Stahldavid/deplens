import fs from 'fs';
import path from 'path';
import { getSourceFiles } from './language-detector.mjs';

const MODIFIERS = new Set([
  'public',
  'private',
  'protected',
  'abstract',
  'static',
  'final',
  'sealed',
  'non-sealed',
  'synchronized',
  'native',
  'default',
  'strictfp',
]);

const CONTROL_NAMES = new Set(['if', 'for', 'while', 'switch', 'catch', 'try', 'return', 'new']);

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function stripComments(content) {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, (match) => ' '.repeat(match.length))
    .replace(/\/\/[^\n\r]*/g, (match) => ' '.repeat(match.length));
}

function findMatchingBrace(content, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < content.length; index += 1) {
    const char = content[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

function bracesAreBalanced(content) {
  let depth = 0;
  for (const char of content) {
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function parseModifiers(prefix) {
  return unique((prefix.match(/\b(?:public|private|protected|abstract|static|final|sealed|non-sealed|synchronized|native|default|strictfp)\b/g) || []));
}

function parseAnnotations(prefix) {
  return unique((prefix.match(/@\w+(?:\([^)]*\))?/g) || []));
}

function parseDelimitedTypeList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getBodySnippet(body, includeBody, maxBodyLines = 10) {
  if (!includeBody || !body) return null;
  const bodyText = body.trim();
  if (!bodyText) return null;
  const lines = bodyText.split('\n');
  if (lines.length <= maxBodyLines) return bodyText;
  return `${lines.slice(0, maxBodyLines).join('\n')}\n... (${lines.length - maxBodyLines} more lines)`;
}

function calculateComplexity(body) {
  if (!body) return 1;
  const keywordMatches = body.match(/\b(if|while|for|switch|case|catch)\b/g) || [];
  const operatorMatches = body.match(/&&|\|\||\?/g) || [];
  return 1 + keywordMatches.length + operatorMatches.length;
}

function detectPatterns(body, annotations = []) {
  const patterns = new Set();
  if (annotations.length > 0) patterns.add('annotation');
  if (/\btry\b|\bcatch\b|\bthrow\b/.test(body)) patterns.add('error-handling');
  if (/\bfor\b|\bwhile\b|\bdo\b/.test(body)) patterns.add('loop');
  if (/\bswitch\b/.test(body)) patterns.add('switch');
  if (/\bnull\b/.test(body)) patterns.add('null-check');
  if (/->/.test(body)) patterns.add('lambda');
  if (/<[^>{}]+>/.test(body)) patterns.add('generics');
  return [...patterns];
}

function parseParams(raw) {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((param) => {
      const cleaned = param.trim();
      if (!cleaned) return null;
      const parts = cleaned.split(/\s+/);
      const name = parts.pop()?.replace(/\[\]$/, '') || '';
      const modifiers = parts.filter((part) => MODIFIERS.has(part) || part.startsWith('@'));
      const type = parts.filter((part) => !MODIFIERS.has(part) && !part.startsWith('@')).join(' ');
      return {
        name,
        type: type.replace(/\.\.\.$/, ''),
        modifiers,
        varArgs: type.endsWith('...'),
      };
    })
    .filter(Boolean);
}

function cleanReturnType(rawReturnType) {
  return rawReturnType
    .trim()
    .split(/\s+/)
    .filter((part) => !MODIFIERS.has(part) && !part.startsWith('@'))
    .join(' ');
}

function parseMemberFunctions(ownerName, ownerBody, ownerOffset, includeBody, maxBodyLines) {
  const functions = [];
  const memberRegex =
    /((?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|abstract|static|final|synchronized|native|default)\s+)*)([\w<>\[\],.?&\s]+?)?\s+(\w+)\s*\(([^()]*)\)\s*(?:throws\s+([^{;]+))?\s*([;{])/g;

  let match;
  while ((match = memberRegex.exec(ownerBody))) {
    const [, prefix = '', rawReturnType = '', name, rawParams = '', rawThrows = '', terminator] = match;
    if (CONTROL_NAMES.has(name)) continue;

    const isConstructor = name === ownerName;
    const returnType = isConstructor ? null : cleanReturnType(rawReturnType);
    if (!isConstructor && !returnType) continue;

    let body = null;
    let bodyEnd = match.index + match[0].length;
    if (terminator === '{') {
      const openIndex = ownerOffset + memberRegex.lastIndex - 1;
      const closeIndex = findMatchingBrace(ownerBody, memberRegex.lastIndex - 1);
      if (closeIndex === -1) continue;
      body = ownerBody.slice(memberRegex.lastIndex - 1, closeIndex + 1);
      bodyEnd = closeIndex + 1;
      memberRegex.lastIndex = bodyEnd;
    }

    const annotations = parseAnnotations(prefix);
    functions.push({
      name,
      owner: ownerName,
      qualifiedName: ownerName ? `${ownerName}.${name}` : name,
      kind: isConstructor ? 'constructor' : 'method',
      modifiers: parseModifiers(prefix),
      annotations,
      params: parseParams(rawParams),
      returnType,
      throws: parseDelimitedTypeList(rawThrows),
      complexity: calculateComplexity(body || ''),
      patterns: detectPatterns(body || '', annotations),
      body: getBodySnippet(body, includeBody, maxBodyLines),
      range: { start: ownerOffset + match.index, end: ownerOffset + bodyEnd },
    });
  }

  return functions;
}

function parseFields(ownerBody) {
  const fields = [];
  const fieldRegex =
    /((?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|final|volatile|transient)\s+)*)([\w<>\[\],.?&\s]+?)\s+([\w\s,=.'"()[\]{}+-]+);/g;
  let match;
  while ((match = fieldRegex.exec(ownerBody))) {
    const [, prefix = '', type = '', namesRaw = ''] = match;
    if (/\(|\)/.test(namesRaw)) continue;
    const names = namesRaw
      .split(',')
      .map((name) => name.split('=')[0].trim())
      .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    if (names.length === 0) continue;
    fields.push({
      names,
      type: type.trim(),
      modifiers: parseModifiers(prefix),
      annotations: parseAnnotations(prefix),
    });
  }
  return fields;
}

function findTypeDeclarations(content) {
  const declarations = [];
  const typeRegex =
    /((?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|abstract|static|final|sealed|non-sealed)\s+)*)(class|interface|enum)\s+(\w+)([^{]*)\{/g;
  let match;
  while ((match = typeRegex.exec(content))) {
    const openIndex = typeRegex.lastIndex - 1;
    const closeIndex = findMatchingBrace(content, openIndex);
    if (closeIndex === -1) continue;
    const start = match.index;
    if (declarations.some((decl) => start > decl.start && start < decl.end)) continue;
    declarations.push({
      prefix: match[1] || '',
      kind: match[2],
      name: match[3],
      suffix: match[4] || '',
      body: content.slice(openIndex + 1, closeIndex),
      bodyOffset: openIndex + 1,
      start,
      end: closeIndex + 1,
    });
    typeRegex.lastIndex = closeIndex + 1;
  }
  return declarations;
}

function parseClass(declaration, includeBody, maxBodyLines) {
  const methods = parseMemberFunctions(
    declaration.name,
    declaration.body,
    declaration.bodyOffset,
    includeBody,
    maxBodyLines
  );
  const constructors = methods.filter((fn) => fn.kind === 'constructor');
  const regularMethods = methods.filter((fn) => fn.kind !== 'constructor');

  return {
    name: declaration.name,
    modifiers: parseModifiers(declaration.prefix),
    annotations: parseAnnotations(declaration.prefix),
    extends: declaration.suffix.match(/\bextends\s+([\w.<>]+)/)?.[1] || null,
    implements: parseDelimitedTypeList(
      declaration.suffix.match(/\bimplements\s+(.+)$/)?.[1]?.trim() || ''
    ),
    fields: parseFields(declaration.body),
    constructors,
    methods: regularMethods,
  };
}

function parseInterface(declaration, includeBody, maxBodyLines) {
  return {
    name: declaration.name,
    modifiers: parseModifiers(declaration.prefix),
    annotations: parseAnnotations(declaration.prefix),
    extends: parseDelimitedTypeList(declaration.suffix.match(/\bextends\s+(.+)$/)?.[1] || ''),
    methods: parseMemberFunctions(
      declaration.name,
      declaration.body,
      declaration.bodyOffset,
      includeBody,
      maxBodyLines
    ).filter((fn) => fn.kind !== 'constructor'),
  };
}

function parseEnum(declaration, includeBody, maxBodyLines) {
  const beforeMembers = declaration.body.split(';')[0] || '';
  const constants = beforeMembers
    .split(',')
    .map((constant) => constant.trim().match(/^([A-Z_$][\w$]*)/)?.[1])
    .filter(Boolean);
  const methods = parseMemberFunctions(
    declaration.name,
    declaration.body,
    declaration.bodyOffset,
    includeBody,
    maxBodyLines
  );

  return {
    name: declaration.name,
    modifiers: parseModifiers(declaration.prefix),
    annotations: parseAnnotations(declaration.prefix),
    constants,
    fields: parseFields(declaration.body),
    constructors: methods.filter((fn) => fn.kind === 'constructor'),
    methods: methods.filter((fn) => fn.kind !== 'constructor'),
  };
}

function applyFilter(classes, interfaces, enums, filter) {
  if (!filter) {
    return [
      ...classes.flatMap((cls) => [...cls.constructors, ...cls.methods]),
      ...interfaces.flatMap((iface) => iface.methods),
      ...enums.flatMap((enm) => [...enm.constructors, ...enm.methods]),
    ];
  }

  const lowered = filter.toLowerCase();
  const keep = (fn) =>
    fn.name.toLowerCase().includes(lowered) || fn.qualifiedName.toLowerCase().includes(lowered);

  for (const collection of [classes, interfaces, enums]) {
    for (const entry of collection) {
      if (entry.methods) entry.methods = entry.methods.filter(keep);
      if (entry.constructors) entry.constructors = entry.constructors.filter(keep);
    }
  }

  return [
    ...classes.flatMap((cls) => [...cls.constructors, ...cls.methods]),
    ...interfaces.flatMap((iface) => iface.methods),
    ...enums.flatMap((enm) => [...enm.constructors, ...enm.methods]),
  ];
}

export function analyzeJavaFile(content, options = {}) {
  const { filter, includeBody = false, maxBodyLines = 10 } = options;
  const source = stripComments(content);

  if (!bracesAreBalanced(source) || /\(\s*\{/.test(source)) {
    return {
      packageName: null,
      imports: [],
      classes: [],
      interfaces: [],
      enums: [],
      functions: [],
      error: 'Unable to parse Java source',
    };
  }

  const packageName = source.match(/\bpackage\s+([\w.]+)\s*;/)?.[1] || null;
  const imports = [...source.matchAll(/^\s*import\s+(static\s+)?([\w.*]+)\s*;/gm)].map(
    (match) => ({
      path: match[2],
      static: Boolean(match[1]),
      wildcard: match[2].endsWith('.*'),
    })
  );

  const classes = [];
  const interfaces = [];
  const enums = [];

  for (const declaration of findTypeDeclarations(source)) {
    if (declaration.kind === 'class') classes.push(parseClass(declaration, includeBody, maxBodyLines));
    if (declaration.kind === 'interface') {
      interfaces.push(parseInterface(declaration, includeBody, maxBodyLines));
    }
    if (declaration.kind === 'enum') enums.push(parseEnum(declaration, includeBody, maxBodyLines));
  }

  const functions = applyFilter(classes, interfaces, enums, filter);

  return {
    packageName,
    imports,
    classes,
    interfaces,
    enums,
    functions,
  };
}

export function analyzeJavaPackage(pkgDir, options = {}) {
  const { filter, maxFiles = 10, includeBody = false, maxBodyLines = 10 } = options;
  const javaFiles = getSourceFiles(pkgDir, 'java', maxFiles);

  if (javaFiles.length === 0) {
    return { error: 'No Java files found', files: [] };
  }

  const results = {
    files: [],
    summary: {
      totalFiles: javaFiles.length,
      totalFunctions: 0,
      totalClasses: 0,
      totalInterfaces: 0,
      totalEnums: 0,
      avgComplexity: 0,
      highComplexityFunctions: [],
    },
  };

  let totalComplexity = 0;
  let functionCount = 0;

  for (const file of javaFiles) {
    const content = fs.readFileSync(file, 'utf-8');
    const analysis = analyzeJavaFile(content, { filter, includeBody, maxBodyLines });
    const fileEntry = {
      path: path.relative(pkgDir, file),
      packageName: analysis.packageName,
      imports: analysis.imports,
      classes: analysis.classes,
      interfaces: analysis.interfaces,
      enums: analysis.enums,
      functions: analysis.functions,
    };

    if (analysis.error) {
      fileEntry.error = analysis.error;
    }

    results.files.push(fileEntry);
    results.summary.totalClasses += analysis.classes.length;
    results.summary.totalInterfaces += analysis.interfaces.length;
    results.summary.totalEnums += analysis.enums.length;

    for (const fn of analysis.functions) {
      functionCount += 1;
      totalComplexity += fn.complexity;
      if (fn.complexity >= 10) {
        results.summary.highComplexityFunctions.push({
          name: fn.qualifiedName,
          file: path.relative(pkgDir, file),
          complexity: fn.complexity,
        });
      }
    }
  }

  results.summary.totalFunctions = functionCount;
  results.summary.avgComplexity =
    functionCount > 0 ? Math.round((totalComplexity / functionCount) * 10) / 10 : 0;
  results.summary.highComplexityFunctions.sort((a, b) => b.complexity - a.complexity);

  return results;
}

export default {
  analyzeJavaPackage,
  analyzeJavaFile,
};
