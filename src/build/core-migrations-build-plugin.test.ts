/** Real source-created ledgers must survive bundling, without accepting a genuinely changed migration. */
import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { migrations, Migrator, hashMigration } from '../migrations';
import { createCoreMigrationsBuildPlugin } from './core-migrations-build-plugin';

test('the official core plugin preserves every checksum and reopens an unchanged source-prepared ledger', async () => {
  const root = await mkdtemp(join(tmpdir(), 'core-migration-canonical-'));
  const database = new Database(':memory:');
  try {
    const result = await Bun.build({ entrypoints: [join(import.meta.dir, '../migrations/index.ts')], outdir: root, target: 'bun', format: 'esm', minify: false,
      plugins: [await createCoreMigrationsBuildPlugin()] });
    expect(result.success, result.logs.map(log => log.message).join('\n')).toBe(true);
    const bundled = await import(result.outputs.find(output => output.kind === 'entry-point')!.path) as typeof import('../migrations');
    expect(bundled.migrations.map(hashMigration)).toEqual(migrations.map(hashMigration));
    expect(bundled.migrations.map(migration => migration.version)).toEqual(migrations.map(migration => migration.version));
    const source = new Migrator({ database, migrations, allowDestructive: true, log: () => {} });
    expect(source.run()).toHaveLength(migrations.length);
    database.run('INSERT INTO users (user_id, username, email, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', ['fixture-user', 'fixture-user', 'fixture@example.test', 'admin', 'active', 1]);
    const before = database.query('SELECT count(*) AS n FROM _zero_migrations').get();
    const raw = await Bun.build({ entrypoints: [join(import.meta.dir, '../migrations/index.ts')], outdir: join(root, 'unfixed'), target: 'bun', format: 'esm', minify: false });
    expect(raw.success).toBe(true);
    const previous = await import(raw.outputs.find(output => output.kind === 'entry-point')!.path) as typeof import('../migrations');
    const unfixed = new previous.Migrator({ database, migrations: previous.migrations, log: () => {} });
    expect(() => unfixed.run()).toThrow('Migration 004 changed after it was applied');
    expect(database.query('SELECT count(*) AS n FROM _zero_migrations').get()).toEqual(before);
    const compiled = new bundled.Migrator({ database, migrations: bundled.migrations, log: () => {} });
    expect(compiled.run()).toEqual([]); expect(compiled.status().every(status => status.checksumMatches)).toBe(true);
    expect(database.query('SELECT count(*) AS n FROM _zero_migrations').get()).toEqual(before);
    expect(database.query('SELECT user_id, role FROM users').all()).toEqual([{ user_id: 'fixture-user', role: 'admin' }]);
    expect(source.run()).toEqual([]);
    const changed = migrations.map(migration => migration.version === '004' ? { ...migration, up() { throw new Error('A real changed migration must not execute'); } } : migration);
    const invalid = new Migrator({ database, migrations: changed, log: () => {} });
    expect(() => invalid.run()).toThrow('Migration 004 changed after it was applied');
    expect(database.query('SELECT count(*) AS n FROM _zero_migrations').get()).toEqual(before);
    expect(Object.getOwnPropertyDescriptor(bundled.migrations[0]!.up, 'toString')).toMatchObject({ writable: false, configurable: false });
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
}, 60000);
