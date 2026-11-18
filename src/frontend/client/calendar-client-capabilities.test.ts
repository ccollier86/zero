/** Strict browser transport, no network/browser/dependencies/generated files. */
import { expect, test } from 'bun:test';
import type { CalendarCapabilities } from '../../calendar/contracts';
import { createCalendarClient } from './calendar-client';
import type { FetchInit } from './sdk';
const capabilities: CalendarCapabilities = { timeZone: 'America/New_York', createOwn: true, manage: true, participants: true,
  limits: { maxRangeDays: 31, maxPageSize: 25, maxResources: 8, maxParticipants: 20 } };
test('capability reads use one fixed native path and return immutable whitelisted data', async () => {
  const calls: { path: string; init?: FetchInit }[] = [];
  const client = createCalendarClient(async <T>(path: string, init?: FetchInit) => { calls.push({ path, init }); return capabilities as T; });
  try {
    const value = await client.capabilities.get(); expect(value).toEqual(capabilities);
    expect(calls[0]!.path).toBe('/api/calendar/capabilities'); expect(calls[0]!.init!.method).toBe('GET');
    expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(value.limits)).toBe(true);
    expect(value).not.toBe(capabilities);
  } finally { client.clear(); }
});
test('invalid/private/contradictory capability projections reject without exposing the wire body', async () => {
  for (const value of [{ ...capabilities, actor: { userId: 'PRIVATE_ID' } }, { ...capabilities, rootDirectory: '/PRIVATE_PATH' },
    { ...capabilities, manage: false }, { ...capabilities, timeZone: 'bad/zone' }, { ...capabilities, createOwn: 'yes' },
    { ...capabilities, limits: { ...capabilities.limits, maxResources: 17 } }, { ...capabilities, limits: { ...capabilities.limits, secret: 'PRIVATE' } }]) {
    const client = createCalendarClient(async <T>() => value as T);
    try { await expect(client.capabilities.get()).rejects.toMatchObject({ name: 'CalendarReadError' }); }
    finally { client.clear(); }
  }
});
test('capability state retires on SDK replacement before delayed reads or live frames can publish', async () => {
  let resolve!: (value: unknown) => void, signal!: AbortSignal;
  const client = createCalendarClient(<T>(_path: string, init?: FetchInit) => {
    signal = init!.signal!; return new Promise<T>(done => { resolve = value => done(value as T); });
  });
  try {
    const pending = client.capabilities.get(), checked = pending.catch(error => error);
    client.clear(); expect(signal.aborted).toBe(true); resolve(capabilities);
    expect(await checked).toMatchObject({ name: 'AbortError' });
  } finally { client.clear(); }
  let controller!: ReadableStreamDefaultController<Uint8Array>, cancelled = 0, seen = 0;
  const live = createCalendarClient(async () => { throw new Error('Watch never uses side fetch.'); }, async (path, init) => {
    expect(path).toBe('/api/calendar/capabilities/live'); signal = init.signal!;
    return new Response(new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel() { cancelled++; } }),
      { headers: { 'Content-Type': 'text/event-stream' } });
  });
  const stop = live.capabilities.watch(() => { seen++; });
  try {
    controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify({ version: 1, value: capabilities }) + '\n\n'));
    for (let i = 0; i < 30 && !seen; i++) await new Promise<void>(done => setTimeout(done, 1));
    expect(seen).toBe(1); live.clear();
    for (let i = 0; i < 30 && !cancelled; i++) await new Promise<void>(done => setTimeout(done, 1));
    expect(cancelled).toBe(1); expect(signal.aborted).toBe(true);
  } finally { stop(); live.clear(); }
});
