/**
 * cascader-model.ts
 *
 * Owns pure Cascader indexing, path-aware search, and bounded leaf selection.
 * It consumes only the tree contracts; it does not fetch children, render React,
 * infer authorization, or mutate caller-owned tree and selection data.
 */

import type {
  CascaderIndex,
  CascaderIndexEntry,
  CascaderNode,
  CascaderSelectionOptions,
  CascaderSelectionUpdate,
} from './cascader.types';

const EMPTY_LEVEL = Object.freeze([]) as readonly never[];

function validateNode<T>(node: CascaderNode<T>, parentPath: readonly string[]): void {
  const location = parentPath.length ? parentPath.join(' / ') : 'root';
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    throw new TypeError(`Cascader option at ${location} must be an object.`);
  }
  if (typeof node.value !== 'string' || !node.value.trim()) {
    throw new TypeError(`Cascader option at ${location} requires a nonempty string value.`);
  }
  if (typeof node.label !== 'string' || !node.label.trim()) {
    throw new TypeError(`Cascader option "${node.value}" requires a nonempty label.`);
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new TypeError(`Cascader children for "${node.value}" must be an array.`);
  }
  if (node.keywords !== undefined && (!Array.isArray(node.keywords)
    || node.keywords.some((keyword) => typeof keyword !== 'string'))) {
    throw new TypeError(`Cascader keywords for "${node.value}" must be strings.`);
  }
  if ((node.disabled !== undefined && typeof node.disabled !== 'boolean')
    || (node.hasChildren !== undefined && typeof node.hasChildren !== 'boolean')) {
    throw new TypeError(`Cascader disabled and hasChildren flags for "${node.value}" must be booleans.`);
  }
  if (node.description !== undefined && typeof node.description !== 'string') {
    throw new TypeError(`Cascader description for "${node.value}" must be a string.`);
  }
}

/**
 * Index the effective tree without changing caller-owned nodes. Completed child
 * loads replace that parent's static children; unrelated/orphan cache keys are
 * ignored until their parent exists. Duplicate values and cycles are rejected.
 */
export function buildCascaderIndex<T>(
  items: readonly CascaderNode<T>[],
  loadedChildren?: ReadonlyMap<string | null, readonly CascaderNode<T>[]>,
): CascaderIndex<T> {
  const rootItems = loadedChildren?.has(null) ? loadedChildren.get(null)! : items;
  if (!Array.isArray(rootItems)) throw new TypeError('Cascader root options must be an array.');
  const roots = Object.freeze([...rootItems]);
  const byValue = new Map<string, CascaderIndexEntry<T>>();
  const ancestors = new Set<CascaderNode<T>>();

  function visit(node: CascaderNode<T>, parent?: CascaderIndexEntry<T>): void {
    const parentPath = parent?.path ?? EMPTY_LEVEL;
    if (ancestors.has(node)) {
      throw new TypeError(`Cascader tree contains a cycle beneath ${parentPath.join(' / ')}.`);
    }
    validateNode(node, parentPath);
    if (byValue.has(node.value)) {
      throw new TypeError(`Cascader value "${node.value}" is duplicated. Use globally unique values even when labels repeat.`);
    }
    const loaded = loadedChildren?.has(node.value) ?? false;
    const childItems = loaded ? loadedChildren!.get(node.value)! : node.children ?? EMPTY_LEVEL;
    if (!Array.isArray(childItems)) {
      throw new TypeError(`Loaded Cascader children for "${node.value}" must be an array.`);
    }
    const children = Object.freeze([...childItems]);
    const path = Object.freeze([...parentPath, node.value]);
    const labelPath = Object.freeze([...(parent?.labelPath ?? EMPTY_LEVEL), node.label]);
    const entry = Object.freeze({
      node,
      path,
      labelPath,
      pathLabel: labelPath.join(' / '),
      children,
      hasChildren: children.length > 0 || (!loaded && node.hasChildren === true),
      disabled: parent?.disabled === true || node.disabled === true,
    });
    byValue.set(node.value, entry);
    ancestors.add(node);
    for (const child of children) visit(child, entry);
    ancestors.delete(node);
  }

  for (const root of roots) visit(root);
  return Object.freeze({ roots, byValue });
}

/** Return a valid branch's children; stale or unrelated navigation paths return an empty level. */
export function getCascaderLevel<T>(
  index: CascaderIndex<T>,
  path: readonly string[],
): readonly CascaderIndexEntry<T>[] {
  let nodes = index.roots;
  for (const value of path) {
    const node = nodes.find((candidate) => candidate.value === value);
    if (!node) return EMPTY_LEVEL;
    const entry = index.byValue.get(value);
    if (!entry?.hasChildren) return EMPTY_LEVEL;
    nodes = entry.children;
  }
  return Object.freeze(nodes.map((node) => index.byValue.get(node.value)!));
}

function normalizeSearch(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

/**
 * Search all known levels using labels, values, descriptions, and path keywords.
 * Every query token must match; own-label matches precede path-only matches, with
 * tree order retained within each group. Unloaded descendants need remote search.
 */
export function searchCascaderIndex<T>(
  index: CascaderIndex<T>,
  query: string,
): readonly CascaderIndexEntry<T>[] {
  const normalizedQuery = normalizeSearch(query).trim();
  if (!normalizedQuery) return EMPTY_LEVEL;
  const tokens = normalizedQuery.split(/\s+/u);
  const matches: { entry: CascaderIndexEntry<T>; rank: number }[] = [];
  for (const entry of index.byValue.values()) {
    const pathNodes = entry.path.map((value) => index.byValue.get(value)!.node);
    const searchText = normalizeSearch(pathNodes.flatMap((node) => [
      node.label, node.value, node.description ?? '', ...(node.keywords ?? []),
    ]).join(' '));
    if (!tokens.every((token) => searchText.includes(token))) continue;
    const label = normalizeSearch(entry.node.label);
    const rank = label === normalizedQuery ? 0 : label.startsWith(normalizedQuery) ? 1
      : tokens.every((token) => label.includes(token)) ? 2 : 3;
    matches.push({ entry, rank });
  }
  matches.sort((left, right) => left.rank - right.rank);
  return Object.freeze(matches.map(({ entry }) => entry));
}

/**
 * Toggle one leaf without duplicates or cap overflow. Removal is always allowed,
 * including stale/disabled selections. Single-select replaces the prior value;
 * omitted multiple defaults to true. A zero cap deliberately prevents additions.
 */
export function updateCascaderSelection<T>(
  index: CascaderIndex<T>,
  selectedValues: readonly string[],
  value: string,
  { multiple = true, maxSelected }: CascaderSelectionOptions = {},
): CascaderSelectionUpdate {
  if (maxSelected !== undefined && (!Number.isSafeInteger(maxSelected) || maxSelected < 0)) {
    throw new RangeError('Cascader maxSelected must be a nonnegative safe integer.');
  }
  const values = Object.freeze([...new Set(selectedValues)]);
  if (values.includes(value)) {
    return { values: Object.freeze(values.filter((selected) => selected !== value)), changed: true };
  }
  const entry = index.byValue.get(value);
  const reason = !entry ? 'unknown' : entry.disabled ? 'disabled' : entry.hasChildren ? 'branch'
    : maxSelected !== undefined && (multiple ? values.length + 1 : 1) > maxSelected
      ? 'selection-limit' : undefined;
  if (reason) return { values, changed: false, reason };
  return { values: Object.freeze(multiple ? [...values, value] : [value]), changed: true };
}
