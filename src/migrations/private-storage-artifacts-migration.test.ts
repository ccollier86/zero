/** Appended SYSTEM migration is additive, parity-checked and refuses destructive rollback with retained artifacts. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migration } from './definitions/045_private_storage_artifacts';
import { STORAGE_PRIVATE_OBJECTS_DDL } from '../storage/storage-private-object-schema';

test('045 and the current runtime private Storage schema agree without changing existing state', () => {
  const a = new Database(':memory:'), b = new Database(':memory:');
  try {
    a.exec('CREATE TABLE fixture_state(id TEXT PRIMARY KEY, value TEXT); INSERT INTO fixture_state VALUES(\'original\',\'unchanged\')');
    migration.up(a); b.exec(STORAGE_PRIVATE_OBJECTS_DDL);
    expect(a.query('PRAGMA table_info(_storage_private_objects)').all()).toEqual(b.query('PRAGMA table_info(_storage_private_objects)').all());
    expect(a.query('SELECT value FROM fixture_state').get()).toEqual({ value: 'unchanged' });
    a.run('INSERT INTO _storage_private_objects VALUES(?,?,?,?,?,?)', ['zero.logging.exports', 'evidence-id', 'a'.repeat(64), 42, 'application/x-ndjson', 1]);
    expect(() => migration.down!(a)).toThrow('must be reconciled');
    expect(a.query('SELECT COUNT(*) AS count FROM _storage_private_objects').get()).toEqual({ count: 1 });
  } finally { a.close(); b.close(); }
});
