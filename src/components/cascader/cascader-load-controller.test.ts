import { describe, expect, test } from 'bun:test';
import { CascaderLoadController, type CascaderLoadError } from './cascader-load-controller';
import type { CascaderNode, CascaderSearchResult } from './cascader.types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}
const branchA: CascaderNode = { value: 'tenant-a', label: 'Workspace A', hasChildren: true };
const branchB: CascaderNode = { value: 'tenant-b', label: 'Workspace B', hasChildren: true };
const leafA: CascaderNode = { value: 'tenant-a/read', label: 'Read' };
const leafB: CascaderNode = { value: 'tenant-b/read', label: 'Read' };
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe('CascaderLoadController', () => {
  test('single-flights a pending parent, caches accepted levels, and copies adapter arrays', async () => {
    const response = deferred<readonly CascaderNode[]>();
    let calls = 0;
    const controller = new CascaderLoadController({
      items: [branchA], getChildren: async () => { calls++; return response.promise; },
    });
    const first = controller.load(branchA);
    const second = controller.load({ ...branchA });
    expect(first).toBe(second);
    expect(controller.getSnapshot().loadingKey).toBe(branchA.value);
    await tick();
    expect(calls).toBe(1);
    const source = [leafA];
    response.resolve(source);
    expect(await first).toBe(true);
    const accepted = controller.getSnapshot();
    source.push({ value: 'unexpected', label: 'Later caller mutation' });
    expect(accepted.loadedChildren.get(branchA.value)).toEqual([leafA]);
    expect(Object.isFrozen(accepted.loadedChildren.get(branchA.value))).toBe(true);
    expect(accepted.loading).toBe(false);
    expect(await controller.load(branchA)).toBe(true);
    expect(calls).toBe(1);
    controller.cancel();
    expect(controller.getSnapshot().loadedChildren.get(branchA.value)).toEqual([leafA]);
  });

  test('aborts obsolete navigation and resolves cancellation even when adapters ignore the signal', async () => {
    const a = deferred<readonly CascaderNode[]>();
    const b = deferred<readonly CascaderNode[]>();
    const signals = new Map<string, AbortSignal>();
    const errors: CascaderLoadError[] = [];
    const controller = new CascaderLoadController({
      items: [branchA, branchB], onError: (error) => { errors.push(error); },
      getChildren: (node, { signal }) => {
        signals.set(node!.value, signal);
        return node!.value === branchA.value ? a.promise : b.promise;
      },
    });
    const first = controller.load(branchA);
    await tick();
    const second = controller.load(branchB);
    await tick();
    expect(signals.get(branchA.value)!.aborted).toBe(true);
    expect(signals.get(branchB.value)!.aborted).toBe(false);
    expect(await first).toBe(false);
    b.resolve([leafB]);
    expect(await second).toBe(true);
    const accepted = controller.getSnapshot();
    a.resolve([leafA]);
    await tick();
    expect(controller.getSnapshot()).toBe(accepted);
    expect(accepted.loadedChildren.has(branchA.value)).toBe(false);
    expect(accepted.loadedChildren.get(branchB.value)).toEqual([leafB]);
    expect(errors).toEqual([]);
  });

  test('a failed level leaves no cache entry, produces safe error state, and can retry', async () => {
    let attempt = 0;
    const errors: CascaderLoadError[] = [];
    const controller = new CascaderLoadController({
      items: [branchA], onError: (error) => { errors.push(error); },
      getChildren: async () => {
        if (++attempt === 1) throw new Error('secret provider URL and organization payload');
        return [leafA];
      },
    });
    expect(await controller.load(branchA)).toBe(false);
    const failed = controller.getSnapshot();
    expect(failed.loadedChildren.size).toBe(0);
    expect(failed.loading).toBe(false);
    expect(failed.loadError).toEqual({
      code: 'CASCADER_LOAD_FAILED', operation: 'children', message: 'This level could not be loaded. Try again.',
    });
    expect(JSON.stringify(errors)).not.toContain('provider');
    expect(await controller.retryLoad()).toBe(true);
    expect(controller.getSnapshot().loadError).toBeNull();
    expect(attempt).toBe(2);
    expect(failed.loadedChildren.size).toBe(0);
    expect(await controller.retryLoad()).toBe(false);
  });

  test('static levels and absent loaders complete without invoking adapters', async () => {
    let calls = 0;
    const staticBranch = { ...branchA, children: [leafA] };
    const controller = new CascaderLoadController({ items: [staticBranch], getChildren: async () => { calls++; return []; } });
    expect(await controller.load(staticBranch)).toBe(true);
    expect(calls).toBe(0);
    const staticOnly = new CascaderLoadController({ items: [leafA] });
    expect(await staticOnly.load(null)).toBe(true);
    expect(staticOnly.getSnapshot().loading).toBe(false);
  });

  test('can load roots and accepts a successful empty level as resolved', async () => {
    const seen: (string | null)[] = [];
    const controller = new CascaderLoadController({
      items: [], getChildren: async (node) => {
        seen.push(node?.value ?? null);
        return node ? [] : [branchA];
      },
    });
    expect(await controller.load(null)).toBe(true);
    expect(controller.getSnapshot().loadedChildren.get(null)).toEqual([branchA]);
    expect(await controller.load(branchA)).toBe(true);
    expect(controller.getSnapshot().loadedChildren.get(branchA.value)).toEqual([]);
    expect(await controller.load(branchA)).toBe(true);
    expect(seen).toEqual([null, branchA.value]);
  });

  test('an empty static array with hasChildren loads before navigating and exposes accepted cache immediately', async () => {
    const branch = { ...branchA, children: [] };
    const seen: string[] = [];
    const controller = new CascaderLoadController({
      items: [branch], getChildren: async (node) => { seen.push(node!.value); return [leafA]; },
    });
    const readChildren = controller.getLoadedChildren;
    expect(readChildren().has(branch.value)).toBe(false);
    expect(await controller.load(branch)).toBe(true);
    expect(controller.getLoadedChildren).toBe(readChildren);
    expect(readChildren().get(branch.value)).toEqual([leafA]);
    expect(await controller.load(branch)).toBe(true);
    expect(seen).toEqual([branch.value]);
    const emptyBranch = { ...branchB, children: [] };
    let emptyCalls = 0;
    const empty = new CascaderLoadController({
      items: [emptyBranch], getChildren: async () => { emptyCalls++; return []; },
    });
    expect(await empty.load(emptyBranch)).toBe(true);
    expect(empty.getLoadedChildren().has(emptyBranch.value)).toBe(true);
    expect(empty.getLoadedChildren().get(emptyBranch.value)).toEqual([]);
    expect(await empty.load(emptyBranch)).toBe(true);
    expect(emptyCalls).toBe(1);
  });

  test('rejects malformed adapter values and duplicate identities across loaded branches', async () => {
    const duplicate = { value: leafA.value, label: 'Duplicate in another branch' };
    const controller = new CascaderLoadController({
      items: [branchA, branchB], getChildren: async (node) => node === branchA ? [leafA] : [duplicate],
    });
    expect(await controller.load(branchA)).toBe(true);
    expect(await controller.load(branchB)).toBe(false);
    expect(controller.getSnapshot().loadedChildren.has(branchB.value)).toBe(false);
    const malformed = new CascaderLoadController({
      items: [branchA], getChildren: async () => [{ value: 'invalid', label: 'Bad', disabled: 'yes' }] as unknown as CascaderNode[],
    });
    expect(await malformed.load(branchA)).toBe(false);
    expect(malformed.getSnapshot().loadError?.code).toBe('CASCADER_LOAD_FAILED');
  });

  test('deep search is latest-wins, full-path annotated, and independent from loading', async () => {
    const oldResponse = deferred<readonly CascaderSearchResult[]>();
    const newResponse = deferred<readonly CascaderSearchResult[]>();
    const childResponse = deferred<readonly CascaderNode[]>();
    const signals = new Map<string, AbortSignal>();
    const controller = new CascaderLoadController({
      items: [branchA], getChildren: () => childResponse.promise,
      onSearch: (query, { signal }) => {
        signals.set(query, signal);
        return query === 'old' ? oldResponse.promise : newResponse.promise;
      },
    });
    const child = controller.load(branchA);
    const first = controller.search('old');
    await tick();
    const second = controller.search(' new ');
    await tick();
    expect(signals.get('old')!.aborted).toBe(true);
    expect(signals.has('new')).toBe(true);
    expect(controller.getSnapshot().loading).toBe(true);
    const path = [branchB, leafB];
    newResponse.resolve([{ node: leafB, path }]);
    await second;
    const result = controller.getSnapshot().searchResults;
    expect(result).toEqual([{ node: leafB, path: [branchB, leafB] }]);
    path.pop();
    expect(result![0]!.path).toEqual([branchB, leafB]);
    oldResponse.resolve([{ node: leafA, path: [branchA, leafA] }]);
    await first;
    await tick();
    expect(controller.getSnapshot().searchResults).toBe(result);
    childResponse.resolve([leafA]);
    expect(await child).toBe(true);
    expect(controller.getSnapshot().searchResults).toBe(result);
  });

  test('single-flights identical active search and clears empty query without calling an adapter', async () => {
    const response = deferred<readonly CascaderSearchResult[]>();
    const queries: string[] = [];
    const controller = new CascaderLoadController({
      items: [], onSearch: (query) => { queries.push(query); return response.promise; },
    });
    const first = controller.search('Read');
    expect(controller.search(' Read ')).toBe(first);
    await tick();
    await controller.search(' ');
    await first;
    expect(queries).toEqual(['Read']);
    expect(controller.getSnapshot().searchResults).toBeUndefined();
    expect(controller.getSnapshot().searchLoading).toBe(false);
    response.resolve([{ node: leafA, path: [branchA, leafA] }]);
    await tick();
    expect(controller.getSnapshot().searchResults).toBeUndefined();
  });

  test('search errors are sanitized and malformed result paths fail admission', async () => {
    const controller = new CascaderLoadController({
      items: [], onSearch: async () => [{ node: leafA, path: [branchB] }],
    });
    await controller.search('private search query');
    expect(controller.getSnapshot().searchError).toEqual({
      code: 'CASCADER_LOAD_FAILED', operation: 'search', message: 'Search could not be completed. Try again.',
    });
    expect(controller.getSnapshot().searchResults).toBeUndefined();
    expect(controller.getSnapshot().searchLoading).toBe(false);
    const failed = new CascaderLoadController({ items: [], onSearch: async () => { throw new Error('sensitive payload'); } });
    await failed.search('anything');
    expect(JSON.stringify(failed.getSnapshot().searchError)).not.toContain('sensitive');
  });

  test('disposal drains visible work and late success or rejection cannot reactivate the scope', async () => {
    const children = deferred<readonly CascaderNode[]>();
    const search = deferred<readonly CascaderSearchResult[]>();
    const errors: CascaderLoadError[] = [];
    const signals: AbortSignal[] = [];
    const controller = new CascaderLoadController({
      items: [branchA], onError: (error) => { errors.push(error); },
      getChildren: (_, { signal }) => { signals.push(signal); return children.promise; },
      onSearch: (_, { signal }) => { signals.push(signal); return search.promise; },
    });
    const loaded = controller.load(branchA);
    const searched = controller.search('read');
    await tick();
    controller.dispose();
    expect(await loaded).toBe(false);
    await searched;
    const retired = controller.getSnapshot();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    children.resolve([leafA]);
    search.reject(new Error('late rejection'));
    await tick();
    expect(controller.getSnapshot()).toBe(retired);
    expect(retired.loadedChildren.size).toBe(0);
    expect(retired.loading).toBe(false);
    expect(retired.searchLoading).toBe(false);
    expect(errors).toEqual([]);
    expect(await controller.load(branchA)).toBe(false);
  });

  test('a synchronously retired owner cannot publish data or errors before effect cleanup', async () => {
    let current = true;
    const children = deferred<readonly CascaderNode[]>();
    const errors: CascaderLoadError[] = [];
    const controller = new CascaderLoadController({
      items: [branchA], isActive: () => current,
      getChildren: () => children.promise, onError: (error) => { errors.push(error); },
    });
    const pending = controller.load(branchA);
    await tick();
    current = false;
    children.resolve([leafA]);
    await tick();
    expect(controller.getSnapshot().loadedChildren.size).toBe(0);
    expect(errors).toEqual([]);
    controller.cancel();
    expect(await pending).toBe(false);
    const replacement = new CascaderLoadController({ items: [branchA], getChildren: async () => [leafB] });
    expect(replacement.getSnapshot().loadedChildren.size).toBe(0);
    expect(await replacement.load(branchA)).toBe(true);
    expect(controller.getSnapshot().loadedChildren.size).toBe(0);
  });

  test('an aborted rejection is silent and a thrown error observer cannot prevent retry', async () => {
    const obsolete = deferred<readonly CascaderNode[]>();
    let call = 0;
    const controller = new CascaderLoadController({
      items: [branchA, branchB], onError: () => { throw new Error('bad observer'); },
      getChildren: () => ++call === 1 ? obsolete.promise : Promise.reject(new Error('load failed')),
    });
    const first = controller.load(branchA);
    await tick();
    const second = controller.load(branchB);
    obsolete.reject(new Error('obsolete credentials'));
    expect(await first).toBe(false);
    expect(await second).toBe(false);
    expect(controller.getSnapshot().loadError?.operation).toBe('children');
    expect(controller.getSnapshot().loading).toBe(false);
    expect(await controller.load(branchB)).toBe(false);
    expect(call).toBe(3);
  });

  test('cancelling before the first microtask prevents adapter invocation altogether', async () => {
    let childCalls = 0;
    let searchCalls = 0;
    const controller = new CascaderLoadController({
      items: [branchA], getChildren: async () => { childCalls++; return [leafA]; },
      onSearch: async () => { searchCalls++; return []; },
    });
    const child = controller.load(branchA);
    const search = controller.search('read');
    controller.cancel();
    expect(await child).toBe(false);
    await search;
    await tick();
    expect(childCalls).toBe(0);
    expect(searchCalls).toBe(0);
    expect(controller.getSnapshot().loading).toBe(false);
    expect(controller.getSnapshot().searchLoading).toBe(false);
  });

  test('malformed deep trees and repeated or mismatched remote paths cannot be cached', async () => {
    const cycle: CascaderNode = { value: 'cycle', label: 'Cycle' };
    cycle.children = [cycle];
    const controller = new CascaderLoadController({ items: [branchA], getChildren: async () => [cycle] });
    expect(await controller.load(branchA)).toBe(false);
    expect(controller.getSnapshot().loadedChildren.size).toBe(0);
    for (const result of [
      { node: leafA, path: [branchA, leafA, leafA] },
      { node: leafA, path: [] },
      { node: leafA, path: [branchA, leafB] },
    ]) {
      const search = new CascaderLoadController({ items: [], onSearch: async () => [result] });
      await search.search('Read');
      expect(search.getSnapshot().searchError?.code).toBe('CASCADER_LOAD_FAILED');
      expect(search.getSnapshot().searchResults).toBeUndefined();
    }
    const duplicate = new CascaderLoadController({
      items: [], onSearch: async () => [
        { node: leafA, path: [branchA, leafA] },
        { node: leafA, path: [branchA, leafA] },
      ],
    });
    await duplicate.search('Read');
    expect(duplicate.getSnapshot().searchError?.code).toBe('CASCADER_LOAD_FAILED');
  });
});
