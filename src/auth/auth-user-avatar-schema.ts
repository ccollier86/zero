/** Exact admission/provisioning; incompatible private tables cannot become readiness success. */
import type { ReactiveDB } from '../sync/reactive-db';
import { USER_AVATAR_SCHEMA_OBJECTS } from './auth-user-avatar-schema-sql';
import { inspectUserProfileSchema } from './auth-user-profile-schema';

export function inspectUserAvatarSchema(db: Pick<ReactiveDB, 'prepare'>): 'ready' | 'missing' | 'invalid' {
  const profile = inspectUserProfileSchema(db);
  if (profile !== 'ready') return profile;
  let missing = false;
  for (const object of USER_AVATAR_SCHEMA_OBJECTS) {
    const actual = db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?').get(object.name) as { type: string; sql: string | null } | null;
    if (!actual) { missing = true; continue; }
    if (actual.type !== object.type || !actual.sql || normalized(actual.sql) !== normalized(object.sql)) return 'invalid';
  }
  return missing ? 'missing' : 'ready';
}
export function reconcileUserAvatarSchema(db: ReactiveDB, allowed: boolean): 'ready' | 'missing' | 'invalid' {
  const status = inspectUserAvatarSchema(db);
  if (status !== 'missing' || !allowed || inspectUserProfileSchema(db) !== 'ready') return status;
  return db.transaction(() => {
    const current = inspectUserAvatarSchema(db);
    if (current !== 'missing') return current;
    for (const object of USER_AVATAR_SCHEMA_OBJECTS) db.exec(object.sql);
    return inspectUserAvatarSchema(db);
  });
}
function normalized(sql: string): string { return sql.replace(/\bIF\s+NOT\s+EXISTS\s+/gi, '').replace(/\s+/g, ' ').trim(); }
