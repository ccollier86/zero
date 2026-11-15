/** Coalescing and retirement without timers/DB ownership escaping the subscription. */
import { expect, spyOn, test } from 'bun:test';
import { watchJobSchedules } from './watch';
test('a disposed pending subscription never acquires a listener or publishes its late result', async () => {
  let complete!: (value: any) => void, subscribed = 0, read = 0, delivered = 0;
  const prepared = new Promise<any>(resolve => { complete = resolve; });
  const stop = watchJobSchedules({ signal: new AbortController().signal, prepare: () => prepared, listener() { delivered++; } });
  stop(); complete({ async read() { read++; return { items: [], total: 0 }; }, subscribe() { subscribed++; return () => {}; } });
  await prepared; await Bun.sleep(1);
  expect(subscribed).toBe(0); expect(read).toBe(0); expect(delivered).toBe(0);
});
test('burst hints coalesce; read denial unsubscribes once and cannot publish or resurrect the previous page', async () => {
  const owner = new AbortController(); let changed!: () => void, removed = 0, reads = 0, delivered = 0, failed = 0, deny = false;
  const stop = watchJobSchedules({ signal: owner.signal,
    async prepare() { return { async read() { reads++; if (deny) throw new Error('Synthetic read denied'); return { items: [], total: 0 }; }, subscribe(listener) { changed = listener; return () => { removed++; }; } }; },
    listener() { delivered++; }, onError() { failed++; },
  });
  try {
    const initial = Date.now() + 1000; while (!delivered) { if (Date.now() > initial) throw new Error('Synthetic watcher did not start.'); await Bun.sleep(1); }
    deny = true; for (let i = 0; i < 20; i++) changed(); await Bun.sleep(80);
    expect(reads).toBe(2); expect(delivered).toBe(1); expect(failed).toBe(1); expect(removed).toBe(1);
    changed(); await Bun.sleep(80); expect(reads).toBe(2); expect(delivered).toBe(1);
  } finally { stop(); owner.abort(); }
  expect(removed).toBe(1);
});

test('equal-page commit hints invalidate once per burst while periodic authority checks remain quiet', async () => {
  const owner = new AbortController(), updates: boolean[] = [];
  let changed!: () => void, recheck!: () => void, reads = 0;
  const nativeInterval = globalThis.setInterval;
  const interval = spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, delay: number) => {
    if (delay === 10_000) recheck = callback;
    return nativeInterval(callback, delay);
  }) as typeof setInterval);
  let stop: (() => void) | undefined;
  try {
    stop = watchJobSchedules({ signal: owner.signal,
      async prepare() { return { async read() { reads++; return { items: [], total: 0 }; }, subscribe(listener) { changed = listener; return () => {}; } }; },
      listener(_page, update) { updates.push(update?.invalidated === true); },
    });
    await eventually(() => updates.length === 1); interval.mockRestore();
    expect(updates).toEqual([false]);
    recheck(); await eventually(() => reads === 2); await Bun.sleep(1);
    expect(updates).toEqual([false]);
    for (let i = 0; i < 20; i++) changed();
    recheck(); await eventually(() => updates.length === 2);
    expect(reads).toBe(3); expect(updates).toEqual([false, true]);
    recheck(); await eventually(() => reads === 4); await Bun.sleep(1);
    expect(updates).toEqual([false, true]);
  } finally { interval.mockRestore(); stop?.(); owner.abort(); }
});

test('a commit during an authorized read requires a follow-up; disposal masks a late invalidated result', async () => {
  const owner = new AbortController(), updates: boolean[] = [];
  let changed!: () => void, complete!: () => void, reads = 0, removed = 0;
  const stop = watchJobSchedules({ signal: owner.signal,
    async prepare() { return { async read() {
      reads++;
      if (reads > 1) await new Promise<void>(resolve => { complete = resolve; });
      return { items: [], total: 0 };
    }, subscribe(listener) { changed = listener; return () => { removed++; }; } }; },
    listener(_page, update) { updates.push(update?.invalidated === true); },
  });
  try {
    await eventually(() => updates.length === 1);
    changed(); await eventually(() => reads === 2);
    changed(); complete(); await eventually(() => updates.length === 2);
    await eventually(() => reads === 3);
    complete(); await eventually(() => updates.length === 3);
    expect(updates).toEqual([false, true, true]);
    changed(); await eventually(() => reads === 4);
    stop(); complete(); await Bun.sleep(80);
    expect(updates).toEqual([false, true, true]); expect(removed).toBe(1);
    changed(); await Bun.sleep(80); expect(reads).toBe(4);
  } finally { stop(); owner.abort(); complete?.(); }
});

async function eventually(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Synthetic jobs watch did not settle.');
    await Bun.sleep(1);
  }
}
