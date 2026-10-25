/** Crash-durable origin capture/receipt queue. All SQL is private/static and joins the caller's source transaction. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { LoggingEvent } from './logging-contracts';
import { normalizeLoggingEvent, loggingCanonical, loggingByteLength, loggingId, LOGGING_MAX_EVENT_BYTES } from './logging-validation';
import { LoggingError } from './logging-error';
import { normalizeLoggingSourceLimits, LOGGING_SOURCE_HARD_EVENTS, LOGGING_SOURCE_HARD_BYTES, LOGGING_SOURCE_PAGE_EVENTS, type LoggingSourceLimits } from './logging-source-limits';
import { decodeLoggingSourceEvent, encodeLoggingSourceEvent } from './logging-source-codec';

export class LoggingSourceOutbox {
  readonly sourceId: string;
  readonly limits: LoggingSourceLimits;
  constructor(readonly db: ReactiveDB, limits?: LoggingSourceLimits) {
    this.limits = normalizeLoggingSourceLimits(limits);
    db.exec(`CREATE TABLE IF NOT EXISTS _zero_logging_source (
      id INTEGER PRIMARY KEY CHECK(id=1), source_id TEXT NOT NULL, queued INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL DEFAULT 0
    ); CREATE TABLE IF NOT EXISTS _zero_logging_outbox (
      event_id TEXT PRIMARY KEY, payload TEXT NOT NULL, bytes INTEGER NOT NULL, ordinal INTEGER NOT NULL UNIQUE, context_id INTEGER
    ); CREATE TABLE IF NOT EXISTS _zero_logging_contexts (
      id INTEGER PRIMARY KEY, digest TEXT NOT NULL UNIQUE, payload TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS zero_logging_source_order ON _zero_logging_outbox(ordinal);
    CREATE TRIGGER IF NOT EXISTS zero_logging_outbox_insert AFTER INSERT ON _zero_logging_outbox BEGIN
      UPDATE _zero_logging_source SET queued=queued+1, bytes=bytes+NEW.bytes WHERE id=1; END;
    CREATE TRIGGER IF NOT EXISTS zero_logging_outbox_delete AFTER DELETE ON _zero_logging_outbox BEGIN
      UPDATE _zero_logging_source SET queued=queued-1, bytes=bytes-OLD.bytes WHERE id=1; END;`);
    if (!(db.prepare('PRAGMA table_info(_zero_logging_outbox)').all() as { name: string }[]).some(column => column.name === 'context_id')) db.exec('ALTER TABLE _zero_logging_outbox ADD COLUMN context_id INTEGER');
    db.exec('CREATE INDEX IF NOT EXISTS zero_logging_source_context ON _zero_logging_outbox(context_id)');
    db.prepare('INSERT OR IGNORE INTO _zero_logging_source(id,source_id) VALUES(1,?)').run(crypto.randomUUID());
    this.sourceId = loggingId((db.prepare('SELECT source_id FROM _zero_logging_source WHERE id=1').get() as { source_id: string }).source_id)!;
    const counts = this.counts();
    const actual = db.prepare('SELECT COUNT(*) AS queued,COALESCE(SUM(bytes),0) AS bytes,MIN(bytes) AS smallest,MAX(bytes) AS largest FROM (SELECT bytes FROM _zero_logging_outbox LIMIT ?)').get(LOGGING_SOURCE_HARD_EVENTS + 1) as { queued: number; bytes: number; smallest: number | null; largest: number | null };
    if (actual.queued > LOGGING_SOURCE_HARD_EVENTS || actual.bytes > LOGGING_SOURCE_HARD_BYTES || actual.queued !== counts.queued || actual.bytes !== counts.bytes
      || actual.smallest !== null && actual.smallest < 1 || actual.largest !== null && actual.largest > LOGGING_MAX_EVENT_BYTES) throw new LoggingError('LOGGING_NOT_READY', 'Origin audit queue accounting is inconsistent; preserve the source for investigation.');
  }
  /** A capacity failure rejects the source transaction; it never turns a missing durable event into success. */
  enqueue(input: LoggingEvent): void {
    // Nested transactions join the origin commit; a standalone caller also gets
    // atomic capacity accounting and admission rather than a check/insert race.
    this.db.transaction(() => this.enqueueInTransaction(input));
  }
  private enqueueInTransaction(input: LoggingEvent): void {
    const event = normalizeLoggingEvent(input), bytes = loggingByteLength(event);
    if (event.sourceId !== this.sourceId) throw new LoggingError('LOGGING_EVENT_INVALID', 'Audit evidence does not belong to this origin source.');
    const prior = this.db.prepare('SELECT CASE WHEN length(o.payload)<=32768 THEN o.payload ELSE NULL END AS payload,o.context_id,CASE WHEN length(c.payload)<=8192 THEN c.payload ELSE NULL END AS context FROM _zero_logging_outbox o LEFT JOIN _zero_logging_contexts c ON c.id=o.context_id WHERE o.event_id=?').get(event.id) as { payload: string | null; context_id: number | null; context: string | null } | null;
    if (prior) {
      if (prior.payload === null || prior.context_id !== null && prior.context === null) throw new LoggingError('LOGGING_EVENT_INVALID', 'Origin audit envelope is outside its budget.');
      if (loggingCanonical(decodeLoggingSourceEvent(prior.payload, prior.context)) !== loggingCanonical(event)) throw new LoggingError('LOGGING_EVENT_CONFLICT', 'Origin evidence identity conflicts.'); return;
    }
    const counts = this.counts();
    if (counts.queued >= this.limits.maxEvents || counts.bytes + bytes > this.limits.maxBytes) throw new LoggingError('LOGGING_AUDIT_UNAVAILABLE', 'Required origin audit admission is unavailable.');
    const encoded = encodeLoggingSourceEvent(event);
    this.db.prepare('INSERT OR IGNORE INTO _zero_logging_contexts(digest,payload) VALUES(?,?)').run(encoded.contextDigest, encoded.context);
    const context = this.db.prepare('SELECT id FROM _zero_logging_contexts WHERE digest=?').get(encoded.contextDigest) as { id: number };
    this.db.prepare('INSERT INTO _zero_logging_outbox(event_id,payload,bytes,ordinal,context_id) VALUES(?,?,?,COALESCE((SELECT MAX(ordinal)+1 FROM _zero_logging_outbox),1),?)').run(event.id, encoded.payload, bytes, context.id);
  }
  page() {
    let total = 0;
    return (this.db.prepare(`SELECT o.event_id,o.bytes,o.context_id,CASE WHEN o.bytes BETWEEN 1 AND 16384 AND length(o.payload)<=32768 THEN o.payload ELSE NULL END AS payload,
      CASE WHEN length(c.payload)<=8192 THEN c.payload ELSE NULL END AS context FROM _zero_logging_outbox o LEFT JOIN _zero_logging_contexts c ON c.id=o.context_id ORDER BY o.ordinal LIMIT ?`).all(LOGGING_SOURCE_PAGE_EVENTS) as { event_id: string; bytes: number; context_id: number | null; payload: string | null; context: string | null }[])
      .filter(row => { total += row.bytes; return total <= 256 * 1024; })
      .map(row => {
        if (row.payload === null || row.context_id !== null && row.context === null) throw new LoggingError('LOGGING_EVENT_INVALID', 'Origin audit queue envelope is outside its budget.');
        const event = decodeLoggingSourceEvent(row.payload, row.context);
        if (event.id !== row.event_id || event.sourceId !== this.sourceId || loggingByteLength(event) !== row.bytes) throw new LoggingError('LOGGING_EVENT_INVALID', 'Origin audit queue identity/accounting is inconsistent.');
        return Object.freeze({ id: row.event_id, event });
      });
  }
  acknowledge(ids: readonly string[]): void {
    this.db.transaction(() => {
      const contexts = new Set<number>();
      for (const id of ids) {
        const row = this.db.prepare('SELECT context_id FROM _zero_logging_outbox WHERE event_id=?').get(id) as { context_id: number | null } | null;
        if (row?.context_id) contexts.add(row.context_id);
        this.db.prepare('DELETE FROM _zero_logging_outbox WHERE event_id=?').run(id);
      }
      for (const id of contexts) this.db.prepare('DELETE FROM _zero_logging_contexts WHERE id=? AND NOT EXISTS(SELECT 1 FROM _zero_logging_outbox WHERE context_id=?)').run(id, id);
    });
  }
  counts(): Readonly<{ queued: number; bytes: number }> {
    return this.db.prepare('SELECT queued,bytes FROM _zero_logging_source WHERE id=1').get() as { queued: number; bytes: number };
  }
}
