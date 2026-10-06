'use client';

/** Owns local picker navigation and selection; delegated loaders do not persist or authorize. */
import * as React from 'react';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';
import { buildCascaderIndex, getCascaderLevel, searchCascaderIndex, updateCascaderSelection } from './cascader-model';
import { useCascaderLoader } from './use-cascader-loader';
import type { CascaderIndexEntry, CascaderSearchResult } from './cascader.types';
import type { CascaderSelection, CascaderView } from './cascader-context';
import type { CascaderProps } from './cascader.props';
import { loadCascaderBranch } from './cascader-branch-navigation';

/** Derive the current scope's view and fence obsolete async navigation before changing levels. */
export function useCascaderController(props: CascaderProps): CascaderView {
  const generatedId = React.useId();
  const [localValues, setLocalValues] = React.useState<readonly string[]>(() => valuesOf(props.defaultValue));
  const [localOpen, setLocalOpen] = React.useState(props.defaultOpen ?? false);
  const [query, setQuery] = React.useState('');
  const [path, setPath] = React.useState<readonly string[]>([]);
  const [status, setStatus] = React.useState('');
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [remoteQuery, setRemoteQuery] = React.useState('');
  const [remembered, setRemembered] = React.useState<ReadonlyMap<string, CascaderSearchResult>>(new Map());
  const scope = React.useRef(props.scopeKey);
  const scopeChanged = scope.current !== props.scopeKey;
  const generation = React.useMemo(() => ({}), [props.scopeKey, props.items, props.getChildren, props.onSearch]);
  const previousSource = React.useRef(generation);
  const sourceChanged = previousSource.current !== generation;
  const navigation = React.useRef(0), mounted = React.useRef(true);
  const failedBranch = React.useRef<CascaderIndexEntry | null>(null);
  const loader = useCascaderLoader({ items: props.items, getChildren: props.getChildren,
    onSearch: props.onSearch, scopeKey: props.scopeKey, onError: props.onLoadError });
  const index = React.useMemo(() => buildCascaderIndex(props.items, loader.loadedChildren), [props.items, loader.loadedChildren]);
  const values = props.value === undefined ? (scopeChanged ? [] : localValues) : valuesOf(props.value);
  const activePath = sourceChanged ? [] : path;
  const activeQuery = sourceChanged ? '' : query;
  const open = !props.disabled && (props.open ?? localOpen);
  const current = React.useRef({ props, values, index, generation, open, query: activeQuery });
  current.current = { props, values, index, generation, open, query: activeQuery };
  const valuesRef = React.useRef(values); valuesRef.current = values;
  const reportCallbackError = React.useCallback((operation: string) => {
    emitFrontendCode(OBS_CODES.FRONTEND_CASCADER_CALLBACK_FAILED, { metadata: { operation } });
    if (mounted.current) setStatus('The action could not be completed. Please try again.');
  }, []);
  const observe = (operation: string, callback: (() => unknown) | undefined) => {
    const owner = current.current.generation;
    try {
      const result = callback?.();
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch(() => {
          if (mounted.current && owner === current.current.generation) reportCallbackError(operation);
        });
      }
      return true;
    } catch { reportCallbackError(operation); return false; }
  };
  const setOpen = (next: boolean) => {
    if (next && current.current.props.disabled) return;
    if (!next && menuOpen) return;
    if (!next) { navigation.current++; failedBranch.current = null; loader.cancel(); setQuery(''); }
    if (current.current.props.open === undefined) setLocalOpen(next);
    observe('open', () => current.current.props.onOpenChange?.(next));
  };
  const accept = (next: readonly string[]) => {
    const now = current.current.props;
    if (now.disabled || now.readOnly || !mounted.current) return;
    const accepted = observe('selection', () => now.multiple
      ? now.onValueChange?.(next) : now.onValueChange?.(next[0] ?? null));
    if (!accepted) return;
    valuesRef.current = next;
    if (now.value === undefined) setLocalValues(next);
    setStatus(next.length ? `${next.length} selected.` : 'Selection cleared.');
    if (!now.multiple) setOpen(false);
  };
  const toggle = (entry: CascaderIndexEntry) => {
    const source = current.current;
    if (source.props.disabled || source.props.readOnly || entry.disabled) return;
    // Remote paths are retained for presentation; actual authority belongs to the app's backend.
    const choiceIndex = source.index.byValue.has(entry.node.value) ? source.index
      : buildCascaderIndex([entry.node]);
    const result = updateCascaderSelection(choiceIndex, valuesRef.current, entry.node.value,
      { multiple: !!source.props.multiple, maxSelected: source.props.max });
    if (result.changed) {
      if (!source.index.byValue.has(entry.node.value)) {
        const hit = loader.searchResults?.find((item) => item.node.value === entry.node.value);
        if (hit) setRemembered((previous) => new Map(previous).set(hit.node.value, hit));
      }
      accept(result.values);
    } else if (result.reason === 'selection-limit') setStatus(`You can select up to ${source.props.max} items.`);
  };
  const navigate = async (entry: CascaderIndexEntry) => {
    const source = current.current;
    if (source.props.disabled || entry.disabled) return;
    const intent = ++navigation.current;
    const isCurrent = () => mounted.current && intent === navigation.current &&
      source.generation === current.current.generation && current.current.open;
    const result = await loadCascaderBranch(entry, { items: source.props.items,
      load: loader.load, getLoadedChildren: loader.getLoadedChildren, isCurrent });
    if (!isCurrent() || result.status === 'stale') return;
    if (result.status === 'failed') {
      failedBranch.current = entry;
      setStatus('This branch could not be loaded. Try again.');
      return;
    }
    failedBranch.current = null;
    if (result.status === 'empty') {
      setStatus('This attribute has no children. You can select it from the current level.');
      return;
    }
    if (result.status === 'missing') { setStatus('This search result is no longer available. Try searching again.'); return; }
    if (result.status === 'ready') {
      setPath(result.entry.path); setQuery(''); setStatus(`Browsing ${result.entry.pathLabel}.`);
    }
  };
  const goToDepth = (depth: number) => {
    navigation.current++; failedBranch.current = null; loader.cancel(); setPath(activePath.slice(0, Math.max(0, depth)));
    setQuery(''); setStatus(depth ? 'Previous level.' : 'All attributes.');
  };
  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; navigation.current++; };
  }, []);
  React.useEffect(() => {
    if (previousSource.current === generation) return;
    previousSource.current = generation;
    const resetSelection = scope.current !== props.scopeKey;
    scope.current = props.scopeKey; navigation.current++;
    failedBranch.current = null;
    setPath([]); setQuery(''); setRemoteQuery(''); setRemembered(new Map()); setStatus(''); setMenuOpen(false);
    if (resetSelection && props.value === undefined) setLocalValues([]);
  }, [generation]);
  React.useEffect(() => {
    if (open && props.items.length === 0 && props.getChildren) void loader.load(null);
  }, [open, props.items, props.getChildren, props.scopeKey, loader.load]);
  React.useEffect(() => {
    if (!props.onSearch || !open) return;
    if (!activeQuery.trim()) { void loader.search(''); return; }
    const owner = generation;
    const intent = navigation.current;
    const timer = setTimeout(() => {
      void loader.search(activeQuery).then(() => {
        if (mounted.current && intent === navigation.current && current.current.generation === owner && current.current.open && current.current.query === activeQuery) setRemoteQuery(activeQuery);
      });
    }, props.searchDebounce ?? 150);
    return () => clearTimeout(timer);
  }, [activeQuery, open, props.onSearch, props.searchDebounce, generation, loader.search]);
  React.useEffect(() => {
    if (!open) { navigation.current++; failedBranch.current = null; loader.cancel(); setMenuOpen(false); }
  }, [open, loader.cancel]);
  const selectionKey = JSON.stringify(values);
  React.useEffect(() => {
    if (sourceChanged || !activeQuery.trim() || remoteQuery !== activeQuery || !loader.searchResults) return;
    // A restored selection can be hydrated by an admitted remote path without
    // being toggled again. Retain it after the search query/popup is cleared.
    const selectedPaths = loader.searchResults.filter((item) => valuesRef.current.includes(item.node.value));
    setRemembered((previous) => {
      let changed = false;
      const next = new Map(previous);
      for (const item of selectedPaths) {
        if (next.get(item.node.value) !== item) { next.set(item.node.value, item); changed = true; }
      }
      return changed ? next : previous;
    });
  }, [loader.searchResults, remoteQuery, activeQuery, selectionKey, generation, sourceChanged]);
  const entries = activeQuery.trim()
    ? props.onSearch ? (remoteQuery === activeQuery ? loader.searchResults ?? [] : []).map((hit) => {
      const canonical = index.byValue.get(hit.node.value);
      if (!canonical) return remoteEntry(hit);
      const samePath = canonical.path.length === hit.path.length && canonical.path.every((id, depth) => id === hit.path[depth]?.value);
      // Loaded emptiness and disabled ancestry remain authoritative after a
      // remote result's branch is admitted. A moved trail cannot select by ID alone.
      return samePath ? canonical : { ...remoteEntry(hit), disabled: true };
    }) : searchCascaderIndex(index, activeQuery)
    : getCascaderLevel(index, activePath);
  const selections = values.map((value): CascaderSelection => {
    const entry = index.byValue.get(value);
    const remote = sourceChanged ? undefined : remembered.get(value) ??
      (remoteQuery === activeQuery && activeQuery.trim() ? loader.searchResults?.find((item) => item.node.value === value) : undefined);
    const nodes = entry ? entry.path.map((id) => index.byValue.get(id)!.node) : remote?.path ?? [{ value, label: value }];
    return { value, node: nodes.at(-1)!, path: nodes, labelPath: nodes.map((node) => node.label), pathLabel: nodes.map((node) => node.label).join(' / ') };
  });
  return {
    label: props.label ?? 'Choose attributes', id: props.id ?? generatedId, scopeKey: props.scopeKey, generation,
    multiple: !!props.multiple, max: props.max, disabled: !!props.disabled, readOnly: !!props.readOnly,
    open, setOpen, query: activeQuery, setQuery: (next) => {
      navigation.current++; failedBranch.current = null; loader.cancel(); void loader.search(''); setRemoteQuery(''); setQuery(next); setStatus('');
    },
    path: activePath, index, entries, selections, values,
    loading: loader.loading || loader.searchLoading || !!(props.onSearch && activeQuery.trim() && remoteQuery !== activeQuery), loadingKey: loader.loadingKey,
    error: (failedBranch.current && loader.loadError || (activeQuery.trim() ? props.onSearch && loader.searchError : loader.loadError))
      ? 'Could not load these options. Please try again.' : null,
    status, menuOpen, setMenuOpen, navigate, goToDepth, toggle,
    callbackError: status === 'The action could not be completed. Please try again.',
    remove: (value) => accept(valuesRef.current.filter((item) => item !== value)), clear: () => accept([]),
    retry: () => { if (failedBranch.current) void navigate(failedBranch.current);
      else if (activeQuery.trim() && props.onSearch) void loader.search(activeQuery);
      else void loader.load(null); },
    reportCallbackError,
  };
}

function valuesOf(value: string | readonly string[] | null | undefined): readonly string[] {
  return value == null ? [] : typeof value === 'string' ? [value] : [...new Set(value)];
}
function remoteEntry(hit: CascaderSearchResult): CascaderIndexEntry {
  const path = hit.path.map((node) => node.value), labelPath = hit.path.map((node) => node.label);
  return { node: hit.node, path, labelPath, pathLabel: labelPath.join(' / '),
    children: hit.node.children ?? [], hasChildren: !!hit.node.hasChildren || !!hit.node.children?.length,
    disabled: hit.path.some((node) => !!node.disabled) };
}
