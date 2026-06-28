/**
 * bump-version.ts
 *
 * Owns Zero's package version metadata update command. This CLI validates a
 * requested semver value and updates package.json only; it does not create git
 * commits, tags, changelog entries, or release artifacts.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

type PackageJson = {
  name?: string;
  version?: string;
  [key: string]: unknown;
};

/**
 * Return the requested release version from CLI arguments.
 *
 * Exits the process with usage guidance when no valid semver argument is
 * present, because writing an invalid package version would break downstream
 * package tooling.
 */
function parseRequestedVersion(args: string[]): string {
  const version = args.find((arg) => !arg.startsWith('-'));

  if (!version || !SEMVER_PATTERN.test(version)) {
    console.error('Usage: bun run version:bump -- <semver>');
    console.error('Example: bun run version:bump -- 1.0.0');
    process.exit(1);
  }

  return version;
}

/**
 * Update package.json with the requested version.
 *
 * Returns the previous version so release scripts and humans can include it in
 * logs without reparsing the file.
 */
async function updatePackageVersion(packagePath: string, version: string): Promise<string | undefined> {
  const rawPackage = await readFile(packagePath, 'utf8');
  const packageJson = JSON.parse(rawPackage) as PackageJson;
  const previousVersion = packageJson.version;

  packageJson.version = version;

  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

  return previousVersion;
}

const version = parseRequestedVersion(Bun.argv.slice(2));
const packagePath = resolve(import.meta.dir, '..', 'package.json');
const previousVersion = await updatePackageVersion(packagePath, version);

console.log(`Updated package.json version ${previousVersion ?? '(unset)'} -> ${version}`);
