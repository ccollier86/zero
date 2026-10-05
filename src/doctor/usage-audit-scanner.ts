/**
 * usage-audit-scanner.ts
 *
 * Owns app source discovery, path classification, and path-pattern matching
 * for Doctor's usage audit.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { ResolvedConfig } from '../frontend/server/types';
import type { NormalizedUsageAuditOptions, SourceFile } from './usage-audit-types';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']);
const ALWAYS_EXCLUDED_SEGMENTS = new Set([
  '.git',
  '.zero',
  '.build',
  '.storage',
  'coverage',
  'dist',
  'node_modules',
]);

export const DEFAULT_EXCLUDES = [
  '*.test.ts',
  '*.test.tsx',
  '*.spec.ts',
  '*.spec.tsx',
  '*.d.ts',
  '*.generated.ts',
  '*.generated.tsx',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.d.ts',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/generated/**',
  '**/vendor/**',
];

/** Discover app-owned source files using configured/default scan roots. */
export function discoverSourceFiles(
  projectRoot: string,
  resolvedConfig: ResolvedConfig,
  options: NormalizedUsageAuditOptions
): SourceFile[] {
  const roots = getScanRoots(projectRoot, resolvedConfig, options);
  const files: SourceFile[] = [];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const stats = statSync(root);
    if (stats.isFile()) {
      addSourceFile(projectRoot, root, options, files);
      continue;
    }
    if (stats.isDirectory()) walkDirectory(projectRoot, root, options, files);
  }

  return dedupeFiles(files);
}

export function frontendFile(file: SourceFile): boolean {
  return file.isFrontend;
}

export function backendFile(file: SourceFile): boolean {
  return file.isBackend;
}

export function browserSourceFile(file: SourceFile): boolean {
  return !file.isBackend && (
    file.relativePath.startsWith('app/') ||
    file.relativePath.startsWith('components/') ||
    file.relativePath.startsWith('hooks/') ||
    file.relativePath.startsWith('lib/')
  );
}

export function appOwnedSource(): boolean {
  return true;
}

export function matchesPathPattern(relativePath: string, pattern: string): boolean {
  if (pattern === relativePath) return true;
  if (!pattern.includes('*')) {
    return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
  }

  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    // Replace caller wildcards in one pass so a globstar's generated regex
    // cannot be processed again as a segment-local star. A globstar followed
    // by slash also matches no directory (for root-level excluded files).
    .replace(/\*\*\/|\*\*|\*/g, wildcard => wildcard === '**/'
      ? '(?:.*/)?' : wildcard === '**' ? '.*' : '[^/]*');
  return new RegExp(`^${escaped}$`).test(relativePath);
}

export function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function stripLineNumber(path: string): string {
  return path.replace(/:\d+$/, '');
}

function getScanRoots(
  projectRoot: string,
  resolvedConfig: ResolvedConfig,
  options: NormalizedUsageAuditOptions
): string[] {
  const roots = options.include?.length
    ? options.include
    : [
      resolvedConfig.appDir,
      resolvedConfig.serverPluginsDir,
      resolvedConfig.serverMiddlewareDir,
      resolvedConfig.serverEndpointsDir,
      resolvedConfig.serverRoutesDir,
      resolvedConfig.serverResourcesDir,
      'components',
      'hooks',
      'lib',
    ];

  return roots
    .filter((root): root is string => typeof root === 'string' && root.length > 0)
    .map((root) => isAbsolute(root) ? root : resolve(projectRoot, root));
}

function walkDirectory(
  projectRoot: string,
  directory: string,
  options: NormalizedUsageAuditOptions,
  files: SourceFile[]
): void {
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const relativePath = toRelativeProjectPath(projectRoot, absolutePath);
    if (isAlwaysExcluded(relativePath) || matchesAnyPattern(relativePath, options.exclude)) continue;

    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      walkDirectory(projectRoot, absolutePath, options, files);
    } else if (stats.isFile()) {
      addSourceFile(projectRoot, absolutePath, options, files);
    }
  }
}

function addSourceFile(
  projectRoot: string,
  absolutePath: string,
  options: NormalizedUsageAuditOptions,
  files: SourceFile[]
): void {
  const relativePath = toRelativeProjectPath(projectRoot, absolutePath);
  if (!isSourceFile(relativePath)) return;
  if (isAlwaysExcluded(relativePath) || matchesAnyPattern(relativePath, options.exclude)) return;

  const source = readFileSync(absolutePath, 'utf8');
  files.push({
    absolutePath,
    relativePath,
    source,
    lines: source.split(/\r?\n/),
    isFrontend: isFrontendPath(relativePath),
    isBackend: isBackendPath(relativePath),
  });
}

function dedupeFiles(files: SourceFile[]): SourceFile[] {
  const seen = new Set<string>();
  return files.filter((file) => {
    if (seen.has(file.absolutePath)) return false;
    seen.add(file.absolutePath);
    return true;
  });
}

function matchesAnyPattern(relativePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => matchesPathPattern(relativePath, normalizePath(pattern)));
}

function isSourceFile(relativePath: string): boolean {
  if (/\.d\.ts$/.test(relativePath)) return false;
  return SOURCE_EXTENSIONS.has(getExtension(relativePath));
}

function isAlwaysExcluded(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some((segment) => ALWAYS_EXCLUDED_SEGMENTS.has(segment));
}

function isFrontendPath(relativePath: string): boolean {
  if (!/\.(tsx|jsx)$/.test(relativePath)) return false;
  if (relativePath === 'app/server.tsx') return false;
  if (/\/route\.(tsx|jsx)$/.test(relativePath)) return false;
  return relativePath.startsWith('app/') ||
    relativePath.startsWith('components/') ||
    relativePath.startsWith('hooks/') ||
    relativePath.startsWith('lib/');
}

function isBackendPath(relativePath: string): boolean {
  return relativePath.startsWith('server/') ||
    relativePath === 'app/server.ts' ||
    relativePath === 'app/server.js' ||
    /\/route\.(ts|tsx|js|jsx|mts|cts)$/.test(relativePath);
}

function toRelativeProjectPath(projectRoot: string, absolutePath: string): string {
  return normalizePath(relative(projectRoot, absolutePath));
}

function getExtension(relativePath: string): string {
  const match = /\.[^.]+$/.exec(relativePath);
  return match?.[0] ?? '';
}
