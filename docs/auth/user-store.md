# User Store

`UserStore` is the stable application-facing facade for SQLite-backed auth
identity. It coordinates focused internal stores for user rows, properties,
auth config, password credentials, refresh/legacy action tokens, and
provisional registration receipts. This extraction is an
implementation boundary, not an application API change: existing
`UserStore` methods remain the supported facade.

Every store prepares its own statements once during construction and reuses
them per call, matching the ReactiveDB/persistence statement-reuse pattern.

## Core SQLite Schema

These excerpts cover the identity, credential, refresh, and configuration
tables exposed through the `UserStore` facade and `TokenService`. Focused auth
services define additional private session, MFA, tenancy, onboarding,
authorization, and audit tables in their corresponding schema modules.

### Auth/Core Tables

```sql
-- Core identity record — private from generic createApp Sync
CREATE TABLE IF NOT EXISTS users (
  user_id    TEXT PRIMARY KEY,
  username   TEXT UNIQUE NOT NULL,
  email      TEXT UNIQUE NOT NULL,
  email_generation INTEGER NOT NULL DEFAULT 1,
  first_name TEXT,
  last_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'user',
  status     TEXT NOT NULL DEFAULT 'active',
  password_change_required INTEGER NOT NULL DEFAULT 0,
  email_verified_at INTEGER,
  email_verification_required INTEGER NOT NULL DEFAULT 0,
  mfa_required INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Extensible user-owned/admin-managed metadata projection per user
CREATE TABLE IF NOT EXISTS user_properties (
  user_id  TEXT NOT NULL,
  key      TEXT NOT NULL,
  value    TEXT,
  PRIMARY KEY (user_id, key),
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);
```

### Internal Tables (`_` prefix — never client-readable or subscribable)

```sql
-- Password hashes — isolated from user projections
CREATE TABLE IF NOT EXISTS _credentials (
  user_id       TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Refresh tokens — hashed, revocable
CREATE TABLE IF NOT EXISTS _refresh_tokens (
  token_id    TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  session_id  TEXT,
  token_hash  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  revoked_at  INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES _auth_sessions(session_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON _refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON _refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_session ON _refresh_tokens(session_id);

-- Legacy one-time setup/reset tokens — retained for old outstanding links.
-- New auth reset/setup links use _zero_action_tokens via PlatformTokenService.
CREATE TABLE IF NOT EXISTS _auth_action_tokens (...);

-- Signing keypair + auth configuration
CREATE TABLE IF NOT EXISTS _auth_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### Schema Design Decisions

**Why `user_id TEXT` not `INTEGER`:** Consistent with the rest of the codebase — session IDs, document IDs, and all primary keys in the sync engine use text UUIDs. Generated via `crypto.randomUUID()`.

**Why separate `_credentials`:** Credentials need a structural server-only
boundary in addition to transport policy. Keeping `password_hash` in an
internal (`_` prefix) table means no user projection or future policy mistake
can include it. Default `createApp()` policy also withholds the `users` table
itself from generic Sync because email, profile, status, and role data are not
globally public.

**Why `user_properties` KV:** Avoids schema migrations when adding safe user
metadata such as notification preferences, theme, timezone, and display
preferences. Arbitrary or user-editable rows are not trusted for authorization;
only keys present in the live property registry, marked `useInPolicies`, and
not user-editable may feed policy decisions. Because the table uses a composite
primary key, current writes use prepared statements directly and do not emit
ReactiveDB change events.

**Why `_refresh_tokens` stores hashes:** Same principle as passwords — if the database is compromised, raw tokens are not exposed. `SHA-256(token)` is stored; the raw token exists only on the client side.

**Why action token tables store hashes:** Setup/reset links and app action
links are bearer credentials. Zero generates opaque random tokens, stores only
`SHA-256(token)`, and consumes the action token once the action succeeds. New
auth links are stored in `_zero_action_tokens`; `_auth_action_tokens` remains a
legacy compatibility table for previously issued auth links.

## Prepared Statements

Statement ownership follows the data responsibility rather than accumulating
inside one class:

| Store | Statement/data responsibility |
| --- | --- |
| `UserStore` | Stable public methods, transaction/profile fences, creation/deletion ordering, bootstrap, audit, and collaborator orchestration |
| `UserIdentityStore` | `users` identity CRUD, canonical lookup, list/count, email generation/mailbox proof, and row projection |
| `UserPropertyConfigStore` | Composite-key `user_properties` and internal `_auth_config` KV |
| `UserCredentialStore` | `_credentials`, password hash compare-and-swap, password gates, session revocation, and password audit coupling |
| `UserTokenStore` | `_refresh_tokens`, legacy `_auth_action_tokens`, rotation/replay handling, revocation, and cleanup |
| `RegistrationProvisioningStore` | `_auth_registration_provisioning` receipts, leases, finalization, crash recovery, and exact compensation |
| `AuthGenerationStore` | Per-user security generations used to invalidate stale credentials |
| `PlatformTokenStore` | Generic `_zero_action_tokens` and `_zero_resume_tokens`; this lives under `src/tokens`, not in `UserStore` |

The focused stores are internal collaborators and are not exported as a second
application API. Callers continue using
`UserStore.createUser()`, `verifyPassword()`, `resetPassword()`, refresh-token
methods, and legacy action-token methods instead of reaching into those stores.

**Why two paths:**
- Private `users` table writes go through `db.insert()` / `db.update()` /
  `db.delete()` so ReactiveDB provides consistent change tracking. Default
  platform policy denies generic client delivery of those events.
- `user_properties` writes use prepared statements because the table has a
  composite primary key. Arbitrary or user-editable keys are not trusted; only
  live-registry keys marked `useInPolicies` and not user-editable may feed
  policy. These writes do not currently emit ReactiveDB change events.
- Internal tables (`_credentials`, `_refresh_tokens`, `_auth_action_tokens`,
  `_auth_config`, and registration receipts) use prepared statements directly
  inside the shared ReactiveDB transaction domain and have no client Sync
  surface.

**Transaction callback contract:** Authority and lifecycle callbacks invoked
inside a `UserStore` transaction are synchronous-only. If one returns a
Promise or other thenable, Zero consumes any later rejection, throws
`AUTH_STATE_INVARIANT_FAILED`, and rolls back the enclosing transaction rather
than letting work escape the commit boundary.

## Operations

When the user domain is already obvious from context, app-owned backend code
can use the Phase 4 aliases:

| Canonical | Explicit compatibility method |
| --- | --- |
| `create(params)` | `createUser(params)` |
| `get(userId)` | `getUserById(userId)` |
| `list(options?)` | `listUsers(options?)` |
| `update(userId, partial)` | `updateUser(userId, partial)` |
| `delete(userId)` | `deleteUser(userId)` |

### createUser

```ts
async createUser(params: {
  username: string;
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  status?: 'active' | 'suspended';
  passwordChangeRequired?: boolean;
  emailVerifiedAt?: number | null;
  emailVerificationRequired?: boolean;
  mfaRequired?: boolean;
  properties?: Record<string, string>;
}): Promise<UserRecord>
```

**Steps:**
1. Generate `userId` via `crypto.randomUUID()` (prefixed: `u_${uuid}`)
2. Hash password: `await Bun.password.hash(params.password)` (Argon2id, automatic)
3. Wrap in `db.transaction()`:
   - `db.insert('users', { user_id, username, email, first_name, last_name, role, created_at })` — emits a server-side change; client delivery remains policy-controlled
   - lifecycle fields default to `status = 'active'` and `password_change_required = 0` unless provided
   - ask `UserCredentialStore` to insert the hash into `_credentials` — internal, no broadcast
   - configured initial properties are inserted into `user_properties` when provided
4. Return `UserRecord` (no password_hash)

**Transaction ensures atomicity** — if credential insert fails, the user row
is rolled back. Nested collaborator operations reuse the same ReactiveDB
transaction. The `users` change event is deferred until commit (see
[ReactiveDB transactions](../realtime-sync/realtime-sync/reactive-db.md#transactions)).

`createUser()` remains a compatible trusted provisioning primitive after an
installation has completed, and remains the single-mode bootstrap primitive.
It deliberately cannot elect the first user in `multi` mode: while multi-mode
bootstrap is open it fails with
`409 MULTI_TENANT_BOOTSTRAP_ORGANIZATION_REQUIRED`. Use the public registration
path that creates the protected Administration Organization and owner
membership in the same transaction. Invitation-bound account creation rejects
installation bootstrap, and verified-domain admission does not replace the
installation bootstrap flow. This prevents programmatic callers from closing
bootstrap with a tenantless administrator.

### getUserById / getUserByUsername / getUserByEmail

```ts
getUserById(userId: string): UserRecord | null
getUserByUsername(username: string): UserRecord | null
getUserByEmail(email: string): UserRecord | null
```

Pure reads — no change emission. Returns the user row joined with properties:

```ts
getUserById(userId: string): UserRecord | null {
  const row = this.stmts.getUserById.get(userId);
  if (!row) return null;

  const props = this.stmts.getProperties.all(userId);
  return {
    ...row,
    properties: Object.fromEntries(props.map(p => [p.key, p.value])),
  } as UserRecord;
}
```

### listUsers / countUsers / countUsersByRole

```ts
listUsers(): UserRecord[]
countUsers(): number
countUsersByRole(role: string): number
```

`listUsers()` returns newest users first with joined properties. Count helpers
are used by first-user bootstrap and last-admin safety checks.

### Registration and administrator provisioning receipts

`createRegistrationUser(..., { provisional: true })` serializes bootstrap
election and commits the new identity with an exact
`_auth_registration_provisioning` receipt. An optional newly created tenant is
bound to that receipt in the same transaction. In single/advanced mode the
bootstrap application-owner assignment records the receipt ID as its source;
in multi mode the receipt binds the exact tenant and owner identity, including
the advanced assignment when advanced authorization is enabled.

When registration requires email verification, `_auth_registration_intents`
is written inside that same identity/owner transaction. It is the narrow bridge
that keeps the newly provisioned owner recoverable after successful delivery
and receipt finalization but before the user consumes the verification link.
For multi mode the intent records the exact tenant ID, so one registration can
never authorize a second organization. Verification makes the account
token-eligible and removes the intent atomically. The provisioning receipt is
not reused for this longer-lived state: it remains an exact, leased
compensation capability and disappears after delivery/session provisioning.

Each receipt also has a bounded five-minute owner lease. The creating process
holds the opaque lease capability; SQLite stores only its SHA-256 digest and
expiry. The registration orchestrator atomically renews that exact lease before
crossing the potentially slow email/session/token boundary. An expired owner
cannot revive its lease or finalize stale work.

The registration orchestrator calls
`finalizeRegistrationProvisioning(receipt)` only after session/token or
verification-email provisioning succeeds. Finalization removes the receipt and
closes bootstrap atomically. On failure,
`rollbackRegistrationProvisioning(receipt)` removes the receipt-bound tenant,
memberships, role assignments, native-request bindings, platform/legacy action
tokens, sessions, refresh tokens, intents, and user in one transaction. It does
not expose a general last-owner bypass. Runtime startup calls
`recoverPendingRegistrationProvisioning()` before bootstrap reconciliation,
but may recover only an expired or legacy-unowned receipt. A second process
cannot delete another process's live provisional graph. Finalize and ordinary
rollback require the exact lease; recovery rechecks expiry under the SQLite
writer lock. This leaves an interrupted install retryable without reopening a
completed installation or silently accepting partial success.

Administrator-created accounts that request setup email use a separate
`_auth_admin_user_provisioning` receipt table. They never count as pending
registrations and therefore cannot inherit a registration-only bootstrap or
tenant-owner exception. Zero persists an exact identity fingerprint, security
generation, lease capability, and the ID of the exact setup token before
crossing the email provider boundary. The final password gate and receipt
finalization share one transaction and recheck the original state under the
SQLite writer lock.

Failed delivery removes only the still-untouched provisional identity and its
exact setup token. If another authorized operation has already changed the
identity, security generation, authority, session state, unrelated token
state, or an app row linked to that user by a foreign key, compensation
invalidates the provisional setup link, preserves the adopted account, and
retires only the stale receipt. Startup applies the same rule to an expired
receipt and emits `AUTH_ADMIN_USER_PROVISIONING_RECOVERED` with
`cleanupSucceeded`; it never blindly deletes newer user state after a process
interruption. Recovery success signals are scheduled at the enclosing
transaction's after-commit boundary, so rolled-back startup work is never
reported as recovered.

Protected application and tenant ownership uses the same predicate as token
issuance: `status = active`, no password-change requirement, and either no
email-verification requirement or a positive verification timestamp.
`updateUser()` also clears `email_verified_at` whenever the canonical email
changes. Its current-address read, canonical uniqueness checks, verification
clear, and row update share one SQLite writer transaction, so another process
cannot move a verification timestamp between addresses in the comparison/write
gap. Domain services and SQLite lifecycle triggers reject any transition
that would leave an installed application or active tenant without another
token-eligible owner. The only gated-owner exceptions are the exact pending
registration receipt during atomic creation/rollback and the scoped
registration intent during delivered-email verification.

The registration result also carries `authGeneration`, captured inside the
identity/provisioning transaction. Authentication orchestration must pass that
exact value through MFA, tenant selection/onboarding, and session issuance. It
must not query the current generation after an asynchronous boundary: a reset
which commits in between invalidates the receipt and produces
`AUTH_STATE_CHANGED` instead of blessing the original ceremony with newer
security state.

### updateUser

```ts
updateUser(userId: string, partial: Partial<{
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
}>): UserRecord | null
```

Uses `db.update('users', userId, { ...mapped, updated_at: Date.now() })`. The
ReactiveDB `update()` method reads the current row, merges the partial, writes
the full row, and emits a change event. Default platform Sync policy consumes
the event for sequencing/invalidation but does not deliver the private user row
through generic Sync.

### deleteUser

```ts
deleteUser(userId: string): boolean
```

Uses `db.delete('users', userId)`. SQLite `ON DELETE CASCADE` removes
identity-owned private state such as `_credentials`, `user_properties`,
`_refresh_tokens`, and `_auth_action_tokens`. The `db.delete()` call emits a
change event for the `users` table. Generic Sync subscribers do not receive the
private row or its deletion under default `createApp()` policy.

In multi-tenant mode, organization records are durable history rather than
identity-owned scratch state. Tenant creation attribution, memberships,
invitations, and join requests therefore use restrictive user references. A
hard delete that reaches any of that history fails with HTTP 409 and stable
code `USER_HAS_TENANT_HISTORY`; suspend the identity instead. The foreign-key
decision happens in the same SQLite immediate transaction as the delete, so a
second runtime cannot attach history between a stale preflight and commit.
Registration compensation uses its separate exact provisioning receipt and is
not an ordinary administrator deletion.

### verifyPassword

```ts
async verifyPassword(userId: string, password: string): Promise<boolean>
verifyPasswordForAuthentication(
  userId: string,
  password: string,
): Promise<PasswordAuthenticationProof | null>
```

The facade delegates the lookup and verification to `UserCredentialStore`.
`Bun.password.verify()` detects Argon2id parameters from the stored hash and
returns `true`/`false`; an incorrect password is not an exception. The runtime
profile fence is checked before and after the asynchronous verification so a
profile change cannot authorize a stale in-flight result.

Authentication flows use `verifyPasswordForAuthentication()`. Its secret-free
proof contains the exact auth generation read with the verified hash, and the
store rechecks both after Argon2 returns. `verifyPassword()` remains the
compatible boolean wrapper for callers that do not issue authentication state.

### updatePassword

```ts
async updatePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean>
updatePasswordForAuthentication(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<PasswordChangeAuthenticationReceipt | null>
```

**Steps:**
1. Read the current credential and verify the supplied password.
2. Hash the replacement with `Bun.password.hash()`.
3. Inside one transaction, compare-and-swap the exact hash that was verified,
   clear the password-change gate, revoke the user's sessions/tokens, and
   append the security audit event.
4. Return `false` if the credential changed concurrently; otherwise return
   `true` after commit.

The compare-and-swap prevents two concurrent updates that verified the same
old password from both committing. The authenticated change-password route uses
`updatePasswordForAuthentication()`, whose receipt captures the post-revocation
generation in that same transaction. Replacement-session issuance is bound to
the receipt; a later reset fails with `AUTH_STATE_CHANGED`. `updatePassword()`
retains its existing boolean contract.

### resetPassword

```ts
async resetPassword(
  userId: string,
  newPassword: string,
  options?: {
    passwordChangeRequired?: boolean;
    audit?: AuthSecurityAuditContext;
    beforeCommit?: () => void;
  },
): Promise<boolean>
```

Admin reset flow. It does not require the current password, but it does verify
the user exists. On success it replaces the hash, applies the requested
password-change gate, revokes sessions/tokens, and appends the audit event in
one transaction. If the user is deleted while hashing, the method returns
`false`. If the user still exists but its required credential row is missing,
the store fails closed with `AUTH_STATE_INVARIANT_FAILED` instead of reporting
an ordinary not-found result.

Password-action consumption and optional `beforeCommit` callbacks follow the
synchronous transaction-callback contract above.

### completePasswordAction

```ts
async completePasswordAction(
  userId: string,
  newPassword: string,
  consumeActionToken: () => void,
  auditContext?: AuthSecurityAuditContext,
): Promise<boolean>
```

This is the commit boundary for reset/setup links. Password hashing finishes
before the transaction starts. The synchronous token consumer then joins the
same transaction as the credential replacement, account-gate clear,
session/token revocation, and audit append. A later failure rolls everything
back, including generic platform-token consumption when both services share
the required transaction domain.

### Properties KV

```ts
setProperty(userId: string, key: string, value: string): void
setProperties(userId: string, properties: Record<string, string>): void
getProperty(userId: string, key: string): string | null
getProperties(userId: string): Record<string, string>
deleteProperty(userId: string, key: string): void
```

`setProperty` uses a prepared `INSERT OR REPLACE` statement. `deleteProperty`
uses a prepared `DELETE` statement. These methods are low-level store methods;
HTTP routes should enforce configured metadata policy before calling them.
`setProperties` wraps multiple property upserts in one transaction.

`createUser()` also accepts an optional `properties` map so registration and
admin creation can store configured defaults atomically with the user and
credential rows.

**Use cases:**
- Notification preferences: `setProperty(userId, 'notifications_enabled', 'true')`
- Theme: `setProperty(userId, 'theme', 'dark')`
- Timezone: `setProperty(userId, 'timezone', 'America/New_York')`
- Safe app preferences that do not grant access

Reserved system keys such as `groups`, `permissions`, `tenantId`,
`tenantIds`, `clearance`, and storage-backed `avatarFileId` should be written
through dedicated admin/system routes, not the generic current-user properties
route.

### Refresh Token Operations

```ts
storeRefreshToken(tokenId: string, userId: string, tokenHash: string, expiresAt: number): void
getRefreshTokenByHash(tokenHash: string): RefreshTokenRecord | null
revokeRefreshToken(tokenId: string): void
revokeAllUserTokens(userId: string): void
deleteExpiredTokens(): number
```

These compatibility methods delegate to `UserTokenStore`, which owns the
prepared statements for `_refresh_tokens`. They remain synchronous facade
methods and do not expose the internal store. Writes run in the shared
ReactiveDB transaction domain but do not produce a client Sync stream.

**`getRefreshTokenByHash` can return a matching revoked row.** The query does
not add `WHERE revoked_at IS NULL`; `TokenService` checks `revokedAt` and
`expiresAt` after lookup. This is deliberate: replay detection must see a
consumed token. Reuse advances the user's security generation and revokes the
backing session/token family. Filtering revoked rows at SQL lookup time would
turn replay into an indistinguishable unknown token.

```ts
const record = store.getRefreshTokenByHash(tokenHash);
if (record?.revokedAt != null) {
  // TokenService treats reuse as replay; it is not a normal valid lookup.
}
```

### Legacy Auth Action Tokens

```ts
storeActionToken(params): AuthActionTokenRecord
getActionTokenByHash(tokenHash: string): AuthActionTokenRecord | null
consumeActionToken(tokenId: string): boolean
countRecentActionTokens(params): number
deleteExpiredActionTokens(): number
```

These facade methods delegate to `UserTokenStore`, which operates on
`_auth_action_tokens` for legacy compatibility and never stores raw
reset/setup tokens. Normal `createApp()` reset/setup flows use
`PlatformTokenService` and `_zero_action_tokens`; `AuthActionTokenService`
wraps the platform service while falling back to this legacy table for old
outstanding links. Advanced direct composition may explicitly select a null
platform-token service to keep the legacy storage path.

The platform-token store is separate from `UserTokenStore`, but the two must
share the exact same ReactiveDB transaction domain when composed together. See
[Platform Tokens: Auth Transaction Boundary](../tokens.md#auth-transaction-boundary).

`deleteExpiredTokens()` delegates cleanup to `UserTokenStore`, removes expired
or old revoked refresh rows, asks the attached session store to remove expired
parent sessions, and returns the number of deleted refresh rows.

### Auth Config Operations

```ts
getConfig(key: string): string | null
setConfig(key: string, value: string): void
```

Used by TokenService to persist the signing keypair:

```ts
// Store keypair on first start
setConfig('signing_key_private', JSON.stringify(jwk));
setConfig('signing_key_id', keyId);

// Load on subsequent starts
const jwk = JSON.parse(getConfig('signing_key_private')!);
```

## Password Hashing

### Bun.password

Bun provides native password hashing — no external dependency:

```ts
// Hash (async — CPU-intensive, doesn't block event loop)
const hash = await Bun.password.hash('s3cret!');
// → "$argon2id$v=19$m=65536,t=2,p=1$..."

// Verify (async)
const valid = await Bun.password.verify('s3cret!', hash);
// → true/false
```

**Defaults (Argon2id):**
- Memory: 64 MB (`m=65536`)
- Iterations: 2 (`t=2`)
- Parallelism: 1 (`p=1`)

These are OWASP-recommended defaults. Argon2id is resistant to both side-channel and GPU attacks. The hash includes the algorithm, version, and parameters — verification is self-describing.

**Why `Bun.password` and not bcrypt/scrypt:**
- Native to Bun — zero dependencies
- Argon2id is the OWASP first choice for password hashing (2024 guidelines)
- Memory-hard — resistant to GPU/ASIC attacks unlike bcrypt
- Async — hashing doesn't block the Bun event loop

## Change Tracking And Client Exposure

### What broadcasts

| Table | Generic `createApp()` Sync | Supported client path |
|-------|----------------------------|-----------------------|
| `users` | Denied across snapshot, catch-up, and live delivery | Login/register/refresh, `/auth/me`, and protected admin auth APIs |
| `user_properties` | Not a ReactiveDB table stream | Current-user and admin property APIs |
| `_credentials` | Internal; never client-readable | None |
| `_refresh_tokens` | Internal; never client-readable | Opaque refresh-token protocol only |
| `_auth_config` | Internal; never client-readable | Sanitized public/admin config APIs |
| `_auth_audit_events` and audit support state | Internal; never generic Sync data | Authorized tenant/platform audit APIs, strict browser client/hook, and packaged viewer |

### Example: role change

```ts
// Admin changes user role via HTTP route
authStore.updateUser(userId, { role: 'admin' });
```

What happens:

1. The protected admin route validates the transition.
2. `UserStore.updateUser()` writes the row through ReactiveDB and emits a
   server-side change event.
3. Security-relevant changes revoke the user's refresh sessions and invalidate
   the old authorization boundary.
4. Bearer/page-session/Sync verification re-reads live user state and rejects
   stale or ineligible sessions.
5. Admin and current-user UI obtain user projections from the auth APIs; no
   generic `users` subscription is required or allowed by default.

This separates enforcement from UI freshness: an unauthorized stale client
view cannot preserve server authority.

## Key Types

```ts
interface UserRecord {
  userId: string;
  username: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  role: string;
  status: 'active' | 'suspended';
  passwordChangeRequired: boolean;
  emailVerifiedAt: number | null;
  emailVerificationRequired: boolean;
  mfaRequired: boolean;
  createdAt: number;
  updatedAt: number | null;
  properties: Record<string, string>;
}

interface RefreshTokenRecord {
  tokenId: string;
  userId: string;
  sessionId: string | null;
  tokenHash: string;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
}

interface AuthActionTokenRecord {
  tokenId: string;
  userId: string;
  type: 'account_setup' | 'password_reset' | 'admin_password_reset' | 'email_verification';
  tokenHash: string;
  expiresAt: number;
  consumedAt: number | null;
  createdAt: number;
  createdBy: string | null;
  metadata: Record<string, unknown>;
}
```

**Column name mapping:** SQLite uses `snake_case` (`user_id`, `first_name`). TypeScript uses `camelCase` (`userId`, `firstName`). The UserStore maps between them in read methods. Write methods accept the TypeScript shape and map to SQL columns internally.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Duplicate username | Throws `AuthError('Username taken', 'DUPLICATE_USERNAME', 409)` after the transaction-local identity recheck |
| Duplicate email | Throws `AuthError('Email taken', 'DUPLICATE_EMAIL', 409)` after canonical-email conflict checks |
| User not found (read) | Returns `null` — caller decides if this is an error |
| User not found (update/delete) | Returns `null`/`false` — no change emitted |
| Invalid password (verify) | Returns `false` — caller decides the error message |
| Existing user is missing a required credential during reset/recovery | Emits the auth invariant observability code and throws `AUTH_STATE_INVARIANT_FAILED` — never masquerades as not found |
| Transaction-bound authority/lifecycle callback returns a Promise-like value | Consumes any later rejection and throws `AUTH_STATE_INVARIANT_FAILED`; the enclosing transaction rolls back |
| Expired refresh token | `getRefreshTokenByHash()` returns the record; TokenService checks `expires_at` in code and returns `null` if expired |
| Revoked refresh token | `getRefreshTokenByHash()` returns the record even if revoked; TokenService treats reuse as replay, advances security state, and revokes the backing session/token family |
| Foreign key violation | SQLite enforces — attempting to insert a credential for non-existent user throws |
| Database disposed | ReactiveDB throws `Error('ReactiveDB is disposed')` — same as all other operations |
