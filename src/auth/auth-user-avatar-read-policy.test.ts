import { describe, expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { applicationServiceDataScope, trustedSystemServiceDataScope } from './service-data-scope';
import { authorizeAuthUserAvatarRead, snapshotAuthUserAvatarReadPolicy,
  type AuthUserAvatarReadContext, type AuthUserAvatarReadContextFactory,
  type AuthUserAvatarReadPolicy } from './auth-user-avatar-read-policy';
import type { AuthContext } from './types';

const auth: AuthContext = { userId: 'viewer', email: 'private-viewer@example.test', role: 'user',
  sessionScopeKind: 'application', sessionScopeId: 'application' };
const unavailable = { code: 'AUTH_AVATAR_IMAGE_UNAVAILABLE', status: 404 };
const policy = (authorize: AuthUserAvatarReadPolicy['authorize']): AuthUserAvatarReadPolicy => ({ id: 'synthetic-avatar-reads', version: '1', authorize });

describe('runtime-only private avatar peer policy', () => {
  test('snapshots a validated versioned callback without retaining mutable configuration', () => {
    const input = policy(() => true), saved = snapshotAuthUserAvatarReadPolicy(input)!;
    input.authorize = () => false;
    expect(saved).not.toBe(input); expect(Object.isFrozen(saved)).toBe(true);
    expect(saved.authorize({} as AuthUserAvatarReadContext)).toBe(true);
    expect(snapshotAuthUserAvatarReadPolicy()).toBeUndefined();
    for (const value of [null, true, {}, { ...input, id: '' }, { ...input, version: 1 },
      { ...input, version: 'private/invalid' }, { ...input, authorize: true }, { ...input, secret: 'never accepted' }]) {
      expect(() => snapshotAuthUserAvatarReadPolicy(value as AuthUserAvatarReadPolicy)).toThrow();
    }
    let invoked = 0;
    const getter = { ...input };
    Object.defineProperty(getter, 'id', { enumerable: true, get() { invoked++; return 'unsafe'; } });
    const proxy = new Proxy(input, { getOwnPropertyDescriptor() { invoked++; throw new Error('unsafe trap'); },
      getPrototypeOf() { invoked++; throw new Error('unsafe trap'); } });
    const hidden = { ...input }; Object.defineProperty(hidden, 'id', { enumerable: false, value: 'hidden' });
    for (const value of [getter, proxy, hidden, { ...input, [Symbol('hidden')]: true },
      { ...input, authorize: new Proxy(input.authorize, {}) }]) {
      expect(() => snapshotAuthUserAvatarReadPolicy(value)).toThrow();
    }
    expect(invoked).toBe(0);
  });

  test('guarded read methods and the allowlisted context expire when the synchronous policy returns', () => {
    const db = createReactiveDB({ mode: 'memory' }); db.exec('PRAGMA temp_store=MEMORY');
    try {
      db.defineTable('avatar_relationships', { id: 'text primary key', viewer_id: 'text', subject_id: 'text' });
      db.insert('avatar_relationships', { id: 'permitted', viewer_id: 'viewer', subject_id: 'subject' });
      let captured!: AuthUserAvatarReadContext;
      let capturedDb!: AuthUserAvatarReadContext['db'];
      let capturedAllows!: AuthUserAvatarReadContext['allows'];
      let checks = 0;
      const factory: AuthUserAvatarReadContextFactory = (viewer, subjectId) => ({ viewerId: viewer.userId, subjectId,
        scope: applicationServiceDataScope(), db, allows: (id, requirement) => id === 'viewer' && requirement === 'user' });
      authorizeAuthUserAvatarRead(policy(context => {
        captured = context; capturedDb = context.db; capturedAllows = context.allows;
        expect(Object.keys(context).sort()).toEqual(['allows', 'db', 'scope', 'subjectId', 'viewerId']);
        expect(context.viewerId).toBe('viewer'); expect(context.subjectId).toBe('subject');
        expect(context.scope.scopeKind).toBe('application');
        expect(context.allows('viewer', 'user')).toBe(true);
        expect(context.db.get('avatar_relationships', 'permitted')?.subject_id).toBe('subject');
        return context.db.query('avatar_relationships').length === 1;
      }), factory, auth, 'subject', () => { checks++; });
      expect(checks).toBeGreaterThan(10);
      expect(() => captured.viewerId).toThrow(expect.objectContaining(unavailable));
      expect(() => captured.subjectId).toThrow(expect.objectContaining(unavailable));
      expect(() => captured.scope).toThrow(expect.objectContaining(unavailable));
      expect(() => captured.db).toThrow(expect.objectContaining(unavailable));
      expect(() => capturedDb.get('avatar_relationships', 'permitted')).toThrow(expect.objectContaining(unavailable));
      expect(() => capturedDb.query('avatar_relationships')).toThrow(expect.objectContaining(unavailable));
      expect(() => capturedAllows('viewer', 'user')).toThrow(expect.objectContaining(unavailable));
    } finally { db.dispose(); }
  });

  test('denial, errors, nonboolean and asynchronous callbacks all fail closed without private diagnostics', async () => {
    const db = createReactiveDB({ mode: 'memory' }); db.exec('PRAGMA temp_store=MEMORY');
    try {
      const factory: AuthUserAvatarReadContextFactory = (viewer, subjectId) => ({ viewerId: viewer.userId, subjectId,
        scope: applicationServiceDataScope(), db, allows: () => true });
      const callbacks = [() => false, () => undefined, () => 1, () => ({ allowed: true }),
        () => { throw new Error('private housing placement'); }, () => Promise.resolve(true),
        () => Promise.reject(new Error('private asynchronous placement'))];
      for (const callback of callbacks) {
        expect(() => authorizeAuthUserAvatarRead(policy(callback as AuthUserAvatarReadPolicy['authorize']),
          factory, auth, 'subject', () => {})).toThrow(expect.objectContaining({ ...unavailable, message: 'The avatar image is unavailable' }));
      }
      await Promise.resolve(); // Rejected callback continuations have an owned rejection handler.
    } finally { db.dispose(); }
  });

  test('missing or contradictory trusted composition cannot widen the captured viewer scope', () => {
    const db = createReactiveDB({ mode: 'memory' }); db.exec('PRAGMA temp_store=MEMORY');
    try {
      const source = { viewerId: 'viewer', subjectId: 'subject', scope: applicationServiceDataScope(), db, allows: () => true };
      for (const factory of [undefined, () => ({ ...source, viewerId: 'other' }), () => ({ ...source, subjectId: 'other' }),
        () => ({ ...source, scope: trustedSystemServiceDataScope({ scopeKind: 'tenant', tenantId: 'foreign-tenant' }) })]) {
        expect(() => authorizeAuthUserAvatarRead(policy(() => true), factory, auth, 'subject', () => {}))
          .toThrow(expect.objectContaining(unavailable));
      }
      let current = true;
      expect(() => authorizeAuthUserAvatarRead(policy(() => { current = false; return true; }), () => source, auth, 'subject',
        () => { if (!current) throw new Error('retired authority'); })).toThrow(expect.objectContaining(unavailable));
    } finally { db.dispose(); }
  });
});
