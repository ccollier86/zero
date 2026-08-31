/** Canonical path comparison and broad-target protections for create-zero. */

import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, parse, relative, resolve } from 'node:path';

/** Resolve a possibly-new path through the real path of its nearest existing ancestor. */
export async function resolveProspectivePath(path: string): Promise<string> {
  const missing: string[] = [];
  let cursor = path;
  while (!(await pathExists(cursor))) {
    missing.unshift(basename(cursor));
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return resolve(await realpath(cursor), ...missing);
}

/** Reject targets capable of replacing a filesystem, home, or current workspace tree. */
export async function assertTargetIsNarrow(target: string): Promise<void> {
  const filesystemRoot = parse(target).root;
  const protectedPaths = [await realpath(process.cwd()), await realpath(homedir())];
  if (target === filesystemRoot || dirname(target) === filesystemRoot) {
    throw new Error(`[create-zero] Refusing dangerous broad target: ${target}`);
  }
  if (protectedPaths.some((path) => isSameOrInside(path, target))) {
    throw new Error(`[create-zero] Refusing to replace a workspace, home directory, or its ancestor: ${target}`);
  }
}

/** Reject either directory containing the other after canonical resolution. */
export function assertPathsDoNotOverlap(target: string, template: string): void {
  if (isSameOrInside(target, template) || isSameOrInside(template, target)) {
    throw new Error(`[create-zero] Template and target directories must not overlap: ${template} <> ${target}`);
  }
}

export async function pathDetails(path: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

function isSameOrInside(path: string, parent: string): boolean {
  const pathFromParent = relative(parent, path);
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !parse(pathFromParent).root);
}

async function pathExists(path: string): Promise<boolean> {
  return (await pathDetails(path)) !== null;
}
