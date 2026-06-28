import { SignJWT, jwtVerify, importJWK } from 'jose';
import type { JWK } from 'jose';
import type { UserStore } from './user-store';
import type {
  TokenServiceConfig,
  TokenPair,
  AccessTokenPayload,
  UserRecord,
  AuthContext,
} from './types';
import { AUTH_DEFAULTS, AuthError } from './types';

// ─── TTL Parsing ───────────────────────────────────────────────────────────

/**
 * Parse a jose-style duration string to milliseconds.
 * Supports: '15m', '1h', '7d', '30s', etc.
 */
function parseTTLtoMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's':
      return value * 1_000;
    case 'm':
      return value * 60_000;
    case 'h':
      return value * 3_600_000;
    case 'd':
      return value * 86_400_000;
    default:
      throw new Error(`Invalid TTL unit: ${match[2]}`);
  }
}

// ─── TokenService ──────────────────────────────────────────────────────────

/**
 * JWT signing, verification, keypair management, and refresh token rotation.
 *
 * Uses ECDSA P-256 (ES256) for asymmetric signing:
 * - Compact 64-byte signatures
 * - Public key verification (supports JWKS endpoint)
 * - No shared secrets
 *
 * Access tokens are stateless JWTs. Refresh tokens are opaque UUIDs
 * stored as SHA-256 hashes in the database.
 */
export class TokenService {
  private readonly accessTokenTTL: string;
  private readonly refreshTokenTTLMs: number;

  private constructor(
    private readonly privateKey: CryptoKey,
    private readonly publicKey: CryptoKey,
    private readonly publicKeyJWK: JWK,
    private readonly keyId: string,
    private userStore: UserStore | null,
    config: { accessTokenTTL?: string; refreshTokenTTL?: string }
  ) {
    this.accessTokenTTL =
      config.accessTokenTTL ??
      process.env[AUTH_DEFAULTS.accessTokenTTLEnvKey] ??
      AUTH_DEFAULTS.accessTokenTTL;

    const refreshTTL =
      config.refreshTokenTTL ??
      process.env[AUTH_DEFAULTS.refreshTokenTTLEnvKey] ??
      AUTH_DEFAULTS.refreshTokenTTL;

    this.refreshTokenTTLMs = parseTTLtoMs(refreshTTL);
  }

  /**
   * Wire up the UserStore dependency after creation.
   * Called by the auth plugin after both services are initialized.
   */
  setUserStore(store: UserStore): void {
    this.userStore = store;
  }

  // ─── Factory ─────────────────────────────────────────────────────────

  /**
   * Create a TokenService instance. Handles keypair initialization:
   * 1. Check AUTH_SIGNING_KEY env var
   * 2. Check _auth_config table in the database
   * 3. Generate a fresh ECDSA P-256 keypair and persist it
   */
  static async create(config: TokenServiceConfig): Promise<TokenService> {
    const { db } = config;

    // 1. Try env var
    const envKey = process.env[AUTH_DEFAULTS.signingKeyEnvKey];
    if (envKey) {
      return TokenService.fromEnvKey(envKey, config);
    }

    // 2. Try database
    const getConfigStmt = db.prepare(
      'SELECT value FROM _auth_config WHERE key = ?'
    );
    const stored = getConfigStmt.get('signing_key_private') as {
      value: string;
    } | null;

    if (stored) {
      const jwk = JSON.parse(stored.value) as JWK;
      const kidRow = getConfigStmt.get('signing_key_id') as {
        value: string;
      } | null;
      const kid = kidRow?.value ?? crypto.randomUUID();
      return TokenService.fromJWK(jwk, kid, config);
    }

    // 3. Generate fresh keypair
    const keyPair = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true, // extractable — needed for JWK export
      ['sign', 'verify']
    );

    const kid = crypto.randomUUID();
    const privateJWK = await crypto.subtle.exportKey(
      'jwk',
      keyPair.privateKey
    );
    const publicJWK = await crypto.subtle.exportKey(
      'jwk',
      keyPair.publicKey
    );

    // Persist for next startup
    const setConfigStmt = db.prepare(
      'INSERT OR REPLACE INTO _auth_config (key, value) VALUES (?, ?)'
    );
    setConfigStmt.run('signing_key_private', JSON.stringify(privateJWK));
    setConfigStmt.run('signing_key_id', kid);

    // Import as jose KeyLike objects
    const privateKey = await importJWK(privateJWK as JWK, 'ES256');
    const publicKey = await importJWK(publicJWK as JWK, 'ES256');

    return new TokenService(
      privateKey as CryptoKey,
      publicKey as CryptoKey,
      publicJWK as JWK,
      kid,
      null,
      config
    );
  }

  /**
   * Import keypair from env var (PEM or base64 JWK).
   */
  private static async fromEnvKey(
    envKey: string,
    config: TokenServiceConfig
  ): Promise<TokenService> {
    let jwk: JWK;

    if (envKey.startsWith('{')) {
      // Raw JWK JSON
      jwk = JSON.parse(envKey) as JWK;
    } else if (envKey.startsWith('-----BEGIN')) {
      // PEM — not supported in this implementation, use JWK
      throw new Error(
        'PEM signing keys not yet supported. Use JWK format (JSON object or base64-encoded JWK).'
      );
    } else {
      // Base64-encoded JWK
      jwk = JSON.parse(
        Buffer.from(envKey, 'base64').toString('utf-8')
      ) as JWK;
    }

    return TokenService.fromJWK(jwk, jwk.kid ?? crypto.randomUUID(), config);
  }

  /**
   * Import keypair from a JWK (private key — public key derived).
   */
  private static async fromJWK(
    jwk: JWK,
    kid: string,
    config: TokenServiceConfig
  ): Promise<TokenService> {
    const privateKey = await importJWK(jwk, 'ES256');

    // Derive public key by stripping private components
    const publicJWK: JWK = {
      kty: jwk.kty,
      crv: jwk.crv,
      x: jwk.x,
      y: jwk.y,
      kid,
      alg: 'ES256',
      use: 'sig',
    };
    const publicKey = await importJWK(publicJWK, 'ES256');

    return new TokenService(
      privateKey as CryptoKey,
      publicKey as CryptoKey,
      publicJWK,
      kid,
      null,
      config
    );
  }

  // ─── Access Token ────────────────────────────────────────────────────

  /**
   * Sign a JWT access token for the given user.
   * Stateless — carries userId, email, role as claims.
   */
  async signAccessToken(user: {
    userId: string;
    email: string;
    role: string;
  }): Promise<string> {
    return new SignJWT({
      sub: user.userId,
      email: user.email,
      role: user.role,
    })
      .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
      .setIssuedAt()
      .setExpirationTime(this.accessTokenTTL)
      .setIssuer('auth')
      .sign(this.privateKey);
  }

  /**
   * Verify an access token. Returns claims or null if invalid/expired.
   * Stateless — no database lookup. Public key check only.
   */
  async verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        algorithms: ['ES256'],
        issuer: 'auth',
      });

      return {
        sub: payload.sub!,
        email: payload.email as string,
        role: payload.role as string,
      };
    } catch {
      return null; // Expired, invalid signature, wrong algorithm, etc.
    }
  }

  /**
   * Resolve an access token into request auth context.
   *
   * Unlike `verifyAccessToken`, this checks the current user row when the
   * UserStore is wired so suspended and forced-reset accounts fail closed.
   */
  async resolveAuthContext(token: string): Promise<AuthContext | null> {
    const payload = await this.verifyAccessToken(token);
    if (!payload) return null;

    if (!this.userStore) {
      return { userId: payload.sub, email: payload.email, role: payload.role };
    }

    const user = this.userStore.getUserById(payload.sub);
    if (!user) return null;
    if (user.status === 'suspended' || user.passwordChangeRequired) return null;

    return { userId: user.userId, email: user.email, role: user.role };
  }

  // ─── Token Pair Issuance ─────────────────────────────────────────────

  /**
   * Issue a full token pair (access + refresh) for a user.
   * Stores the refresh token hash in the database.
   */
  async issueTokenPair(user: UserRecord): Promise<TokenPair> {
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }
    assertUserCanReceiveTokens(user);

    const accessToken = await this.signAccessToken(user);

    const refreshToken = crypto.randomUUID();
    const refreshHash = this.hashToken(refreshToken);
    const expiresAt = Date.now() + this.refreshTokenTTLMs;
    const tokenId = crypto.randomUUID();

    this.userStore.storeRefreshToken(tokenId, user.userId, refreshHash, expiresAt);

    return { accessToken, refreshToken };
  }

  // ─── Refresh Token Rotation ──────────────────────────────────────────

  /**
   * Rotate a refresh token:
   * 1. Hash the incoming token, look up in DB
   * 2. If revoked → replay attack → revoke ALL user tokens → null
   * 3. If expired → null
   * 4. Revoke old token
   * 5. Issue new token pair
   *
   * One-time use: each refresh token is used exactly once.
   */
  async rotateRefreshToken(rawToken: string): Promise<TokenPair | null> {
    if (!this.userStore) {
      throw new Error('TokenService: UserStore not wired');
    }

    const hash = this.hashToken(rawToken);
    const record = this.userStore.getRefreshTokenByHash(hash);

    if (!record) return null; // Unknown token

    // Replay detection — if already revoked, revoke ALL tokens for this user
    if (record.revokedAt !== null) {
      this.userStore.revokeAllUserTokens(record.userId);
      return null;
    }

    // Check expiry
    if (record.expiresAt < Date.now()) return null;

    // Revoke the used token
    this.userStore.revokeRefreshToken(record.tokenId);

    // Look up the user for the new access token claims
    const user = this.userStore.getUserById(record.userId);
    if (!user) return null; // User deleted between token issuance and refresh
    assertUserCanReceiveTokens(user);

    // Issue new pair
    return this.issueTokenPair(user);
  }

  /**
   * Revoke a refresh token by raw token string (for logout).
   * Returns true if the token was found and revoked.
   */
  revokeRefreshTokenByRaw(rawToken: string): boolean {
    if (!this.userStore) return false;

    const hash = this.hashToken(rawToken);
    const record = this.userStore.getRefreshTokenByHash(hash);
    if (!record) return false;

    this.userStore.revokeRefreshToken(record.tokenId);
    return true;
  }

  // ─── JWKS ────────────────────────────────────────────────────────────

  /**
   * Get the public key in JWK Set format for the /auth/jwks endpoint.
   * Standard OIDC-compatible format for external token verification.
   */
  getJWKS(): { keys: JWK[] } {
    return {
      keys: [
        {
          kty: this.publicKeyJWK.kty,
          crv: this.publicKeyJWK.crv,
          x: this.publicKeyJWK.x,
          y: this.publicKeyJWK.y,
          kid: this.keyId,
          alg: 'ES256',
          use: 'sig',
        },
      ],
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────

  /**
   * SHA-256 hash a token string. Returns hex-encoded hash.
   */
  private hashToken(token: string): string {
    const hasher = new Bun.CryptoHasher('sha256');
    hasher.update(token);
    return hasher.digest('hex');
  }
}

function assertUserCanReceiveTokens(user: UserRecord): void {
  if (user.status === 'suspended') {
    throw new AuthError('Account is suspended', 'ACCOUNT_SUSPENDED', 403);
  }
  if (user.passwordChangeRequired) {
    throw new AuthError('Password change required', 'PASSWORD_CHANGE_REQUIRED', 403);
  }
}
