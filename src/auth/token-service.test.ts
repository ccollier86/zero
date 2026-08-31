import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { calculateJwkThumbprint } from 'jose';
import { createReactiveDB, ReactiveDB } from '../sync/reactive-db';
import { UserStore } from './user-store';
import { TokenService } from './token-service';
import { AUTH_DEFAULTS, AuthError, type UserRecord } from './types';

// ─── Test Setup ───────────────────────────────────────────────────────────

let db: ReactiveDB;
let store: UserStore;
let tokenService: TokenService;

function setupAuthTables(db: ReactiveDB): void {
  db.exec('PRAGMA foreign_keys = ON');

  db.defineTable('users', {
    user_id: 'text primary key',
    username: 'text unique not null',
    email: 'text unique not null',
    first_name: 'text',
    last_name: 'text',
    role: "text not null default 'user'",
    status: "text not null default 'active'",
    password_change_required: 'integer not null default 0',
    email_verified_at: 'integer',
    email_verification_required: 'integer not null default 0',
    mfa_required: 'integer not null default 0',
    created_at: 'integer not null',
    updated_at: 'integer',
  });

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_properties (
      user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT,
      PRIMARY KEY (user_id, key),
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _credentials (
      user_id TEXT PRIMARY KEY, password_hash TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS _refresh_tokens (
      token_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, revoked_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_action_tokens (
      token_id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      type TEXT NOT NULL, token_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL, consumed_at INTEGER,
      created_at INTEGER NOT NULL, created_by TEXT, metadata TEXT,
      FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auth_action_tokens_hash ON _auth_action_tokens(token_hash)'
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS _auth_config (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    )
  `);
}

beforeEach(async () => {
  db = createReactiveDB({ mode: 'memory' });
  setupAuthTables(db);
  store = new UserStore(db);
  tokenService = await TokenService.create({ db });
  tokenService.setUserStore(store);
});

afterEach(() => {
  db.dispose();
});

// ─── Keypair Management ───────────────────────────────────────────────────

describe('TokenService — Keypair', () => {
  test('create generates an ECDSA P-256 keypair', async () => {
    // The tokenService was created in beforeEach — it should work
    const jwks = tokenService.getJWKS();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0].kty).toBe('EC');
    expect(jwks.keys[0].crv).toBe('P-256');
    expect(jwks.keys[0].alg).toBe('ES256');
    expect(jwks.keys[0].use).toBe('sig');
    expect(jwks.keys[0].kid).toBeDefined();
  });

  test('create persists keypair in _auth_config', async () => {
    // The keypair should be stored in the DB
    const storedKey = store.getConfig('signing_key_private');
    expect(storedKey).not.toBeNull();

    const jwk = JSON.parse(storedKey!);
    expect(jwk.kty).toBe('EC');
    expect(jwk.crv).toBe('P-256');
    // Private key should have 'd' component
    expect(jwk.d).toBeDefined();
  });

  test('create reuses keypair from _auth_config on subsequent calls', async () => {
    const jwks1 = tokenService.getJWKS();

    // Create another service from the same DB — should load same key
    const tokenService2 = await TokenService.create({ db });
    const jwks2 = tokenService2.getJWKS();

    expect(jwks1.keys[0].x).toBe(jwks2.keys[0].x);
    expect(jwks1.keys[0].y).toBe(jwks2.keys[0].y);
    expect(jwks1.keys[0].kid).toBe(jwks2.keys[0].kid);
    expect(jwks2.keys[0].kid).toBe(
      store.getConfig('signing_key_id') ?? undefined
    );
  });

  test('env JWK without kid derives one stable across replicas', async () => {
    const privateJwk = JSON.parse(store.getConfig('signing_key_private')!);
    delete privateJwk.kid;
    const expectedKid = await calculateJwkThumbprint(privateJwk, 'sha256');
    const envKey = AUTH_DEFAULTS.signingKeyEnvKey;
    const previous = process.env[envKey];
    const replicaDb = createReactiveDB({ mode: 'memory' });
    setupAuthTables(replicaDb);

    try {
      process.env[envKey] = JSON.stringify(privateJwk);
      const first = await TokenService.create({ db });
      const second = await TokenService.create({ db: replicaDb });

      expect(first.getJWKS().keys[0].kid).toBe(expectedKid);
      expect(second.getJWKS().keys[0].kid).toBe(expectedKid);
    } finally {
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
      replicaDb.dispose();
    }
  });

  test('env JWK preserves an explicit kid', async () => {
    const privateJwk = JSON.parse(store.getConfig('signing_key_private')!);
    privateJwk.kid = 'managed-signing-key-v7';
    const envKey = AUTH_DEFAULTS.signingKeyEnvKey;
    const previous = process.env[envKey];

    try {
      process.env[envKey] = Buffer.from(JSON.stringify(privateJwk)).toString('base64');
      const service = await TokenService.create({ db });
      expect(service.getJWKS().keys[0].kid).toBe('managed-signing-key-v7');
    } finally {
      if (previous === undefined) delete process.env[envKey];
      else process.env[envKey] = previous;
    }
  });

  test('JWKS does not include private key components', () => {
    const jwks = tokenService.getJWKS();
    const key = jwks.keys[0] as Record<string, unknown>;
    expect(key.d).toBeUndefined(); // Private component must not be exposed
  });
});

// ─── Access Tokens ────────────────────────────────────────────────────────

describe('TokenService — Access Tokens', () => {
  test('signAccessToken produces a valid JWT', async () => {
    const token = await tokenService.signAccessToken({
      userId: 'u_123',
      email: 'test@example.com',
      role: 'user',
    });

    expect(typeof token).toBe('string');
    // JWT format: header.payload.signature
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
  });

  test('verifyAccessToken returns claims for a valid token', async () => {
    const token = await tokenService.signAccessToken({
      userId: 'u_123',
      email: 'test@example.com',
      role: 'admin',
    });

    const payload = await tokenService.verifyAccessToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe('u_123');
    expect(payload!.email).toBe('test@example.com');
    expect(payload!.role).toBe('admin');
  });

  test('verifyAccessToken returns null for tampered token', async () => {
    const token = await tokenService.signAccessToken({
      userId: 'u_123',
      email: 'test@example.com',
      role: 'user',
    });

    // Tamper with signature
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(await tokenService.verifyAccessToken(tampered)).toBeNull();
  });

  test('verifyAccessToken returns null for garbage input', async () => {
    expect(await tokenService.verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await tokenService.verifyAccessToken('')).toBeNull();
  });

  test('verifyAccessToken returns null for token signed with different key', async () => {
    // Create a second token service with a fresh DB (different keypair)
    const db2 = createReactiveDB({ mode: 'memory' });
    setupAuthTables(db2);
    const ts2 = await TokenService.create({ db: db2 });

    const token = await ts2.signAccessToken({
      userId: 'u_123',
      email: 'test@example.com',
      role: 'user',
    });

    // Verify with original tokenService — different key
    expect(await tokenService.verifyAccessToken(token)).toBeNull();

    db2.dispose();
  });
});

// ─── Token Pair Issuance ──────────────────────────────────────────────────

describe('TokenService — Token Pair', () => {
  let user: UserRecord;

  beforeEach(async () => {
    user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });
  });

  test('issueTokenPair returns access + refresh tokens', async () => {
    const pair = await tokenService.issueTokenPair(user);

    expect(pair.accessToken).toBeDefined();
    expect(pair.refreshToken).toBeDefined();
    expect(typeof pair.accessToken).toBe('string');
    expect(typeof pair.refreshToken).toBe('string');

    // Access token should be verifiable
    const payload = await tokenService.verifyAccessToken(pair.accessToken);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe(user.userId);
    expect(payload!.email).toBe('alice@example.com');
  });

  test('issueTokenPair stores refresh token hash in DB', async () => {
    const pair = await tokenService.issueTokenPair(user);

    // Hash the refresh token and look it up
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(pair.refreshToken);
    const hash = hasher.digest('hex');

    const record = store.getRefreshTokenByHash(hash);
    expect(record).not.toBeNull();
    expect(record!.userId).toBe(user.userId);
    expect(record!.revokedAt).toBeNull();
  });

  test('revocation during signing cannot leave an issued browser session', async () => {
    const signAccessToken = tokenService.signAccessToken.bind(tokenService);
    let releaseSigner: (() => void) | undefined;
    let signingFinished: (() => void) | undefined;
    let candidateAccessToken: string | undefined;
    const signed = new Promise<void>((resolve) => { signingFinished = resolve; });
    const resume = new Promise<void>((resolve) => { releaseSigner = resolve; });
    tokenService.signAccessToken = async (subject, generation) => {
      candidateAccessToken = await signAccessToken(subject, generation);
      signingFinished!();
      await resume;
      return candidateAccessToken;
    };

    try {
      const issuance = tokenService.issueTokenPair(user);
      await signed;
      store.revokeAllUserTokens(user.userId);
      releaseSigner!();

      await expect(issuance).rejects.toMatchObject({
        name: 'AuthError',
        code: 'AUTH_STATE_CHANGED',
        status: 409,
      } satisfies Partial<AuthError>);
    } finally {
      releaseSigner?.();
      tokenService.signAccessToken = signAccessToken;
    }

    expect(candidateAccessToken).toBeDefined();
    await expect(tokenService.resolveAuthContext(candidateAccessToken!)).resolves.toBeNull();
    const sessions = db.prepare(
      'SELECT COUNT(*) AS count FROM _refresh_tokens WHERE user_id = ?'
    ).get(user.userId) as { count: number };
    expect(sessions.count).toBe(0);
  });

  test('issueTokenPair throws if UserStore not wired', async () => {
    const unwired = await TokenService.create({ db });
    // Don't call setUserStore

    try {
      await unwired.issueTokenPair(user);
      expect(true).toBe(false);
    } catch (err) {
      expect((err as Error).message).toContain('UserStore not wired');
    }
  });
});

// ─── Refresh Token Rotation ───────────────────────────────────────────────

describe('TokenService — Refresh Rotation', () => {
  let user: UserRecord;

  beforeEach(async () => {
    user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });
  });

  test('rotateRefreshToken returns new token pair', async () => {
    const original = await tokenService.issueTokenPair(user);
    const rotated = await tokenService.rotateRefreshToken(
      original.refreshToken
    );

    expect(rotated).not.toBeNull();
    expect(rotated!.accessToken).toBeDefined();
    expect(rotated!.refreshToken).toBeDefined();
    // New refresh token should be different
    expect(rotated!.refreshToken).not.toBe(original.refreshToken);
  });

  test('rotateRefreshToken revokes the old token', async () => {
    const original = await tokenService.issueTokenPair(user);

    // Hash the original token
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(original.refreshToken);
    const oldHash = hasher.digest('hex');

    await tokenService.rotateRefreshToken(original.refreshToken);

    // Old token should be revoked
    const record = store.getRefreshTokenByHash(oldHash);
    expect(record).not.toBeNull();
    expect(record!.revokedAt).not.toBeNull();
  });

  test('rotateRefreshToken returns null for unknown token', async () => {
    const result = await tokenService.rotateRefreshToken('nonexistent-token');
    expect(result).toBeNull();
  });

  test('replay detection — reusing revoked token revokes ALL user tokens', async () => {
    const pair1 = await tokenService.issueTokenPair(user);
    const pair2 = await tokenService.rotateRefreshToken(pair1.refreshToken);
    expect(pair2).not.toBeNull();

    // Try to reuse pair1's refresh token (already revoked) → replay attack
    const replayResult = await tokenService.rotateRefreshToken(
      pair1.refreshToken
    );
    expect(replayResult).toBeNull();

    // pair2's refresh token should now also be revoked (all tokens nuked)
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(pair2!.refreshToken);
    const pair2Hash = hasher.digest('hex');
    const pair2Record = store.getRefreshTokenByHash(pair2Hash);
    expect(pair2Record).not.toBeNull();
    expect(pair2Record!.revokedAt).not.toBeNull();
  });

  test('concurrent replay leaves no usable replacement or current-generation token', async () => {
    const original = await tokenService.issueTokenPair(user);
    const signAccessToken = tokenService.signAccessToken.bind(tokenService);
    let releaseFirst: (() => void) | undefined;
    let firstSigned: (() => void) | undefined;
    const firstSignerPaused = new Promise<void>((resolve) => { firstSigned = resolve; });
    const resumeFirstSigner = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    tokenService.signAccessToken = async (subject, generation) => {
      const token = await signAccessToken(subject, generation);
      calls += 1;
      if (calls === 1) {
        firstSigned!();
        await resumeFirstSigner;
      }
      return token;
    };

    let first: Awaited<ReturnType<TokenService['rotateRefreshToken']>> = null;
    let second: Awaited<ReturnType<TokenService['rotateRefreshToken']>> = null;
    try {
      const firstRotation = tokenService.rotateRefreshToken(original.refreshToken);
      await firstSignerPaused;
      second = await tokenService.rotateRefreshToken(original.refreshToken);
      releaseFirst!();
      first = await firstRotation;
    } finally {
      releaseFirst?.();
      tokenService.signAccessToken = signAccessToken;
    }

    const issued = [first, second].filter((pair) => pair !== null);
    expect(issued).toHaveLength(1);
    const survivor = issued[0]!;
    const survivorHasher = new Bun.CryptoHasher('sha256');
    survivorHasher.update(survivor.refreshToken);
    const survivorRecord = store.getRefreshTokenByHash(
      survivorHasher.digest('hex')
    );
    expect(survivorRecord?.revokedAt).not.toBeNull();
    await expect(tokenService.resolveAuthContext(survivor.accessToken)).resolves.toBeNull();
    await expect(tokenService.issuePageSessionToken(survivor.refreshToken)).resolves.toBeNull();
    await expect(tokenService.rotateRefreshToken(survivor.refreshToken)).resolves.toBeNull();
  });

  test('replay while password-gated does not invalidate the recovery generation', async () => {
    const pair = await tokenService.issueTokenPair(user);
    expect(store.requirePasswordChange(user.userId)).toBe(true);
    const recoveryGeneration = store.getAuthGeneration(user.userId);

    const replayResult = await tokenService.rotateRefreshToken(pair.refreshToken);

    expect(replayResult).toBeNull();
    expect(store.getAuthGeneration(user.userId)).toBe(recoveryGeneration);
  });

  test('rotateRefreshToken returns null for expired token', async () => {
    // Issue a token pair, then manually expire it
    const pair = await tokenService.issueTokenPair(user);

    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(pair.refreshToken);
    const hash = hasher.digest('hex');

    // Manually set expiry to the past
    db.exec(
      `UPDATE _refresh_tokens SET expires_at = ${Date.now() - 1000} WHERE token_hash = '${hash}'`
    );

    const result = await tokenService.rotateRefreshToken(pair.refreshToken);
    expect(result).toBeNull();
  });
});

// ─── Revocation ───────────────────────────────────────────────────────────

describe('TokenService — Revocation', () => {
  let user: UserRecord;

  beforeEach(async () => {
    user = await store.createUser({
      username: 'alice',
      email: 'alice@example.com',
      password: 'password123',
    });
  });

  test('revokeRefreshTokenByRaw revokes a token by raw string', async () => {
    const pair = await tokenService.issueTokenPair(user);
    const revoked = tokenService.revokeRefreshTokenByRaw(pair.refreshToken);
    expect(revoked).toBe(true);

    // Token should now be revoked — rotation should fail (replay detection)
    const result = await tokenService.rotateRefreshToken(pair.refreshToken);
    expect(result).toBeNull();
  });

  test('revokeRefreshTokenByRaw returns false for unknown token', () => {
    expect(tokenService.revokeRefreshTokenByRaw('unknown')).toBe(false);
  });
});

// ─── JWKS ─────────────────────────────────────────────────────────────────

describe('TokenService — JWKS', () => {
  test('getJWKS returns valid JWK Set', () => {
    const jwks = tokenService.getJWKS();
    expect(jwks.keys).toBeArray();
    expect(jwks.keys).toHaveLength(1);

    const key = jwks.keys[0];
    expect(key.kty).toBe('EC');
    expect(key.crv).toBe('P-256');
    expect(key.x).toBeDefined();
    expect(key.y).toBeDefined();
    expect(key.kid).toBeDefined();
    expect(key.alg).toBe('ES256');
    expect(key.use).toBe('sig');
  });
});
