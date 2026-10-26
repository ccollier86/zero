/** Real SQLite, synthetic catalogs; ties and retired catalogs cannot skip or restart pages. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { listLoggingEvidence } from './logging-evidence-realm';
import { LOGGING_TABLES } from './logging-schema';
import { normalizeLoggingEvidenceCursor } from './logging-evidence-cursor';
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { LoggingEvidenceCursor } from './logging-evidence-contracts';

test('composite evidence history visits every equal-time hold and review exactly once with scope isolation', () => {
  const database = new Database(':memory:', { strict: true });
  try {
    for (const name of ['logging_holds', 'logging_reviews'] as const) database.run(`CREATE TABLE ${name} (${Object.entries(LOGGING_TABLES[name]).map(([key, type]) => `${key} ${type}`).join(',')})`);
    const insert = database.transaction(() => {
      for (let i = 0; i < 205; i++) {
        const id = String(i).padStart(4, '0');
        database.run('INSERT INTO logging_holds VALUES(?,?,?,?,?,?,?,?,?,?,?)', [id, 'tenant', 'a', 1, 2, 'case', 1, 1000, 'actor', null, null]);
        database.run('INSERT INTO logging_reviews VALUES(?,?,?,?,?,?,?,?,?)', [id, 'tenant', 'a', '{}', 0, 'reviewed', 'case', 1000, 'actor']);
      }
      database.run('INSERT INTO logging_holds VALUES(?,?,?,?,?,?,?,?,?,?,?)', ['other', 'tenant', 'b', 1, 2, 'case', 1, 1000, 'actor', null, null]);
    });
    insert();
    const context = { database } as unknown as DatabaseReadQueryContext;
    let before: LoggingEvidenceCursor | undefined;
    const holds: string[] = [], reviews: string[] = [];
    for (let pages = 0; pages < 4; pages++) {
      const page = listLoggingEvidence(context, { scope: { kind: 'tenant', tenantId: 'a' }, ...(before ? { before } : {}) });
      holds.push(...page.holds.map(h => h.id)); reviews.push(...page.reviews.map(r => r.id));
      if (!page.nextCursor) break;
      before = page.nextCursor as LoggingEvidenceCursor;
    }
    expect(holds).toHaveLength(205); expect(reviews).toHaveLength(205);
    expect(new Set(holds).size).toBe(205); expect(new Set(reviews).size).toBe(205);
    const done = listLoggingEvidence(context, { scope: { kind: 'tenant', tenantId: 'a' }, before: { version: 1, holds: null, reviews: null } });
    expect(done.holds).toEqual([]); expect(done.reviews).toEqual([]); expect(done.nextCursor).toBeNull();
    expect(listLoggingEvidence(context, { scope: { kind: 'tenant', tenantId: 'a' }, before: 1000 }).reviews).toEqual([]);
  } finally { database.close(); }
});

test('evidence cursors are detached, closed and reject accessors without running them', () => {
  const input = { version: 1 as const, holds: { at: 10, id: 'a' }, reviews: null };
  const output = normalizeLoggingEvidenceCursor(input); input.holds.at = 99;
  expect(output).toEqual({ version: 1, holds: { at: 10, id: 'a' }, reviews: null });
  let ran = false;
  for (const bad of [null, {}, { ...input, extra: 1 }, { ...input, holds: { at: -1, id: 'a' } }, { ...input, get reviews() { ran = true; return null; } }]) {
    expect(() => normalizeLoggingEvidenceCursor(bad)).toThrow();
  }
  expect(ran).toBe(false);
});
