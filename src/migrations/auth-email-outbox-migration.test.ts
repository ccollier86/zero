import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createAuthEmailOutboxSchema } from '../auth/auth-email-outbox-schema';
import { migrations } from './index';
import { Migrator } from './migrator';

test('migration 007 matches the runtime auth email outbox schema', () => {
  const migrated = prepare(true);
  const runtime = prepare(false);
  try {
    createAuthEmailOutboxSchema((sql) => runtime.db.run(sql));
    expect(shape(migrated.db)).toEqual(shape(runtime.db));
    expect(columns(migrated.db)).toEqual([
      'job_id', 'kind', 'recipient', 'recipient_hash', 'native_continuation',
      'status', 'attempts', 'available_at', 'lease_owner', 'lease_expires_at',
      'created_at', 'updated_at', 'completed_at', 'last_error_code',
    ]);
  } finally {
    migrated.migrator.dispose(); runtime.migrator.dispose();
    migrated.db.close(); runtime.db.close();
  }
});

function prepare(migrate: boolean) {
  const db = new Database(':memory:');
  const migrator = new Migrator({
    database: db, dbPath: ':memory:', migrations, createBackups: false, log: () => {},
  });
  if (migrate) migrator.run('007');
  return { db, migrator };
}

function shape(db: Database) {
  return {
    columns: db.query('PRAGMA table_info(_auth_email_outbox)').all(),
    indexes: db.query('PRAGMA index_list(_auth_email_outbox)').all(),
  };
}

function columns(db: Database): string[] {
  return (db.query('PRAGMA table_info(_auth_email_outbox)').all() as any[])
    .map((row) => row.name);
}
