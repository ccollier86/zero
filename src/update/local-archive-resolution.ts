/**
 * Forces Bun to resolve a replaced local archive as a new package source.
 *
 * Reusing the canonical file specifier lets Bun retain the previous archive's
 * dependency metadata even when the tarball bytes and integrity changed. A
 * unique, short-lived specifier makes Bun read the new package manifest. The
 * updater then restores the public specifier without changing the resolved
 * dependency graph Bun produced.
 */

import { LOCAL_FRAMEWORK_DEPENDENCY } from '../create-zero/local-framework-package';
import { bindBunLockToLocalArchive } from './bun-lock-integrity';

const FRAMEWORK_PACKAGE = '@zero/framework';
const CANONICAL_ARCHIVE_REFERENCE = './.zero/framework/zero-framework.tgz';
const SAFE_TOKEN = /^[0-9a-f-]+$/;

type DependencySection =
  | 'dependencies'
  | 'devDependencies'
  | 'optionalDependencies'
  | 'peerDependencies';

export interface LocalArchiveResolutionReference {
  archiveRelativePath: string;
  dependencySpecifier: string;
}

export function createLocalArchiveResolutionReference(
  token: string
): LocalArchiveResolutionReference {
  if (!SAFE_TOKEN.test(token)) {
    throw new Error('[zero update] Refusing an unsafe local archive resolution token');
  }
  const archiveRelativePath = `./.zero/framework/zero-framework-update-${token}.tgz`;
  return {
    archiveRelativePath,
    dependencySpecifier: `file:${archiveRelativePath}`,
  };
}

export function createStagedPackageManifest(
  packageJson: Record<string, unknown>,
  dependencySection: DependencySection,
  reference: LocalArchiveResolutionReference
): string {
  const staged = structuredClone(packageJson);
  const dependencies = staged[dependencySection];
  if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw new Error(
      `[zero update] Missing ${dependencySection} while staging the local framework update`
    );
  }
  const values = dependencies as Record<string, unknown>;
  if (values[FRAMEWORK_PACKAGE] !== LOCAL_FRAMEWORK_DEPENDENCY) {
    throw new Error('[zero update] Local framework dependency changed while staging the update');
  }
  values[FRAMEWORK_PACKAGE] = reference.dependencySpecifier;
  return `${JSON.stringify(staged, null, 2)}\n`;
}

export function canonicalizeResolvedLocalArchiveLock(
  lockText: string,
  reference: LocalArchiveResolutionReference,
  archiveBytes: Uint8Array
): string {
  const stagedDependency = JSON.stringify(reference.dependencySpecifier);
  const canonicalDependency = JSON.stringify(LOCAL_FRAMEWORK_DEPENDENCY);
  const stagedResolution = `${FRAMEWORK_PACKAGE}@${reference.archiveRelativePath}`;
  const canonicalResolution = `${FRAMEWORK_PACKAGE}@${CANONICAL_ARCHIVE_REFERENCE}`;

  assertSingleOccurrence(lockText, stagedDependency, 'staged dependency specifier');
  assertSingleOccurrence(lockText, stagedResolution, 'staged package resolution');

  const normalized = lockText
    .replace(stagedDependency, canonicalDependency)
    .replace(stagedResolution, canonicalResolution);
  if (normalized.includes(reference.archiveRelativePath)) {
    throw new Error('[zero update] Staged local archive reference remained in bun.lock');
  }
  return bindBunLockToLocalArchive(normalized, archiveBytes);
}

function assertSingleOccurrence(text: string, value: string, label: string): void {
  const count = text.split(value).length - 1;
  if (count !== 1) {
    throw new Error(`[zero update] Expected one ${label} in bun.lock; found ${count}`);
  }
}
