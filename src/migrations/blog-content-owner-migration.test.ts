/** Additive SYSTEM ownership migration agrees with exact startup admission and never repairs collisions silently. */
import { Database } from 'bun:sqlite';
import { test, expect } from 'bun:test';
import { Migrator } from './migrator';
import { migrations } from './index';
import { migration } from './definitions/048_blog_content_owner';
import { inspectBlogContentOwnerSchema } from '../blog/content-owner-schema';

test('047 to 048 preserves identities and every previous ledger and schema object', () => {
  const db = new Database(':memory:'), migrator = new Migrator({ database: db, dbPath: ':memory:', migrations, createBackups: false, log() {} });
  try {
    migrator.run('047'); db.exec("INSERT INTO users(user_id,username,email,role,created_at) VALUES ('existing','existing','synthetic@example.test','admin',1)");
    const ledger = db.query('SELECT * FROM _migrations ORDER BY version').all(), schema = db.query("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string; sql: string | null }[];
    const before = db.query('SELECT * FROM users').all(); expect(migrator.run('048')).toEqual(['048']); migration.up(db); expect(migrator.run('048')).toEqual([]);
    expect(db.query('SELECT * FROM users').all()).toEqual(before); expect(db.query("SELECT * FROM _migrations WHERE version<='047' ORDER BY version").all()).toEqual(ledger);
    for (const row of schema) expect(db.query('SELECT sql FROM sqlite_master WHERE name=?').get(row.name)).toEqual({ sql: row.sql });
    expect(inspectBlogContentOwnerSchema({ prepare: (sql: string) => db.query(sql) } as never)).toBe('ready'); expect(db.query('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { migrator.dispose(); db.close(); }
});
test('unknown same-name objects are preserved, with no false migration receipt or partial table installation', () => {
  const db = new Database(':memory:'), migrator = new Migrator({ database: db, dbPath: ':memory:', migrations, createBackups: false, log() {} });
  try {
    migrator.run('047'); db.exec('CREATE TABLE _blog_media_leases (application_value TEXT)'); db.exec("INSERT INTO _blog_media_leases VALUES('keep')");
    expect(() => migrator.run('048')).toThrow(); expect(db.query("SELECT 1 FROM _migrations WHERE version='048'").get()).toBeNull();
    expect(db.query('SELECT * FROM _blog_media_leases').all()).toEqual([{ application_value: 'keep' }]); expect(db.query("SELECT 1 FROM sqlite_master WHERE name='_blog_content_owner'").get()).toBeNull();
  } finally { migrator.dispose(); db.close(); }
});
