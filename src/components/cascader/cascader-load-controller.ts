/**
 * Owns cancellable, cache-scoped cascader adapter requests and response admission.
 * This UI controller receives app-owned callbacks; it does not fetch, persist,
 * choose authorization policy, or render navigation.
 */

import type { CascaderNode, CascaderSearchResult } from './cascader.types';
import { buildCascaderIndex } from './cascader-model';

/** Adapter failures are deliberately safe for presentation and observability. */
export interface CascaderLoadError {
  readonly code: 'CASCADER_LOAD_FAILED';
  readonly operation: 'children' | 'search';
  readonly message: string;
}

/** Every adapter receives a signal, including adapters that perform no HTTP. */
export interface CascaderLoadContext { readonly signal: AbortSignal }

/** Scope ownership is supplied by the hook, not inferred from node labels. */
export interface CascaderLoadControllerOptions<T = unknown> {
  readonly items: readonly CascaderNode<T>[];
  readonly getChildren?: (node: CascaderNode<T> | null, context: CascaderLoadContext) => Promise<readonly CascaderNode<T>[]>;
  readonly onSearch?: (query: string, context: CascaderLoadContext) => Promise<readonly CascaderSearchResult<T>[]>;
  readonly onError?: (error: CascaderLoadError) => void | Promise<void>;
  readonly isActive?: () => boolean;
}

/** Snapshot replacement prevents prior requests from replacing later state. */
export interface CascaderLoaderSnapshot<T = unknown> {
  readonly loadedChildren: ReadonlyMap<string | null, readonly CascaderNode<T>[]>;
  readonly loading: boolean;
  readonly loadingKey: string | null | undefined;
  readonly loadError: CascaderLoadError | null;
  readonly searchResults: readonly CascaderSearchResult<T>[] | undefined;
  readonly searchLoading: boolean;
  readonly searchError: CascaderLoadError | null;
}

interface PendingRequest<R> {
  readonly controller: AbortController;
  readonly promise: Promise<R>;
  readonly resolve: (result: R) => void;
}

interface ChildRequest extends PendingRequest<boolean> { readonly key: string | null }

/** Coordinate latest navigation and search independently within one scope. */
export class CascaderLoadController<T = unknown> {
  private snapshot: CascaderLoaderSnapshot<T> = {
    loadedChildren: new Map(), loading: false, loadingKey: undefined,
    loadError: null, searchResults: undefined, searchLoading: false, searchError: null,
  };
  private readonly listeners = new Set<() => void>();
  private childRequest: ChildRequest | null = null;
  private searchRequest: PendingRequest<void> | null = null;
  private searchQuery: string | null = null;
  private failedNode: CascaderNode<T> | null | undefined;
  private disposed = false;

  constructor(private readonly options: CascaderLoadControllerOptions<T>) {}

  /** React subscribes to the snapshot, not to individual adapter promises. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** The same snapshot reference is returned until admitted state changes. */
  getSnapshot = (): CascaderLoaderSnapshot<T> => this.snapshot;

  /** Read accepted levels immediately after awaiting a load, before React rerenders. */
  getLoadedChildren = (): CascaderLoaderSnapshot<T>['loadedChildren'] => this.snapshot.loadedChildren;

  /** Load before navigating; repeated calls for one pending parent share work. */
  load = (node: CascaderNode<T> | null): Promise<boolean> => {
    if (!this.isActive()) return Promise.resolve(false);
    const key = node?.value ?? null;
    if (this.childRequest?.key === key) return this.childRequest.promise;
    this.abortChildren();
    this.failedNode = undefined;
    const staticLevelResolved = node?.children !== undefined
      && (node.children.length > 0 || node.hasChildren !== true);
    if (this.snapshot.loadedChildren.has(key) || staticLevelResolved || !this.options.getChildren) {
      this.update({ loading: false, loadingKey: undefined, loadError: null });
      return Promise.resolve(true);
    }
    const request = { ...pendingRequest<boolean>(), key };
    this.childRequest = request;
    this.update({ loading: true, loadingKey: key, loadError: null });
    void Promise.resolve().then(() => {
      if (!this.isChildCurrent(request)) return undefined;
      return this.options.getChildren!(node, { signal: request.controller.signal });
    }).then((children) => {
      if (!this.isChildCurrent(request)) return;
      const accepted = validateChildren(children);
      const loadedChildren = new Map(this.snapshot.loadedChildren);
      loadedChildren.set(key, accepted);
      buildCascaderIndex(this.options.items, loadedChildren);
      this.childRequest = null;
      this.update({ loadedChildren, loading: false, loadingKey: undefined });
      request.resolve(true);
    }).catch(() => {
      if (!this.isChildCurrent(request)) return;
      this.childRequest = null;
      this.failedNode = node;
      const error = failure('children');
      this.update({ loading: false, loadingKey: undefined, loadError: error });
      request.resolve(false);
      this.reportError(error);
    });
    return request.promise;
  };

  /** Retry the failed parent without disclosing its identity in public errors. */
  retryLoad = (): Promise<boolean> => this.failedNode === undefined
    ? Promise.resolve(false) : this.load(this.failedNode);

  /** Empty search aborts and clears results without calling the search adapter. */
  search = (query: string): Promise<void> => {
    if (!this.isActive()) return Promise.resolve();
    const normalized = query.trim();
    if (normalized && this.searchQuery === normalized && this.searchRequest) return this.searchRequest.promise;
    this.abortSearch();
    if (!normalized || !this.options.onSearch) {
      this.update({ searchResults: undefined, searchLoading: false, searchError: null });
      return Promise.resolve();
    }
    const request = pendingRequest<void>();
    this.searchRequest = request;
    this.searchQuery = normalized;
    this.update({ searchResults: undefined, searchLoading: true, searchError: null });
    void Promise.resolve().then(() => {
      if (!this.isSearchCurrent(request)) return undefined;
      return this.options.onSearch!(normalized, { signal: request.controller.signal });
    }).then((results) => {
      if (!this.isSearchCurrent(request)) return;
      const accepted = validateSearchResults(results);
      this.searchRequest = null;
      this.update({ searchResults: accepted, searchLoading: false });
      request.resolve();
    }).catch(() => {
      if (!this.isSearchCurrent(request)) return;
      this.searchRequest = null;
      const error = failure('search');
      this.update({ searchLoading: false, searchError: error });
      request.resolve();
      this.reportError(error);
    });
    return request.promise;
  };

  /** Closing a picker cancels pending work but retains successfully loaded levels. */
  cancel = (): void => {
    this.abortChildren();
    this.abortSearch();
    this.update({ loading: false, loadingKey: undefined, loadError: null,
      searchResults: undefined, searchLoading: false, searchError: null });
  };

  /** Retire an instance permanently; even ignored AbortSignals cannot admit data. */
  dispose = (): void => {
    this.disposed = true;
    this.cancel();
    this.listeners.clear();
  };

  private isActive(): boolean { return !this.disposed && (this.options.isActive?.() ?? true); }
  private isChildCurrent(request: ChildRequest): boolean {
    return this.isActive() && this.childRequest === request && !request.controller.signal.aborted;
  }
  private isSearchCurrent(request: PendingRequest<void>): boolean {
    return this.isActive() && this.searchRequest === request && !request.controller.signal.aborted;
  }
  private abortChildren(): void {
    const request = this.childRequest;
    this.childRequest = null;
    request?.controller.abort();
    request?.resolve(false);
  }
  private abortSearch(): void {
    const request = this.searchRequest;
    this.searchRequest = null;
    this.searchQuery = null;
    request?.controller.abort();
    request?.resolve();
  }
  private update(patch: Partial<CascaderLoaderSnapshot<T>>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
  private reportError(error: CascaderLoadError): void {
    // App callbacks must not turn a handled adapter error into a rejected task.
    try {
      const result = this.options.onError?.(error);
      if (result) void result.catch(() => {});
    } catch { /* Hook owns callback telemetry. */ }
  }
}

function pendingRequest<R>(): PendingRequest<R> {
  let resolve!: (result: R) => void;
  const promise = new Promise<R>((accept) => { resolve = accept; });
  return { controller: new AbortController(), promise, resolve };
}

function failure(operation: CascaderLoadError['operation']): CascaderLoadError {
  return Object.freeze({
    code: 'CASCADER_LOAD_FAILED', operation,
    message: operation === 'children'
      ? 'This level could not be loaded. Try again.'
      : 'Search could not be completed. Try again.',
  });
}

function validateChildren<T>(value: readonly CascaderNode<T>[] | undefined): readonly CascaderNode<T>[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid cascader children.');
  buildCascaderIndex(value);
  return Object.freeze([...value]);
}

function validateNode<T>(node: CascaderNode<T>): void {
  buildCascaderIndex([node]);
}

function validateSearchResults<T>(value: readonly CascaderSearchResult<T>[] | undefined): readonly CascaderSearchResult<T>[] {
  if (!Array.isArray(value)) throw new TypeError('Invalid cascader search results.');
  const seen = new Set<string>();
  const accepted = value.map((result: CascaderSearchResult<T>) => {
    validateNode(result?.node);
    if (!Array.isArray(result.path) || result.path.length === 0
      || result.path.at(-1)?.value !== result.node.value || seen.has(result.node.value)) {
      throw new TypeError('Invalid cascader search path.');
    }
    const pathValues = new Set<string>();
    for (const node of result.path) {
      validateNode(node);
      if (pathValues.has(node.value)) throw new TypeError('Invalid cascader search path.');
      pathValues.add(node.value);
    }
    const path = Object.freeze([...result.path]);
    seen.add(result.node.value);
    return Object.freeze({ node: result.node, path });
  });
  return Object.freeze(accepted);
}
