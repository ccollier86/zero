/**
 * copy.ts
 *
 * Copies selected Zero source components/hooks into an app-owned project. This
 * file owns filesystem copying and import rewriting only; supported item names
 * are defined in registry.ts and CLI presentation lives in run.ts.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveAddableTarget } from './registry';

/** Options accepted by the source-copy engine behind `zero add`. */
export interface AddZeroSourceOptions {
  targetDir: string;
  items: string[];
  force?: boolean;
  dryRun?: boolean;
  sourceRoot?: string;
}

/** Result returned after planning or writing source files. */
export interface AddZeroSourceResult {
  targetDir: string;
  requested: string[];
  filesPlanned: string[];
  filesWritten: string[];
  filesSkipped: string[];
  rewrites: ImportRewriteRecord[];
}

/** One import path rewritten from framework internals to a public package path. */
export interface ImportRewriteRecord {
  file: string;
  from: string;
  to: string;
}

interface PlannedFile {
  sourcePath: string;
  targetRel: string;
  content: string;
}

const DEFAULT_SOURCE_ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const APP_OWNED_ROOTS = ['components', 'hooks', 'lib', 'modals'];
const IMPORT_SPECIFIER_PATTERN = /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Copy supported Zero source files into an app-owned project directory.
 *
 * Existing files are skipped unless `force` is true. Framework-internal relative
 * imports are rewritten to public `@zero/framework/*` subpaths so copied files
 * remain package-mode safe.
 */
export async function addZeroSource(options: AddZeroSourceOptions): Promise<AddZeroSourceResult> {
  const sourceRoot = resolve(options.sourceRoot ?? DEFAULT_SOURCE_ROOT);
  const targetDir = resolve(options.targetDir);
  const requested = options.items.map((item) => item.replace(/^\/+|\/+$/g, ''));
  const planned = new Map<string, PlannedFile>();
  const processed = new Set<string>();
  const rewrites: ImportRewriteRecord[] = [];

  for (const item of requested) {
    const target = resolveAddableTarget(item, sourceRoot);
    await enqueueSource(join(sourceRoot, target.sourceRel));
  }

  const filesPlanned = [...planned.keys()].sort();
  const filesWritten: string[] = [];
  const filesSkipped: string[] = [];

  for (const targetRel of filesPlanned) {
    const file = planned.get(targetRel);
    if (!file) continue;

    const targetPath = join(targetDir, targetRel);
    if (existsSync(targetPath) && options.force !== true) {
      filesSkipped.push(targetRel);
      continue;
    }

    if (options.dryRun === true) continue;

    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content);
    filesWritten.push(targetRel);
  }

  return {
    targetDir,
    requested,
    filesPlanned,
    filesWritten,
    filesSkipped,
    rewrites,
  };

  async function enqueueSource(sourcePath: string): Promise<void> {
    const sourceStat = await stat(sourcePath);
    if (sourceStat.isDirectory()) {
      await enqueueDirectory(sourcePath);
      return;
    }
    if (sourceStat.isFile()) await enqueueFile(sourcePath);
  }

  async function enqueueDirectory(sourceDir: string): Promise<void> {
    const entries = await readdir(sourceDir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(sourceDir, entry.name);
      if (entry.isDirectory()) {
        await enqueueDirectory(entryPath);
        continue;
      }
      if (entry.isFile()) await enqueueFile(entryPath);
    }
  }

  async function enqueueFile(sourcePath: string): Promise<void> {
    const normalizedSource = resolve(sourcePath);
    if (!isCopyableSourceFile(normalizedSource, sourceRoot) || processed.has(normalizedSource)) return;
    processed.add(normalizedSource);

    const sourceRel = toSourceRel(normalizedSource, sourceRoot);
    const targetRel = sourceRel;
    const original = await readFile(normalizedSource, 'utf8');
    const content = await rewriteImports(original, normalizedSource, sourceRel, sourceRoot, enqueueFile, rewrites);

    planned.set(targetRel, {
      sourcePath: normalizedSource,
      targetRel,
      content,
    });
  }
}

async function rewriteImports(
  content: string,
  sourceFile: string,
  sourceRel: string,
  sourceRoot: string,
  enqueueFile: (sourcePath: string) => Promise<void>,
  rewrites: ImportRewriteRecord[]
): Promise<string> {
  const replacements = new Map<string, string>();
  const specifiers = collectImportSpecifiers(content);

  for (const specifier of specifiers) {
    const resolved = await resolveSourceImport(sourceFile, specifier, sourceRoot);
    if (!resolved) continue;

    if (isAppOwnedSource(resolved, sourceRoot)) {
      await enqueueFile(resolved);
      if (specifier.startsWith('#zero/')) {
        const appImport = `@/${specifier.slice('#zero/'.length)}`;
        replacements.set(specifier, appImport);
        rewrites.push({ file: sourceRel, from: specifier, to: appImport });
      }
      continue;
    }

    const publicImport = toPublicFrameworkImport(resolved, sourceRoot);
    if (!publicImport) continue;

    replacements.set(specifier, publicImport);
    rewrites.push({
      file: sourceRel,
      from: specifier,
      to: publicImport,
    });
  }

  let next = content;
  for (const [from, to] of replacements) {
    next = next.replaceAll(`'${from}'`, `'${to}'`).replaceAll(`"${from}"`, `"${to}"`);
  }

  return next;
}

function collectImportSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [IMPORT_SPECIFIER_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content))) {
      const specifier = match[1];
      if (specifier.startsWith('.')
        || specifier.startsWith('@/')
        || specifier.startsWith('#zero/')) {
        specifiers.add(specifier);
      }
    }
  }
  return [...specifiers];
}

async function resolveSourceImport(sourceFile: string, specifier: string, sourceRoot: string): Promise<string | null> {
  const basePath = specifier.startsWith('@/')
    ? join(sourceRoot, specifier.slice(2))
    : specifier.startsWith('#zero/')
      ? join(sourceRoot, specifier.slice('#zero/'.length))
      : resolve(dirname(sourceFile), specifier);

  return resolveSourceFile(basePath, sourceRoot);
}

async function resolveSourceFile(basePath: string, sourceRoot: string): Promise<string | null> {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    join(basePath, 'index.ts'),
    join(basePath, 'index.tsx'),
  ];

  for (const candidate of candidates) {
    const resolved = resolve(candidate);
    if (!isInsideSourceRoot(resolved, sourceRoot)) continue;
    if (!existsSync(resolved)) continue;

    const candidateStat = await stat(resolved);
    if (candidateStat.isFile() && isCopyableSourceFile(resolved, sourceRoot)) return resolved;
  }

  return null;
}

function toPublicFrameworkImport(sourcePath: string, sourceRoot: string): string | null {
  const rel = toSourceRel(sourcePath, sourceRoot);
  if (rel.startsWith('schema/')) return '@zero/framework/schema';
  if (rel === 'sync/identity.ts') return '@zero/framework/sync/identity';
  if (rel === 'sync/types.ts') return '@zero/framework/sync/types';
  if (rel.startsWith('frontend/client/')) return '@zero/framework/react';
  if (rel === 'observability/codes.ts') return '@zero/framework/observability/codes';
  if (rel.startsWith('storage/storage-hooks.') || rel.startsWith('storage/upload-dropzone-hooks.')) {
    return '@zero/framework/react';
  }
  if (rel.startsWith('storage/storage-file-hooks.') || rel.startsWith('storage/storage-browser-hooks.')) {
    return '@zero/framework/react';
  }
  if (rel === 'storage/types.ts') return '@zero/framework/storage';
  return null;
}

function isAppOwnedSource(sourcePath: string, sourceRoot: string): boolean {
  const rel = toSourceRel(sourcePath, sourceRoot);
  return APP_OWNED_ROOTS.some((root) => rel === root || rel.startsWith(`${root}/`));
}

function isCopyableSourceFile(sourcePath: string, sourceRoot: string): boolean {
  if (!/\.(ts|tsx)$/.test(sourcePath)) return false;
  if (/\.test\.(ts|tsx)$/.test(sourcePath)) return false;
  if (sourcePath.endsWith('.d.ts')) return false;
  return isInsideSourceRoot(sourcePath, sourceRoot);
}

function isInsideSourceRoot(sourcePath: string, sourceRoot: string): boolean {
  const rel = relative(sourceRoot, resolve(sourcePath));
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith(sep));
}

function toSourceRel(sourcePath: string, sourceRoot: string): string {
  return relative(sourceRoot, sourcePath).split(sep).join('/');
}
