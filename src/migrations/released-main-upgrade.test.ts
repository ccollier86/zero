import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';

import { migrations } from './index';
import { Migrator } from './migrator';

const RELEASED_THROUGH_007_CHECKSUMS = {
  '001': '94e93cee7f534ac564840b2f72af00b6fec9cfb4f6bce70e51faa4bf21681596',
  '002': '7f1b6b0974b3f06d0d164d38fddf8594441bdf09496264a0cbd7619de6e03264',
  '003': 'd1ac0ebbe5485f5d49576a1f96709be1ff725450d12e76e06b850caa51274bcc',
  '004': 'e075b12038c1814667815aa7404f8e6ea640705c2da85fc65d84f23be6630a06',
  '005': 'fe84c55ca4d576fbd41f05c5bba5a0e6584733343a911a61a91370c196e0b93a',
  '006': '4ffe14ae8c3ec90f317dbe93971aaad41434a74a526279f5245d2adbbc662366',
  '007': 'bd0a4322186613734ae550e8504964cf3111c69a245a1cc2db2cd1aacadb873a',
} as const;

test('a released main database through 007 upgrades through the current chain', () => {
  const database = new Database(':memory:');
  const released = new Migrator({
    database,
    dbPath: ':memory:',
    migrations: migrations.filter((migration) => migration.version <= '007'),
    createBackups: false,
    log: () => {},
  });

  try {
    expect(released.run()).toEqual(Object.keys(RELEASED_THROUGH_007_CHECKSUMS));
    const releasedLedger = Object.fromEntries((database.query(`
      SELECT version, checksum FROM _migrations ORDER BY version
    `).all() as Array<{ version: string; checksum: string }>).map((row) => [
      row.version,
      row.checksum,
    ]));
    expect(releasedLedger).toEqual(RELEASED_THROUGH_007_CHECKSUMS);

    released.dispose();
    const current = new Migrator({
      database,
      dbPath: ':memory:',
      migrations,
      createBackups: false,
      log: () => {},
    });
    try {
      expect(current.run()).toEqual(
        migrations.filter((migration) => migration.version > '007')
          .map((migration) => migration.version),
      );
      expect(current.status().every((entry) => entry.applied)).toBe(true);
      expect(columnNames(database, '_auth_tenants')).toContain('kind');
      expect(columnNames(database, '_auth_native_sessions'))
        .toContain('mfa_verified_at');
      expect(columnNames(database, '_auth_tenant_invitations'))
        .toContain('grant_snapshot_fingerprint');
      expect(columnNames(database, '_auth_registration_provisioning'))
        .not.toContain('provisioning_kind');
      expect(columnNames(database, '_auth_admin_user_provisioning')).toEqual([
        'provisioning_id',
        'user_id',
        'user_fingerprint',
        'auth_generation',
        'setup_token_id',
        'lease_owner_hash',
        'lease_expires_at',
        'created_at',
      ]);
      expect(columnNames(database, '_auth_api_keys')).toEqual([
        'key_id',
        'user_id',
        'label',
        'secret_hash',
        'secret_hint',
        'scope_kind',
        'scope_id',
        'tenant_id',
        'membership_id',
        'issued_auth_generation',
        'key_generation',
        'created_by_user_id',
        'created_via',
        'created_at',
        'expires_at',
        'last_used_at',
        'revoked_at',
        'revoked_by_user_id',
        'rotated_from_key_id',
      ]);
    } finally {
      current.dispose();
    }
  } finally {
    database.close();
  }
});

function columnNames(database: Database, table: string): string[] {
  return (database.query(`PRAGMA table_info(${table})`).all() as Array<{
    name: string;
  }>).map((column) => column.name);
}
