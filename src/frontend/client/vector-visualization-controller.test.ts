import { describe, expect, it } from 'bun:test';
import { VectorVisualizationController } from './vector-visualization-controller';
import type { VectorVisualizationAdapter, VectorVisualizationSnapshot } from '../../vector/visualization-types';

function deferred<T>() { let resolve!: (value: T) => void, reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function snapshot(id = 'operation:a', revision = 1): VectorVisualizationSnapshot {
  return { id, index: 'docs', kind: 'search', revision, status: 'running', createdAt: '2026-10-08T12:00:00.000Z',
    updatedAt: '2026-10-08T12:00:00.000Z', stages: [] };
}
async function flush() { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }
function fixture() {
  const gets: Array<{ id: string; signal?: AbortSignal; pending: ReturnType<typeof deferred<VectorVisualizationSnapshot | null>> }> = [];
  const subscriptions: Array<{ id: string; listener: (value: VectorVisualizationSnapshot | null) => void; removed: boolean }> = [];
  const starts: Array<{ signal?: AbortSignal; pending: ReturnType<typeof deferred<VectorVisualizationSnapshot>> }> = [];
  const cancels: Array<{ id: string; pending: ReturnType<typeof deferred<VectorVisualizationSnapshot | null>> }> = [];
  const adapter: VectorVisualizationAdapter = {
    get(id, signal) { const pending = deferred<VectorVisualizationSnapshot | null>(); gets.push({ id, signal, pending }); return pending.promise; },
    subscribe(id, listener) { const entry = { id, listener, removed: false }; subscriptions.push(entry); return () => { entry.removed = true; }; },
    search(_input, signal) { const pending = deferred<VectorVisualizationSnapshot>(); starts.push({ signal, pending }); return pending.promise; },
    ingest(_input, signal) { const pending = deferred<VectorVisualizationSnapshot>(); starts.push({ signal, pending }); return pending.promise; },
    cancel(id) { const pending = deferred<VectorVisualizationSnapshot | null>(); cancels.push({ id, pending }); return pending.promise; },
  };
  return { controller: new VectorVisualizationController(adapter), adapter, gets, subscriptions, starts, cancels };
}
describe('vector visualization observation controller', () => {
  it('attachment never starts backend work and live monotonic revisions outrun an old baseline', async () => {
    const f = fixture(); f.controller.attach('operation:a');
    f.subscriptions[0]!.listener(snapshot('operation:a', 5));
    f.gets[0]!.pending.resolve(snapshot('operation:a', 2)); await flush();
    f.subscriptions[0]!.listener(snapshot('operation:a', 3));
    expect(f.controller.getSnapshot().snapshot?.revision).toBe(5);
    expect(f.starts).toHaveLength(0); f.controller.dispose();
  });
  it('an absent late HTTP baseline does not erase an already accepted live revision', async () => {
    const f = fixture(); f.controller.attach('operation:a');
    f.subscriptions[0]!.listener(snapshot('operation:a', 5));
    f.gets[0]!.pending.resolve(null); await flush();
    expect(f.controller.getSnapshot()).toMatchObject({ status: 'ready', snapshot: { revision: 5 } }); f.controller.dispose();
  });
  it('authoritative subscription-null retires old reads and cannot be resurrected by a late baseline', async () => {
    const f = fixture(); f.controller.attach('operation:a');
    f.subscriptions[0]!.listener(snapshot('operation:a', 5));
    f.subscriptions[0]!.listener(null);
    expect(f.gets[0]!.signal?.aborted).toBe(true);
    expect(f.subscriptions[0]!.removed).toBe(true);
    f.gets[0]!.pending.resolve(snapshot('operation:a', 6)); await flush();
    expect(f.controller.getSnapshot()).toMatchObject({ status: 'unavailable', snapshot: null }); f.controller.dispose();
  });
  it('superseding an attachment fences both ignored-abort HTTP and late unsubscribed callbacks', async () => {
    const f = fixture(); f.controller.attach('operation:a'); f.controller.attach('operation:b');
    expect(f.gets[0]!.signal?.aborted).toBe(true);
    f.subscriptions[0]!.listener(snapshot('operation:a', 9)); f.gets[0]!.pending.resolve(snapshot('operation:a', 10));
    f.subscriptions[1]!.listener(snapshot('operation:b', 2)); await flush();
    expect(f.controller.getSnapshot().snapshot?.id).toBe('operation:b'); f.controller.dispose();
  });
  it('a newer start supersedes an ignored-abort accepted result instead of replaying it', async () => {
    const f = fixture(); const first = f.controller.search({ text: 'first' }); const rejected = first.catch(error => error);
    const second = f.controller.search({ text: 'second' });
    f.starts[0]!.pending.resolve(snapshot('operation:a')); expect(await rejected).toMatchObject({ name: 'AbortError' });
    f.starts[1]!.pending.resolve(snapshot('operation:b')); await second;
    expect(f.controller.getSnapshot().snapshot?.id).toBe('operation:b');
    expect(f.subscriptions.map(entry => entry.id)).toEqual(['operation:b']); f.controller.dispose();
  });
  it('cancellation never regresses a newer accepted live revision', async () => {
    const f = fixture(); f.controller.attach('operation:a'); f.subscriptions[0]!.listener(snapshot('operation:a', 3));
    const cancellation = f.controller.cancel();
    f.subscriptions[0]!.listener({ ...snapshot('operation:a', 5), status: 'completed' });
    f.cancels[0]!.pending.resolve({ ...snapshot('operation:a', 4), status: 'cancelled' }); await cancellation;
    expect(f.controller.getSnapshot().snapshot).toMatchObject({ revision: 5, status: 'completed' }); f.controller.dispose();
  });
  it('cancellation rejects mismatched identity and ignores superseded attachment delivery', async () => {
    const f = fixture(); f.controller.attach('operation:a'); f.subscriptions[0]!.listener(snapshot());
    const bad = f.controller.cancel(); const rejected = bad.catch(error => error);
    f.cancels[0]!.pending.resolve(snapshot('foreign', 2)); expect(await rejected).toBeInstanceOf(Error);
    expect(f.controller.getSnapshot().snapshot?.id).toBe('operation:a');
    const later = f.controller.cancel(); f.controller.attach('operation:b'); f.subscriptions[1]!.listener(snapshot('operation:b', 2));
    f.cancels[1]!.pending.resolve({ ...snapshot('operation:a', 3), status: 'cancelled' }); await later;
    expect(f.controller.getSnapshot().snapshot?.id).toBe('operation:b'); f.controller.dispose();
  });
  it('dispose is idempotent, detaches rather than cancelling execution, and fences late deliveries', async () => {
    const f = fixture(); let notices = 0; f.controller.subscribe(() => { notices++; }); f.controller.attach('operation:a');
    f.controller.dispose(); f.controller.dispose(); const atDispose = notices;
    f.gets[0]!.pending.resolve(snapshot()); f.subscriptions[0]!.listener(snapshot()); await flush();
    expect(f.controller.getSnapshot().status).toBe('idle'); expect(notices).toBe(atDispose);
    expect(f.cancels).toHaveLength(0); expect(f.gets[0]!.signal?.aborted).toBe(true);
    await expect(f.controller.search({ text: 'late' })).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('fresh controllers can reattach after strict-mode-style mount/unmount without starting operations', async () => {
    const f = fixture(); f.controller.attach('operation:a'); f.controller.dispose();
    const current = new VectorVisualizationController(f.adapter); current.attach('operation:a');
    f.gets[1]!.pending.resolve(snapshot('operation:a', 7)); await flush();
    expect(current.getSnapshot().snapshot?.revision).toBe(7); expect(f.starts).toHaveLength(0); current.dispose();
  });
  for (const retirement of ['null', 'throw', 'error'] as const) {
    it(`an accepted start cannot resurrect data after synchronous subscription ${retirement}`, async () => {
      const f = fixture(); let reads = 0, detached = 0;
      f.adapter.subscribe = (_id, listener, onError) => {
        if (retirement === 'throw') throw new Error('private adapter details');
        if (retirement === 'null') listener(null); else onError?.(new Error('private adapter details'));
        return () => { detached++; };
      };
      f.adapter.get = async () => { reads++; return snapshot(); };
      const started = f.controller.search({ text: 'private query' });
      const rejected = started.catch(error => error);
      f.starts[0]!.pending.resolve(snapshot());
      expect(await rejected).toMatchObject({ name: 'AbortError' }); await flush();
      expect(f.controller.getSnapshot()).toMatchObject({ status: retirement === 'null' ? 'unavailable' : 'error', snapshot: null });
      expect(JSON.stringify(f.controller.getSnapshot())).not.toContain('private');
      expect(reads).toBe(0); expect(detached).toBe(retirement === 'throw' ? 0 : 1); f.controller.dispose();
    });
  }
  it('a synchronous baseline read failure detaches safely without escaping the attachment effect', () => {
    const f = fixture(); let signal: AbortSignal | undefined;
    f.adapter.get = (_id, received) => { signal = received; throw new Error('private read details'); };
    expect(() => f.controller.attach('operation:a')).not.toThrow();
    expect(f.controller.getSnapshot()).toMatchObject({ status: 'error', snapshot: null });
    expect(f.subscriptions[0]!.removed).toBe(true); expect(signal?.aborted).toBe(true);
    f.subscriptions[0]!.listener(snapshot('operation:a', 9));
    expect(f.controller.getSnapshot().snapshot).toBeNull(); f.controller.dispose();
  });
  it('a synchronous baseline failure also prevents seeding an accepted start', async () => {
    const f = fixture(); f.adapter.get = () => { throw new Error('private read details'); };
    const started = f.controller.ingest({ document: { id: 'doc', title: 'Private', text: 'body' } });
    const rejected = started.catch(error => error); f.starts[0]!.pending.resolve(snapshot());
    expect(await rejected).toMatchObject({ name: 'AbortError' });
    expect(f.controller.getSnapshot()).toMatchObject({ status: 'error', snapshot: null });
    expect(f.subscriptions[0]!.removed).toBe(true); f.controller.dispose();
  });
  it('cleanup callbacks cannot resurrect data even if cleanup itself throws', () => {
    const f = fixture();
    f.adapter.subscribe = (_id, listener) => () => { listener(snapshot('operation:a', 99)); throw new Error('cleanup'); };
    f.controller.attach('operation:a');
    expect(() => f.controller.attach(null)).not.toThrow();
    expect(f.controller.getSnapshot()).toMatchObject({ status: 'idle', snapshot: null }); f.controller.dispose();
  });
});
