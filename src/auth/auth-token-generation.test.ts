import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from './auth-schema';
import { TokenService } from './token-service';
import { UserStore } from './user-store';

let db: ReactiveDB;
let store: UserStore;
let tokens: TokenService;

beforeEach(async () => {
  db = createReactiveDB({ mode: 'memory' });
  db.exec('PRAGMA foreign_keys = ON');
  defineAuthTables(db);
  store = new UserStore(db);
  tokens = await TokenService.create({ db });
  tokens.setUserStore(store);
});

afterEach(() => db.dispose());

describe('auth token generation', () => {
  test('keeps bearer and transition tokens revoked after account reactivation', async () => {
    const user = await store.createUser({
      username: 'generation',
      email: 'generation@example.com',
      password: 'password123',
    });
    const pair = await tokens.issueTokenPair(user);
    const transition = await tokens.signTransitionToken(user, {
      purpose: 'mfa_setup',
      ttl: '10m',
    });

    expect(await tokens.resolveAuthContext(pair.accessToken)).not.toBeNull();
    expect(await tokens.verifyTransitionToken(transition, 'mfa_setup')).not.toBeNull();
    store.updateUser(user.userId, { status: 'suspended' });
    store.revokeAllUserTokens(user.userId);
    store.updateUser(user.userId, { status: 'active' });

    expect(await tokens.resolveAuthContext(pair.accessToken)).toBeNull();
    expect(await tokens.verifyTransitionToken(transition, 'mfa_setup')).toBeNull();
    const replacement = await tokens.issueTokenPair(store.getUserById(user.userId)!);
    expect(await tokens.resolveAuthContext(replacement.accessToken)).not.toBeNull();
  });
});
