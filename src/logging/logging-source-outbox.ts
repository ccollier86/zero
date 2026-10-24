/** Crash-durable origin capture/receipt queue. All SQL is private/static and joins the caller's source transaction. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { LoggingEvent } from './logging-contracts';
import { normalizeLoggingEvent, loggingCanonical, loggingByteLength, loggingId, LOGGING_MAX_EVENT_BYTES } from './logging-validation';
import { LoggingError } from './logging-error';

export class LoggingSourceOutbox {
  readonly sourceId: string;
  constructor(readonly db: ReactiveDB) {
    db.exec(`CREATE TABLE IF NOT EXISTS _zero_logging_source (
      id INTEGER PRIMARY KEY CHECK(id=1), source_id TEXT NOT NULL, queued INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0
    ); CREATE TABLE IF NOT EXISTS _zero_logging_outbox (
      event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, bytes INTEGER NOT NULL, ordinal INTEGER NOT NULL UNIQUE
    ); CREATE INDEX IF NOT EXISTS zero_logging_source_order ON _zero_logging_outbox(ordinal);
    CREATE TRIGGER IF NOT EXISTS zero_logging_outbox_insert AFTER INSERT ON _zero_logging_outbox BEGIN
      UPDATE _zero_logging_source SET queued=queued+1, bytes=bytes+NEW.bytes WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS zero_logging_outbox_delete AFTER DELETE ON _zero_logging_outbox BEGIN
      UPDATE _zero_logging_source SET queued=queued-1, bytes=bytes-OLD.bytes WHERE id=1; END;`);
    db.prepare('INSERT OR IGNORE INTO _zero_logging_source(id,source_id) VALUES(1,?)').run(crypto.randomUUID());
    this.sourceId = loggingId((db.prepare('SELECT source_id FROM _zero_logging_source WHERE id=1').get() as { source_id: string }).source_id)!;
    const counts = this.counts();
    const actual = db.prepare('SELECT COUNT(*) AS queued,COALESCE(SUM(bytes),0) AS bytes,MIN(bytes) AS smallest,MAX(bytes) AS largest FROM (SELECT bytes FROM _zero_logging_outbox LIMIT 10001)').get() as { queued: number; bytes: number; smallest: number | null; largest: number | null };
    if (actual.queued > 10000 || actual.bytes > 16 * 1024 * 1024 || actual.queued !== counts.queued || actual.bytes !== counts.bytes
      || actual.smallest !== null && actual.smallest < 1 || actual.largest !== null && actual.largest > LOGGING_MAX_EVENT_BYTES) throw new LoggingError('LOGGING_NOT_READY', 'Origin audit queue accounting is inconsistent; preserve the source for investigation.');
  }
  /** A capacity failure rejects the source transaction; it never turns a missing durable event into success. */
  enqueue(input: LoggingEvent): void {
    // Nested transactions join the origin commit; a standalone caller also gets
    // atomic capacity accounting and admission rather than a check/insert race.
    this.db.transaction(() => this.enqueueInTransaction(input));
  }
  private enqueueInTransaction(input: LoggingEvent): void {
    const event = normalizeLoggingEvent(input), bytes = loggingByteLength(event), payload = loggingCanonical(event);
    if (event.sourceId !== this.sourceId) throw new LoggingError('LOGGING_EVENT_INVALID', 'Audit evidence does not belong to this origin source.');
    const prior = this.db.prepare('SELECT payload FROM _zero_logging_outbox WHERE event_id=?').get(event.id) as { payload: string } | null;
    if (prior) { if (prior.payload !== payload) throw new LoggingError('LOGGING_EVENT_CONFLICT', 'Origin evidence identity conflicts.'); return; }
    const counts = this.counts();
    if (counts.queued >= 10000 || counts.bytes + bytes > 16 * 1024 * 1024) throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Required origin audit admission is unavailable.');
    this.db.prepare('INSERT INTO _zero_logging_outbox(event_id,payload,bytes,ordinal) VALUES(?,?,?,COALESCE((SELECT MAX(ordinal)+1 FROM _zero_logging_outbox),1))').run(event.id, payload, bytes);
  }
  page() {
    return (this.db.prepare('SELECT event_id,CASE WHEN bytes BETWEEN 1 AND 16384 AND length(payload)<=32768 THEN payload ELSE NULL END AS payload FROM _zero_logging_outbox ORDER BY ordinal LIMIT 32').all() as { event_id: string; payload: string | null }[])
      .map(row => {
        if (row.payload === null) throw new LoggingError('LOGGING_EVENT_INVALID', 'Origin audit queue envelope is outside its budget.');
        const event = normalizeLoggingEvent(JSON.parse(row.payload));
        if (event.id !== row.event_id || event.sourceId !== this.sourceId) throw new LoggingError('LOGGING_EVENT_INVALID', 'Origin audit queue identity is inconsistent.');
        return Object.freeze({ id: row.event_id, event });
      });
  }
  acknowledge(ids: readonly string[]): void {
    this.db.transaction(() => { for (const id of ids) this.db.prepare('DELETE FROM _zero_logging_outbox WHERE event_id=?').run(id); });
  }
  counts(): Readonly<{ queued: number; bytes: number }> {
    return this.db.prepare('SELECT queued,bytes FROM _zero_logging_source WHERE id=1').get() as { queued: number; bytes: number };
  }
}
