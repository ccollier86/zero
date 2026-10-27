/** Bounded filesystem/AST inspection of literal public exports. Never executes a resolver or module. */
import { dirname, join, relative, resolve, sep } from 'node:path';
import { lstat, readlink } from 'node:fs/promises';
import ts from 'typescript';
import { sourceOnlyBlockedPath, sourceOnlyInside } from './source-only-package';
import type { UpgradeExportEvidence, UpgradeExportKind } from './source-only-upgrade-types';

const MAX_FILES = 256, MAX_BYTES = 16_000_000, MAX_FILE_BYTES = 2_000_000, MAX_DEPTH = 40, MAX_OPERATIONS = 8192;
const SOURCE = /\.(?:ts|tsx|js|jsx|mts|cts|mjs|cjs)$/iu;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const unknown = (reason: UpgradeExportEvidence['reason'] = 'unresolved-source'): UpgradeExportEvidence => ({ status: 'unknown', reason });

export interface UpgradeExportBinding {
  readonly path: string;
  readonly localName: string;
  readonly declaration: ts.Node;
  readonly file: ts.SourceFile;
}
export interface UpgradeResolvedExport extends UpgradeExportEvidence {
  readonly binding?: UpgradeExportBinding;
  /** All runtime conditional branches must support a behavior before it is promoted as a capability. */
  readonly bindings?: readonly UpgradeExportBinding[];
}

/** File contents are admitted before they enter caches or a fingerprint. */
export class SourceOnlyUpgradeExports {
  readonly records = new Map<string, string>();
  complete = true;
  private bytes = 0;
  private operations = 0;
  private readonly files = new Map<string, Promise<ts.SourceFile | UpgradeExportEvidence>>();
  private readonly sources = new Map<string, Promise<string | UpgradeExportEvidence>>();
  private readonly queries = new Map<string, UpgradeResolvedExport>();
  constructor(readonly root: string, private readonly exportsMap: unknown) {}

  private blocked(path: string): boolean {
    return !sourceOnlyInside(this.root, path) || sourceOnlyBlockedPath(relative(this.root, path));
  }

  async source(from: string, target: string): Promise<string | UpgradeExportEvidence> {
    if (++this.operations > MAX_OPERATIONS) { this.complete = false; return unknown('inspection-limit'); }
    const key = `${from}\0${target}`, existing = this.sources.get(key);
    if (existing) return existing;
    const pending = this.resolveSource(from, target);
    this.sources.set(key, pending);
    return pending;
  }

  /** Source identities are instance-local snapshots, just like admitted ASTs.
   * Repeated export queries must not spend the stat budget resolving the same
   * literal edge for every symbol. The original bounds remain unchanged. */
  private async resolveSource(from: string, target: string): Promise<string | UpgradeExportEvidence> {
    if (!target.startsWith('.') || /[*?#\\]/u.test(target)) return unknown();
    const base = resolve(dirname(from), target);
    if (this.blocked(base)) { this.complete = false; return unknown('private-target'); }
    const candidates = [base, ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].map(ext => base + ext),
      ...['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mts', 'index.mjs'].map(file => join(base, file))];
    for (const candidate of candidates) {
      try {
        const admitted = await admitUpgradeFile(this.root, candidate, () => ++this.operations <= MAX_OPERATIONS);
        if (admitted === null) continue;
        if (typeof admitted !== 'string') { this.complete = false; return admitted; }
        if (!SOURCE.test(admitted)) { this.complete = false; return unknown('private-target'); }
        return admitted;
      } catch { /* Unreadable/missing source cannot prove an absent export. */ }
    }
    this.complete = false; return unknown();
  }

  async read(path: string): Promise<ts.SourceFile | UpgradeExportEvidence> {
    const existing = this.files.get(path); if (existing) return existing;
    if (this.files.size >= MAX_FILES) { this.complete = false; return unknown('inspection-limit'); }
    const pending = (async () => {
      try {
        if (this.blocked(path)) return unknown('private-target');
        const admitted = await admitUpgradeFile(this.root, path, () => ++this.operations <= MAX_OPERATIONS);
        if (admitted === null) return unknown();
        if (typeof admitted !== 'string') return admitted;
        const canonical = admitted;
        if (!SOURCE.test(canonical)) return unknown('private-target');
        const file = Bun.file(canonical);
        if (file.size > MAX_FILE_BYTES || this.bytes + file.size > MAX_BYTES) return unknown('inspection-limit');
        // Reserve before awaiting so concurrent public queries cannot oversubscribe the aggregate read budget.
        const budget = Math.min(MAX_FILE_BYTES, MAX_BYTES - this.bytes, file.size); this.bytes += budget;
        const content = await file.slice(0, budget + 1).text(), size = Buffer.byteLength(content);
        if (size > budget) return unknown('inspection-limit');
        this.bytes += size - budget; this.records.set(relative(this.root, canonical).replaceAll('\\', '/'), content);
        const ast = ts.createSourceFile(canonical, content, ts.ScriptTarget.Latest, true);
        if ((ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) return unknown('parse-error');
        return ast;
      } catch { return unknown(); }
    })();
    this.files.set(path, pending);
    const result = await pending; if ('status' in result) this.complete = false;
    return result;
  }

  /** Export-map exact matches/denials win; wildcard precedence is the most-specific package pattern. */
  private entry(specifier: string, kind: UpgradeExportKind): { targets?: string[]; evidence?: UpgradeExportEvidence } {
    if (specifier !== '@zero/framework' && !specifier.startsWith('@zero/framework/')) return { evidence: { status: 'missing', reason: 'not-public' } };
    const subpath = specifier === '@zero/framework' ? '.' : '.' + specifier.slice('@zero/framework'.length);
    const map = this.exportsMap;
    if (map === undefined) return { evidence: unknown() };
    let value: unknown, match: string | undefined;
    if (object(map) && Object.keys(map).some(key => key.startsWith('.'))) {
      if (Object.keys(map).some(key => !key.startsWith('.'))) return { evidence: unknown() };
      if (Object.hasOwn(map, subpath)) value = map[subpath];
      else {
        const patterns = Object.keys(map).filter(key => key.split('*').length === 2
          && subpath.startsWith(key.split('*')[0]!) && subpath.endsWith(key.split('*')[1]!)
          && subpath.length >= key.length - 1).sort((a, b) => b.indexOf('*') - a.indexOf('*') || b.length - a.length);
        const key = patterns[0];
        if (!key) return { evidence: { status: 'missing', reason: 'not-public' } };
        match = subpath.slice(key.indexOf('*'), subpath.length - (key.length - key.indexOf('*') - 1)); value = map[key];
      }
    } else if (subpath === '.') value = map;
    else return { evidence: { status: 'missing', reason: 'not-public' } };
    if (value === null) return { evidence: { status: 'missing', reason: 'not-public' } };
    const targets: string[] = []; let uncertain = false, nodes = 0;
    const visit = (item: unknown, depth = 0) => {
      if (++nodes > MAX_OPERATIONS || depth > MAX_DEPTH || targets.length >= MAX_FILES) { uncertain = true; this.complete = false; return; }
      if (typeof item === 'string') { targets.push(match === undefined ? item : item.replaceAll('*', match)); return; }
      if (Array.isArray(item)) { uncertain = true; item.forEach(target => visit(target, depth + 1)); return; }
      if (object(item)) {
        for (const [condition, target] of Object.entries(item)) if (kind === 'any' || condition !== 'types') visit(target, depth + 1);
      } else uncertain = true;
    };
    visit(value);
    if (uncertain || !targets.length) return { evidence: unknown() };
    return { targets: [...new Set(targets)] };
  }

  async inspect(specifier: string, name: string, kind: UpgradeExportKind = 'value'): Promise<UpgradeResolvedExport> {
    if (++this.operations > MAX_OPERATIONS) { this.complete = false; return unknown('inspection-limit'); }
    if (typeof specifier !== 'string' || typeof name !== 'string' || !name || (kind !== 'value' && kind !== 'any')) return unknown();
    const entry = this.entry(specifier, kind); if (entry.evidence) return entry.evidence;
    const results: UpgradeResolvedExport[] = [];
    for (const target of entry.targets!) {
      if (!target.startsWith('./')) { this.complete = false; results.push(unknown('private-target')); continue; }
      const path = await this.source(join(this.root, 'package.json'), target);
      try { results.push(typeof path === 'string' ? await this.resolveExport(path, name, kind, new Set()) : path); }
      catch { this.complete = false; results.push(unknown('inspection-limit')); }
    }
    // Conditional branches with different availability cannot establish an unconditional contract.
    if (kind === 'any' && results.some(result => result.status === 'available')) return results.find(result => result.status === 'available')!;
    if (results.every(result => result.status === 'available')) return { ...results[0]!,
      bindings: results.flatMap(result => result.bindings ?? (result.binding ? [result.binding] : [])) };
    if (results.every(result => result.status === 'missing')) return results[0]!;
    return results.find(result => result.status === 'unknown') ?? unknown();
  }

  private async resolveExport(path: string, name: string, kind: UpgradeExportKind, stack: Set<string>): Promise<UpgradeResolvedExport> {
    const key = `${path}\0${kind}\0${name}`;
    if (stack.has(key) || stack.size >= MAX_DEPTH) return unknown('inspection-limit');
    const cached = this.queries.get(key); if (cached) return cached;
    const next = new Set(stack).add(key);
    // Cache completed answers only: concurrent cyclic queries must not await each other's promises.
    const result = await this.resolveUncached(path, name, kind, next); this.queries.set(key, result); return result;
  }

  private async moduleExport(from: string, specifier: string, name: string, kind: UpgradeExportKind, stack: Set<string>): Promise<UpgradeResolvedExport> {
    const path = await this.source(from, specifier);
    return typeof path === 'string' ? this.resolveExport(path, name, kind, stack) : path;
  }

  private async resolveUncached(path: string, name: string, kind: UpgradeExportKind, stack: Set<string>): Promise<UpgradeResolvedExport> {
    const file = await this.read(path); if ('status' in file) return file;
    if (kind === 'value' && /\.d\.(?:ts|mts|cts)$/iu.test(path)) return unknown();
    const binding = (localName: string, declaration: ts.Node): UpgradeResolvedExport => ({ status: 'available', binding: { path, localName, declaration, file } });
    for (const statement of file.statements) {
      if (ts.isExportDeclaration(statement) && statement.exportClause && (!statement.isTypeOnly || kind === 'any')) {
        if (ts.isNamespaceExport(statement.exportClause) && statement.exportClause.name.text === name) {
          if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) return unknown();
          const target = await this.source(path, statement.moduleSpecifier.text);
          if (typeof target !== 'string') return target;
          const targetFile = await this.read(target);
          return 'status' in targetFile ? targetFile : kind === 'value' && declarationSource(target) ? unknown() : binding(name, statement);
        }
        if (ts.isNamedExports(statement.exportClause)) for (const spec of statement.exportClause.elements) {
          if (spec.name.text !== name || (spec.isTypeOnly && kind === 'value')) continue;
          const original = spec.propertyName?.text ?? spec.name.text;
          if (statement.moduleSpecifier) return ts.isStringLiteral(statement.moduleSpecifier)
            ? this.moduleExport(path, statement.moduleSpecifier.text, original, kind, stack) : unknown();
          return this.local(file, path, original, kind, stack);
        }
      }
      if (ts.isExportAssignment(statement) && !statement.isExportEquals && name === 'default') {
        return ts.isIdentifier(statement.expression) ? this.local(file, path, statement.expression.text, kind, stack) : binding('default', statement);
      }
      if (!has(statement, ts.SyntaxKind.ExportKeyword)) continue;
      const isDefault = has(statement, ts.SyntaxKind.DefaultKeyword);
      if ((isDefault && name === 'default') || (!isDefault && declarationNames(statement).includes(name))) {
        if (kind === 'value' && typeOnly(statement)) continue;
        if (kind === 'value' && has(statement, ts.SyntaxKind.DeclareKeyword)) return unknown();
        return binding(name, statement);
      }
    }
    const stars: UpgradeResolvedExport[] = [];
    for (const statement of file.statements) if (ts.isExportDeclaration(statement) && !statement.exportClause
      && (!statement.isTypeOnly || kind === 'any') && name !== 'default') {
      stars.push(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
        ? await this.moduleExport(path, statement.moduleSpecifier.text, name, kind, stack) : unknown());
    }
    const available = stars.filter(result => result.status === 'available');
    const identities = new Set(available.map(result => `${result.binding?.path}\0${result.binding?.localName}`));
    if (identities.size > 1) return unknown('ambiguous-star');
    if (stars.some(result => result.status === 'unknown')) return stars.find(result => result.status === 'unknown')!;
    if (available.length) return available[0]!;
    // CommonJS/dynamic export contracts are deliberately not interpreted as empty ESM modules.
    if (file.statements.some(statement => ts.isExportAssignment(statement) && statement.isExportEquals)
      || commonJs(file)) return unknown();
    return { status: 'missing', reason: 'not-exported' };
  }

  private async local(file: ts.SourceFile, path: string, name: string, kind: UpgradeExportKind, stack: Set<string>): Promise<UpgradeResolvedExport> {
    for (const statement of file.statements) {
      if (declarationNames(statement).includes(name) && (!typeOnly(statement) || kind === 'any')) {
        if (kind === 'value' && has(statement, ts.SyntaxKind.DeclareKeyword)) return unknown();
        return { status: 'available', binding: { path, localName: name, declaration: statement, file } };
      }
      if (!ts.isImportDeclaration(statement) || !statement.importClause || (statement.importClause.isTypeOnly && kind === 'value')) continue;
      const clause = statement.importClause;
      let original = clause.name?.text === name ? 'default' : undefined;
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        const spec = clause.namedBindings.elements.find(spec => spec.name.text === name && (!spec.isTypeOnly || kind === 'any'));
        if (spec) original = spec.propertyName?.text ?? spec.name.text;
      }
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings) && clause.namedBindings.name.text === name) {
        if (!ts.isStringLiteral(statement.moduleSpecifier)) return unknown();
        const target = await this.source(path, statement.moduleSpecifier.text);
        if (typeof target !== 'string') return target;
        const imported = await this.read(target);
        return 'status' in imported ? imported : kind === 'value' && declarationSource(target) ? unknown()
          : { status: 'available', binding: { path, localName: name, declaration: statement, file } };
      }
      if (original) return ts.isStringLiteral(statement.moduleSpecifier)
        ? this.moduleExport(path, statement.moduleSpecifier.text, original, kind, stack) : unknown();
    }
    return unknown();
  }
}

function has(node: ts.Node, kind: ts.SyntaxKind): boolean { return ts.canHaveModifiers(node) && !!ts.getModifiers(node)?.some(modifier => modifier.kind === kind); }
function declarationSource(path: string): boolean { return /\.d\.(?:ts|mts|cts)$/iu.test(path); }
function typeOnly(node: ts.Node): boolean { return ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node); }
function declarationNames(node: ts.Node): string[] {
  if (ts.isVariableStatement(node)) return node.declarationList.declarations.flatMap(declaration => names(declaration.name));
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) return [node.name.text];
  return [];
}
function names(name: ts.BindingName): string[] {
  return ts.isIdentifier(name) ? [name.text] : name.elements.flatMap(element => ts.isOmittedExpression(element) ? [] : names(element.name));
}
function commonJs(file: ts.SourceFile): boolean {
  const queue: ts.Node[] = [file]; let visited = 0;
  while (queue.length) {
    if (++visited > 100_000) return true; // Exhaustion cannot prove a module's absent names.
    const node = queue.pop()!;
    if (ts.isIdentifier(node) && node.text === 'exports') return true;
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'module' && node.name.text === 'exports') return true;
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'module'
      && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'exports') return true;
    ts.forEachChild(node, child => { queue.push(child); });
  }
  return false;
}

/** Walk aliases before probing their destinations. Private/outside source targets are never existence-probed. */
export async function admitUpgradeFile(root: string, path: string, consume = () => true, links = 0): Promise<string | (UpgradeExportEvidence & { readonly outsideRoot?: true }) | null> {
  if (!sourceOnlyInside(root, path)) return { ...unknown('private-target'), outsideRoot: true };
  if (sourceOnlyBlockedPath(relative(root, path))) return unknown('private-target');
  if (links > MAX_DEPTH) return unknown('inspection-limit');
  const parts = relative(root, path).split(sep).filter(Boolean); let current = root;
  for (let index = 0; index < parts.length; index++) {
    if (!consume()) return unknown('inspection-limit');
    current = resolve(current, parts[index]!);
    try {
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) {
        const target = resolve(dirname(current), await readlink(current), ...parts.slice(index + 1));
        return admitUpgradeFile(root, target, consume, links + 1);
      }
      if (index + 1 === parts.length) return stats.isFile() ? current : null;
      if (!stats.isDirectory()) return null;
    } catch (error) { return (error as { code?: string })?.code === 'ENOENT' ? null : unknown(); }
  }
  return null;
}
