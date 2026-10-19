/** Session commits must wait outside SQLite rather than lose to a busy actor. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { AuthorityCommitCoordinator } from '../databases/authority-commit-coordinator';
import { registerDatabaseAuthorityCommitGuard } from '../databases/database-authority-commit-guard';
import { installAuthAuthorityRevision } from './auth-authority-revision';
import { defineAuthTables } from './auth-schema';
import { UserStore } from './user-store';
import { TokenService } from './token-service';
import { withAuthCommitAdmission } from './auth-commit-admission';
import { AuthError } from './types';

async function fixture() {
  const db = createReactiveDB({ mode: 'memory' });
  defineAuthTables(db);
  const users = new UserStore(db);
  const tokens = await TokenService.create({ db });
  tokens.setUserStore(users);
  const user = await users.createUser({ username: 'admitted-user', email: 'admitted@example.test', password: 'test-password-123' });
  installAuthAuthorityRevision(db);
  const coordinator = new AuthorityCommitCoordinator();
  const remove = registerDatabaseAuthorityCommitGuard(db, coordinator);
  return { db, users, tokens, user, coordinator, async close() { remove(); await coordinator.close(); db.dispose(); } };
}

test('web session issuance waits once for an active shared holder', async () => {
  const h = await fixture();
  const shared = await h.coordinator.acquireShared();
  const timer = setTimeout(() => shared.release(), 100);
  try {
    const pair = await h.tokens.issueTokenPair(h.user);
    expect(pair.accessToken).toBeString();
    expect(shared.released).toBe(true);
    expect(await h.tokens.resolveAuthContext(pair.accessToken)).toMatchObject({ userId: h.user.userId });
    expect(h.coordinator.diagnostics()).toMatchObject({ activeShared: 0, activeExclusive: false, pendingExclusive: 0 });
  } finally { clearTimeout(timer); shared.release(); await h.close(); }
});

test('refresh rotation waits for shared work and rotates exactly once', async () => {
  const h = await fixture();
  const original = await h.tokens.issueTokenPair(h.user);
  const shared = await h.coordinator.acquireShared();
  const timer = setTimeout(() => shared.release(), 100);
  try {
    const rotated = await h.tokens.rotateRefreshToken(original.refreshToken);
    expect(rotated).not.toBeNull();
    expect(rotated!.refreshToken).not.toBe(original.refreshToken);
    expect(shared.released).toBe(true);
    expect(await h.tokens.resolveAuthContext(rotated!.accessToken)).toMatchObject({ userId: h.user.userId });
  } finally { clearTimeout(timer); shared.release(); await h.close(); }
});

async function waitForAdmission(h: Awaited<ReturnType<typeof fixture>>) {
  const deadline = Date.now() + 2_000;
  while (h.coordinator.diagnostics().pendingExclusive === 0 && Date.now() < deadline) await Bun.sleep(1);
  expect(h.coordinator.diagnostics().pendingExclusive).toBe(1);
}

test('session issuance rechecks account authority after waiting', async () => {
  const h = await fixture(), shared = await h.coordinator.acquireShared();
  const pending = h.tokens.issueTokenPair(h.user);
  try {
    await waitForAdmission(h);
    // Simulate another SYSTEM writer changing authority during local admission.
    h.db.prepare("UPDATE users SET status = 'suspended' WHERE user_id = ?").run(h.user.userId);
    shared.release();
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    expect(h.db.prepare('SELECT count(*) AS n FROM _auth_sessions').get()).toEqual({ n: 0 });
  } finally { shared.release(); await h.close(); }
});

test('refresh rechecks revocation after waiting and does not rotate a revoked parent', async () => {
  const h = await fixture(), original = await h.tokens.issueTokenPair(h.user);
  const shared = await h.coordinator.acquireShared();
  const pending = h.tokens.rotateRefreshToken(original.refreshToken);
  try {
    await waitForAdmission(h);
    h.db.prepare("UPDATE _auth_sessions SET status = 'revoked', revoked_at = ? WHERE user_id = ?").run(Date.now(), h.user.userId);
    shared.release();
    expect(await pending).toBeNull();
    expect(await h.tokens.resolveAuthContext(original.accessToken)).toBeNull();
  } finally { shared.release(); await h.close(); }
});

test('refresh cannot consume a child that expires while waiting for admission', async () => {
  const h = await fixture(), original = await h.tokens.issueTokenPair(h.user);
  const shared = await h.coordinator.acquireShared();
  const pending = h.tokens.rotateRefreshToken(original.refreshToken);
  try {
    await waitForAdmission(h);
    h.db.prepare('UPDATE _refresh_tokens SET expires_at = ? WHERE user_id = ?').run(Date.now() + 10, h.user.userId);
    await Bun.sleep(20);
    shared.release();
    expect(await pending).toBeNull();
    expect(h.db.prepare('SELECT count(*) AS n FROM _refresh_tokens').get()).toEqual({ n: 1 });
  } finally { shared.release(); await h.close(); }
});

test('opaque UserStore admission shares its database gate and keeps final authority rejection', async () => {
  const h = await fixture(), pair = await h.tokens.issueTokenPair(h.user);
  const auth = await h.tokens.resolveAuthContext(pair.accessToken);
  const reference = h.tokens.captureAuthContextAuthority(auth!);
  const shared = await h.coordinator.acquireShared();
  let mutations = 0;
  const pending = withAuthCommitAdmission(h.users, () => h.users.transaction(() => {
    if (!reference || !h.tokens.resolveAuthContextAuthority(reference)) {
      throw new AuthError('Authority changed', 'UNAUTHORIZED', 401);
    }
    mutations++;
    return h.users.updateUser(h.user.userId, { role: 'admin' });
  }));
  try {
    await waitForAdmission(h);
    expect(mutations).toBe(0);
    h.db.prepare("UPDATE _auth_sessions SET status = 'revoked', revoked_at = ? WHERE user_id = ?")
      .run(Date.now(), h.user.userId);
    shared.release();
    await expect(pending).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(mutations).toBe(0);
    expect(h.users.getUserById(h.user.userId)!.role).toBe('user');
  } finally { shared.release(); await h.close(); }
});

test('password hashing does not occupy authority, and final reset rechecks authority after waiting', async () => {
  const h = await fixture();
  const credentials = (h.users as any).credentials;
  const original = credentials.hashPassword.bind(credentials);
  const replacementHash = await original('replacement-password');
  let releaseHash!: () => void;
  credentials.hashPassword = () => new Promise<string>(resolve => { releaseHash = () => resolve(replacementHash); });
  const expectedGeneration = h.users.getAuthGeneration(h.user.userId);
  const pending = h.users.resetPassword(h.user.userId, 'replacement-password', {
    beforeCommit() {
      if (h.users.getAuthGeneration(h.user.userId) !== expectedGeneration) {
        throw new AuthError('Authority changed', 'AUTH_STATE_CHANGED', 409);
      }
    },
  });
  const shared = await h.coordinator.acquireShared();
  try {
    expect(h.coordinator.diagnostics()).toMatchObject({ activeExclusive: false, pendingExclusive: 0 });
    releaseHash();
    await waitForAdmission(h);
    h.db.prepare('INSERT INTO _auth_user_generations (user_id, generation) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET generation = generation + 1')
      .run(h.user.userId);
    shared.release();
    await expect(pending).rejects.toMatchObject({ code: 'AUTH_STATE_CHANGED' });
    expect(await h.users.verifyPassword(h.user.userId, 'test-password-123')).toBe(true);
    expect(await h.users.verifyPassword(h.user.userId, 'replacement-password')).toBe(false);
  } finally { credentials.hashPassword = original; shared.release(); releaseHash?.(); await h.close(); }
});
