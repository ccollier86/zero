import { resolve, relative, dirname, basename } from 'path';
import { readFileSync } from 'fs';

// ─── Types ─────────────────────────────────────────────────────────────────

/**
 * A discovered route file from the app/ directory.
 */
export interface ScannedFile {
  /** Absolute file path */
  absolutePath: string;
  /** Path relative to appDir (e.g., 'about/page.tsx') */
  relativePath: string;
  /** Route segments (e.g., ['about']) */
  segments: string[];
  /** File type: page, layout, route, not-found */
  kind: 'page' | 'layout' | 'route' | 'not-found';
}

// ─── Scanner ───────────────────────────────────────────────────────────────

const ROUTE_FILES = new Set([
  'page.tsx',
  'page.ts',
  'layout.tsx',
  'layout.ts',
  'route.ts',
  'route.tsx',
  'not-found.tsx',
  'not-found.ts',
]);

/**
 * Scan the app directory for route files using Bun.Glob.
 *
 * Discovers:
 * - `page.tsx` — page components
 * - `layout.tsx` — layout wrappers
 * - `route.ts` — API handlers
 * - `not-found.tsx` — 404 pages
 *
 * Ignores files starting with _ (private), files inside components/,
 * and test files.
 */
export function scanRoutes(appDir: string): ScannedFile[] {
  const absDir = resolve(appDir);
  const glob = new Bun.Glob('**/{page,layout,route,not-found}.{ts,tsx}');
  const files: ScannedFile[] = [];

  for (const match of glob.scanSync({ cwd: absDir })) {
    // Skip private directories
    if (match.includes('/_') || match.startsWith('_')) continue;
    // Skip test files
    if (match.includes('.test.') || match.includes('.spec.')) continue;

    const absolutePath = resolve(absDir, match);
    const dir = dirname(match);
    const file = basename(match);

    // Determine kind
    let kind: ScannedFile['kind'];
    if (file.startsWith('page.')) kind = 'page';
    else if (file.startsWith('layout.')) kind = 'layout';
    else if (file.startsWith('route.')) kind = 'route';
    else if (file.startsWith('not-found.')) kind = 'not-found';
    else continue;

    // Build segments — strip route groups (parenthesized dirs)
    const segments = dir === '.'
      ? []
      : dir.split('/').filter((s) => !s.startsWith('('));

    files.push({
      absolutePath,
      relativePath: match,
      segments,
      kind,
    });
  }

  return files;
}

// ─── "use client" Detection ───────────────────────────────────────────────

/**
 * Check if a file has a "use client" directive at the top.
 *
 * Files with "use client" are client components — their JS is shipped
 * to the browser and they hydrate on the client.
 *
 * Files without "use client" are server components — they render to
 * HTML on the server and ship zero JS to the client.
 */
export function hasUseClientDirective(filePath: string): boolean {
  const content = readFileSync(filePath, 'utf-8');
  const trimmed = content.trimStart();
  // Check for "use client" or 'use client' as the first statement
  if (trimmed.startsWith('"use client"') || trimmed.startsWith("'use client'")) {
    return true;
  }
  return false;
}
