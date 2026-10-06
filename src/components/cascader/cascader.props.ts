/** Public composition options; the picker selects data but never grants server authority. */
import type * as React from 'react';
import type { CascaderNode, CascaderSearchResult } from './cascader.types';
import type { CascaderLoadError } from './use-cascader-loader';

/** App-owned loading callback. Use Zero's authenticated SDK in the application adapter. */
export type CascaderChildrenLoader<T = unknown> = (
  node: CascaderNode<T> | null,
  context: { signal: AbortSignal },
) => Promise<readonly CascaderNode<T>[]>;

/** Complete remote search paths allow unloaded branches to appear in global search. */
export type CascaderSearchLoader<T = unknown> = (
  query: string,
  context: { signal: AbortSignal },
) => Promise<readonly CascaderSearchResult<T>[]>;

interface CascaderBaseProps<T> {
  children: React.ReactNode;
  items: readonly CascaderNode<T>[];
  label?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Change with organization/query authority to retire cached levels and pending requests. */
  scopeKey?: string | number;
  getChildren?: CascaderChildrenLoader<T>;
  onSearch?: CascaderSearchLoader<T>;
  searchDebounce?: number;
  onLoadError?: (error: CascaderLoadError) => void;
}

/** Controlled or local single selection, or capped controlled/local multi-selection. */
export type CascaderProps<T = unknown> = CascaderBaseProps<T> & (
  | { multiple?: false; value?: string | null; defaultValue?: string | null;
      onValueChange?: (value: string | null) => void; max?: never }
  | { multiple: true; value?: readonly string[]; defaultValue?: readonly string[];
      onValueChange?: (value: readonly string[]) => void; max?: number }
);
