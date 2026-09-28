/** Keep package-private #zero imports mapped to their exact source files. */

import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(rootDir, 'src');
const packagePath = join(rootDir, 'package.json');
const checkOnly = process.argv.includes('--check');
const specifierPattern = /['"](#zero\/[^'"]+)['"]/g;

const sourceFiles = await collectSourceFiles(sourceDir);
const specifiers = new Set<string>();
for (const sourceFile of sourceFiles) {
  const source = await readFile(sourceFile, 'utf8');
  for (const match of source.matchAll(specifierPattern)) specifiers.add(match[1]!);
}

const imports: Record<string, string> = {};
for (const specifier of [...specifiers].sort()) {
  const sourcePath = await resolvePrivateImport(specifier);
  if (!sourcePath) throw new Error(`Cannot resolve package-private import: ${specifier}`);
  imports[specifier] = `./${relative(rootDir, sourcePath).split('\\').join('/')}`;
}

const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
  imports?: Record<string, string>;
  [key: string]: unknown;
};
if (checkOnly) {
  if (JSON.stringify(packageJson.imports ?? {}) !== JSON.stringify(imports)) {
    throw new Error('package.json private imports are stale; run bun run private-imports:sync');
  }
} else {
  packageJson.imports = imports;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectSourceFiles(pathname));
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) files.push(pathname);
  }
  return files;
}

async function resolvePrivateImport(specifier: string): Promise<string | null> {
  const base = join(sourceDir, specifier.slice('#zero/'.length));
  for (const candidate of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (await stat(candidate).then((value) => value.isFile(), () => false)) return candidate;
  }
  return null;
}
