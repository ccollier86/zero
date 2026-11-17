/** Memory streams only. No server, child, database files or generated fixtures. */
import { expect, test } from 'bun:test';
import type { CalendarAppointmentPage, CalendarAvailabilityView, CalendarBlockPage, CalendarHoldPage, CalendarReadOptions, CalendarWatchOptions, ScopedCalendar } from './contracts';
import { calendarAppointmentStream, calendarAvailabilityStream, calendarBlockStream, calendarHoldStream } from './stream';
const query = { resourceIds: ['synthetic'], startAt: '2026-11-16T00:00:00.000Z', endAt: '2026-11-17T00:00:00.000Z' };
const empty: CalendarAppointmentPage = { items: [], truncated: false };
function fixture() {
  let notify!: (page: CalendarAppointmentPage, update?: { invalidated: boolean }) => void;
  let options!: CalendarWatchOptions, calls = 0, removals = 0;
  let read: (options?: CalendarReadOptions) => Promise<CalendarAppointmentPage> = async () => empty;
  const calendar = { appointments: {
    watch(_query: unknown, callback: typeof notify, opts: CalendarWatchOptions) { notify = callback; options = opts; return () => { removals++; }; },
    async query(_query: unknown, options?: CalendarReadOptions) { calls++; return read(options); },
  } } as unknown as ScopedCalendar;
  const abort = new AbortController(), stream = calendarAppointmentStream(calendar, query, abort.signal), reader = stream.getReader();
  return { notify: (value = empty) => notify(value, { invalidated: true }), fail: () => options.onError?.(new Error('SYNTHETIC_PRIVATE_FAILURE')),
    setRead(next: typeof read) { read = next; }, abort, reader, get calls() { return calls; }, get removals() { return removals; } };
}
test('backpressure retains only dirty hints and reauthorizes before later publication', async () => {
  const f = fixture();
  try {
    f.notify(); f.notify({ items: [], truncated: true });
    expect(f.calls).toBe(0);
    f.setRead(async () => { throw new Error('Synthetic current read denied'); });
    const first = await f.reader.read(); expect(new TextDecoder().decode(first.value)).toContain('"truncated":false');
    const second = await f.reader.read(); expect(new TextDecoder().decode(second.value)).toContain('event: invalidated');
    expect(f.calls).toBe(1); expect(f.removals).toBe(1); expect((await f.reader.read()).done).toBe(true);
  } finally { f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
});
test('watch denial discards deferred pages and sends no private exception detail', async () => {
  const f = fixture();
  try {
    f.notify(); f.notify({ items: [], truncated: true }); f.fail();
    const a = await f.reader.read(), b = await f.reader.read();
    const text = new TextDecoder().decode(a.value) + new TextDecoder().decode(b.value);
    expect(text).not.toContain('"truncated":true'); expect(text).not.toContain('PRIVATE'); expect(text).toContain('invalidated');
    expect(f.removals).toBe(1);
  } finally { f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
});
test('cancel and abort each retire exact subscription once', async () => {
  const f = fixture();
  try { f.abort.abort(); await f.reader.cancel(); expect(f.removals).toBe(1); f.notify(); }
  finally { await f.reader.cancel(); f.reader.releaseLock(); }
});

test('stream cancellation aborts its owned queued pull even when the external request stays open', async () => {
  const f = fixture();
  let entered!: (signal: AbortSignal) => void;
  const reading = new Promise<AbortSignal>(resolve => { entered = resolve; });
  try {
    f.setRead(options => new Promise<never>((_resolve, reject) => {
      const signal = options!.signal!; entered(signal);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    f.notify(); f.notify();
    await f.reader.read(); const signal = await reading;
    const pending = f.reader.read(); await f.reader.cancel();
    expect(signal.aborted).toBe(true); expect(f.abort.signal.aborted).toBe(false);
    expect((await pending).done).toBe(true); expect(f.removals).toBe(1); expect(f.calls).toBe(1);
  } finally { f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
});

test('terminal watch denial fences a late in-flight refresh even when its physical read ignores cancellation', async () => {
  const f = fixture(); let entered!: () => void, release!: () => void;
  const reading = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  let refresh: Promise<CalendarAppointmentPage> | undefined;
  try {
    f.setRead(() => {
      refresh = (async () => { entered(); await gate; return { items: [], truncated: true }; })();
      return refresh;
    });
    f.notify(); f.notify();
    await f.reader.read(); await reading;
    const pending = f.reader.read(); f.fail();
    const retired = await pending;
    expect(new TextDecoder().decode(retired.value)).toContain('event: invalidated');
    expect(f.removals).toBe(1);
    release(); await refresh;
    expect((await f.reader.read()).done).toBe(true);
    expect(f.calls).toBe(1);
  } finally { release(); await refresh; f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
});

function schedulingFixture(kind: 'blocks' | 'holds' | 'availability') {
  type Snapshot = CalendarBlockPage | CalendarHoldPage | CalendarAvailabilityView;
  const initial: Snapshot = kind !== 'availability' ? { items: [], truncated: false }
    : { resourceId: 'synthetic', resourceRevision: 1, timeZone: 'UTC', mode: 'windows', windows: [] };
  const deferred: Snapshot = kind !== 'availability' ? { items: [], truncated: true }
    : { resourceId: 'synthetic', resourceRevision: 2, timeZone: 'UTC', mode: 'windows', windows: [{ startAt: query.startAt, endAt: query.endAt }] };
  let notify!: (value: Snapshot, update?: { invalidated: boolean }) => void;
  let options!: CalendarWatchOptions, calls = 0, removals = 0;
  let read: (options?: CalendarReadOptions) => Promise<Snapshot> = async () => initial;
  const watch = (_query: unknown, callback: typeof notify, supplied: CalendarWatchOptions) => {
    notify = callback; options = supplied; return () => { removals++; };
  };
  const refresh = async (_query: unknown, supplied?: CalendarReadOptions) => { calls++; return read(supplied); };
  const calendar = { blocks: { watch, query: refresh }, holds: { watch, query: refresh }, availability: { watch, get: refresh } } as unknown as ScopedCalendar;
  const abort = new AbortController(), stream = kind === 'blocks' ? calendarBlockStream(calendar, query, abort.signal)
    : kind === 'holds' ? calendarHoldStream(calendar, query, abort.signal)
    : calendarAvailabilityStream(calendar, 'synthetic', abort.signal), reader = stream.getReader();
  return { initial, deferred, notify: (value = initial) => notify(value, { invalidated: true }),
    fail: () => options.onError?.(new Error('SYNTHETIC_PRIVATE_FAILURE')), setRead(next: typeof read) { read = next; },
    abort, reader, get calls() { return calls; }, get removals() { return removals; } };
}

for (const kind of ['blocks', 'holds', 'availability'] as const) {
  test(`${kind} backpressure retains only dirty hints and requires another current authorized read`, async () => {
    const f = schedulingFixture(kind);
    try {
      f.notify(); f.notify(f.deferred); expect(f.calls).toBe(0);
      f.setRead(async () => { throw new Error('SYNTHETIC_PRIVATE_DENIAL'); });
      const a = await f.reader.read(), b = await f.reader.read();
      expect(new TextDecoder().decode(a.value)).toContain(JSON.stringify(f.initial));
      const denial = new TextDecoder().decode(b.value);
      expect(denial).toContain('event: invalidated'); expect(denial).not.toContain('PRIVATE');
      expect(denial).not.toContain(JSON.stringify(f.deferred)); expect(f.calls).toBe(1); expect(f.removals).toBe(1);
      expect((await f.reader.read()).done).toBe(true);
    } finally { f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
  });

  test(`${kind} terminal denial fences a late read that ignores cancellation`, async () => {
    const f = schedulingFixture(kind); let entered!: () => void, release!: () => void;
    const reading = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    let refresh: Promise<typeof f.deferred> | undefined;
    try {
      f.setRead(() => { refresh = (async () => { entered(); await gate; return f.deferred; })(); return refresh; });
      f.notify(); f.notify(f.deferred); await f.reader.read(); await reading;
      const pending = f.reader.read(); f.fail();
      const denial = new TextDecoder().decode((await pending).value);
      expect(denial).toContain('event: invalidated'); expect(denial).not.toContain(JSON.stringify(f.deferred)); expect(denial).not.toContain('PRIVATE');
      release(); await refresh;
      expect((await f.reader.read()).done).toBe(true); expect(f.removals).toBe(1); expect(f.calls).toBe(1);
    } finally { release(); await refresh; f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
  });

  test(`${kind} cancellation aborts its owned queued refresh and unsubscribes exactly once`, async () => {
    const f = schedulingFixture(kind); let entered!: (signal: AbortSignal) => void;
    const reading = new Promise<AbortSignal>(resolve => { entered = resolve; });
    try {
      f.setRead(options => new Promise<never>((_resolve, reject) => {
        const signal = options!.signal!; entered(signal); signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }));
      f.notify(); f.notify(f.deferred); await f.reader.read(); const signal = await reading;
      const pending = f.reader.read(); await f.reader.cancel();
      expect(signal.aborted).toBe(true); expect(f.abort.signal.aborted).toBe(false); expect((await pending).done).toBe(true);
      f.abort.abort(); expect(f.removals).toBe(1); f.notify(f.deferred);
    } finally { f.abort.abort(); await f.reader.cancel(); f.reader.releaseLock(); }
  });
}
