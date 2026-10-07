/** Append-only SYSTEM foundation for global profile/region fields and core-field CAS. */

import type { Migration } from '../types';

export const migration: Migration = {
  version: '039',
  description: 'Guardian global user profiles and regional preferences',
  safety: 'safe',
  backupRequired: false,
  up(db) {
    // Immutable DDL duplicated deliberately: future runtime helpers cannot rewrite history.
    const columns = db.query('PRAGMA table_info(users)').all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
    const existingRevision = columns.find(column => column.name === 'profile_revision');
    if (existingRevision && (existingRevision.type.toUpperCase() !== 'INTEGER'
      || existingRevision.notnull !== 1 || existingRevision.dflt_value !== '1')) throw collision();
    const assertRevision = () => {
      const users = db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get() as { sql: string };
      if (!users || !normalized(users.sql).toUpperCase().includes(
        'PROFILE_REVISION INTEGER NOT NULL DEFAULT 1 CHECK (PROFILE_REVISION BETWEEN 1 AND 9007199254740991)',
      )) throw collision();
    };
    if (existingRevision) assertRevision();
    // Exact object checks run before DDL, then after installation, so IF NOT EXISTS
    // cannot silently turn an incompatible private object into ledger success.
    const tables = [
      { name: '_auth_user_profile_policy', type: 'table', sql: `CREATE TABLE _auth_user_profile_policy (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        policy_fingerprint TEXT NOT NULL CHECK (length(policy_fingerprint) = 64),
        generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
      )` },
      { name: '_auth_user_profiles', type: 'table', sql: `CREATE TABLE _auth_user_profiles (
        user_id TEXT PRIMARY KEY,
        preferred_name TEXT CHECK (preferred_name IS NULL OR length(preferred_name) <= 120),
        bio TEXT CHECK (bio IS NULL OR length(bio) <= 2000),
        website TEXT CHECK (website IS NULL OR length(website) <= 2048),
        social_links_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )` },
      { name: '_auth_user_regional_preferences', type: 'table', sql: `CREATE TABLE _auth_user_regional_preferences (
        user_id TEXT PRIMARY KEY,
        locale TEXT,
        time_zone TEXT,
        time_format TEXT CHECK (time_format IS NULL OR time_format IN ('12h', '24h')),
        week_starts_on INTEGER CHECK (week_starts_on IS NULL OR week_starts_on BETWEEN 0 AND 6),
        updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )` },
      { name: 'trg_auth_user_profile_core_revision_v1', type: 'trigger', sql: `CREATE TRIGGER trg_auth_user_profile_core_revision_v1
        AFTER UPDATE OF username, first_name, last_name ON users
        WHEN (NEW.username IS NOT OLD.username OR NEW.first_name IS NOT OLD.first_name OR NEW.last_name IS NOT OLD.last_name)
          AND NEW.profile_revision = OLD.profile_revision
        BEGIN
          SELECT CASE WHEN OLD.profile_revision >= 9007199254740991
            THEN RAISE(ABORT, 'user profile revision is exhausted') END;
          UPDATE users SET profile_revision = profile_revision + 1 WHERE user_id = NEW.user_id;
        END` },
    ];
    const assertObjects = (mustExist: boolean) => {
      for (const table of tables) {
        const actual = db.query('SELECT type, sql FROM sqlite_master WHERE name = ?').get(table.name) as { type: string; sql: string | null } | null;
        if (!actual) { if (mustExist) throw collision(); continue; }
        if (actual.type !== table.type || !actual.sql || normalized(actual.sql) !== normalized(table.sql)) throw collision();
      }
    };
    assertObjects(false);
    if (!columns.some((column) => column.name === 'profile_revision')) {
      db.exec('ALTER TABLE users ADD COLUMN profile_revision INTEGER NOT NULL DEFAULT 1 CHECK (profile_revision BETWEEN 1 AND 9007199254740991)');
    }
    for (const table of tables) db.exec(table.sql.replace(/^CREATE (TABLE|TRIGGER)/u, 'CREATE $1 IF NOT EXISTS'));
    assertObjects(true);
    assertRevision();
  },
};

function normalized(sql: string): string {
  return sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim();
}

function collision(): Error {
  return new Error('Guardian user profile schema is incompatible; resolve the SYSTEM schema collision before migrating');
}
