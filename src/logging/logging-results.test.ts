import { expect, test } from 'bun:test';
import { readLoggingAppend, readLoggingPage } from './logging-results';
import { normalizeLoggingQuery } from './logging-query';
import { loggingEvent } from './test-support/logging-fixture';

test('a malformed accepted append response can never become a definitely uncommitted event', () => {
  const event = loggingEvent();
  for (const value of [null, { status: 'stored' }, { kind: 'command', name: 'wrong', output: {} },
    { kind: 'command', name: 'logging.append', output: { status: 'stored', receipts: [{ id: 'wrong', sourceId: event.sourceId, ordinal: 1, duplicate: false }] } }]) {
    try { readLoggingAppend(value, [event], false); throw new Error('Expected rejection'); }
    catch (error) { expect(error).toMatchObject({ code: 'LOGGING_RESPONSE_INVALID', outcome: 'unknown' }); }
  }
});
test('query result validation cannot release another tenant envelope or malformed cursor/order state', () => {
  const query = normalizeLoggingQuery('audit', { kind: 'tenant', tenantId: 'tenant-a' }, { limit: 2 });
  const page = { events: [{ event: loggingEvent(), ordinal: 2, ingestedAt: 1 }], highWaterOrdinal: 2, hasMore: false, nextBeforeOrdinal: null };
  expect(readLoggingPage(page, query).events).toHaveLength(1);
  for (const patch of [
    { events: [{ ...page.events[0]!, event: loggingEvent('other', 'tenant-b') }] },
    { events: [{ ...page.events[0]!, ordinal: 3 }] },
    { events: [...page.events, ...page.events] }, { hasMore: true }, { nextBeforeOrdinal: 2 },
  ]) expect(() => readLoggingPage({ ...page, ...patch }, query)).toThrow();
});
test('core event contracts build for the browser without importing server or SQLite code', async () => {
  const result = await Bun.build({ entrypoints: [new URL('./logging-contracts.ts', import.meta.url).pathname], target: 'browser' });
  expect(result.success).toBe(true);
  expect(await result.outputs[0]!.text()).not.toMatch(/bun:sqlite|node:|DatabaseCoordinator/);
});
