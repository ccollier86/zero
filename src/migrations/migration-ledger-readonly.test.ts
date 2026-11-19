/** Constructor-free iterator semantics only; no database/file/artifact fixture. */
import type { Database, Statement } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import type { MigrationLedgerRecord } from './types';
import { readMigrationLedgerState } from './migration-ledger';
test('readonly durable-state reader consumes a single-pass stream and retains last successful state per version', () => {
  const first = { id: 1, version: '001', status: 'applied', direction: 'up' } as MigrationLedgerRecord;
  const rollback = { id: 2, version: '001', status: 'rolled_back', direction: 'down' } as MigrationLedgerRecord;
  const second = { id: 3, version: '002', status: 'applied', direction: 'up' } as MigrationLedgerRecord;
  let reads = 0, finalizes = 0, starts = 0;
  const source = { prepare(sql: string) {
    expect(sql).toContain("status IN ('applied', 'rolled_back')");
    return { all() { throw new Error('must not buffer retained history'); }, *iterate() { starts++; for (const row of [first, rollback, second]) { reads++; yield row; } }, finalize() { finalizes++; } } as unknown as Statement;
  } } as Pick<Database, 'prepare'>;
  const result = readMigrationLedgerState(source);
  expect([...result]).toEqual([['001', rollback], ['002', second]]); expect(reads).toBe(3); expect(starts).toBe(1); expect(finalizes).toBe(1);
});
test('readonly durable-state iterator finalizes when iteration fails rather than returning partial proof', () => {
  let finalizes = 0;
  const source = { prepare() { return { *iterate() { throw new Error('synthetic stream failure'); }, finalize() { finalizes++; } } as unknown as Statement; } } as Pick<Database, 'prepare'>;
  expect(() => readMigrationLedgerState(source)).toThrow('synthetic stream failure'); expect(finalizes).toBe(1);
});
