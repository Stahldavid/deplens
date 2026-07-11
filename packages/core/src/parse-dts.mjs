import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { appendSafeRecord, createSafeRecord, setSafeRecord } from './safe-record.mjs';

const TYPE_FORMAT_FLAGS =
  ts.TypeFormatFlags.NoTruncation |
  ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
  ts.TypeFormatFlags.WriteTypeArgumentsOfSignature;

function scriptKindFor(filePath) {
  const kind = ts.getScriptKindFromFileName?.(filePath) ?? ts.ScriptKind.TS;
  return kind === ts.ScriptKind.Unknown ? ts.ScriptKind.TS : kind;
}

function findPackageInfo(startPath) {
  let dir = path.dirname(path.resolve(startPath));
  while (true) {
    const packageJsonPath = path.join(dir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      try {
        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
        return { dir, name: packageJson.name || null };
      } catch {
        return { dir, name: null };
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return { dir: path.dirname(path.resolve(startPath)), name: null };
    dir = parent;
  }
}

function declarationCandidates(basePath) {
  const normalized = basePath
    .replace(/\.cjs$/i, '.d.cts')
    .replace(/\.mjs$/i, '.d.mts')
    .replace(/\.js$/i, '.d.ts')
    .replace(/(?<!\.d)\.ts$/i, '.d.ts');
  if (/\.d\.(?:ts|cts|mts)$/i.test(normalized)) return [normalized];
  return [
    `${normalized}.d.ts`,
    `${normalized}.d.cts`,
    `${normalized}.d.mts`,
    path.join(normalized, 'index.d.ts'),
    path.join(normalized, 'index.d.cts'),
    path.join(normalized, 'index.d.mts'),
  ];
}

function resolveDeclarationSpecifier(specifier, containingFile, packageInfo) {
  let basePath;
  if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(containingFile), specifier);
  } else if (packageInfo.name && specifier === packageInfo.name) {
    basePath = packageInfo.dir;
  } else if (packageInfo.name && specifier.startsWith(`${packageInfo.name}/`)) {
    basePath = path.resolve(packageInfo.dir, specifier.slice(packageInfo.name.length + 1));
  } else {
    return null;
  }
  return declarationCandidates(basePath).find((candidate) => fs.existsSync(candidate)) || null;
}

function createSemanticProgram(entryPath) {
  const packageInfo = findPackageInfo(entryPath);
  const options = {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    noLib: true,
    allowJs: false,
    types: [],
    resolveJsonModule: true,
  };
  const host = ts.createCompilerHost(options, true);
  const originalResolveModuleNames = host.resolveModuleNames?.bind(host);
  host.resolveModuleNames = (moduleNames, containingFile, ...rest) =>
    moduleNames.map((moduleName, index) => {
      const resolved = originalResolveModuleNames?.([moduleName], containingFile, ...rest)?.[0];
      if (resolved) return resolved;
      const standard = ts.resolveModuleName(
        moduleName,
        containingFile,
        options,
        host
      ).resolvedModule;
      if (standard) return standard;
      const fallback = resolveDeclarationSpecifier(moduleName, containingFile, packageInfo);
      if (!fallback) return undefined;
      return {
        resolvedFileName: fallback,
        extension: fallback.endsWith('.d.cts')
          ? ts.Extension.Dcts
          : fallback.endsWith('.d.mts')
            ? ts.Extension.Dmts
            : ts.Extension.Dts,
        isExternalLibraryImport: false,
      };
    });
  const program = ts.createProgram([path.resolve(entryPath)], options, host);
  return { program, checker: program.getTypeChecker(), packageInfo };
}

function moduleSymbols(sourceFile, checker) {
  const sourceSymbol = checker.getSymbolAtLocation(sourceFile);
  if (sourceSymbol && checker.getExportsOfModule(sourceSymbol).length > 0) return [sourceSymbol];
  const ambientSymbols = [];
  for (const statement of sourceFile.statements) {
    if (ts.isModuleDeclaration(statement)) {
      const symbol = checker.getSymbolAtLocation(statement.name);
      if (symbol) ambientSymbols.push(symbol);
    }
  }
  return ambientSymbols;
}

function nodeText(node, sourceFile) {
  return node?.getText(sourceFile).replace(/\s+/g, ' ').trim() || '';
}

function typeText(checker, type, location) {
  return checker.typeToString(type, location, TYPE_FORMAT_FLAGS);
}

function parameterFromDeclaration(parameter, sourceFile) {
  const name = nodeText(parameter.name, sourceFile) || 'arg';
  return {
    name,
    type: parameter.type ? nodeText(parameter.type, sourceFile) : 'any',
    optional: Boolean(parameter.questionToken || parameter.initializer),
    rest: Boolean(parameter.dotDotDotToken),
    default: parameter.initializer ? nodeText(parameter.initializer, sourceFile) : null,
  };
}

function formatParameter(parameter) {
  const prefix = parameter.rest ? '...' : '';
  const optional = parameter.optional && !parameter.default ? '?' : '';
  const defaultValue = parameter.default ? ` = ${parameter.default}` : '';
  return `${prefix}${parameter.name}${optional}: ${parameter.type}${defaultValue}`;
}

function signatureFromDeclaration(declaration, checker) {
  const sourceFile = declaration.getSourceFile();
  const parameters = (declaration.parameters || []).map((parameter) =>
    parameterFromDeclaration(parameter, sourceFile)
  );
  let returnType = declaration.type ? nodeText(declaration.type, sourceFile) : null;
  if (!returnType) {
    const signature = checker.getSignatureFromDeclaration(declaration);
    if (signature)
      returnType = typeText(checker, checker.getReturnTypeOfSignature(signature), declaration);
  }
  return {
    params: parameters.map(formatParameter).join(', '),
    parameters,
    returnType: returnType || 'any',
    typeParameters: (declaration.typeParameters || []).map((parameter) =>
      nodeText(parameter, sourceFile)
    ),
  };
}

function signaturesForSymbol(symbol, declarations, checker) {
  const signatures = [];
  for (const declaration of declarations) {
    if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isMethodSignature(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isCallSignatureDeclaration(declaration) ||
      ts.isConstructSignatureDeclaration(declaration) ||
      ts.isConstructorDeclaration(declaration)
    ) {
      signatures.push(signatureFromDeclaration(declaration, checker));
    } else if (ts.isVariableDeclaration(declaration) && declaration.type) {
      if (ts.isFunctionTypeNode(declaration.type)) {
        signatures.push(signatureFromDeclaration(declaration.type, checker));
      }
    }
  }
  if (signatures.length > 0) return signatures;

  const location = declarations[0] || symbol.valueDeclaration;
  if (!location) return [];
  const type = checker.getTypeOfSymbolAtLocation(symbol, location);
  return type.getCallSignatures().map((signature) => {
    const declaration = signature.getDeclaration();
    if (declaration) return signatureFromDeclaration(declaration, checker);
    const parameters = signature.getParameters().map((parameter) => {
      const parameterDeclaration =
        parameter.valueDeclaration || parameter.declarations?.[0] || location;
      const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
      return {
        name: parameter.getName(),
        type: typeText(checker, parameterType, parameterDeclaration),
        optional: Boolean(parameter.flags & ts.SymbolFlags.Optional),
        rest: false,
        default: null,
      };
    });
    return {
      params: parameters.map(formatParameter).join(', '),
      parameters,
      returnType: typeText(checker, checker.getReturnTypeOfSignature(signature), location),
      typeParameters: [],
    };
  });
}

function signatureFromTypeSignature(signature, checker, location) {
  const parameters = signature.getParameters().map((parameter) => {
    const parameterDeclaration =
      parameter.valueDeclaration || parameter.declarations?.[0] || location;
    const parameterType = checker.getTypeOfSymbolAtLocation(parameter, parameterDeclaration);
    return {
      name: parameter.getName(),
      type: typeText(checker, parameterType, parameterDeclaration),
      optional: Boolean(
        parameter.flags & ts.SymbolFlags.Optional || parameterDeclaration.questionToken
      ),
      rest: Boolean(parameterDeclaration.dotDotDotToken),
      default: null,
    };
  });
  return {
    params: parameters.map(formatParameter).join(', '),
    parameters,
    returnType: typeText(checker, checker.getReturnTypeOfSignature(signature), location),
    typeParameters: [],
  };
}

function addExportEquals(typeInfo, sourceFile, checker) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals !== true) continue;
    const expression = statement.expression;
    const exportName = ts.isIdentifier(expression) ? expression.text : 'default';
    const expressionSymbol = checker.getSymbolAtLocation(expression);
    const expressionType = checker.getTypeAtLocation(expression);
    setSafeRecord(typeInfo.variables, 'default', {
      type: typeText(checker, expressionType, expression),
      ...(exportName !== 'default' ? { localName: exportName } : {}),
    });

    for (const property of expressionType.getProperties()) {
      const propertyName = property.getName();
      if (!propertyName || propertyName === 'prototype') continue;
      const declaration = property.valueDeclaration || property.declarations?.[0] || expression;
      const propertyType = checker.getTypeOfSymbolAtLocation(property, declaration);
      const signatures = propertyType
        .getCallSignatures()
        .map((signature) => signatureFromTypeSignature(signature, checker, declaration));
      if (signatures.length > 0) {
        setSafeRecord(typeInfo.functions, propertyName, {
          ...signatures[0],
          overloads: signatures,
        });
      } else {
        setSafeRecord(typeInfo.variables, propertyName, {
          type: typeText(checker, propertyType, declaration),
        });
      }
    }

    const doc = expressionSymbol ? jsdocForSymbol(expressionSymbol, checker) : null;
    if (doc) setSafeRecord(typeInfo.jsdoc, 'default', doc);
  }
}

function publicMember(member) {
  return !member.modifiers?.some(
    (modifier) =>
      modifier.kind === ts.SyntaxKind.PrivateKeyword ||
      modifier.kind === ts.SyntaxKind.ProtectedKeyword
  );
}

function classDetails(declarations, checker, localName = null) {
  const details = {
    extends: null,
    localName,
    constructors: [],
    methods: createSafeRecord(),
    properties: createSafeRecord(),
    typeParameters: [],
  };
  for (const declaration of declarations.filter(ts.isClassDeclaration)) {
    const sourceFile = declaration.getSourceFile();
    details.typeParameters.push(
      ...(declaration.typeParameters || []).map((parameter) => nodeText(parameter, sourceFile))
    );
    const extendsClause = declaration.heritageClauses?.find(
      (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword
    );
    if (extendsClause?.types[0]) details.extends = nodeText(extendsClause.types[0], sourceFile);
    for (const member of declaration.members) {
      if (!publicMember(member)) continue;
      if (ts.isConstructorDeclaration(member)) {
        details.constructors.push(signatureFromDeclaration(member, checker));
      } else if (ts.isMethodDeclaration(member) && member.name) {
        const name = nodeText(member.name, sourceFile);
        appendSafeRecord(details.methods, name, signatureFromDeclaration(member, checker));
      } else if (ts.isPropertyDeclaration(member) && member.name) {
        const name = nodeText(member.name, sourceFile);
        setSafeRecord(details.properties, name, {
          type: member.type ? nodeText(member.type, sourceFile) : 'any',
          optional: Boolean(member.questionToken),
          readonly: Boolean(
            member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
          ),
          static: Boolean(
            member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
          ),
        });
      }
    }
  }
  return details;
}

function interfaceDetails(declarations, checker) {
  const details = {
    extends: [],
    properties: createSafeRecord(),
    methods: createSafeRecord(),
    callSignatures: [],
    typeParameters: [],
  };
  const legacyMembers = [];
  for (const declaration of declarations.filter(ts.isInterfaceDeclaration)) {
    const sourceFile = declaration.getSourceFile();
    details.typeParameters.push(
      ...(declaration.typeParameters || []).map((parameter) => nodeText(parameter, sourceFile))
    );
    for (const clause of declaration.heritageClauses || []) {
      if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
        for (const type of clause.types) details.extends.push(nodeText(type, sourceFile));
      }
    }
    for (const member of declaration.members) {
      if (ts.isPropertySignature(member) && member.name) {
        const name = nodeText(member.name, sourceFile);
        const property = {
          type: member.type ? nodeText(member.type, sourceFile) : 'any',
          optional: Boolean(member.questionToken),
          readonly: Boolean(
            member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword)
          ),
        };
        setSafeRecord(details.properties, name, property);
        legacyMembers.push(`${name}${property.optional ? '?' : ''}: ${property.type}`);
      } else if (ts.isMethodSignature(member) && member.name) {
        const name = nodeText(member.name, sourceFile);
        const signature = signatureFromDeclaration(member, checker);
        appendSafeRecord(details.methods, name, signature);
        legacyMembers.push(
          `${name}${member.questionToken ? '?' : ''}(${signature.params}): ${signature.returnType}`
        );
      } else if (ts.isCallSignatureDeclaration(member)) {
        const signature = signatureFromDeclaration(member, checker);
        details.callSignatures.push(signature);
        legacyMembers.push(`(${signature.params}): ${signature.returnType}`);
      } else if (ts.isIndexSignatureDeclaration(member)) {
        const signature = signatureFromDeclaration(member, checker);
        legacyMembers.push(`[${signature.params}]: ${signature.returnType}`);
      }
    }
  }
  if (details.extends.length > 0) legacyMembers.unshift(`extends ${details.extends.join(', ')}`);
  return { details, legacyMembers };
}

function jsdocForSymbol(symbol, checker) {
  const summary = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
  const tags = createSafeRecord();
  for (const tag of symbol.getJsDocTags(checker)) {
    appendSafeRecord(tags, tag.name, ts.displayPartsToString(tag.text || []).trim());
  }
  return summary || Object.keys(tags).length > 0 ? { summary, tags } : null;
}

function emptyTypeInfo() {
  return {
    functions: createSafeRecord(),
    interfaces: createSafeRecord(),
    interfaceDetails: createSafeRecord(),
    types: createSafeRecord(),
    classes: createSafeRecord(),
    enums: createSafeRecord(),
    enumDetails: createSafeRecord(),
    namespaces: createSafeRecord(),
    variables: createSafeRecord(),
    defaults: [],
    jsdoc: createSafeRecord(),
  };
}

function exportDeclarations(exportSymbol, checker) {
  const target =
    exportSymbol.flags & ts.SymbolFlags.Alias
      ? checker.getAliasedSymbol(exportSymbol)
      : exportSymbol;
  return { target, declarations: target.declarations || exportSymbol.declarations || [] };
}

function hasExportModifier(node) {
  let current = node;
  while (current && !ts.isSourceFile(current) && !ts.isModuleBlock(current)) {
    if (
      current.modifiers?.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.ExportKeyword ||
          modifier.kind === ts.SyntaxKind.DefaultKeyword
      )
    ) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function isPublicExport(exportSymbol, target, declarations) {
  if (exportSymbol.getName() === 'default') return true;
  if (
    exportSymbol.declarations?.some(
      (declaration) => ts.isExportSpecifier(declaration) || ts.isNamespaceExport(declaration)
    )
  ) {
    return true;
  }
  if (declarations.some(hasExportModifier)) return true;
  return declarations.some((declaration) => {
    const moduleDeclaration = declaration.parent?.parent;
    return (
      Boolean(moduleDeclaration) &&
      ts.isModuleDeclaration(moduleDeclaration) &&
      (ts.isStringLiteral(moduleDeclaration.name) || moduleDeclaration.flags & ts.NodeFlags.Ambient)
    );
  });
}

function addExport(typeInfo, exportSymbol, checker) {
  const exportName = exportSymbol.getName();
  const { target, declarations } = exportDeclarations(exportSymbol, checker);
  if (declarations.length === 0) return;
  if (!isPublicExport(exportSymbol, target, declarations)) return;
  const declarationName = declarations.find((declaration) => declaration.name)?.name;
  const localName = declarationName
    ? nodeText(declarationName, declarationName.getSourceFile())
    : null;
  const doc = jsdocForSymbol(target, checker) || jsdocForSymbol(exportSymbol, checker);
  if (doc) setSafeRecord(typeInfo.jsdoc, exportName, doc);

  const signatures = signaturesForSymbol(target, declarations, checker);
  if (signatures.length > 0) {
    setSafeRecord(typeInfo.functions, exportName, {
      ...signatures[0],
      overloads: signatures,
      ...(exportName === 'default' && localName ? { localName } : {}),
    });
    return;
  }

  if (declarations.some(ts.isClassDeclaration)) {
    setSafeRecord(
      typeInfo.classes,
      exportName,
      classDetails(declarations, checker, exportName === 'default' ? localName : null)
    );
    return;
  }
  if (declarations.some(ts.isInterfaceDeclaration)) {
    const { details, legacyMembers } = interfaceDetails(declarations, checker);
    setSafeRecord(typeInfo.interfaces, exportName, legacyMembers);
    setSafeRecord(typeInfo.interfaceDetails, exportName, details);
    return;
  }
  const typeAlias = declarations.find(ts.isTypeAliasDeclaration);
  if (typeAlias) {
    setSafeRecord(typeInfo.types, exportName, nodeText(typeAlias.type, typeAlias.getSourceFile()));
    return;
  }
  const enumDeclaration = declarations.find(ts.isEnumDeclaration);
  if (enumDeclaration) {
    setSafeRecord(
      typeInfo.enums,
      exportName,
      enumDeclaration.members.map((member) =>
        nodeText(member.name, enumDeclaration.getSourceFile())
      )
    );
    setSafeRecord(
      typeInfo.enumDetails,
      exportName,
      Object.fromEntries(
        enumDeclaration.members.map((member) => [
          nodeText(member.name, enumDeclaration.getSourceFile()),
          member.initializer ? nodeText(member.initializer, enumDeclaration.getSourceFile()) : null,
        ])
      )
    );
    return;
  }
  if (declarations.some(ts.isModuleDeclaration)) {
    setSafeRecord(typeInfo.namespaces, exportName, true);
    return;
  }

  const location = declarations[0];
  const type = checker.getTypeOfSymbolAtLocation(target, location);
  setSafeRecord(typeInfo.variables, exportName, { type: typeText(checker, type, location) });
}

function applyFilter(typeInfo, filterList) {
  if (!filterList?.length) return typeInfo;
  const filters = new Set(filterList.map((name) => String(name).toLowerCase()));
  const matches = (name, value) =>
    filters.has(name.toLowerCase()) ||
    (value?.localName && filters.has(String(value.localName).toLowerCase()));
  for (const bucket of [
    'functions',
    'interfaces',
    'interfaceDetails',
    'types',
    'classes',
    'enums',
    'enumDetails',
    'namespaces',
    'variables',
    'jsdoc',
  ]) {
    typeInfo[bucket] = Object.fromEntries(
      Object.entries(typeInfo[bucket]).filter(([name, value]) => matches(name, value))
    );
  }
  return typeInfo;
}

function addSyntacticDefaults(typeInfo, sourceFile, checker, filterList) {
  const filters = filterList?.length
    ? new Set(filterList.map((name) => String(name).toLowerCase()))
    : null;
  const visit = (node) => {
    const isDefault = node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword
    );
    if (isDefault && (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))) {
      const localName = node.name?.text || null;
      if (
        !filters ||
        filters.has('default') ||
        (localName && filters.has(localName.toLowerCase()))
      ) {
        if (ts.isFunctionDeclaration(node)) {
          const signature = signatureFromDeclaration(node, checker);
          typeInfo.functions.default = {
            ...signature,
            overloads: [signature],
            ...(localName ? { localName } : {}),
          };
        } else {
          typeInfo.classes.default = classDetails([node], checker, localName);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

export function parseDtsFileWithMetadata(dtsPath, filterList = null) {
  if (!dtsPath || !fs.existsSync(dtsPath)) return null;
  const entryPath = path.resolve(dtsPath);
  const { program, checker } = createSemanticProgram(entryPath);
  const sourceFile = program.getSourceFile(entryPath);
  if (!sourceFile) return null;

  const typeInfo = emptyTypeInfo();
  const seen = new Set();
  for (const moduleSymbol of moduleSymbols(sourceFile, checker)) {
    for (const exportSymbol of checker.getExportsOfModule(moduleSymbol)) {
      const name = exportSymbol.getName();
      if (seen.has(name)) continue;
      seen.add(name);
      addExport(typeInfo, exportSymbol, checker);
    }
  }
  addSyntacticDefaults(typeInfo, sourceFile, checker, filterList);
  addExportEquals(typeInfo, sourceFile, checker);

  const dependencies = program
    .getSourceFiles()
    .filter(
      (file) =>
        !program.isSourceFileDefaultLibrary(file) &&
        fs.existsSync(file.fileName) &&
        /\.d\.(?:ts|cts|mts)$/i.test(file.fileName)
    )
    .map((file) => path.resolve(file.fileName));

  return { result: applyFilter(typeInfo, filterList), dependencies };
}

export function parseDtsFile(dtsPath, filterList = null) {
  return parseDtsFileWithMetadata(dtsPath, filterList)?.result || null;
}

export function findReExports(dtsPath, filterList = null) {
  if (!fs.existsSync(dtsPath)) return { named: new Map(), wildcards: [] };
  const packageInfo = findPackageInfo(dtsPath);
  const sourceFile = ts.createSourceFile(
    dtsPath,
    fs.readFileSync(dtsPath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(dtsPath)
  );
  const filters = filterList?.length
    ? new Set(filterList.map((name) => String(name).toLowerCase()))
    : null;
  const named = new Map();
  const wildcards = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    const sourcePath = resolveDeclarationSpecifier(
      statement.moduleSpecifier.text,
      dtsPath,
      packageInfo
    );
    if (!sourcePath) continue;
    if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        const exportedName = element.name.text;
        if (filters && !filters.has(exportedName.toLowerCase())) continue;
        named.set(exportedName, {
          sourcePath,
          localName: element.propertyName?.text || exportedName,
        });
      }
    } else if (!statement.exportClause) {
      wildcards.push(sourcePath);
    }
  }
  return { named, wildcards };
}

const isMain =
  typeof import.meta.main === 'boolean'
    ? import.meta.main
    : Boolean(
        process.argv[1] &&
        path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)
      );

if (isMain) {
  const dtsPath = process.argv[2];
  if (!dtsPath) {
    console.error('Usage: node parse-dts.mjs <path-to-dts> [filter]');
    process.exitCode = 1;
  } else {
    const result = parseDtsFile(dtsPath, process.argv[3]?.split(',') || null);
    if (result) console.log(JSON.stringify(result, null, 2));
    else process.exitCode = 1;
  }
}
