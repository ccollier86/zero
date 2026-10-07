/** Real Bun commands with one private extraction cache per disposable archive fixture. */
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { expect } from 'bun:test';
import type { ZeroUpdateDependencies } from '../run';

export interface LocalArchiveFixtureBun {
  run(cwd: string, args: string[]): Promise<void>;
  runCommand: NonNullable<ZeroUpdateDependencies['runCommand']>;
}

export function createLocalArchiveFixtureBun(rootDir: string): LocalArchiveFixtureBun {
  // --no-cache bypasses the manifest cache, not extracted file-archive packages.
  // Parallel fixtures share the same canonical relative archive name. Keep
  // their extraction caches separate, but retain each cache through every
  // initial/staged/canonical/frozen/rollback install without changing argv.
  const env = { ...Bun.env, BUN_INSTALL_CACHE_DIR: join(rootDir, 'bun-package-cache') };
  const runCommand: LocalArchiveFixtureBun['runCommand'] = async (argv, options) => {
    const child = Bun.spawn(argv, {
      cwd: options.cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { stdout, stderr, exitCode };
  };
  return {
    runCommand,
    run: async (cwd, args) => {
      const result = await runCommand(['bun', ...args], { cwd, stdio: 'pipe' });
      if (result.exitCode !== 0) {
        throw new Error(`Fixture bun ${args[0]} failed (${result.exitCode}):\n${result.stdout}${result.stderr}`);
      }
    },
  };
}

/** These generated framework packages contain only flat package.json/index.js files. */
export async function readFixtureFrameworkFiles(appDir: string): Promise<Record<string, string>> {
  const packageDir = join(appDir, 'node_modules', '@zero', 'framework');
  const names = (await readdir(packageDir)).filter((name) => name !== 'node_modules').sort();
  return Object.fromEntries(await Promise.all(names.map(async (name) =>
    [name, new Bun.CryptoHasher('sha256').update(await Bun.file(join(packageDir, name)).bytes()).digest('hex')] as const)));
}

export async function expectFixtureFrameworkArchive(appDir: string, archivePath: string): Promise<Record<string, string>> {
  const installedFiles = await readFixtureFrameworkFiles(appDir);
  const archivedFiles = await new Bun.Archive(await Bun.file(archivePath).bytes()).files();
  expect(Object.keys(installedFiles).sort()).toEqual(
    [...archivedFiles.keys()].map((name) => name.slice('package/'.length)).sort(),
  );
  for (const [name, file] of archivedFiles) {
    expect(installedFiles[name.slice('package/'.length)]).toBe(
      new Bun.CryptoHasher('sha256').update(new Uint8Array(await file.arrayBuffer())).digest('hex'),
    );
  }
  return installedFiles;
}
