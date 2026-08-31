/**
 * scaffold.ts
 *
 * Creates app-owned Zero project files from the package-mode starter. This file
 * owns filesystem scaffolding only; CLI argument parsing and human output live
 * in run.ts.
 */

import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertRegularDirectoryTree, resolveSafeScaffoldPaths } from './scaffold-safety';
import { commitStagedScaffold } from './scaffold-transaction';

/** Options for creating a new Zero app directory. */
export interface ScaffoldZeroAppOptions {
  targetDir: string;
  packageName?: string;
  force?: boolean;
  /** Complete fallible preparation in staging before the target swap. */
  prepareStagedApp?(stagingDir: string): Promise<void>;
  zeroDependency?: string;
  templateDir?: string;
}

/** Result returned after writing a new Zero app. */
export interface ScaffoldZeroAppResult {
  targetDir: string;
  packageName: string;
  filesWritten: string[];
}

const TEMPLATE_RELATIVE_DIR = '../../examples/package-mode';

/**
 * Create a new Zero app from the package-mode starter template.
 *
 * Existing non-empty directories are rejected unless `force` is true. The
 * generated app uses package imports only, so it can move out of the framework
 * repository once dependencies are installed.
 */
export async function scaffoldZeroApp(options: ScaffoldZeroAppOptions): Promise<ScaffoldZeroAppResult> {
  const templateInput = options.templateDir ?? fileURLToPath(new URL(TEMPLATE_RELATIVE_DIR, import.meta.url));
  const { targetDir, targetSnapshot, templateDir } = await resolveSafeScaffoldPaths(
    options.targetDir,
    templateInput,
    options.force === true
  );
  const packageName = normalizePackageName(options.packageName ?? basename(targetDir));
  await mkdir(dirname(targetDir), { recursive: true });
  const stagingDir = await mkdtemp(join(dirname(targetDir), `.${basename(targetDir)}.zero-stage-`));
  let committed = false;

  try {
    const filesWritten: string[] = [];
    await copyTemplate(templateDir, stagingDir, filesWritten);
    await assertRegularDirectoryTree(stagingDir, 'Copied template');
    await ensureGeneratedDirectories(stagingDir);
    await writeGeneratedPackageJson(stagingDir, packageName, options.zeroDependency);
    filesWritten.push('package.json');
    await writeGeneratedTsConfig(stagingDir);
    filesWritten.push('tsconfig.json');
    await writeGeneratedGitignore(stagingDir);
    filesWritten.push('.gitignore');
    await writeGeneratedReadme(stagingDir, packageName);
    filesWritten.push('README.md');
    await options.prepareStagedApp?.(stagingDir);
    await commitStagedScaffold(stagingDir, targetDir, targetSnapshot);
    committed = true;
    return { targetDir, packageName, filesWritten: filesWritten.sort() };
  } finally {
    if (!committed) await rm(stagingDir, { recursive: true, force: true });
  }
}

async function copyTemplate(templateDir: string, targetDir: string, filesWritten: string[]): Promise<void> {
  await cp(templateDir, targetDir, {
    recursive: true,
    force: true,
    filter(source) {
      const name = basename(source);
      return name !== 'README.md' && name !== '.git';
    },
  });

  await collectFiles(targetDir, targetDir, filesWritten);
}

async function collectFiles(rootDir: string, currentDir: string, files: string[]): Promise<void> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(rootDir, entryPath, files);
      continue;
    }
    if (entry.isFile()) files.push(entryPath.slice(rootDir.length + 1));
  }
}

async function ensureGeneratedDirectories(targetDir: string): Promise<void> {
  await Promise.all([
    mkdir(join(targetDir, 'components'), { recursive: true }),
    mkdir(join(targetDir, 'hooks'), { recursive: true }),
    mkdir(join(targetDir, 'lib'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'plugins'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'middleware'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'endpoints'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'routes'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'resources'), { recursive: true }),
  ]);
}

async function writeGeneratedPackageJson(
  targetDir: string,
  packageName: string,
  zeroDependency?: string
): Promise<void> {
  const packageJson = {
    name: packageName,
    version: '0.1.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'bun --watch app/server.ts',
      start: 'bun app/server.ts',
      build: 'bun build app/server.ts --target bun --outdir dist',
      typecheck: 'tsc --noEmit',
      doctor: 'zero doctor --config ./zero.config.ts',
      migrate: 'zero migrate --db ./data/app.db',
      'migrate:status': 'zero migrate --status --db ./data/app.db',
      'migrate:plan': 'zero migrate --plan --schema ./db/schema.ts --db ./data/app.db',
      'pdf:install': 'zero pdf install',
      'pdf:status': 'zero pdf status',
    },
    dependencies: {
      '@zero/framework': zeroDependency ?? await getDefaultZeroDependency(),
      elysia: '^1.4.27',
      react: '19.2.4',
      'react-dom': '19.2.4',
    },
    devDependencies: {
      '@types/bun': 'latest',
      '@types/react': '19.2.14',
      '@types/react-dom': '19.2.3',
      typescript: '^5.7.0',
    },
  };

  await writeFile(join(targetDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function writeGeneratedTsConfig(targetDir: string): Promise<void> {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: ['bun'],
      strict: true,
      skipLibCheck: true,
      preserveSymlinks: true,
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      baseUrl: '.',
      paths: {
        '@/*': ['./*'],
        '@app/*': ['./app/*'],
        '@/components/*': [
          './components/*',
          './node_modules/@zero/framework/src/components/*',
        ],
        '@/hooks/*': ['./hooks/*', './node_modules/@zero/framework/src/hooks/*'],
        '@/lib/*': ['./lib/*', './node_modules/@zero/framework/src/lib/*'],
        react: ['./node_modules/@types/react'],
        'react/jsx-runtime': ['./node_modules/@types/react/jsx-runtime'],
        'react/jsx-dev-runtime': ['./node_modules/@types/react/jsx-dev-runtime'],
        'react-dom': ['./node_modules/@types/react-dom'],
        'react-dom/client': ['./node_modules/@types/react-dom/client'],
        'react-dom/server': ['./node_modules/@types/react-dom/server'],
      },
    },
    include: [
      'app/**/*.ts',
      'app/**/*.tsx',
      'components/**/*.ts',
      'components/**/*.tsx',
      'hooks/**/*.ts',
      'hooks/**/*.tsx',
      'lib/**/*.ts',
      'lib/**/*.tsx',
      'server/**/*.ts',
      'server/**/*.tsx',
      'db/**/*.ts',
      'zero.config.ts',
      '.zero/generated/**/*.ts',
      '.zero/generated/**/*.tsx',
    ],
    exclude: ['node_modules', 'dist', '.build'],
  };

  await writeFile(join(targetDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
}

async function writeGeneratedGitignore(targetDir: string): Promise<void> {
  const body = `node_modules
dist
.build
.zero
data
.env
*.db
*.db-shm
*.db-wal
.DS_Store
`;

  await writeFile(join(targetDir, '.gitignore'), body);
}

async function getDefaultZeroDependency(): Promise<string> {
  const packagePath = resolve(import.meta.dir, '../../package.json');
  const raw = await readFile(packagePath, 'utf8');
  const packageJson = JSON.parse(raw) as { version?: string };
  return `^${packageJson.version ?? '1.0.0'}`;
}

async function writeGeneratedReadme(targetDir: string, packageName: string): Promise<void> {
  const body = `# ${packageName}

Zero app generated from the package-mode starter. App code lives in this
project; framework runtime code comes from \`@zero/framework\`.

The starter is intentionally blank and public by default: \`app/page.tsx\`
renders the first page, \`db/schema.ts\` starts with no app tables, and
\`zero.config.ts\` opts into platform systems as you enable them.

## Setup

\`\`\`sh
cp .env.example .env
bun install
bun run dev
\`\`\`

The dev server starts from \`app/server.ts\`. Runtime settings live in
\`zero.config.ts\`. Zero itself stays in \`node_modules/@zero/framework\`; do
not copy framework source into this project.

## Commands

\`\`\`sh
bun install
bun run dev
\`\`\`

Useful checks:

\`\`\`sh
bun run typecheck
bun run doctor
bun run migrate:status
\`\`\`

\`bun run doctor\` checks both Zero configuration and app-owned source usage.
It warns when code bypasses Zero components/services, imports framework
internals, uses raw frontend controls where Zero primitives fit, logs through
\`console\` in backend app code, or grows a file beyond the responsibility
threshold. Use \`bun run doctor -- --strict\` in CI or agent hooks.

## Updating Zero

Stop the app/dev server, then update the framework dependency without
regenerating this project:

\`\`\`sh
bun run zero update --project .
bun run zero update --project . --dry-run
\`\`\`

Add \`--latest\` only when intentionally moving to the newest published
release. If the installed framework predates this command, bootstrap it with
\`bunx --package @zero/framework@latest zero update --project .\`. If this app
uses a framework archive from a local Zero checkout, run that checkout's
\`zero-update\` wrapper instead; it packs the checkout and defaults the project
to the current directory. The ignored
\`.zero/framework/zero-framework.tgz\` archive is regenerated on each local
update.

The project must already have exactly one \`bun.lock\` or \`bun.lockb\`, even for
a dry-run. The updater directly manages only Zero dependency artifacts and
package-manager install state. In its default mode it does not rewrite
app-owned source, configuration, environment files, databases, or storage, and
it runs no app-defined scripts. \`--check\` executes this project's existing
typecheck and Doctor scripts; review them first because their side effects are
outside updater rollback. Zero itself never selects a migration command. Run
\`bun run migrate:plan\` separately and intentionally against the correct
database or a safe copy before applying database changes.

Never run \`create-zero --force\` or \`zero-new --force\` to update this app.
Those are scaffold commands and may replace a non-empty project.

## Project Shape

| Path | Purpose |
| --- | --- |
| \`app/\` | File-router pages, layouts, and the server entry. |
| \`server/endpoints/\` | Single Zero-native HTTP endpoints. |
| \`server/routes/\` | Grouped routers and raw Elysia escape-hatch plugins. |
| \`server/middleware/\` | Named middleware and route matchers. |
| \`server/plugins/\` | Advanced app plugins. |
| \`server/resources/\` | Resource definitions discovered by Zero at startup. |
| \`components/\` | App-owned UI overrides or feature components. |
| \`hooks/\` | App-owned React hooks. |
| \`lib/\` | App-owned client/server helpers. |
| \`db/schema.ts\` | Shared data model definitions. |
| \`zero.config.ts\` | Platform systems, paths, auth mode, sitemap, and runtime settings. |
| \`.zero/generated/\` | Generated client/router build glue. Ignored by git. |

Use package imports:

\`\`\`ts
import { createApp } from '@zero/framework/server';
import { useCollection } from '@zero/framework/react/hooks';
import { Button } from '@zero/framework/components/ui/button';
\`\`\`

Use Zero components, hooks, backend services, and config surfaces before
creating custom replacements. The framework guide is available at
\`node_modules/@zero/framework/docs/start-here.md\` when using a local or
published package.

\`/sitemap.xml\` is enabled from public static file-router pages. Add dynamic
URLs through \`sitemap.entries\` in \`zero.config.ts\` when your app can enumerate
them.
`;

  await writeFile(join(targetDir, 'README.md'), body);
}

function normalizePackageName(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/\/-+/g, '/')
    .replace(/-+\//g, '/');

  return normalized || 'zero-app';
}
