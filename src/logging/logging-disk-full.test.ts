/** Real SQLite FULL errors, not a mocked transport failure; disposable file and synthetic metadata only. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReactiveDB } from '../sync/reactive-db';
import { runDatabaseRealmCommand } from '../databases/database-realm';
import { LOGGING_TABLES } from './logging-schema';
import { loggingRealm } from './logging-realm';
import { LOGGING_GENESIS_HASH } from './logging-evidence-realm';
import { captureLoggingEvent } from './logging-validation';
import { loggingContext } from './test-support/logging-fixture';

test('disk-full append rolls back the entire batch, proof chain and sequence; exact original events can be retried after recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'logging-sqlite-full-'));
  const db = createReactiveDB({ mode: 'file', path: join(root, 'audit.db'), synchronous: 'FULL', observability: null });
  try {
    for (const [table, columns] of Object.entries(LOGGING_TABLES)) db.defineTable(table, columns);
    db.createStrict('logging_chain', { id: 'head', ordinal: 0, hash: LOGGING_GENESIS_HASH });
    const pages = Number((db.prepare('PRAGMA page_count').get() as { page_count: number }).page_count);
    db.exec('PRAGMA max_page_count=' + (pages + 1));
    const metadata = Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['field' + i, 'x'.repeat(256)]));
    const events = Array.from({ length: 8 }, (_, i) => captureLoggingEvent(loggingContext(), {
      id: 'full-' + i, family: 'records', action: 'record.prepared', occurredAt: 1800000000000,
      outcome: 'succeeded', evidence: 'server-confirmed', metadata,
    }, Object.keys(metadata)));
    const append = () => runDatabaseRealmCommand(loggingRealm, db, 'logging.append', { stream: 'audit', events } as any);
    let failed: unknown; try { append(); } catch (error) { failed = error; }
    expect(failed).toBeDefined(); expect(String(failed)).toMatch(/full|rollback|transaction/i);
    expect(db.list('logging_events')).toHaveLength(0); expect(db.list('logging_proofs')).toHaveLength(0);
    expect(db.get('logging_chain', 'head')).toMatchObject({ ordinal: 0, hash: LOGGING_GENESIS_HASH });
    expect(db.get('logging_state', 'head')).toBeNull();
    db.exec('PRAGMA max_page_count=' + (pages + 512)); append();
    expect(db.list('logging_events')).toHaveLength(8); expect(db.list('logging_proofs')).toHaveLength(8);
    expect(db.get('logging_chain', 'head')!.ordinal).toBe(8);
    append(); expect(db.list('logging_events')).toHaveLength(8);
  } finally { db.dispose(); await rm(root, { recursive: true, force: true }); }
});
