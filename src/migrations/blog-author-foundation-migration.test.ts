import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';
import { migration as publicAvatars } from './definitions/045_guardian_public_avatars';
import { migration as authors } from './definitions/046_blog_author_foundation';
import {
  inspectPublicAvatarSchema,
  reconcilePublicAvatarSchema,
} from '../auth/auth-user-avatar-publications';
import { inspectBlogSchema, reconcileBlogSchema } from '../blog/schema';
import { defineAuthTables } from '../auth/auth-schema';
import { reconcileUserAvatarSchema } from '../auth/auth-user-avatar-schema';

test('044 to 046 is additive, repeatable and preserves existing identities, private profiles and authorization history', () => {
  const raw = new Database(':memory:');
  const migrator = new Migrator({
    database: raw,
    dbPath: ':memory:',
    migrations,
    createBackups: false,
    log: () => {},
  });
  try {
    migrator.run('044');
    raw.exec(
      "INSERT INTO users(user_id,username,email,role,created_at) VALUES ('existing-user','existing-user','private@example.test','admin',1)",
    );
    raw.exec(
      "INSERT INTO _credentials(user_id,password_hash) VALUES ('existing-user','opaque-existing-hash')",
    );
    raw.exec(
      "INSERT INTO _auth_user_profiles(user_id,bio,updated_at) VALUES ('existing-user','Existing private biography',1)",
    );
    const credentials = raw.query('SELECT * FROM _credentials').all(),
      profiles = raw.query('SELECT * FROM _auth_user_profiles').all();
    const before = raw.query('SELECT * FROM users').all();
    const objects = raw
      .query(
        "SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string; sql: string | null }>;
    expect(migrator.run()).toEqual(['045', '046']);
    publicAvatars.up(raw);
    authors.up(raw);
    expect(migrator.run()).toEqual([]);
    expect(raw.query('SELECT * FROM users').all()).toEqual(before);
    expect(raw.query('SELECT * FROM _credentials').all()).toEqual(credentials);
    expect(raw.query('SELECT * FROM _auth_user_profiles').all()).toEqual(
      profiles,
    );
    for (const object of objects)
      expect(
        raw
          .query('SELECT sql FROM sqlite_master WHERE name=?')
          .get(object.name),
      ).toEqual({ sql: object.sql });
    for (const table of [
      '_blog_sites',
      '_blog_authors',
      '_auth_avatar_publications',
    ])
      expect(raw.query(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual(
        { count: 0 },
      );
    expect(raw.query('PRAGMA foreign_key_check').all()).toEqual([]);
    const adapter = { prepare: (sql: string) => raw.query(sql) } as any;
    expect(inspectBlogSchema(adapter)).toBe('ready');
    expect(inspectPublicAvatarSchema(adapter)).toBe('ready');
  } finally {
    migrator.dispose();
    raw.close();
  }
});

test('numbered migration and admitted standalone schema agree, and migrate:false does no DDL', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    defineAuthTables(db);
    reconcileUserAvatarSchema(db, true);
    expect(reconcilePublicAvatarSchema(db, false)).toBe('missing');
    expect(reconcileBlogSchema(db, false)).toBe('missing');
    expect(reconcilePublicAvatarSchema(db, true)).toBe('ready');
    expect(reconcileBlogSchema(db, true)).toBe('ready');
    expect(() => publicAvatars.up(db.getRawDatabase())).not.toThrow();
    expect(() => authors.up(db.getRawDatabase())).not.toThrow();
  } finally {
    db.dispose();
  }
});

test('colliding private objects are refused without partial installation or a false migration receipt', () => {
  for (const [prior, next, collision] of [
    ['044', '045', '_auth_avatar_publications'],
    ['045', '046', '_blog_authors'],
  ] as const) {
    const raw = new Database(':memory:');
    const migrator = new Migrator({
      database: raw,
      dbPath: ':memory:',
      migrations,
      createBackups: false,
      log: () => {},
    });
    try {
      migrator.run(prior);
      raw.exec(`CREATE TABLE ${collision} (private_application_value TEXT)`);
      raw.query(`INSERT INTO ${collision} VALUES (?)`).run('keep');
      expect(() => migrator.run(next)).toThrow();
      expect(
        raw.query('SELECT 1 FROM _migrations WHERE version=?').get(next),
      ).toBeNull();
      expect(raw.query(`SELECT * FROM ${collision}`).all()).toEqual([
        { private_application_value: 'keep' },
      ]);
      if (next === '046')
        expect(
          raw
            .query("SELECT name FROM sqlite_master WHERE name='_blog_policy'")
            .get(),
        ).toBeNull();
    } finally {
      migrator.dispose();
      raw.close();
    }
  }
});
