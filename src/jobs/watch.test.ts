/** Coalescing and retirement without timers/DB ownership escaping the subscription. */
import { expect, test } from 'bun:test';
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
