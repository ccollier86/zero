import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from '../auth/auth-schema';
import { PROFILE_COMPLETION_SCHEMA, inspectProfileCompletionSchema } from '../auth/auth-user-profile-completion-schema';
import { migration } from './definitions/043_guardian_profile_completion';
import { migrations } from './index';
import { Migrator } from './migrator';

describe('required profile completion SYSTEM upgrade', () => {
  test('populated tenant continuations and domain-child foreign keys survive an additive idempotent upgrade', () => {
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log: () => {} });
    try {
      migrator.run('042');
      raw.exec("INSERT INTO users(user_id,username,email,created_at) VALUES ('old-user','old-user','old@example.test',1)");
      raw.exec(`INSERT INTO _auth_session_continuations
        (continuation_id,application_id,user_id,purpose,token_hash,auth_generation,expires_at,created_at)
        VALUES ('old-continuation','old-app','old-user','tenant_onboarding','old-hash',0,9999999999999,1)`);
      raw.exec(`INSERT INTO _auth_domain_mailbox_tokens
        (token_id,application_id,user_id,email,email_generation,auth_generation,identity_kind,identity_continuation_id,
         token_hash,outbox_job_id,expires_at,created_at)
        VALUES ('old-domain-proof','old-app','old-user','old@example.test',1,0,'continuation','old-continuation',
         'old-domain-hash','old-job',9999999999999,1)`);
      const oldSql = raw.query("SELECT sql FROM sqlite_master WHERE name = '_auth_session_continuations'").get();
      migrator.run('043'); migration.up(raw);
      expect(raw.query("SELECT sql FROM sqlite_master WHERE name = '_auth_session_continuations'").get()).toEqual(oldSql);
      expect(raw.query('SELECT continuation_id,purpose FROM _auth_session_continuations').get())
        .toEqual({ continuation_id: 'old-continuation', purpose: 'tenant_onboarding' });
      expect(raw.query('SELECT token_id,identity_continuation_id FROM _auth_domain_mailbox_tokens').get())
        .toEqual({ token_id: 'old-domain-proof', identity_continuation_id: 'old-continuation' });
      expect(raw.query('PRAGMA foreign_key_list(_auth_domain_mailbox_tokens)').all())
        .toContainEqual(expect.objectContaining({ table: '_auth_session_continuations', from: 'identity_continuation_id' }));
      expect(raw.query('SELECT COUNT(*) AS count FROM _auth_profile_completion_enrollments').get()).toEqual({ count: 0 });
      expect(raw.query("SELECT 1 FROM _migrations WHERE version = '043'").get()).not.toBeNull();
      expect(raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally { migrator.dispose(); raw.close(); }
  });
  test('runtime compatibility and numbered migrations install identical private objects', () => {
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log: () => {} });
    const db = createReactiveDB({ mode: 'memory' });
    try {
      migrator.run('043'); defineAuthTables(db);
      expect(inspectProfileCompletionSchema(db)).toBe('ready');
      for (const object of PROFILE_COMPLETION_SCHEMA) {
        const historical = raw.query('SELECT sql FROM sqlite_master WHERE name = ?').get(object.name) as { sql: string };
        const runtime = db.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(object.name) as { sql: string };
        expect(historical.sql.replace(/\s+/g, ' ').trim()).toBe(runtime.sql.replace(/\s+/g, ' ').trim());
      }
    } finally { migrator.dispose(); raw.close(); db.dispose(); }
  });
  test('migrate:false stays blocked and a colliding schema cannot publish a migration receipt', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db, { profileCompletionSchemaInstallAllowed: false });
      expect(inspectProfileCompletionSchema(db)).toBe('missing');
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_auth_profile_completion_continuations'").get()).toBeNull();
    } finally { db.dispose(); }
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log: () => {} });
    try {
      migrator.run('042'); raw.exec('CREATE TABLE _auth_profile_completion_enrollments (app_owned TEXT)');
      expect(() => migrator.run('043')).toThrow();
      expect(raw.query("SELECT 1 FROM _migrations WHERE version = '043'").get()).toBeNull();
      expect(raw.query("SELECT 1 FROM sqlite_master WHERE name = '_auth_profile_completion_continuations'").get()).toBeNull();
      expect(raw.query('PRAGMA table_info(_auth_profile_completion_enrollments)').all())
        .toEqual([expect.objectContaining({ name: 'app_owned' })]);
    } finally { migrator.dispose(); raw.close(); }
  });
});
