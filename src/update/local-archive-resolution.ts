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

/** Create one process-owned archive alias; never accept paths or arbitrary names as tokens. */
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

/** Stage only the framework declaration and its optional exact matching root override. */
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
  if (hasManagedLocalArchiveOverride(packageJson)) {
    (staged.overrides as Record<string, unknown>)[FRAMEWORK_PACKAGE] = reference.dependencySpecifier;
  }
  return `${JSON.stringify(staged, null, 2)}\n`;
}

/** Admit only an exact matching root override; unrelated package overrides remain untouched. */
export function hasManagedLocalArchiveOverride(packageJson: Record<string, unknown>): boolean {
  const overrides = Object.hasOwn(packageJson, 'overrides') ? packageJson.overrides : undefined;
  if (overrides === undefined) return false;
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('[zero update] Root overrides must be an object while updating the local framework');
  }
  const value = Object.hasOwn(overrides, FRAMEWORK_PACKAGE)
    ? (overrides as Record<string, unknown>)[FRAMEWORK_PACKAGE] : undefined;
  if (value === undefined) return false;
  if (value !== LOCAL_FRAMEWORK_DEPENDENCY) {
    throw new Error(
      `[zero update] Root ${FRAMEWORK_PACKAGE} override must match ${LOCAL_FRAMEWORK_DEPENDENCY}`
    );
  }
  return true;
}

/** Canonicalize admitted root declarations and one package tuple, preserving peer ranges and archive integrity. */
export function canonicalizeResolvedLocalArchiveLock(
  lockText: string,
  reference: LocalArchiveResolutionReference,
  archiveBytes: Uint8Array
): string {
  const stagedDependency = JSON.stringify(reference.dependencySpecifier);
  const canonicalDependency = JSON.stringify(LOCAL_FRAMEWORK_DEPENDENCY);
  const stagedResolution = `${FRAMEWORK_PACKAGE}@${reference.archiveRelativePath}`;
  const canonicalResolution = `${FRAMEWORK_PACKAGE}@${CANONICAL_ARCHIVE_REFERENCE}`;

  // Bun preserves workspace peer ranges. Only the root declaration and its
  // optional matching override may point at the private staging reference.
  const specifierCount = assertStagedLockDeclarations(lockText, reference);
  assertOccurrenceCount(lockText, stagedDependency, specifierCount, 'staged dependency specifier');
  assertSingleOccurrence(lockText, stagedResolution, 'staged package resolution');

  const stagedProperty = new RegExp(`("@zero/framework"\\s*:\\s*)${escapeRegExp(stagedDependency)}`, 'g');
  let changedDeclarations = 0;
  const normalized = lockText
    .replace(stagedProperty, (_entry, prefix: string) => {
      changedDeclarations += 1;
      return `${prefix}${canonicalDependency}`;
    })
    .replace(stagedResolution, canonicalResolution);
  if (changedDeclarations !== specifierCount) {
    throw new Error('[zero update] Staged dependency declarations could not be canonicalized safely');
  }
  if (normalized.includes(reference.archiveRelativePath)) {
    throw new Error('[zero update] Staged local archive reference remained in bun.lock');
  }
  return bindBunLockToLocalArchive(normalized, archiveBytes);
}

function assertStagedLockDeclarations(
  lockText: string,
  reference: LocalArchiveResolutionReference
): number {
  let lock: Record<string, unknown>;
  try {
    lock = Bun.JSON5.parse(lockText) as Record<string, unknown>;
    if (!record(lock)) throw new Error('not an object');
  } catch {
    throw new Error('[zero update] Cannot validate staged dependency specifier in invalid bun.lock');
  }
  const workspaces = record(lock.workspaces);
  const root = record(workspaces?.['']);
  const sections: DependencySection[] = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
  const declarations = sections.filter(
    (section) => record(root?.[section])?.[FRAMEWORK_PACKAGE] === reference.dependencySpecifier
  );
  if (declarations.length !== 1) {
    throw new Error(`[zero update] Expected one staged dependency specifier in the root bun.lock workspace; found ${declarations.length}`);
  }
  const override = record(lock.overrides)?.[FRAMEWORK_PACKAGE];
  if (override !== undefined && override !== reference.dependencySpecifier) {
    throw new Error('[zero update] Root framework override did not resolve the staged local archive');
  }
  const tuple = record(lock.packages)?.[FRAMEWORK_PACKAGE];
  if (!Array.isArray(tuple) || tuple[0] !== `${FRAMEWORK_PACKAGE}@${reference.archiveRelativePath}`) {
    throw new Error('[zero update] Expected one staged package resolution for the managed framework in bun.lock; found 0');
  }
  return 1 + Number(override !== undefined);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function assertSingleOccurrence(text: string, value: string, label: string): void {
  assertOccurrenceCount(text, value, 1, label);
}

function assertOccurrenceCount(text: string, value: string, expected: number, label: string): void {
  const count = text.split(value).length - 1;
  if (count !== expected) {
    throw new Error(`[zero update] Expected ${expected === 1 ? 'one' : expected} ${label} in bun.lock; found ${count}`);
  }
}
