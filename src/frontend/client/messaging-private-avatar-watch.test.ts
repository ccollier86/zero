/** Synthetic fetch streams only; every watcher is stopped in finally, with no external connection. */
import { expect, test } from 'bun:test';
import { createMessagingClient } from './messaging-client';
import type { FetchInit } from './sdk';

test('native people and directory watches carry validated revisioned metadata and cancel at the SDK boundary', async () => {
  const calls: Array<{ path: string; signal?: AbortSignal }> = [], received = Promise.withResolvers<void>();
  let cancelled = 0, snapshots = 0;
  const client = createMessagingClient(async <T>(path: string, init?: FetchInit): Promise<T> => {
    calls.push({ path, signal: init?.signal as AbortSignal | undefined });
    const value = { items: [{ id: 'peer', name: 'Peer', avatarUrl: null, privateAvatar: { revision: 2, asset: null },
      ...(path.includes('/people/live') ? { kind: 'user' } : {}) }], hasMore: false, nextCursor: null };
    return new Response(new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ version: 1, value })}\n\n`));
    }, cancel() { cancelled++; } }), { headers: { 'Content-Type': 'text/event-stream' } }) as T;
  });
  const receive = (page: { items: readonly { privateAvatar?: { revision: number } | null }[] }) => {
    expect(page.items[0]?.privateAvatar?.revision).toBe(2); if (++snapshots === 2) received.resolve();
  };
  const stopDirectory = client.watchDirectory!(receive, { query: { search: 'Synthetic Peer', limit: 50 } });
  const stopPeople = client.watchPeople!('house-one', receive);
  try {
    await received.promise;
    expect(calls.map(call => call.path)).toEqual(['/api/messaging/directory/live?limit=50&search=Synthetic+Peer', '/api/messaging/conversations/house-one/people/live']);
    client.clear(); await Promise.resolve(); await Promise.resolve();
    expect(calls.every(call => call.signal?.aborted)).toBe(true); expect(cancelled).toBe(2);
  } finally { stopDirectory(); stopPeople(); client.clear(); }
});
