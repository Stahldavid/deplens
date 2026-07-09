// parse-dts.mjs - TypeScript Compiler API based .d.ts parser
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

function getScriptKind(filePath) {
  if (typeof ts.getScriptKindFromFileName === 'function') {
    const kind = ts.getScriptKindFromFileName(filePath);
    return kind === ts.ScriptKind.Unknown ? ts.ScriptKind.TS : kind;
  }
  return ts.ScriptKind.TS;
}

function findPackageInfo(startPath) {
  let dir = path.dirname(startPath);
  while (true) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        return { dir, name: pkg.name || null };
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Find re-exported symbols and their source files
 * @param {string} dtsPath - Path to the .d.ts file
 * @param {string[]} filterList - List of symbol names to find
 * @returns {{named: Map<string, {sourcePath: string, localName: string}>, wildcards: string[]}}
 */
function findReExports(dtsPath, filterList) {
  const content = fs.readFileSync(dtsPath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    dtsPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(dtsPath)
  );

  const dtsDir = path.dirname(dtsPath);
  const packageInfo = findPackageInfo(dtsPath);
  const reExports = new Map();
  const wildcardSources = [];
  const filterSet = filterList ? new Set(filterList.map((n) => n.toLowerCase())) : null;

  function resolveDtsPath(moduleSpec) {
    let moduleBaseDir = dtsDir;
    let modulePath = moduleSpec;
    if (packageInfo?.name && moduleSpec === packageInfo.name) {
      moduleBaseDir = packageInfo.dir;
      modulePath = '';
    } else if (packageInfo?.name && moduleSpec.startsWith(`${packageInfo.name}/`)) {
      moduleBaseDir = packageInfo.dir;
      modulePath = moduleSpec.slice(packageInfo.name.length + 1);
    }

    // Handle .cjs/.mjs/.js -> .d.cts/.d.mts/.d.ts
    let sourceFile = modulePath
      .replace(/\.cjs$/, '.d.cts')
      .replace(/\.mjs$/, '.d.mts')
      .replace(/\.js$/, '.d.ts')
      .replace(/(?<!\.d)\.ts$/, '.d.ts');
    if (
      !sourceFile.endsWith('.d.ts') &&
      !sourceFile.endsWith('.d.cts') &&
      !sourceFile.endsWith('.d.mts')
    ) {
      // Try all extensions
      const dtsCandidate = path.resolve(moduleBaseDir, sourceFile + '.d.ts');
      const ctsCandidate = path.resolve(moduleBaseDir, sourceFile + '.d.cts');
      const mtsCandidate = path.resolve(moduleBaseDir, sourceFile + '.d.mts');
      if (fs.existsSync(dtsCandidate) && fs.statSync(dtsCandidate).isFile()) return dtsCandidate;
      if (fs.existsSync(ctsCandidate) && fs.statSync(ctsCandidate).isFile()) return ctsCandidate;
      if (fs.existsSync(mtsCandidate) && fs.statSync(mtsCandidate).isFile()) return mtsCandidate;
      return null;
    }
    const fullPath = path.resolve(moduleBaseDir, sourceFile);
    return fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? fullPath : null;
  }

  function visit(node) {
    // Handle: export { foo } from './foo.js'
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const moduleSpec = node.moduleSpecifier.text;

      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        // Named exports
        for (const elem of node.exportClause.elements) {
          const exportedName = elem.name.text;
          const localName = elem.propertyName?.text || exportedName;
          if (!filterSet || filterSet.has(exportedName.toLowerCase())) {
            const fullPath = resolveDtsPath(moduleSpec);
            if (fullPath) {
              reExports.set(exportedName, { sourcePath: fullPath, localName });
            }
          }
        }
      } else if (!node.exportClause) {
        // Wildcard: export * from './module'
        const fullPath = resolveDtsPath(moduleSpec);
        if (fullPath) {
          wildcardSources.push(fullPath);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // For wildcard exports, we return them all as potential sources
  return { named: reExports, wildcards: wildcardSources };
}

/**
 * Parse a .d.ts file and extract type information for specified symbols
 * @param {string} dtsPath - Path to the .d.ts file
 * @param {string[]} filterList - List of symbol names to extract (null = all)
 * @returns {object} Type information
 */
export function parseDtsFile(dtsPath, filterList, visited = new Set()) {
  if (!fs.existsSync(dtsPath)) {
    return null;
  }
  if (visited.has(dtsPath)) {
    return null;
  }
  visited.add(dtsPath);

  const content = fs.readFileSync(dtsPath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    dtsPath,
    content,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(dtsPath)
  );

  const typeInfo = {
    functions: {},
    interfaces: {},
    types: {},
    classes: {},
    enums: {},
    namespaces: {},
    defaults: [],
    jsdoc: {},
  };

  const filterSet = filterList ? new Set(filterList.map((n) => n.toLowerCase())) : null;

  function shouldInclude(name) {
    if (!filterSet) return true;
    return filterSet.has(name.toLowerCase());
  }

  function shouldIncludeExport(exportName, localName = null) {
    if (!filterSet) return true;
    return [exportName, localName]
      .filter(Boolean)
      .some((name) => filterSet.has(String(name).toLowerCase()));
  }

  function getNodeText(node) {
    return node.getText(sourceFile);
  }

  function formatType(typeNode, maxLen = Infinity) {
    if (!typeNode) return 'any';
    const text = getNodeText(typeNode).replace(/\s+/g, ' ').trim();
    return Number.isFinite(maxLen) && text.length > maxLen
      ? text.substring(0, maxLen) + '...'
      : text;
  }

  function formatParams(params) {
    if (!params || params.length === 0) return '';

    // For complex destructuring, simplify
    const paramStrs = params.map((p) => {
      const name = p.name ? getNodeText(p.name) : 'arg';

      // Handle destructuring pattern - just show "options"
      if (name.startsWith('{')) {
        return 'options: object';
      }

      const optional = p.questionToken ? '?' : '';
      const type = p.type ? formatType(p.type) : 'any';
      return `${name}${optional}: ${type}`;
    });
    return paramStrs.join(', ');
  }

  function jsDocText(comment) {
    if (!comment) return '';
    if (typeof comment === 'string') return comment.trim();
    if (Array.isArray(comment)) {
      return comment
        .map((part) => part.text || '')
        .join('')
        .trim();
    }
    return '';
  }

  function collectJSDocTags(tagNodes) {
    const tags = {};
    if (!tagNodes || tagNodes.length === 0) return tags;
    for (const tag of tagNodes) {
      if (!tag?.tagName?.text) continue;
      const tagName = tag.tagName.text;
      const comment = jsDocText(tag.comment);
      if (!tags[tagName]) tags[tagName] = [];
      tags[tagName].push(comment || '');
    }
    return tags;
  }

  function extractJSDoc(node) {
    const entries = ts.getJSDocCommentsAndTags(node);
    if (!entries || entries.length === 0) return null;
    let summary = '';
    const tags = {};
    for (const entry of entries) {
      if (ts.isJSDoc(entry)) {
        if (!summary) summary = jsDocText(entry.comment);
        const entryTags = collectJSDocTags(entry.tags);
        for (const [name, values] of Object.entries(entryTags)) {
          if (!tags[name]) tags[name] = [];
          tags[name].push(...values);
        }
      } else if (ts.isJSDocTag(entry)) {
        const tagName = entry.tagName?.text;
        if (tagName) {
          const comment = jsDocText(entry.comment);
          if (!tags[tagName]) tags[tagName] = [];
          tags[tagName].push(comment || '');
        }
      }
    }
    if (!summary && Object.keys(tags).length === 0) return null;
    return { summary, tags };
  }

  function attachJSDoc(name, node) {
    if (!name || !node) return;
    const doc = extractJSDoc(node);
    if (!doc) return;
    typeInfo.jsdoc[name] = doc;
  }

  function copySymbol(source, target, fromName, toName) {
    if (!source?.[fromName]) return;
    target[toName] = fromName === toName ? source[fromName] : source[fromName];
    if (fromName !== toName) delete target[fromName];
  }

  function mergeReExportedSymbol(subResult, localName, exportedName) {
    copySymbol(subResult.functions, typeInfo.functions, localName, exportedName);
    copySymbol(subResult.interfaces, typeInfo.interfaces, localName, exportedName);
    copySymbol(subResult.types, typeInfo.types, localName, exportedName);
    copySymbol(subResult.classes, typeInfo.classes, localName, exportedName);
    copySymbol(subResult.enums, typeInfo.enums, localName, exportedName);
    copySymbol(subResult.namespaces, typeInfo.namespaces, localName, exportedName);
    copySymbol(subResult.jsdoc, typeInfo.jsdoc, localName, exportedName);
    typeInfo.defaults.push(...subResult.defaults);
  }

  function visit(node) {
    // Function declarations
    if (ts.isFunctionDeclaration(node)) {
      const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const name = isDefault ? 'default' : node.name?.text || null;
      if (name && shouldIncludeExport(name, node.name?.text || null)) {
        const params = formatParams(node.parameters);
        const returnType = formatType(node.type);
        typeInfo.functions[name] = {
          params,
          returnType,
          ...(isDefault && node.name?.text ? { localName: node.name.text } : {}),
        };
        attachJSDoc(name, node);
      }
    }

    // Interface declarations
    if (ts.isInterfaceDeclaration(node)) {
      const name = node.name.text;
      const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const exportName = isDefault ? 'default' : name;
      if (shouldIncludeExport(exportName, name)) {
        const props = [];
        if (node.heritageClauses) {
          const extendsTypes = [];
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
              extendsTypes.push(...clause.types.map((type) => getNodeText(type)));
            }
          }
          if (extendsTypes.length > 0) props.push(`extends ${extendsTypes.join(', ')}`);
        }
        node.members.forEach((member) => {
          if (ts.isPropertySignature(member) && member.name) {
            const propName = getNodeText(member.name);
            const optional = member.questionToken ? '?' : '';
            const propType = formatType(member.type);
            props.push(`${propName}${optional}: ${propType}`);
          } else if (ts.isMethodSignature(member) && member.name) {
            const methodName = getNodeText(member.name);
            const optional = member.questionToken ? '?' : '';
            const params = formatParams(member.parameters);
            const returnType = formatType(member.type);
            props.push(`${methodName}${optional}(${params}): ${returnType}`);
          } else if (ts.isCallSignatureDeclaration(member)) {
            const params = formatParams(member.parameters);
            const returnType = formatType(member.type);
            props.push(`(${params}): ${returnType}`);
          } else if (ts.isIndexSignatureDeclaration(member)) {
            const params = formatParams(member.parameters);
            const returnType = formatType(member.type);
            props.push(`[${params}]: ${returnType}`);
          }
        });
        if (props.length > 0) {
          typeInfo.interfaces[exportName] = props;
          attachJSDoc(exportName, node);
        }
      }
    }

    // Type aliases
    if (ts.isTypeAliasDeclaration(node)) {
      const name = node.name.text;
      const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const exportName = isDefault ? 'default' : name;
      if (shouldInclude(exportName)) {
        typeInfo.types[exportName] = formatType(node.type);
        attachJSDoc(exportName, node);
      }
    }

    // Class declarations
    if (ts.isClassDeclaration(node)) {
      const isDefault = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      const name = isDefault ? 'default' : node.name?.text || null;
      if (name && shouldIncludeExport(name, node.name?.text || null)) {
        let extendsClause = null;
        if (node.heritageClauses) {
          for (const clause of node.heritageClauses) {
            if (clause.token === ts.SyntaxKind.ExtendsKeyword && clause.types.length > 0) {
              extendsClause = getNodeText(clause.types[0].expression);
            }
          }
        }
        typeInfo.classes[name] =
          isDefault && node.name?.text
            ? { extends: extendsClause, localName: node.name.text }
            : extendsClause;
        attachJSDoc(name, node);
      }
    }

    // Enum declarations
    if (ts.isEnumDeclaration(node)) {
      const name = node.name.text;
      if (shouldInclude(name)) {
        const members = node.members.map((member) => getNodeText(member.name));
        typeInfo.enums[name] = members;
        attachJSDoc(name, node);
      }
    }

    // Namespace/module declarations
    if (ts.isModuleDeclaration(node) && node.name) {
      const name = getNodeText(node.name);
      if (shouldInclude(name)) {
        typeInfo.namespaces[name] = true;
        attachJSDoc(name, node);
      }
    }

    // Variable statements (export const foo: Type)
    if (ts.isVariableStatement(node)) {
      const isExported = node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (isExported && node.declarationList.declarations) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const name = decl.name.text;
            if (shouldInclude(name) && decl.type) {
              // Check if it's a function type
              if (ts.isFunctionTypeNode(decl.type)) {
                const params = formatParams(decl.type.parameters);
                const returnType = formatType(decl.type.type);
                typeInfo.functions[name] = { params, returnType };
                attachJSDoc(name, node);
              }
            }
          }
        }
      }
    }

    // export = Foo or export default Foo
    if (ts.isExportAssignment(node)) {
      const assignment = getNodeText(node.expression);
      if (assignment) {
        typeInfo.defaults.push(assignment);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  // If we have a filter, try to follow re-exports for missing symbols
  if (filterList && filterList.length > 0) {
    const found = new Set([
      ...Object.keys(typeInfo.functions),
      ...Object.keys(typeInfo.interfaces),
      ...Object.keys(typeInfo.types),
      ...Object.keys(typeInfo.classes),
      ...Object.keys(typeInfo.enums),
      ...Object.keys(typeInfo.namespaces),
    ]);
    const missing = filterList.filter((name) => !found.has(name));

    if (missing.length > 0) {
      const { named, wildcards } = findReExports(dtsPath, missing);

      // Try named exports first
      for (const [symbolName, target] of named) {
        const sourcePath = typeof target === 'string' ? target : target.sourcePath;
        const localName = typeof target === 'string' ? symbolName : target.localName;
        const subResult = parseDtsFile(sourcePath, [localName], visited);
        if (subResult) {
          mergeReExportedSymbol(subResult, localName, symbolName);
        }
      }

      // If still missing, try wildcard sources
      if (wildcards.length > 0) {
        for (const wildcardPath of wildcards) {
          const subResult = parseDtsFile(wildcardPath, missing, visited);
          if (subResult) {
            Object.assign(typeInfo.functions, subResult.functions);
            Object.assign(typeInfo.interfaces, subResult.interfaces);
            Object.assign(typeInfo.types, subResult.types);
            Object.assign(typeInfo.classes, subResult.classes);
            Object.assign(typeInfo.enums, subResult.enums);
            Object.assign(typeInfo.namespaces, subResult.namespaces);
            Object.assign(typeInfo.jsdoc, subResult.jsdoc);
            typeInfo.defaults.push(...subResult.defaults);
          }
        }
      }
    }
  }

  return typeInfo;
}

const isMain =
  typeof import.meta.main === 'boolean'
    ? import.meta.main
    : Boolean(process.argv?.[1] && process.argv[1].endsWith('parse-dts.mjs'));

// CLI mode
if (isMain) {
  const dtsPath = process.argv[2];
  const filter = process.argv[3];

  if (!dtsPath) {
    console.error('Usage: node parse-dts.mjs <path-to-dts> [filter]');
    process.exit(1);
  }

  const filterList = filter ? filter.split(',') : null;
  const result = parseDtsFile(dtsPath, filterList);

  if (result) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error('Failed to parse:', dtsPath);
    process.exit(1);
  }
}
export { findReExports };
