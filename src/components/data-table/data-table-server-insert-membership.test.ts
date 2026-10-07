/** Pure lifecycle and receipt-order tests; no server, collection, or auth transport is started. */
import { describe, expect, test } from 'bun:test';
import {
  DataTableServerInsertMembership,
  type DataTableServerInsertMembershipConfiguration,
} from './data-table-server-insert-membership';
import type { DataTableServerChange } from './data-table-server-types';

interface Lookup {
  ids: readonly string[];
  signal: AbortSignal;
  resolve: (ids: readonly string[]) => void;
  reject: (cause: unknown) => void;
}

function fixture() {
  const coordinator = new DataTableServerInsertMembership();
  const lookups: Lookup[] = [];
  const changes: (readonly string[])[] = [];
  const errors: unknown[] = [];
  let current = true;
  const configuration: DataTableServerInsertMembershipConfiguration = {
    key: 'source-a/criteria-a',
    confirm: (ids, signal) => new Promise((resolve, reject) => lookups.push({ ids, signal, resolve, reject })),
    isCurrent: () => current,
    onChange: () => changes.push(coordinator.confirmedIds()),
    onError: cause => errors.push(cause),
  };
  coordinator.configure(configuration);
  return { coordinator, configuration, lookups, changes, errors, setCurrent: (value: boolean) => { current = value; } };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function insert(coordinator: DataTableServerInsertMembership, rowId: string, baseline: readonly string[] = []): void {
  coordinator.observe({ op: 'INSERT', rowId }, baseline);
}

describe('DataTableServerInsertMembership', () => {
  test('coalesces genuine unseen INSERTs, deduplicates receipts, and intersects responses with requested IDs', async () => {
    const f = fixture();
    const empty = f.coordinator.confirmedIds();
    expect(f.changes).toEqual([]);
    insert(f.coordinator, 'baseline', ['baseline']);
    f.coordinator.observe({ op: 'UPDATE', rowId: 'not-an-insert' }, []);
    insert(f.coordinator, 'new-a');
    insert(f.coordinator, 'new-a');
    insert(f.coordinator, '__proto__');
    insert(f.coordinator, 'not-returned-a');
    insert(f.coordinator, 'not-returned-b');
    expect(f.lookups).toHaveLength(0);
    expect(f.coordinator.confirmedIds()).toBe(empty);
    await flush();
    expect(f.lookups).toHaveLength(1);
    expect(f.lookups[0]!.ids).toEqual(['new-a', '__proto__', 'not-returned-a', 'not-returned-b']);
    insert(f.coordinator, 'new-a');
    f.lookups[0]!.resolve(['outside-batch', '__proto__', 'new-a', 'new-a']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual(['new-a', '__proto__']);
    expect(f.changes).toHaveLength(1);
    const confirmed = f.coordinator.confirmedIds();
    insert(f.coordinator, 'new-a');
    f.coordinator.observe({ op: 'DELETE', rowId: 'untracked' }, []);
    await flush();
    expect(f.lookups).toHaveLength(1);
    expect(f.coordinator.confirmedIds()).toBe(confirmed);
  });

  test('allows one active request and drains capped batches while new receipts coalesce', async () => {
    const f = fixture();
    for (let index = 0; index < 120; index += 1) insert(f.coordinator, `row-${index}`);
    await flush();
    expect(f.lookups).toHaveLength(1);
    expect(f.lookups[0]!.ids).toHaveLength(50);
    for (let index = 120; index < 127; index += 1) insert(f.coordinator, `row-${index}`);
    await flush();
    expect(f.lookups).toHaveLength(1);
    f.lookups[0]!.resolve(f.lookups[0]!.ids);
    await flush();
    expect(f.lookups).toHaveLength(2);
    expect(f.lookups[1]!.ids).toHaveLength(50);
    f.lookups[1]!.resolve(f.lookups[1]!.ids);
    await flush();
    expect(f.lookups).toHaveLength(3);
    expect(f.lookups[2]!.ids).toHaveLength(27);
    f.lookups[2]!.resolve(f.lookups[2]!.ids);
    await flush();
    expect(f.coordinator.confirmedIds()).toHaveLength(127);
    expect(f.lookups).toHaveLength(3);
  });

  test('same-key configuration preserves pending and confirmed evidence and replaces callback references', async () => {
    const f = fixture();
    insert(f.coordinator, 'new-a');
    await flush();
    const notifications: (readonly string[])[] = [];
    const replacementRequests: (readonly string[])[] = [];
    f.coordinator.configure({ ...f.configuration,
      confirm: async ids => { replacementRequests.push(ids); return ids; },
      onChange: () => notifications.push(f.coordinator.confirmedIds()),
    });
    expect(f.lookups[0]!.signal.aborted).toBe(false);
    f.lookups[0]!.resolve(['new-a']);
    await flush();
    expect(notifications).toEqual([['new-a']]);
    expect(f.changes).toEqual([]);
    const confirmed = f.coordinator.confirmedIds();
    f.coordinator.configure({ ...f.configuration, onChange: () => notifications.push(f.coordinator.confirmedIds()) });
    expect(f.coordinator.confirmedIds()).toBe(confirmed);
    expect(notifications).toHaveLength(1);
    f.coordinator.configure({ ...f.configuration, confirm: async ids => { replacementRequests.push(ids); return ids; } });
    insert(f.coordinator, 'new-b');
    await flush();
    expect(replacementRequests).toEqual([['new-b']]);
    expect(f.coordinator.confirmedIds()).toEqual(['new-a', 'new-b']);
  });

  test('later UPDATE invalidates an older pending lookup and immediately removes confirmed membership', async () => {
    const f = fixture();
    insert(f.coordinator, 'updated');
    await flush();
    f.coordinator.observe({ op: 'UPDATE', rowId: 'updated' }, []);
    f.lookups[0]!.resolve(['updated']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.lookups).toHaveLength(2);
    expect(f.lookups[1]!.ids).toEqual(['updated']);
    f.lookups[1]!.resolve(['updated']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual(['updated']);
    f.coordinator.observe({ op: 'UPDATE', rowId: 'updated' }, []);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    await flush();
    expect(f.lookups).toHaveLength(3);
    f.lookups[2]!.resolve([]);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.changes).toEqual([['updated'], []]);
  });

  test('DELETE retires pending and confirmed IDs and a later INSERT cannot reuse an older reply', async () => {
    const f = fixture();
    insert(f.coordinator, 'recreated');
    insert(f.coordinator, 'deleted');
    await flush();
    f.coordinator.observe({ op: 'DELETE', rowId: 'recreated' }, []);
    f.coordinator.observe({ op: 'DELETE', rowId: 'deleted' }, []);
    insert(f.coordinator, 'recreated');
    f.lookups[0]!.resolve(['recreated', 'deleted']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.lookups).toHaveLength(2);
    expect(f.lookups[1]!.ids).toEqual(['recreated']);
    f.lookups[1]!.resolve(['recreated']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual(['recreated']);
    f.coordinator.observe({ op: 'DELETE', rowId: 'recreated' }, []);
    expect(f.coordinator.confirmedIds()).toEqual([]);
  });

  test('pre-dispatch DELETE removes queued work and UPDATE coalesces into the latest receipt epoch', async () => {
    const f = fixture();
    insert(f.coordinator, 'deleted-before-dispatch');
    insert(f.coordinator, 'updated-before-dispatch');
    f.coordinator.observe({ op: 'DELETE', rowId: 'deleted-before-dispatch' }, []);
    f.coordinator.observe({ op: 'UPDATE', rowId: 'updated-before-dispatch' }, []);
    await flush();
    expect(f.lookups).toHaveLength(1);
    expect(f.lookups[0]!.ids).toEqual(['updated-before-dispatch']);
    f.lookups[0]!.resolve(f.lookups[0]!.ids);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual(['updated-before-dispatch']);
    expect(f.lookups).toHaveLength(1);
  });

  test('same-key replacement uses the latest error callback and immediately retires a current-false scope', async () => {
    const f = fixture();
    const replacementErrors: unknown[] = [];
    insert(f.coordinator, 'failed');
    await flush();
    f.coordinator.configure({ ...f.configuration, onError: cause => replacementErrors.push(cause) });
    const cause = new Error('latest callback only');
    f.lookups[0]!.reject(cause);
    await flush();
    expect(replacementErrors).toEqual([cause]);
    expect(f.errors).toEqual([]);
    insert(f.coordinator, 'retired');
    await flush();
    f.coordinator.configure({ ...f.configuration, isCurrent: () => false });
    expect(f.lookups[1]!.signal.aborted).toBe(true);
    f.lookups[1]!.reject(new Error('retired failure'));
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.errors).toEqual([]);
    expect(replacementErrors).toEqual([cause]);
  });

  test('source-key replacement aborts work and rejects stale success and error responses', async () => {
    const f = fixture();
    insert(f.coordinator, 'old-success');
    await flush();
    f.coordinator.configure({ ...f.configuration, key: 'source-b/criteria-a' });
    expect(f.lookups[0]!.signal.aborted).toBe(true);
    insert(f.coordinator, 'new');
    await flush();
    f.lookups[0]!.resolve(['old-success']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    f.lookups[1]!.resolve(['new']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual(['new']);
    insert(f.coordinator, 'old-error');
    await flush();
    f.coordinator.configure({ ...f.configuration, key: 'source-c/criteria-a' });
    f.lookups[2]!.reject(new Error('late failure'));
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.errors).toEqual([]);
  });

  test.each(['clear', 'cancel'] as const)('%s discards queued work and fences transports that ignore abort', async method => {
    const f = fixture();
    insert(f.coordinator, 'confirmed');
    await flush();
    f.lookups[0]!.resolve(['confirmed']);
    await flush();
    insert(f.coordinator, 'in-flight');
    await flush();
    insert(f.coordinator, 'queued');
    f.coordinator[method]();
    expect(f.lookups[1]!.signal.aborted).toBe(true);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    f.lookups[1]!.resolve(['in-flight']);
    await flush();
    expect(f.lookups).toHaveLength(2);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.changes).toEqual([['confirmed'], []]);
    insert(f.coordinator, 'new-after-retirement');
    f.coordinator[method]();
    await flush();
    expect(f.lookups).toHaveLength(2);
  });

  test('unsupported confirmation conservatively clears evidence without initial empty notifications', async () => {
    const f = fixture();
    f.coordinator.configure({ ...f.configuration, confirm: null });
    insert(f.coordinator, 'unsupported');
    await flush();
    expect(f.lookups).toEqual([]);
    expect(f.changes).toEqual([]);
    f.coordinator.configure(f.configuration);
    insert(f.coordinator, 'confirmed');
    await flush();
    f.lookups[0]!.resolve(['confirmed']);
    await flush();
    insert(f.coordinator, 'pending');
    await flush();
    f.coordinator.configure({ ...f.configuration, confirm: null });
    expect(f.lookups[1]!.signal.aborted).toBe(true);
    f.lookups[1]!.resolve(['pending']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.changes).toEqual([['confirmed'], []]);
  });

  test('denied and failed epochs never blindly retry, including duplicate INSERT receipts', async () => {
    const f = fixture();
    insert(f.coordinator, 'denied');
    await flush();
    f.lookups[0]!.resolve([]);
    await flush();
    insert(f.coordinator, 'denied');
    f.coordinator.observe({ op: 'UPDATE', rowId: 'denied' }, []);
    insert(f.coordinator, 'failed');
    await flush();
    const cause = new Error('transport failure');
    f.lookups[1]!.reject(cause);
    await flush();
    insert(f.coordinator, 'failed');
    f.coordinator.observe({ op: 'UPDATE', rowId: 'failed' }, []);
    await flush();
    expect(f.errors).toEqual([cause]);
    expect(f.lookups).toHaveLength(2);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.changes).toEqual([]);
  });

  test('checks current authority before starting and after awaiting; false clears evidence and suppresses errors', async () => {
    const f = fixture();
    insert(f.coordinator, 'never-started');
    f.setCurrent(false);
    await flush();
    expect(f.lookups).toEqual([]);
    f.setCurrent(true);
    insert(f.coordinator, 'confirmed');
    await flush();
    f.lookups[0]!.resolve(['confirmed']);
    await flush();
    insert(f.coordinator, 'late-success');
    await flush();
    f.setCurrent(false);
    f.lookups[1]!.resolve(['late-success']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.lookups[1]!.signal.aborted).toBe(true);
    f.setCurrent(true);
    insert(f.coordinator, 'late-error');
    await flush();
    f.setCurrent(false);
    f.lookups[2]!.reject(new Error('not-current'));
    await flush();
    expect(f.errors).toEqual([]);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    f.setCurrent(true);
    await flush();
    expect(f.lookups).toHaveLength(3);
  });

  test('rechecks current authority immediately before publishing a successful lookup', async () => {
    const f = fixture();
    insert(f.coordinator, 'must-not-publish');
    await flush();
    let reads = 0;
    f.coordinator.configure({ ...f.configuration, isCurrent: () => ++reads < 3 });
    f.lookups[0]!.resolve(['must-not-publish']);
    await flush();
    expect(reads).toBe(3);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.changes).toEqual([]);
  });

  test('caps all tracked identities at 1000 including settled receipts and frees capacity only on retirement', async () => {
    const f = fixture();
    for (let index = 0; index < 1_100; index += 1) insert(f.coordinator, `row-${index}`);
    await flush();
    for (let index = 0; index < 20; index += 1) {
      expect(f.lookups[index]!.ids).toHaveLength(50);
      f.lookups[index]!.resolve(index === 0 ? f.lookups[index]!.ids : []);
      await flush();
    }
    expect(f.lookups).toHaveLength(20);
    expect(f.lookups.flatMap(lookup => lookup.ids)).toHaveLength(1_000);
    expect(new Set(f.lookups.flatMap(lookup => lookup.ids)).size).toBe(1_000);
    expect(f.coordinator.confirmedIds()).toHaveLength(50);
    insert(f.coordinator, 'overflow');
    await flush();
    expect(f.lookups).toHaveLength(20);
    f.coordinator.observe({ op: 'DELETE', rowId: 'row-999' }, []);
    insert(f.coordinator, 'after-delete');
    await flush();
    expect(f.lookups).toHaveLength(21);
    expect(f.lookups[20]!.ids).toEqual(['after-delete']);
    f.lookups[20]!.resolve(['after-delete']);
    await flush();
    expect(f.coordinator.confirmedIds()).toHaveLength(51);
  });

  test('ignores malformed receipt IDs and operations without invoking confirmation', async () => {
    const f = fixture();
    for (const change of [null, { op: 'INSERT', rowId: '' }, { op: 'INSERT', rowId: 'x'.repeat(1_025) },
      { op: 'SNAPSHOT', rowId: 'not-live' }, { op: 'INSERT', rowId: 1 }]) {
      f.coordinator.observe(change as DataTableServerChange, []);
    }
    await flush();
    expect(f.lookups).toEqual([]);
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.changes).toEqual([]);
  });

  test('counts deleted in-flight identities in the cap until their older batch retires', async () => {
    const f = fixture();
    for (let index = 0; index < 1_000; index += 1) insert(f.coordinator, `row-${index}`);
    await flush();
    for (let index = 0; index < 50; index += 1) f.coordinator.observe({ op: 'DELETE', rowId: `row-${index}` }, []);
    insert(f.coordinator, 'row-0');
    for (let index = 0; index < 50; index += 1) insert(f.coordinator, `overflow-${index}`);
    f.lookups[0]!.resolve(f.lookups[0]!.ids);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    for (let index = 0; index < 50; index += 1) insert(f.coordinator, `admitted-${index}`);
    for (let index = 1; index < 21; index += 1) {
      f.lookups[index]!.resolve(f.lookups[index]!.ids);
      await flush();
    }
    const requested = f.lookups.flatMap(lookup => lookup.ids);
    expect(f.lookups).toHaveLength(21);
    expect(requested.filter(id => id.startsWith('overflow-'))).toEqual([]);
    expect(requested.filter(id => id.startsWith('admitted-'))).toHaveLength(49);
    expect(requested.filter(id => id === 'row-0')).toHaveLength(2);
    expect(f.coordinator.confirmedIds()).toHaveLength(1_000);
  });

  test('rejects a response larger than the requested batch before admitting any identities', async () => {
    const f = fixture();
    for (let index = 0; index < 50; index += 1) insert(f.coordinator, `row-${index}`);
    await flush();
    f.lookups[0]!.resolve([...f.lookups[0]!.ids, 'outside-batch']);
    await flush();
    expect(f.coordinator.confirmedIds()).toEqual([]);
    expect(f.errors).toHaveLength(1);
    expect(f.lookups).toHaveLength(1);
  });

  test('rejects nonarray, nonstring, sparse and invalid-length confirmation responses without retries', async () => {
    for (const value of ['a', { unexpected: ['a'] }, ['a', 1], ['', 'a'], ['x'.repeat(1_025)], [, 'a']]) {
      const f = fixture();
      insert(f.coordinator, 'a');
      insert(f.coordinator, 'b');
      await flush();
      f.lookups[0]!.resolve(value as unknown as readonly string[]);
      await flush();
      expect(f.coordinator.confirmedIds()).toEqual([]);
      expect(f.errors).toHaveLength(1);
      expect(f.errors[0]).toBeInstanceOf(TypeError);
      insert(f.coordinator, 'a');
      await flush();
      expect(f.lookups).toHaveLength(1);
    }
  });
});
