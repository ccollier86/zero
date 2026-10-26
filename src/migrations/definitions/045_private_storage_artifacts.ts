/** Add private system artifacts without changing application data or existing Storage identities. */
import type { Migration } from '../types';
// Version-local SQL is intentionally independent of mutable runtime helpers.
const PRIVATE_OBJECTS_DDL = `CREATE TABLE IF NOT EXISTS _storage_private_objects (
  namespace TEXT NOT NULL, id TEXT NOT NULL, checksum TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes>=0), mime_type TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(namespace,id)
)`;
export const migration: Migration = {
  version: '045', description: 'Private system Storage artifact references', safety: 'safe', backupRequired: false,
  up(db) { db.exec(PRIVATE_OBJECTS_DDL); },
  down(db) {
    const count = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM _storage_private_objects').get();
    if (count?.count) throw new Error('Private Storage artifacts must be reconciled before removing their metadata schema.');
    db.exec('DROP TABLE IF EXISTS _storage_private_objects');
  },
};
