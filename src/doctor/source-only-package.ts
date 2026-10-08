/**
 * Reads installed package JSON and publicly reachable literal export targets.
 * It never resolves executable imports, loads plugins or evaluates package code.
 */
import { realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';
import type { SourceOnlyFrameworkInspection } from './source-only-types';

/** Package metadata shared by the static import checker; private paths are not public exports. */
export interface SourceOnlyPackageInfo extends SourceOnlyFrameworkInspection {
  readonly ownImports: Readonly<Record<string, unknown>>;
  readonly deniedExports: readonly string[];
}

function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

/** Canonicalization is filesystem-only; Bun has no realpath API equivalent. */
export function sourceOnlyRealpath(path: string): string { return realpathSync.native(path); }

/** Keep a read inside its explicitly admitted filesystem root, including symlink targets. */
export function sourceOnlyInside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`));
}

async function jsonFile(path: string): Promise<Record<string, unknown> | null> {
  try {
    const file = Bun.file(path);
    if (!await file.exists() || file.size > 2_000_000) return null;
    const value: unknown = await file.json(); return object(value) ? value : null;
  } catch { return null; }
}

function targets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(targets);
  if (object(value)) return Object.values(value).flatMap(targets);
  return [];
}

/** Inspect only the selected app's installed package, or the explicitly selected framework workspace. */
export async function inspectSourceOnlyPackage(projectRoot: string): Promise<SourceOnlyPackageInfo> {
  const own = await jsonFile(join(projectRoot, 'package.json'));
  const ownImports = object(own?.imports) ? own.imports : {};
  const installedManifest = join(projectRoot, 'node_modules/@zero/framework/package.json');
  let manifest = await jsonFile(installedManifest);
  let packageRoot: string; let status: 'installed' | 'workspace' = 'installed';
  try {
    if (manifest) packageRoot = dirname(sourceOnlyRealpath(installedManifest));
    else if (own?.name === '@zero/framework') { manifest = own; packageRoot = projectRoot; status = 'workspace'; }
    else return { status: await Bun.file(installedManifest).exists() ? 'unavailable' : 'missing', version: null, publicExports: [], modalShow: null, ownImports, deniedExports: [] };
  } catch { return { status: 'unavailable', version: null, publicExports: [], modalShow: null, ownImports, deniedExports: [] }; }
  if (manifest.name !== '@zero/framework') return { status: 'unavailable', version: null, publicExports: [], modalShow: null, ownImports, deniedExports: [] };
  const exports = object(manifest.exports) ? manifest.exports : typeof manifest.exports === 'string' ? { '.': manifest.exports } : {};
  const publicExports = Object.keys(exports).filter(key => key.startsWith('.') && targets(exports[key]).length > 0);
  const deniedExports = Object.keys(exports).filter(key => key.startsWith('.') && targets(exports[key]).length === 0);
  const version = typeof manifest.version === 'string' ? manifest.version : null;
  const entry = exports['./modals'] ?? exports['./react'] ?? exports['.'];
  const modalShow = entry ? await inspectModalShow(packageRoot, targets(entry)) : null;
  return { status, version, publicExports, modalShow, ownImports, deniedExports };
}

async function resolveSource(root: string, from: string, target: string): Promise<string | null> {
  const base = resolve(dirname(from), target);
  for (const path of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.d.ts`, join(base, 'index.ts'), join(base, 'index.tsx'), join(base, 'index.js'), join(base, 'index.d.ts')]) {
    try {
      if (!await Bun.file(path).exists()) continue;
      const canonical = sourceOnlyRealpath(path); if (sourceOnlyInside(root, canonical)) return canonical;
    } catch { /* Missing/unreadable targets make capability unknown, never available. */ }
  }
  return null;
}

async function inspectModalShow(root: string, entryTargets: string[]): Promise<boolean | null> {
  const queue: string[] = [];
  for (const target of entryTargets) {
    if (!target.startsWith('./') || target.includes('*')) continue;
    const path = await resolveSource(root, join(root, 'package.json'), target); if (path) queue.push(path);
  }
  if (!queue.length) return null;
  const seen = new Set<string>(); let foundFacade = false;
  while (queue.length && seen.size < 80) {
    const path = queue.shift()!; if (seen.has(path)) continue; seen.add(path);
    let source: string;
    try { const file = Bun.file(path); if (file.size > 2_000_000) continue; source = await file.text(); } catch { continue; }
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const localModals = file.statements.some(node => ts.isExportDeclaration(node) && !node.moduleSpecifier && node.exportClause
      && ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(spec => spec.name.text === 'modals'));
    for (const node of file.statements) {
      if (ts.isVariableStatement(node) && (localModals || node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))) {
        for (const declaration of node.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'modals' || !declaration.initializer) continue;
          const initializer = unwrapExpression(declaration.initializer);
          if (!ts.isObjectLiteralExpression(initializer)) continue;
          foundFacade = true;
          if (initializer.properties.some(property => property.name && name(property.name) === 'show')) return true;
        }
      }
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text.startsWith('.') && (!node.exportClause || (ts.isNamedExports(node.exportClause)
          && node.exportClause.elements.some(spec => spec.name.text === 'modals' || spec.name.text === 'default')))) {
        const next = await resolveSource(root, path, node.moduleSpecifier.text); if (next) queue.push(next);
      }
    }
  }
  return foundFacade ? false : null;
}

/** Type-only wrappers preserve the same literal facade; no imported expression is evaluated. */
function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
    || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
}

/** Static exact/wildcard package subpath support; no application resolver is executed. */
export function sourceOnlyExported(specifier: string, exports: readonly string[], denied: readonly string[] = []): boolean {
  const subpath = specifier === '@zero/framework' ? '.' : `.${specifier.slice('@zero/framework'.length)}`;
  if (denied.includes(subpath)) return false;
  return exports.some(key => key === subpath || (key.includes('*') && subpath.startsWith(key.slice(0, key.indexOf('*')))
    && subpath.endsWith(key.slice(key.indexOf('*') + 1))));
}

/** A genuinely app-owned #zero alias is not a copied framework-private import. */
export function sourceOnlyOwnAlias(specifier: string, imports: Readonly<Record<string, unknown>>): boolean {
  for (const [key, value] of Object.entries(imports)) {
    const matches = key === specifier || (key.includes('*') && specifier.startsWith(key.slice(0, key.indexOf('*'))) && specifier.endsWith(key.slice(key.indexOf('*') + 1)));
    if (!matches) continue;
    const values = targets(value);
    return values.length > 0 && values.every(target => target.startsWith('./') && !target.includes('node_modules') && !target.includes('@zero/framework'));
  }
  return false;
}

function name(node: ts.PropertyName): string | null { return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null; }
