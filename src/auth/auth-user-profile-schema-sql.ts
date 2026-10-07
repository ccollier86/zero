/** Fixed SYSTEM profile DDL; policy enablement never changes these nullable fields. */

export const USER_PROFILE_REVISION_COLUMN =
  'INTEGER NOT NULL DEFAULT 1 CHECK (profile_revision BETWEEN 1 AND 9007199254740991)';

/** Startup-owned policy clock; schema installation never invents a current runtime. */
export const USER_PROFILE_POLICY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _auth_user_profile_policy (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  policy_fingerprint TEXT NOT NULL CHECK (length(policy_fingerprint) = 64),
  generation INTEGER NOT NULL CHECK (generation BETWEEN 1 AND 9007199254740991),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
)`;

export const USER_PROFILE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _auth_user_profiles (
  user_id TEXT PRIMARY KEY,
  preferred_name TEXT CHECK (preferred_name IS NULL OR length(preferred_name) <= 120),
  bio TEXT CHECK (bio IS NULL OR length(bio) <= 2000),
  website TEXT CHECK (website IS NULL OR length(website) <= 2048),
  social_links_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

export const USER_REGIONAL_PREFERENCES_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _auth_user_regional_preferences (
  user_id TEXT PRIMARY KEY,
  locale TEXT,
  time_zone TEXT,
  time_format TEXT CHECK (time_format IS NULL OR time_format IN ('12h', '24h')),
  week_starts_on INTEGER CHECK (week_starts_on IS NULL OR week_starts_on BETWEEN 0 AND 6),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
)`;

/** Every core writer shares the profile CAS, including existing administrator APIs. */
export const USER_PROFILE_CORE_REVISION_TRIGGER_SQL = `CREATE TRIGGER IF NOT EXISTS trg_auth_user_profile_core_revision_v1
  AFTER UPDATE OF username, first_name, last_name ON users
  WHEN (NEW.username IS NOT OLD.username OR NEW.first_name IS NOT OLD.first_name OR NEW.last_name IS NOT OLD.last_name)
    AND NEW.profile_revision = OLD.profile_revision
  BEGIN
    SELECT CASE WHEN OLD.profile_revision >= 9007199254740991
      THEN RAISE(ABORT, 'user profile revision is exhausted') END;
    UPDATE users SET profile_revision = profile_revision + 1 WHERE user_id = NEW.user_id;
  END`;

export const USER_PROFILE_SCHEMA_OBJECTS = Object.freeze([
  { name: '_auth_user_profile_policy', type: 'table', sql: USER_PROFILE_POLICY_TABLE_SQL },
  { name: '_auth_user_profiles', type: 'table', sql: USER_PROFILE_TABLE_SQL },
  { name: '_auth_user_regional_preferences', type: 'table', sql: USER_REGIONAL_PREFERENCES_TABLE_SQL },
  { name: 'trg_auth_user_profile_core_revision_v1', type: 'trigger', sql: USER_PROFILE_CORE_REVISION_TRIGGER_SQL },
] as const);
