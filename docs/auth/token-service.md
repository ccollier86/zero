# Token Service

The stable `TokenService` facade coordinates JWT signing and verification,
keypair establishment, durable browser-session families, refresh rotation, and
live request authority. Focused internal collaborators own each narrower
concern. The only external cryptography dependency is `jose`.

| Module | Responsibility |
|---|---|
| `token-service.ts` | Stable public facade, live user/native/session authority, profile fences, and collaborator composition |
| `auth-signing-keys.ts` | Atomic ES256 key establishment/import across concurrent file-backed replicas |
| `auth-token-codec.ts` | JWT/JWKS encoding, signature verification, and strict public claim projection |
| `auth-web-session-token-service.ts` | Browser refresh-family, page-cookie, rotation, replacement, and logout orchestration |

## Overview

Four credential types with distinct verification and transport boundaries:

| Token | Format | Lifetime | Storage | Verification |
|-------|--------|----------|---------|-------------|
| **Access** | JWT (ES256, issuer `auth`) | Short (default 15m) | Browser memory | Signature plus live user and durable parent-session authority |
| **Auth transition** | JWT (ES256, issuer `auth-transition`) | Short | Browser memory | Signature, purpose, and current-user checks in account/MFA flows |
| **Refresh** | Opaque UUID | Long (default 7d) | Raw value in browser `localStorage`; SHA-256 hash in `_refresh_tokens` | Stateful DB lookup, expiry, revocation, and rotation |
| **Page session** | JWT (ES256, issuer `auth-page-session`) | No later than backing refresh row | Host-only HttpOnly cookie | Signature plus live refresh row and current user; safe SSR pages only |

Access and transition JWTs are explicit credentials. Refresh tokens are random
strings whose hashes map to database rows. Page JWTs contain only `sub` and the
backing refresh-session ID (`sid`); they never expose the raw refresh token.

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
     │   ├── Set? → Import raw JSON or base64 JWK → use as signing key
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
const keys = await loadOrCreateAuthSigningKeys(config);
return new TokenService(
  keys.privateKey,
  keys.publicKey,
  keys.publicKeyJWK,
  keys.keyId,
  null, // AuthRuntime wires UserStore immediately after construction.
  config,
);
```

`TokenService` delegates key loading to `loadOrCreateAuthSigningKeys()`. Key
generation happens outside the SQLite lock. Establishment then uses the same
`ReactiveDB` transaction domain and a `BEGIN IMMEDIATE` writer transaction to
re-read the durable pair before inserting it. If two replicas start against a
new file at the same time, one persists the private JWK and `kid`; every loser
imports that exact winner instead of retaining a process-local key. The two
configuration rows commit atomically, and a partial legacy pair is repaired
without replacing the half that is already durable.

**Key persistence:** The private key is stored as a JWK in the system-plane `_auth_config` table. On restart, the same key is loaded — existing access tokens remain valid. If that database is wiped (`:memory:` mode restart), a new key is generated and all tokens are implicitly invalidated.

**Env var override:** `AUTH_SIGNING_KEY` takes precedence over the database. It
is useful when a secrets manager or orchestrator supplies the same ES256
private JWK to every replica. Zero accepts raw JWK JSON or a base64-encoded JWK;
PEM input is rejected. When the JWK omits `kid`, Zero derives the stable RFC
7638 SHA-256 public-key thumbprint, so restarts and replicas publish the same
JWKS identifier. An explicit `kid` is preserved.

**Separate from TLS:** The signing key is for JWTs. TLS keys are for transport encryption. Different purposes, independent rotation, different storage (`_auth_config` vs. file system).

## Access Token

### Signing

```ts
// Custom password-auth flows carry the exact generation proven alongside the
// password hash. Official Guardian flows already do this internally.
const proof = await userStore.verifyPasswordForAuthentication(user.userId, password);
if (!proof) throw new AuthError('Invalid credentials', 'INVALID_CREDENTIALS', 401);

const pair = await tokenService.issueTokenPair(user, {
  binding: tenancyMode === 'multi'
    ? { tenantId, membershipId }
    : undefined,
  expectedAuthGeneration: proof.authGeneration,
});
```

Credential-derived flows must pass `expectedAuthGeneration` from their exact
password or durable transition receipt. Omitting it is retained only for
compatible trusted server issuance that did not verify an earlier credential;
it must not be used to bridge an asynchronous authentication ceremony.

`signAccessToken()` is a low-level cryptographic helper used internally by the
token service; it is not a complete browser-session issuance API. New browser
access JWTs are signed only after Zero has prepared a durable `web` parent and
carry that parent's opaque ID and generation. In multi-tenant mode the binding
must either be supplied by a server-owned auth flow or resolve to exactly one
active membership. Zero does not accept a client-selected tenant header.

**Claims:**

| Claim | Source | Purpose |
|-------|--------|---------|
| `sub` | `userId` | Subject — identifies the user |
| `email` | Browser user record | Browser-token identity hint; live user data remains authoritative |
| `role` | Browser user record | Browser-token hint; live user role remains authoritative |
| `authGeneration` | User security state | Rejects tokens minted before a security transition |
| `sessionKind` | `'web'` or `'native'` | Prevents one credential family from being interpreted as another |
| `sid` | Browser parent or native refresh family | Binds access to live, revocable server state |
| `sessionGeneration` | Browser parent | Rejects browser access after a parent generation change |
| `iat` | Auto (jose) | Issued-at timestamp |
| `exp` | TTL config | Expiration — stateless enforcement |
| `iss` | `'auth'` | Issuer — identifies the auth system |
| `kid` | Header | Key ID — allows key rotation (JWKS lookup) |

**What's NOT in the token:**
- `password_hash` — obviously never
- `properties` — too variable, too large; fetch from `/auth/me` if needed
- `permissions` — derived from the live application/tenant authorization
  scope and assignment revision, not trusted from JWT claims

### Verification

```ts
const payload = await codec.verifyBrowserAccessToken(token);
// `null` means the verified JWT still failed Zero's required browser-claim
// shape; signature/expiry/issuer failures are normalized by the facade.
if (!payload) return null;
```

`AuthTokenCodec` does not cast arbitrary JWT claims into a trusted TypeScript
shape. A browser token must contain non-empty string `sub`, `email`, and `role`
claims before the facade can continue to live user/session resolution.
Transition and page credentials apply their corresponding required-claim
checks and fail closed as well.

`verifyAccessToken()` is deliberately cryptographic-only: the public key
verifies the signature and `jose` checks claims such as `exp` and `iss`.
Request middleware uses `resolveAuthContext()` instead. That method loads the
current user, checks account eligibility and `authGeneration`, then resolves
the credential's live session boundary. Browser access must resolve an active,
unexpired `_auth_sessions` row with the same user, kind, ID, and generation.
Tenant-scoped parents additionally require the tenant and membership to remain
active with the exact captured authorization generations. Native access still
uses its configured-client refresh family. Native JWTs omit email and role;
those values are hydrated from the live user.

Code that verifies a JWT offline through JWKS can validate its signature and
expiry, but cannot observe Zero's live user/session revocation state. Protected
Zero routes and Sync use live resolution rather than offline verification.

**Error handling:** Credential failures such as expiry, claim validation, an
unknown signature, or the wrong algorithm return `null`. Internal Zero
authority failures are different: `AuthError` is deliberately rethrown, so a
stale installed-profile fence or `AUTH_STATE_INVARIANT_FAILED` condition cannot
be mistaken for an ordinary anonymous request. `resolveAuthContext()` also
fails closed when no `UserStore` has been wired. Direct low-level consumers of
`TokenService.create()` must call `setUserStore()` before using live request
resolution; `createAuthPlugin()` and `createApp()` do this automatically.

### Token Anatomy

An access credential has the standard three-part form
`base64url(header).base64url(payload).base64url(signature)`. The protected
header carries `alg: ES256` and `kid`; the payload carries the identity,
security generation, and session-family binding described above. Exact length
depends on whether the credential is web- or native-scoped.

## Auth Transition Tokens

MFA setup and challenge continuations are short-lived ES256 JWTs with issuer
`auth-transition`. They are not app sessions. `signTransitionToken()` and the
official auth routes preserve the exact `authGeneration` proved by the
password, session, or preceding transition ceremony and recheck it both before
and after asynchronous signing. A generation change rejects the unfinished
ceremony with `AUTH_STATE_CHANGED` (409).

Profile MFA enrollment has an additional exact-session boundary. The route
captures an `AuthContextAuthorityReference`, passes it as `profileAuthority`,
and the token service verifies that live reference before and after signing.
Only a SHA-256 `profileAuthorityFingerprint` is placed in the JWT; the
credential-free authority reference and session details are not serialized
into the client token. Activation requires a current bearer whose recaptured
authority has the same fingerprint, then resolves that same reference again
inside the method-activation transaction. A token copied to another session
for the same user therefore cannot activate the method.

```ts
await tokenService.signTransitionToken(user, {
  purpose: 'mfa_setup',
  ttl: authConfig.mfa.challengeTTL,
  flow: 'profile',
  expectedAuthGeneration: authority.authGeneration,
  profileAuthority: authority,
});
```

The optional generation fallback remains for source compatibility with
trusted server issuance that did not authenticate an earlier credential. It
is not valid for a ceremony that crosses an asynchronous credential boundary.
Official MFA paths always supply the exact generation. Profile signing without
`profileAuthority`, or non-profile signing with one, fails as
`AUTH_STATE_INVARIANT_FAILED` because it is an internal wiring error.

## Page Session

When an auth flow produces a complete access/refresh pair, Zero signs a
dedicated page JWT and sends it only as the HttpOnly
`__zero_page_session` cookie. Its expiration matches the backing refresh row.

```ts
new SignJWT({
  sid: refreshRecord.tokenId,
  authGeneration: currentAuthGeneration,
})
  .setSubject(user.userId)
  .setIssuer('auth-page-session')
  .setExpirationTime(Math.floor(refreshRecord.expiresAt / 1000));
```

Resolution verifies the signature and issuer, loads `_refresh_tokens` by
`sid`, checks user ownership, expiry, and revocation, then follows
`_refresh_tokens.session_id` to the same durable parent used by browser access.
The parent, current user, and any tenant/membership authority are revalidated.
Current role and email come from the database, not stale cookie claims.

This JWT is intentionally rejected by access-token verification. The file
router accepts it only for actual `GET`/`HEAD` pages when no Authorization
header is present. APIs, mutations, server plugins, and WebSocket sync remain
Bearer-only. Rotation and session revocation invalidate the page JWT through
its backing refresh row; authenticated HTML is private/no-store and excluded
from ISR.

## Refresh Token

### Why opaque (not JWT)

Refresh tokens are **not JWTs**. They're random UUIDs:

| | Access Token (JWT) | Refresh Token (opaque) |
|---|-------------------|----------------------|
| **Format** | Structured, signed, readable | Random UUID, meaningless |
| **Verification** | Signature plus live parent lookup | Stateful DB lookup |
| **Revocable** | Yes (revoke the durable parent) | Yes (parent or child revocation) |
| **Rotation** | Not needed (short-lived) | Required (long-lived, must be one-time-use) |

A JWT refresh token would be stateless — but then you can't revoke it. Since refresh tokens are long-lived (7 days), revocation is critical. Making them opaque forces a DB check, which enables revocation and rotation.

### Lifecycle

```
Login / Register
       │
       ▼
  Generate: crypto.randomUUID()
       │
       ├── Create: durable parent → _auth_sessions table
       │
       ├── Store: SHA-256(token) + parent session_id → _refresh_tokens
       │          (never store the raw token in the DB; both writes are atomic)
       │
       └── Return: raw token → browser SDK
                   (SDK stores it in localStorage for client restoration;
                    the HttpOnly cookie contains a separate page JWT)
```

### Hash Storage

```ts
export function hashToken(rawToken: string): string {
  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(rawToken);
  return hasher.digest('hex');
}
```

The raw refresh token only exists:
1. In the HTTP response body (sent to client once)
2. In the browser SDK's `localStorage`
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

Rotation never creates a new parent: it revalidates the current parent and any
tenant/membership generations, consumes the old refresh child, inserts its
replacement with the same `session_id`, and extends the parent's last-seen and
expiry values in the same transaction. Ordinary rotation therefore preserves
`sid`; logout, replay, page-session replacement, and account security changes
revoke the appropriate parent sessions so already-issued access JWTs fail live
resolution immediately.

### Replay Detection

**Replay response:** If a revoked refresh token is reused, Zero bumps the
user's security generation, revokes every refresh token and durable browser
parent for that user, and returns no replacement. Both the suspected attacker
and legitimate browser must authenticate again.

## Durable Browser Session Schema and Upgrade

`_auth_sessions` is additive internal state. Each row records the opaque
`session_id`, user, `web` kind, active/revoked status, generation, application
or tenant scope, optional tenant and membership IDs plus their captured
authorization generations, local-auth provenance, timestamps, expiry, and
revocation metadata. `_refresh_tokens.session_id` is added as a nullable,
indexed foreign key so an existing database can migrate without rewriting all
refresh rows. Every refresh token issued after the upgrade has a non-null
parent link.

Compatibility is mode-specific and intentionally asymmetric:

- In `single`, a live legacy refresh row with a null link is adopted lazily and
  transactionally into its own application-scoped parent. An old page cookie
  without an `authGeneration` claim resolves through that exact live refresh
  row, adopts its current generation, and triggers the same parent adoption.
  Generation-changing security transitions revoke every such row, while an
  explicit mismatched or malformed claim still fails closed. A
  pre-upgrade access JWT without `sessionKind`/`sid` may finish only its
  already-signed access-token lifetime after process startup, provided the
  live user and `authGeneration` still match; new official issuance is always
  parent-bound.
- In `multi`, an unbound refresh/page/access credential fails closed. Zero
  cannot safely infer tenant authority from a legacy credential. The shared
  auth-completion service auto-binds exactly one live membership, returns a
  typed onboarding-required result for none, or creates a five-minute,
  hash-at-rest, single-use tenant-selection continuation for several. Consuming
  that continuation revalidates user generation, tenant, and membership and
  commits continuation consumption, parent session, and refresh child in one
  transaction.

Tenant switching is a parent-session replacement, not a claim edit. The
browser proves the current refresh family, Zero revalidates both current and
target authority, consumes the old refresh, inserts the replacement parent and
refresh child, and revokes the old `sid` transactionally. Consequently old
access, page, and refresh credentials fail live resolution. A concurrent or
replayed refresh/switch attempt invokes the existing fail-closed replay policy.

Native credentials retain their separate rotating-family persistence rather
than being children of the browser `_auth_sessions` parent. They implement the
same tenant-authority outcome through the discovery-advertised native tenant
session v1 contract: tenant list/switch uses the credential owner's raw refresh
proof, a switch atomically revokes the source family and inserts a replacement
capturing the selected membership and tenant generations, and every native
HTTP/Sync access revalidates the live family and captured authority.

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
- Standard key publication makes rotation interoperable. Zero's current
  single-key rotation invalidates old access tokens immediately; graceful
  multi-key overlap is a future enhancement described below.
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
| Security generation changes while an authentication, MFA, or session-signing ceremony is in flight | HTTP 409 `AUTH_STATE_CHANGED`; discard the stale ceremony and restart sign-in |
| Expired refresh token | `rotateRefreshToken()` → `null` → client must re-login |
| Revoked refresh token | Replay detection → revoke all user tokens → `null` → client must re-login |
| Unknown refresh token | Hash not found in DB → `null` |
| User deleted between token issuance and refresh | `getUserById()` → `null` → refresh fails |

## Configuration

```ts
interface TokenServiceConfig {
  /** Shared ReactiveDB transaction domain. */
  db: ReactiveDB;
  accessTokenTTL?: string;
  refreshTokenTTL?: string;
  nativeIssuer?: string;
  nativeAudience?: string;

  /** Durable browser-session authority; direct use defaults to single mode. */
  authSessionService?: AuthSessionService;

  /** App-local invariant telemetry boundary. */
  emitCode?: AuthPlatformCodeEmitter;
}
```

`nativeIssuer` and `nativeAudience` must be supplied together for native OIDC
access verification. Managed `createApp()` composition supplies the durable
session service and app-local emitter. Direct composition may omit them for a
single-tenant browser-only service, but it still must wire the `UserStore`
before attempting `resolveAuthContext()`.

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
