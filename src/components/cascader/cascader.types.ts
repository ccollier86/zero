/**
 * cascader.types.ts
 *
 * Defines the framework-independent Cascader tree, index, and selection contracts.
 * React is consumed only for optional icons; these types do not grant permissions
 * or own data loading, transport, rendering, or persisted selection.
 */

import type { ReactNode } from 'react';

/** A tree option with a globally unique value; labels may repeat in other paths. */
export interface CascaderNode<T = unknown> {
  value: string;
  label: string;
  description?: string;
  icon?: ReactNode;
  keywords?: readonly string[];
  disabled?: boolean;
  /** Marks an unloaded branch. A successful empty child load becomes a leaf. */
  hasChildren?: boolean;
  children?: readonly CascaderNode<T>[];
  data?: T;
}

/** A remote search result must carry its entire root-to-result node path. */
export interface CascaderSearchResult<T = unknown> {
  node: CascaderNode<T>;
  path: readonly CascaderNode<T>[];
}

/** Canonical metadata for an option in the currently known tree. */
export interface CascaderIndexEntry<T = unknown> {
  node: CascaderNode<T>;
  /** Globally unique node values from the root through this option. */
  path: readonly string[];
  labelPath: readonly string[];
  pathLabel: string;
  children: readonly CascaderNode<T>[];
  hasChildren: boolean;
  /** Includes disabled ancestors, preventing selection through a disabled branch. */
  disabled: boolean;
}

/** The effective static tree plus child lists supplied by completed async loads. */
export interface CascaderIndex<T = unknown> {
  roots: readonly CascaderNode<T>[];
  byValue: ReadonlyMap<string, CascaderIndexEntry<T>>;
}

/** Optional limits for a single leaf toggle. Existing selections can be removed. */
export interface CascaderSelectionOptions {
  multiple?: boolean;
  maxSelected?: number;
}

/** A selection toggle outcome; rejection preserves the current value list. */
export interface CascaderSelectionUpdate {
  values: readonly string[];
  changed: boolean;
  reason?: 'unknown' | 'disabled' | 'branch' | 'selection-limit';
}
