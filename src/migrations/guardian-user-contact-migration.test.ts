import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from '../auth/auth-schema';
import { inspectUserContactSchema, reconcileUserContactSchema } from '../auth/auth-user-contact-schema';
import { USER_CONTACT_SCHEMA_OBJECTS } from '../auth/auth-user-contact-schema-sql';
import { migration } from './definitions/041_guardian_user_contacts';
import { migrations } from './index';
import { Migrator } from './migrator';

describe('contact SYSTEM migration', () => {
  test('populated queued jobs survive idempotent numbered upgrade, without invented possession proofs', () => {
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log: () => {} });
    try {
      migrator.run('040');
      raw.query(`INSERT INTO _auth_email_outbox(job_id,kind,recipient,recipient_hash,status,attempts,available_at,created_at,updated_at)
        VALUES ('old-job','password_reset','old@example.test','hash','pending',2,1,1,1)`).run();
      migrator.run('041'); migration.up(raw);
      expect(raw.query('SELECT job_id,kind,status,attempts FROM _auth_email_outbox').get()).toEqual({ job_id: 'old-job', kind: 'password_reset', status: 'pending', attempts: 2 });
      expect(raw.query('SELECT COUNT(*) AS count FROM _auth_user_contacts').get()).toEqual({ count: 0 });
      expect(raw.query('SELECT COUNT(*) AS count FROM _auth_contact_challenges').get()).toEqual({ count: 0 });
      expect(raw.query("SELECT 1 FROM _migrations WHERE version = '041'").get()).not.toBeNull();
    } finally { migrator.dispose(); raw.close(); }
  });
  test('fresh runtime and numbered installation admit the same exact private objects', () => {
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log: () => {} });
    const runtime = createReactiveDB({ mode: 'memory' });
    try {
      migrator.run('041'); defineAuthTables(runtime);
      expect(inspectUserContactSchema(runtime)).toBe('ready');
      for (const object of USER_CONTACT_SCHEMA_OBJECTS) {
        const historical = raw.query('SELECT sql FROM sqlite_master WHERE name = ?').get(object.name) as { sql: string };
        const current = runtime.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(object.name) as { sql: string };
        expect(historical.sql.replace(/\s+/g, ' ').trim()).toBe(current.sql.replace(/\s+/g, ' ').trim());
      }
      expect(reconcileUserContactSchema(runtime, false)).toBe('ready');
    } finally { migrator.dispose(); raw.close(); runtime.dispose(); }
  });
  test('forbidden compatibility upgrade stays blocked, and collision migration cannot publish success', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      defineAuthTables(db, { profileContactSchemaInstallAllowed: false });
      expect(inspectUserContactSchema(db)).toBe('missing');
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = '_auth_user_contacts'").get()).toBeNull();
    } finally { db.dispose(); }
    const raw = new Database(':memory:');
    const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log: () => {} });
    try {
      migrator.run('040'); raw.exec('CREATE TABLE _auth_user_contacts (application_owned_data TEXT)');
      expect(() => migrator.run('041')).toThrow();
      expect(raw.query("SELECT 1 FROM _migrations WHERE version = '041'").get()).toBeNull();
      expect(raw.query('PRAGMA table_info(_auth_user_contacts)').all()).toEqual([expect.objectContaining({ name: 'application_owned_data' })]);
    } finally { migrator.dispose(); raw.close(); }
  });
});
