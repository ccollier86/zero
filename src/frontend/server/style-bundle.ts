/**
 * style-bundle.ts
 *
 * Builds Zero's platform stylesheet for SSR pages. This file owns Tailwind
 * scanning/compilation and hashed CSS output only; it does not render routes,
 * serve files, or define design tokens.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const PLATFORM_SOURCE_DIR = resolve(import.meta.dir, '../..');
const PLATFORM_CSS_ENTRYPOINT = resolve(import.meta.dir, '../styles/globals.css');
const STYLE_FILE_PREFIX = 'platform.';
const STYLE_FILE_SUFFIX = '.css';
const runtimeRequire = createRequire(import.meta.url);

type SourceEntry = {
  base: string;
  pattern: string;
  negated: boolean;
};

type TailwindCompiler = {
  build(candidates: string[]): string;
};

type TailwindNodeModule = {
  compile(
    css: string,
    options: {
      base: string;
      from: string;
      onDependency(path: string): void;
    }
  ): Promise<TailwindCompiler>;
};

type TailwindOxideModule = {
  Scanner: new (options: { sources: SourceEntry[] }) => { scan(): string[] };
};

export interface StyleBundleResult {
  /** Absolute path to the generated stylesheet. */
  cssPath: string;
  /** URL-safe path for serving from /_build. */
  publicPath: string;
  /** Whether the stylesheet was rebuilt. */
  rebuilt: boolean;
}

/**
 * Build the platform CSS bundle and return the public URL.
 *
 * Tailwind scans both platform source and the app directory so route/page
 * classes are available without app authors managing a separate CSS pipeline.
 */
export async function buildPlatformStyles(
  outDir: string,
  appDir: string = './app'
): Promise<StyleBundleResult> {
  const absOut = resolve(outDir);
  if (!existsSync(absOut)) mkdirSync(absOut, { recursive: true });

  removeStaleStyleBundles(absOut);

  const entrypoint = PLATFORM_CSS_ENTRYPOINT;
  const css = readFileSync(entrypoint, 'utf8');
  const { compile } = loadTailwindCompiler();
  const compiler = await compile(css, {
    base: dirname(entrypoint),
    from: entrypoint,
    onDependency() {},
  });
  const candidates = scanTailwindCandidates(appDir);
  const output = compiler.build(candidates);
  const hash = createHash('sha256').update(output).digest('hex').slice(0, 12);
  const fileName = `${STYLE_FILE_PREFIX}${hash}${STYLE_FILE_SUFFIX}`;
  const cssPath = join(absOut, fileName);

  writeFileSync(cssPath, output);

  return {
    cssPath,
    publicPath: `/_build/${fileName}`,
    rebuilt: true,
  };
}

/**
 * Scan platform and app sources for Tailwind candidates.
 *
 * Missing app directories are ignored so backend-only apps can still start and
 * receive the platform base stylesheet.
 */
export function scanTailwindCandidates(appDir: string = './app'): string[] {
  const { Scanner } = loadTailwindScanner();
  const sources: SourceEntry[] = [
    { base: PLATFORM_SOURCE_DIR, pattern: '**/*.{ts,tsx,js,jsx}', negated: false },
  ];
  const resolvedAppDir = resolve(appDir);

  if (existsSync(resolvedAppDir)) {
    sources.push({ base: resolvedAppDir, pattern: '**/*.{ts,tsx,js,jsx}', negated: false });
  }

  return new Scanner({ sources }).scan();
}

/** Remove old hashed platform styles while preserving unrelated build assets. */
function removeStaleStyleBundles(outDir: string): void {
  for (const entry of readdirSync(outDir)) {
    if (entry.startsWith(STYLE_FILE_PREFIX) && entry.endsWith(STYLE_FILE_SUFFIX)) {
      rmSync(join(outDir, entry));
    }
  }
}

/**
 * Load Tailwind's compiler at runtime.
 *
 * Keeping this behind createRequire prevents Bun's app/server bundle from
 * statically crawling native Lightning CSS internals that must remain
 * runtime-resolved from node_modules.
 */
function loadTailwindCompiler(): TailwindNodeModule {
  const packageName = '@tailwindcss/node';
  return runtimeRequire(packageName) as TailwindNodeModule;
}

/** Load Tailwind's native scanner at runtime for the same bundling reason. */
function loadTailwindScanner(): TailwindOxideModule {
  const packageName = '@tailwindcss/oxide';
  return runtimeRequire(packageName) as TailwindOxideModule;
}
