import fs from 'fs';
import path from 'path';
import { parse } from 'java-parser';
import { getSourceFiles } from './language-detector.mjs';

const COMPLEXITY_NODE_NAMES = new Set([
  'ifStatement',
  'whileStatement',
  'doStatement',
  'forStatement',
  'basicForStatement',
  'enhancedForStatement',
  'switchStatement',
  'switchRule',
  'catchClause',
  'conditionalExpression',
]);

const COMPLEXITY_TOKEN_NAMES = new Set(['AndAnd', 'OrOr', 'QuestionMark']);

function firstChild(node, key) {
  return node?.children?.[key]?.[0] || null;
}

function childList(node, key) {
  return node?.children?.[key] || [];
}

function isToken(value) {
  return Boolean(value && typeof value.image === 'string' && value.tokenType);
}

function visitNode(node, visitor) {
  if (!node) return;
  visitor(node);
  const children = node.children || {};
  for (const values of Object.values(children)) {
    for (const value of values) {
      if (isToken(value)) {
        visitor(value);
      } else {
        visitNode(value, visitor);
      }
    }
  }
}

function nodeText(node, content) {
  if (!node?.location) return '';
  return content.slice(node.location.startOffset, node.location.endOffset + 1);
}

function collectTokens(node, predicate = null) {
  const tokens = [];
  visitNode(node, (value) => {
    if (isToken(value) && (!predicate || predicate(value))) {
      tokens.push(value);
    }
  });
  return tokens;
}

function collectIdentifiers(node) {
  return collectTokens(node, (token) => token.tokenType?.name === 'Identifier').map(
    (token) => token.image
  );
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseDelimitedTypeList(raw) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function extractModifiers(modifierNodes, content) {
  return unique(
    modifierNodes.map((node) => {
      const text = nodeText(node, content).trim();
      return text || collectTokens(node).map((token) => token.image).join(' ');
    })
  );
}

function extractAnnotations(modifierNodes, content) {
  return unique(
    modifierNodes
      .filter((node) => node.children?.annotation)
      .map((node) => nodeText(firstChild(node, 'annotation'), content).trim())
  );
}

function extractVariableDeclaratorNames(variableDeclaratorListNode) {
  return childList(variableDeclaratorListNode, 'variableDeclarator')
    .map((declarator) => {
      const idNode = firstChild(declarator, 'variableDeclaratorId');
      const identifiers = collectIdentifiers(idNode);
      return identifiers[identifiers.length - 1] || null;
    })
    .filter(Boolean);
}

function getBodySnippet(node, content, includeBody, maxBodyLines = 10) {
  if (!includeBody || !node) return null;
  const bodyText = nodeText(node, content).trim();
  if (!bodyText) return null;
  const lines = bodyText.split('\n');
  if (lines.length <= maxBodyLines) {
    return bodyText;
  }
  return `${lines.slice(0, maxBodyLines).join('\n')}\n... (${lines.length - maxBodyLines} more lines)`;
}

function calculateComplexity(node) {
  let complexity = 1;
  visitNode(node, (value) => {
    if (isToken(value)) {
      if (COMPLEXITY_TOKEN_NAMES.has(value.tokenType?.name)) {
        complexity += 1;
      }
      return;
    }
    if (COMPLEXITY_NODE_NAMES.has(value.name)) {
      complexity += 1;
    }
  });
  return complexity;
}

function detectPatterns(node) {
  const patterns = new Set();
  visitNode(node, (value) => {
    if (isToken(value)) {
      if (value.image === 'null') patterns.add('null-check');
      return;
    }
    switch (value.name) {
      case 'tryStatement':
      case 'catchClause':
      case 'throwStatement':
        patterns.add('error-handling');
        break;
      case 'annotation':
        patterns.add('annotation');
        break;
      case 'lambdaExpression':
        patterns.add('lambda');
        break;
      case 'switchStatement':
      case 'switchRule':
        patterns.add('switch');
        break;
      case 'whileStatement':
      case 'doStatement':
      case 'forStatement':
      case 'basicForStatement':
      case 'enhancedForStatement':
        patterns.add('loop');
        break;
      case 'typeArguments':
        patterns.add('generics');
        break;
    }
  });
  return [...patterns];
}

function extractPackageName(packageDeclarationNode) {
  const identifiers = collectIdentifiers(packageDeclarationNode);
  return identifiers.join('.');
}

function extractImport(importDeclarationNode, content) {
  let raw = nodeText(importDeclarationNode, content).trim();
  if (raw.startsWith('import ')) raw = raw.slice('import '.length).trim();
  if (raw.endsWith(';')) raw = raw.slice(0, -1).trim();

  const isStatic = raw.startsWith('static ');
  if (isStatic) raw = raw.slice('static '.length).trim();

  const isWildcard = raw.endsWith('.*');
  return {
    path: raw,
    static: isStatic,
    wildcard: isWildcard,
  };
}

function extractField(fieldDeclarationNode, content) {
  const modifiers = extractModifiers(childList(fieldDeclarationNode, 'fieldModifier'), content);
  const annotations = extractAnnotations(childList(fieldDeclarationNode, 'fieldModifier'), content);
  const typeNode = firstChild(fieldDeclarationNode, 'unannType');
  const declaratorList = firstChild(fieldDeclarationNode, 'variableDeclaratorList');
  return {
    names: extractVariableDeclaratorNames(declaratorList),
    type: nodeText(typeNode, content).trim(),
    modifiers,
    annotations,
  };
}

function extractMethodParameters(formalParameterListNode, content) {
  return childList(formalParameterListNode, 'formalParameter')
    .map((parameter) => {
      const regular = firstChild(parameter, 'variableParaRegularParameter');
      const varArg = firstChild(parameter, 'variableArityParameter');
      const target = regular || varArg;
      if (!target) return null;
      const typeNode = firstChild(target, 'unannType');
      const variableId = firstChild(target, 'variableDeclaratorId');
      const nameParts = collectIdentifiers(variableId);
      const modifiers = extractModifiers(childList(target, 'variableModifier'), content);
      return {
        name: nameParts[nameParts.length - 1] || nodeText(variableId, content).trim(),
        type: typeNode ? nodeText(typeNode, content).trim() : '',
        modifiers,
        varArgs: Boolean(varArg),
      };
    })
    .filter(Boolean);
}

function extractThrows(throwsNode, content) {
  const raw = nodeText(throwsNode, content).trim();
  if (!raw) return [];
  const normalized = raw.startsWith('throws ') ? raw.slice('throws '.length).trim() : raw;
  return parseDelimitedTypeList(normalized);
}

function extractMethodFromHeader({
  ownerName,
  methodNode,
  content,
  modifierKey,
  includeBody,
  maxBodyLines,
  kind = 'method',
}) {
  const modifierNodes = childList(methodNode, modifierKey);
  const header = firstChild(methodNode, 'methodHeader');
  const declarator = firstChild(header, 'methodDeclarator');
  const parametersNode = firstChild(declarator, 'formalParameterList');
  const bodyNode = firstChild(firstChild(methodNode, 'methodBody'), 'block');
  const throwsNode = firstChild(header, 'throws');
  const resultNode = firstChild(firstChild(header, 'result'), 'unannType') || firstChild(header, 'result');
  const name = childList(declarator, 'Identifier')[0]?.image || 'anonymous';

  return {
    name,
    owner: ownerName,
    qualifiedName: ownerName ? `${ownerName}.${name}` : name,
    kind,
    modifiers: extractModifiers(modifierNodes, content),
    annotations: extractAnnotations(modifierNodes, content),
    params: extractMethodParameters(parametersNode, content),
    returnType: kind === 'constructor' ? null : nodeText(resultNode, content).trim(),
    throws: extractThrows(throwsNode, content),
    complexity: bodyNode ? calculateComplexity(bodyNode) : 1,
    patterns: bodyNode ? detectPatterns(bodyNode) : [],
    body: getBodySnippet(bodyNode, content, includeBody, maxBodyLines),
  };
}

function extractConstructor(ownerName, constructorNode, content, includeBody, maxBodyLines) {
  const modifierNodes = childList(constructorNode, 'constructorModifier');
  const declarator = firstChild(constructorNode, 'constructorDeclarator');
  const parametersNode = firstChild(declarator, 'formalParameterList');
  const bodyNode = firstChild(constructorNode, 'constructorBody');
  return {
    name: ownerName,
    owner: ownerName,
    qualifiedName: ownerName ? `${ownerName}.${ownerName}` : ownerName,
    kind: 'constructor',
    modifiers: extractModifiers(modifierNodes, content),
    annotations: extractAnnotations(modifierNodes, content),
    params: extractMethodParameters(parametersNode, content),
    returnType: null,
    throws: [],
    complexity: bodyNode ? calculateComplexity(bodyNode) : 1,
    patterns: bodyNode ? detectPatterns(bodyNode) : [],
    body: getBodySnippet(bodyNode, content, includeBody, maxBodyLines),
  };
}

function extractClassBodyMembers(bodyDeclarationNodes, ownerName, content, includeBody, maxBodyLines) {
  const fields = [];
  const methods = [];
  const constructors = [];

  for (const declaration of bodyDeclarationNodes) {
    const member = firstChild(declaration, 'classMemberDeclaration');
    const constructor = firstChild(declaration, 'constructorDeclaration');

    if (constructor) {
      constructors.push(
        extractConstructor(ownerName, constructor, content, includeBody, maxBodyLines)
      );
      continue;
    }

    if (!member) continue;
    const field = firstChild(member, 'fieldDeclaration');
    const method = firstChild(member, 'methodDeclaration');

    if (field) {
      fields.push(extractField(field, content));
    } else if (method) {
      methods.push(
        extractMethodFromHeader({
          ownerName,
          methodNode: method,
          content,
          modifierKey: 'methodModifier',
          includeBody,
          maxBodyLines,
        })
      );
    }
  }

  return { fields, methods, constructors };
}

function extractClass(normalClassDeclarationNode, classModifierNodes, content, includeBody, maxBodyLines) {
  const name = collectIdentifiers(firstChild(normalClassDeclarationNode, 'typeIdentifier'))[0] || 'AnonymousClass';
  const extendsNode = firstChild(normalClassDeclarationNode, 'classExtends');
  const implementsNode = firstChild(normalClassDeclarationNode, 'classImplements');
  const body = firstChild(normalClassDeclarationNode, 'classBody');
  const members = extractClassBodyMembers(
    childList(body, 'classBodyDeclaration'),
    name,
    content,
    includeBody,
    maxBodyLines
  );

  return {
    name,
    modifiers: extractModifiers(classModifierNodes, content),
    annotations: extractAnnotations(classModifierNodes, content),
    extends: extendsNode ? nodeText(extendsNode, content).replace(/^extends\s+/, '').trim() : null,
    implements: implementsNode
      ? parseDelimitedTypeList(nodeText(implementsNode, content).replace(/^implements\s+/, '').trim())
      : [],
    fields: members.fields,
    constructors: members.constructors,
    methods: members.methods,
  };
}

function extractInterface(interfaceNode, content, includeBody, maxBodyLines) {
  const normalInterfaceDeclaration = firstChild(interfaceNode, 'normalInterfaceDeclaration');
  const name =
    collectIdentifiers(firstChild(normalInterfaceDeclaration, 'typeIdentifier'))[0] || 'AnonymousInterface';
  const body = firstChild(normalInterfaceDeclaration, 'interfaceBody');
  const methods = childList(body, 'interfaceMemberDeclaration')
    .map((member) => firstChild(member, 'interfaceMethodDeclaration'))
    .filter(Boolean)
    .map((method) =>
      extractMethodFromHeader({
        ownerName: name,
        methodNode: method,
        content,
        modifierKey: 'interfaceMethodModifier',
        includeBody,
        maxBodyLines,
      })
    );

  return {
    name,
    modifiers: [],
    annotations: [],
    extends: firstChild(normalInterfaceDeclaration, 'interfaceExtends')
      ? parseDelimitedTypeList(
          nodeText(firstChild(normalInterfaceDeclaration, 'interfaceExtends'), content)
            .replace(/^extends\s+/, '')
            .trim()
        )
      : [],
    methods,
  };
}

function extractEnum(enumDeclarationNode, content, includeBody, maxBodyLines) {
  const name = collectIdentifiers(firstChild(enumDeclarationNode, 'typeIdentifier'))[0] || 'AnonymousEnum';
  const body = firstChild(enumDeclarationNode, 'enumBody');
  const constants = childList(firstChild(body, 'enumConstantList'), 'enumConstant')
    .map((constant) => collectIdentifiers(constant)[0] || null)
    .filter(Boolean);
  const bodyDeclarations = childList(firstChild(body, 'enumBodyDeclarations'), 'classBodyDeclaration');
  const members = extractClassBodyMembers(bodyDeclarations, name, content, includeBody, maxBodyLines);

  return {
    name,
    modifiers: [],
    annotations: [],
    constants,
    fields: members.fields,
    constructors: members.constructors,
    methods: members.methods,
  };
}

export function analyzeJavaFile(content, options = {}) {
  const { filter, includeBody = false, maxBodyLines = 10 } = options;

  try {
    const cst = parse(content);
    const root = firstChild(cst, 'ordinaryCompilationUnit') || firstChild(cst, 'modularCompilationUnit');
    if (!root) {
      return {
        packageName: null,
        imports: [],
        classes: [],
        interfaces: [],
        enums: [],
        functions: [],
      };
    }

    const packageDeclaration = firstChild(root, 'packageDeclaration');
    const packageName = packageDeclaration ? extractPackageName(packageDeclaration) : null;
    const imports = childList(root, 'importDeclaration').map((imp) => extractImport(imp, content));

    const classes = [];
    const interfaces = [];
    const enums = [];

    for (const typeDeclaration of childList(root, 'typeDeclaration')) {
      const classDeclaration = firstChild(typeDeclaration, 'classDeclaration');
      const interfaceDeclaration = firstChild(typeDeclaration, 'interfaceDeclaration');
      if (classDeclaration) {
        const normalClass = firstChild(classDeclaration, 'normalClassDeclaration');
        const enumDeclaration = firstChild(classDeclaration, 'enumDeclaration');
        if (normalClass) {
          classes.push(
            extractClass(
              normalClass,
              childList(classDeclaration, 'classModifier'),
              content,
              includeBody,
              maxBodyLines
            )
          );
        } else if (enumDeclaration) {
          enums.push(extractEnum(enumDeclaration, content, includeBody, maxBodyLines));
        }
      } else if (interfaceDeclaration) {
        interfaces.push(extractInterface(interfaceDeclaration, content, includeBody, maxBodyLines));
      }
    }

    let functions = [
      ...classes.flatMap((cls) => [...cls.constructors, ...cls.methods]),
      ...interfaces.flatMap((iface) => iface.methods),
      ...enums.flatMap((enm) => [...enm.constructors, ...enm.methods]),
    ];

    if (filter) {
      const lowered = filter.toLowerCase();
      functions = functions.filter(
        (fn) =>
          fn.name.toLowerCase().includes(lowered) || fn.qualifiedName.toLowerCase().includes(lowered)
      );
      for (const collection of [classes, interfaces, enums]) {
        for (const entry of collection) {
          if (entry.methods) {
            entry.methods = entry.methods.filter(
              (fn) =>
                fn.name.toLowerCase().includes(lowered) ||
                fn.qualifiedName.toLowerCase().includes(lowered)
            );
          }
          if (entry.constructors) {
            entry.constructors = entry.constructors.filter((fn) =>
              fn.qualifiedName.toLowerCase().includes(lowered)
            );
          }
        }
      }
    }

    return {
      packageName,
      imports,
      classes,
      interfaces,
      enums,
      functions,
    };
  } catch (error) {
    return {
      packageName: null,
      imports: [],
      classes: [],
      interfaces: [],
      enums: [],
      functions: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
