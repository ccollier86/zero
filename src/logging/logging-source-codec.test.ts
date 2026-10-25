/** Private encoding compatibility and bounded corruption detection; no persisted app data is used. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { LoggingSourceOutbox } from './logging-source-outbox';
import { captureLoggingEvent, loggingByteLength, loggingCanonical } from './logging-validation';
import { loggingContext } from './test-support/logging-fixture';

test('legacy full-envelope source rows upgrade additively, retain identity, and replay without rewriting the queued event', () => {
  const db = createReactiveDB({ mode: 'memory' });
  const event = captureLoggingEvent({ ...loggingContext(null), sourceId: 'legacy-source' }, {
    id: 'legacy-event', family: 'records', action: 'record.created', occurredAt: Date.now(), evidence: 'server-confirmed', outcome: 'succeeded', target: { type: 'table.records', id: 'one' },
  });
  const payload = loggingCanonical(event), bytes = loggingByteLength(event);
  db.exec(`CREATE TABLE _zero_logging_source(id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,queued INTEGER NOT NULL,bytes INTEGER NOT NULL);
    CREATE TABLE _zero_logging_outbox(event_id TEXT PRIMARY KEY,payload TEXT NOT NULL,bytes INTEGER NOT NULL,ordinal INTEGER NOT NULL UNIQUE);`);
  db.prepare('INSERT INTO _zero_logging_source VALUES(1,?,?,?)').run(event.sourceId, 1, bytes);
  db.prepare('INSERT INTO _zero_logging_outbox VALUES(?,?,?,1)').run(event.id, payload, bytes);
  try {
    const outbox = new LoggingSourceOutbox(db);
    expect(outbox.sourceId).toBe('legacy-source'); expect(outbox.page()[0]!.event).toEqual(event);
    outbox.enqueue(event); expect(outbox.counts().queued).toBe(1);
    expect(db.prepare('SELECT payload FROM _zero_logging_outbox').get()).toEqual({ payload });
    expect(() => outbox.enqueue({ ...event, outcome: 'failed' })).toThrow(expect.objectContaining({ code: 'LOGGING_EVENT_CONFLICT' }));
    outbox.acknowledge([event.id]); expect(outbox.counts()).toEqual({ queued: 0, bytes: 0 });
  } finally { db.dispose(); }
});

test('compact source storage preserves the full normalized budget and refuses envelope/accounting corruption', () => {
  const db = createReactiveDB({ mode: 'memory' }); const outbox = new LoggingSourceOutbox(db);
  const event = captureLoggingEvent({ ...loggingContext(null), sourceId: outbox.sourceId }, {
    id: 'compact-event', family: 'records', action: 'record.created', occurredAt: Date.now(), evidence: 'server-confirmed', outcome: 'succeeded', target: { type: 'table.records', id: 'one' },
  });
  try {
    outbox.enqueue(event);
    expect(outbox.page()[0]!.event).toEqual(event); expect(outbox.counts().bytes).toBe(loggingByteLength(event));
    const stored = db.prepare('SELECT payload FROM _zero_logging_outbox').get() as { payload: string };
    expect(stored.payload.length).toBeLessThan(loggingCanonical(event).length);
    db.prepare('UPDATE _zero_logging_outbox SET bytes=bytes+1').run();
    expect(() => outbox.page()).toThrow(expect.objectContaining({ code: 'LOGGING_EVENT_INVALID' }));
  } finally { db.dispose(); }
});
