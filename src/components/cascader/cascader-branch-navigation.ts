/**
 * Resolves a Cascader branch through admitted ancestor levels before navigation.
 * This pure UI helper consumes the loader's validated cache and lifecycle fence;
 * it does not render, fetch, log private paths, or infer server authorization.
 */

import { buildCascaderIndex } from './cascader-model';
import type { CascaderIndex, CascaderIndexEntry, CascaderNode } from './cascader.types';

/** Load callbacks own cancellation and validation; isCurrent owns navigation intent. */
export interface CascaderBranchNavigationOptions<T = unknown> {
  readonly items: readonly CascaderNode<T>[];
  readonly load: (node: CascaderNode<T> | null) => Promise<boolean>;
  readonly getLoadedChildren: () => ReadonlyMap<string | null, readonly CascaderNode<T>[]>;
  readonly isCurrent: () => boolean;
}

/** Only ready results carry a canonical, current tree entry suitable for navigation. */
export type CascaderBranchNavigationResult<T = unknown> =
  | { readonly status: 'ready'; readonly entry: CascaderIndexEntry<T> }
  | { readonly status: 'empty' | 'failed' | 'stale' | 'missing' };

/**
 * Resolve a local or remote root-to-target path without navigating on a partial,
 * failed, moved, or obsolete trail. Every target passes through load(), including
 * static/cached branches, so another pending navigation request is retired.
 */
export async function loadCascaderBranch<T = unknown>(
  entry: CascaderIndexEntry<T>,
  options: CascaderBranchNavigationOptions<T>,
): Promise<CascaderBranchNavigationResult<T>> {
  if (!options.isCurrent()) return { status: 'stale' };
  const path = [...entry.path];
  if (path.length === 0 || path.at(-1) !== entry.node.value) return currentResult('missing');
  let index = readIndex();
  if (!index.roots.some((node) => node.value === path[0])) {
    const interrupted = await load(null);
    if (interrupted) return interrupted;
    index = readIndex();
  }

  let level = index.roots;
  for (let depth = 0; depth < path.length; depth++) {
    if (!options.isCurrent()) return { status: 'stale' };
    const node = level.find((candidate) => candidate.value === path[depth]);
    const canonical = node ? index.byValue.get(node.value) : undefined;
    if (!canonical || canonical.disabled || !samePath(canonical.path, path.slice(0, depth + 1))) return currentResult('missing');
    const target = depth === path.length - 1;
    if (target || !canonical.children.some((child) => child.value === path[depth + 1])) {
      const interrupted = await load(canonical.node);
      if (interrupted) return interrupted;
      index = readIndex();
    }
    const admitted = index.byValue.get(canonical.node.value);
    if (!admitted || admitted.disabled || !samePath(admitted.path, path.slice(0, depth + 1))) return currentResult('missing');
    if (target) {
      if (!options.isCurrent()) return { status: 'stale' };
      if (!admitted.hasChildren) return { status: 'empty' };
      // A branch flag alone is not an admitted child level (e.g. no adapter).
      if (admitted.children.length === 0) return { status: 'missing' };
      return { status: 'ready', entry: admitted };
    }
    level = admitted.children;
  }
  return currentResult('missing');

  function readIndex(): CascaderIndex<T> {
    return buildCascaderIndex(options.items, options.getLoadedChildren());
  }
  function currentResult(status: 'missing' | 'failed'): CascaderBranchNavigationResult<T> {
    return { status: options.isCurrent() ? status : 'stale' };
  }
  async function load(node: CascaderNode<T> | null): Promise<CascaderBranchNavigationResult<T> | undefined> {
    if (!options.isCurrent()) return { status: 'stale' };
    try {
      const accepted = await options.load(node);
      if (!options.isCurrent()) return { status: 'stale' };
      if (!accepted) return { status: 'failed' };
    } catch { return currentResult('failed'); }
    return undefined;
  }
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
