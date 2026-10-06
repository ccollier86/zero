'use client';

/** Shared picker view contract; data loaders and selection policy live in focused hooks. */
import * as React from 'react';
import type { CascaderIndex, CascaderIndexEntry, CascaderNode } from './cascader.types';

/** A selected node and its complete ancestor trail; labels need not be unique. */
export interface CascaderSelection<T = unknown> {
  value: string;
  node: CascaderNode<T>;
  path: readonly CascaderNode<T>[];
  labelPath: readonly string[];
  pathLabel: string;
}

export interface CascaderView {
  label: string;
  id: string;
  scopeKey?: string | number;
  generation: object;
  multiple: boolean;
  max?: number;
  disabled: boolean;
  readOnly: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  path: readonly string[];
  index: CascaderIndex;
  entries: readonly CascaderIndexEntry[];
  selections: readonly CascaderSelection[];
  values: readonly string[];
  loading: boolean;
  loadingKey: string | null | undefined;
  error: string | null;
  callbackError: boolean;
  status: string;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  navigate: (entry: CascaderIndexEntry) => Promise<void>;
  goToDepth: (depth: number) => void;
  toggle: (entry: CascaderIndexEntry) => void;
  remove: (value: string) => void;
  clear: () => void;
  retry: () => void;
  reportCallbackError: (operation: string) => void;
}

export const CascaderContext = React.createContext<CascaderView | null>(null);

/** Internal view access with an actionable composition error. */
export function useCascaderView(): CascaderView {
  const context = React.useContext(CascaderContext);
  if (!context) throw new Error('Cascader components must be rendered inside <Cascader>.');
  return context;
}

/** Build optional external chips or summaries inside Cascader, outside its popup. */
export function useCascaderSelection<T = unknown>() {
  const view = useCascaderView();
  return {
    items: view.selections as readonly CascaderSelection<T>[],
    values: view.values,
    remove: view.remove,
    clear: view.clear,
    isSelected: (value: string) => view.values.includes(value),
    disabled: view.disabled || view.readOnly,
  };
}
