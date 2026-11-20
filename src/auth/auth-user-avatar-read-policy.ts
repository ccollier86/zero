/** Runtime-only peer-photo admission. A descriptor or copied image URL is never a grant. */
import { types as utilTypes } from 'node:util';
import type { ReactiveDB } from '../sync/reactive-db';
import type { AccessRequirement } from './authorization-kernel';
import type { ServiceDataScope } from './service-data-scope';
import { serviceDataScopeFromIdentity } from './service-data-scope';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { AuthError, type AuthContext } from './types';

export interface AuthUserAvatarReadContext {
  readonly viewerId: string;
  readonly subjectId: string;
  readonly scope: ServiceDataScope;
  /** Current application-plane reads only; the facade expires when authorize returns. */
  readonly db: Pick<ReactiveDB, 'get' | 'query'>;
  /** Current Guardian authorization within the viewer's selected scope. */
  allows(userId: string, requirement: AccessRequirement): boolean;
}

/** Change version whenever the implementation's admission semantics change. */
export interface AuthUserAvatarReadPolicy {
  readonly id: string;
  readonly version: string;
  authorize(context: AuthUserAvatarReadContext): boolean;
}

/** Trusted composition, not an HTTP input or an end-user-selectable scope. */
export type AuthUserAvatarReadContextFactory = (
  auth: AuthContext, subjectId: string, guard: () => void,
) => AuthUserAvatarReadContext;

/** Detach identity and callback from mutable application configuration. */
export function snapshotAuthUserAvatarReadPolicy(
  policy?: AuthUserAvatarReadPolicy,
): AuthUserAvatarReadPolicy | undefined {
  if (policy === undefined) return undefined;
  try {
    if (!policy || typeof policy !== 'object' || utilTypes.isProxy(policy) || Array.isArray(policy)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(policy))) throw invalidReadPolicy();
    const fields = Object.getOwnPropertyDescriptors(policy), keys = Reflect.ownKeys(policy);
    if (keys.length !== 3 || keys.some(key => typeof key !== 'string' || !['id', 'version', 'authorize'].includes(key))) throw invalidReadPolicy();
    for (const key of ['id', 'version', 'authorize']) {
      if (!fields[key] || !('value' in fields[key]) || !fields[key].enumerable) throw invalidReadPolicy();
    }
    const id: unknown = fields.id.value, version: unknown = fields.version.value, authorize: unknown = fields.authorize.value;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(id)
      || typeof version !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(version)
      || typeof authorize !== 'function' || utilTypes.isProxy(authorize)) throw invalidReadPolicy();
    return Object.freeze({ id, version, authorize: authorize as AuthUserAvatarReadPolicy['authorize'] });
  } catch {
    throw invalidReadPolicy();
  }
}

/** Rebuild and retire a guarded context for every live delivery fence. */
export function authorizeAuthUserAvatarRead(
  policy: AuthUserAvatarReadPolicy,
  contextFactory: AuthUserAvatarReadContextFactory | undefined,
  auth: AuthContext,
  subjectId: string,
  guard: () => void,
): void {
  if (!contextFactory) throw avatarReadUnavailable();
  let active = true;
  const current = () => { if (!active) throw avatarReadUnavailable(); guard(); };
  try {
    current();
    const source = contextFactory(auth, subjectId, current);
    const expected = serviceDataScopeFromIdentity(auth);
    if (!source || source.viewerId !== auth.userId || source.subjectId !== subjectId || !expected
      || source.scope?.scopeKind !== expected.scopeKind || source.scope.scopeId !== expected.scopeId
      || source.scope.tenantId !== expected.tenantId || typeof source.db?.get !== 'function'
      || typeof source.db.query !== 'function' || typeof source.allows !== 'function') throw avatarReadUnavailable();
    // Expose only the canonical authority-derived shape, never extra factory fields.
    const scope = expected;
    const db: AuthUserAvatarReadContext['db'] = Object.freeze({
      get(table: string, id: string) { current(); const value = source.db.get(table, id); current(); return value; },
      query(table: string) { current(); const value = source.db.query(table); current(); return value; },
    });
    const context: AuthUserAvatarReadContext = Object.freeze({
      get viewerId() { current(); return auth.userId; },
      get subjectId() { current(); return subjectId; },
      get scope() { current(); return scope; },
      get db() { current(); return db; },
      allows(userId: string, requirement: AccessRequirement) {
        current(); const value = source.allows(userId, requirement); current(); return value === true;
      },
    });
    const allowed = invokeSynchronousAuthCallback(() => policy.authorize(context), {
      component: 'user-avatar', invariant: 'read-policy-synchronous',
      message: 'The avatar image is unavailable', createError: avatarReadUnavailable,
    });
    current();
    if (allowed !== true) throw avatarReadUnavailable();
  } catch {
    // Never expose application policy errors, relationship facts or query inputs.
    throw avatarReadUnavailable();
  } finally { active = false; }
}

function avatarReadUnavailable(): AuthError {
  return new AuthError('The avatar image is unavailable', 'AUTH_AVATAR_IMAGE_UNAVAILABLE', 404);
}
function invalidReadPolicy(): Error {
  return new Error('[auth] User avatar read policy must declare own enumerable id, version and synchronous authorize data fields.');
}
