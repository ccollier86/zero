/** Deterministic semantic-stage/authority tests, not worker or browser qualification. No transcript is audit metadata. */
import { expect, test } from 'bun:test';
import { auditMessagingRead } from './read-audit';
import { AuthError } from '../auth/types';
import type { LoggingRuntime } from '../logging/logging-runtime';
import type { LoggingEvent } from '../logging/logging-contracts';
import { loggingContext } from '../logging/test-support/logging-fixture';

function fixture(enabled = true, deliver?: (event: LoggingEvent) => void) {
  const events: LoggingEvent[] = [];
  const logging = { config: { policy: { capture: { communications: enabled } } }, deliver: async (event: LoggingEvent) => { events.push(event); deliver?.(event); } } as unknown as LoggingRuntime;
  return { logging, events };
}
test('messaging reads record preparation and freshly project after yielding, without text or query evidence', async () => {
  const { logging, events } = fixture(); let calls = 0;
  const result = await auditMessagingRead(logging, loggingContext(null), 'history', 'conversation_123', () => {}, async () => ({ text: 'private transcript', revision: ++calls }));
  expect(result.revision).toBe(2);
  expect(events.map(event => [event.action, event.outcome, event.evidence])).toEqual([
    ['messaging.history.admitted', 'attempted', 'server-confirmed'], ['messaging.history.prepared', 'succeeded', 'server-confirmed'],
  ]);
  expect(events.every(event => event.target?.id === 'conversation_123')).toBe(true);
  expect(JSON.stringify(events)).not.toContain('private transcript');
});
test('membership revoked during preparation delivery cannot release a retained body or become success-only evidence', async () => {
  let member = true;
  const { logging, events } = fixture(true, event => { if (event.action.endsWith('.prepared')) member = false; });
  await expect(auditMessagingRead(logging, loggingContext(null), 'review.detail', 'conversation_123', () => {}, async () => {
    if (!member) throw new AuthError('Private draft must not be retained in evidence.', 'MESSAGING_NOT_FOUND', 404);
    return { draftText: 'private draft' };
  })).rejects.toMatchObject({ code: 'MESSAGING_NOT_FOUND' });
  expect(events.at(-1)).toMatchObject({ action: 'messaging.review.detail.denied', outcome: 'denied' });
  expect(JSON.stringify(events)).not.toContain('Private draft'); expect(JSON.stringify(events)).not.toContain('private draft');
});
test('disabled capture imposes no logging delivery or duplicate projection; unknown reads are not definite failures', async () => {
  const { logging, events } = fixture(false); let calls = 0;
  expect(await auditMessagingRead(logging, loggingContext(null), 'history', null, () => {}, async () => ++calls)).toBe(1); expect(events).toEqual([]);
  const active = fixture();
  await expect(auditMessagingRead(active.logging, loggingContext(null), 'history', null, () => {}, async () => { throw Object.assign(new Error('Not audit content.'), { outcome: 'unknown' }); })).rejects.toThrow('Not audit content.');
  expect(active.events.at(-1)?.outcome).toBe('unknown'); expect(JSON.stringify(active.events)).not.toContain('Not audit content.');
});
