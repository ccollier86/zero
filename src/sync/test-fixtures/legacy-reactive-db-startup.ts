import { Database } from 'bun:sqlite';

/**
 * Frozen startup boundary from the pre-fence ReactiveDB release.
 *
 * The released file-mode default clears `_changes` before the application can
 * serve. Fence tests use this exact legacy SQL so the seq=0 tripwire cannot be
 * accidentally weakened by a handwritten approximation in the test itself.
 */
export function openLegacyReactiveDB(
  path: string,
  clearChangesOnStart = true,
): Database {
  const database = new Database(path, { create: true });
  try {
    database.run(`
      CREATE TABLE IF NOT EXISTS _changes (
        seq     INTEGER PRIMARY KEY,
        tbl     TEXT NOT NULL,
        op      TEXT NOT NULL,
        row_id  TEXT NOT NULL,
        data    TEXT,
        previous_data TEXT,
        ts      INTEGER NOT NULL
      )
    `);
    const columns = database.prepare('PRAGMA table_info(_changes)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'previous_data')) {
      database.run('ALTER TABLE _changes ADD COLUMN previous_data TEXT');
    }

    // The released implementation prepares these before its destructive
    // default startup clear.
    database.prepare(
      'INSERT INTO _changes (seq, tbl, op, row_id, data, previous_data, ts) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).finalize();
    database.prepare('DELETE FROM _changes WHERE seq <= ?').finalize();
    database.prepare('SELECT * FROM _changes WHERE seq > ? ORDER BY seq').finalize();
    database.prepare('SELECT MIN(seq) AS min_seq FROM _changes').finalize();

    if (clearChangesOnStart) database.run('DELETE FROM _changes');
    return database;
  } catch (error) {
    database.close();
    throw error;
  }
}
