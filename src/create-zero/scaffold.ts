/**
 * scaffold.ts
 *
 * Creates app-owned Zero project files from the package-mode fixture. This file
 * owns filesystem scaffolding only; CLI argument parsing and human output live
 * in run.ts.
 */

import { existsSync } from 'node:fs';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Options for creating a new Zero app directory. */
export interface ScaffoldZeroAppOptions {
  targetDir: string;
  packageName?: string;
  force?: boolean;
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
 * Create a new Zero app from the package-mode fixture template.
 *
 * Existing non-empty directories are rejected unless `force` is true. The
 * generated app uses package imports only, so it can move out of the framework
 * repository once dependencies are installed.
 */
export async function scaffoldZeroApp(options: ScaffoldZeroAppOptions): Promise<ScaffoldZeroAppResult> {
  const targetDir = resolve(options.targetDir);
  const templateDir = resolve(options.templateDir ?? fileURLToPath(new URL(TEMPLATE_RELATIVE_DIR, import.meta.url)));
  const packageName = normalizePackageName(options.packageName ?? basename(targetDir));

  await assertCanWriteTarget(targetDir, options.force === true);
  if (existsSync(targetDir) && options.force === true) {
    await rm(targetDir, { recursive: true, force: true });
  }
  await mkdir(targetDir, { recursive: true });

  const filesWritten: string[] = [];
  await copyTemplate(templateDir, targetDir, filesWritten);
  await ensureGeneratedDirectories(targetDir);
  await writeGeneratedPackageJson(targetDir, packageName, options.zeroDependency);
  filesWritten.push('package.json');
  await writeGeneratedTsConfig(targetDir);
  filesWritten.push('tsconfig.json');
  await writeGeneratedGitignore(targetDir);
  filesWritten.push('.gitignore');
  await writeGeneratedReadme(targetDir, packageName);
  filesWritten.push('README.md');

  return {
    targetDir,
    packageName,
    filesWritten: filesWritten.sort(),
  };
}

async function assertCanWriteTarget(targetDir: string, force: boolean): Promise<void> {
  if (!existsSync(targetDir)) return;

  const entries = await readdir(targetDir);
  const visibleEntries = entries.filter((entry) => entry !== '.DS_Store');
  if (visibleEntries.length > 0 && !force) {
    throw new Error(`[create-zero] Target directory is not empty: ${targetDir}`);
  }
}

async function copyTemplate(templateDir: string, targetDir: string, filesWritten: string[]): Promise<void> {
  await cp(templateDir, targetDir, {
    recursive: true,
    force: true,
    filter(source) {
      return basename(source) !== 'README.md';
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
    mkdir(join(targetDir, 'server', 'plugins'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'middleware'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'endpoints'), { recursive: true }),
    mkdir(join(targetDir, 'server', 'routes'), { recursive: true }),
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
      esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      jsx: 'react-jsx',
      jsxImportSource: 'react',
      baseUrl: '.',
      paths: {
        '@/*': ['./*'],
        '@app/*': ['./app/*'],
        '@/components/*': ['./components/*', './node_modules/@zero/framework/src/components/*'],
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

Zero app generated from the package-mode starter.

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

App code lives in \`app/\`, \`server/endpoints/\`, \`server/routes/\`,
\`server/middleware/\`, \`server/plugins/\`, \`db/schema.ts\`, and
\`zero.config.ts\`. Zero framework code stays in \`node_modules/@zero/framework\`.
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
