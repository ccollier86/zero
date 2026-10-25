/** Explicit public image pointers. Storage objects and original delivery remain private. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { UserStore } from './user-store';
import { AuthError } from './types';
import {
  AuthUserAvatarStore,
  type AvatarAssetRow,
} from './auth-user-avatar-store';
import { inspectUserAvatarSchema } from './auth-user-avatar-schema';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
export const PUBLIC_AVATAR_SQL = `CREATE TABLE IF NOT EXISTS _auth_avatar_publications (
    user_id TEXT PRIMARY KEY,
    publication_id TEXT NOT NULL UNIQUE,
    asset_id TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL CHECK (created_at >= 0),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (asset_id) REFERENCES _auth_avatar_assets(asset_id) ON DELETE CASCADE
  )`;
export function inspectPublicAvatarSchema(
  db: Pick<ReactiveDB, 'prepare'>,
): 'ready' | 'missing' | 'invalid' {
  const actual = db
    .prepare(
      "SELECT type,sql FROM sqlite_master WHERE name='_auth_avatar_publications'",
    )
    .get() as { type: string; sql: string } | null;
  if (!actual) return 'missing';
  const normalize = (value: string) =>
    value
      .replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  return actual.type === 'table' &&
    actual.sql &&
    normalize(actual.sql) === normalize(PUBLIC_AVATAR_SQL)
    ? 'ready'
    : 'invalid';
}
export function reconcilePublicAvatarSchema(db: ReactiveDB, allowed: boolean) {
  const state = inspectPublicAvatarSchema(db);
  if (
    state !== 'missing' ||
    !allowed ||
    inspectUserAvatarSchema(db) !== 'ready'
  )
    return state;
  return db.transaction(() => {
    if (inspectPublicAvatarSchema(db) === 'missing') db.exec(PUBLIC_AVATAR_SQL);
    return inspectPublicAvatarSchema(db);
  });
}
export interface PublishedAvatarRow extends AvatarAssetRow {
  publication_id: string;
}
export class AuthUserAvatarPublications {
  private readonly avatars: AuthUserAvatarStore;
  constructor(
    private readonly db: ReactiveDB,
    private readonly users: UserStore,
    private readonly now = Date.now,
  ) {
    this.avatars = new AuthUserAvatarStore(db, users, now);
  }
  current(userId: string): PublishedAvatarRow | null {
    if (inspectPublicAvatarSchema(this.db) !== 'ready') return null;
    return this.db
      .prepare(
        `SELECT a.*,p.publication_id FROM _auth_avatar_publications p
      JOIN _auth_user_avatars u ON u.user_id=p.user_id AND u.asset_id=p.asset_id
      JOIN _auth_avatar_assets a ON a.asset_id=p.asset_id AND a.user_id=p.user_id
      JOIN users usr ON usr.user_id=p.user_id
      WHERE p.user_id=? AND a.state='current' AND usr.status='active'`,
      )
      .get(userId) as PublishedAvatarRow | null;
  }
  find(publicationId: string): PublishedAvatarRow | null {
    if (inspectPublicAvatarSchema(this.db) !== 'ready') return null;
    const row = this.db
      .prepare(
        'SELECT user_id FROM _auth_avatar_publications WHERE publication_id=?',
      )
      .get(publicationId) as { user_id: string } | null;
    const current = row ? this.current(row.user_id) : null;
    return current?.publication_id === publicationId ? current : null;
  }
  change(
    userId: string,
    expectedRevision: number,
    publish: boolean,
    admit: () => void,
  ): void {
    const fence = () =>
      invokeSynchronousAuthCallback(admit, {
        component: 'public-avatar',
        invariant: 'live-authority',
        message: 'Public avatar authority must be synchronous',
      });
    this.users.transaction(() => {
      fence();
      if (inspectPublicAvatarSchema(this.db) !== 'ready')
        throw new AuthError(
          'Public avatar storage needs a SYSTEM migration',
          'AUTH_AVATAR_PUBLIC_NOT_READY',
          503,
        );
      if (this.avatars.revision(userId) !== expectedRevision)
        throw new AuthError(
          'Your profile changed. Review it before saving.',
          'AUTH_PROFILE_REVISION_CONFLICT',
          409,
        );
      const asset = this.avatars.current(userId),
        existing = this.current(userId);
      if (publish && !asset)
        throw new AuthError(
          'Upload a profile photo before publishing it.',
          'AUTH_AVATAR_IMAGE_UNAVAILABLE',
          422,
        );
      if (publish && existing?.asset_id === asset?.asset_id) {
        fence();
        return;
      }
      if (!publish) {
        const removed = this.db
          .prepare('DELETE FROM _auth_avatar_publications WHERE user_id=?')
          .run(userId);
        if (!removed.changes) {
          fence();
          return;
        }
      } else
        this.db
          .prepare(
            `INSERT INTO _auth_avatar_publications (user_id,publication_id,asset_id,created_at) VALUES (?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET publication_id=excluded.publication_id,asset_id=excluded.asset_id,created_at=excluded.created_at`,
          )
          .run(
            userId,
            `avp_${crypto.randomUUID()}`,
            asset!.asset_id,
            this.now(),
          );
      if (
        !this.db.update('users', userId, {
          profile_revision: expectedRevision + 1,
          updated_at: this.now(),
        })
      )
        throw new AuthError('Account changed', 'AUTH_STATE_CHANGED', 409);
      fence();
    });
  }
}
