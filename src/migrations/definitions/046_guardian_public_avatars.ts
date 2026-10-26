/** Immutable additive publication snapshot; migration exposes no existing images. */
import type { Migration } from '../types';
const sql = `CREATE TABLE IF NOT EXISTS _auth_avatar_publications (
    user_id TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL UNIQUE,
    asset_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES _auth_avatar_assets(asset_id) ON DELETE CASCADE
  )`;
export const migration: Migration = {
  version: '046',
  description: 'Guardian explicit public avatar publications',
  safety: 'safe',
  up(db) {
    const existing = db
      .query(
        "SELECT type,sql FROM sqlite_master WHERE name='_auth_avatar_publications'",
      )
      .get() as { type: string; sql: string } | null;
    const normalize = (value: string) =>
      value
        .replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    if (
      existing &&
      (existing.type !== 'table' ||
        !existing.sql ||
        normalize(existing.sql) !== normalize(sql))
    )
      throw new Error('Guardian public avatar schema collision');
    db.exec(sql);
  },
};
