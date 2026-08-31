/** Path and template safety checks performed before scaffolding mutates disk. */

import { lstat, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  assertPathsDoNotOverlap,
  assertTargetIsNarrow,
  isMissing,
  pathDetails,
  resolveProspectivePath,
} from './scaffold-path-safety';

export interface SafeScaffoldPaths {
  targetDir: string;
  targetSnapshot: TargetSnapshot;
  templateDir: string;
}

export interface TargetSnapshot {
  ctimeNs?: bigint;
  dev?: bigint;
  exists: boolean;
  ino?: bigint;
  mtimeNs?: bigint;
}

/** Resolve symlinked ancestors, validate the template, and reject unsafe targets. */
export async function resolveSafeScaffoldPaths(
  targetInput: string,
  templateInput: string,
  force: boolean
): Promise<SafeScaffoldPaths> {
  const unresolvedTarget = resolve(targetInput);
  const unresolvedTemplate = resolve(templateInput);
  await assertTargetType(unresolvedTarget);
  await assertRegularDirectoryTree(unresolvedTemplate, 'Template');
  await assertNoNestedGitRepositories(unresolvedTemplate);

  const targetDir = await resolveProspectivePath(unresolvedTarget);
  const templateDir = await realpath(unresolvedTemplate);
  await assertTargetIsNarrow(targetDir);
  assertPathsDoNotOverlap(targetDir, templateDir);

  const targetDetails = await pathDetails(targetDir);
  if (targetDetails) {
    const rootGit = await pathDetails(join(targetDir, '.git'));
    if (rootGit || force) await assertTargetContainsNoGitRepositories(targetDir);
    const entries = (await readdir(targetDir)).filter((entry) => entry !== '.DS_Store');
    if (entries.length > 0 && !force) {
      throw new Error(`[create-zero] Target directory is not empty: ${targetDir}`);
    }
  }
  const targetSnapshot = targetDetails
    ? {
        ctimeNs: targetDetails.ctimeNs,
        dev: targetDetails.dev,
        exists: true,
        ino: targetDetails.ino,
        mtimeNs: targetDetails.mtimeNs,
      }
    : { exists: false };
  return { targetDir, targetSnapshot, templateDir };
}

async function containsGitMetadata(path: string): Promise<boolean> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === '.git') return true;
    if (entry.isDirectory() && await containsGitMetadata(join(path, entry.name))) return true;
  }
  return false;
}

/** Re-scan immediately before replacement so a nested checkout cannot be erased. */
export async function assertTargetContainsNoGitRepositories(path: string): Promise<void> {
  if (await containsGitMetadata(path)) {
    throw new Error(
      `[create-zero] Refusing to replace a directory containing a Git repository: ${path}`
    );
  }
}

async function assertNoNestedGitRepositories(path: string, root = path): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.name === '.git') {
      if (path !== root) {
        throw new Error(
          `[create-zero] Template contains a nested Git repository: ${path}`
        );
      }
      continue;
    }
    if (entry.isDirectory()) await assertNoNestedGitRepositories(join(path, entry.name), root);
  }
}

/** Reject symlinks, sockets, devices, and other non-regular template entries. */
export async function assertRegularDirectoryTree(path: string, label = 'Template'): Promise<void> {
  let root;
  try {
    root = await lstat(path);
  } catch (error) {
    if (isMissing(error)) throw new Error(`[create-zero] ${label} directory does not exist: ${path}`);
    throw error;
  }
  if (root.isSymbolicLink() || !root.isDirectory()) {
    throw new Error(`[create-zero] ${label} must be a real directory, not a symlink or special file: ${path}`);
  }

  for (const entry of await readdir(path, { withFileTypes: true })) {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) await assertRegularDirectoryTree(child, label);
    else if (!entry.isFile()) {
      throw new Error(`[create-zero] ${label} contains a symlink or special file: ${child}`);
    }
  }
}

async function assertTargetType(path: string): Promise<void> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink() || !details.isDirectory()) {
      throw new Error(`[create-zero] Target must be a real directory or a new path: ${path}`);
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
