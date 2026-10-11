/**
 * Pure AST binding evidence for upgrade checks. Resolves public Zero imports and
 * bounded relative re-export chains using only already admitted source text;
 * never reads files, evaluates configuration or treats lookalike names as Zero.
 */
import ts from 'typescript';
import { dirname, normalize, join, sep } from 'node:path';
import type { SourceOnlyFile } from './source-only-types';
import type { UpgradeExportKind } from './source-only-upgrade-types';

export interface UpgradePublicBinding { readonly kind: 'named'; readonly specifier: string; readonly name: string; readonly typeOnly: boolean }
interface NamespaceBinding { readonly kind: 'namespace'; readonly specifier?: string; readonly path?: string; readonly typeOnly: boolean }
export type UpgradeBinding = UpgradePublicBinding | NamespaceBinding | { readonly kind: 'unknown' | 'none' };
export interface UpgradePublicReference { readonly node: ts.Node; readonly binding: UpgradePublicBinding; readonly exportKind: UpgradeExportKind }
export interface UpgradeSourceModule {
  readonly input: SourceOnlyFile;
  readonly file: ts.SourceFile;
  readonly parsed: boolean;
  readonly incomplete?: 'parser-limit' | 'ast-limit';
}
const none: UpgradeBinding = { kind: 'none' }, unknown: UpgradeBinding = { kind: 'unknown' };
const pathKey = (path: string) => normalize(path).split(sep).join('/').replace(/^\.\//u, '');
export const isUpgradePublicSpecifier = (specifier: string) => specifier === '@zero/framework' || specifier.startsWith('@zero/framework/');
/** App path aliases need an application resolver, which this source-only pass intentionally cannot execute. */
export const isUpgradeLocalSpecifier = (specifier: string) => specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('#') || specifier.includes('\\');
export function unwrapUpgradeExpression(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
  return node;
}
const identifierText = (node: ts.ModuleExportName) => node.text;
/** Preflight iteratively before any recursive consumer walk; deeply authored/generated ASTs remain unknown. */
function safeAstDepth(file: ts.SourceFile): boolean {
  const pending: Array<{ node: ts.Node; depth: number }> = [{ node: file, depth: 0 }];
  while (pending.length) {
    const current = pending.pop()!;
    if (current.depth > 256) return false;
    ts.forEachChild(current.node, node => { pending.push({ node, depth: current.depth + 1 }); });
  }
  return true;
}
function typed(binding: UpgradeBinding, typeOnly: boolean): UpgradeBinding {
  return binding.kind === 'named' || binding.kind === 'namespace' ? { ...binding, typeOnly: typeOnly || binding.typeOnly } : binding;
}
function same(left: UpgradeBinding, right: UpgradeBinding) {
  return left.kind === right.kind && (left.kind === 'named' && right.kind === 'named'
    ? left.specifier === right.specifier && left.name === right.name && left.typeOnly === right.typeOnly
    : left.kind === 'namespace' && right.kind === 'namespace' ? left.specifier === right.specifier && left.path === right.path && left.typeOnly === right.typeOnly : true);
}

/** Build a conservative import graph solely from the caller's admitted files. */
export function createUpgradeBindingGraph(inputs: readonly SourceOnlyFile[], publicSpecifier = isUpgradePublicSpecifier) {
  const modules: UpgradeSourceModule[] = inputs.filter(input => /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/iu.test(input.path)).map(input => {
    const kind = /\.(?:tsx|jsx)$/iu.test(input.path) ? ts.ScriptKind.TSX : /\.(?:js|mjs|cjs)$/iu.test(input.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    let file: ts.SourceFile;
    try { file = ts.createSourceFile(input.path, input.source, ts.ScriptTarget.Latest, true, kind); }
    catch { return { input, file: ts.createSourceFile(input.path, '', ts.ScriptTarget.Latest, true, kind), parsed: false, incomplete: 'parser-limit' }; }
    const parsed = !(file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics?.length;
    if (parsed && !safeAstDepth(file)) return { input, file, parsed: false, incomplete: 'ast-limit' };
    return { input, file, parsed };
  });
  const byPath = new Map(modules.map(module => [pathKey(module.input.resolutionPath ?? module.input.path), module]));
  function localPath(module: UpgradeSourceModule, specifier: string): string | null {
    if (specifier.includes('\\')) return null;
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return null;
    const base = pathKey(join(dirname(module.input.resolutionPath ?? module.input.path), specifier));
    const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(extension => base + extension),
      ...['index.ts', 'index.tsx', 'index.js', 'index.jsx'].map(index => pathKey(join(base, index)))];
    if (/\.(?:jsx?|mjs|cjs)$/iu.test(base)) candidates.push(base.replace(/\.(?:jsx?|mjs|cjs)$/iu, '.ts'), base.replace(/\.(?:jsx?|mjs|cjs)$/iu, '.tsx'));
    return candidates.find(candidate => byPath.has(candidate)) ?? null;
  }
  function from(module: UpgradeSourceModule, specifier: string, name: string | null, typeOnly: boolean, seen: Set<string>): UpgradeBinding {
    if (specifier.includes('\\')) return unknown;
    if (publicSpecifier(specifier)) return name === null ? { kind: 'namespace', specifier, typeOnly }
      : { kind: 'named', specifier, name, typeOnly };
    if (specifier.startsWith('@/') || specifier.startsWith('#')) return unknown;
    if (!specifier.startsWith('.')) return none;
    const path = localPath(module, specifier);
    if (!path) return unknown;
    return name === null ? { kind: 'namespace', path, typeOnly } : typed(exported(path, name, seen), typeOnly);
  }
  function alias(module: UpgradeSourceModule, declaration: ts.Node | null, seen: Set<string>): UpgradeBinding {
    if (!declaration || !ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name) || !declaration.initializer
      || !ts.isVariableDeclarationList(declaration.parent) || !(declaration.parent.flags & ts.NodeFlags.Const)) return none;
    const key = `${module.input.path}\0alias:${declaration.pos}`;
    if (seen.has(key) || seen.size >= 80) return unknown;
    const initializer = unwrapUpgradeExpression(declaration.initializer);
    if (!ts.isIdentifier(initializer) && !ts.isPropertyAccessExpression(initializer) && !ts.isElementAccessExpression(initializer)) return none;
    const next = new Set(seen); next.add(key);
    return expression(module, initializer, next);
  }
  function local(module: UpgradeSourceModule, name: string, seen: Set<string>): UpgradeBinding {
    for (const statement of module.file.statements) {
      if (ts.isVariableStatement(statement)) { const declaration = statement.declarationList.declarations.find(declaration => hasBindingName(declaration.name, name));
        if (declaration) return alias(module, declaration, seen); }
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) return none;
    }
    for (const statement of module.file.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const clause = statement.importClause, named = clause?.namedBindings, specifier = statement.moduleSpecifier.text;
        if (clause?.name?.text === name) return from(module, specifier, 'default', !!clause.isTypeOnly, seen);
        if (named && ts.isNamespaceImport(named) && named.name.text === name) return from(module, specifier, null, !!clause?.isTypeOnly, seen);
        if (named && ts.isNamedImports(named)) for (const item of named.elements) if (item.name.text === name)
          return from(module, specifier, identifierText(item.propertyName ?? item.name), !!clause?.isTypeOnly || item.isTypeOnly, seen);
      }
      // A copied/custom declaration is not a Zero binding merely because its name matches.
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => hasBindingName(declaration.name, name))) return none;
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) return none;
    }
    return none;
  }
  function exported(path: string, name: string, seen: Set<string>): UpgradeBinding {
    const key = `${path}\0${name}`;
    if (seen.has(key) || seen.size >= 80) return unknown;
    const next = new Set(seen); next.add(key);
    const module = byPath.get(path); if (!module?.parsed) return unknown;
    const stars: UpgradeBinding[] = [];
    for (const statement of module.file.statements) {
      if (ts.isExportDeclaration(statement)) {
        const clause = statement.exportClause;
        const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
        if (clause && ts.isNamedExports(clause)) for (const item of clause.elements) if (identifierText(item.name) === name) {
          const original = identifierText(item.propertyName ?? item.name);
          return typed(specifier ? from(module, specifier, original, false, next) : local(module, original, next), statement.isTypeOnly || item.isTypeOnly);
        }
        if (clause && ts.isNamespaceExport(clause) && identifierText(clause.name) === name)
          return specifier ? from(module, specifier, null, statement.isTypeOnly, next) : unknown;
        if (!clause && specifier) stars.push(from(module, specifier, name, statement.isTypeOnly, next));
      }
      if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        if (ts.isVariableStatement(statement)) { const declaration = statement.declarationList.declarations.find(declaration => hasBindingName(declaration.name, name));
          if (declaration) return alias(module, declaration, next); }
        if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)
          || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) && statement.name?.text === name) return none;
      }
    }
    if (!stars.length) return none;
    // Multiple stars may shadow or introduce ambiguity; a public target does not prove local uniqueness.
    return stars.every(binding => same(binding, stars[0]!)) ? stars[0]! : unknown;
  }
  function member(binding: UpgradeBinding, name: string): UpgradeBinding {
    if (binding.kind === 'unknown') return unknown;
    if (binding.kind !== 'namespace') return none;
    return typed(binding.specifier ? { kind: 'named', specifier: binding.specifier, name, typeOnly: binding.typeOnly }
      : binding.path ? exported(binding.path, name, new Set()) : unknown, binding.typeOnly);
  }
  function expression(module: UpgradeSourceModule, node: ts.Expression, seen = new Set<string>()): UpgradeBinding {
    node = unwrapUpgradeExpression(node);
    if (ts.isIdentifier(node)) return upgradeIdentifierIsUnshadowed(node.text, node, module.file) ? local(module, node.text, seen)
      : alias(module, upgradeLocalIdentifierIdentity(node), seen);
    if (ts.isPropertyAccessExpression(node)) return member(expression(module, node.expression, seen), node.name.text);
    if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression))
      return member(expression(module, node.expression, seen), node.argumentExpression.text);
    return none;
  }
  function references(module: UpgradeSourceModule): UpgradePublicReference[] {
    const result: UpgradePublicReference[] = [];
    const add = (node: ts.Node, binding: UpgradeBinding) => {
      // Ordinary import syntax may name a type without import-type unless verbatimModuleSyntax is enabled.
      if (binding.kind === 'named') result.push({ node, binding, exportKind: 'any' });
    };
    for (const statement of module.file.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
        const named = statement.importClause?.namedBindings;
        if (statement.importClause?.name) add(statement.importClause.name, local(module, statement.importClause.name.text, new Set()));
        if (named && ts.isNamedImports(named)) for (const item of named.elements) add(item, local(module, item.name.text, new Set()));
      }
      if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        && statement.exportClause && ts.isNamedExports(statement.exportClause)) for (const item of statement.exportClause.elements)
          add(item, from(module, statement.moduleSpecifier.text, identifierText(item.propertyName ?? item.name), statement.isTypeOnly || item.isTypeOnly, new Set()));
    }
    return result;
  }
  return { modules, expression, references, local: (module: UpgradeSourceModule, name: string) => local(module, name, new Set()) };
}

function hasBindingName(name: ts.BindingName, text: string): boolean {
  return ts.isIdentifier(name) ? name.text === text : name.elements.some(item => ts.isBindingElement(item) && hasBindingName(item.name, text));
}
const hoistedNames = new WeakMap<ts.Node, ReadonlySet<string>>();
function declarations(scope: ts.Node, name: string): boolean {
  const cached = hoistedNames.get(scope); if (cached) return cached.has(name);
  const found = new Set<string>();
  const add = (binding: ts.BindingName) => { if (ts.isIdentifier(binding)) found.add(binding.text);
    else for (const element of binding.elements) if (ts.isBindingElement(element)) add(element.name); };
  const visit = (node: ts.Node) => {
    if (node !== scope && ts.isFunctionLike(node)) return;
    if (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
      && !(node.parent.flags & ts.NodeFlags.BlockScoped)) add(node.name);
    ts.forEachChild(node, visit);
  };
  visit(scope); hoistedNames.set(scope, found); return found.has(name);
}
/** Skip runtime shadowing without executing or building a TypeScript program. */
export function upgradeIdentifierIsUnshadowed(name: string, node: ts.Node, file: ts.SourceFile): boolean {
  let parent = node.parent;
  while (parent && parent !== file) {
    if (ts.isFunctionLike(parent)) {
      if (parent.parameters.some(parameter => hasBindingName(parameter.name, name)) || declarations(parent, name)) return false;
      if ((ts.isFunctionExpression(parent) || ts.isFunctionDeclaration(parent)) && parent.name?.text === name) return false;
    }
    if (ts.isCatchClause(parent) && parent.variableDeclaration && hasBindingName(parent.variableDeclaration.name, name)) return false;
    if (ts.isBlock(parent) || ts.isModuleBlock(parent)) for (const statement of parent.statements) {
      if (ts.isVariableStatement(statement) && statement.declarationList.declarations.some(declaration => hasBindingName(declaration.name, name))) return false;
      if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === name) return false;
    }
    if ((ts.isForStatement(parent) || ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer
      && ts.isVariableDeclarationList(parent.initializer) && parent.initializer.declarations.some(declaration => hasBindingName(declaration.name, name))) return false;
    if (ts.isClassExpression(parent) && parent.name?.text === name) return false;
    parent = parent.parent;
  }
  return true;
}

/** Identity for a locally declared ref; same-spelling refs in other scopes never match. */
export function upgradeLocalIdentifierIdentity(node: ts.Identifier): ts.Node | null {
  let parent: ts.Node | undefined = node.parent;
  while (parent) {
    if (ts.isFunctionLike(parent)) {
      const parameter = parent.parameters.find(item => hasBindingName(item.name, node.text)); if (parameter) return parameter;
    }
    if (ts.isCatchClause(parent) && parent.variableDeclaration && hasBindingName(parent.variableDeclaration.name, node.text)) return parent.variableDeclaration;
    if (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent)) for (const statement of parent.statements) {
      if (ts.isVariableStatement(statement)) { const declaration = statement.declarationList.declarations.find(item => hasBindingName(item.name, node.text)); if (declaration) return declaration; }
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause, named = clause?.namedBindings;
        if (clause?.name?.text === node.text) return clause;
        if (named && ts.isNamespaceImport(named) && named.name.text === node.text) return named;
        if (named && ts.isNamedImports(named)) { const item = named.elements.find(item => item.name.text === node.text); if (item) return item; }
      }
    }
    parent = parent.parent;
  }
  return null;
}
