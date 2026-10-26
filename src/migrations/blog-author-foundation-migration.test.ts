import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { migrations } from './index';
import { Migrator } from './migrator';
import { migration as publicAvatars } from './definitions/046_guardian_public_avatars';
import { migration as authors } from './definitions/047_blog_author_foundation';
import {
  inspectPublicAvatarSchema,
  reconcilePublicAvatarSchema,
} from '../auth/auth-user-avatar-publications';
import { inspectBlogSchema, reconcileBlogSchema } from '../blog/schema';
import { defineAuthTables } from '../auth/auth-schema';
import { reconcileUserAvatarSchema } from '../auth/auth-user-avatar-schema';

for (const prior of ['044', '045'] as const) {
test(`${prior} to 047 is additive, repeatable and preserves existing identities, private profiles and authorization history`, () => {
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
    raw.exec(
      "INSERT INTO users(user_id,username,email,role,created_at) VALUES ('existing-user','existing-user','private@example.test','admin',1)",
    );
    raw.exec(
      "INSERT INTO _credentials(user_id,password_hash) VALUES ('existing-user','opaque-existing-hash')",
    );
    raw.exec(
      "INSERT INTO _auth_user_profiles(user_id,bio,updated_at) VALUES ('existing-user','Existing private biography',1)",
    );
    if (prior === '045') raw.exec(
      "INSERT INTO _storage_private_objects(namespace,id,checksum,size_bytes,mime_type,created_at) VALUES ('logging-evidence','retained-export','synthetic-checksum',12,'application/zip',1)",
    );
    const retainedArtifacts = prior === '045'
      ? raw.query('SELECT * FROM _storage_private_objects').all() : [];
    const priorLedger = raw.query('SELECT * FROM _migrations ORDER BY version').all();
    const credentials = raw.query('SELECT * FROM _credentials').all(),
      profiles = raw.query('SELECT * FROM _auth_user_profiles').all();
    const before = raw.query('SELECT * FROM users').all();
    const objects = raw
      .query(
        "SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string; sql: string | null }>;
    expect(migrator.run()).toEqual(prior === '044' ? ['045', '046', '047'] : ['046', '047']);
    publicAvatars.up(raw);
    authors.up(raw);
    expect(migrator.run()).toEqual([]);
    expect(raw.query('SELECT * FROM users').all()).toEqual(before);
    expect(raw.query('SELECT * FROM _credentials').all()).toEqual(credentials);
    expect(raw.query('SELECT * FROM _storage_private_objects').all()).toEqual(retainedArtifacts);
    expect(raw.query('SELECT * FROM _migrations WHERE version<=? ORDER BY version').all(prior)).toEqual(priorLedger);
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
}

test('old unpublished author-preview ledgers are rejected without rewriting receipts, authors or photos', () => {
  for (const includeAuthors of [false, true]) {
    const raw = new Database(':memory:');
    // The earlier preview reserved 045/046 before released main appended its
    // own 045. It is not a released-main ledger and must not be silently aliased.
    const preview = new Migrator({ database: raw, dbPath: ':memory:', createBackups: false, log() {},
      migrations: [
        ...migrations.filter(migration => migration.version <= '044'),
        { ...publicAvatars, version: '045' },
        ...(includeAuthors ? [{ ...authors, version: '046' }] : []),
      ],
    });
    const current = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log() {} });
    try {
      preview.run();
      raw.exec("INSERT INTO users(user_id,username,email,role,created_at) VALUES ('preview-user','preview-user','private@example.test','admin',1)");
      if (includeAuthors) {
        raw.exec("INSERT INTO _blog_sites(site_id,scope_key,slug,name) VALUES ('site-preview','app','blog','Retained preview')");
        raw.exec(`INSERT INTO _blog_authors(author_id,site_id,user_id,status,revision,slug,draft_json,updated_at)
          VALUES ('author-preview','site-preview','preview-user','active',1,'preview-author','{}',1)`);
      }
      const tables = (raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>).map(row => row.name);
      const before = tables.map(name => [name, raw.query(`SELECT * FROM "${name}"`).all()]);
      const schema = raw.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
      expect(() => current.run()).toThrow('Migration 045 changed after it was applied');
      expect(raw.query('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
      expect(tables.map(name => [name, raw.query(`SELECT * FROM "${name}"`).all()])).toEqual(before);
    } finally { current.dispose(); preview.dispose(); raw.close(); }
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
    ['045', '046', '_auth_avatar_publications'],
    ['046', '047', '_blog_authors'],
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
      if (next === '047')
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
