import { describe, expect, it } from 'bun:test';
import { createVectorVisualizationClient, parseVectorVisualizationSnapshot, parseVectorVisualizationMap } from './vector-visualization-client';
import type { FetchInit } from './sdk';
import type { Row } from '../../sync/types';
import type { VectorVisualizationSnapshot } from '../../vector/visualization-types';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function snapshot(id = 'operation:a', revision = 1): VectorVisualizationSnapshot { return { id, index: 'docs', kind: 'search', status: 'running', revision,
  createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z', stages: [] }; }
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function fixture(enabled = true, metadataFeed = false) {
  let boundary = { key: 'authority:a', ready: true, connected: true };
  let rows: Record<string, Row> = {};
  const rowListeners = new Set<() => void>(), boundaryListeners = new Set<() => void>();
  const requests: Array<{ path: string; init?: FetchInit; pending: ReturnType<typeof deferred<unknown>> }> = [];
  const failures: string[] = [];
  const client = createVectorVisualizationClient({ enabled, boundary: () => boundary,
    ...(metadataFeed ? { feed: () => rows } : { rows: () => rows }),
    fetch<T>(path: string, init?: FetchInit): Promise<T> { const pending = deferred<unknown>(); requests.push({ path, init, pending }); return pending.promise as Promise<T>; },
    subscribeRows(callback) { rowListeners.add(callback); return () => { rowListeners.delete(callback); }; },
    subscribeBoundary(callback) { boundaryListeners.add(callback); return () => { boundaryListeners.delete(callback); }; },
    reportFailure(action) { failures.push(action); },
  }, 'docs');
  return { client, requests, rowListeners, boundaryListeners, failures,
    boundary(change: Partial<typeof boundary>) { boundary = { ...boundary, ...change }; for (const listener of [...boundaryListeners]) listener(); },
    rows(value: Record<string, Row>) { rows = value; for (const listener of [...rowListeners]) listener(); },
  };
}
describe('authorized vector visualization client', () => {
  it('uses the existing HTTP transport with caller signal and index-bound command body', async () => {
    const f = fixture(); const abort = new AbortController(); const reading = f.client.get('operation:a', abort.signal);
    expect(f.requests[0]).toMatchObject({ path: '/api/vector-visualizations/operation%3Aa?index=docs', init: { signal: abort.signal } });
    f.requests[0]!.pending.resolve(snapshot()); expect(await reading).toEqual(snapshot());
    const started = f.client.search!({ text: 'actual query', index: 'ignored' });
    expect(f.requests[1]!.init).toMatchObject({ method: 'POST', body: { text: 'actual query', index: 'docs' } });
    f.requests[1]!.pending.resolve(snapshot()); await started;
  });
  it('fences authority changes at asynchronous delivery even when transport ignores cancellation', async () => {
    const f = fixture(); const reading = f.client.get('operation:a'); const rejected = reading.catch(error => error);
    f.boundary({ key: 'authority:b' }); f.requests[0]!.pending.resolve(snapshot()); expect(await rejected).toMatchObject({ name: 'AbortError' });
    const disabled = fixture(false); await expect(disabled.client.get('operation:a')).rejects.toMatchObject({ name: 'AbortError' }); expect(disabled.requests).toHaveLength(0);
  });
  it('does not accept a guessed wrong operation identity or bound index from get/cancel', async () => {
    const f = fixture();
    for (const read of [() => f.client.get('operation:a'), () => f.client.cancel!('operation:a')]) {
      const reading = read(); const rejected = reading.catch(error => error);
      f.requests.at(-1)!.pending.resolve(snapshot('foreign')); expect(await rejected).toBeInstanceOf(Error);
    }
    const reading = f.client.get('operation:a'); const rejected = reading.catch(error => error);
    f.requests.at(-1)!.pending.resolve({ ...snapshot(), index: 'other' }); expect(await rejected).toBeInstanceOf(Error);
  });
  it('publishes only increasing authorized ReactiveDB revisions and disposes both subscriptions', () => {
    const f = fixture(); const values: Array<VectorVisualizationSnapshot | null> = [];
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    for (const revision of [3, 2, 3, 4]) f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot('operation:a', revision)) } });
    expect(values.map(value => value?.revision)).toEqual([3, 4]);
    remove(); expect(f.rowListeners.size).toBe(0); expect(f.boundaryListeners.size).toBe(0);
    f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot('operation:a', 5)) } }); expect(values).toHaveLength(2);
  });
  it('authority retirement clears live presentation and prevents new old-boundary publications', () => {
    const f = fixture(); const values: Array<VectorVisualizationSnapshot | null> = []; let errors = 0;
    const remove = f.client.subscribe('operation:a', value => values.push(value), () => { errors++; });
    f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot()) } });
    f.boundary({ ready: false });
    f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot('operation:a', 2)) } });
    expect(values.map(value => value?.revision ?? null)).toEqual([1, null]); expect(errors).toBe(1); remove();
  });
  it('coalesces reconnect reads and a newer live receipt outruns their older HTTP baseline', async () => {
    const f = fixture(); const values: Array<VectorVisualizationSnapshot | null> = [];
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    f.boundary({ connected: false }); f.boundary({ connected: true });
    expect(f.requests).toHaveLength(1);
    f.boundary({ connected: false }); f.boundary({ connected: true }); expect(f.requests).toHaveLength(1);
    f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot('operation:a', 8)) } });
    f.requests[0]!.pending.resolve(snapshot('operation:a', 3)); await flush();
    expect(values.map(value => value?.revision)).toEqual([8]); expect(f.requests).toHaveLength(2);
    f.requests[1]!.pending.resolve(snapshot('operation:a', 8)); await flush(); remove();
  });
  it('a reconnect HTTP null baseline does not erase a newer current live record', async () => {
    const f = fixture(); const values: Array<VectorVisualizationSnapshot | null> = [];
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    f.boundary({ connected: false }); f.boundary({ connected: true });
    f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot('operation:a', 8)) } });
    f.requests[0]!.pending.resolve(null); await flush();
    expect(values.map(value => value?.revision ?? null)).toEqual([8]); remove();
  });
  it('rejects non-finite/accessor/oversized transport objects before they reach rendering', () => {
    let reads = 0;
    expect(() => parseVectorVisualizationSnapshot({ ...snapshot(), get query() { reads++; return {}; } })).toThrow(); expect(reads).toBe(0);
    expect(() => parseVectorVisualizationSnapshot({ ...snapshot(), revision: Infinity })).toThrow();
    expect(() => parseVectorVisualizationSnapshot({ ...snapshot(), query: { text: 'x'.repeat(250_000) } })).toThrow();
    expect(() => parseVectorVisualizationMap({ revision: 1, dimensions: 3, projectionId: 'p', points: [{ id: 'x', position: { x: NaN, y: 0 } }], clusters: [], capabilities: {} })).toThrow();
  });
  it('coalesces fixed-slot metadata feed updates into reads of only the attached operation', async () => {
    const f = fixture(true, true), values: Array<VectorVisualizationSnapshot | null> = [];
    const signal = (token: string, index = 'docs') => ({ index_name: index, kind: 'search', change_token: token });
    f.rows({ slot: signal('baseline') });
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    expect(f.requests).toHaveLength(0);
    f.rows({ slot: signal('baseline'), unrelated: signal('other', 'other-index') });
    expect(f.requests).toHaveLength(0);
    f.rows({ slot: signal('revision:2') }); f.rows({ slot: signal('revision:3') }); f.rows({ slot: signal('revision:4') });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]!.path).toBe('/api/vector-visualizations/operation%3Aa?index=docs');
    // No full operation snapshot (or unrelated history) is carried by the feed.
    expect(values).toEqual([]);
    f.requests[0]!.pending.resolve(snapshot('operation:a', 2)); await flush();
    expect(f.requests).toHaveLength(2); expect(values.map(value => value?.revision)).toEqual([2]);
    f.requests[1]!.pending.resolve(snapshot('operation:a', 4)); await flush();
    expect(values.map(value => value?.revision)).toEqual([2, 4]);
    f.rows({ slot: signal('revision:4') }); expect(f.requests).toHaveLength(2);
    remove(); expect(f.rowListeners.size).toBe(0); expect(f.boundaryListeners.size).toBe(0);
  });
  it('a superseded feed baseline cannot retire an operation before its queued reconciliation', async () => {
    const f = fixture(true, true), values: Array<VectorVisualizationSnapshot | null> = [];
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    f.rows({ slot: { index_name: 'docs', change_token: 'first' } });
    f.rows({ slot: { index_name: 'docs', change_token: 'second' } });
    f.requests[0]!.pending.resolve(null); await flush();
    expect(values).toEqual([]); expect(f.requests).toHaveLength(2);
    f.requests[1]!.pending.resolve(snapshot('operation:a', 3)); await flush();
    expect(values.map(value => value?.revision)).toEqual([3]); remove();
  });
  it('authority retirement aborts feed reads and late metadata cannot revive presentation', async () => {
    const f = fixture(true, true), values: Array<VectorVisualizationSnapshot | null> = [];
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    f.rows({ slot: { index_name: 'docs', change_token: 'first' } });
    f.boundary({ ready: false }); expect(f.requests[0]!.init?.signal?.aborted).toBe(true);
    f.requests[0]!.pending.resolve(snapshot('operation:a', 7)); await flush();
    f.rows({ slot: { index_name: 'docs', change_token: 'second' } });
    expect(values).toEqual([null]); expect(f.requests).toHaveLength(1); remove();
  });
  it('completed historical cards do not refetch for new feed events but still revalidate authority', async () => {
    const f = fixture(true, true), values: Array<VectorVisualizationSnapshot | null> = [];
    const remove = f.client.subscribe('operation:a', value => values.push(value));
    const initial = f.client.get('operation:a');
    f.requests[0]!.pending.resolve({ ...snapshot('operation:a', 4), status: 'completed' }); await initial;
    for (let revision = 1; revision <= 50; revision++) f.rows({ slot: { index_name: 'docs', change_token: `new-operation:${revision}` } });
    expect(f.requests).toHaveLength(1); expect(values).toEqual([]);
    f.boundary({ connected: false }); f.boundary({ connected: true });
    expect(f.requests).toHaveLength(2);
    f.requests[1]!.pending.resolve({ ...snapshot('operation:a', 4), status: 'completed' }); await flush();
    f.boundary({ ready: false }); expect(values.at(-1)).toBeNull(); remove();
    expect(f.rowListeners.size).toBe(0); expect(f.boundaryListeners.size).toBe(0);
  });
  it('subscription setup failures clean up partial subscriptions instead of leaking observers', () => {
    let removed = 0;
    const client = createVectorVisualizationClient({ enabled: true,
      boundary: () => ({ key: 'current', ready: true, connected: true }), rows: () => ({}),
      fetch: async <T>() => null as T,
      subscribeRows: () => () => { removed++; },
      subscribeBoundary: () => { throw new Error('subscription unavailable'); },
    });
    expect(() => client.subscribe('operation:a', () => {})).toThrow(); expect(removed).toBe(1);
  });
  it('an observation error retires an imperative subscription until it is explicitly reattached', () => {
    const f = fixture(), values: Array<VectorVisualizationSnapshot | null> = []; let errors = 0;
    const remove = f.client.subscribe('operation:a', value => values.push(value), () => { errors++; });
    f.rows({ 'operation:a': { snapshot_json: 'invalid json' } });
    f.rows({ 'operation:a': { snapshot_json: JSON.stringify(snapshot('operation:a', 7)) } });
    expect(values).toEqual([null]); expect(errors).toBe(1); remove();
  });
  it('retiring a managed feed observer stops subsequent feed/reconnect requests and removes listeners', async () => {
    const f = fixture(true, true), values: Array<VectorVisualizationSnapshot | null> = []; let errors = 0;
    const remove = f.client.subscribe('operation:a', value => values.push(value), () => { errors++; });
    f.rows({ slot: { index_name: 'docs', change_token: 'first' } });
    f.requests[0]!.pending.resolve({ invalid: 'snapshot' }); await flush();
    expect(values).toEqual([null]); expect(errors).toBe(1);
    expect(f.rowListeners.size).toBe(0); expect(f.boundaryListeners.size).toBe(0);
    f.rows({ slot: { index_name: 'docs', change_token: 'second' } });
    f.boundary({ connected: false }); f.boundary({ connected: true });
    expect(f.requests).toHaveLength(1); remove(); remove();
  });
  it('reports code-only read failures without leaking payloads or logging normal authority retirement', async () => {
    const f = fixture(); const reading = f.client.get('operation:a'); const rejected = reading.catch(error => error);
    f.requests[0]!.pending.resolve({ secret: 'private text cannot reach telemetry' });
    expect(await rejected).toBeInstanceOf(Error); expect(f.failures).toEqual(['read']);
    const stale = f.client.get('operation:a'); const retired = stale.catch(error => error);
    f.boundary({ key: 'authority:b' }); f.requests[1]!.pending.resolve(snapshot());
    expect(await retired).toMatchObject({ name: 'AbortError' }); expect(f.failures).toEqual(['read']);
  });
});
