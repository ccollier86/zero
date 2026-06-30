/**
 * client-bundle.ts
 *
 * Builds Zero's browser bundle and app-owned generated route artifacts. This
 * file owns bundle generation only; it does not hydrate React, render routes,
 * or serve static assets.
 */

import { resolve, join, relative, dirname, isAbsolute } from 'path';
import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'fs';
import { scanRoutes, hasUseClientDirective } from '../router/scanner';
import { buildRouteTree } from '../router/route-tree';
import type { RouteNode } from '../router/types';

// ─── Client Bundle Builder ─────────────────────────────────────────────────

export interface BundleResult {
  /** Absolute path to the output JS file */
  jsPath: string;
  /** URL-safe path for serving (e.g., '/_build/client.js') */
  publicPath: string;
  /** Whether the bundle was rebuilt (false if cached) */
  rebuilt: boolean;
}

export interface ClientBundleOptions {
  /** Directory for generated app-owned route manifest and client entry files. */
  generatedDir?: string;
  /** Import specifier for Zero's browser hydration runtime. */
  hydrationRuntimeImport?: string;
  /** Import alias that maps to the configured app directory. */
  appImportAlias?: string;
}

const DEFAULT_GENERATED_DIR = '.zero/generated';
const DEFAULT_HYDRATION_RUNTIME_IMPORT = '@zero/framework/react/hydrate-runtime';
const DEFAULT_APP_IMPORT_ALIAS = '@app';
const ROUTE_MANIFEST_FILE = 'route-manifest.ts';
const CLIENT_ENTRY_FILE = 'client-entry.tsx';

/**
 * Build the client-side JS bundle using Bun.build().
 *
 * The entry point is generated into `.zero/generated` so package-mode apps do
 * not need Zero source files copied into their project tree.
 *
 * The bundle includes:
 * - React + ReactDOM (for hydration)
 * - Client-side router
 * - App provider (sync + auth + state)
 * - All app/ page and layout components (code-split via manifest)
 */
export async function buildClientBundle(
  outDir: string,
  appDir: string = './app',
  options: ClientBundleOptions = {}
): Promise<BundleResult> {
  const absOut = resolve(outDir);
  const generatedDir = resolve(options.generatedDir ?? DEFAULT_GENERATED_DIR);
  const appDependencyAliasPlugin = createAppDependencyAliasPlugin(appDir);

  // Clean stale build artifacts before writing new ones.
  // Bun.build with splitting generates chunk-[hash].js files with unique hashes
  // per build. Without cleanup, old chunks accumulate and stale HTML entry points
  // can reference outdated chunks — causing runtime errors like missing tables.
  if (existsSync(absOut)) {
    const entries = readdirSync(absOut);
    for (const entry of entries) {
      // Preserve non-JS assets (e.g., styles.css) that other build steps produce
      if (entry.endsWith('.js') || entry.endsWith('.js.map')) {
        rmSync(join(absOut, entry));
      }
    }
  } else {
    mkdirSync(absOut, { recursive: true });
  }

  // Generate route manifest and client entry BEFORE Bun.build so imports are analyzed.
  generateRouteManifest({
    appDir,
    generatedDir,
    appImportAlias: options.appImportAlias ?? DEFAULT_APP_IMPORT_ALIAS,
  });
  const entrypoint = generateClientEntry({
    generatedDir,
    hydrationRuntimeImport: options.hydrationRuntimeImport ?? DEFAULT_HYDRATION_RUNTIME_IMPORT,
  });

  const result = await Bun.build({
    entrypoints: [entrypoint],
    outdir: absOut,
    naming: 'client.[hash].js',
    target: 'browser',
    format: 'esm',
    minify: process.env.NODE_ENV === 'production',
    splitting: true,
    sourcemap: process.env.NODE_ENV === 'production' ? 'none' : 'linked',
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
    },
    plugins: [appDependencyAliasPlugin],
    external: [],
  });

  if (!result.success) {
    const errors = result.logs.map((l) => l.message).join('\n');
    throw new Error(`Client bundle build failed:\n${errors}`);
  }

  // Find the main entry output
  const mainOutput = result.outputs.find((o) => o.kind === 'entry-point');
  if (!mainOutput) {
    throw new Error('No entry-point output found in bundle result');
  }

  const jsPath = mainOutput.path;
  const fileName = jsPath.split('/').pop()!;
  const publicPath = `/_build/${fileName}`;

  return { jsPath, publicPath, rebuilt: true };
}

/**
 * Resolve singleton browser dependencies from the app package, not from the
 * framework source tree. This keeps React module identity stable when Zero is
 * installed through `file:` or a symlink during package-mode development.
 */
function createAppDependencyAliasPlugin(appDir: string) {
  const appRoot = resolve(appDir, '..');
  const requireFromApp = createRequire(join(appRoot, 'package.json'));
  const cache = new Map<string, string>();

  return {
    name: 'zero-app-dependency-alias',
    setup(build: any) {
      build.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, (args: { path: string }) => {
        const cached = cache.get(args.path);
        if (cached) return { path: cached };

        let resolved: string;
        try {
          resolved = requireFromApp.resolve(args.path);
        } catch {
          throw new Error(`[client-bundle] Could not resolve "${args.path}" from ${appRoot}. Install compatible react and react-dom dependencies in the app.`);
        }

        cache.set(args.path, resolved);
        return { path: resolved };
      });
    },
  };
}

// ─── Route Manifest Generation ─────────────────────────────────────────────

export interface RouteManifestGenerationOptions {
  /** File-based app route directory to scan. */
  appDir: string;
  /** Destination directory for the generated manifest. */
  generatedDir?: string;
  /** Alias that resolves to appDir from the app tsconfig. Default: '@app'. */
  appImportAlias?: string;
}

export interface ClientEntryGenerationOptions {
  /** Destination directory for the generated browser entry. */
  generatedDir?: string;
  /** Import specifier for the hydration runtime. */
  hydrationRuntimeImport?: string;
}

/**
 * Generate a route manifest file that maps URL patterns to dynamic imports.
 *
 * The manifest contains static `import()` expressions so Bun.build can
 * analyze them and code-split each route into its own chunk.
 */
export function generateRouteManifest(options: RouteManifestGenerationOptions): string {
  const appDir = resolve(options.appDir);
  const generatedDir = resolve(options.generatedDir ?? DEFAULT_GENERATED_DIR);
  const manifestPath = join(generatedDir, ROUTE_MANIFEST_FILE);
  const appImportAlias = options.appImportAlias ?? DEFAULT_APP_IMPORT_ALIAS;
  const files = scanRoutes(appDir);
  const root = buildRouteTree(files);

  // Collect all page entries with their patterns and layout chains
  const entries: Array<{
    pattern: string;
    pageImport: string;
    layoutImports: string[];
    isClient: boolean;
  }> = [];

  collectRouteEntries(root, [], [], entries, appDir, generatedDir, appImportAlias);

  if (!existsSync(generatedDir)) {
    mkdirSync(generatedDir, { recursive: true });
  }

  // Split into client routes (have "use client") and server-only routes
  const clientEntries = entries.filter((e) => e.isClient);
  const serverPatterns = entries.filter((e) => !e.isClient).map((e) => e.pattern);

  // Build the manifest source — only client routes get import() calls
  const lines: string[] = [
    '// AUTO-GENERATED by client-bundle.ts — do not edit',
    '',
    'export interface ManifestEntry {',
    '  pattern: string;',
    '  load: () => Promise<{ default: any }>;',
    '  layouts: Array<() => Promise<{ default: any }>>;',
    '}',
    '',
    '/** Patterns for server-only pages (no JS shipped, no hydration). */',
    `export const serverRoutes: string[] = ${JSON.stringify(serverPatterns)};`,
    '',
    '/** Client pages — these hydrate on the client. */',
    'export const routes: ManifestEntry[] = [',
  ];

  for (const entry of clientEntries) {
    const layoutsStr = entry.layoutImports
      .map((imp) => `    () => import('${imp}'),`)
      .join('\n');

    lines.push('  {');
    lines.push(`    pattern: '${entry.pattern}',`);
    lines.push(`    load: () => import('${entry.pageImport}'),`);
    if (entry.layoutImports.length > 0) {
      lines.push('    layouts: [');
      lines.push(layoutsStr);
      lines.push('    ],');
    } else {
      lines.push('    layouts: [],');
    }
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');

  writeFileSync(manifestPath, lines.join('\n'));

  return manifestPath;
}

/**
 * Generate the app-specific browser entry that connects Zero's hydration
 * runtime with the generated route manifest.
 */
export function generateClientEntry(options: ClientEntryGenerationOptions = {}): string {
  const generatedDir = resolve(options.generatedDir ?? DEFAULT_GENERATED_DIR);
  const entryPath = join(generatedDir, CLIENT_ENTRY_FILE);
  const hydrationRuntimeImport = options.hydrationRuntimeImport ?? DEFAULT_HYDRATION_RUNTIME_IMPORT;

  if (!existsSync(generatedDir)) {
    mkdirSync(generatedDir, { recursive: true });
  }

  writeFileSync(entryPath, [
    '// AUTO-GENERATED by client-bundle.ts — do not edit',
    '',
    `import { startHydration } from '${hydrationRuntimeImport}';`,
    `import { routes, serverRoutes } from './${ROUTE_MANIFEST_FILE.replace(/\.ts$/, '')}';`,
    '',
    'startHydration({ routes, serverRoutes });',
    '',
  ].join('\n'));

  return entryPath;
}

/**
 * Recursively collect route entries from the tree.
 * For each page, records the pattern and layout chain from root → leaf.
 */
function collectRouteEntries(
  node: RouteNode,
  patternSegments: string[],
  layoutPaths: string[],
  entries: Array<{ pattern: string; pageImport: string; layoutImports: string[]; isClient: boolean }>,
  appDir: string,
  generatedDir: string,
  appImportAlias: string
): void {
  // Accumulate layouts at this level
  const currentLayouts = node.layoutPath
    ? [...layoutPaths, node.layoutPath]
    : layoutPaths;

  // If this node has a page, record it
  if (node.pagePath) {
    const pattern = patternSegments.length > 0
      ? '/' + patternSegments.join('/')
      : '/';

    // A client page or any inherited client layout makes the route hydrate.
    // The renderer uses the same boundary rule when deciding whether to emit
    // route data and the browser bundle script.
    const isClient = hasUseClientDirective(node.pagePath)
      || currentLayouts.some((layoutPath) => hasUseClientDirective(layoutPath));

    entries.push({
      pattern,
      pageImport: toManifestImport(node.pagePath, appDir, generatedDir, appImportAlias),
      layoutImports: currentLayouts.map((layoutPath) =>
        toManifestImport(layoutPath, appDir, generatedDir, appImportAlias)
      ),
      isClient,
    });
  }

  // Recurse into children
  for (const child of node.children.values()) {
    collectRouteEntries(
      child,
      [...patternSegments, child.segment],
      currentLayouts,
      entries,
      appDir,
      generatedDir,
      appImportAlias
    );
  }
}

/**
 * Convert an absolute app file path to the configured app import alias.
 *
 * Falls back to a relative import when a route file is outside appDir so tests
 * and custom route trees still generate analyzable dynamic import specifiers.
 */
function toManifestImport(
  absolutePath: string,
  appDir: string,
  generatedDir: string,
  appImportAlias: string
): string {
  const relativeToApp = relative(appDir, absolutePath);

  if (!relativeToApp.startsWith('..') && !isAbsolute(relativeToApp)) {
    const withoutExt = relativeToApp.replace(/\.(tsx?|jsx?)$/, '');
    return `${appImportAlias}/${withoutExt}`;
  }

  const rel = relative(generatedDir, absolutePath);
  const withoutExt = rel.replace(/\.(tsx?|jsx?)$/, '');
  return withoutExt.startsWith('.') ? withoutExt : './' + withoutExt;
}
