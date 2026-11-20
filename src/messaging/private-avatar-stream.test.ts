/** Owned in-memory streams only; cancellation removes every timer and subscription in finally. */
import { expect, test } from 'bun:test';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { AuthError } from '../auth/types';
import type { MessagingRuntime } from './runtime';
import { messagingProjectionStream } from './stream';

test('photo-only snapshots replace, remove and invalidate with the existing coalesced authorized stream', async () => {
  let changed: (() => void) | undefined, removed = false, revision = 1, denied = false;
  const runtime = { subscribe: (_scope: unknown, callback: () => void) => { changed = callback; return () => { removed = true; }; } } as unknown as MessagingRuntime;
  const abort = new AbortController();
  const stream = messagingProjectionStream(runtime, applicationServiceDataScope(), async () => {
    if (denied) throw new AuthError('NEVER_EXPOSE synthetic relationship denial.', 'MESSAGING_NOT_FOUND', 404);
    return { items: [{ id: 'housemate', privateAvatar: { revision, asset: null } }], hasMore: false, nextCursor: null };
  }, abort.signal, { actorId: 'resident', conversationId: 'house' });
  const reader = stream.getReader(), decoder = new TextDecoder();
  const next = async () => decoder.decode((await reader.read()).value);
  try {
    expect(await next()).toContain('"revision":1');
    revision = 2; changed!(); expect(await next()).toContain('"revision":2');
    denied = true; changed!(); const frame = await next();
    expect(frame).toContain('"error":{"status":404}'); expect(frame).not.toContain('NEVER_EXPOSE');
    expect((await reader.read()).done).toBe(true); expect(removed).toBe(true);
  } finally { abort.abort(); await reader.cancel(); reader.releaseLock(); }
});
