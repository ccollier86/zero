import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';

import { migrations } from './index';
import { Migrator } from './migrator';

describe('migration 021 verified-domain request provenance', () => {
  test('marks legacy evidence unbound instead of guessing the current revision', () => {
    const db = new Database(':memory:');
    try {
      db.exec(`
        CREATE TABLE _auth_domain_join_request_provenance (
          join_request_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          claim_id TEXT NOT NULL,
          domain TEXT NOT NULL,
          request_role_key TEXT NOT NULL,
          mailbox_proof_id TEXT,
          blocked_until INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE _auth_released_domain_join_provenance (
          claim_id TEXT NOT NULL,
          join_request_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          domain TEXT NOT NULL,
          request_role_key TEXT NOT NULL,
          released_at INTEGER NOT NULL,
          blocked_until INTEGER NOT NULL,
          released_by TEXT,
          PRIMARY KEY (claim_id, join_request_id)
        );
        INSERT INTO _auth_domain_join_request_provenance VALUES (
          'join-legacy', 'tenant-1', 'user-1', 'claim-1', 'acme.test',
          'member', NULL, 500, 1, 1
        );
        INSERT INTO _auth_released_domain_join_provenance VALUES (
          'claim-1', 'join-legacy', 'tenant-1', 'user-1', 'acme.test',
          'member', 1, 500, NULL
        );
      `);
      const migration = migrations.find((entry) => entry.version === '021')!;
      migration.up(db);
      migration.up(db);

      expect(db.query(`SELECT source, request_revision
        FROM _auth_domain_join_request_provenance`).get()).toEqual({
        source: 'legacy-unbound',
        request_revision: null,
      });
      expect(db.query(`SELECT source, request_revision
        FROM _auth_released_domain_join_provenance`).get()).toEqual({
        source: 'legacy-unbound',
        request_revision: null,
      });
    } finally {
      db.close();
    }
  });

  test('is the append-only successor to migration 020', () => {
    const db = new Database(':memory:');
    const migrator = new Migrator({
      database: db,
      dbPath: ':memory:',
      migrations,
      createBackups: false,
      log: () => {},
    });
    try {
      expect(migrator.run('020').at(-1)).toBe('020');
      expect(migrator.run('021')).toEqual(['021']);
      expect((db.query(`PRAGMA table_info(_auth_domain_join_request_provenance)`)
        .all() as Array<{ name: string }>).map((column) => column.name))
        .toEqual(expect.arrayContaining(['source', 'request_revision']));
    } finally {
      migrator.dispose();
      db.close();
    }
  });
});
