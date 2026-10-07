/** Persisted app-owned identity shared by private Guardian protocols. */
import type { ReactiveDB } from '../sync/reactive-db';
import { createAuthStateInvariantError, type AuthPlatformCodeEmitter } from './auth-observability';

export function resolveApplicationId(db: ReactiveDB, emitCode?: AuthPlatformCodeEmitter): string {
  const key = 'auth.application.id';
  db.prepare(`
    INSERT INTO _auth_config (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO NOTHING
  `).run(key, `app_${crypto.randomUUID()}`);
  const row = db.prepare('SELECT value FROM _auth_config WHERE key = ?')
    .get(key) as { value: string } | null;
  if (!row?.value) {
    throw createAuthStateInvariantError(emitCode, {
      component: 'auth-session-continuation-store',
      invariant: 'application-id-resolution-missing',
      message: '[auth] Failed to resolve the auth application id.',
    });
  }
  return row.value;
}
