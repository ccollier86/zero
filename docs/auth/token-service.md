# Token Service

JWT signing, verification, keypair management, refresh token rotation. One external dependency: `jose`.

## Overview

Two token types, two verification strategies:

| Token | Format | Lifetime | Storage | Verification |
|-------|--------|----------|---------|-------------|
| **Access** | JWT (ES256) | Short (default 15m) | Client only | Stateless — public key check, no DB lookup |
| **Refresh** | Opaque UUID | Long (default 7d) | SHA-256 hash in `_refresh_tokens` | Stateful — DB lookup, check expiry + revocation |

Access tokens carry claims. Refresh tokens carry nothing — they're random strings whose hashes map to database rows.

## ECDSA P-256 Keypair

### Algorithm choice: ES256

| Property | ES256 (ECDSA P-256) | RS256 (RSA 2048) | HS256 (HMAC) |
|----------|---------------------|-------------------|--------------|
| **Key type** | Asymmetric | Asymmetric | Symmetric |
| **Signature size** | 64 bytes | 256 bytes | 32 bytes |
| **Signing speed** | Fast | Slow | Fastest |
| **Verification** | Public key only | Public key only | Shared secret |
| **JWKS compatible** | Yes | Yes | No |
| **External verification** | Yes — any service with the public key | Yes | No — requires sharing the secret |

ES256 is the sweet spot: asymmetric (supports JWKS, external verification), compact signatures, fast operations. No shared secrets to distribute.

### Keypair Lifecycle

```
Process start
     │
     ├── Check AUTH_SIGNING_KEY env var
     │   ├── Set? → Import as PEM or base64 JWK → use as signing key
     │   └── Not set? ▼
     │
     ├── Check _auth_config table
     │   ├── Has 'signing_key_private'? → Import JWK → use as signing key
     │   └── Empty? ▼
     │
     ├── Generate new ECDSA P-256 keypair
     │   crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
     │   │
     │   ├── Export private key as JWK → store in _auth_config
     │   ├── Generate key ID (kid) → store in _auth_config
     │   └── Derive public key from private key
     │
     └── Ready: privateKey + publicKey + kid available
```

```ts
class TokenService {
  private privateKey: CryptoKey;
  private publicKey: CryptoKey;
  private keyId: string;

  static async create(config: TokenServiceConfig): Promise<TokenService> {
    // 1. Try env var
    const envKey = process.env[AUTH.signingKeyEnvKey];
    if (envKey) {
      return TokenService.fromImportedKey(envKey, config);
    }

    // 2. Try database (_auth_config is an internal table — use raw SQL, not ReactiveDB methods)
    const getConfigStmt = config.db.prepare('SELECT value FROM _auth_config WHERE key = ?');
    const stored = getConfigStmt.get('signing_key_private') as { value: string } | null;
    if (stored) {
      const jwk = JSON.parse(stored.value);
      const kid = (getConfigStmt.get('signing_key_id') as { value: string }).value;
      return TokenService.fromJWK(jwk, kid, config);
    }

    // 3. Generate fresh keypair
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,  // extractable — needed for JWK export
      ['sign', 'verify'],
    );

    const kid = crypto.randomUUID();
    const jwk = await crypto.subtle.exportKey('jwk', privateKey);

    // Persist for next startup (_auth_config is internal — raw SQL)
    const setConfigStmt = config.db.prepare('INSERT OR REPLACE INTO _auth_config (key, value) VALUES (?, ?)');
    setConfigStmt.run('signing_key_private', JSON.stringify(jwk));
    setConfigStmt.run('signing_key_id', kid);

    return new TokenService(privateKey, publicKey, kid, config);
  }
}
```

**Key persistence:** The private key is stored as a JWK in the `_auth_config` table. On restart, the same key is loaded — existing access tokens remain valid. If the database is wiped (`:memory:` mode restart), a new key is generated and all tokens are implicitly invalidated.

**Env var override:** `AUTH_SIGNING_KEY` takes precedence over the database. Useful for deployments where the key is managed externally (secrets manager, K8s secret). Accepts PEM (`-----BEGIN...`) or base64-encoded JWK.

**Separate from TLS:** The signing key is for JWTs. TLS keys are for transport encryption. Different purposes, independent rotation, different storage (`_auth_config` vs. file system).

## Access Token

### Signing

```ts
async signAccessToken(user: { userId: string; email: string; role: string }): Promise<string> {
  const jwt = await new SignJWT({
    sub: user.userId,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'ES256', kid: this.keyId })
    .setIssuedAt()
    .setExpirationTime(this.accessTokenTTL)  // default '15m'
    .setIssuer('auth')
    .sign(this.privateKey);

  return jwt;
}
```

**Claims:**

| Claim | Source | Purpose |
|-------|--------|---------|
| `sub` | `userId` | Subject — identifies the user |
| `email` | User record | Convenience — avoids DB lookup for common field |
| `role` | User record | Authorization — middleware exposes it in `authContext` |
| `iat` | Auto (jose) | Issued-at timestamp |
| `exp` | TTL config | Expiration — stateless enforcement |
| `iss` | `'auth'` | Issuer — identifies the auth system |
| `kid` | Header | Key ID — allows key rotation (JWKS lookup) |

**What's NOT in the token:**
- `password_hash` — obviously never
- `properties` — too variable, too large; fetch from `/auth/me` if needed
- `permissions` — derived from `role` at the application level, not embedded

### Verification

```ts
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
    return null;  // Expired, invalid signature, wrong algorithm, etc.
  }
}
```

**Stateless:** No database lookup. The public key verifies the signature, `jose` checks `exp` and `iss`. If the token is valid, the claims are trusted. If it's expired or tampered, `null` is returned.

**Error handling:** Verification never throws to callers. All failure modes (`JWTExpired`, `JWTClaimValidationFailed`, `JWSSignatureVerificationFailed`) are caught and returned as `null`. The auth middleware maps `null` to `authContext: null` — routes decide what to do.

### Token Anatomy

```
eyJhbGciOiJFUzI1NiIsImtpZCI6IjU1MGUxNGYyLTRjZjQtNDYzZi05ZTY1LTJmMjIzNGE3YjRlNCJ9
.eyJzdWIiOiJ1XzEyMzQ1Njc4IiwiZW1haWwiOiJhbGljZUBleGFtcGxlLmNvbSIsInJvbGUiOiJ1c2VyIiwiaWF0IjoxNzA5NTAwMDAwLCJleHAiOjE3MDk1MDA5MDAsImlzcyI6ImF1dGgifQ
.MEUCIHlXcGLJ... (64 bytes — ES256 signature)
```

Three parts: header (alg + kid) . payload (claims) . signature. Total ~300 bytes — small enough for `Authorization` header on every request.

## Refresh Token

### Why opaque (not JWT)

Refresh tokens are **not JWTs**. They're random UUIDs:

| | Access Token (JWT) | Refresh Token (opaque) |
|---|-------------------|----------------------|
| **Format** | Structured, signed, readable | Random UUID, meaningless |
| **Verification** | Stateless (public key) | Stateful (DB lookup) |
| **Revocable** | No (valid until expiry) | Yes (set `revoked_at` in DB) |
| **Rotation** | Not needed (short-lived) | Required (long-lived, must be one-time-use) |

A JWT refresh token would be stateless — but then you can't revoke it. Since refresh tokens are long-lived (7 days), revocation is critical. Making them opaque forces a DB check, which enables revocation and rotation.

### Lifecycle

```
Login / Register
       │
       ▼
  Generate: crypto.randomUUID()
       │
       ├── Store: SHA-256(token) → _refresh_tokens table
       │          (never store the raw token in the DB)
       │
       └── Return: raw token → client
                   (client stores in httpOnly cookie or secure storage)
```

### Hash Storage

```ts
private hashToken(token: string): string {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = new Bun.CryptoHasher('sha256').update(data).digest();
  return Buffer.from(hashBuffer).toString('hex');
}
```

The raw refresh token only exists:
1. In the HTTP response body (sent to client once)
2. In the client's storage (httpOnly cookie or secure local storage)
3. In the incoming HTTP request body (when the client uses it)

The database stores only `SHA-256(token)`. If the database is breached, the attacker has hashes — not usable tokens.

### Token Rotation

On every refresh, the old token is revoked and a new pair is issued:

```
Client                          TokenService                    _refresh_tokens
  │                                  │                                │
  │  refreshToken: "abc-def-..."     │                                │
  │ ────────────────────────────────►│                                │
  │                                  │  SHA-256("abc-def-...")        │
  │                                  │  = "7f83b1..."                 │
  │                                  │                                │
  │                                  │  SELECT * WHERE token_hash =   │
  │                                  │  '7f83b1...'                   │
  │                                  │ ──────────────────────────────►│
  │                                  │                                │
  │                                  │  Found: {                      │
  │                                  │    token_id, user_id,          │
  │                                  │    expires_at > now,           │
  │                                  │    revoked_at IS NULL          │
  │                                  │  }                             │
  │                                  │ ◄──────────────────────────────│
  │                                  │                                │
  │                                  │  ── Revoke old ──              │
  │                                  │  UPDATE SET revoked_at = now   │
  │                                  │  WHERE token_id = old_id       │
  │                                  │ ──────────────────────────────►│
  │                                  │                                │
  │                                  │  ── Issue new ──               │
  │                                  │  new_refresh = randomUUID()    │
  │                                  │  INSERT(new_id, user_id,       │
  │                                  │    SHA-256(new_refresh),       │
  │                                  │    new_expires_at)             │
  │                                  │ ──────────────────────────────►│
  │                                  │                                │
  │                                  │  new_access = signJWT(user)    │
  │                                  │                                │
  │  { accessToken, refreshToken }   │                                │
  │ ◄────────────────────────────────│                                │
  │   (both new)                     │                                │
```

**One-time use:** Every refresh token is used exactly once. After use, it's revoked. The client receives a new refresh token and must use that for the next refresh. If a revoked token is used again (token replay), all tokens for that user are revoked — indicating possible token theft.

### Replay Detection

```ts
async rotateRefreshToken(rawToken: string): Promise<TokenPair | null> {
  const hash = this.hashToken(rawToken);
  const record = this.userStore.getRefreshTokenByHash(hash);

  if (!record) return null;  // Unknown token

  // Check if already revoked — possible replay attack
  if (record.revokedAt !== null) {
    // Revoke ALL tokens for this user (family rotation)
    this.userStore.revokeAllUserTokens(record.userId);
    return null;
  }

  // Check expiry
  if (record.expiresAt < Date.now()) return null;

  // Revoke the used token
  this.userStore.revokeRefreshToken(record.tokenId);

  // Issue new pair
  const user = this.userStore.getUserById(record.userId);
  if (!user) return null;

  const accessToken = await this.signAccessToken(user);
  const newRefreshToken = crypto.randomUUID();
  const newHash = this.hashToken(newRefreshToken);
  const newExpiresAt = Date.now() + this.refreshTokenTTLMs;

  this.userStore.storeRefreshToken(crypto.randomUUID(), user.userId, newHash, newExpiresAt);

  return { accessToken, refreshToken: newRefreshToken };
}
```

**Family rotation:** If a revoked token is reused, the entire token family (all tokens for that user) is revoked. This handles the scenario where an attacker steals a refresh token — one of them (attacker or legitimate user) will present the revoked token first, triggering a full revocation. Both must re-authenticate.

## JWKS Endpoint

`GET /auth/jwks` — returns the public key in standard JWK Set format:

```ts
getJWKS(): { keys: JWK[] } {
  return {
    keys: [{
      kty: 'EC',
      crv: 'P-256',
      x: this.publicKeyJWK.x,
      y: this.publicKeyJWK.y,
      kid: this.keyId,
      alg: 'ES256',
      use: 'sig',
    }],
  };
}
```

**Response:**

```json
{
  "keys": [{
    "kty": "EC",
    "crv": "P-256",
    "x": "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
    "y": "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
    "kid": "550e14f2-4cf4-463f-9e65-2f2234a7b4e4",
    "alg": "ES256",
    "use": "sig"
  }]
}
```

**Why JWKS:**
- Standard OIDC-compatible format
- External services can verify tokens without shared secrets
- Key rotation: update the key, publish new JWKS, old tokens expire naturally
- Public endpoint — no auth required, cacheable

**Use case:** An external microservice validates the auth system's JWTs by fetching the JWKS endpoint once, caching the public key, and verifying signatures locally. No network call per request after the initial fetch.

## Token Flow Summary

### Happy Path

```
                 ┌─────────────────────────────────────────────────────┐
                 │                     Token Lifecycle                  │
                 │                                                      │
  Login ────────►│  Access Token (15m)          Refresh Token (7d)     │
                 │  ┌───────────┐               ┌─────────────┐        │
                 │  │  Signed   │               │  UUID hash  │        │
                 │  │  JWT      │               │  in DB      │        │
                 │  └─────┬─────┘               └──────┬──────┘        │
                 │        │                            │               │
                 │        │  ◄── Use for API calls ──► │               │
                 │        │      (Authorization hdr)   │               │
                 │        │                            │               │
                 │        │  Token expires (15m)       │               │
                 │        │                            │               │
                 │        │  POST /auth/refresh ──────►│               │
                 │        │   with refresh token       │               │
                 │        │                            │               │
                 │        │  ◄─── New access + ────────│               │
                 │        │       new refresh          │ old revoked   │
                 │        │                            │               │
                 │        │  ... repeat until ...      │               │
                 │        │                            │               │
                 │        │  Refresh expires (7d) or   │               │
                 │        │  POST /auth/logout ────────│ revoke        │
                 │        │                            │               │
                 │  Re-login required                                   │
                 └─────────────────────────────────────────────────────┘
```

### Error Cases

| Scenario | Behavior |
|----------|----------|
| Expired access token | `verifyAccessToken()` → `null` → middleware sets `authContext: null` → route returns 401 |
| Tampered access token | Signature check fails → `null` → same as expired |
| Wrong algorithm | `jose` rejects non-ES256 → `null` |
| Expired refresh token | `rotateRefreshToken()` → `null` → client must re-login |
| Revoked refresh token | Replay detection → revoke all user tokens → `null` → client must re-login |
| Unknown refresh token | Hash not found in DB → `null` |
| User deleted between token issuance and refresh | `getUserById()` → `null` → refresh fails |

## Configuration

```ts
interface TokenServiceConfig {
  /** Shared ReactiveDB — token service uses prepared statements on _auth_config and _refresh_tokens directly */
  db: ReactiveDB;

  /** Access token TTL in jose duration format (default: '15m') */
  accessTokenTTL?: string;

  /** Refresh token TTL in jose duration format (default: '7d') */
  refreshTokenTTL?: string;
}
```

**TTL defaults:**
- Access: `15m` — short enough to limit exposure, long enough to avoid constant refreshes
- Refresh: `7d` — user stays logged in for a week without re-entering credentials

Both configurable via env vars (`ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`). The auth plugin reads these and passes them through.

## Security Considerations

### Key Storage

| Storage | When | Risk | Mitigation |
|---------|------|------|------------|
| `_auth_config` table | Default (auto-generated) | DB access → key access | DB is in-process (`:memory:` or local file), not network-accessible |
| `AUTH_SIGNING_KEY` env var | Production/managed deployments | Env var leakage | Use secrets manager, limit env access |

For `:memory:` mode, the key is ephemeral — process restart generates a new key, invalidating all tokens. For file mode, the key persists across restarts — existing tokens remain valid.

### Key Rotation

Key rotation is manual and deliberate:

1. Generate new keypair (or set new `AUTH_SIGNING_KEY`)
2. Restart the process
3. Old access tokens fail verification (signed with old key) — clients refresh
4. Refresh tokens still work (they're opaque, verified by DB hash — not by signing key)
5. New access tokens signed with new key

**Graceful rotation** (future enhancement): maintain a list of old public keys in JWKS. Accept tokens signed by any known key. Gradually phase out old keys after `max_access_token_ttl` has passed.

### Token Theft Mitigation

| Threat | Mitigation |
|--------|-----------|
| Access token stolen | Short TTL (15m default) — limited exposure window |
| Refresh token stolen | Rotation — used token is revoked. Replay detection revokes all user tokens |
| Both stolen | Attacker has 15m of access + one refresh. After token rotation, legitimate user's next refresh triggers replay detection → full revocation |
| Database breach | Refresh tokens stored as SHA-256 hashes — not usable. Access tokens are JWTs — attacker needs the private key (separate from token storage) |

### Timing Attacks

`Bun.password.verify()` uses constant-time comparison internally (Argon2id implementation). JWT signature verification via `jose` also uses constant-time comparison. No timing oracle on login or token verification.
