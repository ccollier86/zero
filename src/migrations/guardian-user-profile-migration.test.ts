import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from '../auth/auth-schema';
import { inspectUserProfileSchema, reconcileUserProfileSchema } from '../auth/auth-user-profile-schema';
import { migration } from './definitions/039_guardian_user_profiles';
import { migrations } from './index';
import { Migrator } from './migrator';

function oldUsers(db: Database): void {
  db.exec(`CREATE TABLE users (user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL, first_name TEXT, last_name TEXT,
    role TEXT NOT NULL DEFAULT 'user', status TEXT NOT NULL DEFAULT 'active',
    password_change_required INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER)`);
  db.query('INSERT INTO users (user_id, username, email, first_name, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('legacy-user', 'legacy', 'legacy@example.test', 'Existing', 1);
}

describe('Guardian profile SYSTEM migration', () => {
  test('populated prior schema upgrades repeatedly without invented profile values or lost identity', () => {
    const raw = new Database(':memory:');
    oldUsers(raw);
    const db = createReactiveDB({ database: raw });
    try {
      expect(inspectUserProfileSchema(db)).toBe('missing');
      migration.up(raw); migration.up(raw);
      expect(inspectUserProfileSchema(db)).toBe('ready');
      expect(raw.query('SELECT first_name, profile_revision FROM users').get()).toEqual({ first_name: 'Existing', profile_revision: 1 });
      expect(raw.query('SELECT count(*) AS count FROM _auth_user_profiles').get()).toEqual({ count: 0 });
      expect(raw.query('SELECT count(*) AS count FROM _auth_user_regional_preferences').get()).toEqual({ count: 0 });
      raw.query('UPDATE users SET first_name = ? WHERE user_id = ?').run('Administrative edit', 'legacy-user');
      expect(raw.query('SELECT profile_revision FROM users').get()).toEqual({ profile_revision: 2 });
      expect(reconcileUserProfileSchema(db, false)).toBe('ready');
    } finally { db.dispose(); raw.close(); }
  });

  test('fresh runtime DDL and durable numbered migration have identical profile contracts', () => {
    const migrated = new Database(':memory:'); oldUsers(migrated); migration.up(migrated);
    const runtime = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(runtime);
      for (const name of ['_auth_user_profile_policy', '_auth_user_profiles', '_auth_user_regional_preferences', 'trg_auth_user_profile_core_revision_v1']) {
        const expected = migrated.query('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string };
        const actual = runtime.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(name) as { sql: string };
        expect(actual.sql.replace(/\s+/g, ' ').trim()).toBe(expected.sql.replace(/\s+/g, ' ').trim());
      }
    } finally { runtime.dispose(); migrated.close(); }
  });

  test('forbidden upgrades stay unready without creating feature tables or a revision column', () => {
    const raw = new Database(':memory:'); oldUsers(raw);
    const db = createReactiveDB({ database: raw });
    try {
      defineAuthTables(db, { profileSchemaInstallAllowed: false });
      expect(inspectUserProfileSchema(db)).toBe('missing');
      expect(raw.query("SELECT 1 FROM sqlite_master WHERE name = '_auth_user_profiles'").get()).toBeNull();
      expect((raw.query('PRAGMA table_info(users)').all() as Array<{ name: string }>)
        .some(column => column.name === 'profile_revision')).toBe(false);
      expect(raw.query('SELECT first_name FROM users').get()).toEqual({ first_name: 'Existing' });
    } finally { db.dispose(); raw.close(); }
  });

  test('schema collisions are rejected rather than repaired or overwritten', () => {
    const raw = new Database(':memory:'); oldUsers(raw);
    raw.exec('CREATE TABLE _auth_user_profiles (private_data TEXT)');
    const db = createReactiveDB({ database: raw });
    try {
      expect(reconcileUserProfileSchema(db, true)).toBe('invalid');
      expect(raw.query('PRAGMA table_info(_auth_user_profiles)').all()).toEqual([
        expect.objectContaining({ name: 'private_data' }),
      ]);
      expect((raw.query('PRAGMA table_info(users)').all() as Array<{ name: string }>)
        .some(column => column.name === 'profile_revision')).toBe(false);
      expect(() => migration.up(raw)).toThrow('schema is incompatible');
      expect((raw.query('PRAGMA table_info(users)').all() as Array<{ name: string }>)
        .some(column => column.name === 'profile_revision')).toBe(false);
    } finally { db.dispose(); raw.close(); }
  });

  test('a same-name incompatible policy table cannot pass exact migration or runtime admission', () => {
    const raw = new Database(':memory:'); oldUsers(raw);
    raw.exec('CREATE TABLE _auth_user_profile_policy (policy_fingerprint TEXT)');
    const db = createReactiveDB({ database: raw });
    try {
      const before = raw.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
      expect(inspectUserProfileSchema(db)).toBe('invalid');
      expect(reconcileUserProfileSchema(db, true)).toBe('invalid');
      expect(() => migration.up(raw)).toThrow('schema is incompatible');
      expect(raw.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
      expect(raw.query('SELECT first_name FROM users').get()).toEqual({ first_name: 'Existing' });
    } finally { db.dispose(); raw.close(); }
  });

  test('an incompatible numbered upgrade does not publish a successful migration ledger entry', () => {
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations,
      createBackups: false, log: () => {} });
    try {
      migrator.run('038');
      raw.exec('CREATE TABLE _auth_user_profiles (application_owned_data TEXT)');
      expect(() => migrator.run('039')).toThrow();
      expect(raw.query("SELECT 1 FROM _migrations WHERE version = '039'").get()).toBeNull();
      expect((raw.query('PRAGMA table_info(users)').all() as Array<{ name: string }>)
        .some(column => column.name === 'profile_revision')).toBe(false);
      expect(raw.query('PRAGMA table_info(_auth_user_profiles)').all()).toEqual([
        expect.objectContaining({ name: 'application_owned_data' }),
      ]);
    } finally { migrator.dispose(); raw.close(); }
  });
});
