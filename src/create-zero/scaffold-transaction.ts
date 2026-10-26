/** Recoverable same-filesystem commit for a fully generated scaffold. */

import { lstat, readdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';

import type { TargetSnapshot } from './scaffold-safety';
import { assertTargetContainsNoGitRepositories } from './scaffold-safety';
import { pathDetails } from './scaffold-path-safety';

export interface ScaffoldCommitOperations {
  rename(source: string, destination: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const DEFAULT_OPERATIONS: ScaffoldCommitOperations = {
  rename,
  remove: (path) => rm(path, { force: true, recursive: true }),
};

/** Swap a staged app into place and restore the original if installation fails. */
export async function commitStagedScaffold(
  stagingDir: string,
  targetDir: string,
  snapshot: TargetSnapshot,
  operations: ScaffoldCommitOperations = DEFAULT_OPERATIONS
): Promise<void> {
  if (dirname(stagingDir) !== dirname(targetDir)) {
    throw new Error('[create-zero] Staging and target directories must be siblings');
  }
  await assertTargetUnchanged(targetDir, snapshot);
  if (snapshot.exists) await assertTargetContainsNoGitRepositories(targetDir);

  if (!snapshot.exists) {
    await operations.rename(stagingDir, targetDir);
    return;
  }

  if (snapshot.preserveDirectory) {
    await populateCurrentDirectory(stagingDir, targetDir, operations);
    return;
  }

  const backupDir = join(
    dirname(targetDir),
    `.${basename(targetDir)}.zero-backup-${randomUUID()}`
  );
  await operations.rename(targetDir, backupDir);
  try {
    await operations.rename(stagingDir, targetDir);
  } catch (installError) {
    try {
      await operations.rename(backupDir, targetDir);
    } catch (rollbackError) {
      throw new AggregateError(
        [installError, rollbackError],
        `[create-zero] Install and rollback failed; original target is preserved at ${backupDir}`
      );
    }
    throw installError;
  }

  await operations.remove(backupDir);
}

/** Publish prepared entries without renaming the directory held by the caller's shell. */
async function populateCurrentDirectory(
  stagingDir: string,
  targetDir: string,
  operations: ScaffoldCommitOperations
): Promise<void> {
  const moved: string[] = [];
  try {
    for (const entry of await readdir(stagingDir)) {
      const destination = join(targetDir, entry);
      if (await pathDetails(destination)) {
        throw new Error(`[create-zero] Target changed during generation; refusing to replace: ${destination}`);
      }
      await operations.rename(join(stagingDir, entry), destination);
      moved.push(entry);
    }
  } catch (installError) {
    const rollbackErrors: unknown[] = [];
    for (const entry of moved.reverse()) {
      try {
        await operations.rename(join(targetDir, entry), join(stagingDir, entry));
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [installError, ...rollbackErrors],
        `[create-zero] Install and rollback failed; inspect generated entries in ${targetDir}`
      );
    }
    throw installError;
  }
  await operations.remove(stagingDir);
}

async function assertTargetUnchanged(targetDir: string, snapshot: TargetSnapshot): Promise<void> {
  let current;
  try {
    current = await lstat(targetDir, { bigint: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
  }

  if (!snapshot.exists && current) {
    throw new Error(`[create-zero] Target appeared during generation; refusing to replace it: ${targetDir}`);
  }
  if (snapshot.exists && (
    !current || !current.isDirectory() || current.isSymbolicLink()
    || current.dev !== snapshot.dev || current.ino !== snapshot.ino
    || current.ctimeNs !== snapshot.ctimeNs || current.mtimeNs !== snapshot.mtimeNs
  )) {
    throw new Error(`[create-zero] Target changed during generation; refusing to replace it: ${targetDir}`);
  }
}
